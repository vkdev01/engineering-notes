---
section: "3"
title: "Chapter 1 \u2014 Serving and optimization"
kicker: "Chapter notes"
abstract: "No code in this chapter. What the repository's shape still tells you about serving paradigms and the model lifecycle."
time: "3 min"
order: 3
---
**Covers:** anatomy of a model, the model lifecycle, what serving is, why we optimise it, serving paradigms (edge, single-model, multi-model), serving platforms.

**In the repository:** no code. Chapters 1 and 5 are conceptual, and there is no `ch01/` directory. What the repository gives you is the *shape* of the chapter's taxonomy, visible in how the code is organised.

## Where the paradigms appear in the code

The chapter separates single-model serving from multi-model serving, and the repository implements both, side by side, in one directory.

| Paradigm | Where | What makes it that paradigm |
| --- | --- | --- |
| Single-model | `ch03/single_model_llm_serving/` | One model loaded at startup, a workload manager batching requests against it, no residency decisions |
| Multi-model | `ch03/multi_model_serving/` | An LRU cache holding at most two models (`max_models: int = 2`), loading and evicting on demand |
| Cloud-managed | `ch04/bedrock/`, `ch04/jumpstart/` | No serving code at all — the vendor owns the model, the notebook owns the request |
| Container-served | `ch04/dlc/`, `ch04/dlc_customization/` | You ship a model definition and a container image; SageMaker runs it |

Reading the two `ch03` services against each other is the fastest way to feel what the chapter means by "paradigm". The single-model service spends its complexity on queues, batching and process isolation. The multi-model service spends it on metadata, a cache, and a factory that decides which kind of worker to build. Same problem, opposite distribution of effort.

## The lifecycle, as four directories

The chapter's model lifecycle — fetch, load, serve, retire — shows up as separate concerns rather than separate directories:

```python
# ch03/single_model_llm_serving/llm/model_manager.py
def load_model(self, model_name: str = "facebook/opt-125m") -> tuple[AutoModelForCausalLM, AutoTokenizer]:
    os.makedirs(self.model_dir, exist_ok=True)
    model = AutoModelForCausalLM.from_pretrained(model_name)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    return model, tokenizer
```

That is the whole of "fetch and load" in the repository: fifteen lines, a cache directory that is created but never populated, and `from_pretrained` doing the work. The interesting lifecycle engineering in a real system — revision pinning, integrity checks, partial downloads, atomic swaps — is not here, because the chapter is about serving rather than distribution.

## What to read it for

Two ideas survive into every later chapter, and both are visible in the code.

**Optimisation is a trade, not a speed-up.** Chapter 3's two services make it concrete: the single-model service batches aggressively to raise throughput, which raises tail latency; the multi-model service keeps two models warm to cut cold-start latency, which costs memory that could have gone to KV cache. Neither is "better".

**Serving is a queueing problem.** The single-model service's `WorkloadManager` exists because requests arrive faster than the model can serve them, and something has to decide who goes next. Every framework in chapter 8 is, at bottom, a better answer to that question.

## Checkpoint

1. Which of the four paradigms is `ch03/multi_model_serving/`, and what is the constant that decides how many models it holds?
2. Where in the repository would you look for the "retire a model" half of the lifecycle, and what do you find?
3. Name one thing the single-model service trades away to raise throughput.

## Where this leads

Chapter 3 is the next stop, and the [single-model walkthrough](/c/llm-serving/13-single-model-service/) is the fastest route into it.
