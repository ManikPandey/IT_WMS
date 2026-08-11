const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const STREAM_NAME = 'core-events';
const GROUP_NAME = 'inventory-service-group';
const CONSUMER_NAME = `inventory-consumer-${process.pid}`;

async function init() {
  try {
    await redis.xgroup('CREATE', STREAM_NAME, GROUP_NAME, '$', 'MKSTREAM');
    console.log(`Created consumer group ${GROUP_NAME}`);
  } catch (err) {
    if (!err.message.includes('BUSYGROUP')) {
      console.error('Error creating consumer group:', err);
    }
  }
}

async function startConsumer() {
  await init();
  console.log(`Inventory Saga Consumer started listening to ${STREAM_NAME}`);

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', GROUP_NAME, CONSUMER_NAME,
        'BLOCK', 5000,
        'STREAMS', STREAM_NAME, '>'
      );

      if (results) {
        const stream = results[0];
        const messages = stream[1];

        for (let message of messages) {
          const messageId = message[0];
          // message[1] is array of [key1, val1, key2, val2]
          let eventType = null;
          let payloadStr = null;

          for (let i = 0; i < message[1].length; i += 2) {
            if (message[1][i] === 'event_type') eventType = message[1][i + 1];
            if (message[1][i] === 'payload_json') payloadStr = message[1][i + 1];
          }

            if (eventType === 'PO_REJECTED' && payloadStr) {
              const payload = JSON.parse(payloadStr);
              const poId = payload.poId;
              const reqId = payload.request_id || 'system';
              
              console.log(`[req:${reqId}] [Saga] Received PO_REJECTED for PO ${poId}. Reverting procured assets...`);
              
              // Compensating Transaction
              await prisma.asset.updateMany({
                where: { po_id: poId, status: 'IN_STOCK' }, // Or PROCURED if we had that state
                data: { status: 'CANCELLED' } // Mark cancelled
              });
              
              console.log(`[req:${reqId}] [Saga] Successfully reverted assets for PO ${poId}`);
            }

          // Ack message
          await redis.xack(STREAM_NAME, GROUP_NAME, messageId);
        }
      }
    } catch (err) {
      console.error('Error consuming events:', err);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

startConsumer();
