---
section: "13"
title: "Serving and deploying small language models"
kicker: "Runtime"
abstract: "Turn a trained model into a bounded service with reproducible artifacts, explicit resource budgets, safe concurrency, and operational fallbacks."
time: "30 min"
order: 13
outcomes:
  - "Estimate model memory and choose a serving topology"
  - "Define a robust inference API and lifecycle"
  - "Plan batching, timeouts, autoscaling, rollout, and rollback"
---
# 13.1 Inference is a service lifecycle

A model file is not a production service. A production inference path includes request validation, tokenization, model execution, decoding, output parsing, policy enforcement, telemetry, and response delivery.

~~~mermaid
flowchart LR
  A[Client] --> B[Auth and schema validation]
  B --> C[Queue / admission control]
  C --> D[Tokenizer]
  D --> E[Model runtime]
  E --> F[Output parser]
  F --> G[Decision policy]
  G --> H[Response]
  E --> I[Metrics and traces]
  G --> I
~~~

The policy layer must remain independent of the model runtime so you can replace the model without rewriting authorization or business rules.

## 13.2 Estimate memory before choosing hardware

For a dense model with P parameters and b bits per parameter, the raw weight storage lower bound is:

\[
M_{weights}=P\times\frac{b}{8}
\]

A 1.5-billion-parameter model at 16-bit precision requires approximately 3.0 GB for weights alone. At 8-bit, approximately 1.5 GB; at 4-bit, approximately 0.75 GB. These are decimal lower bounds, not full runtime requirements.

Actual memory also includes quantization metadata, activations, temporary workspaces, KV cache for decoder models, runtime overhead, and fragmentation. The KV cache grows with batch size and sequence length. Measure the target runtime rather than treating the weight calculation as a deployment guarantee.

## 13.3 A minimal API contract

A stable API should expose task semantics, not arbitrary internal model prompts. Example request:

~~~json
{
  "request_id": "req-123",
  "text": "The package arrived damaged",
  "context": {"order_state": "delivered"}
}
~~~

Example response:

~~~json
{
  "request_id": "req-123",
  "action": "support_review",
  "reason_code": "damage_report",
  "model_version": "triage-2026-01",
  "policy_version": "policy-4",
  "latency_ms": 38
}
~~~

The server should validate maximum input length, accepted content types, authentication, tenant boundaries, and rate limits. Do not expose raw chain-of-thought or internal reasoning traces as an API requirement.

## 13.4 Reproducible model artifacts

Package the weights with a manifest containing model architecture, tokenizer revision, weight hash, quantization method, training data snapshot identifier, training code commit, prompt/template version, calibration artifact, evaluation report, license, and supported runtime versions.

Pin immutable revisions. A floating model tag such as "latest" is not a reproducible deployment identifier.

## 13.5 Batching and concurrency

Batching amortises GPU launch and scheduling overhead, but increases queueing delay and memory use. Dynamic batching waits briefly to collect requests; set a maximum batch size and maximum queue delay. For latency-sensitive decisions, a small wait budget may be better than maximum throughput.

Measure throughput and latency together. A server that reports high tokens/second while p95 request latency violates the product SLO is not successful.

## 13.6 Deadlines, retries, and backpressure

Give each request an end-to-end deadline. Propagate the remaining budget to downstream services. Do not retry indefinitely. Retry transient failures only, use exponential backoff with jitter, and enforce a retry budget. Reject or shed load before queues consume all memory.

If the model is unavailable, return a safe fallback such as review or a deterministic route. Never bypass a critical policy gate to preserve availability.

## 13.7 Rollouts and rollback

A safe rollout sequence:

1. Validate artifact hashes and startup health.
2. Run smoke tests against a staging environment.
3. Shadow production traffic without using outputs for actions.
4. Canary a small fraction of traffic.
5. Compare quality, cost, latency, and error metrics against the incumbent.
6. Increase traffic only when predeclared gates pass.
7. Keep the prior artifact and policy ready for rollback.

Rollback should restore the full compatible bundle: weights, tokenizer, prompt, calibration, and policy. Restoring only weights may leave an incompatible system.

## 13.8 Container example

A minimal container should pin dependencies and run as a non-root user. The following is a starting pattern; adapt the command to your framework and pin a tested base image digest for production.

~~~dockerfile
FROM python:3.11-slim
WORKDIR /srv/app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/
RUN useradd --create-home appuser
USER appuser
EXPOSE 8080
CMD ["python", "-m", "app.server"]
~~~

Build and test the image in CI. Scan dependencies, generate an SBOM, and keep credentials out of the image layers.

## 13.9 Knowledge check

1. Why is the weight-size formula only a lower bound?
2. What does dynamic batching trade against throughput?
3. Why must rollback include tokenizer and calibration?
4. What should happen when the inference deadline expires?

**Answers:** 1. Runtime memory includes cache, activations, workspaces, metadata, and overhead. 2. Queueing latency and memory. 3. They affect tokenization and decision probabilities. 4. Stop work, return the defined safe fallback, and record the timeout.
