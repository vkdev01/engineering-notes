---
section: "5"
title: "Why SLMs for decisions"
kicker: "Economics"
abstract: "Cost, latency, privacy and controllability — with the arithmetic that makes the case, and the cases where it does not."
time: "5 min"
order: 5
outcomes:
  - "Cost a decision per case against an API"
  - "Recognise the five cases where an SLM is the wrong tool"
  - "Decide build-versus-buy on volume and latency"
---

The honest framing: an SLM is not a worse version of a large model. For a *closed decision task* it is a
different tool with a different cost structure, and the economics usually dominate.

## The arithmetic

Take a classification decision over 5M cases/month with ~600 input tokens each.

|   | Frontier API (assumed) | 7B self-hosted | 360M SLM, INT8 |
| --- | --- | --- | --- |
| Weights in memory | n/a | 14 GB FP16 | 360 MB |
| GPU needed | none (vendor) | 1× 24 GB | none — CPU or 4 GB GPU |
| p50 latency | 400–1500 ms | 60–180 ms | 8–30 ms |
| Throughput per core | rate-limited | ~40 req/s per GPU | ~120 req/s per vCPU |
| Marginal cost per case | ₹0.15–₹2.00 | ₹0.02–₹0.08 | ₹0.0005–₹0.004 |
| Monthly inference bill | ₹7.5L–₹1Cr | ₹1L–₹4L | ₹2.5k–₹20k |

*Illustrative model, not a quote. Substitute your own token
counts, instance pricing and utilisation before using this table in a business case. The ratios, not the absolute
rupees, are the argument: two to three orders of magnitude between a frontier API call and a self-hosted SLM.*

## Five reasons that survive scrutiny

1. **Latency as a feature, not a cost.** 10 ms versus 600 ms changes the product. Sub-50 ms enables inline decisions — flag a transaction while it authorises, route a support ticket before the customer finishes typing.
1. **Privacy by architecture.** Data that never leaves the VPC cannot be leaked by a vendor. For health records, bank statements or employee data this is often the deciding constraint, not a bonus.
1. **Determinism and auditability.** With temperature 0, a fixed prompt, a pinned tokenizer and a pinned quantisation, you can reproduce a decision bit-for-bit years later. Frontier APIs change under you; a versioned model artefact does not.
1. **Cost per decision near zero.** Once the model is in memory, marginal cost is dominated by the request path, not the model. That makes high-volume, low-value decisions (tag every line item) economically possible.
1. **Constrained output spaces.** A classification head cannot emit an unparseable string. With a decoder you get the same guarantee via grammar-constrained decoding or a strict schema validator — see [edge cases](/c/slm-decision-models/23-edge-cases).

## Where an SLM is the wrong tool

| Situation | Why SLMs struggle | Do this instead |
| --- | --- | --- |
| Open-ended generation quality matters | Fluency and breadth are parameter-bound | Frontier model, human in the loop |
| Decisions need recent world knowledge | Weights are frozen at training cutoff | Retrieval + SLM, or a tool call |
| Long-horizon multi-step planning | Error compounding over hops | Planner LLM + SLM executors (hybrid, ch. 07) |
| Zero labelled data, no teacher budget | Cannot be tuned; prompting alone is brittle at this size | Prompt a large model first, distil later |
| Regulated high-stakes decisions | No SLM alone is a defensible medical device | SLM as a triage signal inside a governed pathway |

## The distillation economics

Getting a 360M model to 97% of a 70B teacher's agreement on a narrow task costs roughly:

```text
teacher labelling    : 100k prompts × ~₹0.40      = ₹40,000   (one-off)
distillation train   : 3 epochs, 1× A10G, ~6 h     = ₹600
eval + calibration   : negligible
total                : ~₹41,000 one-off, then ~₹0.001/case forever
```

Break-even against an API at ₹0.40/case is ~100k cases. Above that volume, distillation pays for itself within the
first month. Below it, use the API and revisit when volume grows — this is the same build-versus-buy calculus as any
infrastructure decision.

## Accuracy you should expect, by task type

From published distillation and small-model tuning results, in terms of *agreement with a strong teacher*
on a narrow task — not absolute accuracy:

| Task shape | Typical SLM agreement with teacher | Notes |
| --- | --- | --- |
| Topic / intent classification (≤ 20 classes) | 95–99% | Easiest case; often matched by a linear model on embeddings |
| Sentiment / severity ordinal scoring | 90–96% | Adjacent-class confusion dominates the error |
| Span extraction into a schema | 85–95% F1 | Degrades sharply with entity count per document |
| Short rationale + label | 80–92% | Rationale quality is weaker than label quality |
| Arithmetic / multi-hop reasoning | 55–80% | Where SLMs genuinely lose; add tools |
:::warn[Do not quote these as your result]
These ranges come from published work on specific datasets. Your number depends on label noise, class balance, and
how much of the decision is genuinely ambiguous. Measure, then compare.
:::

## Decision checklist: SLM or API?

- Volume × API price > build cost within 12 months?
- Latency requirement below what an API round trip allows?
- Data cannot leave your environment (contractual or regulatory)?
- Decision is closed-set and stable over the next 6–12 months?
- You can label or teacher-label ≥ 5k examples?
- You can staff model maintenance (retraining, drift monitoring) for the life of the product?

Five or more yes: build the SLM. Fewer: wrap the API behind the same `DecisionSpec` interface so you can
swap later without rewriting the product.
