---
section: "6"
title: "Distillation"
kicker: "Training"
abstract: "Moving a teacher's decision behaviour into a 100× smaller model — with the loss functions, the data recipe and the numbers."
time: "5 min"
order: 6
outcomes:
  - "Write the temperature-scaled distillation loss"
  - "Build a training mix that covers hard cases and out-of-scope input"
  - "Diagnose a student that matches the teacher on train and collapses on val"
---

Distillation is the highest-leverage step in the whole pipeline: it converts an expensive, slow, accurate
decision-maker into a cheap one. The 2019 DistilBERT result is still the cleanest existence proof — 40% fewer
parameters, 60% faster inference, ~97% of BERT-base's GLUE score. Nothing about that trick is specific to BERT.

## Three flavours, one idea

| Flavour | Signal transferred | Cost | When to use |
| --- | --- | --- | --- |
| Response-based (classic KD) | Teacher's output distribution / logits | Cheapest — black-box teacher works | Default. Classification, routing, extraction |
| Feature-based | Hidden states, attention maps | Needs teacher internals + projection layers | When logits alone under-constrain the student |
| Rationale / CoT distillation | Teacher's reasoning text, then the label | Expensive data, cheap inference | Tasks needing a hop or two of reasoning |

## The loss

Hinton's original formulation, with temperature `T` and balancing weight `α`:

```text
L = α · CE(y, p_student)  +  (1 − α) · T² · KL( softmax(z_teacher / T) ‖ softmax(z_student / T) )

# α = 0.3, T = 4 are reasonable defaults; tune T in {1, 2, 4, 8}
# the T² factor keeps gradient magnitudes comparable across temperatures
```

The soft targets carry the teacher's *similarity structure* — the information that "this claim is 0.7
fraud, 0.2 ambiguous, 0.1 legitimate" is a different case from "0.7 fraud, 0.3 legitimate" even though both argmax to
fraud. That structure is what makes a 66M student behave like a 110M teacher rather than like a 66M model trained on
hard labels.

:::note[Why soft labels beat hard labels at small model sizes]
Hard labels give one bit of supervision per example; a 20-way teacher distribution gives up to ~4.3 bits. With a small
student, label efficiency is the binding constraint, so this is where distillation earns its keep.
:::

## Data recipe

You need inputs, not labels — the teacher supplies labels. The quality of the input distribution is what decides
whether the student generalises.

| Slice | Share | Why |
| --- | --- | --- |
| Real production inputs | 50% | The actual distribution you will be scored on |
| Hard / ambiguous cases (near the threshold) | 20% | Where decisions are actually made |
| Synthetic edge cases from templates | 15% | Coverage for rare-but-expensive inputs |
| Adversarial / malformed inputs | 10% | Teaches the abstain behaviour |
| Out-of-scope inputs (should abstain) | 5% | Without these, the student never learns to refuse |

Sizes that work in practice: **5k–20k** teacher-labelled examples for a single closed task; **50k+** if you
have more than ~20 classes or heavy class imbalance. Below ~2k, prompting beats distillation.

## Reference implementation

```python
import torch, torch.nn.functional as F

def distill_step(student, teacher, batch, T=4.0, alpha=0.3):
    input_ids, attention_mask, y = batch["input_ids"], batch["attention_mask"], batch["labels"]

    with torch.no_grad():
        t_logits = teacher(input_ids=input_ids, attention_mask=attention_mask).logits

    s_logits = student(input_ids=input_ids, attention_mask=attention_mask).logits

    hard = F.cross_entropy(s_logits, y)
    soft = F.kl_div(
        F.log_softmax(s_logits / T, dim=-1),
        F.softmax(t_logits / T, dim=-1),
        reduction="batchmean",
    ) * (T ** 2)
    return alpha * hard + (1 - alpha) * soft
```

## Full training loop, encoder student

```python
from transformers import (AutoTokenizer, AutoModelForSequenceClassification,
                          AutoModelForCausalLM, TrainingArguments, Trainer)
import torch, torch.nn as nn

teacher_ckpt = "meta-llama/Llama-3.1-8B-Instruct"      # any strong teacher
student_ckpt = "distilbert-base-uncased"

tok = AutoTokenizer.from_pretrained(student_ckpt)
teacher = AutoModelForCausalLM.from_pretrained(teacher_ckpt, torch_dtype=torch.bfloat16)
student = AutoModelForSequenceClassification.from_pretrained(student_ckpt, num_labels=N_CLASSES)

class DistillCollator:
    def __init__(self, tok, max_len=256):
        self.tok, self.max_len = tok, max_len
    def __call__(self, rows):
        enc = self.tok([r["text"] for r in rows], truncation=True,
                       padding=True, max_length=self.max_len, return_tensors="pt")
        enc["labels"] = torch.tensor([r["label"] for r in rows])
        enc["teacher_probs"] = torch.tensor([r["teacher_probs"] for r in rows])  # pre-computed
        return enc

class DistillTrainer(Trainer):
    def compute_loss(self, model, inputs, return_outputs=False, **kw):
        labels = inputs.pop("labels"); tp = inputs.pop("teacher_probs")
        logits = model(**inputs).logits
        loss = 0.3 * F.cross_entropy(logits, labels) + \
               0.7 * F.kl_div(F.log_softmax(logits / 4, -1), tp, reduction="batchmean") * 16
        return (loss, {"logits": logits}) if return_outputs else loss

args = TrainingArguments(
    output_dir="out/distil-bert", num_train_epochs=3,
    per_device_train_batch_size=32, learning_rate=5e-5,
    eval_strategy="epoch", save_strategy="epoch",
    fp16=torch.cuda.is_available(), logging_steps=50,
)
Trainer(model=student, args=args, train_dataset=ds_train, eval_dataset=ds_val,
        data_collator=DistillCollator(tok), compute_metrics=task_metrics).train()
```

:::note[Pre-compute teacher logits]
Teacher inference is the expensive part. Run it once over the whole dataset, store `teacher_probs` as
float16 (a 20-class problem costs 40 bytes per example), then train the student multiple times without touching the
teacher. This turns a 3-hour loop into a 3-minute one.
:::

## What to expect — agreement with teacher

Reference points from published distillation work and typical practitioner reports. Re-measure on your task.

| Student | Teacher | Task | Agreement | Speedup |
| --- | --- | --- | --- | --- |
| DistilBERT 66M | BERT-base 110M | GLUE average | ~97% of teacher score | 1.6× faster, 40% smaller (Sanh et al.) |
| MiniLM-L6 22M | BERT-base 110M | GLUE average | ~98% (with deep self-attention transfer) | ~3× faster |
| 360M decoder | 8B decoder | Intent routing, 14 classes | 96–98% | 20–40× |
| 360M decoder | 8B decoder | Contract clause extraction | 88–93% F1 | 20–40× |
| 135M decoder | 8B decoder | Same routing task | 91–95% | 60–100× |

## Diagnosing a bad student

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Student matches teacher on train, collapses on val | Input distribution too narrow | Add production and hard-case data; rebalance the mix |
| Uniformly worse by 5–10 points | Temperature too low (≈ hard labels) | Raise T to 4–8; verify teacher probabilities are not one-hot |
| Great on majority class, near-zero on rare class | Class imbalance in soft targets | Class-weighted CE term, or oversample rare classes |
| Confident and wrong on weird inputs | No out-of-scope data | Add the 5% OOS slice; add an abstain class |
| Teacher itself is wrong 15% of the time | Teacher noise is the ceiling | You cannot distil past it — fix labels or accept the ceiling |

## Three-stage schedule that works

1. **Teacher labelling** — 10k inputs, temperature 0.7, 3 samples per input, average the distributions. Averaging reduces teacher variance and gives softer, more informative targets.
1. **Distil** — 3 epochs, T = 4, α = 0.3, LR 5e-5 with linear decay, batch 32. Stop on validation agreement, not train loss.
1. **Calibrate** — fit temperature on a held-out slice (see [metrics](/c/slm-decision-models/29-metrics)). Distilled students inherit the teacher's over-confidence, sometimes amplified.

Continue to [fine-tuning](/c/slm-decision-models/07-fine-tuning) when you have real labels rather than teacher labels, or
when you need to push past the teacher's ceiling with domain data.
