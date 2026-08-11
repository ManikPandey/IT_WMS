const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

app.use(express.json());
app.use(cors());

// 1. Auth & RBAC
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
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

const requireRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).json({ error: `Forbidden: Requires ${role} role` });
  }
  next();
};

// 1.5 User CRUD (Admin)
app.get('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, name: true, email: true, role: true }
  });
  res.json(users);
});

app.post('/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const { username, name, email, password, role } = req.body;
  const password_hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { username, name, email, password_hash, role }
  });
  res.status(201).json({ id: user.id, username, email });
});

// 2. PO Creation
app.post('/purchase-orders', requireAuth, async (req, res) => {
  const { vendor, budget, request_date, gstin, department, billing_address, delivery_address, custom_attributes } = req.body;
  const po = await prisma.purchaseOrder.create({
    data: {
      vendor,
      budget,
      request_date: request_date ? new Date(request_date) : new Date(),
      gstin,
      department,
      billing_address,
      delivery_address,
      custom_attributes,
      status: 'PENDING',
      idempotency_key: `po-create-${Date.now()}` // internal unique
    }
  });
  res.status(201).json(po);
});

app.get('/purchase-orders', requireAuth, async (req, res) => {
  const pos = await prisma.purchaseOrder.findMany({
    orderBy: { created_at: 'desc' }
  });
  res.json(pos);
});

// 3. PO Approval with Idempotency
app.post('/purchase-orders/:id/approve', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const { comments, finalBudget } = req.body; // example payload fields
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
  const cacheKey = `idem:${idempotencyKey}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsedCache = JSON.parse(cached);
      if (parsedCache.bodyHash === bodyHash) {
        // Safe retry, return cached response
        return res.status(parsedCache.statusCode).json(parsedCache.responseBody);
      } else {
        // Same key, different payload -> Conflict
        return res.status(409).json({ error: 'Idempotency key reused with different payload' });
      }
    }

    // Process the request
    const poId = parseInt(req.params.id, 10);
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });
    
    if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
    if (po.status !== 'PENDING') return res.status(400).json({ error: 'Purchase Order is already processed' });

    // Update PO
    const updatedPo = await prisma.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: 'APPROVED',
        budget: finalBudget || po.budget,
        idempotency_key: idempotencyKey,
        action_date: new Date()
      }
    });

    const responseBody = { message: 'Approved successfully', po: updatedPo };
    const statusCode = 200;

    // Cache the response with 24h TTL (86400 seconds)
    await redis.set(
      cacheKey,
      JSON.stringify({ bodyHash, statusCode, responseBody }),
      'EX',
      86400
    );

    res.status(statusCode).json(responseBody);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/audit-log', requireAuth, async (req, res) => {
  const { entity_type } = req.query; // optional filter
  
  const where = {};
  if (entity_type) {
    where.event_type = { startsWith: entity_type };
  }
  
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { created_at: 'desc' },
    take: 100
  });
  res.json(logs);
});

// 4. Procurement Stats
app.get('/procurement/stats', requireAuth, async (req, res) => {
  // Aggregate spend over time by month
  const pos = await prisma.purchaseOrder.findMany({ where: { status: 'APPROVED' } });
  
  const spendOverTime = pos.reduce((acc, po) => {
    const month = po.created_at.toISOString().slice(0, 7);
    acc[month] = (acc[month] || 0) + po.budget;
    return acc;
  }, {});

  res.json({ spendOverTime });
});

// 5. System Health & Export
app.get('/system/health', async (req, res) => {
  try {
    // Core DB
    await prisma.$queryRaw`SELECT 1`;
    // Redis
    await redis.ping();
    
    // Inventory Health
    let inventoryStatus = 'unknown';
    try {
      const invRes = await fetch('http://localhost:3001/health');
      if (invRes.ok) inventoryStatus = 'ok';
    } catch (e) {
      inventoryStatus = 'down';
    }

    res.json({ status: 'ok', core_db: 'ok', redis: 'ok', inventory_service: inventoryStatus });
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
      console.warn('Could not fetch inventory dump', e);
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
app.listen(port, () => {
  console.log(`Core service listening on port ${port}`);
});
