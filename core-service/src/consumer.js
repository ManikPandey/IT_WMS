const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const STREAM_KEY = 'asset-events';
const GROUP_NAME = 'audit-log-group';
const CONSUMER_NAME = 'core-consumer-1';

async function initGroup() {
  try {
    // Create stream and group (MKSTREAM automatically creates stream if it doesn't exist)
    await redis.xgroup('CREATE', STREAM_KEY, GROUP_NAME, '0', 'MKSTREAM');
    console.log(`Consumer group ${GROUP_NAME} created.`);
  } catch (err) {
    if (err.message.includes('BUSYGROUP')) {
      console.log(`Consumer group ${GROUP_NAME} already exists.`);
    } else {
      console.error('Error creating consumer group:', err);
    }
  }
}

async function processMessage(message) {
  const [streamId, fields] = message;
  // Parse fields array into an object
  const data = {};
  for (let i = 0; i < fields.length; i += 2) {
    data[fields[i]] = fields[i + 1];
  }

  const processedEventId = `inventory-outbox-${data.event_id}`;

  try {
    // Check for idempotency
    const exists = await prisma.auditLog.findUnique({
      where: { processed_event_id: processedEventId }
    });

    if (!exists) {
      const payload = JSON.parse(data.payload);
      
      await prisma.auditLog.create({
        data: {
          event_type: data.event_type,
          entity_id: payload.assetId || 0,
          payload_json: payload,
          processed_event_id: processedEventId
        }
      });
      console.log(`Processed and saved audit log for event ${processedEventId}`);
    } else {
      console.log(`Skipped duplicate event ${processedEventId}`);
    }

    // Acknowledge the message so it is removed from the pending entries list
    await redis.xack(STREAM_KEY, GROUP_NAME, streamId);
  } catch (err) {
    console.error(`Error processing message ${streamId}:`, err);
    // Deliberately not acking so it remains pending and can be retried
  }
}

async function readPending() {
  // Read all unacked messages for this consumer
  // "0" means read from the pending list (start from the beginning)
  try {
    const res = await redis.xreadgroup('GROUP', GROUP_NAME, CONSUMER_NAME, 'STREAMS', STREAM_KEY, '0');
    if (res && res.length > 0) {
      const messages = res[0][1];
      if (messages.length > 0) {
        console.log(`Found ${messages.length} pending messages, recovering...`);
        for (const msg of messages) {
          await processMessage(msg);
        }
      }
    }
  } catch (err) {
    console.error('Error reading pending messages:', err);
  }
}

async function listenLoop() {
  try {
    // Block for 5 seconds waiting for new messages (">" means new messages never delivered to other consumers in the group)
    const res = await redis.xreadgroup('GROUP', GROUP_NAME, CONSUMER_NAME, 'BLOCK', 5000, 'STREAMS', STREAM_KEY, '>');
    if (res && res.length > 0) {
      const messages = res[0][1];
      for (const msg of messages) {
        await processMessage(msg);
      }
    }
  } catch (err) {
    console.error('Error reading stream:', err);
  } finally {
    setImmediate(listenLoop); // Keep looping
  }
}

async function start() {
  await initGroup();
  await readPending(); // Handle any crashed/unacked events first
  console.log('Listening for new events...');
  listenLoop();
}

start();
