---
section: "4"
title: "Decision theory"
kicker: "Theory"
abstract: "The five-line version of expected utility, the cost matrix that replaces accuracy, and how to price abstention."
time: "5 min"
order: 4
outcomes:
  - "Derive a decision threshold from a cost matrix"
  - "Price abstention and spot an unconstrained argmax that cannot ship"
  - "Split regret into model, approximation and constraint regret"
---

Most ML projects optimise accuracy and then hope it translates into value. A decision model inverts that: you
state the value function first, and accuracy becomes one input to it.

## Expected utility, minimally

Given observation `x`, action `a`, and outcome `y` with posterior `p(y|x)`:

```text
EU(a | x) = Σ_y  p(y | x) · u(a, y)
a*        = argmax_a EU(a | x)
```

Two consequences drive everything else in this guide:

- **You need probabilities, not labels.** A hard label throws away the information that makes the argmax correct under asymmetric costs. This is why [calibration](/c/slm-decision-models/29-metrics) is a first-class metric.
- **The threshold is not 0.5.** It is where the expected utilities of two actions cross, which depends only on the cost ratio and the posterior.

## Thresholds fall out of the cost matrix

Binary case: approve if the case is good, decline if bad. Let `c_FP` be the cost of approving a bad case and
`c_FN` the cost of declining a good one. Then:

```text
approve  ⟺  p(good|x) · 0  +  p(bad|x) · c_FP   <   p(good|x) · c_FN
         ⟺  p(good|x)  >  c_FP / (c_FP + c_FN)

# c_FP = 120,000 and c_FN = 24,000  →  threshold = 120000/144000 = 0.833
# c_FP = 1,000   and c_FN = 9,000   →  threshold = 0.100
```

A 5:1 cost ratio moves the threshold to 0.83 — far from the 0.5 that accuracy-based training implicitly assumes.
Publishing that number, with its derivation, is usually the highest-value artefact a decision team produces.

## The three-action case: pricing abstention

Abstention is not free and not cowardly; it is an action with a cost. With a manual-review action at cost
`c_rev` per case:

| Action | Cost if truly bad | Cost if truly good | Expected cost |
| --- | --- | --- | --- |
| auto_approve | 120,000 | 0 | 120,000 · p(bad) |
| manual_review | 900 | 900 | 900 |
| decline | 0 | 24,000 | 24,000 · p(good) |

Solving the three-way argmax gives two thresholds rather than one. With these numbers, review beats approve when
`120,000 · p_bad > 900`, i.e. `p_bad > 0.0075`, and review beats decline when
`24,000 · p_good > 900`, i.e. `p_good > 0.0375`. So:

```text
p_bad < 0.0075              -> auto_approve
0.0075 <= p_bad <= 0.9625   -> manual_review     (a 95% wide band!)
p_bad > 0.9625              -> decline
```
:::warn[This is the uncomfortable result]
Cheap review makes abstention optimal for almost every case. That is correct arithmetic and a terrible product. The
fix is to constrain the problem — raise `c_rev` to reflect real reviewer cost per case (salary + queue + SLA),
add a capacity constraint, or restrict abstention to a fixed budget (`≤ 25%`) and optimise cost inside that
budget. Never ship an unconstrained argmax without looking at the abstain rate it implies.
:::

## Decision criteria under deep uncertainty

When you cannot defend a probability, use a different criterion:

| Criterion | Rule | Use when |
| --- | --- | --- |
| Expected utility | argmax of probability-weighted payoff | Probabilities are calibrated and costs known |
| Maximin | argmax of the worst-case payoff | Tail risk is unacceptable (safety, medical) |
| Minimax regret | argmin of the worst-case regret vs the best action in hindsight | Costs are known, probabilities are not |
| Satisficing | First action meeting a threshold on all criteria | Real-time routing with hard SLAs |
| Value of information | Act only if the expected gain from another observation exceeds its cost | You can buy a second signal (lab test, API call) |

## Value of information: when to pay for another look

```text
EVSI = E_z[ max_a EU(a | x, z) ] - max_a EU(a | x) - cost(z)
```

If the expected value of sample information is below the cost of the sample, decide now. This is the principled
version of "should the model call the database before answering?" — and the correct answer is usually no, because
latency and cost dominate.

## Regret, and why it is the metric for continuous improvement

```text
regret(x) = EU(a_optimal | x) - EU(a_chosen | x)      # always >= 0
```

Regret decomposes into three attributable parts, which is what makes it useful operationally:

1. **Model regret** — the posterior was wrong. Fix with data, distillation, fine-tuning.
1. **Approximation regret** — the posterior was right, the policy was wrong (bad thresholds, uncalibrated scores). Fix with calibration.
1. **Constraint regret** — the right action was blocked by a rule, a budget or a policy. Fix with the business owner.

Track the three separately. Otherwise every degradation looks like "the model got worse" and nobody knows whose
backlog it belongs in.

## Worked end-to-end example

```python
from slm_decision import DecisionSpec, cost_optimal_policy, evaluate_policy

spec = DecisionSpec(
    actions=["auto_approve", "manual_review", "decline"],
    costs={("auto_approve","default"):120_000, ("auto_approve","repaid"):0,
           ("manual_review","default"):900,  ("manual_review","repaid"):900,
           ("decline","default"):0,          ("decline","repaid"):24_000},
    abstain="manual_review", max_abstain_rate=0.25,
)
policy = cost_optimal_policy(spec)          # solves the argmax, then applies the abstain cap
report = evaluate_policy(spec, policy, y_true=y_test, scores=p_test)
print(report.cost_per_case, report.abstain_rate, report.ece)
```

The library's `cost_optimal_policy` solves the unconstrained argmax first, then tightens the abstain band
until the rate meets `max_abstain_rate` — the constrained version of the table above.

:::note[Reading next]
With framing settled, [chapter 03](/c/slm-decision-models/05-why-slms) covers why an SLM is the right engine for this, and
[chapter 04](/c/slm-decision-models/06-distillation) shows how to get the task behaviour out of a larger teacher.
:::

:::exercise[Exercise 04.1 · Score your cost matrix]{id="scorecard" labels="Actions named,Outcomes named,Every cell filled,Costs defended,Abstain priced" scale="4" unit="matrix"}
:::

