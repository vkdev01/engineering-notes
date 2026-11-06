---
section: "73"
title: "Question bank"
kicker: "Interview"
abstract: "Drills with model answers for every part of the course — estimation, fundamentals, building blocks, patterns, case studies and implementations — each answer carrying the number that makes it convincing and a link to the section that derives it."
time: "12 min"
order: 73
outcomes:
  - "Answer the standard estimation drills aloud in under a minute each"
  - "Give a two-sentence model answer with a number for any fundamental or building block"
  - "Name what each classic prompt is really testing and its decisive number"
  - "Find the section that derives an answer when yours is shaky"
---

A question bank is only useful if you answer before reading the answer. Cover each model answer, say yours aloud in two or three sentences, then compare: a strong answer has a **mechanism, a number and a cost**. Numbers come from the running examples — Pulse (10M DAU), the photo service (20M DAU) and checkout (2,000 orders/s flash sale) — and each answer links to where it is derived.

:::key[First principle]
A model answer is short because it is specific: one mechanism, the one number that decides it, and what it costs. If your answer is longer and has no number, it is a description, not an answer.
:::

## 73.1 Estimation drills

Do each in your head first; the script is the answer key ([§2](/c/system-design/02-estimation) for the method).

```python run
import math

D = 1e5                                                        # seconds/day shortcut
print("1. 100M DAU x 50 req:", f"{100e6 * 50 / D:,.0f} QPS avg, {3 * 100e6 * 50 / D:,.0f} peak")
hours = 500 * 60 * 24                                          # 500 h uploaded per minute
print("2. video:", f"{hours:,} h/day x 15 GB = {hours * 15 / 1e6:.1f} PB/day")
print("3. 99.95% over 30 days:", f"{0.0005 * 30 * 1440:.1f} min of downtime")
print("4. Pulse timelines:", f"{10e6 * 800 * 16 / 1e9:.0f} GB raw")
print("5. checkout in flight:", f"p50 {2000 * 0.3:,.0f}, p99 {2000 * 2:,.0f}")
print("6. feed servers:", math.ceil(6000 / (1000 * 0.6)) + 2)
pb = 20e9 * 86_400 * 30 / 1e15
print("7. photo egress:", f"{pb:.0f} PB/month x USD 0.02/GB = USD {pb * 1e6 * 0.02 / 1e6:.2f}M")
print("8. 3 layers x 2 retries:", (1 + 2) ** 3, "attempts at the bottom")
print("9. 20-way fan-out, 1% slow each:", f"{1 - 0.99 ** 20:.1%} of pages")
print("10. idempotency keys/day:", f"{(50 * 86_400 + 2000 * 600) / 1e6:.2f}M x 500 B"
      f" = {(50 * 86_400 + 2000 * 600) * 500 / 1e9:.1f} GB per day of TTL")
print("11. Snowflake:", f"41 bits of ms = {2 ** 41 / 1000 / 86_400 / 365.25:.1f} years,"
      f" 12-bit sequence = {2 ** 12 * 1000 / 1e6:.1f}M IDs/s per worker")
print("12. base62^7 =", f"{62 ** 7:.2e} codes")
print("13. flash-sale backlog:", f"{(2000 - 1000) * 600:,} orders, oldest waits"
      f" {(2000 - 1000) * 600 / 1000 / 60:.0f} min")
print("14. B-tree depth:", math.ceil(math.log(7.3e9, 179)), "levels")
print("15. checkout path 99.95 x 99.9 x 99.9 x 99.95:",
      f"{0.9995 * 0.999 * 0.999 * 0.9995:.4%} -> {(1 - 0.9995 * 0.999 * 0.999 * 0.9995) * 43_200:.0f} min/30 days")
```

```output
1. 100M DAU x 50 req: 50,000 QPS avg, 150,000 peak
2. video: 720,000 h/day x 15 GB = 10.8 PB/day
3. 99.95% over 30 days: 21.6 min of downtime
4. Pulse timelines: 128 GB raw
5. checkout in flight: p50 600, p99 4,000
6. feed servers: 12
7. photo egress: 52 PB/month x USD 0.02/GB = USD 1.04M
8. 3 layers x 2 retries: 27 attempts at the bottom
9. 20-way fan-out, 1% slow each: 18.2% of pages
10. idempotency keys/day: 5.52M x 500 B = 2.8 GB per day of TTL
11. Snowflake: 41 bits of ms = 69.7 years, 12-bit sequence = 4.1M IDs/s per worker
12. base62^7 = 3.52e+12 codes
13. flash-sale backlog: 600,000 orders, oldest waits 10 min
14. B-tree depth: 5 levels
15. checkout path 99.95 x 99.9 x 99.9 x 99.95: 99.7003% -> 129 min/30 days
```

| # | Drill | What to say after the number |
| ---: | --- | --- |
| 1 | 100M DAU, 50 requests each — peak QPS? | 150,000 peak: a fleet behind a balancer, and cache before any database sees it |
| 2 | 500 h of 4K video/min at 15 GB/h (illustrative) — storage/day? | 10.8 PB/day before transcoded renditions: object storage, tiering ([§61](/c/system-design/61-video-platform)) |
| 3 | 99.95% — downtime per 30 days? | 21.6 min: one bad 15-minute deploy spends 70% of it ([§6](/c/system-design/06-availability)) |
| 4 | Pulse timelines, 800 × 16 B each — RAM? | 128 GB raw, 174 GB as lists, 769 GB as sorted sets ([§18](/c/system-design/18-cache)) |
| 5 | Checkout calls in flight at p50 vs p99? | 600 vs 4,000 by Little's law: size pools and timeouts for the tail ([§10](/c/system-design/10-latency-and-throughput)) |
| 6 | Feed servers for 6,000 QPS at 1,000/server (illustrative)? | 10 at 60% + 2 spare = 12 ([§2.5](/c/system-design/02-estimation)) |
| 7 | Photo egress bill? | ~USD 1.0M/month at an illustrative USD 0.02/GB: the CDN pays for itself ([§19](/c/system-design/19-cdn)) |
| 13 | Flash sale at 2,000/s for 10 min, consumers at 1,000/s? | 600,000 backlog, 10 min worst wait; drained ~10.5 min after the sale ([§25](/c/system-design/25-message-queue)) |
| 15 | Four synchronous dependencies, best SLO? | 99.70%, ~130 min/30 days: promising 99.9% needs an async step ([§6](/c/system-design/06-availability)) |

## 73.2 Fundamentals

:::qa[Why do servers run at ~60% utilisation rather than 90%?]
Queueing: in M/M/1 the mean response is \(S/(1-\rho)\) — 2.5 S at 60%, 10 S at 90%, and p99 at 90% is 46 S. Above ~80% small traffic changes cause large latency changes ([§10](/c/system-design/10-latency-and-throughput)).
:::

:::qa[Your page fans out to 20 backends whose p99 is 50 ms. What is the page's tail problem?]
\(1 - 0.99^{20}\) = 18.2% of pages wait on at least one backend's p99, so the backend's tail becomes the page's p80. Batch into one multi-get first, then hedge ([§10](/c/system-design/10-latency-and-throughput)).
:::

:::qa[What does raising the cache hit rate from 90% to 99% do to Pulse's database?]
DB load is \((1-h) \times\) QPS: 600 → 60 reads/s at the 6,000 peak — 10× less, from nine points of hit rate. Pay for it in memory and staleness ([§7](/c/system-design/07-caching)).
:::

:::qa[With N = 3 replicas, which R and W guarantee a read sees the latest acknowledged write?]
Any with R + W > N, e.g. W = R = 2 — the read and write sets must overlap in one replica. Necessary, not sufficient: sloppy quorums and concurrent writes still need versioning ([§8](/c/system-design/08-consistency)).
:::

:::qa[Checkout's async replica applies 1,500 entries/s while the flash sale writes 2,000/s for 60 s. How stale can it get, and what does a failover lose?]
Backlog grows 500/s → 30,000 entries → 20 s of lag; a failover at the peak loses up to 2,000 × 20 = 40,000 acknowledged orders. So the ledger uses semi-sync to a same-DC follower ([§12](/c/system-design/12-replication-and-partitioning)).
:::

:::qa[A load test shows Pulse's feed tier peaks at 9,537 QPS around 39 nodes. Someone proposes 64 nodes. Answer?]
Under the Universal Scalability Law, 64 nodes serve 8,935 QPS — less than 32. Coherency cost (κ) bends the curve down; remove the shared serial work instead of adding nodes ([§13](/c/system-design/13-scalability)).
:::

:::qa[How many page reads does a lookup in a 7.3B-row B-tree index take?]
\(\lceil \log_{179} 7.3 \times 10^9 \rceil\) = 5 with fanout 179; the 1.9 GB of internal pages stay in RAM, so one SSD read (~100 µs) for the leaf ([§14](/c/system-design/14-storage-models), [§23](/c/system-design/23-indexes)).
:::

:::qa[Why is "exactly-once delivery" a misleading phrase, and what do you build instead?]
A sender can't tell a lost message from a lost ack, so it either resends (duplicates) or doesn't (losses). Exactly-once *effect* = at-least-once delivery + an idempotent consumer with a dedupe window: ~0.55 GB for checkout at 24 h and ~100 B/entry ([§9](/c/system-design/09-delivery-semantics)).
:::

:::qa[Why does a 2 MB photo take 1.2 s for a user 150 ms away, and what fixes it?]
TCP slow start: a fresh connection needs 8 round trips for 2 MB, 8 × 150 ms = 1,200 ms. Reuse warm connections and move the bytes closer — a CDN edge 10–40 ms away ([§11](/c/system-design/11-networking), [§19](/c/system-design/19-cdn)).
:::

:::qa[Why not two-phase commit across inventory, payment provider and ledger?]
The provider will never join your transaction, and 2PC holds locks across a network round trip plus fsyncs, with availability \(A^{n+1}\). Use a saga with compensations instead ([§15](/c/system-design/15-transactions), [§31](/c/system-design/31-sagas)).
:::

## 73.3 Building blocks

:::qa[Pulse's timelines as Redis lists or sorted sets?]
Lists: 174 GB vs 769 GB for the same 128 GB of data (4.4×). `LPUSH` + `LTRIM` covers newest-first; pay for a sorted set only when you need score ranges or rank ([§18](/c/system-design/18-cache)).
:::

:::qa[What does a CDN do to the photo service's egress bill?]
Origin egress scales with the miss ratio: at 95% hit, an illustrative USD 311k/month vs 1,037k with no CDN. An origin shield keeps the total hit ratio ~92% even across 50 PoPs ([§19](/c/system-design/19-cdn)).
:::

:::qa[The payment provider hangs. Why does the cart, which never calls it, go down?]
2,000 calls/s × 2.5 s timeout wants 5,000 workers; a shared pool of 1,500 fills in 0.33 s, starving everything. A circuit breaker (2 s window) plus a bulkhead for payment calls keeps the cart at 100% ([§20](/c/system-design/20-circuit-breaker), [§38](/c/system-design/38-one-service-failing-breaker)).
:::

:::qa[Why is a TTL lease not enough for mutual exclusion?]
A paused holder wakes up still believing it holds the lock; in the simulation 13 of 20,000 settlement jobs overwrote a newer balance. A fencing token checked by storage on every access makes it zero ([§21](/c/system-design/21-distributed-locks)).
:::

:::qa[How long should checkout keep idempotency keys, and what does it cost?]
24–72 h: 5.52M keys/day × ~500 B is 2.8 GB for 24 h, 8.3 GB for 72 h, leaving ~95 vs ~12 late retries a day uncovered. Back it with a unique constraint on `cart_id` ([§22](/c/system-design/22-idempotency)).
:::

:::qa[Round robin over a fleet where half the servers are twice as fast — what happens?]
6,000 req/s over 15 servers is 400 each: 50% on a new server, 100% on an old one. Weighted RR (2:1) or least-connections equalises utilisation at 60% ([§24](/c/system-design/24-load-balancer)).
:::

:::qa[Size the flash-sale consumers so no order waits more than 2 minutes.]
\(\mu \ge \lambda T/(T + A)\) = 2,000 × 600 / 720 ≈ 1,667/s: backlog ~200,000, oldest waits ~120 s. Consumers must be idempotent: delivery is at-least-once ([§25](/c/system-design/25-message-queue)).
:::

:::qa[Why is a fixed-window limit of 100/s weaker than it looks?]
It admits 200 requests in 20 ms across a window boundary — 2L. A token bucket bounds the burst explicitly: checkout's per-account 1/s with burst 5 gives a 50/s bot 65 attempts in its first minute instead of 3,000 ([§28](/c/system-design/28-rate-limiter)).
:::

:::qa[Four layers each retry twice during a provider outage. What does the provider see?]
2,000 × 3⁴ = 162,000 calls/s, 65× its 2,500/s quota. Retry at one layer (6,000/s) with a 10% budget (2,200/s), and jitter: at the flash-sale opening full jitter served 4,387 of 5,000 vs 1,468 without ([§30](/c/system-design/30-retry)).
:::

:::qa[How often does checkout's saga compensate, and how long must a stock hold live?]
3.6% of flash-sale orders — 43,001 in 10 minutes, ~72/s — so the release path is hot, not an edge case. A 5 s hold is outlived by 0.0031% of sagas; size it from timeouts × retries, not p99 ([§31](/c/system-design/31-sagas)).
:::

:::qa[Should Pulse shard its posts database?]
No: 600 peak writes/s and 9.5 TB/year with indexes fit one primary; tier posts older than a year instead. Photo metadata does need sharding within a year — use 1,024 logical shards mapped to few nodes ([§34](/c/system-design/34-sharding)).
:::

## 73.4 Patterns

:::qa[A 100-second flash sale, 1 s client timeout, no idempotency key. How bad?]
~17,700 double charges from timeouts and retries. An idempotency key claimed with an insert before the charge, and passed to the provider, makes it zero ([§37](/c/system-design/37-duplicate-requests-idempotency)).
:::

:::qa[Checkout's database commits 1,250 orders/s; the sale offers 2,000/s. Synchronous or queued?]
Synchronous FIFO completed 63,700 orders for waiting shoppers out of 1.3M and committed 2.5M for nobody. A queue at 1,000/s completes every order, worst wait 10 minutes ([§47](/c/system-design/47-write-spikes-queue)).
:::

:::qa[Pulse feed p99 regressed and the database is busy. Add replicas?]
Measure first: rows examined vs returned and the plan. In the worked triage it was a missing composite index — replicas would have multiplied the same scan ([§36](/c/system-design/36-choosing-between-fixes), [§41](/c/system-design/41-slow-queries-indexes)).
:::

:::qa[How do 200 bot accounts hurt checkout without per-account limits?]
They take 80% of the payment quota in the simulation, starving real shoppers. A per-identity token bucket in front of the expensive call, plus a global limit per dependency ([§44](/c/system-design/44-too-many-requests-rate-limit)).
:::

:::qa[What do burn-rate alerts and traces buy during an incident?]
On Pulse's 2% error incident: from 125 minutes and 6.2% of the error budget to 53 minutes and 2.6% ([§35](/c/system-design/35-cannot-see-what-broke-telemetry)).
:::

## 73.5 Case studies — the decisive number

| Prompt | What it really tests | The number to say |
| --- | --- | --- |
| [News feed](/c/system-design/54-news-feed) | Fan-out strategy | 120,000 timeline inserts/s at peak; pull path for ~30 accounts |
| [URL shortener](/c/system-design/60-url-shortener) | Key space, read caching | 7 base62 chars: 3.52 × 10¹² codes, a guess hits 1 in 1,930 after 5 years |
| [Chat](/c/system-design/49-chat) | Ordering, connection state | 60,000 msgs/s, 10M sockets; per-conversation sequence numbers |
| [Ticket booking](/c/system-design/59-ticket-booking) | Concurrency without overselling | Read-then-write oversold 985 seats; conditional update: 0 |
| [Payments ledger](/c/system-design/56-payments-ledger) | Idempotency, double entry | 5.5M payments/day, 1.2M in a 10-minute sale |
| [Rate limiter](/c/system-design/57-rate-limiter-service) | Shared counters, fail open/closed | ~80,000 decisions/s, designed for 240,000 |
| [ID generator](/c/system-design/52-id-generator) | Coordination avoidance | 41/10/12 bits: 69.7 years, 4.1M IDs/s per worker |
| [Video platform](/c/system-design/61-video-platform) | Egress economics | 11 PB/day watched ≈ 1 Tbit/s average |
| [Web crawler](/c/system-design/62-web-crawler) | Politeness, dedupe | 11,574 pages/s; Bloom filter 0.9 GB per node |
| [Distributed cache](/c/system-design/50-distributed-cache) | Sharding by ops and memory | 1M ops/s → 20 primaries; ~256 vnodes per node |
| [Leaderboard](/c/system-design/72-mock-walkthrough) | Order statistics, rank at scale | Pulse: 3,300 ops/s, 2.4 GB — one node |

:::qa[In the news feed, why is the hybrid push/pull not about saving work?]
Total work is similar; the hybrid removes the cliff. A 1M-follower post at 50,000 inserts/s takes 20 s to fan out, missing the 5 s freshness target, so the ~30 such accounts are merged at read time ([§54](/c/system-design/54-news-feed)).
:::

:::qa[Why do 64 random bits make a poor ID for Pulse?]
Birthday bound: a year of Pulse posts (7.3 billion) collides with 76% probability, and even one day carries a 1-in-100,000 risk. Snowflake's time/worker/sequence layout is unique by construction and time-sortable ([§52](/c/system-design/52-id-generator)).
:::

:::qa[How does the ticket-booking design never sell a seat twice?]
A conditional `UPDATE … WHERE status = 'available'` claims the seat atomically; read-then-write oversold 985 seats when payment sat inside the window. Holds expire on a TTL chosen from checkout times, behind a waiting room sized by inventory ([§59](/c/system-design/59-ticket-booking)).
:::

## 73.6 Implementations

:::qa[What does the circuit breaker in §63 buy when the provider hangs for 40 s?]
Mean latency 2,500 ms → 178 ms with a 2 s window, and 14× fewer calls into the dead provider; the first ~2.5 s still wait the full timeout ([§63](/c/system-design/63-circuit-breaker)).
:::

:::qa[Adding a 9th node to 8: consistent hashing vs hash mod N?]
11% of keys move on the ring vs 89% with mod N; 100 virtual nodes per node keep the hottest node ~14% over the mean ([§64](/c/system-design/64-consistent-hashing)).
:::

:::qa[Why is insert-first the only safe idempotency pattern?]
Check-then-act lets concurrent copies all see "not found" and all charge; one INSERT under a unique index lets exactly one win. The test with 16 concurrent copies charges once ([§65](/c/system-design/65-idempotency)).
:::

:::qa[How far is LRU from optimal on a Zipf trace?]
At 1% of the catalogue, 50.8% hit vs Belady's offline 66.6%; LFU gets 59.3% while popularity is stable. Each point is 60 reads/s at Pulse's peak ([§66](/c/system-design/66-lru-cache)).
:::

:::qa[What does a 10% retry budget cost and save?]
Invisible below ~10% failures; at higher failure rates it caps load at 1.10× instead of up to 4×, deliberately giving up rescues to protect the dependency ([§67](/c/system-design/67-retry)).
:::

:::qa[A default shard table puts the photo service's hottest owner on one node. How hot, and the fix?]
That node runs 2.18× the mean. Load-aware placement fixes nodes but can't split a hot logical shard; caching the head (top 1,000 owners draw 52% of reads) flattens it ([§68](/c/system-design/68-sharding)).
:::

:::qa[Why store a token bucket as one timestamp (GCRA)?]
Same decisions — 20,000 of 20,000 agree in the test — with half the state and a natural expiry, so the distributed version is one atomic script and one key ([§69](/c/system-design/69-token-bucket)).
:::

Next: [§74 Trade-off cheatsheet](/c/system-design/74-trade-off-cheatsheet) — the decisions above as dense tables.
