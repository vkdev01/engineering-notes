---
section: "3"
title: "SLM fundamentals"
kicker: "Background"
abstract: "What a small language model actually is, how big is small, and where the compute goes."
time: "5 min"
order: 3
outcomes:
  - "Pick encoder-only or decoder-only for a given decision"
  - "Estimate parameters, memory and KV cache for a small model"
  - "Check tokeniser cost before committing to a language"
---

"Small" is a moving target. In this guide an SLM is a transformer decoder or encoder with roughly
**10M to 4B parameters** that can run on one CPU core-group or a single consumer GPU. That range covers two very
different families, and knowing which one you have changes your entire plan.

## Two families, two different jobs

|   | Encoder-only (BERT-style) | Decoder-only (GPT-style) |
| --- | --- | --- |
| Examples | DistilBERT 66M, MiniLM-L6 22M, DeBERTa-v3-xsmall 22M | SmolLM2 135M/360M/1.7B, Qwen2.5 0.5B/1.5B/3B, Phi-3-mini 3.8B, TinyLlama 1.1B |
| Output | Fixed label distribution over your classes | Free text, then parsed into a label |
| Latency (CPU, seq 256) | 1–15 ms | 15 ms–2 s depending on generated tokens |
| Decision fit | Excellent — a classifier *is* a decision function | Good when the decision needs reasoning over long context |
| Failure mode | Confidently wrong on out-of-distribution input | Confidently wrong *and* fluent about it; schema violations |
| Trainable on | Single CPU-hour to a few GPU-hours | Single GPU-day with LoRA, more for full tuning |

:::note[Default recommendation]
If your decision is "pick one of N labels from this text", use an encoder-only model. Reach for a decoder only when
the input is long, the rule is not expressible as a label, or you need the model to call tools.
:::

## Where the parameters and the FLOPs go

A decoder block at hidden size `d` with `L` layers and vocabulary `V` holds roughly:

```python
params ≈ L · (12·d²  +  13·d² for gated MLPs)  +  V·d        # embeddings dominate at small d
FLOPs per token ≈ 2 · params                                 # forward pass, rule of thumb
KV cache bytes ≈ 2 · L · d · n_kv_heads/n_heads · bytes_per_elem · seq_len
```

Worked example — SmolLM2-360M-ish shape (`d=960`, `L=32`, `V=49152`):

| Component | Parameters | Share |
| --- | --- | --- |
| Embeddings (tied) | 47.2M | 13% |
| Attention + MLP, 32 layers | ≈ 311M | 87% |
| Total | ≈ 358M | 100% |
| Weights at FP32 / FP16 / INT8 / INT4 | 1.43 GB / 716 MB / 358 MB / 179 MB | — |

The embedding share is why small models are *relatively* more embedding-heavy: shrinking layers while keeping a
50k vocabulary leaves a floor you cannot quantise away cheaply. Trimming the vocabulary to your domain's token set is
a real optimisation, not a micro-optimisation.

## Memory budget for inference

```python
total_memory ≈ weights + KV_cache + activations + runtime_overhead
weights     = params × bytes_per_param          # 4 FP32, 2 FP16, 1 INT8, 0.5 INT4
KV_cache    = 2 × L × d × seq_len × batch × bytes_per_param
activations ≈ small for batch 1, grows with batch × seq_len
```

For a 360M model at INT8, batch 1, 512 tokens: 358 MB weights + ~25 MB KV cache + overhead ≈ 450 MB resident. That
is the number that decides whether your container fits a 512 MiB edge box.

## What SLMs are good and bad at

- **Good** — Classification, extraction into a fixed schema, routing, short-form judgement with clear criteria, rewriting, tagging, severity scoring.
- **Fragile** — Multi-step arithmetic, long-horizon planning, anything needing 2024-era world knowledge, tasks where the label depends on a rarely-seen token.

Empirically the capability cliff sits around tasks that need more than ~3 reasoning hops without tool support.
Below that, a well-tuned 360M model can match a 7B model on a narrow, well-labelled task — that is the entire
economic argument for distillation in [chapter 04](/c/slm-decision-models/06-distillation).

## Tokenisation is a decision variable

Tokenisers set your latency floor. A 32k-vocab BPE splits Hindi or Tamil text into 2–4× more tokens than English,
which multiplies cost and latency for the same content. Measure it before you commit:

```python
from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained("HuggingFaceTB/SmolLM2-360M-Instruct")
for s in ["claim denied, resubmit with invoice",
          "दावा अस्वीकृत, कृपया चालान के साथ पुनः भेजें"]:
    print(len(tok(s).input_ids), s[:32])
```

## Checklist before choosing a base model

- Label set is closed and small (≤ 50 classes) → encoder-only, classification head.
- Input longer than ~1k tokens → decoder with 4k+ context, or a retrieval step first.
- Licence permits commercial use (check the model card, not the paper).
- Tokenizer covers your language and domain vocabulary efficiently.
- Quantised size fits your smallest deployment target, not your largest.
- You have a teacher model or ≥ 1k labelled examples — otherwise see prompting in [chapter 06](/c/slm-decision-models/08-prompt-engineering).
