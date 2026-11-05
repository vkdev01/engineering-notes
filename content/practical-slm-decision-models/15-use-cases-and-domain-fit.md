---
section: "15"
title: "Use cases and domain fit"
kicker: "Applicability"
abstract: "Choose tasks where small models have a structural advantage, and identify when rules, retrieval, larger models, or people are the better tool."
time: "24 min"
order: 15
outcomes:
  - "Assess task suitability using boundedness, evidence, error cost, and volume"
  - "Map common domains to safe SLM patterns"
  - "Reject poor-fit use cases before spending on training"
---
# 15.1 Start with the task, not the model

A small model is not automatically the right answer because it is cheaper or can run locally. First describe the task without mentioning AI: input, allowed actions, outcomes, consequences, volume, and service constraints.

A good SLM candidate often has:
- a narrow and repeatable task;
- a finite action set or structured extraction target;
- enough representative examples to evaluate;
- bounded input context;
- a clear fallback for ambiguity;
- high request volume or meaningful latency/privacy constraints;
- errors that can be detected or safely contained.

A poor candidate may require open-ended expert judgement, constantly changing world knowledge, long multi-document synthesis, or actions whose failure cannot be reviewed.

## 15.2 A practical fit scorecard

Rate each dimension from 1 (poor fit) to 5 (strong fit). This is a screening aid, not a statistically validated score.

| Dimension | Strong SLM fit | Weak SLM fit |
|---|---|---|
| Task boundedness | Few labels or fixed schema | Open-ended, shifting objective |
| Input scope | Short, structured context | Very long, heterogeneous context |
| Evidence | Supplied or retrievable facts | Requires unsupported world knowledge |
| Error containment | Review/abstain possible | Mistake causes irreversible harm |
| Data | Representative labels available | Labels sparse or unreliable |
| Volume | High enough to justify optimisation | Low volume; setup dominates |
| Runtime | Local/low-latency valuable | Larger model latency acceptable |

A single low score on safety or evidence can disqualify the use case even if the total is high.

## 15.3 Common patterns by domain

**Customer support:** intent routing, language detection, field extraction, duplicate detection, and suggested queue. Do not let a classifier issue refunds or change account state without deterministic authorization and confirmation.

**Developer tooling:** classify test failures, map known error signatures, extract stack-trace fields, and route incidents. Keep code execution and repository writes behind separate permissioned tools.

**Operations:** classify alerts, summarise known incident fields, and prioritise a queue. Evaluate on rare-event recall and alert fatigue, not only overall accuracy.

**Healthcare administration:** extract administrative fields or route documents for human review. Clinical diagnosis and treatment decisions require domain-specific validation, regulatory analysis, and qualified oversight; a general-purpose SLM benchmark is not evidence of clinical safety.

**Finance and fraud operations:** triage or prioritise cases, not silently make high-impact decisions from a raw score. Measure subgroup performance, false-positive burden, explainability, auditability, and applicable legal obligations.

**Edge and embedded systems:** local intent classification or command parsing can benefit from offline operation and data locality. Constrain the action vocabulary and ensure safe behaviour when sensors or context are missing.

## 15.4 Build a decision table before a model

For each task, enumerate possible actions and actual outcomes. Fill a cost matrix with stakeholders, including review time, delay, customer harm, operational loss, and reversibility. Record which costs are measured and which are assumptions.

Example for a support router:

| Action / actual queue | Billing | Technical | Account access |
|---|---:|---:|---:|
| Billing | 0 | 4 | 5 |
| Technical | 6 | 0 | 4 |
| Account access | 8 | 5 | 0 |
| Human review | 2 | 2 | 2 |

The numbers are illustrative effort units. Validate them with operational data. If human review is overloaded, its effective cost may rise with queue length; a static matrix is then only an approximation.

## 15.5 Decide when not to use an SLM

Use deterministic code for exact arithmetic, access control, and state transitions. Use retrieval or databases for fresh facts. Use a larger model when task complexity demonstrably requires it. Use a human when the evidence is ambiguous and the consequence of error is high.

The correct architecture may be a rules engine with an SLM only for one bounded subtask. "No model" is a valid outcome of the model-selection process.

## 15.6 Knowledge check

1. Name two properties that make a task suitable for an SLM.
2. Why should a support router not directly issue refunds?
3. What is the right baseline for a proposed model?
4. When is a larger model a better choice?

**Answers:** 1. Bounded task, representative data, short context, safe abstention, high volume, or valuable local execution. 2. Routing confidence is not authorization and refund execution is a separate side effect. 3. The best existing rules/process baseline under the same cost and quality metrics. 4. When the task's complexity or evidence needs exceed what the small model can meet at required quality.
