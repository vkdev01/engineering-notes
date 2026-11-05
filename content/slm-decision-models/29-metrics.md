---
section: "29"
title: "Performance metrics"
kicker: "Benchmarks"
abstract: "Which numbers decide a decision model: expected cost per case first, then the rates and calibration that explain it, coverage–risk for the review queue, latency percentiles for the SLA, and an interval on every one of them."
time: "16 min"
order: 29
outcomes:
  - "Compute expected cost per case from a confusion matrix and compare it with the trivial policies"
  - "Show with numbers why F1 and accuracy pick the wrong threshold when errors cost 5:1"
  - "Measure calibration with ECE, Brier and a reliability diagram, and price a miscalibration in rupees"
  - "Read a coverage–risk curve to size automation and the review queue"
  - "Put a bootstrap or Wilson interval on every metric and report p50/p95/p99 from enough samples"
---

The loan-triage service has been live for a month. The dashboard shows fourteen numbers: accuracy 0.89, F1 0.70, AUC, ECE, precision, recall, p50, p99, review rate and more. The risk committee asks one question — *is the model saving money, and how sure are you?* — and only one of those fourteen numbers answers it directly. This section sorts the metrics into **the one that decides**, **the ones that explain it**, and **the ones that keep the service inside its limits**, with the numbers worked on the course's loan example.

:::key[First principle]
A decision model is judged by the **expected cost per decision of the policy you run** (model + calibration + thresholds + review rule), with a confidence interval. Rates and calibration explain *why* the cost is what it is; latency and queue metrics are hard limits. Every other number is a diagnostic.
:::

**Setup used throughout.** Loan pre-approval with $p = P(\text{good})$; approving a bad case costs ₹120,000, declining a good case ₹24,000, a fully loaded review ₹3,000 (illustrative). Approve when $p \ge 0.833$. The simulated book has a 20% bad rate and a calibrated score (score ~ N(0, 1) for bad applicants, N(2, 1) for good) — synthetic, chosen so every number below can be reproduced.

## 29.1 The metric that matters: expected cost per decision

State the positive class before anything else. Here it is a **bad** applicant, flagged by `decline`:

| | Actually bad (positive) | Actually good |
| --- | ---: | ---: |
| **Declined** | TP · ₹0 | FP · ₹24,000 lost margin |
| **Approved** | FN · ₹120,000 bad loan | TN · ₹0 |

The release metric is the average realised cost over $N$ held-out cases:

$$
\hat R(\pi) = \frac{FN \cdot c_{FN} + FP \cdot c_{FP} + \#\text{reviews} \cdot r}{N}
$$

Three companions make it readable:

- **Trivial policies.** Approve everyone costs $\text{bad rate} \times 120{,}000$; decline everyone costs $\text{good rate} \times 24{,}000$. A model is worth the gap to the cheaper of the two.
- **Savings per month** $= (\hat R_{\text{baseline}} - \hat R_{\text{model}}) \times \text{volume}$ — the number the committee asked for.
- **Regret** $= \hat R_{\text{model}} - \hat R_{\text{oracle}}$, where the oracle knows the outcome (₹0 here). It bounds what any future model could still save on these cases.

The [deep course §11](/c/practical-slm-decision-models/11-evaluation-and-release-gates) derives $\hat R$ and its interval and shows a model with *lower* accuracy that is ₹240 per case cheaper.

## 29.2 Precision, recall and F1 under asymmetric costs

Precision, recall and F1 each count errors, and count them as equal. When one error is five times dearer than the other they rank models — and thresholds — wrongly.

:::example[Worked example · the higher-F1 model costs more]
Two candidates on the same 10,000 applications (2,000 bad). X is precise; Y declines more aggressively.

```python run
C_FN, C_FP = 120_000, 24_000          # approve a bad case / decline a good one (INR)
N, BAD = 10_000, 2_000                # positive class = bad applicant; flagging action = decline
models = {"X": dict(tp=1_800, fp=600), "Y": dict(tp=1_920, fp=1_100)}

for name, m in models.items():
    tp, fp = m["tp"], m["fp"]
    fn, tn = BAD - tp, N - BAD - fp
    prec, rec = tp / (tp + fp), tp / (tp + fn)
    f1 = 2 * prec * rec / (prec + rec)
    f2 = 5 * prec * rec / (4 * prec + rec)          # F-beta with beta = 2: recall weighted 4x
    cost = (fn * C_FN + fp * C_FP) / N
    print(f"{name}: TP={tp} FN={fn} FP={fp} TN={tn}  acc {(tp + tn) / N:.3f}  precision {prec:.3f}  "
          f"recall {rec:.3f}  F1 {f1:.3f}  F2 {f2:.3f}  INR {cost:,.0f}/case")
print(f"approve all INR {BAD * C_FN / N:,.0f}/case; decline all INR {(N - BAD) * C_FP / N:,.0f}/case")
```

```output
X: TP=1800 FN=200 FP=600 TN=7400  acc 0.920  precision 0.750  recall 0.900  F1 0.818  F2 0.865  INR 3,840/case
Y: TP=1920 FN=80 FP=1100 TN=6900  acc 0.882  precision 0.636  recall 0.960  F1 0.765  F2 0.871  INR 3,600/case
approve all INR 24,000/case; decline all INR 19,200/case
```

X wins accuracy (0.920 vs 0.882) and F1 (0.818 vs 0.765). Y is **₹240 per case cheaper**: it approves 120 fewer bad applicants (\(120 \times 120{,}000\) = ₹14.4M saved) and declines 500 more good ones (\(500 \times 24{,}000\) = ₹12.0M lost). At 100,000 applications a month that is ₹2.4 crore.
:::

$F_\beta$ with $\beta = 2$ happens to rank Y first here (0.871 vs 0.865), but only by luck: $F_\beta$ ignores true negatives and the base rate, so no $\beta$ reproduces a cost ratio across datasets. If you must show F1, show it next to the cost.

The same failure appears inside one model when you pick its threshold. Sweep the approve threshold on the simulated book and ask each metric where to set it:

```python run
import numpy as np

rng = np.random.default_rng(29)
N, BAD_RATE, D = 20_000, 0.20, 2.0             # synthetic: score ~ N(0,1) if bad, N(2,1) if good
bad = rng.random(N) < BAD_RATE
x = rng.normal(size=N) + D * ~bad
p = 1 / (1 + BAD_RATE / (1 - BAD_RATE) * np.exp(-(D * x - D * D / 2)))   # exact P(good|x)
C_FN, C_FP = 120_000, 24_000


def at(t):
    dec = p < t                                # decline (flag bad) below the threshold
    tp, fp, fn = (dec & bad).sum(), (dec & ~bad).sum(), (~dec & bad).sum()
    return 2 * tp / (2 * tp + fp + fn), (dec == bad).mean(), (fn * C_FN + fp * C_FP) / N


ts = np.round(np.arange(0.05, 0.991, 0.01), 2)
rows = np.array([at(t) for t in ts])
for label, i in (("max F1", rows[:, 0].argmax()), ("max accuracy", rows[:, 1].argmax()),
                 ("min cost", rows[:, 2].argmin())):
    print(f"{label:12s} t = {ts[i]:.2f}   F1 {rows[i, 0]:.3f}  acc {rows[i, 1]:.3f}  INR {rows[i, 2]:,.0f}/case")
f1, acc, cost = at(120_000 / 144_000)
print(f"p* = 0.833    F1 {f1:.3f}  acc {acc:.3f}  INR {cost:,.0f}/case")
```

```output
max F1       t = 0.62   F1 0.715  acc 0.885  INR 8,378/case
max accuracy t = 0.51   F1 0.695  acc 0.889  INR 9,875/case
min cost     t = 0.84   F1 0.671  acc 0.827  INR 6,611/case
p* = 0.833    F1 0.674  acc 0.830  INR 6,643/case
```

:::chart[Cost per case vs approve threshold, simulated loan book (20,000 cases)]{type="line" x="approve when P(good) ≥ t" y="cost per case" prefix="₹" xfmt="dec2" marks="0.51:max accuracy;0.62:max F1;0.833:p* = 0.833" note="Synthetic calibrated scores, 20% bad. Costs ₹120,000 (bad approved) and ₹24,000 (good declined)."}
t, cost per case
0.10, 19158
0.20, 15980
0.30, 13553
0.40, 11830
0.50, 10036
0.55, 9295
0.60, 8629
0.65, 8113
0.70, 7583
0.75, 7150
0.80, 6713
0.833, 6640
0.86, 6654
0.90, 7102
0.93, 7856
0.96, 9334
0.98, 11662
:::

- **Accuracy's threshold (0.51) costs ₹9,875 per case; F1's (0.62) costs ₹8,378.** The cost-derived $p^* = 0.833$ costs ₹6,643 — the F1 choice costs 26% more — while having the *lowest* F1 and accuracy of the three.
- **The empirical minimum (0.84, ₹6,611) lands on $p^*$.** With calibrated probabilities the threshold comes from the costs, not from a sweep; the sweep is a check.
- **The bottom is flat**: 0.80–0.86 is within 1.5% of the minimum. Getting the cost *ratio* right matters far more than its third digit.

## 29.3 Calibration: ECE, Brier and the reliability diagram

The threshold $p^* = 0.833$ is only optimal if "0.833" means 83.3% of such applicants repay. Three numbers check that:

$$
\text{ECE} = \sum_{b} \frac{|B_b|}{N}\,\bigl|\bar y_b - \bar p_b\bigr|, \qquad
\text{Brier} = \frac{1}{N}\sum_i (p_i - y_i)^2, \qquad
\text{LogLoss} = -\frac{1}{N}\sum_i \bigl[y_i \ln p_i + (1-y_i)\ln(1-p_i)\bigr]
$$

ECE measures calibration only. Brier and log loss are **proper scores**: they reward calibration *and* discrimination, so a change in them can come from either. To isolate the effect, keep the ranking fixed and only distort the probability scale — multiply the true log-odds by 2.5 (overconfident, typical of an un-tuned softmax) or 0.5 (underconfident):

```python run
import numpy as np

rng = np.random.default_rng(29)
N, BAD_RATE, D = 20_000, 0.20, 2.0
bad = rng.random(N) < BAD_RATE
x = rng.normal(size=N) + D * ~bad
z = np.log((1 - BAD_RATE) / BAD_RATE) + D * x - D * D / 2    # true log-odds of good
y = (~bad).astype(float)
C_FN, C_FP, P_STAR = 120_000, 24_000, 120_000 / 144_000


def reliability(p, bins=10):
    """(mean predicted, observed rate, count) per non-empty equal-width bin."""
    b = np.minimum((p * bins).astype(int), bins - 1)
    return [(p[b == k].mean(), y[b == k].mean(), int((b == k).sum())) for k in np.unique(b)]


def cost(p, t=P_STAR):
    dec = p < t
    return ((~dec & bad).sum() * C_FN + (dec & ~bad).sum() * C_FP) / N


for name, scale in (("calibrated", 1.0), ("overconfident x2.5", 2.5), ("underconfident x0.5", 0.5)):
    p = 1 / (1 + np.exp(-scale * z))           # same ranking, different probability scale
    ece = sum(abs(m - o) * n for m, o, n in reliability(p)) / N
    brier = np.mean((p - y) ** 2)
    ll = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
    best = min(cost(p, t) for t in np.quantile(p, np.linspace(0.01, 0.6, 300)))
    print(f"{name:19s} ECE {ece:.3f}  Brier {brier:.4f}  log loss {ll:.3f}  "
          f"INR {cost(p):,.0f}/case at 0.833, {best:,.0f} at its best threshold")
```

```output
calibrated          ECE 0.004  Brier 0.0808  log loss 0.265  INR 6,643/case at 0.833, 6,614 at its best threshold
overconfident x2.5  ECE 0.068  Brier 0.0898  log loss 0.384  INR 8,086/case at 0.833, 6,614 at its best threshold
underconfident x0.5 ECE 0.100  Brier 0.0925  log loss 0.319  INR 9,455/case at 0.833, 6,614 at its best threshold
```

:::chart[Reliability diagram, 10 equal-width bins: calibrated vs overconfident (same ranking)]{type="line" x="mean predicted P(good) in bin" y="observed repayment rate" diag="true" xmin="0" xmax="1" ymin="0" ymax="1" xfmt="dec1" yfmt="dec1" note="On the diagonal = calibrated. The overconfident curve is flatter than the diagonal: its 0.85 means 0.66."}
predicted, calibrated, overconfident x2.5
0.020, -, 0.120
0.048, 0.039, -
0.144, -, 0.310
0.148, 0.131, -
0.249, 0.241, 0.378
0.351, 0.351, 0.438
0.450, -, 0.454
0.452, 0.429, -
0.549, 0.528, -
0.553, -, 0.526
0.650, -, 0.525
0.654, 0.653, -
0.752, 0.730, 0.596
0.856, -, 0.664
0.857, 0.857, -
0.973, 0.973, -
0.994, -, 0.939
:::

- **Miscalibration is priced in rupees.** The overconfident model costs ₹8,086 per case at 0.833, ₹1,443 more than the calibrated one — with *identical* ranking. Applicants it scores 0.85 repay at 0.66, so it approves many it should decline.
- **Either fix recovers it**: refit calibration (temperature, Platt or isotonic), or re-optimise the threshold on validation data. All three versions reach ₹6,614 at their own best threshold. Calibrating is better because one calibrated $p$ serves every threshold, the review band and the prior-shift correction at once.
- **Brier moved only from 0.0808 to 0.0898**, while cost moved 22%. Gate on ECE and cost, report Brier as the overall probability score.
- **ECE has a noise floor.** A perfectly calibrated model on 1,000 cases shows ECE ≈ 0.031 from sampling alone (about $1/\sqrt{N}$); read ECE together with per-bin counts, especially in the bins around 0.833 ([sizing and fixes in the deep course §7](/c/practical-slm-decision-models/07-probabilities-and-calibration)).

## 29.4 Coverage–risk: how much can you automate?

With a `manual_review` action, the model decides only the cases it is sure of. Sort cases by the model's own expected cost of the best automatic action, $\min\bigl(24{,}000\,p,\; 120{,}000\,(1-p)\bigr)$, automate the most certain share (**coverage**) and review the rest. **Risk** is the error rate among automated cases.

```python run
import numpy as np

rng = np.random.default_rng(29)
N, BAD_RATE, D = 20_000, 0.20, 2.0
bad = rng.random(N) < BAD_RATE
x = rng.normal(size=N) + D * ~bad
p = 1 / (1 + BAD_RATE / (1 - BAD_RATE) * np.exp(-(D * x - D * D / 2)))
C_FN, C_FP, REVIEW = 120_000, 24_000, 3_000     # review: fully loaded price, illustrative

approve = p >= 120_000 / 144_000
realised = np.where(approve, bad * C_FN, ~bad * C_FP)          # cost if decided automatically
expected = np.minimum(p * C_FP, (1 - p) * C_FN)                 # the model's own expected cost
order = np.argsort(expected)                                    # most certain first
k = np.arange(1, N + 1)
risk = np.cumsum(realised[order] > 0) / k                       # error rate among automated cases
auto = np.cumsum(realised[order])
total = (auto + (N - k) * REVIEW) / N                           # INR per case, reviews included
print(f"{'coverage':>8s} {'error rate':>10s} {'INR/auto case':>13s} {'INR/case incl. review':>21s}")
for c in (0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
    i = int(c * N) - 1
    print(f"{c:8.0%} {risk[i]:10.2%} {auto[i] / (i + 1):13,.0f} {total[i]:21,.0f}")
band = (p > REVIEW / C_FP) & (p < 1 - REVIEW / C_FN)
i = int((~band).sum()) - 1
print(f"band rule [0.125, 0.975]: coverage {(~band).mean():.1%}, error rate {risk[i]:.2%}, "
      f"INR {total[i]:,.0f}/case; best coverage on this sample {(total.argmin() + 1) / N:.1%} "
      f"(INR {total.min():,.0f})")
```

```output
coverage error rate INR/auto case INR/case incl. review
     30%      0.68%           580                 2,274
     50%      2.01%         1,423                 2,212
     60%      3.31%         2,138                 2,483
     70%      5.21%         3,130                 3,091
     80%      7.93%         4,004                 3,803
     90%     11.95%         5,311                 5,080
    100%     16.96%         6,643                 6,643
band rule [0.125, 0.975]: coverage 41.5%, error rate 1.36%, INR 2,168/case; best coverage on this sample 46.0% (INR 2,145)
```

:::chart[Coverage vs risk: error rate among automated loan decisions (simulated)]{type="line" x="coverage (share decided automatically)" y="error rate among automated cases" xfmt="pct" yfmt="pct" marks="0.415:review band at ₹3,000" hmarks="0.02:2% risk budget"}
coverage, error rate
0.10, 0.0020
0.20, 0.0045
0.30, 0.0068
0.40, 0.0119
0.45, 0.0168
0.50, 0.0201
0.55, 0.0248
0.60, 0.0331
0.65, 0.0413
0.70, 0.0521
0.75, 0.0645
0.80, 0.0793
0.85, 0.0975
0.90, 0.1195
0.95, 0.1431
1.00, 0.1696
:::

- **The curve converts "how accurate" into "how much can we automate".** Automating half the book keeps errors at 2.0%; automating everything means 17.0%.
- **The cost-optimal coverage comes from the review price.** The band rule $p \in [r/24{,}000,\; 1 - r/120{,}000]$ reviews 58.5% and automates 41.5% at ₹2,168 per case — against ₹6,643 with no review. The sample's best (46.0%, ₹2,145) is within ₹23: the curve is flat between 40% and 50%.
- **Capacity usually binds first.** 58.5% of 100,000 applications is 58,500 reviews a month. If the team can do 20,000, automate 80% and accept ₹3,803 per case; the marginal value of a reviewer is the slope of the last column ([§16](/c/slm-decision-models/16-finance) prices it).

## 29.5 Operational metrics

Decision quality is necessary, not sufficient: the service also has to answer in time, keep queues inside staffing and notice when its inputs move.

```python run
import numpy as np

rng = np.random.default_rng(29)


def latencies(n):
    slow = rng.random(n) < 0.03                       # 3% take a slow path (retry, cold cache): illustrative
    fast = rng.lognormal(np.log(40), 0.25, n)         # fast path: median 40 ms
    return np.where(slow, rng.lognormal(np.log(400), 0.4, n), fast)


ms = latencies(100_000)
print("mean %.0f ms | p50 %.0f | p90 %.0f | p95 %.0f | p99 %.0f | p99.9 %.0f | p99/p50 %.1f" % (
    ms.mean(), *np.percentile(ms, [50, 90, 95, 99, 99.9]), np.percentile(ms, 99) / np.median(ms)))
print("spread of a p99 estimate from n samples (20 repeats, 5th-95th percentile):")
for n in (200, 1_000, 10_000, 100_000):
    est = [np.percentile(latencies(n), 99) for _ in range(20)]
    print(f"  n = {n:7,d}: {np.percentile(est, 5):4.0f} - {np.percentile(est, 95):4.0f} ms")
```

```output
mean 54 ms | p50 40 | p90 58 | p95 67 | p99 485 | p99.9 840 | p99/p50 12.0
spread of a p99 estimate from n samples (20 repeats, 5th-95th percentile):
  n =     200:   72 -  580 ms
  n =   1,000:  408 -  549 ms
  n =  10,000:  439 -  500 ms
  n = 100,000:  469 -  481 ms
```

:::chart[Latency percentiles of a two-path service (simulated, 100,000 requests)]{type="line" x="percentile" y="latency" unit=" ms" ylog="true" marks="95:p95;99:p99" note="97% fast path (median 40 ms), 3% slow path (median 400 ms); illustrative"}
percentile, latency
50, 40
60, 43
70, 46
80, 51
90, 58
95, 67
96, 72
97, 188
97.5, 281
98, 346
98.5, 411
99, 485
99.5, 596
99.9, 840
:::

- **The mean (54 ms) describes no request.** p95 is 67 ms and p99 is 485 ms: the 3% slow path sits *between* them. Any percentile above $1 - \text{slow share}$ is a slow-path latency, so set SLOs per path ([§9](/c/slm-decision-models/09-hybrid-systems) has the cascade version).
- **A p99 from 200 samples is a guess** (72–580 ms across repeats). Use ≥ 10,000 samples — at least 100 beyond the percentile — and discard warm-up ([§24](/c/slm-decision-models/24-benchmarking)).

| Metric | Definition | Alarm when (example rule) |
| --- | --- | --- |
| p50 / p95 / p99 latency | percentiles over ≥ 10,000 requests per path | p99 over SLO for 3 consecutive windows; p99/p50 above ~8 suggests queueing or retries |
| Timeout / invalid-output rate | share of calls that fall back to the safe action | above 0.5% — each one is an unplanned review |
| Review (abstain) rate | share routed to `manual_review` | outside ±20% of plan: 58,500/month planned here |
| Action mix | share approve / review / decline | any share moves > 3 points week on week |
| Mean predicted vs observed rate | calibration-in-the-large per cohort, when labels arrive | gap above the Wilson interval of the observed rate |
| Score drift (PSI) | $\sum (a_i - e_i)\ln(a_i/e_i)$ over score deciles | well above its no-drift floor $(B-1)(1/n_{ref} + 1/n_{cur})$: 0.00225 for 10 bins, 20,000 reference, 5,000 weekly |

Labels for loans arrive months late; the action mix, review rate and score PSI move the same week. Watch the leading signals, confirm with the lagging ones ([deep course §18](/c/practical-slm-decision-models/18-experimentation-and-improvement) reads PSI properly).

## 29.6 Confidence intervals on every metric

Per-case cost is ₹0 for most applicants and ₹24,000 or ₹120,000 for the rest, so its standard deviation is about three times its mean. Intervals shrink as $1/\sqrt{n}$. Use a **bootstrap** for averages (cost per case) and a **Wilson interval** for rates — especially rare, expensive ones.

```python run
import numpy as np

rng = np.random.default_rng(29)
BAD_RATE, D, C_FN, C_FP = 0.20, 2.0, 120_000, 24_000


def per_case_cost(n):
    bad = rng.random(n) < BAD_RATE
    x = rng.normal(size=n) + D * ~bad
    p = 1 / (1 + BAD_RATE / (1 - BAD_RATE) * np.exp(-(D * x - D * D / 2)))
    approve = p >= 120_000 / 144_000
    return np.where(approve, bad * C_FN, ~bad * C_FP).astype(float), approve, bad


def wilson(k, n, z=1.96):
    c = (k + z * z / 2) / (n + z * z)
    h = z * np.sqrt(k * (n - k) / n + z * z / 4) / (n + z * z)
    return c - h, c + h


print(f"{'n':>6s} {'INR/case':>8s} {'95% bootstrap CI':>17s} {'+/-':>6s} {'bad approvals':>17s} {'Wilson 95%':>15s}")
for n in (1_000, 5_000, 20_000):
    c, approve, bad = per_case_cost(n)
    lo, hi = np.percentile(c[rng.integers(0, n, (1_000, n))].mean(1), [2.5, 97.5])
    k, m = int((approve & bad).sum()), int(approve.sum())
    wl, wh = wilson(k, m)
    print(f"{n:6,d} {c.mean():8,.0f} {f'[{lo:,.0f}, {hi:,.0f}]':>17s} {(hi - lo) / 2:6,.0f} "
          f"{f'{k}/{m} = {k / m:.2%}':>17s} {f'[{wl:.2%}, {wh:.2%}]':>15s}")
c, _, _ = per_case_cost(200_000)
print(f"sd of per-case cost INR {c.std():,.0f}; {(c == 0).mean():.1%} of cases cost nothing")
print(f"0 bad approvals in 300: Wilson upper bound {wilson(0, 300)[1]:.2%}")
```

```output
     n INR/case  95% bootstrap CI    +/-     bad approvals      Wilson 95%
 1,000    6,288    [5,136, 7,440]  1,152    20/684 = 2.92%  [1.90%, 4.47%]
 5,000    6,974    [6,384, 7,560]    588  150/3429 = 4.37%  [3.74%, 5.11%]
20,000    6,800    [6,529, 7,086]    278 533/13555 = 3.93%  [3.62%, 4.27%]
sd of per-case cost INR 20,634; 82.4% of cases cost nothing
0 bad approvals in 300: Wilson upper bound 1.26%
```

- **On 1,000 cases the cost is known to ±₹1,152 (±18%).** Two models ₹500 apart cannot be told apart there; 20,000 cases bring the half-width to ₹278. Rule of thumb: half-width ≈ \(1.96 \times 20{,}634 / \sqrt{n}\).
- **Small samples mislead in both directions.** The 1,000-case point estimate (₹6,288) is ₹500 below the 20,000-case one: the same policy, a luckier draw.
- **Gate rare errors on the Wilson upper bound.** Zero bad approvals in 300 does not mean 0%: the data allow up to 1.26%.
- **Comparing two models?** Bootstrap the *paired* per-case difference, not two separate intervals — [§30](/c/slm-decision-models/30-model-comparison).

## 29.7 The metric sheet

What goes in a release report, in order:

| # | Metric | Role | Example gate (set before the run) |
| ---: | --- | --- | --- |
| 1 | Cost per case with 95% CI, vs incumbent and trivial policies | **decides** | paired CI of the improvement excludes 0 |
| 2 | Rate of the most expensive error (bad approvals) with Wilson bound | veto | upper bound ≤ the agreed limit |
| 3 | Review rate × volume vs capacity | hard limit | ≤ staffed reviews per month |
| 4 | ECE (with bin counts) and Brier | explains 1 | ECE ≤ 0.03 and not worse than incumbent |
| 5 | Confusion matrix, precision, recall at the *operating* threshold | explains 1 | reported, not gated |
| 6 | Coverage–risk curve | sizes automation | coverage at the risk budget ≥ plan |
| 7 | p95/p99 latency per path, timeout rate | hard limit | inside SLO on ≥ 10,000 requests |
| 8 | Slice table (cost per segment, with CIs) | finds hidden regressions | no pre-registered slice significantly worse |

:::warn[Metrics to keep in the appendix]
**Accuracy** on an imbalanced book (decline-everyone scores 0.20 here, approve-everyone 0.80). **AUC**, which is threshold-free while the product is not — it cannot see the ₹1,443 calibration loss in §29.3 because the ranking never changed. **Average confidence**, which says nothing about correctness. **F1 at 0.5**, which picks a threshold the costs never asked for.
:::

## 29.8 Check yourself

:::qa[A model has F1 0.80 at threshold 0.5 and 0.72 at 0.833. Which threshold do you ship?]
The one with the lower cost per case on validation data — with calibrated probabilities that is 0.833, whatever F1 says. In §29.2 the F1-optimal threshold cost ₹8,378 per case against ₹6,643 at $p^*$.
:::

:::qa[Temperature scaling cut ECE from 0.07 to 0.01 and AUC did not move. Did anything improve?]
Yes, if the policy uses fixed thresholds. Temperature changes probabilities, not ranking, so AUC cannot move; cost at $p^* = 0.833$ can. In §29.3 the same fix is worth ₹1,443 per case.
:::

:::qa[The team can review 30,000 of 100,000 applications a month. What coverage do you run and what does it cost?]
Coverage 70% (30% reviewed): ₹3,091 per case on the simulated book, against ₹2,168 with the uncapped band — the capacity limit costs about ₹923 per case, ₹9.2 crore a month. That is the case for more reviewers.
:::

:::qa[A p99 measured on 500 requests is 120 ms. The SLO is 150 ms. Pass?]
Not yet. 500 samples leave 5 beyond the 99th percentile; §29.5 shows p99 estimates from 200–1,000 samples ranging over hundreds of milliseconds when a slow path exists. Collect ≥ 10,000 requests per path first.
:::

Next: [Model comparison](/c/slm-decision-models/30-model-comparison) — paired tests, intervals on cost differences and choosing under latency and size limits.
