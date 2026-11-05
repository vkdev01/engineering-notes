---
section: "14"
title: "Benchmarking and performance engineering"
kicker: "Measurement"
abstract: "Benchmark the full request path the way production will load it — warm-up discarded, open-loop arrivals, percentiles from enough samples — then rank optimisations by the bytes and FLOPs they actually remove."
time: "30 min"
order: 14
outcomes:
  - "Build a harness that separates warm-up from steady state and reports percentiles, not means"
  - "Detect and correct coordinated omission in a load generator"
  - "Compute how many samples a stable p99 needs"
  - "Predict throughput vs batch size from a bandwidth/FLOP roofline"
  - "Rank optimisation levers by first-principles gain before implementing any of them"
---

A team reports "mean latency 24 ms" for the ticket router and signs a 100 ms p99 SLO. In production, p99 is 176 ms and one request in a thousand takes a second. Nothing regressed: the mean never described the tail, and the benchmark that produced it had warm-up mixed in, a load generator that stopped sending during stalls, and too few samples to see p99 at all. This section builds a benchmark that would have caught all three.

:::key[First principle]
A benchmark is an experiment on a distribution. Fix the workload, discard warm-up, generate load on a schedule that does not wait for the server, collect enough samples to resolve the percentile you promise, and report that percentile — never the mean alone.
:::

## 14.1 Define the experiment before running it

Latency depends on more than the model. Fix and record every variable that moves it:

| Variable | Why it moves latency | Record |
|---|---|---|
| Bundle (weights, tokenizer, prompt, quantisation) | bytes per token, prompt length | `bundle_id` (§13.9) |
| Hardware, runtime, threads, driver | effective BW and FLOP/s | exact versions |
| Prompt and output token distributions | prefill ∝ prompt, decode ∝ output | histogram from production sample, not one prompt |
| Arrival process and rate | queueing (§13.4) | open-loop rate, or utilisation $\rho$ |
| Batch limit and concurrency | §13.5 trade-off | the cap, not "default" |
| Warm-up rule | cold caches, JIT, allocator | how many requests discarded, and why |
| Quality on the same run | a faster model that is wrong is not faster | accuracy / cost on the evaluated set (§11) |

Know which metric matches the task:

| Metric | Meaning | Matters for |
|---|---|---|
| end-to-end latency | request in → decision out, including queue | every decision service; this is the SLO |
| TTFT (time to first token) | queue + prefill | streaming UIs; for decisions it is ≈ prefill |
| inter-token latency | one decode step | long outputs; a decision has 5–15 tokens |
| output tokens/s | generation throughput | chat; misleading for classifiers |
| decisions/s at the SLO | capacity that still meets p95/p99 | sizing (§13.3) |

## 14.2 Warm-up, steady state and why p99 ≫ mean

The harness below separates warm-up from steady state and reports the distribution. So the output is reproducible, the "service" is simulated: a lognormal body (median 20 ms), a decaying cold-start cost, a 1% chance of a 150–400 ms stall (GC, page fault, noisy neighbour) and a 0.1% chance of a 1 s client timeout-and-retry. To benchmark a real model, replace `simulated_call` with a `time.perf_counter()` pair around the real request.

```python run
"""Micro-benchmark harness: warm-up, steady state, percentiles. Latencies are simulated so the run is reproducible."""
import numpy as np

rng = np.random.default_rng(14)


def simulated_call(i):
    """Latency (ms) of request i. In real use: t0 = perf_counter(); call(); return 1e3*(perf_counter()-t0)."""
    base = rng.lognormal(np.log(20.0), 0.25)                  # the normal path, median 20 ms
    cold = 400.0 * np.exp(-i / 30.0)                          # JIT, allocator, cache warm-up
    stall = rng.uniform(150, 400) if rng.random() < 0.01 else 0.0   # GC pause, page fault, noisy neighbour
    retry = 1000.0 if rng.random() < 0.001 else 0.0           # client timeout + retry
    return base + cold + stall + retry


def bench(call, warmup, n):
    lat = np.array([call(i) for i in range(warmup + n)])
    return lat[:warmup], lat[warmup:]


def summary(x):
    q = np.percentile(x, [50, 90, 99, 99.9])
    return "n=%6d mean=%6.1f sd=%6.1f p50=%5.1f p90=%5.1f p99=%6.1f p99.9=%7.1f max=%7.1f" % (
        len(x), x.mean(), x.std(), *q, x.max())


warm, steady = bench(simulated_call, warmup=500, n=20_000)
print("all requests   ", summary(np.concatenate([warm, steady])))
print("first 100 only ", summary(warm[:100]))
print("steady state   ", summary(steady))
print("p99 / mean = %.1fx ; mean + 2 sd = %.1f ms (a 'p97.5' that is wrong)" % (
    np.percentile(steady, 99) / steady.mean(), steady.mean() + 2 * steady.std()))
print("true share of steady requests above mean + 2 sd: %.2f%%" % (
    100 * (steady > steady.mean() + 2 * steady.std()).mean()))

edges = [0, 15, 20, 25, 30, 40, 100, 200, 300, 400, 1000, 2000]
counts, _ = np.histogram(steady, bins=edges)
print("histogram:", ", ".join("%d-%d:%d" % (a, b, c) for a, b, c in zip(edges, edges[1:], counts)))
qs = [50, 75, 90, 95, 98, 99, 99.5, 99.8, 99.9, 99.95]
print("percentile curve:", ", ".join("p%s=%.0f" % (q, v) for q, v in zip(qs, np.percentile(steady, qs))))
```

```output
all requests    n= 20500 mean=  24.8 sd=  44.5 p50= 20.1 p90= 28.1 p99= 209.2 p99.9= 1012.6 max= 1039.3
first 100 only  n=   100 mean= 138.0 sd= 104.1 p50= 96.7 p90=309.7 p99= 396.8 p99.9=  421.1 max=  423.8
steady state    n= 20000 mean=  24.2 sd=  43.5 p50= 20.1 p90= 27.9 p99= 176.5 p99.9= 1013.4 max= 1039.3
p99 / mean = 7.3x ; mean + 2 sd = 111.2 ms (a 'p97.5' that is wrong)
true share of steady requests above mean + 2 sd: 1.02%
histogram: 0-15:2449, 15-20:7405, 20-25:6250, 25-30:2664, 30-40:973, 40-100:55, 100-200:17, 200-300:74, 300-400:74, 400-1000:16, 1000-2000:23
percentile curve: p50=20, p75=24, p90=28, p95=31, p98=36, p99=176, p99.5=317, p99.8=398, p99.9=1013, p99.95=1020
```

Four readings:

1. **Warm-up is a different distribution.** The first 100 requests have p50 = 96.7 ms against 20.1 ms in steady state; leaving the 500 warm-up requests in moves p99 from 176.5 to 209.2 ms. Discard warm-up until a rolling p50 stops moving, and say how many you discarded.
2. **The mean describes nobody.** 24.2 ms is above the median and 7.3× below p99. A rare, large component (1% stalls, 0.1% retries) barely moves the mean and *is* the tail.
3. **Mean + 2 sd is not a percentile.** Gaussian intuition says 2.5% of requests exceed 111 ms; the real share is 1.02%, and the requests that do exceed it are 2–10× slower, not slightly slower.
4. **Percentile definitions differ.** NumPy interpolates between order statistics; nearest-rank picks one. On 20,000 samples the difference is negligible; on 10 samples p95 and p99 are both just the maximum. State the definition.

:::chart[Steady-state latency histogram (20,000 requests, log count axis)]{type="bar" x="latency bucket (ms)" y="requests" ylog="true"}
bucket, requests
0–15, 2449
15–20, 7405
20–25, 6250
25–30, 2664
30–40, 973
40–100, 55
100–200, 17
200–300, 74
300–400, 74
400–1000, 16
1000–2000, 23
:::

The second hump at 200–400 ms is the stall population. A mean or a single "typical" number cannot show it; the percentile curve makes it obvious:

:::chart[Percentile curve: the tail is a different population]{type="line" x="percentile" y="latency" unit=" ms" ylog="true" ymax="2000" hmarks="24.2:mean"}
percentile, latency
p50, 20
p75, 24
p90, 28
p95, 31
p98, 36
p99, 176
p99.5, 317
p99.8, 398
p99.9, 1013
p99.95, 1020
:::

## 14.3 Coordinated omission

Most quick load generators are **closed-loop**: each virtual user sends a request, waits for the reply, then sends the next. If the server stalls for 2 s, the generator also stops — so the stall is recorded as *one* slow sample, while in production every request that arrived during those 2 s would have waited. The tool coordinates with the server to omit exactly the measurements you need.

The fix is to measure from the **intended** send time (when an open-loop schedule would have sent it), not the actual send time. Below, a client paced at 50 req/s meets a server that freezes for 2 s at $t = 30$ s:

```python run
"""Coordinated omission: a load generator that waits for responses hides the stall it should measure."""
import numpy as np

rng = np.random.default_rng(3)
RATE, DURATION = 50.0, 60.0                    # intended 50 req/s for 60 s
STALL = (30.0, 32.0)                           # server freezes for 2 s at t = 30 s
n = int(RATE * DURATION)
intended = np.arange(n) / RATE                 # when each request *should* be sent
service = rng.lognormal(np.log(0.010), 0.2, n) # ~10 ms of real work

sent = np.empty(n)
done = np.empty(n)
prev_done = 0.0
for i in range(n):
    sent[i] = max(intended[i], prev_done)      # closed-loop: cannot send before the last reply
    start = sent[i]
    if STALL[0] <= start < STALL[1]:
        start = STALL[1]
    finish = start + service[i]
    if start < STALL[0] < finish:              # stall hits mid-request
        finish += STALL[1] - STALL[0]
    done[i] = prev_done = finish

naive = 1e3 * (done - sent)                    # what a closed-loop tool records
honest = 1e3 * (done - intended)               # what a user arriving on schedule experiences
for name, x in [("measured from actual send  ", naive), ("measured from intended send", honest)]:
    p = np.percentile(x, [50, 99, 99.9])
    print("%s p50=%7.1f p99=%7.1f p99.9=%7.1f max=%7.1f  >100ms: %d" % (
        name, *p, x.max(), (x > 100).sum()))
```

```output
measured from actual send   p50=   10.1 p99=   15.9 p99.9=   19.3 max= 2009.0  >100ms: 1
measured from intended send p50=   10.3 p99= 1723.6 p99.9= 1979.5 max= 2009.0  >100ms: 203
```

Same server, same run: p99 is 15.9 ms or 1,723.6 ms depending on where you start the clock. The honest count of slow requests is 203, not 1 — the 2 s stall delays 100 requests directly and roughly another 100 while the backlog drains (service 10 ms, arrivals every 20 ms, so the queue shrinks at about 50 requests/s).

:::warn[How to avoid it]
Use an open-loop generator that sends on a fixed or Poisson schedule regardless of replies; or record latency from the scheduled time; or use a histogram library that back-fills missing samples from the expected interval (HdrHistogram's "expected interval" recording does this). Then report the arrival rate alongside every percentile — a p99 without $\lambda$ is not a result.
:::

## 14.4 How many samples does a p99 need?

A percentile is estimated from the few samples above it. With $n$ samples, about $n(1-q)$ lie beyond the $q$-quantile, and the rank of the estimate wobbles by roughly $\pm z\sqrt{nq(1-q)}$. For p99 at $n = 1{,}000$ that is $990 \pm 1.96 \times 3.1$, i.e. anywhere between the 98.4th and 99.6th percentile of the true distribution — which, in a heavy tail, is a wide range of milliseconds. Empirically, on a lognormal tail (median 20 ms, $\sigma = 0.8$):

```python run
"""How many samples does a stable p99 need? Repeat the same benchmark 200 times at three sizes."""
import numpy as np

rng = np.random.default_rng(99)


def run(n):
    return rng.lognormal(np.log(20.0), 0.8, n)        # heavy-tailed: median 20 ms, true p99 ~129 ms


print("true p99 = %.0f ms" % (20.0 * np.exp(0.8 * 2.3263)))
print("n          p99 across 200 repeats: 5th pct   median   95th pct   (tail samples per run)")
for n in (1_000, 10_000, 100_000):
    est = np.array([np.percentile(run(n), 99) for _ in range(200)])
    lo, mid, hi = np.percentile(est, [5, 50, 95])
    print("%-9d  %33.0f %8.0f %10.0f   (%d)" % (n, lo, mid, hi, n // 100))
```

```output
true p99 = 129 ms
n          p99 across 200 repeats: 5th pct   median   95th pct   (tail samples per run)
1000                                     108      123        145   (10)
10000                                    122      128        134   (100)
100000                                   127      129        131   (1000)
```

:::tip[Rules of thumb]
- Aim for **≥ 100 samples beyond the percentile** you report: 10,000 requests for p99, 100,000 for p99.9. With 1,000 requests, two honest runs can disagree on p99 by ~35 ms here.
- **Never average percentiles** across runs or replicas. Merge the raw samples (or histograms) and recompute.
- Repeat the whole run 3–5 times and report the median run plus the spread; a single run hides machine-level noise.
:::

## 14.5 Throughput vs batch size

From §13, one decode step reads all weights once plus each sequence's KV cache, and does $2P$ FLOPs per sequence. Whichever is slower bounds the step (a roofline):

$$
t_{\text{step}}(b) = \max\!\left(\frac{P\,b_w + b\,n_{\text{ctx}}\,k_{\text{kv}}}{BW},\ \frac{2P\,b}{F}\right), \qquad \text{tokens/s} = \frac{b}{t_{\text{step}}(b)}
$$

with $k_{\text{kv}}$ = KV bytes per token (41 KB for dec d960). The model below uses the same illustrative GPU (300 GB/s, 20 TFLOP/s effective); it is a model, not a measurement.

```python run
"""Decode throughput vs batch size on an illustrative GPU (roofline: the slower of bytes and FLOPs)."""
BW, FLOPS = 300e9, 20e12                       # effective, illustrative T4-class
P = 401.1e6                                    # dec d960 L32, int8 weights = 401 MB
KV_TOK = 40_960                                # bytes per cached token (fp16), from 13.6


def step_ms(b, ctx):
    bytes_read = P * 1.0 + b * ctx * KV_TOK    # weights once per step + each sequence's cache
    flops = b * 2 * P
    return 1e3 * max(bytes_read / BW, flops / FLOPS)


print("batch  " + "".join("%28s" % ("ctx=%d: step ms / tok/s" % c) for c in (128, 512, 2048)))
for b in (1, 2, 4, 8, 16, 32, 64, 128, 256):
    cells = ["%14.2f / %8.0f" % (step_ms(b, c), b * 1e3 / step_ms(b, c)) for c in (128, 512, 2048)]
    print("%5d  " % b + "".join("%28s" % c for c in cells))
```

```output
batch      ctx=128: step ms / tok/s    ctx=512: step ms / tok/s   ctx=2048: step ms / tok/s
    1               1.35 /      738             1.41 /      711             1.62 /      619
    2               1.37 /     1458             1.48 /     1354             1.90 /     1055
    4               1.41 /     2843             1.62 /     2474             2.46 /     1629
    8               1.48 /     5417             1.90 /     4219             3.57 /     2238
   16               1.62 /     9897             2.46 /     6516             5.81 /     2753
   32               1.90 /    16875             3.57 /     8954            10.28 /     3111
   64               2.57 /    24931             5.81 /    11014            19.23 /     3328
  128               5.13 /    24931            10.28 /    12445            37.13 /     3447
  256              10.27 /    24931            19.23 /    13311            72.92 /     3511
```

:::chart[Illustrative model: decode tokens/s vs batch size (dec d960, 300 GB/s, 20 TFLOP/s)]{type="line" x="batch size" y="output tokens/s" xlog="true" note="Roofline model, not a measurement"}
batch, ctx=128, ctx=512, ctx=2048
1, 738, 711, 619
2, 1458, 1354, 1055
4, 2843, 2474, 1629
8, 5417, 4219, 2238
16, 9897, 6516, 2753
32, 16875, 8954, 3111
64, 24931, 11014, 3328
128, 24931, 12445, 3447
256, 24931, 13311, 3511
:::

Three regimes appear. At small batch the step costs one weight read (1.34 ms), so throughput is almost linear in $b$ — batching is nearly free. At short context and $b \ge 64$ the step becomes **compute-bound** and throughput flattens at $F/2P = 24{,}931$ tokens/s. At long context, **KV reads** dominate early: at 2,048 tokens throughput saturates near 3,500 tokens/s while each step's latency keeps climbing (73 ms at $b = 256$). A benchmark that reports one batch size reports one point on this curve; report the curve, and the latency at each point.

:::note[Tokens/s is the wrong headline for decisions]
A decision emits ~12 tokens after a 300-token prefill, so prefill dominates and does not batch away (§13.5): requests/s rose only from 33 to 76 between $B=1$ and $B=16$, while decode tokens/s in this model rises ~9×. Benchmark decisions/s at the SLO.
:::

## 14.6 Optimisation levers, ranked before you build them

Each lever removes bytes or FLOPs from one stage. Estimate the gain from the formulas before spending a sprint. Baseline: dec d960 in fp16 on the illustrative CPU (25 GB/s, 0.4 TFLOP/s effective), 300-token prompt, 40 free-form output tokens (a JSON decision with a rationale).

```python run
"""Rank optimisation levers by first-principles latency gain for one decoder request on a CPU."""
BW, FLOPS = 25e9, 0.4e12                 # illustrative 8-vCPU VM, effective
P = 401.1e6                              # dec d960 L32
FIXED = 2.0                              # ms: tokenise, parse, policy


def latency(prompt=300, cached=0, out=40, bytes_pp=2.0, int8_speedup=1.0, params=P, passes=None):
    prefill = 2 * params * (prompt - cached) / (FLOPS * int8_speedup)
    steps = out if passes is None else passes
    decode = steps * params * bytes_pp / BW          # each decode step reads every weight
    return 1e3 * (prefill + decode) + FIXED


base = latency()
levers = {
    "constrained output 40->6 tokens": latency(out=6),
    "int8 weights (half the bytes, 2x MACs)": latency(bytes_pp=1.0, int8_speedup=2.0),
    "prefix cache, 220 of 300 tokens shared": latency(cached=220),
    "shorter prompt 300->150 tokens": latency(prompt=150),
    "encoder classifier, 128 tokens, 1 pass": latency(prompt=128, params=65.9e6, passes=1),
    "constrained + int8 + prefix cache": latency(out=6, bytes_pp=1.0, int8_speedup=2.0, cached=220),
}
print("baseline (fp16, 300-token prompt, 40 output tokens): %.0f ms" % base)
for name, ms in sorted(levers.items(), key=lambda kv: kv[1]):
    print("  %-40s %6.0f ms   %5.1fx" % (name, ms, base / ms))
hit = 0.15                                # exact-duplicate cache hit rate, illustrative
print("result cache, %d%% hits: mean %.0f ms (%.2fx), p95 unchanged at %.0f ms" % (
    100 * hit, (1 - hit) * base, 1 / (1 - hit), base))
```

```output
baseline (fp16, 300-token prompt, 40 output tokens): 1887 ms
  encoder classifier, 128 tokens, 1 pass       49 ms    38.2x
  constrained + int8 + prefix cache           178 ms    10.6x
  constrained output 40->6 tokens             796 ms     2.4x
  int8 weights (half the bytes, 2x MACs)      945 ms     2.0x
  prefix cache, 220 of 300 tokens shared     1446 ms     1.3x
  shorter prompt 300->150 tokens             1586 ms     1.2x
result cache, 15% hits: mean 1604 ms (1.18x), p95 unchanged at 1887 ms
```

:::chart[Illustrative speed-up per lever (CPU, dec d960 fp16 baseline = 1887 ms)]{type="bar" x="lever" y="speed-up (×)" ylog="true" labels="true" note="all three = constrained + int8 + prefix cache; result cache improves the mean only"}
lever, speedup
encoder, 38.2
all three, 10.6
constrained, 2.4
int8, 2.0
prefix cache, 1.3
short prompt, 1.2
result cache, 1.18
:::

| Rank | Lever | What it removes | Why the gain is this size | Risk to check |
|---:|---|---|---|---|
| 1 | Encoder for a closed label set | the whole decode loop; 6× fewer params | one 128-token pass of 66M params vs a 300-token prefill plus 40 weight-reading steps of 401M | needs labelled data; no rationale string |
| 2 | Constrained decoding / short outputs | 34 of 40 decode steps | decode ∝ $n_{\text{out}}$; each step reads 802 MB | rationale moves to a separate, optional call |
| 3 | int8 weights | half the bytes per step; faster MACs | decode ∝ bytes; the 2× MAC rate is an assumption | accuracy and calibration shift — re-run §11 gates |
| 4 | Prefix (KV) caching | prefill of the shared instruction | prefill ∝ uncached tokens: 300 → 80 | cache keyed on exact prefix; bundle change invalidates it |
| 5 | Shorter prompt | prefill tokens | prefill ∝ prompt tokens | fewer examples can cost accuracy |
| 6 | Result cache | whole requests, for exact repeats | mean × (1 − hit rate) | barely moves p95: the slowest 5% are still misses |
| — | Batching | nothing per request | raises throughput (§14.5), not single-request latency | raises latency under load |

The levers compound only multiplicatively on the stage they touch: once constrained decoding has cut decode to 6 steps, int8's halving of *decode* bytes is worth 96 ms, not the 642 ms it saved on the 40-token baseline. Re-rank after each change — the bottleneck moves from decode to prefill.

## 14.7 Quality-adjusted cost

A benchmark that ignores quality rewards the model that is fast and wrong. Report cost per decision including what the decision triggers:

$$
C_{\text{effective}} = C_{\text{inference}} + r_{\text{review}}\,C_{\text{review}} + C_{\text{retry}} + \mathbb{E}[C_{\text{error}}]
$$

:::example[Worked example · the cheaper model is more expensive (illustrative)]
Model A costs ₹0.05 per decision and sends 8% of loan cases to `manual_review` at ₹900: ₹0.05 + 0.08 × ₹900 = ₹72.05. Model B costs ₹0.40 and sends 5%: ₹0.40 + 0.05 × ₹900 = ₹45.40. B is 8× dearer to run and ₹26.65 cheaper per decision — before counting error costs, which §4 shows dominate both.
:::

## 14.8 A benchmark report template

```text
BENCHMARK REPORT — <service> — <date>
Bundle:        bundle_id=<sha256>  (model, tokenizer, prompt, quant, calibration, policy)
Hardware:      <instance type>, <CPU/GPU model>, runtime <name+version>, threads=<n>, batch cap=<B>
Workload:      <N> requests sampled from <dataset/date range>; prompt tokens p50/p95=<a>/<b>;
               output tokens p50/p95=<c>/<d>
Load:          open-loop Poisson at λ = <x> req/s (ρ ≈ <y>); duration <s> s; latency from scheduled time
Warm-up:       first <k> requests discarded (rolling p50 stable within 5%)
Repeats:       <r> runs; reported = median run; spread = min–max across runs

Results (steady state, end-to-end)
  λ (req/s) | p50 | p95 | p99 | p99.9 | errors | timeouts | fallback rate
  ...       | ... | ... | ... | ...   | ...    | ...      | ...
Stage breakdown at target λ: queue / prefill / decode / parse / policy (ms, p50 and p95)
Max λ meeting SLO (p95 ≤ <SLO> ms): <z> req/s per replica
Quality on the same run: accuracy=<..>, expected cost per decision=₹<..>, review rate=<..>
Effective cost per 1,000 decisions: ₹<..>
Caveats: <anything simulated, assumed or not production-like>
```

:::warn[Benchmark anti-patterns]
- Mean latency, or "mean ± sd", reported as the result.
- Warm-up included, or only warm-cache requests measured.
- Closed-loop load generator with latency measured from actual send time.
- p99 from fewer than ~10,000 requests; percentiles averaged across runs.
- One prompt repeated, instead of the production length distribution.
- Model A at batch 1 compared with model B at batch 32.
- Failed and timed-out requests dropped from the percentiles (count them at the timeout value, at least).
- Tuning on the benchmark workload, then presenting it as independent.
:::

:::exercise[Exercise 14.1 · Audit your last benchmark]{id="checklist" items="Warm-up discarded and the count stated;Load is open-loop or latency is measured from the scheduled time;Arrival rate reported next to every percentile;At least 10,000 steady-state requests behind each p99;Percentiles recomputed from merged samples, never averaged;Prompt and output lengths follow production;Quality measured on the same run;Batch cap, threads and quantisation pinned" grades="A,B,C,D,F"}
:::

## 14.9 Check yourself

:::qa[Mean latency is 24 ms and the SLO is p99 ≤ 100 ms. Is the SLO met?]
Unknown — and in the §14.2 run, no: p99 was 176.5 ms. A rare slow component (1% stalls) barely moves the mean but sets p99. Measure p99 directly from ≥ 10,000 steady-state requests.
:::

:::qa[A closed-loop tool reports p99 = 16 ms; production p99 is far worse during GC pauses. What happened, and what is the fix?]
Coordinated omission. The tool stopped sending while the server stalled, so it recorded one slow sample instead of the ~100 that real arrivals would have produced. Measure from the intended send time or use an open-loop generator; in the §14.3 run that changes p99 from 15.9 ms to 1,723.6 ms.
:::

:::qa[Two runs of 1,000 requests give p99 = 112 ms and 141 ms. Did something regress?]
Not necessarily. With 1,000 samples only ~10 lie above p99; in §14.4 the 5th–95th percentile spread of p99 estimates at n = 1,000 was 108–145 ms on the same distribution. Collect 10,000+ requests per run before comparing.
:::

:::qa[int8 quantisation halves weight bytes. Why might end-to-end latency on a long-prompt decision fall by much less than 2×?]
Only decode is bandwidth-bound. Prefill is compute-bound, so its gain depends on whether int8 kernels actually run faster than fp16 on that hardware — an assumption, not a law. If prefill dominates (long prompt, short constrained output), halving decode bytes moves the total little; shorten or cache the prompt instead.
:::

:::qa[A 15% result-cache hit rate cut mean latency by 15%. Why did p95 not move?]
Hits are fast, so they remove requests from the *bottom* of the distribution. The slowest 5% are still misses running the full path, so overall p95 becomes roughly the miss path's 94th percentile — almost unchanged (exactly unchanged in the §14.6 toy model, where every miss costs 1,887 ms). A cache moves the tail only if its hits are the slow requests, e.g. long-prompt cases.
:::

Next: which problems deserve all this machinery — [§15 Use cases and domain fit](/c/practical-slm-decision-models/15-use-cases-and-domain-fit).
