---
section: "18"
title: "Glossary"
kicker: "Reference"
abstract: "Terms as the repository uses them, each pointing at the file or notebook where the term becomes concrete."
time: "3 min"
order: 18
---
Terms as the repository uses them. Each entry points at the file or notebook where the term becomes concrete.

**AWQ / GPTQ / FP8** — quantisation formats. In this repository they appear as model ids: `Qwen/Qwen3-14B-AWQ`, `Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4`, `RedHatAI/Qwen2.5-7B-Instruct-FP8-dynamic`. → [06](/c/llm-serving/08-essential-techniques/)

**Batch size** — how many sequences a manager admits at once. `WorkloadManager.batch_size = 4` in the single-model service. → [single-model](/c/llm-serving/13-single-model-service/)

**`benchmark_serving.py`** — vLLM's own benchmark script, used by chapter 6. Chapter 9 uses the `vllm bench serve` subcommand instead. → [benchmark method](/c/llm-serving/15-benchmark-method/)

**Burstiness** — a benchmark flag (`--burstiness 1.0`) controlling how evenly requests are spaced. At 1.0 the arrival pattern is Poisson.

**DLC** — AWS Deep Learning Containers, the basis of the `ch04/dlc*` examples.

**DJL** — Deep Java Library, the AWS inference container used to run vLLM in `ch04/dlc/`.

**Explicit model control** — Triton's `--model-control-mode=explicit`, where models load on request rather than at boot. The Triton equivalent of an LRU cache. → [multi-model](/c/llm-serving/14-multi-model-service/)

**GGUF** — the quantised single-file model format consumed by llama.cpp in `ch08/llamaCpp.ipynb`.

**KV cache** — stored keys and values for tokens already processed. Present in vLLM's engine, absent from the single-model service's streaming path (`use_cache=False`). → [02](/c/llm-serving/04-llm-serving/)

**LMCache** — an external KV cache store used in `ch07/LMCache.ipynb` so cached blocks survive the process. → [07](/c/llm-serving/09-advanced-techniques/)

**LRU eviction** — least-recently-used eviction, implemented with `OrderedDict.popitem(last=False)` in `app/manager.py`.

**ModelExecutor** — the class in the single-model service that owns the worker process and its two `mp.Queue` objects.

**ModelWorker** — in `ch03/single_model_llm_serving/` it is the process that runs forward passes; in `ch03/multi_model_serving/` it is an ABC with three framework-specific subclasses. Same name, different roles.

**Prefix repetition** — a synthetic workload where prompts share a long prefix, generated in chapter 9 with `--prefix-repetition-prefix-len` and friends.

**Prefill / decode** — the two phases of generation. Prefill processes the prompt (compute-bound); decode produces one token at a time (bandwidth-bound). → [02](/c/llm-serving/04-llm-serving/)

**Sequence** — the object in `workload_manager.py` holding a request's id, prompt, output, token count and, for streaming, the client queue.

**`Sequence.prompt += token`** — the line in `update_sequence_output` that grows the prompt by one token per step, making the recompute-per-step behaviour explicit.

**Spec-Bench** — the benchmark cloned by `ch07/SpecDecode.ipynb`, run at concurrency 1 because speculation is a latency technique.

**Tensor parallelism** — splitting each layer across GPUs with an all-reduce per layer; `--tensor-parallel-size`. Whether it helps depends on interconnect, as chapter 9's `g6e` versus `p4d` results show.

**TPOT** — time per output token, the decode-phase counterpart to TTFT.

**TTFT** — time to first token, dominated by prefill plus queueing.

**TritonWorker** — the worker in `app/worker.py` that calls a Triton server over HTTP instead of running a model locally.

**`vllm serve`** — the command that starts vLLM's OpenAI-compatible server; every benchmark notebook starts it in the background and kills it afterwards.
