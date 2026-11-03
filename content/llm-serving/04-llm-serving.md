---
section: "4"
title: "Chapter 2 \u2014 LLM serving"
kicker: "Chapter notes"
abstract: "Five notebooks that take a transformer apart: config, attention, memory, per-token timing, vLLM versus plain Transformers."
time: "3 min"
order: 4
---
**Covers:** inside the transformer, autoregressive generation, decoder-only architecture, attention, the KV cache, prefill and decode, and running a model with vLLM.

**In the repository:** five notebooks in `ch02/`, plus a standalone `streaming.py`.

| Notebook | What it does |
| --- | --- |
| `ch2_Inside_the_Mind_of_a_Transformer.ipynb` | Loads Qwen2.5-0.5B, prints `model.config`, computes the memory footprint, walks the architecture and the attention layer, and visualises attention with `bertviz` |
| `ch2_Workthrough_LLM_execution.ipynb` | Runs generation with a plain Transformers pipeline, then re-implements it step by step to time each token, plot the per-token latency, and show how context length affects generation |
| `ch2_Run_LLM_With_vLLM.ipynb` | Runs the same model through vLLM, then through plain Transformers, and prints the latency difference |
| `ch2_Batching.ipynb` | Sends a batch of prompts through vLLM and times it against one-at-a-time |
| `ch2_Streaming.ipynb` | Async streaming with `AsyncEngineArgs`; the notebook says to run `streaming.py` for the real thing because of the Jupyter event loop |

## The one notebook to run first

`ch2_Workthrough_LLM_execution.ipynb` is the chapter in executable form. It takes generation apart: the pipeline call first, then the same thing written out with an explicit loop, timing each step and plotting the result. The plot is the point — the first bar is enormous and the rest are a flat line, and that single chart is the prefill/decode asymmetry that every later chapter optimises against.

`ch2_Inside_the_Mind_of_a_Transformer.ipynb` complements it from the other direction. It includes an explicit memory calculation function, so you can see the arithmetic behind a model's footprint rather than taking a table on faith, and `bertviz` attention visualisations that make "attention over the whole prefix" visible rather than abstract.

## What the code makes concrete

Three things that are easy to read past in prose:

**The first token is a different operation.** In the walkthrough, the first step processes the whole prompt and every later step processes one token. The timing chart is not a warm-up artefact; it is two different workloads.

**vLLM changes the serving path, not the model.** `ch2_Run_LLM_With_vLLM.ipynb` loads the same weights through a different runtime and compares latency. Nothing about the transformer changed — the scheduler and the KV memory manager did.

**Streaming is an async problem, not a model problem.** `ch2_Streaming.ipynb` reaches for `AsyncEngineArgs` and an async generator, and warns that Jupyter's event loop will fight you. The notebook explicitly points at `streaming.py` for a real run. That file is worth reading: it is the same pattern the chapter 3 service reimplements by hand with queues and threads.

## Reading `streaming.py` beside chapter 3

`ch02/streaming.py` streams tokens from vLLM's async engine. `ch03/single_model_llm_serving/llm/llm.py` streams tokens from a worker process through an `asyncio.Queue`, bridged with `asyncio.run_coroutine_threadsafe`. Both solve "a blocking producer, an async consumer, and a client that may disconnect"; the first lets the framework handle it, the second does it manually so you can see the moving parts.

## Checkpoint

1. Which notebook produces the per-token latency chart, and what does its first bar represent?
2. In the memory calculation notebook, which terms dominate for a 0.5B model, and which for a 7B model with a long context?
3. Why does the streaming notebook tell you to run a script instead?

## Next

[Chapter 3](03-system-design.md) turns these pieces into a service.
