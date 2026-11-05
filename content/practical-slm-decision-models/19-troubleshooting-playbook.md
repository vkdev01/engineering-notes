---
section: "19"
title: "Troubleshooting and operational playbook"
kicker: "Field guide"
abstract: "Diagnose quality regressions, latency spikes, memory failures, malformed outputs, drift, and escalation overload using symptoms and measurable checks."
time: "18 min"
order: 19
outcomes:
  - "Map symptoms to likely causes and diagnostic measurements"
  - "Distinguish model, data, serving, and integration failures"
  - "Use rollback and incident procedures safely"
---
# 19.1 Diagnose before changing the model

A sudden quality drop may be caused by a model revision, prompt change, tokenizer mismatch, retrieval index, traffic mix, upstream schema, or label policy. First compare the deployed artifact manifest and traffic distribution with the last known-good release.

## 19.2 Symptom-to-diagnosis table

| Symptom | First checks | Likely intervention |
|---|---|---|
| Accuracy falls for one class | class mix, label changes, recent examples | relabel, rebalance, update examples |
| All outputs malformed | tokenizer/template, schema mode, parser | restore compatible template; validate |
| Confidence rises but quality falls | calibration, drift, threshold | recalibrate, shift threshold, review |
| p95 latency spikes | queue depth, concurrency, output length | capacity, batching, timeout budget |
| OOM at high load | KV cache, context length, batch size | cap concurrency/context; quantise |
| Escalation queue fills | threshold, traffic shift, upstream change | throttle automation; add review capacity |
| Duplicate actions | retry semantics, idempotency key | enforce idempotent writes |

## 19.3 Safe incident sequence

1. Protect users: disable autonomous actions or route to review.
2. Preserve evidence: capture trace IDs, model/prompt revisions, inputs under approved retention policy, and service metrics.
3. Compare against the last known-good artifact.
4. Reproduce on a frozen sample and classify the failure.
5. Roll back if impact is ongoing and rollback is safe.
6. Add a reviewed regression case after root cause is established.
7. Document impact, remediation, and follow-up owner.

## 19.4 Operational signals

Monitor request rate, p50/p95/p99 latency, timeout/error rate, queue depth, token counts, cost, schema-valid rate, abstention/escalation, and sampled quality. Slice by model revision, prompt version, language, tenant, and task type where privacy and sample size permit.

Avoid logging raw sensitive text by default. Prefer trace IDs, hashes, redacted features, and controlled sampling.

## 19.5 Knowledge check

1. What should you do before tuning a model after a sudden production regression?
2. Which metric helps diagnose queue overload?
3. Why are idempotency keys important during retries?

**Answers:** 1. Compare the full deployed artifact and traffic/data dependencies. 2. Queue depth and escalation rate. 3. They prevent a retried request from applying the same side effect twice.
