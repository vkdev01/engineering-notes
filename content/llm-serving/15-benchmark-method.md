---
section: "15"
title: "The benchmark method"
kicker: "Code walkthroughs"
abstract: "Chapter 9's seven-phase method as a reusable checklist for Gemma 3 12B, with the statistics the notebooks leave implicit: a Little's-law check for every row, how many requests a stable p99 needs, the warm-up wave that poisons short closed-loop runs, and where to put the rate and concurrency grid."
time: "17 min"
order: 15
outcomes:
  - "Run chapter 9's seven phases with `vllm bench serve` on Gemma 3 12B and say what each flag fixes"
  - "Check any benchmark row with Little's law, throughput ≈ C / (TTFT + TPOT × (out − 1)), and name what an inconsistent row implies"
  - "Choose num-prompts from the confidence band you need on p99 (±8% needs about 2,000 requests)"
  - "Detect and remove the warm-up wave of a closed-loop run"
  - "Place a request-rate and concurrency grid around the predicted knee, and budget its run time"
---
Chapter 11 predicted that Gemma 3 12B in bf16 with prefix caching serves 2.74 HelpDesk requests per second on one L40S inside the SLO. Now someone has to measure it, and the measurement has to be good enough to decide a fleet size: a p99 that moves 30% between two identical runs, or a throughput figure that silently measured the request rate instead of the server, would size the fleet wrong. Chapter 9's seven phases are the repository's method for this. The notebook uses a different open-weight model; this page keeps its method, swaps in `google/gemma-3-12b-it`, and adds the statistics that make a run trustworthy.

:::key[First principle]
A benchmark is an experiment: change one thing, keep the workload identical, collect enough samples for the percentile you report, throw away the warm-up, and check every row against Little's law before believing it. A number that fails any of these is not a slow result — it is not a result.
:::

## 15.1 The method, in order

:::mermaid
flowchart LR
    A[1 Inspect GPU] --> B[2 Generate traffic]
    B --> C[3 Define metrics]
    C --> D[4 Start server]
    D --> E[5 Baseline]
    E --> F[6 Change one thing]
    F --> G[7 Scale out]
:::

The ordering is the argument. A baseline before any change is what lets you attribute a difference to the change; quantising before the baseline is the common mistake, because it shrinks everything at once and hides the bottleneck you were looking for. Each phase also produces a number the next one can check — the derivations live in [§11](/c/llm-serving/11-in-practice), the metric definitions in [§2](/c/llm-serving/02-benchmarks):

| Phase | Produces | Checked against |
| --- | --- | --- |
| 1 Inspect GPU | name, compute capability, free memory | KV pool estimate: 16.58 GiB for bf16 12B (§11.2) |
| 2 Generate traffic | prompt and output length distributions | the five labels of §2.7 |
| 3 Define metrics | the SLO-bound metrics, fixed before any run | p99 TTFT ≤ 500 ms, mean TPOT ≤ 50 ms |
| 4 Start server | startup log: load time, KV-cache size in tokens | the 45,262-token upper bound of §11.2 |
| 5 Baseline | TTFT, TPOT, throughput per operating point | the §11.5 prediction and Little's law (§15.3) |
| 6 One change | the same table for one variant | the predicted ratio (int4: 1.8× at the SLO, §11.6) |
| 7 Scale out | the same table per GPU count and instance | all-reduce arithmetic (§2.5, §11.7) |

## 15.2 The commands, and what each flag fixes

Phases 1–2: record the hardware, then build two workloads — realistic mixed traffic, and one with controlled structure that isolates the effect you care about (here the 768-token shared prefix).

```bash
nvidia-smi --query-gpu=name,compute_cap,memory.free,memory.used,memory.total --format=csv

python3 inspect_dataset.py --dataset-name sharegpt \
    --dataset-path ShareGPT_V3_unfiltered_cleaned_split.json \
    --model google/gemma-3-12b-it --num-prompts 100 --save-samples

python3 inspect_dataset.py --dataset-name prefix_repetition \
    --model google/gemma-3-12b-it --num-prompts 50 \
    --prefix-repetition-prefix-len 768 --prefix-repetition-suffix-len 256 \
    --prefix-repetition-num-prefixes 1 --prefix-repetition-output-len 256 --save-samples
```

Benchmark only realistic traffic and you can't tell a caching win from a lucky prompt mix; benchmark only the synthetic one and you don't know how you'll actually be loaded. Phases 4–5: one server per configuration (export your Hugging Face token first — the model is gated), then the benchmark:

```bash
vllm serve google/gemma-3-12b-it \
    --gpu-memory-utilization 0.90 --max-model-len 4096 --enable-prefix-caching

vllm bench serve --backend vllm --base-url http://localhost:8000 \
    --model google/gemma-3-12b-it --dataset-name prefix_repetition \
    --prefix-repetition-prefix-len 768 --prefix-repetition-suffix-len 256 \
    --prefix-repetition-num-prefixes 1 --prefix-repetition-output-len 256 \
    --num-prompts 2000 --request-rate inf --max-concurrency 32 --seed 0 \
    --percentile-metrics ttft,tpot,itl,e2el --metric-percentiles 50,90,99 \
    --save-result --append-result --result-filename helpdesk_bf16.json
```

| Flag | Fixes | Pitfall |
| --- | --- | --- |
| `--request-rate` | Offered arrivals per second; `inf` sends as fast as concurrency allows | Below capacity, throughput just equals the rate (§15.3, row B) |
| `--burstiness` | Shape of inter-arrival times; 1.0 = Poisson | Lower is burstier; compare runs only at the same value |
| `--max-concurrency` | Requests in flight: the closed loop's $C$ | With rate `inf`, the first $C$ start together (§15.5) |
| `--num-prompts` | Sample count and run length | Sets the p99 confidence band (§15.4) |
| `--seed` | Which prompts are sampled | A new seed is a new workload |
| `--percentile-metrics`, `--metric-percentiles` | Which latencies and percentiles are reported | Add `e2el`: Little's-law check needs mean E2E |
| `--save-result --append-result --result-filename` | One file, one row per run | The notebook plots runs from this file; keep one file per experiment |

`--request-rate` and `--max-concurrency` together define the operating point: rate is what you offer, concurrency is what the server may hold in flight. Vary one at a time. And read the server's own startup log: the model-loading line (bytes and seconds) decides whether cold starts are acceptable, and the KV-cache size in tokens tells you which bound of §11.2 your engine uses. No client-side benchmark shows either.

Phase 6 stops the server, starts the variant (an int4 checkpoint, say), and re-runs the *identical* command. Phase 7 repeats it per GPU count and instance type; chapter 9's distributed phase found tensor parallelism hurt on PCIe-only `g6e` instances and helped on NVLink `p4d`, and [§2.5](/c/llm-serving/02-benchmarks) derives why from the all-reduce cost.

## 15.3 Little's law: check every row before you believe it

With $C$ clients in a closed loop, each request occupies a slot for TTFT plus $(\text{out}-1)$ decode steps, so ([§2.2](/c/llm-serving/02-benchmarks) derives it):

$$
X \approx \min\!\left(\frac{C}{\text{TTFT} + \text{TPOT}\,(\text{out}-1)},\ \lambda\right),
\qquad
L = X \cdot \overline{\text{E2E}} \le C,
$$

with $\lambda$ the offered rate. The second form is the useful one: multiply reported throughput by mean E2E and you get the number of requests that must have been in flight. If it exceeds $C$, something in the row is wrong. Three rows (illustrative, built to show each verdict):

```python run
"""Little's-law check of benchmark rows. Rows are ILLUSTRATIVE, built to show each verdict."""
ROWS = [  # name, max concurrency C, offered rate (inf = closed loop), mean TTFT s,
          # mean TPOT s, mean output tokens, reported request throughput req/s
    ("A  model row (sec 2.3)", 16, float("inf"), 0.1395, 0.0432, 256, 1.435),
    ("B  rate 1.0, C=32", 32, 1.0, 0.130, 0.0400, 256, 0.99),
    ("C  C=64 claims 9 req/s", 64, float("inf"), 0.300, 0.0600, 256, 9.0),
]

print("row                        E2E s  C/E2E  reported  in flight  verdict")
for name, C, rate, ttft, tpot, out, x in ROWS:
    e2e = ttft + tpot * (out - 1)          # one request's time in the system
    pred = min(C / e2e, rate)              # closed loop, unless the offered rate binds
    inflight = x * e2e                     # Little's law: L = X * W
    if abs(x / pred - 1) <= 0.10:
        verdict = "consistent" + (" (rate-limited, not saturated)" if rate < C / e2e else "")
    else:
        out_implied = (C / x - ttft) / tpot + 1
        verdict = f"INCONSISTENT: needs {inflight:.0f} in flight or ~{out_implied:.0f}-token outputs"
    print(f"{name:26s} {e2e:5.2f} {C / e2e:6.2f} {x:9.2f} {inflight:10.1f}  {verdict}")
```

```output
row                        E2E s  C/E2E  reported  in flight  verdict
A  model row (sec 2.3)     11.16   1.43      1.44       16.0  consistent
B  rate 1.0, C=32          10.33   3.10      0.99       10.2  consistent (rate-limited, not saturated)
C  C=64 claims 9 req/s     15.60   4.10      9.00      140.4  INCONSISTENT: needs 140 in flight or ~115-token outputs
```

- **Row A** is the §2.3 model's own point: 16 in flight, as configured.
- **Row B** is consistent but measures the *client*: only 10.2 of 32 slots were ever busy, so 0.99 req/s is the offered rate, not capacity. A capacity number needs the rate raised until throughput stops following it.
- **Row C** can't be true as labelled: 9 req/s at those latencies needs 140 requests in flight with $C = 64$. The likeliest culprit is output length — the model stopped near 115 tokens instead of 256 (EOS before `max_tokens`). Read mean output tokens from the result file (total output tokens ÷ completed requests), not from the dataset flag.

With variable output lengths, use mean E2E (`mean_e2el_ms`) directly: $X \approx C / \overline{\text{E2E}}$. Mean TPOT × (mean out − 1) is not the mean of the products.

## 15.4 How many requests a stable p99 needs

A p99 is estimated from the top 1% of samples: 2,000 requests give it 20 samples to stand on. The large-sample variance of a quantile estimate is

$$
\operatorname{SE}(\hat x_q) \approx \frac{1}{f(x_q)}\sqrt{\frac{q(1-q)}{n}},
\qquad
\text{lognormal: } \frac{\operatorname{SE}}{x_q} = \frac{\sigma}{\varphi(z_q)}\sqrt{\frac{q(1-q)}{n}}.
$$

For a TTFT spread of $\sigma = 0.6$ (the §2.1 trace) and $q = 0.99$: \(0.6 / 0.0267 \times \sqrt{0.0099}\) = 2.24, so the relative standard error is \(2.24/\sqrt{n}\) — three times the median's \(0.75/\sqrt{n}\). Simulate it to check, and to see what each run costs in wall time at the 2.75 req/s the HelpDesk point runs at:

```python run
"""How many requests for a stable p99? Sampling spread of percentile estimates (SYNTHETIC TTFT)."""
import numpy as np

rng = np.random.default_rng(15)
MU, SIGMA = np.log(0.14), 0.6            # TTFT lognormal, median 140 ms (as in section 2.1)
true = {q: np.exp(MU + SIGMA * z) for q, z in ((50, 0.0), (99, 2.3263))}
X = 2.75                                 # req/s at the SLO, bf16 + prefix cache (section 2.3)
REPS = 2000

print(f"true p50 {true[50] * 1e3:.0f} ms, true p99 {true[99] * 1e3:.0f} ms")
print("requests, samples above p99, p50 90% band +-%, p99 90% band +-%, minutes at 2.75 req/s")
for n in (100, 200, 500, 1000, 2000, 5000, 10000, 20000):
    est = np.percentile(rng.lognormal(MU, SIGMA, (REPS, n)), [50, 99], axis=1)
    half = [(np.percentile(e, 95) - np.percentile(e, 5)) / 2 / true[q] * 100
            for e, q in zip(est, (50, 99))]
    print(f"{n}, {n // 100}, {half[0]:.1f}, {half[1]:.1f}, {n / X / 60:.1f}")

one = rng.lognormal(MU, SIGMA, 2000)    # a single run of 2,000 requests
boot = np.percentile(rng.choice(one, (REPS, one.size)), 99, axis=1)
lo, hi = np.percentile(boot, [5, 95])
print(f"\none run, n=2000: p99 {np.percentile(one, 99) * 1e3:.0f} ms, "
      f"bootstrap 90% interval {lo * 1e3:.0f}-{hi * 1e3:.0f} ms")
```

```output
true p50 140 ms, true p99 565 ms
requests, samples above p99, p50 90% band +-%, p99 90% band +-%, minutes at 2.75 req/s
100, 1, 12.3, 27.0, 0.6
200, 2, 8.8, 22.6, 1.2
500, 5, 5.5, 15.4, 3.0
1000, 10, 4.0, 11.3, 6.1
2000, 20, 2.9, 8.4, 12.1
5000, 50, 1.8, 5.2, 30.3
10000, 100, 1.2, 3.6, 60.6
20000, 200, 0.9, 2.5, 121.2

one run, n=2000: p99 544 ms, bootstrap 90% interval 513-600 ms
```

:::chart[90% sampling band of the p50 and p99 estimates vs number of requests (SYNTHETIC, lognormal TTFT, σ = 0.6)]{type="line" x="requests in the run" y="± % of the true value" xlog="true" ylog="true" points="true" xfmt="int" hmarks="10:±10%" note="Half-width of the 5th–95th percentile range over 2,000 simulated runs."}
requests, p50, p99
100, 12.3, 27.0
200, 8.8, 22.6
500, 5.5, 15.4
1000, 4.0, 11.3
2000, 2.9, 8.4
5000, 1.8, 5.2
10000, 1.2, 3.6
20000, 0.9, 2.5
:::

:::example[Worked example · sizing num-prompts]
- **The formula matches the simulation.** At $n$ = 2,000 it predicts ±\(1.645 \times 2.24/\sqrt{2000}\) = ±8.2%; 2,000 simulated runs give ±8.4%.
- **Required $n$ for a band $h$:** \(n \approx (1.645 \times 2.24 / h)^2\) — about 1,400 requests for ±10%, 5,400 for ±5%. At 2.75 req/s those runs take 8 and 33 minutes per operating point.
- **A 100-prompt run** pins p99 to ±27% — a 565 ms truth can read anywhere from about 410 to 720 ms, either side of the 500 ms SLO. Fine for a smoke test; useless for an SLO decision.
- **One run is enough to know its own band.** Resampling the 2,000 requests of a single run (bootstrap) gives 513–600 ms around the 544 ms estimate — about the width the 2,000 independent runs showed. Report p99 with that interval.
:::

## 15.5 Warm-up: the first wave of a closed loop

With `--request-rate inf --max-concurrency 32`, the client starts 32 requests at $t = 0$. They arrive together, before anything is cached, and queue behind each other's prefills. If none of them can reuse the shared prefix (it isn't cached until one of them has computed it), each prefills all 1,024 tokens, 122 ms at the §2.3 MFU assumption, and the $k$-th waits for $k$ of them. In steady state the prefix is cached and TTFT sits around the 53 ms the §2.3 model predicts. A synthetic run with that wave in front:

```python run
"""Warm-up wave in a closed-loop run: C requests start at t=0 (SYNTHETIC, illustrative)."""
import numpy as np

rng = np.random.default_rng(7)
C = 32                                   # --max-concurrency
PF_FULL = 1024 * 21.5e9 / (362e12 * 0.5)  # 1,024-token prefill, MFU 0.5 illustrative (122 ms)
STEADY = (np.log(0.053), 0.4)            # steady-state TTFT, shared prefix cached (section 2.3)


def run(n):
    """TTFT of n requests: the first C miss the prefix cache and queue for prefill."""
    wave = PF_FULL * np.arange(1, C + 1)                 # k-th waits for k full prefills
    return np.concatenate([wave, rng.lognormal(*STEADY, n - C)])


print(f"first wave: {C} prefills of {PF_FULL * 1e3:.0f} ms, last one waits {C * PF_FULL:.2f} s")
print("num-prompts, warm-up share %, p99 all ms, p99 after dropping first C ms, mean all ms")
for n in (100, 200, 500, 1000, 2000, 3200, 5000, 10000):
    t = run(n)
    print(f"{n}, {100 * C / n:.1f}, {np.percentile(t, 99) * 1e3:.0f}, "
          f"{np.percentile(t[C:], 99) * 1e3:.0f}, {t.mean() * 1e3:.0f}")
```

```output
first wave: 32 prefills of 122 ms, last one waits 3.89 s
num-prompts, warm-up share %, p99 all ms, p99 after dropping first C ms, mean all ms
100, 32.0, 3772, 102, 678
200, 16.0, 3650, 115, 366
500, 6.4, 3285, 119, 180
1000, 3.2, 2677, 144, 120
2000, 1.6, 1461, 132, 89
3200, 1.0, 239, 131, 77
5000, 0.6, 153, 134, 70
10000, 0.3, 140, 133, 64
```

:::chart[p99 TTFT vs run length, with and without the first wave (SYNTHETIC, C = 32)]{type="line" x="num-prompts" y="p99 TTFT" unit=" ms" xlog="true" ylog="true" points="true" xfmt="int" hmarks="500:p99 TTFT SLO" note="Worst case: all 32 first-wave requests miss the prefix cache. Steady-state TTFT lognormal around 53 ms."}
num-prompts, p99 all requests, p99 first C dropped
100, 3772, 102
200, 3650, 115
500, 3285, 119
1000, 2677, 144
2000, 1461, 132
3200, 239, 131
5000, 153, 134
10000, 140, 133
:::

The wave is $C$ requests; it dominates p99 whenever it is more than 1% of the run — until $n > 100\,C$ = 3,200 here — and still biases it beyond that. At 2,000 prompts, a configuration that meets the SLO with nearly 4× headroom (132 ms) reports 1,461 ms and fails it. The mean is fooled too: 89 ms against a steady-state mean of 57 ms. Two fixes, both cheap: run a short discarded pass (a few times $C$ prompts) after every server start, or drop the first $C$ completions before computing percentiles. Other warm-up sources — an empty prefix cache, adapters not yet loaded, lazily allocated buffers — are removed by the same discarded pass; CUDA-graph capture and compilation happen at server start and show up in the startup log, not the run.

## 15.6 Choosing the rate and concurrency grid

Two sweeps answer two questions. A **concurrency sweep** (`--request-rate inf`, vary `--max-concurrency`) traces the capacity curve of §2.3. A **rate sweep** (`--burstiness 1.0`, vary `--request-rate`, concurrency uncapped or large) shows latency under offered load, which is what users see. Put the points where the curves bend, using the prediction as a guide: $X^* = 2.75$ req/s for bf16 with prefix caching at the SLO, and a KV cap of 35 sequences at the upper bound.

Queueing delay grows like \(u/(1-u)\) in utilisation $u$, so it changes fastest near saturation — space rate points densely there (first principles, illustrative):

| Rate as fraction of $X^*$ | Rate (req/s) | \(u/(1-u)\) | Minutes for 2,000 prompts |
| ---: | ---: | ---: | ---: |
| 0.25 | 0.69 | 0.33 | 48.5 |
| 0.50 | 1.38 | 1.00 | 24.2 |
| 0.70 | 1.92 | 2.33 | 17.3 |
| 0.80 | 2.20 | 4.00 | 15.2 |
| 0.90 | 2.48 | 9.00 | 13.5 |
| 0.95 | 2.61 | 19.0 | 12.8 |
| 1.00 | 2.75 | ∞ | 12.1 |
| 1.10 | 3.03 | ∞ (queue grows all run) | 12.1 |

The rate sweep costs about 2.6 hours of GPU time at 2,000 prompts per point. For the concurrency sweep use 1, 2, 4, 8, 16, 24, 32 and the KV cap; the low-$C$ points are slow (at $C$ = 1 the §2.3 model gives 36 output tok/s, 0.14 req/s, so 2,000 prompts would take 3.9 hours) but have no queueing and little spread, so 200 prompts (24 minutes) is enough there. The points past saturation (1.1 × $X^*$) are worth one run each: they show whether the server sheds load gracefully or lets TTFT grow without bound.

:::warn[Failure modes that invalidate a comparison]
- **Different workload.** A new seed, dataset, `--num-prompts` or output-length setting between the baseline and the variant makes it two experiments.
- **Client-bound runs.** The benchmark client on the GPU host competes for CPU; a client that can't send fast enough looks like row B of §15.3.
- **Early EOS.** Outputs shorter than labelled make throughput look better and TPOT look the same; check mean output tokens per run.
- **One run per point.** A difference smaller than the p99 band of §15.4 (±8% at 2,000 requests) is not a difference.
:::

## 15.7 What chapters 6 and 7 do differently

**Chapter 6** keeps the model fixed and varies precision across three runs (fp16, GPTQ-Int4, FP8-dynamic), sweeping concurrency 1 → 10 → 100 and appending every result to one JSON file. It uses vLLM's bundled `benchmarks/benchmark_serving.py` rather than the `vllm bench serve` subcommand, because the notebook pins `vllm==0.8.5.post1`.

**Chapter 7** keeps the model fixed and varies the *decoding strategy* (vanilla, n-gram, improved n-gram, Eagle3) at concurrency 1, using Spec-Bench. Concurrency 1 is deliberate: speculation is a latency technique, and batching would hide it.

All three follow the same skeleton — fix the model, change one axis, re-measure with an identical workload, record the result. That skeleton is the transferable asset; the statistics above are what make its rows comparable.

## 15.8 A checklist you can reuse

- [ ] Record `nvidia-smi` (name, compute capability, free/total memory) and the engine version.
- [ ] Write the prediction first: TPOT floor, KV capacity, throughput at the SLO ([§11](/c/llm-serving/11-in-practice)).
- [ ] Build two workloads: realistic, and one that isolates the effect; fix `--seed`.
- [ ] Fix the metrics and SLO percentiles before the first run; include `e2el`.
- [ ] Start the server; read the load time and the KV-cache size from the startup log.
- [ ] Run a discarded warm-up pass after every server start, or drop the first $C$ completions.
- [ ] Size `--num-prompts` for the p99 band you need (±10% ≈ 1,400, ±5% ≈ 5,400 at σ = 0.6).
- [ ] Sweep concurrency geometrically to the KV cap; sweep rate densely between 0.7 and 1.0 of predicted capacity.
- [ ] Check every row: $X \cdot \overline{\text{E2E}} \le C$, total ÷ output throughput = (in + out)/out, TPOT at $C = 1$ ≥ the decode floor.
- [ ] Change exactly one thing; re-run the identical command; report the difference with its interval.
- [ ] Scale out only after the single-GPU bottleneck is explained; measure on the interconnect you will deploy on.

## 15.9 Check yourself

:::qa[A row reports C = 24, mean TTFT 200 ms, mean TPOT 50 ms, 256 output tokens and 3.5 req/s. Believe it?]
E2E = \(0.2 + 255 \times 0.05\) = 12.95 s, so the loop can sustain \(24 / 12.95\) = 1.85 req/s; 3.5 req/s would need \(3.5 \times 12.95\) ≈ 45 requests in flight. Either outputs averaged about \((24/3.5 - 0.2)/0.05 + 1\) ≈ 134 tokens (early EOS), or the concurrency label is wrong.
:::

:::qa[Two configurations differ by 8% in p99 TTFT. How many prompts per run before you can call the difference real?]
The band must be well inside 8%: for ±5%, \(n \approx (1.645 \times 2.24 / 0.05)^2\) ≈ 5,400 requests per run — about 33 minutes each at 2.75 req/s. At 2,000 requests (±8.4%) the two bands overlap and the comparison is noise. Bootstrap both runs to show it.
:::

:::qa[A 500-prompt closed-loop run at C = 32 reports a median TTFT near 53 ms and p99 3.3 s. What happened?]
The warm-up wave: 32 of 500 requests (6.4%) started together on a cold server and queued behind each other's full prefills, up to 32 × 122 ms = 3.9 s. In the synthetic run, dropping them takes p99 from 3,285 to 119 ms. Re-run after a discarded warm-up pass.
:::

:::qa[A run at --request-rate 2 with --max-concurrency 64 reports 2.0 req/s. Is that the server's capacity?]
No — throughput equals the offered rate, so the server was not saturated. Little's law gives the in-flight count as \(2 \times\) mean E2E, far below 64. Raise the rate (or use `inf`) until throughput stops following it; that plateau is capacity.
:::

Next: [the reading plan](/c/llm-serving/16-reading-plan).
