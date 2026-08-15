const express = require('express');
const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const helmet = require('helmet');
const pino = require('pino');
const pinoHttp = require('pino-http');
const swaggerUi = require('swagger-ui-express');
const crypto = require('crypto');
const { z } = require('zod');
const { generateSpec } = require('./swagger');
require('dotenv').config({ path: '../.env' }); // Load from root

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: { folder: 'it_wms_bills' },
});

const upload = multer({ dest: 'uploads/' });
const cloudUpload = multer({ storage: storage });

const app = express();
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

app.use(express.json());
app.use(helmet());
const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({ origin: [frontendOrigin] }));

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

app.use(pinoHttp({ logger, genReqId: req => req.id }));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(generateSpec()));

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

app.get('/categories/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json([]);
  
  const categories = await prisma.category.findMany({
    where: { name: { contains: q, mode: 'insensitive' } }
  });
  res.json(categories);
});

app.delete('/categories/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  
  // Check for subcategories
  const subcats = await prisma.category.findFirst({ where: { parent_id: id } });
  if (subcats) return res.status(409).json({ error: 'Cannot delete category with subcategories' });

  // Check for assets
  const assets = await prisma.asset.findFirst({ where: { category_id: id } });
  if (assets) return res.status(409).json({ error: 'Cannot delete category containing assets' });

  await prisma.category.delete({ where: { id } });
  res.json({ success: true });
});

// Removed /dashboard/stats to enforce CQRS in core-service

// Get all assets
app.get('/assets', async (req, res) => {
  try {
    const { category_id, search, status, cursor, limit = 50 } = req.query;
    const where = {};
    if (category_id) where.category_id = parseInt(category_id);
    
    if (status) {
      where.status = { in: status.split(',') };
    }

    if (search) {
      where.OR = [
        { asset_tag: { contains: search, mode: 'insensitive' } },
        { type: { contains: search, mode: 'insensitive' } },
        { serial_number: { contains: search, mode: 'insensitive' } }
      ];
    }

    const query = {
      where,
      take: Number(limit) + 1,
      orderBy: { created_at: 'desc' }
    };
    
    if (cursor) {
      query.cursor = { id: parseInt(cursor, 10) };
    }

    const assets = await prisma.asset.findMany(query);
    let nextCursor = null;
    if (assets.length > limit) {
      nextCursor = assets.pop().id;
    }
    
    res.json({ data: assets, nextCursor });
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const CreateAssetSchema = z.object({
  asset_tag: z.string().min(1),
  serial_number: z.string().optional(),
  type: z.string().min(1),
  status: z.string().optional(),
  warehouse_id: z.number().int().optional(),
  category_id: z.number().int().optional(),
  po_id: z.number().int().optional(),
  properties: z.array(z.object({ key: z.string(), value: z.string() })).optional()
});

// Create asset
app.post('/assets', async (req, res) => {
  try {
    const parsed = CreateAssetSchema.parse(req.body);
    const { asset_tag, serial_number, type, status, warehouse_id, category_id, po_id, properties } = parsed;
    
    const jsonb_attributes = properties ? properties.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {}) : null;

    const asset = await prisma.asset.create({
      data: {
        asset_tag, serial_number, type,
        status: status || 'IN_STOCK',
        warehouse_id, category_id, po_id, jsonb_attributes
      }
    });
    res.status(201).json(asset);
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
    req.log.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk Create assets (For GRN)
app.post('/assets/bulk', async (req, res) => {
  try {
    const { assets } = req.body;
    if (!Array.isArray(assets) || assets.length === 0) {
      return res.status(400).json({ error: 'Assets array is required' });
    }
    
    // Default status to IN_STOCK or whatever is passed
    const data = assets.map(a => ({
      ...a,
      status: a.status || 'IN_STOCK',
      warehouse_id: a.warehouse_id || 1
    }));

    const result = await prisma.asset.createMany({ data });
    res.json({ success: true, count: result.count });
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/assets/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { asset_tag, serial_number, type, category_id, properties } = req.body;
    
    const data = {};
    if (asset_tag) data.asset_tag = asset_tag;
    if (serial_number !== undefined) data.serial_number = serial_number;
    if (type) data.type = type;
    if (category_id !== undefined) data.category_id = category_id ? parseInt(category_id) : null;
    
    if (properties) {
      data.jsonb_attributes = properties.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});
    }

    const updated = await prisma.asset.update({
      where: { id },
      data
    });
    res.json(updated);
  } catch (error) {
    req.log.error(error);
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

app.post('/assets/:id/report-issue', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { issue_type, description } = req.body;
    
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.maintenanceTicket.create({
        data: { asset_id: id, issue_type, description, status: 'OPEN' }
      });
      const asset = await tx.asset.update({
        where: { id },
        data: { status: 'MAINTENANCE' }
      });
      return { ticket, asset };
    });
    res.json(result);
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

app.patch('/maintenance/:id/submit-approval', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { cost, parts_used } = req.body;

    const ticket = await prisma.maintenanceTicket.update({
      where: { id },
      data: { 
        status: 'PENDING_APPROVAL', 
        cost,
        parts_used: parts_used || []
      }
    });
    res.json(ticket);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/maintenance/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.maintenanceTicket.update({
        where: { id },
        data: { status: 'CLOSED', resolved_at: new Date(), admin_note: null }
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

app.patch('/maintenance/:id/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { admin_note } = req.body;
    const ticket = await prisma.maintenanceTicket.update({
      where: { id },
      data: { status: 'RUNNING', admin_note }
    });
    res.json(ticket);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/maintenance/:id/bill', cloudUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const id = parseInt(req.params.id);
    
    const ticket = await prisma.maintenanceTicket.update({
      where: { id },
      data: { bill_url: req.file.path }
    });
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/maintenance/stats', async (req, res) => {
  try {
    const { range } = req.query; // weekly, monthly, yearly
    let format = 'YYYY-MM'; // default monthly
    if (range === 'weekly') format = 'YYYY-WW';
    if (range === 'yearly') format = 'YYYY';

    // Using raw SQL for date_trunc
    const truncStr = range === 'yearly' ? 'year' : range === 'weekly' ? 'week' : 'month';
    const stats = await prisma.$queryRawUnsafe(`
      SELECT date_trunc($1, created_at) as period, SUM(cost) as total_cost 
      FROM "MaintenanceTicket" 
      WHERE cost IS NOT NULL 
      GROUP BY period 
      ORDER BY period ASC
    `, truncStr);

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Seed endpoint for testing
app.post('/seed', async (req, res) => {
  console.log("ENABLE_SEED is:", process.env.ENABLE_SEED);
  if (process.env.ENABLE_SEED !== 'true') {
    return res.status(403).json({ error: 'Seed endpoint is disabled in this environment' });
  }

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
              strategy: 'redis',
              request_id: req.id
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
              strategy: 'postgres',
              request_id: req.id
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
  logger.info(`Inventory service listening on port ${port}`);
});
