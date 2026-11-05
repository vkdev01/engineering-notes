---
section: "7"
title: "Probabilities, thresholds, and calibration"
kicker: "Decision foundations"
abstract: "Turn model scores into probabilities you can reason about, choose thresholds from explicit costs, and detect when confidence is lying."
time: "22 min"
order: 7
outcomes:
  - "Distinguish logits, scores, probabilities, and calibrated probabilities"
  - "Compute Bayes-optimal thresholds from false-positive and false-negative costs"
  - "Measure Brier score, expected calibration error, and reliability"
---
# 7.1 A score is not a probability

A classifier may emit a logit of 2.4, a margin of 0.91, or a softmax value of 0.83. Those numbers are not interchangeable. A *score* orders examples; a *probability* is a claim about frequency. If a model says 0.8 for 100 comparable cases, calibration asks whether roughly 80 of them are positive.

For binary classification, a logit z maps to a probability through the sigmoid:

\[
p(y=1\mid x)=\sigma(z)=\frac{1}{1+e^{-z}}
\]

The transformation constrains the output to [0,1], but it does not guarantee calibration. A model can be consistently overconfident and still rank examples correctly.

## 7.2 Derive the decision threshold from costs

Suppose an automated action has two possible mistakes:
- false positive: take the action when the case is negative, cost \(C_{FP}\);
- false negative: do not act when the case is positive, cost \(C_{FN}\).

Let \(p=P(y=1\mid x)\). Expected loss if we act is \((1-p)C_{FP}\). Expected loss if we do not act is \(pC_{FN}\). Act when:

\[
(1-p)C_{FP} < pC_{FN}
\quad\Longrightarrow\quad
p > \frac{C_{FP}}{C_{FP}+C_{FN}}
\]

This is the Bayes decision threshold under the stated assumptions. It is not automatically 0.5.

**Worked example.** A fraud review that misses a fraud costs $500; an unnecessary review costs $10. Then the threshold is \(10/(10+500)=0.0196\). A calibrated 3% fraud probability is enough to justify review. If the downstream action is permanently blocking a customer, its false-positive cost is much larger and the threshold rises.

The model estimates probabilities. Product and risk owners define the costs. Do not hide a policy decision inside a model threshold.

## 7.3 Calibration metrics

The Brier score is mean squared probability error:

\[
BS=\frac{1}{N}\sum_{i=1}^{N}(p_i-y_i)^2
\]

It is proper (the expected score is minimised by reporting the true probability), bounded between 0 and 1 for binary outcomes, and sensitive to both calibration and discrimination.

Expected calibration error (ECE) bins predictions and compares average confidence with observed accuracy:

\[
ECE=\sum_{b=1}^{B}\frac{|I_b|}{N}|acc(I_b)-conf(I_b)|
\]

ECE depends on binning; always state the bin strategy and include a reliability diagram. Brier score and log loss are more stable scalar companions.

## 7.4 Reproducible calibration lab

This example creates an intentionally overconfident classifier, fits Platt scaling on a validation set, then compares Brier score and ECE on held-out data. Calibration data must be separate from final test data.

~~~python
import numpy as np

rng = np.random.default_rng(7)
n = 12000
latent = rng.normal(size=n)
true_p = 1 / (1 + np.exp(-1.4 * latent))
y = rng.binomial(1, true_p)
logits = 2.2 * latent  # overconfident, but rank-preserving

idx = rng.permutation(n)
valid, test = idx[:3500], idx[3500:]


def sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -40, 40)))


def brier(p, labels):
    return float(np.mean((p - labels) ** 2))


def ece(p, labels, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if mask.any():
            total += mask.mean() * abs(p[mask].mean() - labels[mask].mean())
    return float(total)


# Fit p = sigmoid(a * logit + b) on validation data.
xv, yv = logits[valid], y[valid]
a, b = 1.0, 0.0
for _ in range(3000):
    p = sigmoid(a * xv + b)
    da = np.mean((p - yv) * xv)
    db = np.mean(p - yv)
    a -= 0.03 * da
    b -= 0.03 * db

raw = sigmoid(logits[test])
cal = sigmoid(a * logits[test] + b)
yt = y[test]
print(f"Platt parameters: a={a:.3f}, b={b:.3f}")
print(f"raw: Brier={brier(raw, yt):.4f}, ECE={ece(raw, yt):.4f}")
print(f"cal: Brier={brier(cal, yt):.4f}, ECE={ece(cal, yt):.4f}")
~~~

Expected qualitative result: the fitted slope is below one because the raw logits are too extreme; calibrated Brier and ECE should improve on the untouched test set. Exact values depend on the random sample and optimisation.

## 7.5 Reliability table

A reliability table groups predictions by confidence. For every bin report count, mean predicted probability, and observed positive rate. Do not report only ECE: a bin with 12 cases is not as trustworthy as one with 12,000.

| Mean predicted | Observed rate | Interpretation |
|---:|---:|---|
| 0.10 | 0.09 | close |
| 0.30 | 0.18 | overconfident |
| 0.50 | 0.51 | close |
| 0.80 | 0.91 | underconfident |

These are illustrative values, not a benchmark. A reliability diagram plots observed rate against predicted confidence; the ideal line is y=x.

## 7.6 Threshold selection is a separate step

After calibration, choose a threshold using a cost matrix or an operational constraint (for example, review no more than 300 cases/day). If capacity is fixed, sort by expected value and choose the top K; do not pretend this is a universal probability threshold.

For imbalanced tasks, include precision, recall, PR-AUC, confusion matrix, and cost-weighted loss. ROC-AUC alone can look excellent while precision is unusably low.

## 7.7 Practical checklist

- Calibrate on a representative validation set, never on the final test set.
- Re-check calibration after model, prompt, quantisation, or traffic changes.
- Monitor calibration by language, geography, customer segment, and time where lawful and statistically supported.
- Use confidence intervals for small bins.
- Add an abstain/review action for cases where expected loss is high or uncertainty is unacceptable.

## 7.8 Knowledge check

1. Why does softmax not guarantee calibration?
2. If \(C_{FP}=90\) and \(C_{FN}=10\), derive the action threshold.
3. Why must calibration and threshold selection not use the final test set?

**Answers:** 1. Softmax normalises scores but does not constrain empirical frequencies. 2. \(90/(90+10)=0.9\). 3. Reusing test outcomes leaks information and makes reported performance optimistic.
