---
section: "24"
title: "Benchmarking"
kicker: "Testing"
abstract: "Latency, throughput and cost measured honestly — plus the harness that keeps your numbers comparable across runs."
time: "5 min"
order: 24
outcomes:
  - "Measure p50, p95 and p99 so two runs stay comparable"
  - "Report cost per case in every table"
  - "Set regression gates that fire on real regressions"
---

Benchmark claims decay fast and are easy to fake accidentally. This chapter is about measuring so that two runs a
month apart are comparable: same harness, same warm-up, same reporting shape.

## What to measure

| Metric | Definition | Why it matters |
| --- | --- | --- |
| p50 / p95 / p99 latency | Per-request wall time, warm | The p99 is what your SLA is written against |
| Throughput | Requests per second at fixed concurrency | Sizing and cost per case |
| Time to first token | Generation models only | Dominates perceived latency in interactive use |
| Peak RSS | Resident memory after warm-up | Container sizing, edge fit |
| Cold start | Load + first inference | Autoscaling and serverless viability |
| Energy (optional) | Joules per 1k decisions | Edge and battery-powered deployments |

## Harness rules

1. **Warm up.** Run 20 requests and discard them. First-call latency includes allocator and cache effects that never recur.
1. **Fix the input distribution.** Benchmark on your real length distribution, not on 128-token sentences, unless you say so.
1. **Batch honestly.** Batch-1 latency and batch-32 throughput are different products. Report both, labelled.
1. **Pin the environment.** Threads (`OMP_NUM_THREADS`), quantisation, dtype, and the exact commit.
1. **Repeat.** Three runs, report the median of the p95s, and note the spread.

## Minimal harness

```python
import time, statistics, numpy as np, torch

def benchmark(fn, inputs, warmup=20, repeat=3):
    for x in inputs[:warmup]:
        fn(x)
    runs = []
    for _ in range(repeat):
        ts = []
        for x in inputs:
            t0 = time.perf_counter(); fn(x); ts.append((time.perf_counter() - t0) * 1000)
        runs.append({"p50": np.percentile(ts, 50), "p95": np.percentile(ts, 95),
                     "p99": np.percentile(ts, 99), "mean": statistics.mean(ts)})
    return {k: statistics.median([r[k] for r in runs]) for k in runs[0]}

torch.set_num_threads(4)
res = benchmark(lambda t: model.decide(t), sample_texts)
print({k: round(v, 1) for k, v in res.items()})
```

## Reference latency table

Illustrative figures for a 360M decoder and a 66M encoder, batch 1, 4 vCPU, 256 input tokens, INT8. Measure your own;
the ratios are the transferable part.

| Model | Hardware | p50 | p95 | Throughput | Peak RSS |
| --- | --- | --- | --- | --- | --- |
| 66M encoder, classification | 4 vCPU | 4 ms | 9 ms | ~230 req/s | 310 MB |
| 66M encoder, classification | Raspberry Pi 4 | 38 ms | 61 ms | ~24 req/s | 290 MB |
| 360M decoder, 1 label token | 4 vCPU | 24 ms | 41 ms | ~40 req/s | 520 MB |
| 360M decoder, 32 generated tokens | 4 vCPU | 210 ms | 380 ms | ~4.5 req/s | 540 MB |
| 360M decoder, 32 tokens | 1× T4 GPU | 55 ms | 78 ms | ~110 req/s | 1.1 GB |
| 1.7B decoder, 32 tokens | 1× T4 GPU | 190 ms | 260 ms | ~32 req/s | 3.4 GB |
:::warn[Generation dominates]
Note the jump from 24 ms to 210 ms when the model must emit 32 tokens instead of one. If your decision fits in a
single label token, force it — the latency difference is larger than any quantisation gain.
:::

## Accuracy benchmarking

```python
from slm_decision import evaluate_policy

rows = []
for name, policy in [("rules", rule_policy), ("slm-360m", slm_policy), ("cascade", cascade)]:
    r = evaluate_policy(spec, policy, y_true=y_test, scores=p_test)
    rows.append({"policy": name, **r.to_dict()})

pd.DataFrame(rows)[["policy","accuracy","macro_f1","cost_per_case","abstain_rate","ece"]]
```

Report cost per case alongside accuracy in every table. A policy that is 3 points less accurate but halves cost per
case is usually the right choice, and the table should make that visible without a footnote.

## Regression gates for CI

| Gate | Threshold | Action on failure |
| --- | --- | --- |
| Macro-F1 vs baseline | −1.0 point | Fail the build |
| p95 latency | +20% vs main | Fail the build |
| Peak RSS | +15% vs main | Warn, fail above +30% |
| Abstain rate | outside [0.8×, 1.2×] of baseline | Fail — it usually means a threshold or prompt bug |
| ECE | > 0.05 after calibration | Fail |

Benchmark results belong in the repo, dated, next to the model artefact. A latency claim with no date, hardware
description and commit hash is folklore.

:::exercise[Exercise 24.1 · Audit how you measure]{id="checklist" items="Warm-up requests are discarded;Inputs follow the production length mix;Batch size is stated, not implied;Threads and quantisation are pinned;p50 and p95 are both reported;Three runs, median reported" grades="A,B,C,D,F"}
:::

