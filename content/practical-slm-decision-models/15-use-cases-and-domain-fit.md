---
section: "15"
title: "Use cases and domain fit"
kicker: "Applicability"
abstract: "A weighted, gated rubric for deciding whether a problem is an SLM decision problem at all — applied to five domains with their action sets, cost matrices, derived thresholds and the one risk that decides each."
time: "26 min"
order: 15
outcomes:
  - "Score a proposed use case on seven criteria and apply the hard gates"
  - "Compute the break-even volume that justifies building a decision model"
  - "Write a domain's action set and cost matrix, and derive its thresholds"
  - "Recognise when an extreme cost ratio makes a model useless as a decider"
  - "Reject anti-pattern use cases before spending on data or training"
---

Three proposals arrive in one week: route support tickets, pre-screen card payments, and triage patient messages at a clinic. All three are "classify text into a few buckets", and a demo of each works. Only one of them is clearly a good SLM decision problem, one needs heavy controls, and one should not be automated as a decision at all. This section gives the rubric that separates them in an hour, before anyone labels data.

:::key[First principle]
A problem is an SLM *decision* problem when you can write down the actions, put a bounded cost on every (action, outcome) cell, and observe the outcome afterwards — and when volume or latency makes a small, calibrated, local model pay for itself. If you cannot fill in the cost matrix, you do not yet have a decision problem.
:::

## 15.1 Seven criteria, each tied to the machinery

Every criterion exists because some part of the course stops working without it:

| Criterion | Weight | 1 — poor fit | 3 | 5 — strong fit | What breaks without it |
|---|---:|---|---|---|---|
| Closed action set | 15 | open-ended answer or free text | finite, but depends on context | ≤ ~10 fixed actions incl. a safe fallback | expected-cost argmin (§4) has nothing to choose from |
| Measurable outcome | 20 | never observed, or opinion | observed late, or only for some actions | observed quickly for every decision | evaluation, calibration, canaries (§7, §11, §13) |
| Bounded, quantified costs | 10 | unbounded or irreversible harm | order of magnitude known | measured ₹ per cell, bounded worst case | thresholds $p^*$ and error containment |
| Volume | 15 | < 1,000/month | ~10,000/month | ≥ 100,000/month | build cost never amortises |
| Latency / locality | 10 | seconds fine, data may leave | sub-second preferred | inline < 100 ms, on-device or air-gapped | the SLM's structural edge over an API LLM (§5) |
| Labelled data | 15 | none, or labels contested | a few thousand, noisy | ≥ 10,000 historical decisions with outcomes | distillation, fine-tuning, evaluation (§6, §8) |
| Low regulatory exposure | 15 | high-risk decision about health, liberty or livelihood | consumer-protection duties (explanations, fairness) | internal operations | oversight and audit cost (§16) |

Measurable outcome carries the most weight because it is the only criterion that lets you check all the others. The score is a weighted sum mapped to 0–100:

$$
S = \sum_{i=1}^{7} w_i\,\frac{s_i - 1}{4}, \qquad \sum_i w_i = 100
$$

with three **hard gates**: a 1 on measurable outcome, bounded costs or regulatory exposure vetoes autonomous use regardless of $S$. A high average cannot buy back an unmeasurable or unbounded failure. Bands: $S \ge 70$ strong, $50 \le S < 70$ conditional (build, with the controls the low criteria demand), below 50 or gated — do not automate the decision.

Volume deserves its own arithmetic. With fixed build-and-run cost $F$ for the first year and saving $s$ per decision versus the current process, the break-even volume is

$$
V^* = \frac{F}{s}
$$

At an illustrative $F$ = ₹15,00,000 and $s$ = ₹8, that is 187,500 decisions: under two months for 100,000 tickets/month, over fifteen years at 1,000/month.

## 15.2 Scoring five domains

Scores below are judgements, argued in §15.3; change them for your organisation and re-run.

| Criterion (weight) | Ticket routing | Fraud pre-screen | Content moderation | Clinical triage | Loan pre-approval |
|---|---:|---:|---:|---:|---:|
| Closed actions (15) | 5 | 5 | 4 | 3 | 5 |
| Measurable outcome (20) | 4 | 3 | 2 | 2 | 3 |
| Bounded costs (10) | 4 | 4 | 3 | **1** | 5 |
| Volume (15) | 4 | 5 | 5 | 3 | 4 |
| Latency / locality (10) | 3 | 5 | 4 | 3 | 3 |
| Labelled data (15) | 5 | 3 | 4 | 2 | 4 |
| Low regulatory exposure (15) | 5 | 3 | 2 | **1** | 2 |

```python run
"""Score five domains for SLM decision fit, apply hard gates, and derive each domain's thresholds."""
W = {"closed actions": 15, "measurable outcome": 20, "bounded costs": 10, "volume": 15,
     "latency/locality": 10, "labelled data": 15, "low regulatory exposure": 15}
SCORES = {  # 1 = poor fit, 5 = strong fit; judgements, argued in 15.3
    "ticket routing":     [5, 4, 4, 4, 3, 5, 5],
    "fraud pre-screen":   [5, 3, 4, 5, 5, 3, 3],
    "content moderation": [4, 2, 3, 5, 4, 4, 2],
    "clinical triage":    [3, 2, 1, 3, 3, 2, 1],
    "loan pre-approval":  [5, 3, 5, 4, 3, 4, 2],
}
GATES = ["measurable outcome", "bounded costs", "low regulatory exposure"]   # a 1 here vetoes

names = list(W)
for dom, s in SCORES.items():
    total = sum(W[n] * (v - 1) / 4 for n, v in zip(names, s))
    vetoed = [n for n, v in zip(names, s) if n in GATES and v == 1]
    band = "gated" if vetoed else ("strong" if total >= 70 else "conditional" if total >= 50 else "weak")
    print(("%-19s %5.1f / 100  %-11s %s" % (dom, total, band, ", ".join(vetoed))).rstrip())


def boundary(cost_a_pos, cost_a_neg, cost_b_pos, cost_b_neg):
    """q = P(positive) at which actions a and b have equal expected cost."""
    return (cost_b_neg - cost_a_neg) / ((cost_a_pos - cost_a_neg) - (cost_b_pos - cost_b_neg))


print()
# loan: positive = good applicant. costs (if good, if bad) in INR
print("loan    approve/decline p*=%.3f  review band %.4f-%.4f" % (
    boundary(0, 120000, 24000, 0), boundary(900, 900, 24000, 0), boundary(0, 120000, 900, 900)))
# fraud: positive = fraud. pass (8000, 0) step_up (1600, 6) hold (60, 120)
print("fraud   pass->step_up q=%.5f  step_up->hold q=%.4f" % (
    boundary(8000, 0, 1600, 6), boundary(1600, 6, 60, 120)))
# moderation: positive = violating. allow (500, 0) review (15, 15) remove (0, 50)
print("modern. allow->review v=%.3f  review->remove v=%.3f" % (
    boundary(500, 0, 15, 15), boundary(15, 15, 0, 50)))
# ticket routing: best queue costs 80*(1-p_max) (misroute); triage desk costs 40 (a person routes it)
print("tickets send to triage desk when p_max < %.3f" % (1 - 40 / 80))
# clinical: positive = emergent. routine (1000, 0) escalate (0, 1) in harm units
print("clinic. escalate when P(emergent) > %.4f" % boundary(1000, 0, 0, 1))

F, saving = 1_500_000, 8.0                  # first-year build + run, saving per decision (INR), illustrative
for monthly in (1_000, 10_000, 100_000, 1_000_000):
    print("volume %9d/month -> break-even after %6.1f months" % (monthly, F / saving / monthly))
```

```output
ticket routing       83.8 / 100  strong
fraud pre-screen     72.5 / 100  strong
content moderation   58.8 / 100  conditional
clinical triage      28.8 / 100  gated       bounded costs, low regulatory exposure
loan pre-approval    66.2 / 100  conditional

loan    approve/decline p*=0.833  review band 0.0375-0.9925
fraud   pass->step_up q=0.00094  step_up->hold q=0.0689
modern. allow->review v=0.030  review->remove v=0.700
tickets send to triage desk when p_max < 0.500
clinic. escalate when P(emergent) > 0.0010
volume      1000/month -> break-even after  187.5 months
volume     10000/month -> break-even after   18.8 months
volume    100000/month -> break-even after    1.9 months
volume   1000000/month -> break-even after    0.2 months
```

:::chart[Domain-fit score (0–100); clinical triage is vetoed by its gates regardless of score]{type="bar" x="domain" y="fit score" ymin="0" ymax="100" labels="true" hmarks="70:strong;50:conditional"}
domain, score
tickets, 83.8
fraud, 72.5
loan, 66.2
moderation, 58.8
clinical, 28.8
:::

The `boundary` helper is §4's crossing-point formula for two actions $a, b$ over a binary outcome: with $c_a^{+}, c_a^{-}$ the costs of $a$ when the outcome is positive or negative,

$$
q^* = \frac{c_b^{-} - c_a^{-}}{(c_a^{+} - c_a^{-}) - (c_b^{+} - c_b^{-})}
$$

## 15.3 The five domains

All ₹ figures below are illustrative; replace each cell with a measured cost before using the thresholds.

### Ticket routing — strong (83.8)

**Actions:** route to `billing`, `account_access`, `technical`, `orders`, or `triage_desk`. 100,000 tickets/month.

| Action ↓ / true queue → | billing | account_access | technical | orders |
|---|---:|---:|---:|---:|
| route to billing | 0 | 200 | 80 | 80 |
| route to account_access | 80 | 0 | 80 | 80 |
| route to technical | 80 | 200 | 0 | 80 |
| route to orders | 80 | 200 | 80 | 0 |
| triage_desk | 40 | 40 | 40 | 40 |

A misroute costs a human re-route (₹40, the per-ticket human cost used in §10) plus delay; a locked-out customer sent to the wrong queue costs more (₹200, churn risk). With a uniform ₹80 misroute, the triage desk wins whenever $80(1-p_{\max}) > 40$, i.e. $p_{\max} < 0.5$; the account_access column shifts that boundary per ticket, which is why the policy takes the argmin of expected cost rather than a single threshold.

**Key risk:** new ticket types (a product launch) that belong to no queue get forced into one. Errors are cheap and visible within hours, so an out-of-scope detector and the triage desk contain it. An encoder on one CPU replica serves this volume (§13.3).

### Fraud pre-screen — strong (72.5)

**Actions:** `pass`, `step_up` (OTP or challenge), `hold` (manual review), inline in payment authorisation.

| Action ↓ / outcome → | legitimate | fraud |
|---|---:|---:|
| pass | 0 | 8,000 (average loss) |
| step_up | 6 (3% abandonment × ₹200 margin) | 1,600 (challenge stops 80%) |
| hold | 120 (₹60 review + ₹60 delay churn) | 60 |

Thresholds on $q = P(\text{fraud})$: pass below **0.094%**, step-up from 0.094% to **6.9%**, hold above.

**Key risk:** the pass/step-up boundary sits at $q \approx 0.001$, so calibration must be right in the extreme tail, where positives are rarest. Labels arrive late (chargebacks) and only for transactions you let through — held payments never reveal their outcome — and fraudsters adapt to the model. Latency (inline, tens of milliseconds) is exactly where an SLM beats an API call, which is why it still scores strongly.

### Loan pre-approval — conditional (66.2)

**Actions:** `auto_approve`, `manual_review`, `decline` — the course's running example.

| Action ↓ / outcome → | good | bad |
|---|---:|---:|
| auto_approve | 0 | 120,000 |
| manual_review | 900 | 900 |
| decline | 24,000 (lost margin) | 0 |

Approve over decline when $P(\text{good}) > 120{,}000/144{,}000 = 0.833$. With review at ₹900 the review band spans 0.0375–0.9925 — §4's lesson that a ₹900 review is under-priced; at a realistic fully loaded review cost the band narrows sharply.

**Key risk:** selective labels. Repayment is observed only for approved applicants, so the model's calibration on the population it declines is unknown, and fair-lending and explanation duties apply to every decline. Hence "conditional": build it, with reject-inference analysis, subgroup monitoring, the oversight controls of §16 and a review queue sized to its capacity.

### Content moderation — conditional (58.8)

**Actions:** `allow`, `human_review`, `remove`, per item.

| Action ↓ / outcome → | benign | violating |
|---|---:|---:|
| allow | 0 | 500 |
| human_review | 15 | 15 |
| remove | 50 (appeal + creator harm) | 0 |

Thresholds on $v = P(\text{violating})$: allow below **3%**, review from 3% to **70%**, remove above.

**Key risk:** the "outcome" is a contested policy definition — trained annotators disagree, so the label itself is noisy (measurable outcome = 2). Severity also differs by category: the most severe categories belong to deterministic matching and mandatory human review, not to a threshold on one score. Multilingual text and adversarial spelling drift faster than the labelled set.

### Clinical triage — gated (28.8)

**Actions:** `routine` or `escalate` (urgent clinician review). Costs are in harm units, not rupees — pricing a missed emergency is not a modelling choice an engineering team should make.

| Action ↓ / outcome → | not emergent | emergent |
|---|---:|---:|
| routine | 0 | 1,000 |
| escalate | 1 | 0 |

Escalate when $P(\text{emergent}) > 1/1001 \approx$ **0.001**. The model may say "routine" only when it is more than 99.9% sure. Even verifying that is expensive: with zero misses in $n$ cases, the 95% upper bound on the miss rate is about $3/n$ (the rule of three), so showing a miss rate below 0.1% needs at least 3,000 routine-routed cases with no missed emergency — per subgroup you care about.

**Key risk:** under-triage, with unbounded and irreversible harm; software intended for triage is likely to be regulated as a medical device in many jurisdictions. The gates fire. The SLM's legitimate role is *assistive*: summarise the intake for a nurse, extract structured fields, route administrative documents — the clinician decides.

:::pull
When the cost ratio is 1,000 : 1, the threshold is 0.001 and the "decision model" degenerates into "escalate almost everything" — its value is in ordering a human's queue, not in deciding.
:::

## 15.4 Anti-patterns

| Anti-pattern | Symptom | What to do instead |
|---|---|---|
| Generation dressed as a decision | "actions" are free-text answers; no cost matrix can be written | enumerate actions, or treat it as a generation task with human review |
| No observable outcome | quality judged by "looks right" | define a measurable proxy and its bias, or do not automate |
| Model output used as authorization | the router issues refunds or unlocks accounts | model proposes; deterministic code authorises (§16) |
| Low volume | 1,000 decisions/month, 187.5 months to break even | rules, an API model, or people |
| Fresh facts in weights | prices, policies or limits change monthly | retrieval or a database lookup; the model only classifies |
| Extreme cost ratio | $p^*$ near 0 or 1; nearly every case gets one action | use the score to rank a human queue |
| Proxy label equals target | moderation trained on user reports | the model learns who reports, not what violates; label against the policy |
| Exact rules modelled statistically | eligibility, arithmetic, access control | code, with tests (§12) |

## 15.5 When something else is the right tool

| Use | When | Example |
|---|---|---|
| Deterministic rules | the decision is a formula or a lookup | "income < 2 × EMI → decline" |
| Retrieval / database | the answer is a fact that changes | current interest rate, order status |
| Larger model | the task needs open-ended reasoning and volume is low | drafting a one-off legal summary |
| A person | evidence is ambiguous and error is severe | clinical triage, appeals |
| SLM decision model | closed actions, bounded costs, measurable outcomes, volume or latency | ticket routing, fraud pre-screen |

The usual answer is a hybrid (§10): rules for the exact parts, an SLM for the bounded classification, a person for the abstentions. "No model" is a valid result of this section.

:::exercise[Exercise 15.1 · Pre-flight before you label anything]{id="checklist" items="Every action is enumerated, including a safe fallback;Every cost-matrix cell has a number and a source;Worst-case cost per decision is bounded;The outcome is observed for every action, and you know the lag;Break-even volume V* = F/s is below expected volume;Regulatory and oversight duties are identified;A rules or human baseline exists to beat" grades="A,B,C,D,F"}
:::

## 15.6 Check yourself

:::qa[A proposal scores 78 but has a 1 on low regulatory exposure. Do you build an autonomous decision system?]
No. The gates veto autonomous use regardless of the weighted score: a high average cannot compensate for a failure mode you are not permitted, or not able, to absorb. Build it as an assistive tool with a person deciding, or not at all.
:::

:::qa[Build cost is ₹15,00,000 and the model saves ₹8 per decision. Volume is 10,000 decisions/month. Worth it?]
$V^* = 15{,}00{,}000 / 8 = 187{,}500$ decisions, i.e. 18.8 months at 10,000/month — longer than many models stay unchanged. Prefer rules or an API model unless volume will grow or the saving per decision is much larger.
:::

:::qa[In the fraud matrix, step-up abandonment cost doubles from ₹6 to ₹12. Where does the pass/step-up boundary move?]
$q^* = 12 / (8{,}000 - (1{,}600 - 12)) = 12/6{,}412 \approx 0.00187$. It doubles, from 0.094% to 0.187%: twice as many low-risk payments now pass without a challenge. The boundary is almost exactly proportional to the friction cost because the fraud-loss term dominates the denominator.
:::

:::qa[Why is a 1,000 : 1 cost ratio a sign the model should not be the decider?]
The threshold becomes $1/1001 \approx 0.001$, so the cheap action is allowed only above 99.9% confidence, and verifying a miss rate that low needs ≥ 3,000 cases with zero misses per subgroup (rule of three). In practice the model escalates nearly everything; its useful output is the ranking of the escalated queue.
:::

:::qa[A moderation model reaches high accuracy against user-report labels. What has it learned?]
To predict which items users report — a proxy that over-represents visible, popular or targeted content and under-represents violations nobody reports. Label a sample against the written policy and measure against that.
:::

Next: who may see, change and audit all of this — [§16 Security, privacy and governance](/c/practical-slm-decision-models/16-security-privacy-and-governance).
