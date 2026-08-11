const express = require('express');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const upload = multer({ dest: 'uploads/' });

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(express.json());
app.use(cors());

// --- System ---
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'ok', db: 'ok', redis: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.get('/export-data', async (req, res) => {
  // Internal export endpoint
  const assets = await prisma.asset.findMany();
  const categories = await prisma.category.findMany();
  const tickets = await prisma.maintenanceTicket.findMany();
  res.json({ assets, categories, tickets });
});

// --- Categories ---
app.post('/categories', async (req, res) => {
  try {
    const category = await prisma.category.create({ data: req.body });
    res.json(category);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/categories', async (req, res) => {
  const categories = await prisma.category.findMany();
  res.json(categories);
});

app.put('/categories/:id', async (req, res) => {
  const category = await prisma.category.update({
    where: { id: parseInt(req.params.id) },
    data: req.body
  });
  res.json(category);
});

app.delete('/categories/:id', async (req, res) => {
  await prisma.category.delete({ where: { id: parseInt(req.params.id) } });
  res.json({ success: true });
});

// --- Dashboard ---
app.get('/dashboard/stats', async (req, res) => {
  const totalAssets = await prisma.asset.count();
  const inStock = await prisma.asset.count({ where: { status: 'IN_STOCK' } });
  const outOfStock = totalAssets - inStock;
  
  const categoryGroups = await prisma.asset.groupBy({
    by: ['category_id'],
    _count: { _all: true }
  });
  
  const openTickets = await prisma.maintenanceTicket.count({ where: { status: 'OPEN' } });
  
  const costAgg = await prisma.maintenanceTicket.aggregate({
    _sum: { cost: true }
  });

  res.json({
    totalAssets,
    inStock,
    outOfStock,
    assetsByCategory: categoryGroups,
    openMaintenance: openTickets,
    totalMaintenanceCost: costAgg._sum.cost || 0
  });
});

// Get all assets
app.get('/assets', async (req, res) => {
  try {
    const { category_id, search } = req.query;
    const where = {};
    if (category_id) where.category_id = parseInt(category_id);
    if (search) {
      where.OR = [
        { asset_tag: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } }
      ];
    }

    const assets = await prisma.asset.findMany({
      where,
      orderBy: { created_at: 'desc' }
    });
    res.json(assets);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create asset
app.post('/assets', async (req, res) => {
  try {
    const { asset_tag, type, status, warehouse_id, category_id, properties } = req.body;
    
    // Merge properties array into jsonb object
    const jsonb_attributes = properties ? properties.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {}) : null;

    const asset = await prisma.asset.create({
      data: {
        asset_tag,
        type,
        status: status || 'IN_STOCK',
        warehouse_id,
        category_id,
        jsonb_attributes
      }
    });
    res.json(asset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export assets CSV
app.get('/assets/export', async (req, res) => {
  try {
    const assets = await prisma.asset.findMany();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="assets.csv"');
    
    res.write('ID,Asset Tag,Type,Status,Assigned To,Warehouse ID,Category ID\n');
    assets.forEach(a => {
      res.write(`${a.id},${a.asset_tag},${a.type},${a.status},${a.assigned_to || ''},${a.warehouse_id},${a.category_id || ''}\n`);
    });
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import assets from Excel
app.post('/assets/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.worksheets[0];

    let successCount = 0;
    const errors = [];

    // Assuming first row is headers: asset_tag, type, warehouse_id
    worksheet.eachRow(async (row, rowNumber) => {
      if (rowNumber === 1) return; // skip headers
      
      const asset_tag = row.getCell(1).value?.toString();
      const type = row.getCell(2).value?.toString();
      const warehouse_id = parseInt(row.getCell(3).value) || 1;

      if (!asset_tag || !type) {
        errors.push(`Row ${rowNumber}: missing tag or type`);
        return;
      }

      try {
        await prisma.asset.create({
          data: { asset_tag, type, status: 'IN_STOCK', warehouse_id }
        });
        successCount++;
      } catch (err) {
        errors.push(`Row ${rowNumber}: ${err.message}`);
      }
    });

    res.json({ success: successCount, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Maintenance Tickets ---
app.post('/maintenance', async (req, res) => {
  try {
    const { asset_id, issue_type, description } = req.body;
    
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.maintenanceTicket.create({
        data: { asset_id, issue_type, description, status: 'OPEN' }
      });
      await tx.asset.update({
        where: { id: asset_id },
        data: { status: 'MAINTENANCE' }
      });
      return ticket;
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/maintenance', async (req, res) => {
  const { status } = req.query;
  const where = status ? { status } : {};
  const tickets = await prisma.maintenanceTicket.findMany({ where, orderBy: { created_at: 'desc' } });
  res.json(tickets);
});

app.patch('/maintenance/:id/resolve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { cost } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.maintenanceTicket.update({
        where: { id },
        data: { status: 'CLOSED', resolved_at: new Date(), cost }
      });
      await tx.asset.update({
        where: { id: ticket.asset_id },
        data: { status: 'IN_STOCK' }
      });
      return ticket;
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
