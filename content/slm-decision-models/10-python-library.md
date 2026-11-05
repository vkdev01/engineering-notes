---
section: "10"
title: "The Python library"
kicker: "Reference"
abstract: "API reference for slm_decision — specs, policies, calibrators, metrics, evaluation and the optional model wrappers — with each function's signature, parameters, return value, example and the one line of math behind it, plus a 60-line numpy reference implementation of the core you can run today."
time: "14 min"
order: 10
outcomes:
  - "Build a DecisionSpec and read its cut points (0.0375 / 0.9925 at a ₹900 review)"
  - "Choose between RulePolicy, ThresholdPolicy and CostOptimalPolicy, with or without an abstain cap"
  - "Call the metrics and evaluate_policy correctly and know which report fields gate a release"
  - "Run the numpy reference implementation when the package is not installed"
---

Every section of this handbook makes the same few computations: expected cost per action, the cost-optimal action with a review band and a capacity cap, calibration, and a report of cost per case, abstain rate and ECE. `slm_decision` is the small library those sections are written against. It is **not on PyPI**; if you do not have its source, §10.9 implements the core in ~60 lines of numpy with the same semantics, and the handbook's runnable examples are self-contained anyway.

:::key[First principle]
Keep the **decision layer** (costs → thresholds → actions → report) separate from the **model layer** (whatever produces probabilities). Everything in the core takes numpy arrays of calibrated probabilities, so you can swap a logistic regression for a distilled SLM without touching the spec, the policy or the report.
:::

## 10.1 Install and module map

```bash
pip install -e code/            # from the companion source, if you have it
pip install -e "code/[ml]"      # optional: torch + transformers for the model wrappers
```

| Module | Contents | Depends on |
| --- | --- | --- |
| `slm_decision.spec` | `DecisionSpec`, `Action` | numpy |
| `slm_decision.policies` | `RulePolicy`, `ThresholdPolicy`, `CostOptimalPolicy`, `as_policy` | numpy |
| `slm_decision.calibration` | `TemperatureCalibrator`, `IsotonicCalibrator`, `ConformalCalibrator` | numpy |
| `slm_decision.metrics` | `ece`, `brier`, `macro_f1`, `expected_cost`, `risk_coverage` | numpy |
| `slm_decision.evaluation` | `evaluate_policy`, `Report` | numpy |
| `slm_decision.models` | `SLMDecisionModel`, `DistilledDecisionModel`, `FineTunedDecisionModel`, `HybridDecisionModel` | torch, transformers (lazy) |
| `slm_decision.hybrid` | `Retriever`, `HybridPolicy` | `[ml]` extra |

**Conventions.** Outcomes are sorted, so for a binary spec `y = 0` is `bad` and `y = 1` is `good`. `scores` means a 1-D array of $P(\text{good})$; `probs` means an $n \times K$ matrix over outcomes. Costs are in currency, per case.

## 10.2 `DecisionSpec` — the cost matrix as code

```python
DecisionSpec(actions, costs, abstain=None, max_abstain_rate=None, name="decision")
```

| Parameter | Type | Meaning |
| --- | --- | --- |
| `actions` | `list[str]` | Closed action set, e.g. `["decline", "manual_review", "auto_approve"]` |
| `costs` | `dict[(action, outcome), float]` | One cell per (action, outcome); missing or non-numeric cells raise `ValueError` |
| `abstain` | `str` or `None` | The review / defer action; must be in `actions` |
| `max_abstain_rate` | `float` or `None` | Default capacity cap used by policies |

Methods: `validate() -> None` (raises `ValueError`), `thresholds() -> dict[str, float]` (lower edge of each action's optimal region on $P(\text{good})$), `save(path)` / `DecisionSpec.load(path)` (JSON — commit it with the model).

**Math:** two actions, $p^* = c_{FP}/(c_{FP}+c_{FN})$; with a review costing $r$, review wins on $[r/c_{FN},\; 1 - r/c_{FP}]$ ([§4](/c/slm-decision-models/04-decision-theory)).

```python
from slm_decision import DecisionSpec

spec = DecisionSpec(
    name="loan_triage",
    actions=["decline", "manual_review", "auto_approve"],
    costs={("auto_approve", "bad"): 120_000, ("auto_approve", "good"): 0,
           ("manual_review", "bad"): 900,    ("manual_review", "good"): 900,
           ("decline", "bad"): 0,            ("decline", "good"): 24_000},
    abstain="manual_review",
    max_abstain_rate=0.25,
)
spec.validate()
spec.thresholds()   # {'decline': 0.0, 'manual_review': 0.0375, 'auto_approve': 0.9925}
# drop manual_review -> {'decline': 0.0, 'auto_approve': 0.8333}
```

`Action` is the string-valued enum the spec builds from `actions`; plain strings are accepted everywhere.

## 10.3 Policies

Every policy implements the same interface, which is what makes rules, a calibrated SLM and a cascade interchangeable in tests:

| Method | Returns |
| --- | --- |
| `act(score) -> str` | One action for one case |
| `act_batch(scores_or_probs) -> np.ndarray[str]` | Vectorised; applies the abstain cap across the batch |
| `proba(score) -> dict[str, float]` | Outcome probabilities the policy acted on |

| Class | Signature | Rule | Use when |
| --- | --- | --- | --- |
| `RulePolicy` | `RulePolicy(spec, threshold, review_band=None)` | approve if $p \ge$ `threshold`, else decline; review inside `review_band=(lo, hi)` | Baselines, fixed policy thresholds |
| `ThresholdPolicy` | `ThresholdPolicy(spec, cuts)` | `cuts={"manual_review": 0.125, "auto_approve": 0.975}` — highest cut not above $p$ wins | Cut points set by a governance process |
| `CostOptimalPolicy` | `CostOptimalPolicy(spec, max_abstain_rate=None)` | $\arg\min_a \sum_o P(o)\,c(a,o)$, then the cap | Default |
| `as_policy` | `as_policy(obj, spec)` | Wraps a callable `p -> action` or a model in the interface | Plugging in custom logic |

**Cap math:** when the uncapped review share exceeds the cap, keep review for the cases with the largest saving $\min_{a \ne \text{abstain}} E[c \mid a] - r$; the rest take their cheaper automatic action.

```python
from slm_decision import RulePolicy, CostOptimalPolicy

rules = RulePolicy(spec, threshold=0.45)
policy = CostOptimalPolicy(spec)              # cap falls back to spec.max_abstain_rate
rules.act(0.71)       # 'auto_approve'  (0.71 >= 0.45)
policy.act(0.71)      # 'manual_review' (review 900 < decline 17,040 < approve 34,800)
policy.act(0.995)     # 'auto_approve'
policy.act(0.01)      # 'decline'
actions = policy.act_batch(p_test)            # capped at 25% across the batch
```

## 10.4 Calibration

All calibrators: `fit(scores, y) -> self`, `transform(scores) -> np.ndarray`. Fit on a slice the model never trained on.

| Class | Math | Data (rule of thumb) | Notes |
| --- | --- | --- | --- |
| `TemperatureCalibrator()` | $p = \sigma(\operatorname{logit}(s)/T)$, $T$ minimises NLL; attribute `.temperature` | ≥ 200 labelled | One parameter; fixes uniform over/under-confidence only |
| `IsotonicCalibrator()` | best monotone step function $s \mapsto p$ (least squares) | ≥ 500 | Order-preserving but creates ties (plateaus); fixes curves that bend both ways |
| `ConformalCalibrator(alpha=0.1)` | $\hat q$ = the $\lceil (n+1)(1-\alpha) \rceil / n$ quantile of $1 - p_{y}$; set $= \{y : 1 - p_y \le \hat q\}$ | ≥ 200 | `predict_set(scores)` → label sets with ≥ $1-\alpha$ marginal coverage |

```python
from slm_decision import TemperatureCalibrator, IsotonicCalibrator, ConformalCalibrator

cal = TemperatureCalibrator().fit(s_val, y_val);  p_test = cal.transform(s_test)
iso = IsotonicCalibrator().fit(s_val, y_val)
sets = ConformalCalibrator(alpha=0.1).fit(s_val, y_val).predict_set(s_test)
# a set with both outcomes = "the model cannot tell" -> natural review candidate
```

## 10.5 Metrics

| Function | Returns | Math |
| --- | --- | --- |
| `ece(p, y, n_bins=15)` | `float` | $\sum_b \frac{n_b}{n}\,\lvert \bar y_b - \bar p_b \rvert$ over equal-width bins |
| `brier(p, y)` | `float` (lower is better) | $\frac1n \sum_i (p_i - y_i)^2$ |
| `macro_f1(preds, y)` | `float` | unweighted mean of per-class F1 |
| `expected_cost(spec, actions, y)` | `float`, currency per case | $\frac1n \sum_i c(a_i, y_i)$ — realised, not expected under $p$ |
| `risk_coverage(p, y, preds)` | `(coverage, risk)` arrays | sort by confidence $\max(p, 1-p)$; coverage $k/n$, risk = error rate of the top $k$ |

```python
from slm_decision import ece, brier, expected_cost, risk_coverage

ece(p, y)                                                   # e.g. 0.007 for a calibrated model
expected_cost(spec, ["auto_approve", "decline"], [0, 1])    # (120,000 + 24,000) / 2 = 72000.0
cov, risk = risk_coverage(p, y, preds)                      # plot risk against cov
```

## 10.6 `evaluate_policy` and `Report`

```python
evaluate_policy(spec, policy, y_true, scores=None, probs=None, acceptable=None) -> Report
```

Pass `scores` (binary) **or** `probs` ($n \times K$). `acceptable` maps each outcome to the actions counted as correct for accuracy, e.g. `{"bad": ["decline", "manual_review"], "good": ["auto_approve", "manual_review"]}`; by default it is the single cost-minimising action per outcome.

| `Report` field | Meaning | Gate on it? |
| --- | --- | --- |
| `cost_per_case` | realised currency per case | **Yes** — primary |
| `abstain_rate` / `coverage` | share sent to the abstain action / decided automatically | **Yes** — against staffed capacity |
| `ece`, `brier` | calibration of the scores the policy used | **Yes** — near the cut points |
| `accuracy` | against `acceptable` | Secondary |
| `macro_f1` | only when each outcome has exactly one acceptable action, else `None` | Secondary |
| `per_class_recall` | `dict[outcome, float]` | Slice checks |
| `actions` | the action vector (hash it for reproducibility tests) | Regression tests |

`report.to_dict()` is JSON-serialisable — commit it next to the model with the data snapshot and code commit. An eval report without those is not evidence.

```python
from slm_decision import evaluate_policy

report = evaluate_policy(spec, CostOptimalPolicy(spec, max_abstain_rate=0.25), y_true=y, scores=p)
assert report.cost_per_case < baseline.cost_per_case and report.abstain_rate <= 0.25
```

## 10.7 Models (optional `[ml]` extra)

| Class / method | Purpose |
| --- | --- |
| `SLMDecisionModel.from_pretrained(name_or_path, device="cpu", dtype="auto")` | Load a causal or encoder SLM plus its label mapping and calibrator |
| `.decide(text, timeout_ms=None) -> DecisionResult` | Score the closed label set, calibrate, apply the spec's policy |
| `.decide_with_context(prompt, context: dict)` | Same, with structured context rendered into the prompt |
| `.warmup(n=5)` | Run `n` dummy decisions to pay allocator and compile costs before traffic |
| `DistilledDecisionModel`, `FineTunedDecisionModel` | Same interface; constructors take a student / adapter checkpoint |
| `HybridDecisionModel` | Same interface over a cascade of policies (§9) |
| `Retriever(index, embed_model, top_k)` | Top-$k$ passages for a query |
| `HybridPolicy(spec, slm, retriever, template, max_context_tokens=None)` | SLM policy whose prompt is filled with retrieved context |

`DecisionResult` fields: `action`, `confidence`, `probs` (dict), `raw` (model text), `latency_ms`. Labels are scored as logits over the closed set, so `confidence` is a probability after calibration — not a self-reported number.

```python
from slm_decision import SLMDecisionModel

model = SLMDecisionModel.from_pretrained("HuggingFaceTB/SmolLM2-360M-Instruct", device="cpu")
model.warmup(n=5)
result = model.decide("Salaried, 6 years at employer, two missed EMIs in 2023", timeout_ms=200)
result.action, result.confidence        # timeouts and schema failures map to spec.abstain
```

:::note[Why torch is optional]
Specs, policies, calibrators and metrics work on numpy arrays. CI stays fast and decision logic is unit-testable without downloading a model ([unit testing](/c/slm-decision-models/21-unit-testing)).
:::

## 10.8 Stability contract

- **Stable:** `DecisionSpec`, the policy interface (`act`, `act_batch`, `proba`), the metric functions, `evaluate_policy`, `Report`. These are what the handbook uses.
- **May change:** policy internals and the model wrappers' constructor arguments. Subclass; don't monkey-patch.
- Typed throughout; `mypy` runs on the core modules in CI ([CI/CD](/c/slm-decision-models/28-cicd)).

## 10.9 Reference implementation (numpy only)

The core with the same semantics — cost-optimal policy with an abstain band and a cap, and an evaluation returning cost per case, abstain rate, accuracy on automatic decisions and ECE — on 20,000 synthetic loan cases whose scores are calibrated by construction. Review is priced at ₹3,000 (illustrative, fully loaded).

```python run
"""Reference implementation of the slm_decision core: numpy only."""
import numpy as np

C_FP, C_FN = 120_000.0, 24_000.0          # approve a bad case / decline a good case (INR)
ACTIONS = np.array(["decline", "manual_review", "auto_approve"])


def expected_costs(p, review, c_fp=C_FP, c_fn=C_FN):
    """n x 3 expected cost per action; p = P(good)."""
    p = np.asarray(p, float)
    return np.stack([p * c_fn, np.full_like(p, review), (1 - p) * c_fp], axis=1)


def cost_optimal_policy(p, review, max_abstain_rate=None):
    """Argmin expected cost; over the cap, keep the reviews that save the most."""
    e = expected_costs(p, review)
    a = e.argmin(1)
    if max_abstain_rate is not None and (a == 1).mean() > max_abstain_rate:
        saving = e[:, [0, 2]].min(1) - review          # what a review saves on each case
        a = np.where(e[:, 0] <= e[:, 2], 0, 2)          # cheaper automatic action
        a[np.argsort(-saving)[: int(max_abstain_rate * len(a))]] = 1
    return a


def ece(p, y, n_bins=15):
    b = np.minimum((p * n_bins).astype(int), n_bins - 1)
    return sum(abs(p[b == k].mean() - y[b == k].mean()) * (b == k).mean() for k in np.unique(b))


def evaluate_policy(a, p, y, review):
    """Realised cost per case, abstain rate, accuracy on auto-decided cases, ECE."""
    cost = np.choose(a, [y * C_FN, np.full(len(y), review), (1 - y) * C_FP])
    auto = a != 1
    return {"cost_per_case": cost.mean(), "abstain_rate": (a == 1).mean(),
            "auto_accuracy": ((a == 2) == (y == 1))[auto].mean(), "ece": ece(p, y)}


for r in (900, 3_000):
    print(f"review {r:>5,}: band [{r / C_FN:.4f}, {1 - r / C_FP:.4f}]; "
          f"p=0.71 -> {ACTIONS[cost_optimal_policy([0.71], r)][0]}")

rng = np.random.default_rng(0)                        # synthetic, calibrated by construction
n = 20_000
logit = rng.normal(1.6, 1.8, n)
p_true = 1 / (1 + np.exp(-logit))
y = (rng.random(n) < p_true).astype(int)              # 1 = good
p_over = 1 / (1 + np.exp(-2 * logit))                 # same ranking, overconfident
print(f"\n{n:,} cases, good rate {y.mean():.3f}; review priced at 3,000")
print(f"{'policy':30s} {'INR/case':>9s} {'abstain':>8s} {'auto acc':>9s} {'ECE':>6s}")
policies = {
    "approve if p >= 0.5": (np.where(p_true >= 0.5, 2, 0), p_true),
    "p* = 0.833, two actions": (np.where(p_true >= C_FP / (C_FP + C_FN), 2, 0), p_true),
    "cost-optimal band": (cost_optimal_policy(p_true, 3_000), p_true),
    "cost-optimal band, cap 25%": (cost_optimal_policy(p_true, 3_000, 0.25), p_true),
    "band on overconfident scores": (cost_optimal_policy(p_over, 3_000), p_over),
}
for name, (a, p) in policies.items():
    m = evaluate_policy(a, p, y, 3_000)
    print(f"{name:30s} {m['cost_per_case']:9,.0f} {m['abstain_rate']:8.1%} "
          f"{m['auto_accuracy']:9.3f} {m['ece']:6.3f}")
```

```output
review   900: band [0.0375, 0.9925]; p=0.71 -> manual_review
review 3,000: band [0.1250, 0.9750]; p=0.71 -> manual_review

20,000 cases, good rate 0.741; review priced at 3,000
policy                          INR/case  abstain  auto acc    ECE
approve if p >= 0.5               16,873     0.0%     0.815  0.007
p* = 0.833, two actions           10,504     0.0%     0.691  0.007
cost-optimal band                  2,808    85.2%     0.978  0.007
cost-optimal band, cap 25%         6,600    25.0%     0.800  0.007
band on overconfident scores       4,635    47.7%     0.932  0.082
```

What the run shows (synthetic data, so the levels are illustrative; the orderings are the point):

- **Cost thresholds beat 0.5 while being less accurate**: ₹10,504 vs ₹16,873 per case at 0.691 vs 0.815 accuracy.
- **The review band is cheap and huge**: ₹2,808 per case, but 85.2% of cases go to people — this population has many middling scores. A 25% cap costs ₹3,792 per case more; that is a staffing decision with a price.
- **Overconfidence shrinks the band and hides cost**: the same ranking squashed outward (ECE 0.082) reviews only 47.7% and costs ₹4,635 — ₹1,827 per case more than the calibrated band. Check `ece` before trusting any cut point.

## 10.10 Check yourself

:::qa[What does spec.thresholds() return for the loan costs with a ₹3,000 review?]
`{'decline': 0.0, 'manual_review': 0.125, 'auto_approve': 0.975}` — $3{,}000/24{,}000$ and $1 - 3{,}000/120{,}000$.
:::

:::qa[expected_cost(spec, actions, y) and Report.cost_per_case — expected or realised?]
Realised: the mean of $c(a_i, y_i)$ over the outcomes that happened. The *expected* cost under $p$ is what the policy minimises per case; the realised cost is what you gate on.
:::

:::qa[Why compare models with CostOptimalPolicy(spec, max_abstain_rate=0.25) held fixed?]
Otherwise you compare policies, not models. Fix the spec, policy and cap; vary only the probabilities ([model comparison](/c/slm-decision-models/30-model-comparison)).
:::

:::qa[Temperature scaling left ECE unchanged. Which calibrator next?]
`IsotonicCalibrator` if you have ≥ ~500 held-out labels: one temperature can only fix confidence that is uniformly too high or too low; isotonic fixes curves that bend both ways.
:::

Next: [Notebook: distillation basics](/c/slm-decision-models/11-notebook-distillation) — teacher, soft labels, student, calibration, cell by cell.
