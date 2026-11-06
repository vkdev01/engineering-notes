---
section: "10"
title: "Latency and throughput"
kicker: "Fundamentals"
abstract: "Latency is how long one request takes; throughput is how many finish per second. Queueing ties them together: response time grows like 1/(1 − utilisation), Little's law converts rate into concurrency, and fan-out turns a rare slow call into a common slow page."
time: "16 min"
order: 10
outcomes:
  - "Compute mean and p99 response time from utilisation with the M/M/1 model, and explain the hockey stick"
  - "Use Little's law to size thread pools, connection pools and in-flight limits"
  - "Size a server fleet for a peak QPS at a target utilisation, including losing a zone"
  - "Compute how often a fan-out request hits a backend's tail, and what hedging buys"
  - "Decide between batching, parallelising and removing round trips using a latency budget"
---

Pulse's API tier serves 6,000 feed requests per second at peak. Each request costs about 10 ms of CPU (illustrative), and a feed page needs 20 posts from a backend. Two questions decide the design: how many servers keep p99 under control at peak, and what happens to the page's latency when it waits on 20 backend calls? Neither has the answer "add up the averages". The first is a queueing question; the second is a probability question.

:::key[First principle]
A request's latency is its service time plus the time it waits in queues, and **the wait grows like $\rho/(1-\rho)$ as utilisation $\rho$ approaches 1** — at 90% busy, a 10 ms request takes 100 ms on average. Throughput is set by the bottleneck. And when one request waits on many, **the page is as slow as its slowest call**, so the backend's p99 becomes the page's p50.
:::

## 10.1 The words, precisely

- **Latency** — time for one operation, quoted as percentiles (p50, p95, p99): the *distribution* is the product, the mean describes nobody. Ninety-nine requests at 10 ms and one at 1,000 ms have a mean of 19.9 ms; the p99 user waited a second.
- **Throughput** — operations completed per second. Bounded by the slowest stage (the bottleneck).
- **Service time** $S$ — time a request spends being worked on. Capacity of one worker is $\mu = 1/S$.
- **Utilisation** — $\rho = \lambda / (c\,\mu)$ for arrival rate $\lambda$ and $c$ workers: the fraction of time they are busy.

## 10.2 Little's law: rate × time = concurrency

For any stable system, the average number of requests inside it equals arrival rate times average time inside:

$$
L = \lambda W
$$

No assumptions about distributions; it holds for a thread pool, a database, a queue, or a whole data centre.

:::example[Worked example · Little's law on Pulse]
| System | $\lambda$ | $W$ | In flight $L$ |
|---|---:|---:|---:|
| API tier at peak | 6,000 req/s | 50 ms (illustrative mean response) | 300 concurrent requests |
| Postgres at a 90% cache hit rate ([§7](/c/system-design/07-caching)) | 600 queries/s | 5 ms | 3 busy connections |
| Payment calls in a flash sale ([§9](/c/system-design/09-delivery-semantics)) | 2,000 calls/s | 300 ms (p50) | 600 concurrent calls |

The API tier needs ~300 request slots (threads, coroutines) across the fleet *on average* — more for bursts. The database pool needs only a handful of connections: a pool of 100 per server wastes memory on the database and hides overload. And if the payment provider slows to 2 s, the same arrival rate needs 4,000 slots; a fixed pool of 600 means the rest queue, which is §10.3.
:::

## 10.3 The hockey stick

Model one worker with random (Poisson) arrivals and exponential service times — the M/M/1 queue. Its mean response time, waiting plus service, is

$$
W = \frac{S}{1-\rho}, \qquad W_q = \frac{\rho\,S}{1-\rho}, \qquad p_{99} = \frac{S \ln 100}{1-\rho} \approx \frac{4.6\,S}{1-\rho}
$$

(the M/M/1 response time is exponential with rate $\mu - \lambda$, hence the $\ln 100$). Service-time *variability* matters too. For general service times with squared coefficient of variation $C_s^2$ (1 for exponential, 0 for constant), the Pollaczek–Khinchine formula gives

$$
W_q = \frac{\rho\,S}{1-\rho}\cdot\frac{1 + C_s^2}{2}
$$

so perfectly regular service halves the queueing delay but does not remove the $1/(1-\rho)$ blow-up.

:::example[Worked example · a 10 ms request at rising utilisation]
| $\rho$ | Mean response (M/M/1) | p99 (M/M/1) | Mean (constant service, M/D/1) |
|---:|---:|---:|---:|
| 0.5 | 20 ms | 92 ms | 15 ms |
| 0.6 | 25 ms | 115 ms | 17.5 ms |
| 0.8 | 50 ms | 230 ms | 30 ms |
| 0.9 | 100 ms | 461 ms | 55 ms |
| 0.95 | 200 ms | 921 ms | 105 ms |

Going from 50% to 90% busy multiplies the mean by 5 and the p99 from 92 ms to 461 ms. At 80%, a 10% burst in traffic (ρ → 0.88) adds ~33 ms to the mean; at 50%, the same burst adds ~2 ms. That nonlinearity is why fleets run at 50–70%, not 95%.
:::

:::chart[Response time vs utilisation for a 10 ms service time]{type="line" x="utilisation ρ" y="response time (ms)" xfmt="pct" ymax="1000" yfmt="int" band="0.5:0.7:target zone" dash="M/D/1 mean"}
rho, M/M/1 mean, M/M/1 p99, M/D/1 mean
0.1, 11.1, 51, 10.6
0.2, 12.5, 58, 11.2
0.3, 14.3, 66, 12.1
0.4, 16.7, 77, 13.3
0.5, 20.0, 92, 15.0
0.6, 25.0, 115, 17.5
0.7, 33.3, 154, 21.7
0.75, 40.0, 184, 25.0
0.8, 50.0, 230, 30.0
0.85, 66.7, 307, 38.3
0.9, 100.0, 461, 55.0
0.93, 142.9, 658, 76.4
0.95, 200.0, 921, 105.0
:::

The formulas are simple enough to distrust. A discrete-event simulation (the Lindley recursion: each request waits for whatever work the previous one left behind) checks them:

```python run
import numpy as np

rng = np.random.default_rng(11)
S = 10.0                  # mean service time, ms (illustrative API request)
N = 1_000_000             # requests per run


def simulate(rho, deterministic):
    """Single server, Poisson arrivals. Lindley: wait[n+1] = max(0, wait[n] + s[n] - gap[n+1])."""
    gaps = rng.exponential(S / rho, N)
    service = np.full(N, S) if deterministic else rng.exponential(S, N)
    wait = np.zeros(N)
    for n in range(1, N):
        wait[n] = max(0.0, wait[n - 1] + service[n - 1] - gaps[n])
    response = (wait + service)[N // 10:]          # drop warm-up
    return response.mean(), np.percentile(response, 99)


print("  rho | M/M/1 theory | M/M/1 sim mean   p99 | M/D/1 sim mean   p99")
for rho in (0.5, 0.7, 0.8, 0.9, 0.95):
    theory = S / (1 - rho)                          # M/M/1 mean response time
    mm_mean, mm_p99 = simulate(rho, deterministic=False)
    md_mean, md_p99 = simulate(rho, deterministic=True)
    print("%5.2f | %9.1f ms | %11.1f %6.0f | %11.1f %6.0f" % (
        rho, theory, mm_mean, mm_p99, md_mean, md_p99))
```

```output
  rho | M/M/1 theory | M/M/1 sim mean   p99 | M/D/1 sim mean   p99
 0.50 |      20.0 ms |        19.9     91 |        15.0     44
 0.70 |      33.3 ms |        32.9    151 |        21.7     74
 0.80 |      50.0 ms |        50.4    232 |        29.9    112
 0.90 |     100.0 ms |        99.2    473 |        54.0    224
 0.95 |     200.0 ms |       190.6    860 |       106.3    469
```

The simulation lands within a few percent of $S/(1-\rho)$ and $4.6S/(1-\rho)$ up to 90%; at 95% even 900,000 requests barely converge (190.6 vs 200 ms; p99 860 vs 921 ms) — near saturation the queue has a long memory, which is another way of saying it is unstable. The M/D/1 column matches the Pollaczek–Khinchine mean (55 ms at ρ = 0.9).

:::tip[Pooling beats speed at the same utilisation]
$c$ workers sharing one queue (M/M/c) wait much less than $c$ separate single-worker queues at the same $\rho$, because an idle worker can take any request. That's why one load balancer in front of a pool beats per-server sticky queues, and why the M/M/1 curve is a conservative estimate for a multi-core server.
:::

## 10.4 Sizing a fleet

$$
\text{servers} = \left\lceil \frac{\text{peak QPS}}{\text{per-server capacity} \times \rho_{\text{target}}} \right\rceil
$$

:::example[Worked example · Pulse's API tier]
Each request needs 10 ms of CPU; a server has 8 cores (illustrative), so capacity is \(8 \times 1{,}000/10\) = 800 req/s. At a 60% target, a server takes 480 req/s:

$$
\frac{6{,}000}{480} = 12.5 \Rightarrow 13 \text{ servers } (\rho = 0.58)
$$

Now lose one of three availability zones. Spread 5/4/4, losing the 5-server zone leaves 8 servers at \(6{,}000 / (8 \times 800)\) = 94% — deep in the hockey stick, p99 measured in seconds, during an incident. Provision **15 servers, 5 per zone**: 50% normally, \(6{,}000 / (10 \times 800)\) = 75% with a zone down. Zone-loss headroom, not average load, sets the fleet size.
:::

Two corrections every real sizing needs: measure per-server capacity with a load test at your target p99 (not CPU math alone — locks, GC and I/O cut it), and remember the bottleneck may be downstream: 6,000 req/s with 5 ms of database time each would need 30 busy database connections if the cache were cold.

## 10.5 Tail latency under fan-out

A feed page that calls $N$ backends in parallel finishes when the *slowest* call returns. If each call independently exceeds its p99 with probability $p = 0.01$:

$$
P(\text{page waits on at least one tail call}) = 1 - (1-p)^N
$$

| $N$ calls | $p$ = 0.1% | $p$ = 1% | $p$ = 5% |
|---:|---:|---:|---:|
| 1 | 0.1% | 1.0% | 5.0% |
| 5 | 0.5% | 4.9% | 22.6% |
| 20 | 2.0% | 18.2% | 64.2% |
| 100 | 9.5% | 63.4% | 99.4% |

Pulse's page with 20 parallel post fetches hits a backend p99 on 18% of page loads; at 100 calls, on most of them. The backend's p99 has become the page's median experience.

:::chart[Probability a fan-out request hits at least one slow call]{type="line" x="parallel calls N" y="P(at least one slow)" xlog="true" yfmt="pct" ymin="0" ymax="1" marks="20:Pulse feed page"}
N, p=0.1%, p=1%, p=5%
1, 0.001, 0.010, 0.050
2, 0.002, 0.020, 0.098
5, 0.005, 0.049, 0.226
10, 0.010, 0.096, 0.401
20, 0.020, 0.182, 0.642
50, 0.049, 0.395, 0.923
100, 0.095, 0.634, 0.994
200, 0.181, 0.866, 1.000
:::

**Hedged requests** cut the tail: if a call hasn't returned by the backend's p95, send a duplicate to another replica and take whichever answers first. Only ~5% of calls get a second copy, but a call is now slow only if *both* copies are. The simulation uses an illustrative lognormal backend (median 5 ms, p99 ≈ 50 ms):

```python run
import numpy as np

rng = np.random.default_rng(5)
PAGES = 100_000
# Backend call latency (illustrative): lognormal, median 5 ms, p99 about 50 ms
MU, SIGMA = np.log(5.0), 0.99


def call(shape):
    return rng.lognormal(MU, SIGMA, shape)


one = call(1_000_000)
p95_single = np.percentile(one, 95)
print("single call: p50 %.1f ms, p99 %.1f ms, p95 %.1f ms" % (
    np.percentile(one, 50), np.percentile(one, 99), p95_single))

print("fan-out N | page p50 | page p99 | P(page waits on a call's p99 tail) | hedged p99")
for n in (1, 5, 20, 100):
    page = call((PAGES, n)).max(axis=1)                 # parallel: wait for the slowest
    first, backup = call((PAGES, n)), call((PAGES, n))
    hedged = np.minimum(first, p95_single + backup)     # resend if no reply by single-call p95
    print("%9d | %5.1f ms | %5.1f ms | %33.3f | %7.1f ms" % (
        n, np.percentile(page, 50), np.percentile(page, 99),
        1 - 0.99 ** n, np.percentile(hedged.max(axis=1), 99)))
extra = (first > p95_single).mean()
print("hedging sends %.1f%% extra calls" % (100 * extra))
```

```output
single call: p50 5.0 ms, p99 50.1 ms, p95 25.5 ms
fan-out N | page p50 | page p99 | P(page waits on a call's p99 tail) | hedged p99
        1 |   5.0 ms |  49.6 ms |                             0.010 |    32.7 ms
        5 |  15.3 ms |  85.4 ms |                             0.049 |    41.1 ms
       20 |  30.4 ms | 130.7 ms |                             0.182 |    50.5 ms
      100 |  57.3 ms | 196.6 ms |                             0.634 |    63.8 ms
hedging sends 5.0% extra calls
```

At $N = 20$ the page median (30.4 ms) is already 6× a single call's median, and the page p99 is 130.7 ms. Hedging at the p95 cuts that p99 to 50.5 ms — the single call's own p99 — for 5% more backend calls. It only works when slowness is per-replica (GC pause, noisy neighbour, a cold cache); if the backend is overloaded, hedging adds 5% load to the thing that is already slow, so cap it with a budget.

Other tail-cutters, in order of preference:

1. **Fewer calls.** One multi-get for 20 posts replaces 20 tail draws with one ($N = 1$: 1% instead of 18%).
2. **Timeouts with partial results.** Render the page with 19 posts if the 20th misses a 40 ms deadline.
3. **Hedging or tied requests** as above.
4. **Fix the backend's tail** — usually queueing (§10.3), GC, or lock contention; a p99 that is 10× the p50 almost always means waiting, not work.

## 10.6 Sequential calls add, parallel calls max

For $k$ sequential calls the latencies add, so means add and tails compound; for parallel calls, the page pays the maximum. Forty sequential 0.5 ms cache round trips cost 20 ms — and forty sequential 5 ms backend calls cost 200 ms, the whole budget. Counting sequential round trips on the critical path is the fastest latency review there is.

A latency budget makes that count visible. For a 200 ms p95 target on Pulse's server-rendered feed (illustrative allocation):

| Stage | Budget |
|---|---:|
| TLS + connection reuse | 20 ms |
| Auth (cached token check) | 5 ms |
| Post fetch (one multi-get, hedged) | 60 ms |
| Cache lookups | 5 ms |
| Database (indexed, one round trip) | 20 ms |
| Serialisation + rendering | 30 ms |
| Headroom | 60 ms |
| **Total** | **200 ms** |

Percentiles don't add exactly — the sum of stage p95s overstates the p95 of the sum — so a budget built this way is conservative, which is what you want.

## 10.7 Throughput levers and what they cost

**Batching** amortises the fixed cost per round trip. With a 0.5 ms round trip and 0.01 ms of work per item (illustrative), time per item is $0.5/B + 0.01$ ms:

| Batch size $B$ | ms per item | Items/s per connection | Time to fill a batch at 6,000 items/s |
|---:|---:|---:|---:|
| 1 | 0.510 | 1,961 | 0.17 ms |
| 10 | 0.060 | 16,667 | 1.7 ms |
| 100 | 0.015 | 66,667 | 17 ms |
| 1,000 | 0.011 | 95,238 | 167 ms |

Throughput rises 34× from $B$ = 1 to $B$ = 100, then flattens, while the wait to fill a batch keeps growing. Batch up to a size *or* a short deadline (e.g. 100 items or 5 ms), whichever comes first.

| Technique | Raises throughput by | Costs |
|---|---|---|
| Batching | Amortising round trips and per-call overhead | Fill delay; partial-failure handling |
| Pipelining / multiplexing | Many requests in flight per connection | Head-of-line blocking |
| Concurrency (async, threads) | Overlapping I/O waits (Little's law) | Memory per in-flight request; pools that fill on failure |
| Caching | Removing work ([§7](/c/system-design/07-caching)) | Staleness, invalidation |
| Queueing writes | Decoupling arrival from processing rate ([§9](/c/system-design/09-delivery-semantics)) | Completion becomes asynchronous |
| More servers | Lower $\rho$ at the same load | Money; the bottleneck may move downstream |

## 10.8 Rules of thumb

- **Run at 50–70% utilisation**; above ~80% the M/M/1 mean is 5× the service time and climbing steeply.
- **Size for losing a zone**: with three zones, each zone's loss must leave the rest under ~75%.
- **Little's law sizes every pool**: slots = rate × time in system, at the tail latency you must survive.
- **A p99 10× the p50 means queueing, GC or locks**, not slow code.
- **Fan-out multiplies tails**: 20 parallel calls turn a backend's 1% tail into 18% of pages. Batch first, hedge second.
- **Alert on p99 and on utilisation**, not on mean latency.

## 10.9 Check yourself

:::qa[A service with 20 ms service time runs at 85% utilisation. Estimate mean and p99 response time (M/M/1). What does adding 20% more servers do?]
Mean \(= 20/(1-0.85)\) ≈ 133 ms; p99 ≈ \(4.6 \times 133\) ≈ 613 ms. With 20% more capacity, ρ = 0.85/1.2 ≈ 0.71: mean ≈ \(20/0.29\) ≈ 69 ms, p99 ≈ 317 ms. Twenty percent more hardware halves latency — because the system was on the steep part of the curve.
:::

:::qa[A worker pool processes 1,500 jobs/s, each taking 40 ms on average. How many workers are busy on average? How many do you provision?]
$L = \lambda W$ = 1,500 × 0.04 = 60 busy on average. To keep ρ ≈ 0.6, provision 60 / 0.6 = 100 workers, then check the job-time p99: if jobs sometimes take 400 ms, a burst needs far more slots.
:::

:::qa[A request fans out to 50 shards in parallel; each shard is slow 1% of the time. What fraction of requests are slow, and what is the cheapest fix?]
\(1 - 0.99^{50}\) ≈ 39.5%. Cheapest fixes: reduce $N$ (route to the shards that hold relevant data, or pre-aggregate), then hedge or return partial results with a deadline.
:::

:::qa[Pulse's 15-server fleet runs at 50%. Someone proposes cutting to 10 servers to save money, since "utilisation will only be 75%". What do you say?]
At 10 servers, normal ρ = 0.75 gives a mean of 4× service time instead of 2× (p99 ≈ 184 ms vs 92 ms for a 10 ms request), and losing a zone (spread 4/3/3) leaves 6–7 servers at 107–125% of capacity — overload, an unbounded queue. The extra five servers are the zone-failure budget, not waste.
:::

Next: [§11 Networking](/c/system-design/11-networking) — where the round-trip milliseconds in these budgets come from.
