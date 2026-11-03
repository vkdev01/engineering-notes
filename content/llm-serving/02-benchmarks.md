---
section: "2"
title: "Benchmarks"
kicker: "Getting started"
abstract: "The results the notebooks record: quantisation on Qwen3-14B, prefix repetition, and where tensor parallelism backfires."
time: "4 min"
order: 2
---
The repository's own recorded results, from the notebooks that measured them. Every table below names the model, the dataset, the request rate and the concurrency, because a serving number without those four is not a number.

## Quantisation: Qwen3-14B fp16 versus AWQ

From `ch09/model_optimization_in_practice.ipynb`, ShareGPT workload, 2,000 prompts, request rate 10/s, max concurrency 10, single GPU.

| Metric | Qwen3-14B (fp16) | Qwen3-14B-AWQ | Change |
| --- | --- | --- | --- |
| Request throughput | 1.11 req/s | 2.98 req/s | 2.7× |
| Output token throughput | 227.8 tok/s | 614.9 tok/s | 2.7× |
| Mean TTFT | 103.6 ms | 59.3 ms | 1.7× faster |
| p99 TTFT | 194.4 ms | 168.2 ms | — |
| Mean TPOT | 43.3 ms | 16.0 ms | 2.7× faster |

The notebook also records that loading the AWQ model took 9.3619 GiB and 88.46 seconds. Read the TPOT row against the throughput row: they move by the same factor, which is what you would expect when decode is bandwidth-bound and quantisation shrinks what has to be streamed per token.

## Prefix repetition

Same chapter, 1,000 prompts, request rate 5/s, max concurrency 10, prefix-repetition workload (prompts sharing a long common prefix).

| Metric | fp16 | AWQ |
| --- | --- | --- |
| Request throughput | 1.76 req/s | 4.41 req/s |
| Output token throughput | 223.5 tok/s | 562.6 tok/s |
| Total token throughput | 1,124 tok/s | 2,822 tok/s |
| Mean TTFT | 103.0 ms | 64.2 ms |
| Mean TPOT | 43.9 ms | 17.2 ms |

Total token throughput is 5× the output token throughput here, because most of the traffic is a repeated prefix that gets prefilled and then cached. That gap is the prefix cache doing its job.

## Tensor parallelism, and where it backfires

Same chapter, AWQ model, 2,000 prompts, request rate 20/s, max concurrency 20, ShareGPT, across two instance types.

| Setup | GPUs | Request throughput | Output tok/s | Mean TTFT | p99 TTFT | Mean TPOT |
| --- | --- | --- | --- | --- | --- | --- |
| g6e | 1 | 4.81 req/s | 992 tok/s | 67.9 ms | 203.7 ms | 19.8 ms |
| g6e | 2 | 4.02 req/s | 828 tok/s | 104.6 ms | 329.5 ms | 23.8 ms |
| g6e | 4 | 4.09 req/s | 843 tok/s | 106.2 ms | 324.6 ms | 23.5 ms |
| p4d | 1 | 5.72 req/s | 1,178 tok/s | 66.7 ms | 198.0 ms | 16.7 ms |
| p4d | 2 | 7.78 req/s | 1,604 tok/s | 44.2 ms | 121.6 ms | 12.2 ms |
| p4d | 4 | 9.14 req/s | 1,885 tok/s | 33.5 ms | 78.2 ms | 10.4 ms |

Two things to take from this table. On `g6e`, adding GPUs made everything *worse* — throughput fell and TTFT rose. On `p4d`, four GPUs gave 1.6× the request throughput and half the TTFT. Tensor parallelism splits every layer's matrices and needs an all-reduce per layer, so whether it helps is a question about interconnect bandwidth, not about how many GPUs you bought.

The notebook states the trade-off directly: *"Overall throughput will be lower, since 1 gpu x 4 > 4 gpu, so we are trading off throughput for latency in this case."* Four single-GPU replicas would serve more total requests than one model spread over four GPUs; the four-GPU run wins on latency per request.

## Three-way quantisation: Qwen2.5-7B

From `ch06/quantization_3way_300.ipynb`, which serves the same model three ways — `Qwen/Qwen2.5-7B-Instruct` in fp16, `Qwen/Qwen2.5-7B-Instruct-GPTQ-Int4`, and `RedHatAI/Qwen2.5-7B-Instruct-FP8-dynamic` — and benchmarks each with vLLM's benchmark script before plotting four comparison charts.

The notebook records the harness and the plots rather than a summary table; the four charts at the end are the deliverable. Run it on your own GPU to get numbers for your hardware — the useful part is the method (one model, three precisions, one benchmark script, four charts), not a figure that will not transfer.

## What the metrics mean

The notebooks use vLLM's benchmark output fields throughout:

| Field | Meaning |
| --- | --- |
| `request_throughput` | Completed requests per second |
| `output_throughput` | Generated tokens per second |
| `total_token_throughput` | Prompt plus generated tokens per second |
| `mean_ttft_ms`, `p99_ttft_ms` | Time to first token — dominated by prefill and queueing |
| `mean_tpot_ms` | Time per output token, i.e. inter-token latency during decode |

Chapter 9 focuses on four of these, and the choice is the lesson: throughput tells you what the machine costs to run, TTFT tells you what the user feels first, TPOT tells you what they feel continuously, and p99 tells you whether the average is a lie.

:::note[Comparing across chapters]
Chapter 6 uses Qwen2.5-7B, chapter 7 uses Qwen3-32B, chapter 9 uses Qwen3-14B. Different models, different instance types, different datasets. The *ordering of experiments* transfers; the numbers do not.
:::
