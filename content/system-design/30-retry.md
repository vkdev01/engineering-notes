---
section: "30"
title: "Retry and backoff"
kicker: "Building blocks"
abstract: "A retry is a second draw: nearly free when failures are independent, a load multiplier when they are correlated. Compute what retries cost, simulate a retry storm with and without jitter, bound retries with a budget and a deadline, and retry only what is safe to repeat."
time: "13 min"
order: 30
outcomes:
  - "Compute retry load: about 1 + p in normal operation, (1 + r)^d in an outage across d layers"
  - "Choose backoff with full jitter and size attempts and cap so the retry window covers recovery"
  - "Size a retry budget and per-attempt timeouts that fit a caller's deadline"
  - "Decide which errors are retryable and which need an idempotency key first"
---

The checkout flash sale opens at noon. Five thousand shoppers who have been staring at a countdown tap **Buy** within the same 100 ms; checkout admits 2,500 orders/s (the payment quota from [§28](/c/system-design/28-rate-limiter), illustrative) on top of ~1,000/s of other traffic, and rejects the excess fast with a 503. Every client retries. Whether the sale serves ~5,000 orders in four seconds or turns away 3,500 shoppers depends on nothing but *how* those clients wait between attempts. The same retries, a few minutes later during a provider outage, decide whether checkout sees 1.1× its normal load or 64×.

:::key[First principle]
A retry is a second draw. If failures are independent it is almost free (extra load ≈ the failure rate) and turns a 1% error rate into one in a hundred million; if failures are correlated — an outage, an overload — every retry fails too and only adds load, multiplied at every layer that retries. So: retry only what is retryable and safe to repeat, spread retries with full jitter, stop at a deadline, and cap retries with a budget.
:::

## 30.1 What a retry buys, and what it costs

With independent failure probability $p$ per attempt and up to $r$ retries ([§6.6](/c/system-design/06-availability) derives it), attempt $k+1$ happens only if the first $k$ failed:

$$
P(\text{request fails}) = p^{\,r+1}, \qquad \text{load per request} = \sum_{k=0}^{r} p^k \approx 1 + p .
$$

In an outage $p = 1$: each layer makes \(1 + r\) attempts, and if the layer above also retries each of its failures, the attempts multiply:

$$
\text{attempts at the bottom} = (1 + r)^d \quad \text{for } d \text{ layers that each retry } r \text{ times.}
$$

```python run
"""What r retries cost and buy: independent blips vs an outage, one layer vs a stack of d layers."""
R = 3                                         # retries per call (4 attempts)

print("independent failures, one layer with r = %d" % R)
print("  p(fail)   load per request   P(request fails)   extra calls at 2,000/s")
for p in (0.001, 0.01, 0.05, 0.1, 0.3, 0.5):
    load = sum(p ** k for k in range(R + 1))  # attempt k+1 happens only if the first k failed
    print("  %6.3f %14.3fx %18.1e %15.0f/s" % (p, load, p ** (R + 1), 2_000 * (load - 1)))

print("\noutage (p = 1): every layer retries every failure -> (1 + r)^d attempts at the bottom")
print("  depth   r = 2   r = 3   retry budget 10%/layer")
for d in (1, 2, 3, 4):
    print("  %5d %6dx %6dx %12.2fx" % (d, 3 ** d, (R + 1) ** d, 1.1 ** d))
```

```output
independent failures, one layer with r = 3
  p(fail)   load per request   P(request fails)   extra calls at 2,000/s
   0.001          1.001x            1.0e-12               2/s
   0.010          1.010x            1.0e-08              20/s
   0.050          1.053x            6.3e-06             105/s
   0.100          1.111x            1.0e-04             222/s
   0.300          1.417x            8.1e-03             834/s
   0.500          1.875x            6.2e-02            1750/s

outage (p = 1): every layer retries every failure -> (1 + r)^d attempts at the bottom
  depth   r = 2   r = 3   retry budget 10%/layer
      1      3x      4x         1.10x
      2      9x     16x         1.21x
      3     27x     64x         1.33x
      4     81x    256x         1.46x
```

:::example[Worked example · checkout's retry stack during a provider outage]
A tap on **Buy** passes through the mobile app, the API gateway, the checkout service and the payment client. If each retries twice, a provider outage turns the flash sale's 2,000 orders/s into \(2{,}000 \times 3^4\) = 162,000 calls/s at the provider — 65× its 2,500/s quota, hammering it exactly while it tries to recover. With **one** layer retrying (the payment client, which knows the call is idempotent) it is \(2{,}000 \times 3\) = 6,000/s; with a 10% retry budget, 2,200/s.
:::

The two halves of the table are the whole design problem. A 1% blip rate costs 20 extra calls/s at 2,000/s and buys eight nines of masking (if the blips really are independent). An outage costs 4× at one layer and 64× at three. The fixes in the rest of this section — jitter, deadlines, budgets, one retrying layer — keep the first half and remove the second.

## 30.2 Backoff and jitter: the retry storm

Waiting before a retry gives a transient fault time to clear. *How* clients wait decides whether their retries arrive as a wall or a ramp:

| Strategy | Delay before retry $n$ (0-based) | Behaviour |
|---|---|---|
| None | 0 | A tight loop: all attempts land within milliseconds |
| Exponential | $\min(\text{cap}, b \cdot 2^n)$ | Clients that failed together retry together, forever |
| Exponential + **full jitter** | $\text{uniform}(0, \min(\text{cap}, b \cdot 2^n))$ | Spreads each wave over its whole interval; the default |
| Decorrelated jitter | $\min(\text{cap}, \text{uniform}(b, 3 \cdot \text{prev}))$ | Grows from the previous delay; good for long-lived clients |

The simulation runs the noon opening on 10 ms ticks: 5,000 requests in the first 100 ms, ~1,000/s of background traffic, 25 admissions per tick (2,500/s), excess rejected and retried; $b$ = 100 ms, cap = 2 s, 6 attempts (all illustrative).

```python run
"""Retry storm at the flash-sale opening: 5,000 shoppers tap Buy in the same 100 ms; checkout admits 2,500/s."""
import numpy as np

TICK, CAP, BG, T = 0.01, 25, 10, 1_000       # 10 ms ticks; admit 25/tick = 2,500/s; background 1,000/s; 10 s
BURST, BASE, MAXD = 5_000, 0.1, 2.0          # illustrative: burst size, first backoff, backoff cap


def delay(policy, n, prev, rng):
    ceil = min(MAXD, BASE * 2 ** n)          # n = retries already made
    if policy == "no backoff":
        return TICK
    if policy == "exponential":
        return ceil
    if policy == "full jitter":
        return rng.uniform(0, ceil)
    return min(MAXD, rng.uniform(BASE, 3 * prev))   # decorrelated jitter


def run(policy, attempts=6, seed=1):
    rng = np.random.default_rng(seed)
    due = [[] for _ in range(T + 300)]       # per tick: list of (retries made, previous delay)
    for t in rng.integers(0, 10, BURST):
        due[t].append((0, BASE))
    offered, served, gave_up, tries, bg_rej, last = np.zeros(T), 0, 0, 0, 0, 0.0
    for t in range(T):
        bg, reqs = rng.poisson(BG), due[t]
        offered[t], tries = len(reqs) + bg, tries + len(reqs)
        ok = rng.permutation(len(reqs) + bg) < CAP           # admit CAP at random
        bg_rej += int((~ok[len(reqs):]).sum())
        for (n, prev), admitted in zip(reqs, ok):
            if admitted:
                served, last = served + 1, t * TICK
            elif n + 1 >= attempts:
                gave_up += 1
            else:
                d = delay(policy, n, prev, rng)
                due[t + max(1, round(d / TICK))].append((n + 1, d))
    used = np.minimum(offered[:300], CAP).sum() / (300 * CAP)   # share of capacity used in first 3 s
    return served, gave_up, bg_rej, tries, last, used


print("policy (attempts)   served  gave up  bg rejected  attempts  last ok  capacity used 0-3 s")
for p, a in (("no backoff", 6), ("exponential", 6), ("full jitter", 6),
             ("decorrelated", 6), ("full jitter", 8)):
    s, g, rej, tries, last, used = run(p, a)
    print("%-16s(%d) %7d %8d %12d %9d %6.2f s %12.0f%%" % (p, a, s, g, rej, tries, last, 100 * used))
```

```output
policy (attempts)   served  gave up  bg rejected  attempts  last ok  capacity used 0-3 s
no backoff      (6)     372     4628          153     29054   0.14 s           43%
exponential     (6)    1468     3532          584     26323   3.19 s           50%
full jitter     (6)    4387      613         1014     24854   2.81 s           85%
decorrelated    (6)    4806      194         1039     19399   4.03 s           87%
full jitter     (8)    4993        7         1052     25608   4.09 s           90%
```

:::chart[Requests offered per 100 ms after the noon burst: exponential backoff arrives in waves, full jitter as a ramp (simulated)]{type="line" x="seconds after opening" y="requests offered per 100 ms" ylog="true" hmarks="250:capacity per 100 ms"}
seconds, exponential (no jitter), exponential + full jitter
0.1, 4849, 4891
0.2, 109, 2841
0.3, 4610, 1786
0.4, 98, 1527
0.5, 117, 1294
0.6, 92, 864
0.7, 4383, 647
0.8, 95, 664
0.9, 99, 672
1.0, 106, 635
1.1, 94, 505
1.2, 97, 394
1.3, 104, 299
1.4, 89, 254
1.5, 4115, 234
1.6, 101, 276
1.7, 95, 232
1.8, 98, 270
1.9, 106, 238
2.0, 97, 255
2.1, 99, 206
2.2, 100, 183
2.3, 98, 195
2.4, 111, 150
2.5, 92, 132
2.6, 93, 105
2.7, 102, 112
2.8, 90, 91
2.9, 92, 98
3.0, 100, 84
3.1, 3873, 104
3.2, 88, 92
3.3, 101, 109
3.4, 91, 107
3.5, 112, 107
3.6, 108, 110
3.7, 86, 120
3.8, 106, 86
3.9, 112, 96
4.0, 100, 108
:::

:::chart[Outcome for the 5,000 shoppers by retry policy (simulated)]{type="bar" x="policy" y="shoppers" stacked="true"}
policy, served, gave up
no backoff (6), 372, 4628
exponential (6), 1468, 3532
full jitter (6), 4387, 613
decorrelated (6), 4806, 194
full jitter (8), 4993, 7
:::

What the numbers say:

- **No backoff** burns all six attempts in 140 ms against a server that can admit 250 per 100 ms: 372 served, 4,628 gone.
- **Exponential without jitter** keeps the 5,000 in lockstep. They return together at 0.1, 0.3, 0.7, 1.5 and 3.1 s — the running sums of 0.1, 0.2, 0.4, 0.8, 1.6 s — each time ~4,000–4,800 requests against 250 slots, while between waves the server idles at background load. Half the capacity of the first 3 s is wasted; 1,468 served.
- **Full jitter** spreads every wave across its interval, so retries fill the idle slots: 85% of capacity used, 4,387 served. The price is visible too — background requests rejected rise from 584 to 1,014 (~10% of ~10,000), because the shoppers' retries now compete for slots that were idle. That is capacity being used, not wasted.
- **Attempts must cover the drain time.** The burst needs \(5{,}000 / 1{,}500\) ≈ 3.3 s of spare capacity. Six attempts with full jitter wait on average half of \(0.1 + 0.2 + 0.4 + 0.8 + 1.6\) = 1.55 s in total, too short: 613 give up. Eight attempts (cap 2 s) average \(7.1/2\) = 3.55 s and serve all but 7. Decorrelated jitter waits longer from the start and lands in between.

## 30.3 Timeouts, deadlines and the layer that retries

Each attempt needs its own timeout, and the whole sequence needs a deadline the caller can live with:

$$
k \cdot T_{\text{attempt}} + \sum_{n=0}^{k-2} \min(\text{cap}, b \cdot 2^n) \le D .
$$

:::example[Worked example · the payment call inside an 8 s checkout deadline]
The provider's p99 is 2 s (illustrative), so a per-attempt timeout of 2.5 s abandons ~1% or fewer of healthy calls; a 1 s timeout would abandon the slow tail and send a duplicate while the first is still charging ([§22](/c/system-design/22-idempotency) and [§25](/c/system-design/25-message-queue) show the duplicates). With $b$ = 100 ms and $D$ = 8 s: three attempts take at worst \(3 \times 2.5 + 0.1 + 0.2\) = 7.8 s, so $r$ = 2. A fourth attempt would end at 10.5 s, after the shopper's app has already given up.
:::

Rules that follow:

- **Propagate the deadline.** Send the remaining time with the request (a header or gRPC deadline) and have every hop skip retries — or the work itself — that cannot finish in time. A retry whose caller has gone is pure load.
- **One layer retries.** Pick the layer that knows the operation is safe and has the budget (usually the client closest to the dependency); the others fail fast. That turns $(1+r)^d$ into \(1 + r\).
- **Honour `Retry-After`.** A 429 or 503 that says when to come back is the dependency telling you its capacity ([§28](/c/system-design/28-rate-limiter)); use it as the delay, plus jitter.
- **Reads have a cheaper option.** For idempotent reads with a latency target, a hedged request (send a second copy at the p95) cuts the tail for ~5% more calls ([§10](/c/system-design/10-latency-and-throughput)).

## 30.4 Retry budgets

Backoff spreads retries in time; it doesn't reduce how many there are. A **retry budget** does: retries may not exceed a fraction $\beta$ of first attempts, per client and dependency. It is a token bucket ([§28](/c/system-design/28-rate-limiter)): each first attempt deposits $\beta$ tokens, each retry spends one.

```python
import random, time

class RetryBudget:
    """Retries may not exceed `ratio` of first attempts (per client, per dependency)."""
    def __init__(self, ratio=0.1, max_tokens=10.0):
        self.ratio, self.max, self.tokens = ratio, max_tokens, max_tokens

    def first_attempt(self):
        self.tokens = min(self.max, self.tokens + self.ratio)

    def try_spend(self):
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


def call(op, budget, deadline, base=0.1, cap=2.0, attempts=3):
    budget.first_attempt()
    for n in range(attempts):
        try:
            return op(timeout=min(2.5, deadline - time.monotonic()))
        except RetryableError as e:                    # allow-list: see 30.5
            wait = e.retry_after or random.uniform(0, min(cap, base * 2 ** n))
            if n + 1 == attempts or time.monotonic() + wait >= deadline or not budget.try_spend():
                raise
            time.sleep(wait)
```

The budget is invisible in normal operation: at $p$ = 1% a client wants 0.01 retries per request against an allowance of 0.1. It starts binding only above ~9% failures (at $p$ = 0.1, $r$ = 3 wants 0.111 per request, from the table in §30.1). In an outage it holds each layer to 1.1× instead of 4× — 1.33× instead of 64× across three layers. When the dependency is clearly down, a [circuit breaker](/c/system-design/20-circuit-breaker) stops even that 10%.

## 30.5 What to retry

| Error | Retry? | Condition |
|---|---|---|
| Connection refused / DNS failure (nothing sent) | Yes | Safe even for writes: the request never left |
| Timeout, connection reset after sending | Only if idempotent | The first attempt may have succeeded; writes need an [idempotency key](/c/system-design/22-idempotency) |
| 503, 502, 504 | Yes, with backoff | Overload or a restarting instance |
| 429 | Yes, after `Retry-After` | Plus jitter |
| 500 | Only idempotent requests, once or twice | Often a bug that will fail again |
| Deadlock / serialisation failure | Yes — the whole transaction | The database rolled it back |
| Leader election, "not primary" | Yes, after rediscovery | Seconds; see [§29.5](/c/system-design/29-read-replicas) |
| 400, 401, 403, 404, 409, 422 | No | The same request fails the same way |

The ambiguous row is the dangerous one. A payment call that times out may have charged the card; retrying without a key charges twice. With the key, the provider replays the first answer ([§9](/c/system-design/09-delivery-semantics) has the delivery semantics, [§37](/c/system-design/37-duplicate-requests-idempotency) the pattern).

## 30.6 Configuration defaults

| Knob | Default | Why |
|---|---|---|
| Backoff | Full jitter, $b$ = 100 ms, cap 2–10 s | §30.2: 3× the successes of unjittered backoff |
| Attempts | 3 for user-facing calls; more for background work | Must fit the deadline (§30.3) |
| Retry window | Sum of mean waits ≥ expected recovery or drain time | 3.3 s drain needed 8 attempts in §30.2 |
| Per-attempt timeout | Just above the dependency's p99 (2.5 s for a 2 s p99) | Lower timeouts create duplicates |
| Deadline | Propagated from the caller; checkout 8 s | No retries the user won't wait for |
| Retry budget | 10% of first attempts per client and dependency | Outage costs 1.1× per layer, not 1 + r |
| Retrying layer | One per call path, nearest the dependency | $(1+r)^d$ → \(1+r\) |
| Metrics | Retry rate, attempts per request, budget exhaustion | Retries hide a dependency that is 5% broken |

## 30.7 Failure modes

| Failure | Symptom | Fix |
|---|---|---|
| Retries at every layer | Dependency load × 27–256 during an incident | One retrying layer; budgets elsewhere |
| No jitter | Load arrives in waves at fixed offsets; idle capacity between | Full jitter |
| Retry window shorter than recovery | Most clients give up just before the dependency is ready | Size attempts × cap from drain time |
| Timeout below the p99 | Duplicates while the first attempt is still running | Timeout above p99; idempotency keys |
| Retrying 4xx | Pointless load, slower errors | Allow-list of retryable errors |
| Retrying non-idempotent writes | Double charges, double emails | Idempotency key or no retry |
| Ignoring `Retry-After` | Client hammers a dependency that asked for time | Use it as the minimum delay |
| No budget | An outage multiplies load by \(1+r\) per layer | 10% retry budget plus a circuit breaker |

## 30.8 Check yourself

:::qa[A dependency fails 2% of calls at random. You allow 3 retries. What do retries cost and buy?]
Load per request \(1 + 0.02 + 0.02^2 + 0.02^3\) ≈ 1.02 — 2% more calls. Failure probability falls from 2% to \(0.02^4\) = 1.6 × 10⁻⁷, if the failures really are independent. If they are correlated (one bad instance, a brownout), the gain is much smaller and the load is the same or worse.
:::

:::qa[Browser, gateway, service and client library each retry 2 times. The database goes down. How many attempts does one user action produce?]
$(1 + 2)^4$ = 81. Make one layer retry (the client library), make the others fail fast, and add a 10% budget: 3 attempts at most, and 1.1× load across the fleet.
:::

:::qa[Why does exponential backoff without jitter serve only 1,468 of 5,000 shoppers when full jitter serves 4,387?]
The shoppers failed together, so a deterministic delay brings them back together: waves of ~4,000+ at 0.1, 0.3, 0.7, 1.5 and 3.1 s against 250 slots per 100 ms, and an idle server in between (50% of capacity used). Full jitter spreads each wave over its interval so retries land in the idle slots (85% used).
:::

:::qa[A payment call times out after 2.5 s. Is it safe to retry?]
Only with an idempotency key. The timeout says nothing about whether the provider charged the card; the request may still be completing. With a key generated once per checkout attempt, the provider (or your idempotency layer) returns the first result instead of charging again ([§22](/c/system-design/22-idempotency)).
:::

Next: [Sagas](/c/system-design/31-sagas) — when a retried step can't be undone by trying again.
