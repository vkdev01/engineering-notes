---
section: "18"
title: "Experimentation and continuous improvement"
kicker: "Learning loop"
abstract: "Run controlled experiments, prioritise data improvements, monitor drift, and decide whether to change prompts, policies, or model weights."
time: "22 min"
order: 18
outcomes:
  - "Choose the right intervention for a measured failure"
  - "Design controlled experiments and compare paired outcomes"
  - "Monitor drift and safely refresh data, calibration, and models"
---
# 18.1 Diagnose before changing the model

When performance falls, do not immediately fine-tune. First locate the failure:

- input distribution changed;
- retrieval evidence is missing or stale;
- parser or schema contract changed;
- prompt changed;
- calibration shifted;
- decision costs or policy changed;
- serving runtime regressed;
- model quality changed.

A useful decomposition is: data → representation → model → probability → policy → runtime. Instrument each boundary so you can identify where the error entered.

## 18.2 Select the intervention

| Observed problem | First intervention to test |
|---|---|
| Wrong labels despite clear examples | Improve labels/data or task definition |
| Good ranking, poor probabilities | Recalibrate |
| Good probabilities, wrong action mix | Revisit cost matrix/policy |
| Missing current facts | Retrieval or deterministic lookup |
| Invalid output format | Constrained decoding and parser validation |
| Domain vocabulary mismatch | Data augmentation or fine-tuning |
| Tail latency regression | Runtime, queueing, batching, or model size |
| One cohort fails | Cohort-specific analysis and data coverage |

The least complex intervention that addresses the measured failure is usually easiest to maintain.

## 18.3 Controlled experiments

Pre-register the hypothesis, primary metric, guardrail metrics, sample size approach, and stopping rule. Change one major factor at a time when diagnosing causes. For product A/B tests, randomise users/accounts when requests from the same user are correlated.

For paired offline comparison, run both systems on the same examples. Bootstrap the per-example cost difference rather than comparing unrelated aggregate averages.

## 18.4 Data quality is often the bottleneck

Inspect label disagreements, ambiguous policy cases, duplicate examples, class imbalance, stale examples, and missing cohorts. Write annotation guidelines with explicit boundary examples. Measure inter-annotator agreement, but do not mistake agreement for truth: annotators can consistently apply a flawed policy.

Use active learning to prioritise examples where the model is uncertain or where different models disagree, but sample some random production traffic too. Uncertainty-only sampling can bias the dataset toward unusual cases.

## 18.5 Drift monitoring

Monitor:
- input feature and token-length distributions;
- class/action proportions;
- confidence and abstention rates;
- per-class error when labels become available;
- retrieval hit rate and source freshness;
- cohort-specific performance;
- latency, timeouts, and cost.

Input drift is not proof of performance degradation. It is a signal to investigate and, where labels arrive later, compare against outcome data.

## 18.6 Refreshing calibration and weights

Calibration can become stale when the relationship between scores and outcomes changes. Refit on a fresh representative validation sample and preserve a separate test period for final verification. Fine-tune only when there is evidence that model representation or task behaviour is inadequate and enough high-quality labels exist.

Version every dataset snapshot and artifact. Keep the previous calibration and model available so a refresh can be rolled back.

## 18.7 Avoid false discoveries

If you try 50 prompts and publish the one with the best score on a small validation set, the winner may be lucky. Use a development set for exploration, a separate validation set for selection, and a final untouched test set. Report all material experiments, not only the winning run.

## 18.8 Knowledge check

1. What should you do if ranking is good but probabilities are overconfident?
2. Why can uncertainty-only active learning create a biased dataset?
3. Does input drift prove quality has degraded?
4. Why keep an untouched test set?

**Answers:** 1. Calibrate before retraining. 2. It over-samples difficult/uncertain cases and under-represents ordinary traffic. 3. No; it is a signal to investigate and measure outcome quality. 4. To estimate final performance without selection leakage.
