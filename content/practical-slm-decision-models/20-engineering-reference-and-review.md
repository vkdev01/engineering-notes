---
section: "20"
title: "Engineering reference and final review"
kicker: "Reference"
abstract: "Every working formula of the course on one page — decision cut points, regret, EVSI, calibration metrics, sample sizes, cascade cost, memory, KV cache, decode floor, Little's law and PSI — each with its one-line meaning and the section that derives it, followed by the numbers worth remembering, three review checklists and a glossary."
time: "25 min"
order: 20
outcomes:
  - "Look up and apply the formula for any threshold, sizing or monitoring question in the course"
  - "Recompute the course's anchor numbers (0.833, [0.125, 0.975], ₹20,000, 31.5 ms, 16,475) from first principles"
  - "Run a design review, a release review and an operations review from checklists"
  - "Explain each term in the glossary with the number that makes it concrete"
---

This is the page to keep open in a design review. When someone asks "why 0.83 and not 0.5?", "will it fit in 4 GB?", "how many replicas?", "how many labels?" or "is this drift real?", the answer is one formula and two inputs away. Each formula below links to the section that derives it; the derivations are not repeated here.

:::key[First principle]
A decision system turns a **calibrated probability** and a **cost matrix** into an action, under three physical budgets: **bytes** (memory and bandwidth set what fits and how fast it decodes), **time** (queues set the tail) and **labels** (sample size sets what you can prove). Every formula on this page is one of those four things.
:::

Symbols used throughout: $p = P(\text{good} \mid x)$ for the loan case, $c_{FP}$ = cost of approving a bad case (₹120,000), $c_{FN}$ = cost of declining a good case (₹24,000), $r$ = cost of one review, $\hat p$ a model's calibrated probability, $N$ or $n$ a count of cases.

## 20.1 The workflow and where each step lives

| # | Step | Artifact it produces | Section |
|---:|---|---|---|
| 1 | Define the decision, actions (incl. review/abstain) and observable outcome | Action set, outcome definition | [§1](/c/practical-slm-decision-models/01-what-a-decision-model-is) |
| 2 | Write the cost matrix in currency, signed by its owner | $c_{FP}$, $c_{FN}$, $r$; derived $p^*$, $p_{lo}$, $p_{hi}$, $r_{max}$ | [§4](/c/practical-slm-decision-models/04-decision-theory) |
| 3 | Decide whether a model, and an SLM, is warranted | Rubric score, break-even $V^*$ | [§5](/c/practical-slm-decision-models/05-why-slms), [§15](/c/practical-slm-decision-models/15-use-cases-and-domain-fit) |
| 4 | Size the model against memory and latency budgets | Bytes, KV cache, prefill/decode floors | [§3](/c/practical-slm-decision-models/03-slm-fundamentals) |
| 5 | Build the model: prompt, distil or fine-tune | Model + prompt template | [§6](/c/practical-slm-decision-models/06-distillation), [§8](/c/practical-slm-decision-models/08-fine-tuning-and-adaptation), [§9](/c/practical-slm-decision-models/09-prompt-engineering) |
| 6 | Calibrate on a held-out calibration split | Calibrator, reliability diagram, ECE, Brier | [§7](/c/practical-slm-decision-models/07-probabilities-and-calibration) |
| 7 | Compose with rules, larger models and people | Cascade, escalation threshold, budgets | [§10](/c/practical-slm-decision-models/10-hybrid-architectures) |
| 8 | Evaluate against a gate written in advance | Paired CI, Wilson bounds, slices, verdict | [§11](/c/practical-slm-decision-models/11-evaluation-and-release-gates) |
| 9 | Test contracts, properties, shadow and canary | Test suite, canary plan | [§12](/c/practical-slm-decision-models/12-testing-decision-systems) |
| 10 | Serve: replicas, batching, deadlines, bundle | Capacity plan, versioned bundle | [§13](/c/practical-slm-decision-models/13-serving-and-deployment) |
| 11 | Benchmark honestly | p50/p95/p99 at stated $\lambda$, quality-adjusted cost | [§14](/c/practical-slm-decision-models/14-benchmarking-and-performance) |
| 12 | Monitor, troubleshoot, contain | PSI and calibration alarms, runbooks | [§19](/c/practical-slm-decision-models/19-troubleshooting-and-failure-modes) |

## 20.2 Decisions

**Bayes action.** Choose the action with the lowest expected cost under the posterior. Everything else in this subsection is a special case. — [§4.1](/c/practical-slm-decision-models/04-decision-theory)

$$
a^*(x) = \arg\min_{a \in \mathcal{A}} \; \sum_{o} P(o \mid x)\, c(a, o)
$$

**Two-action threshold.** Approve when $p$ exceeds the cost ratio; with the loan costs, $p^* = 120{,}000/144{,}000 = 0.833$. — [§4.2](/c/practical-slm-decision-models/04-decision-theory)

$$
p^* = \frac{c_{FP}}{c_{FP} + c_{FN}}
$$

**Three-action cut points.** Decline below $p_{lo}$, approve above $p_{hi}$, review between. At a realistic review price $r$ = ₹3,000 the band is $[0.125, 0.975]$. — [§4.3](/c/practical-slm-decision-models/04-decision-theory)

$$
p_{lo} = \frac{r}{c_{FN}}, \qquad p_{hi} = 1 - \frac{r}{c_{FP}}
$$

**When the review band vanishes.** If a review costs at least the automatic actions' cost at their crossing point, review is never optimal: here ₹20,000. — [§4.3](/c/practical-slm-decision-models/04-decision-theory)

$$
r_{max} = \frac{c_{FP}\,c_{FN}}{c_{FP} + c_{FN}}
$$

**Multi-class review rule.** With $K$ queues, a misroute cost $C_{\text{err}}$ and a reviewer who routes correctly, send to review when the best queue's expected error costs more than the review: with $C_{\text{err}}$ = ₹60 and review ₹40, review only when $p_{\max} < 1/3$. — [§15](/c/practical-slm-decision-models/15-use-cases-and-domain-fit), [Appendix A](/c/practical-slm-decision-models/20-decision-review-and-mastery)

$$
\text{review} \iff (1 - p_{\max})\,C_{\text{err}} > c_{\text{review}}
$$

**Regret.** Extra expected cost over an oracle that knows the true posterior; splits into belief error (the ML team's) and constraint regret (whoever set the cap). — [§4.6](/c/practical-slm-decision-models/04-decision-theory)

$$
\text{Regret}(\pi) = \frac{1}{N}\sum_{i=1}^{N} \Big( \mathbb{E}\big[c \mid \pi(x_i), p_i^{\text{true}}\big] - \min_{a} \mathbb{E}\big[c \mid a, p_i^{\text{true}}\big] \Big)
$$

**Expected value of sample information.** Buy a signal only if deciding after it, net of its price, beats deciding now; value exists only where a signal outcome can move the posterior across a cut point. — [§4.7](/c/practical-slm-decision-models/04-decision-theory)

$$
\text{EVSI} = \min_a \mathbb{E}[c \mid a, p] - \sum_{z} P(z)\, \min_a \mathbb{E}\big[c \mid a, P(\text{good} \mid z)\big] - c_{\text{signal}}
$$

**Robust criteria** when neither $p$ nor costs are trusted: maximin minimises the worst case; minimax regret minimises the worst shortfall versus hindsight. — [§4.8](/c/practical-slm-decision-models/04-decision-theory)

$$
\arg\min_a \max_{s \in S} c(a, s) \qquad\qquad \arg\min_a \max_{s \in S} \Big( c(a, s) - \min_{a'} c(a', s) \Big)
$$

## 20.3 Probabilities and calibration

**Logit, sigmoid, softmax with temperature.** Temperature divides every logit by one fitted number; it changes confidence, never the ranking. — [§7.1](/c/practical-slm-decision-models/07-probabilities-and-calibration), [§7.4](/c/practical-slm-decision-models/07-probabilities-and-calibration)

$$
\hat p = \sigma(z) = \frac{1}{1 + e^{-z}}, \qquad \hat p_k(T) = \frac{e^{z_k / T}}{\sum_j e^{z_j / T}}
$$

**Expected calibration error.** Count-weighted gap between confidence and observed rate per bin; even a perfect model shows about $1/\sqrt{N}$ on $N$ cases. — [§7.3](/c/practical-slm-decision-models/07-probabilities-and-calibration)

$$
\text{ECE} = \sum_{b=1}^{B} \frac{|B_b|}{N}\,\bigl|\text{acc}(B_b) - \text{conf}(B_b)\bigr|
$$

**Brier score and log loss.** Proper scoring rules: minimised in expectation only by the true probability, so they reward calibration and sharpness together. — [§7.3](/c/practical-slm-decision-models/07-probabilities-and-calibration)

$$
\text{Brier} = \frac{1}{N}\sum_{i}(\hat p_i - y_i)^2, \qquad \text{LogLoss} = -\frac{1}{N}\sum_i \bigl[y_i \log \hat p_i + (1-y_i)\log(1-\hat p_i)\bigr]
$$

**Prior-shift correction.** When only the base rate moves from $\pi$ to $\pi'$, rescale the odds; 0.90 at $\pi = 0.70$ becomes 0.825 at $\pi' = 0.55$ and flips an approval. — [§7.7](/c/practical-slm-decision-models/07-probabilities-and-calibration)

$$
\frac{p'}{1-p'} = \frac{p}{1-p} \times \frac{\pi'/(1-\pi')}{\pi/(1-\pi)}
$$

**Wilson interval** for a rate $\hat p = k/n$; gate on its upper bound for rare, expensive errors. — [§11.6](/c/practical-slm-decision-models/11-evaluation-and-release-gates)

$$
\frac{\hat p + \frac{z^2}{2n} \pm z\sqrt{\frac{\hat p(1-\hat p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}
$$

## 20.4 Evaluation, experiments and monitoring

**Empirical decision cost.** The release metric: average realised cost of the policy's actions on held-out cases. — [§11.3](/c/practical-slm-decision-models/11-evaluation-and-release-gates)

$$
\hat R(\pi) = \frac{FN \cdot c_{FN} + FP \cdot c_{FP} + \#\text{reviews} \cdot r}{N}
$$

**Cases needed to detect a difference $\delta$** at two-sided $\alpha = 0.05$ and power 0.8, where $(z_{0.975} + z_{0.8})^2 = 7.849$. Paired evaluation uses $\sigma_d$; unpaired uses $\sigma_A^2 + \sigma_B^2$ per arm. — [§11.5](/c/practical-slm-decision-models/11-evaluation-and-release-gates)

$$
n = \frac{\big(z_{1-\alpha/2} + z_{1-\beta}\big)^2 \, \sigma_d^2}{\delta^2}
$$

**Smallest detectable change in a canary** with $n_c$ canary and $n_b$ baseline cases at base rate $p$. — [§12](/c/practical-slm-decision-models/12-testing-decision-systems)

$$
\Delta_{\min} = (z_{0.975} + z_{0.80})\sqrt{p(1-p)\left(\frac{1}{n_c} + \frac{1}{n_b}\right)}
$$

**Population stability index** between reference shares $e_i$ and current shares $a_i$ over $B$ bins, and its no-drift noise floor. Set the alarm from the floor, not from a fixed 0.1. — [§19.3](/c/practical-slm-decision-models/19-troubleshooting-and-failure-modes)

$$
\text{PSI} = \sum_{i=1}^{B} (a_i - e_i)\ln\frac{a_i}{e_i}, \qquad \mathbb{E}[\text{PSI} \mid \text{no drift}] \approx (B-1)\left(\frac{1}{n_{ref}} + \frac{1}{n_{cur}}\right)
$$

## 20.5 Routing and cascades

**Cascade running cost.** Stage $k$ costs $c_k$ and passes on a fraction $q_k$; the rarest, most expensive stage usually dominates. — [§10.2](/c/practical-slm-decision-models/10-hybrid-architectures)

$$
E[C] = \sum_{k} c_k \prod_{j<k} q_j, \qquad E[\text{total}] = E[C] + C_{\text{err}} \cdot P(\text{misroute})
$$

**Escalation threshold.** Accept the SLM's answer when its calibrated confidence $s$ is at least the next stage's accuracy minus its price in error units: $0.961 - 2/60 = 0.928$ in §10. — [§10.4](/c/practical-slm-decision-models/10-hybrid-architectures)

$$
s \ge a - \frac{c_L}{C_{\text{err}}}
$$

**Constrained threshold.** Minimise total cost subject to a risk budget and the next stage's quota. — [§10.4](/c/practical-slm-decision-models/10-hybrid-architectures)

$$
t^\star = \arg\min_t \; E[\text{total}](t) \quad\text{s.t.}\quad \text{risk}(t) \le \rho,\;\; \text{esc}(t)\cdot N \le K_{\text{LLM}}
$$

**Effective cost per decision** — what to compare across architectures. — [§14.7](/c/practical-slm-decision-models/14-benchmarking-and-performance)

$$
C_{\text{effective}} = C_{\text{inference}} + r_{\text{review}}\,C_{\text{review}} + C_{\text{retry}} + \mathbb{E}[C_{\text{error}}]
$$

**API cost and break-even volume.** Tokens × price × (1 + retry share) × FX per decision; self-hosting pays above $V^* = F / c_{\text{API}}$, where $F$ is the self-hosted monthly floor. — [§5](/c/practical-slm-decision-models/05-why-slms)

$$
c_{\text{API}} = \frac{t_{in}\,P_{in} + t_{out}\,P_{out}}{10^6}\,(1 + \rho)\,\text{FX}, \qquad V^* = \frac{F}{c_{\text{API}}}
$$

## 20.6 Bytes and time

**Weight memory.** Parameters × bytes per parameter: 4 (fp32), 2 (bf16), 1 (int8), about 0.53 (int4 with one fp16 scale per 64 weights). — [§3.2](/c/practical-slm-decision-models/03-slm-fundamentals)

$$
M_{\text{weights}} \approx P \times b_w
$$

**KV cache.** Two tensors (K and V) per layer per KV head per token; GQA ($h_{kv} < h$) is what keeps it small. Qwen2.5-0.5B in bf16: 12,288 bytes per token. — [§3.3](/c/practical-slm-decision-models/03-slm-fundamentals)

$$
\text{KV bytes} = 2 \times L \times h_{kv} \times d_h \times T_{\text{seq}} \times B \times \text{bytes per element}
$$

**Replica memory budget.** Weights, runtime overhead, KV for the batch, activations. — [§13.6](/c/practical-slm-decision-models/13-serving-and-deployment)

$$
M \approx P\,b_w + 0.18\,P\,b_w + B \cdot n_{\text{ctx}} \cdot 2\,n_{\text{layer}}\,h_{kv}\,d_{\text{head}}\,b_{kv} + \text{activations}
$$

**Decode floor** (memory-bound: every weight read once per token) and **prefill floor** (compute-bound: $2P$ FLOPs per prompt token). — [§3.4–3.5](/c/practical-slm-decision-models/03-slm-fundamentals), [§13.1](/c/practical-slm-decision-models/13-serving-and-deployment)

$$
t_{\text{decode}} \approx n_{\text{out}} \cdot \frac{P \cdot b_w + \text{KV bytes read}}{BW}, \qquad t_{\text{prefill}} \approx \frac{2\,P\,n_{\text{prompt}}}{F}
$$

**Batched decode step (roofline).** A step is bound by bytes or by FLOPs, whichever is slower; batching raises throughput until the FLOPs catch up. — [§14.5](/c/practical-slm-decision-models/14-benchmarking-and-performance)

$$
t_{\text{step}}(b) = \max\!\left(\frac{P\,b_w + b\,n_{\text{ctx}}\,k_{\text{kv}}}{BW},\ \frac{2P\,b}{F}\right)
$$

**Little's law and replicas.** Requests in service equal arrival rate × time in service; size replicas at a target utilisation. — [§13.3](/c/practical-slm-decision-models/13-serving-and-deployment)

$$
L = \lambda W, \qquad N_{\text{replicas}} = \left\lceil \frac{\lambda S}{\rho_{\text{target}}} \right\rceil
$$

**Waiting time (M/G/1).** Queueing delay grows as $\rho/(1-\rho)$ — 1.5 at $\rho = 0.6$, 5.7 at $\rho = 0.85$. — [§13.4](/c/practical-slm-decision-models/13-serving-and-deployment)

$$
W = \bar S + \frac{\rho\,\bar S\,(1 + c_s^2)}{2(1-\rho)}, \qquad \rho = \lambda \bar S
$$

**Deadline admission.** With deadline $D$ and service time $S$, a request queued behind more than $q_{\max}$ others will miss anyway; reject or fall back at the door. — [§13.7](/c/practical-slm-decision-models/13-serving-and-deployment)

$$
q_{\max} = \left\lfloor \frac{D - S}{S} \right\rfloor
$$

**End-to-end latency** is a sum of stages; means add, percentiles do not — decompose the tail conditionally on requests above the percentile. — [§19.4](/c/practical-slm-decision-models/19-troubleshooting-and-failure-modes)

$$
T_{\text{total}} = \sum_i T_i
$$

## 20.7 Training, briefly

**Distillation loss.** Hard-label cross-entropy plus temperature-softened KL to the teacher; the $T^2$ keeps the soft term's gradient on the same scale. — [§6](/c/practical-slm-decision-models/06-distillation)

$$
\mathcal{L} = \alpha\, \mathrm{CE}\big(y,\ \sigma(z_s)\big) + (1-\alpha)\, T^2\, \mathrm{KL}\Big(\sigma(z_t / T)\ \big\Vert\ \sigma(z_s / T)\Big)
$$

**LoRA.** Freeze $W$ and learn a rank-$r$ update; trainable parameters drop from $d_{out} d_{in}$ to $r(d_{in} + d_{out})$. — [§8](/c/practical-slm-decision-models/08-fine-tuning-and-adaptation)

$$
h = W x + \frac{\alpha}{r} B A x
$$

## 20.8 Numbers to remember

Recompute the anchors from their formulas whenever an input changes:

```python run
"""The course's key numbers, recomputed from their formulas."""
from math import ceil, log
from statistics import NormalDist, pstdev

C_FP, C_FN = 120_000, 24_000
print("p* = %.4f" % (C_FP / (C_FP + C_FN)))
for r in (900, 3_000):
    print("review %5d: band [%.4f, %.4f]" % (r, r / C_FN, 1 - r / C_FP))
print("review band vanishes at r_max = %.0f" % (C_FP * C_FN / (C_FP + C_FN)))
print("ticket review pays when 1 - p_max > 40/60 = %.3f" % (40 / 60))
print("cascade E[C] = %.3f" % (0.001 + 0.70 * 0.05 + 0.70 * 0.15 * 2.00 + 0.70 * 0.15 * 0.20 * 40))
print("escalation threshold t = %.3f" % (0.961 - 2 / 60))
L = 40 * 0.0468
print("Little: L = %.2f busy, replicas at 60%% = %d" % (L, ceil(L / 0.6)))
print("KV bytes/token Qwen2.5-0.5B bf16 = %d" % (2 * 24 * 2 * 64 * 2))
print("decode floor 1.5B int8 @50 GB/s = %.1f ms/token" % (1.573e9 / 50e9 * 1e3))
print("prefill 1.5B, 600 tokens @1 TFLOP/s = %.2f s" % (2 * 1.544e9 * 600 / 1e12))
z = NormalDist().inv_cdf
k = (z(0.975) + z(0.80)) ** 2
sd = pstdev([120_000] * 70 + [24_000] * 50 + [-24_000] * 300 + [0] * 9_580)   # section 11 pairs
print("(z.975+z.80)^2 = %.3f; n for sd %.0f, delta 240 = %d" % (k, sd, ceil(k * sd ** 2 / 240 ** 2)))
odds = 0.9 / 0.1 * (0.55 / 0.45) / (0.70 / 0.30)
print("prior shift 0.90 at 0.70 -> %.3f at 0.55" % (odds / (1 + odds)))
a, b = [0.10] * 10, [0.08] * 5 + [0.12] * 5            # 2-point move in half the deciles
print("PSI example = %.4f" % sum((y - x) * log(y / x) for x, y in zip(a, b)))
```

```output
p* = 0.8333
review   900: band [0.0375, 0.9925]
review  3000: band [0.1250, 0.9750]
review band vanishes at r_max = 20000
ticket review pays when 1 - p_max > 40/60 = 0.667
cascade E[C] = 1.086
escalation threshold t = 0.928
Little: L = 1.87 busy, replicas at 60% = 4
KV bytes/token Qwen2.5-0.5B bf16 = 12288
decode floor 1.5B int8 @50 GB/s = 31.5 ms/token
prefill 1.5B, 600 tokens @1 TFLOP/s = 1.85 s
(z.975+z.80)^2 = 7.849; n for sd 10996, delta 240 = 16475
prior shift 0.90 at 0.70 -> 0.825 at 0.55
PSI example = 0.0405
```

| Number | Value | What it tells you | From |
|---|---:|---|---|
| Loan approve threshold $p^*$ | 0.833 | Not 0.5; at 0.5 the loan book costs ₹9,922 vs ₹6,775 per case (+46%) | §4.2, §4.5 |
| Cost curve flatness | 0.75–0.90 within 6.4% | Get the cost *ratio* right within ~2×; don't chase decimals | §4.5 |
| Review band at ₹900 / ₹3,000 | [0.0375, 0.9925] / [0.125, 0.975] | Review shares 79.7% / 58.6% — a staffing plan, not a detail | §4.3–4.4 |
| Review band vanishes at | ₹20,000 | Above $r_{max}$ any review share is a policy bug | §4.3 |
| EVSI of a ₹250, 90% signal at $p$ = 0.90 | ₹1,010 per case | Buy information only near cut points | §4.7 |
| Temperature scaling on overconfident logits | ECE 0.115 → 0.025, cost −26% | One parameter, no retraining; refit every release | §7.5 |
| ECE of a *perfect* model on 1,000 cases | 0.031 | ECE below ~$1/\sqrt{N}$ is noise | §7.6 |
| Labels near $p^*$ for a ±0.025 check | ~800 | Size calibration sets by the bins that decide | §7.6 |
| Weight memory per billion parameters | 2 / 1 / ~0.5 GB | bf16 / int8 / int4 | §3.2 |
| KV cache, Qwen2.5-0.5B, bf16 | 12 KiB per token | 50 MB at 4k tokens; small for decision prompts | §3.3 |
| Decode floor, 1.5B int8, 50 GB/s | 31.5 ms per token | Latency is bytes moved ÷ bandwidth | §3.4 |
| Prefill share of a CPU decision | 88–89% | Shorten the prompt before quantising further | §3.5 |
| Replicas at 40 req/s × 46.8 ms, 60% target | 4 | Little's law, then +1 for failure | §13.3 |
| Samples for a stable p99 | ≥ 10,000 | ≥ 100 beyond the percentile | §14.4 |
| Paired cases to detect ₹240/case | 16,475 | Unpaired needs 2.4× per arm | §11.5 |
| Cascade running cost | ₹1.086 per ticket | People are 2.1% of tickets and 77% of the bill | §10.2 |
| Escalation threshold | 0.928 | $a - c_L/C_{\text{err}}$ with $a$ = 0.961, ₹2, ₹60 | §10.4 |
| Cascade vs single models (simulated) | ₹2.57 vs ₹4.31 / ₹4.32 per ticket | Composition beats either model alone | §10.4 |
| 5% canary for 7 days at 3.6% misroutes | detects +1.6 pp | Canaries catch only large regressions | §12 |
| PSI noise floor, 20k ref / 5k weekly, 10 bins | 0.00225 (99th pct 0.0067) | A 15-point base-rate fall peaks at PSI ≈ 0.05 | §19.3 |

## 20.9 Review checklists

### Before training (design review)

- [ ] Actions enumerated, including a safe fallback; outcome observable with a known lag
- [ ] Cost matrix in currency with a named owner; $p^*$, $p_{lo}$, $p_{hi}$, $r_{max}$ derived
- [ ] Review priced at its full cost (salary, queue, SLA); review share × volume ÷ throughput ≤ headcount
- [ ] Rules and incumbent baselines measured; break-even $V^*$ below expected volume
- [ ] Model sized: weights + KV + runtime fit the target with headroom; prefill + decode floor under the latency budget
- [ ] Data residency, privacy and permissions settled before any data moves

### Before shipping (release review)

- [ ] Gate document signed before the run: minimum effect, slices, thresholds
- [ ] Group/time split; evaluation size has ≥ 80% power at the minimum effect
- [ ] Calibrated on a separate split; reliability diagram, ECE and Brier attached
- [ ] Paired CI on cost difference vs baseline excludes zero; Wilson bounds on rare-error rates
- [ ] Pre-registered slices reported with $n$ and CI; none regresses beyond the gate
- [ ] p95/p99 at production $\lambda$ with ≥ 10,000 samples; parse-failure rate measured
- [ ] Bundle (weights, tokenizer, prompt, calibrator, policy) versioned as one artifact; rollback tested

### After shipping (operations review)

- [ ] PSI on calibrated scores with the alarm set from the no-drift floor; mean $p$ vs EM base rate tracked
- [ ] Realised cost per case computed as labels mature, with the same cost matrix as the policy
- [ ] Action shares, review share and escalation share (wanted and allowed) on one dashboard
- [ ] Per-stage latency logged; tail decomposed conditionally on requests above p95
- [ ] Containment actions documented and rehearsed; one person can disable automation
- [ ] Cost matrix and architecture re-reviewed when volume, prices or policy change

## 20.10 Glossary

| Term | Meaning | Concrete anchor |
|---|---|---|
| Decision model | A model plus a policy that maps calibrated probabilities to actions by expected cost | Loan triage: decline / review / approve |
| Cost matrix | Cost of every (action, outcome) pair, in currency | ₹120,000 bad approval; ₹24,000 declined good |
| $p^*$ | Two-action threshold, the cost ratio | 0.833 |
| Review band | $[p_{lo}, p_{hi}]$ where review beats both automatic actions | [0.125, 0.975] at ₹3,000 |
| $r_{max}$ | Review price above which the band vanishes | ₹20,000 |
| Regret | Expected cost above an unconstrained oracle with true probabilities | Belief vs constraint split, §4.6 |
| EVSI | Value of a signal before acting, net of its price | ₹1,010 for a ₹250 pull at $p$ = 0.90 |
| Calibration | $P(Y{=}1 \mid \hat p = p) = p$ | Required for any cost-derived threshold |
| ECE | Count-weighted mean gap between confidence and accuracy per bin | Perfect model on 1,000 cases: 0.031 |
| Brier score | Mean squared error of probabilities; proper scoring rule | Lower is better; rewards calibration and sharpness |
| Temperature scaling | Divide logits by one fitted $T$ | $T$ = 2.44 recovered a ×2.5 distortion |
| Prior (label) shift | Base rate changes, $P(x \mid y)$ does not | 0.90 → 0.825 when $\pi$ falls 0.70 → 0.55 |
| Coverage / selective risk | Share handled automatically / error rate among those | Read off the coverage–risk curve, §10.4 |
| Cascade | Stages tried in order, each passing on what it is unsure of | Rules → SLM → LLM → people |
| Escalation budget | Cap on the share escalated per window, overflow to a safe default | Holds LLM traffic at 25% during a storm |
| Bundle | Weights + tokenizer + prompt + calibrator + policy, versioned together | Rollback restores all of it |
| Prefill / decode | Prompt processing (compute-bound) / token generation (bandwidth-bound) | 1.85 s for a 600-token prompt / 31.5 ms per token, 1.5B int8 on the illustrative CPU |
| KV cache | Stored keys and values of previous tokens | 12 KiB/token for Qwen2.5-0.5B bf16 |
| GQA | Several query heads share one K/V head | 7× smaller KV cache for Qwen2.5-0.5B |
| Little's law | $L = \lambda W$ | 1.87 requests in service at 40 req/s |
| Coordinated omission | Load generator pauses during stalls, hiding the tail | Use open-loop load, §14.3 |
| Shadow / canary | New version scores live traffic without acting / acts on a small share | 5% for 7 days detects +1.6 pp |
| PSI | Symmetric KL between binned distributions | Noise floor $(B-1)(1/n_{ref} + 1/n_{cur})$ |
| Distillation | Train a student on a teacher's soft labels | Loss with $T^2$-scaled KL, §6 |
| LoRA | Low-rank trainable update on frozen weights | 2.65 GB vs 19.77 GB to fine-tune 1.236B, §8 |

## 20.11 Check yourself

:::qa[Accepting a bad case costs 100 and rejecting a good case costs 10. What is the accept threshold on P(good)?]
Accept when $100(1-p) \le 10p$, i.e. $p \ge 100/110 = 0.909$. The threshold is the cost of the error you make by accepting, over the sum of both error costs — far above 0.5 because accepting a bad case is ten times worse.
:::

:::qa[Review now costs ₹25,000 per case because it requires a field visit. What happens to the loan policy's review band?]
It vanishes: $r = 25{,}000 > r_{max} = 20{,}000$. At $p^* = 0.833$ both automatic actions cost ₹20,000 in expectation, so a ₹25,000 review is beaten everywhere. The policy becomes approve/decline at 0.833; spend the field-visit budget only where EVSI says the visit changes the action.
:::

:::qa[A 3B model in int8 must decode 12 tokens within 500 ms on a 50 GB/s CPU. Feasible before prefill?]
Decode floor is about $3.09\ \text{GB} / 50\ \text{GB/s} \approx 62$ ms per token (§3.4 lists 62.5 ms with a 1k-token cache), so 12 tokens take about 750 ms — infeasible on decode alone, and prefill adds seconds on this CPU. Shrink the model, move to a GPU, or make the first token decide.
:::

:::qa[Your evaluation has 10,000 paired cases with σ_d = ₹10,996. What is the smallest cost improvement it can detect with 80% power?]
Solve $n = 7.849\,\sigma_d^2/\delta^2$ for $\delta$: $\delta = 10{,}996 \times \sqrt{7.849/10{,}000} \approx ₹308$ per case. §11.5 rounds this to "≥ ₹310". A claimed ₹240 improvement is below what this set can reliably detect.
:::

:::qa[Weekly PSI on scores is 0.006 with 20,000 reference and 5,000 weekly cases over 10 bins. Alarm?]
No. The expected no-drift PSI is $9 \times (1/20{,}000 + 1/5{,}000) = 0.00225$ and the simulated 99th percentile is 0.0067; 0.006 is inside normal noise. Watch for two consecutive weeks above 0.0067, and check mean $p$ against the EM base rate.
:::

## 20.12 Further reading

- Christopher M. Bishop, *Pattern Recognition and Machine Learning* — probabilistic modelling and decision theory.
- Kevin P. Murphy, *Probabilistic Machine Learning: An Introduction* — statistical foundations.
- Guo, Pleiss, Sun and Weinberger, "On Calibration of Modern Neural Networks" (2017) — temperature scaling.
- Hinton, Vinyals and Dean, "Distilling the Knowledge in a Neural Network" (2015) — knowledge distillation.
- Saerens, Latinne and Decaestecker, "Adjusting the Outputs of a Classifier to New a Priori Probabilities" (2002) — prior-shift correction by EM.
- NIST AI Risk Management Framework — governance and lifecycle risk.
- OWASP Top 10 for LLM Applications — application-level threat patterns.

Next: put it all to work in a full decision review — [Appendix A · Decision review and mastery checklist](/c/practical-slm-decision-models/20-decision-review-and-mastery).
