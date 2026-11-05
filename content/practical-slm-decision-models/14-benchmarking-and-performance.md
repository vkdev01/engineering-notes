---
section: "14"
title: "Benchmarking and performance engineering"
kicker: "Measurement"
abstract: "Benchmark the full request path under realistic load, report tail latency and throughput, and avoid misleading single-number comparisons."
time: "26 min"
order: 14
outcomes:
  - "Design a repeatable benchmark with warm-up and controlled workload"
  - "Interpret p50, p95, p99, throughput, and saturation"
  - "Compare models on quality-adjusted cost and latency"
---
# 14.1 Benchmark the workload you will actually serve

A benchmark is an experiment, not a stopwatch around one model call. The workload includes input length, output length, concurrency, arrival pattern, batch size, hardware, runtime, precision, and network overhead.

Record at least:
- model and tokenizer immutable revisions;
- runtime, driver, hardware, precision, and quantization;
- input and output token distributions;
- concurrency and request arrival pattern;
- warm-up procedure and number of measured requests;
- queueing, preprocessing, generation, and end-to-end latency;
- failures, timeouts, and output quality.

## 14.2 Tail latency matters

The median (p50) describes a typical request. p95 means 95% of requests completed at or below that latency; p99 captures more of the tail. A service can have a good median while one request in twenty is unacceptably slow.

For a user-facing service, measure end-to-end latency, not only token generation time. Include queueing, network, retrieval, parsing, and policy.

## 14.3 Little's Law and queue intuition

For a stable system:

\[
L=\lambda W
\]

where L is average number of requests in the system, \(\lambda\) is throughput (requests per second), and W is average time in system (seconds).

If throughput is 40 requests/s and average time in system is 0.25 s, average in-flight requests are 10. If arrival rate exceeds sustainable service rate, queues grow and latency becomes unbounded until admission control or load shedding intervenes.

## 14.4 A simple latency summary

~~~python
import math

def percentile(values, q):
    if not values:
        raise ValueError("need at least one observation")
    ordered = sorted(values)
    # Nearest-rank definition: rank = ceil(q * n), one-indexed.
    rank = max(1, math.ceil(q * len(ordered)))
    return ordered[rank - 1]

latencies_ms = [18, 20, 21, 22, 23, 24, 25, 28, 40, 110]
print("p50:", percentile(latencies_ms, 0.50))
print("p95:", percentile(latencies_ms, 0.95))
print("p99:", percentile(latencies_ms, 0.99))
~~~

Expected output:

~~~text
p50: 23
p95: 110
p99: 110
~~~

This tiny sample is for illustrating percentile definitions, not a production benchmark. For robust tail estimates, collect many thousands of observations and repeat the run.

## 14.5 Throughput is not a single metric

For generative serving, distinguish:
- **time to first token (TTFT):** user-visible wait before generation begins;
- **inter-token latency:** time between generated tokens;
- **output tokens/s:** generation throughput;
- **requests/s:** completed requests per second;
- **end-to-end latency:** complete request duration.

For classification-style tasks with short structured outputs, request latency and completed decisions per second may be more meaningful than output tokens/s.

## 14.6 A benchmark protocol

1. Freeze the artifact and configuration.
2. Define a representative request corpus and workload distribution.
3. Run warm-up requests until compilation, caching, and memory allocation stabilise.
4. Measure at several concurrency levels, not just one.
5. Repeat runs and report median across runs plus variation.
6. Capture errors, timeouts, memory, power if relevant, and quality.
7. Compare at equal quality or report the quality-performance frontier.

Do not compare one model at batch size 1 with another at batch size 32 and call the result a model-only comparison.

## 14.7 Quality-adjusted cost

The fastest model is not necessarily the cheapest system. Include escalation, review, retries, and error remediation.

\[
C_{effective}=C_{inference}+C_{review}+C_{retry}+C_{error}
\]

A small model with low inference cost can be more expensive overall if it generates many costly mistakes or escalations. Report cost per successful, policy-compliant decision.

## 14.8 Benchmark anti-patterns

- measuring only the first request or only a warm cache;
- reporting average latency without percentiles;
- omitting failed or timed-out requests;
- using synthetic prompts unlike production;
- comparing different hardware or precision without disclosure;
- measuring model-only latency while claiming service latency;
- tuning on the benchmark set and presenting it as independent evaluation.

## 14.9 Knowledge check

1. What does p95 latency mean?
2. If arrival rate exceeds sustainable service rate, what happens?
3. Why is output tokens/s insufficient for short classification tasks?
4. What belongs in effective cost beyond inference?

**Answers:** 1. 95% of observations are no slower than that value. 2. Queues grow and tail latency rises until backpressure or failure. 3. The task may emit only a few tokens; request throughput and end-to-end latency matter more. 4. Review, retries, and downstream error costs.
