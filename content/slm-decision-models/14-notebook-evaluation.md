---
section: "14"
title: "Notebook: evaluation metrics"
kicker: "Notebook"
abstract: "Calibration, cost curves and risk-coverage: the three plots that tell you whether a decision model is shippable."
time: "5 min"
order: 14
outcomes:
  - "Read a reliability diagram and a cost curve"
  - "Find the cost-optimal threshold and compare it with 0.5"
  - "Use risk-coverage to set a coverage target"
---

**File:** `notebooks/04-evaluation-metrics.ipynb` · **Runtime:** ~1 min CPU · **Inputs:**
saved score files from notebooks 1–3, or the bundled synthetic set.

## What gets plotted

1. **Reliability diagram** with 15 bins and the ECE annotation, before and after temperature scaling.
1. **Cost curve**: expected cost per case as a function of the decision threshold, with the minimum marked and the 0.5-accuracy baseline overlaid.
1. **Risk-coverage curve**: error rate on the retained slice versus the fraction of cases auto-decided.
1. **Per-class recall table** with support, to catch a class that has collapsed.

## Core code

```python
import numpy as np, matplotlib.pyplot as plt
from slm_decision import ece, brier, risk_coverage, expected_cost

# reliability diagram
bins = np.linspace(0, 1, 16)
idx = np.digitize(p, bins) - 1
conf = np.array([p[idx == b].mean() for b in range(15) if (idx == b).any()])
acc  = np.array([y[idx == b].mean() for b in range(15) if (idx == b).any()])
plt.plot([0, 1], [0, 1], "--", color="#999")
plt.plot(conf, acc, "o-", label=f"ECE = {ece(p, y):.3f}")

# risk-coverage
cov, risk = risk_coverage(p, y, preds)
plt.plot(cov, risk); plt.xlabel("coverage"); plt.ylabel("error on covered")

# cost curve
ths = np.linspace(0.01, 0.99, 99)
costs = [expected_cost(spec, (p >= t).astype(int), y) for t in ths]
t_star = ths[int(np.argmin(costs))]
```

## Reference output

```python
ECE (raw / temperature)      : 0.164 / 0.019      (fitted T = 3.01)
Brier (raw / calibrated)     : 0.238 / 0.207
cost-optimal threshold       : 0.83   (11.24 per case)
cost at threshold 0.50       : 23.95 per case   (+113%)
coverage at 5% error         : 0.03
per-class recall (vs oracle) : approve 0.68 | decline 0.67  (support ~2000 each)
```

## Reading the numbers like an operator

| Observation | Interpretation | Action |
| --- | --- | --- |
| Threshold 0.83 beats 0.50 by 2× | Cost asymmetry dominates; accuracy was never the objective | Publish the derived threshold; wire it into the policy |
| ECE 0.164 → 0.019, T = 3.01 | Scores were exactly 3× too sharp; ranking unchanged | Ship temperature scaling; re-fit monthly |
| Coverage 0.03 at 5% error | This synthetic task is genuinely hard at 5% risk | Set the risk target from the cost matrix, not from ambition |
| Recall 0.68 / 0.67 against the oracle action | Errors are spread, not concentrated in one class | Add features or labels; thresholding will not fix it |

## Reproduce the whole chain

```bash
jupyter nbconvert --to notebook --execute notebooks/0[1-4]*.ipynb --output-dir /tmp/out
```

All four notebooks run in under 15 minutes on 2 vCPU with no network access, which makes them safe to execute in
CI. That is intentional: a tutorial you cannot run is a screenshot.
