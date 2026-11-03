---
section: "29"
title: "Performance metrics"
kicker: "Benchmarks"
abstract: "Definitions, formulas and thresholds for the metrics that actually decide whether a decision model ships."
time: "5 min"
order: 29
outcomes:
  - "Define the eight metrics that decide a launch"
  - "Compute ECE, Brier and risk-coverage yourself"
  - "Know which metrics not to lead with"
---

There are dozens of metrics available and about eight that matter. Each one below answers a question a stakeholder
will ask, so each one belongs in the release report.

## The core eight

| Metric | Formula / definition | Answers | Gate |
| --- | --- | --- | --- |
| Macro-F1 | Unweighted mean of per-class F1 | Are all classes working, including rare ones? | Within 1 point of baseline |
| Cost per case | `mean(c(a_i, y_i))` | What does a decision cost in money? | Below current process |
| Abstain rate | Fraction routed to the abstain action | Can operations absorb the load? | Inside the capacity plan |
| Coverage at fixed risk | Fraction auto-decided while error ≤ target | How much can we automate safely? | ≥ planned coverage |
| ECE | `Σ_b (\|B_b\| / n) · \|acc(B_b) − conf(B_b)\|` | Can thresholds be trusted? | ≤ 0.05 |
| Brier score | `mean((p - y)^2)` | Overall probability quality (proper rule) | Improves vs baseline |
| p95 latency | 95th percentile of decision time | Does it meet the SLA? | Within budget |
| Severe-miss rate | Fraction of the worst outcome class handled by the safest action | The one number that can veto a launch | Set by the domain owner |

## Calibration, in practice

```python
import numpy as np

def ece(p, y, n_bins=15):
    bins = np.linspace(0, 1, n_bins + 1)
    idx = np.digitize(p, bins) - 1
    total = 0.0
    for b in range(n_bins):
        m = idx == b
        if m.sum() == 0:
            continue
        total += m.mean() * abs(y[m].mean() - p[m].mean())
    return total

def brier(p, y):
    return float(np.mean((p - y) ** 2))
```

Reading an ECE: 0.03 is good, 0.05 is acceptable for most business decisions, 0.10 means your thresholds are
effectively arbitrary, and above 0.15 the probability output should not be used for cost arithmetic at all.

## Risk-coverage: the curve to show a product owner

```python
def risk_coverage(p, y, preds):
    order = np.argsort(-p)                       # most confident first
    cov, risk, errs = [], [], 0
    for i, k in enumerate(order, start=1):
        errs += int(preds[k] != y[k])
        cov.append(i / len(p))
        risk.append(errs / i)
    return np.array(cov), np.array(risk)
```
| Coverage | Error on covered | Interpretation |
| --- | --- | --- |
| 0.50 | 0.021 | Auto-decide half, near-perfect |
| 0.71 | 0.050 | Typical operating point for a 5% error budget |
| 0.85 | 0.094 | Error roughly doubles for 14 more points of automation |
| 1.00 | 0.158 | The model's raw accuracy — usually unacceptable alone |

This table is the single most useful artefact in a launch review: it converts "how accurate is the model" into "how
much can we automate at a risk level we accept".

## Cost metrics

```text
cost_per_case   = mean over cases of cost(action_i, y_i)
cost_savings    = (cost_baseline - cost_model) * volume
regret          = mean over cases of (best_possible_cost - realised_cost)
break_even_vol  = build_cost / (cost_baseline - cost_model)   # cases needed to pay back
```

Report regret alongside cost: it bounds how much better any future model could be on the same cases, which is the
number that tells you whether to keep investing.

## Latency metrics that predict incidents

| Metric | Why |
| --- | --- |
| p50 | Baseline health; slow drift here precedes tail failures |
| p99 | The number in the SLA |
| p99/p50 ratio | Above ~8 suggests retries, GC pauses or queueing |
| Timeout rate | Directly produces abstentions, which load reviewers |
| Cold-start count | Each one is a multi-second user-visible stall |

## What not to lead with

Accuracy on an imbalanced set, AUC on a decision you take at a fixed threshold, and average confidence are all
seductive and none of them decides a launch. Accuracy hides class collapse; AUC is threshold-free while your product
is not; average confidence says nothing about correctness. Keep them in the appendix.
