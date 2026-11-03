---
section: "2"
title: "Quick start"
kicker: "Setup"
abstract: "From clone to a calibrated, cost-aware decision model in under thirty minutes — CPU only."
time: "5 min"
order: 2
outcomes:
  - "Install the library and run the test suite"
  - "Write a decision spec with a defensible cost matrix"
  - "Read cost per case, abstain rate and ECE as a go/no-go"
---

This chapter gets you to a working decision pipeline with no GPU and no model download. You will build a
*policy*, score it under a cost matrix, calibrate it, and see the three numbers that decide whether it is
shippable.

## 1. Install

```bash
git clone https://github.com/vkdev01/slm-decision-models.git
cd slm-decision-models
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -e code/          # installs the slm_decision package
```

The core path needs only `numpy` and `pandas`. Torch and transformers are optional extras,
imported lazily, so the test suite and the metrics layer run on a laptop with nothing else installed:

```bash
pip install -r requirements.txt          # core: numpy, pandas
pip install ".[ml]"                      # adds torch, transformers, datasets, scikit-learn
```

## 2. Define the decision, not the prompt

The first artefact in a decision project is a spec file, not a model. It fixes the action set, the cost of each
mistake, and the abstain path:

```python
from slm_decision import DecisionSpec

spec = DecisionSpec(
    name="loan_triage",
    actions=["auto_approve", "manual_review", "decline"],
    # (predicted action, true outcome) -> cost in rupees of expected loss
    costs={
        ("auto_approve", "default"): 120_000,
        ("auto_approve", "repaid"): 0,
        ("manual_review", "default"): 900,
        ("manual_review", "repaid"): 900,
        ("decline", "default"): 0,
        ("decline", "repaid"): 24_000,   # lost margin on a good customer
    },
    abstain="manual_review",
    max_abstain_rate=0.25,
)
spec.validate()
```

Costs are in whatever unit you can defend in a meeting. Ratios matter more than absolutes: here a false approval
costs 5× a false decline and 133× a manual review, which is what pushes the policy toward abstaining.

## 3. Get scores from the cheapest thing that works

Always start with a rule or a logistic baseline. It gives you a floor and a sanity check for the SLM:

```python
import numpy as np
from slm_decision import RulePolicy, evaluate_policy

rng = np.random.default_rng(0)
# stand-in for real features -> probability of default
scores = rng.beta(2, 5, size=2000)          # p(default)
y_true = (rng.random(2000) < scores).astype(int)   # calibrated-by-construction toy data

policy = RulePolicy(spec, threshold=0.45)
report = evaluate_policy(spec, policy, y_true=y_true, scores=scores)
print(report)
```
```text
policy                 loan_triage
n                      2000
accuracy               0.842
cost_per_case          1318.4
abstain_rate           0.187
coverage               0.813
ece                    0.014
```

## 4. Swap in the SLM behind the same interface

The point of the spec is that the model is replaceable. The SLM produces the score; everything downstream is
unchanged.

```python
from slm_decision import SLMDecisionModel

model = SLMDecisionModel.from_pretrained(
    "HuggingFaceTB/SmolLM2-360M-Instruct",
    actions=spec.actions,
)
policy = model.as_policy(spec, prompt="Rate default risk 0-1 and answer with a single number.")
report = evaluate_policy(spec, policy, y_true=y_true, scores=customer_scores)
```

## 5. Calibrate before you ship

Raw model scores are usually over-confident. Fit a temperature on a held-out slice, then re-measure:

```python
from slm_decision import TemperatureCalibrator

cal = TemperatureCalibrator().fit(scores_val, y_val)
scores_test_cal = cal.transform(scores_test)

print("ECE before:", round(ece(scores_test, y_test), 4))
print("ECE after :", round(ece(scores_test_cal, y_test), 4))
print("T         :", round(cal.temperature, 3))
```

## The three numbers that decide go/no-go

| Metric | Question it answers | Typical gate |
| --- | --- | --- |
| `cost_per_case` | Is this cheaper than the human process it replaces? | Below current baseline by a margin you can defend |
| `abstain_rate` | Can operations absorb the escalations? | Within the staffing plan, e.g. ≤ 25% |
| `ece` | Can downstream thresholds be trusted? | ≤ 0.05 after calibration |

:::note[Order of operations]
Spec → baseline → SLM → calibrate → cost-optimise thresholds → test → deploy. Teams that start with the model and
retrofit a cost matrix spend months tuning an objective they cannot state.
:::

## Next

Continue to [SLM fundamentals](/c/slm-decision-models/03-slm-fundamentals) for the architecture and sizing maths, or go
straight to [distillation](/c/slm-decision-models/06-distillation) if you already have a teacher model in mind.
