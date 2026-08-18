const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

let isRunning = false;

async function relayEvents() {
  isRunning = true;
  console.log('Core Outbox relay started...');
  while (isRunning) {
    try {
      const events = await prisma.outboxEvent.findMany({
        where: { published: false },
        orderBy: { id: 'asc' },
        take: 50
      });

      for (const event of events) {
        await redis.xadd(
          'core-events', '*',
          'event_type', event.event_type,
          'payload_json', JSON.stringify(event.payload_json),
          'event_id', event.id.toString()
        );

        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { published: true }
        });
      }

      if (isRunning) await new Promise(res => setTimeout(res, 2000));
    } catch (err) {
      console.error('Error in outbox relay:', err);
      if (isRunning) await new Promise(res => setTimeout(res, 5000));
    }
  }
}

if (require.main === module) {
  relayEvents();
}

module.exports = { 
  start: () => relayEvents(), 
  stop: () => { isRunning = false; }
};
