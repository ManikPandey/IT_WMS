const targetUrl = 'http://localhost:3001';

async function runStrategyTest(strategyName, qs) {
  console.log(`\n--- Running test for strategy: ${strategyName} ---`);
  
  // Seed
  console.log(`Seeding 50 assets...`);
  const seedRes = await fetch(`${targetUrl}/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'LAPTOP', count: 50 })
  });
  
  if (!seedRes.ok) {
    console.error('Failed to seed DB', await seedRes.text());
    return;
  }
  
  console.log(`Firing 100 concurrent allocation requests...`);
  
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    promises.push(
      fetch(`${targetUrl}/allocate${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: 'LAPTOP',
          assignedTo: i + 1,
          warehouseId: 1
        })
      }).then(res => {
        const end = performance.now();
        const latency = end - start;
        if (res.status === 200) return { status: 'SUCCESS', latency };
        if (res.status === 409) return { status: 'OUT_OF_STOCK', latency };
        return { status: `ERROR_${res.status}`, latency };
      }).catch(err => ({ status: `FETCH_ERROR_${err.message}`, latency: 0 }))
    );
  }

  const results = await Promise.all(promises);
  
  const summary = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  
  // Calculate latencies for SUCCESS cases to measure actual processing time
  const successLatencies = results.filter(r => r.status === 'SUCCESS').map(r => r.latency).sort((a, b) => a - b);
  
  const avgLatency = successLatencies.length ? successLatencies.reduce((a, b) => a + b, 0) / successLatencies.length : 0;
  const p95Latency = successLatencies.length ? successLatencies[Math.floor(successLatencies.length * 0.95)] : 0;

  console.log(`Total Requests: 100`);
  console.log(`Total Assets Available: 50`);
  console.log(`Successful Allocations: ${summary['SUCCESS'] || 0}`);
  console.log(`Rejected (Out of Stock): ${summary['OUT_OF_STOCK'] || 0}`);
  
  console.log(`Avg Latency (Success): ${avgLatency.toFixed(2)} ms`);
  console.log(`P95 Latency (Success): ${p95Latency.toFixed(2)} ms`);
  
  const others = Object.keys(summary).filter(k => k !== 'SUCCESS' && k !== 'OUT_OF_STOCK');
  if (others.length > 0) {
    others.forEach(k => {
      console.log(`${k}: ${summary[k]}`);
    });
  }
  
  if (summary['SUCCESS'] === 50 && summary['OUT_OF_STOCK'] === 50) {
    console.log(`✅ PASSED: Zero overselling for ${strategyName}.`);
  } else {
    console.log(`❌ FAILED: Concurrency bug detected in ${strategyName}.`);
  }
}

async function runBenchmark() {
  await runStrategyTest('Postgres (Option A)', '');
  await runStrategyTest('Redis (Option B)', '?strategy=redis');
  
  console.log('\n--- Benchmark Complete ---');
}

runBenchmark();
