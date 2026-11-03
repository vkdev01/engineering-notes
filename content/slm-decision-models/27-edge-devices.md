---
section: "27"
title: "Edge devices"
kicker: "Deployment"
abstract: "Raspberry Pi, Jetson and mobile: ONNX Runtime, quantisation, and the memory arithmetic that decides what fits."
time: "5 min"
order: 27
outcomes:
  - "Size a model to the device from RAM, not benchmarks"
  - "Export to ONNX and quantise without losing the task"
  - "Handle thermals, offline operation and OTA rollback"
---

Edge deployment is a memory problem first and a compute problem second. If the model does not fit in RAM with room
for the runtime, nothing else matters.

## What fits where

| Device | RAM | Realistic model ceiling | Latency (66M encoder) |
| --- | --- | --- | --- |
| Raspberry Pi 4 / 5 (4 GB) | 4 GB | ~200M INT8 encoder | 35–60 ms |
| Raspberry Pi Zero 2 W | 512 MB | ~20M INT8 encoder (distilled) | 250–400 ms |
| Jetson Orin Nano (8 GB) | 8 GB | 1–1.7B INT8 | 8–15 ms |
| Mobile (modern SoC, 6–8 GB) | shared | ~350M INT8 | 20–45 ms |
| Industrial PC (4 GB, fanless) | 4 GB | ~360M INT8 | 25–50 ms |

Rule of thumb: usable model size ≈ 25% of device RAM. The runtime, tokenizer, OS page cache and your application all
compete for the rest.

## ONNX Runtime beats PyTorch on edge

```python
# export once, on a machine with torch
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer
from optimum.onnxruntime import ORTModelForSequenceClassification, ORTQuantizer
from optimum.onnxruntime.configuration import AutoQuantizationConfig

model = AutoModelForSequenceClassification.from_pretrained("out/clf")
tok = AutoTokenizer.from_pretrained("out/clf")

ort_model = ORTModelForSequenceClassification.from_pretrained("out/clf", export=True)
ort_model.save_pretrained("out/clf-onnx")

q = ORTQuantizer.from_pretrained("out/clf-onnx")
q.quantize(save_dir="out/clf-onnx-int8", quantization_config=AutoQuantizationConfig.arm64(is_static=False, per_channel=False))
```
| Runtime | Size on disk | RSS | Latency (Pi 4, 66M) |
| --- | --- | --- | --- |
| PyTorch FP32 | 265 MB + 800 MB wheel | ~1.1 GB | 95 ms |
| ONNX FP32 | 265 MB + 40 MB runtime | ~420 MB | 52 ms |
| ONNX INT8 (dynamic) | 68 MB + 40 MB runtime | ~180 MB | 38 ms |

*Illustrative. Dynamic INT8 quantisation typically costs 0.5–2
points of accuracy on a 66M encoder; measure on your own validation set before shipping.*

## Inference loop, edge-safe

```python
import onnxruntime as ort, numpy as np
from transformers import AutoTokenizer

sess_options = ort.SessionOptions()
sess_options.intra_op_num_threads = 2
sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

sess = ort.InferenceSession("out/clf-onnx-int8/model_quantized.onnx", sess_options,
                            providers=["CPUExecutionProvider"])
tok = AutoTokenizer.from_pretrained("out/clf")

def decide(text, max_len=256):
    enc = tok(text, truncation=True, max_length=max_len, padding=True, return_tensors="np")
    logits = sess.run(None, {"input_ids": enc["input_ids"],
                             "attention_mask": enc["attention_mask"]})[0]
    p = np.exp(logits) / np.exp(logits).sum(-1, keepdims=True)
    idx = int(p[0].argmax())
    return LABELS[idx], float(p[0][idx])
```

## Operating constraints on real devices

- **No network at inference.** Bundle tokenizer and calibration; never fetch at startup.
- **Signed artefacts.** Verify a hash before loading; a corrupted model on a remote device is unrecoverable without a site visit.
- **Thermal throttling.** Sustained inference on a passively cooled Pi drops throughput 20–40%. Benchmark after 10 minutes of load, not 10 seconds.
- **Store-and-forward logging.** Buffer decisions locally, flush when connectivity returns.
- **Deterministic fallback.** If the model fails to load, the rule table must still decide.
- **OTA updates with rollback.** Keep the previous artefact on disk; switching back is a symlink flip.

## Battery and power

```text
energy per 1k decisions ≈ (mean_power_w × latency_s × 1000) / 3600   [Wh]
# 3 W device, 40 ms per decision: 3 × 0.04 × 1000 / 3600 ≈ 0.033 Wh per 1k decisions
```

On battery-powered devices the decision that matters is usually *how often* to run the model, not which model
to run. Batch local decisions and run them on a schedule.
