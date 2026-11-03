---
section: "11"
title: "Chapter 9 \u2014 In practice"
kicker: "Chapter notes"
abstract: "Seven phases on Qwen3-14B, and the distributed phase that contradicts the intuition that more GPUs are better."
time: "4 min"
order: 11
---
**Covers:** a step-by-step optimisation plan for Qwen3-14B with vLLM — hardware inspection, benchmarking, quantisation, distributed serving, trade-offs.

**In the repository:** `ch09/model_optimization_in_practice.ipynb`, structured in seven explicit phases. This is the chapter to copy wholesale.

| Phase | What it does |
| --- | --- |
| 0 | Install dependencies, define helpers: `start_vllm_serve`, `check_vllm_status`, `plot_vllm_bench_metrics` |
| 1 | Examine the GPU with `nvidia-smi` queries |
| 2 | Generate benchmark traffic — inspect the ShareGPT dataset, then a prefix-repetition dataset |
| 3 | Define the metrics |
| 4 | Start the vLLM server with Qwen3-14B |
| 5 | Benchmark the baseline |
| 6 | Benchmark the quantised model (AWQ) and compare |
| 7 | Benchmark distributed serving across GPU counts and instance types |

## Phase 1 — inspect before you plan

```bash
!nvidia-smi --query-gpu=name,compute_cap,memory.free,memory.used,memory.total --format=csv
```

Name, compute capability, and the memory split. The free-memory number is the one that decides whether your plan is "quantise" or "add a GPU", and it is the number people guess instead of reading.

## Phase 2 — generate traffic, then read it

The notebook inspects the dataset before benchmarking with it:

```bash
!python3 inspect_dataset.py \
    --dataset-name sharegpt \
    --dataset-path ShareGPT_V3_unfiltered_cleaned_split.json \
    --model Qwen/Qwen3-14B --num-prompts 100 --save-samples
```

Then it builds a second workload with controlled structure — a prefix-repetition dataset with `--prefix-repetition-prefix-len 256`, `--prefix-repetition-suffix-len 256`, `--prefix-repetition-num-prefixes 5`, `--prefix-repetition-output-len 128`.

Two workloads, deliberately. ShareGPT is realistic mixed traffic; prefix repetition isolates cache behaviour. If you only ever benchmark on realistic traffic, you cannot tell a caching win from a lucky prompt mix.

## Phase 3 — four metrics

The notebook narrows vLLM's output to four metrics, and the choice is the lesson:

- **throughput** — what the machine costs to run
- **TTFT** — what the user feels first
- **TPOT** (time per output token) — what they feel continuously
- **p99** — whether the average is hiding a tail

## Phases 4–6 — baseline, then one change

The server is started once for Qwen3-14B, benchmarked at several rates and concurrency levels, then killed, and the same procedure is repeated for `Qwen/Qwen3-14B-AWQ`. The notebook records that loading the AWQ model took 9.3619 GiB and 88.46 seconds, and includes a note to open `vllm.log` and read the memory-usage lines yourself.

The measured difference is large and worth internalising: request throughput 1.11 → 2.98 req/s, output tokens 227.8 → 614.9 tok/s, mean TPOT 43.3 → 16.0 ms, on ShareGPT at rate 10 and concurrency 10. See [Benchmarks](/c/llm-serving/02-benchmarks/) for the full tables.

## Phase 7 — distribute, and discover the ceiling

The last phase is the most valuable, because it does not produce the answer people expect. The same AWQ model, benchmarked with tensor parallelism across `g6e` and `p4d` instances:

- on `g6e`, going from 1 to 2 to 4 GPUs made throughput *worse* (4.81 → 4.02 → 4.09 req/s) and TTFT worse (67.9 → 104.6 → 106.2 ms)
- on `p4d`, going from 1 to 4 GPUs improved throughput 5.72 → 9.14 req/s and cut mean TTFT 66.7 → 33.5 ms

The notebook states the trade-off plainly: four single-GPU replicas would out-serve one model spread over four GPUs, so the multi-GPU configuration is buying latency, not throughput.

That is the lesson of the chapter, and you cannot get it from a spec sheet. Tensor parallelism requires an all-reduce per layer; whether that is cheap depends on the interconnect, and the only way to know is to measure on the machine you actually have.

## Checkpoint

1. Why does the notebook build a prefix-repetition workload in addition to ShareGPT?
2. What are the four metrics, and what does each one protect you from?
3. On which instance type did tensor parallelism hurt, and what does that tell you about the bottleneck?
4. What is the one variable that changes between Phase 5 and Phase 6?

## Next

The [benchmark method walkthrough](/c/llm-serving/15-benchmark-method/) turns these phases into a checklist you can apply to your own model.
