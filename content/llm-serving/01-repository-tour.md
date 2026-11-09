---
section: "1"
title: "Repository tour"
kicker: "Getting started"
abstract: "What is in each chapter directory and what runs where, then the running examples every later page reuses — Gemma 3 12B on one L40S serving a HelpDesk assistant — and the three numbers that size any deployment: weight bytes, KV bytes per token and memory bandwidth."
time: "12 min"
order: 1
outcomes:
  - "Find the code for any chapter and say which machine it needs to run"
  - "Compute weight bytes, KV bytes per token and the batch-1 decode floor for any Gemma 3 size"
  - "Decide whether a model fits one 48 GB GPU and how many 1,280-token requests its KV pool holds"
  - "Pick a reading order that starts with the service, not with chapter 1"
---
<https://github.com/orca3/llm-model-inference> is the companion code for *Hands-On LLM Serving and Optimization* by Chi Wang and Peiheng Hu (O'Reilly): notebooks for most chapters and two small serving services. You have one NVIDIA L40S, a 12-billion-parameter model and a support chatbot to launch. Before reading any chapter you want to know where the code is, what it needs to run, and whether your model even fits. This page answers all three, and sets up the numbers the rest of the course reuses.

:::key[First principle]
Three numbers size almost every LLM deployment before you run anything: **weight bytes** (does it fit, and how long does one decode step take), **KV bytes per token** (how many concurrent requests fit beside the weights), and **memory bandwidth** (how fast the GPU can stream both). Everything else — batching, quantisation, parallelism — is a way of trading one of them against another.
:::

## 1.1 Layout

| Directory | Chapter | What is in it |
| --- | --- | --- |
| `ch02/` | Large Language Model Serving | Five notebooks on transformer internals, execution, vLLM, batching and streaming, plus `streaming.py` |
| `ch03/single_model_llm_serving/` | Model-Serving System Design | A FastAPI service serving one LLM (`facebook/opt-125m`), with a workload manager, a model executor, a separate worker process and a vLLM path |
| `ch03/multi_model_serving/` | Model-Serving System Design | A FastAPI service caching up to two models with an LRU, a worker factory per framework, and a Triton client |
| `ch04/KnowledgeAgent/` | Model Serving Best Practices | A RAG-plus-planning agent: `planner.py`, `rag_system.py`, `actions.py`, `llm_manager.py`, `agent.py` |
| `ch04/bedrock/`, `jumpstart/`, `dlc/`, `dlc_customization/` | Model Serving Best Practices | AWS deployment examples: Bedrock, SageMaker JumpStart, Deep Learning Containers, a custom container |
| `ch06/quantization_3way_300.ipynb` | Essential Techniques | One model served three ways — fp16, GPTQ-Int4, FP8-dynamic — and benchmarked with vLLM's benchmark script across a concurrency sweep |
| `ch07/SpecDecode.ipynb`, `LMCache.ipynb` | Advanced Techniques | Four speculative-decoding configurations (vanilla, n-gram, improved n-gram, EAGLE-3) at concurrency 1; cold versus warm KV cache with LMCache |
| `ch08/SGLang.ipynb`, `TensorRT_LLM.ipynb`, `llamaCpp.ipynb` | Frameworks | The same small generation task in three frameworks |
| `ch09/model_optimization_in_practice.ipynb` | In Practice | Seven phases: GPU inspection, traffic generation, metrics, baseline, AWQ quantisation, distributed serving |

Chapters 1, 5 and 10 are conceptual and ship no code; there is no `ch01/`, `ch05/` or `ch10/`. The benchmark notebooks use other open-weight models; this guide re-derives every number on Gemma 3 so the pages stay consistent with each other.

## 1.2 What runs where

Most chapters are notebooks with a Colab badge at the top, so the cheapest way to read the code is also the way to run it.

| Chapter | Runs on | Note |
| --- | --- | --- |
| 2 | Colab, GPU runtime | The transformer-internals notebook needs a GPU for its attention visualisations; it loads a sub-1B model |
| 3 | Local machine | Install the chapter's requirements, then start a service: port 8000 for single-model, 8001 for multi-model |
| 4 | AWS account | Bedrock, SageMaker and S3 calls; the notebooks are trimmed to key steps |
| 6 | CUDA GPU with vLLM | Clones the vLLM repository to get its benchmark script |
| 7 | Large CUDA GPU with vLLM | Speculative decoding needs a large target model to show a win; LMCache needs a KV-transfer-capable setup |
| 8 | Depends | llama.cpp runs anywhere; TensorRT-LLM needs NVIDIA tooling; SGLang needs a GPU for meaningful numbers |
| 9 | CUDA GPU with vLLM | The recorded runs use `g6e` (L40S, PCIe) and `p4d` (A100, NVLink) EC2 instances |

## 1.3 The two runnable services

Both live in `ch03/` and both are small enough to read in an afternoon.

```bash
# single-model service — port 8000
cd ch03/single_model_llm_serving
pip install -r requirements.txt
python main.py

# multi-model service — port 8001
cd ch03/multi_model_serving
pip install -r requirements.txt
python -m app.server
```

The single-model service exposes four endpoints: `/basic_generate` (one prompt, no queue), `/generate` (many prompts, batched through the workload manager), `/generate_stream` (server-sent events, one token at a time) and `/generate_vllm` (the same batch through vLLM). The multi-model service exposes two: `/models` and `/predict`. Its config serves four small models — two text classifiers (`distilbert-base-uncased-finetuned-sst-2-english`, `mrm8488/bert-tiny-finetuned-sms-spam-detection`), `mobilenet_v2`, and `densenet_onnx` through Triton.

What the repository does not include, so you don't look for it: no Kubernetes or Terraform (deployment is notebook-level AWS calls); no model download in the multi-model service (`# Skip the downlaod implementation for simplicity` in `manager.py`); and no shared benchmark harness across chapters, so numbers from different notebooks are not comparable with each other. The *method* transfers between chapters; the numbers don't.

## 1.4 The running examples

Every page from here on uses the same model, the same GPU and the same workload, so a number on one page can be checked against a number on another.

**Model: Gemma 3.** The 12B is the primary example; 1B and 27B bracket it. Values are from the published configs.

| | Gemma 3 1B | Gemma 3 12B | Gemma 3 27B |
|---|---:|---:|---:|
| layers $L$ | 26 | 48 | 62 |
| hidden size | 1,152 | 3,840 | 5,376 |
| query heads / KV heads | 4 / 1 | 16 / 8 | 32 / 16 |
| head dim | 256 | 256 | 128 |
| gated FFN width | 6,912 | 15,360 | 21,504 |
| vocabulary | 262,144 | 262,208 | 262,208 |
| sliding window on local layers | 512 | 1,024 | 1,024 |
| global / local layers (1 : 5) | 4 / 22 | 8 / 40 | 10 / 52 |

The 12B and 27B are multimodal (a SigLIP vision tower of about 0.42B parameters, 256 tokens per image); every number in this course is for the text path.

**GPU: one NVIDIA L40S** (AWS `g6e`): 48 GB GDDR6 of which `nvidia-smi` reports 46,068 MiB, 864 GB/s memory bandwidth, about 362 TFLOPS dense bf16, PCIe Gen4 between GPUs and no NVLink (spec-sheet values). The comparison GPU is an A100 40GB on `p4d`: 1,555 GB/s, 312 TFLOPS, NVLink. Prices, where used, are illustrative: $2.00 per L40S-hour and $4.00 per A100-hour.

**Workload: a HelpDesk assistant** (illustrative). Mean prompt 1,024 tokens, of which 768 are a shared system prompt and tool schema; mean output 256 tokens; SLO p99 TTFT ≤ 500 ms and mean TPOT ≤ 50 ms; peak 10 requests/s.

## 1.5 Three numbers that size any deployment

**Weight bytes.** Parameters times bytes per parameter. For Gemma 3 the input and output embeddings are tied, so the vocabulary matrix is counted once:

$$
N = L\,(2dHd_h + 2dKd_h + 3dF) + Vd, \qquad \text{bytes}_W = N \times b_w,
$$

with hidden size $d$, $H$ query heads, $K$ KV heads, head dim $d_h$, FFN width $F$ and vocabulary $V$. Here $b_w = 2$ for bf16. A 4-bit weight-only format with one scale and zero point per group of 128 costs about 4.25 bits per weight; the embedding usually stays bf16.

**KV bytes per token.** Every generated or prompt token leaves a key and a value vector in every layer:

$$
\text{KV/token} = 2 \times L \times K \times d_h \times b_{kv}.
$$

This is the all-layers upper bound. Gemma 3's local layers only attend to the last 1,024 tokens, so an allocator that exploits the window holds less; [§4](/c/llm-serving/04-llm-serving) derives both bounds.

**Memory bandwidth.** A decode step at batch 1 must stream every weight from memory once, so it can't run faster than

$$
t_{\text{decode}} \gtrsim \frac{\text{bytes}_W}{\text{bandwidth}}.
$$

```python run
"""Three numbers that size any deployment, for Gemma 3 on one L40S."""
GiB = 2**30
# Gemma 3 text config: layers, query heads, KV heads, head_dim, hidden, FFN, vocab
CFG = {
    "1B": (26, 4, 1, 256, 1152, 6912, 262_144),
    "12B": (48, 16, 8, 256, 3840, 15_360, 262_208),
    "27B": (62, 32, 16, 128, 5376, 21_504, 262_208),
}
BW = 864e9                      # L40S memory bandwidth, bytes/s (spec)
VRAM = 46_068 * 2**20           # what nvidia-smi reports on an L40S
UTIL, RESERVE = 0.90, 2 * GiB   # vLLM-style budget; reserve is illustrative
print(f"L40S budget at utilisation {UTIL}: {VRAM * UTIL / 1e9:.2f} GB = {VRAM * UTIL / GiB:.2f} GiB\n")

print(f"{'model':>5} {'params':>8} {'bf16 GB':>8} {'int4 GB':>8} "
      f"{'KV KiB/tok':>11} {'decode ms bf16':>15} {'int4':>6} {'KV pool GiB':>12}")
for name, (L, H, KV, D, HID, FF, V) in CFG.items():
    attn = 2 * HID * H * D + 2 * HID * KV * D        # q,o + k,v projections
    body = L * (attn + 3 * HID * FF)                 # gated MLP has 3 matrices
    emb = V * HID                                    # tied input/output embedding
    w_bf16 = 2 * (body + emb)
    w_int4 = body * 4.25 / 8 + 2 * emb               # 4-bit, group-128 scales
    kv_tok = 2 * L * KV * D * 2                      # K and V, every layer, bf16
    pool = VRAM * UTIL - w_bf16 - RESERVE
    pool_s = f"{pool / GiB:.2f}" if pool > 0 else "does not fit"
    print(f"{name:>5} {(body + emb) / 1e9:7.3f}B {w_bf16 / 1e9:8.2f} {w_int4 / 1e9:8.2f} "
          f"{kv_tok / 1024:11.0f} {w_bf16 / BW * 1e3:15.1f} {w_int4 / BW * 1e3:6.1f} {pool_s:>12}")

L, H, KV, D, HID, FF, V = CFG["12B"]
body = L * (2 * HID * H * D + 2 * HID * KV * D + 3 * HID * FF)
kv_req = (1024 + 256) * 2 * L * KV * D * 2           # one HelpDesk request, upper bound
print(f"\n12B on L40S, one 1,280-token HelpDesk request = {kv_req / 2**20:.0f} MiB of KV (all-layers bound)")
for label, w in (("bf16", 2 * (body + V * HID)), ("int4", body * 4.25 / 8 + 2 * V * HID)):
    pool = VRAM * UTIL - w - RESERVE
    print(f"  {label}: KV pool {pool / GiB:5.2f} GiB -> {int(pool // kv_req)} concurrent requests")
```

```output
L40S budget at utilisation 0.9: 43.48 GB = 40.49 GiB

model   params  bf16 GB  int4 GB  KV KiB/tok  decode ms bf16   int4  KV pool GiB
   1B   1.000B     2.00     0.97          26             2.3    1.1        36.63
  12B  11.765B    23.53     7.73         384            27.2    8.9        16.57
  27B  27.008B    54.02    16.42         496            62.5   19.0 does not fit

12B on L40S, one 1,280-token HelpDesk request = 480 MiB of KV (all-layers bound)
  bf16: KV pool 16.57 GiB -> 35 concurrent requests
  int4: KV pool 31.29 GiB -> 66 concurrent requests
```

:::chart[Weight bytes per Gemma 3 size against one L40S's budget]{type="bar" x="model" y="weights" unit=" GB" hmarks="43.48:L40S budget at 0.90" labels="true"}
model, bf16, int4 (g128)
1B, 2.00, 0.97
12B, 23.53, 7.73
27B, 54.02, 16.42
:::

:::chart[Batch-1 decode floor on an L40S: bytes ÷ 864 GB/s]{type="bar" x="model" y="time per output token" unit=" ms" hmarks="50:HelpDesk TPOT SLO" labels="true"}
model, bf16, int4 (g128)
1B, 2.3, 1.1
12B, 27.2, 8.9
27B, 62.5, 19.0
:::

:::example[Worked example · Gemma 3 12B on one L40S]
**Budget.** vLLM-style: \(46{,}068\ \text{MiB} \times 0.90\) = 40.49 GiB usable.

**Weights.** 11.765B parameters × 2 bytes = 23.53 GB = 21.91 GiB in bf16.

**KV pool.** 40.49 − 21.91 − 2 (illustrative activation and CUDA-graph reserve) = 16.57 GiB.

**Per request.** \(1{,}280\ \text{tokens} \times 384\ \text{KiB}\) = 480 MiB, so 16.57 GiB holds 35 HelpDesk requests at once.

**Speed.** Each decode step streams 23.53 GB at 864 GB/s: at least 27.2 ms per token at batch 1, about 37 tokens/s for a single user — inside the 50 ms TPOT SLO with room to batch.
:::

Three readings of the table:

- **The 27B does not fit in bf16** (54.02 GB against a 43.48 GB budget) but does in int4 at 16.42 GB, with a 19.0 ms decode floor. Quantisation here is the difference between one GPU and two.
- **Int4 nearly doubles concurrency, not just speed.** The KV cache stays bf16, but the 15.8 GB of weights it frees go to the KV pool: 35 → 66 concurrent HelpDesk requests.
- **The int4 decode floor is 8.9 ms, not 27.2 / 4 = 6.8 ms.** The 2.01 GB embedding matrix stays bf16 and is read in full every step as the output projection, and the group scales add 0.25 bits per weight.

:::warn[Read the startup log, not just the formula]
The 2 GiB reserve is a placeholder. vLLM prints the KV-cache size it actually allocated (in tokens and GiB) when the server starts; chapter 9's notebook tells you to open `vllm.log` and read exactly those lines. If your formula and the log disagree by more than a few percent, the log is right and your formula is missing a term.
:::

## 1.6 How to read this repository

Not in chapter order. Chapter 3 is the only place a whole serving system is assembled, and every other chapter either explains one of its parts or replaces it with a framework.

:::mermaid[A reading order that follows the request path]
flowchart LR
  A[§1 tour: three numbers] --> B[§13 ch03 single-model service]
  B --> C[§4 ch02: prefill vs decode]
  C --> D[§2 reading serving numbers]
  D --> E[§15 ch09 benchmark method]
  E --> F[§8 ch06 quantisation and batching]
  F --> G[§9 ch07 speculation, KV tiers]
  G --> H[§10 ch08 frameworks]
  B -.-> I[§14 multi-model service]
:::

1. **Read chapter 3 first** — the [single-model walkthrough](/c/llm-serving/13-single-model-service) goes file by file. Look for the queue: every design decision follows from requests arriving faster than the model serves them.
2. **Then chapter 2's notebooks** ([§4](/c/llm-serving/04-llm-serving)). They answer what chapter 3's code raises but doesn't explain: what is recomputed on each token, and why the first token is slow.
3. **Then chapter 9's phases** ([§15](/c/llm-serving/15-benchmark-method)): inspect, generate traffic, define metrics, baseline, quantise, distribute. It is the method you will reuse on your own hardware; [§2](/c/llm-serving/02-benchmarks) is how to read what it prints.
4. **Chapters 6, 7 and 8** are reference material for when you have a specific problem: precision, speculative decoding, or a framework swap.

## 1.7 Check yourself

:::qa[Can Gemma 3 27B serve the HelpDesk workload on one L40S?]
Not in bf16: 54.02 GB of weights exceed the 43.48 GB budget at 0.90 utilisation. In int4 the weights are 16.42 GB, the decode floor is \(16.42 / 864\) ≈ 19.0 ms per token — well inside the 50 ms TPOT SLO — and about 25 GB is left for KV cache. Whether int4 quality is good enough is a separate measurement the throughput numbers can't answer.
:::

:::qa[Why does the int4 12B fit 66 concurrent requests when the bf16 one fits 35, even though the KV cache is still bf16?]
The pool is what is left after weights: 40.49 − 7.20 − 2 = 31.29 GiB for int4 against 40.49 − 21.91 − 2 = 16.57 GiB for bf16. Each request needs the same 480 MiB, so the count scales with the pool: \(31.29 \times 1024 / 480\) ≈ 66.
:::

:::qa[Which single-model endpoint skips the workload manager, and why does that matter for benchmarking?]
`/basic_generate` sends one prompt straight to the executor with no queue. Timing it measures the model alone; timing `/generate` under load measures the model plus queueing and batching — the number users actually feel.
:::

:::qa[A colleague quotes tokens/s from the ch06 notebook and from the ch09 notebook and compares them. What's wrong?]
Different models, instance types, datasets and concurrency settings, and no shared harness. Compare the *method* and the direction of each effect; recompute absolute numbers for your own model and GPU with the formulas above.
:::

Next: [Reading serving numbers](/c/llm-serving/02-benchmarks).
