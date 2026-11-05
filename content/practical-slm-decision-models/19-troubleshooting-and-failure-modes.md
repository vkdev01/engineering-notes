---
section: "19"
title: "Troubleshooting and failure modes"
kicker: "Operations"
abstract: "Use symptoms and measurements to isolate failures in model output, calibration, routing, serving, data, and production behaviour."
time: "22 min"
order: 19
outcomes:
  - "Diagnose common quality, calibration, latency, and reliability failures"
  - "Use a structured incident workflow rather than random prompt edits"
  - "Distinguish model failure from data, policy, and infrastructure failure"
---
# 19.1 Start with the symptom and preserve evidence

During an incident, freeze the relevant artifact versions and preserve request IDs, timestamps, policy versions, latency traces, and redacted examples. Avoid changing prompts, weights, and thresholds simultaneously; doing so destroys the ability to identify the cause.

## 19.2 Symptom-to-cause guide

| Symptom | Plausible causes | First checks |
|---|---|---|
| High accuracy, high business loss | Cost asymmetry ignored; threshold wrong | Confusion matrix by error cost; expected-cost calculation |
| Good validation, poor production | Leakage, drift, different preprocessing | Split strategy; input and label distribution |
| High confidence, frequent errors | Miscalibration or out-of-distribution inputs | Reliability diagram; cohort calibration |
| Excessive review rate | Threshold too strict; weak model; bad retrieval | Risk-coverage curve; retrieval hit rate |
| Invalid JSON | Prompt/schema mismatch; truncation | Raw response status, token limit, parser |
| Repeated tool actions | Retry/idempotency bug; unbounded agent loop | Idempotency key, attempt counter, action log |
| Sudden latency increase | Queue growth, cold start, longer inputs | Queue time, input length, runtime metrics |
| One class collapses | Label drift, imbalance, preprocessing bug | Per-class recall and recent labeled examples |

These are hypotheses, not automatic diagnoses. Verify with traces and a controlled reproduction.

## 19.3 Confidence is not truth

A score of 0.99 can be wrong, especially on unfamiliar or adversarial inputs. Inspect calibration by cohort and time period. Check whether confidence is computed from logits, token likelihood, a verbal self-report, or a calibrated classifier head; these are not interchangeable quantities.

## 19.4 Latency debugging

Decompose total time:

\[
T_{total}=T_{queue}+T_{preprocess}+T_{retrieve}+T_{inference}+T_{parse}+T_{policy}+T_{network}
\]

Measure each component separately. If queue time dominates, a smaller model may not solve the problem. If retrieval dominates, optimise retrieval. If generation dominates, reduce output length, consider a smaller model, or use constrained classification.

## 19.5 Quality debugging workflow

1. Identify affected cohort, time window, and exact metric.
2. Compare current inputs with the last known-good period.
3. Reproduce using frozen model/prompt/policy versions.
4. Inspect representative errors, not only aggregate metrics.
5. Determine whether failure is data, model, calibration, policy, or runtime.
6. Test one targeted intervention on validation data.
7. Canary and monitor guardrails before broad rollout.

## 19.6 Safe incident response

For high-impact errors, disable the risky automated action or route to review. Preserve the ability to serve safe deterministic paths. Notify the owner, record impact, and follow the incident process. Do not hide a model failure by silently changing labels or deleting difficult examples from evaluation.

## 19.7 Troubleshooting checklist

- [ ] Did the model, tokenizer, prompt, calibration, or policy version change?
- [ ] Did input volume, length, language, or cohort mix change?
- [ ] Did retrieval sources or freshness change?
- [ ] Are parser failures and timeouts included in the metrics?
- [ ] Is the cost matrix still representative?
- [ ] Are retries bounded and side effects idempotent?
- [ ] Does the safe fallback still work under load?

## 19.8 Knowledge check

1. Why should you avoid changing several components during diagnosis?
2. What does a high review rate tell you?
3. How should total latency be investigated?
4. What is the safest response to a critical misclassification incident?

**Answers:** 1. It obscures causality. 2. It may indicate a strict threshold, weak model, distribution shift, or retrieval failure; inspect risk-coverage and cohort metrics. 3. Decompose it into queue, preprocessing, retrieval, inference, parsing, policy, and network. 4. Disable the risky automated action and route affected cases to the safe review path.
