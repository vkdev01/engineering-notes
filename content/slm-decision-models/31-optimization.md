---
section: "31"
title: "Optimization"
kicker: "Benchmarks"
abstract: "Find where the time goes (prefill FLOPs or decode bytes), then pull the biggest lever first: output length, prompt and prefix caching, quantisation with an accuracy-and-calibration check, batching, caching and cascades — re-optimising the threshold after every change."
time: "17 min"
order: 31
outcomes:
  - "Split a decision call into prefill and decode time from first principles and find the bottleneck"
  - "Compute weight memory and decode floors for bf16, int8 and int4, and run the post-quantisation check"
  - "Predict what batching does to decision throughput when prefill dominates"
  - "Compute the expected cost and latency of a small → large cascade and pick its escalation share"
  - "Order optimisations by measured return and re-fit calibration and thresholds after each one"
---

The loan-triage SLM (Qwen2.5-0.5B, served on CPU) answers in 1.8 s and the product needs well under a second. The team's first instinct is to quantise to int4. The arithmetic says something else: this call spends a third of its time reading the prompt and two-thirds generating a 60-token JSON rationale that the policy never reads. This section is the measure-first procedure — where the time goes, what each lever removes, what it costs in decision quality, and in which order to pull them.

:::key[First principle]
Latency is bytes moved plus FLOPs done. **Prefill** (reading the prompt) is compute-bound: $2P$ FLOPs per prompt token. **Decode** (each generated token) is memory-bound: every weight is read once per token. Optimise the term that dominates, then re-measure — and after every change that touches the model's outputs, re-check calibration, re-optimise the threshold and re-run the cost gate.
:::

All hardware numbers are the [§3](/c/slm-decision-models/03-slm-fundamentals) illustrative machines — **CPU** 50 GB/s and 1 TFLOP/s effective, **GPU** 300 GB/s and 50 TFLOP/s — so every latency below is a **floor** for ruling options in or out, not a measurement. The deep course ranks the same levers on its own model in [§14](/c/practical-slm-decision-models/14-benchmarking-and-performance).

## 31.1 Measure first: where does the time go?

$$
t_{\text{call}} \approx \underbrace{\frac{2P\,(n_{\text{prompt}} - n_{\text{cached}})}{F}}_{\text{prefill}} + \underbrace{\sum_{i=1}^{n_{\text{out}}} \frac{P\,b_w + k_{kv}\,(n_{\text{prompt}} + i)}{BW}}_{\text{decode}} + t_{\text{fixed}}
$$

$P$ parameters, $b_w$ bytes per weight, $F$ FLOP/s, $BW$ bytes/s, $k_{kv}$ = 12,288 KV bytes per token for Qwen2.5-0.5B. Five ways to serve the same decision:

```python run
P = 0.494e9                       # Qwen2.5-0.5B parameters
KV_TOK = 12_288                   # bytes of KV cache per token (bf16, section 3)
HW = {"CPU": (50e9, 1e12), "GPU": (300e9, 50e12)}   # illustrative: bytes/s, effective FLOP/s
FIXED_MS = 2.0                    # tokenise, parse, policy


def call_ms(hw, prompt, out, cached=0, bytes_pp=1.0):
    bw, flops = HW[hw]
    prefill = 2 * P * (prompt - cached) / flops                       # compute-bound
    decode = sum((P * bytes_pp + KV_TOK * (prompt + i)) / bw for i in range(out))  # bytes-bound
    return 1e3 * prefill, 1e3 * decode


CONFIGS = {   # name: (prompt tokens, output tokens, cached prefix tokens, bytes per weight)
    "free-form JSON, 60 tokens, bf16": (600, 60, 0, 2.0),
    "free-form JSON, 60 tokens, int8": (600, 60, 0, 1.0),
    "short label, 8 tokens, int8": (600, 8, 0, 1.0),
    "8 tokens + 450-token prefix cache": (600, 8, 450, 1.0),
    "score label logits, 1 pass, 300-token prompt": (300, 1, 0, 1.0),
}
for hw in HW:
    print(f"{hw}: {'configuration':45s} {'prefill':>8s} {'decode':>8s} {'total':>8s} {'prefill %':>9s}")
    for name, (prompt, out, cached, bpp) in CONFIGS.items():
        pre, dec = call_ms(hw, prompt, out, cached, bpp)
        total = pre + dec + FIXED_MS
        print(f"     {name:45s} {pre:8.0f} {dec:8.0f} {total:8.0f} {pre / total:9.0%}")
```

```output
CPU: configuration                                  prefill   decode    total prefill %
     free-form JSON, 60 tokens, bf16                    593     1195     1790       33%
     free-form JSON, 60 tokens, int8                    593      602     1197       50%
     short label, 8 tokens, int8                        593       80      675       88%
     8 tokens + 450-token prefix cache                  148       80      230       64%
     score label logits, 1 pass, 300-token prompt       296       10      308       96%
GPU: configuration                                  prefill   decode    total prefill %
     free-form JSON, 60 tokens, bf16                     12      199      213        6%
     free-form JSON, 60 tokens, int8                     12      100      114       10%
     short label, 8 tokens, int8                         12       13       27       44%
     8 tokens + 450-token prefix cache                    3       13       18       16%
     score label logits, 1 pass, 300-token prompt         6        2       10       62%
```

:::chart[Where the time goes: one loan decision on Qwen2.5-0.5B, illustrative CPU]{type="bar" stacked="true" x="configuration" y="milliseconds (floor)" unit=" ms" labels="false" note="Prefill = 2P FLOPs per uncached prompt token ÷ 1 TFLOP/s; decode = bytes read per token ÷ 50 GB/s. Fixed 2 ms omitted."}
configuration, prefill, decode
"60 tokens, bf16", 593, 1195
"60 tokens, int8", 593, 602
"8 tokens, int8", 593, 80
"8 tokens + prefix cache", 148, 80
"label logits, 300-token prompt", 296, 10
:::

- **The bottleneck moves as you optimise.** The bf16 free-form call is 67% decode, so int8 (half the bytes per token) takes it from 1,790 to 1,197 ms. Cutting the output from 60 tokens to 8 then brings it to 675 ms — and now prefill is 88% of the call. A second round of quantisation would buy at most 40 ms.
- **On CPU, after the output is short, the prompt is the lever.** Caching a 450-token shared instruction prefix cuts the call to 230 ms (2.9×); scoring the label tokens' logits from a 300-token prompt needs one pass and 308 ms.
- **On GPU, decode dominates free-form output** (93% at bf16), so output length matters even more: at int8, 114 ms → 27 ms by going from 60 tokens to 8.
- **Profile the real thing.** These are floors; real kernels reach part of peak, and tokenisation, JSON validation and network add fixed costs. Measure p50/p95 per stage before choosing ([§24](/c/slm-decision-models/24-benchmarking)).

## 31.2 Output and prompt surgery

The cheapest optimisations change what the model is asked to produce, not how it is computed:

| Change | What it removes | Gain on CPU (above) | Quality risk |
| --- | --- | --- | --- |
| 60-token rationale → 8-token label | 52 decode steps | 1,197 → 675 ms | usually none for a closed label set; rationale moves to an optional, async call |
| Score label logits directly | the decode loop | 1 pass instead of 8 | none if labels are single tokens; probabilities come straight from the logits |
| Shared instruction as a cached prefix | prefill of 450 tokens | 675 → 230 ms | cache invalidates when the prompt bundle changes; version it |
| Fewer few-shot examples | prefill tokens | ~99 ms per 100 tokens | can cost accuracy — re-run the cost gate |
| Encoder classifier instead of a decoder | prompt instructions *and* decoding | 17 ms for 128 tokens ([§3.5](/c/slm-decision-models/03-slm-fundamentals)) | needs labelled data ([§6](/c/slm-decision-models/06-distillation)) |

```python
# Sketch (transformers-style): read P(label) from one forward pass instead of generating text.
ids = tok(prompt, return_tensors="pt").input_ids
logits = model(ids).logits[0, -1]                        # next-token logits after the prompt
label_ids = [tok.encode(" " + a, add_special_tokens=False)[0] for a in ACTIONS]   # one token each
p = torch.softmax(logits[label_ids], dim=-1)             # then calibrate before thresholding
```

## 31.3 Quantisation: memory, bandwidth and the accuracy check

Weight-only quantisation stores fewer bytes per weight, so it shrinks memory and the decode floor proportionally. It does not reduce prefill FLOPs unless the kernels also compute in low precision.

```python run
MODELS = {"Qwen2.5-0.5B": 0.494e9, "Qwen2.5-1.5B": 1.544e9, "Qwen2.5-3B": 3.086e9}
BYTES = {"bf16": 2.0, "int8": 1.0, "int4 (+1 fp16 scale / 64)": 0.5 + 2 / 64}
BW_CPU, BW_GPU = 50e9, 300e9      # illustrative memory bandwidth, bytes/s

print(f"{'model':13s} {'dtype':26s} {'weights GB':>10s} {'CPU ms/token':>12s} {'GPU ms/token':>12s}")
for name, p in MODELS.items():
    for dtype, b in BYTES.items():
        gb = p * b
        print(f"{name:13s} {dtype:26s} {gb / 1e9:10.2f} {gb / BW_CPU * 1e3:12.1f} {gb / BW_GPU * 1e3:12.2f}")
print("int8 vs bf16: weights and decode floor x0.50; int4 vs bf16: x%.3f" % ((0.5 + 2 / 64) / 2))
```

```output
model         dtype                      weights GB CPU ms/token GPU ms/token
Qwen2.5-0.5B  bf16                             0.99         19.8         3.29
Qwen2.5-0.5B  int8                             0.49          9.9         1.65
Qwen2.5-0.5B  int4 (+1 fp16 scale / 64)        0.26          5.2         0.87
Qwen2.5-1.5B  bf16                             3.09         61.8        10.29
Qwen2.5-1.5B  int8                             1.54         30.9         5.15
Qwen2.5-1.5B  int4 (+1 fp16 scale / 64)        0.82         16.4         2.73
Qwen2.5-3B    bf16                             6.17        123.4        20.57
Qwen2.5-3B    int8                             3.09         61.7        10.29
Qwen2.5-3B    int4 (+1 fp16 scale / 64)        1.64         32.8         5.46
int8 vs bf16: weights and decode floor x0.50; int4 vs bf16: x0.266
```

The speed-up is real only for the decode share of the call: on the 8-token CPU call above, int8 → int4 saves \(8 \times (9.9 - 5.2)\) ≈ 38 ms of 675. Memory is often the better reason: int4 brings a 1.5B's weights under 1 GB (0.82 GB) — then measure peak resident memory, not weights.

**What quantisation does to decisions.** It perturbs the weights, so it perturbs $P(\text{good})$ — typically some loss of ranking *and* a shift in the probability scale. The protocol below runs on frozen validation and test sets. The "quantised" outputs are a **simulated perturbation** (logits × 1.4 plus noise of s.d. 0.6) so the protocol has something to find; use your real fp16 and quantised outputs in its place.

```python run
import numpy as np

rng = np.random.default_rng(31)
BAD_RATE, D, C_FN, C_FP, P_STAR = 0.20, 2.45, 120_000, 24_000, 120_000 / 144_000


def scores(n):
    """fp16 reference: calibrated logits. 'Quantised': SIMULATED perturbation (x1.4 scale + noise)."""
    bad = rng.random(n) < BAD_RATE
    z = np.log((1 - BAD_RATE) / BAD_RATE) + D * (rng.normal(size=n) + D * ~bad) - D * D / 2
    return bad, z, 1.4 * z + rng.normal(0, 0.6, n)


def cost(z, bad, t=P_STAR):
    return np.where(1 / (1 + np.exp(-z)) >= t, bad * C_FN, ~bad * C_FP).astype(float)


def ece(z, bad):
    p, y = 1 / (1 + np.exp(-z)), ~bad
    b = np.minimum((p * 10).astype(int), 9)
    return sum(abs(p[b == k].mean() - y[b == k].mean()) * (b == k).sum() for k in np.unique(b)) / len(p)


bad_v, zf_v, zq_v = scores(10_000)                 # validation: refit here
bad_t, zf_t, zq_t = scores(40_000)                 # test: report here
temps = np.linspace(0.5, 1.5, 201)                 # temperature refit: minimise validation log loss
nll = [np.mean(np.logaddexp(0, -np.where(bad_v, -1, 1) * T * zq_v)) for T in temps]
T = temps[int(np.argmin(nll))]
grid = np.arange(0.70, 0.99, 0.005)
t_q = grid[np.argmin([cost(zq_v, bad_v, t).mean() for t in grid])]
ref = cost(zf_t, bad_t)
idx = rng.integers(0, len(ref), (2_000, len(ref)))
print(f"decisions flipped vs fp16 at p*: {np.mean((zq_t >= np.log(5)) != (zf_t >= np.log(5))):.2%}")
print(f"{'variant':32s} {'ECE':>6s} {'INR/case':>9s} {'vs fp16 (95% CI)':>24s}")
for name, c, z in (("fp16 reference", ref, zf_t), ("quantised, as is", cost(zq_t, bad_t), zq_t),
                   (f"quantised, threshold -> {t_q:.3f}", cost(zq_t, bad_t, t_q), zq_t),
                   (f"quantised, temperature {T:.3f}", cost(T * zq_t, bad_t), T * zq_t)):
    lo, hi = np.percentile((c - ref)[idx].mean(1), [2.5, 97.5])
    print(f"{name:32s} {ece(z, bad_t):6.3f} {c.mean():9,.0f} {f'{(c - ref).mean():+,.0f} [{lo:+,.0f}, {hi:+,.0f}]':>24s}")
```

```output
decisions flipped vs fp16 at p*: 3.87%
variant                             ECE  INR/case         vs fp16 (95% CI)
fp16 reference                    0.003     4,833              +0 [+0, +0]
quantised, as is                  0.028     5,138        +305 [+191, +423]
quantised, threshold -> 0.890     0.028     4,957         +124 [+38, +220]
quantised, temperature 0.715      0.004     4,999         +166 [+82, +257]
```

- **The as-is penalty (₹305 per case) has two parts.** The scale shift is recoverable: re-optimising the threshold on validation (0.890) or refitting a temperature (0.715, ECE back to 0.004) brings the penalty to ₹124–166. The rest is ranking damage that no recalibration can undo.
- **The two fixes differ.** The threshold minimises cost directly; temperature minimises log loss and restores calibrated probabilities, which the review band and every other threshold also need. Do both: calibrate, then confirm the threshold.
- **Decide with the paired interval.** If the budget for the optimisation is, say, ≤ ₹50 per case, this variant fails even after the fixes (lower bound ₹38 at best). Try int8, per-channel scales, or a calibration-data method before shipping int4.
- **3.87% flipped decisions** is the cheap smoke test: run it on every build. It says *how many* decisions changed; only the cost difference says whether that matters.

## 31.4 Batching: throughput, not latency

Batching lets one weight read serve $b$ sequences during decode. Prefill does not benefit: it is already compute-bound at batch 1, and $b$ prompts cost $b$ times the FLOPs. For a decision call, prefill dominates — so batching saturates early.

```python run
P, KV_TOK = 0.494e9, 12_288                     # Qwen2.5-0.5B, int8 weights, bf16 KV cache
BW, FLOPS = 300e9, 50e12                         # illustrative GPU: bytes/s, effective FLOP/s
PROMPT, OUT = 600, 8                             # one decision call


def batch_ms(b):
    prefill = 2 * P * PROMPT * b / FLOPS                                  # compute-bound: no reuse
    steps = sum(max((P + b * KV_TOK * (PROMPT + i)) / BW, 2 * P * b / FLOPS) for i in range(OUT))
    return 1e3 * (prefill + steps), 1e3 * prefill


print(f"{'batch':>5s} {'batch ms':>9s} {'prefill %':>9s} {'decisions/s':>11s} {'x vs b=1':>8s}")
base = 1e3 / batch_ms(1)[0]
for b in (1, 2, 4, 8, 16, 32, 64):
    ms, pre = batch_ms(b)
    print(f"{b:5d} {ms:9.1f} {pre / ms:9.0%} {b * 1e3 / ms:11.1f} {b * 1e3 / ms / base:8.2f}")
print(f"ceiling if prefill were free: decode-only b=64 -> {64e3 / (batch_ms(64)[0] - batch_ms(64)[1]):,.0f}/s")
print(f"prefill-bound ceiling: FLOPS / (2 P x prompt) = {FLOPS / (2 * P * PROMPT):.1f} decisions/s; "
      f"with 450 of 600 tokens prefix-cached: {FLOPS / (2 * P * (PROMPT - 450)):.1f}")
```

```output
batch  batch ms prefill % decisions/s x vs b=1
    1      25.2       47%        39.6     1.00
    2      37.3       64%        53.6     1.35
    4      61.4       77%        65.2     1.64
    8     109.6       87%        73.0     1.84
   16     206.0       92%        77.7     1.96
   32     398.9       95%        80.2     2.02
   64     784.6       97%        81.6     2.06
ceiling if prefill were free: decode-only b=64 -> 2,478/s
prefill-bound ceiling: FLOPS / (2 P x prompt) = 84.3 decisions/s; with 450 of 600 tokens prefix-cached: 337.4
```

- **Throughput only doubles** (39.6 → 81.6 decisions/s) while each batch takes 31× longer (25 → 785 ms). Past batch 8 you buy almost nothing: 1.84× at 110 ms vs 2.06× at 785 ms.
- **The ceiling is set by prefill FLOPs**: $F / (2P \cdot n_{\text{prompt}})$ = 84.3 decisions/s. Prefix caching 450 of the 600 tokens raises it to 337.4 — 4× the ceiling batching can reach.
- **Tokens/s is the wrong headline.** Decode-only throughput would be 2,478/s at batch 64; decisions/s is what the queue sees.
- **Use a short dynamic-batching window** (a few ms) and size replicas from the arrival rate with Little's law ([deep course §13](/c/practical-slm-decision-models/13-serving-and-deployment)).

## 31.5 Caching

| Cache | Removes | Effect on the mean | Effect on p95 |
| --- | --- | --- | --- |
| Prefix (KV) cache for the shared instruction | prefill of the cached tokens | CPU call 675 → 230 ms | same — every request benefits |
| Result cache (exact duplicate inputs) | whole requests | × (1 − hit rate): 15% hits → 675 × 0.85 ≈ 574 ms | **unchanged** until hit rate ≥ 95%: the slowest 5% are still misses |
| Feature / embedding cache (slow-moving entities) | the SLM call for that entity | depends on refresh rate | moves the SLM off the hot path ([§16](/c/slm-decision-models/16-finance)) |

:::warn[Cache keys are part of the model version]
A result cache keyed on the input alone serves stale decisions after a model, prompt, calibration or threshold change. Key on (input hash, model hash, prompt hash, policy version), and never cache decisions whose inputs include time-varying state you did not hash.
:::

## 31.6 Cascades and early exit

Run a small model on everything and escalate only the cases where its answer could change the decision — those near the threshold. Expected cost and latency per case:

$$
E[C] = c_{\text{small}} + q\,c_{\text{big}} + E[\text{error cost}], \qquad E[L] = \ell_{\text{small}} + q\,\ell_{\text{big}}
$$

with $q$ the escalation share. The simulation uses §30's illustrative pair — the 66M encoder ($d' = 2.20$, 17 ms on CPU) in front of Qwen2.5-1.5B ($d' = 2.45$, 79 ms on GPU) — with the small model's score a noisier copy of the big one's (their errors are correlated), and escalates when the small model's log-odds is within $w$ of logit(0.833).

```python run
import numpy as np

rng = np.random.default_rng(31)
N, BAD_RATE, C_FN, C_FP = 200_000, 0.20, 120_000, 24_000
D_BIG, NOISE = 2.45, 0.49                # small model = big model's score + extra noise -> d' 2.20
COST = {"small": 0.01, "big": 0.15}      # INR per call, illustrative
MS = {"small": 17, "big": 79}            # section-3 floors: encoder on CPU, 1.5B int8 on GPU
LOGIT_PSTAR = np.log(5.0)                # logit(0.833)
bad = rng.random(N) < BAD_RATE
s_big = rng.normal(size=N) + D_BIG * ~bad
s_small = s_big + rng.normal(0, NOISE, N)


def logit_good(s, d, sd):                # exact calibrated log-odds for a binormal score
    return np.log((1 - BAD_RATE) / BAD_RATE) + (d * s - d * d / 2) / sd ** 2


z_small, z_big = logit_good(s_small, D_BIG, np.sqrt(1 + NOISE ** 2)), logit_good(s_big, D_BIG, 1.0)


def run(width):
    """Escalate to the big model when the small model's log-odds is within `width` of logit(p*)."""
    esc = np.abs(z_small - LOGIT_PSTAR) < width
    z = np.where(esc, z_big, z_small)
    err = np.where(z >= LOGIT_PSTAR, bad * C_FN, ~bad * C_FP).mean()
    infer = COST["small"] + esc.mean() * COST["big"]
    return esc.mean(), err + infer, MS["small"] + esc.mean() * MS["big"]


print(f"{'escalated':>9s} {'INR/case':>9s} {'mean ms':>8s}")
for w in (0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, np.inf):
    share, c, ms = run(w)
    print(f"{share:9.1%} {c:9,.0f} {ms:8.1f}")
big_only = np.where(z_big >= LOGIT_PSTAR, bad * C_FN, ~bad * C_FP).mean() + COST["big"]
print(f"big model alone: INR {big_only:,.0f}/case at {MS['big']} ms")
```

```output
escalated  INR/case  mean ms
     0.0%     5,807     17.0
     5.3%     5,443     21.2
    10.6%     5,194     25.4
    16.0%     5,013     29.6
    21.2%     4,891     33.8
    31.8%     4,802     42.1
    42.4%     4,767     50.5
   100.0%     4,747     96.0
big model alone: INR 4,747/case at 79 ms
```

:::chart[Cascade: cost per case vs share escalated to the big model (simulated loan book)]{type="line" x="share of cases escalated" y="cost per case" prefix="₹" xfmt="pct" hmarks="4747:big model alone;5807:small model alone" marks="0.318:32% escalated" note="Illustrative: encoder 66M (d′ 2.20) → Qwen2.5-1.5B (d′ 2.45); escalate the cases nearest p* = 0.833."}
share escalated, cost per case
0.000, 5807
0.026, 5604
0.053, 5443
0.080, 5302
0.106, 5194
0.133, 5079
0.160, 5013
0.186, 4938
0.212, 4891
0.239, 4867
0.265, 4837
0.292, 4814
0.318, 4802
0.344, 4795
0.371, 4785
0.397, 4775
0.424, 4767
0.525, 4754
0.619, 4749
0.779, 4747
1.000, 4747
:::

- **Escalating 31.8% of cases recovers 95% of the gain**: ₹4,802 against ₹5,807 (small alone) and ₹4,747 (big alone) — a gap of ₹55 per case — at a mean of 42 ms instead of 79 ms, using a third of the big model's GPU capacity.
- **Escalate by distance to the threshold, not by raw confidence.** A case at $p = 0.99$ and one at $p = 0.02$ are both "certain" for the decision; the cases that matter sit near 0.833, where the big model's extra separation can flip the action.
- **The tail follows the escalation path.** With 31.8% escalated, p95 is a small + big latency (17 + 79 = 96 ms floor), not 42 ms. Set SLOs per path ([§9](/c/slm-decision-models/09-hybrid-systems)).
- **Correlated errors are built in here** (the small score is a noisy copy of the big one). If your big model shares fewer blind spots, the gain per escalation is larger; measure it on the escalated slice.

## 31.7 Re-optimise the threshold after every change

Every optimisation that changes the model's outputs — quantisation, a new export runtime, a distilled student, a cascade, a shorter prompt — changes the probability scale. The thresholds from [§4](/c/slm-decision-models/04-decision-theory) assume calibrated probabilities; after the change, they no longer are until you check. The post-optimisation routine, on frozen validation and test sets:

1. **Flip rate** at the current thresholds vs the reference (smoke test, every build).
2. **Refit the calibrator** (temperature or isotonic) on validation; report ECE with bin counts.
3. **Re-derive or re-sweep the thresholds** — $p^*$ and the review band — on validation; confirm the cost minimum sits near the derived value.
4. **Paired cost difference with a CI** on test against the reference, plus the Wilson bound on bad approvals and the slice table ([§14](/c/slm-decision-models/14-notebook-evaluation)).
5. **Accept only if** the CI's upper bound is inside the budget agreed for the optimisation — in §31.3, +₹124 [+38, +220] fails a ₹50 budget.

## 31.8 Measure → biggest lever first

| Order | Step | Expected return (numbers from this section) | Re-check after |
| ---: | --- | --- | --- |
| 1 | Profile p50/p95 per stage: prefill, decode, fixed, queue | tells you which lever applies | — |
| 2 | Shorten the output (label, not rationale); score label logits | CPU 1,197 → 675 ms; GPU 114 → 27 ms | cost gate |
| 3 | Cache the shared prompt prefix; trim the prompt | CPU 675 → 230 ms; throughput ceiling 84 → 337/s | cache keys |
| 4 | Encoder or a smaller distilled model if quality holds | 17 ms encoder floor; see §30's frontier | full eval |
| 5 | Cascade: small model + escalate near the threshold | ₹55/case from the big model's cost at 42 vs 79 ms | per-path SLO, escalated-slice accuracy |
| 6 | Quantise weights (int8 first, then int4) | decode bytes ×0.5 / ×0.266; memory to fit the device | flip rate, calibration, threshold, paired CI |
| 7 | Batch (short dynamic window) | ~2× throughput when prefill dominates | p95 under load |
| 8 | Result cache | mean × (1 − hit rate); p95 unchanged | cache key versioning |

Record the hardware, runtime, dtype, prompt length, output length and batch size with every number, or it is not reusable.

## 31.9 Check yourself

:::qa[A CPU call is 600 prompt tokens and 40 output tokens on a 0.5B int8 model. Roughly where does the time go, and what do you do first?]
Prefill ≈ 593 ms; decode ≈ \(40 \times 10\) ≈ 400 ms. Decode is 40%, prefill 60%. Cut the output to a label first (−~320 ms, no quality risk on a closed label set), then cache the shared prefix. Quantising to int4 would save only about \(40 \times 4.7\) ≈ 190 ms and touch quality.
:::

:::qa[int4 halves the bytes of int8. Why might the call barely speed up?]
Only decode reads weights per token. If the call is 88% prefill (the 8-token CPU call), halving decode bytes saves ≈ 38 ms of 675. Prefill is FLOP-bound and unchanged by weight-only quantisation.
:::

:::qa[After quantising, ECE went from 0.004 to 0.028 and cost rose ₹305 per case. Is the quantised model unusable?]
Not yet. Refit a temperature and re-sweep the threshold on validation: in §31.3 that recovered ₹139–181 of the ₹305. Then judge the remaining paired penalty against the budget. Only the ranking damage is permanent.
:::

:::qa[A team proposes batch 64 to raise decision throughput 10×. What does the arithmetic say?]
With a 600-token prompt the call is prefill-bound: throughput tops out at $F / (2P \cdot 600)$ ≈ 84 decisions/s, about 2.1× batch 1, while each batch takes ~785 ms. Prefix caching 450 tokens raises the ceiling to 337/s.
:::

That closes the handbook. Start again from [what a decision model is](/c/slm-decision-models/01-what-a-decision-model-is) to apply it to your own problem, or use the deep course's [engineering reference and final review](/c/practical-slm-decision-models/20-engineering-reference-and-review) — every formula above on one page, with review checklists.
