---
section: "67"
title: "Retry with backoff"
kicker: "Code"
abstract: "A tested retry loop with full, equal and decorrelated jitter, a deadline, Retry-After and a thread-safe retry budget — then simulations of 5,000 clients hitting a recovering server and of retries multiplying across four layers."
time: "15 min"
order: 67
outcomes:
  - "Implement retry() with an allow-list, injectable clock and sleep, jittered backoff and a deadline, and test it without sleeping"
  - "Implement a thread-safe retry budget and predict where it starts to bind (failure rate above ~10%)"
  - "Compare full, equal and decorrelated jitter by peak load and drain time against a recovering server"
  - "Compute dependency load for d retrying layers, (1 + r)^d in an outage, and show what budgets and one retrying layer cut it to"
---

Checkout's payment client calls a provider whose failovers take a few seconds ([§43](/c/system-design/43-temporary-failures-retry)) and whose quota is 2,500 calls/s (illustrative, [§28](/c/system-design/28-rate-limiter)). The client needs one function that retries what is safe, waits so that thousands of clients don't come back together, stops before the shopper's 8 s deadline, honours `Retry-After`, and can't multiply load during an outage. This section writes that function, tests it in milliseconds with a fake clock, and then measures it. The theory — why retries are nearly free for independent blips and a multiplier for correlated failures — is in [§30](/c/system-design/30-retry).

:::key[First principle]
A retry loop is three decisions per failure: **may** I retry (allow-list, idempotency), **when** (exponential backoff with jitter, or the server's `Retry-After`), and **should** I (deadline left, budget left). Make each one a pure function of injected inputs — clock, sleep, random source — so it can be tested exactly, and keep the only shared state, the budget, behind a lock.
:::

## 67.1 The retry loop

Three ways to pick the wait before retry $n+1$, with base $b$ and cap $c$ ([§30.2](/c/system-design/30-retry) compares them in a storm):

$$
\begin{aligned}
\text{full:}\quad & w_n \sim U\big(0,\ \min(c,\ b\,2^n)\big) & \mathbb{E}[w_n] &= \tfrac12 \min(c, b\,2^n) \\
\text{equal:}\quad & w_n = \tfrac12 \min(c, b\,2^n) + U\big(0,\ \tfrac12 \min(c, b\,2^n)\big) & \mathbb{E}[w_n] &= \tfrac34 \min(c, b\,2^n) \\
\text{decorrelated:}\quad & w_n = \min\big(c,\ U(b,\ 3\,w_{n-1})\big) & &\text{grows from the last wait}
\end{aligned}
$$

The loop below takes `clock`, `sleep` and `rng` as arguments. That one choice is what makes it testable: the tests replace `sleep` with a function that advances a fake clock, so five scenarios — recover, non-retryable error, give up, deadline, `Retry-After` — run in microseconds.

```python run
"""retry(): exponential backoff with full / equal / decorrelated jitter, a deadline and Retry-After."""
import random

JITTER = {  # delay before retry n+1, given n retries made and the previous delay
    "full": lambda n, prev, base, cap, rng: rng.uniform(0, min(cap, base * 2 ** n)),
    "equal": lambda n, prev, base, cap, rng: min(cap, base * 2 ** n) * (0.5 + rng.uniform(0, 0.5)),
    "decorrelated": lambda n, prev, base, cap, rng: min(cap, rng.uniform(base, 3 * prev)),
}


class RetryableError(Exception):
    def __init__(self, msg="", retry_after=None):
        super().__init__(msg)
        self.retry_after = retry_after               # seconds, from a 429/503 Retry-After header


def retry(op, *, clock, sleep, attempts=4, base=0.1, cap=2.0, deadline=8.0, jitter="full",
          retryable=(RetryableError, ConnectionError, TimeoutError), rng=random.Random(0)):
    start, prev = clock(), base
    for n in range(attempts):
        try:
            return op(n)
        except retryable as e:                       # anything else (ValueError, a 4xx) propagates
            hint = getattr(e, "retry_after", None)
            wait = hint + rng.uniform(0, base) if hint else JITTER[jitter](n, prev, base, cap, rng)
            if n + 1 == attempts or clock() - start + wait >= deadline:
                raise
            sleep(wait)
            prev = wait


def run(fails, exc=ConnectionError, **kw):           # op fails `fails` times, then succeeds
    now, slept, calls = [0.0], [], []

    def op(n):
        calls.append(n)
        if len(calls) <= fails:
            raise exc("boom")
        return "ok"

    def sleep(s):                                    # injected fake clock: tests run instantly
        slept.append(s)
        now[0] += s
    try:
        out = retry(op, clock=lambda: now[0], sleep=sleep, **kw)
    except Exception as e:
        out = type(e).__name__
    return out, len(calls), slept


assert run(2)[:2] == ("ok", 3)                                     # recovers on attempt 3
assert run(9, ValueError)[:2] == ("ValueError", 1)                 # not retryable: one call
out, n, slept = run(9)
assert (out, n, len(slept)) == ("ConnectionError", 4, 3)          # gives up after 4 attempts
out, n, slept = run(9, attempts=10, base=1.0, deadline=3.0)
assert out == "ConnectionError" and sum(slept) < 3.0 and n < 10   # the deadline stops it early
out, n, slept = run(1, lambda m: RetryableError(m, retry_after=1.5))
assert out == "ok" and 1.5 <= slept[0] <= 1.6                     # Retry-After beats backoff
print("all retry tests pass")

rng, base, cap, N = random.Random(1), 0.1, 2.0, 20_000
print("retry n  ceiling   full: mean [min, max]   equal: mean [min, max]")
for n in range(6):
    f = [JITTER["full"](n, 0, base, cap, rng) for _ in range(N)]
    e = [JITTER["equal"](n, 0, base, cap, rng) for _ in range(N)]
    print(f"{n:7d} {min(cap, base * 2 ** n):7.2f} s  {sum(f) / N:5.3f} [{min(f):.2f}, {max(f):.2f}]"
          f"    {sum(e) / N:5.3f} [{min(e):.2f}, {max(e):.2f}]")
d = [base]
for _ in range(N):                                   # decorrelated grows from the previous wait
    d.append(JITTER["decorrelated"](0, d[-1], base, cap, rng))
print(f"decorrelated chain: mean {sum(d) / len(d):.3f} s, range [{min(d):.2f}, {max(d):.2f}]")
```

```output
all retry tests pass
retry n  ceiling   full: mean [min, max]   equal: mean [min, max]
      0    0.10 s  0.050 [0.00, 0.10]    0.075 [0.05, 0.10]
      1    0.20 s  0.101 [0.00, 0.20]    0.150 [0.10, 0.20]
      2    0.40 s  0.199 [0.00, 0.40]    0.300 [0.20, 0.40]
      3    0.80 s  0.403 [0.00, 0.80]    0.600 [0.40, 0.80]
      4    1.60 s  0.802 [0.00, 1.60]    1.200 [0.80, 1.60]
      5    2.00 s  0.995 [0.00, 2.00]    1.499 [1.00, 2.00]
decorrelated chain: mean 1.301 s, range [0.10, 2.00]
```

What the design and the numbers say:

- **The allow-list is the safety argument.** `retryable` names the exceptions that mean "try again might work". A `ValueError` (or a 400) escapes after one call; the test asserts it. Timeouts are in the list only because the payment call carries an [idempotency key](/c/system-design/22-idempotency) — a timeout says nothing about whether the provider charged the card.
- **The deadline is checked before sleeping.** `clock() - start + wait >= deadline` refuses a wait that would end after the caller has gone; the test with `deadline=3.0` stops early instead of making all 10 attempts.
- **Mean waits match the formulas.** Full jitter averages half the ceiling (0.995 s at the 2 s cap), equal jitter three-quarters (1.499 s). With the defaults (4 attempts, $b$ = 100 ms) full jitter waits on average \(0.05 + 0.10 + 0.20\) = 0.35 s in total, equal jitter 0.525 s. The decorrelated chain drifts towards the cap: it averages 1.3 s per wait once it has grown, so its cap does most of the work.

:::example[Worked example · sizing the payment client from these numbers]
A 3 s provider failover needs total waiting of at least ~3 s. Full jitter from $b$ = 100 ms waits on average half the sum of the ceilings; with a 2 s cap, ceilings 0.1, 0.2, 0.4, 0.8, 1.6, 2, 2 s sum to 7.1 s, so 7 retries (8 attempts) average 3.55 s of waiting. The alternative from [§43.3](/c/system-design/43-temporary-failures-retry) is $b$ = 1 s, 4 retries, cap 4 s: ceilings 1, 2, 4, 4 → mean 5.5 s. Both must fit $k \cdot T_{\text{attempt}} + \text{waits} \le 8$ s; with failovers failing fast, they do.
:::

## 67.2 A retry budget

Backoff spreads retries out; a budget caps how many there are. Each first attempt deposits $\beta$ tokens (here 0.1), each retry spends one, and the bucket holds at most 10 so a quiet client can still retry a short burst:

$$
\text{retries} \le \beta \cdot \text{requests} + \text{max tokens}
\quad\Rightarrow\quad
\text{calls per request} \le 1 + \beta = 1.1 \ \text{in an outage.}
$$

```python run
"""A retry budget: retries may not exceed `ratio` x first attempts. Thread-safe; tested under threads."""
import random
import threading
from concurrent.futures import ThreadPoolExecutor


class RetryBudget:
    """Integer milli-tokens: ten deposits of 0.1 must make exactly one retry, not 0.9999999."""
    def __init__(self, ratio=0.1, max_tokens=10.0):
        self.deposit, self.max = round(ratio * 1000), round(max_tokens * 1000)
        self.tokens = self.max
        self._lock = threading.Lock()                # on_request and can_retry race across threads

    def on_request(self):                            # every first attempt deposits `ratio` tokens
        with self._lock:
            self.tokens = min(self.max, self.tokens + self.deposit)

    def can_retry(self):                             # every retry spends one
        with self._lock:
            if self.tokens >= 1000:
                self.tokens -= 1000
                return True
            return False


b = RetryBudget(0.1, 10)
assert sum(b.can_retry() for _ in range(50)) == 10   # starts full: 10 retries of headroom
for _ in range(100):
    b.on_request()
assert sum(b.can_retry() for _ in range(50)) == 10   # 100 requests earn 10 retries

shared = RetryBudget(0.1, 10)


def worker(_):                                       # a hard outage: every request wants a retry
    got = 0
    for _ in range(10_000):
        shared.on_request()
        got += shared.can_retry()
    return got


with ThreadPoolExecutor(8) as ex:
    total = sum(ex.map(worker, range(8)))
assert 8_000 <= total <= 8_010, total                # 10% of 80,000 + the initial 10, never more
print("8 threads x 10,000 failing requests: retries granted stay within 10% + 10 (8,010)")


def simulate(p, budget, requests=100_000, r=3, seed=4):
    rng, calls, ok = random.Random(seed), 0, 0
    for _ in range(requests):
        budget.on_request()
        for n in range(r + 1):
            calls += 1
            if rng.random() >= p:
                ok += 1
                break
            if n == r or not budget.can_retry():
                break
    return calls / requests, 1 - ok / requests


print("\np(fail)  no budget: calls/req  failed   |  10% budget: calls/req  failed")
for p in (0.001, 0.01, 0.05, 0.1, 0.2, 0.5, 1.0):
    c0, f0 = simulate(p, RetryBudget(1e9, 1e9))      # effectively unlimited
    c1, f1 = simulate(p, RetryBudget(0.1, 10))
    print(f"{p:7.3f} {c0:19.3f} {f0:8.2%}   | {c1:20.3f} {f1:8.2%}")
```

```output
8 threads x 10,000 failing requests: retries granted stay within 10% + 10 (8,010)

p(fail)  no budget: calls/req  failed   |  10% budget: calls/req  failed
  0.001               1.001    0.00%   |                1.001    0.00%
  0.010               1.010    0.00%   |                1.010    0.00%
  0.050               1.053    0.00%   |                1.053    0.00%
  0.100               1.111    0.01%   |                1.099    1.12%
  0.200               1.248    0.16%   |                1.100   11.91%
  0.500               1.879    6.34%   |                1.100   45.09%
  1.000               4.000  100.00%   |                1.100  100.00%
```

- **Invisible below ~10% failures.** At $p$ = 1% and 5% the budgeted client behaves exactly like the unbudgeted one: it wants $p + p^2 + p^3 \approx p$ retries per request against an allowance of 0.1.
- **It binds at ~10% and caps load at 1.10×.** At $p$ = 0.2 the unbudgeted client sends 1.25× and fails 0.16%; the budgeted one sends 1.10× and fails 11.9%. That is the trade the budget makes on purpose: during a partial outage it gives up rescues to keep the dependency's load near normal. At $p$ = 1 it is 1.1× instead of 4×.
- **The first test caught a real bug.** With float tokens, ten deposits of 0.1 sum to 0.9999999, and the 100-request test granted 9 retries instead of 10. Counting integer milli-tokens fixes it — the same reason money is stored in cents.

:::warn[Where the budget lives]
Keep one budget per client process **per dependency**, not per request and not global. Per request is just "max attempts"; a global budget lets one failing dependency spend the retries another one needs. A fleet needs no coordination: if every process holds retries to 10% of its own first attempts, the fleet does too.
:::

## 67.3 Simulation: 5,000 clients against a recovering server

A provider restarts: 5,000 in-flight calls fail in the same 10 ms, the provider is down for 2 s, then admits 2,500 calls/s (25 per 10 ms tick) and rejects the rest at no cost (an assumption — real rejections cost CPU). Each client retries with $b$ = 100 ms, cap 2 s, until its 8 s deadline. The ideal outcome is a 2 s drain (\(5{,}000 / 2{,}500\)), finishing at 4.0 s.

```python run
"""5,000 clients fail together; the server is down 2 s, then admits 2,500/s. Which jitter?"""
import numpy as np

TICK, CAP, T = 0.01, 25, 1_000                 # 10 ms ticks, 25 admits/tick = 2,500/s, 10 s
N, UP, BASE, MAXD, DEADLINE = 5_000, 2.0, 0.1, 2.0, 8.0   # illustrative


def delay(policy, n, prev, rng):              # n = retries already made
    c = min(MAXD, BASE * 2 ** n)
    if policy == "no jitter":
        return c
    if policy == "full":
        return rng.uniform(0, c)
    if policy == "equal":
        return c / 2 + rng.uniform(0, c / 2)
    return min(MAXD, rng.uniform(BASE, 3 * prev))   # decorrelated


def run(policy, seed=3):
    rng = np.random.default_rng(seed)
    due = [[] for _ in range(T + 300)]         # per tick: (retries made, previous delay)
    due[0] = [(0, BASE)] * N                   # all 5,000 fail in the same 10 ms
    offered, done = np.zeros(T), []
    for t in range(T):
        reqs = due[t]
        offered[t] = len(reqs)
        admit = set(rng.permutation(len(reqs))[:CAP]) if t * TICK >= UP else set()
        for j, (n, prev) in enumerate(reqs):
            if j in admit:
                done.append(t * TICK)
                continue
            d = delay(policy, n, prev, rng)
            nxt = t + max(1, round(d / TICK))
            if nxt * TICK < DEADLINE:          # the caller's deadline: give up instead
                due[nxt].append((n + 1, d))
    after = offered[int(UP / TICK):].reshape(-1, 10).sum(1)   # per 100 ms once the server is up
    t99 = f"{sorted(done)[int(0.99 * N) - 1]:.2f} s" if len(done) >= 0.99 * N else "never"
    return len(done), int(offered.sum()), int(after.max()), t99


print("policy        served  gave up  attempts  peak per 100 ms after recovery  99% served at")
for p in ("no jitter", "full", "equal", "decorrelated"):
    served, tries, peak, t99 = run(p)
    print(f"{p:12s} {served:7,d} {N - served:8,d} {tries:9,d} {peak:13,d} (capacity 250) {t99:>11s}")
```

```output
policy        served  gave up  attempts  peak per 100 ms after recovery  99% served at
no jitter         75    4,925    39,925         5,000 (capacity 250)       never
full           5,000        0    37,458           541 (capacity 250)      4.68 s
equal          5,000        0    32,993           643 (capacity 250)      5.47 s
decorrelated   5,000        0    33,170           620 (capacity 250)      4.94 s
```

:::chart[Attempts per 200 ms after 5,000 clients fail together; the server is down until 2 s, then admits 500 per 200 ms (simulated)]{type="line" x="seconds after the failure" y="attempts per 200 ms" band="1:2:server down" hmarks="500:capacity per 200 ms"}
seconds, no jitter, full jitter, equal jitter, decorrelated
1.0, 0, 1510, 2446, 1771
1.2, 0, 998, 1558, 1565
1.4, 5000, 894, 51, 1426
1.6, 0, 1007, 81, 1369
1.8, 0, 1091, 503, 1264
2.0, 0, 1075, 1091, 1223
2.2, 0, 987, 1212, 1007
2.4, 0, 901, 1221, 908
2.6, 0, 754, 712, 769
2.8, 0, 652, 242, 606
3.0, 5000, 615, 186, 535
3.2, 0, 533, 285, 425
3.4, 0, 447, 465, 379
3.6, 0, 340, 573, 338
3.8, 0, 268, 506, 289
4.0, 0, 198, 402, 192
4.2, 0, 129, 244, 142
4.4, 0, 80, 101, 124
4.6, 0, 45, 29, 92
4.8, 0, 16, 23, 45
5.0, 4975, 12, 32, 28
5.2, 0, 3, 23, 9
5.4, 0, 0, 31, 0
5.6, 0, 0, 26, 0
5.8, 0, 0, 5, 0
6.0, 0, 0, 0, 0
6.4, 0, 0, 0, 0
6.8, 0, 0, 0, 0
7.0, 4950, 0, 0, 0
7.2, 0, 0, 0, 0
:::

- **No jitter never recovers.** The 5,000 return together at 0.1, 0.3, 0.7, 1.5, 3.1, 5.1 and 7.1 s. The server is up for the last three waves, and each time it can take 25 of 5,000 in the 10 ms they arrive: 75 served, 4,925 give up. The server idles between waves.
- **Full jitter finishes closest to ideal**: 99% served at 4.68 s against the 4.0 s floor. Its peak after recovery is 541 attempts per 100 ms — still twice capacity, because jitter spreads retries but does not reduce them; the excess is rejected and retried.
- **Equal jitter is slowest (5.47 s).** Its minimum wait of half the ceiling empties the 1.4–1.8 s range (51 and 81 attempts) and pushes clients later; it behaves like a partially synchronised schedule. Decorrelated jitter sits in between (4.94 s) with the fewest wasted attempts during the outage.

Use full jitter by default; decorrelated jitter suits long-lived clients that retry the same dependency repeatedly. Equal jitter guarantees a minimum wait, which is only worth it when the server needs that minimum (then prefer `Retry-After`).

## 67.4 Amplification across layers

If layer $i$ retries up to $r$ times and the layer below fails with probability $q_{i-1}$, layer $i$ makes $\sum_{k=0}^{r} q_{i-1}^k$ calls per request and fails with $q_i = q_{i-1}^{\,r+1}$. Multiplying down the stack from $q_0 = p$:

$$
\text{dependency calls per user request} = \prod_{i=1}^{d} \sum_{k=0}^{r} q_{i-1}^{\,k}
\;\xrightarrow{\;p\,=\,1\;}\; (1 + r)^d .
$$

The simulation checks the formula for four layers (app → gateway → checkout → payment client) with $r$ = 2, then adds a 10% budget at every layer, and finally lets only the payment client retry.

```python run
"""Retry amplification across layers: dependency calls per user request, with and without budgets."""
import random


class Budget:                                     # same rule as RetryBudget, single-threaded
    def __init__(self, ratio, cap=10.0):
        self.ratio, self.cap, self.tokens = ratio, cap, cap

    def earn(self):
        self.tokens = min(self.cap, self.tokens + self.ratio)

    def spend(self):
        ok = self.tokens >= 1
        self.tokens -= ok
        return ok


def simulate(p, retries, budget=None, requests=20_000, seed=5):
    """retries[i] = retries made by layer i (0 calls the dependency; the last is the user's app)."""
    rng, hits = random.Random(seed), [0]
    budgets = [Budget(budget) if budget else None for _ in retries]

    def call(level):
        b = budgets[level]
        if b:
            b.earn()                              # a retry from above is a first attempt here
        for n in range(retries[level] + 1):
            if level == 0:
                hits[0] += 1
                ok = rng.random() >= p
            else:
                ok = call(level - 1)
            if ok:
                return True
            if n == retries[level] or (b and not b.spend()):
                return False

    for _ in range(requests):
        call(len(retries) - 1)
    return hits[0] / requests


def formula(p, r, d):                             # expected dependency calls, no budget
    calls, q = 1.0, p
    for _ in range(d):
        calls *= sum(q ** k for k in range(r + 1))
        q = q ** (r + 1)
    return calls


print("p(fail)  1 layer r=2   4 layers r=2: formula   sim   +10% budgets  1 of 4 retries +budget")
for p in (0.0, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99, 1.0):
    four = simulate(p, [2, 2, 2, 2])
    assert abs(four - formula(p, 2, 4)) / formula(p, 2, 4) < 0.05
    print(f"{p:7.2f} {simulate(p, [2]):11.2f}x {formula(p, 2, 4):18.2f}x {four:7.2f}x"
          f" {simulate(p, [2, 2, 2, 2], 0.1):10.2f}x {simulate(p, [2, 0, 0, 0], 0.1):14.2f}x")
```

```output
p(fail)  1 layer r=2   4 layers r=2: formula   sim   +10% budgets  1 of 4 retries +budget
   0.00        1.00x               1.00x    1.00x       1.00x           1.00x
   0.01        1.01x               1.01x    1.01x       1.01x           1.01x
   0.10        1.11x               1.11x    1.11x       1.11x           1.10x
   0.30        1.39x               1.43x    1.42x       1.42x           1.10x
   0.50        1.75x               2.00x    1.99x       1.47x           1.10x
   0.70        2.19x               3.33x    3.34x       1.47x           1.10x
   0.90        2.71x              10.00x    9.98x       1.47x           1.10x
   0.99        2.97x              55.70x   55.56x       1.47x           1.10x
   1.00        3.00x              81.00x   81.00x       1.47x           1.10x
```

:::chart[Dependency calls per user request vs the dependency's failure rate (simulated, r = 2 per retrying layer)]{type="line" x="dependency failure probability p" y="calls at the dependency per request" ylog="true" points="true" dash="1 retrying layer + budget"}
p, 1 layer r=2, 4 layers r=2, 4 layers + 10% budgets, 1 retrying layer + budget
0.0, 1.00, 1.00, 1.00, 1.00
0.01, 1.01, 1.01, 1.01, 1.01
0.1, 1.11, 1.11, 1.11, 1.10
0.3, 1.39, 1.42, 1.42, 1.10
0.5, 1.75, 1.99, 1.47, 1.10
0.7, 2.19, 3.34, 1.47, 1.10
0.9, 2.71, 9.98, 1.47, 1.10
0.99, 2.97, 55.56, 1.47, 1.10
1.0, 3.00, 81.00, 1.47, 1.10
:::

- **Stacks are harmless until they aren't.** Up to $p$ = 0.3 four retrying layers cost about what one does (1.42× vs 1.39×): the upper layers rarely see a failure. Past $p$ = 0.5 the product takes off — 10× at 0.9, 55.6× at 0.99, 81× in a full outage. At the flash sale's 2,000 orders/s that is 162,000 calls/s at a provider with a 2,500/s quota.
- **Budgets at every layer compound too**: 1.47× = \(1.1^4\). A retry from layer 3 is a *first attempt* at layer 2 and earns layer 2 more budget, so each layer adds its 10%.
- **One retrying layer with a budget is flat at 1.10×.** The payment client is the right layer: it knows the call is idempotent and is closest to the dependency. Every layer above should fail fast and pass the deadline down.

## 67.5 Production notes

- **Thread safety.** `retry()` holds no shared state except the random source; give each thread its own `random.Random` (or use the module-level functions) rather than sharing a seeded instance. The budget is shared per process and dependency, so it needs the lock (or an atomic counter); the 8-thread test checks the invariant, not an exact count, because which deposits land at the cap depends on thread interleaving.
- **Async.** The same loop with `await asyncio.sleep(wait)`; within one event loop the budget needs no lock as long as nothing awaits between the check and the spend.
- **Deadlines travel.** Take `deadline` from the incoming request (a header or the gRPC deadline) minus what has already elapsed, and send the remainder downstream. A retry whose caller has hung up is pure load.
- **What libraries do.** AWS SDKs retry with exponential backoff and jitter and offer a retry mode with a client-side retry quota; gRPC supports retry policies in service config with token-based retry throttling; Envoy can cap retries with a retry budget relative to active requests; the Google SRE book describes a per-client retry budget of about 10%; in Python, `tenacity` and urllib3's `Retry` (which can honour `Retry-After`) implement the loop. Check the defaults of whatever you use — several retry by default, which is how stacks of retrying layers happen without anyone deciding it.
- **Observe it.** Log the attempt number with every outcome, export retries per request and budget rejections, and alert when retries exceed a few percent: retries hide a dependency that is quietly 5% broken ([§43.1](/c/system-design/43-temporary-failures-retry)).

:::warn[Retrying writes]
Never put a non-idempotent call inside `retry()` with `TimeoutError` in the allow-list. Generate the idempotency key **once, outside** the loop, and send the same key on every attempt — a key generated per attempt is no key at all ([§65](/c/system-design/65-idempotency)).
:::

## 67.6 Interview angle

| Question | Answer with numbers |
|---|---|
| Complexity? | $O(\text{attempts})$ time per call, $O(1)$ state; the budget is $O(1)$ per decision under one lock |
| Why jitter? | Without it, clients that failed together retry together: 75 of 5,000 served vs 5,000 with full jitter (§67.3) |
| Why not retry at every layer? | $(1 + r)^d$: 81× at $r$ = 2, $d$ = 4 in an outage; one layer with a budget is 1.1× |
| What is retryable? | Connection refused, 502/503/504, 429 after `Retry-After`; timeouts only with an idempotency key; never 400/401/403/404/422 |
| How many attempts? | Enough that mean total wait ≥ recovery time, few enough that attempts × timeout + waits ≤ deadline |
| How do you test it? | Inject clock, sleep and RNG; assert call counts, sleeps and deadline behaviour — no real sleeping |

Edge cases worth naming: `Retry-After` larger than the remaining deadline (give up now, don't sleep), a cap smaller than the base, `attempts=1`, an exception raised by the fake `sleep` (cancellation), and clock skew — use a monotonic clock, never wall time, for deadlines.

Follow-ups: *hedged requests* for idempotent reads (send a second copy at the p95, ~5% extra calls, [§30.3](/c/system-design/30-retry)); *circuit breakers* to stop even the 10% budget when the dependency is clearly down ([§63](/c/system-design/63-circuit-breaker)); *server-side* protection with load shedding and [rate limits](/c/system-design/69-token-bucket) so a misbehaving client can't hurt others.

## 67.7 Check yourself

:::qa[With base 100 ms, cap 2 s and full jitter, what is the mean total wait for 5 attempts, and does it cover a 3 s failover?]
Four waits with ceilings 0.1, 0.2, 0.4, 0.8 s average half of 1.5 s = 0.75 s. No: most clients give up ~2 s before the provider is back. Either raise the base (1 s → ceilings 1, 2, 2, 2 s, mean 3.5 s with the 2 s cap) or add attempts, and check the result still fits the 8 s deadline.
:::

:::qa[Your 10% retry budget starts the bucket full at 10 tokens. Why have the initial tokens at all?]
A client that has just started, or has been idle, has made no first attempts to earn from; without headroom its first transient failure could never be retried. Ten tokens let it absorb a short burst of blips; in a sustained outage the bucket drains in 10 retries and the 10% rule takes over.
:::

:::qa[A dependency fails 30% of calls. Four layers each retry twice. How much load do retries add, and should you worry?]
About 1.42× (vs 1.39× with one layer) — the upper layers rarely see failures because the bottom layer's retries mask most of them. Worry anyway: at $p$ = 0.9 the same stack sends 10×, and at an outage 81×. The stack's cost is hidden exactly until the incident.
:::

:::qa[Why does the 8-thread budget test assert a range (8,000–8,010) rather than exactly 8,010?]
The bucket starts at its 10-token cap, so deposits made while it is full are discarded. How many deposits land at the cap before the first retry spends a token depends on how the threads interleave. The invariant that matters — never more than 10% + 10 — holds for every interleaving, so that's what the test asserts.
:::

Next: [Shard router](/c/system-design/68-sharding) — routing keys to logical shards and moving them with minimal data movement.
