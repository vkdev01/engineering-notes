---
section: "30"
title: "Model comparison"
kicker: "Benchmarks"
abstract: "Compare candidate models the way the decision will use them: on the same cases, each at its own cost-optimal threshold, with a paired test and a paired interval on the cost difference — then choose on the cost–latency–size frontier."
time: "15 min"
order: 30
outcomes:
  - "Run McNemar's test on paired predictions and explain why it can disagree with cost"
  - "Put a paired bootstrap interval on the cost difference between two models"
  - "Compare models at their own validation-chosen thresholds, not a shared one"
  - "Find the Pareto frontier over cost, latency and size and pick a model under constraints"
---

The incumbent loan model is a gradient-boosted scorecard; the candidates are a 66M encoder and three distilled Qwen2.5 decoders. Each team brings a leaderboard number. None of them answers the question that matters: **on our applications, under our policy, which model costs least per decision, by how much, how sure are we — and what does it cost in latency and hardware?** This section is the procedure, with numbers.

:::key[First principle]
Compare **policies on the same cases**: each model with its own calibration and its own cost-optimal threshold chosen on validation data, scored on one shared test set by cost per case. Test the *paired* difference — the shared easy cases cancel and the interval shrinks. Then choose on the frontier of cost against latency and size, never on one axis.
:::

## 30.1 Same cases, paired

Two models scored on the same test set are not independent samples: both get the same easy approvals right and both stumble on the same thin-file applicants. A comparison that ignores this throws away information.

| Design | What varies between A and B | Interval on the difference |
| --- | --- | --- |
| Paired (same cases) | only the models | narrow: per-case difference $d_i = c_A(x_i) - c_B(x_i)$ |
| Unpaired (different cases) | models **and** case mix | wide: $\sigma_A^2 + \sigma_B^2$ per arm |

Pairing changes three practical things: you bootstrap $d_i$ rather than two separate means, the right significance test for error *counts* is McNemar's (it looks only at disagreements), and you need far fewer cases — the deep course derives the sample-size formula in [§11.5](/c/practical-slm-decision-models/11-evaluation-and-release-gates).

## 30.2 McNemar's test — and why it is not the decision

Put the two models' per-case correctness in a 2×2 table. Cases both get right or both get wrong say nothing about which is better; only the **discordant** cells do:

| | B right | B wrong |
| --- | ---: | ---: |
| **A right** | — | $b$ |
| **A wrong** | $c$ | — |

Under "equally accurate", each disagreement is a fair coin, so $b \sim \text{Binomial}(b + c, \tfrac12)$:

$$
\chi^2 = \frac{(|b - c| - 1)^2}{b + c} \quad (1 \text{ dof; } 3.84 \text{ at } \alpha = 0.05)
$$

:::example[Worked example · B makes more errors and costs less]
The deep course's paired loan comparison (10,000 applications, 1,000 bad): only B declines 70 bad applicants, only A declines 50 good ones, only B declines 300 good ones.

```python run
import math

# Same 10,000 applications (1,000 bad), both models at their operating thresholds (deep course 11.3).
# Discordant pairs: only B declines 70 bad (B right); only A declines 50 good (B right);
# only B declines 300 good (A right). Everything else both models get right or both get wrong.
C_FN, C_FP, N = 120_000, 24_000, 10_000
b = 300                       # A right, B wrong
c = 70 + 50                   # A wrong, B right
chi2 = (abs(b - c) - 1) ** 2 / (b + c)                          # McNemar with continuity correction
p_chi2 = math.erfc(math.sqrt(chi2 / 2))                         # chi-square, 1 dof, upper tail
p_exact = min(1.0, 2 * sum(math.comb(b + c, k) for k in range(min(b, c) + 1)) / 2 ** (b + c))
print(f"discordant: b = {b} (only A right), c = {c} (only B right)")
print(f"McNemar chi2 = {chi2:.1f}, p = {p_chi2:.1e}; exact binomial p = {p_exact:.1e}")
print(f"error counts differ by {b - c}: B makes {b - c} more errors than A on the same cases")
saved = 70 * C_FN + 50 * C_FP                                  # B right where A was wrong
lost = 300 * C_FP                                              # B wrong where A was right
print(f"cost on discordant cases: B saves INR {saved / 1e6:.1f}M, loses INR {lost / 1e6:.1f}M "
      f"-> B cheaper by INR {(saved - lost) / N:,.0f}/case")
```

```output
discordant: b = 300 (only A right), c = 120 (only B right)
McNemar chi2 = 76.3, p = 2.5e-18; exact binomial p = 7.0e-19
error counts differ by 180: B makes 180 more errors than A on the same cases
cost on discordant cases: B saves INR 9.6M, loses INR 7.2M -> B cheaper by INR 240/case
```

McNemar is emphatic — $\chi^2 = 76.3$, B is significantly *less accurate*. And B is ₹240 per case cheaper, because 70 of its 120 wins are bad loans it refused (₹120,000 each) while all 300 of its losses are good applicants it declined (₹24,000 each).
:::

Use McNemar for what it answers — "do these two models make different numbers of errors?" — e.g. as a quick check that a refactor did not change behaviour (expect $b + c \approx 0$). For the ship decision, weight each disagreement by its cost: that is the paired bootstrap of §30.3.

## 30.3 Each model at its own threshold, with a paired interval

A shared threshold compares **calibrations**, not models. If candidate B's raw probabilities are overconfident, 0.833 on its scale is not 0.833 in reality, and B loses money that a recalibration or its own threshold would recover. Choose each model's threshold on validation, then score both on the same test set.

The simulation: a latent creditworthiness score (bad ~ N(0, 1), good ~ N(2, 1), 20% bad); incumbent A sees it through noise of s.d. 0.8 and is calibrated; candidate B sees it through noise 0.4 (better) but its raw logits are doubled (overconfident). Synthetic and stated — the method carries over.

```python run
import numpy as np

rng = np.random.default_rng(30)
BAD_RATE, D, C_FN, C_FP = 0.20, 2.0, 120_000, 24_000
LOGIT_PRIOR = np.log((1 - BAD_RATE) / BAD_RATE)


def book(n):
    """Latent creditworthiness x; model A sees it with noise 0.8, model B with noise 0.4."""
    bad = rng.random(n) < BAD_RATE
    x = rng.normal(size=n) + D * ~bad
    out = {}
    for name, sd, temp in (("A", 0.8, 1.0), ("B", 0.4, 2.0)):   # B: raw scores overconfident (x2 logits)
        s = (x + rng.normal(0, sd, n)) / np.sqrt(1 + sd * sd)     # standardised score
        d = D / np.sqrt(1 + sd * sd)
        out[name] = 1 / (1 + np.exp(-temp * (LOGIT_PRIOR + d * s - d * d / 2)))
    return bad, out


def case_cost(p, bad, t):
    return np.where(p >= t, bad * C_FN, ~bad * C_FP).astype(float)


bad_v, val = book(10_000)                         # validation: choose thresholds here only
bad_t, test = book(20_000)                        # test: report here
grid = np.round(np.arange(0.30, 0.995, 0.005), 3)
own = {m: grid[np.argmin([case_cost(val[m], bad_v, t).mean() for t in grid])] for m in "AB"}
print("thresholds chosen on validation:", {m: float(t) for m, t in own.items()})
cA, cB = {}, {}
for label, tA, tB in (("both at 0.833", 0.833, 0.833), ("own thresholds", own["A"], own["B"])):
    cA[label], cB[label] = case_cost(test["A"], bad_t, tA), case_cost(test["B"], bad_t, tB)
    ok = lambda c: c == 0
    b = int((ok(cA[label]) & ~ok(cB[label])).sum())
    c = int((~ok(cA[label]) & ok(cB[label])).sum())
    print(f"{label:15s} A INR {cA[label].mean():,.0f}  B INR {cB[label].mean():,.0f}  "
          f"errors A {int((~ok(cA[label])).sum())} B {int((~ok(cB[label])).sum())}  "
          f"McNemar b={b} c={c} chi2={(abs(b - c) - 1) ** 2 / (b + c):.1f}")
n = len(bad_t)
idx, idx2 = rng.integers(0, n, (2_000, n)), rng.integers(0, n, (2_000, n))
for label in cA:
    d = cA[label] - cB[label]                                # positive = B cheaper
    lo, hi = np.percentile(d[idx].mean(1), [2.5, 97.5])     # paired: same rows for A and B
    ulo, uhi = np.percentile(cA[label][idx].mean(1) - cB[label][idx2].mean(1), [2.5, 97.5])
    print(f"{label:15s} A-B = INR {d.mean():,.0f}  paired 95% CI [{lo:,.0f}, {hi:,.0f}]  "
          f"unpaired [{ulo:,.0f}, {uhi:,.0f}]")
print(f"B's 0.833 on a calibrated scale = {1 / (1 + np.exp(-2 * np.log(0.833 / 0.167))):.3f} on its raw scale")
```

```output
thresholds chosen on validation: {'A': 0.835, 'B': 0.965}
both at 0.833   A INR 9,287  B INR 8,491  errors A 5007 B 2816  McNemar b=918 c=3109 chi2=1191.0
own thresholds  A INR 9,318  B INR 7,608  errors A 5053 B 4092  McNemar b=1351 c=2312 chi2=251.6
both at 0.833   A-B = INR 796  paired 95% CI [448, 1,134]  unpaired [306, 1,309]
own thresholds  A-B = INR 1,710  paired 95% CI [1,393, 2,012]  unpaired [1,286, 2,146]
B's 0.833 on a calibrated scale = 0.961 on its raw scale
```

:::chart[Test cost per case vs threshold: calibrated A vs overconfident B (simulated, 20,000 cases)]{type="line" x="approve when model's P(good) ≥ t" y="cost per case" prefix="₹" xfmt="dec2" xmin="0.5" xmax="1" marks="0.833:shared 0.833;0.965:B's own threshold" note="A is calibrated, so its minimum sits at 0.833. B's raw logits are doubled, so its minimum moves to ≈ 0.96."}
t, A (calibrated), B (overconfident raw)
0.50, 13724, 11188
0.60, 11894, 10336
0.70, 10468, 9611
0.75, 9762, 9242
0.80, 9306, 8782
0.833, 9287, 8491
0.86, 9522, 8332
0.88, 9740, 8225
0.90, 10176, 8041
0.92, 10806, 7888
0.94, 11732, 7643
0.95, 12356, 7590
0.965, 13688, 7608
0.975, 14834, 7750
0.985, 16506, 7951
0.99, 17402, 8268
:::

- **At a shared 0.833, B looks ₹796 better; at its own threshold it is ₹1,710 better** — more than twice the gain. The validation search found 0.965, almost exactly where 0.833 lands on B's doubled-logit scale (0.961). Recalibrating B would put its optimum back at 0.833 and serve the review band too ([§29.3](/c/slm-decision-models/29-metrics)).
- **Pairing narrows the interval by about 28%**: ±₹310 paired vs ±₹430 unpaired at the own thresholds. On a smaller test set that difference decides whether you can ship.
- **Errors went *up* when cost went down.** At its own threshold B makes 4,092 errors instead of 2,816, because it trades bad approvals for cheaper wrong declines. Every error-count metric would have called this a regression.
- **Never tune the threshold on the test set.** The thresholds above come from a separate 10,000-case validation set; tuning on test makes its interval optimistic.

## 30.4 The frontier: cost against latency and size

Once each candidate is scored by cost at its own threshold, add the constraints. The table below is **illustrative**: the separations $d'$ are assumptions standing in for your measured cost per case, the parameter counts are the published sizes, and latencies are the [§3](/c/slm-decision-models/03-slm-fundamentals) floors on its illustrative hardware (encoder: 128 tokens on CPU; decoders: 600-token prompt + 8 tokens, int8, GPU). Cost per case is computed from $d'$ exactly, for a calibrated binormal model at $p^* = 0.833$, plus an illustrative price per call.

```python run
from math import log
from statistics import NormalDist

PHI = NormalDist().cdf
BAD, C_FN, C_FP, P_STAR = 0.20, 120_000, 24_000, 120_000 / 144_000
# name: (params, assumed separation d', latency ms, INR per call).
# d' values are ILLUSTRATIVE assumptions; latencies are the section-3 floors on its illustrative
# hardware (encoder: 128 tokens on CPU; decoders: 600-token prompt + 8 tokens on GPU, int8); API illustrative.
CANDIDATES = {
    "TF-IDF + logistic": ("~1M", 1.80, 2, 0.001),
    "encoder 66M":       ("66M", 2.20, 17, 0.01),
    "Qwen2.5-0.5B":      ("0.49B", 2.30, 25, 0.05),
    "Qwen2.5-1.5B":      ("1.54B", 2.45, 79, 0.15),
    "Qwen2.5-3B":        ("3.09B", 2.48, 157, 0.30),
    "frontier API":      ("n/a", 2.35, 1_200, 2.00),
}


def cost_per_case(d):
    """Binormal scores (bad ~ N(0,1), good ~ N(d,1)), calibrated, approve when P(good) >= p*."""
    x_star = (log(P_STAR / (1 - P_STAR)) - log((1 - BAD) / BAD) + d * d / 2) / d
    return BAD * (1 - PHI(x_star)) * C_FN + (1 - BAD) * PHI(x_star - d) * C_FP


rows = [(n, p, d, ms, fee, cost_per_case(d) + fee) for n, (p, d, ms, fee) in CANDIDATES.items()]
print(f"{'model':18s} {'params':>6s} {'d':>5s} {'ms':>6s} {'INR/call':>8s} {'INR/case':>9s}  Pareto")
for n, p, d, ms, fee, total in rows:
    dominated = any(o[3] <= ms and o[5] <= total and (o[3], o[5]) != (ms, total) for o in rows)
    print(f"{n:18s} {p:>6s} {d:5.2f} {ms:6,d} {fee:8.3f} {total:9,.0f}  {'no' if dominated else 'yes'}")
best = {n: total for n, _, _, ms, _, total in rows}
print(f"1.5B vs encoder: INR {best['encoder 66M'] - best['Qwen2.5-1.5B']:,.0f}/case = "
      f"INR {(best['encoder 66M'] - best['Qwen2.5-1.5B']) * 100_000 / 1e7:.2f} crore/month at 100,000")
print(f"3B vs 1.5B: INR {best['Qwen2.5-1.5B'] - best['Qwen2.5-3B']:,.0f}/case for +{157 - 79} ms")
```

```output
model              params     d     ms INR/call  INR/case  Pareto
TF-IDF + logistic     ~1M  1.80      2    0.001     7,872  yes
encoder 66M           66M  2.20     17    0.010     5,808  yes
Qwen2.5-0.5B        0.49B  2.30     25    0.050     5,355  yes
Qwen2.5-1.5B        1.54B  2.45     79    0.150     4,723  yes
Qwen2.5-3B          3.09B  2.48    157    0.300     4,604  yes
frontier API          n/a  2.35  1,200    2.000     5,140  no
1.5B vs encoder: INR 1,084/case = INR 10.84 crore/month at 100,000
3B vs 1.5B: INR 120/case for +78 ms
```

:::chart[Cost per case vs latency floor — illustrative candidates (assumed quality, §3 latency floors)]{type="scatter" x="latency floor per decision" xunit=" ms" xlog="true" y="cost per case" prefix="₹" points="true" note="Illustrative: d′ assumed, latencies are floors on illustrative hardware. Lower-left is better; the API is dominated by the 1.5B."}
latency ms, TF-IDF + logistic, encoder 66M, Qwen2.5-0.5B, Qwen2.5-1.5B, Qwen2.5-3B, frontier API
2, 7872, -, -, -, -, -
17, -, 5808, -, -, -, -
25, -, -, 5355, -, -, -
79, -, -, -, 4723, -, -
157, -, -, -, -, 4604, -
1200, -, -, -, -, -, 5140
:::

How to read it:

- **A model is dominated** when another is at least as cheap *and* at least as fast. Under these assumptions the prompted API is dominated by the 1.5B (₹5,140 vs ₹4,723 at 15× the latency). Drop dominated models before discussing anything else.
- **In loans, quality dominates the bill.** Error costs are thousands of rupees per case; inference is paise to ₹2. The encoder → 1.5B step is worth ₹1,084 per case (₹10.84 crore a month at 100,000 applications) — far more than any GPU bill. For ticket routing, where a misroute costs ~₹60 ([§9](/c/slm-decision-models/09-hybrid-systems)), the same arithmetic gives inference price real weight.
- **Small gains need big test sets.** The 3B's ₹120 per case over the 1.5B rests on an assumed $d'$. To *detect* ₹120 at 80% power with a per-case difference s.d. of ₹14,144 (the [§14](/c/slm-decision-models/14-notebook-evaluation) notebook's value) needs \(7.849 \times 14{,}144^2 / 120^2\) ≈ 109,041 paired cases; detecting the ₹1,084 step needs about 1,336. Measure before you pay 2× the latency for a gain you cannot see.
- **Size is a hard limit, not a trade-off.** Weights at int8 are about 1 GB per billion parameters: 0.49 GB, 1.54 GB, 3.09 GB. In a 2 GB container the 3B is out at int8 and fits at int4 (1.54 GB) with almost no headroom, regardless of its cost; if it is CPU-only with a 1 s budget, every decoder misses (the 0.5B's CPU decision call is 673 ms *floor*, the 1.5B's 2.1 s) and the encoder wins by default.

## 30.5 Choosing under constraints

Apply the hard limits first, then take the cheapest survivor by cost per case (with a paired CI against the incumbent):

| Constraint | Survivors (from §30.4) | Pick | Why |
| --- | --- | --- | --- |
| CPU only, p95 ≤ 100 ms | TF-IDF, encoder | encoder 66M | decoders' CPU prefill floor is 673 ms+ |
| GPU, p95 ≤ 100 ms | up to 1.5B | Qwen2.5-1.5B | cheapest under the budget; 3B is 157 ms floor |
| GPU, no latency limit | all | 1.5B or 3B | only if the ₹120 gap is measured on ≥ ~110k paired cases |
| Device ≤ 1 GB RAM | TF-IDF, encoder, 0.5B int8 | 0.5B int4 or encoder | measure peak RSS, not weights |
| Data must stay on-prem | all self-hosted | as above | removes the API row entirely |
| No labels yet | API, prompted SLM | API now, then [distil](/c/slm-decision-models/06-distillation) | a bootstrapping problem, not a model choice |
| Needs a reason string | decoders | smallest passing decoder, short constrained JSON | encoders cannot generate |

**Baselines belong in every comparison.** Report the trivial policies (approve-all, decline-all), the incumbent and a cheap classical model (TF-IDF or gradient boosting) next to the candidates. If the SLM does not beat the classical model by more than its paired CI, ship the classical model — that is a successful evaluation.

:::warn[Ways a comparison lies]
Different test sets per model. A shared threshold on uncalibrated scores. Thresholds tuned on the test set. Unpaired intervals compared by eye. Error counts (or McNemar) used as the ship metric when errors have different prices. Leaderboard scores from a different task. Latency measured on different hardware, batch size or prompt length. Comparing a 10-shot prompted API against a fine-tuned model without saying so.
:::

## 30.6 Check yourself

:::qa[McNemar gives b = 40, c = 64 on 5,000 cases. Is B better?]
$\chi^2 = (|40 - 64| - 1)^2 / 104 = 529/104 = 5.09 > 3.84$: B makes significantly fewer errors (p ≈ 0.024). Whether B is *better* depends on what those 104 disagreements cost — weight each by its price and bootstrap the paired cost difference.
:::

:::qa[Candidate B costs more than A at 0.833 but its validation-optimal threshold is 0.95. What do you do?]
Its probabilities are miscalibrated (overconfident if the optimum moved up). Fit a calibrator on validation data, re-check that the optimum returns to ≈ 0.833, then compare both at their own thresholds on test. In §30.3 that more than doubled B's measured advantage, from ₹796 to ₹1,710 per case.
:::

:::qa[Two models differ by ₹300 per case; the per-case difference has s.d. ₹12,000. How many paired cases to detect it at 80% power?]
$n = 7.849 \times 12{,}000^2 / 300^2 \approx 12{,}558$. Unpaired, with per-model s.d. around ₹20,000, each arm would need \(7.849 \times (20{,}000^2 + 20{,}000^2) / 300^2\) ≈ 69,768 — 5.6× as many.
:::

:::qa[The API is 2 points more accurate than the 0.5B on a public benchmark. Should it win?]
Not on that evidence. Score both on your test set as policies (own calibration, own threshold), compute cost per case with a paired CI, and place both on the cost–latency frontier. In §30.4's illustration the API is dominated.
:::

Next: [Optimization](/c/slm-decision-models/31-optimization) — where the time goes, and which lever to pull first.
