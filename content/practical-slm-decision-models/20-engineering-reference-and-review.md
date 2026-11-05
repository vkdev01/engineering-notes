---
section: "20"
title: "Engineering reference and final review"
kicker: "Mastery"
abstract: "Consolidate the decision workflow into reusable checklists, equations, review questions, and a practical model-selection rubric."
time: "20 min"
order: 20
outcomes:
  - "Apply a repeatable SLM go/no-go decision process"
  - "Recall the core equations and engineering trade-offs"
  - "Explain the complete system to a reviewer or interviewer"
---
# 20.1 The complete decision workflow

Use this sequence for a new SLM proposal:

1. Define the decision and the real-world outcomes.
2. Enumerate allowed actions, including review/abstain.
3. Build a cost matrix with domain owners.
4. Establish deterministic and incumbent baselines.
5. Create a representative, leakage-resistant dataset.
6. Decide whether a model is needed and whether an SLM is sufficient.
7. Train/adapt only if prompting or rules are inadequate.
8. Calibrate probabilities on validation data.
9. Select a policy by expected cost subject to risk constraints.
10. Test contracts, boundaries, adversarial inputs, and failure paths.
11. Benchmark the full service under realistic load.
12. Canary, monitor, and preserve rollback capability.

## 20.2 Core equations

**Expected decision cost**

\[
R(\pi)=\mathbb{E}_{x,y}[C(\pi(x),y)]
\]

**Bayes-optimal action under a known posterior**

\[
a^*(x)=\arg\min_a\sum_y C(a,y)P(y\mid x)
\]

**Expected cascade cost** for an SLM cost c_s, large-model cost c_l, and escalation probability q:

\[
E[C]=c_s+q c_l
\]

**Brier score**

\[
\frac{1}{N}\sum_i(p_i-y_i)^2
\]

**Weight memory lower bound**

\[
M\approx P\times b/8
\]

**Little's Law**

\[
L=\lambda W
\]

These equations answer different questions: decision quality, routing economics, probability quality, hardware sizing, and queue behaviour. Do not substitute one for another.

## 20.3 Model-selection rubric

| Option | Choose it when |
|---|---|
| Rules / deterministic code | Exact logic, arithmetic, permissions, stable patterns |
| Retrieval / database | Facts must be current, attributable, or exact |
| Small language model | Bounded language task, high volume, local/low-latency needs |
| Larger model | Small model misses required quality on complex cases |
| Human review | Ambiguous evidence or high-impact decisions |
| Hybrid cascade | Most cases are easy, difficult cases can be escalated safely |

A hybrid system is not automatically superior. Its added routing, monitoring, and failure modes must earn their complexity.

## 20.4 Review questions

1. Explain why a decision model is not simply a classifier.
2. Derive the cost-sensitive threshold for two actions from their expected costs.
3. What does calibration tell you that accuracy does not?
4. Why are raw self-reported LLM confidence values not automatically probabilities?
5. How can distillation reduce serving cost, and what capability can be lost?
6. When is retrieval better than fine-tuning?
7. What is the difference between validation and test data?
8. Why can a model with better F1 have worse expected cost?
9. What does a risk-coverage curve help you choose?
10. Why is prompt injection a system-security issue rather than just a prompt-writing issue?
11. What is the difference between TTFT and end-to-end latency?
12. What evidence should be in a model release manifest?

## 20.5 Short worked decision derivation

Suppose there are two actions, accept and reject, and two outcomes, good and bad. Let:

- accepting a bad case cost 100;
- rejecting a good case cost 10;
- correct actions cost 0.

Let p = P(good | x).

Expected cost of accept:

\[
C(accept)=100(1-p)
\]

Expected cost of reject:

\[
C(reject)=10p
\]

Accept when:

\[
100(1-p)\leq10p
\]

\[
100\leq110p\quad\Rightarrow\quad p\geq0.9091
\]

The optimal threshold is about 0.91, not 0.5. This is the central idea of the course: model probabilities become useful decisions only after combining them with consequences.

## 20.6 Final go/no-go review

A reviewer should be able to answer "yes" to all of the following:

- Is the task bounded and the intended use documented?
- Is there a cost matrix and a credible non-model baseline?
- Is the evaluation representative and leakage-resistant?
- Are probabilities calibrated or is uncertainty handled safely?
- Does the chosen policy meet expected-cost and risk constraints?
- Are all side effects separately authorized?
- Are tests, benchmarks, monitoring, and rollback in place?
- Can the team reproduce the exact deployed artifact?

If any critical answer is no, the correct decision may be to delay launch, narrow the use case, or use a deterministic/human process instead.

## 20.7 Further reading

- Christopher M. Bishop, *Pattern Recognition and Machine Learning* — probabilistic modelling and decision theory.
- Kevin P. Murphy, *Probabilistic Machine Learning: An Introduction* — statistical foundations.
- Guo et al., "On Calibration of Modern Neural Networks" (2017) — temperature scaling and calibration.
- Hinton, Vinyals, and Dean, "Distilling the Knowledge in a Neural Network" (2015) — knowledge distillation.
- NIST AI Risk Management Framework — governance and risk management.
- OWASP Top 10 for LLM Applications — application-level threat patterns.

## 20.8 Final exercise

Choose one real workflow. Write a one-page design note with: task definition, action set, cost matrix, baseline, evaluation split, acceptance gates, runtime budget, safe fallback, and monitoring plan. Ask a domain owner to challenge the cost assumptions before writing model code.

**Completion criterion:** you can explain not only which model you selected, but why this decision system is the lowest-risk, lowest-cost way to achieve the required outcome.
