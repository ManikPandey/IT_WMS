const request = require('supertest');
const app = require('../src/index');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

let token;
let user;

beforeAll(async () => {
  // Clear tables
  await prisma.purchaseOrder.deleteMany();
  await prisma.user.deleteMany();

  // Create admin user
  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash('password123', 10);
  user = await prisma.user.create({
    data: {
      username: 'admin',
      name: 'Admin User',
      email: 'admin@example.com',
      password_hash,
      role: 'ADMIN'
    }
  });

  const jwt = require('jsonwebtoken');
  token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'supersecretkey', { expiresIn: '1h' });
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe('Purchase Orders API', () => {
  let poId;

  it('should create a purchase order with validation', async () => {
    const res = await request(app)
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vendor: 'Tech Supplier Inc.',
        budget: 5000,
        department: 'Engineering'
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.vendor).toBe('Tech Supplier Inc.');
    expect(res.body.status).toBe('PENDING');
    poId = res.body.id;
  });

  it('should fail validation when budget is negative', async () => {
    const res = await request(app)
      .post('/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vendor: 'Invalid Supplier',
        budget: -1000
      });

    expect(res.statusCode).toBe(400);
    console.log("Response body for negative budget:", res.body);
    expect(res.body.error).toBeDefined();
  });

  it('should approve a purchase order with idempotency', async () => {
    const idempotencyKey = 'test-idem-key-' + Date.now();
    
    // First request
    const res1 = await request(app)
      .post(`/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ finalBudget: 4800 });

    expect(res1.statusCode).toBe(200);
    expect(res1.body.po.status).toBe('APPROVED');
    expect(res1.body.po.budget).toBe(4800);

    // Second request with same idempotency key
    const res2 = await request(app)
      .post(`/purchase-orders/${poId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ finalBudget: 4800 });

    expect(res2.statusCode).toBe(200);
    // Should be cached response
    expect(res2.body).toEqual(res1.body);
  });
});
