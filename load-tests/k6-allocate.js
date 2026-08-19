import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const successLatencyPostgres = new Trend('success_latency_postgres');
const successLatencyRedis = new Trend('success_latency_redis');
const successCountPostgres = new Counter('success_count_postgres');
const outOfStockCountPostgres = new Counter('out_of_stock_count_postgres');
const successCountRedis = new Counter('success_count_redis');
const outOfStockCountRedis = new Counter('out_of_stock_count_redis');

export const options = {
  scenarios: {
    postgres_strategy: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      startTime: '0s',
      env: { STRATEGY: 'postgres' },
    },
    redis_strategy: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      startTime: '10s',
      env: { STRATEGY: 'redis' },
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
};

export function setup() {
  const BASE_URL = __ENV.INVENTORY_URL || 'http://localhost:3001';

  console.log('Seeding 50 assets for Postgres test...');
  let resPg = http.post(`${BASE_URL}/seed`, JSON.stringify({ type: 'LAPTOP_PG', count: 50 }), {
    headers: { 'Content-Type': 'application/json' }
  });

  console.log('Seeding 50 assets for Redis test...');
  let resRd = http.post(`${BASE_URL}/seed`, JSON.stringify({ type: 'LAPTOP_RD', count: 50 }), {
    headers: { 'Content-Type': 'application/json' }
  });

  return { BASE_URL };
}

export default function (data) {
  const strategy = __ENV.STRATEGY;
  const assetType = strategy === 'postgres' ? 'LAPTOP_PG' : 'LAPTOP_RD';
  const url = `${data.BASE_URL}/allocate${strategy === 'redis' ? '?strategy=redis' : ''}`;

  const res = http.post(url, JSON.stringify({
    assetType: assetType,
    assignedTo: __VU,
    warehouseId: 1
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(res, {
    'is status 200 (Allocated)': (r) => r.status === 200,
    'is status 400/409 (Out of Stock)': (r) => r.status === 400 || r.status === 409,
  });

  if (res.status === 200) {
    if (strategy === 'postgres') {
      successCountPostgres.add(1);
      successLatencyPostgres.add(res.timings.duration);
    } else {
      successCountRedis.add(1);
      successLatencyRedis.add(res.timings.duration);
    }
  } else {
    if (strategy === 'postgres') {
      outOfStockCountPostgres.add(1);
    } else {
      outOfStockCountRedis.add(1);
    }
  }
}
