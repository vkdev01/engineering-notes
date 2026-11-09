---
section: "11"
title: "Chapter 9 \u2014 In practice"
kicker: "Chapter notes"
abstract: "Chapter 9's seven phases run as a capacity plan for Gemma 3 12B on one L40S: a memory budget, workload arithmetic, a predicted baseline and int4 run from a closed-loop model, and the all-reduce arithmetic that decides when tensor parallelism helps."
time: "22 min"
order: 11
outcomes:
  - "Compute the KV pool and the sequence capacity of Gemma 3 12B on an L40S from nvidia-smi and the model config"
  - "Predict TPOT, TTFT and request throughput versus concurrency with a closed-loop model before running a benchmark"
  - "Estimate the all-reduce time per decode step for tensor parallelism on PCIe and on NVLink"
  - "Decide between replicas and tensor parallelism, and size a fleet for 10 req/s at the SLO"
---
A team wants to serve the HelpDesk assistant — 1,024-token prompts, 768 of them a shared system prompt, 256-token answers — on Gemma 3 12B, at a peak of 10 requests per second, with p99 TTFT ≤ 500 ms and mean TPOT ≤ 50 ms. They have L40S GPUs (AWS `g6e`). How many GPUs, in which configuration, and what should the first benchmark show? Chapter 9 of the repository answers questions like this with seven phases of measurement. This page runs the same seven phases *on paper first*, so that every benchmark you then launch has a predicted number to be checked against.

:::key[First principle]
Predict before you measure. Every phase produces a number the next phase can check: the memory budget bounds concurrency, the workload fixes the bytes and FLOPs per request, and a closed-loop model turns both into TTFT, TPOT and throughput. A benchmark that lands far from the prediction is telling you something — usually about the bottleneck you assumed.
:::

## 11.1 What the repository contains

`ch09/model_optimization_in_practice.ipynb` is structured in seven explicit phases. It is the chapter to copy wholesale.

| Phase | What it does |
| --- | --- |
| 0 | Install dependencies, define helpers: `start_vllm_serve`, `check_vllm_status`, `plot_vllm_bench_metrics` |
| 1 | Examine the GPU with `nvidia-smi` queries |
| 2 | Generate benchmark traffic — inspect the ShareGPT dataset, then a prefix-repetition dataset |
| 3 | Define the metrics |
| 4 | Start the vLLM server with the model under test |
| 5 | Benchmark the baseline |
| 6 | Benchmark a 4-bit (AWQ) version of the same model and compare |
| 7 | Benchmark distributed serving across GPU counts and instance types (`g6e`, `p4d`) |

The method is the asset: one server start per configuration, the identical `vllm bench serve` command against each, results appended to one file and plotted. The notebook uses a different open-weight model; this guide re-derives the numbers on Gemma 3 so they stay consistent with the rest of the course. Its one finding that does not depend on the model stays: **tensor parallelism made things worse on PCIe-only `g6e` instances and better on NVLink `p4d` instances.** §11.7 derives why.

## 11.2 Phase 1 — the memory budget

```bash
nvidia-smi --query-gpu=name,compute_cap,memory.free,memory.used,memory.total --format=csv
```

An L40S reports 46,068 MiB total. vLLM takes the share you allow with `--gpu-memory-utilization`, loads the weights, reserves room for activations and CUDA graphs, and turns the rest into the KV-cache pool:

$$
\text{KV pool} = u \cdot M_{\text{GPU}} - W - R,
\qquad
k = 2 \cdot L \cdot n_{kv} \cdot d_{\text{head}} \cdot 2\ \text{bytes}
$$

For Gemma 3 12B, $L = 48$, $n_{kv} = 8$, $d_{\text{head}} = 256$, so $k$ = 393,216 bytes (384 KiB) per token if every layer keeps every token. That is an **upper bound**: 40 of the 48 layers use a 1,024-token sliding window, so an allocator that exploits the window stores less. Compute both and let the server's startup log (the line reporting the KV-cache size in tokens) tell you which one your engine version uses.

```python run
GiB, MiB = 2**30, 2**20
total = 46_068 * MiB                     # nvidia-smi memory.total on one L40S
usable = 0.90 * total                    # --gpu-memory-utilization 0.90
reserve = 2 * GiB                        # activations + CUDA graphs (illustrative)
KV_TOK = 2 * 48 * 8 * 256 * 2            # K,V x layers x kv_heads x head_dim x bf16
KV_GLOBAL = 2 * 8 * 8 * 256 * 2          # the 8 global layers keep every token
KV_LOCAL = 2 * 40 * 8 * 256 * 2          # the 40 sliding-window layers keep 1,024
SEQ, PREFIX = 1280, 768                  # HelpDesk: 1,024 prompt + 256 output

full = SEQ * KV_TOK
window = SEQ * KV_GLOBAL + min(SEQ, 1024) * KV_LOCAL
print(f"usable {usable/GiB:.2f} GiB of {total/GiB:.2f} GiB")
print(f"KV per {SEQ}-token sequence: {full/MiB:.0f} MiB upper bound, "
      f"{window/MiB:.0f} MiB window-aware")
for name, w in (("bf16", 23.53e9), ("int4", 7.73e9)):
    pool = usable - w - reserve
    shared = (pool - PREFIX * KV_TOK) // ((SEQ - PREFIX) * KV_TOK)
    print(f"{name}: weights {w/GiB:5.2f} GiB, KV pool {pool/GiB:5.2f} GiB "
          f"= {pool/KV_TOK:7,.0f} tokens")
    print(f"      sequences: {int(pool // full):3d} upper bound, "
          f"{int(pool // window):3d} window-aware, {int(shared):3d} with prefix shared")
```

```output
usable 40.49 GiB of 44.99 GiB
KV per 1280-token sequence: 480 MiB upper bound, 400 MiB window-aware
bf16: weights 21.91 GiB, KV pool 16.58 GiB =  45,262 tokens
      sequences:  35 upper bound,  42 window-aware,  86 with prefix shared
int4: weights  7.20 GiB, KV pool 31.29 GiB =  85,443 tokens
      sequences:  66 upper bound,  80 window-aware, 165 with prefix shared
```

:::example[Worked example · what the budget already decides]
- **bf16 fits, barely.** 21.91 GiB of weights leaves 16.58 GiB of KV — 35 HelpDesk sequences at the upper bound. The 2 GiB reserve is illustrative; read the real one from the startup log.
- **The window helps less than it looks at this length.** A 1,280-token sequence is only 256 tokens past the 1,024-token window, so window awareness saves 80 MiB of 480 MiB (17%). It matters at 8k+ contexts, not here.
- **Prefix sharing helps more.** The 768-token system prompt is stored once (288 MiB) and each sequence then needs only 512 unique tokens (192 MiB): 86 sequences instead of 35.
- **int4 roughly doubles everything.** Weights drop to 7.20 GiB, the pool almost doubles to 31.29 GiB, and capacity reaches 165 sequences with sharing.
:::

## 11.3 Phase 2 — generate traffic, then read it

The notebook inspects its datasets before benchmarking with them. With this guide's model:

```bash
python3 inspect_dataset.py \
    --dataset-name sharegpt \
    --dataset-path ShareGPT_V3_unfiltered_cleaned_split.json \
    --model google/gemma-3-12b-it --num-prompts 100 --save-samples
```

Then it builds a second workload with controlled structure — a prefix-repetition dataset with `--prefix-repetition-prefix-len 256`, `--prefix-repetition-suffix-len 256`, `--prefix-repetition-num-prefixes 5`, `--prefix-repetition-output-len 128`. For HelpDesk, set the flags to the workload you are planning for: prefix 768, suffix 256, one prefix, output 256. ShareGPT is realistic mixed traffic; prefix repetition isolates cache behaviour. Benchmark only realistic traffic and you cannot tell a caching win from a lucky prompt mix.

Reading the workload means turning it into demand. At the 10 req/s peak:

$$
\begin{aligned}
\text{prompt tokens} &= 10 \times 1{,}024 = 10{,}240\ \text{tok/s} \quad (\text{only } 10 \times 256 = 2{,}560 \text{ new if the prefix is cached}) \\
\text{output tokens} &= 10 \times 256 = 2{,}560\ \text{tok/s} \\
\text{in flight} &= \lambda \cdot W \approx 10 \times (0.08 + 255 \times 0.050) \approx 128\ \text{sequences}
\end{aligned}
$$

The last line is Little's law with a request lifetime of TTFT plus 255 inter-token gaps at the 50 ms TPOT budget. 128 sequences at the prefix-shared rate is \(288 + 128 \times 192\) = 24,864 MiB of KV — more than one bf16 pool (16.58 GiB) holds. **Memory alone says at least two bf16 GPUs**, before any timing.

## 11.4 Phase 3 — four metrics, tied to the SLO

| Metric | What it protects you from | HelpDesk target |
| --- | --- | --- |
| Request throughput | Paying for idle GPUs | 10 req/s across the fleet |
| TTFT | A user staring at nothing | p99 ≤ 500 ms |
| TPOT | A user watching text crawl | mean ≤ 50 ms |
| p99 | An average that hides a tail | report p99 for both latencies |

Fix these before the first run. A metric chosen after seeing results will be the one that looks best.

## 11.5 Phases 4–5 — the predicted baseline

Start the server once per configuration (the model is gated on the Hub, so export your Hugging Face token in the environment first):

```bash
vllm serve google/gemma-3-12b-it \
    --gpu-memory-utilization 0.90 --max-model-len 4096 --enable-prefix-caching
```

Before benchmarking it, predict it. Three pieces, all from earlier chapters:

**A decode step reads every weight once and every live sequence's KV once.** At small batch it is bandwidth-bound; it becomes compute-bound only when $C$ approaches the ridge point (~419 FLOP/byte on an L40S):

$$
t_{\text{step}}(C) = \max\!\left(\frac{W + C\,\bar n\,k}{B_{\text{HBM}}},\; \frac{C\,F}{P \cdot \text{MFU}}\right)
$$

with $W$ weight bytes, $\bar n$ = 1,152 mean context during decode, $F$ = 21.5 GFLOP per token, $P$ = 362 TFLOPS and MFU = 0.5 (**illustrative** — prefill rarely reaches the spec-sheet peak; measure yours).

**A prefill of $p$ new tokens is compute-bound:** \(t_{\text{pf}} = p\,F / (P \cdot \text{MFU})\) — 122 ms for 1,024 tokens, 30 ms for the 256 new tokens when the prefix is cached.

**The closed loop ties them together.** With $C$ clients and no think time, throughput is $X = C / (\text{TTFT} + \text{TPOT}\,(n_{out} - 1))$. Prefills steal a share $\rho = X\,t_{\text{pf}}$ of GPU time from decoding, and a new request may wait behind other prefills (an M/D/1 queue):

$$
\text{TPOT} = \frac{t_{\text{step}}}{1-\rho},
\qquad
\text{TTFT} = t_{\text{pf}} + t_{\text{step}} + \frac{\rho\,t_{\text{pf}}}{2(1-\rho)}
$$

The model is deliberately simple and slightly pessimistic: chunked prefill can hide part of a prefill inside a bandwidth-bound decode step, so real TPOT under load should land at or below it. Solve it by fixed-point iteration and sweep $C$:

```python run
import math

BW, PEAK, MFU = 864e9, 362e12, 0.5      # L40S spec; MFU is illustrative
FLOP_TOK = 21.5e9                        # forward FLOPs per token, Gemma 3 12B
KV_TOK, CTX, OUT = 393_216, 1152, 256    # bytes/token (upper bound), mean decode context
CONFIGS = {  # name: (weight bytes, new prompt tokens to prefill, max sequences in KV pool)
    "bf16 no cache": (23.53e9, 1024, 35),
    "bf16 + prefix cache": (23.53e9, 256, 86),
    "int4 + prefix cache": (7.73e9, 256, 165),
}

def predict(C, w, p_new):
    """Closed loop, C clients, no think time. Returns TTFT s, TPOT s, req/s."""
    step = max((w + C * CTX * KV_TOK) / BW, C * FLOP_TOK / (PEAK * MFU))
    t_pf = p_new * FLOP_TOK / (PEAK * MFU)           # prefill of one request
    X = 0.0
    for _ in range(200):                             # fixed point on throughput
        rho = min(X * t_pf, 0.95)                    # share of time spent prefilling
        tpot = step / (1 - rho)
        ttft = t_pf + step + rho * t_pf / (2 * (1 - rho))   # M/D/1 wait for prefill
        X = C / (ttft + tpot * (OUT - 1))            # Little's law
    return ttft, tpot, X

print(f"decode floor bf16 {23.53e9/BW*1e3:.1f} ms, int4 {7.73e9/BW*1e3:.1f} ms; "
      f"prefill 1,024 tok {1024*FLOP_TOK/(PEAK*MFU)*1e3:.0f} ms, 256 tok "
      f"{256*FLOP_TOK/(PEAK*MFU)*1e3:.0f} ms")
print("C, " + ", ".join(CONFIGS))                    # chart data: TPOT in ms
for C in (1, 2, 4, 8, 16, 24, 32, 48, 64, 86, 96, 128, 165):
    print(f"{C}, " + ", ".join(f"{predict(C, w, p)[1]*1e3:.1f}" if C <= cap else "-"
                               for w, p, cap in CONFIGS.values()))
print("\nconfig               C*  TTFT ms  TPOT ms  req/s/GPU  GPUs raw  GPUs@80%  $/h")
for name, (w, p, cap) in CONFIGS.items():
    C = max(c for c in range(1, cap + 1)
            if predict(c, w, p)[1] <= 0.050 and predict(c, w, p)[0] <= 0.5)
    ttft, tpot, X = predict(C, w, p)
    raw, planned = math.ceil(10 / X), math.ceil(10 / (0.8 * X))
    print(f"{name:20s} {C:3d} {ttft*1e3:8.0f} {tpot*1e3:8.1f} {X:10.2f} "
          f"{raw:9d} {planned:9d} {planned*2.00:6.2f}")
```

```output
decode floor bf16 27.2 ms, int4 8.9 ms; prefill 1,024 tok 122 ms, 256 tok 30 ms
C, bf16 no cache, bf16 + prefix cache, int4 + prefix cache
1, 28.2, 27.9, 9.6
2, 29.2, 28.5, 10.2
4, 31.2, 29.8, 11.5
8, 35.2, 32.4, 14.1
16, 43.1, 37.5, 19.2
24, 51.1, 42.7, 24.4
32, 59.1, 47.8, 29.5
48, -, 58.1, 39.8
64, -, 68.4, 50.1
86, -, 82.5, 64.2
96, -, -, 70.7
128, -, -, 91.2
165, -, -, 115.0

config               C*  TTFT ms  TPOT ms  req/s/GPU  GPUs raw  GPUs@80%  $/h
bf16 no cache         22      177     49.1       1.73         6         8  16.00
bf16 + prefix cache   35       77     49.7       2.74         4         5  10.00
int4 + prefix cache   63       75     49.4       4.97         3         3   6.00
```

:::chart[Predicted TPOT vs concurrency, Gemma 3 12B on one L40S (model, not measurement)]{type="line" x="concurrent clients C" y="mean TPOT" unit=" ms" hmarks="50:TPOT SLO" note="Closed-loop model above; MFU 0.5 illustrative; KV at the all-layers upper bound. Each line stops where the KV pool is full."}
C, bf16 no cache, bf16 + prefix cache, int4 + prefix cache
1, 28.2, 27.9, 9.6
2, 29.2, 28.5, 10.2
4, 31.2, 29.8, 11.5
8, 35.2, 32.4, 14.1
16, 43.1, 37.5, 19.2
24, 51.1, 42.7, 24.4
32, 59.1, 47.8, 29.5
48, -, 58.1, 39.8
64, -, 68.4, 50.1
86, -, 82.5, 64.2
96, -, -, 70.7
128, -, -, 91.2
165, -, -, 115.0
:::

How to read the prediction:

- **At $C = 1$ every line sits on its decode floor** — 27.2 ms for bf16 (23.53 GB ÷ 864 GB/s), 8.9 ms for int4. The first benchmark at concurrency 1 should land within a few ms of these; if it is 2× off, something other than bandwidth is the bottleneck (a missing CUDA graph, an eager-mode fallback, a wrong dtype).
- **Each extra client adds its KV read** — about \(1{,}152 \times 393{,}216 / 864\text{e}9\) = 0.52 ms per step — plus its share of prefill. Without the prefix cache, every request costs a 122 ms prefill, which inflates TPOT fast: the 50 ms budget is crossed at $C$ = 22.
- **The prefix cache is worth 58% more throughput** (1.73 → 2.74 req/s per GPU), purely because 768 of 1,024 prompt tokens stop being recomputed. On this workload it is the cheapest optimisation on the page.
- **TTFT is not the binding constraint here** — 77 ms predicted at the operating point against a 500 ms p99 budget. TPOT binds. That tells you which number the baseline benchmark must confirm.

:::warn[The prediction is a hypothesis, not a result]
MFU 0.5 and the 2 GiB reserve are assumptions; KV traffic is taken at the upper bound; the M/D/1 term ignores bursty arrivals. Run phase 5 at $C$ = 1, 8, 32 and compare. Agreement within ~15% means the bandwidth model is right and you can plan with it; a large gap means find out why before scaling anything.
:::

## 11.6 Phase 6 — one change: int4

The notebook stops the server, starts a 4-bit (AWQ) version of the same model, and re-runs the identical command. Predict it first. Weight-only int4 (group size 128, embeddings left in bf16) shrinks the weights from 23.53 GB to 7.73 GB, so:

- the decode floor falls to \(7.73\text{e}9 / 864\text{e}9\) = 8.9 ms, 3.0× lower;
- the KV pool grows from 16.58 to 31.29 GiB, so the line runs to 165 sequences;
- prefill does not get faster — weight-only quantisation saves bytes, not FLOPs, and the kernels dequantise on the fly.

The model predicts the SLO-bound operating point moves from $C$ = 35 to $C$ = 63 and throughput from 2.74 to 4.97 req/s per GPU, 1.8×. That ratio is smaller than the 3.0× floor ratio because KV reads and prefill do not shrink. If your measured ratio is near 3×, your benchmark is running at low concurrency, where the weights dominate. Quality is the other half: re-run the task evaluation on the int4 checkpoint before shipping it (Google also publishes quantisation-aware-trained int4 Gemma 3 checkpoints, which are the first ones to try).

## 11.7 Phase 7 — tensor parallelism and the all-reduce

Gemma 3 27B in bf16 is 54.02 GB of weights — more than one L40S holds — so the 27B forces the question chapter 9's last phase asks: split the model across GPUs?

Tensor parallelism (TP) shards each weight matrix across $N$ GPUs. Each GPU streams only $1/N$ of the weights per step, which cuts decode time — but after the attention block and after the MLP block of every layer, the partial results must be summed across GPUs with an **all-reduce**. Per decode step:

$$
S_{\text{call}} = d_{\text{model}} \times 2\ \text{bytes} \times B,
\qquad
\text{calls} = 2L,
\qquad
t_{\text{ring}}(N) = 2(N-1)\left(\alpha + \frac{S_{\text{call}}}{N\,\beta}\right)
$$

$\beta$ is the link bandwidth (~32 GB/s per direction on PCIe Gen4 x16, 600 GB/s NVLink on `p4d`), and $\alpha$ is the fixed cost of one ring hop — kernel launch, synchronisation, and on PCIe without peer-to-peer, a trip through host memory. $\alpha$ is the number nobody publishes for your machine: this guide uses **25 µs per hop on PCIe and 3 µs on NVLink, both illustrative**. Measure yours with `all_reduce_perf` from nccl-tests at small message sizes.

```python run
L, HID, KV_TOK, CTX, B = 62, 5376, 507_904, 1152, 16   # Gemma 3 27B, batch of 16
GPUS = {  # name: (HBM bytes/s, usable bytes, link bytes/s, per-hop latency s)
    "L40S PCIe": (864e9, 0.9 * 46_068 * 2**20, 32e9, 25e-6),     # latency illustrative
    "A100 NVLink": (1555e9, 0.9 * 40_960 * 2**20, 600e9, 3e-6),  # latency illustrative
}
WEIGHTS = {"bf16": 54.02e9, "int4": 16.42e9}

def allreduce(n, nbytes, link, alpha):
    """Ring all-reduce: 2(n-1) hops, each moves nbytes/n and pays alpha."""
    return 0.0 if n == 1 else 2 * (n - 1) * (alpha + nbytes / n / link)

def tpot(n, w, gpu):
    bw, usable, link, alpha = GPUS[gpu]
    kv = B * CTX * KV_TOK
    if w / n + kv / n + 2 * 2**30 > usable:
        return None                                   # does not fit
    mem = (w + kv) / n / bw                           # every GPU streams its shard
    comm = 2 * L * allreduce(n, HID * 2 * B, link, alpha)   # 2 all-reduces per layer
    return mem, comm

nb = HID * 2 * B
print(f"per all-reduce {nb/1e3:.0f} kB, {2*L} calls/step = {2*L*nb/1e6:.1f} MB/step")
for gpu in GPUS:
    bw, usable, link, alpha = GPUS[gpu]
    print(f"{gpu}: one all-reduce at TP=4 = {allreduce(4, nb, link, alpha)*1e6:.1f} us "
          f"(latency part {6*alpha*1e6:.0f} us)")
print("TP, " + ", ".join(f"{g} {q}" for g in GPUS for q in WEIGHTS))
for n in (1, 2, 4, 8):
    cells = []
    for g in GPUS:
        for q, w in WEIGHTS.items():
            r = tpot(n, w, g)
            cells.append("-" if r is None else f"{sum(r)*1e3:.1f}")
    print(f"{n}, " + ", ".join(cells))
print()
for g in GPUS:
    for n in (2, 4, 8):
        mem, comm = tpot(n, WEIGHTS["int4"], g)
        print(f"{g} int4 TP={n}: weights+KV {mem*1e3:5.1f} ms + all-reduce {comm*1e3:5.1f} ms")
```

```output
per all-reduce 172 kB, 124 calls/step = 21.3 MB/step
L40S PCIe: one all-reduce at TP=4 = 158.1 us (latency part 150 us)
A100 NVLink: one all-reduce at TP=4 = 18.4 us (latency part 18 us)
TP, L40S PCIe bf16, L40S PCIe int4, A100 NVLink bf16, A100 NVLink int4
1, -, 29.8, -, 16.6
2, 43.5, 21.8, 21.2, 9.1
4, 37.9, 27.1, 12.5, 6.4
8, 53.7, 48.3, 10.4, 7.3

L40S PCIe int4 TP=2: weights+KV  14.9 ms + all-reduce   6.9 ms
L40S PCIe int4 TP=4: weights+KV   7.5 ms + all-reduce  19.6 ms
L40S PCIe int4 TP=8: weights+KV   3.7 ms + all-reduce  44.6 ms
A100 NVLink int4 TP=2: weights+KV   8.3 ms + all-reduce   0.8 ms
A100 NVLink int4 TP=4: weights+KV   4.1 ms + all-reduce   2.3 ms
A100 NVLink int4 TP=8: weights+KV   2.1 ms + all-reduce   5.3 ms
```

:::chart[Predicted TPOT vs tensor-parallel degree, Gemma 3 27B at batch 16]{type="line" x="tensor-parallel degree N" y="TPOT" unit=" ms" xlog="true" points="true" dash="A100 NVLink bf16,A100 NVLink int4" note="Model above. Per-hop latency 25 us (PCIe) and 3 us (NVLink) are illustrative. bf16 does not fit on one GPU of either type."}
TP, L40S PCIe bf16, L40S PCIe int4, A100 NVLink bf16, A100 NVLink int4
1, -, 29.8, -, 16.6
2, 43.5, 21.8, 21.2, 9.1
4, 37.9, 27.1, 12.5, 6.4
8, 53.7, 48.3, 10.4, 7.3
:::

:::example[Worked example · why PCIe TP backfires on a quantised model]
At batch 16 one all-reduce moves only \(5{,}376 \times 2 \times 16\) = 172 kB. On PCIe at TP = 4 the six ring hops spend 6 × 25 = 150 µs waiting and \(6 \times 172\text{e}3 / 4 / 32\text{e}9\) = 8.1 µs moving data. **The all-reduce is latency-bound, not bandwidth-bound**, and 124 of them per step cost 19.6 ms.

TP divides the weight-streaming time by $N$ but multiplies the hop count by $2(N-1)$. For int4 27B on PCIe the weight time is already small (29.8 ms at $N$ = 1), so TP = 2 helps (21.8 ms), TP = 4 is worse than TP = 2 (27.1 ms), and TP = 8 is worse than one GPU (48.3 ms). On NVLink the per-hop cost is 8× smaller and the curve keeps falling to TP = 4. That is the shape of chapter 9's finding — TP hurt on `g6e`, helped on `p4d` — and it comes from $\alpha$, not from bandwidth.
:::

The repository's notebook states the consequence plainly: *"Overall throughput will be lower, since 1 gpu x 4 > 4 gpu, so we are trading off throughput for latency in this case."* Check it on the 12B, where both options fit — four independent replicas versus one TP = 4 group on the same four L40S (PCIe, same illustrative $\alpha$, prefix cache on; prefill now pays all-reduces too):

```python run
BW, PEAK, MFU, LINK, ALPHA = 864e9, 362e12, 0.5, 32e9, 25e-6   # MFU, ALPHA illustrative
L, HID, FLOP_TOK, W = 48, 3840, 21.5e9, 23.53e9                 # Gemma 3 12B bf16
KV_TOK, CTX, OUT, P_NEW = 393_216, 1152, 256, 256               # HelpDesk, prefix cached

def ar(n, nbytes):                                   # ring all-reduce time
    return 0.0 if n == 1 else 2 * (n - 1) * (ALPHA + nbytes / n / LINK)

def predict(C, n):
    """n-way tensor-parallel replica, C clients: TTFT s, TPOT s, req/s."""
    step = max((W + C * CTX * KV_TOK) / n / BW, C * FLOP_TOK / (n * PEAK * MFU))
    step += 2 * L * ar(n, HID * 2 * C)
    t_pf = P_NEW * FLOP_TOK / (n * PEAK * MFU) + 2 * L * ar(n, HID * 2 * P_NEW)
    X = 0.0
    for _ in range(200):
        rho = min(X * t_pf, 0.95)
        tpot = step / (1 - rho)
        ttft = t_pf + step + rho * t_pf / (2 * (1 - rho))
        X = C / (ttft + tpot * (OUT - 1))
    return ttft, tpot, X

def kv_cap(n):                                       # sequences, prefix shared once
    pool = n * (0.9 * 46_068 * 2**20 - W / n - 2 * 2**30)
    return int((pool - 768 * KV_TOK) // (512 * KV_TOK))

for n in (1, 4):
    t1 = predict(1, n)
    C = max(c for c in range(1, kv_cap(n) + 1)
            if predict(c, n)[1] <= 0.050 and predict(c, n)[0] <= 0.5)
    ttft, tpot, X = predict(C, n)
    print(f"TP={n}: one user TTFT {t1[0]*1e3:3.0f} ms, TPOT {t1[1]*1e3:4.1f} ms | "
          f"KV cap {kv_cap(n)} seqs")
    print(f"      at SLO: C*={C}, TPOT {tpot*1e3:4.1f} ms -> {X:5.2f} req/s")
    if n == 1:
        print(f"      4 replicas of TP=1 -> {4 * X:5.2f} req/s on 4 GPUs")
```

```output
TP=1: one user TTFT  58 ms, TPOT 27.9 ms | KV cap 86 seqs
      at SLO: C*=35, TPOT 49.7 ms ->  2.74 req/s
      4 replicas of TP=1 -> 10.97 req/s on 4 GPUs
TP=4: one user TTFT  52 ms, TPOT 21.5 ms | KV cap 702 seqs
      at SLO: C*=100, TPOT 49.8 ms ->  7.83 req/s
```

Four replicas serve 10.97 req/s at the SLO; one TP = 4 group serves 7.83 req/s on the same hardware — 29% less. TP buys a lone user 6.4 ms off TPOT (27.9 → 21.5 ms) and a much larger KV pool (702 sequences), and pays for it with 96 all-reduces per step. **Replicas maximise throughput; TP minimises latency and lets a model too big for one GPU run at all.**

| Situation | Choose | Why |
| --- | --- | --- |
| Model fits one GPU with room for KV, throughput is the goal | Replicas | No all-reduce; capacity scales linearly with GPUs |
| Model does not fit one GPU (27B bf16 on L40S) | Smallest TP that fits, or quantise to fit one GPU | Each extra TP degree adds $2(N-1)$ hops per all-reduce |
| Strict per-user TPOT below the single-GPU floor | TP on NVLink | On PCIe the hop latency eats the gain beyond TP = 2 |
| Very long contexts that overflow one KV pool | TP or pipeline parallelism | KV capacity scales with $N$ |

## 11.8 The capacity plan

Put the phases together for the original question — HelpDesk at 10 req/s peak, p99 TTFT ≤ 500 ms, mean TPOT ≤ 50 ms. Per-GPU capacity comes from the closed-loop model in §11.5; the fleet is sized to run at **80% of that capacity** (illustrative headroom for Poisson bursts and the p99 tail, which a mean-value model does not see). Prices are the course's illustrative $2.00 per L40S-hour.

| Configuration | Per-GPU req/s at SLO (predicted) | L40S raw | L40S at 80% | Cost / hour | Cost / 1,000 requests at peak |
| --- | ---: | ---: | ---: | ---: | ---: |
| bf16, no prefix cache | 1.73 | 6 | 8 | $16.00 | $0.44 |
| bf16, prefix cache | 2.74 | 4 | 5 | $10.00 | $0.28 |
| int4, prefix cache | 4.97 | 3 | 3 | $6.00 | $0.17 |
| bf16, TP = 4 groups, prefix cache | 7.83 per group | 8 | 8 | $16.00 | $0.44 |

Cost per 1,000 requests is hourly cost ÷ 36 (36,000 requests per hour at 10 req/s). The plan: **start with 5 × bf16 replicas with prefix caching**, and run the int4 evaluation in parallel — if quality holds, 3 GPUs serve the same peak. Do not deploy TP for a model that fits one L40S. Then run phases 5 and 6 and replace every "predicted" in this table with a measured number.

:::warn[What the plan does not cover]
Agent traffic (8 sequential calls per task with growing prompts) changes the prefill share completely; re-run §11.5 with its token counts. Peak-to-mean ratio, failover headroom (N+1) and autoscaling lag are fleet decisions on top of this per-GPU arithmetic.
:::

## 11.9 Check yourself

:::qa[The startup log reports a KV cache of 54,000 tokens for bf16 12B at utilisation 0.90. What does that tell you?]
More than the 45,262-token upper bound computed in §11.2, so either the activation reserve is smaller than the 2 GiB assumed (each GiB is 2,731 tokens at 384 KiB) or the allocator stores sliding-window layers more compactly. Use the logged number in the capacity plan, not the computed bound.
:::

:::qa[Phase 5 at concurrency 1 measures TPOT 45 ms for bf16 12B. The model said 27.9 ms. What do you check?]
The floor is pure arithmetic — 23.53 GB ÷ 864 GB/s — so a 60% gap means the decode step is not bandwidth-bound: check the server is not in eager mode (CUDA graphs disabled), that the dtype is bf16 rather than fp32, that nothing else holds the GPU, and the clocks under `nvidia-smi -q -d CLOCK`. Do not move on to phase 6 until the baseline is explained.
:::

:::qa[Why does int4 improve throughput at the SLO by 1.8× when it cuts the decode floor by 3.0×?]
Only the weight term shrinks. At $C$ = 63, KV reads alone cost \(63 \times 0.52\) ≈ 33 ms per step against 8.9 ms of weights, and part of every second goes to prefill — neither changes with weight-only quantisation. The bigger KV pool lets int4 run at higher concurrency, which is where the 1.8× comes from.
:::

:::qa[On PCIe, what would make TP = 4 beat TP = 2 for the 27B int4?]
A smaller per-hop latency $\alpha$ (peer-to-peer enabled, a PCIe switch instead of the host bridge) or a larger weight term (bf16 instead of int4, where TP = 4 does beat TP = 2: 37.9 vs 43.5 ms). The all-reduce cost per step is about 124 × 2(N−1) × α; TP pays only when the weight time it removes exceeds that.
:::

:::qa[You need 10 req/s and have exactly 4 L40S. Which configuration?]
bf16 replicas give 4 × 2.74 = 10.97 req/s predicted — at the edge, with no headroom for bursts. int4 replicas give about 19.9 req/s on the same four GPUs (3 would do). If int4 quality is acceptable, use it; otherwise four bf16 replicas, and plan for p99 violations at peak.
:::

Next: [Chapter 10 — Advancements](/c/llm-serving/12-advancements).
