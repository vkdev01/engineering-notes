---
section: "2"
title: "Benchmarks"
kicker: "Getting started"
abstract: "How to read serving numbers: TTFT, TPOT, ITL, E2E, throughput and goodput defined from token timestamps; Little's law tying throughput to concurrency and latency; a first-principles model of Gemma 3 12B on one L40S; and what quantisation, tensor parallelism and prefix caching should and shouldn't move."
time: "22 min"
order: 2
outcomes:
  - "Compute TTFT, TPOT, ITL, E2E and goodput from token timestamps, and say which percentile answers which question"
  - "Sanity-check any closed-loop benchmark row with Little's law: throughput ≈ C / (TTFT + TPOT × (out − 1))"
  - "Predict the throughput and TPOT curve versus concurrency for a model and GPU from bytes, FLOPs and bandwidth"
  - "Decide whether tensor parallelism can pay on PCIe or NVLink from an all-reduce cost estimate"
  - "Explain why total/output token throughput is (in + out)/out, and what a prefix cache really changes"
---
A benchmark run against your HelpDesk deployment prints a dozen numbers: request throughput, output and total token throughput, mean and p99 TTFT, TPOT, ITL. Your manager asks one question — *can one L40S running Gemma 3 12B take the peak load inside the SLO?* This page shows how to answer it from those numbers, how to tell when a number is wrong, and how to predict the curve before you run anything.

:::key[First principle]
A serving number is a point on a curve. Throughput, latency and concurrency are tied together by Little's law, and the curve's shape is set by three quantities from [§1](/c/llm-serving/01-repository-tour): weight bytes, KV bytes per token and memory bandwidth — plus prefill FLOPs. A throughput figure without its model, GPU, input/output lengths, request rate and concurrency is not a number.
:::

## 2.1 The metrics, from token timestamps

Every serving metric is a function of four timestamps per request: arrival $a_i$, first token $f_i$, the $k$-th token $t_{i,k}$, and last token $e_i$, with $n_i$ output tokens and $m_i$ prompt tokens.

$$
\begin{aligned}
\text{TTFT}_i &= f_i - a_i &&\text{queueing + prefill + first sample}\\
\text{TPOT}_i &= \frac{e_i - f_i}{n_i - 1} &&\text{mean decode gap, one value per request}\\
\text{ITL}_{i,k} &= t_{i,k+1} - t_{i,k} &&\text{every gap, pooled over all requests}\\
\text{E2E}_i &= e_i - a_i = \text{TTFT}_i + (n_i - 1)\,\text{TPOT}_i
\end{aligned}
$$

Over a run of length $T$: request throughput is $N/T$, output token throughput $\sum n_i / T$, total token throughput $\sum (m_i + n_i)/T$. **Goodput** is the throughput of requests that met every SLO — the only throughput a user is paying for.

TPOT and ITL have the same mean when every request has the same length, but they answer different questions. TPOT averages *within* a request first, so a short stall disappears into the request's mean. ITL keeps every gap, so its p99 shows the stalls a reader actually sees as a stutter. Here they are on a synthetic trace shaped like the HelpDesk workload, with 2% of decode steps sharing time with another request's prefill:

```python run
"""Serving metrics from token timestamps, on a SYNTHETIC trace (illustrative inputs)."""
import numpy as np

rng = np.random.default_rng(0)
N = 2000
SLO_TTFT, SLO_TPOT = 0.500, 0.050                      # HelpDesk SLO, seconds
ttft = rng.lognormal(np.log(0.14), 0.6, N)             # queueing + prefill
out = np.clip(rng.geometric(1 / 256, N), 2, 2048)      # output tokens per request
reqs = []
for i in range(N):
    gaps = rng.normal(0.043, 0.004, out[i] - 1)        # steady decode steps
    gaps += (rng.random(out[i] - 1) < 0.02) * 0.120    # 2% of steps share time with a prefill
    reqs.append(gaps)

e2e = ttft + np.array([g.sum() for g in reqs])
tpot = (e2e - ttft) / (out - 1)                        # per request, then averaged
itl = np.concatenate(reqs)                             # every gap, pooled
pct = lambda a: "mean %6.1f  p50 %6.1f  p90 %6.1f  p99 %6.1f" % (
    a.mean() * 1e3, *(np.percentile(a, [50, 90, 99]) * 1e3))
print("TTFT ms ", pct(ttft))
print("TPOT ms ", pct(tpot))
print("ITL  ms ", pct(itl))
print("E2E  s  ", pct(e2e / 1e3))
good = (ttft <= SLO_TTFT) & (tpot <= SLO_TPOT)
print(f"requests meeting both SLOs: {good.mean():.1%}  "
      f"(TTFT ok {np.mean(ttft <= SLO_TTFT):.1%}, TPOT ok {np.mean(tpot <= SLO_TPOT):.1%})")
```

```output
TTFT ms  mean  164.5  p50  137.2  p90  299.6  p99  541.8
TPOT ms  mean   45.4  p50   45.2  p90   47.3  p99   52.8
ITL  ms  mean   45.4  p50   43.1  p90   48.6  p99  163.0
E2E  s   mean   12.1  p50    8.3  p90   27.4  p99   54.1
requests meeting both SLOs: 96.3%  (TTFT ok 98.5%, TPOT ok 97.8%)
```

Four readings, each a habit:

- **Mean TTFT 164.5 ms passes a 500 ms SLO; p99 541.8 ms fails it.** An SLO written on a percentile must be checked on that percentile.
- **ITL p99 is 163.0 ms while TPOT p99 is 52.8 ms.** The stalls are real and visible to users; TPOT averages them away. If streaming smoothness matters, report ITL percentiles.
- **E2E is mostly output length.** Its p99 (54.1 s) is set by the longest answers, not the server. Compare E2E across runs only at the same output-length distribution.
- **Goodput is 96.3% of throughput.** At 2 req/s that is 1.93 good req/s; the other 3.7% were served and still failed the user.

vLLM's benchmark (`vllm bench serve`, or `benchmarks/benchmark_serving.py` in older versions, which chapter 6 uses) prints these fields; the notebooks read them from the saved JSON:

| Field | Meaning |
| --- | --- |
| `request_throughput` | Completed requests per second |
| `output_throughput` | Generated tokens per second |
| `total_token_throughput` | Prompt plus generated tokens per second |
| `mean_ttft_ms`, `p99_ttft_ms` | Time to first token: queueing + prefill |
| `mean_tpot_ms`, `p99_tpot_ms` | Time per output token, per request, excluding the first |
| `mean_itl_ms`, `p99_itl_ms` | Inter-token latency, every gap pooled |

## 2.2 Little's law: the check every benchmark row must pass

A benchmark with `--max-concurrency C` and a request rate high enough to keep it full is a **closed loop**: $C$ clients each send a request, wait for the last token, and send the next. Little's law says the average number in the system equals arrival rate times time in system, $C = X \cdot \overline{\text{E2E}}$, so

$$
X \approx \frac{C}{\text{TTFT} + \text{TPOT}\,(\text{out} - 1)} \quad \text{requests/s}, \qquad \text{output tok/s} \approx X \cdot \text{out}.
$$

The means here are request-weighted; with a wide output-length distribution use the mean E2E directly. If the request rate is *below* what the loop could sustain, the server is not saturated and $X$ equals the offered rate instead — the first thing to check when a row looks too slow.

:::example[Worked example · one row, checked by hand]
Gemma 3 12B bf16 on one L40S, HelpDesk lengths, $C = 16$. The model in §2.3 predicts TTFT 139.5 ms and TPOT 43.2 ms:

$$
\text{E2E} = 0.1395 + 255 \times 0.0432 = 11.15\ \text{s}, \qquad X = \frac{16}{11.15} = 1.435\ \text{req/s} \approx 367\ \text{output tok/s}.
$$

A table claiming 3 req/s at those latencies would need $C \approx 33$ requests in flight. Either the concurrency is misreported, the output lengths are shorter than you think, or the timer is wrong.
:::

## 2.3 A first-principles model of the curve

You can predict the throughput–latency curve before renting the GPU. Every input below is a spec value or a labelled assumption; the result is ILLUSTRATIVE, not a measurement.

**Decode step.** At batch $C$, one step streams all weights once plus each sequence's KV cache, at mean context $\bar c = \text{in} + \text{out}/2 = 1{,}152$ tokens:

$$
t_{\text{dec}}(C) = \frac{\text{bytes}_W + C \cdot \bar c \cdot \text{KV/token}}{\text{bandwidth}}.
$$

The compute for that step, \(C \times 21.5\) GFLOP, is under 5 ms even at $C = 35$, so decode stays memory-bound.

**Prefill.** A 1,024-token prompt costs \(1{,}024 \times 21.5\) GFLOP; at an assumed 50% of the L40S's 362 TFLOPS (the MFU is ILLUSTRATIVE) that is $P = 121.7$ ms. Attention adds \(2n^2 H d_h L\) = 0.41 TFLOP to the 22.0 TFLOP of matrix multiplies, about 2% at this length, and is ignored.

**Interference.** With continuous batching, prefills run on the same GPU as everyone's decode. At $X$ requests/s the GPU spends a fraction $XP$ of its time prefilling, so every decode step is stretched:

$$
\text{TPOT} = \frac{t_{\text{dec}}(C)}{1 - XP}, \qquad \text{TTFT} \approx P + \tfrac{1}{2} t_{\text{dec}}(C),
$$

and $X$ from Little's law closes the loop. Solve by fixed-point iteration, for bf16 and int4 weights, with and without the 768-token shared prefix cached (prefill drops to 256 tokens). Concurrency stops where the KV pool from §1 is full: 35 requests for bf16, 66 for int4.

```python run
"""Closed-loop throughput model: Gemma 3 12B on one L40S, HelpDesk workload.
Every input is a spec value or a labelled assumption; nothing here is measured."""
BW, PEAK = 864e9, 362e12           # L40S bandwidth (B/s) and dense bf16 FLOP/s, spec
MFU = 0.50                         # ILLUSTRATIVE: fraction of peak reached in prefill
F = 2 * 10.758e9                   # forward FLOPs per token = 2 x non-embedding params
KV_TOK = 393_216                   # KV bytes/token, all-layers bound (section 1)
W = {"bf16": 23.53e9, "int4": 7.73e9}
CAP = {"bf16": 35, "int4": 66}     # concurrent requests that fit the KV pool (section 1)
IN, SHARED, OUT = 1024, 768, 256   # HelpDesk prompt, shared prefix, output tokens


def operating_point(C, w, prefix_cache):
    p = (IN - SHARED if prefix_cache else IN) * F / (PEAK * MFU)   # prefill seconds
    t_dec = (W[w] + C * (IN + OUT / 2) * KV_TOK) / BW               # one decode step
    x = 0.0
    for _ in range(200):           # fixed point: prefill steals time from decode
        tpot = t_dec / (1 - x * p)
        ttft = p + t_dec / 2       # wait for the running step, then prefill
        x = C / (ttft + (OUT - 1) * tpot)
    return ttft, tpot, x


RUNS = [("bf16", False), ("bf16", True), ("int4", False), ("int4", True)]
print("C, " + ", ".join(f"{w}{' +cache' if pc else ''}" for w, pc in RUNS) + "   <- output tok/s")
for C in (1, 2, 4, 8, 16, 24, 32, 48, 64):
    row = [f"{operating_point(C, w, pc)[2] * OUT:.0f}" if C <= CAP[w] else "-" for w, pc in RUNS]
    print(f"{C}, " + ", ".join(row))
print("C, " + ", ".join(f"{w}{' +cache' if pc else ''}" for w, pc in RUNS) + "   <- TPOT ms")
for C in (1, 2, 4, 8, 16, 24, 32, 48, 64):
    row = [f"{operating_point(C, w, pc)[1] * 1e3:.1f}" if C <= CAP[w] else "-" for w, pc in RUNS]
    print(f"{C}, " + ", ".join(row))

print("\nlargest C meeting mean TPOT <= 50 ms:")
for w, pc in RUNS:
    ok = [C for C in range(1, CAP[w] + 1) if operating_point(C, w, pc)[1] <= 0.050]
    ttft, tpot, x = operating_point(ok[-1], w, pc)
    print(f"  {w:4s} cache={str(pc):5s} C={ok[-1]:2d}  TTFT {ttft * 1e3:5.1f} ms  "
          f"TPOT {tpot * 1e3:4.1f} ms  {x:4.2f} req/s  {x * OUT:5.0f} out tok/s  "
          f"{x * (IN + OUT):5.0f} total tok/s")
print(f"\nprefill alone caps a replica at {PEAK * MFU / (IN * F):.1f} req/s "
      f"({PEAK * MFU / ((IN - SHARED) * F):.1f} with the shared prefix cached)")
ttft, tpot, x = operating_point(16, "bf16", False)
print(f"bf16, C=16: prefill {IN * F / (PEAK * MFU) * 1e3:.1f} ms, decode step "
      f"{(W['bf16'] + 16 * (IN + OUT / 2) * KV_TOK) / BW * 1e3:.1f} ms, TTFT {ttft * 1e3:.1f} ms, "
      f"TPOT {tpot * 1e3:.1f} ms, E2E {ttft + (OUT - 1) * tpot:.2f} s, {x:.3f} req/s")
```

```output
C, bf16, bf16 +cache, int4, int4 +cache   <- output tok/s
1, 35, 36, 96, 103
2, 67, 70, 176, 194
4, 127, 134, 300, 345
8, 225, 247, 463, 564
16, 367, 426, 634, 829
24, 466, 562, 723, 982
32, 538, 669, 777, 1082
48, -, -, 840, 1205
64, -, -, 876, 1277
C, bf16, bf16 +cache, int4, int4 +cache   <- TPOT ms
1, 28.2, 27.9, 9.9, 9.6
2, 29.2, 28.5, 10.9, 10.2
4, 31.2, 29.8, 12.9, 11.5
8, 35.2, 32.4, 16.8, 14.1
16, 43.2, 37.5, 24.8, 19.2
24, 51.2, 42.7, 32.8, 24.4
32, 59.1, 47.8, 40.8, 29.5
48, -, -, 56.8, 39.8
64, -, -, 72.8, 50.1

largest C meeting mean TPOT <= 50 ms:
  bf16 cache=False C=22  TTFT 141.1 ms  TPOT 49.2 ms  1.74 req/s    444 out tok/s   2222 total tok/s
  bf16 cache=True  C=35  TTFT  53.2 ms  TPOT 49.7 ms  2.75 req/s    703 out tok/s   3517 total tok/s
  int4 cache=False C=41  TTFT 136.9 ms  TPOT 49.8 ms  3.19 req/s    818 out tok/s   4088 total tok/s
  int4 cache=True  C=63  TTFT  51.4 ms  TPOT 49.5 ms  4.97 req/s   1273 out tok/s   6367 total tok/s

prefill alone caps a replica at 8.2 req/s (32.9 with the shared prefix cached)
bf16, C=16: prefill 121.7 ms, decode step 35.6 ms, TTFT 139.5 ms, TPOT 43.2 ms, E2E 11.15 s, 1.435 req/s
```

:::chart[Model: output throughput vs concurrency, Gemma 3 12B on one L40S (ILLUSTRATIVE)]{type="line" x="concurrent requests C" y="output tokens/s" xfmt="int" yfmt="int" dash="bf16 +cache,int4 +cache" note="First-principles model, prefill MFU 50% assumed. bf16 stops at 35 and int4 at 66 requests, where the KV pool is full."}
C, bf16, bf16 +cache, int4, int4 +cache
1, 35, 36, 96, 103
2, 67, 70, 176, 194
4, 127, 134, 300, 345
8, 225, 247, 463, 564
16, 367, 426, 634, 829
24, 466, 562, 723, 982
32, 538, 669, 777, 1082
48, -, -, 840, 1205
64, -, -, 876, 1277
:::

:::chart[Model: mean TPOT vs concurrency against the 50 ms SLO (ILLUSTRATIVE)]{type="line" x="concurrent requests C" y="mean TPOT" unit=" ms" xfmt="int" hmarks="50:HelpDesk TPOT SLO" dash="bf16 +cache,int4 +cache"}
C, bf16, bf16 +cache, int4, int4 +cache
1, 28.2, 27.9, 9.9, 9.6
2, 29.2, 28.5, 10.9, 10.2
4, 31.2, 29.8, 12.9, 11.5
8, 35.2, 32.4, 16.8, 14.1
16, 43.2, 37.5, 24.8, 19.2
24, 51.2, 42.7, 32.8, 24.4
32, 59.1, 47.8, 40.8, 29.5
48, -, -, 56.8, 39.8
64, -, -, 72.8, 50.1
:::

What the model says about the HelpDesk launch:

- **Batching is nearly free at first, then it isn't.** From $C = 1$ to $C = 8$, bf16 throughput rises 6.4× (35 → 225 tok/s) while TPOT rises 25% (28.2 → 35.2 ms): every extra sequence shares the same weight read. After that, each sequence's own KV reads and the prefills it brings dominate.
- **The SLO, not memory, sets the bf16 operating point.** Without prefix caching TPOT crosses 50 ms at $C = 23$; the best point inside the SLO is $C = 22$ at 1.74 req/s. Memory would have allowed 35.
- **Prefill alone caps a replica at 8.2 req/s.** Even with infinitely fast decode, 1,024-token prompts at 50% MFU saturate the GPU at that rate. HelpDesk's 10 req/s peak cannot fit on one L40S without prefix caching, whatever else you change.
- **The best configuration serves 4.97 req/s inside the SLO**: int4 weights plus a cached shared prefix at $C = 63$. Peak traffic needs at least three such GPUs before any headroom for queueing — [§3](/c/llm-serving/03-serving-and-optimization) prices it.

:::warn[A model is a hypothesis, not a result]
This model ignores scheduler overhead, sampling, CUDA-graph limits, attention kernels, uneven output lengths and the real MFU of your prefill. Its job is to tell you which curve to expect and which knob matters; the benchmark's job is to correct it. If they disagree by more than about 30%, find the missing term before trusting either.
:::

## 2.4 Why int4 moves TPOT and throughput by the same factor

Read the int4 column against bf16 at $C = 1$: TPOT 28.2 → 9.9 ms (2.85× faster), throughput 35 → 96 tok/s (2.74×). At low concurrency a decode step is a weight read, TPOT is proportional to weight bytes, and by Little's law throughput is $C$ divided by a time that is almost all TPOT. Both move by roughly the bytes ratio, \(23.53 / 7.73\) = 3.04, less the parts int4 doesn't shrink.

At $C = 32$ the factors shrink together: throughput 538 → 777 (1.44×), TPOT 59.1 → 40.8 ms (1.45×). Now each step also reads 32 sequences' bf16 KV cache (\(32 \times 1{,}152 \times 384\) KiB = 14.5 GB, more than the int4 weights) and absorbs the same prefill compute, and int4 shrinks neither.

:::tip[Diagnostic rule]
If a change moves TPOT and throughput by the same factor, decode was bandwidth-bound and the factor is the byte ratio of whatever got smaller. If throughput moves much more than TPOT, the change bought concurrency (more KV room); if TTFT moves and TPOT doesn't, it changed prefill.
:::

Chapter 9's notebook runs exactly this comparison (fp16 against AWQ at the same rate and concurrency), and chapter 6's runs fp16, GPTQ-Int4 and FP8-dynamic across concurrency 1, 10 and 100. Read their TPOT and throughput rows against each other with this rule.

## 2.5 Tensor parallelism on PCIe vs NVLink

Chapter 9's distributed phase serves one model with tensor parallelism on 1, 2 and 4 GPUs on two instance types. On the PCIe-only `g6e` (L40S) instances, adding GPUs made throughput *and* TTFT worse; on NVLink `p4d` (A100) instances they improved. The notebook states the trade-off: *"Overall throughput will be lower, since 1 gpu x 4 > 4 gpu, so we are trading off throughput for latency in this case."*

The first-principles reason: Megatron-style tensor parallelism splits every weight matrix $N$ ways and needs two all-reduces of the activations per layer (after attention and after the MLP). A ring all-reduce of $S$ bytes over $N$ GPUs with per-direction link bandwidth $\beta$ and per-hop latency $\alpha$ costs

$$
t_{\text{AR}} = \frac{2(N-1)}{N} \cdot \frac{S}{\beta} + 2(N-1)\,\alpha,
$$

with $S = \text{tokens} \times d \times 2$ bytes. For Gemma 3 12B that is \(2L = 96\) all-reduces per forward pass. Decode moves small messages many times (latency-bound); prefill moves large ones (bandwidth-bound). PCIe Gen4 gives about 32 GB/s each way; NVLink on A100 about 300 GB/s each way (600 GB/s total). The per-hop latencies below — 10 µs on PCIe, 2 µs on NVLink — are ILLUSTRATIVE.

```python run
"""Tensor parallelism: per-layer all-reduce cost vs compute, Gemma 3 12B (first principles).
Bandwidths are spec values; per-hop latencies ALPHA are ILLUSTRATIVE."""
L, HID, BYTES = 48, 3840, 2          # Gemma 3 12B layers, hidden size, bf16
W, KV_TOK, F = 23.53e9, 393_216, 2 * 10.758e9
GPU = {  # memory B/s, bf16 FLOP/s, link B/s each way, per-hop latency s
    "L40S + PCIe": (864e9, 362e12, 32e9, 10e-6),
    "A100 + NVLink": (1555e9, 312e12, 300e9, 2e-6),
}
B, CTX, PROMPT, MFU = 16, 1152, 1024, 0.50   # decode batch, mean context, prompt, MFU


def allreduce(nbytes, n, link, alpha):
    """Ring all-reduce: 2(n-1)/n of the message crosses each link, 2(n-1) latency hops."""
    return 0.0 if n == 1 else 2 * (n - 1) / n * nbytes / link + 2 * (n - 1) * alpha


print(f"{'setup':14s} {'N':>2} | {'decode step ms':>14} {'comm':>5} {'speedup':>7} {'per GPU':>7}"
      f" | {'prefill ms':>10} {'comm':>5} {'speedup':>7}")
for name, (bw, peak, link, alpha) in GPU.items():
    base_d = base_p = None
    for n in (1, 2, 4):
        dec = (W + B * CTX * KV_TOK) / n / bw                    # weights + KV split n ways
        dec_c = 2 * L * allreduce(B * HID * BYTES, n, link, alpha)
        pre = PROMPT * F / n / (peak * MFU)
        pre_c = 2 * L * allreduce(PROMPT * HID * BYTES, n, link, alpha)
        base_d, base_p = base_d or dec + dec_c, base_p or pre + pre_c
        sd = base_d / (dec + dec_c)
        print(f"{name:14s} {n:2d} | {(dec + dec_c) * 1e3:14.1f} {dec_c * 1e3:5.1f} {sd:6.2f}x "
              f"{sd / n:6.0%} | {(pre + pre_c) * 1e3:10.1f} {pre_c * 1e3:5.1f} "
              f"{base_p / (pre + pre_c):6.2f}x")
```

```output
setup           N | decode step ms  comm speedup per GPU | prefill ms  comm speedup
L40S + PCIe     1 |           35.6   0.0   1.00x   100% |      121.7   0.0   1.00x
L40S + PCIe     2 |           20.1   2.3   1.77x    89% |       86.4  25.5   1.41x
L40S + PCIe     4 |           15.2   6.3   2.34x    59% |       71.6  41.1   1.70x
A100 + NVLink   1 |           19.8   0.0   1.00x   100% |      141.2   0.0   1.00x
A100 + NVLink   2 |           10.3   0.4   1.92x    96% |       73.5   2.9   1.92x
A100 + NVLink   4 |            6.2   1.2   3.21x    80% |       40.2   4.9   3.51x
```

:::chart[Estimated per-GPU efficiency of tensor parallelism, decode at batch 16]{type="bar" x="GPUs" y="speedup ÷ GPUs" yfmt="pct" labels="true" note="First-principles estimate; per-hop latencies illustrative. A replica of the whole model on each GPU scores 100% by definition."}
GPUs, L40S + PCIe, A100 + NVLink
1, 1.00, 1.00
2, 0.89, 0.96
4, 0.59, 0.80
:::

Even this best case makes the repository's finding unsurprising. On four L40S GPUs, 6.3 ms of every 15.2 ms decode step is communication, and a 1,024-token prefill spends 41.1 ms of 71.6 ms moving activations over PCIe: per GPU, TP4 delivers 59% of a single GPU's decode throughput. Four independent replicas — the model fits on one L40S — deliver 100%. Real PCIe all-reduce rarely reaches link bandwidth, and kernel launch and synchronisation add more, which is how a 59% estimate becomes a measured loss.

| Situation | Choice |
| --- | --- |
| Model fits one GPU, goal is throughput | Replicas, never TP |
| Model fits, goal is lower TPOT, NVLink available | TP2 or TP4 (80–96% per-GPU efficiency estimated) |
| Model fits, PCIe only | Replicas; reduce TPOT with int4 or speculative decoding instead |
| Model doesn't fit one GPU, PCIe only | TP2 at most, or quantise until it fits (27B int4 = 16.42 GB) |

## 2.6 Prefix caching, and the total/output ratio

Total token throughput counts prompt tokens; output token throughput doesn't. Their ratio is fixed by the workload:

$$
\frac{\text{total tok/s}}{\text{output tok/s}} = \frac{\overline{\text{in}} + \overline{\text{out}}}{\overline{\text{out}}}.
$$

For HelpDesk, \((1{,}024 + 256)/256\) = 5.0 — with or without a prefix cache, on any GPU. Chapter 9's prefix-repetition workload (256-token shared prefix, 256-token suffix, 128 output tokens) gives \((512 + 128)/128\) = 5.0 as well. A 5× gap between total and output throughput on that workload is arithmetic, not evidence that the cache worked.

What the cache does change is the prefill: with the 768-token system prompt cached, each request computes 256 new tokens instead of 1,024. From the §2.3 model at the best point inside the TPOT SLO:

| bf16, HelpDesk | C | TTFT | TPOT | req/s | output tok/s | total tok/s | total ÷ output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| No prefix cache | 22 | 141.1 ms | 49.2 ms | 1.74 | 444 | 2,222 | 5.0 |
| Shared prefix cached | 35 | 53.2 ms | 49.7 ms | 2.75 | 703 | 3,517 | 5.0 |

The cache cuts TTFT by 2.7×, and by taking prefill time away from decode it lets 35 sequences instead of 22 run inside the TPOT SLO: 1.58× the throughput. The ratio column doesn't move. To see a cache in a benchmark, compare TTFT (and the server's prefix-cache hit rate in its log) between a run with prefix caching enabled and one with it disabled, on a workload with a known shared prefix.

## 2.7 A checklist for any benchmark table

1. **Five labels:** model and precision, GPU and count, input/output length distribution, request rate, max concurrency. Missing one, don't compare it with anything.
2. **Little's law:** $C / (\text{TTFT} + \text{TPOT}(\text{out}-1))$ within about 10% of request throughput, or the server wasn't saturated.
3. **Decode floor:** mean TPOT at $C=1$ ≥ weight bytes ÷ bandwidth (27.2 ms for 12B bf16 on an L40S). Faster means speculation, a smaller model, or a timing bug.
4. **Ratio:** total ÷ output throughput = (in + out)/out. If not, the lengths are not what the label says.
5. **Tail:** read p99 TTFT and p99 ITL against the SLO; means hide stalls.
6. **Same harness:** numbers from different notebooks or tools are not comparable — the repository's chapters each carry their own setup.

## 2.8 Check yourself

:::qa[A table reports C = 10, mean TTFT 100 ms, mean TPOT 40 ms, 200 output tokens and 5 req/s. Is it consistent?]
Little's law gives \(10 / (0.1 + 199 \times 0.04)\) = \(10 / 8.06\) ≈ 1.24 req/s. Five req/s would need about 40 requests in flight. Either the concurrency or the output length is wrong, or the run wasn't closed-loop.
:::

:::qa[Switching Gemma 3 12B from bf16 to int4 at C = 1 cut TPOT 2.85× in the model. Why not 4×?]
Batch-1 decode time is weight bytes ÷ bandwidth, and int4 shrinks bytes from 23.53 to 7.73 GB, only 3.04×, because the 2.01 GB tied embedding stays bf16 and group scales add 0.25 bits per weight. The remaining gap to 2.85× is the bf16 KV read and prefill interference, which int4 doesn't touch.
:::

:::qa[Two L40S GPUs: TP2 or two replicas for HelpDesk?]
Two replicas. The 12B fits on one L40S, the estimated TP2 decode efficiency on PCIe is 89% per GPU at best (59% at TP4), and chapter 9 measured tensor parallelism hurting on `g6e`. TP only makes sense on PCIe when the model doesn't fit one GPU.
:::

:::qa[Prefix caching is turned on and total token throughput is still exactly 5× output throughput. Did it work?]
The ratio can't tell you: it is \((1{,}024 + 256)/256\) = 5 for HelpDesk regardless. Look at TTFT — the model predicts 141 → 53 ms — and at the prefix-cache hit rate the server logs.
:::

Next: [Chapter 1 — Serving and optimization](/c/llm-serving/03-serving-and-optimization).
