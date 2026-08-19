const { parseArgs } = require('util');
const path = require('path');

const { values } = parseArgs({
  options: {
    env: {
      type: 'string',
      default: 'local'
    }
  }
});

let envPath = values.env === 'prod' ? '.env.prod' : '.env';
require('dotenv').config({ path: path.join(__dirname, '..', envPath) });

let API_URL = process.env.API_URL || 'http://localhost:3000';
const INVENTORY_URL = process.env.INVENTORY_URL || 'http://localhost:4000';

console.log(`Targeting Core API: ${API_URL}`);
console.log(`Targeting Inventory API: ${INVENTORY_URL}`);

let token = '';

async function fetchWithAuth(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const d = await res.text();
    throw new Error(`HTTP ${res.status}: ${d}`);
  }
  return res.json();
}

async function login() {
  console.log('Initializing system (creating default admin if none exists)...');
  await fetch(`${API_URL}/system/init`, { method: 'POST' }).catch(() => {}); // Ignore error if already initialized

  console.log('Logging in as admin...');
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.com', password: 'admin123' })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Login failed: ${err}`);
  }
  const data = await res.json();
  token = data.token;
  console.log('Logged in successfully.\n');
}

async function seedCategories() {
  console.log('Seeding 5 Categories...');
  const categories = [
    { name: 'Laptops', attribute_schema: { "RAM": "string", "Storage": "string" } },
    { name: 'Monitors', attribute_schema: { "Size": "string" } },
    { name: 'Peripherals', attribute_schema: { "Type": "string" } },
    { name: 'Servers', attribute_schema: { "Cores": "number" } },
    { name: 'Software', attribute_schema: { "Seats": "number" } }
  ];

  const createdCategories = [];
  for (const cat of categories) {
    try {
      const res = await fetchWithAuth(`${INVENTORY_URL}/categories`, { method: 'POST', body: JSON.stringify(cat) });
      createdCategories.push(res);
      console.log(`Created category: ${cat.name}`);
    } catch (e) {
      console.error(`Failed to create category ${cat.name}:`, e.message);
    }
  }
  return createdCategories;
}

async function seedUsers() {
  console.log('\nSeeding 10 Users...');
  const roles = ['EMPLOYEE', 'EMPLOYEE', 'EMPLOYEE', 'EMPLOYEE', 'EMPLOYEE', 'MAINTENANCE_CREW', 'MAINTENANCE_CREW', 'VIEWER', 'VIEWER', 'ADMIN'];
  const createdUsers = [];
  
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const username = `user_${Date.now()}_${i}`;
    try {
      const res = await fetchWithAuth(`${API_URL}/users`, {
        method: 'POST',
        body: JSON.stringify({
          username, name: `Simulated ${role} ${i}`, email: `${username}@example.com`, password: 'password123', role
        })
      });
      createdUsers.push(res);
    } catch(e) {
      console.error(`Failed to create user ${username}:`, e.message);
    }
  }
  console.log(`Created ${createdUsers.length} users.`);
  return createdUsers;
}

async function seedAssets(categories) {
  console.log('\nSeeding ~100 Assets...');
  const states = ['IN_STOCK', 'IN_STOCK', 'IN_STOCK', 'DEPLOYED', 'DEPLOYED', 'MAINTENANCE', 'IN_TRANSIT', 'RETIRED', 'SCRAPPED'];
  
  let count = 0;
  for (let i = 0; i < 100; i++) {
    const cat = categories[i % categories.length];
    if (!cat) continue;

    const status = states[Math.floor(Math.random() * states.length)];
    let props = {};
    if (cat.name === 'Laptops') props = { "RAM": "16GB", "Storage": "512GB SSD" };
    
    try {
      await fetchWithAuth(`${INVENTORY_URL}/assets`, {
        method: 'POST',
        body: JSON.stringify({
          asset_tag: `TAG-${Date.now()}-${i}`,
          serial_number: `SN-${Math.random().toString(36).substring(7).toUpperCase()}`,
          category_id: cat.id,
          type: cat.name.toUpperCase().replace(' ', '_'),
          status, warehouse_id: 1, jsonb_attributes: props
        })
      });
      count++;
    } catch(e) { }
  }
  console.log(`Created ${count} assets.`);
}

async function seedRequests(categories) {
  console.log('\nSeeding 15 Asset Requests...');
  let count = 0;
  for (let i = 0; i < 15; i++) {
    const cat = categories[i % categories.length];
    if(!cat) continue;
    try {
      await fetchWithAuth(`${API_URL}/asset-requests`, {
        method: 'POST',
        body: JSON.stringify({ category_id: cat.id, justification: `Simulated request for ${cat.name} ${Date.now()}` })
      });
      count++;
    } catch(e) { console.error(e.message); }
  }
  console.log(`Created ${count} asset requests.`);
}

async function seedPOs(categories) {
  console.log('\nSeeding 10 Purchase Orders...');
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const cat = categories[i % categories.length];
    if(!cat) continue;

    const formData = new FormData();
    formData.append('vendor', `Vendor ${i}`);
    formData.append('department', 'IT');
    formData.append('gstin', '27ABCDE1234F1Z5');
    const lineItems = [{ category_id: cat.id, description: `Item for ${cat.name}`, quantity: 5, unit_price: 100 }];
    formData.append('line_items', JSON.stringify(lineItems));

    try {
      // Don't use fetchWithAuth because it sets Content-Type to application/json
      const res = await fetch(`${API_URL}/purchase-orders`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData
      });
      if(!res.ok) throw new Error(await res.text());
      count++;
    } catch (e) { console.error('Failed to create PO:', e.message); }
  }
  console.log(`Created ${count} purchase orders.`);
}

async function seedMaintenance() {
  console.log('\nSeeding 15 Maintenance Tickets...');
  const res = await fetchWithAuth(`${INVENTORY_URL}/assets?limit=15`);
  const assets = res.data;
  if (!assets || assets.length === 0) return console.log('No assets to report issues on.');

  let count = 0;
  for (let i = 0; i < Math.min(15, assets.length); i++) {
    try {
      await fetchWithAuth(`${INVENTORY_URL}/assets/${assets[i].id}/report-issue`, {
        method: 'POST', body: JSON.stringify({ reported_by: 1, issue_type: 'HARDWARE', description: `Simulated hardware issue ${Date.now()}` })
      });
      count++;
    } catch (e) { console.error(e.message); }
  }
  console.log(`Created ${count} maintenance tickets.`);
}

async function run() {
  try {
    await login();
    const categories = await seedCategories();
    if(categories.length === 0) {
      console.log('Fetching existing categories...');
      const catsRes = await fetchWithAuth(`${INVENTORY_URL}/categories`);
      categories.push(...catsRes);
    }
    await seedUsers();
    await seedAssets(categories);
    await seedRequests(categories);
    await seedPOs(categories);
    await seedMaintenance();
    // --- 7. Sync Redis ---
    console.log('\nSynchronizing Redis counters with Postgres...');
    const syncRes = await fetch(`${INVENTORY_URL}/system/sync-redis`, {
      method: 'POST'
    });
    if (syncRes.ok) {
      const syncData = await syncRes.json();
      console.log('Redis synced successfully:', syncData.stock);
    } else {
      console.error('Failed to sync Redis');
    }

    console.log('\n✅ Seeding Complete! The system is fully hydrated and ready for demo.');
  } catch (err) {
    console.error('\n❌ Seeding failed:', err.message);
  }
}

run();
