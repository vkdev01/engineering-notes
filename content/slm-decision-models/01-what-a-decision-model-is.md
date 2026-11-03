---
section: "1"
title: "What a decision model is"
kicker: "Orientation"
abstract: "A practical, end-to-end guide to turning small language models (SLMs) into decision systems you can test, measure and ship."
time: "5 min"
order: 1
outcomes:
  - "Say what separates a decision model from a chat model"
  - "Name the six stages of the conversion pipeline"
  - "Place your own problem on the learning path"
---

- **135M–4B** — Typical SLM parameter range used in this guide
- **8 guides** — Fundamentals → distillation → fine-tuning → hybrid systems
- **4 notebooks** — Runnable, end-to-end with CPU-only defaults
- **6 domains** — Healthcare, finance, industrial, gaming, education, autonomy

A language model becomes a **decision model** the moment its output is used to pick an action. That single
change raises the bar: a chat model can be "roughly right", a decision model cannot. It must return a defined
label or action, with a calibrated confidence, an explicit abstain option, a bounded latency, and a documented
failure mode for every input it will see in production.

This site is the written companion to the [slm-decision-models](https://github.com/vkdev01/slm-decision-models)
repository. Every chapter follows the same shape: the concept, the maths, the numbers you should expect, a working
code path, and the test that proves it still works after your next change.

## What "decision model" means here

A decision model is a function from a messy observation to a committed action under uncertainty. Formally, with
observation `x`, action space `A`, and a utility function `u(a, y)` over the true outcome `y`:

```text
a* = argmax_a  E_{p(y|x)}[ u(a, y) ]
```

Three properties separate this from ordinary text generation:

| Property | Chat model | Decision model |
| --- | --- | --- |
| Output space | Open text | Closed set of labels or actions, schema-validated |
| Uncertainty | Implicit, usually uncalibrated | Explicit score + calibration check (ECE, reliability curve) |
| Failure handling | Free-form apology | Abstain / escalate, with a defined escalation path |
| Evaluation | Human preference, LLM-as-judge | Cost-weighted accuracy, regret, coverage at fixed risk |
| Latency budget | Seconds, tolerated | p95 budget enforced, usually 20–800 ms |

## The conversion pipeline

:::mermaid[The pipeline]
flowchart LR
  F[1 · Frame<br/>actions, costs, abstain] --> D[2 · Data<br/>labels, hard cases]
  D --> T[3 · Distil<br/>teacher to SLM]
  T --> U[4 · Tune<br/>LoRA, task head]
  U --> C[5 · Calibrate<br/>temperature, conformal]
  C --> P[6 · Deploy<br/>quantise, serve, monitor]
  P -.->|every production miss| D
:::

## Learning path

- **New to SLMs** — Read [SLM fundamentals](/c/slm-decision-models/03-slm-fundamentals), then [why SLMs for decisions](/c/slm-decision-models/05-why-slms). Skim the notebooks.
- **ML engineer** — Jump to [distillation](/c/slm-decision-models/06-distillation) and [fine-tuning](/c/slm-decision-models/07-fine-tuning), then [benchmarking](/c/slm-decision-models/24-benchmarking).
- **Product / domain lead** — [Decision theory](/c/slm-decision-models/04-decision-theory) for the framing, then the [use cases](/c/slm-decision-models/15-healthcare) closest to yours.
- **Platform / SRE** — [Docker](/c/slm-decision-models/25-docker), [edge](/c/slm-decision-models/27-edge-devices), [CI/CD](/c/slm-decision-models/28-cicd) and the [edge-case](/c/slm-decision-models/23-edge-cases) suite.

## Numbers to keep in your head

These are published reference points, not results measured on your data. Reproduce them with the scripts in
`benchmarks/` before quoting them internally.

| Quantity | Reference value | Source / caveat |
| --- | --- | --- |
| DistilBERT vs BERT-base | 40% fewer parameters, 60% faster, ~97% of GLUE retained | Sanh et al., 2019 — the canonical proof that a 66M model can carry a 110M model's task behaviour |
| LoRA trainable parameters | 0.01%–1% of full weights | Hu et al., 2021 — rank 8–64 adapters on attention projections |
| INT8 weight memory | 4× smaller than FP32, 2× smaller than FP16 | Arithmetic, not a benchmark: 1 byte vs 4 bytes per weight |
| INT4 weight memory | 8× smaller than FP32 | Quality loss is task-dependent; always re-run the eval suite |
| Calibration gap | Modern deep nets are typically over-confident; ECE of 0.05–0.15 is common pre-calibration | Guo et al., 2017 — measure your own ECE, never assume |
| Conformal guarantee | Coverage ≥ 1 − α on exchangeable data | Angelopoulos & Bates, 2021 — distribution-free, but assumes exchangeability |
| Self-consistency gain | Typically +5 to +17 points on arithmetic reasoning benchmarks | Wang et al., 2023 — costs k× inference; usually unaffordable for real-time decisions |

:::warn[Read this before trusting any table]
Every performance table in this site is either attributed to a published paper or marked *illustrative*.
Latency and accuracy depend on your hardware, your tokenizer, your label set and your data. The repo ships the
scripts; run them on your machine and replace the numbers.
:::

## Repository map

```text
slm-decision-models/
├── docs/                    # this site (GitHub Pages source, served from /docs)
├── code/src/slm_decision/   # the Python library used in every example
├── notebooks/               # 4 runnable .ipynb tutorials
├── tests/                   # pytest suite: metrics, calibration, policies, schema
├── benchmarks/              # latency + accuracy harness
└── requirements.txt
```

## Sixty-second taste

```python
from slm_decision import DecisionSpec, RulePolicy, calibrate, expected_cost

spec = DecisionSpec(
    actions=["approve", "review", "decline"],
    costs={("approve", "bad"): 10.0, ("decline", "good"): 3.0, ("review", "good"): 0.5},
    abstain="review",
)

# A policy is anything that maps a signal in [0,1] to an action under a cost matrix.
policy = RulePolicy(spec, threshold=0.62)
print(policy.act(0.71))          # 'approve'
print(expected_cost(spec, policy, y_true=[1, 0, 1], scores=[0.71, 0.55, 0.9]))
```

:::note[Working code, not pseudocode]
Everything importable here exists in `code/src/slm_decision/` and is covered by the test suite. If a
snippet on this site drifts from the library, the test suite is the source of truth — and CI will tell you.
:::
