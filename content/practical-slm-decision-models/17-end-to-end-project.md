---
section: "17"
title: "Capstone: build an end-to-end decision service"
kicker: "Integration"
abstract: "Turn a bounded classification task into a complete, evaluated, cost-aware decision service with explicit baselines and safe fallbacks."
time: "40 min"
order: 17
outcomes:
  - "Translate a product task into actions, outcomes, and a cost matrix"
  - "Implement a baseline, model adapter, calibrated policy, and review path"
  - "Produce a release report with quality, cost, and latency evidence"
---
# 17.1 Project brief

Build a support-ticket router with four possible actions: `billing`, `technical`, `account_access`, and `review`. The first three are automated routes. Review is the safe fallback when the evidence is weak, the input is out of scope, or the model output is invalid.

This capstone uses synthetic data and a deterministic fake predictor so it runs on a laptop without downloading weights. Later, replace the fake predictor with an SLM adapter while keeping the policy and tests unchanged.

## 17.2 Define the policy

Assume the following illustrative cost matrix (effort units):

| Action / true queue | Billing | Technical | Account access |
|---|---:|---:|---:|
| Billing | 0 | 6 | 7 |
| Technical | 5 | 0 | 6 |
| Account access | 7 | 5 | 0 |
| Review | 2 | 2 | 2 |

The review action has a fixed cost of 2. Automated misroutes have higher costs. The matrix is a stakeholder assumption to be validated, not a universal truth.

For probability vector p, choose action a that minimises expected cost:

\[
a^*=\arg\min_a\sum_y C(a,y)P(y\mid x)
\]

## 17.3 Executable decision policy

~~~python
LABELS = ("billing", "technical", "account_access")
COST = {
    "billing":        (0, 6, 7),
    "technical":      (5, 0, 6),
    "account_access": (7, 5, 0),
    "review":         (2, 2, 2),
}

def validate_probabilities(probs):
    if set(probs) != set(LABELS):
        raise ValueError("probability keys do not match labels")
    values = [probs[k] for k in LABELS]
    if any(not isinstance(v, (int, float)) or isinstance(v, bool) for v in values):
        raise ValueError("probabilities must be numeric")
    if any(v < 0 or v > 1 for v in values):
        raise ValueError("probabilities must be in [0, 1]")
    if abs(sum(values) - 1.0) > 1e-6:
        raise ValueError("probabilities must sum to one")

def choose(probs, max_auto_cost=1.5):
    validate_probabilities(probs)
    candidates = {}
    for action, costs in COST.items():
        candidates[action] = sum(costs[i] * probs[label]
                                  for i, label in enumerate(LABELS))
    action = min(candidates, key=candidates.get)
    if action == "review" or candidates[action] > max_auto_cost:
        return "review", candidates
    return action, candidates

example = {"billing": 0.82, "technical": 0.10, "account_access": 0.08}
print(choose(example)[0])
~~~

Expected output: `billing`.

## 17.4 Add a model adapter

The adapter contract should return a validated probability distribution and metadata. Keep provider-specific code behind this interface:

~~~python
class Predictor:
    def predict_proba(self, text):
        raise NotImplementedError

class DemoPredictor(Predictor):
    def predict_proba(self, text):
        t = text.lower()
        if "invoice" in t or "charged" in t:
            return {"billing": .82, "technical": .10, "account_access": .08}
        if "password" in t or "login" in t:
            return {"billing": .05, "technical": .15, "account_access": .80}
        if "crash" in t or "error" in t:
            return {"billing": .08, "technical": .82, "account_access": .10}
        return {"billing": .34, "technical": .33, "account_access": .33}

def route_ticket(text, predictor):
    try:
        probs = predictor.predict_proba(text)
        action, costs = choose(probs)
        return {"action": action, "probabilities": probs, "expected_costs": costs}
    except (ValueError, TypeError, KeyError):
        return {"action": "review", "reason": "invalid_model_output"}

demo = DemoPredictor()
for ticket in ["I was charged twice", "I cannot reset my password", "The app crashes"]:
    print(ticket, "=>", route_ticket(ticket, demo)["action"])
~~~

Expected output:

~~~text
I was charged twice => billing
I cannot reset my password => account_access
The app crashes => technical
~~~

## 17.5 Evaluate against a baseline

Compare the model-backed policy with:
- always review;
- a keyword/rule baseline;
- the incumbent production process.

Measure expected cost per ticket, automation coverage, high-cost misroute rate, per-class recall, invalid-output rate, and p50/p95 latency. Report the number of examples and confidence intervals.

Do not claim that the demo predictor is a trained model or that its synthetic outputs establish real-world quality. The point of this project is to create a testable system boundary.

## 17.6 Add a release checklist

- [ ] Input schema, size limits, and authentication are enforced.
- [ ] Cost matrix has an owner and documented assumptions.
- [ ] Model probabilities are validated and calibrated on held-out data.
- [ ] Review fallback works for low confidence and malformed output.
- [ ] Policy unit tests cover all decision boundaries.
- [ ] Evaluation set is group/time split to avoid leakage.
- [ ] Latency and load tests meet target SLOs.
- [ ] Model, tokenizer, prompt, calibration, and policy versions are recorded.
- [ ] Monitoring and rollback are operational.

## 17.7 Extension work

1. Replace the fake predictor with a local instruct SLM and constrained label output.
2. Fit temperature scaling on a validation set; do not fit it on the test set.
3. Sweep the automation threshold and plot expected cost against coverage.
4. Add an out-of-distribution detector and verify that it increases review rather than forcing a guessed class.
5. Run a shadow deployment and compare live input drift with the offline evaluation set.

## 17.8 Knowledge check

1. Why is the model adapter separate from the cost policy?
2. Why is always-review a useful baseline?
3. Which data split is used to fit calibration?
4. What evidence is required before replacing the demo predictor?

**Answers:** 1. It isolates model/runtime changes from deterministic business policy. 2. It provides a known safety/cost reference. 3. Validation data. 4. Representative held-out quality, calibration, decision cost, cohort, latency, reliability, and safety results.
