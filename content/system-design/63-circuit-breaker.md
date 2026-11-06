---
section: "63"
title: "Circuit breaker"
kicker: "Implementations"
abstract: "A thread-safe circuit breaker in ~50 lines — rolling window, minimum volume, jittered cool-down, exactly k half-open probes, stale results ignored — tested with a fake clock and 50 racing threads, then measured against checkout's payment provider hanging for 40 s: mean latency 2,500 ms → 178 ms and 14× fewer calls into the dead provider."
time: "15 min"
order: 63
outcomes:
  - "Implement a closed / open / half-open breaker whose decisions can't race"
  - "Test it deterministically with an injected clock, including concurrent half-open probes"
  - "Measure error rate, latency and load on the dependency with and without a breaker during an outage"
  - "Choose the window and cool-down from detection delay, probe load and recovery delay"
---

One checkout API instance sends its share of the flash sale to the payment provider: 2,000 calls/s across 15 instances ≈ 133 calls/s each ([§20.5](/c/system-design/20-circuit-breaker)). The provider (p50 300 ms, p99 2 s, illustrative) hangs for 40 seconds. Without a breaker every one of those calls waits the full 2.5 s timeout to be told no — \(133 \times 2.5\) ≈ 333 requests stuck per instance at any moment, all failing, all still hammering a provider that is trying to recover. [§20](/c/system-design/20-circuit-breaker) derived the tuning; this section builds the breaker, tests the parts that are easy to get wrong, and measures what it changes.

:::key[First principle]
A breaker is a small state machine that turns "this dependency is failing" into "don't wait for it": **closed** counts outcomes over a rolling window, **open** fails fast for a cool-down, **half-open** lets exactly $k$ probes decide. The two correctness rules are that every decision reads and writes the counters atomically, and that a result is only counted against the state it was started under.
:::

## 63.1 What the implementation must get right

| Requirement | Why | How below |
|---|---|---|
| Rolling window by time, with a minimum volume | 1 failure out of 2 calls must not trip it; old failures must age out | `deque` of `(t, failed)`, pruned on each result; trip at ≥ 50% over ≥ 20 calls |
| Count only dependency failures | A 4xx means the provider is healthy and *we* sent a bad request | `counts(exc)` predicate; `ClientError` counts as an answer |
| Exactly $k$ probes in half-open | Letting all traffic through on recovery knocks a restarting service over again | `issued` counter checked and incremented under the lock |
| Ignore stale results | A call started before the trip can land during half-open and wrongly re-open it | Each permit carries the state's **generation**; mismatches are dropped |
| Never hold the lock during the call | The lock would serialise every request through one dependency | Lock only around `acquire` and `release` |
| Jittered cool-down | 15 instances opened together would probe together | `cooldown + U(0, jitter)` |
| Injectable clock | Tests must not sleep | `clock=time.monotonic` by default — monotonic, never wall time |

The API is split into `acquire()` → permit or `None`, and `release(permit, failed)`, so it also works around async or callback-style clients; `call(fn, fallback)` wraps both for the common case.

## 63.2 The implementation and its tests

```python run
import random, threading, time
from collections import deque

class CircuitOpen(Exception): pass
class ClientError(Exception): pass      # a 4xx: the dependency is healthy, the request was bad

class CircuitBreaker:
    def __init__(self, threshold=0.5, min_calls=20, window=2.0, cooldown=5.0, jitter=1.0,
                 probes=5, clock=time.monotonic, rng=None):
        self.threshold, self.min_calls, self.window = threshold, min_calls, window
        self.cooldown, self.jitter, self.probes = cooldown, jitter, probes
        self.clock, self.rng, self.lock = clock, rng or random.Random(), threading.Lock()
        self.state, self.gen, self.open_until = "closed", 0, 0.0
        self.events, self.fails, self.issued, self.passed = deque(), 0, 0, 0

    def _move(self, state):                 # every transition starts a new generation
        self.state, self.gen = state, self.gen + 1
        self.events.clear(); self.fails = self.issued = self.passed = 0
        if state == "open":
            self.open_until = self.clock() + self.cooldown + self.rng.uniform(0, self.jitter)

    def acquire(self):                      # a permit (the generation), or None = fail fast
        with self.lock:
            if self.state == "open" and self.clock() >= self.open_until:
                self._move("half_open")
            if self.state == "open" or (self.state == "half_open" and self.issued >= self.probes):
                return None
            self.issued += self.state == "half_open"
            return self.gen

    def release(self, permit, failed):
        with self.lock:
            if permit != self.gen: return   # call started under an earlier state: ignore it
            if self.state == "half_open":
                self.passed += not failed
                if failed or self.passed == self.probes: self._move("open" if failed else "closed")
                return
            now = self.clock()
            self.events.append((now, failed)); self.fails += failed
            while self.events[0][0] < now - self.window: self.fails -= self.events.popleft()[1]
            if len(self.events) >= self.min_calls and self.fails >= self.threshold * len(self.events):
                self._move("open")

    def call(self, fn, fallback=None, counts=lambda exc: not isinstance(exc, ClientError)):
        permit = self.acquire()             # the lock is never held while fn() runs
        if permit is None:
            if fallback is None: raise CircuitOpen()
            return fallback()
        try: result = fn()
        except Exception as exc:
            self.release(permit, counts(exc)); raise
        self.release(permit, False); return result

def boom(exc): raise exc()
def fail(cb, n, exc=TimeoutError):
    for _ in range(n):
        try: cb.call(lambda: boom(exc))
        except exc: pass

now = [0.0]
cb = CircuitBreaker(clock=lambda: now[0], rng=random.Random(63))
fail(cb, 15); now[0] = 3.0; fail(cb, 100, ClientError)
assert (cb.state, cb.fails, len(cb.events)) == ("closed", 0, 100), "old failures left the window"
fail(cb, 99)
assert (cb.state, cb.fails, len(cb.events)) == ("closed", 99, 199), "4xx count as answers"
fail(cb, 1); assert cb.state == "open", "100 of 200 failed: >= 50% over >= 20 calls"
ran = []
assert cb.call(lambda: ran.append(1), fallback=lambda: "cached") == "cached" and not ran
stale, now[0] = cb.gen - 1, cb.open_until
permits = [cb.acquire() for _ in range(7)]
assert cb.state == "half_open" and permits.count(None) == 2, "only 5 probes go through"
cb.release(stale, True); assert cb.state == "half_open", "a call from before the trip is ignored"
for p in permits[:4]: cb.release(p, False)
cb.release(permits[4], True); assert cb.state == "open", "one failed probe re-opens"
now[0] = cb.open_until
for p in [cb.acquire() for _ in range(5)]: cb.release(p, False)
assert cb.state == "closed" and cb.call(lambda: "paid") == "paid"

fail(cb, 19); now[0] = cb.open_until
barrier, got = threading.Barrier(50), []
def racer(): barrier.wait(); got.append(cb.acquire())
threads = [threading.Thread(target=racer) for _ in range(50)]
for t in threads: t.start()
for t in threads: t.join()
assert sum(p is not None for p in got) == 5, "50 racing threads get exactly 5 probe permits"
print("all breaker tests passed | transitions:", cb.gen, "| state:", cb.state,
      "| probe permits granted to 50 racing threads:", sum(p is not None for p in got))
```

```output
all breaker tests passed | transitions: 7 | state: half_open | probe permits granted to 50 racing threads: 5
```

What each test pins down:

1. **Window and minimum volume.** 15 failures at $t$ = 0 are gone by $t$ = 3 s, so 100 later answers start from a clean window.
2. **Client errors.** 100 `ClientError`s count as answers, which is why 99 timeouts on top (99 of 199 = 49.7%) leave it closed and the 100th (100 of 200 = 50%) opens it.
3. **Fail fast.** When open, the dependency is not touched (`ran` stays empty) and the fallback answers.
4. **Probes.** Seven callers in half-open: five get permits, two fall back. A late result from a call started before the trip is ignored. One failed probe re-opens; five successes close.
5. **Concurrency.** 50 threads released by a barrier into a half-open breaker get exactly 5 permits. Without the lock around the check-and-increment, several threads read `issued < 5` together and the probe limit leaks.

## 63.3 Measuring it: a 40-second provider outage

The simulation replays 160 s of one instance's traffic (Poisson, 133 calls/s) with the provider hung from 40 s to 80 s; a hung call fails at the 2.5 s timeout. Healthy calls follow the lognormal latency above plus 0.5% background errors. The breaker is the class above minus the lock (the event loop is single-threaded), with the defaults from [§20.8](/c/system-design/20-circuit-breaker): ≥ 50% failures over ≥ 20 calls, 5 probes, cool-down 5 s + U(0, 1) s. A fail-fast call costs 1 ms. The second table sweeps the cool-down over 20 outage end times spread across a full probe cycle, so recovery lands at every phase.

```python run
import heapq, random
from collections import deque
import numpy as np

class CircuitBreaker:                       # same logic as the block above, without the lock
    def __init__(self, clock, rng, window=2.0, cooldown=5.0, threshold=0.5, min_calls=20, probes=5):
        self.clock, self.rng, self.window, self.cooldown = clock, rng, window, cooldown
        self.threshold, self.min_calls, self.probes = threshold, min_calls, probes
        self.state, self.gen, self.open_until, self.closed_at = "closed", 0, 0.0, []
        self.events, self.fails, self.issued, self.passed = deque(), 0, 0, 0
    def _move(self, state):
        self.state, self.gen = state, self.gen + 1
        self.events.clear(); self.fails = self.issued = self.passed = 0
        if state == "open": self.open_until = self.clock() + self.cooldown + self.rng.uniform(0, 1)
        if state == "closed": self.closed_at.append(self.clock())
    def acquire(self):
        if self.state == "open" and self.clock() >= self.open_until: self._move("half_open")
        if self.state == "open" or (self.state == "half_open" and self.issued >= self.probes):
            return None
        self.issued += self.state == "half_open"
        return self.gen
    def release(self, permit, failed):
        if permit != self.gen: return
        if self.state == "half_open":
            self.passed += not failed
            if failed or self.passed == self.probes: self._move("open" if failed else "closed")
            return
        self.events.append((self.clock(), failed)); self.fails += failed
        while self.events[0][0] < self.clock() - self.window: self.fails -= self.events.popleft()[1]
        if len(self.events) >= self.min_calls and self.fails >= self.threshold * len(self.events):
            self._move("open")

rng = np.random.default_rng(63)
END, DOWN, TIMEOUT = 160, 40.0, 2.5           # provider hangs from 40 s; client timeout 2.5 s
arr = np.cumsum(rng.exponential(1 / 133, 25_000)); arr = arr[arr < END]   # one of 15 instances
lat = rng.lognormal(np.log(0.3), 0.8156, arr.size)                        # p50 300 ms, p99 2 s
err = rng.random(arr.size) < 0.005

def run(window=None, cooldown=5.0, up=80.0, seed=1):
    now = [0.0]
    cb = window and CircuitBreaker(lambda: now[0], random.Random(seed), window, cooldown)
    heap, out = [], np.zeros((arr.size, 3))       # caller latency (s), failed, reached provider
    for i, t in enumerate(arr):
        while heap and heap[0][0] <= t:
            now[0], permit, failed = heapq.heappop(heap)
            if cb: cb.release(permit, failed)
        now[0] = t
        permit = cb.acquire() if cb else 0
        if permit is None:
            out[i] = 0.001, 1, 0                  # fail fast into the fallback
            continue
        hung = DOWN <= t < up
        d = TIMEOUT if hung else min(lat[i], TIMEOUT)
        out[i] = d, hung or lat[i] > TIMEOUT or err[i], 1
        heapq.heappush(heap, (t + d, permit, out[i, 1]))
    return out, cb

phases = {"0-40 s healthy": arr < DOWN, "40-80 s hung": (arr >= DOWN) & (arr < 80),
          "80-120 s back": (arr >= 80) & (arr < 120)}
print("%-13s %-15s %7s %9s %8s %11s" % ("config", "phase", "errors", "mean lat", "p99 lat", "to provider"))
runs = {name: run(w) for name, w in (("no breaker", None), ("breaker 10 s", 10.0), ("breaker 2 s", 2.0))}
for name, (out, cb) in runs.items():
    for ph, m in phases.items():
        print("%-13s %-15s %6.1f%% %6.0f ms %5.0f ms %11d" % (name, ph, 100 * out[m, 1].mean(),
              1000 * out[m, 0].mean(), 1000 * np.percentile(out[m, 0], 99), out[m, 2].sum()))
print("\ncooldown | calls to dead provider per min | mean s from recovery to closed (20 outage ends)")
for c in (1, 2, 5, 10, 20, 30):
    probes, delay = [], []
    for k in range(20):
        up = 80 + k * (c + 3) / 20                # recovery lands at every phase of the cycle
        out, cb = run(2.0, c, up, seed=k)
        probes.append(out[(arr >= 50) & (arr < up), 2].sum() * 60 / (up - 50))
        delay.append(min(x for x in cb.closed_at if x >= up) - up)
    print("%6d s | %30.1f | %8.1f" % (c, np.mean(probes), np.mean(delay)))
print("\nchart: second, no breaker, breaker 10 s window, breaker 2 s window")
for s in range(34, 96, 2):
    m = (arr >= s) & (arr < s + 2)
    print("%d, %s" % (s, ", ".join("%.0f" % (1000 * o[m, 0].mean()) for o, _ in runs.values())))
```

```output
config        phase            errors  mean lat  p99 lat to provider
no breaker    0-40 s healthy     0.8%    405 ms  1848 ms        5325
no breaker    40-80 s hung     100.0%   2500 ms  2500 ms        5291
no breaker    80-120 s back      1.0%    414 ms  1995 ms        5311
breaker 10 s  0-40 s healthy     0.8%    405 ms  1848 ms        5325
breaker 10 s  40-80 s hung     100.0%    410 ms  2500 ms         866
breaker 10 s  80-120 s back     13.2%    362 ms  1906 ms        4655
breaker 2 s   0-40 s healthy     0.8%    405 ms  1848 ms        5325
breaker 2 s   40-80 s hung     100.0%    178 ms  2500 ms         374
breaker 2 s   80-120 s back      2.6%    407 ms  1976 ms        5223

cooldown | calls to dead provider per min | mean s from recovery to closed (20 outage ends)
     1 s |                           74.8 |      3.0
     2 s |                           60.2 |      2.8
     5 s |                           35.2 |      4.8
    10 s |                           25.5 |      8.0
    20 s |                           12.3 |     12.3
    30 s |                            7.9 |     19.6

chart: second, no breaker, breaker 10 s window, breaker 2 s window
34, 434, 434, 434
36, 403, 403, 403
38, 387, 387, 387
40, 2500, 2500, 2500
42, 2500, 2500, 798
44, 2500, 2500, 1
46, 2500, 613, 50
48, 2500, 1, 1
50, 2500, 48, 1
52, 2500, 1, 1
54, 2500, 1, 1
56, 2500, 1, 50
58, 2500, 49, 1
60, 2500, 1, 1
62, 2500, 1, 1
64, 2500, 1, 49
66, 2500, 1, 1
68, 2500, 47, 1
70, 2500, 1, 1
72, 2500, 1, 53
74, 2500, 44, 1
76, 2500, 1, 1
78, 2500, 1, 1
80, 430, 1, 265
82, 438, 8, 438
84, 411, 147, 411
86, 432, 432, 432
88, 397, 397, 397
90, 456, 456, 456
92, 373, 373, 373
94, 446, 446, 446
```

:::chart[Mean caller latency per 2 s while the payment provider hangs from 40 s to 80 s (one instance, simulated)]{type="line" x="time (s)" y="mean latency (ms)" marks="40:provider hangs;80:provider back" hmarks="2500:timeout"}
second, no breaker, breaker 10 s window, breaker 2 s window
34, 434, 434, 434
36, 403, 403, 403
38, 387, 387, 387
40, 2500, 2500, 2500
42, 2500, 2500, 798
44, 2500, 2500, 1
46, 2500, 613, 50
48, 2500, 1, 1
50, 2500, 48, 1
52, 2500, 1, 1
54, 2500, 1, 1
56, 2500, 1, 50
58, 2500, 49, 1
60, 2500, 1, 1
62, 2500, 1, 1
64, 2500, 1, 49
66, 2500, 1, 1
68, 2500, 47, 1
70, 2500, 1, 1
72, 2500, 1, 53
74, 2500, 44, 1
76, 2500, 1, 1
78, 2500, 1, 1
80, 430, 1, 265
82, 438, 8, 438
84, 411, 147, 411
86, 432, 432, 432
88, 397, 397, 397
90, 456, 456, 456
92, 373, 373, 373
94, 446, 446, 446
:::

:::example[Worked example · what the breaker changed, per instance]
- **Errors don't change during the outage: 100% either way.** The breaker cannot make a dead provider succeed. What it changes is *how* calls fail.
- **Latency: 2,500 ms → 178 ms mean** with a 2 s window. The first ~2.5 s of the outage still wait the full timeout — nothing can be counted before the first timeout lands — then every caller gets the fallback in 1 ms. The 10 s window opens ~6 s in and averages 410 ms. Both match [§20.4](/c/system-design/20-circuit-breaker)'s detection delay with failures completing at the arrival rate: $\max(\tau, (W + \tau)/2)$ = 2.5 s and 6.25 s.
- **Load on the dead provider: 5,291 calls → 374** (2 s window), 14× fewer — ~5,600 instead of ~79,000 across 15 instances. A provider that is restarting needs that.
- **Workers held** (Little's law, $L = \lambda W$): \(133 \times 2.5\) ≈ 333 per instance without a breaker, ~0 once open. That is what keeps the rest of the service alive ([§20.3](/c/system-design/20-circuit-breaker) simulates the shared pool).
- **The price is paid after recovery.** Errors from 80–120 s: 1.0% without a breaker (the baseline), 2.6% with the 2 s window, 13.2% with the 10 s window — calls failed fast against a provider that was already healthy.
- **The 1 ms / ~50 ms sawtooth while open** is the probe cycle: every ~8 s, 5 probes go through and hang for 2.5 s, lifting that bucket's mean.
:::

**Choosing the cool-down.** While the provider is dead the breaker cycles open ($C$ + jitter) → half-open (5 probes, each hanging $\tau$) → open, so probe load is about

$$
\text{probes/min} \approx \frac{5 \times 60}{C + 0.5 + \tau} = \frac{300}{C + 3}
$$

— 75, 60, 37.5, 23, 13 and 9 per minute for $C$ = 1, 2, 5, 10, 20, 30 s, matching the measured 74.8, 60.2, 35.2, 25.5, 12.3 and 7.9. Recovery waits for the next probe, on average about half a cycle: 4.8 s at $C$ = 5 s, 19.6 s at 30 s. Below ~2 s the probe timeout dominates the cycle, so a 1 s cool-down (3.0 s) recovers no faster than 2 s (2.8 s) and doubles the probes. **Start at 5 s with jitter**: ~35 probes a minute per instance into a dead provider, ~5 s to notice it is back.

## 63.4 Production notes

**Thread safety and cost.** One lock per breaker, held for a few dictionary and deque operations, never during the call. Per call that is $O(1)$ amortised (each result is appended and pruned once). The window holds $\lambda W$ entries: 266 here, 4,000 if one instance took all 2,000 calls/s. At high rates replace the deque with **bucketed counters** — e.g. 10 buckets of 200 ms, each `(calls, failures)` — so memory is constant and the trip check is a sum over 10 numbers.

**State is per instance.** Each of the 15 instances decides from its own ~133 calls/s, which is plenty of volume. A shared breaker in Redis would add a network call to every call in order to protect a network call, and would fail exactly when the network does.

**Where it sits.** Per dependency (often per host for a load-balanced pool), inside the caller: deadline → bulkhead → breaker → timeout → call, with retries *outside* the breaker and `CircuitOpen` never retried ([§20.7](/c/system-design/20-circuit-breaker), [§67](/c/system-design/67-retry)).

**Count slow calls too.** An error-rate breaker never opens on a provider that is merely 2–3× slower, yet that already exhausts the worker pool. Add "calls slower than ~1 s count as failed, open at 30%" ([§38.4](/c/system-design/38-one-service-failing-breaker)): one more comparison in `release`.

**What libraries do.**

| Library / system | What it gives you |
|---|---|
| Resilience4j (Java) | Count- or time-based sliding window, failure-rate and slow-call-rate thresholds, minimum number of calls, permitted calls in half-open, exception predicates |
| Polly (.NET) | Breaker strategies with failure ratio, minimum throughput, sampling duration and break duration |
| Hystrix (Netflix) | The pattern's popular origin; in maintenance mode, superseded by the above |
| pybreaker (Python) | Consecutive-failure breaker; add your own window and probe limit if you need them |
| Envoy | "Circuit breaking" = per-cluster concurrency caps (connections, pending requests, retries) — a bulkhead; *outlier detection* ejects failing hosts, which is the per-host breaker |

**Observability.** Export state transitions, time spent open and fallback rate per dependency, and alert when a breaker has been open more than a few minutes. A breaker that quietly serves an empty widget for a week is a feature that has been down for a week.

:::warn[Failure modes of the code itself]
- **Lock held around `fn()`** → every call to the dependency is serialised; throughput collapses to 1 / latency.
- **Check and increment of `issued` in separate critical sections** → the 50-thread test lets more than 5 probes through.
- **No generation check** → with a cool-down shorter than the timeout, calls from before the trip land in half-open and re-open it forever.
- **Wall-clock time** → an NTP step backwards keeps the breaker open; use a monotonic clock.
- **Counting `CircuitOpen` or 4xx as failures** → the breaker feeds on its own rejections or on client bugs.
:::

## 63.5 Interview angle

Complexity: $O(1)$ amortised per call, $O(\lambda W)$ memory (or $O(\text{buckets})$). Edge cases to raise unprompted: minimum volume; what counts as a failure; concurrent half-open probes; results that arrive after a state change; the fallback itself failing (it must be cheap and local); clock choice; testing without sleeps. Follow-ups to expect:

- *Count-based or time-based window?* Count-based (last 100 calls) is simple and volume-independent but reacts slowly at low traffic; time-based reacts in bounded time but needs a minimum volume.
- *How long to stay open?* From §63.3: probe load $\approx 300/(C+3)$ per minute vs recovery ≈ half a cycle; 5 s with jitter.
- *Breaker vs retries vs bulkhead?* The breaker removes waiting, the bulkhead caps how many workers one dependency can hold, retries are only safe outside the breaker with a budget.
- *Should breaker state be shared across instances?* No (§63.4).

## 63.6 Check yourself

:::qa[An instance makes 133 calls/s with a 2.5 s timeout and a 2 s window. How long after the provider hangs does the breaker open, and why can't it be faster?]
About 2.5 s: a hung call is only counted when it times out, so the first failure lands $\tau$ = 2.5 s after the hang began; by then the 2 s window holds only failures. In the chart, the 42–44 s bucket averages 798 ms because it straddles the trip. To open sooner, lower the timeout or count slow calls.
:::

:::qa[Why does the breaker hand out a permit carrying a generation number instead of just a boolean?]
Results arrive after the state may have changed. With a 1 s cool-down and a 2.5 s timeout, calls started while closed are still timing out when the breaker goes half-open; counted there, each looks like a failed probe and re-opens the circuit. The generation lets `release` drop results that belong to an earlier state.
:::

:::qa[You set the cool-down to 30 s to "protect the provider". What does it cost, per instance at 133 calls/s?]
Probe load falls to ~8 calls a minute, but recovery waits on average ~20 s (19.6 s measured): \(133 \times 19.6\) ≈ 2,600 payments failed fast against a healthy provider per instance, ~39,000 across 15. At 5 s it is ~4.8 s and ~640 per instance, for ~35 probes a minute — still negligible next to 8,000 calls a minute.
:::

:::qa[A teammate wraps `fn()` inside `with self.lock:` "to be safe". What happens at checkout's load?]
All calls through that breaker are serialised: one in flight at a time, so throughput is 1 / 0.42 s ≈ 2.4 calls/s against 133 arriving. The queue grows without bound and the breaker itself becomes the outage. Hold the lock only for bookkeeping.
:::

Next: [§64 Consistent hashing](/c/system-design/64-consistent-hashing) — placing keys on nodes so a resize moves 1/N of them.
