---
section: "18"
title: "Experiment design and continuous improvement"
kicker: "Learning loop"
abstract: "Run disciplined experiments on data, prompts, thresholds, and model size; separate signal from noise and turn incidents into regression coverage."
time: "18 min"
order: 18
outcomes:
  - "Write falsifiable hypotheses and choose one variable at a time"
  - "Use paired evaluation and confidence intervals"
  - "Create an incident-to-regression feedback loop"
---
# 18.1 Start with a hypothesis

Weak experiment: "Try a better prompt." Strong experiment: "Adding three representative examples for the account-access class will improve its recall by at least 2 percentage points without reducing schema validity or increasing p95 latency by more than 5%."

A good experiment defines the change, expected mechanism, primary metric, guardrail metrics, evaluation set, sample size, and stopping rule.

## 18.2 Change one factor at a time

Possible factors include prompt wording, few-shot examples, model revision, quantisation, temperature, retrieval chunking, threshold, and training data mix. If several change together, the result cannot tell you which change mattered. Factorial designs can test interactions once the baseline is stable.

## 18.3 Paired evaluation

Run candidate and baseline on the same frozen examples. Compare per-example outcomes, not only aggregate scores. Bootstrap examples (or users/tenants if correlated) to estimate uncertainty. For prompt experiments on live traffic, randomise at the user or account level when repeated requests are dependent.

## 18.4 Error taxonomy

Label failures by cause: missing evidence, wrong label boundary, ambiguous policy, malformed output, hallucinated field, language coverage, prompt injection, timeout, or data drift. A single "model error" bucket is too broad to guide engineering.

## 18.5 Incident learning loop

~~~mermaid
flowchart LR
  A[Production incident] --> B[Reproduce and classify]
  B --> C[Add reviewed regression case]
  C --> D[Propose one intervention]
  D --> E[Paired offline evaluation]
  E --> F{Guardrails pass?}
  F -->|yes| G[Canary release]
  F -->|no| D
  G --> H[Monitor and document]
~~~

Do not add a case to a benchmark without reviewing its label and provenance. A noisy regression set can train the team to optimise for incorrect answers.

## 18.6 Experiment log template

| Field | Example |
|---|---|
| Hypothesis | examples improve rare-class recall |
| Change | add 3 examples to prompt v4 |
| Primary metric | account-access recall |
| Guardrails | macro-F1, schema-valid, p95, cost |
| Dataset | frozen eval 2026-10 |
| Result | estimate + interval |
| Decision | ship / reject / inconclusive |

## 18.7 Knowledge check

1. Why should prompt A and B run on the same examples?
2. What does an inconclusive experiment mean?
3. Why should incidents be classified by cause?

**Answers:** 1. It controls for example difficulty. 2. Evidence is insufficient to support either shipping or rejecting the hypothesis. 3. Different failure causes require different interventions.
