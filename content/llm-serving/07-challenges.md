---
section: "7"
title: "Chapter 5 \u2014 Challenges"
kicker: "Chapter notes"
abstract: "No code, but the arithmetic that makes every other number in the repository readable. Where each question gets answered."
time: "3 min"
order: 7
---
**Covers:** why optimisation matters, accelerator chips and GPU specs, model-loading bottlenecks, KV cache sizing, arithmetic-intensity analysis of prefill and decode.

**In the repository:** no code. Like chapter 1, this chapter is conceptual, and there is no `ch05/` directory. But it is the chapter that tells you how to read every number the rest of the repository produces, so it is worth knowing which later artefacts answer which of its questions.

## Where each question gets answered in the code

| Chapter 5 question | Answered by | What it shows |
| --- | --- | --- |
| What hardware do I have? | `ch09` Phase 1 | `nvidia-smi --query-gpu=name,compute_cap,memory.free,memory.used,memory.total --format=csv` |
| What does a model cost in memory? | `ch02/ch2_Inside_the_Mind_of_a_Transformer.ipynb` | An explicit memory-calculation function you can edit |
| How long does loading take? | `ch09` Phase 6 | "Model loading took 9.3619 GiB and 88.463658 seconds" for Qwen3-14B-AWQ |
| Is my workload compute- or bandwidth-bound? | `ch02/ch2_Workthrough_LLM_execution.ipynb` | The per-token timing chart: a huge first step, a flat tail |
| Does quantisation actually help? | `ch06`, `ch09` | Three-way comparison; fp16 versus AWQ throughput and TPOT |

## The arithmetic, from the notebooks

Two formulas cover most of what the chapter does, and both are computable from what the repository prints.

```
weights ≈ parameters × bytes_per_parameter
KV cache ≈ 2 × layers × kv_heads × head_dim × context × sessions × bytes
```

The first is why `ch09`'s note that Qwen3-14B-AWQ occupies 9.36 GiB is checkable: a 14B model at roughly 4 bits plus overhead lands near that number, and a 14B model at fp16 would need roughly 28 GiB — which is why quantisation is what makes it fit a single GPU with room for KV.

The second is why `max_model_len` and concurrency interact the way they do in every vLLM invocation in the repository. The notebooks pass `--gpu-memory-utilization` and `--max-model-len` explicitly for exactly this reason; those flags are the chapter's formulas, as command-line arguments.

## The single most useful chart in the repository

`ch2_Workthrough_LLM_execution.ipynb` plots the time taken for each generated token, with the first bar in a different colour. It is worth generating on your own hardware once, because it converts three abstract claims into one picture:

- prefill and decode are different operations
- the first token's cost scales with prompt length, the rest do not
- decode speed is roughly flat, so total latency is roughly linear in tokens generated

Once you have seen it, the ordering of experiments in chapter 9 — baseline, then quantise, then scale out — stops being arbitrary and becomes the obvious way to attack whichever bar is too tall.

## What to read it for

Read chapter 5 for the habit of asking *which resource is the bottleneck* before changing anything. The repository's own results show why: on `g6e`, four GPUs performed worse than one, because the bottleneck was interconnect rather than compute. No amount of GPU would have helped; the answer was a different instance type.

## Checkpoint

1. A 14B model at fp16 needs roughly how much memory for weights, and what does AWQ change about that?
2. Which two flags in the repository's vLLM commands encode the KV-cache calculation?
3. From the `g6e` versus `p4d` results, what was `g6e`'s bottleneck when tensor parallelism was added?

## Next

[Chapter 6](06-essential.md), where the optimisation techniques begin.
