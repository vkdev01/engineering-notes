---
section: "18"
title: "Cache"
kicker: "Building blocks"
abstract: "A fast tier holding answers you have already computed. Cheap to add, hard to keep honest."
time: "3 min"
order: 18
---

## What it is

A store in front of a slower source of truth, holding recently or frequently used data. For
the theory — hit rate, working sets, write policies, stampedes — read [caching
theory](../fundamentals/caching.md) first. This page is the operational version.

## The layers you actually deploy

| Layer | Typical tech | Latency | Shared? |
| --- | --- | --- | --- |
| Browser | `Cache-Control` | 0 | Per user |
| CDN edge | CDN | 5–30 ms | Global |
| In-process | dict + TTL | ~0.1 µs | Per instance |
| Distributed | Redis, Memcached | 0.5–2 ms | All instances |
| Database page cache | engine-managed | ~0.1 µs | Per node |

The two-layer pattern — a small in-process cache in front of Redis — cuts both latency and
Redis load, at the cost of per-instance staleness. It is worth it when the object is small,
hot, and tolerant of a second or two of drift (feature flags, config, category lists).

## Choosing between Redis and Memcached

| | Redis | Memcached |
| --- | --- | --- |
| Data structures | Strings, hashes, lists, sets, sorted sets, streams, HyperLogLog | Strings only |
| Persistence | Optional snapshots / AOF | None |
| Clustering | Redis Cluster, sharded | Client-side sharding |
| Extra use cases | Locks, rate limits, queues, leaderboards, pub/sub | Pure caching |
| Multi-threaded | Mostly single-threaded per shard | Multi-threaded |

Rule of thumb: Memcached if you only need a cache and want simple horizontal scale; Redis if
you want data structures, atomic operations, or to use it for locks and rate limiting too.

## Patterns worth knowing by name

- **Cache-aside** — app checks cache, on miss reads the DB and populates. Default choice.
- **Read-through** — the cache library does the miss handling.
- **Write-through / write-behind** — the cache is on the write path.
- **Refresh-ahead** — proactively refresh hot keys before they expire.
- **Negative caching** — cache "not found" for a short TTL to blunt enumeration attacks.

## Trade-offs

1. **Staleness is now a product decision.** Get an agreed maximum staleness per data type.
2. **Two sources of truth.** Any bug in invalidation produces data that is wrong in a way
   that is hard to reproduce. Prefer delete-on-write over update-on-write.
3. **A new dependency on the request path.** If the cache is down and you have no fallback,
   you have made the system less available, not more. Always handle cache failure as a miss,
   with load shedding behind it.
4. **Memory is expensive.** Budget for the working set, not the data set.

## Failure modes

- **Stampede** on expiry of a hot key → single-flight, jittered TTLs.
- **Hot key** saturating one shard → key replication with a random suffix.
- **Big keys** (a 10 MB list) blocking the event loop → split into chunks.
- **Cache used as a database** — data that exists only in Redis is data you will lose.

## Interview soundbite

> "Cache-aside in Redis, 30-second TTL, delete on write, single-flight to prevent a
> stampede. If Redis is unavailable the request falls through to the database behind a load
> shedder, so a cache outage is slow rather than fatal."

## Where to go next

- [Caching theory](../fundamentals/caching.md).
- [Distributed cache case study](../case-studies/distributed-cache.md).
