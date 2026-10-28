---
section: "7"
title: "Caching theory"
kicker: "Fundamentals"
abstract: "A cache is a bet that the same answer will be asked for again. Most of the time the bet wins; the engineering is in what happens when it does not."
time: "4 min"
order: 7
---

## What it is

A cache stores the result of expensive work in a faster tier. It works because access
patterns are skewed: in most systems a small fraction of items accounts for most requests.

The metrics that matter:

- **Hit rate** — fraction of requests served from cache. Going from 90% to 99% cuts
  database load by 10×; going from 99% to 99.9% cuts it by another 10×. The tail of misses
  is where the cost lives.
- **Working set size** — bytes of the frequently accessed subset. If the working set
  exceeds cache memory, hit rate collapses; this is why "add more cache" sometimes does
  nothing.
- **Eviction policy** — LRU (recency), LFU (frequency), FIFO, random, TTL-only.

## Where caches live

| Layer | Example | Typical win |
| --- | --- | --- |
| Client / browser | `Cache-Control: max-age` | Eliminates the request entirely |
| CDN edge | Static assets, video segments, public API responses | 100–250 ms of network, plus origin load |
| Application in-process | Local dict with TTL | ~100 ns; no network at all |
| Distributed cache | Redis, Memcached | ~0.5–1 ms; shared across instances |
| Database buffer pool | Pages in RAM | Turns 100 µs into 100 ns |
| Materialised view | Precomputed aggregate | Removes the computation |

Each layer is worth roughly an order of magnitude in latency, and each has a different
invalidation story. The browser is nearly impossible to invalidate; the in-process cache is
nearly impossible to keep consistent across instances.

## Write policies

| Policy | Flow | Consequence |
| --- | --- | --- |
| **Cache-aside** (lazy) | App reads cache; on miss reads DB and populates | Simple; first request after a miss is slow; stale data possible |
| **Read-through** | Cache library fetches on miss | Same, less app code |
| **Write-through** | Write cache and DB together, synchronously | Cache always fresh; every write pays twice |
| **Write-behind** | Write cache, flush to DB asynchronously | Fast writes; data loss window on crash |
| **Write-around** | Write DB only, invalidate cache | Avoids caching write-once data |

Cache-aside with explicit invalidation is the default in most systems, and the honest
answer in most interviews.

## The four failure modes

### 1. Stampede (thundering herd)

A hot key expires and 5,000 concurrent requests all miss and all query the database.

**Fixes:** single-flight / request coalescing (only one caller recomputes, others wait);
jittered TTLs so keys do not expire together; probabilistic early refresh.

### 2. Cache penetration

Requests for keys that do not exist bypass the cache every time — often a scraper
enumerating IDs. **Fixes:** cache negative results with a short TTL, or a Bloom filter in
front.

### 3. Hot key

One key is requested so often that a single cache node saturates. **Fixes:** replicate the
key across nodes with a random suffix, or keep it in-process at the edge.

### 4. Inconsistency

The database and cache disagree because a write updated one and not the other, or two
writers interleaved. **Fixes:** delete rather than update on write (delete-then-populate is
idempotent in a way that update is not), version keys, or use a short TTL as a backstop so
any inconsistency self-heals.

:::warn[Cache invalidation is not a joke, it is a schedule]
Every cache needs a *maximum staleness* number that the product owner has agreed to.
"Five seconds" and "five minutes" produce completely different designs, and asking for
that number is a better question than "should we cache?".
:::

## Choosing an eviction policy

- **LRU** — the default. Fails on scans, which flush a hot working set with cold data.
- **LFU** — better when popularity is stable, worse when it shifts (yesterday's viral post).
- **TTL** — necessary regardless, as a correctness backstop.
- **Segmented LRU / W-TinyLFU** — what modern caches actually use, to resist scan pollution.

## What must never be cached

- Anything a user must see immediately after their own write (unless you handle
  read-your-writes).
- Authorisation decisions, unless the TTL is shorter than the revocation window.
- Anything with a legal retention constraint on staleness (some financial data).
- Personal data without a per-user key, or you will serve one user's data to another.

## Interview soundbite

> "I'd cache feed pages cache-aside in Redis with a 30-second TTL, delete-on-write, and
> single-flight to prevent a stampede when a popular user's key expires. Thirty seconds of
> staleness is invisible in a feed, and it removes about 95% of the read load."

## Where to go next

- [Cache building block](/c/system-design/18-cache/) — the operational version.
- [Slow reads → add a cache](/c/system-design/42-slow-reads-cache/) — the pattern page.
- [LRU cache implementation](/c/system-design/66-lru-cache/).
