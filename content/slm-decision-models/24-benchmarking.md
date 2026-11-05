---
section: "24"
title: "Benchmarking"
kicker: "Testing"
abstract: "Predict latency from first principles (prefill is compute-bound, decode reads every weight per token), measure it as a distribution with enough samples, and compare models with paired tests sized before the run — so a reported speed-up or accuracy gain is not noise."
time: "16 min"
order: 24
outcomes:
  - "Estimate prefill, decode and total latency for a model on given hardware before running anything"
  - "Explain why batching barely helps decision workloads and compute the prefill-bound ceiling"
  - "Use an A/A test to find how large a latency difference must be before it is real"
  - "Size a model comparison: paired vs unpaired cases needed to detect an accuracy gap"
  - "Set CI regression gates that sit above the measured noise"
---

Two candidate routers are benchmarked on 1,000 requests each. B's p99 is 30% lower, and the team is ready to switch. Run the *same* model twice on 1,000 requests and its p99 differs by 28.6% in a typical pair of runs (§24.3) — the "speed-up" is noise. Benchmarks for decision models fail in three predictable ways: the numbers are not anchored to what the hardware can do, the percentile is estimated from too few samples, and two models are compared without asking how large a difference the setup can detect. This section fixes all three.

:::key[First principle]
Latency has a floor you can compute: prefill costs about $2P$ FLOPs per prompt token, and every decode step reads every weight. Measure against that floor, as a distribution, with enough samples beyond the percentile you report — and before comparing two systems, run one system against itself to see what noise looks like.
:::

The deep course derives the roofline, coordinated omission and percentile sample sizes in [Benchmarking and performance engineering](/c/practical-slm-decision-models/14-benchmarking-and-performance); serving-side sizing (Little's law, utilisation) is in [Serving and deployment](/c/practical-slm-decision-models/13-serving-and-deployment).

## 24.1 Latency from first principles

A decoder answers a decision request in two phases:

$$
t_{\text{prefill}} \approx \frac{2\,P\,n_{\text{prompt}}}{F}, \qquad
t_{\text{decode}} \approx n_{\text{out}} \cdot \frac{P \cdot b_w}{BW}, \qquad
t \approx t_{\text{prefill}} + t_{\text{decode}} + t_{\text{fixed}},
$$

with $P$ parameters, $b_w$ bytes per weight (1 for int8), $F$ effective FLOP/s and $BW$ effective memory bandwidth. Prefill processes the whole prompt in parallel, so it is **compute-bound**. Each decode step produces one token and must stream every weight from memory, so it is **bandwidth-bound**. An encoder classifier does one pass of $2P$ FLOPs per input token and no decode at all. (KV-cache reads and attention FLOPs are ignored here; at a 300-token context they are small.)

:::example[Worked example · Qwen2.5-0.5B on a T4-class GPU]
$P \approx 0.49\text{B}$, int8, 300-token prompt, 12-token constrained JSON output, on an illustrative GPU at 20 TFLOP/s and 300 GB/s *effective*:

- prefill: \(2 \times 0.49 \times 10^9 \times 300 / (20 \times 10^{12})\) = 14.7 ms
- decode: \(12 \times 0.49\,\text{GB} / 300\,\text{GB/s}\) = 12 × 1.63 ms = 19.6 ms
- total ≈ 34.3 ms before tokenisation, network and queueing.

A measured median within ~1.5× of this means the runtime is doing its job; 150 ms means something else is going on (fp16 instead of int8, no batching kernel, CPU fallback, a 2,000-token prompt).
:::

The same arithmetic across model sizes and two illustrative machines (8-vCPU VM at 25 GB/s and 0.4 TFLOP/s effective; T4-class GPU as above — replace with your own measured rates):

```python run
HW = {"CPU (8 vCPU)": (25e9, 0.4e12), "GPU (T4-class)": (300e9, 20e12)}   # effective B/s, FLOP/s (illustrative)
MODELS = {   # approximate parameter counts; int8 weights = 1 byte per parameter
    "DistilBERT (encoder)": 66e6, "Qwen2.5-0.5B": 0.49e9, "Llama-3.2-1B": 1.24e9,
    "Llama-3.2-3B": 3.21e9, "Phi-3-mini": 3.8e9,
}
PROMPT, OUT, ENC_TOKENS = 300, 12, 128      # decision: 300-token prompt, 12-token constrained JSON


def latency_ms(params, bw, flops, encoder=False):
    if encoder:                              # one forward pass, no generation
        return 1e3 * 2 * params * ENC_TOKENS / flops, 0.0
    prefill = 2 * params * PROMPT / flops    # compute-bound: 2 FLOPs per parameter per token
    decode = OUT * params * 1.0 / bw         # bandwidth-bound: every step reads all weights
    return 1e3 * prefill, 1e3 * decode


print(f"{'model':21s}" + "".join(f"{h + ': prefill + decode = total':>39s}" for h in ("CPU", "GPU")))
for name, p in MODELS.items():
    cells = []
    for bw, fl in HW.values():
        pre, dec = latency_ms(p, bw, fl, encoder="encoder" in name)
        cells.append(f"{pre:7.1f} + {dec:6.1f} = {pre + dec:6.1f} ms")
    print(f"{name:21s}" + "".join(f"{c:>39s}" for c in cells))
```

```output
model                          CPU: prefill + decode = total          GPU: prefill + decode = total
DistilBERT (encoder)               42.2 +    0.0 =   42.2 ms               0.8 +    0.0 =    0.8 ms
Qwen2.5-0.5B                      735.0 +  235.2 =  970.2 ms              14.7 +   19.6 =   34.3 ms
Llama-3.2-1B                     1860.0 +  595.2 = 2455.2 ms              37.2 +   49.6 =   86.8 ms
Llama-3.2-3B                     4815.0 + 1540.8 = 6355.8 ms              96.3 +  128.4 =  224.7 ms
Phi-3-mini                       5700.0 + 1824.0 = 7524.0 ms             114.0 +  152.0 =  266.0 ms
```

:::chart[Latency floor per decision on the illustrative GPU: prefill vs decode]{type="bar" stacked="true" x="model (int8, 300-token prompt, 12 output tokens)" y="latency floor" unit=" ms" note="First-principles estimate, not a measurement. Encoder: one 128-token pass."}
model, prefill, decode
DistilBERT, 0.8, 0
Qwen2.5-0.5B, 14.7, 19.6
Llama-3.2-1B, 37.2, 49.6
Llama-3.2-3B, 96.3, 128.4
Phi-3-mini, 114.0, 152.0
:::

What the table says before any benchmark is run:

- **Latency scales with parameters.** Phi-3-mini is 7.8× Qwen2.5-0.5B in both phases; no runtime trick changes that ratio much.
- **On CPU, prefill dominates.** 735 of 970 ms for the 0.5B model: shortening or caching the prompt pays more than shrinking the output. On GPU the two phases are comparable.
- **Every output token costs a full weight read.** A 40-token free-text rationale instead of 12 tokens adds \(28 \times 1.63\) ≈ 46 ms on the GPU for the 0.5B model — more than the whole 12-token decision.
- **An encoder is in a different class:** 0.8 ms on GPU, 42 ms on CPU, for a closed label set.

## 24.2 Throughput vs batch: decisions are prefill-bound

Batching shares the decode step (one weight read serves the whole batch) but not prefill (each prompt's tokens must be computed). For the 0.5B model on the illustrative GPU, with static batches of identical decision requests:

```python run
BW, FLOPS, P = 300e9, 20e12, 0.49e9          # illustrative GPU; 0.5B model, int8 weights
PROMPT, OUT = 300, 12


def batch_ms(b):
    prefill = 2 * P * PROMPT * b / FLOPS                     # prefill is per request: no sharing
    step = max(P / BW, 2 * P * b / FLOPS)                    # one decode step serves the whole batch
    return 1e3 * (prefill + OUT * step)


print(f"{'batch':>5s} {'batch ms':>9s} {'decisions/s':>12s} {'x vs b=1':>9s}")
for b in (1, 2, 4, 8, 16, 32, 64):
    ms = batch_ms(b)
    print(f"{b:5d} {ms:9.1f} {b * 1e3 / ms:12.1f} {b * batch_ms(1) / ms:9.2f}")
print(f"prefill-bound ceiling FLOPS / (2 P prompt) = {FLOPS / (2 * P * PROMPT):.1f} decisions/s")
```

```output
batch  batch ms  decisions/s  x vs b=1
    1      34.3         29.2      1.00
    2      49.0         40.8      1.40
    4      78.4         51.0      1.75
    8     137.2         58.3      2.00
   16     254.8         62.8      2.15
   32     490.0         65.3      2.24
   64     978.4         65.4      2.24
prefill-bound ceiling FLOPS / (2 P prompt) = 68.0 decisions/s
```

:::chart[Decisions per second vs batch size (0.5B int8, illustrative GPU)]{type="line" x="batch size" y="decisions per second" xlog="true" hmarks="68:prefill-bound ceiling" note="Roofline model, not a measurement. Batch latency rises from 34 ms (b = 1) to 255 ms (b = 16)."}
batch, decisions/s
1, 29.2
2, 40.8
4, 51.0
8, 58.3
16, 62.8
32, 65.3
64, 65.4
:::

Batching at 8 doubles throughput and quadruples batch latency (137 ms); beyond 16 it buys almost nothing. The ceiling is $F / (2P \cdot n_{\text{prompt}})$ = 68 decisions/s, set by prompt length — which is why prefix caching of a shared instruction block, or a shorter prompt, raises capacity more than any batch size ([levers ranked in the deep course](/c/practical-slm-decision-models/14-benchmarking-and-performance)). A benchmark that reports "tokens/s" at batch 64 measures the wrong thing for a decision service: report **decisions/s at the latency SLO**.

## 24.3 Percentiles and noise: run an A/A test first

Before comparing A with B, benchmark A against A. The spread between two runs of the same system is the smallest difference your setup can see. Simulated service: lognormal body (median 35 ms) plus 1% stalls of 100–300 ms (GC, page faults; illustrative). Each row repeats the pair of runs 300 times.

```python run
import numpy as np

rng = np.random.default_rng(24)


def run(n):
    """One benchmark run: lognormal body (median 35 ms) plus 1% stalls of 100-300 ms (illustrative)."""
    t = rng.lognormal(np.log(35), 0.3, n)
    s = rng.random(n) < 0.01
    t[s] = rng.uniform(100, 300, s.sum())
    return t


print("A/A test: the SAME system benchmarked twice; |relative difference| between the two runs")
print(f"{'n':>7s} {'metric':>6s} {'median':>7s} {'95th pct':>9s}")
for n in (1_000, 10_000, 100_000):
    for q in (50, 95, 99):
        d = [abs(np.percentile(run(n), q) / np.percentile(run(n), q) - 1) for _ in range(300)]
        print(f"{n:7,d} {'p' + str(q):>6s} {np.median(d):7.1%} {np.percentile(d, 95):9.1%}")
```

```output
A/A test: the SAME system benchmarked twice; |relative difference| between the two runs
      n metric  median  95th pct
  1,000    p50    1.1%      3.0%
  1,000    p95    2.5%      6.6%
  1,000    p99   28.6%    106.2%
 10,000    p50    0.4%      1.1%
 10,000    p95    0.8%      2.0%
 10,000    p99   13.2%     40.8%
100,000    p50    0.1%      0.3%
100,000    p95    0.2%      0.6%
100,000    p99    5.0%     13.5%
```

- **Read the 95th-percentile column as the noise threshold.** At 1,000 requests, a p95 difference under 6.6% is indistinguishable from re-running the same system; at 10,000, under 2.0%.
- **This p99 is pathological, and that is the lesson.** With exactly 1% stalls, p99 sits on the boundary between the 35 ms body and the 100–300 ms stall population, so it jumps between them: two runs of 10,000 differ by more than 13% half the time and by over 40% one time in twenty. When a percentile lands on a mode boundary, report the stall *rate* and a percentile clearly inside one mode (p98, p99.5), or collect far more data.
- **Rule of thumb:** at least 100 samples beyond the percentile you report — 10,000 requests for p99 — and never average percentiles across runs; merge the raw samples and recompute.

## 24.4 A fair benchmark, as a checklist

| Rule | Why | Failure it prevents |
| --- | --- | --- |
| Same input set, sampled from production lengths | Prefill is linear in prompt tokens | A 128-token benchmark for a 600-token workload |
| Discard warm-up until a rolling p50 is stable; state the count | JIT, allocator and cache effects never recur | p99 inflated by the first 100 requests |
| Open-loop load at a stated arrival rate; latency from the scheduled send time | A closed-loop client stops sending during stalls | Coordinated omission hiding the tail ([deep course §14.3](/c/practical-slm-decision-models/14-benchmarking-and-performance)) |
| Interleave A and B (A, B, A, B…) on the same machine | Thermal, noisy neighbours and caches drift over minutes | Whoever runs second looks slower |
| Pin threads, dtype, quantisation, runtime version, batch cap | Each moves latency by more than most "optimisations" | Comparing int8 A with fp16 B |
| Measure quality on the same run | A faster model that is wrong is not faster | Shipping a speed-up that costs ₹ per case |
| Count timeouts and errors at the timeout value | Dropping failures removes the slowest requests | A p99 that improves because requests fail |
| Run A/A first; repeat 3–5 times; report median run and spread | Shows the noise floor | Declaring a 5% win inside a 7% noise band |

## 24.5 Comparing two models: how many cases?

Latency is half a comparison; the other half is whether the faster model is as good. For accuracy on a labelled set, the required size depends on the gap you want to detect and on **pairing**. Evaluate both models on the *same* cases and only the cases where they disagree on correctness carry information (McNemar's test). With $\psi$ = the share of discordant cases and $\Delta$ = the accuracy gap:

$$
n_{\text{paired}} = \frac{\left(z_{1-\alpha/2}\sqrt{\psi} + z_{1-\beta}\sqrt{\psi - \Delta^2}\right)^2}{\Delta^2},
\qquad
n_{\text{unpaired}} = \frac{\left(z_{1-\alpha/2}\sqrt{2\bar p\bar q} + z_{1-\beta}\sqrt{p_1q_1 + p_2q_2}\right)^2}{\Delta^2}\ \text{per model.}
$$

```python run
from math import sqrt, ceil
from statistics import NormalDist

z = NormalDist().inv_cdf
ZA, ZB = z(0.975), z(0.80)                   # two-sided 5%, power 80%


def unpaired(p1, p2):
    pb = (p1 + p2) / 2
    return ceil((ZA * sqrt(2 * pb * (1 - pb)) + ZB * sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2 / (p1 - p2) ** 2)


def paired(delta, psi):
    """McNemar: psi = share of cases where the two models disagree on correctness."""
    return ceil((ZA * sqrt(psi) + ZB * sqrt(psi - delta ** 2)) ** 2 / delta ** 2)


print(f"{'gap':>6s} {'unpaired (per model)':>21s} {'paired, 10% discordant':>23s} {'paired, 4% discordant':>22s}")
for gap in (0.005, 0.01, 0.02, 0.03):
    print(f"{gap:6.1%} {unpaired(0.90, 0.90 + gap):21,d} {paired(gap, 0.10):23,d} {paired(gap, 0.04):22,d}")
```

```output
   gap  unpaired (per model)  paired, 10% discordant  paired, 4% discordant
  0.5%                55,252                  31,394                 12,556
  1.0%                13,495                   7,847                  3,138
  2.0%                 3,213                   1,960                    783
  3.0%                 1,356                     870                    347
```

:::chart[Labelled cases needed to detect an accuracy gap (baseline 90%, α = 0.05, power 0.8)]{type="line" x="accuracy gap to detect" y="cases needed" xfmt="pct" ylog="true" yfmt="int" hmarks="2000:a typical golden set" note="Unpaired = per model, separate samples. Paired = same cases for both models; ψ = share of cases where exactly one model is right."}
gap, unpaired (per model), "paired, ψ = 10%", "paired, ψ = 4%"
0.0025, 223531, 125580, 50231
0.005, 55252, 31394, 12556
0.0075, 24275, 13952, 5580
0.01, 13495, 7847, 3138
0.015, 5856, 3487, 1393
0.02, 3213, 1960, 783
0.025, 2005, 1254, 500
0.03, 1356, 870, 347
0.04, 721, 489, 194
:::

- **A 2,000-case golden set detects about a 2-point gap** when the models disagree on 10% of cases, about 1.25 points when they disagree on 4%. A "0.5-point improvement" measured on it is not evidence.
- **Pairing halves the labels or better.** Unpaired needs 13,495 cases *per model* for a 1-point gap — 26,990 labels — against 7,847 paired at $\psi$ = 10%.
- **Similar models are cheaper to compare.** A distilled student and its teacher disagree rarely, so $\psi$ is small and a few thousand paired cases suffice; two different architectures disagree more and need more.
- **For decisions, compare cost per case, not accuracy.** The same logic with the per-case cost difference is in [§14](/c/slm-decision-models/14-notebook-evaluation) (157,021 paired cases to detect ₹100 per case).

## 24.6 Regression gates that sit above the noise

| Gate | Threshold (example) | Valid when |
| --- | --- | --- |
| p50 latency | +5% vs main | ≥ 1,000 steady-state requests (A/A 95th pct: 3.0%) |
| p95 latency | +10% vs main | ≥ 1,000 requests (6.6%); +5% needs ≥ 10,000 (2.0%) |
| p99 latency | +20% vs main | ≥ 100,000 requests, and p99 not on a mode boundary |
| Stall rate (requests > 3× median) | +50% relative | Reported alongside every percentile |
| Peak RSS | +15% warn, +30% fail | Measured after warm-up, same batch cap |
| Accuracy / cost per case | Binomial limit ([§21.4](/c/slm-decision-models/21-unit-testing)) or paired CI ([§14](/c/slm-decision-models/14-notebook-evaluation)) | Set sized for the smallest gap worth catching |
| Latency vs first-principles floor | median < 3× the §24.1 estimate | Catches CPU fallback, wrong dtype, missing kernels |

A latency gate tighter than the A/A noise at its sample size will fail on its own; teams then learn to re-run it until green, and the gate stops meaning anything. Store every benchmark result in the repo, dated, with hardware, runtime versions, bundle hash and the A/A spread — a number without them cannot be compared next month.

:::exercise[Exercise 24.1 · Audit your benchmark]{id="checklist" items="Latency floor computed before measuring;Inputs follow production prompt and output lengths;Warm-up discarded and the count stated;Open-loop load at a stated rate;A and B interleaved on the same machine;A/A run shows the noise floor;At least 100 samples beyond each reported percentile;Quality measured on the same run;Model comparison sized for the smallest gap worth detecting" grades="A,B,C,D,F"}
:::

## 24.7 Check yourself

:::qa[A 1.2B int8 decoder on the illustrative GPU answers a 300-token, 12-output-token decision. What is the latency floor, and what would you suspect at a measured 400 ms median?]
Prefill \(2 \times 1.2 \times 10^9 \times 300 / (20 \times 10^{12})\) = 36 ms; decode \(12 \times 1.2 / 300\) s = 48 ms; floor ≈ 84 ms. A 400 ms median is ~5× the floor: check dtype (fp16 doubles decode), whether it actually runs on the GPU, the real prompt length, and whether the output is constrained to 12 tokens.
:::

:::qa[On the 8-vCPU VM the 0.5B model takes 970 ms. Which halves it faster: int8 → int4 weights, or a 300 → 150-token prompt?]
Prompt. Prefill is 735 ms and compute-bound, so halving the prompt saves ~368 ms. Int4 halves bytes read in decode (235 → ~118 ms), saving ~118 ms, and does nothing for prefill unless int4 kernels are also faster at compute — an assumption to measure.
:::

:::qa[B's p95 is 4% lower than A's on 1,000 requests each. Ship the "faster" model?]
No claim yet. The A/A test shows two runs of the same system differ by up to 6.6% at p95 on 1,000 requests (95th percentile). Collect 10,000 interleaved requests per model; a 4% gap then exceeds the 2.0% noise band.
:::

:::qa[A new model is 0.5 points more accurate on a 2,000-case golden set. Is that real?]
Almost certainly not detectable. Even paired with only 4% discordant cases, a 0.5-point gap needs about 12,556 cases for 80% power; with 2,000 the gap you can reliably detect is about 1.25–2 points.
:::

Next: packaging the benchmarked model into a container — [Docker](/c/slm-decision-models/25-docker).
