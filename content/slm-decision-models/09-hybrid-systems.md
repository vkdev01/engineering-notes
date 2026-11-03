---
section: "9"
title: "Hybrid systems"
kicker: "Architecture"
abstract: "When one model call is not enough: retrieval, rules, tools, cascades and the escalation economics that justify them."
time: "5 min"
order: 9
outcomes:
  - "Size a cascade from escalation rate and per-call cost"
  - "Put deterministic rules before and after the model"
  - "Stop adding stages when marginal cost beats operational cost"
---

Pure-model decisions are rare in production. The systems that survive are hybrids: a cheap SLM for the bulk of
traffic, deterministic rules for the cases rules handle better, retrieval for facts, a bigger model for the hard tail,
and a human for what remains.

## The canonical architecture

:::mermaid[Hybrid decision architecture]
flowchart LR
  I[Input<br/>claim, txn, log] --> R{Rules gate<br/>~35% decided}
  R --> S[SLM policy<br/>~55% decided]
  K[(Retrieval<br/>policy, history)] --> S
  W[Tools<br/>price, KYC API] --- S
  S --> E[Escalate<br/>7B model or human]
  E --> A[Action + log<br/>calibrated score]
:::

## The cascade, and its arithmetic

A cascade is worth building when the cost of the expensive path × escalation rate is less than the cost of running
the expensive model on everything.

```text
cost_cascade  = c_cheap + r · c_expensive
cost_flat     = c_expensive

# c_cheap = ₹0.002, c_expensive = ₹0.40, r = 0.12
# cascade = 0.002 + 0.048 = ₹0.050  vs  ₹0.400 flat  → 8x cheaper
# but latency: p50 25 ms, p95 25 + 600 = 625 ms — check your SLA tail
```

Escalate on any of: confidence below the cost-derived threshold, disagreement between two policies, schema
failure, or an out-of-scope flag. Log the reason — escalation reasons are the best source of new training data.

## Rules before models

Deterministic rules beat models on cases with a hard, legible constraint. Route those first:

| Case | Rule | Why not the model |
| --- | --- | --- |
| Regulatory blacklist | Sanctions list match → decline | Must be explainable and 100% reproducible |
| Amount thresholds | ₹ > 10L → manual review | Policy, not prediction |
| Missing required fields | No invoice number → review | Deterministic data check |
| Duplicate submission | Hash match → decline | Exact match beats inference |

Rules also act as guardrails *after* the model: a model that approves a sanctioned entity is a compliance
incident regardless of its accuracy.

## Retrieval: give the SLM the facts it cannot know

```python
from slm_decision import Retriever, HybridPolicy

retriever = Retriever(index="policy-index", embed_model="BAAI/bge-small-en-v1.5", top_k=3)
policy = HybridPolicy(
    spec=spec,
    slm=slm_model,
    retriever=retriever,
    template="Policy excerpts:\n{context}\n\nCase:\n{query}\n\nAction?",
    max_context_tokens=700,
)
```

Keep the retrieved context under ~40% of the model's context window. Beyond that, small models attend to it worse,
not better — a well-documented effect that shows up as accuracy falling while token count rises.

## Tool calls from a small model

SLMs can call tools reliably if the tool set is small (≤ 5), the schema is flat, and there is exactly one call per
step. ReAct-style multi-step tool use (Yao et al., 2022) at 360M parameters usually degrades into loops; cap the
number of steps and add a hard timeout.

```python
MAX_STEPS = 2
for step in range(MAX_STEPS):
    out = slm(scratchpad)
    if out.is_final:
        return out.action
    result = tools[out.tool](**out.args)          # validated args, allow-listed tools
    scratchpad += f"\nObservation: {result}"
return ABSTAIN                                    # never loop past the cap
```

## Human-in-the-loop, as a designed action

Route to a human when: the cost of the mistake exceeds the reviewer cost, the case is out of distribution, or the
decision is irreversible. Two design details matter more than the model:

- **Give the reviewer the model's score and reason code**, not just the case. Reviewers who see a calibrated score agree with the model ~85% of the time and catch its errors faster.
- **Measure the reviewer, not just the model.** Human accuracy on the escalated slice is usually lower than teams assume, and that number caps your achievable system accuracy.

## When to stop adding components

Each stage adds a failure mode, a latency hop and an on-call surface. Stop when marginal cost reduction is below
the operational cost of the stage — usually at two model calls plus one deterministic gate. Beyond that you are
building a distributed system, and it will behave like one.
