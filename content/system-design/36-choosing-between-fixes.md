---
section: "36"
title: "Choosing between overlapping fixes"
kicker: "Patterns"
abstract: "The twelve patterns overlap, and naming the right-sounding fix for the wrong bottleneck is the most common way a good answer loses marks. Measure rate, time per operation, utilisation and concentration first; each fix changes exactly one of them. Worked triage: a Pulse feed regression that looks like 'add replicas' and is an index."
time: "10 min"
order: 36
outcomes:
  - "Map a symptom to the measurement that discriminates between candidate fixes, with thresholds"
  - "Tell a load problem from a per-operation-cost problem using rate, execution time and wait time"
  - "Triage a Pulse latency regression step by step and price each candidate fix"
  - "Reject sharding, replicas or a cache with a number, not a preference"
---

Pulse's feed p99 is nine times worse at the evening peak after Tuesday's release. In the design review, four people propose four fixes: a bigger cache, more replicas, sharding, and "probably an index". All four would move some graph. Only one fixes the cause, and it is the cheapest — but you can only know that by measuring before choosing. This section is the decision guide for the pattern sections that follow ([§37](/c/system-design/37-duplicate-requests-idempotency)–[§47](/c/system-design/47-write-spikes-queue)): symptom → measurement → fix, then one incident triaged with numbers.

:::key[First principle]
Every performance fix changes one term of $\rho = \lambda S / c$ — arrival rate $\lambda$ (cache, rate limit, CDN), service time $S$ (index, query rewrite), or capacity $c$ (replicas, load balancer, shards) — or moves work in time (queue) or stops it (breaker). **Measure which term moved, then pick the fix that acts on that term.** Response time grows like $1/(1-\rho)$ ([§10.3](/c/system-design/10-latency-and-throughput)), so the wrong term can look fixed and still sit on the hockey stick.
:::

## 36.1 Four measurements that separate the fixes

| Measure | Where | What it isolates | Fixes that act on it |
|---|---|---|---|
| **Rate** $\lambda$: requests or queries per second, per dependency | RED metrics ([§27](/c/system-design/27-observability)) | More work arrived | Cache, rate limit, CDN, dedupe |
| **Execution time** $S$: time doing the work (e.g. `pg_stat_statements` mean exec time) | Database or service internals | Each unit got more expensive | Index, query or plan fix, smaller payload |
| **Wait time**: client-side time minus execution time | Client histograms vs server stats | Queueing: $\rho$ too high | Capacity (replicas, servers, shards) — or lower $\lambda$ or $S$ |
| **Concentration**: share of load on the top keys, clients, nodes | Key/client/host breakdowns | Skew, not volume | Cache (hot keys), rate limit (hot clients), rebalancing (hot nodes) |

Read them together. Rate up with flat execution time is a load problem. Execution time up with flat rate is a cost problem. Wait time up with both flat means capacity disappeared (a node lost, a noisy neighbour). Concentration high means the average is lying.

## 36.2 Symptom → measurement → fix

| Symptom | Measure first | Threshold that points to the fix | Fix | Pattern |
|---|---|---|---|---|
| One endpoint slow, others fine | Execution time of its top queries; `EXPLAIN ANALYZE` | Exec time up with rate flat; rows examined > ~100× rows returned | Index or query fix | [§41](/c/system-design/41-slow-queries-indexes) |
| Reads slow, same keys again and again | Hit rate; top-1% keys' share of reads | Hit rate < 90% on a skewed workload; top keys > 50% of reads | Cache | [§42](/c/system-design/42-slow-reads-cache) |
| Database CPU high on broad reads | Read QPS ÷ replica capacity | Utilisation > 60% with exec time flat and no hot set | Read replicas | [§39](/c/system-design/39-read-heavy-replicas) |
| Write latency rising, primary saturated | Writes/s and data size vs one node | Writes > ~60% of one primary, or data past one node's disk after indexes | Shard | [§46](/c/system-design/46-write-heavy-shard) |
| Writes fail only during spikes | Peak ÷ average write rate; can the work wait? | Peak ≫ capacity for minutes, average ≪ capacity (checkout: 2,000 vs 50 orders/s) | Queue | [§47](/c/system-design/47-write-spikes-queue) |
| Overload from a few callers | Requests per client, top client's share | One client > its quota or > ~10% of capacity | Rate limit | [§44](/c/system-design/44-too-many-requests-rate-limit) |
| Some servers hot, others idle | Max ÷ mean CPU or connections per server | Max/mean > ~1.5 | Load balancer, stateless servers | [§45](/c/system-design/45-traffic-load-balancer) |
| Large files slow for far users, egress bill | Latency by region; bytes served | Cross-region RTT ~150 ms per round trip; egress ~USD 1.0M/month for photos (illustrative) | Object storage + CDN | [§40](/c/system-design/40-slow-files-object-storage-cdn) |
| Brief error blips | Error bursts < seconds, independent | Attempts per request ≈ 1 + p, errors uncorrelated | Retry with jittered backoff | [§43](/c/system-design/43-temporary-failures-retry) |
| Everything slow because one dependency is | In-flight calls per dependency (Little) | In-flight > ~1.5× healthy; dependency p50 ≈ timeout | Circuit breaker + bulkhead | [§38](/c/system-design/38-one-service-failing-breaker) |
| Duplicate side effects | Duplicates per 10,000 operations | > 0 on money or orders | Idempotency key | [§37](/c/system-design/37-duplicate-requests-idempotency) |
| You can't answer any of the above | Who noticed first; time to suspect | Users first; > ~15 min to a named component | Telemetry | [§35](/c/system-design/35-cannot-see-what-broke-telemetry) |

## 36.3 The six confusions, and the number that settles each

| Confusion | Measurement that separates them | Pick |
|---|---|---|
| **Cache vs read replica** | Hit rate achievable at your cache size ([§7.1](/c/system-design/07-caching): Zipf $s$ = 1, 14 GB → 88%) | Skewed reads → cache (10× less DB per nine). Broad, varied reads → replicas |
| **Queue vs rate limit** | Is the rejected work wanted? | Wanted but bursty → queue. Over quota or abusive → limit |
| **Index vs shard** | Exec time per query vs data and write volume per node | Slow queries on data that fits one node → index. Writes or size beyond one node → shard |
| **Retry vs circuit breaker** | Are failures independent? Error-burst length vs timeout | Blips → retry. Sustained (seconds+) → breaker; retries without one multiply load by $(1+r)^d$ ([§30](/c/system-design/30-retry)) |
| **Idempotency key vs dedup** | Where duplicates come from: one client retrying vs a stream redelivering | Client retries → key. Stream or batch repeats → consumer dedup |
| **Load balancer vs rate limiter** | Is total load above capacity, or unevenly spread? | Uneven → balancer. Above what you choose to serve → limiter. Usually both |

## 36.4 Worked triage: the Pulse feed regression

Pulse's read path: 6,000 feed reads/s at peak, 90% served by Redis (0.5 ms), 10% — 600 queries/s — go to two read replicas. Each replica serves 2,000 reads/s at 5 ms per query (illustrative, [§29](/c/system-design/29-read-replicas)), which by Little's law is 10 queries in execution at full load, so the model treats a replica as 10 parallel slots (M/M/10). After the release:

1. **Scope.** Only `GET /feed` is slower; posts are fine. All 15 API servers and all three zones show the same p99. *Not a host, zone or load-balancer problem.*
2. **Saturation.** API CPU flat at 50%. Replica CPU 15% → 90%. *The database tier is the queue.*
3. **Rate vs cost.** Feed reads still 6,000/s, hit rate still 90%, so replica QPS is still 600 — **rate is flat**. Execution time per feed query went 5 → 30 ms; client-side DB time is 50 ms, so 20 ms of it is waiting. *Cost went up; the waiting is a consequence.*
4. **Plan.** `EXPLAIN ANALYZE` on the top query by total time: the release added a filter on a `mutes` table with no index on `mutes(user_id)`; rows examined ≫ rows returned (illustrative cause).
5. **Price every candidate** with the same model:

```python run
"""Triage: Pulse feed p99 regressed at peak. Which fix does the arithmetic pick?"""
import math
import numpy as np

QPS, T_HIT = 6_000, 0.5                # peak feed reads/s; cache lookup ms (illustrative, §7)
SLOTS = 10                             # one replica: 2,000 reads/s at 5 ms -> 10 busy query slots (Little)


def erlang_c(c, a):                    # P(wait) in M/M/c with offered load a = lambda*S
    s = sum(a ** k / math.factorial(k) for k in range(c))
    top = a ** c / math.factorial(c) * c / (c - a)
    return top / (s + top)


def feed(hit, s_ms, replicas, burst=1.0, seed=36):
    lam = QPS * burst * (1 - hit) / replicas / 1000      # DB queries per ms, per replica
    a = lam * s_ms
    rho = a / SLOTS
    if rho >= 1:
        return rho, float("inf"), float("inf")
    rng = np.random.default_rng(seed)
    n = 400_000
    pw = erlang_c(SLOTS, a)
    wait = np.where(rng.random(n) < pw, rng.exponential(1 / (SLOTS / s_ms - lam), n), 0.0)
    db = wait + rng.exponential(s_ms, n)
    t = np.where(rng.random(n) < hit, T_HIT, T_HIT + db)
    return rho, db.mean(), np.percentile(t, 99)


print("%-30s %6s %8s %9s %10s" % ("state", "rho", "DB mean", "feed p99", "rho +20%"))
cases = [("healthy: hit 90%, 5 ms, 2 rep", 0.90, 5, 2),
         ("incident: hit 90%, 30 ms, 2 rep", 0.90, 30, 2),
         ("fix A: index -> 5 ms", 0.90, 5, 2),
         ("fix B: 3 replicas", 0.90, 30, 3),
         ("fix B: 5 replicas", 0.90, 30, 5),
         ("fix C: hit 99% (bigger cache)", 0.99, 30, 2)]
for name, h, s, r in cases:
    rho, mean, p99 = feed(h, s, r)
    print("%-30s %5.0f%% %6.1f ms %6.1f ms %9.0f%%" % (name, 100 * rho, mean, p99, 100 * feed(h, s, r, 1.2)[0]))

print("\nchart: query ms, feed p99 ms with 2 / 3 / 4 replicas (hit 90%)")
for s in (5, 10, 15, 20, 25, 28, 30, 32):
    print("%d, %s" % (s, ", ".join("%.1f" % feed(0.9, s, r)[2] for r in (2, 3, 4))))
```

```output
state                             rho  DB mean  feed p99   rho +20%
healthy: hit 90%, 5 ms, 2 rep     15%    5.0 ms   11.9 ms        18%
incident: hit 90%, 30 ms, 2 rep    90%   50.0 ms  104.3 ms       108%
fix A: index -> 5 ms              15%    5.0 ms   11.9 ms        18%
fix B: 3 replicas                 60%   30.7 ms   70.0 ms        72%
fix B: 5 replicas                 36%   30.0 ms   69.2 ms        43%
fix C: hit 99% (bigger cache)      9%   29.9 ms    0.5 ms        11%

chart: query ms, feed p99 ms with 2 / 3 / 4 replicas (hit 90%)
5, 11.9, 11.9, 11.9
10, 23.4, 23.4, 23.4
15, 34.9, 34.8, 34.8
20, 46.8, 46.3, 46.3
25, 62.3, 57.9, 57.7
28, 79.2, 65.0, 64.7
30, 104.3, 70.0, 69.3
32, 211.1, 75.3, 73.9
```

Feed p99 is the cache-and-database part of the request; with 10% misses it sits near the database's p90, which is why it tracks query time so closely.

:::chart[Feed p99 (cache + database) vs per-query execution time, by replica count (Pulse peak, M/M/10 per replica)]{type="line" x="query execution time (ms)" y="feed p99 (ms)" points="true" marks="5:healthy;30:after the release"}
query ms, 2 replicas, 3 replicas, 4 replicas
5, 11.9, 11.9, 11.9
10, 23.4, 23.4, 23.4
15, 34.9, 34.8, 34.8
20, 46.8, 46.3, 46.3
25, 62.3, 57.9, 57.7
28, 79.2, 65.0, 64.7
30, 104.3, 70.0, 69.3
32, 211.1, 75.3, 73.9
:::

:::example[Worked example · the decision, with numbers]
- **Incident state is one surge from an outage.** At 90% utilisation a 20% traffic surge takes each replica to 108%: arrivals exceed service, the queue grows without bound, feed requests time out and the SLO burns.
- **Replicas treat the queue, not the cause.** A third replica drops utilisation to 60% and the 20% surge to 72% — safe — but p99 stays at 70 ms, 6× healthy, because every miss still costs 30 ms. Five replicas buy nothing more (69.2 ms): the curves for 3 and 4 replicas in the chart are already flat at the service time.
- **A bigger cache hides it.** At a 99% hit rate the p99 lands on cache hits (0.5 ms), but the 1% of misses still take ~30 ms, and getting from 90% to 99% needs most of the corpus in memory at Zipf $s$ = 1 ([§7.1](/c/system-design/07-caching): 44 GB buys only 94%).
- **The index moves along the x-axis.** Back to 5 ms: 15% utilisation, 11.9 ms p99, 18% under a surge — and a few percent of write throughput as its only cost.
- **Rejected with numbers:** sharding (writes are 200/s average, 600 peak; data 7.3 TB/year — [§34](/c/system-design/34-sharding) says not yet), rate limiting (traffic is the planned 6,000/s), a breaker (the replica is not failing; our query is expensive).
:::

## 36.5 The cost ladder

Work up the ladder, not across it. Prices are not close.

| Rung | Fix | What it costs | Reversible? | Acts on |
|---|---|---|---|---|
| 1 | Index, query fix | A few % write throughput, index storage | Yes, trivially | $S$ |
| 2 | Cache | Staleness, invalidation, a cache tier (~128 GB timelines on Pulse) | Yes | $\lambda$ at the database |
| 3 | Load balancer + stateless servers | A hop; moving session state out | Yes | Spread of $\lambda$ |
| 4 | Read replicas | Lag, routing for read-your-writes, a server each | Yes | $c$ for reads |
| 5 | Queue | Asynchrony, duplicates, a new system to run | Mostly | $\lambda$ over time |
| 6 | CDN + object storage | Invalidation, egress pricing | Yes | Bytes and distance |
| 7 | Sharding | Cross-shard queries, a permanent key choice | Barely | $c$ for writes and data |

An answer that reaches rung 7 while skipping rung 1 is the most common way to sound sophisticated and look inexperienced. A good answer names the fix, prices it, and **rejects the next-higher rung with a number**.

## 36.6 Triage failure modes

| Mistake | Why it hurts | Instead |
|---|---|---|
| Adding capacity first | Works on paper (90% → 60%), hides a 6× regression, costs servers | Check whether rate or cost moved |
| Reading averages | Mean DB time 50 ms says nothing about who waits | Histograms: p50 and p99, exec vs wait |
| Changing two things at once | You can't tell which one helped, or which one hurt | One change, measure, then the next |
| Fixing the slice with the most traffic | High share, no lift (§35.3) | Slice with high lift *and* high share |
| Trusting a fix at average load | 15% → 60% looks safe at 6,000/s | Re-check at peak × 1.2 and with a zone lost |

## 36.7 Interview soundbite

> "Before I pick a fix I want three numbers: did the rate go up, did the cost per operation go up, or did capacity go down. Here query time went 5 to 30 milliseconds with traffic flat, so it's a plan problem — an index takes replicas from 90% back to 15%. A third replica would also stop the bleeding, but it leaves p99 six times worse, and I'd say why I'm not sharding: 600 writes a second at peak fits one primary."

## 36.8 Check yourself

:::qa[Feed p99 doubled. Replica QPS went 600 → 1,500, hit rate fell 90% → 75%, query exec time is flat at 5 ms. Which fix, and which is wrong?]
Rate moved, cost didn't: \((1 - 0.75) \times 6{,}000\) = 1,500 queries/s. First find why the hit rate fell (a cache-key change, evictions, a smaller cache) and restore it — rung 2 work. An index does nothing (exec time is flat); replicas would absorb it (1,500 over two at 2,000/s is 38% each) but pay servers to cover a cache bug.
:::

:::qa[Why does the third replica fix utilisation but not p99 in the triage?]
p99 here is roughly the database's p90 response, and response = wait + service. Replicas shrink the wait (90% → 60% utilisation), but the service time is still 30 ms, so p99 floors near \(30 \times \ln 10\) ≈ 69 ms — exactly where 3, 4 and 5 replicas land.
:::

:::qa[A batch job's writes fail every night at 02:00 for 10 minutes; the rest of the day writes run at 10% of capacity. Shard, queue or rate limit?]
Peak ≫ capacity for minutes, average ≪ capacity, and the work is wanted: a queue. Sharding buys permanent capacity for a 10-minute spike; a rate limit would reject work you need. Size the queue for the spike's excess × duration and make consumers idempotent.
:::

:::qa[Errors spike after the payment provider has a 20-second blip, and stay high for minutes after it recovers. Retry or breaker?]
Errors outliving the blip is the signature of a retry storm: attempts per request rose and the provider is being hammered while it recovers. Cap retries with a budget and jitter ([§30](/c/system-design/30-retry)), and add a breaker so a sustained failure stops the attempts entirely ([§38](/c/system-design/38-one-service-failing-breaker)).
:::

Next: [§37 Duplicate requests → idempotency keys](/c/system-design/37-duplicate-requests-idempotency).
