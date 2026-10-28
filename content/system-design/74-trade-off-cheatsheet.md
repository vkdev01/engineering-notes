---
section: "74"
title: "Trade-off cheat sheet"
kicker: "Interview"
abstract: "Every decision in this guide, reduced to one line of what you gain and one line of what you pay."
time: "2 min"
order: 74
---

## Storage

| Choose | You gain | You pay |
| --- | --- | --- |
| Relational | Transactions, joins, constraints | Horizontal write scale |
| Key-value | Single-key access at any scale | Every query must know the key |
| Wide-column | Massive writes, per-partition ordering | Ad-hoc queries, cross-partition reads |
| Document | Flexible nested shape | Cross-document consistency |
| Search index | Relevance, facets, fuzzy match | It is derived, and it lags |
| Object storage | Cheap durable blobs | Latency, no partial updates |
| OLAP | Aggregates over billions of rows | Point updates, small-read concurrency |
| Cache | Latency and origin load | Staleness and invalidation |
| Read replica | Read throughput, failover | Lag and failover decisions |
| Sharding | Write throughput and size | Cross-shard queries, permanent key |

## Consistency

| Choose | You gain | You pay |
| --- | --- | --- |
| Strong consistency | Simple mental model | Coordination, latency, availability under partition |
| Eventual consistency | Availability and speed | Every read must handle staleness |
| Read-your-writes | Correct-feeling UX | Routing complexity |
| Causal consistency | Sensible ordering where it matters | Dependency tracking |
| Synchronous replication | Zero data loss on failover | Write latency includes the replica |
| Async replication | Fast writes | An RPO window of data loss |

## Messaging and delivery

| Choose | You gain | You pay |
| --- | --- | --- |
| Queue (SQS/Rabbit) | Simple work distribution | No replay, weaker ordering |
| Log (Kafka) | Replay, ordering per partition, fan-out | Operational weight, retention cost |
| At-least-once | No message loss | Duplicates, so idempotent consumers |
| At-most-once | No duplicates | Message loss |
| One partition | Global ordering | One consumer's throughput |
| Many partitions | Throughput | Ordering only within a partition |

## Resilience

| Choose | You gain | You pay |
| --- | --- | --- |
| Timeout | Bounded worst case | Possible false failures on slow-but-fine calls |
| Retry with backoff | Recovers from blips | Amplified load during incidents |
| Circuit breaker | Fails fast, protects the dependency | A fallback you must design |
| Bulkhead | Failure isolation | Wasted capacity per pool |
| Fail fast | Predictable behaviour | Users see errors sooner |
| Graceful degradation | Partial service | Complexity, and silent staleness |

## Architecture

| Choose | You gain | You pay |
| --- | --- | --- |
| Monolith | Simplicity, one deploy, real transactions | Coupled scaling and releases |
| Microservices | Independent scaling and ownership | Distributed everything: latency, debugging, consistency |
| API gateway | One place for cross-cutting concerns | A hop, a shared deploy surface |
| Serverless | No capacity planning | Cold starts, execution limits, per-request cost |
| Batch | Efficiency, cheap reprocessing | Latency |
| Stream | Freshness | A permanently running stateful system |
| Polyglot persistence | The right tool per query | N systems to operate and keep in sync |

## The one-liners to memorise

- A cache trades staleness for latency.
- A replica trades staleness for read throughput.
- A shard trades query flexibility for write throughput.
- An index trades write speed for read speed.
- A queue trades immediacy for resilience.
- A rate limit trades rejected requests for system stability.
- A breaker trades a feature for overall availability.
- An idempotency key trades storage for safety.
- Synchronous replication trades latency for zero data loss.
- Denormalisation trades write complexity for read speed.
