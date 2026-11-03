---
section: "8"
title: "Chapter 6 \u2014 Essential techniques"
kicker: "Chapter notes"
abstract: "One model served at three precisions, benchmarked across a concurrency sweep, and what the sweep is really testing."
time: "3 min"
order: 8
---
**Covers:** request batching and scheduling, scalable attention and kernel fusion, model compression (quantisation, distillation, pruning), prefix caching and RadixAttention.

**In the repository:** `ch06/quantization_3way_300.ipynb` — one model served at three precisions, benchmarked with vLLM's own benchmark script, then plotted.

## What the notebook does

The model is `Qwen/Qwen2.5-7B-Instruct`, served three ways:

| Run | Model ID | Precision |
| --- | --- | --- |
| 1 | `Qwen/Qwen2.5-7B-Instruct` | fp16 |
| 2 | `Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4` | 4-bit weight-only (GPTQ) |
| 3 | `RedHatAI/Qwen2.5-7B-Instruct-FP8-dynamic` | 8-bit floating point |

Each run follows the same four steps: start `vllm serve` in the background with `--disable-log-requests`, wait for it to come up, benchmark it, then `pkill -f "vllm serve"` and check it is gone.

```bash
!nohup vllm serve {hf_model_id} --disable-log-requests > vllm.log 2>&1 &
```

The benchmark is the script shipped inside vLLM itself, cloned alongside the library:

```bash
!python3 {benchmark_script} \
  --backend vllm --model {hf_model_id} --endpoint /v1/completions \
  --dataset-name sharegpt \
  --dataset-path /content/ShareGPT_V3_unfiltered_cleaned_split.json \
  --num-prompts 100 --max-concurrency 100 \
  --save-result --append-result --result-filename vllm_bench.json
```

The notebook sweeps concurrency — 1, 10, 100 — and appends every result to one JSON file, which the final cells load and plot as four comparison charts.

## Why the concurrency sweep is the whole experiment

Quantisation changes memory, and memory changes how many sequences fit at once. A single-concurrency comparison would show you a faster token rate and tell you nothing about throughput. Sweeping concurrency shows where the curve bends: at concurrency 1 you are measuring latency, at 100 you are measuring how much of the GPU you can keep busy, and quantisation moves both.

This is the practical form of the chapter's argument. Compression is not a speed-up applied to a fixed system; it changes the system's capacity, so you have to measure at more than one operating point.

## What is in the notebook, and what is not

Present: the serving commands, the benchmark invocations, the result accumulation, the plots.

Not present: a summary table of the results, or a discussion of quality. The notebook measures throughput and latency; it does not evaluate whether the 4-bit model is still good at the task. If you are choosing a precision for production, that is the missing half, and no amount of tokens-per-second will fill it.

Also absent: distillation and pruning. The chapter covers them; the repository's lab only covers quantisation, which is the technique that can be applied to a downloaded checkpoint without a training loop.

## Running it yourself

The notebook pins `vllm==0.8.5.post1` and expects a CUDA GPU with enough memory for a 7B model at fp16. It downloads the ShareGPT dataset from the Hub and clones `vllm-project/vllm` for the benchmark script.

If you have less memory, swap the model down — the method is model-agnostic, and the three precisions are the variable under test, not the specific 7B.

## Checkpoint

1. Why does the notebook benchmark at three concurrency levels rather than one?
2. What does `--append-result` give you that a single run does not?
3. Name the two things the chapter covers that this lab does not measure.

## Next

[Chapter 7](07-advanced.md) adds speculative decoding and a KV cache that outlives the request.
