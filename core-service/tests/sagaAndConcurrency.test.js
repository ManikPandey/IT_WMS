const request = require('supertest');
const app = require('../src/index');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

let token;
let user;
const INVENTORY_URL = process.env.INVENTORY_SERVICE_URL || 'http://localhost:3001';

beforeAll(async () => {
  await prisma.purchaseOrder.deleteMany();
  await prisma.user.deleteMany();
  require('../src/outbox-relay').start();
  const bcrypt = require('bcryptjs');
  const password_hash = await bcrypt.hash('password123', 10);
  user = await prisma.user.create({
    data: {
      username: 'admin2',
      name: 'Admin User 2',
      email: 'admin2@example.com',
      password_hash,
      role: 'ADMIN'
    }
  });

  const jwt = require('jsonwebtoken');
  token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET || 'supersecretkey', { expiresIn: '1h' });
});

afterAll(async () => {
  require('../src/outbox-relay').stop();
  await prisma.$disconnect();
  redis.disconnect();
});

describe('System Hardening: Concurrency & Saga', () => {

  it('should prevent overselling during 100 concurrent requests for 50 stock', async () => {
    // Seed 50 assets in inventory-service
    const seedRes = await fetch(`${INVENTORY_URL}/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'CONCURRENCY_TEST', count: 50 })
    });
    if (!seedRes.ok) {
      console.log('Seed Error:', seedRes.status, await seedRes.text());
    }
    expect(seedRes.ok).toBe(true);
    
    // Fire 100 concurrent requests to core-service /allocate (which proxies via opossum to inventory)
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        request(app)
          .post('/allocate')
          .set('Authorization', `Bearer ${token}`)
          .send({ assetType: 'CONCURRENCY_TEST', assignedTo: user.id, warehouseId: 1 })
      );
    }
    
    const results = await Promise.all(promises);
    
    let successCount = 0;
    let conflictCount = 0;
    
    results.forEach(res => {
      if (res.statusCode === 200) successCount++;
      else if (res.statusCode === 409) conflictCount++;
    });
    
    console.log(`Concurrency Test Results: ${successCount} allocated, ${conflictCount} rejected due to out of stock`);
    
    expect(successCount).toBe(50);
    expect(conflictCount).toBe(50); // Exact 50-50 split means ZERO overselling and ZERO dropped connections
  }, 30000); // give it more time for 100 requests

  it('should execute PO_REJECTED compensating transaction correctly', async () => {
    const testTag = `SAGA-TEST-TAG-${Date.now()}`;
    await fetch(`${INVENTORY_URL}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_tag: testTag,
        type: 'SAGA_TEST',
        status: 'IN_STOCK',
        warehouse_id: 1,
        po_id: 9999
      })
    });

    // Create a fake PO in core DB
    const po = await prisma.purchaseOrder.create({
      data: {
        id: 9999,
        vendor: 'Saga Vendor',
        status: 'APPROVED',
        idempotency_key: 'saga-test-1',
        line_items: { create: [{ category_id: 1, description: 'Laptops', quantity: 5, unit_price: 1000 }] }
      }
    });

    // Trigger rejection to emit PO_REJECTED
    const rejectRes = await request(app)
      .post(`/purchase-orders/${po.id}/reject`)
      .set('Authorization', `Bearer ${token}`);
      
    expect(rejectRes.statusCode).toBe(200);
    
    // Wait for outbox relay and consumer to process
    await new Promise(r => setTimeout(r, 8000));
    
    // Check inventory-service to see if status is CANCELLED
    const invRes = await fetch(`${INVENTORY_URL}/assets?search=${testTag}`);
    const invData = await invRes.json();
    
    const sagaAsset = invData.data ? invData.data[0] : invData[0];
    console.log("Compensated asset status:", sagaAsset.status);
    expect(sagaAsset.status).toBe('CANCELLED');
  }, 20000);
});
