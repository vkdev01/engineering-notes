---
section: "A"
title: "Appendix A — decision review and mastery checklist"
kicker: "Mastery"
abstract: "A reviewer's template for any decision system before it ships, applied end to end to the 100,000-ticket routing proposal: the original arithmetic is checked and corrected, rules vs SLM + review vs a larger model vs a cascade are recomputed on the course's simulated workload, constraints are applied as hard gates, and a verdict is written. Closes with a worked self-assessment."
time: "30 min"
order: 21
outcomes:
  - "Run a decision review with a fixed question set and name the evidence each answer needs"
  - "Recompute a candidate comparison and catch double-counted review, untargeted review slices and missing candidates"
  - "Decide when human review pays for itself from the ratio of review cost to error cost"
  - "Apply latency, capacity and residency as hard gates before ranking on cost"
  - "Check your command of the course with worked problems on thresholds, calibration, sizing, sample size and drift"
---

A proposal lands for review: route 100,000 support tickets a month into four queues with a small model, send 5% of tickets to a person, and save most of the cost of the current keyword rules. It comes with a comparison table, a code snippet that reproduces it, and a conclusion. The arithmetic in the snippet is correct. The comparison is still wrong in three ways that change the decision — and a reviewer who asks a fixed set of questions finds all three in under an hour. This appendix gives the questions, then does the review.

:::key[First principle]
A decision review does not check whether the model is good; it checks whether **the comparison could have come out differently**. Every candidate must be priced with the same cost matrix, on the same cases, counting what each component actually removes — and only candidates that pass the hard constraints are ranked by cost.
:::

## A.1 The review template

Ask these in order. Each has an artifact that answers it and a red flag that means "stop and fix before going further".

| # | Area | Question | Evidence that answers it | Red flag |
|---:|---|---|---|---|
| 1 | Decision | What does each output *do*, and what is the safe fallback? | Closed action set incl. review/fallback ([§1](/c/practical-slm-decision-models/01-what-a-decision-model-is)) | "The model decides" with no action list |
| 2 | Costs | Who owns each cost, and is review priced at its full cost? | Signed cost matrix; review = salary + queue + SLA ([§4.4](/c/practical-slm-decision-models/04-decision-theory)) | Review priced at reviewer-minutes only |
| 3 | Thresholds | Are thresholds derived from the costs? | $p^*$, $[p_{lo}, p_{hi}]$, $r_{max}$, or the multi-class review rule | 0.5, or "looks right" |
| 4 | Baselines | What do rules, the incumbent and the best constant action cost on the same cases? | Same eval set, same cost matrix | Baseline from a different dataset or period |
| 5 | Candidates | Is a composed option (cascade, cost-based review) in the comparison? | At least one hybrid priced end to end ([§10](/c/practical-slm-decision-models/10-hybrid-architectures)) | Only single models compared |
| 6 | Selective slices | Is the reviewed or escalated slice measured separately? | Error rate *in* the slice; next-stage accuracy *on* the slice | Review assumed to fix a random sample; stage accuracy from a generic benchmark |
| 7 | Probabilities | Are the scores calibrated on a separate split? | Reliability diagram, ECE vs its noise floor ([§7](/c/practical-slm-decision-models/07-probabilities-and-calibration)) | Self-reported confidence; calibrated on the test set |
| 8 | Evidence | Is the evaluation big enough to separate the candidates? | Paired CIs; power at the minimum effect ([§11](/c/practical-slm-decision-models/11-evaluation-and-release-gates)) | Point estimates only |
| 9 | Capacity | Does review/escalation volume fit people and quotas? | Volume × share ÷ throughput vs headcount | A share with no headcount |
| 10 | Latency | Does every path meet its SLO at production load? | p95 per path at production $\lambda$ ([§13](/c/practical-slm-decision-models/13-serving-and-deployment), [§14](/c/practical-slm-decision-models/14-benchmarking-and-performance)) | Mean latency; idle benchmark |
| 11 | Hard constraints | Residency, privacy, permissions: pass/fail, not weighted? | Written sign-off | A residency issue "traded off" against cost |
| 12 | Sensitivity | Does the ranking survive the cost ratio being off by 2×? | Cost per case across a range of error costs | One-point estimate |
| 13 | Operations | Drift alarms, bundle versioning, rollback, owner? | PSI floor, bundle manifest, rollback test ([§19](/c/practical-slm-decision-models/19-troubleshooting-and-failure-modes)) | No named owner for disabling automation |

## A.2 The proposal as submitted

The original comparison (in dollars, illustrative planning assumptions): a wrong route costs $4 of rework; human review costs $0.60 per ticket.

| Candidate | Accuracy | Inference / ticket | Review | Misroutes / month | Total / month (as submitted) |
|---|---:|---:|---|---:|---:|
| Rules baseline | 82% | $0 | none | 18,000 | $72,000 |
| SLM + review | 92% | $0.001 | 5% of tickets | 8,000 | $35,100 |
| Larger model | 95% | $0.012 | none | 5,000 | $21,200 |

Its conclusion: the larger model is cheapest.

## A.3 Review findings

**Finding 1 — the SLM row double-counts.** It pays for 5,000 reviews ($3,000) *and* still charges all 8,000 SLM errors as misroutes, as if the people who reviewed those tickets routed them wrongly too. (Its footnote also calls 92% an "error rate"; it is the accuracy.) Even if the reviewed 5% were a random sample, review would remove \(5{,}000 \times 0.08 = 400\) errors: 7,600 misroutes and $30,400 + $100 + $3,000 = **$33,500**, not $35,100. The arithmetic was right; the model of what review does was not.

**Finding 2 — the reviewed slice is not random.** A confidence gate sends the *least confident* tickets to people, and those are where the errors are. On the course's simulated workload (below) the SLM is 92.9% accurate overall but only 46.3% accurate on its least-confident 5%. Review removes 2,687 errors, not 400. Assuming a random slice understates what review does — and, as finding 3 shows, can still lead to reviewing too much.

**Finding 3 — whether review pays depends on one ratio.** Sending a ticket with SLM confidence $s$ to a person (assumed correct) saves $(1 - s)\,C_{\text{err}}$ in expected rework and costs $c_{\text{review}}$. Review it only when

$$
(1 - s)\,C_{\text{err}} > c_{\text{review}} \quad\Longleftrightarrow\quad s < 1 - \frac{c_{\text{review}}}{C_{\text{err}}} .
$$

In the submitted dollars the ratio is \(0.60 / 4 = 0.15\): review every ticket with more than a 15% chance of being wrong, which the least-confident 5% (53.7% wrong) easily clears. In the course's rupee prices from [§10](/c/practical-slm-decision-models/10-hybrid-architectures) — a misroute costs ₹60 and a person costs ₹40 per ticket — the ratio is \(40/60 = 0.667\), and a fixed 5% review *loses* money. Same model, same slice, opposite answer: the review share is an output of the cost ratio, never an input.

**Finding 4 — a candidate is missing.** No cascade was priced. §10 showed an SLM → LLM cascade at threshold 0.92 beating both single models on this workload.

**Finding 5 — the prices disagree with the rest of the system.** The proposal's $0.012 larger-model call and $0.60 review are not the figures the serving and cascade designs use. The recomputation below uses the course's illustrative rupee prices throughout: rules ₹0.001, SLM ₹0.05, larger model ₹2.00, a person ₹40, a misroute ₹60.

## A.4 The comparison, recomputed

Same simulated workload as §10.4 (seed 10): 85% easy tickets, 15% ambiguous, calibrated SLM confidence, and a larger model whose accuracy falls where the SLM is unsure. Rules keep the proposal's 82%. Reviewers are assumed always right (optimistic, which favours review).

```python run
"""Ticket routing review: rules vs SLM + review vs larger model vs cascade (100,000 tickets/month)."""
import numpy as np

rng = np.random.default_rng(10)                       # the same simulated workload as section 10
n = 100_000
hard = rng.random(n) < 0.15
s = np.where(hard, rng.beta(4, 2, n), rng.beta(40, 1, n))    # SLM calibrated confidence
slm_ok = rng.random(n) < s
llm_ok = rng.random(n) < 0.70 + 0.28 * s
C_RULE, C_SLM, C_LLM, C_HUM, RULE_ACC = 0.001, 0.05, 2.00, 40.0, 0.82   # illustrative


def options(c_err):
    """Monthly (inference, review, misroutes) per option; reviewers assumed always right."""
    rev5 = s <= np.quantile(s, 0.05)                    # review the least confident 5%
    rev_opt = (1 - s) * c_err > C_HUM                   # review only when it pays
    ts = np.arange(0.50, 0.995, 0.005)
    esc = min((s < t for t in ts), key=lambda e: C_LLM * e.sum() + c_err * (
        (~e & ~slm_ok).sum() + (e & ~llm_ok).sum()))
    return {
        "rules only": (C_RULE * n, 0.0, n * (1 - RULE_ACC)),
        "SLM only": (C_SLM * n, 0.0, (~slm_ok).sum()),
        "SLM + 5% review": (C_SLM * n, C_HUM * rev5.sum(), (~rev5 & ~slm_ok).sum()),
        "SLM + review if (1-s)C>40": (C_SLM * n, C_HUM * rev_opt.sum(), (~rev_opt & ~slm_ok).sum()),
        "larger model only": (C_LLM * n, 0.0, (~llm_ok).sum()),
        "cascade SLM -> LLM": (C_SLM * n + C_LLM * esc.sum(), 0.0,
                               (~esc & ~slm_ok).sum() + (esc & ~llm_ok).sum()),
    }


rev5 = s <= np.quantile(s, 0.05)
print("accuracy: SLM %.3f, LLM %.3f | SLM error rate in its least-confident 5%%: %.3f"
      % (slm_ok.mean(), llm_ok.mean(), 1 - slm_ok[rev5].mean()))
print("reviews/month: 5%% rule %d, cost rule %d" % (rev5.sum(), ((1 - s) * 60 > C_HUM).sum()))
print("\n%-26s %7s %8s %9s %10s" % ("option, C_err = INR 60", "infer", "review", "misroutes", "total/mo"))
for name, (inf, rev, mis) in options(60.0).items():
    print("%-26s %7.0f %8.0f %9.0f %10.0f" % (name, inf, rev, mis, inf + rev + 60 * mis))
e = 1 - slm_ok[:2_000].mean()                          # a 2,000-ticket evaluation set
half = 1.96 * np.sqrt(e * (1 - e) / 2_000)
print("\nSLM error on 2,000 eval tickets: %.3f +/- %.3f -> +/- INR %.0f/month at C_err 60"
      % (e, half, half * 60 * n))
print("\nC_err  rules  SLM only  SLM+5%  SLM+rule  larger  cascade   (INR per ticket)")
for c in (20, 40, 60, 80, 120, 200):
    tot = [(i + r + c * m) / n for i, r, m in options(float(c)).values()]
    print("%5d " % c + " ".join("%8.2f" % t for t in tot))
```

```output
accuracy: SLM 0.929, LLM 0.961 | SLM error rate in its least-confident 5%: 0.537
reviews/month: 5% rule 5000, cost rule 694

option, C_err = INR 60       infer   review misroutes   total/mo
rules only                     100        0     18000    1080100
SLM only                      5000        0      7099     430940
SLM + 5% review               5000   200000      4412     469720
SLM + review if (1-s)C>40     5000    27760      6589     428100
larger model only           200000        0      3869     432140
cascade SLM -> LLM           39330        0      3630     257130

SLM error on 2,000 eval tickets: 0.070 +/- 0.011 -> +/- INR 67094/month at C_err 60

C_err  rules  SLM only  SLM+5%  SLM+rule  larger  cascade   (INR per ticket)
   20     3.60     1.47     2.93     1.47     2.77     1.08
   40     7.20     2.89     3.81     2.89     3.55     1.84
   60    10.80     4.31     4.70     4.28     4.32     2.57
   80    14.40     5.73     5.58     5.46     5.10     3.27
  120    21.60     8.57     7.34     7.24     6.64     4.65
  200    36.00    14.25    10.87     9.65     9.74     7.31
```

| Option (₹60 per misroute) | Inference / month | Review / month | Misroutes | Misroute cost | Total / month | People / month |
|---|---:|---:|---:|---:|---:|---:|
| Rules only | ₹100 | — | 18,000 | ₹1,080,000 | ₹1,080,100 | 0 |
| SLM only | ₹5,000 | — | 7,099 | ₹425,940 | ₹430,940 | 0 |
| SLM + 5% review (as proposed) | ₹5,000 | ₹200,000 | 4,412 | ₹264,720 | ₹469,720 | 5,000 |
| SLM + review when $(1-s)\,60 > 40$ | ₹5,000 | ₹27,760 | 6,589 | ₹395,340 | ₹428,100 | 694 |
| Larger model only | ₹200,000 | — | 3,869 | ₹232,140 | ₹432,140 | 0 |
| Cascade SLM → LLM ($t$ = 0.92) | ₹39,330 | — | 3,630 | ₹217,800 | **₹257,130** | 0 |

:::chart[Monthly cost by option and component — ₹60 per misroute, 100,000 tickets (simulated workload, illustrative prices)]{type="bar" stacked="true" y="₹ per month" prefix="₹"}
option, inference, review, misroutes
rules only, 100, 0, 1080000
SLM only, 5000, 0, 425940
SLM + 5% review, 5000, 200000, 264720
SLM + cost-rule review, 5000, 27760, 395340
larger model, 200000, 0, 232140
cascade, 39330, 0, 217800
:::

How to read it:

- **The fixed 5% review costs ₹38,780 a month more than no review** (₹469,720 vs ₹430,940). It removes \(7{,}099 - 4{,}412 = 2{,}687\) misroutes worth ₹161,220 at a price of ₹200,000. The least-confident 5% are wrong 53.7% of the time; review pays only above 66.7%.
- **The cost-rule review is almost free money, and small.** It reviews only 694 tickets (confidence below 1/3), removes 510 misroutes worth ₹30,600 for ₹27,760: a net ₹2,840 a month. At these prices people are for the genuinely unroutable, not for "low confidence".
- **"Larger model is cheapest" was wrong by omission.** Against the single-model options it ties the SLM (₹432,140 vs ₹430,940 — a 0.3% gap). The cascade costs ₹257,130, **40% less than either**, because it spends ₹2 only on the 17% of tickets where the larger model's accuracy gain is worth ₹2.
- **The evidence cannot separate the SLM from the larger model.** A 2,000-ticket evaluation measures the SLM's error rate to ±1.1 points — ±₹67,000 a month at ₹60 per misroute. The ₹1,200 difference between them is noise; the ₹174,000 gap to the cascade is not.

:::chart[Cost per ticket as the misroute cost changes (rules only: ₹3.60–₹36.00, off the chart)]{type="line" x="cost of one misroute C_err" y="₹ per ticket" prefix="₹" xprefix="₹" marks="60:§10 price;80:§15 price" dash="SLM + 5% review"}
C_err, SLM + 5% review, SLM + cost-rule review, larger model, cascade
20, 2.93, 1.47, 2.77, 1.08
40, 3.81, 2.89, 3.55, 1.84
60, 4.70, 4.28, 4.32, 2.57
80, 5.58, 5.46, 5.10, 3.27
120, 7.34, 7.24, 6.64, 4.65
200, 10.87, 9.65, 9.74, 7.31
:::

The sensitivity answers question 12 of the template. The cascade is cheapest at every misroute cost from ₹20 to ₹200 — a 10× range — so its ranking does not depend on getting $C_{\text{err}}$ exactly right. The order of the others does: below ₹60 the SLM beats the larger model; from ₹80 up the larger model wins; the fixed 5% review is never the best SLM option in this range.

## A.5 Constraints first, then the verdict

Cost ranks only the candidates that pass the hard gates. Applying the template's questions 9–11:

| Gate | Rules | SLM + cost-rule review | Larger model | Cascade |
|---|---|---|---|---|
| Capacity: people ≤ 1,500 tickets/month (§10) | pass (0) | pass (694) | pass (0) | pass (0) |
| Capacity: LLM quota ≤ 25,000 calls/month (§10.4, illustrative) | pass | pass | **fail** (100,000) | pass (17,165) |
| Latency: one overall p95 ≤ 200 ms | pass | pass | **fail** (~1.2 s per call) | **fail** — 17% escalation puts p95 on the LLM path ([§10.3](/c/practical-slm-decision-models/10-hybrid-architectures)) |
| Latency: per-path SLO (SLM path ≤ 80 ms, LLM path ≤ 2.5 s) | pass | pass | pass | pass |
| Residency: ticket text may leave the region | pass | pass | depends on provider | depends on provider |

The latency and residency rows are where the decision is actually made, and they are product and legal decisions, not ML ones. The written verdict:

:::example[Worked example · the review verdict]
**Do not ship the proposal as submitted.** Its SLM row double-counts review (finding 1), its review share is not derived from costs (finding 3), and it omits the cheapest candidate (finding 4).

**Recommended:** the SLM → LLM cascade at $t = 0.92$, ₹257,130 a month against ₹1,080,100 for the current rules (−76%), **conditional on** (a) per-path latency SLOs being accepted by the product owner, (b) residency sign-off for sending about 17% of tickets to the larger model, (c) the larger model being evaluated on *escalated* tickets, not a generic benchmark ([§10.5](/c/practical-slm-decision-models/10-hybrid-architectures)), and (d) an escalation budget with an alarm on the wanted share.

**Fallback if (a) or (b) fails:** SLM with cost-rule review, ₹428,100 a month (−60% vs rules), 694 tickets a month to people.

**Before either ships:** a group- and time-split evaluation large enough to measure the cascade's misroute rate, calibration of the SLM's confidence on a separate split, and a canary sized to the regression worth catching ([§12](/c/practical-slm-decision-models/12-testing-decision-systems)).
:::

:::warn[What this review did not settle]
Every price here is illustrative, the workload is simulated, and reviewers were assumed perfect. The review's job was to get the **structure** of the comparison right — same costs, slice-specific accuracies, derived review rule, a composed candidate, hard gates first. With real prices the numbers change; with the structure right, the decision process does not.
:::

## A.6 Mastery self-assessment

Answer each before opening it. If more than two surprise you, revisit the linked section.

:::qa[1 · Loan costs are ₹120,000 (bad approval) and ₹24,000 (declined good). Review is priced honestly at ₹3,000. Derive the policy.]
Approve when $p \ge p_{hi} = 1 - 3{,}000/120{,}000 = 0.975$; decline when $p < p_{lo} = 3{,}000/24{,}000 = 0.125$; review in between. Without review the cut is $p^* = 120{,}000/144{,}000 = 0.833$. On §4.4's score distribution this review band holds 58.6% of cases — convert that to headcount before shipping. ([§4](/c/practical-slm-decision-models/04-decision-theory))
:::

:::qa[2 · After int4 quantisation the model's AUC is unchanged but cost per case at 0.833 rose. What happened, and what is the fix?]
Quantisation rescaled the logits, so the probabilities moved while the ranking did not. The threshold 0.833 is correct only for calibrated probabilities. Refit the calibrator (temperature first) on the calibration split, re-check cost at threshold, and ship model and calibrator as one bundle. ([§7.4](/c/practical-slm-decision-models/07-probabilities-and-calibration), [§13.9](/c/practical-slm-decision-models/13-serving-and-deployment))
:::

:::qa[3 · In the ticket cascade, a misroute is repriced from ₹60 to ₹80. The larger model costs ₹2 and is 96.1% accurate. New escalation threshold?]
$t = a - c_L / C_{\text{err}} = 0.961 - 2/80 = 0.961 - 0.025 = 0.936$, up from 0.928: a dearer misroute makes escalation worth buying on slightly more confident tickets. ([§10.4](/c/practical-slm-decision-models/10-hybrid-architectures))
:::

:::qa[4 · A Qwen2.5-1.5B in int8 must answer a 600-token prompt with 8 output tokens within 300 ms on the illustrative CPU (50 GB/s, 1 TFLOP/s). Does it fit a 4 GB container, and does it meet the budget?]
Memory: 1.54 GB of weights plus about 17 MB of KV cache fits 4 GB. Latency: prefill $2 \times 1.544 \times 10^9 \times 600 / 10^{12} = 1.85$ s, decode $8 \times 31.5$ ms = 0.25 s, a 2.1 s floor — seven times over budget. On the illustrative GPU the floor is 79 ms; or shrink the prompt and model. ([§3](/c/practical-slm-decision-models/03-slm-fundamentals))
:::

:::qa[5 · Peak traffic is 120 req/s, service time 25 ms, target utilisation 70%. How many replicas?]
Busy servers $L = \lambda S = 120 \times 0.025 = 3.0$; replicas $= \lceil 3.0/0.7 \rceil = \lceil 4.29 \rceil = 5$, plus one if a replica failure at peak must be survivable. ([§13.3](/c/practical-slm-decision-models/13-serving-and-deployment))
:::

:::qa[6 · The smallest improvement worth a migration is ₹100 per case, and the paired cost difference has σ_d = ₹10,996. How many labelled cases?]
$n = 7.849 \times 10{,}996^2 / 100^2 \approx 94{,}895$ paired cases (unpaired would need about 224,000 per arm). A 10,000-case set cannot support that gate. ([§11.5](/c/practical-slm-decision-models/11-evaluation-and-release-gates))
:::

:::qa[7 · A model has belief-error regret ₹326 per case and constraint regret ₹1,859 under a 25% review cap. Where should the next quarter's effort go?]
To the cap, not the model: even a perfect model would keep the ₹1,859 of constraint regret, so the decision belongs to whoever owns review capacity. Bring them the number; meanwhile rank model candidates on belief error, uncapped. ([§4.6](/c/practical-slm-decision-models/04-decision-theory))
:::

:::qa[8 · Your reference window has 50,000 scores and weekly windows have 2,000, over 10 bins. Where should the PSI alarm sit?]
The no-drift floor is $9 \times (1/50{,}000 + 1/2{,}000) = 9 \times 0.00052 = 0.0047$. Set the alarm at the 99th percentile of PSI from simulated or historical no-drift weeks at these sizes — a small multiple of 0.0047, nowhere near the folklore 0.1. ([§19.3](/c/practical-slm-decision-models/19-troubleshooting-and-failure-modes))
:::

:::qa[9 · A ₹250 second signal is offered for every loan case. When is it worth buying?]
Only for cases whose prior sits near a cut point, where some signal outcome can push the posterior across $p_{lo}$ or $p_{hi}$. Where no outcome can change the action, EVSI is exactly −₹250. At $p = 0.90$ with a 90%-accurate signal and ₹3,000 review it is worth ₹1,010 per case. ([§4.7](/c/practical-slm-decision-models/04-decision-theory))
:::

## A.7 Release readiness

Tick what your system can show evidence for today:

:::exercise[Exercise A.1 · Decision release readiness]{id="checklist" items="Cost matrix signed, review priced at full cost;Thresholds and review rule derived from the costs;Baselines and a composed candidate priced on the same cases;Reviewed and escalated slices measured separately;Calibrated on a separate split with reliability diagram;Paired CIs with power at the minimum effect;Capacity and quotas checked against volume;p95 per path at production load;Residency and permissions signed off as hard gates;Ranking survives a 2x error in the cost ratio;PSI alarm set from the no-drift floor;Bundle rollback tested with a named owner" grades="A,B,C,D,F"}
:::

**Completion criterion:** you can defend a decision system with a cost matrix someone signed, a comparison in which every candidate is priced the same way, the constraints that removed the others, and the evidence size that makes the difference real — not with a benchmark score or a preference for small models.

Back to the [engineering reference](/c/practical-slm-decision-models/20-engineering-reference-and-review) for every formula used above.
