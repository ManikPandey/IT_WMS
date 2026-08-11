const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function processOutbox() {
  try {
    const events = await prisma.outboxEvent.findMany({
      where: { published: false },
      orderBy: { created_at: 'asc' },
      take: 50
    });

    for (const event of events) {
      // Publish to Redis Stream
      await redis.xadd(
        'asset-events',
        '*',
        'event_id', event.id,
        'event_type', event.event_type,
        'payload', JSON.stringify(event.payload_json)
      );

      // Mark published
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { published: true }
      });
      
      console.log(`Relayed event ${event.id} (${event.event_type}) to stream`);
    }
  } catch (err) {
    console.error('Error processing outbox:', err);
  } finally {
    // Poll again
    setTimeout(processOutbox, 2000);
  }
}

console.log('Outbox relay started...');
processOutbox();
