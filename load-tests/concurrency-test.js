const targetUrl = 'http://localhost:3001';

async function runTest() {
  console.log('Seeding 50 assets...');
  const seedRes = await fetch(`${targetUrl}/seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'LAPTOP', count: 50 })
  });
  
  if (!seedRes.ok) {
    console.error('Failed to seed DB', await seedRes.text());
    return;
  }
  console.log(await seedRes.json());

  console.log('Firing 100 concurrent allocation requests...');
  
  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(
      fetch(`${targetUrl}/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetType: 'LAPTOP',
          assignedTo: i + 1,
          warehouseId: 1
        })
      }).then(res => {
        if (res.status === 200) return 'SUCCESS';
        if (res.status === 409) return 'OUT_OF_STOCK';
        return `ERROR_${res.status}`;
      }).catch(err => `FETCH_ERROR_${err.message}`)
    );
  }

  const results = await Promise.all(promises);
  
  const summary = results.reduce((acc, status) => {
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  console.log('\n--- Concurrency Test Results ---');
  console.log(`Total Requests: 100`);
  console.log(`Total Assets Available: 50`);
  console.log(`Successful Allocations: ${summary['SUCCESS'] || 0}`);
  console.log(`Rejected (Out of Stock): ${summary['OUT_OF_STOCK'] || 0}`);
  
  const others = Object.keys(summary).filter(k => k !== 'SUCCESS' && k !== 'OUT_OF_STOCK');
  if (others.length > 0) {
    others.forEach(k => {
      console.log(`${k}: ${summary[k]}`);
    });
  }
  
  if (summary['SUCCESS'] === 50 && summary['OUT_OF_STOCK'] === 50) {
    console.log('\n✅ PASSED: Zero overselling. Exactly 50 succeeded and 50 failed cleanly.');
  } else {
    console.log('\n❌ FAILED: Concurrency bug detected (overselling or deadlocks).');
  }
}

runTest();
