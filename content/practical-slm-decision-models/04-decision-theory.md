---
section: "4"
title: "Decision theory"
kicker: "Theory"
abstract: "Thresholds solved exactly rather than eyeballed, abstention priced as an action, regret decomposed into the three parts that have different owners, and the value of a second signal computed before you pay for it."
time: "16 min"
order: 4
outcomes:
  - "Solve optimal action regions analytically from a cost matrix"
  - "Price abstention and detect an unshippable argmax before building it"
  - "Attribute regret to the model, the policy or a constraint"
---

Expected utility is a two-line idea: multiply each action's cost by the probability of each outcome, add, take the smallest. Everything else in this section is about doing that correctly, and about what to do when the answer is arithmetically right and operationally absurd.

## 4.1 Regions, solved exactly

The grid search in §1 is fine for intuition and wrong for production: it is off by half a grid step and it hides dominated actions. With two outcomes every action's expected cost is a straight line in `p = P(good)`, so the regions are found by intersecting lines:

```python run
"""Exact optimal regions, abstain pricing and regret decomposition."""
import itertools

ACTIONS = ["auto_approve", "manual_review", "decline"]
COSTS = {
    ("auto_approve", "bad"): 120_000.0, ("auto_approve", "good"): 0.0,
    ("manual_review", "bad"): 900.0,    ("manual_review", "good"): 900.0,
    ("decline", "bad"): 0.0,            ("decline", "good"): 24_000.0,
}


def line(action):
    """Expected cost as m*p + c with p = P(good)."""
    c_bad, c_good = COSTS[(action, "bad")], COSTS[(action, "good")]
    return c_good - c_bad, c_bad


def crossing(a1, a2):
    m1, c1 = line(a1)
    m2, c2 = line(a2)
    if abs(m1 - m2) < 1e-12:
        return None
    p = (c2 - c1) / (m1 - m2)
    return p if 0.0 <= p <= 1.0 else None


def regions():
    """[(p_lo, p_hi, action)] - exact, no grid."""
    cuts = sorted({0.0, 1.0} | {x for a1, a2 in itertools.combinations(ACTIONS, 2)
                                for x in [crossing(a1, a2)] if x is not None})
    out = []
    for lo, hi in zip(cuts[:-1], cuts[1:]):
        mid = (lo + hi) / 2
        best = min(ACTIONS, key=lambda a: line(a)[0] * mid + line(a)[1])
        if out and out[-1][2] == best:
            out[-1] = (out[-1][0], hi, best)
        else:
            out.append((lo, hi, best))
    return out


def dominated():
    """Actions that are never cheapest for any p. Not always a mistake - see 4.2."""
    winners = {a for _lo, _hi, a in regions()}
    return [a for a in ACTIONS if a not in winners]


def best_action(p):
    return min(ACTIONS, key=lambda a: line(a)[0] * p + line(a)[1])


def expected_cost(p):
    return {a: round(line(a)[0] * p + line(a)[1], 2) for a in ACTIONS}


print("regions (P(good)):")
for lo, hi, a in regions():
    print("  %6.4f - %6.4f  %-14s  cost at midpoint %9.0f" % (lo, hi, a, expected_cost((lo + hi) / 2)[a]))
print("dominated actions:", dominated() or "none")
print()
print("the threshold people quote: P(good) > %.4f to approve" % crossing("auto_approve", "decline"))
print("expected cost at p=0.71:", expected_cost(0.71))
```

```text
regions (P(good)):
  0.0000 - 0.0375  decline         cost at midpoint       450
  0.0375 - 0.9925  manual_review   cost at midpoint       900
  0.9925 - 1.0000  auto_approve    cost at midpoint       450
dominated actions: none

the threshold people quote: P(good) > 0.8333 to approve
expected cost at p=0.71: {'auto_approve': 34800.0, 'manual_review': 900.0, 'decline': 17040.0}
```

The `manual_review` region spans almost the whole interval, which is the arithmetic telling you the review is too cheap relative to the mistakes it prevents. Two responses, and only one of them is a modelling change:

- **Raise the review cost** to what a reviewer actually costs per case: salary per hour ÷ cases per hour, plus queueing delay and the SLA penalty for slow decisions.
- **Cap the volume** instead of the price: keep the cost matrix and add `max_abstain_rate`, which §1 implements and §2 uses.

Doing neither is how a team ends up with a policy that routes 82% of traffic to humans and calls it a success because the cost per case fell.

## 4.2 Abstention is an action, and dominated actions can still be right

`manual_review` is never the cheapest action under certainty — if you knew the outcome you would approve or decline. It is still correct to keep it, because a decision model never knows the outcome; it knows a probability. A dominated action that is optimal over a *range of probabilities* is exactly what an abstain path is.

The distinction that matters is between an action that is dominated over the whole probability space and one that is merely never optimal under certainty. The first is dead weight; the second is your escalation path.

## 4.3 Regret, decomposed

Regret is what you lost by not taking the best action given the same information. Decompose it, because the three parts have different owners:

```python run
"""Regret = model regret + approximation regret + constraint regret."""
import numpy as np

rng = np.random.default_rng(7)
n = 6000
p_true = rng.beta(0.6, 0.6, n)                 # the real posterior for each case
y = (rng.random(n) < p_true).astype(int)

# the model's belief: honest on average, wrong per case
p_model = np.clip(p_true + rng.normal(0, 0.10, n), 0.001, 0.999)


def action_for(p, cap=None, budget_actions=None):
    """Cost-optimal action, optionally under a capacity constraint."""
    if cap is not None and budget_actions is not None:
        return budget_actions
    return best_action(float(p))


def realised_cost(action, outcome):
    return COSTS[(action, "good" if outcome else "bad")]


def eu(action, p):
    return COSTS[(action, "bad")] * (1 - p) + COSTS[(action, "good")] * p


# 1. the oracle: right action for the true posterior, no constraints
oracle = [best_action(float(p)) for p in p_true]
# 2. the policy: right action for the model's belief
chosen = [best_action(float(p)) for p in p_model]
# 3. a no-model baseline: the single action with the lowest expected cost overall
best_constant = min(ACTIONS, key=lambda a: np.mean([eu(a, float(p)) for p in p_true]))
# 3. the constrained policy: same, but at most 25% may abstain
order = np.argsort([-(eu("manual_review", float(p)) < min(eu("auto_approve", float(p)),
                                                            eu("decline", float(p))))
                    for p in p_model])
capped = list(chosen)
budget = int(0.25 * n)
abstaining = [i for i, a in enumerate(capped) if a == "manual_review"]
for i in sorted(abstaining, key=lambda i: eu("manual_review", float(p_model[i])) -
                min(eu("auto_approve", float(p_model[i])), eu("decline", float(p_model[i]))))[:max(0, len(abstaining) - budget)]:
    capped[i] = best_action_excl = min(("auto_approve", "decline"),
                                      key=lambda a: eu(a, float(p_model[i])))

def regret(actions):
    """Expected regret against the true posterior - not the realised outcome."""
    return float(np.mean([eu(a, float(p)) - eu(o, float(p)) for a, o, p in zip(actions, oracle, p_true)]))


total = regret(capped)
belief = regret(chosen)
constraint = total - belief
baseline = regret([best_constant] * n)

print("no-model baseline: always %s" % best_constant)
print("  regret of always taking it        %10.1f" % baseline)
print("  what the model buys you           %10.1f" % (baseline - belief))
print()
print("regret of the constrained policy    %10.1f" % total)
print("  belief error (model vs truth)     %10.1f" % belief)
print("  constraint (capacity cap)         %10.1f" % constraint)
print()
print("realised cost, oracle actions      %10.1f" % float(np.mean([realised_cost(o, t) for o, t in zip(oracle, y)])))
```

```text
no-model baseline: always manual_review
  regret of always taking it              71.9
  what the model buys you               -419.0

regret of the constrained policy        7403.9
  belief error (model vs truth)          490.9
  constraint (capacity cap)             6912.9

realised cost, oracle actions           842.9
```

The split is the point, and it is two parts, not three. **Belief error** is yours: it shrinks with better calibration and better data, and it is what a better model buys. **Constraint regret** belongs to whoever set the abstain budget — it is the number to bring to that meeting, and no amount of modelling will remove it.

The baseline row is the one teams forget to compute: the regret of taking the single best action for every case. Here it is **negative** — the constant "always review" policy has lower regret than the model's policy — and that is not a bug in the code, it is the cost matrix talking. When one action is optimal across almost the whole probability range, a model that sometimes picks a different action can only lose. Fix the matrix (a review that costs 900 against a 120,000 mistake is too cheap) before spending anything on the model.

That is the most useful thing this section can teach you: **compute the constant-action baseline first.** If your model does not beat it, you have a framing problem, not a modelling problem, and no amount of distillation will help.

## 4.4 Value of a second signal

The principled version of "should the model call the database first?" is expected value of sample information: compare the expected cost after seeing the signal with the expected cost now, and subtract what the signal costs.

```python run
"""EVSI: should you pay for one more observation before deciding?"""

def evsi(p_prior, signal_accuracy, cost_signal):
    """A binary signal with known sensitivity/specificity, both = signal_accuracy."""
    sens = spec = signal_accuracy
    # P(signal=1) under the prior
    p_pos = sens * p_prior + (1 - spec) * (1 - p_prior)
    p_neg = 1 - p_pos
    # posterior after a positive and a negative signal
    post_pos = sens * p_prior / p_pos if p_pos > 0 else p_prior
    post_neg = (1 - sens) * p_prior / p_neg if p_neg > 0 else p_prior
    cost_now = min(eu(a, p_prior) for a in ACTIONS)
    cost_after = p_pos * min(eu(a, post_pos) for a in ACTIONS) + \
                 p_neg * min(eu(a, post_neg) for a in ACTIONS)
    return {"cost_now": round(cost_now, 1), "cost_after": round(cost_after, 1),
            "gain": round(cost_now - cost_after, 1),
            "evsi": round(cost_now - cost_after - cost_signal, 1)}


for p_prior in (0.2, 0.5, 0.8):
    for acc in (0.7, 0.9, 0.99):
        r = evsi(p_prior, acc, cost_signal=250.0)
        print("p=%.1f  signal acc=%.2f  gain %8.1f  EVSI %8.1f  %s" %
              (p_prior, acc, r["gain"], r["evsi"], "buy it" if r["evsi"] > 0 else "decide now"))
```

```text
p=0.2  signal acc=0.70  gain      0.0  EVSI   -250.0  decide now
p=0.2  signal acc=0.90  gain    186.0  EVSI    -64.0  decide now
p=0.2  signal acc=0.99  gain    666.6  EVSI    416.6  buy it
p=0.5  signal acc=0.70  gain      0.0  EVSI   -250.0  decide now
p=0.5  signal acc=0.90  gain      0.0  EVSI   -250.0  decide now
p=0.5  signal acc=0.99  gain    330.0  EVSI     80.0  buy it
p=0.8  signal acc=0.70  gain      0.0  EVSI   -250.0  decide now
p=0.8  signal acc=0.90  gain      0.0  EVSI   -250.0  decide now
p=0.8  signal acc=0.99  gain    474.6  EVSI    224.6  buy it
```

Read the last column as a rule: buy the signal only when the EVSI is positive. Note the p=0.5 rows where a 0.90-accuracy signal gains exactly nothing — with this cost matrix the review action is optimal across almost the whole probability range, so no signal short of near-certainty moves the action. A signal is only worth buying when it can change which action you take, which is a property of the cost matrix, not of the signal.

:::note[Note 4.1.a — which criterion when]
Expected utility needs calibrated probabilities and defensible costs. When you have neither — a new domain, a regulator asking about tails — use maximin over the plausible cost range and say so explicitly. Minimax regret is the right middle ground when costs are known but probabilities are contested. What is never acceptable is quietly using expected utility with invented numbers.
:::

## 4.5 Check yourself

```python run
# the properties any cost matrix must satisfy before it goes near a model
regs = regions()
assert abs(sum(hi - lo for lo, hi, _a in regs) - 1.0) < 1e-9, "regions must tile [0, 1]"
assert all(lo < hi for lo, hi, _a in regs), "empty region"
for lo, hi, a in regs:                                   # the winner must win inside its region
    mid = (lo + hi) / 2
    assert best_action(mid) == a, "region and argmin disagree at %.3f" % mid
# a cost matrix with no free action has a non-zero floor - check you meant that
floor = min(max(COSTS[(a, o)] for a in ACTIONS) for o in ("bad", "good"))
print("regions tile [0,1]: ok | worst-case cost floor: %.0f" % floor)
```

```text
regions tile [0,1]: ok | worst-case cost floor: 24000
```
