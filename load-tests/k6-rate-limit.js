import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const status200 = new Counter('status_200');
const status429 = new Counter('status_429');

export const options = {
  scenarios: {
    burst: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 60,
      maxDuration: '10s',
    },
  },
};

export function setup() {
  const BASE_URL = __ENV.API_URL || 'http://localhost:3000';
  
  // Login to get a token
  const loginRes = http.post(`${BASE_URL}/login`, JSON.stringify({
    email: 'admin@example.com',
    password: 'admin'
  }), { headers: { 'Content-Type': 'application/json' } });

  let token = '';
  if (loginRes.status === 200) {
    token = loginRes.json('token');
  } else {
    console.error('Failed to login for rate-limit test');
  }

  return { BASE_URL, token };
}

export default function (data) {
  const url = `${data.BASE_URL}/dashboard/stats`;

  const res = http.get(url, {
    headers: {
      'Authorization': `Bearer ${data.token}`
    }
  });

  check(res, {
    'is status 200': (r) => r.status === 200,
    'is status 429': (r) => r.status === 429,
  });

  if (res.status === 200) status200.add(1);
  if (res.status === 429) status429.add(1);
}
