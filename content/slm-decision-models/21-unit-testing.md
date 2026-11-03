---
section: "21"
title: "Unit testing"
kicker: "Testing"
abstract: "What to test on a decision model: the arithmetic, the policy, the schema — everything except the weights."
time: "5 min"
order: 21
outcomes:
  - "Test the arithmetic exhaustively and the model statistically"
  - "Write assertions that survive retraining and quantisation"
  - "Set coverage targets per layer"
---

A decision model has more testable surface than a classifier, because the decision layer is ordinary code. The rule
of thumb: **test the maths exhaustively, test the model statistically, and never test the model's exact output.**

## What belongs in a unit test

| Target | Example assertion | Speed |
| --- | --- | --- |
| Cost arithmetic | `expected_cost` of a known action vector equals a hand-computed value | < 1 ms |
| Threshold derivation | cost ratio 5:1 produces threshold 0.833 | < 1 ms |
| Policy monotonicity | higher score never yields a strictly worse action | < 1 ms |
| Calibrator | temperature fit on synthetic data recovers T within 0.1 | ~5 ms |
| Schema validation | malformed model output maps to the abstain action | < 1 ms |
| Spec validation | missing cost cell raises `ValueError` | < 1 ms |

## Worked test file

```python
import numpy as np
import pytest
from slm_decision import (DecisionSpec, RulePolicy, CostOptimalPolicy,
                          TemperatureCalibrator, ece, expected_cost)

SPEC = DecisionSpec(
    name="t",
    actions=["approve", "review", "decline"],
    costs={("approve","bad"):120.0, ("approve","good"):0.0,
           ("review","bad"):1.0,   ("review","good"):1.0,
           ("decline","bad"):0.0,  ("decline","good"):24.0},
    abstain="review",
)

BINARY = DecisionSpec(
    actions=["approve", "decline"],
    costs={("approve", "bad"): 120.0, ("approve", "good"): 0.0,
           ("decline", "bad"): 0.0, ("decline", "good"): 24.0},
)

def test_threshold_follows_cost_ratio():
    # 120 : 24 -> approve only above 120/(120+24) = 0.833 of being good
    assert BINARY.thresholds()["approve"] == pytest.approx(0.8333, abs=1e-3)

def test_expected_cost_matches_hand_calculation():
    actions = ["approve", "decline"]
    y = [0, 1]                                    # outcomes are sorted: 0 = bad, 1 = good
    # approve on a bad case costs 120, decline on a good case costs 24
    assert expected_cost(SPEC, actions, y) == pytest.approx(72.0)

def test_policy_is_monotone_in_score():
    pol = RulePolicy(SPEC, threshold=0.5)
    actions = [pol.act(s) for s in np.linspace(0, 1, 101)]
    rank = {"decline": 0, "review": 1, "approve": 2}
    assert all(rank[actions[i]] <= rank[actions[i+1]] for i in range(len(actions)-1))

def test_temperature_recovery():
    rng = np.random.default_rng(0)
    y = rng.integers(0, 2, 5000)
    p = 1 / (1 + np.exp(-(2.2 * (y - 0.5) * 2 + rng.normal(0, 1, 5000))))   # known sharpness
    cal = TemperatureCalibrator().fit(p, y)
    assert 0.2 < cal.temperature < 5.0

def test_missing_cost_cell_raises():
    with pytest.raises(ValueError):
        DecisionSpec(actions=["a","b"], costs={("a","x"):1.0}, abstain="a").validate()
```

## Testing the model without asserting its output

Three assertion styles that survive retraining, quantisation and prompt edits:

```python
def test_model_beats_trivial_baseline(model, X_val, y_val):
    acc = (model.predict(X_val) == y_val).mean()
    majority = np.bincount(y_val).max() / len(y_val)
    assert acc >= majority + 0.10        # not a fixed number

def test_model_abstains_on_garbage(model, spec):
    garbage = ["", "asdf qwer", "🙂" * 40, "SELECT * FROM users;"]
    for g in garbage:
        assert model.decide(g).action == spec.abstain

def test_model_is_calibrated(model, X_val, y_val):
    p = model.predict_proba(X_val)[:, 1]
    assert ece(p, y_val, n_bins=10) < 0.08
```

:::warn[Do not assert exact strings]
`assert out == '{"action":"review"}'` fails on the next tokeniser update, whitespace change or quantisation.
Assert the parsed decision, the confidence band, and the schema — the properties you actually depend on.
:::

## Fixtures and speed

```python
# conftest.py
import pytest, numpy as np

@pytest.fixture(scope="session")
def spec():
    return DecisionSpec(...)                      # built once

@pytest.fixture(scope="session")
def toy_scores():
    rng = np.random.default_rng(42)
    p = rng.beta(2, 5, 4000)
    y = (rng.random(4000) < p).astype(int)
    return p, y

@pytest.fixture(scope="session")
def slm():
    pytest.importorskip("torch")                  # skip cleanly when torch absent
    from slm_decision import SLMDecisionModel
    return SLMDecisionModel.from_pretrained("HuggingFaceTB/SmolLM2-135M-Instruct")
```

Target: the whole non-model suite under 5 seconds, so it runs on every save. Mark the model tests
`@pytest.mark.slow` and run them in CI only.

## Coverage targets

| Layer | Line coverage target | Rationale |
| --- | --- | --- |
| Spec + metrics + calibration | ≥ 95% | Pure arithmetic; every branch is cheap to test |
| Policies | ≥ 90% | Branching on thresholds and caps |
| Model wrappers | ≥ 60% | Most lines are I/O and framework calls |
| Notebooks | execute without error | Run headless in CI, no coverage requirement |

```bash
pytest tests/ -q --cov=slm_decision --cov-report=term-missing -m "not slow"
```
