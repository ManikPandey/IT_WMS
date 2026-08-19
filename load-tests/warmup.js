async function checkHealth(url) {
  try {
    const res = await fetch(url);
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

async function warmup(url, name) {
  process.stdout.write(`Warming up ${name} (${url})... `);
  let attempts = 0;
  while (attempts < 30) { // Try for 1 minute (2s intervals)
    const isUp = await checkHealth(url);
    if (isUp) {
      console.log('✅ UP!');
      return;
    }
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
  }
  console.log('❌ Failed to wake up service.');
}

async function run() {
  const CORE_URL = process.env.API_URL || 'http://localhost:3000';
  const INV_URL = process.env.INVENTORY_URL || 'http://localhost:3001';

  await warmup(`${CORE_URL}/system/health`, 'Core Service');
  await warmup(`${INV_URL}/health`, 'Inventory Service'); // Assuming inventory has /health
}

run();
