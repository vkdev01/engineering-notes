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

A decision pipeline has five parts, and only one of them is a model. You need something that produces a probability, something that makes that probability honest, a rule that converts it into an action, a constraint that keeps the action volume affordable, and a report that says what the whole thing cost. Teams that build only the first part and then argue about accuracy have skipped four fifths of the system.

The order matters, and it is not the order most projects follow. The cost matrix comes before the model, because it fixes the threshold; calibration comes before the threshold, because an over-confident score puts the threshold in the wrong place; the capacity cap comes after both, because it is a constraint on the answer rather than on the model.

This section builds all five, on CPU, with numpy, in one file. Later sections replace the baseline with a distilled SLM and the synthetic data with yours, and nothing else in the file changes — which is the point of separating the decision layer from the model layer.

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

## 2.3 The threshold is a curve, not a number

Before reading the table, look at what the threshold does to cost across its whole range. This is computed from the same 5,000 cases the pipeline scores:

<svg viewBox="0 0 760 320" role="img" aria-label="The threshold is a business decision, not a default — cheapest here is 0.82" style="width:100%;height:auto;font-family:var(--sans,system-ui);font-size:11px">
<rect x="0" y="0" width="760" height="320" fill="transparent"/>
<line x1="62" y1="274.0" x2="610" y2="274.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="278.0" text-anchor="end" fill="var(--dim,#5c6472)">0</text>
<line x1="62" y1="194.0" x2="610" y2="194.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="198.0" text-anchor="end" fill="var(--dim,#5c6472)">20k</text>
<line x1="62" y1="114.0" x2="610" y2="114.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="118.0" text-anchor="end" fill="var(--dim,#5c6472)">40k</text>
<line x1="62" y1="34.0" x2="610" y2="34.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="38.0" text-anchor="end" fill="var(--dim,#5c6472)">60k</text>
<line x1="62.0" y1="274" x2="62.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="62.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.01</text>
<line x1="171.6" y1="274" x2="171.6" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="171.6" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.21</text>
<line x1="281.2" y1="274" x2="281.2" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="281.2" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.40</text>
<line x1="390.8" y1="274" x2="390.8" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="390.8" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.60</text>
<line x1="500.4" y1="274" x2="500.4" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="500.4" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.79</text>
<line x1="610.0" y1="274" x2="610.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="610.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">0.99</text>
<line x1="62" y1="274" x2="610" y2="274" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<line x1="62" y1="274" x2="62" y2="34" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<polyline points="62.0,61.8 67.6,73.7 73.2,81.1 78.8,87.5 84.4,92.5 90.0,97.1 95.6,101.4 101.1,105.6 106.7,109.0 112.3,111.6 117.9,114.4 123.5,117.2 129.1,120.0 134.7,123.1 140.3,125.4 145.9,128.6 151.5,131.5 157.1,134.2 162.7,137.5 168.2,139.4 173.8,141.8 179.4,143.8 185.0,146.5 190.6,149.9 196.2,152.2 201.8,154.3 207.4,156.7 213.0,160.4 218.6,163.2 224.2,165.9 229.8,168.1 235.3,170.9 240.9,173.7 246.5,177.3 252.1,180.2 257.7,182.6 263.3,185.1 268.9,187.5 274.5,189.2 280.1,191.7 285.7,194.4 291.3,196.4 296.9,198.7 302.4,201.2 308.0,202.4 313.6,203.5 319.2,205.2 324.8,207.4 330.4,209.3 336.0,211.2 341.6,212.4 347.2,214.0 352.8,215.7 358.4,217.9 364.0,218.7 369.6,220.1 375.1,221.9 380.7,224.3 386.3,225.7 391.9,227.3 397.5,228.7 403.1,229.7 408.7,231.2 414.3,231.8 419.9,233.1 425.5,233.7 431.1,234.4 436.7,235.4 442.2,235.7 447.8,236.9 453.4,237.3 459.0,238.2 464.6,239.2 470.2,240.4 475.8,240.7 481.4,241.2 487.0,241.4 492.6,241.3 498.2,241.2 503.8,241.5 509.3,241.5 514.9,242.0 520.5,241.6 526.1,241.5 531.7,241.2 537.3,241.0 542.9,241.0 548.5,240.8 554.1,240.8 559.7,240.7 565.3,240.8 570.9,240.4 576.4,239.9 582.0,239.4 587.6,238.4 593.2,237.6 598.8,236.7 604.4,235.3 610.0,233.4" fill="none" stroke="var(--accent,#6d28d9)" stroke-width="2.2"/>
<polyline points="336.0,242.0 336.0,61.8" fill="none" stroke="var(--dim,#6a7059)" stroke-width="2.2" stroke-dasharray="5 4"/>
<text x="336" y="312" text-anchor="middle" fill="var(--ink-2,#3a3f2c)">decision threshold on P(good)</text>
<text x="14" y="154" text-anchor="middle" fill="var(--ink-2,#3a3f2c)" transform="rotate(-90 14 154)">cost per case (INR)</text>
<text x="62" y="18" fill="var(--ink,#15170f)" font-size="12.5" font-weight="600">The threshold is a business decision, not a default — cheapest here is 0.82</text>
<line x1="624" y1="42" x2="644" y2="42" stroke="var(--accent,#6d28d9)" stroke-width="2.4"/>
<text x="650" y="46" fill="var(--ink-2,#3a3f2c)">cost per case</text>
<line x1="624" y1="62" x2="644" y2="62" stroke="var(--dim,#6a7059)" stroke-width="2.4" stroke-dasharray="5 4"/>
<text x="650" y="66" fill="var(--ink-2,#3a3f2c)">naive 0.5</text>
</svg>

The curve is the reason the naive 0.5 rule is expensive and the reason you should not over-tune either: the minimum is broad, so a threshold within a few hundredths of optimal costs almost nothing, while sitting at 0.5 costs multiples of the minimum. Get the cost matrix roughly right and the threshold takes care of itself.

## 2.4 How to read that table

Three things in that output are worth more than the rest of the section.

**The cost policy is *less* accurate and three times cheaper.** `accuracy_decided` falls from 0.686 to 0.615 while cost per case falls from 23,715 to 7,522. If your review gate is "accuracy must not regress", this pipeline fails it — and ships the expensive version. Gate on cost per case instead.

**Calibration was already fine, and the numbers prove it.** The fitted temperature is 0.990 and ECE moves from 0.0323 to 0.0329 — i.e. it does not improve, because the synthetic scores were calibrated by construction. On your data this row is the one that moves; when it does not, do not ship a calibrator just because the course has one.

**Regret equals cost here, which tells you about the matrix, not the model.** The oracle always has a free action in this cost matrix (decline a bad case, approve a good one), so oracle cost is zero and regret collapses into cost per case. §4 shows the version where the oracle pays something, which is when the decomposition earns its keep.

The `argmin @ 0.5` row is what an accuracy-first pipeline ships by default: no abstain path, and it pays 120,000 for every bad approval.

## 2.5 What to do when a number looks wrong

| Reading | Likely cause | Check |
| --- | --- | --- |
| Cost per case near the review cost × cases | Abstain rate hit the cap | Print the action mix; the cap is binding |
| ECE barely moves after calibration | Scores already calibrated, or label noise dominates | Compare reliability curves before/after |
| `accuracy_decided` is very high, cost is high | The policy abstains on the hard cases and eats the review cost | Compare with `MAX_ABSTAIN = 0.5` to see the trade |
| Regret is a large fraction of cost | Model, not policy, is the bottleneck | Per-class recall on the decided slice |

## 2.6 The verification step

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
