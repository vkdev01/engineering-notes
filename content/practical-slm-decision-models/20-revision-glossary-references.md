---
section: "20"
title: "Revision guide, glossary, and references"
kicker: "Mastery"
abstract: "Consolidate the course into a repeatable decision framework, a compact glossary, and primary references for deeper study."
time: "20 min"
order: 20
outcomes:
  - "Apply a complete SLM-versus-alternative decision framework"
  - "Recall the core equations and operational definitions"
  - "Follow primary research and implementation references"
---
# 20.1 The decision framework

Before choosing an SLM, answer these questions in order:

1. **Task:** What exact decision or transformation is required?
2. **Baseline:** Can deterministic code, search, or retrieval solve it?
3. **Risk:** What are false-positive, false-negative, and abstention costs?
4. **Data:** Is there representative, lawful, reviewed data?
5. **Model:** What is the smallest model that meets the quality target?
6. **System:** Does the architecture include validation, retrieval, fallback, and human review?
7. **Economics:** What is cost per successful task, including operations?
8. **Evidence:** Does a leakage-resistant evaluation support the claim?
9. **Operations:** Can the service be monitored, rolled back, and audited?

A sound decision can be "do not use an SLM." The point of decision models is to make that conclusion explicit rather than defaulting to a fashionable architecture.

## 20.2 Equations to remember

**Bayes action threshold**

\[
p > \frac{C_{FP}}{C_{FP}+C_{FN}}
\]

**Brier score**

\[
BS=\frac{1}{N}\sum_i(p_i-y_i)^2
\]

**Expected cascade inference cost**

\[
E[C]=c_s+q c_l
\]

**Little's Law**

\[
L=\lambda W
\]

**Raw weight memory**

\[
M \approx N_{parameters}\times bytes\_per\_parameter
\]

Each equation depends on assumptions. State them before applying the result.

## 20.3 Glossary

| Term | Meaning |
|---|---|
| SLM | Small language model; a relative engineering category, not a fixed parameter count |
| Distillation | Training a student using targets or signals from a teacher |
| SFT | Supervised fine-tuning on input/target examples |
| LoRA | Low-rank parameter-efficient weight adaptation |
| QLoRA | LoRA training with a quantised frozen base model |
| RAG | Retrieval-augmented generation |
| Calibration | Agreement between predicted probabilities and empirical frequencies |
| Abstention | Explicitly declining to make an automated decision |
| ECE | Expected calibration error under a chosen binning scheme |
| PR-AUC | Area under the precision-recall curve |
| TTFT | Time to first generated token |
| KV cache | Stored attention keys and values for prior tokens |
| Canary | Limited rollout used to observe a candidate safely |
| Pareto frontier | Set of options not dominated across chosen objectives |

## 20.4 Primary references

- Hinton, Vinyals, Dean (2015), *Distilling the Knowledge in a Neural Network*: https://arxiv.org/abs/1503.02531
- Sanh et al. (2019), *DistilBERT*: https://arxiv.org/abs/1910.01108
- Hu et al. (2021), *LoRA: Low-Rank Adaptation of Large Language Models*: https://arxiv.org/abs/2106.09685
- Dettmers et al. (2023), *QLoRA*: https://arxiv.org/abs/2305.14314
- Guo et al. (2017), *On Calibration of Modern Neural Networks*: https://arxiv.org/abs/1706.04599
- NIST, *AI Risk Management Framework*: https://www.nist.gov/itl/ai-risk-management-framework
- OWASP, *Top 10 for LLM Applications*: https://owasp.org/www-project-top-10-for-large-language-model-applications/

Use papers for methods and assumptions, official framework documentation for implementation details, and your own measured evaluation for deployment decisions. Published benchmark numbers are not promises about your workload.

## 20.5 Final self-assessment

You are ready to make an engineering recommendation when you can:
- derive a threshold from an explicit cost matrix;
- explain why a confidence score may be uncalibrated;
- choose between prompting, retrieval, fine-tuning, distillation, and a larger model;
- calculate memory and expected cascade cost;
- design a representative evaluation and report uncertainty;
- identify trust boundaries and define a safe fallback;
- explain the evidence behind ship, pilot, or reject.

If you cannot answer one of these, return to the corresponding chapter and reproduce its worked example.
