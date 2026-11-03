---
section: "7"
title: "Fine-tuning"
kicker: "Training"
abstract: "LoRA, QLoRA and full tuning for decision tasks: what to freeze, what to learn, and the hyperparameters that matter."
time: "5 min"
order: 7
outcomes:
  - "Choose between a linear probe, LoRA, QLoRA and a full fine-tune"
  - "Add a cost-sensitive loss term that matches your cost matrix"
  - "Version an adapter with the evidence needed to reproduce a decision"
---

Distillation copies behaviour; fine-tuning shapes it toward your objective — your label taxonomy, your cost
asymmetry, your abstain class. In practice you do both: distil for breadth, fine-tune on the gold-labelled slice.

## Choosing the method

| Method | Trainable params | GPU memory (360M model) | Use when |
| --- | --- | --- | --- |
| Linear probe (frozen encoder) | ~0.05% | < 1 GB | ≤ 20 classes, ≥ 500 labels — start here |
| LoRA (r = 8–16) | 0.1%–1% | 2–6 GB | Default for decoder SLMs and larger label sets |
| QLoRA (4-bit base + LoRA) | 0.1%–1% | 1.5–3 GB for a 3B model | Consumer GPU, or when you must hold many adapters |
| Full fine-tune | 100% | 8–20 GB | Large domain shift, ≥ 50k labels, and you own the training rig |

LoRA's original result (Hu et al., 2021) was that adapters with rank 8–64 on the attention projections cut
trainable parameters by ~10,000× and GPU memory by ~3× versus full fine-tuning of GPT-3-scale models, with no
measurable quality loss on the tasks tested. For a 360M SLM the absolute savings are smaller but the practical effect
is the same: you can tune on a laptop-adjacent GPU.

## LoRA configuration that works

```python
from peft import LoraConfig, get_peft_model, TaskType

cfg = LoraConfig(
    task_type=TaskType.CAUSAL_LM,
    r=16,                     # rank: 8 for ≤10 classes, 16–32 for extraction tasks
    lora_alpha=32,            # keep alpha = 2r as a starting point
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],   # all attention projections
    bias="none",
)
model = get_peft_model(base_model, cfg)
model.print_trainable_parameters()
# trainable params: 2,949,120 || all params: 362,289,152 || trainable%: 0.81
```

:::note[Target all four projections]
Tuning only `q_proj`/`v_proj` (the original paper's choice for GPT-3) underperforms on
classification-style tasks at small scale. Adding `k_proj` and `o_proj` typically recovers 1–3
points for ~2× the (still tiny) adapter size.
:::

## Supervised fine-tuning for a decision task

Two recipes. Pick by whether you need a rationale.

### A. Classification head (encoder, or decoder with a head)

```python
from transformers import AutoModelForSequenceClassification, TrainingArguments, Trainer
import torch

model = AutoModelForSequenceClassification.from_pretrained(
    "distilbert-base-uncased", num_labels=len(LABELS),
    id2label=dict(enumerate(LABELS)), label2id={l: i for i, l in enumerate(LABELS)},
)

args = TrainingArguments(
    output_dir="out/clf",
    learning_rate=2e-5,          # encoders: 1e-5 – 5e-5
    per_device_train_batch_size=32,
    num_train_epochs=4,          # small datasets overfit fast; watch val
    weight_decay=0.01,
    warmup_ratio=0.06,
    eval_strategy="epoch",
    metric_for_best_model="macro_f1",
    load_best_model_at_end=True,
    fp16=torch.cuda.is_available(),
)
Trainer(model=model, args=args, train_dataset=ds_train, eval_dataset=ds_val,
        compute_metrics=classification_metrics).train()
```

### B. Instruction format with a rationale (decoder)

```python
PROMPT = """You are a claims triage model. Choose exactly one action.

Claim: {claim}
Policy: {policy_excerpt}

Reply with JSON only:
{{"action": "approve|review|decline", "confidence": 0.0-1.0, "reason_code": "R1..R9"}}"""

example = {
    "text": PROMPT.format(claim=c.text, policy_excerpt=c.policy),
    "completion": '{"action": "review", "confidence": 0.72, "reason_code": "R4"}',
}
```

Train on the completion only — mask the prompt tokens out of the loss. For a decision model the JSON skeleton is
part of the contract: validate it at inference (see [edge cases](/c/slm-decision-models/23-edge-cases)) and treat a
schema violation as an abstain, not as a parse error to paper over.

## Cost-sensitive fine-tuning

Standard cross-entropy treats all mistakes equally. Your cost matrix does not. Two ways to fix it:

```python
# 1. class weights derived from the cost matrix (cheap, effective)
w = torch.tensor([1.0, 4.0, 12.0])       # proportional to mean cost of each misclassification
loss = F.cross_entropy(logits, labels, weight=w)

# 2. direct expected-cost loss over the softmax (better when costs are asymmetric per pair)
p = F.softmax(logits, dim=-1)
cost = torch.einsum("bn,nm->bm", p, cost_matrix)     # cost_matrix[n, m] = cost of predicting n when truth is m
loss = cost.gather(1, labels.view(-1, 1)).mean()
```

Method 2 usually buys 5–15% reduction in realised cost per case over weighted CE, at the price of losing calibration
— recalibrate afterwards.

## Data hygiene, in order of impact

1. **Label noise.** Two annotators on a 200-example sample; measure Cohen's κ. Below 0.6, fix the guideline before touching the model. No architecture recovers from a 25%-noisy label set.
1. **Leakage.** Split by entity (customer, document, patient), not by row. Row-level splits inflate accuracy by 5–20 points on duplicated content.
1. **Balance.** Keep every rare class at ≥ 50 examples, or merge classes until you can.
1. **Length and language coverage.** Long inputs get truncated silently; check the token-length histogram against your `max_length`.

## Hyperparameters that actually matter

| Knob | Range to search | Effect |
| --- | --- | --- |
| Learning rate | 1e-5 – 5e-5 (encoder), 1e-4 – 3e-4 (LoRA) | Largest single effect; LoRA tolerates ~10× higher LR |
| Epochs | 2–5 | Beyond 5, small datasets memorise |
| LoRA rank | 8 / 16 / 32 | Diminishing returns above 32 for classification |
| Max length | p95 of token counts | Halving length roughly halves attention cost |
| Batch size | 16–64 | Mostly a throughput knob; use grad accumulation to reach it |

## Adapter versioning

A LoRA adapter is 5–40 MB — small enough to version like a config file. Store with each adapter: base model
revision hash, training data snapshot id, hyperparameters, eval report, and the calibration temperature. Without the
last two you cannot reproduce a decision, and in a regulated setting that is a blocker on its own.

```python
out/claims-lora-v3/
├── adapter_config.json
├── adapter_model.safetensors
├── calibration.json          # {"temperature": 1.42, "fit_on": "val-2026-09", "ece": 0.031}
├── eval_report.json          # macro_f1, cost_per_case, abstain_rate, per-class recall
└── manifest.json             # base model + revision, data snapshot, code commit
```

Next: [prompt engineering](/c/slm-decision-models/08-prompt-engineering) when you cannot fine-tune, or
[hybrid systems](/c/slm-decision-models/09-hybrid-systems) when the decision needs more than one model call.
