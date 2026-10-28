---
section: "71"
title: "Glossary"
kicker: "Interview"
abstract: "The terms that come up constantly, including the ones that are usually used loosely."
time: "4 min"
order: 71
---

**ACID** — Atomicity, Consistency, Isolation, Durability: the guarantees of a single-database
transaction.

**Amdahl's law** — The speedup from parallelising is limited by the fraction that cannot be
parallelised. In system design: one serial component caps the whole system.

**At-least-once** — Delivery guarantee where every message is delivered, possibly more than once.
Requires idempotent consumers.

**Backpressure** — A mechanism that slows producers when consumers cannot keep up, instead of
letting a queue grow without bound.

**BASE** — Basically available, soft state, eventual consistency. The availability-first alternative
to ACID.

**Bloom filter** — A probabilistic set membership structure. False positives possible, false
negatives not. Used to avoid expensive lookups.

**Bulkhead** — Isolating resources (thread pools, connection pools) per dependency so one failure
cannot starve the others.

**CAP theorem** — During a network partition, a distributed system must sacrifice either
consistency or availability.

**Cache-aside** — The application checks the cache, and on a miss reads the source and populates the
cache. The default caching pattern.

**Cardinality** — The number of distinct values. In metrics, distinct label combinations; in
databases, distinct values in a column (which decides whether an index helps).

**CDC (change data capture)** — Tailing a database's log to publish row changes as events.

**Circuit breaker** — A state machine that stops calling a failing dependency, fails fast, and
probes for recovery.

**Consistent hashing** — Placing nodes and keys on a ring so adding or removing a node moves only
about 1/N of keys.

**CQRS** — Command Query Responsibility Segregation: separate write and read models.

**Dead-letter queue** — Where messages go after repeated processing failures, so they do not block
a partition.

**Denormalisation** — Duplicating data to make reads cheaper, at the cost of write complexity.

**Eventual consistency** — Replicas converge given no new writes. Staleness is bounded in practice
but not guaranteed.

**Fan-out** — Distributing one event to many destinations. The core issue in feeds and notifications.

**Fencing token** — A monotonically increasing number issued with a lock, so storage can reject
writes from a holder whose lease expired.

**Geohash** — An encoding of latitude and longitude into a string, where a shared prefix implies
proximity.

**Idempotency** — Performing an operation twice has the same effect as once.

**Isolation level** — How much concurrent transactions can see each other's partial work. Read
committed, repeatable read, serialisable.

**LSM tree** — Log-structured merge tree: writes go to memory and immutable sorted files, merged in
the background. Good for write-heavy workloads.

**Materialised view** — A precomputed query result, stored and refreshed.

**Outbox pattern** — Writing the domain change and an event row in one local transaction, then
publishing from the outbox, so the event is never lost or spurious.

**PACELC** — Extension of CAP: even without partitions (E), you trade latency (L) against
consistency (C).

**Partition tolerance** — The system keeps working despite dropped messages between nodes. In
practice, not optional for distributed systems.

**Quorum** — A majority of replicas. Writing to W and reading from R with W + R > N guarantees
overlap.

**Read-your-writes** — A consistency guarantee that a user sees their own writes immediately.

**Replication lag** — The delay between a write committing on the primary and appearing on a
replica.

**RPO / RTO** — Recovery point objective (how much data you may lose) and recovery time objective
(how long you may be down).

**Saga** — A sequence of local transactions with compensating actions, replacing a distributed
transaction.

**Shard key** — The attribute that decides which partition a row lives on. The most consequential
choice in a sharded system.

**SLO / SLI / error budget** — Service level objective (target), indicator (measurement), and the
allowed failure that remains.

**Split-brain** — Two nodes both believing they are the primary, both accepting writes.

**Stampede / thundering herd** — Many clients missing a cache simultaneously and overwhelming the
origin.

**Stateless** — No request depends on state held in one specific process's memory, so any instance
can serve any request.

**Tail latency** — The slow end of the latency distribution (p95, p99). What users actually notice.

**Throughput** — Operations completed per unit time, as distinct from latency.

**Token bucket** — A rate-limiting algorithm with a burst allowance and a refill rate.

**Two-phase commit** — A synchronous protocol for atomic commits across nodes. Correct, slow, and
fragile under coordinator failure.

**Write amplification** — The ratio of bytes written to storage versus bytes written by the
application. Every index multiplies it.
