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
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const exceljs = require('exceljs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'demo',
  api_key: process.env.CLOUDINARY_API_KEY || 'demo',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'demo'
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'it_wms_po_documents',
    allowedFormats: ['jpg', 'png', 'pdf'],
  },
});
const upload = multer({ storage: storage, limits: { fileSize: 2 * 1024 * 1024 } }); // 2MB
const uploadExcel = multer({ dest: 'uploads/' });

// Logger setup
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001';

// 1. Security & Middleware
app.use(helmet());
const frontendOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(u => u.trim().replace(/\/$/, '')) 
  : [];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow non-browser requests
    if (origin.includes('localhost') || origin.includes('vercel.app') || frontendOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
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
  
  // 15 minute access token
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: '15m' });
  
  // 7 day refresh token
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
  
  await redis.set(`refresh_token:${user.id}`, hashedRefresh, 'EX', 7 * 24 * 60 * 60);

  res.json({ token, refreshToken, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.post('/auth/refresh', async (req, res) => {
  const { refreshToken, userId } = req.body;
  if (!refreshToken || !userId) return res.status(400).json({ error: 'Missing refreshToken or userId' });

  const storedHashed = await redis.get(`refresh_token:${userId}`);
  if (!storedHashed) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  const providedHashed = crypto.createHash('sha256').update(refreshToken).digest('hex');
  if (storedHashed !== providedHashed) return res.status(401).json({ error: 'Invalid refresh token' });

  const user = await prisma.user.findUnique({ where: { id: parseInt(userId, 10) } });
  if (!user) return res.status(401).json({ error: 'User no longer exists' });

  const newToken = jwt.sign({ id: user.id, email: user.email, role: user.role, username: user.username, name: user.name }, JWT_SECRET, { expiresIn: '15m' });
  
  // Rotate refresh token
  const newRefreshToken = crypto.randomBytes(40).toString('hex');
  const newHashedRefresh = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
  await redis.set(`refresh_token:${user.id}`, newHashedRefresh, 'EX', 7 * 24 * 60 * 60);

  res.json({ token: newToken, refreshToken: newRefreshToken });
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

app.post('/auth/logout', requireAuth, async (req, res) => {
  await redis.del(`refresh_token:${req.user.id}`);
  res.json({ message: 'Logged out successfully' });
});

// 3. Rate Limiting (Token Bucket)
const rateLimiter = async (req, res, next) => {
  if (!req.user) return next();
  
  const capacity = 50; // max requests
  const rate = 5; // requests per second to refill
  const key = `ratelimit:${req.user.id}`;
  const now = Date.now();

  console.log('rateLimiter executed for user:', req.user.id);
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
    console.error('RATE LIMITER LUA ERROR:', err);
    req.log.error(err, 'Rate limiter error');
    next(); // fail open
  }
};


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

app.patch('/users/:id/password', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { password } = req.body;
    if (!password || password.length < 2) return res.status(400).json({ error: 'Password too short' });
    const password_hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id }, data: { password_hash } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Asset Requests
const CreateAssetRequestSchema = z.object({
  category_id: z.number().int().positive(),
  justification: z.string().min(5)
});

app.post('/asset-requests', requireAuth, requireRole(['EMPLOYEE', 'ADMIN']), async (req, res) => {
  try {
    const parsed = CreateAssetRequestSchema.parse(req.body);
    const request = await prisma.assetRequest.create({
      data: {
        requested_by: req.user.id,
        category_id: parsed.category_id,
        justification: parsed.justification
      }
    });
    res.status(201).json(request);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues });
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/asset-requests', requireAuth, async (req, res) => {
  const where = req.user.role === 'EMPLOYEE' ? { requested_by: req.user.id } : {};
  const requests = await prisma.assetRequest.findMany({ where, orderBy: { created_at: 'desc' } });
  res.json(requests);
});

app.patch('/asset-requests/:id/approve', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  
  // Conditional update to prevent Lost Update race conditions
  const updateResult = await prisma.assetRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'PROCESSING', approved_by: req.user.id }
  });
  
  if (updateResult.count === 0) return res.status(409).json({ error: 'Request not found or already processed' });
  
  const assetRequest = await prisma.assetRequest.findUnique({ where: { id } });

  try {
    // Attempt allocation via Circuit Breaker
    await allocateBreaker.fire({
      assetType: 'LAPTOPS', // Hardcoded fallback for now, normally fetch category
      assignedTo: assetRequest.requested_by,
      warehouseId: 1
    }, req.id);

    const updated = await prisma.assetRequest.update({
      where: { id },
      data: { status: 'APPROVED', resolved_at: new Date() }
    });
    res.json(updated);
  } catch (err) {
    // Revert status on failure
    // Revert status on failure
    await prisma.assetRequest.update({
      where: { id },
      data: { status: 'PENDING', approved_by: null }
    });
    req.log.error(err, 'Asset request approval failed during allocation');
    if (err.message.startsWith('409:')) {
      return res.status(409).json({ error: err.message.substring(4) });
    }
    res.status(500).json({ error: 'Failed to allocate asset. Out of stock?' });
  }
});

app.patch('/asset-requests/:id/reject', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  
  const updateResult = await prisma.assetRequest.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'REJECTED', approved_by: req.user.id, resolved_at: new Date() }
  });
  
  if (updateResult.count === 0) return res.status(409).json({ error: 'Request not found or already processed' });

  const updated = await prisma.assetRequest.findUnique({ where: { id } });
  res.json(updated);
});

// Zod schema for PO creation (modified for line items)
const CreatePOSchema = z.object({
  vendor: z.string().min(1),
  request_date: z.string().optional(),
  gstin: z.string().optional(),
  department: z.string().optional(),
  billing_address: z.string().optional(),
  delivery_address: z.string().optional(),
  custom_attributes: z.string().optional(), // Passed as JSON string if formData
  line_items: z.string() // Passed as JSON string: [{ category_id, description, quantity, unit_price }]
});

app.post('/purchase-orders', requireAuth, rateLimiter, requireRole('ADMIN'), upload.single('document'), async (req, res) => {
  try {
    const parsed = CreatePOSchema.parse(req.body);
    const lineItems = JSON.parse(parsed.line_items);
    const customAttributes = parsed.custom_attributes ? JSON.parse(parsed.custom_attributes) : null;
    
    let totalBudget = 0;
    lineItems.forEach(item => totalBudget += (item.quantity * item.unit_price));

    const po = await prisma.purchaseOrder.create({
      data: {
        vendor: parsed.vendor,
        request_date: parsed.request_date ? new Date(parsed.request_date) : new Date(),
        gstin: parsed.gstin,
        status: 'PENDING',
        idempotency_key: crypto.randomUUID(),
        department: parsed.department,
        billing_address: parsed.billing_address,
        delivery_address: parsed.delivery_address,
        custom_attributes: parsed.custom_attributes ? JSON.parse(parsed.custom_attributes) : null,
        document_url: req.file ? req.file.path : null,
        line_items: {
          create: lineItems.map(li => ({
            category_id: li.category_id,
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price
          }))
        }
      },
      include: { line_items: true }
    });

    res.status(201).json(po);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues });
    req.log.error(error);
    res.status(500).json({ error: 'Failed to create PO' });
  }
});

app.get('/purchase-orders/grn-template', requireAuth, async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('GRN');
    worksheet.columns = [
      { header: 'LineItemID', key: 'line_item_id', width: 15 },
      { header: 'ReceivedQty', key: 'received_qty', width: 15 },
      { header: 'AssetTag', key: 'asset_tag', width: 25 },
      { header: 'SerialNumber', key: 'serial_number', width: 25 }
    ];
    worksheet.addRow({ line_item_id: 1, received_qty: 1, asset_tag: 'TAG-1234', serial_number: 'SN-ABCD' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=GRN_Template.xlsx');
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: 'Failed to generate template' });
  }
});

// Excel file upload via Multer for GRN (Goods Receipt Note)
app.post('/purchase-orders/:id/receive', requireAuth, requireRole('ADMIN'), upload.single('file'), async (req, res) => {
  const poId = parseInt(req.params.id, 10);
  
  if (!req.file) return res.status(400).json({ error: 'Excel file is required' });

  try {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { line_items: true }
    });

    if (!po) return res.status(404).json({ error: 'PO not found' });
    if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      return res.status(400).json({ error: 'PO must be APPROVED or PARTIALLY_RECEIVED to receive goods' });
    }

    const workbook = new exceljs.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.worksheets[0];
    
    const assetsToCreate = [];
    const updates = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header
      // Assuming columns: 1=LineItemID, 2=ReceivedQty, 3=AssetTag, 4=SerialNumber
      const lineItemId = row.getCell(1).value;
      const receivedQty = row.getCell(2).value;
      const assetTag = row.getCell(3).value;
      const serialNumber = row.getCell(4).value;

      if (!lineItemId || !receivedQty || !assetTag) return;

      const lineItem = po.line_items.find(li => li.id === parseInt(lineItemId, 10));
      if (!lineItem) throw new Error(`Line item ${lineItemId} not found in this PO`);

      if (lineItem.received_qty + receivedQty > lineItem.quantity) {
        throw new Error(`Cannot receive more than ordered for line item ${lineItemId}`);
      }

      // We will bulk create assets in inventory-service
      assetsToCreate.push({
        asset_tag: assetTag.toString(),
        serial_number: serialNumber ? serialNumber.toString() : null,
        category_id: lineItem.category_id,
        po_id: poId,
        type: 'PROCURED' // Using type as a fallback, but category_id is preferred
      });

      updates.push({ id: lineItem.id, received_qty: lineItem.received_qty + receivedQty });
    });

    // Send to inventory-service bulk create
    const invRes = await fetch(`${INVENTORY_URL}/assets/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': req.id,
        'Authorization': req.headers.authorization
      },
      body: JSON.stringify({ assets: assetsToCreate })
    });

    if (!invRes.ok) {
      const errData = await invRes.text();
      throw new Error(`Inventory service failed to create assets: ${errData}`);
    }

    // Update PO Line Items and Status
    await prisma.$transaction(async (tx) => {
      for (const update of updates) {
        await tx.pOLineItem.update({
          where: { id: update.id },
          data: { received_qty: update.received_qty }
        });
      }
      
      const updatedLines = await tx.pOLineItem.findMany({ where: { po_id: poId } });
      const allReceived = updatedLines.every(li => li.received_qty === li.quantity);
      
      await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: allReceived ? 'COMPLETED' : 'PARTIALLY_RECEIVED' }
      });
    });

    res.json({ message: 'Goods received successfully', assets_created: assetsToCreate.length });
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/purchase-orders', requireAuth, requireRole(['ADMIN', 'VIEWER']), async (req, res) => {
  try {
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
      orderBy: { id: 'desc' },
      include: { line_items: true }
    };
    
    if (cursor && cursor !== 'null' && cursor !== 'undefined') {
      const cursorId = parseInt(cursor, 10);
      if (!isNaN(cursorId)) {
        query.cursor = { id: cursorId };
        query.skip = 1; // Skip the cursor itself
      }
    }

    const pos = await prisma.purchaseOrder.findMany(query);
    let nextCursor = null;
    if (pos.length > limit) {
      const nextItem = pos.pop();
      nextCursor = nextItem.id;
    }
    
    res.json({ data: pos, nextCursor });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: 'Failed to fetch purchase orders' });
  }
});

app.post('/purchase-orders/:id/approve', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header is required' });

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
      data: { status: 'APPROVED', idempotency_key: idempotencyKey, action_date: new Date() }
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
app.get('/dashboard/stats', requireAuth, rateLimiter, async (req, res) => {
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
      SELECT date_trunc($1, po.created_at) as period, SUM(li.quantity * li.unit_price) as total_spend 
      FROM "PurchaseOrder" po
      JOIN "POLineItem" li ON po.id = li.po_id
      WHERE po.status IN ('APPROVED', 'ISSUED', 'COMPLETED', 'PARTIALLY_RECEIVED', 'RECEIVED') 
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
  const res = await fetch(`${INVENTORY_URL}/health`, { signal: AbortSignal.timeout(2000) });
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
  resetTimeout: 10000,
  errorFilter: (err) => err.message.startsWith('409:')
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

app.get('/assets/:id/timeline', requireAuth, async (req, res) => {
  const assetId = parseInt(req.params.id, 10);
  try {
    const logs = await prisma.$queryRaw`
      SELECT * FROM "AuditLog"
      WHERE payload_json->>'asset_id' = ${assetId.toString()}
         OR payload_json->>'assetId' = ${assetId.toString()}
      ORDER BY created_at ASC
    `;
    res.json(logs);
  } catch (err) {
    req.log.error(err, 'Failed to fetch asset timeline');
    res.status(500).json({ error: 'Internal server error' });
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

app.get('/health', async (req, res) => {
  // Simple ping for Render
  res.send('OK');
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
      const invRes = await fetch(`${INVENTORY_URL}/export-data`);
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

app.post('/system/init', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return res.status(403).json({ error: 'System already initialized' });
    }
    const password_hash = await bcrypt.hash('admin', 10);
    const admin = await prisma.user.create({
      data: {
        username: 'admin',
        name: 'System Admin',
        email: 'admin@example.com',
        password_hash,
        role: 'ADMIN'
      }
    });
    res.json({ message: 'Default admin user created successfully', admin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin ONLY: seed initial categories and data
app.post('/system/seed', requireAuth, requireRole('ADMIN'), async (req, res) => {
  try {
    const response = await fetch(`${INVENTORY_URL}/seed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: 'Failed to proxy seed request' });
  }
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => {
    logger.info(`Core service listening on port ${port}`);
  });
}

module.exports = app;
