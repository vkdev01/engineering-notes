---
section: "14"
title: "Use-case selection and deployment economics"
kicker: "Engineering decisions"
abstract: "Identify workloads where SLMs are a good fit, quantify total cost of ownership, and avoid deploying a model where deterministic code is better."
time: "20 min"
order: 14
outcomes:
  - "Screen candidate tasks for SLM suitability"
  - "Calculate total cost per successful decision"
  - "Build a workload-specific model selection matrix"
---
# 14.1 Start with task structure

SLMs tend to be attractive when inputs are bounded, outputs are constrained, the task repeats frequently, latency or data locality matters, and mistakes can be detected or escalated. They are less attractive when the task requires broad open-ended reasoning, rare specialist knowledge, or high-impact judgement without a reliable review path.

Candidate workloads include classification, extraction, language detection, intent routing, constrained summarisation, redaction assistance, and local/on-device assistance. These are candidates to test, not automatic recommendations.

## 14.2 A practical suitability scorecard

Score each dimension from 1 (poor fit) to 5 (strong fit): task repeatability, input/output constraints, training/evaluation data availability, cost/latency sensitivity, privacy/locality requirements, and safe fallback availability. A high total is a reason to run a pilot, not a substitute for evaluation.

Disqualifiers should override the score: no lawful data access, no way to evaluate critical errors, no safe fallback for consequential decisions, or no owner for production monitoring.

## 14.3 Total cost of ownership

Inference price is only one component:

\[
TCO=C_{inference}+C_{hardware}+C_{engineering}+C_{data}+C_{evaluation}+C_{operations}
\]

Use cost per successful task:

\[
C_{success}=\frac{\text{total system cost}}{\text{number of correct completed tasks}}
\]

A cheap model with high retry, review, or correction rates may be more expensive than a larger model. Include human review and downstream remediation.

## 14.4 Worked example

Suppose 100,000 monthly tasks:
- SLM inference: $40;
- 8% escalation, $0.02 each: $160;
- human review: 2,000 cases at $0.50: $1,000;
- monthly amortised engineering/operations: $600.

Total is $1,800/month. If 96,000 tasks are successfully completed, cost per successful task is $0.01875. Compare this with a baseline using the same definition of success and the same workload.

All numbers are illustrative. Replace them with measured rates, fully loaded labour costs, and your real provider/runtime prices.

## 14.5 Decision matrix

| Workload property | Prefer SLM | Prefer larger model / other |
|---|---|---|
| Small closed label set | often | rarely |
| Fixed extraction schema | often | if context/ambiguity is high |
| Current private knowledge | SLM + retrieval | retrieval is essential either way |
| Open-ended multi-step reasoning | only after evidence | larger model or workflow |
| Exact arithmetic/permissions | deterministic code | do not delegate to a model |
| High-impact irreversible action | assist + human gate | never autonomous by default |

## 14.6 Knowledge check

1. Why is cost per successful task more useful than cost per request?
2. Name two SLM disqualifiers.
3. Why should deterministic code handle permissions and arithmetic?

**Answers:** 1. It includes failures, retries, escalation, and correction. 2. No lawful data, no evaluable critical errors, no fallback, or no operational owner. 3. Those operations require exact, auditable behaviour.
