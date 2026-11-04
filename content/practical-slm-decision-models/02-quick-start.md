---
section: "2"
title: "Quick start"
kicker: "Build"
abstract: "One file, no downloads: load cases, fit a baseline, calibrate it, derive the threshold from the cost matrix, apply a capacity cap, and print the report a launch review actually needs."
time: "14 min"
order: 2
outcomes:
  - "Stand up a full decision pipeline in one script"
  - "Read cost per case, abstain rate and ECE together"
  - "Know which of the three numbers can veto a launch"
---

This is the smallest pipeline that is still honest: a baseline you must beat, a calibration step, a cost-derived threshold, a capacity cap, and a report. Everything runs on CPU with numpy. Later sections replace the baseline with a distilled SLM and the synthetic data with your own, and nothing else in this file changes.

## 2.1 Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install numpy pandas
pip install -e "git+https://github.com/vkdev01/slm-decision-models.git#egg=slm-decision&subdirectory=code"
```

The package is optional — the listing below is self-contained. Use it when you want the tested version of the metrics and the calibrators.

## 2.2 The pipeline

```python run
"""End-to-end decision pipeline: baseline -> calibration -> cost policy -> report."""
import numpy as np

# ---------------------------------------------------------------- 1. the decision
ACTIONS = ["approve", "review", "decline"]
OUTCOMES = ["bad", "good"]          # sorted: index 1 is the "good" outcome
COSTS = {
    ("approve", "bad"): 120_000.0,  ("approve", "good"): 0.0,
    ("review",  "bad"): 900.0,      ("review",  "good"): 900.0,
    ("decline", "bad"): 0.0,        ("decline", "good"): 24_000.0,
}
ABSTAIN = "review"
MAX_ABSTAIN = 0.25


def expected_cost(p_good: float) -> dict[str, float]:
    p = {OUTCOMES[0]: 1.0 - p_good, OUTCOMES[1]: p_good}
    return {a: sum(COSTS[(a, o)] * p[o] for o in OUTCOMES) for a in ACTIONS}


def argmin_action(p_good: float) -> str:
    costs = expected_cost(p_good)
    return min(ACTIONS, key=lambda a: costs[a])


# ---------------------------------------------------------------- 2. the data
def make_data(n=8000, seed=0):
    """A weak signal plus label noise - deliberately not linearly separable."""
    rng = np.random.default_rng(seed)
    X = rng.normal(0, 1.0, (n, 12))
    z = 1.4 * X[:, 0] - 0.9 * X[:, 1] + 0.6 * X[:, 2] * X[:, 3] + rng.normal(0, 1.0, n)
    y = (rng.random(n) < 1 / (1 + np.exp(-z))).astype(int)
    flip = rng.random(n) < 0.08                      # 8% label noise
    y[flip] = 1 - y[flip]
    return X, y


def split(X, y, frac=0.6):
    n = int(frac * len(X))
    return X[:n], y[:n], X[n:], y[n:]


# ---------------------------------------------------------------- 3. the baseline
def fit_logistic(X, y, epochs=600, lr=0.5, l2=1e-3):
    """Full-batch logistic regression. Complete, no sklearn."""
    w = np.zeros(X.shape[1])
    b = 0.0
    for _ in range(epochs):
        p = 1 / (1 + np.exp(-(X @ w + b)))
        w -= lr * (X.T @ (p - y) / len(y) + l2 * w)
        b -= lr * float((p - y).mean())
    return w, b


def predict_proba(X, w, b):
    return 1 / (1 + np.exp(-(X @ w + b)))


# ---------------------------------------------------------------- 4. calibration
def fit_temperature(p, y, grid=np.exp(np.linspace(np.log(0.05), np.log(20), 300))):
    """One scalar that makes the scores honest. Monotone, so ranking is untouched."""
    logit = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    best_t, best_nll = 1.0, np.inf
    for t in grid:
        q = 1 / (1 + np.exp(-logit / t))
        nll = -np.mean(y * np.log(np.clip(q, 1e-12, 1)) + (1 - y) * np.log(np.clip(1 - q, 1e-12, 1)))
        if nll < best_nll:
            best_t, best_nll = float(t), nll
    return best_t


def apply_temperature(p, t):
    logit = np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))
    return 1 / (1 + np.exp(-logit / t))


def ece(p, y, bins=15):
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    return float(sum((idx == b).mean() * abs(y[idx == b].mean() - p[idx == b].mean())
                     for b in range(bins) if (idx == b).any()))


# ---------------------------------------------------------------- 5. policy + report
def act(p_good, max_abstain=MAX_ABSTAIN):
    p_good = np.asarray(p_good, dtype=float)
    actions = [argmin_action(float(p)) for p in p_good]
    budget = int(np.floor(max_abstain * len(actions)))
    idx = [i for i, a in enumerate(actions) if a == ABSTAIN]
    if len(idx) > budget:
        margin = []
        for i in idx:
            costs = expected_cost(float(p_good[i]))
            alt = min((c, a) for a, c in costs.items() if a != ABSTAIN)
            margin.append((alt[0] - costs[ABSTAIN], i, alt[1]))
        margin.sort()
        for _saving, i, alt in margin[: len(idx) - budget]:
            actions[i] = alt
    return actions


def report(actions, y):
    costs = np.array([COSTS[(a, OUTCOMES[int(t)])] for a, t in zip(actions, y)])
    oracle = [min(ACTIONS, key=lambda a: COSTS[(a, OUTCOMES[int(t)])]) for t in y]
    decided = [i for i, a in enumerate(actions) if a != ABSTAIN]
    return {
        "n": len(actions),
        "cost_per_case": round(float(costs.mean()), 1),
        "abstain_rate": round(float(np.mean([a == ABSTAIN for a in actions])), 3),
        "accuracy_decided": round(float(np.mean([actions[i] == oracle[i] for i in decided])), 3) if decided else None,
        "regret": round(float(np.mean([COSTS[(a, OUTCOMES[int(t)])] -
                                       COSTS[(o, OUTCOMES[int(t)])]
                                       for a, o, t in zip(actions, oracle, y)])), 1),
    }


X, y = make_data()
Xtr, ytr, Xte, yte = split(X, y)
Xtr, Xte = (Xtr - Xtr.mean(0)) / Xtr.std(0), (Xte - Xtr.mean(0)) / Xtr.std(0)

w, b = fit_logistic(Xtr, ytr)
p_tr, p_te = predict_proba(Xtr, w, b), predict_proba(Xte, w, b)

T = fit_temperature(p_tr, ytr)
p_cal = apply_temperature(p_te, T)

print("temperature          %.3f" % T)
print("ECE raw / calibrated %.4f / %.4f" % (ece(p_te, yte), ece(p_cal, yte)))
print()
print("%-22s %8s %8s %10s %8s" % ("policy", "cost", "abstain", "acc_dec", "regret"))
for name, p in (("argmin @ 0.5", (p_te >= 0.5).astype(float)),
                ("cost policy, raw", p_te),
                ("cost policy, calibrated", p_cal)):
    if name.startswith("argmin"):
        acts = ["approve" if x >= 0.5 else "decline" for x in p]
    else:
        acts = act(p)
    r = report(acts, yte)
    print("%-22s %8.0f %8.3f %10s %8.0f" % (name, r["cost_per_case"], r["abstain_rate"],
                                            r["accuracy_decided"], r["regret"]))
```

```text
temperature          0.990
ECE raw / calibrated 0.0323 / 0.0329

policy                     cost  abstain    acc_dec   regret
argmin @ 0.5              23715    0.000      0.686    23715
cost policy, raw           7538    0.250      0.614     7538
cost policy, calibrated     7522    0.250      0.615     7522
```

## 2.3 How to read that table

Three things in that output are worth more than the rest of the section.

**The cost policy is *less* accurate and three times cheaper.** `accuracy_decided` falls from 0.686 to 0.615 while cost per case falls from 23,715 to 7,522. If your review gate is "accuracy must not regress", this pipeline fails it — and ships the expensive version. Gate on cost per case instead.

**Calibration was already fine, and the numbers prove it.** The fitted temperature is 0.990 and ECE moves from 0.0323 to 0.0329 — i.e. it does not improve, because the synthetic scores were calibrated by construction. On your data this row is the one that moves; when it does not, do not ship a calibrator just because the course has one.

**Regret equals cost here, which tells you about the matrix, not the model.** The oracle always has a free action in this cost matrix (decline a bad case, approve a good one), so oracle cost is zero and regret collapses into cost per case. §4 shows the version where the oracle pays something, which is when the decomposition earns its keep.

The `argmin @ 0.5` row is what an accuracy-first pipeline ships by default: no abstain path, and it pays 120,000 for every bad approval.

## 2.4 What to do when a number looks wrong

| Reading | Likely cause | Check |
| --- | --- | --- |
| Cost per case near the review cost × cases | Abstain rate hit the cap | Print the action mix; the cap is binding |
| ECE barely moves after calibration | Scores already calibrated, or label noise dominates | Compare reliability curves before/after |
| `accuracy_decided` is very high, cost is high | The policy abstains on the hard cases and eats the review cost | Compare with `MAX_ABSTAIN = 0.5` to see the trade |
| Regret is a large fraction of cost | Model, not policy, is the bottleneck | Per-class recall on the decided slice |

## 2.5 The verification step

```python run
# invariants that must hold before you look at any headline number
acts = act(p_cal)
assert np.mean([a == ABSTAIN for a in acts]) <= MAX_ABSTAIN + 1e-9, "cap violated"
assert all(a in ACTIONS for a in acts), "action outside the closed set"
assert 0.0 <= ece(p_cal, yte) <= 1.0

# calibration must not reorder cases: the policy can only change through thresholds
assert np.all(np.argsort(p_te) == np.argsort(p_cal)), "temperature changed the ranking"

# cost must improve when you move from the naive rule to the cost rule
naive = report(["approve" if x >= 0.5 else "decline" for x in p_cal], yte)
costly = report(act(p_cal), yte)
assert costly["cost_per_case"] < naive["cost_per_case"], "cost policy is not cheaper"
print("invariants ok:", {"naive_cost": naive["cost_per_case"], "policy_cost": costly["cost_per_case"]})
```

```text
invariants ok: {'naive_cost': 23715.0, 'policy_cost': 7522.5}
```

:::warn[Warning 2.1.a — the ranking assertion is not decoration]
If `argsort` changes, your calibrator is not monotone and every threshold you derived from the cost matrix is now attached to a different case. Isotonic regression fitted on a small slice can do this. Assert it in CI.
:::

:::note[Note 2.2.a — where your own data goes]
Replace `make_data()` with a loader that returns `(texts_or_features, labels)` and keep the split by entity, not by row: split by customer id, document id or patient id. Row-level splits on duplicated content inflate accuracy by 5–20 points, and the inflation survives every test you write.
:::
