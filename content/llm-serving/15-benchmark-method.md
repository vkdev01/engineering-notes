---
section: "15"
title: "The benchmark method"
kicker: "Code walkthroughs"
abstract: "Chapter 9's seven phases as a reusable checklist, plus the four metrics and what each one protects you from."
time: "4 min"
order: 15
---
Chapter 9's seven phases are the most reusable thing in the repository. This page turns them into a checklist, and adds what chapters 6 and 7 do differently.

## The method, in order

:::mermaid
flowchart LR
    A["1. Inspect<br/>the GPU"] --> B["2. Generate<br/>traffic"]
    B --> C["3. Define<br/>metrics"]
    C --> D["4. Start the<br/>server"]
    D --> E["5. Baseline<br/>benchmark"]
    E --> F["6. Change one<br/>thing, re-run"]
    F --> G["7. Scale out,<br/>re-run"]
:::

The ordering is the argument. Benchmarking before changing anything is what lets you attribute a difference to the change; and quantising before benchmarking is the common mistake, because it makes everything smaller and hides the bottleneck you were looking for.

## Phase 1 — inspect the hardware

```bash
!nvidia-smi --query-gpu=name,compute_cap,memory.free,memory.used,memory.total --format=csv
```

Record all five fields. `memory.free` decides whether your plan is quantise, shard, or buy; `compute_cap` decides which kernels you can use; `name` decides whether tensor parallelism is even plausible.

## Phase 2 — generate traffic, then read it

Two workloads, and both are necessary:

```bash
# realistic mixed traffic
!python3 inspect_dataset.py --dataset-name sharegpt \
    --dataset-path ShareGPT_V3_unfiltered_cleaned_split.json \
    --model Qwen/Qwen3-14B --num-prompts 100 --save-samples

# controlled structure: shared prefixes
!python inspect_dataset.py --dataset-name prefix_repetition \
    --model Qwen/Qwen3-14B --num-prompts 50 \
    --prefix-repetition-prefix-len 256 --prefix-repetition-suffix-len 256 \
    --prefix-repetition-num-prefixes 5 --prefix-repetition-output-len 128 \
    --save-samples
```

ShareGPT tells you how you will actually be loaded. Prefix repetition isolates cache behaviour, because every prompt shares a known prefix. Benchmark only on realistic traffic and you cannot tell a caching win from a lucky prompt mix.

## Phase 3 — four metrics

| Metric | What it protects you from |
| --- | --- |
| Throughput | Paying for idle GPUs |
| TTFT | A user staring at nothing |
| TPOT | A user watching text crawl |
| p99 | An average that hides a tail |

## Phase 4–5 — start, then baseline

```bash
!vllm bench serve --backend vllm --base-url "http://localhost:8000" \
    --dataset-name sharegpt --dataset-path ShareGPT_V3_unfiltered_cleaned_split.json \
    --num-prompts 2000 --request-rate 10 --burstiness 1.0 \
    --max-concurrency 10 --model Qwen/Qwen3-14B \
    --save-result --append-result --result-filename test_serve_results.txt
```

`--request-rate` plus `--max-concurrency` is the pair that defines the operating point. Rate is what you offer; concurrency is what the server is allowed to hold in flight. Vary one at a time.

Also read the server's own log. The notebook records one such line: *"Model loading took 9.3619 GiB and 88.463658 seconds"* — a number no client-side benchmark will ever show you, and one that decides whether cold starts are acceptable.

## Phase 6 — one change

Stop the server, start the quantised variant, run the identical command:

| Metric (ShareGPT, rate 10, concurrency 10) | fp16 | AWQ |
| --- | --- | --- |
| Request throughput | 1.11 req/s | 2.98 req/s |
| Output token throughput | 227.8 tok/s | 614.9 tok/s |
| Mean TTFT | 103.6 ms | 59.3 ms |
| Mean TPOT | 43.3 ms | 16.0 ms |

One variable, one table. Full tables on the [Benchmarks](/c/llm-serving/02-benchmarks/) page.

## Phase 7 — scale out, and expect surprises

The distributed phase is where the method pays for itself, because it produces a result that contradicts the intuition that more GPUs are better:

| Setup | Request throughput | Mean TTFT |
| --- | --- | --- |
| g6e, 1 GPU | 4.81 req/s | 67.9 ms |
| g6e, 4 GPUs | 4.09 req/s | 106.2 ms |
| p4d, 1 GPU | 5.72 req/s | 66.7 ms |
| p4d, 4 GPUs | 9.14 req/s | 33.5 ms |

Same model, same quantisation, same workload — opposite outcomes. Tensor parallelism needs an all-reduce per layer, so the interconnect decides. Measure on the machine you will actually run on.

## What chapters 6 and 7 do differently

**Chapter 6** keeps the model fixed and varies precision across three runs (fp16, GPTQ-Int4, FP8-dynamic), sweeping concurrency 1 → 10 → 100 and appending every result to one JSON file. It uses vLLM's bundled `benchmarks/benchmark_serving.py` rather than the `vllm bench serve` subcommand, because the notebook pins `vllm==0.8.5.post1`.

**Chapter 7** keeps the model fixed and varies the *decoding strategy* (vanilla, n-gram, improved n-gram, Eagle3) at concurrency 1, using Spec-Bench. Concurrency 1 is deliberate: speculation is a latency technique, and batching would hide it.

All three follow the same skeleton — fix the model, change one axis, re-measure with an identical workload, record the result. That skeleton is the transferable asset.

## A checklist you can reuse

1. Record the hardware before anything else.
2. Build two workloads: realistic, and one that isolates the effect you care about.
3. Fix the metrics before you see any results.
4. Benchmark the baseline until the numbers are stable across runs.
5. Change exactly one thing.
6. Re-run the identical command, same rate, same concurrency.
7. Write down what changed, by how much, and on which machine.
8. Repeat for scaling only after you know what the single-machine bottleneck was.
