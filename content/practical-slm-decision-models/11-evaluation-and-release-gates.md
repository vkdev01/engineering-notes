---
section: "11"
title: "Evaluation: measure decisions, not just predictions"
kicker: "Evidence"
abstract: "Build a task-specific evaluation set, select metrics from the loss function, quantify uncertainty, and turn offline results into release gates."
time: "28 min"
order: 11
outcomes:
  - "Separate predictive quality, calibration, decision quality, and operational quality"
  - "Compute confusion-matrix metrics and expected decision cost"
  - "Design a leakage-resistant evaluation protocol with uncertainty estimates"
---
# 11.1 Why accuracy is not a decision metric

A classifier predicts a label. A decision system chooses an action under consequences. Those are different objects.

Suppose an SLM screens transactions. A false approval costs 100 units, a false decline costs 8, and manual review costs 2. A model that is 95% accurate can still be worse than a 92%-accurate model if its errors are concentrated in the expensive direction.

Evaluate at four layers:

1. **Prediction quality:** does the model rank or classify outcomes well?
2. **Probability quality:** do stated probabilities match observed frequencies?
3. **Decision quality:** does the chosen action minimise the real cost?
4. **Operational quality:** does the complete service meet latency, availability, privacy, and cost limits?

No single metric answers all four questions.

## 11.2 Confusion matrix from first principles

For binary outcomes, define positive as the event the system is trying to detect.

| | Actual positive | Actual negative |
|---|---:|---:|
| Predict positive | TP | FP |
| Predict negative | FN | TN |

From these counts:

\[
\text{Precision}=\frac{TP}{TP+FP},\qquad
\text{Recall}=\frac{TP}{TP+FN}
\]

\[
\text{Specificity}=\frac{TN}{TN+FP},\qquad
\text{FPR}=\frac{FP}{FP+TN}
\]

Precision answers: "When we raise an alert, how often is it right?" Recall answers: "Of all real positives, how many did we catch?" They are not interchangeable.

### Worked example

A held-out set contains 1,000 cases: 100 positives and 900 negatives. The model produces TP=80, FN=20, FP=45, TN=855.

- Precision = 80 / 125 = 0.64
- Recall = 80 / 100 = 0.80
- Specificity = 855 / 900 = 0.95
- Accuracy = (80 + 855) / 1,000 = 0.935

The 93.5% accuracy sounds excellent, but 36% of alerts are false positives. Whether this is acceptable depends on the cost of review and missed events.

## 11.3 Expected cost is the decision metric

Let y be the true outcome, a the action, and C(a,y) the cost of taking action a when y is true. For N examples:

\[
\widehat{R}(\pi)=\frac{1}{N}\sum_{i=1}^{N}C(\pi(x_i),y_i)
\]

For the example above, suppose alerting on a positive costs 0 when correct and 100 when false; not alerting costs 20 when a positive is missed and 0 otherwise. The observed cost is:

\[
45(100)+20(20)=4,900
\]

or 4.9 units per case. A manual-review action costing 2 units for every case would cost 2,000 total, or 2 units per case. The classifier is accurate but the all-review baseline is cheaper under this illustrative matrix. This is why baselines must include simple policies, not just other models.

## 11.4 A reproducible evaluation function

This dependency-free example computes the confusion matrix and expected cost. It deliberately rejects mismatched inputs and invalid labels rather than silently producing a score.

~~~python
from collections import Counter

def evaluate_binary(y_true, y_pred, costs):
    if len(y_true) != len(y_pred) or not y_true:
        raise ValueError("non-empty inputs must have equal length")
    allowed = {0, 1}
    if set(y_true) - allowed or set(y_pred) - allowed:
        raise ValueError("labels must be 0 or 1")

    counts = Counter(zip(y_true, y_pred))
    tp = counts[(1, 1)]
    fn = counts[(1, 0)]
    fp = counts[(0, 1)]
    tn = counts[(0, 0)]

    def ratio(num, den):
        return num / den if den else float("nan")

    total_cost = sum(costs[(pred, actual)]
                     for actual, pred in zip(y_true, y_pred))
    n = len(y_true)
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "accuracy": (tp + tn) / n,
        "precision": ratio(tp, tp + fp),
        "recall": ratio(tp, tp + fn),
        "specificity": ratio(tn, tn + fp),
        "expected_cost": total_cost / n,
    }

y = [1] * 100 + [0] * 900
pred = [1] * 80 + [0] * 20 + [1] * 45 + [0] * 855
costs = {(1, 1): 0, (1, 0): 100, (0, 1): 20, (0, 0): 0}
print(evaluate_binary(y, pred, costs))
~~~

Expected output (rounding may vary):

~~~text
{'tp': 80, 'fp': 45, 'fn': 20, 'tn': 855,
 'accuracy': 0.935, 'precision': 0.64, 'recall': 0.8,
 'specificity': 0.95, 'expected_cost': 4.9}
~~~

## 11.5 Calibration and proper scoring rules

A model is calibrated when, among examples assigned probability near p, approximately fraction p are positive. For example, among 200 predictions near 0.8, roughly 160 should be positive.

The Brier score for binary predictions is:

\[
\text{Brier}=\frac{1}{N}\sum_i(p_i-y_i)^2
\]

It is a proper scoring rule: in expectation, truthful probabilities minimise it. Log loss is another proper scoring rule and penalises confident mistakes especially strongly:

\[
\text{LogLoss}=-\frac{1}{N}\sum_i[y_i\log p_i+(1-y_i)\log(1-p_i)]
\]

Clip probabilities away from exactly zero and one before taking logarithms. Expected calibration error (ECE) is useful as a diagnostic, but it depends on binning and is not a proper scoring rule. Always inspect a reliability diagram and bin counts, not just one ECE value.

## 11.6 Split data to match the deployment question

Random splitting is not always valid. If several rows belong to the same customer, patient, device, document, or incident, random row splitting can leak near-duplicates across train and test. Use group-based splits. If the production future differs from the past, use a time-based split.

A robust protocol:

- training set: fit model parameters;
- validation set: choose prompts, thresholds, calibration, and hyperparameters;
- test set: one-time final estimate after choices are frozen;
- shadow/production set: monitor drift and real operational behaviour.

Do not repeatedly tune against the test set. It then becomes another validation set.

## 11.7 Confidence intervals and small samples

A measured 98% accuracy on 50 examples is not the same evidence as 98% on 50,000. Report numerator, denominator, and uncertainty. For a simple proportion, a Wilson interval is preferable to the naive normal interval near zero or one. For paired model comparisons, bootstrap the same examples so the comparison preserves pairing.

A practical bootstrap procedure is to sample evaluation rows with replacement, recompute the metric thousands of times, and report percentile intervals. Resample at the customer or group level when rows are correlated.

## 11.8 Release gates

Write gates before running the experiment. Example policy (illustrative, not universal):

| Dimension | Release gate |
|---|---|
| Expected cost | At least 15% below the deterministic baseline |
| High-cost error | Upper 95% confidence bound below 0.5% |
| Calibration | ECE below 0.05 and no severe cohort failure |
| Coverage | At least 70% of in-scope cases automated |
| Latency | p95 below 250 ms at target concurrency |
| Reliability | Invalid-output rate below 0.1% |
| Safety | No critical policy violation in the red-team suite |

A model that fails a critical safety gate should not ship merely because its average score is high.

## 11.9 Knowledge check

1. Why can accuracy rise while expected cost gets worse?
2. Which split should be used when multiple examples come from one customer?
3. Why should the test set not be used repeatedly to select thresholds?
4. What extra information must accompany a reported 98% accuracy?

**Answers:** 1. The error mix can shift toward more expensive mistakes. 2. Group split by customer. 3. Repeated selection leaks test information into model development. 4. At minimum the sample count and an uncertainty interval, plus cohort context.
