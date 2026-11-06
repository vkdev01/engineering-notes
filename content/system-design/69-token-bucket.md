---
section: "69"
title: "Token bucket"
kicker: "Code"
abstract: "A tested token bucket with lazy refill, an injectable clock, cost-weighted requests and Retry-After; a head-to-head with fixed window, sliding log and sliding counter on bursty and adversarial traces; GCRA as the one-timestamp form; and the atomic Redis script for the distributed version."
time: "14 min"
order: 69
outcomes:
  - "Implement a token bucket with lazy refill, an injectable clock and an atomic check-and-take, and test burst, refill, cap and concurrency"
  - "Compute the worst case each limiter admits in a window — 2L for a fixed window and, adversarially, for a sliding counter; b + rW for a bucket"
  - "Choose burst b from what honest clients send: b = 50 rejected 40% of a bursty client's requests that b = 600 admitted"
  - "Store a bucket as one timestamp (GCRA) and make the distributed check one atomic script"
---

Checkout limits each account to 1 order/s with a burst of 5, and the payment client holds itself to 2,400 calls/s with a burst of 400 against the provider's 2,500/s quota ([§28.2](/c/system-design/28-rate-limiter), illustrative). Pulse gives each user 10 requests/s with a burst of 20. All three are the same twenty lines of code with different numbers, and all three fail the same ways: refilling with a timer that drifts, checking and taking in two steps so two threads spend one token, or picking a window algorithm that admits twice the limit at a boundary. This section writes the bucket, tests those failure modes, and measures it against the alternatives. The algorithm comparison and sizing are in [§28](/c/system-design/28-rate-limiter); the service around it is [§57](/c/system-design/57-rate-limiter-service).

:::key[First principle]
A token bucket is two numbers per key — tokens and the time they were counted — and one rule: on each request, add $r \cdot \Delta t$ tokens up to $b$, then take the request's cost or reject. Computing refill lazily from elapsed time makes it exact and timer-free; doing refill, check and take as **one atomic step** is what makes it correct under concurrency; and $b + rW$ is the most it ever admits in a window $W$.
:::

## 69.1 The bucket

With rate $r$ tokens/s, capacity $b$, and $\tau_k$ the tokens after request $k$ at time $t_k$:

$$
\tau_k = \min\big(b,\ \tau_{k-1} + r\,(t_k - t_{k-1})\big) - \text{cost}_k \cdot \mathbb{1}[\text{admitted}],
\qquad
\text{Retry-After} = \frac{\text{cost} - \tau}{r}.
$$

Because the bucket never holds more than $b$, the requests admitted in any interval of length $W$ cost at most $b + rW$.

```python run
"""TokenBucket: lazy refill, injectable clock, atomic check-and-take, Retry-After. With tests."""
import threading
import time
from concurrent.futures import ThreadPoolExecutor


class TokenBucket:
    def __init__(self, rate, burst, clock=time.monotonic):
        if rate <= 0 or burst < 1:
            raise ValueError("need rate > 0 and burst >= 1")
        self.rate, self.burst, self.clock = float(rate), float(burst), clock
        self.tokens, self.last = float(burst), clock()
        self._lock = threading.Lock()

    def _refill(self):                               # lazy: no timer thread, O(1) per call
        now = self.clock()
        self.tokens = min(self.burst, self.tokens + max(0.0, now - self.last) * self.rate)
        self.last = max(self.last, now)              # a clock stepping backwards mints nothing

    def try_acquire(self, cost=1.0):
        """(allowed, retry_after_seconds). Refill, check and take under one lock."""
        with self._lock:
            self._refill()
            if self.tokens >= cost:
                self.tokens -= cost
                return True, 0.0
            if cost > self.burst:
                return False, float("inf")           # can never succeed: a 413/400, not a 429
            return False, (cost - self.tokens) / self.rate


t = [0.0]
b = TokenBucket(rate=1, burst=5, clock=lambda: t[0])   # checkout: 1 order/s, burst 5 (section 28)
assert [b.try_acquire()[0] for _ in range(6)] == [True] * 5 + [False]
assert b.try_acquire() == (False, 1.0)               # Retry-After: one token is 1 s away
t[0] = 0.5
assert b.try_acquire() == (False, 0.5)
t[0] = 1.0
assert b.try_acquire() == (True, 0.0)
t[0] = 3_601.0                                       # idle an hour: capped at the burst, not 3,600
assert sum(b.try_acquire()[0] for _ in range(10)) == 5
assert b.try_acquire(cost=6) == (False, float("inf"))
t[0] = 3_000.0                                       # clock steps back 601 s: no free tokens
assert b.try_acquire() == (False, 1.0)
print("single-thread tests pass")

shared = TokenBucket(rate=1, burst=50, clock=lambda: 0.0)   # frozen clock: exactly 50 tokens exist
with ThreadPoolExecutor(16) as ex:
    admitted = sum(ex.map(lambda _: sum(shared.try_acquire()[0] for _ in range(100)), range(16)))
assert admitted == 50
print(f"16 threads x 100 tries on 50 tokens -> {admitted} admitted")


class SplitBucket:                                   # the bug: check and take as separate steps
    tokens = 1.0


naive, gate, got = SplitBucket(), threading.Barrier(2), []


def client():
    if naive.tokens >= 1:                            # both clients see the last token...
        gate.wait()
        naive.tokens -= 1                            # ...and both take it
        got.append(1)


threads = [threading.Thread(target=client) for _ in range(2)]
[th.start() for th in threads]
[th.join() for th in threads]
print(f"check-then-take without atomicity: {len(got)} requests admitted on 1 token,"
      f" {naive.tokens:.0f} tokens left")
```

```output
single-thread tests pass
16 threads x 100 tries on 50 tokens -> 50 admitted
check-then-take without atomicity: 2 requests admitted on 1 token, -1 tokens left
```

What each test protects:

- **Burst then rate.** The checkout bucket admits 5 at once, rejects the 6th with `Retry-After` 1.0 s, and admits again exactly when a token has accrued. That 1.0 is what goes in the 429's header, plus jitter so rejected clients don't return together ([§67](/c/system-design/67-retry)).
- **Idle credit is capped.** After an hour idle the account gets 5 tokens, not 3,600 — the cap is the whole point of $b$.
- **Impossible requests say so.** Cost 6 against a burst of 5 can never succeed; returning `inf` lets the caller send a 4xx instead of a 429 the client would retry forever.
- **Time going backwards mints nothing.** Use `time.monotonic()`, not wall time; the `max(0, …)` and `max(last, now)` guards keep an injected or adjusted clock from creating tokens.
- **Atomicity.** With the clock frozen, exactly 50 tokens exist and 16 threads × 100 tries get exactly 50. The `SplitBucket` uses a barrier to force the interleaving that load produces by chance: both clients read "1 token", both take it, and the bucket goes to −1. The distributed version has the same bug if it does a `GET` then a `SET` (§69.4).

:::example[Worked example · Retry-After for the payment client]
The payment client's bucket is $r$ = 2,400/s, $b$ = 400. After a 400-call burst it is empty; the next call waits \(1/2{,}400\) s ≈ 0.42 ms. A cost-weighted call — say a batch refund worth 50 tokens — waits \(50/2{,}400\) ≈ 21 ms. A batch worth 500 exceeds $b$ and is rejected as impossible: split it, or raise $b$.
:::

## 69.2 Four limiters on bursty and adversarial traces

Set every algorithm to "600 per minute" (10/s average) and replay three traces over 10 minutes: an honest **bursty client** (background 3/s plus four 400-request bursts of 2 s each — a sync job), a **boundary attack** (600 in the last second of a minute, 600 in the first second of the next), and a **counter attack** (600 in the last second of a minute, then 100/s for the whole next minute). Buckets use $r$ = 10/s with $b$ = 50 or 600.

```python run
"""'600 per minute' four ways on bursty and adversarial traces: admitted, max in any 60 s and any 1 s."""
from collections import deque
import numpy as np

L, W = 600, 60.0


def fixed(ts):
    win, n, out = None, 0, []
    for t in ts:
        if t // W != win:
            win, n = t // W, 0
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
    win, prev, cur, out = 0, 0, 0, []
    for t in ts:
        w = int(t // W)
        if w != win:
            prev, cur, win = (cur if w == win + 1 else 0), 0, w
        out.append(prev * (1 - (t % W) / W) + cur < L)   # assumes last window was uniform
        cur += out[-1]
    return out


def bucket(ts, rate=L / W, burst=50.0):
    tokens, last, out = burst, 0.0, []
    for t in ts:
        tokens, last = min(burst, tokens + (t - last) * rate), t
        out.append(tokens >= 1)
        tokens -= out[-1]
    return out


rng = np.random.default_rng(69)
bursts = np.concatenate([s + rng.uniform(0, 2, 400) for s in rng.uniform(0, 590, 4)])
traces = {"bursty client": np.sort(np.concatenate([rng.uniform(0, 600, 1_800), bursts])),
          "boundary attack": np.concatenate([np.linspace(59, 59.99, 600), np.linspace(60, 60.99, 600)]),
          "counter attack": np.concatenate([np.linspace(59, 59.99, 600), np.arange(60, 120, 0.01)])}
algos = {"fixed window": fixed, "sliding log": sliding_log, "sliding counter": sliding_counter,
         "bucket r=10/s b=50": bucket, "bucket r=10/s b=600": lambda ts: bucket(ts, burst=600)}


def max_in(ok, span):                            # most admitted in any interval of length span
    return max((np.searchsorted(ok, t + span) - i for i, t in enumerate(ok)), default=0)


for name, ts in traces.items():
    print(f"{name} ({len(ts):,} requests)   admitted  max/any 60 s  max/any 1 s")
    for a, f in algos.items():
        ok = ts[np.array(f(ts), dtype=bool)]
        m60 = max_in(ok, W)
        print(f"  {a:20s} {len(ok):9,d} {m60:9,d} ({m60 / L:.2f}x) {max_in(ok, 1.0):8,d}")
```

```output
bursty client (3,400 requests)   admitted  max/any 60 s  max/any 1 s
  fixed window             3,037       658 (1.10x)      220
  sliding log              3,024       600 (1.00x)      220
  sliding counter          2,865       605 (1.01x)      213
  bucket r=10/s b=50       2,048       299 (0.50x)       59
  bucket r=10/s b=600      3,400       975 (1.62x)      229
boundary attack (1,200 requests)   admitted  max/any 60 s  max/any 1 s
  fixed window             1,200     1,200 (2.00x)      600
  sliding log                600       600 (1.00x)      600
  sliding counter            610       610 (1.02x)      600
  bucket r=10/s b=50          69        69 (0.12x)       59
  bucket r=10/s b=600        619       619 (1.03x)      600
counter attack (6,600 requests)   admitted  max/any 60 s  max/any 1 s
  fixed window             1,200     1,200 (2.00x)      600
  sliding log                699       600 (1.00x)      600
  sliding counter          1,200     1,190 (1.98x)      600
  bucket r=10/s b=50         659       649 (1.08x)       59
  bucket r=10/s b=600      1,209     1,199 (2.00x)      600
```

:::chart[Most requests admitted in any 60 s, as a multiple of the 600/min limit (simulated)]{type="bar" x="algorithm" y="max in any 60 s ÷ limit" hmarks="1:the limit"}
algorithm, bursty client, boundary attack, counter attack
fixed window, 1.10, 2.00, 2.00
sliding log, 1.00, 1.00, 1.00
sliding counter, 1.01, 1.02, 1.98
bucket b=50, 0.50, 0.12, 1.08
bucket b=600, 1.62, 1.03, 2.00
:::

The worst cases follow from each algorithm's state:

- **Fixed window: 2L at the boundary.** 600 at 0:59 and 600 at 1:00 are in different windows: 1,200 in 2 s, both attacks.
- **Sliding counter: also ~2L, against a patient attacker.** It estimates the trailing minute as $\text{prev}\cdot(1-f) + \text{cur}$, assuming the previous window was uniform. Put all 600 of the previous window in its last second and, at fraction $f$ of the next window, the estimate is $600(1-f) + \text{cur}$, so it admits until cur = $600f$ — while the true trailing minute holds $600 + 600f$. Near $f = 1$ that is ~1,200; measured 1,190 (1.98×). On honest traffic it is within 1% (605), which is why it's a fine default for quotas, not for hard contracts.
- **Sliding log: exact** (600 in every case) at the cost of storing up to 600 timestamps per key.
- **Token bucket: $b + rW$, chosen by you.** $b$ = 50 caps any minute at 650 (649 measured) and any second at 59 — no attack gets more. $b$ = 600 allows 1,200 (1,199) in a minute.

The honest client shows the other side of the burst knob:

| Limiter | Admitted of the bursty client's 3,400 | Most in any 1 s | Use when |
|---|---:|---:|---|
| Fixed window | 3,037 (89%) | 220 | Never for protection; fine for coarse billing counts |
| Sliding log | 3,024 (89%) | 220 | Exact quotas with small limits |
| Sliding counter | 2,865 (84%) | 213 | "N per minute" quotas, O(1) state |
| Bucket $b$ = 50 | 2,048 (60%) | 59 | Protecting a backend that can't take bursts |
| Bucket $b$ = 600 | 3,400 (100%) | 229 | Clients with legitimate bursts, backend sized for them |

$b$ = 50 smooths the downstream (never more than 59 in a second) by rejecting 40% of a client that stayed under 600/min on average; $b$ = 600 admits it all and passes its 229/s bursts through. Choose $b$ from what honest clients do and what the protected resource can absorb, not from the per-minute number ([§28.2](/c/system-design/28-rate-limiter)).

## 69.3 One timestamp instead of two: GCRA

The generic cell rate algorithm stores, per key, only the **theoretical arrival time** (TAT) of the next request that would conform. With emission interval $T = 1/r$ and tolerance $\tau = (b - 1)\,T$:

$$
\text{TAT}' = \max(\text{TAT}, \text{now}); \quad \text{admit iff } \text{TAT}' - \text{now} \le \tau; \quad \text{then } \text{TAT} \leftarrow \text{TAT}' + T.
$$

It is the token bucket in disguise: tokens $= b - (\text{TAT} - \text{now})/T$ whenever TAT is ahead of now, and a full bucket when TAT ≤ now. The test runs both on 20,000 bursty requests in integer milliseconds (so neither suffers float error) and requires identical decisions.

```python run
"""GCRA: the token bucket stored as one timestamp. Same decisions, half the state, easy to expire."""
import numpy as np

T, B = 100, 20                                   # emission interval 100 ms (10/s), burst 20


def bucket_decisions(times_ms):                  # integer ms of credit, so both are exact
    credit, last, out = B * T, 0, []
    for now in times_ms:
        credit, last = min(B * T, credit + now - last), now
        out.append(credit >= T)
        credit -= T if out[-1] else 0
    return out


class GCRA:
    """Per key, store only TAT, the theoretical arrival time of the next conforming request."""
    def __init__(self, interval, burst):
        self.T, self.tau, self.tat = interval, (burst - 1) * interval, {}

    def allow(self, key, now):
        tat = max(self.tat.get(key, now), now)
        if tat - now > self.tau:                 # too far ahead of schedule: reject
            return False
        self.tat[key] = tat + self.T
        return True

    def sweep(self, now):                        # tat <= now means a full bucket: same as no key
        self.tat = {k: v for k, v in self.tat.items() if v > now}


rng = np.random.default_rng(3)
gaps = np.where(rng.random(20_000) < 0.6, rng.integers(0, 5, 20_000), rng.integers(50, 400, 20_000))
times = np.cumsum(gaps).tolist()                 # bursts of near-simultaneous requests + idle gaps
g = GCRA(T, B)
a, b = bucket_decisions(times), [g.allow("acct:42", t) for t in times]
assert a == b
print(f"{len(times):,} requests over {times[-1] / 1000:,.0f} s: token bucket and GCRA agree on all"
      f" {len(times):,} decisions ({sum(a):,} admitted)")

g, now = GCRA(T, B), 0
for i in range(100_000):                         # 100,000 users, each one request, 1,000 per second
    now = i
    g.allow(f"user:{i}", now)
before = len(g.tat)
g.sweep(now)
print(f"keys stored: {before:,} before sweep, {len(g.tat):,} after (only keys within {T} ms of now)")
```

```output
20,000 requests over 1,813 s: token bucket and GCRA agree on all 20,000 decisions (17,919 admitted)
keys stored: 100,000 before sweep, 100 after (only keys within 100 ms of now)
```

Two practical wins. **State is one number**, so in Redis it's a plain string with an expiry rather than a hash with two fields. And **expiry is exact**: a key whose TAT has passed is a full bucket, indistinguishable from no key, so its TTL is simply $\text{TAT} - \text{now}$. In the sweep, 100,000 one-off users leave 100 live keys — those seen in the last 100 ms. That is the TTL rule from [§28.4](/c/system-design/28-rate-limiter) ($b/r$ for a bucket that was just emptied) made precise per key.

## 69.4 The distributed version

Many gateways share one limit, so the state moves to a store and the atomic step becomes a server-side script — one round trip, no window between read and write. The GCRA form in Redis Lua (not run here; [§57.6](/c/system-design/57-rate-limiter-service) has the two-field bucket version):

```lua
-- KEYS[1] = rl:{acct:42}   ARGV: interval_ms (1000 / rate), burst, cost
local T, burst, cost = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
local t = redis.call('TIME')                          -- one clock for every gateway
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local tat = math.max(tonumber(redis.call('GET', KEYS[1])) or now, now)
local new_tat = tat + cost * T
local allow_at = new_tat - burst * T                  -- earliest time this request conforms
if allow_at > now then
  return {0, allow_at - now}                          -- rejected: Retry-After in ms
end
redis.call('SET', KEYS[1], new_tat, 'PX', math.ceil(new_tat - now))   -- expires when full again
return {1, 0}
```

Checking it against §69.3: with cost 1, `allow_at > now` is $\text{TAT}' + T - bT > \text{now}$, i.e. $\text{TAT}' - \text{now} > (b - 1)T = \tau$ — the same rejection rule. Notes for production:

- **One clock.** The script reads Redis `TIME` so gateways with skewed clocks agree. (On old Redis versions, writing after a non-deterministic command inside a script required `redis.replicate_commands()`; recent versions replicate script effects by default.)
- **One key per script.** In a cluster all keys of a script must hash to one slot; check account and IP limits as two scripts in parallel and accept that a request rejected by one may have spent a token in the other ([§57.6](/c/system-design/57-rate-limiter-service)).
- **Cost of the round trip.** ~0.5 ms intra-DC ([§2](/c/system-design/02-estimation)) per decision. The cheaper alternatives trade exactness for it: split the limit across $N$ gateways ($r/N$ each — an honest client at 80/s got only 49/s at $N$ = 16 in [§28.3](/c/system-design/28-rate-limiter)), or count locally and sync every Δ (overshoot up to $N \cdot r \cdot \Delta$, [§57.7](/c/system-design/57-rate-limiter-service)), or route each key to one limiter instance by [consistent hashing](/c/system-design/64-consistent-hashing) so its bucket lives whole in one process.
- **Store down.** Decide per limit: fail open with a local $r/N$ backstop for abuse guardrails, fail closed only for contractual quotas ([§28.4](/c/system-design/28-rate-limiter)).

## 69.5 Production notes

- **Thread safety.** One lock per bucket is enough; with many keys use a dict of buckets guarded by a striped lock or a concurrent map, and never hold the map lock while computing. In asyncio, a bucket needs no lock if nothing awaits between refill and take.
- **Clock.** `time.monotonic()` in-process; Redis `TIME` across processes. Store time as integer ms or ns if you need exact agreement between implementations — §69.3's equivalence test only holds bit-for-bit in integers.
- **Memory.** A bucket is ~100 B per key in Redis with overhead ([§28.4](/c/system-design/28-rate-limiter)); expire keys at full-bucket time. Unbounded in-process maps of per-user buckets are a slow memory leak; sweep or use an LRU.
- **What real systems do.** AWS API Gateway documents its throttling as a token bucket with a rate and a burst; Envoy's local rate limit filter is a token bucket; NGINX's `limit_req` is a leaky bucket with a `burst` queue; the redis-cell module implements GCRA; Guava's `RateLimiter` hands out permits at a steady rate and can block callers until one is available. Same two knobs everywhere: a sustained rate and how much burst you tolerate.

:::warn[Rate is not concurrency]
A bucket bounds arrivals, not work in flight. When the payment provider slows from 300 ms to 2 s, the same 2,000 calls/s become 4,000 in flight by Little's law ([§10](/c/system-design/10-latency-and-throughput)). Pair the bucket with a concurrency limit (a semaphore) per dependency.
:::

## 69.6 Interview angle

| Question | Answer with numbers |
|---|---|
| Complexity? | $O(1)$ time and two numbers (or one, GCRA) per key; sliding log is $O(L)$ memory per key |
| Worst case in a window $W$? | Bucket $b + rW$ (650 for $b$ = 50 at 10/s over 60 s); fixed window $2L$; sliding counter up to ~$2L$ adversarially, ~1% over on honest traffic |
| Why lazy refill? | Exact, no timer thread, no drift; refill is computed from elapsed time on each call |
| Two gateways, one token? | Check-and-take must be atomic: a lock in-process, one Lua script in Redis; `GET` then `SET` admits both |
| What does a rejected client get? | 429 with `Retry-After` = (cost − tokens)/r plus jitter; a 4xx if cost > b |
| How do you pick b? | From honest bursts and backend tolerance: $b$ = 50 rejected 40% of a bursty but compliant client; $b$ = 600 admitted it all |

Edge cases: first request for an unseen key (start full), clock going backwards, cost greater than burst, fractional costs, huge idle gaps (cap), and rate changes at runtime (refill with the old rate up to now, then switch).

Follow-ups: hierarchical limits (per user inside per tenant inside global — check the narrowest first and refund on a later rejection, or accept the small one-sided error), priority classes (separate buckets so checkout isn't starved by search), and adaptive limits that shrink $r$ when the backend's latency rises.

## 69.7 Check yourself

:::qa[A bucket has r = 10/s and b = 20. A client idle for a minute sends 100 requests in 1 s. How many are admitted?]
It starts full: 20, plus 10 refilled during the second, so about 30. The cap stops the idle minute from banking 600 tokens.
:::

:::qa[Why can a sliding window counter admit nearly 2× its limit, and why do people still use it?]
It assumes the previous window's requests were spread evenly. If they were all at its end, the estimate under-counts the trailing window by up to the previous window's total, and an attacker who then sends steadily gets ~2L in 60 s (1,190 of 600 measured). On real traffic the error is small (605 vs 600 here) and the state is two integers, so it suits quotas that aren't hard contracts.
:::

:::qa[Your Redis limiter does GET tokens, computes in the gateway, then SET tokens. What goes wrong at 2,000 checkouts/s, and how do you fix it?]
Two gateways read the same token count between the GET and the SET and both admit; the second SET overwrites the first, so tokens are spent once for two requests. Under load this happens constantly. Move the read-refill-check-write into one Lua script (or use GCRA in one script) so Redis executes it atomically.
:::

:::qa[How long should a GCRA key live in Redis, and what happens if it expires early?]
Until its TAT: `PX = TAT − now`. After that the bucket is full and the key carries no information. If it expires early, the client gets a full bucket too soon — up to $b$ extra requests — so never set the TTL shorter than TAT − now.
:::

Next: [Common mistakes](/c/system-design/70-common-mistakes) — the reference part of the course starts here.
