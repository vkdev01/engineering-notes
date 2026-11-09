---
section: "5"
title: "Chapter 3 \u2014 System design"
kicker: "Chapter notes"
abstract: "The two ch03 services read as designs, then batching from first principles: a decode-step time model for Gemma 3 12B on an L40S, why a static batch of four blocks the queue, what continuous batching buys, and what an LRU miss costs when the models are LLM-sized."
time: "22 min"
order: 5
outcomes:
  - "Compute decode step time and tokens per second as a function of batch size from weight bytes, KV bytes and bandwidth"
  - "Pick a batch size from the TPOT SLO and the KV pool, and say which one binds"
  - "Quantify head-of-line blocking in a static batch and the capacity continuous batching recovers"
  - "Size the miss penalty of an LRU model cache from bytes divided by load bandwidth"
---
**Covers:** building online single-model and multi-model serving services from scratch, batching and streaming, NVIDIA Triton, cost- versus latency-optimised designs.

The HelpDesk assistant runs Gemma 3 12B in bf16 on one L40S: prompts of 1,024 tokens, answers of 256, a 50 ms TPOT target and a 500 ms p99 TTFT target (all illustrative, reused across this guide). The chapter 3 service would serve it with a fixed batch of four. How many requests per second does that sustain, and what would a different scheduler buy? Every answer below comes from three numbers: the bytes the GPU must read per decode step, its memory bandwidth, and how the scheduler fills the batch.

:::key[First principle]
A decode step reads every weight once no matter how many sequences are in the batch, so adding a sequence costs only its own KV reads. Batching is nearly free throughput until KV reads or the TPOT target stop it — and the scheduler's job is to keep the batch full without making short requests wait for long ones.
:::

## 5.1 What is in the repository

The heart of the repository: two runnable services and a Triton example.

```
ch03/single_model_llm_serving/     FastAPI on :8000, facebook/opt-125m
  main.py                          4 endpoints
  llm/llm.py                       LLMEngine: orchestration + vLLM path
  llm/workload_manager.py          queues, batching, sequence state
  llm/model_executor.py            multiprocessing queues, one worker process
  llm/model_worker.py              the actual forward passes
  llm/model_manager.py             model + tokenizer loading
  tests/                           test_api.py, test_vllm.py, test_stream.sh

ch03/multi_model_serving/          FastAPI on :8001, up to 2 models
  app/server.py                    /predict, /models
  app/store.py                     model metadata from config/models.json
  app/manager.py                   LRU cache over workers
  app/engine.py                    worker factory by framework
  app/worker.py                    ModelWorker ABC + 3 implementations
  model_dir/densenet_onnx/         Triton model repository + config.pbtxt
```

Two walkthroughs — [single-model](/c/llm-serving/13-single-model-service) and [multi-model](/c/llm-serving/14-multi-model-service) — read these file by file. This page reads them as designs, then derives the numbers the code leaves implicit, on the HelpDesk workload instead of the demo's `facebook/opt-125m`.

## 5.2 The single-model architecture

The request path has four hops, and each exists for a reason you can name:

:::mermaid[Single-model service: the request path]
flowchart LR
    A[POST /generate] --> B[LLMEngine.generate]
    B --> C[WorkloadManager<br/>queue + batch of 4]
    C --> D[ModelExecutor<br/>mp.Queue]
    D --> E[ModelWorker<br/>separate process]
    E --> D
    D --> C
    C --> B
    B --> A
:::

| Hop | File | Why it exists |
| --- | --- | --- |
| API layer | `main.py` | Four endpoints: `/basic_generate` (no queue), `/generate` (batched), `/generate_stream` (server-sent events), `/generate_vllm` (the vLLM path) |
| Orchestration | `llm/llm.py` | `LLMEngine` owns the workload manager and executor; a background thread runs `requests_processing_loop` and pushes tokens to per-client queues |
| Queueing and batching | `llm/workload_manager.py` | Separate streaming and batch queues, `batch_size = 4`, and a `Sequence` holding prompt, output, token count and the client's queue |
| Process isolation | `llm/model_executor.py`, `llm/model_worker.py` | One `mp.Process` runs the model; `task_queue` and `result_queue` carry `(prompts, is_streaming)` in and results out |

Two batching behaviours live in this code, and the rest of the page is about the difference. The `/generate` path hands the whole batch to `model.generate(..., max_new_tokens=50)`: nothing joins or leaves until the call returns, so it is a **static batch**. The streaming loop calls `get_next_batch()` on every iteration, which tops the active list back up to four — admission at every step, the seed of **continuous batching** — but it is capped at four and, with `use_cache=False`, recomputes the whole prompt every step.

## 5.3 The multi-model architecture

The same split, with a cache instead of a queue:

:::mermaid[Multi-model service: the residency decision]
flowchart LR
    A[POST /predict] --> B[ModelManager.get_model_worker]
    B --> C{in cache?}
    C -- yes --> D[move_to_end<br/>return worker]
    C -- no --> E{two models resident?}
    E -- yes --> F[popitem oldest<br/>delete_worker]
    E -- no --> G[ModelEngine.create_worker]
    F --> G
    G --> H[TransformerWorker<br/>TorchVisionWorker<br/>TritonWorker]
:::

`ModelStore` reads `config/models.json`: two text classifiers (`distilbert-base-uncased-finetuned-sst-2-english`, `mrm8488/bert-tiny-finetuned-sms-spam-detection`), a `pytorch/vision:mobilenet_v2` image classifier and a `densenet_onnx` model served through Triton. `ModelManager` keeps an `OrderedDict` of workers capped at two and evicts the least recently used; `ModelEngine` picks the worker class from the metadata's `framework` field. The Triton example is the industrial version of the same idea: `model_dir/densenet_onnx/config.pbtxt` declares inputs and outputs, and `--model-control-mode=explicit` makes models load on request instead of at boot.

## 5.4 What one decode step costs

Each decode step streams every weight from GPU memory once, plus the KV cache of every sequence in the batch, and does about two FLOPs per parameter per sequence. Whichever of memory time and compute time is longer sets the step:

$$
t(B) \approx \max\!\left(\frac{W + B\,c\,k}{\text{BW}},\; \frac{B\,F}{\text{peak}}\right),
\qquad
\text{tokens/s} = \frac{B}{t(B)}
$$

with $W$ the weight bytes, $c$ the context per sequence, $k$ the KV bytes per token, $F$ the FLOPs per token, BW the memory bandwidth and peak the tensor throughput. For Gemma 3 12B bf16 on an L40S: $W$ = 23.53 GB, $k$ = 393,216 B (every layer keeps every token — the upper bound), $F$ = 21.5 GFLOP, BW = 864 GB/s, peak = 362 TFLOPS (spec sheet). Use $c$ = 1,152: the 1,024-token prompt plus half of the 256-token answer, the average context mid-decode.

:::example[Worked example · one sequence versus thirty-two]
**B = 1.** KV read \(1{,}152 \times 393{,}216\) B = 0.453 GB. Memory time \((23.53 + 0.453)\) GB ÷ 864 GB/s = 27.8 ms; compute time 21.5 GFLOP ÷ 362 TFLOPS = 0.06 ms. Memory-bound by more than 400×: 36 tokens/s.

**B = 32.** KV read \(32 \times 0.453\) = 14.5 GB. Memory time \((23.53 + 14.5) / 864\) = 44.0 ms; compute 1.90 ms. Still memory-bound: \(32 / 0.044\) = 727 tokens/s.

Thirty-two times the work for 58% more time: the weights were already being read.
:::

The window-aware KV bound is a little lower: Gemma 3's 40 local layers keep only the last 1,024 tokens, so at $c$ = 1,152 a sequence holds \(64 \times 1{,}152 + 320 \times 1{,}024\) KiB = 392 MiB instead of 432 MiB, about 9% less. The upper bound is used below; read your engine's KV-cache size line at startup to see which one it allocates ([chapter 5](/c/llm-serving/07-challenges) derives both).

```python run
"""Decode step time vs batch size: Gemma 3 12B bf16 on one L40S (spec-sheet rates)."""
GiB, MiB = 2**30, 2**20
W = 23.53e9            # bf16 weight bytes read every decode step
FLOP_TOK = 21.5e9      # forward FLOPs per token (2 x non-embedding params)
KV_TOK = 393_216       # bf16 KV bytes per token, all layers full (upper bound)
BW, PEAK = 864e9, 362e12
CTX = 1024 + 128       # HelpDesk mid-decode context: prompt + half the output


def step(b, ctx=CTX):
    """Seconds per decode step for b sequences: max(memory time, compute time)."""
    mem = (W + b * ctx * KV_TOK) / BW
    comp = b * FLOP_TOK / PEAK
    return max(mem, comp), mem, comp


print("%5s %9s %9s %9s %10s %9s" % ("B", "step ms", "mem ms", "comp ms", "tok/s", "FLOP/B"))
for b in (1, 2, 4, 8, 16, 32, 48, 64, 96, 128):
    t, mem, comp = step(b)
    inten = b * FLOP_TOK / (W + b * CTX * KV_TOK)
    print("%5d %9.1f %9.1f %9.2f %10.0f %9.1f" % (b, t * 1e3, mem * 1e3, comp * 1e3, b / t, inten))

b_slo = max(b for b in range(1, 512) if step(b)[0] <= 0.050)
pool = 46_068 * MiB * 0.90 - W - 2 * GiB
b_mem = int(pool // (1280 * KV_TOK))   # each sequence must reserve prompt + full output
print("asymptote (KV reads only): %.0f tok/s" % (BW / (CTX * KV_TOK)))
print("largest B with step <= 50 ms: %d (%.0f tok/s)" % (b_slo, b_slo / step(b_slo)[0]))
print("KV pool %.2f GiB -> at most %d sequences of 1,280 tokens (upper bound)" % (pool / GiB, b_mem))
print("at B=%d: step %.1f ms, %.0f tok/s" % (b_mem, step(b_mem)[0] * 1e3, b_mem / step(b_mem)[0]))
```

```output
    B   step ms    mem ms   comp ms      tok/s    FLOP/B
    1      27.8      27.8      0.06         36       0.9
    2      28.3      28.3      0.12         71       1.8
    4      29.3      29.3      0.24        136       3.4
    8      31.4      31.4      0.48        255       6.3
   16      35.6      35.6      0.95        449      11.2
   32      44.0      44.0      1.90        727      18.1
   48      52.4      52.4      2.85        916      22.8
   64      60.8      60.8      3.80       1053      26.2
   96      77.6      77.6      5.70       1238      30.8
  128      94.3      94.3      7.60       1357      33.8
asymptote (KV reads only): 1907 tok/s
largest B with step <= 50 ms: 43 (864 tok/s)
KV pool 16.58 GiB -> at most 35 sequences of 1,280 tokens (upper bound)
at B=35: step 45.6 ms, 768 tok/s
```

:::chart[Decode throughput vs batch size — Gemma 3 12B bf16, one L40S, floor model]{type="line" x="sequences in the batch (B)" y="output tokens per second" marks="35:KV pool full;43:TPOT 50 ms" note="Spec-sheet bandwidth, KV upper bound, context 1,152 tokens. Real kernels land below this floor."}
B, tokens/s
1, 36
2, 71
4, 136
8, 255
16, 449
32, 727
35, 768
48, 916
64, 1053
96, 1238
128, 1357
:::

:::chart[Decode step time (TPOT) vs batch size — the weights are a fixed toll]{type="line" x="sequences in the batch (B)" y="step time" unit=" ms" hmarks="50:TPOT target;27.2:weights alone" marks="35:KV pool full"}
B, step ms
1, 27.8
2, 28.3
4, 29.3
8, 31.4
16, 35.6
32, 44.0
35, 45.6
48, 52.4
64, 60.8
96, 77.6
128, 94.3
:::

What the model says about the HelpDesk deployment:

- **Compute never binds in decode.** At B = 128 compute is 7.6 ms of a 94.3 ms step, and arithmetic intensity tops out near 34 FLOP/byte against an L40S ridge of about 419. Decode is a bandwidth problem at every batch size you can afford.
- **Two limits on B, and memory binds first.** The 50 ms TPOT target allows B ≤ 43. The KV pool — \(46{,}068\) MiB × 0.90 − 23.53 GB of weights − 2 GiB reserve (illustrative) = 16.58 GiB — holds only 35 sequences that each reserve 1,280 tokens. So B = 35: a 45.6 ms step and 768 tokens/s.
- **One GPU cannot serve the peak.** 10 req/s × 256 output tokens = 2,560 tokens/s, above the 1,907 tokens/s asymptote that pure KV reads allow at any batch size. No scheduler fixes that; quantisation, more replicas or a smaller model do.

:::warn[A floor, not a forecast]
The model assumes kernels run at spec-sheet bandwidth and ignores the LM head, attention arithmetic, sampling and scheduler overhead. Use it to rank designs and to sanity-check measurements; get the real curve by sweeping concurrency with the method in [chapter 9](/c/llm-serving/15-benchmark-method).
:::

## 5.5 Static batching and head-of-line blocking

A static batch admits its members together and releases them together. With output lengths $o_1, \dots, o_B$ every member occupies a slot for $\max_i o_i$ steps, so the useful share of slot-steps is

$$
U_{\text{static}} = \frac{\sum_i o_i}{B \cdot \max_i o_i}.
$$

If answer lengths are roughly exponential with mean $m$, the longest of $B$ has mean $m\,H_B$ where $H_B = 1 + \tfrac12 + \dots + \tfrac1B$, so on average \(U_{\text{static}} \approx 1/H_B\): a static batch wastes more slots the larger it gets.

```python run
"""Head-of-line blocking: four HelpDesk requests, static batch vs continuous batching."""
W, KV_TOK, BW, CTX = 23.53e9, 393_216, 864e9, 1152


def step(b):
    return (W + b * CTX * KV_TOK) / BW   # memory-bound decode step, seconds


outs = [40, 120, 256, 900]               # output lengths (illustrative)
n = len(outs)

# static: generate() runs until the longest finishes and returns the whole batch at once
static_done = max(outs) * step(n)
# continuous: a sequence leaves the batch the step it finishes; the batch shrinks
t, alive, cont_done = 0.0, sorted(outs), {}
for k in range(1, max(outs) + 1):
    t += step(sum(1 for o in alive if o >= k))
    for o in outs:
        if o == k:
            cont_done[o] = t

print("step time at B=4: %.1f ms" % (step(4) * 1e3))
print("%8s %12s %16s" % ("output", "static s", "continuous s"))
for o in outs:
    print("%8d %12.2f %16.2f" % (o, static_done, cont_done[o]))
print("slot utilisation, static: %.1f%%" % (100 * sum(outs) / (n * max(outs))))
print("5th request waits for a slot: static %.2f s, continuous %.2f s"
      % (static_done, cont_done[min(outs)]))
for b in (4, 32):                        # exponential outputs: E[max] = mean * H_B
    h = sum(1 / k for k in range(1, b + 1))
    print("B=%d: static batch lasts %.2fx the mean answer, slot utilisation %.1f%%"
          % (b, h, 100 / h))
```

```output
step time at B=4: 29.3 ms
  output     static s     continuous s
      40        26.40             1.17
     120        26.40             3.48
     256        26.40             7.32
     900        26.40            25.20
slot utilisation, static: 36.6%
5th request waits for a slot: static 26.40 s, continuous 1.17 s
B=4: static batch lasts 2.08x the mean answer, slot utilisation 48.0%
B=32: static batch lasts 4.06x the mean answer, slot utilisation 24.6%
```

:::example[Worked example · one long answer in a batch of four]
Four HelpDesk requests ask for 40, 120, 256 and 900 tokens (illustrative). At 29.3 ms per step the static batch runs \(900 \times 29.3\) ms = 26.4 s and returns everything at once: the user who wanted 40 tokens waits 26.4 s for 1.2 s of work. Slot utilisation is \((40 + 120 + 256 + 900) / (4 \times 900)\) = 36.6%. A fifth request arriving at time zero waits the full 26.4 s for a slot; with continuous batching it takes the first free slot after 1.17 s.
:::

That is **head-of-line blocking**: one long request sets the latency of everything batched with it and of everything queued behind it. Continuous (iteration-level) batching removes it by making admission and release per step rather than per batch.

## 5.6 Continuous batching under load

The worked example has four requests. Under Poisson arrivals the effect compounds: a static batch stalls the queue while it drains. The simulation below runs the HelpDesk workload (1,024-token prompts, answers geometric with mean 256 and capped at 2,048 — an illustrative distribution) through three schedulers on the floor model above. Each admitted request pays a 60.8 ms prefill (\(1{,}024 \times 21.5\) GFLOP ÷ 362 TFLOPS) that pauses decoding, as in a server without chunked prefill or prefix caching.

```python run
"""Queueing simulation: static batch of 4 vs continuous batching with 4 or 32 slots."""
import numpy as np

W, KV_TOK, BW, CTX = 23.53e9, 393_216, 864e9, 1152
PREFILL = 1024 * 21.5e9 / 362e12          # compute floor for a 1,024-token prompt, s


def step(b):
    return (W + b * CTX * KV_TOK) / BW if b else 0.0


def simulate(rate, slots, static, n=2000, seed=5):
    rng = np.random.default_rng(seed)
    arrive = np.cumsum(rng.exponential(1 / rate, n))
    out = np.minimum(rng.geometric(1 / 256, n), 2048)   # mean ~256 tokens (illustrative)
    t, nxt, running, ttft, done = 0.0, 0, [], [], 0
    while done < n:
        free = slots - len(running) if (not static or not running) else 0
        if not running and nxt < n and arrive[nxt] > t:
            t = arrive[nxt]                               # idle: jump to next arrival
        while free and nxt < n and arrive[nxt] <= t:
            t += PREFILL                                  # prefill blocks the decode loop
            running.append([nxt, out[nxt]])
            ttft.append(t - arrive[nxt])
            nxt, free = nxt + 1, free - 1
        t += step(len(running))
        for r in running:
            r[1] -= 1
        if static and all(r[1] <= 0 for r in running):   # static batch leaves together
            done, running = done + len(running), []
        elif not static:
            done += sum(r[1] <= 0 for r in running)
            running = [r for r in running if r[1] > 0]
    served = out.sum() / (t - arrive[0]) / (rate * out.mean())
    return np.mean(ttft), np.percentile(ttft, 99), served


POLICIES = (("static-4", 4, True), ("continuous-4", 4, False), ("continuous-32", 32, False))
RATES = (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1.0, 1.5, 2.0, 2.5)
p99 = {name: {} for name, _, _ in POLICIES}
for name, slots, static in POLICIES:
    for rate in RATES:
        _, p, served = simulate(rate, slots, static)
        if served < 0.97:                                # queue grows without bound
            print("%-14s overloaded at %.2f req/s" % (name, rate))
            break
        p99[name][rate] = p
print()
print("req/s, " + ", ".join(name for name, _, _ in POLICIES))
for rate in RATES:
    print("%.2f, " % rate + ", ".join("%.3g" % p99[k][rate] if rate in p99[k] else "-"
                                      for k in p99))
```

```output
static-4       overloaded at 0.30 req/s
continuous-4   overloaded at 0.60 req/s
continuous-32  overloaded at 2.50 req/s

req/s, static-4, continuous-4, continuous-32
0.05, 25.3, 0.0883, 0.0878
0.10, 35.2, 0.721, 0.0885
0.15, 62.9, 6.03, 0.0892
0.20, 111, 9.41, 0.0922
0.30, -, 14.4, 0.11
0.40, -, 25.8, 0.123
0.60, -, -, 0.128
0.80, -, -, 0.133
1.00, -, -, 0.134
1.50, -, -, 0.146
2.00, -, -, 4.36
2.50, -, -, -
```

:::chart[p99 TTFT vs offered load — static batch of 4 against continuous batching (simulated floor)]{type="line" x="offered load (requests per second)" y="p99 time to first token" unit=" s" ylog="true" hmarks="0.5:p99 TTFT target" note="A gap means the queue grows without bound at that rate."}
req/s, static-4, continuous-4, continuous-32
0.05, 25.3, 0.0883, 0.0878
0.10, 35.2, 0.721, 0.0885
0.15, 62.9, 6.03, 0.0892
0.20, 111, 9.41, 0.0922
0.30, -, 14.4, 0.11
0.40, -, 25.8, 0.123
0.60, -, -, 0.128
0.80, -, -, 0.133
1.00, -, -, 0.134
1.50, -, -, 0.146
2.00, -, -, 4.36
2.50, -, -, -
:::

Three readings:

1. **Static batching fails the TTFT target at any load.** Even at 0.05 req/s — one request every 20 s — its p99 TTFT is 25 s, because an unlucky arrival lands behind a long answer and waits for all of it. It saturates between 0.2 and 0.3 req/s.
2. **Continuous admission with the same four slots doubles capacity** (overload between 0.4 and 0.6 req/s), but four slots still leave the GPU mostly idle — §5.4 shows B = 4 uses 136 of a possible 768 tokens/s.
3. **Slots are the lever, and the KV pool caps them.** Thirty-two continuous slots hold p99 TTFT at 0.15 s up to 1.5 req/s and collapse past 2 req/s. At 1.5 req/s per replica, the 10 req/s peak needs \(\lceil 10 / 1.5 \rceil\) = 7 replicas of this floor model; quantisation, prefix caching and chunked prefill ([chapter 6](/c/llm-serving/08-essential-techniques)) are what bring that number down.

:::tip[What to change in ch03 first]
Make `WorkloadManager.batch_size` a parameter derived from the KV pool, keep the per-iteration top-up the streaming loop already does, turn the KV cache on in `model_worker.py`, and release a sequence the step it finishes. That is the design every production engine converges on.
:::

## 5.7 The multi-model service: residency arithmetic

The ch03 cache holds two classifiers small enough that a miss is cheap. Put LLMs behind the same LRU and a miss means moving the weights: load time ≈ bytes ÷ the slowest link they cross. The bandwidths below are illustrative round numbers for a 10 Gb/s path to an object store, a local NVMe drive, and host RAM to GPU over PCIe; [chapter 5](/c/llm-serving/07-challenges) builds the full cold-start pipeline.

```python run
"""Multi-model residency: load time = bytes / bandwidth, and what an LRU miss costs."""
import numpy as np

MODELS = {"Gemma 3 1B bf16": 2.00e9, "Gemma 3 12B int4": 7.73e9,
          "Gemma 3 12B bf16": 23.53e9, "Gemma 3 27B bf16": 54.02e9}
LINKS = {"object store 10 Gb/s": 1.25e9, "local NVMe": 3.0e9, "host RAM to GPU": 25e9}

print("%-18s" % "load seconds" + "".join("%22s" % k for k in LINKS))
for m, size in MODELS.items():
    print("%-18s" % m + "".join("%22.1f" % (size / bw) for bw in LINKS.values()))

# LRU over the ch03 config's four model ids, skewed popularity (illustrative)
pop = np.array([0.4, 0.3, 0.2, 0.1])
reqs = np.random.default_rng(3).choice(4, size=100_000, p=pop)


def lru_miss_rate(capacity):
    cache, misses = [], 0
    for r in reqs:
        if r in cache:
            cache.remove(r)
        else:
            misses += 1
            if len(cache) == capacity:
                cache.pop(0)                      # evict least recently used
        cache.append(r)
    return misses / len(reqs)


load = 7.73e9 / 3.0e9                             # Gemma 3 12B int4 from local NVMe
print()
print("%9s %10s %22s" % ("capacity", "miss rate", "added s per request"))
for cap in (1, 2, 3, 4):
    mr = lru_miss_rate(cap)
    print("%9d %9.1f%% %22.2f" % (cap, 100 * mr, mr * load))
```

```output
load seconds        object store 10 Gb/s            local NVMe       host RAM to GPU
Gemma 3 1B bf16                      1.6                   0.7                   0.1
Gemma 3 12B int4                     6.2                   2.6                   0.3
Gemma 3 12B bf16                    18.8                   7.8                   0.9
Gemma 3 27B bf16                    43.2                  18.0                   2.2

 capacity  miss rate    added s per request
        1      69.9%                   1.80
        2      41.7%                   1.07
        3      17.4%                   0.45
        4       0.0%                   0.00
```

:::example[Worked example · four Gemma 3 12B fine-tunes behind a two-slot LRU]
Suppose the four ids in `config/models.json` were four int4 Gemma 3 12B fine-tunes requested 40/30/20/10% of the time (illustrative). With the ch03 capacity of two, 41.7% of requests miss. Each miss loads 7.73 GB from NVMe in \(7.73 / 3.0\) = 2.6 s — five times the whole 500 ms p99 TTFT budget — so the average request pays 1.07 s and every miss breaks the SLO.

The memory side is no better. On an L40S the engine budget is 40.49 GiB; one 12B int4 leaves \(40.49 - 7.20 - 2\) = 31.29 GiB of KV pool, two leave \(40.49 - 2 \times 7.20 - 2\) = 24.09 GiB to share. Residency is paid for in batch size.
:::

Practical rules for LLM-sized multi-model serving:

- **Size the cache to the working set, or don't cache.** Capacity 3 here still misses 17.4% of requests. If the working set does not fit, route each model to dedicated replicas instead of swapping.
- **Stage weights in host RAM.** The same 12B int4 load drops from 2.6 s (NVMe) to 0.3 s over PCIe; at that point a swap may fit inside a relaxed TTFT target.
- **Share the base, swap the delta.** Fine-tunes of one base model are better served as one resident base plus per-request LoRA adapters — the gap the repository leaves open ([chapter 10](/c/llm-serving/12-advancements)).
- **Make unload explicit.** Triton's explicit model-control mode loads and unloads on command; the ch03 `TritonWorker` ties unload to `__del__`, which runs whenever Python gets round to it.

## 5.8 Single-model versus multi-model

| | Single-model | Multi-model |
| --- | --- | --- |
| Scarce resource | Time per step: TPOT rises from 27.8 ms at B = 1 to 45.6 ms at B = 35 | Memory: each resident 12B int4 removes 7.20 GiB from the KV pool |
| Complexity lives in | Batching, queueing, streaming | Cache, metadata, worker dispatch |
| Failure mode | Head-of-line blocking: one 900-token answer holds a static batch of four for 26.4 s | A miss costs a full load: 2.6 s (12B int4, NVMe) to 18.8 s (12B bf16, object store) |
| Main lever | Continuous batching with as many slots as the KV pool allows | Cache capacity versus working set; host-RAM staging; shared base with adapters |
| Cost story | Tokens per second per GPU | Utilisation across many models |

Neither ch03 service is a production system, and both say so: the single-model service batches at a fixed four with no admission control, and the multi-model service downloads nothing (`# Skip the downlaod implementation for simplicity`) and has no request queue.

## 5.9 Check yourself

:::qa[You make WorkloadManager.batch_size configurable for HelpDesk on Gemma 3 12B bf16 and one L40S. What value, and which limit sets it?]
35. The 50 ms TPOT target alone would allow 43 (step 50 ms or less), but the 16.58 GiB KV pool holds only 35 sequences that each reserve 1,280 tokens at 384 KiB per token. Memory binds first; the step at B = 35 is 45.6 ms and the GPU produces 768 tokens/s.
:::

:::qa[Doubling the batch from 8 to 16 adds how much to the decode step, and why so little?]
From 31.4 ms to 35.6 ms, +13%, while throughput rises from 255 to 449 tokens/s. The 23.53 GB of weights are read once per step regardless of B; the 8 extra sequences add only \(8 \times 0.453\) GB of KV reads, 4.2 ms at 864 GB/s.
:::

:::qa[A static batch of four gets answers of 40, 120, 256 and 900 tokens. What is slot utilisation, and when does the 40-token user get a reply?]
\((40 + 120 + 256 + 900) / (4 \times 900)\) = 36.6%. The `generate()` call returns the whole batch at once, after \(900 \times 29.3\) ms = 26.4 s. With continuous batching the same user is done at 1.17 s.
:::

:::qa[In the multi-model service with max_models = 2, the request order is A, B, A, C, D. What is evicted, and when?]
A and B load (two misses). A hits and becomes most recent, so the order is B, A. C misses and evicts B (least recent): A, C. D misses and evicts A: C, D. Four misses in five requests; with Gemma 3 12B int4 weights from NVMe that is four 2.6 s loads.
:::

:::qa[What does Triton's explicit model-control mode buy over loading everything at boot?]
Residency becomes a decision instead of a side effect: the server starts without loading the repository and loads or unloads models on command, so memory goes to the models that are actually being called. It is the runtime-native version of the ch03 LRU — and it still pays bytes ÷ bandwidth on every load.
:::

Next: [Chapter 4 — Best practices](/c/llm-serving/06-best-practices).
