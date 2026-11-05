---
section: "11"
title: "Evaluation and release gates"
kicker: "Evidence"
abstract: "Score a decision model by expected cost per case under the policy you will run, put a confidence interval on it, size the evaluation set to detect the difference you care about, and turn the results into a written release gate."
time: "30 min"
order: 11
outcomes:
  - "Compute precision, recall, specificity and FPR, and explain why none of them is the decision metric"
  - "Compute expected cost per case and show when the more accurate model is the worse product"
  - "Put a paired bootstrap confidence interval on a cost difference"
  - "Compute the evaluation-set size needed to detect a given improvement"
  - "Write a release gate with slice checks and decide ship / don't ship"
---

The loan pre-approval team has two candidates for the same policy. Model A, the incumbent, is right on 95.8% of a 10,000-application held-out set. Model B, the challenger, is right on 94.0%. A dashboard that ranks by accuracy ships A. This section shows why that would cost about ₹2.4 million per 10,000 applications, how sure we are of that figure, how large the test set has to be to trust it, and why B *still* should not ship as-is.

:::key[First principle]
The decision metric is the **expected cost per case of the policy you will actually run**, estimated on held-out data, with an interval around it. Accuracy, precision and recall are diagnostics: they explain *why* the cost is what it is, but they weigh every mistake the same, and your business does not.
:::

## 11.1 Four things an evaluation must answer

| Layer | Question | Typical measure | Where |
|---|---|---|---|
| Prediction | Does the model separate outcomes? | ROC-AUC, PR-AUC, confusion matrix | §11.2 |
| Probability | Do stated probabilities match frequencies? | Brier, log loss, reliability diagram | [§7](/c/practical-slm-decision-models/07-probabilities-and-calibration) |
| Decision | Does the policy minimise real cost? | $\hat R(\pi)$ with a CI, per slice | §11.3–11.7 |
| Operation | Does the service meet its limits? | p95 latency, invalid-output rate, cost/1k | [§13](/c/practical-slm-decision-models/13-serving-and-deployment) |

A model can win one layer and lose another. The release decision is made at the decision layer, subject to hard limits at the others.

## 11.2 The confusion matrix and its rates

Call the event we are trying to catch the **positive** class. For loans that is a *bad* applicant (one who will default), and the action that "flags" it is `decline`. Every case lands in one of four cells:

| | Actually bad (positive) | Actually good (negative) |
|---|---:|---:|
| **Declined** (flagged) | TP | FP — lost margin, ₹24,000 |
| **Approved** (not flagged) | FN — bad loan, ₹120,000 | TN |

Four rates summarise the matrix. Each conditions on a different row or column, which is why they answer different questions:

$$
\text{Precision} = \frac{TP}{TP+FP}
\qquad
\text{Recall} = \frac{TP}{TP+FN}
\qquad
\text{Specificity} = \frac{TN}{TN+FP}
\qquad
\text{FPR} = \frac{FP}{FP+TN} = 1 - \text{Specificity}
$$

- **Precision** — of the applicants we declined, what share were really bad?
- **Recall** (sensitivity, TPR) — of the bad applicants, what share did we decline?
- **Specificity** — of the good applicants, what share did we approve?
- **FPR** — of the good applicants, what share did we wrongly decline?

The costs in the table are the course's running example ([§4](/c/practical-slm-decision-models/04-decision-theory)). They fix the flagging rule before any model is trained: decline when $P(\text{bad}) > \frac{24{,}000}{24{,}000 + 120{,}000} = 0.167$, which is the same as approving only when $P(\text{good}) > 0.833$.

## 11.3 Expected cost per case is the decision metric

For a policy $\pi$ that maps an input to an action, and a cost $c(a, y)$ for taking action $a$ when the truth is $y$, the empirical risk on $N$ held-out cases is

$$
\hat R(\pi) = \frac{1}{N} \sum_{i=1}^{N} c\big(\pi(x_i),\, y_i\big)
= \frac{FN \cdot c_{FN} + FP \cdot c_{FP} + \#\text{reviews} \cdot c_{\text{review}}}{N}.
$$

The second form is the same sum grouped by confusion-matrix cell (correct actions cost zero here; add a review term if the policy has a review action). It is just an average, so it has a standard error and a confidence interval like any other average.

:::example[Worked example · the more accurate model costs more]
10,000 held-out applications, 1,000 bad and 9,000 good.

| | Model A (incumbent) | Model B (candidate) |
|---|---:|---:|
| TP / FN | 880 / **120** | 950 / **50** |
| FP / TN | **300** / 8,700 | **550** / 8,450 |
| Accuracy | **0.958** | 0.940 |
| Precision | **0.746** | 0.633 |
| Recall | 0.880 | **0.950** |
| Specificity / FPR | **0.9667** / 0.0333 | 0.9389 / 0.0611 |
| Cost: FN × ₹120,000 | ₹14.4M | ₹6.0M |
| Cost: FP × ₹24,000 | ₹7.2M | ₹13.2M |
| $\hat R(\pi)$ per case | ₹2,160 | **₹1,920** |

B makes 600 errors against A's 420, so it loses on accuracy. But B approves 70 fewer bad applicants (saving $70 \times 120{,}000 = ₹8.4$M) at the price of declining 250 more good ones (costing $250 \times 24{,}000 = ₹6.0$M). Net: B is ₹2.4M cheaper on these 10,000 cases, ₹240 per case.

For scale, the two no-model baselines: approving everyone costs $1{,}000 \times 120{,}000 / 10{,}000 = ₹12{,}000$ per case; declining everyone costs $9{,}000 \times 24{,}000 / 10{,}000 = ₹21{,}600$. Always report at least one trivial policy — it tells you how much the model is worth at all.
:::

Accuracy counts every error as 1. It agrees with cost only when $c_{FP} = c_{FN}$. Here one error type is five times dearer, so a model that trades one FN for up to five FPs is an improvement that accuracy calls a regression.

:::warn[Compare policies, not models]
$\hat R$ belongs to a *policy*: model + calibration + thresholds + review rule. Changing the threshold on the same model changes $\hat R$. When you compare candidates, compare each at its own cost-optimal threshold chosen on validation data, never at a shared default of 0.5.
:::

## 11.4 How sure are we? A paired bootstrap

A point estimate of ₹240 per case is not a decision. Per-case cost is ₹0 for 94–96% of applicants and ₹24,000 or ₹120,000 for the rest, so its standard deviation (₹13,617 for A) is six times its mean. Rare expensive cases dominate the uncertainty.

The bootstrap estimates the sampling distribution without a formula: resample the evaluation rows with replacement, recompute the metric, repeat, and read off percentiles. Two rules make it correct for model comparison:

1. **Pair.** Resample *the same rows* for both models in each replicate, and bootstrap the per-case difference $d_i = c_A(x_i) - c_B(x_i)$. Both models get the easy and the hard cases together, so shared difficulty cancels.
2. **Resample the independent unit.** If one customer contributes several rows, resample customers, not rows.

The code builds the 10,000-row evaluation set from the counts above. The pairing is an assumption stated in the `groups` table: of the 1,000 bad applicants, both models decline 880, only B declines 70, neither declines 50; of the 9,000 good ones, both decline 250, only A declines 50, only B declines 300. Applicants are also tagged with an employment segment for §11.7.

```python run
import numpy as np

C_BAD_APPROVE, C_GOOD_DECLINE = 120_000, 24_000
# (slice, count, is_bad, A declines?, B declines?)  -- 10,000 held-out applications
groups = [
    ("salaried", 390, 1, 1, 1), ("salaried", 40, 1, 0, 1), ("salaried", 20, 1, 0, 0),
    ("salaried", 150, 0, 1, 1), ("salaried", 20, 0, 1, 0), ("salaried", 120, 0, 0, 1),
    ("salaried", 5260, 0, 0, 0),
    ("self-emp", 307, 1, 1, 1), ("self-emp", 28, 1, 0, 1), ("self-emp", 15, 1, 0, 0),
    ("self-emp", 60, 0, 1, 1), ("self-emp", 10, 0, 1, 0), ("self-emp", 90, 0, 0, 1),
    ("self-emp", 2490, 0, 0, 0),
    ("new-to-credit", 183, 1, 1, 1), ("new-to-credit", 2, 1, 0, 1),
    ("new-to-credit", 15, 1, 0, 0), ("new-to-credit", 40, 0, 1, 1),
    ("new-to-credit", 20, 0, 1, 0), ("new-to-credit", 90, 0, 0, 1),
    ("new-to-credit", 650, 0, 0, 0),
]
sl = np.repeat([g[0] for g in groups], [g[1] for g in groups])
bad, dA, dB = (np.repeat([g[i] for g in groups], [g[1] for g in groups]) for i in (2, 3, 4))

def cost(declines):
    return np.where(declines == 1, (1 - bad) * C_GOOD_DECLINE, bad * C_BAD_APPROVE)

def report(dec, name):
    tp, fn = ((dec == 1) & (bad == 1)).sum(), ((dec == 0) & (bad == 1)).sum()
    fp, tn = ((dec == 1) & (bad == 0)).sum(), ((dec == 0) & (bad == 0)).sum()
    print(f"{name}: TP={tp} FN={fn} FP={fp} TN={tn} acc={(tp + tn) / len(bad):.3f} "
          f"prec={tp / (tp + fp):.3f} rec={tp / (tp + fn):.3f} "
          f"spec={tn / (tn + fp):.4f} FPR={fp / (fp + tn):.4f} R=₹{cost(dec).mean():,.0f}")

report(dA, "A"); report(dB, "B")
cA, cB = cost(dA), cost(dB)
d = cA - cB                                   # positive = candidate B is cheaper

rng = np.random.default_rng(11)
def boot(idx, reps=2000):
    m = len(idx)
    draws = idx[rng.integers(0, m, (reps, m))]
    return cA[draws].mean(1), cB[draws].mean(1), d[draws].mean(1)

bA, bB, bD = boot(np.arange(len(d)))
ci = lambda x: np.percentile(x, [2.5, 97.5])
for name, x, b in (("A", cA, bA), ("B", cB, bB), ("A-B", d, bD)):
    lo, hi = ci(b)
    print(f"{name:4s} ₹{x.mean():6,.0f}  95% CI [₹{lo:,.0f}, ₹{hi:,.0f}]")
print(f"P(B not cheaper) ~ {(bD <= 0).mean():.3f}   sd(d)=₹{d.std(ddof=1):,.0f}")

for s in ("salaried", "self-emp", "new-to-credit"):
    idx = np.flatnonzero(sl == s)
    _, _, bs = boot(idx)
    lo, hi = ci(bs)
    print(f"{s:14s} n={len(idx):5d} A=₹{cA[idx].mean():5,.0f} B=₹{cB[idx].mean():5,.0f} "
          f"A-B=₹{d[idx].mean():6,.0f} CI [₹{lo:,.0f}, ₹{hi:,.0f}]")
```

```output
A: TP=880 FN=120 FP=300 TN=8700 acc=0.958 prec=0.746 rec=0.880 spec=0.9667 FPR=0.0333 R=₹2,160
B: TP=950 FN=50 FP=550 TN=8450 acc=0.940 prec=0.633 rec=0.950 spec=0.9389 FPR=0.0611 R=₹1,920
A    ₹ 2,160  95% CI [₹1,896, ₹2,424]
B    ₹ 1,920  95% CI [₹1,728, ₹2,129]
A-B  ₹   240  95% CI [₹29, ₹449]
P(B not cheaper) ~ 0.015   sd(d)=₹10,996
salaried       n= 6000 A=₹1,880 B=₹1,480 A-B=₹   400 CI [₹136, ₹676]
self-emp       n= 3000 A=₹2,280 B=₹1,800 A-B=₹   480 CI [₹64, ₹944]
new-to-credit  n= 1000 A=₹3,480 B=₹4,920 A-B=₹-1,440 CI [₹-1,968, ₹-839]
```

:::chart[Expected cost per case with 95% bootstrap CI (10,000 cases)]{type="bar" y="₹ per case" prefix="₹" labels="true" ymin="0"}
policy, CI low, estimate, CI high
A (baseline), 1896, 2160, 2424
B (candidate), 1728, 1920, 2129
:::

Look at the two intervals: [₹1,896, ₹2,424] and [₹1,728, ₹2,129] overlap by more than half their width. Someone comparing them by eye would call it a tie. The **paired** interval for the difference, [₹29, ₹449], excludes zero. Pairing works because of the 720 applicants on whom at least one model errs, 300 are errors both models make; their cost is identical for A and B, cancels in $d_i$, and only the 420 disagreements remain.

:::chart[Bootstrap distribution of the paired difference A − B (2,000 replicates)]{type="area" x="₹ per case (positive = B cheaper; bin centres)" y="replicates" points="false" marks="0:no difference;29:2.5%;449:97.5%"}
diff, replicates
-75, 6
-25, 24
25, 57
75, 113
125, 201
175, 317
225, 390
275, 331
325, 275
375, 145
425, 91
475, 35
525, 10
575, 3
625, 1
675, 1
:::

:::warn[Overlapping CIs do not mean "no difference"]
Two separate 95% intervals can overlap substantially while the paired difference is clearly non-zero. Always compute the interval of the *difference* on the *same* cases.
:::

## 11.5 How many cases do we need?

The interval above only just excludes zero. Was 10,000 cases enough, or did we get lucky? For a paired comparison the standard error of the mean difference is $\sigma_d / \sqrt{n}$. To detect a true difference $\delta$ with a two-sided test at level $\alpha$ and power $1-\beta$:

$$
n = \frac{\big(z_{1-\alpha/2} + z_{1-\beta}\big)^2 \, \sigma_d^2}{\delta^2}.
$$

For an unpaired comparison (each model on its own sample) replace $\sigma_d^2$ with $\sigma_A^2 + \sigma_B^2$ and read $n$ as cases *per arm*.

:::example[Worked example · sizing the loan evaluation]
$\sigma_d = ₹10{,}996$, $\alpha = 0.05$, power $0.80$, so $(1.960 + 0.842)^2 = 7.849$.

$$
n = \frac{7.849 \times 10{,}996^2}{240^2} = \frac{7.849 \times 1.209 \times 10^8}{57{,}600} \approx 16{,}475 .
$$

With 10,000 cases the standard error is $10{,}996/\sqrt{10{,}000} = ₹110$, the effect is $240/110 = 2.18$ standard errors, and the power is $\Phi(2.18 - 1.96) = \Phi(0.22) \approx 59\%$. A study of this size misses a real ₹240 improvement about four times in ten. Halving the effect to detect quadruples $n$.
:::

```python run
from math import sqrt, ceil
from statistics import NormalDist, pstdev

z = NormalDist().inv_cdf
k = (z(0.975) + z(0.80)) ** 2                # alpha = 0.05 two-sided, power = 0.80

# per-case costs of the 10,000-case eval set (₹): only errors are non-zero
cA = [120_000] * 120 + [24_000] * 300 + [0] * 9_580
cB = [120_000] * 50 + [24_000] * 550 + [0] * 9_400
# paired difference A-B: 70 bads only B declined, 50 goods only A declined, 300 only B
d = [120_000] * 70 + [24_000] * 50 + [-24_000] * 300 + [0] * 9_580
sd_a, sd_b, sd_d = pstdev(cA), pstdev(cB), pstdev(d)
print(f"sd per case: A=₹{sd_a:,.0f}  B=₹{sd_b:,.0f}  paired diff=₹{sd_d:,.0f}")

for delta in (240, 100, 50):
    print(f"detect ₹{delta}/case: paired n = {ceil(k * sd_d**2 / delta**2):,}   "
          f"unpaired n per arm = {ceil(k * (sd_a**2 + sd_b**2) / delta**2):,}")
power = NormalDist().cdf(240 / (sd_d / sqrt(10_000)) - z(0.975))
print(f"power of the 10,000-case paired eval for ₹240: {power:.0%}")

def wilson(k_, n, conf=0.95):
    zz = z(0.5 + conf / 2)
    centre = (k_ + zz**2 / 2) / (n + zz**2)
    half = zz * sqrt(k_ * (n - k_) / n + zz**2 / 4) / (n + zz**2)
    return centre - half, centre + half

for name, k_, n in (("A", 120, 8820), ("B", 50, 8500), ("B new-to-credit", 15, 685)):
    lo, hi = wilson(k_, n)
    print(f"{name:16s} bad approvals {k_}/{n} = {k_ / n:.2%}  Wilson 95% [{lo:.2%}, {hi:.2%}]")
```

```output
sd per case: A=₹13,617  B=₹10,000  paired diff=₹10,996
detect ₹240/case: paired n = 16,475   unpaired n per arm = 38,892
detect ₹100/case: paired n = 94,895   unpaired n per arm = 224,014
detect ₹50/case: paired n = 379,580   unpaired n per arm = 896,054
power of the 10,000-case paired eval for ₹240: 59%
A                bad approvals 120/8820 = 1.36%  Wilson 95% [1.14%, 1.62%]
B                bad approvals 50/8500 = 0.59%  Wilson 95% [0.45%, 0.77%]
B new-to-credit  bad approvals 15/685 = 2.19%  Wilson 95% [1.33%, 3.58%]
```

:::chart[Cases needed to detect a cost difference (α = 0.05, power 0.8)]{type="line" x="difference to detect (₹ per case)" y="cases needed" ylog="true" yfmt="int" marks="240:observed ₹240" hmarks="10000:current eval set"}
delta, paired (same cases), unpaired (per arm)
50, 379579, 896053
75, 168702, 398246
100, 94895, 224013
150, 42175, 99561
200, 23724, 56003
240, 16475, 38891
300, 10544, 24890
400, 5931, 14001
500, 3796, 8961
:::

Practical rules from the curve:

- **Pairing is worth a lot of labels.** Unpaired needs 2.4× the cases per arm (38,892 vs 16,475), and 4.7× the labelled cases in total (two arms). Always evaluate candidate and baseline on the same cases; in production experiments, use a shadow comparison on the same traffic when you can.
- **Decide the minimum effect worth shipping before you look**, then size the set for it. If ₹100/case is the smallest improvement that justifies a migration, you need about 95,000 paired cases, not 10,000.
- **Labels are the bottleneck.** Loan outcomes take months to mature. If you can only label 10,000, say so in the gate: "able to detect ≥ ₹310/case with 80% power" ($7.849 \times 10{,}996^2 / 310^2 \approx 9{,}875 \le 10{,}000$).

## 11.6 Rates of rare, expensive errors

Some gates are about a rate, not an average — "bad approvals must be below 1% of approvals". For a proportion $\hat p = k/n$ use the Wilson interval, which stays inside [0, 1] and behaves near zero where the naive $\hat p \pm 1.96\sqrt{\hat p(1-\hat p)/n}$ does not:

$$
\frac{\hat p + \frac{z^2}{2n} \pm z\sqrt{\frac{\hat p(1-\hat p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}} .
$$

From the output above: B approves 50 bad applicants out of 8,500 approvals, 0.59% with a 95% upper bound of 0.77%. A gate of "upper bound ≤ 1.0%" passes. A's upper bound, 1.62%, would fail it.

:::tip[Gate on the bound, not the point estimate]
"Bad-approval rate ≤ 1%" on the point estimate passes a model that approved 3 bad loans out of 400 (0.75%) — whose Wilson upper bound is 2.2%. Gating on the upper bound makes small evaluation sets fail safe instead of passing by luck.
:::

## 11.7 Slice analysis: the average can hide a regression

An overall win is an average over segments. Re-run the same paired comparison per segment you care about — for lending, at least the segments in your credit policy and any legally protected attributes you are permitted and required to monitor.

:::chart[Paired cost difference A − B per segment with 95% CI (positive = B cheaper; n in brackets)]{type="bar" y="₹ per case" prefix="₹"}
segment, CI low, estimate, CI high
salaried (6000), 136, 400, 676
self-employed (3000), 64, 480, 944
new-to-credit (1000), -1968, -1440, -839
overall (10000), 29, 240, 449
:::

B is cheaper for salaried and self-employed applicants and **₹1,440 per case more expensive** for new-to-credit applicants, with an interval [₹−1,968, ₹−839] well clear of zero. Its bad-approval rate in that segment is 2.19% [1.33%, 3.58%] — the overall 0.59% hid it. With thin credit files B declines too many good applicants (130 of 800) while catching only 2 more bad ones.

Three rules keep slice analysis honest:

1. **Pre-register the slices** in the gate document. Searching 50 slices after the fact will find two or three "significant" regressions by chance at 95% confidence.
2. **Set a minimum slice size** (e.g. n ≥ 500) for a hard gate; smaller slices are reported, reviewed by a person, and fed into the next labelling round.
3. **A slice regression is a routing question, not just a veto.** Here, running B on salaried and self-employed applicants and keeping A on new-to-credit gives $(8.88\text{M} + 5.40\text{M} + 3.48\text{M}) / 10{,}000 = ₹1{,}776$ per case — better than either model alone. But that policy was chosen *by looking at the test set*, so it must be re-validated on fresh data before it ships.

## 11.8 Splits and calibration, briefly

The interval only means something if the evaluation set answers the deployment question.

- **Group split** when rows share a customer, device, document or incident; otherwise near-duplicates leak across train and test.
- **Time split** when the future differs from the past (always, in lending). Train on earlier applications, evaluate on later ones.
- **Three roles:** validation chooses prompts, thresholds and calibration; the test set is touched once after choices freeze; production shadow traffic watches for drift. Re-tuning on the test set turns it into a validation set and the interval into fiction.
- **Calibration** is checked with a proper scoring rule (Brier or log loss) plus a reliability diagram with bin counts ([§7](/c/practical-slm-decision-models/07-probabilities-and-calibration)). Thresholds derived from costs assume calibrated probabilities; an uncalibrated model at the "right" threshold is at the wrong one.

## 11.9 The release gate

Write the gate **before** running the evaluation, sign it, and apply it mechanically. The thresholds below are examples for this loan case, not universal values.

| # | Gate (example threshold) | Model B result | Verdict |
|---|---|---|---|
| 1 | Paired 95% CI of $\hat R_A - \hat R_B$ excludes zero | [₹29, ₹449] | pass |
| 2 | Point improvement ≥ ₹100/case (worth the migration) | ₹240 | pass |
| 3 | Bad-approval rate, Wilson upper bound ≤ 1.0% | 0.77% | pass |
| 4 | No pre-registered slice with n ≥ 500 worse with CI excluding zero | new-to-credit: −₹1,440 [−₹1,968, −₹839] | **fail** |
| 5 | Eval set has ≥ 80% power at the gate-2 effect size (₹100 → 94,895 cases) | 10,000 cases | **warn** |
| 6 | Brier score not worse than baseline; ECE ≤ 0.03 | not computed in this example | — |
| 7 | Invalid-output rate ≤ 0.1%; p95 latency ≤ 150 ms | measured in serving tests | — |
| 8 | Cost-optimal thresholds chosen on validation, not test | stated in the run log | — |

**Verdict: do not ship B as-is.** Gate 4 fails. The fix is to route new-to-credit applicants to A (or to review), validate that routed policy on fresh data, and re-run every gate on it. Gate 5 is a warning, not a failure: it says the evidence is thinner than the gate's own effect size requires, and the next labelling budget should go there.

Use the gate as a checklist in the release PR:

- [ ] Gate document written and signed before the run (costs, slices, thresholds, minimum effect)
- [ ] Evaluation set: time- or group-split, size and power stated
- [ ] $\hat R(\pi)$ for candidate, baseline and a trivial policy, each at its own validation-chosen threshold
- [ ] Paired bootstrap CI for the difference
- [ ] Wilson bounds for every rare-error rate in the gate
- [ ] Every pre-registered slice reported with n and CI
- [ ] Calibration (Brier/log loss + reliability diagram) and operational metrics attached
- [ ] Verdict recorded with the failing gate and the follow-up, if any

## 11.10 Check yourself

:::qa[Model C has TP=900, FN=100, FP=400, TN=8,600 on the same 10,000 cases. Compute its accuracy, precision, recall and cost per case. Does it beat B?]
Accuracy $= (900 + 8{,}600)/10{,}000 = 0.950$. Precision $= 900/1{,}300 = 0.692$. Recall $= 900/1{,}000 = 0.900$.
$\hat R = (100 \times 120{,}000 + 400 \times 24{,}000)/10{,}000 = (12.0\text{M} + 9.6\text{M})/10{,}000 = ₹2{,}160$.
C is more accurate than B (0.950 vs 0.940) but ₹240/case more expensive — exactly as expensive as A.
:::

:::qa[Separate 95% CIs for two models overlap. Your colleague concludes there is no difference. What do you do?]
Compute the interval of the paired per-case difference on the same cases. Shared easy and hard cases inflate each model's own interval but cancel in the difference; in §11.4 the separate intervals overlapped heavily while the paired interval was [₹29, ₹449].
:::

:::qa[With σ_d = ₹10,996, how many paired cases detect a ₹400/case improvement at α = 0.05 and 80% power?]
$n = 7.849 \times 10{,}996^2 / 400^2 = 7.849 \times 1.209 \times 10^8 / 160{,}000 \approx 5{,}931$.
:::

:::qa[A model approves 2 bad loans out of 300 approvals. Does it pass "bad-approval rate upper bound ≤ 1%"?]
Point estimate 0.67%, but the Wilson 95% upper bound is about 2.4%. It fails: 300 approvals cannot show a rate below 1% with confidence. Either gather more data or accept that the gate cannot pass yet.
:::

:::qa[Why is it not enough to fix the new-to-credit slice by picking a separate threshold on the test set and shipping?]
The threshold was selected using test outcomes, so the test estimate for the new policy is optimistically biased. Choose it on validation data, then measure it once on untouched data before shipping.
:::

Next: the tests that keep this policy correct after the gate passes — [Testing decision systems](/c/practical-slm-decision-models/12-testing-decision-systems).
