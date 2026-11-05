# 20. Decision review, operating playbook, and mastery checklist

This final chapter turns the course into a repeatable engineering decision process. The goal is not to prove that a small language model (SLM) is always preferable. The goal is to choose the least complex system that satisfies the product's quality, latency, privacy, reliability, and cost constraints—and to know when the evidence says not to ship it.

## 20.1 The decision in one sentence

Choose a model-and-system design by minimizing **total expected operating cost** subject to explicit quality and risk constraints.

A useful formulation is:

\[
\begin{aligned}
\min_{a \in \mathcal{A}} \quad & C_{\text{total}}(a) \\
\text{subject to} \quad & Q(a) \ge Q_{\min} \\
& L_{p95}(a) \le L_{\max} \\
& R(a) \le R_{\max} \\
& P(a) \text{ satisfies the data and deployment policy}
\end{aligned}
\]

Here, an *action* \(a\) is a complete architecture—not merely a model name. It may include a small model, retrieval, deterministic rules, a larger-model fallback, human review, caching, and monitoring.

Do not collapse these constraints into one vague score. A system that is cheap but unsafe is not a good trade. A system that is accurate but misses the latency budget is also not feasible.

## 20.2 A disciplined sequence

1. **Specify the decision.** Write down the input, allowed outputs, downstream action, and cost of each error.
2. **Build a baseline.** Use deterministic logic or the simplest existing system before introducing a model.
3. **Create a representative evaluation set.** Include common cases, edge cases, ambiguous inputs, adversarial cases, and examples from real operating conditions.
4. **Compare candidate architectures.** At minimum compare rules, an SLM, a larger model, and a hybrid or escalation design when applicable.
5. **Measure the whole system.** Include preprocessing, retrieval, network, queueing, inference, post-processing, retries, and human review.
6. **Choose thresholds from error costs.** Do not select a confidence threshold because it “looks right.”
7. **Run a shadow or limited canary.** Observe production-like inputs without allowing unreviewed outputs to cause irreversible effects.
8. **Release against gates.** Define quality, latency, cost, privacy, and rollback criteria before launch.
9. **Monitor drift and failures.** Re-evaluate when inputs, policies, traffic, models, or dependencies change.
10. **Revisit the decision.** The correct architecture can change as volume, model prices, hardware, and requirements change.

## 20.3 Worked example: support-ticket routing

Suppose a service routes 100,000 tickets per month into four queues. A wrong automatic route costs an estimated $4 of rework. Human review costs $0.60 per ticket. These are illustrative planning assumptions, not measured industry benchmarks.

Candidate A is a deterministic keyword baseline:
- 82% of tickets are routed correctly.
- All tickets are processed automatically.
- Inference cost is negligible for this comparison.

Candidate B is an SLM:
- 92% of tickets are routed correctly on the held-out evaluation set.
- Estimated inference cost is $0.001 per ticket.
- A human review process is required for 5% of tickets that fail a confidence or policy gate.

Candidate C is a larger model:
- 95% correct on the same evaluation set.
- Estimated inference cost is $0.012 per ticket.
- No review is included in this simplified comparison.

For a first-pass expected-cost calculation, assume the measured accuracy generalizes to production and count only misroute rework, model inference, and the stated review workload. This assumption must be validated with a pilot.

\[
C_{\text{misroute}} = N(1-\text{accuracy})c_{\text{error}}
\]

For the SLM, conservatively assume the 5% review slice is additional human work and the 92% accuracy applies to the remaining automatic decisions. The simplified comparison is:

| Candidate | Misroutes / month | Inference / month | Review / month | Estimated total |
|---|---:|---:|---:|---:|
| Rules baseline | 18,000 | $0 | $0 | $72,000 |
| SLM + 5% review | 8,000* | $100 | $3,000 | $35,100 |
| Larger model | 5,000 | $1,200 | $0 | $21,200 |

\*For comparability, the SLM row uses the 92% error rate across all tickets. A real evaluation must measure the reviewed and auto-approved populations separately; review may catch errors, and its effectiveness must be included rather than assumed.

The larger model has the lowest estimated total under these assumptions. That does **not** settle the decision. If the larger model violates a data residency requirement or the p95 latency budget, it is infeasible. If a hybrid design routes easy cases to the SLM and only uncertain cases to the larger model, it may reduce cost while preserving quality—but that hybrid must be measured as its own candidate.

### Reproduce the arithmetic

The following Python uses only the standard library:

\`\`\`python
from dataclasses import dataclass

@dataclass(frozen=True)
class Candidate:
    name: str
    accuracy: float
    inference_cost_per_ticket: float
    review_fraction: float = 0.0
    review_cost_per_ticket: float = 0.60

def monthly_cost(candidate: Candidate, volume: int, error_cost: float) -> dict:
    errors = volume * (1 - candidate.accuracy)
    inference = volume * candidate.inference_cost_per_ticket
    review = volume * candidate.review_fraction * candidate.review_cost_per_ticket
    return {
        "name": candidate.name,
        "errors": round(errors),
        "inference": round(inference, 2),
        "review": round(review, 2),
        "total": round(errors * error_cost + inference + review, 2),
    }

candidates = [
    Candidate("Rules", 0.82, 0.0),
    Candidate("SLM + review", 0.92, 0.001, 0.05),
    Candidate("Large model", 0.95, 0.012),
]

for candidate in candidates:
    print(monthly_cost(candidate, volume=100_000, error_cost=4.0))
\`\`\`

Expected output:

\`\`\`text
{'name': 'Rules', 'errors': 18000, 'inference': 0.0, 'review': 0.0, 'total': 72000.0}
{'name': 'SLM + review', 'errors': 8000, 'inference': 100.0, 'review': 3000.0, 'total': 35100.0}
{'name': 'Large model', 'errors': 5000, 'inference': 1200.0, 'review': 0.0, 'total': 21200.0}
\`\`\`

The code reproduces the arithmetic, not the validity of the assumptions. In particular, accuracy should be reported with confidence intervals, review effectiveness should be measured, and the evaluation sample should represent production traffic.

## 20.4 Derive a review threshold from error costs

For a binary decision, suppose the model estimates probability \(p\) that an item belongs to the positive class. Let:
- \(C_{FP}\) be the cost of a false positive;
- \(C_{FN}\) be the cost of a false negative.

Predict positive when its expected loss is lower:

\[
(1-p)C_{FP} < pC_{FN}
\]

Rearranging:

\[
p > \frac{C_{FP}}{C_{FP}+C_{FN}}
\]

If a false positive costs $90 and a false negative costs $10, the threshold is:

\[
t = \frac{90}{90+10}=0.90
\]

This is the Bayes decision threshold under the stated assumptions and calibrated probabilities. It is not a universal threshold. If probabilities are miscalibrated, costs are uncertain, or there are abstain/review options, estimate the policy empirically on held-out data.

## 20.5 Add abstention and escalation

A robust classifier need not force a prediction on every input. Define three regions:

- **Auto-approve:** confidence and policy checks pass.
- **Escalate:** uncertainty, novelty, or high consequence requires a larger model or a human.
- **Reject or defer:** input is malformed, out of scope, or unsafe to process.

A simple confidence gate is only a starting point. Confidence must be calibrated on the target distribution, and policy checks must not be replaced by model confidence.

Example policy:

\`\`\`python
def route(probability: float, *, low: float = 0.15, high: float = 0.90) -> str:
    if not 0.0 <= probability <= 1.0:
        raise ValueError("probability must be between 0 and 1")
    if probability >= high:
        return "auto_positive"
    if probability <= low:
        return "auto_negative"
    return "review"

for p in (0.04, 0.42, 0.97):
    print(p, route(p))
\`\`\`

Expected output:

\`\`\`text
0.04 auto_negative
0.42 review
0.97 auto_positive
\`\`\`

In a real system, thresholds should be selected using a validation set and a stated objective such as minimizing expected cost subject to a maximum false-negative rate. Track coverage (the fraction handled automatically) alongside selective risk (error rate among automatically handled cases). A policy that achieves near-zero error by sending every case to a human has zero automation value.

## 20.6 Production release checklist

### Problem and data
- [ ] The decision boundary and permitted outputs are documented.
- [ ] False-positive, false-negative, abstention, and delay costs are defined.
- [ ] Training, validation, and test sets are separated by entity/time where leakage is possible.
- [ ] Sensitive data handling, retention, and residency are approved.
- [ ] The evaluation set includes realistic edge cases and known failure modes.

### Model and system
- [ ] The exact model artifact, tokenizer, prompt, code, and configuration are versioned.
- [ ] Output schema validation is deterministic.
- [ ] Timeouts, retries, rate limits, and fallback behavior are bounded.
- [ ] Retrieval sources and freshness rules are explicit where retrieval is used.
- [ ] Human escalation has an owner and service-level expectation.

### Evidence
- [ ] Quality metrics include per-class results and confidence intervals.
- [ ] Calibration and abstention coverage are measured where probabilities drive decisions.
- [ ] p50, p95, and p99 latency are measured under representative concurrency.
- [ ] Cost includes infrastructure, tokens, retries, review, and operations.
- [ ] Regression tests include adversarial and previously failed examples.

### Operations
- [ ] Dashboards cover quality proxies, latency, volume, cost, and escalation rate.
- [ ] Logs avoid unnecessary sensitive payloads and have retention limits.
- [ ] Drift triggers and reevaluation cadence are documented.
- [ ] Rollback is tested and does not depend on the model being healthy.
- [ ] A named owner can disable automation safely.

## 20.7 Common decision errors

| Error | Why it fails | Better practice |
|---|---|---|
| Choosing by parameter count | Size does not determine task quality or system cost | Evaluate the exact task and deployment |
| Comparing vendor benchmark scores | Datasets, prompts, hardware, and metrics differ | Run a controlled, task-specific benchmark |
| Treating confidence as correctness | Scores may be uncalibrated | Measure calibration and selective risk |
| Ignoring review operations | Human time can dominate inference cost | Include review, queueing, and rework |
| Optimizing average latency | Tail latency drives user experience and SLOs | Measure p50/p95/p99 under load |
| Shipping after one good demo | Demos rarely represent production distributions | Use held-out tests, shadow traffic, and canaries |
| Never revisiting the architecture | Traffic, prices, and requirements change | Schedule periodic decision reviews |

## 20.8 Mastery questions

1. Why is an SLM a system-level choice rather than merely a model-size choice?
2. Derive the binary decision threshold from false-positive and false-negative costs.
3. When can a larger model be economically preferable even if its inference price is higher?
4. What is the difference between coverage and selective risk?
5. Why can a confidence threshold fail after a distribution shift?
6. Which latency components must be included in an end-to-end p95 measurement?
7. What evidence would justify moving a task from human review to automatic SLM handling?
8. Which constraints should be hard release gates rather than weighted terms in a score?

### Suggested answers

1. The deployed behavior depends on routing, retrieval, validation, retries, fallbacks, monitoring, and human review as well as the model.
2. Compare the expected losses of positive and negative predictions; predict positive when \((1-p)C_{FP}<pC_{FN}\), yielding \(p>C_{FP}/(C_{FP}+C_{FN})\).
3. When lower error/rework costs outweigh the higher inference cost, or when quality, risk, or latency requirements rule out the smaller model.
4. Coverage is the fraction auto-handled; selective risk is the error rate among those auto-handled cases.
5. The relationship between score and correctness can change when the input distribution or model behavior changes; recalibration and reevaluation are required.
6. Preprocessing, queueing, network, retrieval, inference, post-processing, retries, and any synchronous review step.
7. Representative held-out and shadow evidence, acceptable selective risk, confidence intervals, stable monitoring, and a safe rollback path.
8. Safety, legal, privacy, residency, and other non-negotiable product constraints.

## 20.9 Further reading

- [A Tutorial on Conformal Prediction](https://arxiv.org/abs/2107.07511) — uncertainty sets and coverage guarantees.
- [On Calibration of Modern Neural Networks](https://arxiv.org/abs/1706.04599) — why confidence scores need calibration.
- [Selective Classification for Deep Neural Networks](https://arxiv.org/abs/1705.08500) — abstention, coverage, and risk.
- [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework) — governance and lifecycle risk practices.

---

**Completion criterion:** you should be able to defend a model/system choice with a reproducible evaluation, a cost model, explicit constraints, a safe escalation policy, and a rollback plan—not simply with a benchmark score or a preference for small models.
