---
section: "8"
title: "Prompt engineering"
kicker: "Training"
abstract: "Making a frozen SLM decide reliably: schemas, few-shot selection, constrained decoding and self-consistency's real cost."
time: "5 min"
order: 8
outcomes:
  - "Write a seven-part prompt that constrains the output space"
  - "Select few-shot examples by similarity with class coverage"
  - "Price self-consistency honestly against a latency budget"
---

Prompting is the zero-training path. On an SLM it is less forgiving than on a frontier model — a 360M model has
little spare capacity for instruction-following, so the prompt has to do structural work that a larger model would do
itself.

## The seven-part prompt

| Part | Purpose | Example |
| --- | --- | --- |
| Role | Narrows the distribution | "You triage insurance claims." |
| Task | One sentence, one verb | "Choose exactly one action." |
| Label definitions | Removes ambiguity between adjacent classes | "review = missing documents OR value > ₹5L" |
| Decision rules | The tie-breakers | "If two actions seem valid, choose the one with lower cost." |
| Examples | 2–5, ordered hardest-last | Include one abstain example |
| Output schema | Machine-parsable | JSON with fixed keys and enum |
| Fallback | What to do when unsure | "If the claim is unreadable, return action review." |

## Few-shot example selection beats prompt wording

For a fixed budget of k examples, picking the *right* examples typically moves accuracy more than any
phrasing change. Use similarity-based retrieval over an embedding index of labelled cases, and force class coverage:

```python
import numpy as np

def select_shots(q_vec, bank_vecs, bank_labels, k=4, per_class_min=1):
    sims = bank_vecs @ q_vec / (np.linalg.norm(bank_vecs, axis=1) * np.linalg.norm(q_vec) + 1e-9)
    order = np.argsort(-sims)
    shots, seen = [], {}
    for i in order:                                  # first pass: cover rare classes
        lab = bank_labels[i]
        if seen.get(lab, 0) < per_class_min:
            shots.append(i); seen[lab] = seen.get(lab, 0) + 1
        if len(shots) == k:
            return shots
    for i in order:                                  # second pass: fill by similarity
        if i not in shots:
            shots.append(i)
        if len(shots) == k:
            break
    return shots
```

Numbers worth knowing: random few-shot selection is usually 4–9 points worse than similarity-based selection on
classification-style tasks, and adding a 5th example beyond k=5 typically gains under a point while adding ~20%
prompt tokens.

## Constrain the output, do not hope

Free-form JSON from a 360M model fails to parse on 2–8% of inputs. Two robust fixes:

```python
# 1. grammar-constrained decoding (outlines / llama.cpp grammars / vLLM guided decoding)
from outlines import models, generate
import outlines.grammars as g

model = models.transformers("HuggingFaceTB/SmolLM2-360M-Instruct")
choice = generate.choice(model, ["approve", "review", "decline"])
action = choice(prompt)          # cannot emit anything outside the enum

# 2. hard schema validation with an explicit abstain on failure
import json, jsonschema
try:
    obj = json.loads(raw)
    jsonschema.validate(obj, SCHEMA)
except (json.JSONDecodeError, jsonschema.ValidationError):
    obj = {"action": "review", "confidence": 0.0, "reason_code": "SCHEMA_FAIL"}
```
:::note[Never retry-until-parseable in a decision path]
Retry loops turn a 5% schema-failure rate into unbounded tail latency. Fail closed to the abstain action and log the
raw output; that is both faster and auditable.
:::

## Chain-of-thought and self-consistency, priced honestly

CoT (Wei et al., 2022) helps multi-step tasks and hurts simple classification — on a narrow label task it adds
tokens and variance for no accuracy gain. Self-consistency (Wang et al., 2023) samples k reasoning paths and takes a
majority vote, typically +5 to +17 points on arithmetic benchmarks, but costs k× the inference:

| Strategy | Latency (360M, CPU) | Relative cost | Accuracy effect on closed classification |
| --- | --- | --- | --- |
| Direct label | ~25 ms | 1× | baseline |
| Rationale then label | ~90 ms | 3–4× | −1 to +2 points; rationale is useful for audit |
| Self-consistency k=5 | ~125 ms (batched) | 5× | +0 to +3 points on classification |
| Self-consistency k=5 + CoT | ~450 ms | 15× | +3 to +8 points on multi-hop tasks only |

Latency figures are illustrative for a 360M INT8 model on 4 vCPU. The pattern is what matters: self-consistency is
a batch-time optimisation, not a real-time one. Use it offline to build a high-quality label set for distillation,
not in the request path.

## Getting a probability out of a generative model

```python
# Option A: verbalised confidence (cheap, poorly calibrated)
prompt: '... reply {"action": ..., "confidence": 0.0-1.0}'

# Option B: token logprob of the label token (better; needs logits access)
ids = tok(prompt + ' "', return_tensors="pt").input_ids
logits = model(ids).logits[0, -1]
p = {a: torch.softmax(logits, -1)[tok.encode(' ' + a)[0]].item() for a in ACTIONS}
p = {a: v / sum(p.values()) for a, v in p.items()}      # renormalise over the action set
```

Option B is consistently better calibrated than Option A and costs one forward pass. It is what you should feed into
the cost-matrix argmax from [chapter 02](/c/slm-decision-models/04-decision-theory). Still calibrate it — see
[metrics](/c/slm-decision-models/29-metrics).

## Prompt version control

A prompt is source code with a measurable effect on the decision. Keep prompts in files, hash them, and record the
hash with every logged decision:

```python
prompts/
├── claims_triage/
│   ├── v1.txt
│   ├── v2.txt          # + reason codes, + abstain example
│   └── CHANGELOG.md    # v2: macro-F1 0.81 -> 0.86, abstain 0.11 -> 0.09
└── __init__.py         # load_prompt(name, version) with an sha256 in the manifest
```

## Prompt-level tests to run in CI

- Golden set of 200 inputs with expected actions: assert macro-F1 does not drop more than 1 point.
- Schema conformance: 100% of outputs parse and validate, or fall back to abstain.
- Abstain behaviour: out-of-scope inputs produce the abstain action at ≥ 90%.
- Injection resistance: an input containing "ignore previous instructions" does not change the action on 95% of cases.
- Token budget: p95 prompt tokens under the context limit with 10% headroom.
