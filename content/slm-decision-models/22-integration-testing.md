---
section: "22"
title: "Integration testing"
kicker: "Testing"
abstract: "End-to-end paths: spec → model → policy → decision → log, including the failure branches that only appear in staging."
time: "5 min"
order: 22
outcomes:
  - "Pin a golden set with a deliberate digest update"
  - "Cover the failure branches, not just the happy path"
  - "Assert latency and reproducibility"
---

Unit tests prove the pieces work. Integration tests prove the *decision* works — that a request arrives,
becomes a score, becomes an action, gets logged, and behaves identically after a redeploy.

## The contract test

One test that pins the entire decision path against a golden set. It is the single most valuable test in a decision
repo, because it catches every layer at once:

```python
import json, hashlib
from slm_decision import evaluate_policy

def test_golden_set_decision_quality(service, golden):
    report = service.evaluate(golden.texts, golden.expected_actions)
    assert report.macro_f1 >= 0.80, report
    assert report.abstain_rate <= 0.30
    assert report.cost_per_case <= 5.50
    # and the exact decisions must be reproducible
    digest = hashlib.sha256(json.dumps(report.actions).encode()).hexdigest()
    assert digest == golden.expected_digest       # updated deliberately, never automatically
```
:::note[Update the digest on purpose]
When you intentionally change the model, the prompt or a threshold, the digest changes and the test fails. That is the
point: the diff must be reviewed by a human who confirms the new decisions are better, not merely different.
:::

## Path coverage matrix

| Path | Setup | Expected outcome |
| --- | --- | --- |
| Happy path | Valid input, model healthy | Action returned, p95 latency within budget |
| Model timeout | Inject 3 s delay | Abstain action, latency capped at the timeout, error logged |
| Model load failure | Corrupt artefact | Service starts in degraded mode using the rule fallback |
| Schema violation | Force malformed generation | Abstain, raw output logged, no retry loop |
| Retriever down | Index unreachable | Degrade to no-context policy, or abstain if the task needs context |
| Cost matrix change | New spec version | Decisions change as expected, golden digest updated deliberately |
| Cold start | Fresh container | First request within 2× p95; readiness probe gates traffic |

## Reproducibility test

A decision must be identical when replayed. This is what separates a decision model from a chatbot, and it is cheap
to verify:

```python
def test_decision_is_reproducible(service, sample_inputs):
    first = [service.decide(t) for t in sample_inputs]
    second = [service.decide(t) for t in sample_inputs]
    assert [d.action for d in first] == [d.action for d in second]
    assert [round(d.confidence, 6) for d in first] == [round(d.confidence, 6) for d in second]

def test_replay_from_log(service, decision_log):
    for row in decision_log.sample(100, random_state=0):
        again = service.decide(row["input_text"], spec_version=row["spec_version"])
        assert again.action == row["action"]        # same model, same prompt, same thresholds
```

## Latency assertions in integration tests

```python
import time, numpy as np

def test_latency_budget(service, sample_inputs):
    ts = []
    for t in sample_inputs[:200]:
        s = time.perf_counter(); service.decide(t); ts.append((time.perf_counter() - s) * 1000)
    p50, p95 = np.percentile(ts, 50), np.percentile(ts, 95)
    assert p95 < 250, f"p95 {p95:.0f} ms over budget"
    assert p95 < 8 * p50, "tail too heavy — check for retries or GC pauses"
```

The second assertion is the interesting one: a healthy decision service has a flat tail. A p95 that is 20× the p50
almost always means a retry loop, a cold cache, or unbounded generation.

## Staging with production shape

- Same model artefact bytes as production (verify the SHA-256 at startup).
- Same quantisation and same hardware class — INT8 on staging and FP16 in production invalidates every latency test.
- Replay a week of production inputs through staging and diff the actions; investigate any change over 0.5%.
- Exercise the queue and concurrency limits, not just single requests.
- Run the escalation path with a real (or mock) downstream ticket system, including its failures.

## Contract with downstream systems

```python
DECISION_SCHEMA = {
  "type": "object",
  "required": ["action", "confidence", "reason_code", "model", "spec_version"],
  "properties": {
    "action":      {"enum": ["approve", "review", "decline"]},
    "confidence":  {"type": "number", "minimum": 0, "maximum": 1},
    "reason_code": {"type": "string", "pattern": "^R[0-9]{1,2}$"},
    "model":       {"type": "string"},
    "spec_version":{"type": "string"}
  },
  "additionalProperties": False
}
```

Validate the response against this schema in both the producer's tests and the consumer's. Schema drift between
teams is the most common cause of silent decision failures in production.
