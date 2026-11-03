---
section: "9"
title: "Chapter 7 \u2014 Advanced techniques"
kicker: "Chapter notes"
abstract: "Four speculative-decoding configurations at concurrency 1, and a KV cache that survives the process."
time: "3 min"
order: 9
---
**Covers:** speculative decoding, multi-GPU and multinode inference, prefill–decode disaggregation, advanced KV caching for long context.

**In the repository:** two notebooks in `ch07/`, both of which measure something that only pays off at scale.

## `SpecDecode.ipynb` — four configurations, one model

The model is `Qwen/Qwen3-32B`, served four ways in sequence, with the server torn down and restarted between runs:

| Configuration | What changes |
| --- | --- |
| Vanilla vLLM | Baseline: no speculation |
| n-gram | Speculation from n-gram matches in the prompt, no draft model |
| Improved n-gram | Tuned n-gram configuration |
| Eagle3 | A trained draft head (EAGLE-3) proposing tokens |

The benchmark is `Spec-Bench`, cloned from `hemingkx/Spec-Bench`, run at concurrency 1. That choice is deliberate: speculative decoding is a *latency* technique. It makes each token cheaper by verifying several at once, so it shows up at low concurrency and disappears into queueing at high concurrency.

The notebook pins `vllm==0.11.0`, checks GPU state with `nvidia-smi` between runs, and finishes by loading the result JSON and computing summaries with numpy.

### What to watch for

Two things determine whether speculation pays, and both are visible in the results rather than in the code:

**Acceptance rate.** If the draft proposes tokens the big model would have produced anyway, you win; if it proposes wrong ones, you pay for the verification and gain nothing. n-gram speculation is cheap to try precisely because it needs no second model — it guesses from the prompt's own repetitions.

**Where the time goes.** At concurrency 1, decode dominates, so speculation helps. At high concurrency, decode is batched and the bottleneck moves, so the same technique can lose. The notebook's single-concurrency benchmark is an honest scope choice, not an oversight.

## `LMCache.ipynb` — a KV cache that outlives the request

The setup is `lmcache==0.3.5` with `vllm==0.10.1`, started with `LMCACHE_USE_EXPERIMENTAL=True`, and the experiment is cold versus warm:

```python
time_cold_lmcache = []
for i in range(30)[::-1]:
    ...
```

The notebook runs the same benchmark loop twice — once against a server with LMCache, once against plain vLLM — collecting 30 samples each, then plots the two distributions.

This is the same idea as prefix caching, taken one level further out. vLLM's prefix cache lives in GPU memory and dies with the process. LMCache moves KV blocks to a store that survives restarts and can be shared, so a "cold" request can find its prefix already computed.

The payoff shows up as time-to-first-token on repeated prompts, which is why the notebook measures TTFT rather than throughput.

## Prefill–decode disaggregation

The chapter covers it; neither notebook implements it directly. LMCache is the closest thing in the repository, because moving KV blocks between tiers is the same machinery disaggregation needs. If you want to see disaggregation, the place to look is chapter 9's distributed section, where tensor parallelism changes the prefill/decode balance without separating them.

## Running either notebook

Both need a serious GPU. Qwen3-32B at any precision is not a laptop model, and the whole point of speculative decoding is the ratio between a large model and a cheap proposal mechanism. If you have one GPU, run the n-gram configuration first — it needs no draft model and still shows the mechanism.

## Checkpoint

1. Why is `SpecDecode.ipynb` benchmarked at concurrency 1, and what would change at concurrency 20?
2. What does n-gram speculation use instead of a draft model?
3. What does LMCache keep that a normal prefix cache loses, and which metric reveals the difference?
4. Which notebook is closest to prefill–decode disaggregation, and why?

## Next

[Chapter 8](08-frameworks.md) swaps the framework rather than the technique.
