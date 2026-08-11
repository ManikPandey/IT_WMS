const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const pino = require('pino');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const CircuitBreaker = require('opossum');
const { z } = require('zod');
const { generateSpec } = require('./swagger');

// Logger setup
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// 1. Security & Middleware
app.use(helmet());
app.use(cors({ origin: ['http://localhost:5173'] })); // Tightened CORS
app.use(express.json());

// Correlation ID Middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Structured Logging
app.use(pinoHttp({ 
  logger,
  genReqId: req => req.id
}));

// Swagger Docs
app.use('/docs', swaggerUi.serve, swaggerUi.setup(generateSpec()));

// 2. Auth & RBAC
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    req.log.warn({ email }, 'Failed login attempt');
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing Authorization header' });
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

const requireRole = (roles) => (req, res, next) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  if (!allowedRoles.includes(req.user.role)) {
    req.log.warn({ user: req.user.id, required: allowedRoles }, 'Role authorization failed');
    return res.status(403).json({ error: `Forbidden: Requires one of ${allowedRoles.join(', ')}` });
  }
  next();
};

// 3. Rate Limiting (Token Bucket)
const rateLimiter = async (req, res, next) => {
  if (!req.user) return next();
  
  const capacity = 50; // max requests
  const rate = 5; // requests per second to refill
  const key = `ratelimit:${req.user.id}`;
  const now = Date.now();

  const script = `
    local key = KEYS[1]
    local capacity = tonumber(ARGV[1])
    local rate = tonumber(ARGV[2])
    local now = tonumber(ARGV[3])
    
    local bucket = redis.call("HMGET", key, "tokens", "last_update")
    local tokens = tonumber(bucket[1])
    local last_update = tonumber(bucket[2])
    
    if not tokens then
      tokens = capacity
      last_update = now
    end
    
    local elapsed = math.max(0, (now - last_update) / 1000)
    tokens = math.min(capacity, tokens + (elapsed * rate))
    
    if tokens >= 1 then
      tokens = tokens - 1
      redis.call("HMSET", key, "tokens", tokens, "last_update", now)
      redis.call("PEXPIRE", key, 60000)
      return {1, tokens}
    else
      return {0, tokens}
    end
  `;

  try {
    const result = await redis.eval(script, 1, key, capacity, rate, now);
    if (result[0] === 1) {
      res.setHeader('X-RateLimit-Remaining', Math.floor(result[1]));
      next();
    } else {
      res.setHeader('Retry-After', 1);
      res.status(429).json({ error: 'Too Many Requests' });
    }
  } catch (err) {
    req.log.error(err, 'Rate limiter error');
    next(); // fail open
  }
};

app.use('/purchase-orders', rateLimiter);
app.use('/dashboard/stats', rateLimiter);

// 4. Endpoints

app.get('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, username: true, name: true, email: true, role: true } });
  res.json(users);
});

app.post('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { username, name, email, password, role } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { username, name, email, password_hash, role } });
  res.status(201).json({ id: user.id, username, email });
});

// Zod schema for PO creation
const CreatePOSchema = z.object({
  vendor: z.string().min(1),
  budget: z.number().positive(),
  request_date: z.string().optional(),
  gstin: z.string().optional(),
  department: z.string().optional(),
  billing_address: z.string().optional(),
  delivery_address: z.string().optional(),
  custom_attributes: z.record(z.any()).optional()
});

app.post('/purchase-orders', requireAuth, async (req, res) => {
  try {
    const parsed = CreatePOSchema.parse(req.body);
    const po = await prisma.purchaseOrder.create({
      data: {
        ...parsed,
        request_date: parsed.request_date ? new Date(parsed.request_date) : new Date(),
        status: 'PENDING',
        idempotency_key: `po-create-${Date.now()}`
      }
    });
    res.status(201).json(po);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues });
    req.log.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/purchase-orders', requireAuth, requireRole(['ADMIN', 'VIEWER']), async (req, res) => {
  const { cursor, search, limit = 50 } = req.query;
  const where = {};
  
  if (search) {
    where.OR = [
      { vendor: { contains: search, mode: 'insensitive' } },
      { department: { contains: search, mode: 'insensitive' } }
    ];
  }

  const query = {
    where,
    take: Number(limit) + 1,
    orderBy: { id: 'desc' }
  };
  
  if (cursor) {
    query.cursor = { id: parseInt(cursor, 10) };
  }

  const pos = await prisma.purchaseOrder.findMany(query);
  let nextCursor = null;
  if (pos.length > limit) {
    const nextItem = pos.pop();
    nextCursor = nextItem.id;
  }
  
  res.json({ data: pos, nextCursor });
});

app.post('/purchase-orders/:id/approve', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required' });

  const { finalBudget } = req.body;
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  const cacheKey = `idem:${idempotencyKey}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (parsedCache.bodyHash === bodyHash) return res.status(parsedCache.statusCode).json(parsedCache.responseBody);
      return res.status(409).json({ error: 'Idempotency key reused with different payload' });
    }

    const poId = parseInt(req.params.id, 10);
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    if (po.status !== 'PENDING') return res.status(400).json({ error: 'Purchase Order is already processed' });

    const updatedPo = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'APPROVED', budget: finalBudget || po.budget, idempotency_key: idempotencyKey, action_date: new Date() }
    });

    const responseBody = { message: 'Approved successfully', po: updatedPo };
    await redis.set(cacheKey, JSON.stringify({ bodyHash, statusCode: 200, responseBody }), 'EX', 86400);

    // Publish to CQRS read model indirectly via Saga outbox (if required) or directly.
    // For PO_APPROVED, we'll write an outbox event so consumer handles it.
    await prisma.outboxEvent.create({
      data: { event_type: 'PO_APPROVED', payload_json: { poId, request_id: req.id } }
    });

    res.status(200).json(responseBody);
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/purchase-orders/:id/reject', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const poId = parseInt(req.params.id, 10);
  try {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    if (po.status === 'REJECTED') return res.status(400).json({ error: 'Already rejected' });

    const result = await prisma.$transaction(async (tx) => {
      const updatedPo = await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: 'REJECTED', action_date: new Date() }
      });
      
      if (['APPROVED', 'ISSUED', 'COMPLETED'].includes(po.status)) {
        await tx.outboxEvent.create({ data: { event_type: 'PO_REJECTED', payload_json: { poId, request_id: req.id } } });
      }
      return updatedPo;
    });

    res.json(result);
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/audit-log', requireAuth, async (req, res) => {
  const { entity_type, cursor, limit = 50 } = req.query;
  const where = {};
  if (entity_type) where.event_type = { startsWith: entity_type };
  
  const query = { where, take: Number(limit) + 1, orderBy: { id: 'desc' } };
  if (cursor) query.cursor = { id: parseInt(cursor, 10) };

  const logs = await prisma.auditLog.findMany(query);
  let nextCursor = null;
  if (logs.length > limit) {
    nextCursor = logs.pop().id;
  }
  res.json({ data: logs, nextCursor });
});

// CQRS Dashboard Stats
app.get('/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const stats = await prisma.dashboardSummary.findUnique({ where: { id: 1 } });
    res.json(stats || { total_assets: 0, total_maintenance_cost: 0, active_issues: 0, in_stock_assets: 0, out_of_stock_assets: 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: 'Failed to read CQRS dashboard view' });
  }
});

app.get('/procurement/stats', requireAuth, requireRole(['ADMIN', 'VIEWER']), async (req, res) => {
  try {
    const { range } = req.query;
    const truncStr = range === 'yearly' ? 'year' : range === 'weekly' ? 'week' : 'month';
    const stats = await prisma.$queryRawUnsafe(`
      SELECT date_trunc($1, created_at) as period, SUM(budget) as total_spend 
      FROM "PurchaseOrder" 
      WHERE status IN ('APPROVED', 'ISSUED', 'COMPLETED') 
      GROUP BY period 
      ORDER BY period ASC
    `, truncStr);

    const spendOverTime = stats.reduce((acc, row) => {
      let key = new Date(row.period).toISOString().slice(0, 7);
      if (range === 'yearly') key = new Date(row.period).toISOString().slice(0, 4);
      if (range === 'weekly') key = new Date(row.period).toISOString().slice(0, 10);
      acc[key] = row.total_spend;
      return acc;
    }, {});
    res.json({ spendOverTime });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Circuit Breaker for Inventory Service Calls
const fetchInventoryHealth = async () => {
  const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error('Inventory returned non-200');
  return res.json();
};

const inventoryHealthBreaker = new CircuitBreaker(fetchInventoryHealth, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000 // half-open after 10s
});

inventoryHealthBreaker.fallback(() => ({ status: 'degraded', message: 'Inventory Service temporarily unavailable' }));

// Circuit Breaker for Inventory Allocate
const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001';

const fetchInventoryAllocate = async (payload, reqId) => {
  const res = await fetch(`${INVENTORY_URL}/allocate?strategy=redis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': reqId
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000)
  });
  
  if (res.status === 409) {
    const data = await res.json();
    throw new Error(`409:${data.error}`); // Pass through Out of stock
  }
  if (!res.ok) throw new Error('Inventory returned non-200');
  return res.json();
};

const allocateBreaker = new CircuitBreaker(fetchInventoryAllocate, {
  timeout: 6000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000
});

app.post('/allocate', requireAuth, async (req, res) => {
  try {
    const result = await allocateBreaker.fire(req.body, req.id);
    res.json(result);
  } catch (e) {
    if (e.message.startsWith('409:')) {
      return res.status(409).json({ error: e.message.substring(4) });
    }
    req.log.error(e, 'Failed to proxy /allocate');
    res.status(503).json({ error: 'Inventory service unavailable' });
  }
});

app.get('/system/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    const invHealth = await inventoryHealthBreaker.fire();
    res.json({ status: 'ok', core_db: 'ok', redis: 'ok', inventory_service: invHealth });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.get('/system/export', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const coreDump = {
      users: await prisma.user.findMany({ select: { id: true, username: true, email: true, role: true } }),
      purchaseOrders: await prisma.purchaseOrder.findMany(),
      auditLogs: await prisma.auditLog.findMany()
    };
    
    let inventoryDump = {};
    try {
      const invRes = await fetch('http://localhost:3001/export-data');
      if (invRes.ok) inventoryDump = await invRes.json();
    } catch (e) {
      req.log.warn('Could not fetch inventory dump for export', e);
    }
    
    const combined = { core: coreDump, inventory: inventoryDump, timestamp: new Date() };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="system-export.json"');
    res.send(JSON.stringify(combined, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => {
    logger.info(`Core service listening on port ${port}`);
  });
}

module.exports = app;
