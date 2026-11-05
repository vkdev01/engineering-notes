---
section: "8"
title: "Fine-tuning and adaptation"
kicker: "Model adaptation"
abstract: "Understand when prompting, retrieval, adapters, or full fine-tuning is the right intervention; estimate the training budget and build a safe evaluation loop."
time: "24 min"
order: 8
outcomes:
  - "Choose between prompting, retrieval, adapters, and full fine-tuning"
  - "Explain supervised fine-tuning and parameter-efficient adaptation"
  - "Build a leakage-resistant training and evaluation workflow"
---
# 8.1 First ask what is missing

A model can fail because it lacks *knowledge*, *behaviour*, *format discipline*, or *capacity*. Those are different problems.

| Failure | First intervention | Why |
|---|---|---|
| Missing current/private facts | Retrieval (RAG) | Update data without retraining |
| Wrong output format | Structured decoding / prompt | Cheap behavioural constraint |
| Repeated task-specific mistakes | Curated examples, then SFT | Teach the desired mapping |
| Domain vocabulary or style | SFT or adapters | Change task behaviour |
| Insufficient reasoning/capacity | Larger model or decomposition | Fine-tuning cannot create unlimited capacity |

Fine-tuning is not a way to inject frequently changing facts. It changes model parameters; retrieval supplies external evidence at inference time.

## 8.2 Supervised fine-tuning from first principles

A language model predicts the next token. Given a sequence \(x_1,\ldots,x_T\), training minimises negative log likelihood:

\[
L(\theta)=-\sum_{t=1}^{T}\log P_\theta(x_t\mid x_{<t})
\]

For instruction tuning, concatenate instruction, optional context, and target response. Mask the loss on prompt tokens so the gradient teaches the answer rather than rewarding reproduction of the prompt. Exact masking depends on the model's chat template.

A tiny dataset with duplicated templates can produce apparent training success and poor generalisation. Split by source/customer/template family, not random rows, when near-duplicates exist.

## 8.3 Parameter-efficient fine-tuning

Full fine-tuning updates all parameters. LoRA instead learns low-rank updates to selected weight matrices:

\[
W'=W+\Delta W,\qquad \Delta W=BA
\]

where \(A\in\mathbb{R}^{r\times d_{in}}\), \(B\in\mathbb{R}^{d_{out}\times r}\), and rank r is much smaller than either dimension. The base weights remain frozen. This reduces trainable parameters and optimizer state, but does not guarantee better quality or lower inference latency.

QLoRA combines a quantised frozen base with trainable low-rank adapters. It reduces memory requirements; quantisation and adapter rank remain experimental choices to validate.

## 8.4 A decision matrix

| Option | Training cost | Inference cost | Best when |
|---|---:|---:|---|
| Prompting | none | prompt tokens | task is simple and examples suffice |
| RAG | index + ingestion | retrieval + context | facts change or must be cited |
| LoRA / QLoRA | moderate | often small adapter overhead | task behaviour is stable |
| Full fine-tuning | high | model-dependent | broad parameter change is justified |
| Distillation | teacher labelling + training | smaller student | serving cost/latency is the constraint |

Do not compare only GPU-hours. Include data curation, evaluation, deployment, rollback, and ongoing drift monitoring.

## 8.5 Build a data contract before training

Each example should have:
- stable example ID and source lineage;
- input and target in the exact production schema;
- split assignment and timestamp;
- language/domain and task labels;
- PII/sensitive-data review status;
- annotator or teacher provenance;
- quality flags and adjudication outcome.

Keep a frozen, human-reviewed gold set. Synthetic teacher outputs are useful training data, not ground truth. Audit a sample and label uncertainty explicitly.

## 8.6 Minimal training step

The following is a reusable PyTorch loss-step pattern for a causal language model. It assumes tokenized batches with labels already masked to -100 for prompt/padding positions. Model loading and tokenizer chat-template details vary by checkpoint.

~~~python
import torch
from torch.nn.utils import clip_grad_norm_

def train_step(model, batch, optimizer, max_grad_norm=1.0):
    model.train()
    input_ids = batch["input_ids"]
    attention_mask = batch["attention_mask"]
    labels = batch["labels"]  # prompt and padding tokens are -100

    out = model(
        input_ids=input_ids,
        attention_mask=attention_mask,
        labels=labels,
    )
    loss = out.loss

    optimizer.zero_grad(set_to_none=True)
    loss.backward()
    clip_grad_norm_(model.parameters(), max_grad_norm)
    optimizer.step()
    return float(loss.detach().cpu())


# Contract checks before the first step:
assert batch["input_ids"].shape == batch["labels"].shape
assert batch["attention_mask"].shape == batch["input_ids"].shape
assert (batch["labels"] != -100).any(), "batch has no supervised target tokens"
~~~

For a production run, add deterministic seeds, gradient accumulation, mixed precision appropriate to hardware, checkpointing, validation every fixed number of steps, early stopping, and a run manifest containing data/model/tokenizer hashes.

## 8.7 Detect memorisation and leakage

Plot training and validation loss. A widening gap is a warning, not a complete diagnosis. Also measure exact-match and semantic task metrics on held-out source groups. Search for duplicated text across splits; check that a customer's future events do not leak into their past prediction.

A strong evaluation suite includes:
1. frozen gold examples;
2. recent production-like examples;
3. rare and long-tail cases;
4. out-of-domain and malformed inputs;
5. safety and privacy cases;
6. regression cases from prior incidents.

## 8.8 When not to fine-tune

Do not fine-tune when the desired behaviour can be achieved with a deterministic parser, schema constraint, retrieval, or a few prompt examples. Do not fine-tune on unreviewed private data merely because it is available. Do not ship based on training loss.

## 8.9 Knowledge check

1. Why is RAG usually preferable for frequently changing facts?
2. What does LoRA's low-rank update constrain?
3. Why split by source family rather than random row?

**Answers:** 1. It updates the knowledge source without parameter updates. 2. The learned weight delta is represented as a product of two smaller matrices. 3. Random splitting can put near-duplicates in train and test, inflating generalisation.
