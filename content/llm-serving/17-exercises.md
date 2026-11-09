---
section: "17"
title: "Exercises"
kicker: "Plan"
abstract: "Twelve tasks, each naming a file and producing an artefact — a measurement, a diff, or a sentence — and, where the course derives one, a number to predict before you run anything."
time: "8 min"
order: 17
outcomes:
  - "Predict each result from the course's Gemma 3 numbers before running the code that measures it"
  - "Fix the single-model service's cache-free streaming loop and confirm the saving"
  - "Run a one-change benchmark on `google/gemma-3-1b-it` or `google/gemma-3-12b-it` and check it against the prediction"
  - "Design multi-LoRA serving from adapter bytes and cold-load time"
---
Each task names a file in the repository and produces a concrete artefact — a measurement, a diff, or a sentence. They are ordered so that each one uses something the previous one taught.

Where the course derives a number for its running example — Gemma 3 12B on one NVIDIA L40S serving the illustrative HelpDesk workload ([§1.4](/c/llm-serving/01-repository-tour)) — the task has a **Predict first** line. Write your prediction down before you run anything. On other hardware or a smaller model the absolute numbers change; redo the arithmetic with your model's `config.json` and your GPU's bandwidth, and the ratios should survive.

## 1 · Run all four endpoints

*`ch03/single_model_llm_serving/main.py`*

Start the service and call `/basic_generate`, `/generate`, `/generate_stream` and `/generate_vllm`. Time each.

**Predict first.** The very first call is slow whichever endpoint it hits: `get_llm()` builds the engine lazily inside the request path ([§13.2](/c/llm-serving/13-single-model-service)). Time a second call before comparing endpoints.

Done when: you can say which endpoint used the workload manager and which bypassed it, and why `/generate_stream` needs `curl -N`.

## 2 · Find the missing KV cache

*`ch03/single_model_llm_serving/llm/model_worker.py`*

Find the line that disables the cache, then explain in one sentence what it costs per generated token.

**Predict first.** Without a cache, step $i$ pushes the whole $p + i$ token prefix through the model: \(T = np + n(n-1)/2\) tokens for $n$ outputs ([§13.6](/c/llm-serving/13-single-model-service)). On the demo — a 16-token prompt and the engine's 20-token streaming limit — that is 510 tokens instead of 35, 14.6×.

Done when: you can predict, before running it, that per-token latency will be roughly flat rather than dropping after the first token — and you have confirmed it.

## 3 · Make streaming cheap

*Same file*

Pass `past_key_values` through `self.stream_states` so each step only processes the new token.

**Predict first.** At 125M parameters (`facebook/opt-125m`) the saving is hard to see. On the HelpDesk shape with Gemma 3 12B it is not: 294,784 tokens become 1,279 (230.5×), and a step drops from about 68.4 ms of compute-bound recompute to the 27.2 ms bandwidth floor on an L40S ([§13.6](/c/llm-serving/13-single-model-service)).

:::details[Worked prediction · HelpDesk shape]
$p$ = 1,024, $n$ = 256. Without a cache: \(256 \times 1{,}024 + 256 \times 255 / 2\) = 262,144 + 32,640 = 294,784 tokens. With a cache: one 1,024-token prefill plus 255 single-token steps = 1,279 tokens. The cached decode step reads all 23.53 GB of bf16 weights once: \(23.53 / 864\) GB/s = 27.2 ms.
:::

Done when: per-token latency for a long prompt drops after the first token, and the output text is unchanged.

## 4 · Unify the token limits

*`llm/llm.py` and `llm/model_worker.py`*

Two different limits exist — `max_tokens = 20` in the engine, `max_new_tokens=50` in the worker. Thread one value from the request through to the worker.

**Predict first.** If you raise the streaming limit to 50 before task 3 is merged, the same formula gives \(50 \times 16 + 50 \times 49 / 2\) = 2,025 tokens processed instead of 65 with a cache — 31×, up from 14.6×. The cache-free cost grows with the square of the output length.

Done when: a single request parameter controls both paths, and the streaming path stops at the same length as the batch path.

## 5 · Watch the LRU evict

*`ch03/multi_model_serving/app/manager.py`*

With `max_models = 2`, request the four models in the config in a specific order and log each eviction.

**Predict first.** A hit calls `move_to_end`, a miss on a full cache calls `popitem(last=False)` ([§14.3](/c/llm-serving/14-multi-model-service)). Trace it on paper before you run it. For the hit rate, [§5.7](/c/llm-serving/05-system-design) derives that two slots in front of four models requested 40/30/20/10% of the time (illustrative) miss 41.7% of requests.

:::details[Worked prediction · A, B, A, C, D]
A and B load: cache [A, B]. A hits and moves to the end: [B, A]. C misses on a full cache and evicts B: [A, C]. D misses and evicts A: [C, D]. Evictions: **B, then A**.
:::

Done when: you can state the eviction order for the sequence A, B, A, C, D — and your log agrees.

## 6 · Serve the same model twice

*`ch03/multi_model_serving/`*

Add a second entry to `config/models.json` that points at the same model name with a different id.

**Predict first.** The cache is keyed by id, so both copies load. With the demo classifiers nobody notices; with Gemma 3 12B int4 on an L40S the second copy costs 7.20 GiB and shrinks the KV pool from 31.29 to 24.09 GiB ([§5.7](/c/llm-serving/05-system-design)).

Done when: both ids are resident at once and you can explain why that is a memory bug rather than a feature.

## 7 · Replace `__del__`

*`app/worker.py`, `app/manager.py`*

Add an explicit `unload(model_id)` to the manager, call it on eviction, and remove the Triton unload from `__del__`.

Done when: eviction unloads the model deterministically, and you can say why relying on `__del__` is unsafe.

## 8 · Build a two-workload benchmark

*`ch09/`*

Using the notebook's helpers, benchmark one model on ShareGPT and on prefix repetition at the same request rate. Use `google/gemma-3-1b-it` on a small GPU or `google/gemma-3-12b-it` on a 48 GB card, with the HelpDesk-shaped prefix workload of [§15.2](/c/llm-serving/15-benchmark-method) (768-token shared prefix, 256-token suffix, 256 output tokens).

**Predict first.** Total ÷ output token throughput is \((\overline{\text{in}} + \overline{\text{out}}) / \overline{\text{out}}\) — for the prefix workload \((1{,}024 + 256)/256\) = 5.0, cache or no cache ([§2.6](/c/llm-serving/02-benchmarks)); for ShareGPT, compute it from the lengths `inspect_dataset.py` reports. With the 12B in bf16 on an L40S, the course predicts prefix caching cuts TTFT from 141.1 to 53.2 ms and lifts the best in-SLO rate from 1.74 to 2.75 req/s.

Done when: you have a table showing both, and one sentence explaining why the total-token throughput differs so much between them.

## 9 · Quantise, then re-run identically

*`ch09/`, `ch06/`*

Benchmark `google/gemma-3-12b-it` (or `google/gemma-3-1b-it`), then an int4 build of the same model — Google's quantisation-aware-trained int4 Gemma 3 release, or your own AWQ or GPTQ quantisation — and re-run the *same* command with the same rate and concurrency.

**Predict first.** For the 12B on an L40S: weights 23.53 → 7.73 GB, decode floor 27.2 → 8.9 ms per token (3.0× from bytes alone), KV pool 16.58 → 31.29 GiB ([§8.2](/c/llm-serving/08-essential-techniques)), and with prefix caching 2.74 → 4.97 req/s per GPU at the SLO ([§11.8](/c/llm-serving/11-in-practice)).

Done when: your table has a before and after column per metric, and the only difference between the two runs is the model id.

## 10 · Predict the parallelism outcome

*`ch09/` phase 7*

Before running anything, predict whether tensor parallelism will help on the hardware you have. Write the prediction down, with a reason. `google/gemma-3-12b-it` fits one L40S, so TP is a choice there; `google/gemma-3-27b-it` in bf16 (54.02 GB) does not, so TP is forced.

**Predict first.** Each layer pays two all-reduces per step. The course's best-case estimate puts TP = 4 at about 59% of a single GPU's per-GPU decode throughput on PCIe L40S and about 80% on NVLink A100 ([§2.5](/c/llm-serving/02-benchmarks)); for the 12B with prefix caching, four replicas serve 10.97 req/s at the SLO where one TP = 4 group serves 7.83 ([§11.7](/c/llm-serving/11-in-practice)).

Done when: you have compared it with the result, and your explanation of any surprise names the interconnect rather than the GPU count.

## 11 · Read a framework's setup cost

*`ch08/`*

Install one of the three frameworks and get a single generation out of it.

**Predict first.** For llama.cpp the decode ceiling is bandwidth ÷ file size. Gemma 3 12B at Q4_K_M is a 7.13 GB file: about 14 tokens/s on an illustrative 100 GB/s laptop; the 1B at Q4_K_M is 0.61 GB, about 165 tokens/s ([§10.3](/c/llm-serving/10-frameworks)).

Done when: you can state how long the install took, what it needed beyond `pip`, and what you would have to give up to use it instead of vLLM.

## 12 · Design multi-LoRA serving

*Nothing in the repository*

Write the design, not the code: one base model, N adapters, a per-request selection. Where does the adapter live, what is resident, and what does a cold adapter cost in TTFT?

**Predict first.** For Gemma 3 12B with all seven projections targeted, a rank-16 adapter is 65.5M parameters, 131 MB in bf16. Twelve of them are 1.57 GB — about 4,000 tokens of KV, so the bf16 pool drops from 35 to 32 HelpDesk sequences — and a cold adapter costs about 71 ms of TTFT at illustrative disk and host-to-GPU rates ([§12.2](/c/llm-serving/12-advancements)).

Done when: you have two candidate designs and one measurement that would decide between them.

## Before you trust any run from tasks 8–10

:::exercise[Exercise 17.1 · Benchmark run readiness]{id="checklist" items="Prediction written down before the run: decode floor, KV capacity, throughput at the SLO;nvidia-smi output and engine version recorded;KV-cache size read from the server startup log;Warm-up pass discarded after every server start;num-prompts sized for the p99 band you report;Every row passes Little's law: throughput × mean E2E ≤ concurrency;Exactly one thing changed between the two runs" grades="A,B,C,D,F"}
:::

The items come from the reusable checklist in [§15.8](/c/llm-serving/15-benchmark-method).
