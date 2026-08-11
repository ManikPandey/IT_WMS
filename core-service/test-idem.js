const targetUrl = 'http://localhost:3000';

async function run() {
  // 1. Login as ADMIN
  const loginRes = await fetch(`${targetUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', role: 'ADMIN' })
  });
  const { token } = await loginRes.json();
  console.log('Got Token:', token);

  // 2. Create PO
  const poRes = await fetch(`${targetUrl}/purchase-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ vendor: 'Dell', budget: 5000 })
  });
  const po = await poRes.json();
  console.log('Created PO:', po.id);

  // 3. Approve PO (Initial request)
  const idemKey = `idem-test-${Date.now()}`;
  const payload1 = { comments: 'Looks good', finalBudget: 5000 };
  
  const approve1 = await fetch(`${targetUrl}/purchase-orders/${po.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idemKey },
    body: JSON.stringify(payload1)
  });
  console.log('Approve 1 Status:', approve1.status, await approve1.json());

  // 4. Repeat exact same request (Should return cached)
  const approve2 = await fetch(`${targetUrl}/purchase-orders/${po.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idemKey },
    body: JSON.stringify(payload1)
  });
  console.log('Approve 2 Status (Same Payload):', approve2.status, await approve2.json());

  // 5. Repeat with same key but different body (Should return 409)
  const payload2 = { comments: 'Looks good', finalBudget: 6000 };
  const approve3 = await fetch(`${targetUrl}/purchase-orders/${po.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idemKey },
    body: JSON.stringify(payload2)
  });
  console.log('Approve 3 Status (Different Payload):', approve3.status, await approve3.json());
}

run();
