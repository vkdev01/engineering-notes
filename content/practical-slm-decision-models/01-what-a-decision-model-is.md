---
section: "1"
title: "What a decision model is"
kicker: "Orientation"
abstract: "A decision model is not a classifier with a label on top: it is an observation, a closed set of actions, the outcomes those actions meet, what each pairing costs, and a policy that picks the cheapest action under uncertainty. This section builds that definition from the loan example and shows why a probability plus a cost matrix beats a label."
time: "16 min"
order: 1
outcomes:
  - "Name the five parts of a decision and fill them in for a real workflow"
  - "Derive the approve/decline threshold 0.833 from two costs"
  - "Compute the review band from the price of a review, and when it vanishes"
  - "Show two cases with the same label that deserve different actions"
  - "Decide what a decision log must record so a choice can be explained months later"
---

A lender pre-screens loan applications. A classifier trained on past repayments labels each applicant `good` or `bad`, and the first version of the system approves every `good`. Six months later the default rate is too high, the data science team reports that accuracy is fine, and nobody can say which number to change. The classifier is not broken. The *system* never said what a wrong approval costs compared with a wrong decline, so it could not choose between them — it approved everything above 0.5 because that is what `argmax` does.

This section defines a decision model precisely enough that this cannot happen, using the running example of the course: **loan pre-approval triage**, with actions `auto_approve`, `manual_review` and `decline`.

:::key[First principle]
A decision model outputs an **action**, not a label. It needs a probability over outcomes and a cost for every (action, outcome) pair; the action is whichever has the lowest expected cost. Accuracy is one input to that arithmetic, never the objective.
:::

## 1.1 The five parts of a decision

Every automated decision, from loan triage to ticket routing, has the same five parts. If any one is missing, the system is guessing.

| Part | Symbol | Loan triage | What breaks if it is missing |
| --- | --- | --- | --- |
| **Observation** | $x$ | Application form, bureau features, bank-statement summary | Nothing to decide on |
| **Closed action set** | $\mathcal{A}$ | `auto_approve`, `manual_review`, `decline` | Downstream code cannot branch on free text |
| **Outcomes** | $y \in \mathcal{Y}$ | `good` (repays), `bad` (defaults) | No way to say what "right" meant |
| **Costs** | $C(a, y)$ | ₹120,000 for approving a bad case, ₹24,000 for declining a good one, the price of a review | Every threshold is a guess |
| **Policy** | $\pi(x) \in \mathcal{A}$ | Pick the action with the lowest expected cost, subject to review capacity | The model's output never becomes an action |

The policy that minimises expected cost is one line:

$$
\pi(x) \;=\; \arg\min_{a \in \mathcal{A}} \; \sum_{y \in \mathcal{Y}} P(y \mid x)\, C(a, y)
$$

The model supplies exactly one term in that line: $P(y \mid x)$. Everything else — the action set, the outcomes, the cost matrix, the capacity constraint — is a business decision that someone has to write down. A team that skips this writes a model and hopes the policy emerges.

The loan cost matrix, in full:

| Action \ outcome | `good` (repays) | `bad` (defaults) |
| --- | ---: | ---: |
| `auto_approve` | ₹0 | ₹120,000 |
| `manual_review` | $r$ | $r$ |
| `decline` | ₹24,000 (lost margin) | ₹0 |

The review row is flat because a reviewer costs the same whether the applicant turns out good or bad. Its price $r$ is the most argued-about number in the matrix; §1.4 shows why it matters so much.

## 1.2 Prediction versus decision

A prediction answers *"how likely is this applicant to repay?"*. A decision answers *"what do we do with this application?"*. They are different questions with different owners:

| | Prediction | Decision |
| --- | --- | --- |
| Output | $P(\text{good} \mid x) = 0.62$ | `manual_review` |
| Judged by | Calibration, ranking (AUC, log loss) | Cost per case, review volume |
| Changes when | The model or the data changes | The model, the data **or the costs** change |
| Owner | ML team | ML team + product + risk + operations |

A classifier that emits a label has already made a decision — silently. Taking `argmax` over two outcomes means "approve when $P(\text{good}) > 0.5$", and 0.5 is the right threshold only when both mistakes cost the same. Write the expected costs of the two actions and see:

$$
\begin{aligned}
\mathbb{E}[C \mid \texttt{approve}] &= (1-p)\cdot c_{AB}, \qquad
\mathbb{E}[C \mid \texttt{decline}] = p \cdot c_{DG} \\[4pt]
\text{approve} \iff (1-p)\,c_{AB} < p\,c_{DG} &\iff p > p^* = \frac{c_{AB}}{c_{AB} + c_{DG}}
\end{aligned}
$$

where $p = P(\text{good} \mid x)$, $c_{AB}$ is the cost of approving a bad case and $c_{DG}$ the cost of declining a good one. With $c_{AB} = c_{DG}$, $p^* = 0.5$ — the `argmax` rule. With the loan costs:

$$
p^* = \frac{120{,}000}{120{,}000 + 24{,}000} = 0.8\overline{3}
$$

A bad approval costs five times a wrong decline, so the model must be five-to-one confident ($p/(1-p) > 5$) before approving. Shipping 0.5 instead is not "40% less cautious"; it approves every applicant between 0.5 and 0.833, each of whom the business has already declared unaffordable.

:::pull
`argmax` is a policy that assumes every mistake costs the same. In most real decisions that assumption is the most expensive line in the system.
:::

## 1.3 Same label, different action

The argument becomes concrete with two applicants. Both get the label `good` from an `argmax` classifier because both have $P(\text{good}) > 0.5$.

:::example[Worked example · two "good" applicants, two actions]
Two actions only (approve or decline), costs ₹120,000 and ₹24,000.

| Applicant | $p$ | Label | $\mathbb{E}[C]$ approve $=(1-p)\cdot120{,}000$ | $\mathbb{E}[C]$ decline $=p\cdot24{,}000$ | Optimal action |
| --- | ---: | --- | ---: | ---: | --- |
| A | 0.62 | good | ₹45,600 | ₹14,880 | **decline** |
| B | 0.97 | good | ₹3,600 | ₹23,280 | **approve** |

Same label, opposite actions. Applicant A has a 38% chance of default; approving costs ₹45,600 in expectation, three times what declining costs. The label threw away the one number — 0.62 versus 0.97 — that separates them.
:::

The general lesson: a label is a probability rounded to one bit at a threshold you did not choose. Keep the probability; apply the threshold the costs imply. This is also why calibration matters (§7): the derivation above assumes that among applicants scored 0.62, about 62% really repay. If the model is over-confident, $p^*$ is in the wrong place on its scale.

Plotting the expected cost of each action against $p$ shows the whole policy at once. Each line is straight because expected cost is linear in $p$:

:::chart[Expected cost of each action as P(good) moves; the cheapest line wins]{type="line" x="p = P(good)" y="expected cost per case" prefix="₹" marks="0.833:p* approve/decline" band="0.25:0.95:review band at ₹6,000" dash="review ₹900"}
p, auto_approve, decline, review ₹6000, review ₹900
0, 120000, 0, 6000, 900
1, 0, 24000, 6000, 900
:::

Read the chart left to right. Below some $p$, `decline` is cheapest; above some $p$, `auto_approve` is; in between, a flat review line can undercut both. Where that middle band starts and ends depends entirely on what a review costs.

## 1.4 Abstention is an action with a price

`manual_review` is never the best action *if you knew the outcome* — knowing it, you would approve or decline. It earns its place because the model never knows the outcome. Review beats approve when $r < (1-p)\,c_{AB}$, and beats decline when $r < p\,c_{DG}$, so the review band is

$$
\frac{r}{c_{DG}} \;<\; p \;<\; 1 - \frac{r}{c_{AB}}
$$

The band exists only while its lower edge is below its upper edge:

$$
\frac{r}{c_{DG}} < 1 - \frac{r}{c_{AB}} \iff r < \frac{c_{AB}\, c_{DG}}{c_{AB} + c_{DG}} = \frac{120{,}000 \times 24{,}000}{144{,}000} = \text{₹}20{,}000
$$

That ₹20,000 is no coincidence: it is the expected cost of the cheaper automatic action at $p^*$, the most uncertain point. A review is worth buying only if it costs less than the worst expected loss it can prevent.

:::example[Worked example · how the review price sets the band]
| Review price $r$ | Band starts $r/24{,}000$ | Band ends $1 - r/120{,}000$ | Width of $p$-range sent to review |
| ---: | ---: | ---: | ---: |
| ₹900 | 0.0375 | 0.9925 | 0.955 |
| ₹3,000 | 0.1250 | 0.9750 | 0.850 |
| ₹6,000 | 0.2500 | 0.9500 | 0.700 |
| ₹12,000 | 0.5000 | 0.9000 | 0.400 |
| ₹20,000 | 0.8333 | 0.8333 | 0 — no band |
:::

:::chart[The review band narrows as a review gets more expensive and closes at ₹20,000]{type="line" x="price of one review" y="P(good)" xprefix="₹" ymin="0" ymax="1" yfmt="dec2" hmarks="0.833:p*" marks="6000:illustrative ₹6,000;20000:band closes"}
r, band starts, band ends
0, 0.0000, 1.0000
2000, 0.0833, 0.9833
4000, 0.1667, 0.9667
6000, 0.2500, 0.9500
8000, 0.3333, 0.9333
10000, 0.4167, 0.9167
12000, 0.5000, 0.9000
14000, 0.5833, 0.8833
16000, 0.6667, 0.8667
18000, 0.7500, 0.8500
20000, 0.8333, 0.8333
:::

At ₹900 — roughly the reviewer's time on one file — the band covers 95.5% of the probability range, and on a typical score distribution that sends most traffic to humans. That is correct arithmetic and an unshippable product. The fix is to price the review honestly: reviewer salary per case, plus the queueing delay, plus applicants who go elsewhere while they wait. This course uses **₹6,000** as an illustrative fully loaded price; it still gives a band 0.70 wide, but how much *traffic* lands in it depends on how confident the model is. On the quick-start data in §2 it is 39.6% of cases. If operations cannot staff that, a capacity cap reassigns the least valuable reviews to their next-best action — the price of that constraint is measured in [§4](/c/practical-slm-decision-models/04-decision-theory).

:::warn[A cheap review is a trap, not a safety net]
If the review price only counts reviewer minutes, abstention wins almost everywhere and the "automated" system becomes a queue. Price the review at what it costs the business, then check the share of real traffic in the band before anyone promises an automation rate.
:::

## 1.5 The decision loop, and the only place the model appears

:::mermaid[The loop every decision model runs. The model supplies one arrow.]
flowchart LR
  X[Observation x] --> M[Model: P of outcome given x]
  M --> P[Policy: cost matrix, review band, capacity cap]
  P --> A[Action from a closed set]
  A --> L[Decision log]
  A --> O[Outcome observed later]
  O --> D[(Labelled cases)]
  L --> D
  D -.->|retrain and recalibrate| M
  D -.->|reprice costs| P
:::

Two feedback edges, two owners. Outcomes retrain and recalibrate the model (the ML team); outcomes also reveal whether the cost matrix was right — the real default loss, the real cost of a review — which reprices the policy (product, risk and operations). Treating only the first edge as "the system" is how decision models drift into expensive habits.

### What the log must record

Every decision is written down with enough to replay it. A decision you cannot explain in eight months is a liability, not an asset.

| Field | Example | Why |
| --- | --- | --- |
| `action` | `manual_review` | What was done — the thing auditors ask about |
| `p_good` | 0.62 | Lets you recompute the action under new costs without re-running the model |
| `expected_cost_inr` | per action | Shows the margin: a near-tie and a landslide look identical in `action` alone |
| `reason` | `p_good inside review band 0.25-0.95` | Human-readable rule that fired, plus model evidence if any |
| `model_version` | `loan-clf-2026-11-01` | Which weights produced $p$ |
| `policy_version` | `costs-v3:120000/24000/6000` | Which cost matrix and thresholds turned $p$ into an action |

Version the model and the policy **separately**. Changing the review price from ₹900 to ₹6,000 changes thousands of actions without touching a weight; if only the model is versioned, that change is invisible in the log.

## 1.6 The whole section as one script

Everything above, computed rather than asserted — the threshold, the two applicants, the review band table and one log record:

```python run
"""Same label, different decisions: the loan triage policy in 40 lines."""
import json

C_APPROVE_BAD = 120_000   # approve, applicant defaults
C_DECLINE_GOOD = 24_000   # decline, applicant would have repaid (lost margin)


def expected_costs(p_good, review):
    return {
        "auto_approve": C_APPROVE_BAD * (1 - p_good),
        "manual_review": review,
        "decline": C_DECLINE_GOOD * p_good,
    }


def decide(p_good, review=None):
    costs = expected_costs(p_good, review if review is not None else float("inf"))
    if review is None:
        costs.pop("manual_review")
    action = min(costs, key=costs.get)
    return action, {a: round(c) for a, c in costs.items()}


p_star = C_APPROVE_BAD / (C_APPROVE_BAD + C_DECLINE_GOOD)
print(f"approve/decline threshold p* = {p_star:.4f}")
print()
print("two applicants, both labelled 'good' by an argmax classifier (p > 0.5):")
for name, p in (("A", 0.62), ("B", 0.97)):
    action, costs = decide(p)
    print(f"  {name}: p_good={p:.2f}  label=good  action={action:12s} E[cost]={costs}")
print()
print("review band [r/24000, 1 - r/120000] as the price of a review r changes:")
for r in (900, 3_000, 6_000, 12_000, 20_000):
    lo, hi = r / C_DECLINE_GOOD, 1 - r / C_APPROVE_BAD
    width = max(0.0, hi - lo)
    print(f"  r={r:>6,}  band {lo:.4f} - {hi:.4f}  width {width:.3f}")
print()
action, costs = decide(0.62, review=6_000)
record = {
    "case_id": "LN-2026-000184",
    "action": action,
    "p_good": 0.62,
    "expected_cost_inr": costs,
    "reason": ["p_good inside review band 0.25-0.95"],
    "model_version": "loan-clf-2026-11-01",
    "policy_version": "costs-v3:120000/24000/6000",
}
print(json.dumps(record))
```

```output
approve/decline threshold p* = 0.8333

two applicants, both labelled 'good' by an argmax classifier (p > 0.5):
  A: p_good=0.62  label=good  action=decline      E[cost]={'auto_approve': 45600, 'decline': 14880}
  B: p_good=0.97  label=good  action=auto_approve E[cost]={'auto_approve': 3600, 'decline': 23280}

review band [r/24000, 1 - r/120000] as the price of a review r changes:
  r=   900  band 0.0375 - 0.9925  width 0.955
  r= 3,000  band 0.1250 - 0.9750  width 0.850
  r= 6,000  band 0.2500 - 0.9500  width 0.700
  r=12,000  band 0.5000 - 0.9000  width 0.400
  r=20,000  band 0.8333 - 0.8333  width 0.000

{"case_id": "LN-2026-000184", "action": "manual_review", "p_good": 0.62, "expected_cost_inr": {"auto_approve": 45600, "manual_review": 6000, "decline": 14880}, "reason": ["p_good inside review band 0.25-0.95"], "model_version": "loan-clf-2026-11-01", "policy_version": "costs-v3:120000/24000/6000"}
```

Note that applicant A flips from `decline` to `manual_review` once a review exists at ₹6,000: ₹6,000 for certainty beats ₹14,880 of expected lost margin. The model did not change; the action set did.

## 1.7 Accuracy bugs versus policy bugs

Once the five parts are separate, "the model got worse" tickets sort themselves by owner:

| Symptom | Which part is broken | Who fixes it | First diagnostic |
| --- | --- | --- | --- |
| Cost per case rises, score ranking (AUC) unchanged | Costs or thresholds | Product + risk | Diff `policy_version`; recompute actions from logged `p_good` |
| Scores drift but actions barely change | Calibration | ML | Reliability curve and ECE before/after |
| Review volume jumps with no code change | Score distribution shifted into the band | ML + data | Histogram of `p_good` this week vs last |
| Actions shift on a new customer segment | Data distribution | Data owner | Per-segment base rate and score histogram |
| Accuracy on auto-decided cases falls | Model quality | ML | Confusion matrix on the decided slice only |

Three of the five rows are not model problems. That is the practical payoff of the definition: blaming the model by default is how decision systems rot.

## 1.8 Practical rules

- **Write the cost matrix before training anything.** It fixes $p^*$ (0.833 here) and the review band, and it is cheaper to argue about four numbers than about a model.
- **Costs need to be roughly right, not exact.** In §2's run, every threshold from 0.76 to 0.84 gives the same cost per case; what is expensive is a framing error such as 0.5 instead of 0.833.
- **Price the review fully.** ₹900 of reviewer time produces a 95.5%-wide band; an illustrative fully loaded ₹6,000 produces 70%. Above ₹20,000 no review is ever worth it.
- **Log probabilities, not just actions**, so you can replay history under a new cost matrix without re-scoring.
- **Version model and policy separately**, and put both in every log record.

:::warn[Do not start with the model]
The order is: cost matrix → baseline policy → model → calibration → capacity cap → tests. Teams that start with the model optimise an objective they cannot state, then discover that the review band swallows most of their traffic.
:::

## 1.9 Check yourself

:::qa[Risk revises the cost of a bad approval from ₹120,000 to ₹60,000 (better collateral recovery). What is the new approve/decline threshold, and does the model need retraining?]
$p^* = 60{,}000 / (60{,}000 + 24{,}000) = 0.714$. No retraining: the model's probabilities are unchanged; only the policy moves. Bump `policy_version`, and replay the last month's logged `p_good` values through the new threshold to estimate the change in approvals before deploying.
:::

:::qa[At what review price does manual review stop being optimal anywhere, and why that number?]
When $r \ge c_{AB} c_{DG} / (c_{AB} + c_{DG}) = 120{,}000 \times 24{,}000 / 144{,}000 = 20{,}000$, i.e. ₹20,000. At $p^* = 0.833$ the two automatic actions tie at $0.1667 \times 120{,}000 = 0.8333 \times 24{,}000 = 20{,}000$, i.e. ₹20,000 of expected cost. That is the largest expected loss review could ever avoid, so a review priced above it never pays.
:::

:::qa[80% of applicants are good. "Always approve" is 80% accurate; "always decline" is 20% accurate. Which is cheaper?]
Always approve: $0.2 \times 120{,}000 = 24{,}000$, i.e. ₹24,000 per case. Always decline: $0.8 \times 24{,}000 = 19{,}200$, i.e. ₹19,200 per case. The policy with a quarter of the accuracy is ₹4,800 per case cheaper. Accuracy weights every mistake equally; the business does not.
:::

:::qa[Two applicants both score p = 0.90. One is a first-time borrower, the other has ten years of history. Should they get different actions?]
Not under this policy: the action depends on $p$ and the costs only, so both get the same action — `manual_review`, since 0.90 is inside the ₹6,000 band (0.25–0.95). If you believe the first-time borrower's 0.90 is less trustworthy, that is a calibration claim — check the reliability curve on the first-time segment. If the *costs* differ (e.g. a larger loan size), put the loan amount into $C(a, y)$ so the costs differ per case, rather than adding an ad-hoc rule.
:::

:::qa[Why log expected cost per action when you already log the action?]
Because the margin matters. `manual_review` chosen at ₹6,000 against ₹6,100 for `decline` is a near-tie that a small cost change flips; chosen at ₹6,000 against ₹45,600 it is robust. Without the expected costs, every logged action looks equally certain, and you cannot estimate how many decisions a proposed cost change would flip.
:::

:::exercise[Exercise 1.1 · Threshold lab]{id="threshold" fp="120000" fn="24000" review="6000" actions="decline,manual_review,auto_approve" currency="₹"}
:::

Next: build the whole pipeline — classifier, calibration, cost threshold, review band — on synthetic data in [Quick start](/c/practical-slm-decision-models/02-quick-start).
