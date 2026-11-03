---
section: "16"
title: "Reading plan"
kicker: "Plan"
abstract: "Four weeks, pairing one part of the book with one part of the repository. Start at chapter 3, not chapter 1."
time: "3 min"
order: 16
---
Four weeks, each pairing one part of the book with one part of the repository. The order is not the book's order: it starts with chapter 3, because that is the only place a whole serving system is assembled and every later chapter either explains one of its parts or replaces it.

## Week 1 — the service

**Repository:** `ch03/single_model_llm_serving/`
**Notes:** [single-model walkthrough](/c/llm-serving/13-single-model-service/)
**Book:** chapter 3.

Run it first (`python main.py`, then `curl` the four endpoints), then read the code in dependency order: `main.py` → `llm.py` → `workload_manager.py` → `model_executor.py` → `model_worker.py`.

The thing to look for is the queue. Every other design decision in the directory — separate streaming and batch queues, a fixed batch size of four, a background thread, a worker process — follows from "requests arrive faster than the model can serve them."

If you finish the week with one question, make it this: what does `use_cache=False` in `model_worker.py` cost, and how would you see the cost in a chart?

## Week 2 — the model

**Repository:** `ch02/`
**Book:** chapter 2.

Five notebooks, in this order: transformer internals, execution walkthrough, vLLM comparison, batching, streaming.

`ch2_Workthrough_LLM_execution.ipynb` is the one that answers week 1's question. It times each generated token and plots the result, and the first bar dwarfs the rest. That chart is what `use_cache=False` throws away on every step.

Read `ch02/streaming.py` afterwards and compare it with `llm/llm.py`'s `event_generator`: the same problem (blocking producer, async consumer) solved with a framework's async engine and by hand with queues and threads.

## Week 3 — the measurements

**Repository:** `ch09/model_optimization_in_practice.ipynb`
**Notes:** [benchmark method](/c/llm-serving/15-benchmark-method/), [Benchmarks](/c/llm-serving/02-benchmarks/)
**Book:** chapters 5 and 9.

Chapter 5 has no code, and this is the week it becomes concrete: memory sizing, TTFT versus TPOT, and why quantisation changes both. Chapter 9's seven phases are the method, and its recorded results are the worked example.

If you have a GPU, run phases 1 to 6 on your own hardware with a smaller model. If you do not, read the recorded JSON and reconstruct the tables on the Benchmarks page by hand — that exercise teaches the metric definitions faster than reading them.

Pay particular attention to phase 7. On `g6e`, four GPUs were *slower* than one; on `p4d`, four GPUs were 1.6× faster. Same code, same model. That is the week's lesson: the bottleneck decides, not the hardware count.

## Week 4 — the frameworks and the ceiling

**Repository:** `ch06/`, `ch08/`, then `ch07/`
**Book:** chapters 6, 8, 7.

Chapter 6's three-way quantisation lab first, because it is the most immediately applicable: one model, three precisions, a concurrency sweep, four charts. Then chapter 8's three notebooks, read as a comparison of setup cost rather than of speed. Then chapter 7, which is the ceiling — speculative decoding and a KV cache that outlives the process.

**Skim:** chapters 1, 4 and 10. Chapter 1 is vocabulary, chapter 4 is organisational and cloud-shaped, and chapter 10 has no code in the repository at all. All three are worth reading; none of them will change what you type this month.

## If you have one evening

Read `ch03/single_model_llm_serving/llm/workload_manager.py` and `model_worker.py`, then the [single-model walkthrough](/c/llm-serving/13-single-model-service/), then the [Benchmarks](/c/llm-serving/02-benchmarks/) page. That is the whole arc: a queue, a model, and what the numbers look like when you measure it.

## Reading with the code open

A habit worth keeping: for each chapter, write two sentences.

*"This chapter explains why `path/to/file.py` does X."*

*"This chapter explains what `path/to/file.py` cannot do."*

If the second sentence is hard to fill in, you have read a description rather than a specification, and the chapter deserves a second pass.
