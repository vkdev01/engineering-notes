---
section: "13"
title: "Serving, quantisation, and performance"
kicker: "Production engineering"
abstract: "Estimate memory, choose a serving strategy, understand quantisation trade-offs, and benchmark tail latency."
time: "24 min"
order: 13
outcomes:
  - "Estimate weight memory from parameter count and precision"
  - "Explain quantisation, batching, and KV-cache pressure"
  - "Choose metrics for a production serving benchmark"
---
# 13.1 Model size is a memory calculation

A parameter stored in FP32 requires 4 bytes; FP16/BF16 requires 2; INT8 requires approximately 1; 4-bit weights require approximately 0.5 bytes before scales, metadata, and alignment overhead.

For a 1.5-billion-parameter model, raw weight storage is approximately:
- FP32: 6 GB;
- FP16/BF16: 3 GB;
- INT8: 1.5 GB;
- 4-bit: 0.75 GB plus quantisation metadata.

These are decimal GB approximations for weights only. Runtime memory also includes activations, temporary buffers, framework allocations, and the KV cache. Training additionally requires gradients and optimizer state.

## 13.2 Quantisation is an accuracy/efficiency trade

Quantisation maps high-precision values to a smaller representable set. Lower bit width reduces weight bandwidth and memory, but introduces quantisation error. Per-channel or group-wise scales can preserve quality better than one global scale. Quantisation-aware training simulates quantisation during training; post-training quantisation applies it after training.

Do not assume 4-bit always fits or is always fast. Kernel support, sequence length, batch size, hardware, and runtime determine actual speed.

## 13.3 KV cache and context length

Autoregressive generation stores keys and values from previous tokens so attention does not recompute them each step. Approximate KV memory grows linearly with batch size and cached sequence length:

\[
M_{KV}\propto B\cdot L\cdot N_{layers}\cdot N_{heads}\cdot d_{head}\cdot 2
\]

The factor 2 accounts for keys and values; multiply by bytes per element. This is why long contexts and concurrent sessions can exhaust memory even when the model weights fit.

## 13.4 Benchmark the actual service

A benchmark should include realistic prompt/output length distributions, concurrency, warm-up, batching, hardware, model revision, quantisation, runtime, and sampling configuration. Report p50/p95/p99 latency, throughput, TTFT, inter-token latency, error rate, memory, and cost per successful task.

A model that is fastest at batch size one may be slower at high concurrency. A high average throughput can hide terrible tail latency.

## 13.5 Capacity planning example

Suppose a service receives 40 requests/second, average generation time is 0.8 seconds, and the target average in-flight concurrency is 32. Little's Law gives:

\[
L=\lambda W=40\times0.8=32
\]

This is an average concurrency estimate, not a GPU sizing answer. Add headroom for burstiness, queueing, tail latency, and failure recovery; measure on the intended hardware.

## 13.6 Knowledge check

1. How much raw FP16 weight memory does a 3B parameter model need?
2. Why can a model fit in memory at batch one but fail at high concurrency?
3. What does Little's Law estimate?

**Answers:** 1. Approximately 6 GB decimal. 2. KV cache and activations grow with concurrent sequences and context length. 3. Average in-flight work from arrival rate multiplied by average time in system.
