# IT WMS - Architecture & System Design Q&A

This document serves as a cheat sheet for technical interviews, covering the exact architectural decisions, design patterns, and performance optimizations implemented in the IT_WMS project.

---

## 🟢 Small Questions

### 1. What does CQRS stand for, and why did you apply it specifically to the analytics module?
**CQRS** stands for **Command Query Responsibility Segregation**. It means splitting the system into a "Command" side (which writes/mutates data) and a "Query" side (which reads data). 
**Why here?** In a warehouse system, querying the dashboard for live statistics (Total Stock, Asset Value, Pending POs) requires expensive `COUNT` and `SUM` aggregations across millions of rows in the `inventory-service` database. By applying CQRS, the `inventory-service` handles commands and emits events. The `core-service` listens to these events and asynchronously increments/decrements a pre-aggregated `dashboard_summary` read model table. When the frontend loads the dashboard, it performs an $O(1)$ query on this table instead of scanning the entire inventory database, resulting in lightning-fast dashboard loads.

### 2. What is the Saga pattern, and how does it differ from a standard ACID transaction?
The **Saga pattern** manages distributed transactions across multiple microservices. A standard **ACID** transaction (like Two-Phase Commit / 2PC) locks database tables across the network until all services vote to commit, which creates severe performance bottlenecks and tight coupling.
A Saga breaks the transaction into a sequence of isolated, local ACID transactions. If a downstream service fails, the Saga does not "roll back" the database natively; instead, it executes **Compensating Transactions**—explicit logic that undoes the previous steps (e.g., reverting an asset's status back to `CANCELLED`), achieving Eventual Consistency without holding cross-network database locks.

### 3. What problem does a transactional outbox pattern solve, and why is it needed?
It solves the **Dual-Write Problem**. If your code updates a database and then publishes an event to a message broker (like Redis Streams or Kafka), a crash between those two lines of code means the database updated but the event was lost. The system is now permanently out of sync.
The Outbox pattern solves this by saving the event to an `outbox` table *inside the exact same database transaction* as the domain update. Because databases guarantee atomicity, either both save or neither save. A background relay worker then polls the outbox table and guarantees at-least-once delivery to the message broker.

### 4. How does Token Bucket rate limiting work, and how does it differ from a Fixed Window approach?
**Token Bucket** works by adding a "token" to a bucket at a constant rate (e.g., 5 tokens per second) up to a maximum capacity. When a request arrives, it consumes a token. If the bucket is empty, it returns a `429 Too Many Requests`. This allows for smooth, bursty traffic.
**Fixed Window** simply counts requests starting at the top of a minute (e.g., 12:00) and resets to zero at 12:01. The problem is the "Window Boundary Spike"—a user could send 100 requests at 12:00:59 and another 100 at 12:01:01, effectively bypassing the limit and hitting the server with 200 requests in 2 seconds. Token Bucket prevents this mathematical loophole.

### 5. What does "database-per-service" mean, and what problem does it solve in microservices?
It means every microservice owns its own isolated database (e.g., `core-db` and `inventory-db`), and no service is allowed to directly run SQL queries against another service's database. 
**Problem solved:** It prevents tight coupling. If the inventory team wants to change their schema or switch from Postgres to MongoDB, they can do so without breaking the core team's code. It also prevents cascading failures (one service doing a bad query won't exhaust the CPU of the other service's database).

---

## 🔴 Big Questions

### 1. Redis atomic counters beat Postgres pessimistic locking (655ms vs. 1.4s p50 latency) for concurrency-safe asset allocation. Explain what's happening under the hood in each approach that causes this gap.
**Under the hood with Postgres (`SKIP LOCKED`):**
This relies on Pessimistic Locking. When 100 concurrent requests hit Postgres, the first request acquires a row-level lock on an available asset. The other 99 requests must parse SQL, walk the B-Tree indexes, and scan the disk (or cache) looking for the next unlocked row. Inside the Postgres Lock Manager, managing 100 concurrent lock contentions creates massive CPU overhead and context-switching. On a constrained cloud CPU, this creates a severe bottleneck, queuing up requests and causing the 1.4s latency.

**Under the hood with Redis (`DECR`):**
This relies on Optimistic Atomic Operations. Redis is entirely in-memory and operates on a single-threaded event loop. When 100 requests hit Redis, it doesn't have to manage complex row locks, parse SQL, or scan indexes. It simply queues the 100 `DECR` commands and executes them sequentially in RAM. Because the single thread processes millions of operations per second, an O(1) integer decrement has virtually zero CPU contention. The 655ms latency is almost entirely network travel time, proving that moving highly-contended locking operations out of a relational DB into Redis massively increases cloud throughput.

### 2. Walk me through your k6 benchmark setup (100 requests/50 assets) in full. How did you simulate concurrent load, and how did you verify "zero overselling" actually held?
**The Setup:** The script uses an automated setup block to hit a protected `/seed` API, strictly injecting exactly 50 dummy assets (e.g., `LAPTOP_TEST`) into the live database. 
**The Simulation:** We configured `k6` to spawn exactly 100 Virtual Users (VUs) using the `per-vu-iterations` executor with a simultaneous `startTime`. This ensures all 100 users hit the `POST /allocate` API at the exact same millisecond to maximize race conditions.
**Verification Rigor:** We mathematically verified zero overselling using the `k6` assertion module (`check()`). Out of 100 requests fighting for 50 assets, the metrics output proved that exactly 50 requests returned a `200 OK (Allocated)` and exactly 50 requests returned a `409 (Out of Stock)`. If even one race condition slipped through, we would have seen 51 successes, but both Postgres and Redis strategies held perfectly under stress.

### 3. Walk me through a Saga rollback end-to-end: an asset allocation succeeds but a downstream step fails. What compensating actions fire, in what order, and how do you guarantee they complete?
1. **The Failure Trigger:** An Admin rejects a pending Purchase Order in the `core-service`. The `core-service` updates the PO to `REJECTED`.
2. **The Outbox Write:** In the *exact same Postgres transaction*, the core service inserts a `PO_REJECTED` JSON event into its Outbox table. 
3. **The Relay:** A background worker polls the Outbox, publishes the event to Redis Streams (`asset-events`), and marks it as `published: true`.
4. **The Consumer:** The `inventory-service` consumer loop (`XREADGROUP`) picks up the `PO_REJECTED` event.
5. **The Compensating Action:** The `inventory-service` starts a local transaction to undo the previously successful allocation. It finds all assets tied to that `PO ID`, updates their status from `IN_STOCK` to `CANCELLED`, and dynamically increments the Redis stock counter to return the items to the pool.
6. **The Guarantee:** Once committed, it sends an `XACK` (acknowledge) back to Redis Streams. If the `inventory-service` crashes *before* the `XACK`, Redis Streams will re-deliver the message to another consumer. We guarantee safety against duplicate deliveries by using the Redis Event ID as an idempotency key.

### 4. What is a "dual-write anomaly," concretely? Explain step-by-step how the outbox pattern via Redis Streams prevents it.
**Concretely:** Imagine you run `await prisma.asset.update()` and immediately on the next line run `await redis.publish()`. If your server crashes or the network drops between line 1 and line 2, your database is updated, but the downstream services never receive the event. You now have a dual-write anomaly: silent, permanent data corruption across your distributed architecture.
**How Outbox prevents it:**
1. You open a database transaction.
2. You run the `prisma.asset.update()`.
3. You run `prisma.outbox.create({ event: 'ASSET_UPDATED' })`.
4. You commit the transaction. Because it's an ACID transaction, if the server crashes, both write or neither write. Atomicity is guaranteed.
5. A completely separate relay worker sweeps the `outbox` table, reads the unpublished events, and fires them to Redis Streams. If the relay crashes after sending to Redis but before updating the DB, the event might be sent twice (at-least-once delivery)—which is fine, because our consumers are built to be idempotent!

### 5. How did you decide on microservice boundaries during the migration, and what was hardest about keeping data consistent across services during the cutover?
**Deciding Boundaries:** We used Domain-Driven Design (DDD). We separated the system by bounded contexts: `core-service` handles *Identity & Procurement* (who you are, what your role is, and budgets). `inventory-service` handles *Warehouse Operations* (physical asset state, maintenance, and stock counts). 
**The Hardest Part:** The lack of foreign keys. In a monolith, you can tie an `Asset` directly to a `User` with an enforced Foreign Key and `ON DELETE CASCADE`. In microservices, the `inventory-db` cannot strictly validate if a `user_id` is real. The hardest part was building the event-driven choreography so that if a User is deleted in `core-service`, a `USER_DELETED` event flows through Redis Streams so `inventory-service` can asynchronously unassign all assets tied to that user, replacing rigid database constraints with eventual consistency.
