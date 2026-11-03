---
section: "30"
title: "Model comparison"
kicker: "Benchmarks"
abstract: "How SLMs compare with each other, with frontier APIs and with non-neural baselines — on decision metrics, not benchmarks."
time: "5 min"
order: 30
outcomes:
  - "Include the baselines that make a comparison honest"
  - "Compare models under one fixed policy and abstain cap"
  - "Climb the distillation ladder only when the cost justifies it"
---

The useful comparison is not "which model scores highest on MMLU". It is "which model gives the lowest cost per
case at my latency budget and my abstain capacity". Those are different questions with different winners.

## Baselines you must include

1. **Majority class.** Establishes the floor. If your model does not beat it by 10 points, something is broken.
1. **TF-IDF + logistic regression.** Absurdly strong on text classification; frequently within 2–5 points of a fine-tuned transformer at 1/1000th the cost.
1. **Gradient boosting on engineered features.** The incumbent in most enterprises.
1. **Frontier API with a good prompt.** The quality ceiling and the cost comparison.

:::note[If the SLM does not beat the logistic baseline, ship the logistic baseline]
This happens more often than vendors would like. It is a success — you saved a year of model maintenance.
:::

## Comparison table

Illustrative results on a 12-class support-ticket routing task, 20k training examples, 4k test. Replace with your
own numbers from `benchmarks/evaluate.py`.

| Model | Macro-F1 | Cost/case | p95 latency | Memory | Trainable on |
| --- | --- | --- | --- | --- | --- |
| Majority class | 0.09 | 14.2 | < 1 ms | — | — |
| TF-IDF + logistic | 0.74 | 6.1 | 2 ms | 40 MB | CPU, seconds |
| 66M encoder (fine-tuned) | 0.83 | 4.0 | 9 ms | 310 MB | 1 GPU-hour |
| 360M decoder (distilled) | 0.86 | 3.6 | 41 ms | 520 MB | 6 GPU-hours |
| 1.7B decoder (distilled) | 0.87 | 3.5 | 140 ms | 1.9 GB | 1 GPU-day |
| Frontier API (prompted) | 0.88 | 3.4 | 900 ms | — | — |

*Illustrative. The pattern to expect: most of the gain arrives by
66M; the frontier API adds ~2 points of F1 over a distilled 360M model at 20× the latency and materially higher cost.*

## Reading that table honestly

- **0.74 → 0.83 is the big jump.** Almost all the value of "using a transformer" is captured by the smallest model in the list.
- **0.83 → 0.88 is diminishing.** Ask what those 5 points are worth in cost terms before paying 20× latency.
- **Cost per case, not F1, orders the last four rows.** A 1.7B model is not worth 3× the latency for 1 point of F1 on a routing task.

## Choosing under constraints

| Constraint | Pick | Why |
| --- | --- | --- |
| p99 < 50 ms | 66M encoder, INT8, ONNX | Decoders cannot generate in that budget |
| Must run on a Pi | 22M–66M encoder, INT8 | Memory, not compute, is the limit |
| Input is 4k tokens | 360M–1.7B decoder with 8k context | Encoders cap at 512 tokens |
| Needs a reason string | 360M decoder with constrained JSON | Classification heads cannot explain |
| Zero training data | Frontier API, then distil | Bootstrapping problem, not a model problem |
| Regulated, no third parties | Self-hosted 360M | Data residency and audit |

## Comparing like for like

```python
# the only fair comparison: same spec, same split, same policy class
from slm_decision import evaluate_policy, CostOptimalPolicy

rows = []
for name, proba in scores_by_model.items():
    policy = CostOptimalPolicy(spec, max_abstain_rate=0.25)
    r = evaluate_policy(spec, policy, y_true=y_test, probs=proba)
    rows.append({"model": name, **r.to_dict()})
```

Keep the policy and the abstain cap fixed across models, otherwise you are comparing policies, not models. Then vary
one axis at a time — accuracy, latency, memory — and record the hardware.

## Distillation ladder

A practical sequence that avoids over-building: logistic baseline → 66M encoder → distill the best available teacher
into 360M → stop. Each rung should be justified by a measured gain in cost per case, not by a benchmark leaderboard.
