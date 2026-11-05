---
section: "14"
title: "Notebook: evaluation metrics"
kicker: "Notebook"
abstract: "Seven runnable cells that take two loan-triage models from confusion matrix to a signed release verdict: precision/recall, ECE and Brier, cost per case, paired bootstrap, slices and a mechanical gate."
time: "18 min"
order: 14
outcomes:
  - "Compute a confusion matrix and its rates with the positive class stated"
  - "Separate calibration (ECE, reliability) from discrimination (Brier) and know which one a fix touches"
  - "Report cost per case with a paired bootstrap CI and a Wilson bound on rare errors"
  - "Run a pre-written release gate mechanically, including slices and a power check"
---

An incumbent loan-triage model **A** (logistic regression) and a candidate **B** (gradient-boosted trees) both score $p = P(\text{good})$ for 12,000 held-out applications. Both are isotonic-calibrated on a slice neither model trained on, and both run the same two-action policy: approve when $p \ge 0.833$, otherwise decline. Is B better, by how much, for whom, and does it pass the gate? This notebook is the runnable path through the deep course's [evaluation and release gates](/c/practical-slm-decision-models/11-evaluation-and-release-gates).

:::key[First principle]
The decision metric is the **expected cost per case of the policy you will run**, with a paired interval. Confusion-matrix rates and calibration explain *why* the cost is what it is; a gate written before the run decides whether it ships.
:::

**Setup.** numpy + scikit-learn; the cells share one session — run them top to bottom. The data are a synthetic stand-in for 30,000 applications (~80% repay), split 12,000 train / 6,000 calibration / 12,000 test. A random 10% are tagged *new-to-credit* and have two bureau features missing (imputed as 0) — a thin-file segment to slice on. Levels are illustrative; the method is the point. Costs are the course's running example: approving a bad case ₹120,000, declining a good one ₹24,000.

## 14.1 Cell 1 · Data and two calibrated models

```python run
import numpy as np
from sklearn.datasets import make_classification
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

X, y = make_classification(n_samples=30_000, n_features=20, n_informative=6, weights=[0.2, 0.8],
                           flip_y=0.02, class_sep=1.0, shuffle=False, random_state=1)  # y = 1: good
order = np.random.default_rng(1).permutation(len(y))   # shuffle=False keeps informative columns first
X, y = X[order], y[order]
seg = np.random.default_rng(2).choice(["salaried", "self-employed", "new-to-credit"], len(y), p=[0.6, 0.3, 0.1])
X[seg == "new-to-credit", :2] = 0.0             # thin file: two bureau features missing, imputed 0
tr, cal, te = slice(0, 12_000), slice(12_000, 18_000), slice(18_000, None)
yt, bad, seg = y[te], 1 - y[te], seg[te]        # positive class for the confusion matrix = bad


def fit_calibrated(model):
    model.fit(X[tr], y[tr])
    iso = IsotonicRegression(out_of_bounds="clip").fit(model.predict_proba(X[cal])[:, 1], y[cal])
    return model.predict_proba(X[te])[:, 1], iso.predict(model.predict_proba(X[te])[:, 1])


rawA, pA = fit_calibrated(LogisticRegression(max_iter=1_000))              # incumbent A
rawB, pB = fit_calibrated(HistGradientBoostingClassifier(random_state=0))  # candidate B
P_STAR = 120_000 / (120_000 + 24_000)           # approve if P(good) >= 0.833, else decline
decA, decB = (pA < P_STAR).astype(int), (pB < P_STAR).astype(int)   # 1 = decline (flag as bad)
print(f"test {len(yt):,} cases, bad rate {bad.mean():.3f}; segments:",
      {s: int((seg == s).sum()) for s in ("salaried", "self-employed", "new-to-credit")})
```

```output
test 12,000 cases, bad rate 0.205; segments: {'salaried': 7193, 'self-employed': 3606, 'new-to-credit': 1201}
```

The threshold comes from the costs, not from the models: approve when $p \ge 120{,}000 / 144{,}000 = 0.833$ ([derivation](/c/practical-slm-decision-models/04-decision-theory)).

## 14.2 Cell 2 · Confusion matrix, precision and recall

State the positive class first. Here it is a **bad** applicant, and the flagging action is `decline`:

| | Actually bad (positive) | Actually good |
| --- | ---: | ---: |
| **Declined** | TP | FP — lost margin, ₹24,000 |
| **Approved** | FN — bad loan, ₹120,000 | TN |

$$
\text{Precision} = \frac{TP}{TP + FP} \qquad \text{Recall} = \frac{TP}{TP + FN} \qquad \text{Specificity} = \frac{TN}{TN + FP}
$$

```python run
def confusion(dec, pos=bad):
    tp, fn = int(((dec == 1) & (pos == 1)).sum()), int(((dec == 0) & (pos == 1)).sum())
    fp, tn = int(((dec == 1) & (pos == 0)).sum()), int(((dec == 0) & (pos == 0)).sum())
    return tp, fn, fp, tn


for name, dec in (("A", decA), ("B", decB)):
    tp, fn, fp, tn = confusion(dec)
    print(f"{name}: TP={tp} FN={fn} FP={fp} TN={tn}  acc={(tp + tn) / len(dec):.3f} "
          f"precision={tp / (tp + fp):.3f} recall={tp / (tp + fn):.3f} "
          f"specificity={tn / (tn + fp):.3f} decline rate={dec.mean():.3f}")
```

```output
A: TP=2214 FN=246 FP=1012 TN=8528  acc=0.895 precision=0.686 recall=0.900 specificity=0.894 decline rate=0.269
B: TP=2256 FN=204 FP=342 TN=9198  acc=0.955 precision=0.868 recall=0.917 specificity=0.964 decline rate=0.216
```

B wins every rate here: it catches 2,256 of 2,460 bad applicants (recall 0.917 vs 0.900) while declining 670 fewer good ones (FP 342 vs 1,012), so its precision jumps from 0.686 to 0.868. When candidates trade one error for the other the rates disagree, and only cost can rank them — see the deep course's worked example where the *less* accurate model is ₹240 per case cheaper.

## 14.3 Cell 3 · Calibration: ECE and Brier

- **ECE** — bin cases by predicted $p$, then average $|\text{mean } p - \text{observed rate}|$ weighted by bin size. Measures calibration only.
- **Brier** — $\frac{1}{N}\sum (p_i - y_i)^2$. A proper score: it rewards calibration *and* discrimination, so a lower Brier can come from either.

```python run
def brier(p, y):
    return np.mean((p - y) ** 2)


def reliability(p, y, bins=10):
    """Rows (bin mean predicted, observed rate, count) for non-empty equal-width bins."""
    b = np.minimum((p * bins).astype(int), bins - 1)
    return [(p[b == k].mean(), y[b == k].mean(), int((b == k).sum())) for k in np.unique(b)]


def ece(p, y, bins=10):
    return sum(abs(m - o) * n for m, o, n in reliability(p, y, bins)) / len(p)


for name, p in (("A raw", rawA), ("A isotonic", pA), ("B raw", rawB), ("B isotonic", pB)):
    print(f"{name:10s} ECE {ece(p, yt):.3f}  Brier {brier(p, yt):.4f}  "
          f"(base-rate-only Brier {brier(np.full(len(yt), yt.mean()), yt):.4f})")
    print("   bins (pred -> observed, n):",
          "  ".join(f"{m:.2f}->{o:.2f}({n})" for m, o, n in reliability(p, yt)))
```

```output
A raw      ECE 0.018  Brier 0.0585  (base-rate-only Brier 0.1630)
   bins (pred -> observed, n): 0.04->0.05(933)  0.15->0.11(388)  0.25->0.13(281)  0.35->0.26(251)  0.45->0.32(234)  0.55->0.49(267)  0.65->0.64(351)  0.75->0.75(488)  0.86->0.91(1174)  0.98->0.98(7633)
A isotonic ECE 0.008  Brier 0.0576  (base-rate-only Brier 0.1630)
   bins (pred -> observed, n): 0.05->0.05(1124)  0.17->0.13(396)  0.21->0.00(1)  0.30->0.23(410)  0.41->0.39(158)  0.55->0.49(279)  0.68->0.67(517)  0.77->0.77(334)  0.89->0.91(555)  0.98->0.98(8226)
B raw      ECE 0.003  Brier 0.0325  (base-rate-only Brier 0.1630)
   bins (pred -> observed, n): 0.03->0.03(1813)  0.14->0.11(245)  0.25->0.22(121)  0.35->0.44(84)  0.45->0.51(93)  0.55->0.57(79)  0.65->0.65(98)  0.76->0.71(128)  0.86->0.85(283)  0.98->0.98(9056)
B isotonic ECE 0.004  Brier 0.0326  (base-rate-only Brier 0.1630)
   bins (pred -> observed, n): 0.03->0.03(1902)  0.14->0.10(115)  0.25->0.18(138)  0.35->0.39(113)  0.49->1.00(1)  0.51->0.54(119)  0.64->0.62(197)  0.72->0.77(13)  0.87->0.82(238)  0.98->0.98(9164)
```

:::chart[Reliability on 12,000 test cases: A raw vs B calibrated]{type="line" x="mean predicted P(good) in bin" y="observed repayment rate" diag="true" xmin="0" xmax="1" ymin="0" ymax="1" xfmt="dec1" yfmt="dec1" note="Equal-width bins; bins with fewer than 20 cases omitted. On the diagonal = calibrated."}
predicted, A raw, B isotonic
0.033, -, 0.034
0.038, 0.048, -
0.144, -, 0.104
0.146, 0.106, -
0.251, 0.132, -
0.252, -, 0.181
0.349, 0.259, -
0.354, -, 0.389
0.452, 0.325, -
0.509, -, 0.538
0.550, 0.487, -
0.642, -, 0.619
0.651, 0.641, -
0.753, 0.754, -
0.856, 0.910, -
0.870, -, 0.819
0.977, 0.981, -
0.983, -, 0.982
:::

- **A raw is overconfident in the middle.** Cases it scores 0.25 repay at 0.13; at 0.45 they repay at 0.33. Isotonic calibration cuts its ECE from 0.018 to 0.008 — but barely moves its Brier (0.0585 → 0.0576), because calibration cannot add discrimination.
- **B's lower Brier (0.0326) is discrimination.** B was already calibrated (raw ECE 0.003); isotonic regression changed nothing useful (0.004) and added plateau noise — note the 1-case bin at 0.49. Calibrating a calibrated model is harmless but not free; check the raw ECE first.
- Read reliability **with counts**. 9,164 of B's 12,000 cases sit in the top bin; the mid-range bins hold ~100–200 each, which is where the 0.833 threshold lives and where the evidence is thinnest.

## 14.4 Cell 4 · Cost per case

$$
\hat R(\pi) = \frac{FN \cdot 120{,}000 + FP \cdot 24{,}000}{N}
$$

```python run
C_BAD_APPROVE, C_GOOD_DECLINE = 120_000, 24_000   # INR


def case_cost(dec):
    """Per-case INR: declining a good case loses margin; approving a bad one loses the loan."""
    return np.where(dec == 1, (1 - bad) * C_GOOD_DECLINE, bad * C_BAD_APPROVE).astype(float)


cA, cB = case_cost(decA), case_cost(decB)
rows = {"always approve": np.zeros(len(yt), int), "always decline": np.ones(len(yt), int),
        "A at p*": decA, "B at p*": decB, "B at 0.5": (pB < 0.5).astype(int)}
for name, dec in rows.items():
    tp, fn, fp, tn = confusion(dec)
    print(f"{name:15s} INR {case_cost(dec).mean():6,.0f}/case = FN {fn:4d} x 120,000 + FP {fp:4d} x 24,000 "
          f"over {len(yt):,}   acc {(tp + tn) / len(yt):.3f}")
```

```output
always approve  INR 24,600/case = FN 2460 x 120,000 + FP    0 x 24,000 over 12,000   acc 0.795
always decline  INR 19,080/case = FN    0 x 120,000 + FP 9540 x 24,000 over 12,000   acc 0.205
A at p*         INR  4,484/case = FN  246 x 120,000 + FP 1012 x 24,000 over 12,000   acc 0.895
B at p*         INR  2,724/case = FN  204 x 120,000 + FP  342 x 24,000 over 12,000   acc 0.955
B at 0.5        INR  3,662/case = FN  337 x 120,000 + FP  146 x 24,000 over 12,000   acc 0.960
```

- **Trivial policies set the bar.** Declining everyone costs ₹19,080 per case; approving everyone ₹24,600. A model's value is measured against the cheaper of the two.
- **B at p\* costs ₹2,724; A at p\* ₹4,484.** That ₹1,760 is what the swap is worth — about ₹17.6 crore a month at 100,000 applications, if it holds.
- **Accuracy points the wrong way at the threshold.** B at 0.5 is *more* accurate (0.960 vs 0.955) and ₹938 per case *dearer*: it approves 133 more bad applicants (₹120,000 each) to decline 196 fewer good ones (₹24,000 each).

## 14.5 Cell 5 · Paired bootstrap CI and a Wilson bound

Per-case cost is ₹0 for most applicants and ₹24,000 or ₹120,000 for the rest, so rare cases dominate the uncertainty. Bootstrap the per-case **difference** $d_i = c_A(x_i) - c_B(x_i)$ on resampled rows, and put a Wilson interval on the rate of the rare, expensive error.

```python run
from statistics import NormalDist

rng = np.random.default_rng(11)
d = cA - cB                                     # positive = candidate B is cheaper
IDX = rng.integers(0, len(d), (2_000, len(d)))  # paired: the same resampled rows for A and B
ci = lambda x: np.percentile(x, [2.5, 97.5])
for name, x in (("A", cA), ("B", cB), ("A-B", d)):
    lo, hi = ci(x[IDX].mean(1))
    print(f"{name:3s} INR {x.mean():6,.0f}  95% CI [{lo:,.0f}, {hi:,.0f}]")
print(f"P(B not cheaper) ~ {(d[IDX].mean(1) <= 0).mean():.3f}; sd(d) = INR {d.std(ddof=1):,.0f}")


def wilson(k, n, z=1.96):
    c = (k + z * z / 2) / (n + z * z)
    h = z * np.sqrt(k * (n - k) / n + z * z / 4) / (n + z * z)
    return c - h, c + h


for name, dec in (("A", decA), ("B", decB)):
    k, n = int(((dec == 0) & (bad == 1)).sum()), int((dec == 0).sum())
    lo, hi = wilson(k, n)
    print(f"{name} bad approvals {k}/{n} = {k / n:.2%}  Wilson 95% [{lo:.2%}, {hi:.2%}]")
z = NormalDist().inv_cdf
n100 = (z(0.975) + z(0.80)) ** 2 * d.std(ddof=1) ** 2 / 100 ** 2
print(f"paired cases needed to detect INR 100/case at 80% power: {n100:,.0f}")
```

```output
A   INR  4,484  95% CI [4,170, 4,818]
B   INR  2,724  95% CI [2,442, 3,018]
A-B INR  1,760  95% CI [1,504, 2,020]
P(B not cheaper) ~ 0.000; sd(d) = INR 14,144
A bad approvals 246/8774 = 2.80%  Wilson 95% [2.48%, 3.17%]
B bad approvals 204/9402 = 2.17%  Wilson 95% [1.89%, 2.48%]
paired cases needed to detect INR 100/case at 80% power: 157,021
```

- The paired interval for A − B is [₹1,504, ₹2,020]: B is cheaper with no replicate disagreeing.
- B approves 204 bad applicants out of 9,402 approvals: 2.17%, upper bound **2.48%**. Gate on the bound, not the point estimate — a small set then fails safe instead of passing by luck.
- Power runs the other way. The per-case difference has $\sigma_d$ = ₹14,144, so detecting a ₹100 improvement at 80% power needs \(7.849 \times 14{,}144^2 / 100^2\) ≈ 157,021 paired cases. Twelve thousand cases can only reliably detect differences of about ₹362 ([sizing derivation](/c/practical-slm-decision-models/11-evaluation-and-release-gates)).

## 14.6 Cell 6 · Slice table

An overall win is an average over segments. Re-run the paired comparison per **pre-registered** segment.

```python run
SLICES = ("salaried", "self-employed", "new-to-credit")
print(f"{'segment':14s} {'n':>5s} {'bad':>6s} {'A INR':>7s} {'B INR':>7s} {'A-B':>7s}  95% CI")
slice_ci = {}
for s in SLICES:
    i = np.flatnonzero(seg == s)
    boot = d[i][rng.integers(0, len(i), (2_000, len(i)))].mean(1)
    slice_ci[s] = (len(i), d[i].mean(), *ci(boot))
    print(f"{s:14s} {len(i):5d} {bad[i].mean():6.3f} {cA[i].mean():7,.0f} {cB[i].mean():7,.0f} "
          f"{d[i].mean():7,.0f}  [{slice_ci[s][2]:,.0f}, {slice_ci[s][3]:,.0f}]")
```

```output
segment            n    bad   A INR   B INR     A-B  95% CI
salaried        7193  0.207   4,561   2,649   1,912  [1,588, 2,249]
self-employed   3606  0.202   4,173   2,576   1,597  [1,151, 2,043]
new-to-credit   1201  0.203   4,956   3,617   1,339  [460, 2,199]
```

B is cheaper in every segment, but new-to-credit shows the smallest gain (₹1,339) and the widest interval [₹460, ₹2,199]: with two bureau features missing, B's cost there is ₹3,617 against ₹2,649 for salaried applicants at the same 20% bad rate. Nothing fails, but that segment is where the next labelling budget should go. With 1,201 cases its interval is about 2.6 times wider than the salaried one; slices below a minimum size (say n < 500) should be reported and reviewed, not gated.

## 14.7 Cell 7 · The release gate

Write the gate before the run, sign it, apply it mechanically. The thresholds below are examples for this synthetic book; hard gates block, the power check warns.

```python run
lo, hi = ci(d[IDX].mean(1))
kB, nB = int(((decB == 0) & (bad == 1)).sum()), int((decB == 0).sum())
worse = [s for s, (n, m, l, h) in slice_ci.items() if n >= 500 and h < 0]
GATES = [   # (gate, hard?, passed, value) -- written before the run; example thresholds
    ("paired 95% CI of A-B excludes 0", True, lo > 0, f"[{lo:,.0f}, {hi:,.0f}]"),
    ("improvement >= INR 100/case", True, d.mean() >= 100, f"{d.mean():,.0f}"),
    ("bad approvals: Wilson upper <= 2.5%", True, wilson(kB, nB)[1] <= 0.025, f"{wilson(kB, nB)[1]:.2%}"),
    ("no slice (n >= 500) worse, CI < 0", True, not worse, ", ".join(worse) or "none"),
    ("ECE <= 0.03 and Brier <= incumbent", True, ece(pB, yt) <= 0.03 and brier(pB, yt) <= brier(pA, yt),
     f"ECE {ece(pB, yt):.3f}; Brier {brier(pB, yt):.4f} vs {brier(pA, yt):.4f}"),
    ("eval size gives 80% power at INR 100", False, len(d) >= n100, f"{len(d):,} vs {n100:,.0f} needed"),
]
for i, (gate, hard, ok, value) in enumerate(GATES, 1):
    print(f"{i}. {'PASS' if ok else 'FAIL' if hard else 'WARN'}  {gate:37s} {value}")
print("verdict:", "ship B" if all(ok for _, hard, ok, _ in GATES if hard) else "do not ship B as-is")
```

```output
1. PASS  paired 95% CI of A-B excludes 0       [1,504, 2,020]
2. PASS  improvement >= INR 100/case           1,760
3. PASS  bad approvals: Wilson upper <= 2.5%   2.48%
4. PASS  no slice (n >= 500) worse, CI < 0     none
5. PASS  ECE <= 0.03 and Brier <= incumbent    ECE 0.004; Brier 0.0326 vs 0.0576
6. WARN  eval size gives 80% power at INR 100  12,000 vs 157,021 needed
verdict: ship B
```

**Verdict: ship B.** Two things go in the release note. Gate 3 passed by 0.02 points (2.48% vs 2.5%) — a small shift in applicant mix would fail it, so put the bad-approval bound on the monitoring dashboard. Gate 6 warns that the set cannot see ₹100 effects; that is acceptable for a ₹1,760 change and would not be for a ₹150 one.

:::warn[Common ways to fool yourself]
Tuning the threshold or calibrator on the test set (it becomes a validation set and the CI becomes fiction). Comparing two unpaired intervals by eye. Searching 50 slices after the fact and reporting the two "significant" ones. Gating on a point estimate of a rare error rate.
:::

## 14.8 Exercises

:::exercise[Exercise 14.1 · Release-gate pre-flight]{id="checklist" items="Positive class and costs written in the gate document;Thresholds and calibrators fit on validation only;Trivial policies reported next to the candidate;Paired bootstrap CI of the cost difference;Wilson bound for every rare-error gate;Slices pre-registered with a minimum size;Power stated for the smallest effect worth shipping"}
:::

1. **Thinner files.** In Cell 1 blank four bureau features (`:4`) for new-to-credit. Re-run Cells 6–7: does gate 4 still pass?
2. **Tighter gate.** Change gate 3 to 2.0%. Which model, if any, could pass it on 12,000 cases?
3. **Wrong threshold.** Run the gate with B at 0.5 (`decB = (pB < 0.5).astype(int)`). Which gates move?
4. **Half the data.** Use `te = slice(18_000, 24_000)`. Predict how much the A − B interval widens ($\approx\sqrt{2}$) before running.

## 14.9 Check yourself

:::qa[B at 0.5 is more accurate than B at 0.833. Why is it dearer?]
At 0.5 it approves 133 more bad applicants and declines 196 fewer good ones: \(133 \times 120{,}000 - 196 \times 24{,}000\) = ₹11.26M more on 12,000 cases, ₹938 per case. Accuracy counts both errors as 1; the business does not.
:::

:::qa[Isotonic calibration lowered A's ECE from 0.018 to 0.008 but its Brier barely moved. Why?]
Brier = calibration + (lack of) discrimination. Monotone recalibration fixes the first and cannot change the ranking, so the discrimination part — most of A's Brier — is untouched.
:::

Next: [Healthcare](/c/slm-decision-models/15-healthcare).
