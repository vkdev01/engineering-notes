---
section: "71"
title: "Glossary"
kicker: "Interview"
abstract: "Every term the course uses, alphabetically, each in one or two precise lines with the formula or number that pins it down and a link to the section that derives it."
time: "12 min"
order: 71
outcomes:
  - "Define each term precisely enough to use it in a design argument, not just name it"
  - "Attach the defining formula or number to a term (Little's law, quorum overlap, retry amplification, birthday bound)"
  - "Tell apart terms that are used loosely: latency vs throughput, at-least-once vs effectively-once, the three meanings of partition"
  - "Jump from any term to the section that derives it"
---

An interviewer asks "what consistency does that give you?" and the answer "eventual, I think" ends the thread. The same question answered with "read-your-writes for the author via an LSN token, eventual for everyone else, lag p99 under 2 s" starts a good one. This glossary gives each term the definition and the number that make it usable; the link goes to the derivation.

:::key[First principle]
A term is only useful in a design argument when it carries its **condition** (when it holds) and its **price** (what it costs). Learn the formula or number next to each one; that's what lets you defend the choice.
:::

Numbers come from the running examples — Pulse, the photo service and checkout ([§2](/c/system-design/02-estimation)); hardware and price figures are illustrative, as in the sections they come from.

## 71.1 A–B

| Term | Definition | § |
|---|---|---|
| **ABR** (adaptive bitrate) | The player picks each video segment's bitrate from its buffer and measured throughput; in the simulation fixed 1080p rebuffered 28.7% of the time, ABR 0.1%. | [§61](/c/system-design/61-video-platform) |
| **ACID** | Atomicity, consistency, isolation, durability. "Consistency" is only the constraints you declare; durability means the log is fsync'd before the acknowledgement. | [§15](/c/system-design/15-transactions) |
| **Allowed lateness** | How long a stream window keeps accepting late events before its result is final; trades freshness for completeness. | [§17](/c/system-design/17-batch-and-stream) |
| **Amdahl's law** | With serial fraction $\sigma$, speedup on $N$ nodes is \(1/(\sigma + (1-\sigma)/N)\), capped at \(1/\sigma\): 5% serial work → at most 20×. | [§13](/c/system-design/13-scalability) |
| **At-least-once** | Resend until acknowledged: nothing lost, some duplicates (≈ ack-loss rate × volume: ~2/s at 0.1% and 2,000/s). Requires idempotent consumers. | [§9](/c/system-design/09-delivery-semantics) |
| **At-most-once** | Never resend: no duplicates, and a lost message stays lost. | [§9](/c/system-design/09-delivery-semantics) |
| **Availability** | Fraction of time (or requests) served correctly, $A = \text{MTBF}/(\text{MTBF}+\text{MTTR})$. Series paths multiply $A$; parallel replicas multiply \(1 - A\). | [§6](/c/system-design/06-availability) |
| **Backfill** | Recomputing history with new logic — from stored files, not by replaying the stream (30 days of Pulse impressions: 6.7 h instead of a week). | [§17](/c/system-design/17-batch-and-stream) |
| **Backpressure** | Slowing or rejecting producers when consumers fall behind, instead of letting a queue grow without bound. Alert on the oldest message's age. | [§9.7](/c/system-design/09-delivery-semantics) |
| **Bandwidth-delay product** | Bytes in flight needed to fill a link: rate × RTT. 1 Gbit/s × 150 ms = 18.75 MB; a 64 KB window uses 0.35% of that link. | [§11](/c/system-design/11-networking) |
| **BASE** | Basically available, soft state, eventually consistent — the availability-first trade used outside a small ACID core. | [§15](/c/system-design/15-transactions) |
| **Belady's algorithm** (OPT) | Evict the key whose next use is furthest away. Needs the future, so it's the offline bound: 66.6% hit vs LRU's 50.8% at 1% capacity. | [§66](/c/system-design/66-lru-cache) |
| **Birthday bound** | $n$ random $b$-bit IDs collide with probability ≈ \(1 - e^{-n^2/2^{b+1}}\), so collisions start near $\sqrt{2^b}$: 7.3B random 64-bit IDs → 76%. | [§52](/c/system-design/52-id-generator) |
| **Bloom filter** | A bit array and $k$ hashes answering "definitely absent" or "maybe present"; false positives ≈ $(1-e^{-k/b})^k$ at $b$ bits per key — 0.82% at 10 bits. | [§14.5](/c/system-design/14-storage-models) |
| **BM25** | Search ranking: inverse document frequency × a term-frequency score that saturates, normalised by document length ($k_1$ = 1.2, $b$ = 0.75). | [§32](/c/system-design/32-search-index) |
| **B-tree** | Sorted pages with fanout $f$; a lookup reads $\lceil \log_f N \rceil$ pages — 5 levels for 7.3B rows at $f$ = 179, one SSD read once the ~1.9 GB of internal pages are cached. | [§23](/c/system-design/23-indexes) |
| **Bulkhead** | A cap on concurrent calls per dependency (~1.2–2× its healthy in-flight count) so one slow dependency can't hold every worker. | [§20](/c/system-design/20-circuit-breaker) |
| **Burn rate** | Error-budget spend relative to plan: $b$ = 14.4 empties a 28-day budget in 1.9 days (2.1% per hour). Page when a short and a long window both burn fast. | [§6.7](/c/system-design/06-availability) |

## 71.2 C

| Term | Definition | § |
|---|---|---|
| **Cache-aside** | Read the cache; on a miss read the database and fill; on a write delete the key. The default — stale at most until the TTL if a delete is lost. | [§7.5](/c/system-design/07-caching) |
| **Cache stampede** (thundering herd) | Many requests miss one key together and all hit the origin. Fix with single-flight, request collapsing (209 → 50 origin fetches after a purge) and jittered TTLs. | [§7.6](/c/system-design/07-caching) |
| **CAP theorem** | During a network partition a replicated store must refuse some requests (keep C) or answer with possibly stale data (keep A). | [§8.5](/c/system-design/08-consistency) |
| **Cardinality** | Number of distinct values. For metrics, series = product of label cardinalities — one `user_id` label made 180M series. | [§53](/c/system-design/53-metrics-pipeline) |
| **Causal consistency** | Causally related writes appear in order to everyone (a reply after its comment); concurrent writes in any order. | [§8](/c/system-design/08-consistency) |
| **CDC** (change data capture) | Tailing the database's log to publish row changes as events — how caches and search indexes follow the source without dual writes. | [§17.6](/c/system-design/17-batch-and-stream) |
| **CDC** (content-defined chunking) | Chunk boundaries set by a rolling hash of the bytes, so an insert changes one chunk: ~3% re-uploaded vs about half the file with fixed-size chunks. | [§51](/c/system-design/51-file-sync) |
| **CDN** | Caches spread over points of presence. Latency follows the *edge* hit ratio; origin load and egress follow the *total* hit ratio. | [§19](/c/system-design/19-cdn) |
| **Circuit breaker** | Opens after ≥ $n_{\min}$ calls (20) with a failure share ≥ θ (50%); fails fast for a jittered cool-down; half-open lets $k$ probes decide. | [§20](/c/system-design/20-circuit-breaker) |
| **Column store** | Each column stored contiguously; a single-field aggregate reads orders of magnitude less (3,050× in the example). The OLAP layout. | [§14.3](/c/system-design/14-storage-models) |
| **Compaction** | The LSM background merge of sorted runs into larger levels — the source of write amplification (~35 at size ratio 10, rule of thumb) and of write stalls. | [§14.5](/c/system-design/14-storage-models) |
| **Compensation** | A new action that semantically undoes a committed saga step: release stock, void an authorisation, refund. | [§31](/c/system-design/31-sagas) |
| **Compulsory miss** | The first-ever request for a key; if 20% of requests are first-ever, no cache size gets past 80% hit. | [§7](/c/system-design/07-caching) |
| **Conditional write** | A write that applies only if a predicate still holds (`UPDATE … WHERE status = 'available'`); the database settles the race atomically. | [§15](/c/system-design/15-transactions) |
| **Consistent hashing** | Nodes and keys on one ring; a key belongs to the next node clockwise, so adding a node moves ~\(1/(N+1)\) of keys (11% at 8 → 9, vs 89% for mod N). | [§64](/c/system-design/64-consistent-hashing) |
| **Consumer group / offset** | In a log, each group tracks its own read position (offset) per partition; at most one consumer per partition per group. | [§25](/c/system-design/25-message-queue) |
| **Covering index** | An index holding every column a query needs, so the seek isn't followed by a fetch of each table row. | [§23](/c/system-design/23-indexes) |
| **CQRS** | Separate write model and read projections built from it; flexible reads, twice the schemas. | [§14.7](/c/system-design/14-storage-models) |

## 71.3 D–E

| Term | Definition | § |
|---|---|---|
| **Dead-letter queue** | Where a message goes after 3–5 failed attempts, so one poison message doesn't block its partition. | [§25.5](/c/system-design/25-message-queue) |
| **Deadline** | The caller's total time budget, propagated downstream (checkout: 8 s); retries stop when it's spent. | [§30.3](/c/system-design/30-retry) |
| **Debounce** | The client waits for a pause in typing before sending; 150 ms gives 6.6 suggestion requests per search. | [§48](/c/system-design/48-autocomplete) |
| **Dedupe window** | How long a consumer remembers IDs it has processed; ≥ the longest retry or replay window, sized rate × TTL × ~100 B. | [§9.5](/c/system-design/09-delivery-semantics) |
| **Denormalisation** | Storing data redundantly in the shape reads need: cheaper reads, more write paths to keep consistent. | [§14.7](/c/system-design/14-storage-models) |
| **DNS TTL** | How long resolvers cache a record — the floor on DNS-based failover (300 s means minutes). | [§11.7](/c/system-design/11-networking) |
| **Double-entry** | Every posting's entries sum to zero, so all balances sum to zero; corrections are reversal postings, never updates. | [§56](/c/system-design/56-payments-ledger) |
| **Effectively-once** | At-least-once delivery plus an idempotent effect — what "exactly-once" means in practice. | [§9.4](/c/system-design/09-delivery-semantics) |
| **Egress** | Bytes leaving a provider's network, billed per GB: the photo service's 20 GB/s is ~USD 1.0M a month at an illustrative USD 0.02/GB. | [§2.4](/c/system-design/02-estimation) |
| **Erasure coding** | $k$ data + $m$ parity fragments, any $k$ rebuild the object: overhead $(k+m)/k$, survives $m$ losses — 6+3 costs 1.5× and tolerates 3. | [§26.2](/c/system-design/26-object-storage) |
| **Error budget** | $(1 - \text{SLO})$ × window: 99.9% over 28 days is 40.3 minutes, or 4.84M bad requests at Pulse's traffic. | [§6.7](/c/system-design/06-availability) |
| **Event sourcing** | Events are the source of truth and current state is derived from them: a full audit trail, paid for in snapshots and event-schema evolution. | [§14.7](/c/system-design/14-storage-models) |
| **Eventual consistency** | Replicas converge if writes stop; any read may be stale by the replication lag. | [§8](/c/system-design/08-consistency) |
| **Exactly-once** | Not achievable as *delivery* over an unreliable network — the sender can't tell a lost message from a lost ack. Built as effectively-once. | [§9](/c/system-design/09-delivery-semantics) |

## 71.4 F–G

| Term | Definition | § |
|---|---|---|
| **Fail open / fail closed** | What a limiter, lock or dedupe store does when its backing store is down: admit (guardrails) or reject (quotas, payments). Decide per rule, in advance. | [§28.4](/c/system-design/28-rate-limiter) |
| **Failover** | Promoting a replica when the primary dies; writes lost ≈ write rate × lag at failure (600/s × 0.46 s ≈ 280 on Pulse). Fence the old primary first. | [§29.5](/c/system-design/29-read-replicas) |
| **Fan-out (request)** | One request waits on $N$ parallel calls: $P(\text{slow}) = 1 - (1-p)^N$ — 18% at $N$ = 20 and $p$ = 1%. | [§10.5](/c/system-design/10-latency-and-throughput) |
| **Fan-out on write / on read** | Push each post into every follower's timeline, or merge at read time. Pull is $r/p$ = 10× more work on Pulse; pull only accounts above $F^\ast$ = 250,000 followers (the celebrity problem). | [§54](/c/system-design/54-news-feed) |
| **Fencing token** | A number that increases with every lock grant; storage rejects any write carrying a token older than one it has seen. | [§21](/c/system-design/21-distributed-locks) |
| **Fixed window** | A counter per calendar window; admits up to \(2L\) across a boundary (200 in 20 ms on a 100/s limit). | [§28.1](/c/system-design/28-rate-limiter) |
| **Frontier** | A crawler's scheduler: priority queues in front, one queue per host behind, ordered by each host's next allowed fetch time. | [§62](/c/system-design/62-web-crawler) |
| **GCRA** | The token bucket stored as one timestamp, the theoretical arrival time of the next allowed request. | [§69.3](/c/system-design/69-token-bucket) |
| **Geohash** | Latitude and longitude interleaved into a base-32 string; a shared prefix means a nearby cell (6 chars ≈ 0.93 × 0.61 km at 40.7°N). Always query the 8 neighbours. | [§58](/c/system-design/58-ride-hailing) |
| **Graceful degradation** | Turning a hard dependency into a soft one with a fallback; Pulse's read path went from 69 to 4.3 minutes down per 30 days. | [§6.4](/c/system-design/06-availability) |

## 71.5 H–I

| Term | Definition | § |
|---|---|---|
| **Head-of-line blocking** | One lost packet stalls everything queued behind it — every stream of an HTTP/2 connection over TCP; HTTP/3 (QUIC) stalls only the affected stream. | [§11.5](/c/system-design/11-networking) |
| **Health check** | An active probe that takes a backend out of rotation (every 5 s, eject after 2–3 failures: ~10–15 s). Check local state only, or one database blip ejects the fleet. | [§24.4](/c/system-design/24-load-balancer) |
| **Hedged request** | A second copy of an idempotent read sent once the first passes ~p95; ~5% extra calls for a much shorter tail. | [§30.3](/c/system-design/30-retry) |
| **Hold** | A reservation with a TTL so payment happens outside the transaction: 30 s for checkout stock, 5 min for stadium seats. | [§59.9](/c/system-design/59-ticket-booking) |
| **Hot key / hot partition** | One key or partition with far more than its share of traffic; hashing spreads keys, not traffic. Cache, replicate, salt or near-cache it. | [§12.6](/c/system-design/12-replication-and-partitioning) |
| **Hot set** | The data most reads touch — Pulse's last 10 days of posts is 200 GB. Size caches to it, not to the whole data set. | [§2.3](/c/system-design/02-estimation) |
| **Idempotency** | Applying an operation twice has the same effect as once: $f(f(x)) = f(x)$. | [§22](/c/system-design/22-idempotency) |
| **Idempotency key** | A client-generated ID per intent; the server claims it with a unique insert *before* any work and replays the stored result. TTL ≥ the retry window (24–72 h ≈ 2.8–8.3 GB for checkout). | [§65](/c/system-design/65-idempotency) |
| **Index (composite)** | A sorted copy of some columns; serves only a leftmost prefix, ordered equality → sort → range. Each index adds a write per insert. | [§23](/c/system-design/23-indexes) |
| **Inverted index** | Term → posting list of the documents containing it; a query reads only its terms' lists, then ranks. | [§32](/c/system-design/32-search-index) |
| **Isolation level** | Which concurrency anomalies a transaction can see: read committed allows lost updates, snapshot isolation allows write skew, serializable neither. | [§15.2](/c/system-design/15-transactions) |

## 71.6 J–L

| Term | Definition | § |
|---|---|---|
| **Jitter** | Randomised retry waits; full jitter sleeps $U(0, \min(\text{cap}, b \cdot 2^k))$ before attempt $k$. 4,387 of 5,000 clients served vs 1,468 without. | [§30.2](/c/system-design/30-retry) |
| **L4 / L7 balancing** | L4 balances connections (fast, blind to requests); L7 balances requests (routes, retries, ejects on 5xx). Long-lived HTTP/2 needs L7. | [§24.1](/c/system-design/24-load-balancer) |
| **Lambda / kappa** | Lambda: a batch path for correctness plus a stream path for freshness. Kappa: one stream path; reprocess by replaying the log. | [§17.7](/c/system-design/17-batch-and-stream) |
| **Latency** | Time for one operation, quoted as percentiles; the mean describes nobody (99 requests at 10 ms and one at 1 s average 19.9 ms). | [§10.1](/c/system-design/10-latency-and-throughput) |
| **Leaky bucket** | A queue drained at a fixed rate; smooths output exactly, by adding delay. | [§28.1](/c/system-design/28-rate-limiter) |
| **Lease** | A lock or registration that expires unless renewed — the holder can't know when it lost it. 10–30 s for locks; 3 heartbeats for discovery. | [§21](/c/system-design/21-distributed-locks) |
| **Least requests / P2C** | Send to the backend with the fewest requests in flight, or the better of two random picks; adapts to mixed or degraded servers without weights. | [§24.2](/c/system-design/24-load-balancer) |
| **Linearisability** | Every read sees the latest completed write, as if there were one copy; costs coordination and availability under partition. | [§8](/c/system-design/08-consistency) |
| **Little's law** | Concurrency = rate × time in system, $L = \lambda W$: 2,000 calls/s × 0.3 s = 600 in flight; at 2 s, 4,000. | [§10.2](/c/system-design/10-latency-and-throughput) |
| **Load shedding** | Rejecting excess work early so the work you accept still meets its deadline. | [§38](/c/system-design/38-one-service-failing-breaker) |
| **Logical shard** | A fixed set of hash buckets (1,024) mapped onto fewer physical nodes; resizing moves whole buckets and updates a small table. | [§34.2](/c/system-design/34-sharding) |
| **Long polling** | The client holds a request open until there's news or a timeout; the fallback when a WebSocket isn't possible. | [§49](/c/system-design/49-chat) |
| **Lost update** | Two read-modify-writes interleave and one overwrites the other; prevented by snapshot isolation, conditional writes or locks. | [§15.2](/c/system-design/15-transactions) |
| **LRU / LFU** | Evict the least recently / least frequently used. LFU wins on stable popularity; LRU recovers when the hot set shifts (LFU fell to 57.6% vs LRU's 66.8%). | [§18.3](/c/system-design/18-cache) |
| **LSM tree** | Writes go to a memtable, then immutable sorted runs merged by compaction: sequential writes, paid for in read and write amplification. | [§14.5](/c/system-design/14-storage-models) |

## 71.7 M–O

| Term | Definition | § |
|---|---|---|
| **Materialised view** | A stored, refreshed query result — the simplest denormalisation. | [§14.7](/c/system-design/14-storage-models) |
| **M/M/1** | One server, random arrivals: $W = S/(1-\rho)$ and $W_{p99} \approx 4.6\,S/(1-\rho)$ — 2.5× the service time at 60% busy, 10× at 90%. | [§10.3](/c/system-design/10-latency-and-throughput) |
| **Monotonic reads** | A client never sees data go backwards; pin each session to one replica. | [§8](/c/system-design/08-consistency) |
| **MTBF / MTTR** | Mean time between failures / to recovery. Halving MTTR buys as much availability as doubling MTBF. | [§6.1](/c/system-design/06-availability) |
| **Multipart upload** | A large object sent as independently retried parts (above 16 MB; 8–16 MB parts on mobile). | [§26.3](/c/system-design/26-object-storage) |
| **Near-cache** | A ~1 s in-process copy of hot keys in front of a distributed cache; took the hottest shard from 2.18× to 1.10× the mean. | [§50.8](/c/system-design/50-distributed-cache) |
| **Nines** | Availability shorthand; each nine is 10× less downtime: 99.9% = 43.2 min, 99.99% = 4.3 min, 99.999% = 26 s per 30 days. | [§2.8](/c/system-design/02-estimation) |
| **Object storage** | A flat key → immutable blob store: cheap per byte, tens of ms per request. Bytes there, metadata in a database. | [§26](/c/system-design/26-object-storage) |
| **Optimistic / pessimistic concurrency** | Check at commit and retry, vs lock first. With contention $\rho = \lambda T$ above ~0.1, prefer locks or conditional updates. | [§15.5](/c/system-design/15-transactions) |
| **Orchestration / choreography** | One coordinator drives a saga's steps, vs services reacting to each other's events. Orchestrate anything with ≥ 3 steps and compensations. | [§31.3](/c/system-design/31-sagas) |
| **Origin shield** | A CDN tier between the edges and the origin that re-aggregates misses: origin share 34.0% → 7.7% at 50 PoPs. | [§19.3](/c/system-design/19-cdn) |
| **Outbox** | Write the domain change and an event row in one local transaction, then publish from the table — no lost and no phantom events. | [§9.4](/c/system-design/09-delivery-semantics) |

## 71.8 P–Q

| Term | Definition | § |
|---|---|---|
| **PACELC** | If **P**artitioned, choose **A** or **C**; **E**lse choose **L**atency or **C**onsistency — strong reads across regions pay ~150 ms. | [§8.5](/c/system-design/08-consistency) |
| **Partition** | Three meanings: a subset of data on one node (a shard), a log's unit of order and parallelism, a network split. Say which. | [§12](/c/system-design/12-replication-and-partitioning) |
| **Peak factor** | Peak ÷ average rate: ~3× for a single-region consumer app (the simulated day gives 2.2× plus headroom), ~1.5× global, 40× for checkout's flash sale. | [§2.2](/c/system-design/02-estimation) |
| **Percentile** (p50, p99) | The latency within which that share of requests finish; the payment provider is p50 300 ms, p99 2 s (illustrative). | [§10.1](/c/system-design/10-latency-and-throughput) |
| **Pivot** | The saga step after which nothing can be compensated (capturing payment); later steps retry until they succeed. | [§31](/c/system-design/31-sagas) |
| **PoP** | A CDN point of presence. More PoPs split each object's requests and lower each edge's hit ratio. | [§19](/c/system-design/19-cdn) |
| **Posting** | One ledger write: entries summing to zero, inserted once under a unique posting key. | [§56](/c/system-design/56-payments-ledger) |
| **Presigned URL** | A time-limited signed URL granting one operation on one object (uploads 5–15 min, downloads 1–5 min). | [§26.5](/c/system-design/26-object-storage) |
| **Queue vs log** | Queue: competing consumers, message deleted on ack, no replay. Log: retained, consumers track offsets, replay, order per partition. | [§25.1](/c/system-design/25-message-queue) |
| **Quorum** | $N$ replicas; writes wait for $W$ acks, reads ask $R$. $R + W > N$ makes every read overlap the latest write ($N$ = 3: $W = R = 2$). Necessary, not sufficient. | [§12.4](/c/system-design/12-replication-and-partitioning) |

## 71.9 R

| Term | Definition | § |
|---|---|---|
| **Rate limiter** | Caps what a caller may send and rejects the excess with 429 + `Retry-After`, before the expensive work. | [§28](/c/system-design/28-rate-limiter) |
| **Read replica** | A copy that replays the primary's log; adds read capacity, never write capacity. | [§29](/c/system-design/29-read-replicas) |
| **Read-your-writes** | A user always sees their own writes. Blind replica reads miss 5.6% of a poster's reads; an LSN token gives 0 stale with ~1% of reads on the primary. | [§29.4](/c/system-design/29-read-replicas) |
| **Reconciliation** | Comparing the ledger with provider and bank records (daily); each mismatch lands in a bucket with an owner. | [§56.9](/c/system-design/56-payments-ledger) |
| **RED / USE** | Rate, errors, duration for anything serving requests; utilisation, saturation, errors for anything that is a resource. | [§27.2](/c/system-design/27-observability) |
| **Replication lag** | How far a replica's applied log trails the primary — a queue that grows whenever writes outpace replay (20 s in the flash sale). | [§12.3](/c/system-design/12-replication-and-partitioning) |
| **Request collapsing** (single-flight) | Concurrent misses for one key share one origin fetch. | [§19.5](/c/system-design/19-cdn) |
| **Retry amplification** | If $d$ layers each retry $r$ times, the bottom sees $(1+r)^d$ attempts in an outage — 81× at $r$ = 2, $d$ = 4. | [§30.1](/c/system-design/30-retry) |
| **Retry budget** | Retries capped at a share of first attempts (10%), so an outage costs 1.1× per layer instead of \(1 + r\). | [§30.4](/c/system-design/30-retry) |
| **Rollup** | Pre-aggregated lower-resolution metrics (5 min, 1 h); took two-year retention from 63 TB to 4.6 TB. | [§53.7](/c/system-design/53-metrics-pipeline) |
| **RPO / RTO** | How much data (in time) / how much downtime a disaster may cost. Writes lost = rate × RPO: 2,000 orders at 1 s during the flash sale. | [§6.8](/c/system-design/06-availability) |

## 71.10 S

| Term | Definition | § |
|---|---|---|
| **Saga** | Local transactions with compensations, replacing a distributed transaction; ends completed, compensated, or needing a human. | [§31](/c/system-design/31-sagas) |
| **Scatter-gather** | A query sent to every shard is as slow as the slowest: at 16 shards, 15% of queries hit a p99-slow shard. | [§68.4](/c/system-design/68-sharding) |
| **Selectivity** | The fraction of rows a predicate matches; above ~3%, a non-covering index on wide rows loses to a scan. | [§23.5](/c/system-design/23-indexes) |
| **Semi-synchronous replication** | Acknowledge after one same-zone follower has the write: +1–5 ms, nothing lost if that follower is promoted. | [§12.2](/c/system-design/12-replication-and-partitioning) |
| **Service discovery** | A registry of leases mapping names to live instances; a crash is visible after the lease TTL plus propagation (watch +0.1 s, DNS +15 s). | [§33](/c/system-design/33-service-discovery) |
| **Service time** | $S$, the time a request is actually being worked on; one worker's capacity is $\mu = 1/S$. | [§10.1](/c/system-design/10-latency-and-throughput) |
| **Shard key** | The attribute that routes a row; must be in the dominant query, spread traffic and never change. | [§34.3](/c/system-design/34-sharding) |
| **Sharding** | Splitting data across nodes for write throughput, size or restore time (10 TB restores in ~14 h at 200 MB/s, illustrative). Nearly irreversible. | [§34](/c/system-design/34-sharding) |
| **Sliding log / sliding window counter** | Exact: up to $L$ timestamps per key. Approximate: two counters weighted by overlap, within a few percent. | [§28.1](/c/system-design/28-rate-limiter) |
| **SLI / SLO** | The measurement ("feed returns 200 within 300 ms") / its target over a window (99.9% over 28 days). | [§6.7](/c/system-design/06-availability) |
| **Slow start** | TCP grows its window from ~10 packets, doubling per RTT — why first responses should fit in ~14 KB. | [§11.3](/c/system-design/11-networking) |
| **Snapshot isolation** | Each transaction reads one consistent snapshot; prevents lost updates, allows write skew. | [§15.2](/c/system-design/15-transactions) |
| **Snowflake ID** | 64 bits = 41 bits of milliseconds (69.7 years) + 10 bits of worker + 12 bits of sequence (4.1M IDs/s per worker); time-ordered with no per-ID coordination. | [§52](/c/system-design/52-id-generator) |
| **Split-brain** | Two nodes both acting as primary and accepting writes; prevented by epochs or fencing plus quorum-based leadership. | [§50](/c/system-design/50-distributed-cache) |
| **Stale-while-revalidate** | Serve an expired cached copy while one request refreshes it in the background — no herd at expiry. | [§19.6](/c/system-design/19-cdn) |
| **Stateless** | No request depends on one process's memory, so any instance can serve it and instances can be added or killed freely. | [§45](/c/system-design/45-traffic-load-balancer) |
| **Synchronous replication** | Acknowledge after every copy has the write: no loss, but latency is the slowest copy and any copy down blocks writes. | [§12.2](/c/system-design/12-replication-and-partitioning) |

## 71.11 T–U

| Term | Definition | § |
|---|---|---|
| **Tail latency** | The slow end (p99, p99.9). Under fan-out, the backend's p99 becomes the page's typical experience. | [§10.5](/c/system-design/10-latency-and-throughput) |
| **Throughput** | Operations completed per second, set by the bottleneck stage. Not the inverse of latency. | [§10.1](/c/system-design/10-latency-and-throughput) |
| **Timeout** | How long a caller waits per attempt: just above the dependency's p99 (2.5 s for a 2 s p99), below the caller's deadline. | [§30.3](/c/system-design/30-retry) |
| **TLS 1.3 / 0-RTT** | A cold HTTPS request costs 3 RTTs (TCP, TLS, request), a warm one 1; 0-RTT resumption saves one but its data can be replayed. | [§11.2](/c/system-design/11-networking) |
| **Token bucket** | Tokens refill at rate $r$ up to burst $b$; each request spends one. Admits at most $b + r\,t$ in any interval $t$. | [§69](/c/system-design/69-token-bucket) |
| **Trace / span** | One request's tree of timed spans across services, joined by a propagated trace ID. Tail-sample: all errors, all slow, ~1% of the rest. | [§27](/c/system-design/27-observability) |
| **Trie / radix tree** | A prefix tree; a radix tree merges single-child chains. 10M queries fit in ~0.4 GB with top-10 lists stored where needed. | [§48](/c/system-design/48-autocomplete) |
| **TTL** | Time-to-live: the bound on a cached copy's staleness, and the backstop for a lost invalidation. | [§7.4](/c/system-design/07-caching) |
| **Two-phase commit** | Prepare everywhere, then commit; atomic, but holds locks ≥ 1 extra round trip, multiplies unavailability and blocks if the coordinator dies. | [§15.6](/c/system-design/15-transactions) |
| **Universal Scalability Law** | $C(N) = N/(1 + \sigma(N-1) + \kappa N(N-1))$, peaking at $N^\ast = \sqrt{(1-\sigma)/\kappa}$ — 34.6 nodes for σ = 0.04, κ = 0.0008. | [§13.3](/c/system-design/13-scalability) |
| **Utilisation** | $\rho = \lambda/(c\mu)$, the share of time workers are busy. Plan ≤ 60% at peak and ≤ 75% with a zone down. | [§13.5](/c/system-design/13-scalability) |
| **UUIDv7** | A 16-byte ID led by a millisecond timestamp: time-ordered, no worker lease, 8 more bytes per key than Snowflake. | [§52](/c/system-design/52-id-generator) |

## 71.12 V–Z

| Term | Definition | § |
|---|---|---|
| **Virtual nodes** | Each physical node owns $v$ points on the hash ring; the spread of load falls as ≈ \(1/\sqrt{v}\). | [§64](/c/system-design/64-consistent-hashing) |
| **Visibility timeout** | How long a queue hides a delivered message before redelivering it; ~10× the p99 (30 s for checkout's capture). | [§25.2](/c/system-design/25-message-queue) |
| **Waiting room** | A queue in front of an on-sale that admits buyers at the rate *inventory* can absorb, not at the backend's capacity. | [§59](/c/system-design/59-ticket-booking) |
| **Watermark** | Stream processing: the event time up to which input is believed complete. Chat: the highest `seq` a device has received or read. | [§17.3](/c/system-design/17-batch-and-stream) |
| **WebSocket** | A long-lived two-way connection: ~200k per chat gateway, versus 2M req/s if 10M clients polled every 5 s. | [§49](/c/system-design/49-chat) |
| **Write amplification** | Bytes written to storage ÷ bytes the application wrote. Each index adds writes; LSM compaction ~35× (rule of thumb). | [§14.5](/c/system-design/14-storage-models) |
| **Write skew** | Two transactions read overlapping data and write different rows, jointly breaking an invariant; only serializable prevents it. | [§15.2](/c/system-design/15-transactions) |
| **Write-through / write-behind** | Write cache and database together / write the cache and flush later (lost if the cache dies first). | [§7.5](/c/system-design/07-caching) |
| **Zipf distribution** | The item of popularity rank $k$ gets requests ∝ \(1/k^s\); at $s$ = 1, 10% of items serve ~88% of reads. | [§7.1](/c/system-design/07-caching) |

## 71.13 Check yourself

:::qa["Partition" appears three times in one design. Which meanings, and why does it matter?]
"Shard posts by author" (a data partition), "the orders topic has 12 partitions" (a log's unit of ordering and consumer parallelism) and "during a partition we serve stale reads" (a network split, CAP). Mixing them leads to claims like "more partitions improve availability", which is true of none of them as stated.
:::

:::qa[A candidate says the queue gives exactly-once processing. Correct them with the glossary terms.]
The queue gives at-least-once delivery: a consumer that crashes after the side effect but before the ack gets the message again. Effectively-once is at-least-once plus an idempotent effect — a consumer that records the message ID in the same transaction as its write, with a dedupe window at least as long as the replay window ([§9](/c/system-design/09-delivery-semantics)).
:::

:::qa[What's the difference between latency and throughput, with a Pulse number?]
Latency is how long one request takes (a feed read: a few ms at p50); throughput is how many complete per second (6,000 at peak). They're linked by Little's law, $L = \lambda W$: at 6,000/s and 10 ms each, ~60 are in flight. Raising throughput by adding servers doesn't lower latency unless queueing was the cause.
:::

Next: [§72 Mock walkthrough](/c/system-design/72-mock-walkthrough) — a full 45-minute answer, minute by minute.
