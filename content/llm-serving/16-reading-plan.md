---
section: "16"
title: "Reading plan"
kicker: "Plan"
abstract: "Four weeks, each pairing one part of the book with one part of the repository and the course sections that derive it — with one number per week you should be able to compute before you move on. Start at chapter 3, not chapter 1."
time: "6 min"
order: 16
outcomes:
  - "Plan four weeks of reading that pair each book chapter with its repository directory and course section"
  - "Check your progress each week against a number the course derives on Gemma 3 12B and one L40S"
  - "Predict a result with the course's model before you run the notebook that measures it"
---
Four weeks, each pairing one part of the book with one part of the repository. The order is not the book's order: it starts with chapter 3, because that is the only place a whole serving system is assembled and every later chapter either explains one of its parts or replaces it.

Each week ends with a **target**: a number the course derives for its running example — Gemma 3 12B on one NVIDIA L40S serving the illustrative HelpDesk workload ([§1.4](/c/llm-serving/01-repository-tour)) — that you should be able to reproduce on paper. If you can, the week's sections have done their job.

## Week 1 — the service

**Repository:** `ch03/single_model_llm_serving/`
**Notes:** [The single-model service, file by file](/c/llm-serving/13-single-model-service), then [Chapter 3 — System design](/c/llm-serving/05-system-design)
**Book:** chapter 3.

Run it first (`python main.py`, then `curl` the four endpoints), then read the code in dependency order: `main.py` → `llm.py` → `workload_manager.py` → `model_executor.py` → `model_worker.py`.

The thing to look for is the queue. Every other design decision in the directory — separate streaming and batch queues, a fixed batch size of four, a background thread, a worker process — follows from "requests arrive faster than the model can serve them."

If you finish the week with one question, make it this: what does `use_cache=False` in `model_worker.py` cost, and how would you see the cost in a chart?

**Target.** Explain why, with Gemma 3 12B on an L40S, a static batch of four keeps only 48.0% of its slots busy while continuous refill keeps 97.5% busy — 70.5 versus 143.2 tokens/s ([§13.4](/c/llm-serving/13-single-model-service)) — and why the cache-free streaming loop processes 230.5× as many tokens as a cached one on the HelpDesk shape ([§13.6](/c/llm-serving/13-single-model-service)).

## Week 2 — the model

**Repository:** `ch02/`
**Notes:** [Chapter 2 — LLM serving](/c/llm-serving/04-llm-serving), then [Chapter 1 — Serving and optimization](/c/llm-serving/03-serving-and-optimization)
**Book:** chapters 2 and 1.

Five notebooks, in this order: transformer internals, execution walkthrough, vLLM comparison, batching, streaming.

`ch2_Workthrough_LLM_execution.ipynb` is the one that answers week 1's question. It times each generated token and plots the result, and the first bar dwarfs the rest. That chart is what `use_cache=False` throws away on every step.

Read `ch02/streaming.py` afterwards and compare it with `llm/llm.py`'s `event_generator`: the same problem (blocking producer, async consumer) solved with a framework's async engine and by hand with queues and threads.

Chapter 1 ([§3](/c/llm-serving/03-serving-and-optimization)) is short and belongs here: it turns the per-token cost into a cost per request and shows why a server run near full capacity queues.

**Target.** For one 1,024-token HelpDesk prompt on an L40S, derive a first token of 121.7 ms (compute-bound prefill at an illustrative 50% MFU) and 27.7 ms for every later token (memory-bound decode), 7.20 s for the whole 256-token answer ([§4.5](/c/llm-serving/04-llm-serving)). The first bar of the ch02 chart is the first number; the flat tail is the second.

## Week 3 — the measurements

**Repository:** `ch09/model_optimization_in_practice.ipynb`
**Notes:** [Chapter 5 — Challenges](/c/llm-serving/07-challenges), [Chapter 9 — In practice](/c/llm-serving/11-in-practice), [The benchmark method](/c/llm-serving/15-benchmark-method), [Benchmarks](/c/llm-serving/02-benchmarks)
**Book:** chapters 5 and 9.

Chapter 5 has no code, and this is the week it becomes concrete: memory sizing, the roofline, TTFT versus TPOT, and why quantisation changes both. Chapter 9's seven phases are the method. The notebook uses a different open-weight model; the course keeps its method and re-derives every number on Gemma 3, so the predictions on these pages are what you check a run against.

Work in that order: **predict with the course's model first, then measure.** Write down the KV pool, the decode floor and the closed-loop throughput you expect ([§11.5](/c/llm-serving/11-in-practice)) before you start a server. If you have a GPU, run phases 1 to 6 with `google/gemma-3-1b-it` (or `google/gemma-3-12b-it` on a 48 GB card) and compare. If you do not, run the course's scripts and check each predicted row with Little's law ([§2.2](/c/llm-serving/02-benchmarks)) — that teaches the metric definitions faster than reading them.

Pay particular attention to phase 7. The repository found that tensor parallelism made things *worse* on PCIe-only `g6e` instances and better on NVLink `p4d` instances. Same code, same model. That is the week's lesson: the bottleneck decides, not the hardware count.

**Target.** Compute the bf16 KV pool on one L40S — 46,068 MiB × 0.90 = 40.49 GiB, minus 21.91 GiB of weights and an illustrative 2 GiB reserve, leaves 16.58 GiB, about 35 HelpDesk sequences ([§7.2](/c/llm-serving/07-challenges)) — and check a row by Little's law: \(C = 16\), TTFT 139.5 ms, TPOT 43.2 ms gives 1.435 req/s ([§2.2](/c/llm-serving/02-benchmarks)). For phase 7, explain why four L40S on PCIe deliver about 59% of a single GPU's decode throughput per GPU under TP = 4, against about 80% for A100s on NVLink ([§2.5](/c/llm-serving/02-benchmarks)).

## Week 4 — the frameworks and the ceiling

**Repository:** `ch06/`, `ch08/`, then `ch07/`
**Notes:** [Chapter 6 — Essential techniques](/c/llm-serving/08-essential-techniques), [Chapter 8 — Frameworks](/c/llm-serving/10-frameworks), [Chapter 7 — Advanced techniques](/c/llm-serving/09-advanced-techniques)
**Book:** chapters 6, 8, 7.

Chapter 6's three-way quantisation lab first, because it is the most immediately applicable: one model, three precisions, a concurrency sweep, four charts. Then chapter 8's three notebooks, read as a comparison of setup cost rather than of speed. Then chapter 7, which is the ceiling — speculative decoding and a KV cache that outlives the process.

**Target.** Derive the int4 decode floor for Gemma 3 12B on an L40S, 7.73 GB ÷ 864 GB/s = 8.9 ms per token against 27.2 ms in bf16 ([§8.2](/c/llm-serving/08-essential-techniques)); the 1.86× speculative speed-up of Gemma 3 1B drafting for 27B int4 at an illustrative α = 0.7, k = 4 ([§9.2](/c/llm-serving/09-advanced-techniques)); and the 7.13 GB Q4_K_M file and 14 tokens/s ceiling of the 12B on a 100 GB/s laptop ([§10.3](/c/llm-serving/10-frameworks)).

**Skim:** chapters 4 and 10 ([§6](/c/llm-serving/06-best-practices), [§12](/c/llm-serving/12-advancements)). Chapter 4 is organisational and cloud-shaped, and chapter 10 has no code in the repository at all. Both are worth reading — §6 shows that prefix caching cuts an eight-call agent task from 17,600 prefill tokens to 2,132, and §12 sizes a rank-16 LoRA adapter at 131 MB — but neither will change what you type this month.

## If you have one evening

Read `ch03/single_model_llm_serving/llm/workload_manager.py` and `model_worker.py`, then [The single-model service, file by file](/c/llm-serving/13-single-model-service), then the [Benchmarks](/c/llm-serving/02-benchmarks) page. That is the whole arc: a queue, a model, and what the numbers should look like when you measure it.

## Reading with the code open

A habit worth keeping: for each chapter, write two sentences.

*"This chapter explains why `path/to/file.py` does X."*

*"This chapter explains what `path/to/file.py` cannot do."*

If the second sentence is hard to fill in, you have read a description rather than a specification, and the chapter deserves a second pass.
