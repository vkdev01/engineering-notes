---
section: "74"
title: "Trade-off cheat sheet"
kicker: "Interview"
abstract: "Every recurring decision in the course as a dense table — when to choose each side, the number from the running examples that decides it, and the section that derives it — plus one screen of numbers to remember and a script that recomputes them."
time: "10 min"
order: 74
outcomes:
  - "Recall the headline numbers of Pulse, the photo service and checkout, and the formulas behind them"
  - "Decide between paired options (SQL vs key-value, cache-aside vs write-through, push vs pull, 301 vs 302, token bucket vs sliding window) from a numeric threshold"
  - "Name the cost of each choice in one line"
  - "Recompute the core formulas from a short script"
---

Two days before an interview you don't need another derivation; you need the decision, the number that triggers it and the cost you'll be asked about. This page compresses the course into that form. Every threshold below comes from a section that derives it — follow the link when you need the why.

:::key[First principle]
A trade-off is only an answer when it has a **threshold**: "cache, because 1% of posts take 70% of reads and the database is 10× slower than a cache hit" beats "cache, because reads are heavy". Learn the number next to each choice, not just the choice.
:::

Prices, per-server rates and provider latencies are illustrative, as in the sections they come from.

## 74.1 Numbers to remember

| Quantity | Value | Use it for | § |
|---|---|---|---|
| Seconds per day | 86,400 ≈ 10⁵ (rates 14% low) | Daily count → average QPS | [§2.1](/c/system-design/02-estimation) |
| Peak factor | 3× single region, ~1.5× global, 40× flash sale | Size for the peak, not the mean | [§2.2](/c/system-design/02-estimation) |
| Latency ladder | RAM 100 ns · SSD read 100 µs · intra-DC RTT 0.5 ms · cross-region 150 ms | Count round trips × RTT | [§2.7](/c/system-design/02-estimation) |
| Cold vs warm HTTPS | 3 RTTs vs 1 RTT | Connection reuse, CDN, regional replicas | [§11.2](/c/system-design/11-networking) |
| **Pulse** | 2,000 / 6,000 reads/s · 200 / 600 writes/s · 20 GB/day · 7.3 TB/yr · 200 GB hot set | Cache, replicas, fan-out, "don't shard" | [§2.6](/c/system-design/02-estimation) |
| Pulse fan-out | 200 followers → 40k inserts/s avg, 120k peak; 800-entry timelines = 128 GB raw, 174 GB in Redis | Push vs pull, timeline cache | [§54](/c/system-design/54-news-feed) |
| **Photo service** | 10,000 / 30,000 views/s · 400 / 1,200 uploads/s · 88 TB/day · 20 GB/s = 160 Gbit/s out | Object storage, CDN, egress | [§2.6](/c/system-design/02-estimation) |
| Photo egress bill | ~USD 1.0M/month served direct at USD 0.02/GB | Why the CDN hit ratio is the cost alarm | [§2.4](/c/system-design/02-estimation) |
| **Checkout** | 50 → 2,000 orders/s · 4 writes/order = 8,000 writes/s · payment p50 300 ms, p99 2 s | Queues, idempotency, breakers, limits | [§2.6](/c/system-design/02-estimation) |
| In flight (Little) | $L = \lambda W$: 600 payment calls at p50, 4,000 at p99 | Pools, bulkheads, concurrency limits | [§10.2](/c/system-design/10-latency-and-throughput) |
| Queueing | $W = S/(1-\rho)$: 2.5× at 60%, 5× at 80%, 10× at 90% | Plan ≤ 60% peak, ≤ 75% zone down | [§10.3](/c/system-design/10-latency-and-throughput) |
| Pulse API fleet | 15 servers, 5 per zone (10 at 60% carry the peak) | Size for a lost zone | [§13.5](/c/system-design/13-scalability) |
| Nines | 99.9% = 43.2 min · 99.99% = 4.3 min · 99.999% = 26 s per 30 days | SLOs, error budgets | [§2.8](/c/system-design/02-estimation) |
| Serial availability | $\prod A_i$: 5 × 99.9% = 99.5%; checkout path 99.79% | Fewer hard dependencies | [§6.2](/c/system-design/06-availability) |
| Burn rate | 14.4 empties a 28-day budget in 1.9 days (2.1%/h) | Two-window paging | [§6.7](/c/system-design/06-availability) |
| Fan-out tail | \(1-(1-p)^N\): 18% at 20 calls, 1% slow each | Batch before you parallelise | [§10.5](/c/system-design/10-latency-and-throughput) |
| Cache load | DB = $(1-h)\lambda$: 600 / 360 / 60 reads/s at 90 / 94 / 99% of 6,000 | Each 10× fewer misses = 10× less DB | [§7.2](/c/system-design/07-caching) |
| Zipf skew | $s$ = 1: 10% of items → ~88% of reads (14 GB of Pulse posts) | Size the cache to the hot set | [§7.1](/c/system-design/07-caching) |
| Retry stack | $(1+r)^d$: 81× at $r$ = 2, $d$ = 4; one layer + 10% budget = 1.1× | Retry in one layer | [§30.1](/c/system-design/30-retry) |
| Token bucket | ≤ $b + rt$ in any interval $t$; fixed window up to \(2L\) | Burst control | [§28.1](/c/system-design/28-rate-limiter) |
| Resharding | Ring or logical shards move \(1/(N+1)\) (11% at 8 → 9); mod N moves 89% | Never `hash mod N` | [§64](/c/system-design/64-consistent-hashing) |
| Amdahl / USL | Ceiling \(1/\sigma\) (5% serial → 20×); USL peak $N^\ast = \sqrt{(1-\sigma)/\kappa}$ | Remove σ before adding nodes | [§13](/c/system-design/13-scalability) |
| B-tree depth | $\lceil \log_f N \rceil$: 5 levels for 7.3B rows at fanout 179 | One SSD read per lookup | [§23.1](/c/system-design/23-indexes) |
| Bloom filter | 10 bits/key → 0.82% false positives | LSM reads, crawler dedup | [§14.5](/c/system-design/14-storage-models) |
| Birthday bound | Collisions near $\sqrt{2^b}$: 7.3B random 64-bit IDs → 76% | Don't use random 64-bit keys | [§52.7](/c/system-design/52-id-generator) |
| Snowflake | 41 + 10 + 12 bits: 69.7 years, 1,024 workers, 4.1M IDs/s each | Time-ordered 8-byte IDs | [§52.6](/c/system-design/52-id-generator) |
| Failover loss | rate × lag: 2,000/s × 20 s = 40,000 orders | Semi-sync for money | [§12.2](/c/system-design/12-replication-and-partitioning) |
| Hot row | ≤ \(1/T\) transactions/s for hold time $T$ | Never lock across a network call | [§15](/c/system-design/15-transactions) |
| Queue backlog | Grows at $\lambda - \mu$, waits ≈ backlog ÷ μ | Size consumers for the delay you accept | [§25.3](/c/system-design/25-message-queue) |
| Bandwidth-delay product | 1 Gbit/s × 150 ms = 18.75 MB in flight | Window sizing across regions | [§11.3](/c/system-design/11-networking) |

## 74.2 Data and storage

| Decision | Choose the first when | Choose the second when | Number that decides | § |
|---|---|---|---|---|
| Relational vs key-value / wide-column | Invariants, joins, ad-hoc queries; writes fit one primary | Every access is by key and writes or size exceed one node | Pulse 600 writes/s = 12% of an illustrative primary → relational; chat 60,000 messages/s → partitioned store | [§14.7](/c/system-design/14-storage-models) |
| B-tree vs LSM | Read-heavy OLTP, range scans, predictable latency | Write-heavy, append-mostly, time-ordered keys | LSM write amplification ~35 at T = 10; Pulse is 10:1 reads → B-tree | [§14.6](/c/system-design/14-storage-models) |
| Row vs column store | Fetch whole records | Aggregate one field over billions of rows | Column scan reads 3,050× less for a one-field aggregate | [§14.3](/c/system-design/14-storage-models) |
| Add an index vs not | A frequent query scans or sorts; selectivity < ~3% | Low selectivity or a write-hot table | +1 B-tree write per insert: checkout 8,000 → 10,000 writes/s | [§41.5](/c/system-design/41-slow-queries-indexes) |
| Replicas vs sharding | Reads saturate; writes fit one node | Sustained writes, storage or restore time pass one node within ~a year | Pulse: 12% of write ceiling, 10 TB in 16 months → don't shard; photo metadata: 10 TB in 8.2 months → shard | [§34.1](/c/system-design/34-sharding) |
| Hash vs range partitioning | Even spread, point lookups | Range scans on a key that isn't monotonic | `range(created_at)` = 16× the mean on 16 shards | [§34.3](/c/system-design/34-sharding) |
| Shard map table vs hash ring | Exact balance, whole-shard moves (1,024 logical shards) | Clients route with no central map (cache clusters) | Both move ~\(1/(N+1)\); ring balance ≈ \(1/\sqrt{v}\) (1.27× at 100 vnodes, 16 nodes) | [§68](/c/system-design/68-sharding) |
| Blob in a row vs object storage | Small fields read with the row | Anything photo-sized | 2 MB photos through the app tier: 480 Gbit/s at peak | [§40.4](/c/system-design/40-slow-files-object-storage-cdn) |
| 3× replication vs erasure coding | Small (< ~1 MB) or hot objects | Large objects | 3× overhead vs 1.5× for 6+3 (tolerates 3 losses) | [§26.2](/c/system-design/26-object-storage) |
| Snowflake vs UUIDv7 | High-volume keys where 8 bytes matter | No control over the fleet; no lease service | UUIDv7's extra 8 bytes = 64 GB of Pulse timeline cache | [§52.12](/c/system-design/52-id-generator) |
| Normalised vs precomputed | Writes dominate or data changes often | A hot read repeats the same merge | Feed precomputed: one key lookup per read instead of ~200 | [§54](/c/system-design/54-news-feed) |

## 74.3 Caching and delivery

| Decision | Choose the first when | Choose the second when | Number that decides | § |
|---|---|---|---|---|
| Cache-aside vs write-through | Default: read-heavy, staleness ≤ TTL is fine | Data is read right after it's written and must be fresh | Write-through pays every write twice and caches cold data | [§7.5](/c/system-design/07-caching) |
| Cache vs read replicas | Skewed reads (top keys > 50% of reads) | Broad, low-reuse reads | Feed: 94% hit → 360 DB reads/s; search filters: 11% hit → replicas | [§36.3](/c/system-design/36-choosing-between-fixes) |
| Short vs long TTL | Users notice staleness (stock, prices shown) | Immutable or rarely changed data | 5 s vs 5 min: up to 10× refresh load | [§7.4](/c/system-design/07-caching) |
| LRU vs LFU | Popularity shifts (feeds, news) | Stable catalogue | Stable: LFU 59.3% vs LRU 50.8% at 1% size; after a shift LFU 57.6% vs LRU 66.8% | [§18.3](/c/system-design/18-cache) |
| Remote cache vs in-process tier | Shared working set of GBs | Top ~1,000 keys or one hot key, 1–2 s TTL | ~100 ns in-process vs 0.5 ms; near-cache took the hot shard 2.18× → 1.10× | [§50.8](/c/system-design/50-distributed-cache) |
| Push vs pull fan-out | Default when reads ≫ writes | Authors whose push burst misses freshness | Pull/push work = $r/p$ = 10; pull above $F^\ast$ = 50,000/s × 5 s = 250,000 followers | [§54.6](/c/system-design/54-news-feed) |
| CDN with vs without shield | Many PoPs, long-tail content | Few PoPs, very hot content | Origin share 34.0% → 7.7% at 50 PoPs | [§19.3](/c/system-design/19-cdn) |
| Versioned URLs vs purge | Immutable bytes: content hash, 1-year TTL | Content that can't be versioned | A viral purge: 209 origin fetches, 50 with collapsing | [§19.5](/c/system-design/19-cdn) |
| 301 vs 302 | Permanent internal moves, no stats or takedown needed | A public shortener | 302 + `s-maxage=60`: takedown ≤ 60 s; 301 saves ~900 of 3,000 redirects/s (illustrative) | [§60.8](/c/system-design/60-url-shortener) |

## 74.4 Consistency, replication and transactions

| Decision | Choose the first when | Choose the second when | Number that decides | § |
|---|---|---|---|---|
| Strong vs eventual | An invariant: stock ≥ 0, balances, uniqueness, locks | Feeds, counters, search, analytics | Strong across regions ≈ +150 ms per write; make the invariant strong, not the flow | [§8.8](/c/system-design/08-consistency) |
| Semi-sync vs async replication | Money and orders: no acknowledged write may be lost | Feeds; the cross-region DR copy | Semi-sync +1–5 ms; async loses rate × lag (40,000 orders at 20 s); sync to a remote copy p50 151 ms | [§12.2](/c/system-design/12-replication-and-partitioning) |
| $W = R = 2$ vs $W = R = 1$ ($N$ = 3) | Reads must see acknowledged writes | Latency first, staleness tolerated | $W = R = 1$: stale 2 times in 3 right after a write | [§8.3](/c/system-design/08-consistency) |
| LSN token vs pin window (read-your-writes) | Exactness, ~1% of reads to the primary | No log-position plumbing available | A 5 s pin sends 20% of feed reads (1,200/s at peak) to the primary | [§29.4](/c/system-design/29-read-replicas) |
| Optimistic vs pessimistic | Contention $\rho = \lambda T$ < ~0.1 | $\rho$ > ~0.1; near 1, split the row | A row held for $T$ serves ≤ \(1/T\) per second | [§15.5](/c/system-design/15-transactions) |
| One transaction vs saga | The invariant fits one database | Steps span services | 2PC holds locks ≥ 1 extra RTT and blocks on coordinator loss | [§15.7](/c/system-design/15-transactions) |
| Orchestration vs choreography | ≥ 3 steps with compensations (checkout) | 2–3 step reactions; side effects after the pivot | "Where is order o1?" = one row vs N logs | [§31.3](/c/system-design/31-sagas) |
| Conditional write vs distributed lock | Anything on a hot path | Coarse jobs that mustn't overlap — with fencing | No fencing: 13 lost updates per 20,000 jobs | [§21](/c/system-design/21-distributed-locks) |
| Snapshot isolation vs serializable | Single-row invariants | Invariants spanning rows (write skew) | Serializable needs retries on conflict | [§15.2](/c/system-design/15-transactions) |

## 74.5 Messaging and processing

| Decision | Choose the first when | Choose the second when | Number that decides | § |
|---|---|---|---|---|
| Synchronous write vs queue | Peak fits capacity; the user needs the result now | Peak ≫ capacity for minutes and the work can wait | Checkout 2,000 vs 1,000 orders/s: a 10-minute sale drains 10 minutes later | [§47](/c/system-design/47-write-spikes-queue) |
| Queue vs log | Task distribution, per-message retry | Replay, several consumer groups, per-key order | Checkout: a log, 12 partitions by `order_id` | [§25.1](/c/system-design/25-message-queue) |
| At-most-once vs at-least-once + idempotency | Losing one is cheaper than doubling it (metric samples) | Any side effect | Duplicates ≈ ack-loss × volume: ~2/s at 0.1% and 2,000/s | [§9.2](/c/system-design/09-delivery-semantics) |
| One partition vs many | Global order is required | Throughput | One partition = one consumer; partitions ≥ 2 × peak ÷ per-consumer rate | [§17.9](/c/system-design/17-batch-and-stream) |
| Batch vs stream | Completeness and reruns (invoices, training sets) | Freshness (fraud, trending, alerting) | Freshness: interval + runtime vs processing delay + allowed lateness | [§17.7](/c/system-design/17-batch-and-stream) |
| Pull vs push metrics | Long-lived targets (a dead one shows `up == 0`) | Short-lived jobs, across firewalls | 10M series, 667,000 samples/s company-wide | [§53.11](/c/system-design/53-metrics-pipeline) |
| WebSocket vs polling | Many mostly-idle clients needing push | Rare updates, simple infrastructure | 10M clients polling every 5 s = 2M req/s | [§49.12](/c/system-design/49-chat) |

## 74.6 Traffic, resilience and limits

| Decision | Choose the first when | Choose the second when | Number that decides | § |
|---|---|---|---|---|
| Token bucket vs sliding window counter | APIs that allow bounded bursts | "N per minute" quotas | Bucket ≤ $b + rt$; counter within a few %; fixed window up to \(2L\) | [§28.1](/c/system-design/28-rate-limiter) |
| Central vs local counters | Default: exact, one ~0.5 ms round trip | Hot keys beyond one shard | Local overshoot ≤ $\min(\lambda\Delta, (N-1)L)$ | [§57.7](/c/system-design/57-rate-limiter-service) |
| Fail open vs fail closed | Guardrails (abuse limits) | Quotas, payments, dedupe | Decide per rule; keep a local $r/N$ floor | [§57.9](/c/system-design/57-rate-limiter-service) |
| Rate limit vs queue | The excess is unwanted (abuse, over quota) | The excess is wanted but bursty | Flash-sale orders are wanted → queue; a bot at 50/s under $r$ = 1/s, $b$ = 5 gets 65 attempts a minute instead of 3,000 → limit | [§36.3](/c/system-design/36-choosing-between-fixes) |
| Retry vs circuit breaker | Independent blips | Sustained failure (seconds+) | Retry: failure $p \to p^{r+1}$ at ~$(1+p)$ load; outage: $(1+r)^d$ | [§43](/c/system-design/43-temporary-failures-retry) |
| Exponential backoff vs full jitter | Never on its own | Always | 1,468 vs 4,387 of 5,000 clients served | [§30.2](/c/system-design/30-retry) |
| Payment timeout 1 s vs 3 s | Fast failure matters more than ambiguity (idempotent reads) | Side effects, where an ambiguous outcome is costly | Provider p99 2 s: 1 s leaves 83,942 ambiguous payments per sale, 3 s leaves 2,853 | [§56.12](/c/system-design/56-payments-ledger) |
| Error-rate vs slow-call breaker | The dependency fails loudly | Latency-sensitive calls; brownouts | A 2× slower provider never trips an error-rate breaker | [§38.5](/c/system-design/38-one-service-failing-breaker) |
| L4 vs L7 balancer | Connection spreading, TLS pass-through | Per-request routing, retries, long-lived HTTP/2 | One HTTP/2 connection behind L4 pins thousands of requests to one backend | [§24.1](/c/system-design/24-load-balancer) |
| Round robin vs least-requests / P2C | Identical servers | Mixed or degraded servers | 10 new + 5 half-speed: RR puts the old ones at 100% while the fleet is 60% | [§24.2](/c/system-design/24-load-balancer) |
| Client-side vs server-side discovery | One language, latency-sensitive | Many languages; a sidecar removes the hop | +0.5 ms per remote balancer hop | [§33.1](/c/system-design/33-service-discovery) |
| DNS vs watch-based discovery | Rarely changing endpoints | Instance churn | DNS +15 s (plus caching past TTL) vs watch +0.1 s | [§33.6](/c/system-design/33-service-discovery) |
| One service vs a chain | Default | Independent scaling or ownership is worth a hop | Each 99.9% hard dependency costs ~43 min a month | [§6.9](/c/system-design/06-availability) |

## 74.7 The one-liners

- A **cache** trades staleness for load: 90% → 99% hit is 10× less database.
- A **replica** trades staleness for read capacity — never write capacity.
- A **shard** trades query flexibility for write capacity, nearly permanently.
- An **index** trades a write per insert for a seek instead of a scan.
- A **queue** trades immediacy for survival: backlog grows at $\lambda - \mu$ and drains at μ.
- A **rate limit** trades rejected requests for everyone else's capacity.
- A **breaker** trades one feature for the rest of the system.
- A **retry** trades load for success: ~\(1 + p\) when failures are independent, $(1+r)^d$ when they aren't.
- An **idempotency key** trades one unique insert for zero double charges.
- **Synchronous replication** trades a round trip per write for zero data loss.

## 74.8 Recompute the formulas

Every formula row of §74.1 in one script — change an input and say the new number aloud.

```python run
import math

# Rates and peaks (§2)
print(f"rate = N/1e5 is {86_400 / 1e5:.3f}x the exact N/86,400 ({86_400 / 1e5 - 1:.0%})")
print(f"Pulse reads: {2e8 / 1e5:,.0f} avg, {3 * 2e8 / 1e5:,.0f} peak QPS; writes {2e7 / 1e5:,.0f} avg, {3 * 2e7 / 1e5:,.0f} peak")

# Availability (§2.8, §6)
for a in (0.999, 0.9999, 0.99999):
    print(f"{a:.3%} -> {(1 - a) * 30 * 1440:5.1f} min per 30 days")
print(f"5 deps at 99.9% in series: {0.999 ** 5:.4%}")
print(f"error budget, 99.9% over 28 d: {0.001 * 28 * 1440:.1f} min; burn 14.4 empties it in "
      f"{28 / 14.4:.1f} d, {14.4 / 672:.1%} per hour")

# Queueing (§10)
for rho in (0.6, 0.8, 0.9):
    print(f"M/M/1 at rho={rho:.0%}: W = {1 / (1 - rho):.1f} x S")
print(f"Little: 2,000/s x 0.3 s = {2000 * 0.3:,.0f}; x 2 s = {2000 * 2:,.0f} in flight")
print(f"fan-out: P(any of 20 slow at p=1%) = {1 - 0.99 ** 20:.1%}")

# Caching (§7)
for h in (0.90, 0.94, 0.99):
    print(f"hit {h:.0%}: DB reads at 6,000/s peak = {(1 - h) * 6000:,.0f}/s")

# Retries (§30)
print(f"retry stack r=2, d=4: {3 ** 4}x -> {2000 * 3 ** 4:,} calls/s; one layer + 10% budget: {2000 * 1.1:,.0f}/s")

# Partitioning (§64, §13)
print(f"add 9th node: ring moves {1 / 9:.1%}, mod N moves {8 / 9:.1%}")
print(f"Amdahl ceiling at 5% serial: {1 / 0.05:.0f}x; USL peak N* (0.04, 0.0008) = {math.sqrt(0.96 / 0.0008):.1f}")

# Storage (§14, §23, §52, §60)
print(f"B-tree depth, fanout 179, 7.3e9 rows: {math.ceil(math.log(7.3e9, 179))} levels")
k = round(10 * math.log(2))
print(f"Bloom 10 bits/key, k={k}: false positives {(1 - math.exp(-k / 10)) ** k:.2%}")
n = 7.3e9
print(f"random 64-bit IDs, {n:.1e} IDs: P(collision) = {1 - math.exp(-n * n / (2 * 2 ** 64)):.0%}")
print(f"Snowflake: 2^41 ms = {2 ** 41 / 1000 / 86_400 / 365.25:.1f} years; 2^12/ms = {2 ** 12 * 1000 / 1e6:.1f}M IDs/s per worker")
print(f"base62, 7 chars: {62 ** 7:.2e} codes")

# Network and replication (§11, §12, §15)
print(f"BDP 1 Gbit/s x 150 ms = {1e9 * 0.15 / 8 / 1e6:.2f} MB")
print(f"async failover at 2,000 writes/s, 20 s lag: {2000 * 20:,} writes lost")
print(f"hot row held 1 ms: <= {1 / 0.001:,.0f} tx/s; held across a 300 ms call: <= {1 / 0.3:.1f} tx/s")
```

```output
rate = N/1e5 is 0.864x the exact N/86,400 (-14%)
Pulse reads: 2,000 avg, 6,000 peak QPS; writes 200 avg, 600 peak
99.900% ->  43.2 min per 30 days
99.990% ->   4.3 min per 30 days
99.999% ->   0.4 min per 30 days
5 deps at 99.9% in series: 99.5010%
error budget, 99.9% over 28 d: 40.3 min; burn 14.4 empties it in 1.9 d, 2.1% per hour
M/M/1 at rho=60%: W = 2.5 x S
M/M/1 at rho=80%: W = 5.0 x S
M/M/1 at rho=90%: W = 10.0 x S
Little: 2,000/s x 0.3 s = 600; x 2 s = 4,000 in flight
fan-out: P(any of 20 slow at p=1%) = 18.2%
hit 90%: DB reads at 6,000/s peak = 600/s
hit 94%: DB reads at 6,000/s peak = 360/s
hit 99%: DB reads at 6,000/s peak = 60/s
retry stack r=2, d=4: 81x -> 162,000 calls/s; one layer + 10% budget: 2,200/s
add 9th node: ring moves 11.1%, mod N moves 88.9%
Amdahl ceiling at 5% serial: 20x; USL peak N* (0.04, 0.0008) = 34.6
B-tree depth, fanout 179, 7.3e9 rows: 5 levels
Bloom 10 bits/key, k=7: false positives 0.82%
random 64-bit IDs, 7.3e+09 IDs: P(collision) = 76%
Snowflake: 2^41 ms = 69.7 years; 2^12/ms = 4.1M IDs/s per worker
base62, 7 chars: 3.52e+12 codes
BDP 1 Gbit/s x 150 ms = 18.75 MB
async failover at 2,000 writes/s, 20 s lag: 40,000 writes lost
hot row held 1 ms: <= 1,000 tx/s; held across a 300 ms call: <= 3.3 tx/s
```

The last line is why [§59](/c/system-design/59-ticket-booking) takes payment outside the seat hold: a lock held across a 300 ms provider call caps a row at 3.3 transactions a second.

## 74.9 Check yourself

:::qa[Pulse grows 10×. Which rows of this page change their answer?]
Writes become 6,000/s peak and storage 73 TB/yr (95 TB with indexes) — past one primary, so "replicas vs sharding" flips to sharding by author ([§2.10](/c/system-design/02-estimation)). Reads (60,000/s) stay a cache problem: at 94% hit the database sees 3,600/s. Push fan-out stays the default, but 1.2M inserts/s at peak needs its own capacity plan.
:::

:::qa[An interviewer asks "SQL or NoSQL?" for checkout's orders. Answer with a threshold.]
SQL. The invariants (stock ≥ 0, one charge per idempotency key) want constraints and conditional writes in one database ([§15](/c/system-design/15-transactions)). The flash sale's 8,000 writes/s lasts ten minutes, so the answer to the spike is a queue at ~1,000 orders/s, not a partitioned store ([§47](/c/system-design/47-write-spikes-queue)).
:::

:::qa[Token bucket with r = 100/s and b = 20: what's the most a client gets in one second, and what does a fixed window allow?]
$b + rt$ = 20 + 100 = 120 (119 measured in [§28.1](/c/system-design/28-rate-limiter)). A fixed 100/s window can admit 200 within 20 ms across a boundary. Choose $b$ deliberately — it is how bursty the protected service's load may be.
:::

Back to the start: [§1 A framework for answering](/c/system-design/01-answering-framework) — the six steps that put these numbers to work.
