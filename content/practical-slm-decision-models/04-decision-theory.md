---
section: "4"
title: "Decision theory"
kicker: "Theory"
abstract: "Derive every threshold from a cost matrix before training anything: the expected-cost argmin, the two-action cut point, the three-action review band and when it vanishes, what a capacity cap costs, when a second signal is worth buying, and what to do when you trust neither the probabilities nor the costs."
time: "35 min"
order: 4
outcomes:
  - "Derive the approve/decline threshold and the review band from a cost matrix, with exact cut points"
  - "Compute what a review cap costs and attribute regret to belief error versus constraint"
  - "Decide whether a second signal is worth buying with EVSI"
  - "Choose between expected cost, maximin and minimax regret when probabilities or costs are contested"
---

A lender pre-screens 100,000 loan applications a month. A model reads each application and returns $p = P(\text{good})$. Three things can happen next: `auto_approve`, `manual_review` or `decline`. Approving a bad case costs ₹120,000; declining a good one loses ₹24,000 of margin; a manual review costs ₹900 on the ops sheet. Which action should a case with $p = 0.71$ get — and what threshold should the team ship? Every answer in this section comes from arithmetic on those three numbers, and none of it needs a trained model.

:::key[First principle]
A decision model does not choose the most likely outcome; it chooses the action with the lowest **expected cost**. The model supplies one input — a calibrated probability. The costs, the action set and the capacity limits are business inputs, and they fix the thresholds before any training starts.
:::

## 4.1 A decision is an argmin over expected cost

Let $x$ be the case, $o$ the unknown outcome and $c(a, o)$ the cost of taking action $a$ when the outcome turns out to be $o$. You never observe $o$ at decision time, so you pay the cost in expectation over the model's belief:

$$
\mathbb{E}[c \mid a, x] = \sum_{o} P(o \mid x)\, c(a, o),
\qquad
a^*(x) = \arg\min_{a \in \mathcal{A}} \; \sum_{o} P(o \mid x)\, c(a, o).
$$

For the loan case there are two outcomes, so with $p = P(\text{good} \mid x)$ every action's expected cost is a straight line in $p$:

$$
\begin{aligned}
\mathbb{E}[c \mid \text{approve}] &= (1-p)\,c_{FP} = 120{,}000\,(1-p) \\
\mathbb{E}[c \mid \text{decline}] &= p\,c_{FN} = 24{,}000\,p \\
\mathbb{E}[c \mid \text{review}] &= r = 900
\end{aligned}
$$

Here $c_{FP}$ is the cost of approving a bad case (a false positive for "approve") and $c_{FN}$ the cost of declining a good one. Three consequences follow from the argmin, and each changes how you build.

**You need a distribution, not a label.** Two applications both labelled "bad" can have $P(\text{good}) = 0.49$ and $P(\text{good}) = 0.01$. Under asymmetric costs they deserve different actions; a label has thrown away exactly the number the argmin needs. This is why calibration ([§7](/c/practical-slm-decision-models/07-probabilities-and-calibration)) is a correctness requirement, not polish.

**The threshold is derived, not tuned.** It is the $p$ where two lines cross — a ratio of costs, computable on day one.

**Abstention is an action with a price.** `manual_review` competes on the same arithmetic as the other two actions. It is neither free nor a safety blanket bolted on afterwards.

:::mermaid[The decision triangle: what the model supplies and what the business supplies]
flowchart TB
  M[Model: P(outcome given case)] --> E[Expected cost of each action]
  B[Business: cost matrix] --> E
  C[Operations: review capacity] --> E
  E --> A[Action from a closed set]
  A --> L[Logged: action, p, costs, versions]
  L -.->|outcomes arrive later| M
:::

Read the diagram as an ownership map. The model owns one arrow. The cost matrix and the capacity limit belong to people who can be held accountable for them, and they should sign them off in writing.

## 4.2 Two actions: the threshold is a cost ratio

Start with only `auto_approve` and `decline`. Approve when its expected cost is lower:

$$
(1-p)\,c_{FP} < p\,c_{FN}
\;\Longleftrightarrow\;
c_{FP} < p\,(c_{FP} + c_{FN})
\;\Longleftrightarrow\;
p > p^* = \frac{c_{FP}}{c_{FP} + c_{FN}}.
$$

:::example[Worked example · the loan threshold]
$c_{FP} = 120{,}000$, $c_{FN} = 24{,}000$:

$$
p^* = \frac{120{,}000}{120{,}000 + 24{,}000} = \frac{5}{6} = 0.8333
$$

At $p = 0.71$: approving costs \(0.29 \times 120{,}000\) = ₹34,800 in expectation, declining costs \(0.71 \times 24{,}000\) = ₹17,040. Decline, even though the case is more likely good than bad.
:::

Two readings of the formula are worth keeping:

- **Only the ratio matters.** Scaling both costs by 10× leaves $p^*$ unchanged. If $c_{FP} = k\,c_{FN}$ then $p^* = k/(k+1)$: a 5:1 ratio gives 0.833, 1:1 gives 0.5, 1:5 gives 0.167.
- **Shipping 0.5 is a cost claim.** A 0.5 threshold asserts that a bad approval costs the same as a lost good customer. Here it approves every case in $[0.5, 0.833)$, each of which the team's own numbers say is a net loss.

:::details[Why the cut point is where the lines cross]
Each action's expected cost is linear in $p$, so the difference between two actions is linear too and changes sign exactly once. With $D(p) = \mathbb{E}[c\mid\text{approve}] - \mathbb{E}[c\mid\text{decline}] = c_{FP} - p\,(c_{FP} + c_{FN})$, $D$ is positive at $p=0$, negative at $p=1$, and zero only at $p^*$. No search over thresholds can do better than solving $D(p) = 0$; a grid search can only do worse by half a grid step.
:::

## 4.3 Three actions: the review band and its exact cut points

Add `manual_review` at a flat cost $r$. It wins wherever it undercuts both sloped lines:

$$
\begin{aligned}
r < p\,c_{FN} &\iff p > p_{lo} = \frac{r}{c_{FN}} \\
r < (1-p)\,c_{FP} &\iff p < p_{hi} = 1 - \frac{r}{c_{FP}}
\end{aligned}
$$

So the policy is: decline below $p_{lo}$, review in $[p_{lo}, p_{hi}]$, approve above $p_{hi}$. With the ops-sheet price $r = 900$:

$$
p_{lo} = \frac{900}{24{,}000} = 0.0375,
\qquad
p_{hi} = 1 - \frac{900}{120{,}000} = 0.9925.
$$

The band exists only while $p_{lo} < p_{hi}$. Solving $r/c_{FN} < 1 - r/c_{FP}$ for $r$:

$$
r < r_{max} = \frac{c_{FP}\,c_{FN}}{c_{FP} + c_{FN}} = \frac{120{,}000 \times 24{,}000}{144{,}000} = 20{,}000.
$$

$r_{max}$ (₹20,000) is the expected cost of the cheaper automatic action at $p^*$, where it is highest: $p^* c_{FN} = 0.8333 \times 24{,}000 = 20{,}000$. A review that costs more than the worst automatic decision is never worth buying.

:::chart[Each action is a line in p; the cheapest line wins its interval]{type="line" x="p = P(good)" y="expected cost per case" prefix="₹" marks="0.0375:p_lo;0.8333:p* (two actions);0.9925:p_hi" band="0.0375:0.9925:review band at ₹900" dash="review (₹8000)" points="false"}
p, auto_approve, decline, review (₹900), review (₹8000)
0, 120000, 0, 900, 8000
0.0375, 115500, 900, 900, 8000
0.1, 108000, 2400, 900, 8000
0.2, 96000, 4800, 900, 8000
0.3333, 80000, 8000, 900, 8000
0.5, 60000, 12000, 900, 8000
0.6, 48000, 14400, 900, 8000
0.7, 36000, 16800, 900, 8000
0.8, 24000, 19200, 900, 8000
0.8333, 20000, 20000, 900, 8000
0.9, 12000, 21600, 900, 8000
0.9333, 8000, 22400, 900, 8000
0.9925, 900, 23820, 900, 8000
1, 0, 24000, 900, 8000
:::

The ₹900 line sits under both sloped lines across 95.5% of the unit interval. The dashed ₹8,000 line crosses `decline` at \(8{,}000/24{,}000 = 0.333\) and `auto_approve` at \(1 - 8{,}000/120{,}000 = 0.933\) — a narrower band. Solve the regions exactly rather than scanning a grid; a grid hides dominated actions and is off by half a step:

```python run
"""Exact optimal regions for the loan triage, solved by intersecting lines."""
import itertools

ACTIONS = ["decline", "manual_review", "auto_approve"]
COSTS = {  # (action, outcome) -> INR
    ("auto_approve", "bad"): 120_000.0, ("auto_approve", "good"): 0.0,
    ("manual_review", "bad"): 900.0,    ("manual_review", "good"): 900.0,
    ("decline", "bad"): 0.0,            ("decline", "good"): 24_000.0,
}


def line(a):
    """Expected cost of action a as slope * p + intercept, p = P(good)."""
    return COSTS[(a, "good")] - COSTS[(a, "bad")], COSTS[(a, "bad")]


def cost(a, p):
    m, c = line(a)
    return m * p + c


def best_action(p):
    return min(ACTIONS, key=lambda a: cost(a, p))


def crossing(a1, a2):
    (m1, c1), (m2, c2) = line(a1), line(a2)
    if m1 == m2:
        return None
    p = (c2 - c1) / (m1 - m2)
    return p if 0.0 < p < 1.0 else None


def regions():
    """[(p_lo, p_hi, action)]: exact, no grid."""
    cuts = sorted({0.0, 1.0} | {x for a, b in itertools.combinations(ACTIONS, 2)
                                if (x := crossing(a, b)) is not None})
    out = []
    for lo, hi in zip(cuts[:-1], cuts[1:]):
        a = best_action((lo + hi) / 2)
        if out and out[-1][2] == a:
            out[-1] = (out[-1][0], hi, a)
        else:
            out.append((lo, hi, a))
    return out


for a, b in itertools.combinations(ACTIONS, 2):
    print("%-13s = %-13s at p = %.4f" % (a, b, crossing(a, b)))
print()
for lo, hi, a in regions():
    print("%.4f - %.4f  %-13s" % (lo, hi, a))
print("expected cost at p=0.71:", {a: round(cost(a, 0.71)) for a in ACTIONS})

# invariants any cost matrix must satisfy before it goes near a model
regs = regions()
assert abs(sum(hi - lo for lo, hi, _ in regs) - 1.0) < 1e-12, "regions must tile [0, 1]"
for lo, hi, a in regs:
    assert best_action((lo + hi) / 2) == a, "region and argmin disagree"
r_max = COSTS[("auto_approve", "bad")] * COSTS[("decline", "good")] / (
    COSTS[("auto_approve", "bad")] + COSTS[("decline", "good")])
print("review band exists while review cost < %.0f" % r_max)
```

```output
decline       = manual_review at p = 0.0375
decline       = auto_approve  at p = 0.8333
manual_review = auto_approve  at p = 0.9925

0.0000 - 0.0375  decline      
0.0375 - 0.9925  manual_review
0.9925 - 1.0000  auto_approve 
expected cost at p=0.71: {'decline': 17040, 'manual_review': 900, 'auto_approve': 34800}
review band exists while review cost < 20000
```

Note that the two-action threshold 0.8333 is a real crossing but not a region boundary: with a ₹900 review, `decline` and `auto_approve` meet inside the review band, where neither is the cheapest. The threshold people quote only governs the policy once the review option is removed or priced above ₹20,000.

## 4.4 The cheap review eats the product

`manual_review` is never the best action if you know the outcome — you would simply approve or decline. It is optimal over a range of $p$ because the model never knows the outcome. The danger runs the other way from what teams expect: price the review too cheaply and the arithmetic routes most of the volume to humans.

To see the size of the effect you need a score population. The code below draws 200,000 applications, 80% good, with a score whose exact posterior is $\operatorname{logit} p = \ln 4 + 2s$ — calibrated by construction, so policy and probability are not confounded. "Reviews/mo" assumes 100,000 applications a month.

```python run
"""What the review price does to the product, on a calibrated score population."""
import numpy as np

C_FP, C_FN = 120_000.0, 24_000.0          # approve a bad case / decline a good case
rng = np.random.default_rng(0)
n = 200_000
good = rng.random(n) < 0.80               # 80% of applicants are good
score = rng.normal(np.where(good, 1.0, -1.0), 1.0)
p = 1 / (1 + np.exp(-(np.log(4) + 2 * score)))   # exact posterior => calibrated


def policy(p, review, cap=None):
    """Three-action Bayes policy; optional cap on the share sent to review."""
    lo, hi = review / C_FN, 1 - review / C_FP
    best_auto = np.minimum(p * C_FN, (1 - p) * C_FP)       # cheaper of decline/approve
    want_review = (p >= lo) & (p <= hi) if lo < hi else np.zeros_like(p, bool)
    if cap is not None and want_review.mean() > cap:
        saving = np.where(want_review, best_auto - review, -np.inf)
        keep = np.argsort(-saving)[: int(cap * len(p))]     # review the biggest savings
        want_review = np.zeros_like(p, bool)
        want_review[keep] = True
    return np.where(want_review, review, best_auto), want_review


print("%8s %8s %8s %8s %10s %12s" % ("review", "lo", "hi", "review%", "INR/case", "reviews/mo"))
for r in (900, 3_000, 8_000, 15_000, 20_000):
    cost, rev = policy(p, r)
    lo, hi = (r / C_FN, 1 - r / C_FP) if r / C_FN < 1 - r / C_FP else (0.8333, 0.8333)
    print("%8d %8.4f %8.4f %7.1f%% %10.0f %12s" % (r, lo, hi, 100 * rev.mean(), cost.mean(),
                                                 f"{rev.mean() * 100_000:,.0f}"))

print()
for cap in (None, 0.25, 0.10):
    cost, rev = policy(p, 900, cap)
    print("review INR 900, cap %-4s -> review %5.1f%%, INR/case %5.0f" %
          (cap or "none", 100 * rev.mean(), cost.mean()))

t = np.linspace(0.5, 0.99, 491)
two = [np.mean(np.where(p >= ti, (1 - p) * C_FP, p * C_FN)) for ti in t]
i = int(np.argmin(two))
print("\napprove/decline only: best t = %.3f (INR %.0f/case); t = 0.5 costs INR %.0f/case"
      % (t[i], two[i], np.mean(np.where(p >= 0.5, (1 - p) * C_FP, p * C_FN))))
```

```output
  review       lo       hi  review%   INR/case   reviews/mo
     900   0.0375   0.9925    79.7%        799       79,709
    3000   0.1250   0.9750    58.6%       2220       58,576
    8000   0.3333   0.9333    35.9%       4510       35,864
   15000   0.6250   0.8750    16.6%       6323       16,600
   20000   0.8333   0.8333     0.0%       6775            0

review INR 900, cap none -> review  79.7%, INR/case   799
review INR 900, cap 0.25 -> review  25.0%, INR/case  2934
review INR 900, cap 0.1  -> review  10.0%, INR/case  4991

approve/decline only: best t = 0.833 (INR 6775/case); t = 0.5 costs INR 9922/case
```

The first row looks like a triumph — ₹799 per case — until you staff it. 79,709 reviews a month at 3 reviews per hour is 26,570 reviewer-hours, about **166 full-time reviewers** at 160 working hours each (illustrative throughput). Nobody approved that headcount; it fell out of a ₹900 line item.

:::example[Worked example · pricing a review honestly (illustrative inputs)]
| Component | Arithmetic | ₹ per review |
| --- | --- | ---: |
| Underwriter time | ₹1,800/h loaded ÷ 3 cases/h | 600 |
| Second-line QA | 10% of reviews × ₹600 | 60 |
| Applicants lost to a 2-day queue | 10% of good applicants × ₹24,000 × $p \approx 0.8$ | 1,920 |
| Tooling, SLA penalties | flat allowance | 300 |
| **Total** | | **≈ 2,880 → use ₹3,000** |

The queue term dominates, and it is invisible on the ops sheet. Strictly it grows with $p$ (only good applicants walk away), which tilts the review line; treating it as flat at the band's typical $p$ is the usual first approximation. At ₹3,000 the band shrinks to $[0.125, 0.975]$ and review volume drops from 79.7% to 58.6%.
:::

| What you change | Review share | ₹/case | What it means |
| --- | ---: | ---: | --- |
| Review at ops-sheet ₹900 | 79.7% | 799 | Cheap on paper; ~166 reviewers |
| Review priced honestly at ₹3,000 | 58.6% | 2,220 | Same policy logic, honest inputs |
| Review ₹900, capped at 25% | 25.0% | 2,934 | Capacity forces automatic decisions |
| Review ₹900, capped at 10% | 10.0% | 4,991 | Each cap point is paid for in errors |
| No review (≥ ₹20,000) | 0% | 6,775 | Pure approve/decline at 0.833 |

:::warn[The review band is a staffing plan]
Before shipping any three-action policy, multiply the review share by monthly volume and divide by reviewer throughput. If the answer is more people than exist, the policy is fiction; either price the review honestly, add a cap (§4.6 shows what the cap costs), or both.
:::

## 4.5 The threshold on a real score distribution

On the same 200,000 calibrated cases, restricted to approve/decline, sweep the threshold and measure the average cost per case:

:::chart[Cost per case vs approve threshold — the optimum is the cost ratio, not 0.5]{type="line" x="approve when P(good) ≥ threshold" y="expected cost per case" prefix="₹" marks="0.5:naive 0.5;0.8333:optimum = 5/6"}
threshold, cost per case
0.04, 21488
0.08, 19575
0.12, 18080
0.16, 16805
0.20, 15714
0.24, 14683
0.28, 13763
0.32, 12947
0.36, 12203
0.40, 11507
0.44, 10852
0.48, 10224
0.52, 9647
0.56, 9102
0.60, 8614
0.64, 8144
0.68, 7717
0.72, 7344
0.76, 7049
0.80, 6839
0.84, 6778
0.88, 6962
0.92, 7622
0.96, 9484
:::

Three readings:

1. **The minimum is at 0.833**, exactly $p^*$, because the scores are calibrated. On uncalibrated scores the empirical minimum moves away from $p^*$ — which is the practical test for whether you need calibration.
2. **0.5 costs ₹9,922 per case against ₹6,775 at the optimum — 46% more.** At 100,000 applications a month that is ₹31.5 crore a month of avoidable loss in this model population.
3. **The curve is flat near the optimum.** Thresholds of 0.75 and 0.90 cost ₹7,116 and ₹7,206 — within 6.4% of the minimum. You do not need a precise cost matrix; you need one with the right ratio to within a factor of about two. Being at 0.5 when the ratio says 0.83 is a framing error, not a tuning error.

## 4.6 Regret: belief error versus constraint

Accuracy does not tell you who owns a loss. **Regret** does: the extra expected cost of your policy over an oracle that knows the true posterior $p^{\text{true}}$ and faces no limits, evaluated case by case under $p^{\text{true}}$:

$$
\text{Regret}(\pi) = \frac{1}{N}\sum_{i=1}^{N} \Big( \mathbb{E}\big[c \mid \pi(x_i), p_i^{\text{true}}\big] - \min_{a} \mathbb{E}\big[c \mid a, p_i^{\text{true}}\big] \Big).
$$

Split the regret of the shipped policy $\pi_{\text{cap}}$ (model beliefs plus a review cap) through the uncapped policy $\pi_{\text{model}}$:

$$
\underbrace{\text{Regret}(\pi_{\text{cap}})}_{\text{total}}
= \underbrace{\text{Regret}(\pi_{\text{model}})}_{\text{belief error: ML team}}
+ \underbrace{\text{Regret}(\pi_{\text{cap}}) - \text{Regret}(\pi_{\text{model}})}_{\text{constraint: whoever set the cap}}.
$$

Belief error shrinks with data and calibration. Constraint regret shrinks only when someone changes the cap. Here review is priced at ₹3,000 (the honest price from §4.4) and capped at 25%, against two models: one noisy but unbiased in logit space, and one that is also overconfident (logits stretched by 1.5×).

```python run
"""Regret = belief error + constraint, judged against the true posterior."""
import numpy as np

C_FP, C_FN, REVIEW, CAP = 120_000.0, 24_000.0, 3_000.0, 0.25
rng = np.random.default_rng(1)
n = 100_000
good = rng.random(n) < 0.80
score = rng.normal(np.where(good, 1.0, -1.0), 1.0)
logit_true = np.log(4) + 2 * score
p_true = 1 / (1 + np.exp(-logit_true))                 # what an oracle would believe
noise = rng.normal(0, 1.0, n)
MODELS = {"noisy": logit_true + noise,                 # right on average, wrong per case
          "noisy+overconfident": 1.5 * logit_true + noise}


def exp_cost(p):
    """Expected cost per action; columns = decline, review, approve."""
    return np.stack([p * C_FN, np.full_like(p, REVIEW), (1 - p) * C_FP], axis=1)


def choose(p, cap=None):
    e = exp_cost(p)
    a = e.argmin(1)
    if cap is not None and (a == 1).mean() > cap:
        saving = np.where(a == 1, e[:, [0, 2]].min(1) - REVIEW, -np.inf)
        a = np.where(e[:, 0] < e[:, 2], 0, 2)
        a[np.argsort(-saving)[: int(cap * len(p))]] = 1  # review the biggest savings
    return a


truth = exp_cost(p_true)
paid = lambda a: truth[np.arange(n), a].mean()
oracle = paid(choose(p_true))
print("oracle INR %.0f/case | regret of best constant action INR %.0f | oracle under cap INR %.0f"
      % (oracle, min(truth.mean(0)) - oracle, paid(choose(p_true, CAP)) - oracle))
print()
print("%-20s %8s %8s %11s %8s" % ("model", "review%", "belief", "constraint", "total"))
for name, logit in MODELS.items():
    p_model = 1 / (1 + np.exp(-logit))
    belief = paid(choose(p_model)) - oracle
    total = paid(choose(p_model, CAP)) - oracle
    print("%-20s %7.1f%% %8.0f %11.0f %8.0f" % (name, 100 * (choose(p_model) == 1).mean(),
                                               belief, total - belief, total))
```

```output
oracle INR 2226/case | regret of best constant action INR 774 | oracle under cap INR 1243

model                 review%   belief  constraint    total
noisy                   57.4%      326        1859     2185
noisy+overconfident     36.1%      877         945     1821
```

:::chart[Where the regret comes from — review ₹3,000, cap 25%]{type="bar" y="regret per case" prefix="₹" hmarks="774:always review (no model)" labels="true"}
component, noisy model, overconfident model
belief error, 326, 877
constraint (25% cap), 1859, 945
total, 2185, 1821
:::

What the bars say:

- **For the noisy model the cap costs 5.7× the model error** (₹1,859 vs ₹326). A quarter of engineering spent shrinking the small bar cannot touch the large one. Compute both before deciding what to optimise.
- **Always compare to the no-model baseline.** "Always review" has regret ₹774. The noisy model beats it by ₹448 per case; the overconfident one *loses* ₹103 per case to it. A model that loses to a constant action is subtracting value.
- **Totals under a constraint can rank models backwards.** The overconfident model shows a lower total (₹1,821 vs ₹2,185) only because it pushes cases out of the review band on its own, so the cap binds less. Uncapped, it is 2.7× worse. Rank models on belief error; report constraint regret separately to whoever owns the cap.
- **Even a perfect model pays ₹1,243 per case under this cap.** That number is the price of the capacity decision itself, and it is the figure to bring to the meeting where headcount is set.

## 4.7 Should you pay for a second signal? EVSI

Before deciding you can often buy more information: a credit-bureau pull, a document check, a call to a second model. The **expected value of sample information** compares deciding now with deciding after seeing a signal $z$, net of its price:

$$
\text{EVSI} = \underbrace{\min_a \mathbb{E}[c \mid a, p]}_{\text{decide now}}
- \underbrace{\sum_{z} P(z)\, \min_a \mathbb{E}\big[c \mid a, P(\text{good} \mid z)\big]}_{\text{decide after the signal}}
- c_{\text{signal}}.
$$

The posteriors come from Bayes' rule. For a binary signal that says "good" with probability $s$ on good cases and "bad" with probability $s$ on bad cases:

$$
P(z{=}\text{good}) = s\,p + (1-s)(1-p),
\qquad
P(\text{good} \mid z{=}\text{good}) = \frac{s\,p}{P(z{=}\text{good})},
\qquad
P(\text{good} \mid z{=}\text{bad}) = \frac{(1-s)\,p}{1 - P(z{=}\text{good})}.
$$

:::example[Worked example · a ₹250 bureau pull at p = 0.90, accuracy 0.90, review ₹3,000]
**Decide now.** Decline \(0.9 \times 24{,}000 = 21{,}600\); review \(3{,}000\); approve \(0.1 \times 120{,}000 = 12{,}000\). Best: review, ₹3,000.

**Signal probabilities.** $P(z{=}\text{good}) = 0.9 \times 0.9 + 0.1 \times 0.1 = 0.82$.

**After "good".** $P(\text{good} \mid z) = 0.81/0.82 = 0.9878 > p_{hi} = 0.975$, so approve: \(0.0122 \times 120{,}000\) = ₹1,463.

**After "bad".** $P(\text{good} \mid z) = 0.09/0.18 = 0.50$, inside the band, so review: ₹3,000.

**Decide after.** \(0.82 \times 1{,}463 + 0.18 \times 3{,}000 = 1{,}200 + 540\) = ₹1,740.

**EVSI** = 3,000 − 1,740 − 250 = **₹1,010 per case**. Buy the signal.
:::

The general rule: a signal has value only if some outcome of it **moves the posterior across a cut point**. If every possible posterior lands in the same region as the prior, the action does not change and the EVSI is exactly $-c_{\text{signal}}$.

```python run
"""EVSI: is one more signal worth buying before deciding?"""
C_FP, C_FN, REVIEW = 120_000.0, 24_000.0, 3_000.0


def best(p):
    """Cheapest expected cost over decline / review / approve at P(good) = p."""
    return min(p * C_FN, REVIEW, (1 - p) * C_FP)


def evsi(prior, acc, price):
    """Binary signal that says 'good' with P(acc | good) and P(1 - acc | bad)."""
    p_pos = acc * prior + (1 - acc) * (1 - prior)
    post_pos = acc * prior / p_pos
    post_neg = (1 - acc) * prior / (1 - p_pos)
    after = p_pos * best(post_pos) + (1 - p_pos) * best(post_neg)
    return best(prior) - after - price


print("%6s %10s %10s %10s" % ("prior", "acc 0.80", "acc 0.90", "acc 0.99"))
for prior in (0.05, 0.20, 0.50, 0.80, 0.90, 0.95, 0.99):
    print("%6.2f" % prior + "".join("%10.0f" % evsi(prior, a, 250.0) for a in (0.8, 0.9, 0.99)))
```

```output
 prior   acc 0.80   acc 0.90   acc 0.99
  0.05        20       410       761
  0.20       830      1490      2084
  0.50      -250        50      2030
  0.80      -250      -250      2318
  0.90      -250      1010      2414
  0.95       860      1730      2513
  0.99        92       506       879
```

:::chart[EVSI of a ₹250 signal across the prior — value concentrates near the cut points]{type="line" x="prior P(good)" y="EVSI per case" prefix="₹" hmarks="0:buy above this line" marks="0.125:p_lo;0.975:p_hi" dash="signal 90%" points="false"}
prior, signal 90%, signal 99%
0.025, -70, 240
0.050, 410, 761
0.075, 890, 1282
0.100, 1370, 1802
0.125, 1850, 2322
0.150, 1730, 2243
0.175, 1610, 2164
0.200, 1490, 2084
0.225, 1370, 2004
0.250, 1250, 1925
0.275, 1130, 1846
0.300, 1010, 1838
0.325, 890, 1862
0.350, 770, 1886
0.375, 650, 1910
0.400, 530, 1934
0.425, 410, 1958
0.450, 290, 1982
0.475, 170, 2006
0.500, 50, 2030
0.525, -70, 2054
0.550, -190, 2078
0.575, -250, 2102
0.600, -250, 2126
0.625, -250, 2150
0.650, -250, 2174
0.675, -250, 2198
0.700, -250, 2222
0.725, -250, 2246
0.750, -250, 2270
0.775, -250, 2294
0.800, -250, 2318
0.825, -70, 2342
0.850, 290, 2366
0.875, 650, 2390
0.900, 1010, 2414
0.925, 1370, 2438
0.950, 1730, 2513
0.975, 2090, 2617
:::

The 90%-accurate signal is worthless across $[0.575, 0.80]$: no outcome can push a prior there out of the review band. It peaks at the band edges, where one observation flips a ₹3,000 review into a cheap automatic decision. In practice: **call the expensive second signal only for cases near a cut point**, which is a routing rule you can compute from this curve.

## 4.8 When you trust neither the probabilities nor the costs

Expected cost needs two things: a calibrated $p$ and defensible costs. A new product segment has neither. Suppose the model's $P(\text{good})$ for the segment is contested between 0.85 and 0.99, the loss on a bad approval is somewhere between ₹60,000 and ₹240,000, and review needs a field visit costing ₹8,000 (all illustrative). With scenario set $S$, three criteria:

$$
\begin{aligned}
\text{Expected cost (nominal } s_0\text{):}\quad & \arg\min_a \; c(a, s_0) \\
\text{Maximin (best worst case):}\quad & \arg\min_a \; \max_{s \in S} c(a, s) \\
\text{Minimax regret:}\quad & \arg\min_a \; \max_{s \in S} \Big( c(a, s) - \min_{a'} c(a', s) \Big)
\end{aligned}
$$

```python run
"""Deep uncertainty: no trusted p, no trusted cost. Compare decision criteria."""
import itertools

C_FN, REVIEW = 24_000.0, 8_000.0
P_GOOD = (0.85, 0.95, 0.99)                    # contested P(good) for the new segment
C_FP = (60_000.0, 120_000.0, 240_000.0)        # contested loss on a bad approval
SCEN = list(itertools.product(P_GOOD, C_FP))


def cost(action, p, c_fp):
    return {"decline": p * C_FN, "review": REVIEW, "approve": (1 - p) * c_fp}[action]


ACTIONS = ("decline", "review", "approve")
table = {a: [cost(a, p, c) for p, c in SCEN] for a in ACTIONS}
best_in = [min(table[a][i] for a in ACTIONS) for i in range(len(SCEN))]
regret = {a: [table[a][i] - best_in[i] for i in range(len(SCEN))] for a in ACTIONS}

print("%-8s %10s %10s %10s %10s" % ("action", "nominal", "worst", "max regret", "mean"))
for a in ACTIONS:
    nominal = cost(a, 0.95, 120_000.0)
    print("%-8s %10.0f %10.0f %10.0f %10.0f" % (a, nominal, max(table[a]), max(regret[a]),
                                               sum(table[a]) / len(SCEN)))
print()
print("expected cost (nominal p=0.95, c_FP=120k):", min(ACTIONS, key=lambda a: cost(a, 0.95, 120e3)))
print("maximin (min worst cost):               ", min(ACTIONS, key=lambda a: max(table[a])))
print("minimax regret:                         ", min(ACTIONS, key=lambda a: max(regret[a])))
print("approve wins in %d of %d scenarios" % (sum(table["approve"][i] == best_in[i]
                                                   for i in range(len(SCEN))), len(SCEN)))
```

```output
action      nominal      worst max regret       mean
decline       22800      23760      23160      22320
review         8000       8000       7400       8000
approve        6000      36000      28000       9800

expected cost (nominal p=0.95, c_FP=120k): approve
maximin (min worst cost):                review
minimax regret:                          review
approve wins in 5 of 9 scenarios
```

Expected cost at the nominal point says approve (₹6,000 vs ₹8,000). Approve is in fact the best action in 5 of the 9 scenarios — and in the worst one ($p = 0.85$, ₹240,000 loss) it costs ₹36,000 per case. Both robust criteria pick review; so does the equal-weight average (₹8,000 vs ₹9,800). How to choose:

| Situation | Criterion | Why |
| --- | --- | --- |
| Calibrated $p$, signed-off costs | Expected cost | It is the only criterion that minimises the long-run bill |
| Costs known, probabilities contested (new segment, drift) | Minimax regret | Limits how much you can regret versus the best action in hindsight |
| Ruinous tails, regulator asks about the worst case | Maximin | Bounds the worst outcome; accepts paying more on average |
| Neither, but a scenario set exists | Run all three; if they agree, ship; if not, buy information (§4.7) | Disagreement is the signal that data is worth more than modelling |

The robust choice here is temporary. Reviewing the new segment produces outcome labels; once the probabilities are calibrated, switch back to expected cost and let the review band narrow.

## 4.9 Practical rules

- **Write the cost matrix first**, in currency, signed by the owner of the P&L line. Derive $p^*$, $p_{lo}$, $p_{hi}$ and $r_{max}$ before training anything.
- **Price the review at what it costs the business**, including queue loss; ops-sheet time cost understated it by about 3.3× in §4.4 (₹900 vs ₹3,000).
- **Convert the review share into headcount** before shipping: volume × review share ÷ reviewer throughput.
- **Report regret, not just accuracy**: belief error to the ML team, constraint regret to the capacity owner, and always the best-constant-action baseline.
- **Use the flatness of the cost curve**: the cost ratio needs to be right within about 2×; spend the effort on calibration and on the ratio, not on the third digit of the threshold.
- **Buy signals only near cut points**, where EVSI is positive; elsewhere the signal cannot change the action.

:::warn[Failure modes that look like model problems]
- **Threshold 0.5 in production** — a cost claim nobody made; costs 46% more per case in §4.5.
- **Review band that nobody can staff** — the policy silently degrades into whatever the queue does.
- **Ranking models under a cap** — rewards overconfidence that empties the review band (§4.6).
- **Uncalibrated scores fed into cost formulas** — every cut point is correct for the wrong probability.
:::

## 4.10 Threshold lab

Drag the three costs and the model's $p$. Watch $p_{lo}$ and $p_{hi}$ move, and the band vanish as the review cost passes $c_{FP} c_{FN}/(c_{FP}+c_{FN})$.

:::exercise[Exercise 4.1 · Threshold lab]{id="threshold" fp="120000" fn="24000" review="900" actions="decline,manual_review,auto_approve" currency="₹"}
:::

Try: (1) raise the review to ₹3,000 and confirm the band is $[0.125, 0.975]$; (2) raise it to ₹20,000 and watch the band collapse onto 0.833; (3) set the declined-good cost to ₹120,000 and see $p^*$ fall to 0.5.

## 4.11 Check yourself

:::qa[A fraud team says a missed fraud costs ₹50,000 and a blocked legitimate payment costs ₹2,000. What block threshold on P(fraud) should they use?]
Blocking is the "act" action; it is wrong when the payment is legitimate (₹2,000) and not acting is wrong when it is fraud (₹50,000). Block when $P(\text{fraud})\cdot 50{,}000 > (1 - P(\text{fraud}))\cdot 2{,}000$, i.e. $P(\text{fraud}) > 2{,}000/52{,}000 = 0.0385$. A 4% fraud probability is enough to block.
:::

:::qa[With c_FP = ₹120,000 and c_FN = ₹24,000, what is the most a review can cost before the review band disappears, and why that number?]
$r_{max} = c_{FP}c_{FN}/(c_{FP}+c_{FN})$ = ₹20,000. It is the expected cost of the cheaper automatic action at its worst point, $p^* = 0.833$, where approve and decline both cost ₹20,000. A review costing more than that is beaten everywhere by an automatic decision.
:::

:::qa[Your model's regret is ₹900 per case and "always review" has regret ₹774. What do you ship?]
"Always review" (if capacity allows) while you fix the model, because the model is subtracting ₹126 per case versus a constant action. Check calibration first: the overconfident model in §4.6 lost to the constant action for exactly this reason.
:::

:::qa[A 90%-accurate ₹250 signal is offered for every case. Your priors are mostly between 0.6 and 0.8 and review costs ₹3,000. Buy it?]
No. In that range neither signal outcome moves the posterior out of the review band $[0.125, 0.975]$ — e.g. from 0.8 a positive signal gives \(0.72/0.74 = 0.973 < 0.975\) — so EVSI is exactly −₹250. Buy it only for cases near the cut points.
:::

:::qa[Expected cost says approve; maximin and minimax regret say review. Which do you choose?]
It depends on what you trust. If the probabilities are calibrated and the costs signed off, expected cost. If the segment is new and the inputs are contested, the robust choice (review) — and use the reviews to collect labels so you can return to expected cost. When criteria disagree, information is usually worth more than modelling.
:::

Next: [§5 Why SLMs for decisions](/c/practical-slm-decision-models/05-why-slms) — the same cost arithmetic applied to the choice of model.
