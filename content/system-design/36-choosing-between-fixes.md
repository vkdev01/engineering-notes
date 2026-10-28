---
section: "36"
title: "Choosing between overlapping fixes"
kicker: "Patterns"
abstract: "The twelve lines overlap. Naming the right-sounding pattern for the wrong bottleneck is the most common way a good answer loses marks."
time: "3 min"
order: 36
---

## The six confusions

| Confusion | How to tell them apart |
| --- | --- |
| **Cache vs. read replica** | A cache helps when the *same* small set of results is requested repeatedly. A replica helps when reads are broad and varied. If a few hot keys dominate, replicas are an expensive cache; if every query is different, a cache misses constantly. |
| **Queue vs. rate limit** | A queue absorbs work you intend to do later. A rate limit rejects work you are choosing not to do. Bursty-but-wanted traffic gets a queue; abusive or over-quota traffic gets a limit. |
| **Index vs. shard** | An index fixes slow reads on data that fits on one node. A shard fixes write volume or data size that does not. Sharding an unindexed database buys pain and nothing else. |
| **Retry vs. circuit breaker** | Retry handles the blip. The breaker handles the outage. Retry without a breaker is how a small failure becomes a retry storm. |
| **Idempotency key vs. deduplication** | A key protects one logical operation from being applied twice by retries. Deduplication removes repeats from a stream or batch after the fact. |
| **Load balancer vs. rate limiter** | The balancer spreads good traffic across capacity. The limiter decides how much traffic is good. Both live at the edge; you usually want both. |

## The cost ladder

Every fix on the list has a different price, and the prices are not close. Work up the ladder,
not across it.

| Rung | Fix | Cost | Reversible? |
| --- | --- | --- | --- |
| 1 | Index | Some write throughput | Yes, trivially |
| 2 | Cache | Staleness, invalidation bugs | Yes |
| 3 | Load balancer + statelessness | A hop, and session refactoring | Yes |
| 4 | Read replica | Lag, failover decisions | Yes |
| 5 | Queue | Asynchrony, duplicates, a new system | Mostly |
| 6 | CDN + object storage | Invalidation, egress cost | Yes |
| 7 | Sharding | Cross-shard queries, permanent key choice | Barely |

An answer that reaches rung 7 while ignoring rung 1 is the single most common way to look
inexperienced while sounding sophisticated.

## Symptom → likely cause

| Symptom | Look here first | Before anything else |
| --- | --- | --- |
| One endpoint slow, others fine | Index, query plan | `EXPLAIN` |
| Everything slow at once | Dependency, connection pool | Trace the p99 |
| Slow only for far-away users | Network, CDN, region | Latency table |
| Slow under load, fine at idle | Queueing, pool size, lock contention | Utilisation graph |
| Errors during deploys | Connection draining, readiness | Health checks |
| Errors after a dependency incident | Retry storm, no breaker | Backoff + breaker |
| Data missing right after a write | Replica lag, read-your-writes | Route to primary |
| Duplicates in the database | Missing idempotency | Key store |
| Cannot find the cause at all | Observability | Trace IDs |

## A worked comparison

**Problem:** a product page takes 2.4 seconds at p95. Read QPS is 4,000; the page issues 40
queries; the catalogue has 2 million products; 200 products are viewed 90% of the time.

- **Cache?** Yes — 200 hot products is a tiny working set, and 30 seconds of staleness is fine
  for a catalogue. This alone takes most of the load away.
- **Replicas?** Maybe later, for the 10% of long-tail traffic.
- **Indexes?** Check first: a missing index on `(category_id, updated_at)` could be the reason
  each query takes 60 ms.
- **Sharding?** No. Two million rows is nothing.

The right answer names the index and the cache, prices both, and explicitly rejects sharding
with a reason. That rejection is worth as much as the two fixes.
