---
section: "31"
title: "Optimization"
kicker: "Benchmarks"
abstract: "Quantisation, distillation, pruning, ONNX and vocabulary surgery — ranked by what actually pays."
time: "5 min"
order: 31
outcomes:
  - "Order optimisations by return, not by familiarity"
  - "Quantise, then refit calibration, then re-evaluate"
  - "Cut output length before touching precision"
---

Optimisation effort should follow the bottleneck. Most teams quantise first because it is easy, when their actual
problem is that they are generating 60 tokens for a decision that needs one.

## Ranked by return

| Technique | Typical gain | Effort | Risk |
| --- | --- | --- | --- |
| Shorten the output (1 token, not 60) | 5–20× latency | Hours | Low — often improves accuracy on classification |
| Switch encoder for decoder where possible | 5–10× latency | Days | Low if the task is classification |
| ONNX Runtime instead of PyTorch | 1.3–2× CPU latency, 5–20× smaller image | Hours | Low; verify numerics |
| INT8 dynamic quantisation | 2–4× memory, 1.5–3× speed | Hours | 0.5–2 points accuracy, measure it |
| Distillation to a smaller student | 10–40× latency | Days–weeks | Ceiling at teacher quality |
| INT4 quantisation (GPTQ/AWQ) | 2× memory over INT8 | Days | Higher accuracy risk; needs calibration data |
| Pruning (structured) | 1.2–2× speed at 30–50% sparsity | Weeks | Retraining required; often loses to distillation |
| Vocabulary trimming | 10–20% smaller embeddings | Days | Breaks tokenizer compatibility; careful with multilingual |
| KV-cache / paged attention | 2–4× throughput at high concurrency | Days | Framework-specific |

## Quantisation, concretely

```python
# dynamic INT8 — no calibration data, works well for encoders
from optimum.onnxruntime import ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig

q = ORTQuantizer.from_pretrained("out/model-onnx")
q.quantize(save_dir="out/model-int8",
           quantization_config=AutoQuantizationConfig.avx512_vnni(is_static=False, per_channel=False))

# static INT8 — better accuracy retention, needs ~200 calibration samples
cfg = AutoQuantizationConfig.avx512_vnni(is_static=True, per_channel=True)
# provide a calibration dataset drawn from your real input distribution
```
| Precision | Bytes/param | 360M model size | Accuracy effect |
| --- | --- | --- | --- |
| FP32 | 4.0 | 1.44 GB | reference |
| FP16 / BF16 | 2.0 | 720 MB | negligible |
| INT8 | 1.0 | 360 MB | −0.5 to −2 points typical |
| INT4 | 0.5 | 180 MB | −1 to −5 points; task-dependent |
:::warn[Always re-run the calibration fit after quantising]
Quantisation distorts the probability scale, so a temperature fitted on FP16 weights will be wrong on INT8. Refit on a
held-out slice and re-measure ECE — the cost of forgetting this is systematically wrong thresholds.
:::

## Output-length surgery

```python
# before: generate a sentence, parse the label out of it   (~60 tokens, 380 ms)
prompt = 'Read the claim and explain your reasoning, then state the action.'

# after: score the label token directly                    (1 forward pass, 25 ms)
logits = model(input_ids).logits[0, -1]
p = softmax({a: logits[token_id(a)] for a in ACTIONS})
```

This is the single largest latency win available to most decision models, and it usually *improves* accuracy
because it removes the chance of a fluent-but-wrong rationale overriding the correct label.

## Structured pruning, and why it often loses

```python
import torch.nn.utils.prune as prune
# structured: remove entire attention heads or FFN channels (real speedup)
prune.ln_structured(module.ffn, name="weight", amount=0.3, n=2, dim=0)
# unstructured: zero individual weights (memory win only, needs sparse kernels)
```

Unstructured pruning rarely speeds up dense hardware. Structured pruning at 30% typically needs a short
re-distillation to recover 1–2 points. Distilling a smaller student from scratch usually beats pruning a larger one at
equal final size, which is why pruning sits low on the list.

## Batching and concurrency

| Setting | Throughput | p95 latency | Use for |
| --- | --- | --- | --- |
| Batch 1, 4 threads | ~40 req/s | 41 ms | Interactive |
| Batch 8, 4 threads | ~180 req/s | 95 ms | Near-real-time queues |
| Batch 32, 8 threads | ~420 req/s | 310 ms | Overnight or offline scoring |

Dynamic batching with a 10 ms window is the standard compromise: throughput up ~3× for a p95 increase of ~20 ms.

## Optimisation checklist

- Measure first — profile p50 and p95 separately, and find where the time actually goes.
- Cut output length before touching precision.
- Export to ONNX and compare numerics on 500 examples before switching.
- Quantise, then refit calibration, then re-run the full eval suite.
- Distil only if the smaller model is still not fast enough after the above.
- Record the configuration with every benchmark result, or the numbers are not reusable.
