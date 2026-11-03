---
section: "10"
title: "The Python library"
kicker: "Reference"
abstract: "slm_decision — the small, dependency-light core used throughout this guide: specs, policies, calibration, metrics."
time: "5 min"
order: 10
outcomes:
  - "Use DecisionSpec, policies and calibrators correctly"
  - "Read an evaluation report and know which numbers gate a release"
  - "Know which parts of the API are stable"
---

The library is deliberately small. It contains the parts of a decision system that are easy to get subtly wrong —
the cost arithmetic, the calibration, the selective-prediction curves — and stays out of the way of your training
code.

## Install

```bash
pip install -e code/          # from a clone of the repo
# core needs numpy + pandas only; torch/transformers are optional extras
pip install -e "code/[ml]"
```

## Module map

| Module | Contents | Depends on |
| --- | --- | --- |
| `slm_decision.spec` | `DecisionSpec`, `Action`, cost-matrix validation | numpy |
| `slm_decision.policies` | `RulePolicy`, `CostOptimalPolicy`, `ThresholdPolicy`, `as_policy` | numpy |
| `slm_decision.calibration` | `TemperatureCalibrator`, `IsotonicCalibrator`, `ConformalCalibrator` | numpy |
| `slm_decision.metrics` | `ece`, `brier`, `macro_f1`, `expected_cost`, `risk_coverage` | numpy |
| `slm_decision.models` | `SLMDecisionModel`, `DistilledDecisionModel`, `FineTunedDecisionModel`, `HybridDecisionModel` | torch/transformers (lazy) |
| `slm_decision.evaluation` | `evaluate_policy`, `Report` | numpy, pandas |

## DecisionSpec

The single source of truth for a decision: the action set, the cost of every (action, outcome) pair, and the
abstain policy. It validates itself — missing cost cells, non-numeric costs, or an abstain action outside the action
set all raise at construction.

```python
from slm_decision import DecisionSpec

spec = DecisionSpec(
    name="triage",
    actions=["approve", "review", "decline"],
    costs={("approve", "bad"): 120.0, ("approve", "good"): 0.0,
           ("review",  "bad"): 1.0,   ("review",  "good"): 1.0,
           ("decline", "bad"): 0.0,   ("decline", "good"): 24.0},
    abstain="review",
    max_abstain_rate=0.25,
)
spec.validate()
# lower edge of each action's optimal region, in P(good):
spec.thresholds()      # -> {'decline': 0.0, 'review': 0.0417, 'approve': 0.9917}
# 'approve' only wins above 0.99 because a review costs just 1.0 here
```

## Policies

Every policy implements `act(signal) -> action` and `proba(signal) -> dict[action, p]`.
The same interface covers rules, a calibrated SLM, a cascade, and a human router — which is what makes them
interchangeable in tests.

```python
from slm_decision import RulePolicy, CostOptimalPolicy

rules = RulePolicy(spec, threshold=0.45)          # p(good) >= threshold -> approve
cost_policy = CostOptimalPolicy(spec)             # argmax expected cost, then abstain cap

rules.act(0.71)          # 'approve'
cost_policy.act(0.71)    # 'review'   <- review costs 1.0, so it dominates the middle
cost_policy.act(0.995)   # 'approve'
cost_policy.act(0.01)    # 'decline'
```

## Calibration

```python
from slm_decision import TemperatureCalibrator, IsotonicCalibrator, ConformalCalibrator

cal = TemperatureCalibrator().fit(scores_val, y_val)     # single scalar, monotone, preserves ranking
p_test = cal.transform(scores_test)

iso = IsotonicCalibrator().fit(scores_val, y_val)        # non-parametric, needs >= 500 points
conf = ConformalCalibrator(alpha=0.1).fit(scores_val, y_val)
labels = conf.predict_set(scores_test)                    # sets with >= 90% empirical coverage
```
| Calibrator | Data needed | Preserves ranking | Use when |
| --- | --- | --- | --- |
| Temperature | ≥ 200 points | Yes | Default; almost always the first thing to try |
| Isotonic | ≥ 500 points | No (monotone, so ranking preserved on ties) | Large validation set, strongly non-linear distortion |
| Conformal | ≥ 200 points | n/a — produces sets | You need a coverage guarantee for a review band |

## Metrics

```python
from slm_decision import ece, brier, macro_f1, expected_cost, risk_coverage

ece(p, y, n_bins=15)                     # expected calibration error
brier(p, y)                              # proper scoring rule, lower is better
macro_f1(preds, y)                       # unweighted mean F1 across classes
expected_cost(spec, actions, y)          # mean cost per case under the matrix
cov, risk = risk_coverage(p, y, preds)   # selective-prediction curve
```

## Models (optional extra)

```python
from slm_decision import SLMDecisionModel

model = SLMDecisionModel.from_pretrained(
    "HuggingFaceTB/SmolLM2-360M-Instruct",
    device="cpu", torch_dtype="int8",
)
result = model.decide("Claim denied without reason; policy 4.2 requires one.")
# DecisionResult(action='review', confidence=0.71, probs={...}, raw='review', latency_ms=27.4)

model.decide_with_context("Pick the best option", context={
    "options": ["A", "B", "C"],
    "constraints": ["budget < 1000", "time < 1 week"],
})
```
:::note[Why torch is optional]
Every metric, calibrator and policy works on numpy arrays. That keeps CI fast, keeps the test suite runnable on a
laptop, and lets you unit-test the decision logic without downloading a model.
:::

## Evaluation report

```python
from slm_decision import evaluate_policy

report = evaluate_policy(spec, cost_policy, y_true=y, scores=p)
print(report)
print(report.to_dict())        # JSON-serialisable; commit it with the model artefact
```

Accuracy is measured against the actions the spec accepts for the outcome that actually happened —
by default the single cost-minimising action, or an explicit `acceptable` map for graded action sets
(`acceptable={"bad": ["escalate", "urgent"]}`). Macro-F1 is only reported when each outcome maps to exactly
one acceptable action, because averaging F1 across a graded action set measures nothing useful.

The report carries accuracy, macro-F1, cost per case, abstain rate, coverage, ECE, Brier, and per-class recall.
Commit it next to the adapter — an eval report with no date, data snapshot or code commit is not evidence.

## Stability contract

- `DecisionSpec`, `evaluate_policy`, `Report` and the metric functions are the stable API; they are what the docs and notebooks use.
- Policy internals may change. Subclass rather than monkey-patching.
- Everything is typed; `mypy --strict` runs in CI on the core modules.
