---
section: "12"
title: "Chapter 10 \u2014 Advancements"
kicker: "Chapter notes"
abstract: "No code in the repository for this one. What sits next to each direction, and the two worth building."
time: "3 min"
order: 12
---
**Covers:** semantic caching, performance profiling, multimodal serving, edge AI, multi-LoRA serving, and model serving in reinforcement learning.

**In the repository:** no code. There is no `ch10/` directory, and this is the one chapter whose subject matter the repository does not demonstrate. This page says what that means for how you read it, and where the repository's existing pieces are adjacent to each direction.

## What exists, and what is next to it

| Chapter 10 direction | Nearest thing in the repository | The gap |
| --- | --- | --- |
| Semantic caching | `ch07/LMCache.ipynb` caches KV blocks by prefix | Semantic caching matches by *meaning*, which is a different index and a different correctness risk |
| Performance profiling | `vllm bench serve` output, `--disable-log-requests` and `vllm.log` | Aggregate and per-request metrics exist; end-to-end traces do not |
| Multimodal serving | `ch03/multi_model_serving/` serves an image model (`TorchVisionWorker`, DenseNet via Triton) | Single-image classification, not a multimodal LLM with vision tokens in the KV cache |
| Edge AI | `ch08/llamaCpp.ipynb` runs a GGUF locally | No power, thermal or cold-start measurement |
| Multi-LoRA serving | Nothing | This is the real gap: the repository never serves two adapters over one base model |
| Serving for RL | Nothing | Generation as a rollout, with throughput and determinism as the metrics |

## The two worth caring about

**Multi-LoRA serving** is the direction with the clearest engineering content and the most obvious payoff for a team. The idea is one resident base model with small per-adapter deltas applied per request, rather than N separately merged checkpoints each holding its own full copy of the weights. Memory scales with the number of adapters instead of with the number of fine-tunes, and a request only pays for selecting and applying a delta.

The design questions it raises are concrete and answerable:

- Where does the adapter live — loaded with the model, selected per request, or compiled in?
- What does a cold adapter cost in time-to-first-token?
- How many adapters fit before the deltas rival the base model in memory?

None of these can be answered from the repository, which is exactly why it is worth running the experiment yourself.

**Semantic caching** is the one to approach carefully. Matching requests by embedding similarity and returning a stored answer is cheap to add and dangerous to get wrong: the threshold is a correctness parameter, and a near-miss returns a confidently wrong response. If you build it, log every hit with its similarity score.

## Profiling, from what is already there

The repository gives you more than it looks like. `vllm bench serve` reports TTFT, TPOT and their percentiles per run; `vllm.log` carries the server's own memory and scheduling messages; `nvidia-smi` between phases shows what is resident. What is missing is the per-request waterfall — queue wait, prefill, decode — that turns "p99 is 324 ms" into "p99 is 324 ms because queue wait doubled".

Building that is a small project: timestamp the request on arrival, on first token, and on completion, and you have three segments and a chart.

## Multimodal, and what it breaks

The multi-model service serves an image classifier, which is multimodal in the weak sense: a different input type, a different worker class, the same request shape. A multimodal *LLM* breaks more assumptions — token counts vary with image resolution, prefill costs jump, and the KV cache grows in steps rather than linearly. Every capacity formula from chapter 5 needs re-deriving with a much wider distribution.

## Checkpoint

1. Which chapter 10 direction has the clearest payoff for a team serving several fine-tunes, and why?
2. What is the correctness risk of semantic caching, and what parameter controls it?
3. What three timestamps would turn the repository's aggregate metrics into a per-request profile?
4. Why does a multimodal LLM break the KV-cache arithmetic more than an image classifier does?
