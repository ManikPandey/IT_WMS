const express = require('express');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Seed endpoint for testing
app.post('/seed', async (req, res) => {
  const { type, count } = req.body;
  
  await prisma.outboxEvent.deleteMany();
  await prisma.asset.deleteMany();
  
  const assets = [];
  for (let i = 0; i < count; i++) {
    assets.push({
      asset_tag: `TAG-${Date.now()}-${i}`,
      type: type || 'LAPTOP',
      status: 'IN_STOCK',
      warehouse_id: 1
    });
  }
  
  await prisma.asset.createMany({ data: assets });
  res.json({ message: `Seeded ${count} assets of type ${type || 'LAPTOP'}` });
});

// Phase 1 Option A: Postgres pessimistic locking
app.post('/allocate', async (req, res) => {
  const { assetType, assignedTo, warehouseId } = req.body;

  try {
    const allocatedAsset = await prisma.$transaction(async (tx) => {
      // 1. Lock a single available asset
      // We use raw query because Prisma's standard API doesn't support SKIP LOCKED
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

      // 2. Update the locked asset
      const updatedAsset = await tx.asset.update({
        where: { id: asset.id },
        data: {
          status: 'DEPLOYED',
          assigned_to: assignedTo,
          warehouse_id: warehouseId
        }
      });

      // 3. Insert OutboxEvent for reliable messaging (Phase 4 precursor)
      await tx.outboxEvent.create({
        data: {
          event_type: 'ASSET_ALLOCATED',
          payload_json: {
            assetId: updatedAsset.id,
            assetTag: updatedAsset.asset_tag,
            assignedTo: updatedAsset.assigned_to
          }
        }
      });

      return updatedAsset;
    });

    res.json(allocatedAsset);
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
