---
section: "7"
title: "Chapter 5 \u2014 Challenges"
kicker: "Chapter notes"
abstract: "No code in the repository, so this page does the chapter's arithmetic on Gemma 3 12B and an L40S: the KV-cache budget and how many sequences fit at 4k and 32k context, bf16 versus int4, the roofline that makes decode bandwidth-bound and long prefill compute-bound, cold-start time from bytes and bandwidth, and a table for naming the bottleneck."
time: "24 min"
order: 7
outcomes:
  - "Compute the KV pool and the maximum concurrent sequences at a given context, with both KV bounds"
  - "Place prefill and decode on the roofline and say which resource limits each"
  - "Estimate model-loading time from bytes and the bandwidth of each hop"
  - "Decide which resource is the bottleneck from a symptom before changing anything"
---
**Covers:** why optimisation matters, accelerator chips and GPU specs, model-loading bottlenecks, KV cache sizing, arithmetic-intensity analysis of prefill and decode.

The HelpDesk server has one L40S and Gemma 3 12B. Product asks for 32k-token context so the assistant can read whole ticket histories. How many users can be mid-conversation at once? Is the answer different in int4? When the pod restarts, how long until it serves? Chapter 5 has no code — like chapter 1, there is no `ch05/` directory — but every one of those questions is a few lines of arithmetic, and the later chapters' artefacts are where you check the arithmetic against your own machine.

:::key[First principle]
Every serving limit is one of four resources running out: memory **capacity** (the KV pool), memory **bandwidth** (decode), **compute** (long prefill), or **I/O** (loading weights, moving activations between GPUs). Each has a formula. Compute which one binds before you change a flag.
:::

## 7.1 Where each question is answered in the repository

| Chapter 5 question | Answered by | What it shows |
| --- | --- | --- |
| What hardware do I have? | `ch09` Phase 1 | `nvidia-smi --query-gpu=name,compute_cap,memory.free,memory.used,memory.total --format=csv`; on an L40S `memory.total` reads 46,068 MiB, where every budget below starts |
| What does a model cost in memory? | `ch02/ch2_Inside_the_Mind_of_a_Transformer.ipynb` | An explicit memory-calculation function driven by `model.config` — point it at a Gemma 3 config to reproduce §7.2 |
| How long does loading take? | `ch09` Phase 6 and `vllm.log` | The server logs how much memory the weights took and how many seconds loading took; the notebook asks you to read that line yourself |
| Is my workload compute- or bandwidth-bound? | `ch02/ch2_Workthrough_LLM_execution.ipynb` | The per-token timing chart: one tall prefill bar, then a flat decode tail |
| Does quantisation actually help? | `ch06`, `ch09` | One model at several precisions under one benchmark command |

The notebooks use a different open-weight model; this guide re-derives the numbers on Gemma 3 so they stay consistent with the rest of the course.

## 7.2 The memory budget

An engine such as vLLM claims a fraction $u$ of visible GPU memory (`--gpu-memory-utilization`), loads the weights $W$, sets aside a reserve $R$ for activations and graphs, and gives the rest to the KV cache:

$$
\text{pool} = M_{\text{visible}} \cdot u - W - R
$$

Each token of each sequence costs \(2 \times \text{layers} \times \text{KV heads} \times \text{head dim} \times \text{bytes}\) of KV — the 2 is K and V. For Gemma 3 12B in bf16: \(2 \times 48 \times 8 \times 256 \times 2\) = 393,216 B = 384 KiB per token. That is the **upper bound**: it assumes every layer keeps every token. Gemma 3 interleaves 5 local layers to 1 global; the 40 local layers attend only to the last 1,024 tokens, so a window-aware allocator needs

$$
\text{KV}(c) = c \cdot 64\ \text{KiB} + \min(c, 1024) \cdot 320\ \text{KiB}
$$

per sequence of $c$ tokens — the **lower bound**. Whether your engine version exploits the window is an engine detail; the KV-cache size and maximum-concurrency lines it prints at startup tell you which bound you are on.

:::example[Worked example · the HelpDesk KV pool]
\(46{,}068\) MiB × 0.90 = 41,461 MiB = 40.49 GiB. Subtract 21.91 GiB of bf16 weights and a 2 GiB reserve (illustrative): **16.58 GiB** of KV pool. At 384 KiB per token that is \(16.58 \times 2^{20} / 384\) ≈ 45,260 tokens across all sequences.

At 4,096 tokens a sequence needs \(4{,}096 \times 384\) KiB = 1.5 GiB (upper) or \(4{,}096 \times 64 + 1{,}024 \times 320\) KiB = 576 MiB (window-aware): 11 or 29 sequences.
:::

```python run
"""KV budget for Gemma 3 12B on one L40S: pool, max tokens, max concurrent sequences."""
GiB, MiB, KiB = 2**30, 2**20, 2**10
VISIBLE = 46_068 * MiB             # what nvidia-smi reports for an L40S
UTIL, RESERVE = 0.90, 2 * GiB      # engine memory fraction; activation/graph reserve (illustrative)
WEIGHTS = {"bf16": 23.53e9, "int4": 7.73e9}
FULL = 2 * 48 * 8 * 256 * 2        # bytes/token if every layer keeps every token
GLOBAL = 2 * 8 * 8 * 256 * 2       # bytes/token for the 8 global layers
LOCAL = 2 * 40 * 8 * 256 * 2       # bytes/token for the 40 local layers, capped at 1,024 tokens


def per_seq(ctx, window_aware):
    return ctx * GLOBAL + min(ctx, 1024) * LOCAL if window_aware else ctx * FULL


print("KV bytes/token: all layers %d KiB, global only %d KiB, local %d KiB (x1024 cap)"
      % (FULL // KiB, GLOBAL // KiB, LOCAL // KiB))
pools = {}
for name, w in WEIGHTS.items():
    budget = VISIBLE * UTIL
    pools[name] = budget - w - RESERVE
    print("%s: %.2f GiB budget - %.2f GiB weights - %.0f GiB reserve = %.2f GiB KV pool, "
          "%d tokens (upper bound)" % (name, budget / GiB, w / GiB, RESERVE / GiB,
                                       pools[name] / GiB, pools[name] // FULL))
print()
print("%-6s %7s %16s %14s %16s" % ("prec", "context", "per seq (upper)", "seqs (upper)",
                                   "seqs (window)"))
for name in WEIGHTS:
    for ctx in (4096, 32768):
        up, lo = per_seq(ctx, False), per_seq(ctx, True)
        print("%-6s %7d %12.2f GiB %14d %16d" % (name, ctx, up / GiB, pools[name] // up,
                                                pools[name] // lo))
print()
print("context, bf16 upper, bf16 window-aware, int4 upper, int4 window-aware")
for ctx in (1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072):
    row = []
    for name in WEIGHTS:
        for wa in (False, True):
            n = int(pools[name] // per_seq(ctx, wa))
            row.append(str(n) if n else "-")
    print("%d, %s" % (ctx, ", ".join(row)))
```

```output
KV bytes/token: all layers 384 KiB, global only 64 KiB, local 320 KiB (x1024 cap)
bf16: 40.49 GiB budget - 21.91 GiB weights - 2 GiB reserve = 16.58 GiB KV pool, 45261 tokens (upper bound)
int4: 40.49 GiB budget - 7.20 GiB weights - 2 GiB reserve = 31.29 GiB KV pool, 85443 tokens (upper bound)

prec   context  per seq (upper)   seqs (upper)    seqs (window)
bf16      4096         1.50 GiB             11               29
bf16     32768        12.00 GiB              1                7
int4      4096         1.50 GiB             20               55
int4     32768        12.00 GiB              2               13

context, bf16 upper, bf16 window-aware, int4 upper, int4 window-aware
1024, 44, 44, 83, 83
2048, 22, 37, 41, 71
4096, 11, 29, 20, 55
8192, 5, 20, 10, 38
16384, 2, 12, 5, 23
32768, 1, 7, 2, 13
65536, -, 3, 1, 7
131072, -, 1, -, 3
```

:::chart[Concurrent sequences that fit vs context length — Gemma 3 12B on one L40S, both KV bounds]{type="line" x="context per sequence (tokens)" y="max concurrent sequences" xlog="true" ylog="true" marks="4096:4k;32768:32k" dash="bf16 upper,int4 upper" note="A gap means not even one sequence fits. Upper bound: every layer keeps every token. Window-aware: local layers keep 1,024."}
context, bf16 upper, bf16 window-aware, int4 upper, int4 window-aware
1024, 44, 44, 83, 83
2048, 22, 37, 41, 71
4096, 11, 29, 20, 55
8192, 5, 20, 10, 38
16384, 2, 12, 5, 23
32768, 1, 7, 2, 13
65536, -, 3, 1, 7
131072, -, 1, -, 3
:::

What the budget means for the 32k request:

- **The KV bound decides the product.** At 32k context, bf16 serves 1 sequence on the upper bound and 7 on the window-aware bound. Below 1,024 tokens the bounds agree; above it they diverge, because only 8 of 48 layers grow with context. Read the startup log before promising anyone a concurrency number.
- **Long context is paid for in users.** Going from 4k to 32k divides concurrency by 11 (upper) or about 4 (window-aware) — 29 to 7. Size `--max-model-len` to the context you actually need, not the model's maximum.
- **Some contexts do not fit at all.** One 131,072-token sequence needs \(131{,}072 \times 384\) KiB = 48 GiB on the upper bound, nearly three times the bf16 pool. An engine sized on that bound refuses to start with that `--max-model-len`.
- **The flags are the formula.** `--gpu-memory-utilization` is $u$ and `--max-model-len` is the largest $c$ one sequence may reach — which is why every vLLM command in chapters 6 and 9 passes them explicitly.

:::warn[The reserve is not optional]
The 2 GiB reserve here is a placeholder. Activation memory grows with the number of tokens processed in one step (long prefills, chunk size), and CUDA-graph capture takes its own share. Raise `--gpu-memory-utilization` towards 1.0 and the first long prompt can run out of memory mid-request. Take the reserve from the engine's own profiling line, not from this page.
:::

## 7.3 bf16 versus int4

Weight-only int4 (4-bit weights with a scale per group of 128, embeddings kept in bf16, an estimate) shrinks the weights about 3×. Two things improve, by different amounts:

| Gemma 3 12B on one L40S | bf16 | int4 (est.) | Why |
| --- | ---: | ---: | --- |
| Weights | 23.53 GB (21.91 GiB) | 7.73 GB (7.20 GiB) | 16 → ~4.25 bits per body weight |
| Decode floor at batch 1 | 27.2 ms/token | 8.9 ms/token | \(23.53 / 864\) vs \(7.73 / 864\): weight bytes ÷ bandwidth |
| KV pool | 16.58 GiB | 31.29 GiB | Weights shrink; reserve and budget stay |
| Sequences at 4k (upper / window-aware) | 11 / 29 | 20 / 55 | KV is still bf16 |
| Sequences at 32k (upper / window-aware) | 1 / 7 | 2 / 13 | |

Latency at low load improves about 3× because decode reads weights; capacity improves only 1.89× (\(31.29 / 16.58\)) because the KV cache — what limits concurrency — did not shrink. Quantising the KV cache too (fp8 halves the 384 KiB to 192 KiB per token) is the next lever for capacity.

:::warn[Quantisation changes the outputs]
int4 is a different model. Evaluate it on your task before shipping; throughput numbers say nothing about answer quality. Google publishes quantisation-aware-trained int4 Gemma 3 checkpoints, which are trained to tolerate the precision loss and are the first ones to try.
:::

## 7.4 The roofline: why decode and prefill are different problems

**Arithmetic intensity** is FLOPs performed per byte moved from memory. A GPU can sustain at most

$$
\text{attainable FLOP/s} = \min\big(\text{peak},\; \text{BW} \times I\big),
\qquad
I_{\text{ridge}} = \frac{\text{peak}}{\text{BW}} = \frac{362 \times 10^{12}}{864 \times 10^{9}} \approx 419\ \text{FLOP/byte}.
$$

Below the ridge an operation is bandwidth-bound; above it, compute-bound. Apply it to Gemma 3 12B with $F$ = 21.5 GFLOP per token, $W$ = 23.53 GB and $k$ = 393,216 B per token of KV:

$$
I_{\text{decode}}(B) = \frac{B\,F}{W + B\,c\,k} \;\xrightarrow{B \to \infty}\; \frac{F}{c\,k},
\qquad
I_{\text{prefill}}(n) = \frac{n\,F}{W + n\,k}.
$$

Decode at $B$ = 1 does 21.5 GFLOP for 23.98 GB moved: under 1 FLOP per byte. Batching helps, but each added sequence brings its own KV reads, so at $c$ = 1,152 intensity can never exceed \(21.5\text{ GFLOP} / (1{,}152 \times 393{,}216\text{ B})\) = 47.5 — a ninth of the ridge. Prefill of $n$ tokens reads the weights once for all $n$, so its intensity grows almost linearly with $n$ and crosses the ridge near 460 tokens.

```python run
"""Roofline for Gemma 3 12B on an L40S: where prefill and decode sit."""
BW, PEAK = 864e9, 362e12
FLOP_TOK, KV_TOK = 21.5e9, 393_216
W = {"bf16": 23.53e9, "int4": 7.73e9}
RIDGE = PEAK / BW


def decode(b, ctx=1152, prec="bf16"):
    """One decode step for b sequences: FLOPs over bytes (weights once + every KV read)."""
    return b * FLOP_TOK, W[prec] + b * ctx * KV_TOK


def prefill(n, prec="bf16"):
    """One prompt of n tokens: weights read once, n tokens of KV written."""
    return n * FLOP_TOK, W[prec] + n * KV_TOK


OPS = [("decode B=1 bf16", decode(1)), ("decode B=1 int4", decode(1, prec="int4")),
       ("decode B=32 bf16", decode(32)), ("decode B=35 int4", decode(35, prec="int4")),
       ("decode B=512 bf16", decode(512)),
       ("prefill 256 bf16", prefill(256)), ("prefill 1024 bf16", prefill(1024)),
       ("prefill 4096 bf16", prefill(4096))]
print("ridge point: %.0f FLOP/byte" % RIDGE)
print("%-18s %9s %10s %10s %s" % ("operation", "FLOP/B", "TFLOPS", "time ms", "bound"))
for name, (flops, nbytes) in OPS:
    i = flops / nbytes
    t = max(flops / PEAK, nbytes / BW)
    print("%-18s %9.1f %10.1f %10.1f %s" % (name, i, min(PEAK, BW * i) / 1e12, t * 1e3,
                                            "compute" if i > RIDGE else "memory"))
print("decode ceiling as B grows (KV reads dominate): %.1f FLOP/byte"
      % (FLOP_TOK / (1152 * KV_TOK)))
print("batch that reaches the ridge with no KV reads: %.0f" % (RIDGE * W["bf16"] / FLOP_TOK))
print()
print("FLOP per byte, attainable TFLOPS")
for i in (1, 2, 4, 8, 16, 32, 64, 128, 256, 419, 512, 1024, 2048, 4096):
    print("%d, %.1f" % (i, min(PEAK, BW * i) / 1e12))
```

```output
ridge point: 419 FLOP/byte
operation             FLOP/B     TFLOPS    time ms bound
decode B=1 bf16          0.9        0.8       27.8 memory
decode B=1 int4          2.6        2.3        9.5 memory
decode B=32 bf16        18.1       15.6       44.0 memory
decode B=35 int4        31.9       27.6       27.3 memory
decode B=512 bf16       43.1       37.2      295.7 memory
prefill 256 bf16       232.9      201.2       27.4 memory
prefill 1024 bf16      919.9      362.0       60.8 compute
prefill 4096 bf16     3502.9      362.0      243.3 compute
decode ceiling as B grows (KV reads dominate): 47.5 FLOP/byte
batch that reaches the ridge with no KV reads: 459

FLOP per byte, attainable TFLOPS
1, 0.9
2, 1.7
4, 3.5
8, 6.9
16, 13.8
32, 27.6
64, 55.3
128, 110.6
256, 221.2
419, 362.0
512, 362.0
1024, 362.0
2048, 362.0
4096, 362.0
```

:::chart[L40S roofline with Gemma 3 12B operations — decode lives on the slope, long prefill on the flat]{type="line" x="arithmetic intensity (FLOP per byte)" y="attainable TFLOPS" xlog="true" ylog="true" xmin="0.5" marks="0.9:decode B=1;18.1:decode B=32;232.9:prefill 256;419:ridge;919.9:prefill 1024" points="false"}
FLOP per byte, attainable TFLOPS
1, 0.9
2, 1.7
4, 3.5
8, 6.9
16, 13.8
32, 27.6
64, 55.3
128, 110.6
256, 221.2
419, 362.0
512, 362.0
1024, 362.0
2048, 362.0
4096, 362.0
:::

Readings:

- **Decode uses a fraction of a percent of the tensor cores at batch 1** (0.8 of 362 TFLOPS) and about 4% at B = 32 (15.6 TFLOPS). Every decode optimisation — batching, quantisation, speculative decoding — is a way to do more useful FLOPs per byte read.
- **int4 moves decode along the slope, not off it.** Intensity triples at B = 1 (0.9 → 2.6) because the same FLOPs read a third of the bytes; it is still memory-bound, just 3× faster.
- **Long prefill is compute-bound; short prefill is not.** A 1,024-token prompt sits past the ridge at a 60.8 ms floor. A 256-token chunk is still on the slope and costs 27.4 ms — about one decode step. That is why engines fold prefill chunks into decode steps (chunked prefill, [chapter 6](/c/llm-serving/08-essential-techniques)): the chunk rides on weight reads the decode step pays for anyway.
- **The ch02 per-token chart is this roofline in time.** For a 1,024-token prompt at batch 1 the floor predicts a 60.8 ms first bar and a flat 27.8 ms tail — two operations on opposite sides of the ridge, not a warm-up artefact.

The model leaves out attention-score FLOPs (they grow with $n^2$ and matter at long context), the LM head, and kernel efficiency; it locates operations, it does not time them.

## 7.5 Model loading from first principles

Weights travel from where they are stored to GPU memory through a chain of links. If each hop finishes before the next starts, times add; if the loader streams, the slowest hop sets the pace:

$$
T_{\text{sequential}} = \sum_i \frac{\text{bytes}}{\text{BW}_i},
\qquad
T_{\text{streamed}} \approx \frac{\text{bytes}}{\min_i \text{BW}_i},
$$

plus engine initialisation (memory profiling, graph capture), which you measure rather than derive. The hop bandwidths below are illustrative round numbers: 1.25 GB/s for a 10 Gb/s path to an object store, 3.0 GB/s for local NVMe, 25 GB/s for host RAM to GPU over PCIe Gen4.

```python run
"""Cold start from first principles: bytes / bandwidth for each hop (bandwidths illustrative)."""
SIZES = {"Gemma 3 1B bf16": 2.00e9, "Gemma 3 12B int4": 7.73e9,
         "Gemma 3 12B bf16": 23.53e9, "Gemma 3 27B bf16": 54.02e9}
HOPS = {"object store": 1.25e9, "NVMe": 3.0e9, "PCIe to GPU": 25e9}   # bytes/s


def cold(size, start):
    """Seconds to reach GPU memory, starting at hop `start`; sequential vs streamed."""
    bws = list(HOPS.values())[list(HOPS).index(start):]
    return sum(size / bw for bw in bws), size / min(bws)


print("%-17s %14s %14s %14s %14s" % ("", "cold seq.", "cold streamed", "warm NVMe",
                                      "page cache"))
for m, size in SIZES.items():
    seq, streamed = cold(size, "object store")
    print("%-17s %13.1fs %13.1fs %13.1fs %13.1fs" % (m, seq, streamed,
                                                    cold(size, "NVMe")[0],
                                                    cold(size, "PCIe to GPU")[0]))
gb_per_s_needed = 23.53e9 / 10                    # load 12B bf16 within 10 s
print("to load 12B bf16 in 10 s the slowest hop must sustain %.2f GB/s" % (gb_per_s_needed / 1e9))
```

```output
                       cold seq.  cold streamed      warm NVMe     page cache
Gemma 3 1B bf16             2.3s           1.6s           0.7s           0.1s
Gemma 3 12B int4            9.1s           6.2s           2.9s           0.3s
Gemma 3 12B bf16           27.6s          18.8s           8.8s           0.9s
Gemma 3 27B bf16           63.4s          43.2s          20.2s           2.2s
to load 12B bf16 in 10 s the slowest hop must sustain 2.35 GB/s
```

:::example[Worked example · restarting the HelpDesk pod]
Gemma 3 12B bf16 is 23.53 GB. From an object store at 1.25 GB/s, landing it on NVMe at 3.0 GB/s and then copying it to the GPU at 25 GB/s takes \(18.8 + 7.8 + 0.9\) = 27.6 s; streaming the hops together cuts that to the object-store time, 18.8 s. If the weights are already on the node's NVMe, 8.8 s; in the page cache, 0.9 s. int4 divides every path by \(23.53 / 7.73\) ≈ 3.
:::

Practical consequences:

- **Cold start is an I/O budget.** To be serving within 10 s, every hop must sustain 2.35 GB/s for 12B bf16 — local NVMe can, a 10 Gb/s network path cannot. Pre-stage weights on the node image or a local cache before you autoscale on them.
- **Autoscaling must lead the load.** If traffic can double faster than load time plus engine warm-up, keep warm headroom; a replica that starts in 30 s does not help a spike that peaks in 10.
- **Check the log against the arithmetic.** `ch09` Phase 6 reads the engine's loading line (memory and seconds). Divide the bytes by your disk bandwidth: if the logged time is far larger, it went to initialisation or to an unexpected network fetch, not to the disk.

## 7.6 Which resource is the bottleneck?

The habit chapter 5 teaches, as a table. Match the symptom, confirm with the measurement, then pick a fix aimed at that resource:

| Symptom | Resource | Confirm with | Fixes that target it |
| --- | --- | --- | --- |
| TPOT near weight bytes ÷ bandwidth at low load (27 ms for 12B bf16) and slowly rising with batch | Memory bandwidth | TPOT versus concurrency sweep: flat at low B | Weight quantisation, speculative decoding, larger batches |
| TTFT rises in step with prompt length while the GPU is busy | Compute (prefill) | TTFT versus prompt length; slope near 59 µs per token at the floor | Prefix caching, chunked prefill, shorter prompts |
| Batch stops growing; requests wait or are preempted while TPOT is fine | Memory capacity (KV pool) | Engine log: KV-cache size, running versus waiting requests | int4 weights, fp8 KV, smaller `--max-model-len`, more GPUs |
| Adding GPUs with tensor parallelism makes it slower | Interconnect | `ch09` Phase 7 across instance types | Replicas instead of tensor parallelism on PCIe; NVLink instances |
| Slow cold starts and scale-ups | Storage or network I/O | Logged load seconds versus bytes ÷ disk bandwidth | Local NVMe, host-RAM staging, smaller weights |
| GPU utilisation low while a CPU core is pegged | Host and scheduler | Per-step timing, a Python profiler | Fewer process hops per token, async scheduling, a production engine |

The interconnect row is the repository's most instructive result. Chapter 9's distributed phase found tensor parallelism hurt on PCIe-only `g6e` instances and helped on NVLink `p4d` instances. Tensor parallelism needs an all-reduce in every layer; on an L40S node those all-reduces cross PCIe Gen4 at about 32 GB/s per direction, against 600 GB/s of NVLink on an A100 node (spec sheets). No number of extra GPUs fixes a slow link — the answer was a different instance type, or replicas.

The host row is visible in the repository too: the ch03 single-model service sends every streamed token through an `mp.Queue` round trip and a Python loop, and recomputes the whole prompt with `use_cache=False` ([walkthrough](/c/llm-serving/13-single-model-service)). On a small model, that overhead, not the GPU, sets the token rate.

## 7.7 Check yourself

:::qa[HelpDesk moves to 4k-token contexts on Gemma 3 12B bf16 and one L40S. How many sequences fit, on each KV bound?]
Pool: \(46{,}068\) MiB × 0.90 − 21.91 GiB − 2 GiB = 16.58 GiB. Upper bound: \(4{,}096 \times 384\) KiB = 1.5 GiB per sequence → 11. Window-aware: \(4{,}096 \times 64 + 1{,}024 \times 320\) KiB = 576 MiB → 29. The engine's startup log tells you which one you have.
:::

:::qa[int4 makes the weights about 3× smaller. Why does the number of 32k sequences only go from 7 to 13 (window-aware)?]
Only the weights shrank. The KV cache is still bf16 and the 40.49 GiB budget and 2 GiB reserve are unchanged, so the pool grows from 16.58 to 31.29 GiB, 1.89×. Concurrency is limited by the pool, not by the weights. Quantising the KV cache is what attacks it directly.
:::

:::qa[Is a 256-token prefill compute-bound on an L40S? What about 1,024 tokens?]
256 tokens: intensity \(256 \times 21.5\) GFLOP ÷ (23.53 GB + \(256 \times 393{,}216\) B) = 233 FLOP/byte, below the 419 ridge — bandwidth-bound, 27.4 ms, about one decode step. 1,024 tokens: 920 FLOP/byte, compute-bound, 60.8 ms at the floor.
:::

:::qa[Which two flags in the repository's vLLM commands encode the KV-cache calculation, and which term does each set?]
`--gpu-memory-utilization` sets $u$ in \(M_{\text{visible}} \cdot u - W - R\), the size of the pool. `--max-model-len` sets the largest context $c$ one sequence may reach, which fixes the worst-case per-sequence KV and therefore whether the engine can start and how many long sequences fit.
:::

:::qa[On g6e, tensor parallelism across L40S GPUs lowered throughput. Which resource was the bottleneck, and what would you try instead?]
The interconnect. Every layer's all-reduce crosses PCIe (about 32 GB/s per direction) instead of NVLink (600 GB/s), so communication eats the time the split saves. Run independent single-GPU replicas behind a load balancer, or quantise so the model fits one GPU; use tensor parallelism on NVLink instances.
:::

Next: [Chapter 6 — Essential techniques](/c/llm-serving/08-essential-techniques).
