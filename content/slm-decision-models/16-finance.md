---
section: "16"
title: "Finance"
kicker: "Use cases"
abstract: "Loan pre-approval and fraud pre-screen with the same machinery: cost matrices, cut points and review bands, a capacity-capped hold queue priced per hold, base-rate drift and the explanation duties every decline carries."
time: "14 min"
order: 16
outcomes:
  - "Derive the loan cut points (0.125 / 0.833 / 0.975) and the fraud cut points (0.094% / 6.9%) from their cost matrices"
  - "Cap a review or hold queue by largest saving and price the marginal unit of capacity"
  - "Correct calibrated probabilities for a base-rate shift and say what to monitor"
  - "Specify reason codes and fairness monitoring for adverse actions"
---

Finance has two of the cleanest SLM decision problems in this handbook. **Loan pre-approval** — the course's running example — decides `auto_approve`, `manual_review` or `decline` on an application. **Fraud pre-screen** decides `pass`, `step_up` (an OTP or challenge) or `hold` (manual review) on a card payment, inline, in milliseconds. Both have closed action sets, priced mistakes and observable outcomes; both also carry selective labels, adverse-action duties and drifting base rates. This section gives the worked numbers for each and the controls that make them defensible.

:::key[First principle]
In finance the cost matrix is the policy. Cut points come from the costs, the review band from the price of a review, the queue size from headcount, and every decline needs a reason a person can read. The model's only job is a calibrated probability.
:::

## 16.1 Where SLMs fit

| Decision | Actions | SLM role |
| --- | --- | --- |
| Loan pre-approval | approve · review · decline | Reads application text and documents; combined with bureau features |
| Card-payment fraud pre-screen | pass · step-up · hold | Usually *features*: an SLM scores slow-moving entities (merchant descriptors, customer notes) offline; a fast tabular model decides inline |
| KYC document consistency | pass · manual · reject | Extraction plus field-consistency checks |
| Dispute / chargeback triage | auto-resolve · investigate · escalate | Text-heavy, cost-asymmetric — a strong fit |

:::tip[Latency pattern]
When the decision budget is tens of milliseconds, keep the SLM off the hot path: refresh its outputs for merchants, customers and devices in batch, and let the real-time scorer consume them as features. Measure the latency you actually need before choosing ([§13](/c/practical-slm-decision-models/13-serving-and-deployment) of the deep course covers sizing).
:::

## 16.2 Loan pre-approval: cut points and the review band

| Action ↓ / outcome → | bad (defaults) | good (repays) |
| --- | ---: | ---: |
| `decline` | 0 | 24,000 (lost margin) |
| `manual_review` | $r$ | $r$ |
| `auto_approve` | 120,000 | 0 |

On $p = P(\text{good})$, three cut points follow ([derivation](/c/practical-slm-decision-models/04-decision-theory)):

$$
p^* = \frac{120{,}000}{144{,}000} = 0.833, \qquad p_{lo} = \frac{r}{24{,}000}, \qquad p_{hi} = 1 - \frac{r}{120{,}000} .
$$

:::example[Worked example · the band at two review prices]
- **Fully loaded review, $r$ = ₹3,000** (illustrative: salary, queue time, SLA): review for $p \in [0.125, 0.975]$. A case at $p = 0.90$ is reviewed — declining costs \(0.90 \times 24{,}000\) = ₹21,600, approving \(0.10 \times 120{,}000\) = ₹12,000, reviewing ₹3,000.
- **Ops-sheet review, $r$ = ₹900**: the band widens to $[0.0375, 0.9925]$ and swallows most applications.

On [§12's](/c/slm-decision-models/12-notebook-triage) synthetic book the ₹3,000 band reviews 37.0% of applications — about 37,050 reviews a month at 100,000 applications, roughly 93 reviewers at an illustrative 400 reviews per reviewer-month — for ₹2,698 per case against ₹5,202 with no review. Sizing the band at ₹900 sends 88.5% to review for no measurable saving. Capped at 10% of applications, cost rises to ₹3,849: the capacity limit costs ₹1,151 per case.
:::

:::exercise[Exercise 16.1 · Loan threshold lab]{id="threshold" fp="120000" fn="24000" review="3000" actions="decline,manual_review,auto_approve" currency="₹"}
:::

## 16.3 Fraud pre-screen: three actions, two tiny cut points

Costs per transaction, illustrative (from the deep course's [domain-fit](/c/practical-slm-decision-models/15-use-cases-and-domain-fit) section):

| Action ↓ / outcome → | legitimate | fraud |
| --- | ---: | ---: |
| `pass` | 0 | 8,000 (average loss) |
| `step_up` | 6 (3% abandonment × ₹200 margin) | 1,600 (challenge stops 80%) |
| `hold` | 120 (₹60 review + ₹60 delay churn) | 60 |

Each boundary is where two expected costs meet, with $q = P(\text{fraud})$:

$$
\begin{aligned}
\text{pass} \leftrightarrow \text{step\_up}:&\quad 8000q = 6(1-q) + 1600q \;\Rightarrow\; q = \tfrac{6}{6406} = 0.094\% \\
\text{step\_up} \leftrightarrow \text{hold}:&\quad 6(1-q) + 1600q = 120(1-q) + 60q \;\Rightarrow\; q = \tfrac{114}{1654} = 6.9\%
\end{aligned}
$$

:::example[Worked example · a payment at q = 2%]
Pass: \(0.02 \times 8000\) = ₹160. Step-up: \(0.98 \times 6 + 0.02 \times 1600\) = ₹37.88. Hold: \(0.98 \times 120 + 0.02 \times 60\) = ₹118.80. **Step-up.** A 2% fraud risk is fifty times too high to pass silently and three times too low to justify a reviewer.
:::

The pass/step-up boundary sits near $q = 0.001$, so calibration must be right in the far tail, where fraud cases are rarest. And labels are selective: a held or declined payment never reveals whether it was fraud.

## 16.4 A capacity-capped hold queue

Holds need analysts, and analysts are finite. Simulate 1,000,000 payments at an illustrative 0.2% fraud rate with a calibrated score (posterior computed exactly from the synthetic score distributions). If the cost-optimal policy holds more than the cap, keep the holds that save the most over the best automatic action and send the rest to pass or step-up.

```python run
import numpy as np

# Fraud pre-screen, costs in INR per transaction (illustrative). Columns: (legitimate, fraud)
ACT = ("pass", "step_up", "hold")
COST = np.array([[0, 8_000], [6, 1_600], [120, 60]], float)
rng = np.random.default_rng(16)


def simulate(n, rate, d=3.0):
    """Synthetic traffic: fraud flag and a model score N(d,1) for fraud vs N(0,1) for legitimate."""
    fraud = rng.random(n) < rate
    return fraud, rng.normal(size=n) + d * fraud


def posterior(s, rate, d=3.0):
    lr = np.exp(d * s - d * d / 2)
    return rate * lr / (rate * lr + 1 - rate)


def decide(q, cap=None):
    """Expected-cost argmin; if holds exceed `cap` (share), keep the holds that save the most."""
    e = np.outer(1 - q, COST[:, 0]) + np.outer(q, COST[:, 1])
    a = e.argmin(1)
    if cap is not None and (a == 2).mean() > cap:
        saving = e[:, :2].min(1) - e[:, 2]
        a = e[:, :2].argmin(1)
        a[np.argsort(-saving)[: int(cap * len(q))]] = 2
    return a


def realised(a, fraud):
    return COST[a, fraud.astype(int)].mean()


fraud, s = simulate(1_000_000, 0.002)          # base rate 0.2% (illustrative)
q = posterior(s, 0.002)
a = decide(q)
print("share per action:", {k: f"{(a == i).mean():.3%}" for i, k in enumerate(ACT)},
      f"; fraud caught by hold {(a[fraud] == 2).mean():.1%}")
print(f"{'hold cap':>9s} {'INR/txn':>8s} {'holds/day at 1M txn':>20s}")
for cap in (0.0, 0.0005, 0.001, 0.0015, 0.002, 0.003, None):
    a = decide(q, cap)
    print(f"{'uncapped' if cap is None else f'{cap:.2%}':>9s} {realised(a, fraud):8.2f} {(a == 2).mean() * 1e6:20,.0f}")
print(f"baselines: pass all {realised(np.zeros(len(q), int), fraud):.2f}, "
      f"step-up all {realised(np.ones(len(q), int), fraud):.2f}")
```

```output
share per action: {'pass': '89.252%', 'step_up': '10.281%', 'hold': '0.467%'} ; fraud caught by hold 63.9%
 hold cap  INR/txn  holds/day at 1M txn
    0.00%     4.26                    0
    0.05%     3.61                  500
    0.10%     3.24                1,000
    0.15%     3.04                1,500
    0.20%     2.89                2,000
    0.30%     2.76                3,000
 uncapped     2.70                4,667
baselines: pass all 15.80, step-up all 9.15
```

:::chart[Fraud pre-screen: cost per payment vs hold capacity]{type="line" x="holds per day (at 1,000,000 payments/day)" y="cost per payment" prefix="₹" yfmt="dec2" xfmt="int" marks="4667:uncapped optimum" note="Synthetic, 0.2% fraud rate and costs illustrative. Holds kept by largest saving; the rest pass or step up."}
holds per day, cost per payment
0, 4.261
250, 3.900
500, 3.611
750, 3.403
1000, 3.243
1250, 3.121
1500, 3.036
1750, 2.957
2000, 2.893
2250, 2.857
2500, 2.830
2750, 2.788
3000, 2.760
3250, 2.736
3500, 2.724
3750, 2.707
4000, 2.702
4250, 2.722
4667, 2.704
:::

- **Uncapped, 0.467% of payments are held** — 4,667 a day at an illustrative 1,000,000 payments a day — and the hold queue catches 63.9% of fraud. Cost falls from ₹4.26 per payment with no holds to ₹2.70.
- **Capacity has a price, and it falls fast.** The first 500 holds a day save ₹0.65 per payment, about ₹1,300 per hold. Going from 3,000 to 4,667 holds saves ₹0.056 per payment, about ₹34 per hold after paying for it — under 3% of what the first holds are worth. Beyond about 3,500 holds the curve is flat within simulation noise.
- **Both constant policies are far worse:** pass everything ₹15.80, step up everything ₹9.15.

The same capping rule and curve for the loan review queue are in [§12](/c/slm-decision-models/12-notebook-triage); the marginal value per reviewed case is the number to bring to whoever approves headcount.

## 16.5 Base-rate drift

A calibrated model encodes the base rate it was trained on. When fraud doubles in a wave, every probability is too low; when it halves, too high. If the score distributions *within* each class are unchanged, the fix is a prior-shift correction on the odds:

$$
\frac{q'}{1-q'} = \frac{q}{1-q} \cdot \frac{\pi'/(1-\pi')}{\pi/(1-\pi)} .
$$

```python run
def shift(q, old, new):
    """Prior-shift correction: rescale the odds by the ratio of new to old base-rate odds."""
    k = (new / (1 - new)) / (old / (1 - old))
    return q * k / (q * k + 1 - q)


fraud2, s2 = simulate(1_000_000, 0.004)       # a fraud wave: base rate doubles to 0.4%
stale = posterior(s2, 0.002)                  # model still assumes 0.2%
fixed = shift(stale, 0.002, 0.004)
print(f"monitor: mean predicted {stale.mean():.4%} vs observed {fraud2.mean():.4%}")
for name, qq in (("stale", stale), ("prior-corrected", fixed)):
    a = decide(qq)
    print(f"{name:16s} INR {realised(a, fraud2):.2f}/txn; holds {(a == 2).mean():.3%}, "
          f"fraud passed {(a[fraud2] == 0).mean():.1%}")
print(f"a score with q = 0.050 at 0.2% becomes {shift(0.05, 0.002, 0.004):.3f} at 0.4%")
```

```output
monitor: mean predicted 0.2588% vs observed 0.3861%
stale            INR 4.62/txn; holds 0.584%, fraud passed 4.5%
prior-corrected  INR 4.30/txn; holds 0.944%, fraud passed 2.6%
a score with q = 0.050 at 0.2% becomes 0.095 at 0.4%
```

The stale model under-predicts (mean 0.26% against 0.39% observed), passes 4.5% of fraud and costs ₹4.62 per payment; the corrected one passes 2.6% and costs ₹4.30 — ₹0.32 per payment, about ₹3.2 lakh a day at the illustrative volume. Note the side effect: holds rise from 0.584% to 0.944%, so a fraud wave is also a capacity event, and the cap from §16.4 will bind.

What to watch, because chargeback labels arrive weeks late:

| Signal | Leading or lagging | Action when it moves |
| --- | --- | --- |
| Mean predicted $q$ vs observed fraud rate (by cohort) | lagging (labels) | prior-shift correction; recalibrate |
| Score distribution shift (e.g. PSI on score deciles) | leading | investigate inputs; check for new merchant or channel |
| Share of payments per action; hold-queue length | leading | apply or raise the cap; staff up |
| Step-up abandonment rate | leading | re-price the `step_up` cell |
| Approval / decline rate by segment | leading | fairness review (§16.6) |

:::warn[When the correction is wrong]
The odds correction assumes fraudsters look the same and there are just more of them. New attack patterns change the score distributions themselves; then only fresh labels, recalibration or retraining help. Treat the correction as a stopgap with an expiry date.
:::

## 16.6 Fairness and adverse-action explanations

A loan decline is an adverse action, and so, in effect, is a blocked payment. Requirements vary by jurisdiction and product — work them out with compliance — but the engineering controls are common:

- **Reasons from a closed set.** The model emits a reason code and the evidence spans behind it; a person-readable explanation is built from the code, not generated free-form. Verify that quoted evidence actually appears in the input.
- **No protected attributes as inputs**, and test for proxies: compare approval rates and error rates across the groups you are permitted and required to monitor, with intervals ([§14](/c/slm-decision-models/14-notebook-evaluation) slice table).
- **Selective labels.** Repayment is observed only for approved loans and fraud only for passed payments. Keep a small randomised or human-reviewed sample of decisions the policy would have declined or held, so calibration on that population is measured, not assumed.
- **Reproducibility.** Log model and prompt hashes, input hash, calibrated probability, thresholds, action, reason code, reviewer and outcome for every decision, for as long as your retention rules require.
- **Human review stays real.** A reviewer who sees the model's score first and agrees 99% of the time is a rubber stamp; sample reviews blind.

```json
{"action": "manual_review", "p_good": 0.90, "reason_code": "R3",
 "reason": "income documents inconsistent with stated employer",
 "evidence": ["payslip employer: <span>", "application employer: <span>"],
 "model": "loan-slm@v4", "prompt_hash": "<hash>", "policy": "band-0.125-0.975@2026-10"}
```

## 16.7 Check yourself

:::qa[The review price rises from ₹3,000 to ₹6,000. Where are the new loan cut points?]
$p_{lo} = 6{,}000/24{,}000 = 0.25$ and $p_{hi} = 1 - 6{,}000/120{,}000 = 0.95$; $p^* = 0.833$ is unchanged because it does not involve $r$. The band narrows from both sides.
:::

:::qa[Step-up abandonment cost doubles from ₹6 to ₹12. Where does the pass/step-up boundary move?]
$q = 12 / (8{,}000 - 1{,}600 + 12) = 12/6{,}412 \approx 0.187\%$, double the old 0.094%. Twice as many low-risk payments now pass without a challenge; the boundary is almost proportional to the friction cost because the fraud-loss term dominates.
:::

:::qa[Fraud doubles from 0.2% to 0.4%. A payment previously scored q = 0.05. What now?]
Odds scale by about 2.0, so $q' \approx 0.095$ — above the 6.9% hold boundary. It moves from step-up to hold. Multiply that across the score distribution and the hold queue grows by about 60%.
:::

Next: [Industrial](/c/slm-decision-models/17-industrial).
