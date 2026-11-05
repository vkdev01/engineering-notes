---
section: "7"
title: "Probabilities, thresholds, and calibration"
kicker: "Decision foundations"
abstract: "The threshold from §4 is only correct if the model's probabilities mean what they say. This section defines calibration, measures it (reliability diagram, ECE, Brier, log loss), fixes it (temperature, Platt, isotonic), sizes the calibration set, and re-adjusts probabilities when base rates move."
time: "30 min"
order: 7
outcomes:
  - "Compute ECE, Brier score and log loss by hand and read a reliability diagram"
  - "Choose between temperature scaling, Platt scaling and isotonic regression from data size and failure shape"
  - "Estimate how many calibration labels you need and put a confidence interval on a reliability bin"
  - "Re-adjust probabilities with Bayes' rule when the base rate shifts, with or without new labels"
  - "Quantify the cost-per-case impact of calibration at a derived threshold"
---

The loan triage policy from [§4](/c/practical-slm-decision-models/04-decision-theory) approves when $P(\text{good}) > 0.833$. Run that policy on an overconfident model and look at the applications it scored around 0.85: in the lab below, 2,547 test applications landed in the 0.8–0.9 bin with a mean score of 0.85, and only 71% of them were good. The policy believed each approval cost $0.15 \times 120{,}000$ = ₹18,000 in expected losses, cheaper than declining ($0.85 \times 24{,}000$ = ₹20,400). The real numbers were $0.29 \times 120{,}000$ = ₹34,800 for approving against $0.71 \times 24{,}000$ = ₹17,040 for declining — **₹17,760 lost on every approval in that bin**, with a model whose ranking was perfectly usable.

:::key[First principle]
A model is **calibrated** when its probabilities are frequencies: among all cases it scores $p$, a fraction $p$ are positive, i.e. $P(Y=1 \mid \hat p = p) = p$. The cost-derived threshold assumes this. Ranking quality (AUC) and calibration are independent properties — you need both, and calibration is the cheap one to fix.
:::

## 7.1 Scores, logits and probabilities

A classifier head produces a **logit** $z$; the sigmoid turns it into a number in $[0,1]$:

$$
\hat p = \sigma(z) = \frac{1}{1+e^{-z}}, \qquad z = \log\frac{\hat p}{1-\hat p}.
$$

For $K$ classes (the four-queue ticket router), softmax does the same job:

$$
\hat p_k = \frac{e^{z_k}}{\sum_{j=1}^{K} e^{z_j}}.
$$

Both functions guarantee the output *looks* like a probability — non-negative, sums to one. Neither guarantees it *is* one. Calibration is an empirical property of the model on a population:

$$
\text{perfect calibration:}\quad P(Y = 1 \mid \hat p = p) = p \quad \text{for all } p \in [0,1].
$$

Two consequences engineers trip over:

- **Calibration says nothing about usefulness.** A model that predicts the base rate (0.70) for every application is perfectly calibrated and worthless — it can never cross 0.833. Discrimination (ranking good above bad) is what makes probabilities move; calibration is what makes them honest.
- **Any monotone transform keeps the ranking.** If $\hat p$ ranks well but is miscalibrated, a monotone map $g$ with $g(\hat p) \approx P(Y=1 \mid \hat p)$ fixes the probabilities without touching AUC. That map is what every calibration method in §7.4 estimates.

:::note[Why fine-tuned networks drift overconfident]
Training minimises log loss on the *training* set. Once the training examples are classified correctly, the loss keeps falling by growing $|z|$, so logits end up too large in magnitude for unseen data. The resulting miscalibration is mostly a uniform logit scale — exactly what temperature scaling (§7.4) undoes with one parameter.
:::

## 7.2 Why the threshold needs calibration

From §4, approving instead of declining is cheaper when

$$
p \cdot c(\text{decline}, \text{good}) > (1-p)\cdot c(\text{approve}, \text{bad})
\iff p > p^* = \frac{c(\text{approve},\text{bad})}{c(\text{approve},\text{bad}) + c(\text{decline},\text{good})} = \frac{120{,}000}{144{,}000} = 0.833.
$$

The derivation substitutes the model's $\hat p$ for the true $p$. If $\hat p$ is miscalibrated, the policy compares the wrong expected costs and $p^*$ is simply the wrong cut on the model's scale. You then have two options:

1. **Calibrate**, then use the derived $p^* = 0.833$ unchanged. The threshold stays a business number owned by whoever owns the costs.
2. **Tune the threshold** on labelled data to wherever the cost is lowest for this model. That works, but the threshold becomes a model-specific magic number that silently breaks on the next retrain, and you need as many labels as calibration does.

The cost curves below show what happens on the overconfident model from the lab in §7.5: on raw scores, the cheapest cut sits at 0.99, nowhere near 0.833; after temperature scaling the minimum moves back next to the derived threshold.

:::chart[Cost per application as the approve threshold moves — raw vs temperature-scaled]{type="line" x="approve threshold on the model's P(good)" y="expected cost per application" prefix="₹" marks="0.833:derived p*" note="Same 15,000 test applications and model as the lab in §7.5 (LR with logits ×2.5)."}
threshold, raw (overconfident), temperature-scaled
0.5, 28002, 28002
0.525, 27346, 26165
0.55, 26648, 24363
0.575, 25752, 22933
0.6, 24998, 21482
0.625, 24277, 19726
0.65, 23686, 18397
0.675, 22973, 17184
0.7, 22242, 16278
0.725, 21539, 15438
0.75, 20786, 14659
0.775, 19773, 14088
0.8, 19070, 13552
0.825, 18147, 13269
0.85, 17413, 13027
0.875, 16717, 12976
0.9, 15936, 13202
0.925, 14963, 13686
0.95, 14120, 14560
0.975, 13381, 15642
0.985, 13040, 16146
0.99, 12936, 16368
0.995, 13152, 16558
0.998, 13739, 16626
:::

At exactly $p^* = 0.833$ the raw model costs ₹17,830 per application and the temperature-scaled one ₹13,179 (§7.5) — the same ranking, a 26% difference, purely from what the numbers mean.

## 7.3 Measuring calibration

### Reliability diagram

Sort predictions into bins by $\hat p$ (10 equal-width bins is the convention). For each bin $B_b$ plot the mean prediction (confidence) against the observed positive rate (accuracy):

$$
\text{conf}(B_b) = \frac{1}{|B_b|}\sum_{i\in B_b} \hat p_i, \qquad \text{acc}(B_b) = \frac{1}{|B_b|}\sum_{i\in B_b} y_i .
$$

Points on the diagonal are calibrated. Below the diagonal means **overconfident** about the positive class (predicted 0.85, observed 0.71); above means underconfident. Always print the bin counts next to the plot.

### Expected calibration error

ECE is the count-weighted average gap:

$$
\text{ECE} = \sum_{b=1}^{B} \frac{|B_b|}{N}\,\bigl|\text{acc}(B_b) - \text{conf}(B_b)\bigr| .
$$

It is easy to explain and has two weaknesses: it depends on the binning, and it is biased upward on small samples (§7.6). Report it with the bin scheme and $N$.

### Brier score and log loss

Both are **proper scoring rules**: their expectation is minimised only by reporting the true probability, so they reward calibration and discrimination together.

$$
\text{Brier} = \frac{1}{N}\sum_{i=1}^{N}(\hat p_i - y_i)^2, \qquad
\text{LogLoss} = -\frac{1}{N}\sum_{i=1}^{N}\bigl[y_i \log \hat p_i + (1-y_i)\log(1-\hat p_i)\bigr].
$$

Brier is bounded in $[0,1]$ and forgiving of confident mistakes (worst term 1). Log loss is unbounded: a confident miss at $\hat p = 0.01$ costs $-\ln 0.01 = 4.6$ on its own. Use log loss to fit calibrators, Brier and ECE to report, and the reliability diagram to see *where* the problem is.

:::example[Worked example · ten loan predictions]
Ten applications, $\hat p = P(\text{good})$ and outcome $y$ (1 = good). Use two bins, $[0, 0.5)$ and $[0.5, 1]$ — with $N = 10$, ten bins would be meaningless.

| $\hat p$ | 0.95 | 0.90 | 0.90 | 0.85 | 0.80 | 0.70 | 0.60 | 0.30 | 0.20 | 0.10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| $y$ | 1 | 1 | 0 | 1 | 1 | 0 | 1 | 0 | 0 | 1 |
| $(\hat p - y)^2$ | 0.0025 | 0.01 | 0.81 | 0.0225 | 0.04 | 0.49 | 0.16 | 0.09 | 0.04 | 0.81 |

**High bin** (7 cases): conf $= 5.70/7 = 0.8143$, acc $= 5/7 = 0.7143$, gap $0.1000$.
**Low bin** (3 cases): conf $= 0.60/3 = 0.2000$, acc $= 1/3 = 0.3333$, gap $0.1333$.

$$
\text{ECE} = \tfrac{7}{10}(0.1000) + \tfrac{3}{10}(0.1333) = 0.0700 + 0.0400 = 0.1100
$$

$$
\text{Brier} = \frac{2.475}{10} = 0.2475
$$

Log loss sums $-\ln$ of the probability given to what happened: $-\ln 0.95 - \ln 0.90 - \ln 0.10 - \dots = 7.442$, so $\text{LogLoss} = 0.7442$. The two confident misses ($\hat p = 0.90$ on a bad case, $0.10$ on a good one) contribute $2 \times 2.3026 = 4.61$ of the 7.44.

Sanity check: always predicting the sample base rate 0.6 gives Brier $0.6 \times 0.4 = 0.2400$ — *better* than this model's 0.2475. Two confident mistakes in ten were enough to make the model worse than a constant.
:::

```python run
import numpy as np
from sklearn.metrics import brier_score_loss, log_loss

p = np.array([0.95, 0.90, 0.90, 0.85, 0.80, 0.70, 0.60, 0.30, 0.20, 0.10])
y = np.array([1, 1, 0, 1, 1, 0, 1, 0, 0, 1])
hi = p >= 0.5
for name, m in (("bin [0.5,1]", hi), ("bin [0,0.5)", ~hi)):
    print(f"{name}: n={m.sum()}  conf={p[m].mean():.4f}  acc={y[m].mean():.4f}  gap={abs(p[m].mean()-y[m].mean()):.4f}")
ece = sum(m.mean() * abs(p[m].mean() - y[m].mean()) for m in (hi, ~hi))
print(f"ECE   = {ece:.4f}")
print(f"Brier = {brier_score_loss(y, p):.4f}   (squared errors: {np.round((p - y) ** 2, 4).tolist()})")
print(f"log loss = {log_loss(y, p):.4f}   (worst single term: -ln(0.10) = {-np.log(0.10):.4f})")
print(f"Brier of always predicting the base rate {y.mean():.1f}: {brier_score_loss(y, np.full(10, y.mean())):.4f}")
```

```output
bin [0.5,1]: n=7  conf=0.8143  acc=0.7143  gap=0.1000
bin [0,0.5): n=3  conf=0.2000  acc=0.3333  gap=0.1333
ECE   = 0.1100
Brier = 0.2475   (squared errors: [0.0025, 0.01, 0.81, 0.0225, 0.04, 0.49, 0.16, 0.09, 0.04, 0.81])
log loss = 0.7442   (worst single term: -ln(0.10) = 2.3026)
Brier of always predicting the base rate 0.6: 0.2400
```

## 7.4 Three ways to fix it

All three learn a map from the model's output to a calibrated probability on a **held-out calibration set** — never the training set (its logits are the overconfident ones) and never the test set (you would be grading your own homework).

| Method | Map | Parameters | Fits | Needs |
|---|---|---:|---|---|
| Temperature scaling | $\hat p = \sigma(z/T)$, or softmax$(z/T)$ for $K$ classes | 1 | Uniform over/under-confidence (logits too large: $T>1$) | ~100s of labels |
| Platt scaling | $\hat p = \sigma(a z + b)$ | 2 | Scale *and* shift (e.g. base-rate offset) | ~100s of labels |
| Isotonic regression | $\hat p = g(z)$, $g$ any non-decreasing step function | up to $N$ | Any monotone distortion | ~1,000+ labels |

**Temperature scaling** divides every logit by one number $T$ fitted by minimising log loss on the calibration set. It cannot change the argmax or the ranking, so accuracy and AUC are untouched. For the ticket router it is the default: one $T$ for the softmax over four queues.

**Platt scaling** fits a one-feature logistic regression on the logit. The extra intercept $b$ absorbs a base-rate offset that temperature cannot.

**Isotonic regression** fits the best non-decreasing step function (pool-adjacent-violators). It handles distortions that are not sigmoid-shaped — but with few labels its steps are noisy, and ties at plateaus slightly reduce resolution.

None of them can fix **ranking errors**. If a group of bad applications receives higher scores than a group of good ones, every monotone map keeps them in that order.

## 7.5 Lab: calibration, measured in rupees

Two base models on the same synthetic loan book (70% good), with two different kinds of miscalibration: Gaussian naive Bayes (its redundant-feature independence assumption distorts the *shape*) and a logistic regression whose logits are multiplied by 2.5 (the uniform over-confidence of an over-trained network). Each is calibrated three ways on 5,000 held-out labels and scored on 15,000 untouched test cases at the derived threshold 0.833.

:::details[Show the lab code (51 lines)]
```python run
import numpy as np
from sklearn.datasets import make_classification
from sklearn.naive_bayes import GaussianNB
from sklearn.linear_model import LogisticRegression
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, log_loss

# Synthetic loan book, y=1 means "good" (~70%). Train / calibration / test = 10k / 5k / 15k.
X, y = make_classification(n_samples=30000, n_features=20, n_informative=4, n_redundant=12,
                           weights=[0.3, 0.7], flip_y=0.03, class_sep=0.8, random_state=0)
tr, cal, te = slice(0, 10000), slice(10000, 15000), slice(15000, None)
sig = lambda z: 1 / (1 + np.exp(-z))

def logit(p):
    p = np.clip(p, 1e-12, 1 - 1e-12)
    return np.log(p / (1 - p))

def ece(p, y, bins=10):
    idx = np.minimum((p * bins).astype(int), bins - 1)
    return sum(np.mean(idx == b) * abs(p[idx == b].mean() - y[idx == b].mean())
               for b in range(bins) if np.any(idx == b))

def cost(p, y, t=120000 / 144000):          # approve if P(good) > 0.833, else decline
    return np.mean(np.where(p > t, (1 - y) * 120000, y * 24000))

bases = {   # two kinds of miscalibration: wrong shape (naive Bayes) and logits scaled too large
    "GaussianNB": (GaussianNB(), 1.0),
    "LR, logits x2.5": (LogisticRegression(max_iter=1000), 2.5),   # mimics an over-trained net
}
y_cal, y_te = y[cal], y[te]
for base, (clf, k) in bases.items():
    clf.fit(X[tr], y[tr])
    z_cal, z_te = (k * logit(clf.predict_proba(X[s])[:, 1]) for s in (cal, te))
    Ts = np.exp(np.linspace(-1, 4, 501))
    T = Ts[np.argmin([log_loss(y_cal, sig(z_cal / t)) for t in Ts])]
    platt = LogisticRegression(C=1e6).fit(z_cal[:, None], y_cal)
    iso = IsotonicRegression(out_of_bounds="clip", y_min=1e-6, y_max=1 - 1e-6).fit(z_cal, y_cal)
    out = {"raw": sig(z_te), f"temperature T={T:.2f}": sig(z_te / T),
           "Platt": platt.predict_proba(z_te[:, None])[:, 1], "isotonic": iso.predict(z_te)}
    print(f"--- {base} ---")
    print(f"{'method':18s} {'ECE':>6s} {'Brier':>6s} {'logloss':>7s} {'approve':>7s} {'INR/case':>8s}")
    for name, p in out.items():
        print(f"{name:18s} {ece(p, y_te):6.3f} {brier_score_loss(y_te, p):6.3f} {log_loss(y_te, p):7.3f}"
              f" {np.mean(p > 0.8333):7.1%} {cost(p, y_te):8,.0f}")
    best = min(cost(out["raw"], y_te, t) for t in np.linspace(0.01, 0.999, 999))
    print(f"{'threshold tuned on test (unattainable)':49s} {best:8,.0f}")
print(f"\ntest base rate P(good) = {y_te.mean():.3f}; reliability of the last model (mean p:observed):")
for name, p in list(out.items())[:2]:
    idx = np.minimum((p * 10).astype(int), 9)
    print(name[:11], " ".join(f"{p[idx == b].mean():.2f}:{y_te[idx == b].mean():.2f}({(idx == b).sum()})"
                              for b in range(10) if np.any(idx == b)))
```
:::

```output
--- GaussianNB ---
method                ECE  Brier logloss approve INR/case
raw                 0.065  0.144   0.476   48.8%   10,248
temperature T=1.90  0.053  0.140   0.434   27.8%   10,730
Platt               0.039  0.138   0.424   32.5%   10,197
isotonic            0.009  0.137   0.420   44.9%    9,901
threshold tuned on test (unattainable)               9,582
--- LR, logits x2.5 ---
method                ECE  Brier logloss approve INR/case
raw                 0.115  0.197   0.636   57.8%   17,830
temperature T=2.44  0.025  0.180   0.530   24.3%   13,179
Platt               0.028  0.180   0.530   24.2%   13,179
isotonic            0.012  0.178   0.525   22.4%   12,989
threshold tuned on test (unattainable)              12,914

test base rate P(good) = 0.693; reliability of the last model (mean p:observed):
raw 0.05:0.43(186) 0.15:0.30(276) 0.25:0.25(378) 0.35:0.37(476) 0.45:0.43(628) 0.55:0.49(907) 0.65:0.57(1109) 0.75:0.63(1654) 0.85:0.71(2547) 0.97:0.84(6839)
temperature 0.07:0.90(10) 0.16:0.48(33) 0.26:0.36(176) 0.36:0.26(506) 0.46:0.39(1219) 0.55:0.55(2417) 0.65:0.67(3372) 0.75:0.74(2940) 0.85:0.81(1797) 0.95:0.97(2530)
```

:::chart[Reliability diagram, LR with logits ×2.5 — before and after temperature scaling]{type="line" diag="true" x="mean predicted P(good) in bin" y="observed good rate" xmin="0" xmax="1" ymin="0" ymax="1" xfmt="pct" yfmt="pct" note="10 equal-width bins on 15,000 test cases; temperature bins with fewer than 50 cases (10 and 33) omitted."}
p, raw (overconfident), temperature T=2.44
0.05, 0.43,
0.15, 0.30,
0.25, 0.25,
0.26, , 0.36
0.35, 0.37,
0.36, , 0.26
0.45, 0.43,
0.46, , 0.39
0.55, 0.49, 0.55
0.65, 0.57, 0.67
0.75, 0.63, 0.74
0.85, 0.71, 0.81
0.95, , 0.97
0.97, 0.84,
:::

How to read the results:

- **Logits ×2.5 (the SLM-like case).** The raw model puts 6,839 cases in the top bin claiming 0.97 when 84% are good, so it approves 57.8% of applications and costs ₹17,830 per case. One parameter, $T = 2.44$ (the true distortion was 2.5), brings ECE from 0.115 to 0.025 and cost to ₹13,179 — a **26% cut**, ₹4,651 per application, without retraining. Isotonic gets to ₹12,989, within ₹75 of the unattainable bound from tuning the threshold on the test set itself.
- **Naive Bayes (wrong shape).** Temperature reduces ECE (0.065 → 0.053) and still makes the decision *worse* (₹10,248 → ₹10,730): one global $T$ over-corrects the top of the range and the approve rate collapses from 48.8% to 27.8%. Isotonic, which can bend, is the only method that helps here (₹9,901). **A lower ECE is not the objective; the cost at your threshold is.**
- **The low end.** Bins with $\hat p < 0.5$ wander off the diagonal in both curves. The synthetic book has two clusters per class, and the linear model ranks one cluster of good cases below bad ones. That is a ranking error; no calibrator will fix it, and with $p^* = 0.833$ it does not affect any decision.

:::warn[Calibrate after every change that touches the logits]
Retraining, a new prompt template, quantisation (fp16 → int4), a new tokenizer, distillation into a smaller student — each can rescale logits. Temperature is one number; refit it on every release and gate the release on ECE *and* cost at threshold (§11).
:::

## 7.6 How much calibration data you need

Three separate questions, three answers.

**1. How noisy is the measurement?** ECE is biased upward: even a perfectly calibrated model shows a positive ECE on a finite sample because each bin's observed rate fluctuates. Simulating a perfectly calibrated model (scores skewed towards "good", 10 bins):

| test cases $N$ | 100 | 300 | 1,000 | 3,000 | 10,000 |
|---|---:|---:|---:|---:|---:|
| ECE of a *perfect* model | 0.093 | 0.055 | 0.031 | 0.018 | 0.010 |

For this score distribution and 10 bins, the noise floor is roughly $1/\sqrt{N}$. An ECE of 0.03 on 1,000 cases is indistinguishable from perfect.

**2. Is one bin miscalibrated?** Each bin is a binomial proportion. Use a Wilson interval (it behaves near 0 and 1 where the normal approximation does not). A half-width $h$ at rate $p$ needs about $n \approx 1.96^2\,p(1-p)/h^2$ cases *in that bin*.

```python run
import math

def wilson(k, n, z=1.96):
    p = k / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return mid - half, mid + half

lo, hi = wilson(96, 120)
print(f"bin: 120 cases, mean predicted 0.86, observed 96/120 = 0.800 -> 95% CI [{lo:.3f}, {hi:.3f}]")
for half_width in (0.05, 0.025, 0.01):
    n = math.ceil(1.96 ** 2 * 0.85 * 0.15 / half_width ** 2)
    print(f"cases needed in a bin at p=0.85 for a +/-{half_width} 95% interval: {n:,}")
```

```output
bin: 120 cases, mean predicted 0.86, observed 96/120 = 0.800 -> 95% CI [0.720, 0.862]
cases needed in a bin at p=0.85 for a +/-0.05 95% interval: 196
cases needed in a bin at p=0.85 for a +/-0.025 95% interval: 784
cases needed in a bin at p=0.85 for a +/-0.01 95% interval: 4,899
```

A six-point gap on 120 cases is not evidence of miscalibration — 0.86 is inside the interval. For the loan policy, what matters is the bin around $p^* = 0.833$: to tell 0.85 from 0.80 there, you want roughly 800 labelled cases *near the threshold*, not 800 overall.

**3. How many labels does each calibrator need?** Fit temperature and isotonic on $n$ labels drawn from the 5,000-case calibration pool and score on the 15,000 test cases (mean of 20 resamples):

:::details[Show the simulation code]
```python run
import numpy as np
from sklearn.datasets import make_classification
from sklearn.linear_model import LogisticRegression
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import log_loss

rng = np.random.default_rng(0)

def ece(p, y, bins=10):
    idx = np.minimum((p * bins).astype(int), bins - 1)
    return sum(np.mean(idx == b) * abs(p[idx == b].mean() - y[idx == b].mean())
               for b in range(bins) if np.any(idx == b))

# 1) A perfectly calibrated model still shows ECE > 0 on a finite sample: pure noise.
print("ECE of a PERFECTLY calibrated model (mean of 200 draws, 10 bins):")
for n in (100, 300, 1000, 3000, 10000):
    vals = []
    for _ in range(200):
        p = rng.beta(2, 1, n)                     # skewed towards 'good', like the loan book
        vals.append(ece(p, (rng.random(n) < p).astype(int)))
    print(f"  n={n:6d}  ECE={np.mean(vals):.3f}")

# 2) How many calibration labels does each method need? (LR with logits x2.5, as before)
X, y = make_classification(n_samples=30000, n_features=20, n_informative=4, n_redundant=12,
                           weights=[0.3, 0.7], flip_y=0.03, class_sep=0.8, random_state=0)
clf = LogisticRegression(max_iter=1000).fit(X[:10000], y[:10000])
z = 2.5 * clf.decision_function(X)
sig = lambda v: 1 / (1 + np.exp(-v))
pool_z, pool_y, z_te, y_te = z[10000:15000], y[10000:15000], z[15000:], y[15000:]
Ts = np.exp(np.linspace(-1, 3, 201))
print("\ntest ECE after fitting on n calibration labels (mean of 20 resamples):")
print(f"  {'n_cal':>6s} {'temperature':>11s} {'isotonic':>9s}")
for n in (30, 100, 300, 1000, 3000):
    t_e, i_e = [], []
    for _ in range(20):
        s = rng.choice(len(pool_y), n, replace=False)
        T = Ts[np.argmin([log_loss(pool_y[s], sig(pool_z[s] / t), labels=[0, 1]) for t in Ts])]
        iso = IsotonicRegression(out_of_bounds="clip").fit(pool_z[s], pool_y[s])
        t_e.append(ece(sig(z_te / T), y_te))
        i_e.append(ece(iso.predict(z_te), y_te))
    print(f"  {n:6d} {np.mean(t_e):11.3f} {np.mean(i_e):9.3f}")
```
:::

```output
ECE of a PERFECTLY calibrated model (mean of 200 draws, 10 bins):
  n=   100  ECE=0.093
  n=   300  ECE=0.055
  n=  1000  ECE=0.031
  n=  3000  ECE=0.018
  n= 10000  ECE=0.010

test ECE after fitting on n calibration labels (mean of 20 resamples):
   n_cal temperature  isotonic
      30       0.064     0.113
     100       0.039     0.072
     300       0.029     0.038
    1000       0.027     0.023
    3000       0.027     0.014
```

:::chart[Test ECE after calibrating on n labels]{type="line" xlog="true" x="calibration labels n" y="test ECE (15,000 cases)" xfmt="int" yfmt="dec3" note="Logits ×2.5 model; mean of 20 resamples per n."}
n, temperature (1 parameter), isotonic (step function)
30, 0.064, 0.113
100, 0.039, 0.072
300, 0.029, 0.038
1000, 0.027, 0.023
3000, 0.027, 0.014
:::

The bias–variance trade-off in one picture: temperature is nearly converged at 300 labels and then flattens (its one-parameter family cannot represent the residual distortion); isotonic is worse than temperature below ~500 labels and better above ~1,000.

:::tip[Rules of thumb]
- Fewer than ~500 calibration labels: temperature (multi-class) or Platt (binary).
- More than ~1,000 labels, and the reliability diagram is not a clean S-curve: isotonic.
- Size the set by the bins that matter: ~800 cases near $p^*$ for a ±0.025 check.
- Keep the calibration split separate from both early-stopping validation and the final test set.
:::

## 7.7 Prior shift: when base rates move

Calibration is calibration *for a population*. A model trained when 70% of applicants were good, deployed in a downturn where 55% are good, will be overconfident about "good" even if $P(x \mid y)$ — what good and bad applicants look like — has not changed. This is **label shift**, and Bayes' rule corrects it exactly.

Write the posterior in odds form. Under the training prior $\pi$ and the new prior $\pi'$, with the same likelihoods:

$$
\underbrace{\frac{p'}{1-p'}}_{\text{new odds}} = \underbrace{\frac{p}{1-p}}_{\text{model odds}} \times \frac{\pi'/(1-\pi')}{\pi/(1-\pi)}
\quad\Longrightarrow\quad
p' = \frac{p\,\frac{\pi'}{\pi}}{p\,\frac{\pi'}{\pi} + (1-p)\frac{1-\pi'}{1-\pi}} .
$$

For $K$ classes: multiply each $\hat p_k$ by $\pi'_k/\pi_k$ and renormalise.

:::example[Worked example · a downturn flips an approval]
Model output $p = 0.90$, training base rate $\pi = 0.70$, current base rate $\pi' = 0.55$.

- Model odds: $0.90 / 0.10 = 9$.
- Prior-odds ratio: $\dfrac{0.55/0.45}{0.70/0.30} = \dfrac{1.2222}{2.3333} = 0.5238$.
- New odds: $9 \times 0.5238 = 4.714$, so $p' = 4.714 / 5.714 = 0.825$.

The case was an approval at 0.90; after correction it is 0.825, just below $p^* = 0.833$, and becomes a decline. Nothing about the applicant changed — the population did.
:::

**Estimating $\pi'$ without labels.** Labels for a loan arrive months later, but you can estimate the new base rate from the model's own outputs with an EM loop (Saerens, Latinne and Decaestecker, 2002): start with $\hat\pi' = \pi$, correct all probabilities, set $\hat\pi'$ to their mean, repeat until it stops moving:

$$
\hat\pi'^{(t+1)} = \frac{1}{N}\sum_{i=1}^{N} p'_i\bigl(\hat\pi'^{(t)}\bigr).
$$

```python run
import numpy as np
from sklearn.linear_model import LogisticRegression

rng = np.random.default_rng(1)

def book(n, pi_good):                    # x | y is Gaussian; only the base rate changes
    y = (rng.random(n) < pi_good).astype(int)
    X = rng.normal(0, 1, (n, 3)) + np.where(y[:, None] == 1, 0.9, -0.9) * np.array([1, 0.6, 0.3])
    return X, y

def shift(p, pi_old, pi_new):            # Bayes: rescale the odds by the ratio of prior odds
    odds = p / (1 - p) * (pi_new / (1 - pi_new)) / (pi_old / (1 - pi_old))
    return odds / (1 + odds)

def cost(p, y, t=0.8333):
    return np.mean(np.where(p > t, (1 - y) * 120000, y * 24000))

X_tr, y_tr = book(20000, 0.70)           # trained in a good year
model = LogisticRegression().fit(X_tr, y_tr)
X_new, y_new = book(20000, 0.55)         # deployed in a downturn
p = model.predict_proba(X_new)[:, 1]

# estimate the new base rate WITHOUT labels: EM on the model's own outputs
pi = 0.70
for it in range(100):
    pi_next = shift(p, 0.70, pi).mean()
    if abs(pi_next - pi) < 1e-6:
        break
    pi = pi_next
print(f"true new base rate {y_new.mean():.3f} | EM estimate {pi:.3f} after {it} iterations")

print(f"{'probabilities':26s} {'mean p':>7s} {'approve':>8s} {'INR/case':>9s}")
for name, q in [("as trained (pi=0.70)", p),
                ("Bayes-corrected, true pi", shift(p, 0.70, y_new.mean())),
                ("Bayes-corrected, EM pi", shift(p, 0.70, pi))]:
    print(f"{name:26s} {q.mean():7.3f} {np.mean(q > 0.8333):8.1%} {cost(q, y_new):9,.0f}")
print("single case: p=0.90 under pi=0.70 ->", round(shift(0.90, 0.70, 0.55), 3), "under pi=0.55")
```

```output
true new base rate 0.553 | EM estimate 0.555 after 12 iterations
probabilities               mean p  approve  INR/case
as trained (pi=0.70)         0.613    46.4%     6,950
Bayes-corrected, true pi     0.554    39.9%     6,475
Bayes-corrected, EM pi       0.555    39.9%     6,469
single case: p=0.90 under pi=0.70 -> 0.825 under pi=0.55
```

The uncorrected model's mean prediction (0.613) is 6 points above the true rate (0.553) — that gap is your monitoring signal. EM recovers the rate to 0.002 without a single new label, and the correction cuts cost per application by ₹481 (6.9%).

:::warn[Prior correction assumes only the base rate moved]
The formula is exact only if $P(x \mid y)$ is unchanged. If the applicants themselves change (new product, new channel, a fraud ring learning your features), the likelihoods move too, and you need fresh labels and a full recalibration. Signs you are past label shift: AUC drops on recent labelled data, or the EM estimate disagrees with the observed rate once labels arrive.
:::

## 7.8 Multi-class: the ticket router

For the four-queue router, "calibrated" can mean different things. Pick the one your decision uses:

- **Top-label (confidence) calibration**: $P(\hat y = y \mid \max_k \hat p_k = p) = p$. This is what an auto-route rule "route if the top probability > $t$" relies on, and it is what multi-class ECE usually reports.
- **Class-wise calibration**: each $\hat p_k$ calibrated as a one-vs-rest binary problem. Needed when costs differ by queue (a missed legal complaint costs more than a missed billing question).

Temperature scaling of the softmax is the standard first step: one $T$, argmax unchanged. If a single queue stays miscalibrated, add per-class bias terms (a vector Platt) or a class-wise isotonic map, data permitting — each extra parameter needs labels from *that* queue.

## 7.9 Practical checklist

- [ ] Split data into train / validation (early stopping) / **calibration** / test before anything else.
- [ ] Plot the reliability diagram with bin counts; report ECE with its bin scheme and $N$, plus Brier and log loss.
- [ ] Start with temperature (or Platt for binary); move to isotonic only with 1,000+ labels and a non-sigmoid distortion.
- [ ] Choose the calibrator by **cost at the derived threshold** on the calibration set, not by ECE alone.
- [ ] Check the bins next to $p^*$ with Wilson intervals; aim for ~800 cases there.
- [ ] Monitor mean predicted probability against the realised base rate; correct with Bayes when it drifts, recalibrate when the likelihoods drift.
- [ ] Recalibrate on every model, prompt, quantisation or distillation change.
- [ ] Slice calibration by segment (channel, region, language) where sample sizes support it — a model calibrated on average can be badly off for a minority segment.

## 7.10 Check yourself

:::qa[A model has AUC 0.92 and ECE 0.12. Another has AUC 0.88 and ECE 0.01. Which do you ship for the loan policy?]
Probably the first, after calibrating it. ECE can be fixed with a monotone map on a few hundred labels without changing AUC; AUC cannot be fixed post hoc. Calibrate the AUC-0.92 model, then compare both on cost per application at $p^* = 0.833$ on the test set.
:::

:::qa[Your calibration set has 250 labels. Temperature or isotonic?]
Temperature (or Platt). In the simulation, isotonic fitted on 100–300 labels had test ECE 0.072–0.038 against temperature's 0.039–0.029; the step function overfits small samples. Isotonic only pulled ahead above ~1,000 labels.
:::

:::qa[The bin around 0.85 shows 0.80 observed on 120 cases. Recalibrate?]
Not on this evidence: the 95% Wilson interval is [0.720, 0.862], which contains the predicted 0.86. To resolve a ±0.025 difference at that level you need about 784 cases in the bin.
:::

:::qa[The model was trained when 70% of applicants were good; now 60% are. What does p = 0.88 become?]
Odds $0.88/0.12 = 7.333$; prior-odds ratio $(0.6/0.4)/(0.7/0.3) = 1.5/2.3333 = 0.6429$; new odds $4.714$; $p' = 4.714/5.714 = 0.825$. Below 0.833 — the approval becomes a decline.
:::

:::qa[Temperature scaling lowered ECE but raised cost per case. How?]
ECE averages gaps over all bins; the decision only cares about the bins near $p^*$. A single global $T$ can fix the bulk of the distribution while over-correcting the region around the threshold — as with naive Bayes in §7.5, where the approve rate fell from 48.8% to 27.8% and cost rose from ₹10,248 to ₹10,730.
:::

Next: [§8 Fine-tuning and adaptation](/c/practical-slm-decision-models/08-fine-tuning-and-adaptation) — changing what the model knows how to rank, once you know how to read its probabilities.
