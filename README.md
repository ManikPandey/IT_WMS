# IT_WMS — Distributed Inventory & Procurement System

A MERN-stack IT Asset & Warehouse Management System built to demonstrate real distributed-systems engineering (concurrency control, event-driven communication, idempotency) using a **modular monolith + 2 extracted microservices**, entirely on free-tier infrastructure.

> Built as a fresher-level portfolio project. Every architectural decision below is deliberately scoped to be provable, demoable, and explainable in an interview — not just copy-pasted boilerplate.

---

## 1. Elevator Pitch

"I built a MERN-based Warehouse & Procurement system split into a Core service and a separately-deployed Inventory Allocation microservice. To prevent overselling during concurrent asset allocation, I implemented and benchmarked two concurrency strategies — Postgres `SELECT FOR UPDATE SKIP LOCKED` vs an atomic Redis counter — and proved correctness with a k6 load test firing 100 simultaneous requests. Services communicate asynchronously via Redis Streams using a transactional outbox pattern to guarantee at-least-once delivery without dual-write bugs."

---

## 2. Tech Stack (100% Free Tier)

| Layer | Tool | Free Tier Notes |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind + TanStack Query | Deploy on **Vercel** (free) |
| Core Service | Node.js + Express + Prisma | Deploy on **Render** free web service |
| Inventory Microservice | Node.js + Express + Prisma | Separate **Render** free web service |
| Relational DB | PostgreSQL | **Neon.tech** free tier (separate DB per service) |
| Cache / Locks / Events | Redis | **Upstash** free tier (serverless Redis, supports Streams) |
| Async Messaging | **Redis Streams** (via `ioredis`) | Free, no cluster to manage — Kafka is documented as a stretch goal, not required |
| Containerization | Docker + Docker Compose | Local only, always free — this is where you learn Docker |
| Load Testing | k6 | Open source, run locally |
| CI | GitHub Actions | Free for public repos |
| Auth | JWT (jsonwebtoken) | No cost |

**Note:** Free tiers change — verify current limits on Render/Neon/Upstash before relying on them for a live demo link. Render free services also cold-start after inactivity; mention this in your README/demo so it doesn't look broken.

**Why Redis Streams instead of Kafka:** Kafka needs a broker cluster that's genuinely painful to run for free in the cloud. Redis Streams gives you consumer groups, message acknowledgment, and replay — the same core concepts Kafka teaches — on infrastructure you're already paying nothing for. Document Kafka as "what I'd swap in at higher scale" — that's a mature, honest answer in an interview, not a weakness.

---

## 3. Architecture

```
┌─────────────┐      REST/JWT       ┌───────────────────┐
│   React     │ ──────────────────► │   Core Service      │
│  Frontend   │                     │  (Auth, Procurement,│
└─────────────┘                     │   Gateway routes)   │
                                     └─────────┬──────────┘
                                               │ REST proxy via Opossum
                                               │ Circuit Breaker
                                               ▼
                                     ┌──────────────────────┐
                                     │ Nginx Load Balancer  │
                                     └─────────┬────────────┘
                                               │ Round-robin
                                               ▼
                                     ┌──────────────────────┐
                                     │ Inventory & Allocation │
                                     │  (3 Docker Replicas) │
                                     └─────────┬──────────────┘
                                               │
                        ┌──────────────────────┼───────────────────┐
                        ▼                      ▼                   ▼
                 Postgres (own DB)      Redis (locks/counter)  Redis Streams
                                                                (events out)
                                                                    │
                                                                    ▼
                                                        Core Service consumes
                                                        stream → CQRS updates
```

Two services only, as scoped:
1. **Core Service** — Auth, RBAC, Procurement (PO creation/approval), and acts as the API entry point for the frontend. Owns its own Postgres DB. Also runs a background consumer that reads the Redis Stream and writes the append-only audit log.
2. **Inventory & Allocation Service** — Owns asset data and the allocation/reservation logic. Owns its own separate Postgres DB (this is the "database per service" boundary that makes it a real microservice, not just a second folder). Publishes events to Redis Streams on state changes.

---

## 4. The Core Engineering Challenge: Concurrency-Safe Allocation

Implement **and benchmark both** of these on the same endpoint (`POST /allocate`), then keep the better-performing one live and document the comparison — this comparison is your strongest interview artifact:

**Option A — Postgres pessimistic locking:**
```sql
BEGIN;
SELECT * FROM assets
WHERE status = 'IN_STOCK' AND type = $1
LIMIT 1
FOR UPDATE SKIP LOCKED;
-- update status to 'DEPLOYED', assign to user
COMMIT;
```

**Option B — Redis atomic counter:**
```js
const remaining = await redis.decr(`stock:${assetType}`);
if (remaining < 0) {
  await redis.incr(`stock:${assetType}`); // release
  return reject('OUT_OF_STOCK');
}
// proceed to create the DEPLOYED record in Postgres
```

**Proof of correctness:** write a Node script (or k6 script) that fires 100 concurrent allocation requests against a pool of 50 assets. Screenshot/graph the result: exactly 50 succeed, 50 fail cleanly, zero overselling, zero deadlocks. This graph goes in your README.

---

## 5. Event Flow & the Outbox Pattern (avoiding the dual-write bug)

Problem: writing to Postgres and publishing to Redis Streams are two separate operations — if the process crashes between them, the event is lost silently.

Fix — **transactional outbox**:
1. In the same Postgres transaction that updates `assets`, insert a row into an `outbox_events` table.
2. A lightweight relay worker polls `outbox_events` (or uses Postgres `LISTEN/NOTIFY`) and publishes unpublished rows to the Redis Stream, then marks them `published = true`.
3. Core Service's consumer reads the stream (consumer group `audit-log-group`) and writes to `audit_log`, using the event's unique ID to stay idempotent on redelivery.

This single pattern is worth more in an interview than the entire Kafka mention in the original draft — it shows you understand *why* naive pub/sub is unsafe.

### The Saga Pattern (Distributed Transactions)
When a Purchase Order is rejected in `core-service`, a `PO_REJECTED` event is relayed via the outbox into the Redis Stream. The `inventory-service` consumer listens to this stream and automatically executes a compensating transaction to revert all assigned assets back to `CANCELLED`, effectively rolling back the distributed state without requiring a complex 2PC (Two-Phase Commit).

---

## 6. Database Schema (per service)

**Inventory DB:**
```
assets (id, asset_tag, type, status, jsonb_attributes, assigned_to, warehouse_id, created_at, updated_at)
outbox_events (id, event_type, payload_json, published, created_at)
```

**Core DB:**
```
users (id, email, password_hash, role)
purchase_orders (id, vendor, budget, status, idempotency_key, created_at)
audit_log (id, event_type, entity_id, payload_json, processed_event_id, created_at)  -- processed_event_id enforces idempotent consumption
```

---

## 7. Asset State Machine

| Current State | Allowed Next States | Trigger |
|---|---|---|
| PROCURED | IN_STOCK | GRN scanned/verified |
| IN_STOCK | DEPLOYED, MAINTENANCE, IN_TRANSIT | Allocated / found defective / warehouse transfer |
| DEPLOYED | IN_STOCK, MAINTENANCE | Returned / reported broken |
| MAINTENANCE | IN_STOCK, SCRAPPED | Repaired / unrecoverable |
| IN_TRANSIT | IN_STOCK | Arrived at destination warehouse |
| SCRAPPED | — (terminal) | — |

(Added `IN_TRANSIT` — a WMS handling multiple warehouses needs a transfer state; the original draft was missing it.)

---

## 8. Idempotency (on `POST /purchase-orders/:id/approve`)

- Client sends header `Idempotency-Key: <uuid>`.
- Server checks a Redis key `idem:<key>` (TTL 24h) before processing.
- If present → return the cached response, do not re-run the budget deduction.
- If absent → process request, store `{statusCode, body}` under that key, then respond.

---

## 9. Folder Structure

```
/nexus-wms
  /frontend            (Vite React app)
  /core-service
    /src (routes, prisma, consumers)
    Dockerfile
  /inventory-service
    /src (routes, prisma, outbox-relay)
    Dockerfile
  /load-tests           (k6 scripts)
  docker-compose.yml     (local Postgres x2, Redis, both services)
  README.md
```

---

## 10. Local Dev Setup

```bash
docker compose up -d        # spins up 2 postgres instances + redis
cd core-service && npm run dev
cd inventory-service && npm run dev
cd frontend && npm run dev
```

---

## 11. Roadmap

- **Phase 0 (Week 1):** Schema design for both DBs + outbox table on paper. Docker Compose skeleton.
- **Phase 1 (Weeks 2-3):** Build Inventory service alone. Implement Option A (Postgres locking). Prove correctness with concurrent test script.
- **Phase 2 (Week 4):** Add Option B (Redis counter), benchmark both, write comparison doc.
- **Phase 3 (Week 5):** Build Core service (Auth, PO approval + idempotency key).
- **Phase 4 (Week 6):** Wire up outbox → Redis Streams → audit log consumer.
- **Phase 5 (Week 7):** React frontend + TanStack Query.
- **Phase 6 (Week 8):** Dockerize everything, deploy free tier, k6 load test, generate graphs for README.

---

## 12. Interview Talking Points This Project Proves

- Pessimistic vs optimistic concurrency control, with real benchmark data confirming zero overselling on a horizontally scaled 3-node cluster.
- Dual-write problem and the Transactional Outbox pattern.
- Event-Driven Saga Pattern (Compensating Transactions) across service boundaries.
- CQRS (Command Query Responsibility Segregation) for aggregation-free real-time dashboard statistics.
- Circuit Breakers (`opossum`) for inter-service resilience and Rate Limiting for API protection.
- Distributed Tracing (`X-Request-ID`) propagation from HTTP headers into asynchronous message queues.
- Idempotent API design.
- Database-per-service boundary.
- Honest scoping: why Redis Streams was chosen over Kafka at this scale, and what would change at higher throughput.

---

## 13. Explicit Future Work (say this out loud in interviews — it shows maturity)

- Swap Redis Streams for Kafka when message volume/replay needs exceed Redis's practical limits
- Real Redlock (multi-node) if locks need to survive single-node Redis failure
- Full API Gateway with circuit breakers (`opossum`) if service count grows beyond 2
- OpenTelemetry tracing across service boundaries

---

## 14. Explicit Consistency Model (CAP Theorem Trade-offs)

In a distributed environment, we must explicitly choose between Consistency and Availability under Partition (CAP). This system implements a hybrid approach depending on the domain boundary:

- **CP (Consistent & Partition Tolerant) — Asset Allocation**:
  The core inventory allocation (`POST /allocate`) must NEVER oversell. We trade availability for strict consistency. If the Redis lock/counter is unreachable, or the Postgres DB is partitioned, the request fails (503/500). We guarantee strongly consistent reads and writes here using pessimistic locking (`FOR UPDATE SKIP LOCKED`) and atomic Redis counters.

- **AP (Available & Partition Tolerant) — Dashboard & Audit Logs**:
  The `GET /dashboard/stats` CQRS read model and the Audit Logs are eventually consistent. When a Purchase Order is approved, the UI immediately returns success (Availability). The Outbox Relay and Redis Streams consumer run asynchronously to update the read models. 
  *Maximum Staleness*: Typically < 50ms under normal load, bounded by the Outbox polling interval. If the stream consumer crashes, the system remains fully available for writes, and the read model simply falls behind until the consumer recovers and processes the pending queue.
