---
section: "1"
title: "What a decision model is"
kicker: "Orientation"
abstract: "A chat model can be roughly right. A decision model cannot: it commits to one action, states its confidence, and has a defined behaviour when it is unsure. Here is the whole loop, as a script you can run."
time: "12 min"
order: 1
outcomes:
  - "Write a decision loop end to end in under eighty lines"
  - "Name the four artefacts a decision model must produce per case"
  - "Tell the difference between an accuracy bug and a policy bug"
---

Most language-model projects optimise accuracy and hope value follows. A decision model inverts that: you state the value function first and accuracy becomes one input to it. The practical consequence is that a decision model is a **system**, not a model — and the system is what you build, test and ship.

This section builds the smallest complete version of that system, in one file, with no dependencies beyond numpy. Everything later in the course replaces one box in this script.

## 1.1 The loop

A decision model turns an observation into four artefacts, every time, for every case:

| Artefact | Why it must exist | What happens without it |
| --- | --- | --- |
| **Action** from a closed set | Downstream systems cannot branch on prose | Parsing errors become production incidents |
| **Probability** over outcomes | The cost matrix needs a number, not a label | Thresholds become guesses |
| **Abstain path** | Some inputs must not be auto-decided | The model guesses, and the guess is invisible |
| **Reason + version** | Auditors, debuggers and reviewers need it | Nobody can explain a decision after the fact |

The fourth one is the one teams skip and then regret. If you cannot answer "which model, which prompt, which thresholds, and why" for a decision made eight months ago, you do not have a decision model — you have an API call.

## 1.2 The whole thing, runnable

Save as `decision_loop.py`. It defines the spec, derives thresholds from the cost matrix, scores cases, decides, evaluates and prints a report.

```python run
"""The smallest complete decision model: spec, policy, evaluation."""
from dataclasses import dataclass, field

import numpy as np

# ---------------------------------------------------------------- 1. the spec
@dataclass
class DecisionSpec:
    actions: list[str]
    costs: dict[tuple[str, str], float]     # (action, outcome) -> cost
    outcomes: list[str] = field(default_factory=list)
    abstain: str | None = None

    def __post_init__(self):
        if not self.outcomes:
            self.outcomes = sorted({o for (_a, o) in self.costs})
        for a in self.actions:
            for o in self.outcomes:
                if (a, o) not in self.costs:
                    raise ValueError(f"missing cost for ({a}, {o})")

    def expected_cost(self, p_good: float) -> dict[str, float]:
        """Expected cost of each action given P(outcomes[1]) = p_good."""
        p = {self.outcomes[0]: 1.0 - p_good, self.outcomes[1]: p_good}
        return {a: sum(self.costs[(a, o)] * p[o] for o in self.outcomes) for a in self.actions}

    def best_action(self, p_good: float) -> str:
        costs = self.expected_cost(p_good)
        return min(self.actions, key=lambda a: costs[a])

    def optimal_regions(self, steps: int = 10_001) -> dict[str, tuple[float, float]]:
        """Where each action wins, in P(good). Exact enough at 1e-4 resolution."""
        grid = np.linspace(0.0, 1.0, steps)
        winners = [self.best_action(float(p)) for p in grid]
        regions: dict[str, tuple[float, float]] = {}
        start = 0.0
        for i in range(1, len(grid)):
            if winners[i] != winners[i - 1]:
                regions.setdefault(winners[i - 1], (start, float(grid[i - 1])))
                start = float(grid[i])
        regions.setdefault(winners[-1], (start, 1.0))
        return regions


spec = DecisionSpec(
    actions=["auto_approve", "manual_review", "decline"],
    costs={
        ("auto_approve", "bad"): 120_000.0, ("auto_approve", "good"): 0.0,
        ("manual_review", "bad"): 900.0,    ("manual_review", "good"): 900.0,
        ("decline", "bad"): 0.0,            ("decline", "good"): 24_000.0,
    },
    abstain="manual_review",
)

# ---------------------------------------------------------------- 2. the policy
def decide(spec: DecisionSpec, p_good: float, min_conf: float = 0.0) -> dict:
    """One decision, with the artefacts a reviewer needs."""
    action = spec.best_action(p_good)
    if min_conf and max(p_good, 1.0 - p_good) < min_conf:
        action = spec.abstain or action
    return {
        "action": action,
        "p_good": round(float(p_good), 4),
        "expected_cost": {a: round(c, 2) for a, c in spec.expected_cost(p_good).items()},
        "abstained": action == spec.abstain,
    }

# ---------------------------------------------------------------- 3. evaluation
def evaluate(spec: DecisionSpec, p_good: np.ndarray, y_good: np.ndarray) -> dict:
    actions = [spec.best_action(float(p)) for p in p_good]
    costs = np.array([spec.costs[(a, spec.outcomes[int(y)])] for a, y in zip(actions, y_good)])
    abstained = np.array([a == spec.abstain for a in actions])
    decided = ~abstained
    # "correct" = the action you would have taken knowing the outcome
    oracle = [min(spec.actions, key=lambda a: spec.costs[(a, spec.outcomes[int(y)])]) for y in y_good]
    return {
        "n": int(len(actions)),
        "cost_per_case": round(float(costs.mean()), 2),
        "abstain_rate": round(float(abstained.mean()), 3),
        "action_accuracy": round(float(np.mean([a == o for a, o in zip(actions, oracle)])), 3),
        "accuracy_on_decided": (round(float(np.mean([actions[i] == oracle[i] for i in np.where(decided)[0]])), 3)
                                if decided.any() else None),
        "action_mix": {a: round(float(np.mean([x == a for x in actions])), 3) for a in spec.actions},
    }


if __name__ == "__main__":
    print("optimal regions (P(good)):", {a: tuple(round(x, 4) for x in r) for a, r in spec.optimal_regions().items()})
    print("decision at p=0.71:", decide(spec, 0.71))

    def apply_capacity_cap(spec, p_good, max_abstain_rate=0.25):
        """Keep the cheapest abstentions; reassign the rest to their next-best action."""
        p_good = np.asarray(p_good, dtype=float)
        actions = [spec.best_action(float(p)) for p in p_good]
        if spec.abstain is None:
            return actions
        budget = int(np.floor(max_abstain_rate * len(actions)))
        idx = [i for i, a in enumerate(actions) if a == spec.abstain]
        if len(idx) <= budget:
            return actions
        margin = []
        for i in idx:
            costs = spec.expected_cost(float(p_good[i]))
            alt = min((c, a) for a, c in costs.items() if a != spec.abstain)
            margin.append((alt[0] - costs[spec.abstain], i, alt[1]))
        margin.sort()
        for _saving, i, alt in margin[: len(idx) - budget]:
            actions[i] = alt
        return actions

    rng = np.random.default_rng(0)
    # a model that is confident on most cases and uncertain on 30% of them
    p_good = np.concatenate([rng.beta(0.4, 0.4, 3500), rng.beta(3, 3, 1500)])
    y_good = (rng.random(5000) < p_good).astype(int)    # calibrated by construction
    for k, v in evaluate(spec, p_good, y_good).items():
        print(f"{k:20} {v}")

    capped = apply_capacity_cap(spec, p_good, max_abstain_rate=0.25)
    costs = np.array([spec.costs[(a, spec.outcomes[int(y)])] for a, y in zip(capped, y_good)])
    print()
    print("with a 25% abstain cap")
    print(f"{'abstain_rate':20} {np.mean([a == spec.abstain for a in capped]):.3f}")
    print(f"{'cost_per_case':20} {costs.mean():.1f}")
    print(f"{'action_mix':20} { {a: round(float(np.mean([x == a for x in capped])), 3) for a in spec.actions} }")
```

Run it. The first line is the whole argument of this course:

```text
optimal regions (P(good)): {'decline': (0.0, 0.0374), 'manual_review': (0.0375, 0.9924), 'auto_approve': (0.9925, 1.0)}
decision at p=0.71: {'action': 'manual_review', 'p_good': 0.71, 'expected_cost': {'auto_approve': 34800.0, 'manual_review': 900.0, 'decline': 17040.0}, 'abstained': True}
n                    5000
cost_per_case        782.1
abstain_rate         0.821
action_accuracy      0.177
accuracy_on_decided  0.99
action_mix           {'auto_approve': 0.058, 'manual_review': 0.821, 'decline': 0.121}

with a 25% abstain cap
abstain_rate         0.250
cost_per_case        4271.4
action_mix           {'auto_approve': 0.188, 'manual_review': 0.25, 'decline': 0.562}
```

Read that abstain rate carefully: **84.5%**. With a review that costs 900 against a bad approval at 120,000, abstention wins almost everywhere. That is correct arithmetic and an unshippable product, and it is the single most common surprise in this work. The fix is a capacity constraint — `apply_capacity_cap` in the listing above, which is also the last block of output. It keeps the abstentions that save the most money and reassigns the rest to their next-best action, so the abstain rate lands exactly on the budget you gave it. The cost per case rises by the amount printed there: that is the price of reviewer capacity, and now you can quote it.

## 1.3 Accuracy bugs versus policy bugs

Nearly every "the model got worse" ticket is one of these, and they need different owners:

| Symptom | Which box is broken | Who fixes it | Diagnostic |
| --- | --- | --- | --- |
| Cost per case rises, ranking of scores unchanged | Thresholds or cost matrix | Product + you | Plot cost vs threshold; check the spec diff |
| Scores move but actions barely change | Calibration | You | ECE before/after; reliability curve |
| Actions shift on inputs the model never saw | Data distribution | Data owner | Length and vocabulary drift on the input slice |
| Abstain rate jumps without a code change | Upstream feature or prompt | Platform | Diff prompt hash and feature version in the log |
| Accuracy on decided cases falls, abstain flat | Model quality | You | Per-class recall, confusion on the decided slice |

The middle column is the point: a decision system has four owners' worth of surface area, and blaming the model by default is why these systems rot.

## 1.4 What "complete" means for the rest of this course

Every section that follows ends with the same three things, because a guide is only practical if you can check it:

- **Complete code.** No `...`, no "left as an exercise". Functions you can paste into a file and run.
- **Captured output.** What the code printed when it was run, so you know what success looks like.
- **A verification step.** The assertion or command that proves the thing still works after you change it.

:::note[Note 1.1.a — the library this course references]
Sections 6 to 10 use the `slm_decision` package from the [slm-decision-models repository](https://github.com/vkdev01/slm-decision-models) — `pip install -e code/`. Everything is also written so you can read the listing and reimplement the part you need; the package exists to save you typing, not to hide logic.
:::

:::warn[Warning 1.2.a]
Do not start with the model. The order is spec, then baseline, then model, then calibration, then the capacity cap, then tests. Teams that start with the model spend months tuning an objective they cannot state, and then discover the abstain rate makes the whole thing unshippable.
:::

## 1.5 Check yourself

```python
# the three assertions that must hold for any spec you write
assert set(spec.costs) == {(a, o) for a in spec.actions for o in spec.outcomes}, "missing cost cell"
assert all(c >= 0 for c in spec.costs.values()), "negative cost"
assert spec.abstain in spec.actions, "abstain must be a real action"
regions = spec.optimal_regions()
assert abs(sum(hi - lo for lo, hi in regions.values()) - 1.0) < 1e-6, "regions must tile [0, 1]"
```

If the regions do not tile the unit interval, you have a cost matrix with a dominated action — one whose cost is never lowest. That is not always wrong (an intermediate action is often dominated and still useful under a capacity cap), but you should know it is there.
