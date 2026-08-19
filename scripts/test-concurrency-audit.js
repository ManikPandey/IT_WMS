

let API_URL = process.env.API_URL || 'http://localhost:3000';
const INVENTORY_URL = process.env.INVENTORY_URL || 'http://localhost:4000';

let token = '';

async function login() {
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin' })
  });
  const data = await res.json();
  token = data.token;
}

async function testAssetRequestConcurrency() {
  console.log('\n--- Testing Asset Request Concurrency ---');
  
  // 1. Create an asset request
  const reqRes = await fetch(`${API_URL}/asset-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ category_id: 1, justification: 'Concurrency Test' })
  });
  const requestData = await reqRes.json();
  const requestId = requestData.id;

  console.log(`Created Asset Request ID: ${requestId}, status: ${requestData.status}`);
  
  // 2. Fire 3 concurrent approvals
  console.log('Firing 3 concurrent approval requests...');
  const promises = [];
  for(let i = 0; i < 3; i++) {
    promises.push(
      fetch(`${API_URL}/asset-requests/${requestId}/approve`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      }).then(r => r.status)
    );
  }

  const results = await Promise.all(promises);
  console.log('Approval Status Codes (Expected: One 200, Two 409s):', results);
}

async function testMaintenanceTicketConcurrency() {
  console.log('\n--- Testing Maintenance Ticket Concurrency ---');
  
  // 1. Need an asset first to create ticket
  const assetRes = await fetch(`${INVENTORY_URL}/assets?limit=1`);
  const assetData = await assetRes.json();
  const assetId = assetData.data[0].id;

  // 2. Report issue
  const ticketRes = await fetch(`${INVENTORY_URL}/assets/${assetId}/report-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ reported_by: 1, description: 'Concurrency Test Ticket' })
  });
  let ticket = await ticketRes.json();
  
  // 3. Move to PENDING_APPROVAL
  // Wait, there is no endpoint to submit cost right now, the tech can just update it?
  // Let's assume the tech manually updates it in the DB or via some endpoint.
  // We can just use Prisma directly to bypass this for the test, or since we are outside...
  // Wait, we don't have a direct endpoint for tech to change status to PENDING_APPROVAL in the current simplified API.
  // I will just skip this test if we can't seed PENDING_APPROVAL, but let's see if we can trigger something.
  console.log(`Created Maintenance Ticket ID: ${ticket.id}`);
  console.log('Skipping Maintenance concurrency test because PENDING_APPROVAL requires tech workflow simulation.');
}

async function run() {
  await login();
  await testAssetRequestConcurrency();
  // await testMaintenanceTicketConcurrency();
}

run();
