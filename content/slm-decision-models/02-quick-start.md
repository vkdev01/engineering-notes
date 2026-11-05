---
section: "2"
title: "Quick start"
kicker: "Setup"
abstract: "The shortest runnable path from labelled data to a cost-optimal three-action policy: one numpy + scikit-learn script, its real output, and how to read cost per case, review share and calibration as a go/no-go."
time: "12 min"
order: 2
outcomes:
  - "Run a data → model → calibration → policy pipeline on CPU in under a minute"
  - "Compute cost per case for constant, 0.5, cost-threshold and review-band policies"
  - "Explain why the cheapest policy is not the most accurate one"
  - "Read a cost-vs-threshold curve and decide when calibration is needed"
---

You have labelled history and a manager asking "can we automate loan pre-screening?". This section answers with one script: train a small classifier, calibrate it on held-out data, derive thresholds from the [cost matrix](/c/slm-decision-models/01-what-a-decision-model-is), and report what each policy costs per case. The model here is gradient-boosted trees on synthetic tabular data; later sections swap in an SLM behind the same interface, and nothing downstream changes.

:::key[First principle]
Order is **costs → model → calibration → thresholds → review band → capacity**. The thresholds come from the cost matrix before the model exists; the model only has to supply a probability that means what it says.
:::

## 2.1 The five steps

1. **Data** — split three ways: *train* fits the model, *calibrate* fits the score→probability map on cases the model never saw, *test* measures cost.
2. **Model** — the cheapest thing that might work (here `HistGradientBoostingClassifier`).
3. **Calibrate** — isotonic regression on the calibration slice; check expected calibration error (ECE) before and after.
4. **Thresholds** — $p^* = 120{,}000/144{,}000 = 0.833$; review band $[r/24{,}000,\; 1 - r/120{,}000)$ with $r$ = ₹3,000 → $[0.125, 0.975)$.
5. **Report** — cost per case and review share for every candidate policy, against the constant baselines.

Install (CPU only, no model downloads):

```bash
python -m venv .venv && source .venv/bin/activate
pip install numpy scikit-learn
```

## 2.2 The script

Synthetic stand-in for loan applications: 30,000 applicants, 20 features, ~79% repay, 5% label noise; `y = 1` means good.

```python run
"""Quick start: data -> model -> calibrate -> cost threshold -> policy report."""
import numpy as np
from sklearn.datasets import make_classification
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression

C_AB, C_DG, REVIEW = 120_000, 24_000, 3_000     # INR: approve-bad, decline-good, one review

# 1. data, split three ways
X, y = make_classification(n_samples=30_000, n_features=20, n_informative=6,
                           weights=[0.2, 0.8], flip_y=0.05, class_sep=0.8, random_state=0)
idx = np.random.default_rng(0).permutation(len(y))
tr, cal, te = idx[:15_000], idx[15_000:21_000], idx[21_000:]

# 2. model, 3. calibrate on a slice the model never trained on
clf = HistGradientBoostingClassifier(random_state=0).fit(X[tr], y[tr])
iso = IsotonicRegression(out_of_bounds="clip").fit(clf.predict_proba(X[cal])[:, 1], y[cal])
raw = clf.predict_proba(X[te])[:, 1]
p, yt = iso.predict(raw), y[te]

# 4. thresholds from the cost matrix, not from the data
p_star = C_AB / (C_AB + C_DG)
lo, hi = REVIEW / C_DG, 1 - REVIEW / C_AB


def cost(a):
    """Realised INR per case; a: 0 = decline, 1 = review, 2 = approve."""
    return np.choose(a, [yt * C_DG, np.full(len(yt), REVIEW), (1 - yt) * C_AB]).mean()


def two(s, t):
    return np.where(s >= t, 2, 0)


def ece(s, bins=10):
    b = np.minimum((s * bins).astype(int), bins - 1)
    return sum(abs(s[b == k].mean() - yt[b == k].mean()) * (b == k).mean() for k in set(b))


band = np.select([p >= hi, p >= lo], [2, 1], 0)
saving = np.minimum(p * C_DG, (1 - p) * C_AB) - REVIEW      # what a review saves, per case
capped = two(p, p_star)
capped[np.argsort(-saving)[: int(0.25 * len(p))]] = 1       # review only the top 25%

# 5. report
print(f"test {len(yt)}, good {yt.mean():.3f}, ECE raw {ece(raw):.4f} -> calibrated {ece(p):.4f}")
print(f"p* {p_star:.4f}, review band [{lo:.3f}, {hi:.3f})\n")
print(f"{'policy':26s} {'INR/case':>8s} {'review':>7s} {'acc(auto)':>9s}")
for name, a in [("always approve", np.full(len(yt), 2)), ("always decline", np.zeros(len(yt), int)),
                ("approve if p >= 0.5", two(p, 0.5)), ("p* on raw scores", two(raw, p_star)),
                ("p* on calibrated scores", two(p, p_star)),
                ("p* + review band", band), ("band, capped at 25%", capped)]:
    acc = ((a == 2) == (yt == 1))[a != 1].mean()
    print(f"{name:26s} {cost(a):8,.0f} {(a == 1).mean():7.1%} {acc:9.3f}")

grid = np.round(np.r_[np.arange(0.05, 0.75, 0.05), np.arange(0.75, 0.97, 0.02)], 2)
curve = [cost(two(p, t)) for t in grid]
print(f"\nbest threshold on grid {grid[np.argmin(curve)]:.2f} (INR {min(curve):,.0f}/case)")
```

```output
test 9000, good 0.788, ECE raw 0.0111 -> calibrated 0.0100
p* 0.8333, review band [0.125, 0.975)

policy                     INR/case  review acc(auto)
always approve               25,413    0.0%     0.788
always decline               18,917    0.0%     0.212
approve if p >= 0.5           8,072    0.0%     0.902
p* on raw scores              7,037    0.0%     0.854
p* on calibrated scores       7,155    0.0%     0.865
p* + review band              2,879   65.4%     0.965
band, capped at 25%           3,998   25.0%     0.945

best threshold on grid 0.87 (INR 7,061/case)
```

`acc(auto)` is accuracy on the cases the policy decided automatically (reviewed cases excluded).

## 2.3 Reading the report

**Constants set the bar.** With no model, always declining costs ₹18,917 per case (you lose the margin on the 78.8% who repay); always approving costs ₹25,413. A model that cannot beat ₹18,917 is subtracting value.

**The cost threshold beats 0.5 — while being less accurate.** `approve if p >= 0.5` (what `predict()` does) costs ₹8,072; $p^*$ costs ₹7,155, a saving of ₹917 per case or ₹9.2 crore a month at 100,000 applications. Its accuracy is *lower* (0.865 vs 0.902): it declines more good applicants (₹24,000 each) to avoid bad approvals (₹120,000 each). An accuracy release gate would ship the expensive policy.

**Calibration: measure before you bother.** These boosted trees came out nearly calibrated (ECE 0.0111 raw), and isotonic regression barely moved it (0.0100). On these data, $p^*$ on raw scores is even ₹118 cheaper than on calibrated ones — isotonic's step function on 6,000 cases is slightly coarse. The rule is not "always calibrate"; it is "check ECE, and the reliability curve near $p^*$ and the band edges, then calibrate if they are off". Random forests, prompted LLMs and quantised models usually are; see [performance metrics](/c/slm-decision-models/29-metrics) and the [deep-course calibration section](/c/practical-slm-decision-models/07-probabilities-and-calibration).

**The review band cuts cost to ₹2,879 — and sends 65.4% of cases to people.** At 100,000 applications a month that is about 65,400 reviews. If operations can staff 25%, cap it: review only the cases where a review saves the most expected cost, and send the rest to their cheaper automatic action. Cost rises to ₹3,998; the ₹1,119 difference is what the capacity limit costs, and it belongs to whoever sets headcount ([§4](/c/slm-decision-models/04-decision-theory) splits regret this way).

:::warn[Don't report the ₹900 review]
Price the review at the ops-sheet ₹900 and the band becomes $[0.0375, 0.9925)$: 91.8% of these test cases go to humans. The resulting low cost per case is an artefact of an underpriced action, not a saving.
:::

## 2.4 The threshold is a curve

Two-action policy (no review), cost per case on the 9,000 test cases as the approve threshold moves:

:::chart[Cost per case vs approve threshold, calibrated scores, 9,000 test cases]{type="line" x="approve if p ≥ t" y="cost per case" prefix="₹" marks="0.5:naive 0.5;0.8333:p* = 0.833" ymin="0"}
t, cost per case
0.05, 16789
0.10, 14504
0.15, 14491
0.20, 13787
0.25, 12173
0.30, 9973
0.35, 9941
0.40, 9597
0.45, 8747
0.50, 8072
0.55, 8072
0.60, 8072
0.65, 7923
0.70, 7877
0.75, 7392
0.77, 7384
0.79, 7384
0.81, 7389
0.83, 7155
0.85, 7155
0.87, 7061
0.89, 7064
0.91, 7176
0.93, 8411
0.95, 11184
:::

- **The minimum is broad.** Every threshold from 0.75 to 0.91 costs ₹7,061–₹7,392; the grid optimum (0.87, ₹7,061) is only ₹94 (1.3%) below $p^*$. Get the cost ratio roughly right and stop tuning.
- **The edges are steep.** 0.5 costs ₹8,072; 0.95 costs ₹11,184.
- **The flat stretches are isotonic plateaus**: many cases share the same calibrated value, so moving $t$ inside a plateau changes nothing.
- **Don't tune $t$ on test labels.** A swept optimum moves with every retrain; $p^*$ moves only when the costs do.

## 2.5 Adapting it to your data

- [ ] Replace `make_classification` with your features; split by **customer or application ID**, never by row.
- [ ] Write your cost matrix in currency and get it signed off; recompute $p^*$ and the band by hand.
- [ ] Compute the two constant policies first — that is the bar.
- [ ] Report all rows above, not just the best one; include review share and monthly review volume.
- [ ] Assert invariants in CI: calibrated scores in $[0, 1]$ and monotone in raw score; `cost(p*) < cost(0.5)`; review share ≤ the staffed cap.
- [ ] Log `p_good`, action, expected costs, model and policy versions for every decision ([§1.6](/c/slm-decision-models/01-what-a-decision-model-is)).

| Symptom | Likely cause | First check |
| --- | --- | --- |
| Cost policy no cheaper than always-decline | Weak signal or mis-entered costs | AUC; print the cost matrix next to the result |
| Review share near 100% | Review underpriced | Recompute the band with a fully loaded price |
| Calibrated cost much worse than raw | Calibrator fitted on training rows | Calibration slice disjoint from training |
| Test cost far below production | Same customer in train and test | Split by entity |

## 2.6 Check yourself

:::qa[The p* policy is less accurate than the 0.5 policy but ₹917 per case cheaper. How?]
Mistakes have different prices. Raising the threshold from 0.5 to 0.833 declines some good applicants (₹24,000 each, counted as errors) to avoid approving bad ones (₹120,000 each). Fewer expensive errors, more cheap ones: lower accuracy, lower cost.
:::

:::qa[Why not fit the isotonic calibrator on the training split?]
On training rows the model's scores are over-fitted — more extreme and more often right than on new cases. A calibrator fitted there learns that the scores are trustworthy and corrects nothing. Calibrate on data that looks like production: unseen by the model.
:::

:::qa[Operations can staff 10% review, not 25%. What changes?]
Only the cap: keep the 10% of cases with the largest review saving and send the rest of the band to the cheaper of approve/decline. Thresholds and model are unchanged; cost per case rises by the value of the reviews you can no longer afford.
:::

## 2.7 Next steps

- Swap the engine: [SLM fundamentals](/c/slm-decision-models/03-slm-fundamentals) for sizing, [distillation](/c/slm-decision-models/06-distillation) to get scores from a small model.
- Get the framing right: [decision theory](/c/slm-decision-models/04-decision-theory) — cut points, caps, EVSI, regret.
- Notebooks: [triage under costs](/c/slm-decision-models/12-notebook-triage), [evaluation metrics](/c/slm-decision-models/14-notebook-evaluation).
- Packaged helpers: [the Python library](/c/slm-decision-models/10-python-library).
- Full walk-through with a reliability diagram: [deep-course quick start](/c/practical-slm-decision-models/02-quick-start).

Next: [SLM fundamentals](/c/slm-decision-models/03-slm-fundamentals).
