---
section: "26"
title: "Cloud"
kicker: "Deployment"
abstract: "AWS, GCP and Azure options for a small model, with the cost arithmetic that decides between them."
time: "5 min"
order: 26
outcomes:
  - "Compare managed containers, VMs and managed inference on cost"
  - "Quantify the cold start you are choosing"
  - "Keep decision logs inside the jurisdiction that requires it"
---

A 360M INT8 model does not need a GPU. That single fact reshapes cloud deployment: you are choosing between CPU
instance types, container runtimes and managed inference endpoints, and the cheapest option is usually not the one
marketed for AI.

## Options compared

| Option | AWS | GCP | Azure | Fit |
| --- | --- | --- | --- | --- |
| Managed containers | ECS Fargate | Cloud Run | Container Apps | Best default for CPU inference |
| Kubernetes | EKS | GKE Autopilot | AKS | When you already run a cluster |
| Serverless functions | Lambda (container) | Cloud Functions | Functions | Poor — cold start loads the model |
| Managed inference | SageMaker | Vertex AI | Azure ML | When you need the surrounding MLOps |
| GPU (only if needed) | g5.xlarge (T4) | g2-standard-4 | NCasT4_v3 | > 1B models or high throughput |

## Cost arithmetic

Steady 20 requests/second, 24×7, 360M INT8 at ~40 req/s per vCPU:

| Setup | Shape | Approx monthly | Notes |
| --- | --- | --- | --- |
| Cloud Run / Fargate | 1 vCPU, 1 GB, min-instances 1 | $25–$45 | Scale to zero is not viable — cold start reloads the model |
| Reserved VM | 2 vCPU, 4 GB | $12–$30 | Cheapest steady-state; you own the patching |
| Managed inference endpoint | 1 small instance | $60–$200 | Pays for itself only if you use the surrounding tooling |
| Single T4 GPU | 1× T4, 16 GB | $180–$350 | Only worth it above ~100 req/s or for > 1B models |

*Order-of-magnitude estimates from public list prices; verify
against current pricing and your committed-use discounts. The conclusion that matters: a CPU container is 5–10×
cheaper than a GPU for a sub-1B model at moderate volume.*

## Reference architecture (managed containers)

```text
client ──► API gateway (auth, rate limit, WAF)
              │
              ▼
        decision service (container, CPU, min 1 / max 10)
              │            │
              │            └──► decision log (append-only, e.g. S3 + Athena)
              ▼
        downstream action (ticket, ledger, queue)
```

- Model artefact pulled from object storage by digest at build time, never at runtime.
- Min instances ≥ 1 so the first request of the day is not a 30-second cold start.
- Concurrency per instance sized to CPU, not to request count: 2 vCPU ≈ 2–3 concurrent decisions for a 360M model.
- Autoscale on queue depth or p95 latency, not CPU alone — CPU saturates before latency degrades visibly.
- Decision log immutable and queryable; it is both your audit trail and your next training set.

## Serverless cold start, quantified

```python
cold start = image pull + process start + model load + warm-up
360M INT8, 360 MB artefact : ~1.5 s load + 0.4 s framework import + ~0.2 s warm-up
                             ≈ 2.1 s typical, up to 6 s under a cold page cache
hot path                   : 25 ms
```

A 2-second cold start against a 25 ms hot path is an 80× amplification. For anything user-facing, keep a warm
minimum; for batch or overnight work, scale to zero and accept it.

## Data residency and India-specific notes

- RBI's storage directions require payment data to be stored in India; choose a region accordingly and keep the decision log inside it.
- DPDP Act obligations apply to personal data in decision logs — minimise, encrypt, and set retention explicitly.
- For regulated workloads, a self-hosted model in your own VPC usually clears legal review faster than a managed third-party endpoint.

## Multi-region, only if you must

Two regions doubles cost and adds a consistency problem for the decision log. Do it when a regulatory requirement
or a hard latency SLA demands it, and make one region authoritative for the log.
