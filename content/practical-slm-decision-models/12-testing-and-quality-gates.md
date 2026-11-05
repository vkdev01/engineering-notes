---
section: "12"
title: "Testing and quality gates"
kicker: "Reliability engineering"
abstract: "Test the model boundary, data pipeline, routing policy, and release process with deterministic contracts and statistical gates."
time: "20 min"
order: 12
outcomes:
  - "Separate unit, contract, integration, and statistical model tests"
  - "Create golden cases and metamorphic tests"
  - "Define release gates and rollback triggers"
---
# 12.1 A model system needs more than accuracy tests

Traditional unit tests assert exact outputs for deterministic code. Model outputs are stochastic and distribution-dependent, so test the surrounding contract and measure model quality statistically.

~~~mermaid
flowchart TB
  A[Unit tests: parsing, thresholds, cost functions] --> B[Contract tests: schema, allowed labels, bounds]
  B --> C[Integration tests: retrieval, model API, timeouts]
  C --> D[Evaluation suite: quality, calibration, safety]
  D --> E[Canary and production monitoring]
~~~

Each layer catches a different failure. Passing unit tests does not prove model quality; passing an offline evaluation does not prove production reliability.

## 12.2 Unit-test deterministic policy

~~~python
def choose_action(p, false_positive_cost, false_negative_cost):
    if not 0 <= p <= 1:
        raise ValueError("p must be a probability")
    threshold = false_positive_cost / (
        false_positive_cost + false_negative_cost
    )
    return "act" if p > threshold else "do_not_act"


def test_threshold():
    assert choose_action(0.95, 10, 90) == "act"
    assert choose_action(0.05, 10, 90) == "do_not_act"
    assert choose_action(0.10, 10, 90) == "do_not_act"
    try:
        choose_action(1.2, 10, 90)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid probability accepted")


test_threshold()
print("policy tests passed")
~~~

Expected output: policy tests passed.

## 12.3 Golden sets and metamorphic tests

A golden set contains human-reviewed examples with expected labels, evidence, and severity. Keep it versioned and small enough to inspect. Add examples after incidents, but do not tune repeatedly against the final holdout.

Metamorphic tests check invariants when exact outputs are hard to specify:
- adding irrelevant whitespace should not change the label;
- reordering independent metadata fields should not change the result;
- replacing a customer ID should not alter a content-only classification;
- an empty required field should trigger validation;
- an out-of-scope input should not become an accepted confident answer.

Metamorphic tests are not universal truths: state the assumptions and scope of each invariant.

## 12.4 Statistical gates

A release gate should be predeclared. Example policy (illustrative, not universal):
- no critical safety regression;
- schema-valid rate at least 99.9%;
- macro-F1 no more than 1 percentage point below baseline;
- per-class recall above its risk-specific floor;
- calibration error within the agreed bound;
- p95 latency within the service objective;
- cost per successful task within budget.

Use confidence intervals. If the evaluation sample is too small to resolve the gate, the result is "insufficient evidence", not pass.

## 12.5 Test the unhappy paths

Inject failures: model provider returns 429, 5xx, or malformed JSON; retrieval returns no documents or stale documents; request times out after the model has completed a side effect; retry arrives twice; user loses permission between retrieval and action; prompt-injection text appears in retrieved content; the model emits an unknown label or missing confidence.

Assert that the system fails safely, logs a trace ID, and does not duplicate side effects.

## 12.6 Canary rollout

Route a small fraction of traffic to the candidate while preserving a control. Compare quality proxies, latency, cost, error rate, and escalation by cohort. Increase exposure only when the predeclared observation window and sample size are met. Keep a one-step rollback path.

## 12.7 Release checklist

- [ ] Dataset and model revisions are immutable and recorded.
- [ ] No train/test leakage detected.
- [ ] Golden, edge, safety, and metamorphic tests pass.
- [ ] Per-class metrics and calibration are reviewed.
- [ ] Latency/cost tested at realistic concurrency.
- [ ] Tool permissions and confirmation gates verified.
- [ ] Monitoring, alert owner, and rollback are ready.

## 12.8 Knowledge check

1. Why is an exact-output unit test often brittle for a generative model?
2. Give one metamorphic property for a routing classifier.
3. What should happen if the evaluation sample cannot establish whether a release gate is met?

**Answers:** 1. Sampling and model revisions can change wording while preserving task correctness. 2. Whitespace or independent metadata order should not change a content-based label. 3. Mark the result insufficient evidence and collect more representative cases.
