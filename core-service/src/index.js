const express = require('express');
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const crypto = require('crypto');

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

app.use(express.json());

// 1. Auth & RBAC
app.post('/login', async (req, res) => {
  const { email, role } = req.body;
  // For demo purposes, auto-create user or just issue token based on requested role
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, role: role || 'VIEWER', password_hash: 'dummy' }
    });
  }
  
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
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

// 2. PO Creation
app.post('/purchase-orders', requireAuth, async (req, res) => {
  const { vendor, budget } = req.body;
  const po = await prisma.purchaseOrder.create({
    data: {
      vendor,
      budget,
      status: 'PENDING',
      idempotency_key: `po-create-${Date.now()}` // internal unique just to satisfy schema if needed, but not user provided yet
    }
  });
  res.status(201).json(po);
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
        idempotency_key: idempotencyKey
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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Core service listening on port ${port}`);
});
