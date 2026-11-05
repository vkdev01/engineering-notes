---
section: "11"
title: "Evaluation and benchmarking"
kicker: "Evidence"
abstract: "Build an evaluation set that represents deployment, compare models on task outcomes, and report uncertainty, latency, and cost."
time: "24 min"
order: 11
outcomes:
  - "Create a leakage-resistant evaluation protocol"
  - "Choose metrics that match the decision and class imbalance"
  - "Compare latency and cost under a reproducible load profile"
---
# 11.1 Evaluation starts with the decision

A benchmark is useful only if it predicts deployment performance. Start by writing the decision the model makes, the cost of each error, the expected traffic mix, and the acceptable failure modes. Then sample evaluation examples from that population.

A random split is not automatically safe. For temporal prediction, train on the past and test on the future. For customer data, split by customer. For templated text, split by template family. Remove duplicates and near-duplicates across splits.

## 11.2 Metrics by task

| Task | Core metrics | Important companion |
|---|---|---|
| Binary classification | precision, recall, PR-AUC | calibration, cost matrix |
| Multi-class classification | macro-F1, per-class recall | confusion matrix |
| Extraction | exact match, field-level F1 | schema-valid rate |
| Generation | human rubric, task success | factuality, citation validity |
| Routing | correct destination | abstention and escalation |
| Ranking | NDCG@k, recall@k | latency and coverage |

Accuracy is misleading when classes are imbalanced. A model that predicts "not fraud" for every case can be 99% accurate on a 1%-fraud dataset and still be useless.

## 11.3 Confidence intervals matter

For a proportion such as accuracy, the standard error approximation is:

\[
SE(\hat p)=\sqrt{\frac{\hat p(1-\hat p)}{n}}
\]

At 90% accuracy over 100 examples, SE is approximately 3 percentage points. A one-point gain is not persuasive. Use Wilson intervals for small samples and paired bootstrap or McNemar's test when comparing models on the same examples.

## 11.4 Paired comparison example

If model A and B run on the same cases, preserve per-example outcomes. The paired design removes much of the noise caused by case difficulty. Report the disagreement table: A-only correct, B-only correct, both correct, both wrong.

~~~python
import numpy as np

rng = np.random.default_rng(11)
a = rng.binomial(1, 0.86, 200)
b = np.where(a == 1, rng.binomial(1, 0.97, 200),
             rng.binomial(1, 0.35, 200))

both = int(((a == 1) & (b == 1)).sum())
a_only = int(((a == 1) & (b == 0)).sum())
b_only = int(((a == 0) & (b == 1)).sum())
neither = int(((a == 0) & (b == 0)).sum())
print("A accuracy:", round(a.mean(), 3))
print("B accuracy:", round(b.mean(), 3))
print("both correct / A only / B only / neither:",
      both, a_only, b_only, neither)
print("paired difference:", round((b - a).mean(), 3))
~~~

The generated numbers are illustrative. In a real report, freeze the examples and record model, prompt, decoding settings, and evaluator version.

## 11.5 Benchmark serving honestly

Measure cold start and warm steady state; time to first token (TTFT) and inter-token latency for generation; p50, p90, p95, p99 latency; throughput at realistic concurrency; error, timeout, and queue rates; memory and accelerator utilisation; and cost per request and cost per successful task.

Use realistic prompt and output lengths. Report batch size, concurrency, hardware, quantisation, runtime, model revision, and warm-up procedure. A single tokens/second number is not a service-level result.

## 11.6 Compare quality at equal constraints

Compare at equal quality (which option is cheaper/faster?), equal cost (which option is more accurate?), and equal latency (which option delivers more task value?). Plot a Pareto frontier rather than declaring one model universally best. A model is dominated if another is both cheaper and better (or equal) under the same protocol.

## 11.7 Human evaluation

For open-ended outputs, write a rubric before seeing candidate outputs. Blind evaluators to model identity, randomise order, define tie handling, and measure inter-rater agreement. Include task completion, correctness, completeness, and harmful/unsupported claims. LLM-as-judge can help triage but is not a substitute for human review on consequential outcomes.

## 11.8 Reproducibility manifest

Record dataset version/hash and split rule; model weights/revision and tokenizer; prompt/template and decoding parameters; runtime, hardware, quantisation; metric implementation and evaluator version; run timestamp, seed, and output artifact location.

## 11.9 Knowledge check

1. Why is macro-F1 useful on imbalanced multi-class tasks?
2. Why compare models on the same examples?
3. What must accompany a throughput number?

**Answers:** 1. It weights classes equally rather than letting the majority dominate. 2. Paired outcomes control for case difficulty and enable paired tests. 3. Hardware, batch/concurrency, sequence lengths, warm-up, runtime, and model configuration.
