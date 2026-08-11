const express = require('express');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(express.json());

// Seed endpoint for testing
app.post('/seed', async (req, res) => {
  const { type, count } = req.body;
  const assetType = type || 'LAPTOP';
  
  await prisma.outboxEvent.deleteMany();
  await prisma.asset.deleteMany();
  
  const assets = [];
  for (let i = 0; i < count; i++) {
    assets.push({
      asset_tag: `TAG-${Date.now()}-${i}`,
      type: assetType,
      status: 'IN_STOCK',
      warehouse_id: 1
    });
  }
  
  await prisma.asset.createMany({ data: assets });
  
  // Set Redis counter for Option B
  await redis.set(`stock:${assetType}`, count);
  
  res.json({ message: `Seeded ${count} assets of type ${assetType}, reset Redis counter.` });
});

// Options A & B: Concurrency-safe allocation
app.post('/allocate', async (req, res) => {
  const { assetType, assignedTo, warehouseId } = req.body;
  const strategy = req.query.strategy; // 'redis' or undefined (defaults to postgres)

  try {
    if (strategy === 'redis') {
      // Option B: Redis atomic counter
      const remaining = await redis.decr(`stock:${assetType}`);
      if (remaining < 0) {
        await redis.incr(`stock:${assetType}`); // release back
        throw new Error('OUT_OF_STOCK');
      }

      // Proceed to update Postgres record safely
      // We know there's at least one IN_STOCK asset due to Redis guarantee
      const allocatedAsset = await prisma.$transaction(async (tx) => {
        // Use CTE to find and update a single available asset safely.
        // We still use SKIP LOCKED in the CTE to avoid multiple workers blocking
        // on the exact same physical row, even though Redis guarantees no overselling of the pool.
        const availableAssets = await tx.$queryRaw`
          UPDATE "Asset" 
          SET status = 'DEPLOYED', assigned_to = ${assignedTo}, warehouse_id = ${warehouseId}
          WHERE id = (
            SELECT id FROM "Asset" 
            WHERE type = ${assetType} AND status = 'IN_STOCK' 
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING *;
        `;
        
        if (availableAssets.length === 0) {
          throw new Error('OUT_OF_STOCK'); // Failsafe
        }

        const asset = availableAssets[0];

        await tx.outboxEvent.create({
          data: {
            event_type: 'ASSET_ALLOCATED',
            payload_json: {
              assetId: asset.id,
              assetTag: asset.asset_tag,
              assignedTo: asset.assigned_to,
              strategy: 'redis'
            }
          }
        });

        return asset;
      });

      return res.json(allocatedAsset);

    } else {
      // Option A: Postgres pessimistic locking
      const allocatedAsset = await prisma.$transaction(async (tx) => {
        const availableAssets = await tx.$queryRaw`
          SELECT * FROM "Asset"
          WHERE type = ${assetType} AND status = 'IN_STOCK'
          LIMIT 1
          FOR UPDATE SKIP LOCKED;
        `;

        if (availableAssets.length === 0) {
          throw new Error('OUT_OF_STOCK');
        }

        const asset = availableAssets[0];

        const updatedAsset = await tx.asset.update({
          where: { id: asset.id },
          data: {
            status: 'DEPLOYED',
            assigned_to: assignedTo,
            warehouse_id: warehouseId
          }
        });

        await tx.outboxEvent.create({
          data: {
            event_type: 'ASSET_ALLOCATED',
            payload_json: {
              assetId: updatedAsset.id,
              assetTag: updatedAsset.asset_tag,
              assignedTo: updatedAsset.assigned_to,
              strategy: 'postgres'
            }
          }
        });

        return updatedAsset;
      });

      return res.json(allocatedAsset);
    }
  } catch (error) {
    if (error.message === 'OUT_OF_STOCK') {
      return res.status(409).json({ error: 'Out of stock' });
    }
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Inventory service listening on port ${port}`);
});
