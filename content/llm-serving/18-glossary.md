---
section: "18"
title: "Glossary"
kicker: "Reference"
abstract: "Terms as the repository and the course use them, in alphabetical order: one line each, the formula where there is one, a Gemma 3 number where the course computes it, and a link to the section that derives it."
time: "7 min"
order: 18
---
Terms as the repository and the course use them. Each entry gives the formula where there is one, the course's number for Gemma 3 12B on one NVIDIA L40S where it computes one, and a link to the section that derives it or the file where it becomes concrete. Symbols: $L$ layers, $B$ concurrent sequences, $C$ client concurrency, BW memory bandwidth, peak dense bf16 FLOP/s.

**Acceptance rate (α)** — the probability that the target model keeps a drafted token in speculative decoding. With $k$ drafts per round the target emits \(E = (1 - \alpha^{k+1})/(1 - \alpha)\) tokens per step; α depends on your prompts and sampling temperature, so measure it on your own traffic. → [§9.2](/c/llm-serving/09-advanced-techniques)

**All-reduce** — the collective that sums partial results across GPUs; tensor parallelism needs two per layer per step. A ring over $N$ GPUs costs \(2(N-1)(\alpha + S/(N\beta))\) for $S$ bytes, with per-hop latency α and link bandwidth β — at small batch on PCIe the hop latency dominates. → [§11.7](/c/llm-serving/11-in-practice)

**Arithmetic intensity** — FLOPs done per byte moved from memory. Decode at batch 1 does 21.5 GFLOP for about 24 GB of weights and KV, under 1 FLOP/byte; batching raises it until KV reads take over. → [§4.7](/c/llm-serving/04-llm-serving)

**AWQ / GPTQ / FP8** — quantisation formats. AWQ and GPTQ store weights in 4 bits with per-group scales (activations and KV stay 16-bit); FP8 stores weights in 8-bit floating point, and FP8-dynamic computes activation scales per token at run time. Chapter 6's lab compares fp16, GPTQ int4 and FP8-dynamic; chapter 9's phase 6 benchmarks an AWQ build. For Gemma 3 12B, int4 g128 is an estimated 7.73 GB against 23.53 GB in bf16; Google also publishes quantisation-aware-trained (QAT) int4 Gemma 3 checkpoints. → [§8.2](/c/llm-serving/08-essential-techniques)

**Batch size** — how many sequences a manager admits at once. `WorkloadManager.batch_size = 4` in the single-model service. → [§13.4](/c/llm-serving/13-single-model-service)

**`benchmark_serving.py`** — vLLM's own benchmark script, used by chapter 6. Chapter 9 uses the `vllm bench serve` subcommand instead. → [§15.2](/c/llm-serving/15-benchmark-method)

**Burstiness** — a benchmark flag (`--burstiness 1.0`) controlling how evenly requests are spaced. At 1.0 the arrival pattern is Poisson; lower is burstier. → [§15.2](/c/llm-serving/15-benchmark-method)

**Decode floor** — the fastest a batch-1 decode step can be: weight bytes ÷ memory bandwidth, since every step reads every weight. Gemma 3 12B on an L40S: \(23.53 / 864\) GB/s = 27.2 ms per token in bf16, 8.9 ms in int4. → [§8.2](/c/llm-serving/08-essential-techniques)

**Disaggregation (prefill–decode)** — running prefill and decode on separate GPU pools and shipping each request's KV between them, so long prefills stop stalling decoding users. The shipment is the prompt's KV: 403 MB for a 1,024-token HelpDesk prompt on Gemma 3 12B. → [§9.6](/c/llm-serving/09-advanced-techniques)

**DJL** — Deep Java Library, the AWS inference container used to run vLLM in `ch04/dlc/`. → [§6.1](/c/llm-serving/06-best-practices)

**DLC** — AWS Deep Learning Containers, the basis of the `ch04/dlc*` examples. → [§6.1](/c/llm-serving/06-best-practices)

**Draft model** — the small model that proposes tokens for speculative decoding. Its cost relative to the target is the byte ratio $c$; the speed-up is \(S = E/(1 + kc)\). Gemma 3 1B drafting for 27B int4 gives \(c = 2.00/16.42\) = 0.122 (the vocabularies differ by 64 ids, which the engine must handle). → [§9.2](/c/llm-serving/09-advanced-techniques)

**Explicit model control** — Triton's `--model-control-mode=explicit`, where models load on request rather than at boot. The Triton equivalent of an LRU cache. → [§14.8](/c/llm-serving/14-multi-model-service)

**GGUF** — the quantised single-file model format consumed by llama.cpp in `ch08/llamaCpp.ipynb`. Gemma 3 12B at Q4_K_M is a 7.13 GB file. → [§10.3](/c/llm-serving/10-frameworks)

**Goodput** — the throughput of requests that met every SLO, the only throughput a user pays for; always ≤ throughput. → [§2.1](/c/llm-serving/02-benchmarks)

**GQA (grouped-query attention)** — several query heads share one key/value head, so the KV cache stores only the KV heads. Gemma 3 12B has 16 query heads and 8 KV heads: half the KV of full multi-head attention. → [§4.4](/c/llm-serving/04-llm-serving)

**Head-of-line blocking** — one long request setting the latency of everything batched with or queued behind it. In a static batch of four, one 900-token answer holds a 40-token request for 26.4 s; continuous batching removes it. → [§5.5](/c/llm-serving/05-system-design)

**KV bytes per token** — \(2 \times L \times \text{kv\_heads} \times \text{head\_dim} \times \text{bytes}\), the 2 for K and V. Gemma 3 12B in bf16: \(2 \times 48 \times 8 \times 256 \times 2\) = 393,216 B = 384 KiB with every layer full; 64 KiB for the 8 global layers alone. → [§4.4](/c/llm-serving/04-llm-serving)

**KV cache** — stored keys and values for tokens already processed, so each decode step pushes one new token through the model. Present in vLLM's engine, absent from the single-model service's streaming path (`use_cache=False`). → [§4.6](/c/llm-serving/04-llm-serving)

**Little's law (closed-loop throughput)** — requests in flight = throughput × time in system. With $C$ clients and no think time, throughput ≈ \(C / (\text{TTFT} + \text{TPOT} \times (\text{out} - 1))\): $C$ = 16, TTFT 139.5 ms, TPOT 43.2 ms and 256 output tokens give 1.435 req/s. Check every benchmark row with it. → [§2.2](/c/llm-serving/02-benchmarks)

**LMCache** — an external KV cache store used in `ch07/LMCache.ipynb` so cached blocks survive the process. It pays only when loading KV is faster than recomputing it: above about 3.26 GB/s for Gemma 3 12B on an L40S. → [§9.5](/c/llm-serving/09-advanced-techniques)

**LoRA** — a fine-tune stored as a low-rank update, \(W' = W + BA\) with rank $r$, so one base model serves many adapters. A rank-16 adapter on all seven Gemma 3 12B projections is 131 MB in bf16. → [§12.2](/c/llm-serving/12-advancements)

**LRU eviction** — least-recently-used eviction, implemented with `OrderedDict.popitem(last=False)` in `app/manager.py`. → [§14.3](/c/llm-serving/14-multi-model-service)

**MFU (model FLOPs utilisation)** — achieved FLOP/s ÷ peak FLOP/s. The course assumes an illustrative 50% for prefill, which makes a 1,024-token Gemma 3 12B prefill 121.7 ms on an L40S. → [§4.5](/c/llm-serving/04-llm-serving)

**ModelExecutor** — the class in the single-model service that owns the worker process and its two `mp.Queue` objects. → [§13.5](/c/llm-serving/13-single-model-service)

**ModelWorker** — in `ch03/single_model_llm_serving/` it is the process that runs forward passes; in `ch03/multi_model_serving/` it is an ABC with three framework-specific subclasses. Same name, different roles. → [§13.6](/c/llm-serving/13-single-model-service), [§14.7](/c/llm-serving/14-multi-model-service)

**Paged attention** — storing KV in fixed-size blocks (16 tokens is vLLM's usual default) with a per-sequence block table, like virtual-memory pages. A sequence wastes under one block, about \((b-1)/2\) tokens on average, and shared blocks can be reference-counted. → [§8.5](/c/llm-serving/08-essential-techniques)

**Prefill / decode** — the two phases of generation. Prefill processes the prompt in one pass (compute-bound); decode produces one token per pass (bandwidth-bound). For a 1,024-token HelpDesk prompt: 121.7 ms, then 27.7 ms per token. → [§4.5](/c/llm-serving/04-llm-serving)

**Prefix caching** — keeping the KV of a shared prompt prefix and reusing it, so only the new tokens are prefilled. HelpDesk's 768-token system prompt is stored once (288 MiB), each sequence then holds 192 MiB instead of 480 MiB, and prefill drops to 256 tokens per request. → [§8.6](/c/llm-serving/08-essential-techniques)

**Prefix repetition** — a synthetic workload where prompts share a long prefix, generated in chapter 9 with `--prefix-repetition-prefix-len` and friends. → [§15.2](/c/llm-serving/15-benchmark-method)

**Ridge point** — the arithmetic intensity at which an operation stops being bandwidth-bound: peak ÷ BW. L40S: \(\frac{362 \times 10^{12}}{864 \times 10^{9}}\) ≈ 419 FLOP/byte. → [§7.4](/c/llm-serving/07-challenges)

**Roofline** — attainable FLOP/s = min(peak, intensity × BW). Decode lives on the sloped, bandwidth-bound part; a long prefill sits on the flat, compute-bound part. → [§7.4](/c/llm-serving/07-challenges)

**Semantic cache** — returning a cached *answer* when a new question's embedding similarity to a cached one exceeds a threshold τ. Unlike a prefix cache it can be wrong, so τ is set from the price of a wrong answer, not by eye. → [§12.3](/c/llm-serving/12-advancements)

**Sequence** — the object in `workload_manager.py` holding a request's id, prompt, output, token count and, for streaming, the client queue. → [§13.4](/c/llm-serving/13-single-model-service)

**`Sequence.prompt += token`** — the line in `update_sequence_output` that grows the prompt by one token per step, making the recompute-per-step behaviour explicit. → [§13.6](/c/llm-serving/13-single-model-service)

**Sliding-window attention** — local layers attend only to the last $W$ tokens, so their KV stops growing past the window. Gemma 3 alternates 5 local layers to 1 global; the 12B has 40 local layers with a 1,024-token window, capping their KV at 320 MiB per sequence. Whether an engine exploits it shows in the KV-cache size in its startup log. → [§4.4](/c/llm-serving/04-llm-serving)

**Spec-Bench** — the benchmark cloned by `ch07/SpecDecode.ipynb`, run at concurrency 1 because speculation is a latency technique. → [§9.1](/c/llm-serving/09-advanced-techniques)

**Speculative decoding** — a draft proposes $k$ tokens, the target verifies all of them in one pass and keeps the agreed prefix; lossless, and worth it only while decode is memory-bound. Gemma 3 1B drafting for 27B int4 at an illustrative α = 0.7, $k$ = 4: 1.86× at batch 1. → [§9.2](/c/llm-serving/09-advanced-techniques)

**Tensor parallelism** — splitting each weight matrix across $N$ GPUs, with two all-reduces per layer; `--tensor-parallel-size`. Whether it helps depends on the interconnect, as chapter 9's `g6e` (PCIe, worse) versus `p4d` (NVLink, better) results show. → [§11.7](/c/llm-serving/11-in-practice)

**TPOT** — time per output token, the decode-phase counterpart to TTFT. HelpDesk's SLO is a mean TPOT ≤ 50 ms. → [§2.1](/c/llm-serving/02-benchmarks)

**TritonWorker** — the worker in `app/worker.py` that calls a Triton server over HTTP instead of running a model locally. → [§14.7](/c/llm-serving/14-multi-model-service)

**TTFT** — time to first token, dominated by prefill plus queueing. HelpDesk's SLO is a p99 TTFT ≤ 500 ms. → [§2.1](/c/llm-serving/02-benchmarks)

**`vllm serve`** — the command that starts vLLM's OpenAI-compatible server; every benchmark notebook starts it in the background and kills it afterwards. → [§15.2](/c/llm-serving/15-benchmark-method)
