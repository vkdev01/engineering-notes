---
section: "10"
title: "Latency and throughput"
kicker: "Fundamentals"
abstract: "Latency is how long one request takes. Throughput is how many finish per second. They improve for different reasons, and confusing them produces designs that are fast in a demo and useless under load."
time: "3 min"
order: 10
---

## What it is

- **Latency** — elapsed time for a single operation, usually quoted as a percentile
  (p50, p95, p99), because averages hide the users who are suffering.
- **Throughput** — operations completed per unit time.
- **Utilisation** — the fraction of capacity in use.

The relationship is not linear. At low utilisation they are independent; as utilisation
approaches 100%, queueing delay explodes. A system at 80% utilisation is not "20% away
from full" — it is already in the region where a small burst doubles response time.

## Why percentiles, not averages

Suppose 99 requests take 10 ms and one takes 1,000 ms. The average is 20 ms, which
describes no user. The p99 is 1,000 ms, which describes the person who will complain.

Rules of thumb worth stating in an interview:

- Alert on p95 or p99, not the mean.
- A p99 that is 10× the p50 means queueing, lock contention, or garbage collection — not
  a uniformly slow dependency.
- Tail latency is *amplified* by fan-out: a request that calls 100 services in parallel
  waits for the slowest of 100, so a 1% slow path becomes a near-certainty. This is the
  single most useful latency fact in distributed design.

## The latency budget

Treat your target as a budget and spend it explicitly. For a 200 ms p95 target on a
server-rendered page:

| Stage | Budget |
| --- | --- |
| TLS + connection reuse | 20 ms |
| Auth / token validation (cached) | 5 ms |
| Service fan-out (parallel, 5 calls) | 60 ms |
| Cache lookups | 5 ms |
| Database (indexed, one round trip) | 20 ms |
| Serialisation + rendering | 30 ms |
| Headroom | 60 ms |

The value of writing this down is that it makes "add another synchronous call" a visible
expense rather than a free addition.

## Techniques that raise throughput

| Technique | What it buys | What it costs |
| --- | --- | --- |
| Batching | Amortises per-item overhead; 100 rows in one round trip. | Adds a small delay to gather the batch. |
| Pipelining / multiplexing | Multiple in-flight requests on one connection. | Head-of-line blocking if not careful. |
| Concurrency (threads/async) | Keeps the CPU busy while waiting on I/O. | Complexity, and thread pools that fill up under failure. |
| Caching | Removes work entirely. | Staleness, invalidation, memory. |
| Compression | Fewer bytes on the wire. | CPU on both ends; ~2 µs per KB is usually a bargain. |
| Async / queueing | Decouples arrival rate from processing rate. | Eventual completion; the caller must handle "pending". |

## Techniques that reduce latency

| Technique | Effect |
| --- | --- |
| Bring data closer: CDN, edge, read replica in-region | Removes 100–250 ms of cross-region round trip. |
| Reduce round trips: fewer sequential calls, batch, denormalise | Each avoided round trip is 0.5–150 ms. |
| Indexes | Turns a 10 ms scan into a 0.1 ms seek. |
| Precompute: materialised views, fan-out on write | Moves work off the read path. |
| Parallelise independent work | Total time becomes the max, not the sum. |
| Timeouts and circuit breakers | Caps the worst case instead of inheriting it. |

:::note[The cheapest latency win]
Count the sequential round trips on your request path. Every one you remove — by
caching, denormalising, or parallelising — is worth more than any amount of CPU
tuning, because the network is 5,000× slower than memory.
:::

## Interview soundbite

> "Throughput here is fine — the problem is tail latency. The feed request makes forty
> sequential calls to fetch posts, so p99 is the sum of forty p99s. I'd batch those into
> one multi-get against the timeline store, which turns forty round trips into one."

## Where to go next

- [Caching theory](caching.md) — the highest-leverage way to remove latency.
- [Networking](networking.md) — where the milliseconds actually go.
