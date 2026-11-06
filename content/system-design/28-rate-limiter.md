---
section: "28"
title: "Rate limiter"
kicker: "Building blocks"
abstract: "Decides how much each caller may send and rejects the excess cheaply. Compare the algorithms by the worst burst they admit, size rate and burst from capacity, see why splitting a limit across gateways under-admits honest clients, and size the counter store."
time: "13 min"
order: 28
outcomes:
  - "Compute the worst-case burst each algorithm admits: 2L for a fixed window, b + rt for a token bucket"
  - "Choose a token bucket's rate and burst from downstream capacity and client behaviour"
  - "Decide between a central counter store and per-gateway limits using measured admission error"
  - "Size limiter memory and request overhead for Pulse and the checkout flash sale"
---

The checkout flash sale from [§2](/c/system-design/02-estimation) peaks at 2,000 orders a second against a steady 50. The payment provider behind it has a contracted quota (2,500 calls/s here, illustrative), and bots open hundreds of checkout attempts per second per account hoping to grab stock. Without limits, the bots consume inventory and the quota, real customers time out, and the provider starts returning 429s to everyone. A rate limiter answers one question per request — *may this caller do this now?* — in well under a millisecond, and says no with a 429 that costs almost nothing.

:::key[First principle]
A rate limit is a promise about **how much may arrive in any interval**, not just per window. Token bucket states it directly: in any interval of length $t$ a caller gets at most $b + r\,t$ — a sustained rate $r$ plus a burst $b$, two independent knobs. Pick $r$ from what the protected resource can serve, $b$ from the bursts honest callers make, and keep the check cheaper than the work it protects.
:::

## 28.1 The algorithms, and the burst each allows

For a limit of $L$ requests per window $W$:

| Algorithm | State per key | Admits in any interval of length $W$ | Notes |
|---|---|---|---|
| **Fixed window** | 1 counter | up to $2L$ (end of one window + start of the next) | Simplest; boundary bursts are real |
| **Sliding log** | up to $L$ timestamps | exactly $\le L$ | Precise; memory grows with the limit |
| **Sliding window counter** | 2 counters | ≈ $L$ (estimate: $\text{prev}\cdot(1-f) + \text{cur}$, $f$ = fraction of current window elapsed) | Assumes the previous window was uniform; small overshoot |
| **Token bucket** ($r$, $b$) | tokens + timestamp | $\le b + rW$ | Controlled bursts; the usual default |
| **Leaky bucket** (queue) | a queue | output exactly $r$ | Smooths output by adding delay |

Token bucket in one line: tokens refill at $r$ per second up to $b$; a request spends one or is rejected. Its guarantee follows from the bucket never holding more than $b$:

$$
\text{admitted in } [t, t+\tau] \le b + r\,\tau
$$

The simulation sets every algorithm to "100 per second" and replays three patterns: a client flooding at 1,000/s, an attacker sending 100 requests just before and 100 just after a window boundary, and honest traffic at 60/s with a 150-request burst.

```python run
"""Four rate limiters, all set to '100 requests per second', under three traffic patterns."""
import numpy as np
from collections import deque

L, W = 100, 1.0                                   # limit per window, window seconds


def fixed(ts):
    win, n, out = -1, 0, []
    for t in ts:
        if int(t // W) != win:
            win, n = int(t // W), 0
        out.append(n < L)
        n += out[-1]
    return out


def sliding_log(ts):
    log, out = deque(), []
    for t in ts:
        while log and log[0] <= t - W:
            log.popleft()
        out.append(len(log) < L)
        if out[-1]:
            log.append(t)
    return out


def sliding_counter(ts):
    cur_win, prev, cur, out = 0, 0, 0, []
    for t in ts:
        w = int(t // W)
        if w != cur_win:
            prev, cur, cur_win = (cur if w == cur_win + 1 else 0), 0, w
        est = prev * (1 - (t % W) / W) + cur      # weight last window by its overlap
        out.append(est < L)
        cur += out[-1]
    return out


def token_bucket(ts, rate=100.0, burst=20.0):
    tokens, last, out = burst, 0.0, []
    for t in ts:
        tokens = min(burst, tokens + (t - last) * rate)
        last = t
        out.append(tokens >= 1)
        tokens -= out[-1]
    return out


rng = np.random.default_rng(5)
traffic = {
    "flood 1000/s": np.arange(0, 3, 0.001),
    "boundary 2x100": np.concatenate([np.linspace(0.99, 0.999, 100), np.linspace(1.0, 1.009, 100)]),
    "60/s + 150 burst": np.sort(np.concatenate([rng.uniform(0, 3, 180), rng.uniform(1.5, 2.0, 150)])),
}
algos = {"fixed": fixed, "sliding log": sliding_log, "sliding counter": sliding_counter,
         "bucket b=20": token_bucket, "bucket b=100": lambda ts: token_bucket(ts, burst=100)}
for name, ts in traffic.items():
    print("%s (%d offered)    admitted  max/any 1 s  max/any 100 ms" % (name, len(ts)))
    for a, f in algos.items():
        ok = np.array(ts)[np.array(f(ts), dtype=bool)]
        m1 = max(np.searchsorted(ok, t + W, "left") - i for i, t in enumerate(ok))
        m01 = max(np.searchsorted(ok, t + 0.1, "left") - i for i, t in enumerate(ok))
        print("  %-16s %8d %12d %15d" % (a, len(ok), m1, m01))
```

```output
flood 1000/s (3000 offered)    admitted  max/any 1 s  max/any 100 ms
  fixed                 300          101             100
  sliding log           300          100             100
  sliding counter       300          101             100
  bucket b=20           319          119              29
  bucket b=100          399          199             101
boundary 2x100 (200 offered)    admitted  max/any 1 s  max/any 100 ms
  fixed                 200          200             200
  sliding log           100          100             100
  sliding counter       101          101             101
  bucket b=20            21           21              21
  bucket b=100          101          101             101
60/s + 150 burst (330 offered)    admitted  max/any 1 s  max/any 100 ms
  fixed                 219          122              47
  sliding log           212          100              41
  sliding counter       218          106              43
  bucket b=20           219          107              29
  bucket b=100          299          187              48
```

:::chart[Admitted per 100 ms while a client floods at 1,000 requests/s (limit 100/s)]{type="line" x="seconds" y="requests admitted per 100 ms"}
seconds, fixed window, sliding window counter, token bucket b=20
0.0, 100, 100, 29
0.1, 0, 0, 10
0.2, 0, 0, 10
0.3, 0, 0, 9
0.4, 0, 0, 10
0.5, 0, 0, 10
0.6, 0, 0, 10
0.7, 0, 0, 10
0.8, 0, 0, 10
0.9, 0, 0, 10
1.0, 100, 10, 10
1.1, 0, 10, 10
1.2, 0, 10, 10
1.3, 0, 10, 10
1.4, 0, 10, 10
1.5, 0, 10, 10
1.6, 0, 10, 10
1.7, 0, 10, 10
1.8, 0, 10, 10
1.9, 0, 10, 10
2.0, 100, 10, 10
2.1, 0, 10, 10
2.2, 0, 10, 10
2.3, 0, 10, 10
2.4, 0, 10, 10
2.5, 0, 10, 10
2.6, 0, 10, 10
2.7, 0, 10, 10
2.8, 0, 10, 10
2.9, 0, 10, 10
:::

What the numbers say:

- **The fixed window admits 200 requests in 20 ms** at the boundary — 2L, exactly the bound — and under a flood delivers each second's quota in the first 100 ms. The protected service sees a wall of 100 requests ten times faster than "100 per second" suggests.
- **The sliding log is exact** (never more than 100 in any second) but stores up to 100 timestamps per key.
- **The sliding counter** is within a few percent (101–106 in any second) with two integers of state, and after its first window it spreads admissions evenly.
- **The token bucket** matches $b + r\tau$: 119 with $b = 20$ and 199 with $b = 100$ in any second; with $b = 20$, never more than 29 in 100 ms. Choosing $b$ *is* choosing how bursty the downstream load may be.

## 28.2 Choosing rate and burst

$$
r = \frac{\text{capacity of the protected resource} \times \rho_{\text{target}}}{\text{number of callers sharing it}}, \qquad
b = r \times (\text{burst duration honest callers need})
$$

:::example[Worked example · checkout during the flash sale]
**Global limit on payment calls.** Quota 2,500 calls/s (illustrative); keep 4% headroom for retries and refunds: $r$ = 2,400/s. The sale's 2,000 orders/s fits; a burst allowance of $b$ = 400 absorbs a 200 ms spike at double rate. By Little's law ([§10.2](/c/system-design/10-latency-and-throughput)), 400 requests released together are up to 400 extra provider calls in flight for ~300 ms (p50) — the number to check against the provider's concurrency limit.

**Per-account limit on `POST /checkout`.** A person completes at most a few checkouts a minute; allow $r$ = 1/s with $b$ = 5 (illustrative). A bot firing 50/s gets \(5 + 1 \times 60\) = 65 attempts in its first minute instead of 3,000 — 2% of what it asked for — while a human retrying a failed card never notices.
:::

Rules of thumb:

- **Layer limits**: per key or account (fairness), per IP (abuse — but carrier NAT puts thousands of users behind one address, so keep IP limits loose), per endpoint (expensive search gets a tighter bucket than cheap reads), and a global limit per dependency.
- **Put the limiter in front of the expensive work**: after authentication (to know the key) but *before* calls to the database or provider. Cached responses can bypass it or use a looser bucket.
- **Respond with 429 and `Retry-After`** = time until the next token, $(1 - \text{tokens})/r$, plus jitter so rejected clients do not return in lockstep ([retry](/c/system-design/30-retry)).
- **Pair rate with concurrency.** A rate limit bounds arrivals; a semaphore per dependency bounds in-flight work. When the provider slows from 300 ms to 2 s, the same 2,000 calls/s become 4,000 in flight ([§10.2](/c/system-design/10-latency-and-throughput)) — only a concurrency limit catches that.

## 28.3 Distributed limiting: shared counters or split budgets

Pulse's gateways and the checkout API each run on many instances. A limit of 100/s enforced independently by each of $N$ instances is really $N \times 100$/s. Two fixes:

1. **Central store** — the bucket lives in Redis and is updated by an atomic script (read tokens and timestamp, refill, decrement, write back, set a TTL). Exact, at the cost of one round trip per request (~0.5 ms intra-DC, [§2](/c/system-design/02-estimation)) and a hard dependency.
2. **Split budget** — each instance enforces $r/N$ with burst $b/N$ locally. No extra hop, but the load balancer spreads one client's requests randomly, and small per-instance buckets reject honest traffic:

```python run
"""Distributed limiting: one shared bucket vs the limit split across N gateways behind a random LB."""
import numpy as np

rng = np.random.default_rng(9)
RATE, BURST, SECONDS = 100.0, 20.0, 200


def admitted(ts, rate, burst):
    tokens, last, n = burst, 0.0, 0
    for t in ts:
        tokens = min(burst, tokens + (t - last) * rate)
        last = t
        if tokens >= 1:
            tokens -= 1
            n += 1
    return n


for offered in (80, 100, 150):
    ts = np.sort(rng.uniform(0, SECONDS, int(offered * SECONDS)))   # Poisson-like arrivals
    row = ["central %5.1f/s" % (admitted(ts, RATE, BURST) / SECONDS)]
    for n in (4, 16):
        gw = rng.integers(0, n, len(ts))                            # random load balancing
        got = sum(admitted(ts[gw == g], RATE / n, max(1.0, BURST / n)) for g in range(n))
        row.append("split N=%-2d %5.1f/s" % (n, got / SECONDS))
    print("client offers %3d/s (limit 100): %s" % (offered, " | ".join(row)))
```

```output
client offers  80/s (limit 100): central  80.0/s | split N=4   77.0/s | split N=16  49.2/s
client offers 100/s (limit 100): central  97.7/s | split N=4   89.7/s | split N=16  56.1/s
client offers 150/s (limit 100): central 100.1/s | split N=4   99.3/s | split N=16  68.7/s
```

A client *under* its limit (80/s) loses 39% of its requests when the limit is split 16 ways: each instance gets a bucket of 6.25/s with a burst of ~1, and Poisson arrivals routinely bring two requests close together. Splitting works when per-instance limits stay large (tens of requests of burst per instance) or the limit is a coarse abuse guardrail; for customer-facing quotas use the central store, or hash each key to one limiter instance so its bucket is whole.

Middle ground: local buckets that sync counts to the central store every $\Delta$ seconds. Overshoot is bounded by $N \cdot r \cdot \Delta$ — at $N$ = 16, $r$ = 100/s and $\Delta$ = 0.1 s, up to 160 extra requests per sync interval in the worst case.

## 28.4 Sizing the counter store

Memory per key is the state plus the store's per-key overhead (~80 B in Redis, illustrative); keys expire after the time a bucket takes to refill, $b/r$, because a full bucket is the same as no key.

| Case | Keys alive | Bytes per key | Memory |
|---|---:|---:|---:|
| Pulse, per-user bucket $r$ = 10/s, $b$ = 20 → TTL 2 s | ≤ requests in 2 s at peak: \(6{,}600 \times 2\) = 13,200 | ~100 | 1.3 MB |
| Same users, sliding log with 600/min | users active in 60 s ≤ \(6{,}600 \times 60\) = 396,000 | 80 + 8 per logged request | ≤ 35 MB at typical use; 4.8 KB for a key at its limit |
| Botnet: 1M IPs, each at its limit, token bucket | 1,000,000 | ~100 | 100 MB |
| Same botnet, sliding log at 600/min | 1,000,000 | 80 + 600 × 8 = 4,880 | 4.9 GB |

Throughput: Pulse's peak is 6,000 reads + 600 writes = 6,600 limiter checks/s — one Redis primary handles that with room to spare (each check is one script execution), and the 0.5 ms round trip is small next to a 50 ms response. Shard the limiter by key hash when checks approach a node's measured ceiling; one key's state never needs to span nodes.

:::warn[Fail open or fail closed — decide before the outage]
If the limiter store is down, failing closed rejects every request: your protection has become the outage. Fail **open** (allow, log, alert) for fairness and abuse guardrails, and keep a coarse local limit as a backstop. Fail **closed** only where the limit is a contract — the provider quota or a billing meter — and even then, a local per-instance bucket at $r/N$ is better than zero.
:::

## 28.5 Configuration defaults

| Knob | Default | Why |
|---|---|---|
| Algorithm | Token bucket; sliding window counter for "N per minute" quotas | Bounded bursts, O(1) state |
| Burst $b$ | 1–5 s of rate for APIs; 2–20 for human actions | Honest bursts pass, floods do not |
| Key TTL | $b/r$ (time to refill) plus slack | Full bucket = no key |
| Global limit per dependency | ~95% of the dependency's quota | Leave room for retries and admin traffic |
| Response | 429, `Retry-After` = time to next token + jitter | Clients back off without synchronising |
| Store failure | Fail open with a local backstop (guardrails); fail closed for quotas | §28.4 warning |
| Concurrency limit | Little's law: rate × p99 latency, e.g. 2,000/s × 2 s = 4,000 provider calls | Rate limits miss slowdowns |

## 28.6 Failure modes

| Failure | Symptom | Fix |
|---|---|---|
| Fixed-window boundary burst | 2× load spikes at the top of every window | Sliding counter or token bucket |
| Limit enforced per instance | Effective limit is $N \times$ the intended one | Central store or hash keys to limiter nodes |
| Limit split too finely | Honest clients get 429s below their quota | Larger per-node bursts or a central store (§28.3) |
| Keys without TTL | Store memory grows for months | TTL = $b/r$ on every write |
| Per-IP limits behind carrier NAT | One busy IP blocks thousands of users | Prefer per-account keys; loose IP limits |
| Synchronised `Retry-After` | Rejected clients return in a wave | Add jitter to the value |
| Limiter after the expensive call | Rejection costs as much as success | Check before touching the database or provider |

## 28.7 Check yourself

:::qa[An API allows 1,000 requests per minute with a fixed window. What is the most a client can send in 2 seconds, and how do you prevent it?]
2,000: 1,000 in the last second of one minute and 1,000 in the first second of the next. A token bucket with $r$ = 1,000/60 ≈ 16.7/s and $b$ = 50 caps any 2-second interval at \(50 + 2 \times 16.7\) ≈ 83.
:::

:::qa[Your token bucket has r = 100/s and b = 500. A client has been idle. What is the most it can send in its first second, and is that a problem?]
$b + r \times 1$ = 600. Whether that hurts depends on the downstream: 500 requests at once means up to 500 concurrent calls by Little's law. If the backend's pool is 100, lower $b$ or add a concurrency limit.
:::

:::qa[You run 16 gateways and split a 100/s per-key limit evenly. Customers complain about 429s while their dashboards show 60/s. Why?]
Each gateway gives the key 6.25/s with a burst of ~1. Random load balancing sends clusters of requests to the same gateway, and with almost no burst those are rejected — the simulation shows a client at 80/s admitted at only 49/s. Move to a central store or route each key to one limiter.
:::

:::qa[How much Redis memory does a per-IP token-bucket limiter need during a 1M-IP botnet attack, and what changes with a sliding log?]
About 1,000,000 × ~100 B = 100 MB for token buckets. A sliding log stores a timestamp per admitted request: at 600/min each key holds 600 × 8 B + overhead ≈ 4.9 KB, so ~4.9 GB — 49× more, exactly when you can least afford it.
:::

Next: [Read replicas](/c/system-design/29-read-replicas) — adding read capacity once traffic has been shaped.
