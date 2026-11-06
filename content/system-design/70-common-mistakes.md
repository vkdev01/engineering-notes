---
section: "70"
title: "Common mistakes"
kicker: "Interview"
abstract: "Forty-odd mistakes that cost design interviews, grouped by where they happen. Each comes with the number from the running examples that shows why it's wrong, what to say instead, and the section that derives it."
time: "9 min"
order: 70
outcomes:
  - "Spot a decision made without a number and replace it with the estimate that decides it"
  - "Explain, with the course's numbers, why sharding Pulse, retrying at every layer or caching without a staleness budget is wrong"
  - "Rewrite a weak answer so every component carries a number and a cost"
  - "Score a mock against six measurable signals"
---

A candidate designs Pulse: posts sharded by user across 16 nodes, Redis in front, retries "everywhere for resilience", strong consistency "to be safe". Every component is real and every choice is defensible in isolation. The answer still fails, because none of them is tied to a number, so the interviewer can't tell judgement from habit — and two of them make the system worse. This page lists those mistakes with the number that exposes each one.

:::key[First principle]
Almost every mistake is a **choice without a number** or a **component without a cost**. The fix is the same each time: state the measurement that justifies the choice, name what it costs, and say what would change your mind.
:::

How to read the tables: the middle column is the evidence you'd give an interviewer, taken from the running examples ([§2](/c/system-design/02-estimation)); the last column links to the derivation.

## 70.1 Process: how the 45 minutes go wrong

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| Drawing before scoping | Every minute of scoping past minute 5 comes out of the 10-minute deep dive, the part that scores depth | Ask the four questions (who and how much, core flows, what's out, what "good" means); draw by minute 5 | [§4.3](/c/system-design/04-interview-format) |
| No numbers by minute 10 | "Add a cache" can't be judged without "6,000 QPS over a 200 GB hot set" | Three lines: peak QPS, storage per year, the one ratio that matters (Pulse reads:writes = 10:1) | [§2](/c/system-design/02-estimation) |
| Technology without a because-clause | "Kafka handles that" scores nothing on the depth row | Mechanism + number + cost: "a log absorbs 2,000 orders/s while consumers write 1,000/s; the cost is asynchronous confirmation" | [§47](/c/system-design/47-write-spikes-queue) |
| Designing every feature | 15 minutes of happy path spread over six flows is 2.5 minutes each — no depth anywhere | Two flows, a written out-of-scope list, one deep dive | [§1](/c/system-design/01-answering-framework) |
| No failure story | The senior signal is failure modes raised before being asked (target ≥ 2 per mock) | "Provider p99 is 2 s, so 2,000 orders/s holds 4,000 calls in flight — timeout, bulkhead, breaker" | [§4.4](/c/system-design/04-interview-format) |
| Silent drawing | Interruptions break the narrative; target ≥ 30 of 45 minutes talking, < 3 interruptions | Narrate each box as you draw it: what it does and why it's there | [§4.5](/c/system-design/04-interview-format) |
| Hand-waving the hard part | "The system handles consistency" invites "how?", and you improvise | Name the mechanism: a conditional `UPDATE … WHERE status = 'available'` oversells 0 seats; read-then-write oversold 985 | [§59](/c/system-design/59-ticket-booking) |
| Defending a choice the pushback has beaten | Arguing scores worse than updating on new information | "At 600 writes/s I'd not shard; at 10× growth — 6,000 writes/s, 95 TB/yr with indexes — I'd partition by author" | [§2.10](/c/system-design/02-estimation) |
| No operations at the end | Without telemetry, users report the incident first (Pulse's 03:10 incident) | Close with the SLI, the burn-rate page, three dashboards (hit rate, lag, queue age) and what ships first | [§27](/c/system-design/27-observability) |

## 70.2 Estimation

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| Sizing for the average | Pulse's exact mean is 2,315 reads/s; one region peaks at 2.2× it, and the fleet falls over every evening | Peak = 3× for a single-region consumer app, ~1.5× global | [§2.2](/c/system-design/02-estimation) |
| 3× for a scheduled event | Checkout goes from 50 to 2,000 orders/s in a flash sale: 40× | Size events from buyers ÷ seconds the sale is open | [§2.2](/c/system-design/02-estimation) |
| Forgetting copies and indexes | 7.3 TB/yr of posts is 28.5 TB of disk with +30% indexes and 3 replicas | $S$ = writes × bytes × (1 + index) × copies × time | [§2.3](/c/system-design/02-estimation) |
| Mixing bits and bytes | An 8× error: the photo service's 20 GB/s of egress is 160 Gbit/s | Write the unit on every line | [§2.4](/c/system-design/02-estimation) |
| Little's law at the median | 2,000 calls/s × 0.3 s = 600 in flight; at the provider's p99 of 2 s it's 4,000 | Size pools and bulkheads from rate × the tail latency you must survive | [§10.2](/c/system-design/10-latency-and-throughput) |
| Planning servers at 80–90% | M/M/1 mean is 5× the service time at 80%, 10× at 90%; 13 servers split 5/4/4 run at 94% when a zone fails | 60% target and ≤ 75% with a zone down: 15 servers, 5 per zone | [§10.4](/c/system-design/10-latency-and-throughput) |
| Ignoring serial dependencies | Five hard dependencies at 99.9% give 99.5% (216 min per 30 days); checkout's path is 99.79% | Downtimes add; make dependencies soft or remove them from the path | [§6.2](/c/system-design/06-availability) |
| Ignoring fan-out tails | 20 parallel calls, each slow 1% of the time, make 18% of pages slow | Batch (one multi-get), then hedge | [§10.5](/c/system-design/10-latency-and-throughput) |

The availability-vs-dependencies curve is in [§2.8](/c/system-design/02-estimation); the utilisation hockey stick in [§10.3](/c/system-design/10-latency-and-throughput).

## 70.3 Data, storage and partitioning

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| Sharding Pulse | 600 peak writes/s is 12% of an illustrative 5,000/s primary; 7.3 TB/yr | Index → cache → replicas → tier old posts; shard when a measured ceiling is within a year (photo metadata hits 10 TB in 8.2 months) | [§34.1](/c/system-design/34-sharding) |
| Skipping the cheap rung | A feed regression with query time 5 → 30 ms and traffic flat: a third replica leaves p99 6× worse; an index takes replicas from 90% to 15% busy | Run `EXPLAIN` before buying hardware; walk the cost ladder | [§36](/c/system-design/36-choosing-between-fixes) |
| Timestamp-led shard key | `range(created_at)` puts all of today's writes on one shard: 16× the mean on 16 shards | `hash(owner_id)`, with time as a secondary column | [§34.3](/c/system-design/34-sharding) |
| Shard key the hot query lacks | `hash(photo_id)` makes a 32-photo grid read 13 of 16 shards | The key is what the dominant query filters on | [§34.3](/c/system-design/34-sharding) |
| `hash mod N` placement | Adding a 9th node moves 89% of keys; a ring or logical shards move 11% | 1,024 logical shards mapped onto nodes, or consistent hashing | [§64](/c/system-design/64-consistent-hashing) |
| Blobs through the API tier | 480 Gbit/s through application servers at the photo peak | Presigned uploads to object storage; CDN + shield cut origin to 37 Gbit/s | [§40](/c/system-design/40-slow-files-object-storage-cdn) |
| An index for every column | Each index adds a B-tree write per insert: checkout's 8,000 writes/s becomes 10,000 (+25%) at the peak | One composite index per dominant query, columns equality → sort → range | [§41.5](/c/system-design/41-slow-queries-indexes) |
| Random 64-bit IDs | Birthday bound: a year of Pulse posts (7.3B) collides with 76% probability | Snowflake (41 bits time, 10 worker, 12 sequence) or 16-byte UUIDv7 | [§52](/c/system-design/52-id-generator) |

## 70.4 Caching, replication and consistency

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| A cache with no staleness budget | "Cache it" doesn't say how wrong answers may be; 5 s and 5 min differ up to 10× in refresh load | A staleness number per data type; delete-on-write with a TTL backstop | [§7.4](/c/system-design/07-caching) |
| Assuming the cache is always warm | At 94% hit the database sees 360 reads/s; losing one of six shards makes it 1,300; a cold restart, 6,000 | A replica per shard, database headroom or load shedding behind the cache | [§42](/c/system-design/42-slow-reads-cache) |
| Caching low-reuse reads | Search filters hit 11%: 1,668 of 1,800 reads/s still reach the database | Measure reuse from the access log; broad reads go to replicas | [§39.4](/c/system-design/39-read-heavy-replicas) |
| LFU on a feed | After the hot set shifts, LFU drops from 71.4% to 57.6% hit, below LRU's 66.8% | LRU (or LFU with fast decay) when popularity moves | [§18.3](/c/system-design/18-cache) |
| TTLs without jitter | Keys filled together expire together; ±10% jitter cuts the expiry spike ~10× | TTL ± 10%, single-flight on misses | [§7.6](/c/system-design/07-caching) |
| Strong consistency everywhere | Waiting for all 3 copies with one remote: p50 151 ms, and writes are up only 97.0% of the time (99% per replica, illustrative) | Strong for the invariant (a conditional decrement, a unique key); eventual + session guarantees elsewhere | [§12.2](/c/system-design/12-replication-and-partitioning) |
| Async replication for money | A flash-sale replica 20 s behind loses up to 40,000 acknowledged orders on failover | Semi-sync to a same-zone follower, ~+1 ms per write; async only for the cross-region copy | [§12.2](/c/system-design/12-replication-and-partitioning) |
| Reading your own writes from a replica | 5.6% of a poster's reads miss their own post; a 5 s pin sends 20% of feed reads to the primary | Route by log position (LSN token): 0 stale, ~1% of reads to the primary | [§29.4](/c/system-design/29-read-replicas) |
| A CDN with no origin shield | At 50 PoPs, 34.0% of requests still reach the origin | Shield in the origin's region (7.7%), content-hashed URLs, never purge | [§19.3](/c/system-design/19-cdn) |
| `301` for a URL shortener | Browsers cache it indefinitely: no click stats, no takedown — to save ~900 of 3,000 redirects/s (30% repeat clicks, illustrative) the service can serve anyway | `302` with `s-maxage=60`: the 60 s is the takedown SLA | [§60.8](/c/system-design/60-url-shortener) |

## 70.5 Retries, timeouts and duplicates

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| Retries at every layer | $(1+r)^d$: 2 retries at 4 layers = 81×, so 2,000 orders/s become 162,000 calls/s against a 2,500/s quota | One retrying layer, nearest the dependency, with a 10% budget: 2,200/s | [§30.1](/c/system-design/30-retry) |
| Backoff without jitter | 5,000 clients that failed together retry in waves: 1,468 served vs 4,387 with full jitter | Full jitter, base 100 ms, cap 2–10 s, inside a deadline | [§30.2](/c/system-design/30-retry) |
| Retrying a side effect with no key | A 1 s client timeout in a 100 s flash sale → 17,686 double charges | Idempotency key, claimed by insert before the charge and passed to the provider: 0 | [§37](/c/system-design/37-duplicate-requests-idempotency) |
| Check-then-act deduplication | 2,168 of 4,000 duplicate pairs double-charge: the copy arrives while the first waits on the provider | Claim with a unique insert; `409` while in progress, stored response after | [§22.4](/c/system-design/22-idempotency) |
| Timeouts below the dependency's p99 | Provider p99 2 s: a 1 s timeout leaves 83,942 ambiguous payments per sale; 3 s leaves 2,853 | Per-attempt timeout just above p99 (2.5 s) inside an 8 s propagated deadline | [§56.12](/c/system-design/56-payments-ledger) |
| Promising exactly-once delivery | A lost ack is indistinguishable from a lost message; duplicates ≈ ack-loss × volume: ~2/s at 0.1% and 2,000/s | At-least-once delivery + an idempotent effect, with a dedupe window ≥ the replay window | [§9](/c/system-design/09-delivery-semantics) |

## 70.6 Overload, isolation and concurrency

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| Timeout without a bulkhead | A hung provider at 2,000 calls/s with a 2.5 s timeout wants 5,000 workers; it fills a 1,500 pool in 0.33 s | Per dependency: timeout + bulkhead (~1.2–2× healthy in-flight) + breaker + fallback | [§20](/c/system-design/20-circuit-breaker) |
| A breaker that counts only errors | A provider 2× slower fills the pool while an error-rate breaker never opens — a brownout | Count calls slower than ~healthy p99 as failures | [§38.4](/c/system-design/38-one-service-failing-breaker) |
| Fixed-window rate limits | Admits 2L across a boundary: 200 requests in 20 ms on a 100/s limit | Token bucket, at most $b + rt$ in any interval $t$ | [§28.1](/c/system-design/28-rate-limiter) |
| Only a global limit | 200 bot accounts at 50 req/s take 80% of the payment quota | A bucket per identity plus a global bucket per dependency | [§44](/c/system-design/44-too-many-requests-rate-limit) |
| Read-then-write on inventory | 985 stadium seats sold twice when payment sits between the read and the write | Conditional `UPDATE`: the row count says who won; 0 sold twice | [§59.6](/c/system-design/59-ticket-booking) |
| A lock held across a network call | A row held for $T$ caps it at \(1/T\) transactions/s: across a 300 ms payment call, ≤ 3.3 orders/s per SKU | Holds with a TTL; pay outside the transaction | [§15.5](/c/system-design/15-transactions) |
| A distributed lock without fencing | A pause outlives the lease: 13 lost updates per 20,000 jobs | Storage rejects stale fencing tokens, or use a conditional write instead of a lock | [§21.3](/c/system-design/21-distributed-locks) |
| Two-phase commit across services | ≥ 1 extra round trip of lock time, unavailability multiplies, blocks if the coordinator dies | Outbox + idempotent steps + a [saga](/c/system-design/31-sagas) with compensations | [§15.6](/c/system-design/15-transactions) |

## 70.7 SLOs and observability

| Mistake | Why it's wrong, in numbers | Say instead | § |
|---|---|---|---|
| An SLO tighter than the dependencies | 99.9% end to end over a 99.9% payment provider and two databases is arithmetically 99.79% | Relax it, add a second provider (99.89%), or take the call off the synchronous path | [§2.8](/c/system-design/02-estimation) |
| Paging on causes | CPU was 50% during Pulse's 2% error incident; users noticed first | Page on burn rate: 2% errors on a 99.9% SLO pages after ~2% of the budget | [§35](/c/system-design/35-cannot-see-what-broke-telemetry) |
| Alerting on queue depth | 600,000 messages is 10 minutes at 1,000/s and 10 seconds at 60,000/s | Alert on the age of the oldest message | [§47.5](/c/system-design/47-write-spikes-queue) |
| Unbounded metric labels | A `user_id` label on checkout's counter during the sale: 180M series | A series limit per metric at ingestion; per-user detail in traces and logs | [§53.6](/c/system-design/53-metrics-pipeline) |
| Deep health checks | A readiness check that queries the shared database ejects the whole fleet during a 20 s failover | Readiness checks local state; cap ejection at 10–50% of the pool | [§24.4](/c/system-design/24-load-balancer) |

:::warn[The two mistakes that do the most damage]
Retry stacks and missing idempotency keys don't just lose marks — they turn a provider blip into an outage (162,000 calls/s) and a timeout into a double charge (17,686 per sale). If you raise only two failure modes in an answer about anything with a payment, raise these.
:::

## 70.8 One answer, before and after

:::example[Worked example · the Pulse answer from the opening, rewritten]
**Before:** "I'll shard posts by user across 16 nodes, put Redis in front, retry everywhere, and use strong consistency to be safe."

**After:** "Peak is 6,000 reads and 600 writes a second; posts grow 7.3 TB a year. Writes are 12% of one primary, so one database with old posts tiered to object storage — no sharding until a measured ceiling is a year away. Reads go through cache-aside Redis: at 94% hit the database sees 360 reads/s. Staleness budget: a new post may take 5 s to reach followers; cached posts are deleted on write, with a jittered 300 s TTL as the backstop for a lost delete, and losing a cache shard is covered by a replica per shard. Two replicas cover failover, and a poster's own reads route by LSN so their post never vanishes. Strong consistency only where there's an invariant — none in a feed. Retries live in one client library with full jitter and a 10% budget."

What changed, row by row: sharding Pulse (§70.3), a cache with a staleness budget and a cold-start plan (§70.4), read-your-writes (§70.4), retry stacks (§70.5) and strong-everywhere (§70.4) — each replaced by a number and a cost. Same components, minus the shard; the second answer is checkable.
:::

## 70.9 A self-check after every mock

Score each recording against the coaching targets of [§4.5](/c/system-design/04-interview-format):

| Question | Target | If you missed it |
|---|---|---|
| When was the first number on the board? | By minute 10 | Rehearse the three-line estimate of [§2.6](/c/system-design/02-estimation) |
| Did every component get a reason and a cost? | Every one | Re-read [§74](/c/system-design/74-trade-off-cheatsheet) for the cost column |
| How many failure modes did you raise unprompted? | ≥ 2 | Tables §70.5–70.6 above |
| Did step-2 numbers reappear later? | ≥ twice | Point back at the corner of the board when you choose |
| How long did you talk? | ≥ 30 of 45 minutes, < 3 interruptions | Narrate while drawing |
| Did you say what you'd measure in production? | Yes | One SLI, one burn-rate page, three dashboards |

Any miss is the next practice target; the first row alone usually lifts an answer a level.

## 70.10 Check yourself

:::qa[You proposed read replicas for a slow feed. The interviewer asks what you measured first. What should the answer have been?]
Three numbers: did the request rate rise, did time per query rise, or did capacity fall ([§36](/c/system-design/36-choosing-between-fixes))? In the Pulse regression the rate was flat and query time went 5 → 30 ms — a plan problem. An index fixes it (replicas from 90% to 15% busy); a third replica only spreads the slow query and leaves p99 6× worse.
:::

:::qa[A design retries 3 times at the gateway, the service and the client library. What does the payment provider see in an outage during the flash sale?]
$(1+3)^3$ = 64 attempts per order, so 2,000 orders/s become 128,000 calls/s against a 2,500/s quota ([§30.1](/c/system-design/30-retry)). One retrying layer with a 10% budget sends 2,200/s; a breaker stops even that once the outage is clear.
:::

:::qa[Why is "strong consistency for checkout" an incomplete answer?]
It doesn't name the invariant or the price. The invariant is "stock never goes below zero" and "one charge per intent": a conditional decrement on the primary and a unique idempotency key enforce them. Everything else — product pages, order history — can be seconds stale. Strong replication across regions would add ~150 ms to every write and stop writes whenever one copy is down ([§12.2](/c/system-design/12-replication-and-partitioning)).
:::

:::qa[Pulse's cache hit rate is 94%. What happens to the database when one of six cache shards dies, and what should the design say?]
The database goes from 360 to ~1,300 reads/s ([§42.7](/c/system-design/42-slow-reads-cache)) — survivable only if it has that headroom. The design should give each shard a replica in another zone and say what sheds load if both are lost; a full cold start sends all 6,000 reads/s.
:::

Next: [§71 Glossary](/c/system-design/71-glossary) — every term in the course, with its number and its section.
