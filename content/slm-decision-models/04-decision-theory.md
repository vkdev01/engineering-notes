---
section: "4"
title: "Decision theory"
kicker: "Theory"
abstract: "The arithmetic behind every threshold: expected-cost argmin, the two-action cut point, the three-action review band with exact loan numbers, what to do when probabilities are contested, when a second signal is worth buying (EVSI), and how regret splits into model error and constraint."
time: "18 min"
order: 4
outcomes:
  - "Derive the approve/decline threshold and the review band's cut points from a cost matrix"
  - "Compute the review price at which the band vanishes (₹20,000 for the loan costs)"
  - "Pick expected cost, maximin or minimax regret when probabilities or costs are contested"
  - "Decide whether to buy a second signal with EVSI"
  - "Split regret into belief error (ML team) and constraint regret (capacity owner)"
---

The loan-triage model returns $p = P(\text{good})$ for each of 100,000 applications a month, and three things can happen next: `auto_approve`, `manual_review` or `decline`. Approving a bad case costs ₹120,000; declining a good one loses ₹24,000 of margin; a review costs ₹900 on the ops sheet and about ₹3,000 priced honestly (illustrative). Which action does a case with $p = 0.71$ get, and what does the team ship? Every answer here is arithmetic on those numbers — none of it needs a trained model.

:::key[First principle]
Choose the action with the lowest **expected cost** under a calibrated probability. Thresholds are where two actions' expected costs are equal, so they are ratios of costs — fixed before training and moved only when the costs move.
:::

## 4.1 Expected cost and the argmin

For outcome $o$ and cost $c(a, o)$:

$$
a^*(x) = \arg\min_{a} \sum_{o} P(o \mid x)\, c(a, o)
$$

With two outcomes, every action's expected cost is a straight line in $p$:

$$
\mathbb{E}[c \mid \text{approve}] = (1-p)\,c_{FP}, \qquad
\mathbb{E}[c \mid \text{decline}] = p\,c_{FN}, \qquad
\mathbb{E}[c \mid \text{review}] = r
$$

$c_{FP}$ = ₹120,000 (approve a bad case), $c_{FN}$ = ₹24,000 (decline a good one), $r$ = review price. The policy is "take the lowest line". Two consequences: you need a **probability**, not a label (a label discards where on the line you are), and that probability must be **calibrated** — 0.71 must mean 71% of such cases repay — or every cut point lands on the wrong case.

## 4.2 Two actions: the threshold is a cost ratio

Approve when $(1-p)\,c_{FP} < p\,c_{FN}$:

$$
p > p^* = \frac{c_{FP}}{c_{FP} + c_{FN}} = \frac{120{,}000}{144{,}000} = 0.833
$$

:::example[Worked example · p = 0.71, approve or decline only]
Approve: \(0.29 \times 120{,}000\) = ₹34,800. Decline: \(0.71 \times 24{,}000\) = ₹17,040. **Decline** — although the case is more likely good than bad.
:::

Only the ratio matters: with $c_{FP} = k\,c_{FN}$, $p^* = k/(k+1)$ — 5:1 gives 0.833, 1:1 gives 0.5, 1:5 gives 0.167. Shipping 0.5 asserts the two mistakes cost the same; on the [quick-start](/c/slm-decision-models/02-quick-start) data it costs ₹917 per case more than $p^*$. [Why no threshold search can beat solving the crossing](/c/practical-slm-decision-models/04-decision-theory).

## 4.3 Three actions: the review band

Review wins where its flat line is under both sloped lines:

$$
r < p\,c_{FN} \iff p > p_{lo} = \frac{r}{c_{FN}}, \qquad
r < (1-p)\,c_{FP} \iff p < p_{hi} = 1 - \frac{r}{c_{FP}}
$$

Decline below $p_{lo}$, review in $[p_{lo}, p_{hi}]$, approve above $p_{hi}$. The band exists only while $p_{lo} < p_{hi}$:

$$
r < r_{max} = \frac{c_{FP}\,c_{FN}}{c_{FP} + c_{FN}} = \frac{120{,}000 \times 24{,}000}{144{,}000} = 20{,}000
$$

— the expected cost of the cheaper automatic action at its worst point, $p^*$. A review that costs more than the worst automatic decision is never worth buying.

| Review price $r$ | $p_{lo}$ | $p_{hi}$ | Band width | Review share, quick-start data |
| ---: | ---: | ---: | ---: | ---: |
| ₹900 (ops sheet) | 0.0375 | 0.9925 | 0.955 | 91.8% |
| ₹3,000 (honest, illustrative) | 0.125 | 0.975 | 0.850 | 65.4% |
| ₹20,000 | 0.833 | 0.833 | 0 | 0% |

At $p = 0.71$ with $r$ = ₹900 the expected costs are decline ₹17,040, review ₹900, approve ₹34,800: **review**.

:::chart[Expected cost of each action vs P(good); the lowest line wins its interval]{type="line" x="p = P(good)" y="expected cost per case" prefix="₹" marks="0.125:p_lo;0.8333:p* (two actions);0.975:p_hi" band="0.125:0.975:review band at ₹3,000" dash="review ₹900" points="false"}
p, auto_approve, decline, review ₹3000, review ₹900
0, 120000, 0, 3000, 900
0.0375, 115500, 900, 3000, 900
0.125, 105000, 3000, 3000, 900
0.25, 90000, 6000, 3000, 900
0.5, 60000, 12000, 3000, 900
0.75, 30000, 18000, 3000, 900
0.8333, 20000, 20000, 3000, 900
0.9, 12000, 21600, 3000, 900
0.975, 3000, 23400, 3000, 900
0.9925, 900, 23820, 3000, 900
1, 0, 24000, 3000, 900
:::

Note that 0.833 is a real crossing but not a region boundary once review exists: approve and decline meet inside the band, where neither is cheapest. The two-action threshold governs only when review is removed or priced above ₹20,000.

:::warn[The review band is a staffing plan]
Multiply the review share by monthly volume and divide by reviewer throughput before shipping. 65.4% of 100,000 is 65,400 reviews a month. If that exceeds capacity, cap the band: review only the cases where review saves the most ($\min(p\,c_{FN}, (1-p)\,c_{FP}) - r$), send the rest to their cheaper automatic action, and report what the cap costs (§4.6). On the quick-start data a 25% cap costs ₹1,119 per case.
:::

## 4.4 When you trust neither probabilities nor costs

Expected cost needs a calibrated $p$ and signed-off costs. A new product segment has neither. Use a different criterion — and know which one you are using:

| Criterion | Rule | Use when |
| --- | --- | --- |
| Expected cost | $\arg\min_a \sum_o P(o)\,c(a,o)$ | Calibrated $p$, signed-off costs — the only criterion that minimises the long-run bill |
| Maximin (min worst cost) | $\arg\min_a \max_s c(a, s)$ | Ruinous tails; regulator asks about the worst case |
| Minimax regret | $\arg\min_a \max_s [c(a,s) - \min_{a'} c(a',s)]$ | Costs roughly known, probabilities contested (drift, new segment) |
| Satisficing | First action meeting every hard limit | Real-time routing with hard SLAs |
| Value of information | Buy a signal if EVSI > 0 (§4.5) | A second look is available at a price |

:::example[Worked example · a new segment, illustrative scenarios]
$P(\text{good}) \in \{0.85, 0.95, 0.99\}$, loss on a bad approval $\in$ {₹60,000, ₹120,000, ₹240,000}, review needs a field visit at ₹8,000.

| Action | Nominal ($p$ = 0.95, ₹120,000) | Worst case | Max regret |
| --- | ---: | ---: | ---: |
| decline | \(0.95 \times 24{,}000\) = ₹22,800 | \(0.99 \times 24{,}000\) = ₹23,760 | ₹23,760 − ₹600 = ₹23,160 |
| review | ₹8,000 | ₹8,000 | ₹8,000 − ₹600 = ₹7,400 |
| approve | \(0.05 \times 120{,}000\) = ₹6,000 | \(0.15 \times 240{,}000\) = ₹36,000 | ₹36,000 − ₹8,000 = ₹28,000 |

(₹600 is approve's cost at $p$ = 0.99, ₹60,000 — the best action in that scenario.) Expected cost at the nominal point says **approve**; maximin and minimax regret both say **review**. Disagreement between criteria is the signal that information is worth more than modelling: review now, collect outcomes, calibrate, then switch back to expected cost.
:::

## 4.5 EVSI: is a second signal worth buying?

A bureau pull, a document check or a second model can refine $p$ before acting. The **expected value of sample information** compares deciding now with deciding after seeing signal $z$, net of its price:

$$
\text{EVSI} = \min_a \mathbb{E}[c \mid a, p] \;-\; \sum_z P(z)\,\min_a \mathbb{E}\big[c \mid a, P(\text{good} \mid z)\big] \;-\; c_{\text{signal}}
$$

For a binary signal that is right with probability $s$ on both classes: $P(z{=}\text{good}) = s\,p + (1-s)(1-p)$ and $P(\text{good} \mid z{=}\text{good}) = s\,p / P(z{=}\text{good})$.

:::example[Worked example · ₹250 signal, 90% accurate, p = 0.90, review ₹3,000]
**Now:** decline ₹21,600, review ₹3,000, approve ₹12,000 → review, **₹3,000**.
**Signal says good** (probability 0.82): posterior $0.81/0.82 = 0.988 > p_{hi} = 0.975$ → approve at \(0.012 \times 120{,}000\) ≈ ₹1,463.
**Signal says bad** (0.18): posterior $0.09/0.18 = 0.50$ → review, ₹3,000.
**After:** \(0.82 \times 1{,}463 + 0.18 \times 3{,}000\) = ₹1,740.
**EVSI** = 3,000 − 1,740 − 250 = **₹1,010 per case** → buy it.
:::

A signal has value only if some outcome **moves the posterior across a cut point**. From $p = 0.70$, neither outcome leaves the band $[0.125, 0.975]$, so EVSI is exactly −₹250. Route the paid check only to cases near $p_{lo}$ or $p_{hi}$.

```python run
"""Loan triage: cut points from costs, and EVSI of a paid second signal."""
C_FP, C_FN = 120_000.0, 24_000.0          # approve a bad case / decline a good case (INR)


def costs(p, review):
    return {"decline": p * C_FN, "review": review, "approve": (1 - p) * C_FP}


print(f"p* = {C_FP / (C_FP + C_FN):.4f}; band vanishes at review = {C_FP * C_FN / (C_FP + C_FN):,.0f}")
for r in (900, 3_000):
    print(f"review {r:>5,}: decline < {r / C_FN:.4f} <= review <= {1 - r / C_FP:.4f} < approve")
c = costs(0.71, 900)
print("p = 0.71, review 900:", {a: round(v) for a, v in c.items()}, "->", min(c, key=c.get))


def best(p, review=3_000.0):
    return min(costs(p, review).values())


def evsi(prior, acc=0.9, price=250.0):
    pz = acc * prior + (1 - acc) * (1 - prior)              # P(signal says good)
    post_g, post_b = acc * prior / pz, (1 - acc) * prior / (1 - pz)
    return best(prior) - (pz * best(post_g) + (1 - pz) * best(post_b)) - price


print("EVSI of a 250 signal (90% accurate), review 3,000:")
for prior in (0.05, 0.20, 0.50, 0.70, 0.90, 0.95):
    v = evsi(prior)
    print(f"  prior {prior:.2f}: {v:7,.0f}  {'buy' if v > 0 else 'skip'}")
```

```output
p* = 0.8333; band vanishes at review = 20,000
review   900: decline < 0.0375 <= review <= 0.9925 < approve
review 3,000: decline < 0.1250 <= review <= 0.9750 < approve
p = 0.71, review 900: {'decline': 17040, 'review': 900, 'approve': 34800} -> review
EVSI of a 250 signal (90% accurate), review 3,000:
  prior 0.05:     410  buy
  prior 0.20:   1,490  buy
  prior 0.50:      50  buy
  prior 0.70:    -250  skip
  prior 0.90:   1,010  buy
  prior 0.95:   1,730  buy
```

## 4.6 Regret: whose loss is it?

**Regret** is the extra expected cost of your policy over an oracle that knows the true posterior and faces no limits, judged under the true posterior. Split the shipped policy (model beliefs + review cap) through the uncapped one:

$$
\underbrace{\text{Regret}(\pi_{\text{cap}})}_{\text{total}} =
\underbrace{\text{Regret}(\pi_{\text{model}})}_{\text{belief error: ML team}} +
\underbrace{\text{Regret}(\pi_{\text{cap}}) - \text{Regret}(\pi_{\text{model}})}_{\text{constraint: capacity owner}}
$$

On a synthetic population with a known true posterior (100,000 cases, 80% good), a model that is noisy but unbiased, review ₹3,000 and a 25% cap:

| Quantity | ₹ per case |
| --- | ---: |
| Oracle cost (true $p$, no cap) | 2,226 |
| Belief error (model, no cap) | 326 |
| Constraint regret (25% cap) | 1,859 |
| **Total regret, shipped policy** | **2,185** |
| Regret of "always review" (no model at all) | 774 |
| Regret of a *perfect* model under the same cap | 1,243 |

- **The cap costs 5.7× the model error.** More ML work cannot touch the larger bar; the headcount decision can.
- **Compare with the best constant action.** "Always review" has regret ₹774; the model beats it by ₹448 per case *uncapped*. A model that loses to a constant action is subtracting value.
- **Rank models on belief error**, not on capped totals: an overconfident model pushes cases out of the band and makes the cap look cheaper. That trap and its numbers are in [the deep course §4.6](/c/practical-slm-decision-models/04-decision-theory).

:::details[Show the regret computation]
```python run
"""Regret = belief error + constraint, judged against the true posterior."""
import numpy as np

C_FP, C_FN, REVIEW, CAP = 120_000.0, 24_000.0, 3_000.0, 0.25
rng = np.random.default_rng(1)
n = 100_000
good = rng.random(n) < 0.80
logit = np.log(4) + 2 * rng.normal(np.where(good, 1.0, -1.0), 1.0)   # exact posterior logit
p_true = 1 / (1 + np.exp(-logit))
p_model = 1 / (1 + np.exp(-(logit + rng.normal(0, 1.0, n))))      # noisy, unbiased in logit


def exp_cost(p):
    """Columns: decline, review, approve."""
    return np.stack([p * C_FN, np.full_like(p, REVIEW), (1 - p) * C_FP], axis=1)


def choose(p, cap=None):
    e = exp_cost(p)
    a = e.argmin(1)
    if cap is not None and (a == 1).mean() > cap:
        saving = np.where(a == 1, e[:, [0, 2]].min(1) - REVIEW, -np.inf)
        a = np.where(e[:, 0] < e[:, 2], 0, 2)
        a[np.argsort(-saving)[: int(cap * n)]] = 1                  # review the biggest savings
    return a


truth = exp_cost(p_true)
paid = lambda a: truth[np.arange(n), a].mean()
oracle = paid(choose(p_true))
belief = paid(choose(p_model)) - oracle
total = paid(choose(p_model, CAP)) - oracle
print(f"oracle {oracle:,.0f}; always review {truth[:, 1].mean() - oracle:,.0f}; "
      f"perfect model under cap {paid(choose(p_true, CAP)) - oracle:,.0f}")
print(f"belief {belief:,.0f} + constraint {total - belief:,.0f} = total {total:,.0f} "
      f"(uncapped review share {(choose(p_model) == 1).mean():.1%})")
```

```output
oracle 2,226; always review 774; perfect model under cap 1,243
belief 326 + constraint 1,859 = total 2,185 (uncapped review share 57.4%)
```
:::

## 4.7 Recipe

1. Write the cost matrix in currency; get it signed by whoever owns each loss.
2. Compute $p^*$, $p_{lo}$, $p_{hi}$ and $r_{max}$ by hand. If $r \ge r_{max}$, drop the review action.
3. Price review fully (time + queue loss + SLA); convert the review share into headcount.
4. If capacity binds, cap by largest saving and report the constraint regret separately.
5. Check calibration near the cut points before trusting any of it.
6. For contested segments, compare expected cost, maximin and minimax regret; buy information where they disagree and EVSI > 0.
7. Report regret against the best constant action, not just accuracy.

## 4.8 Exercises

Drag the costs and $p$; watch $p_{lo}$ and $p_{hi}$ move. Try a ₹3,000 review (band $[0.125, 0.975]$), then ₹20,000 (band collapses onto 0.833), then a declined-good cost of ₹120,000 ($p^*$ falls to 0.5).

:::exercise[Exercise 04.1 · Threshold lab]{id="threshold" fp="120000" fn="24000" review="900" actions="decline,manual_review,auto_approve" currency="₹"}
:::

Then score your own problem's cost matrix:

:::exercise[Exercise 04.2 · Score your cost matrix]{id="scorecard" labels="Actions named,Outcomes named,Every cell filled,Costs defended,Abstain priced" scale="4" unit="matrix"}
:::

## 4.9 Check yourself

:::qa[A missed fraud costs ₹50,000; blocking a legitimate payment costs ₹2,000. Block threshold on P(fraud)?]
Block when $P(\text{fraud}) \times 50{,}000 > (1 - P(\text{fraud})) \times 2{,}000$: $P(\text{fraud}) > 2{,}000 / 52{,}000 = 0.038$.
:::

:::qa[With the loan costs and a ₹12,000 review, what are the cut points?]
$p_{lo} = 12{,}000/24{,}000 = 0.5$, $p_{hi} = 1 - 12{,}000/120{,}000 = 0.9$. Decline below 0.5, review in $[0.5, 0.9]$, approve above 0.9. The band still exists because ₹12,000 < ₹20,000.
:::

:::qa[A 90%-accurate ₹250 signal is offered for every case; most priors sit between 0.6 and 0.8 and review costs ₹3,000. Buy it?]
No. From 0.8 a positive signal gives $0.72/0.74 = 0.973 < 0.975$ and a negative one $0.08/0.26 = 0.31$ — both inside the band, so the action never changes and EVSI = −₹250. Buy only for cases near the cut points.
:::

:::qa[Your model's regret is ₹900 per case and "always review" has ₹774. What do you ship?]
"Always review" (if capacity allows) while you fix the model — it is ₹126 per case cheaper. Check calibration first; overconfidence is the usual cause.
:::

Next: [Why SLMs for decisions](/c/slm-decision-models/05-why-slms) — choosing the engine that produces $p$.
