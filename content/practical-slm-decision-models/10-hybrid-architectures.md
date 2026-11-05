---
section: "10"
title: "Hybrid architectures and model routing"
kicker: "System composition"
abstract: "Compose deterministic code, retrieval, small models, and escalation into a cost-aware decision pipeline with explicit fallbacks."
time: "22 min"
order: 10
outcomes:
  - "Design a cascade with deterministic, SLM, and larger-model stages"
  - "Calculate expected cost and quality under routing assumptions"
  - "Define abstention, fallback, and timeout behaviour"
---
# 10.1 The model is one component

A decision service rarely needs a language model for every step. Deterministic code is cheaper and more predictable for parsing, arithmetic, permissions, and state transitions. Retrieval is better for fresh evidence. A small language model can classify or extract. A larger model can handle ambiguous cases. Humans handle high-impact exceptions.

~~~mermaid
flowchart TD
  A[Request] --> B[Validate schema and permissions]
  B --> C{Deterministic rule resolves?}
  C -->|yes| D[Return rule result]
  C -->|no| E[Retrieve trusted evidence]
  E --> F[SLM classifier / extractor]
  F --> G{Confidence and policy gates pass?}
  G -->|yes| H[Validate result and respond]
  G -->|no| I[Escalate to larger model or human]
  I --> J[Validate, log, and respond]
~~~

The gates should use calibrated estimates or empirically validated policies, not a raw confidence field blindly.

## 10.2 Expected cost of a cascade

Suppose the SLM costs \(c_s\), the larger model costs \(c_l\), and fraction q of requests escalate. Expected inference cost is:

\[
E[C]=c_s+q c_l
\]

If the SLM costs $0.0004/request, the large model costs $0.008/request, and 12% escalate:

\[
E[C]=0.0004+0.12(0.008)=\$0.00136
\]

Compared with using the large model for every request ($0.008), the illustrative reduction is 83%. This is not a quality claim. The cascade is acceptable only if the SLM's accepted cases meet the task's quality and safety requirements.

## 10.3 Quality and coverage are coupled

Raising the SLM acceptance threshold usually reduces coverage and increases escalation. Plot accepted fraction, error rate among accepted cases, escalation rate, cost/request, and p50/p95 latency.

A useful policy objective is minimise expected cost subject to accepted-case error below a risk limit and escalation capacity below a service limit. This makes the trade-off explicit.

## 10.4 Routing policy example

~~~python
from dataclasses import dataclass

@dataclass
class Prediction:
    label: str
    probability: float
    in_scope: bool

def route(pred: Prediction, threshold: float = 0.92) -> str:
    # A probability threshold is meaningful only after calibration on representative data.
    if not pred.in_scope:
        return "human_review"
    if pred.probability < threshold:
        return "large_model"
    return "slm_result"

cases = [
    Prediction("billing", 0.98, True),
    Prediction("technical", 0.73, True),
    Prediction("account_access", 0.99, False),
]
for case in cases:
    print(case.label, "->", route(case))

slm_cost, large_cost, escalation_rate = 0.0004, 0.008, 0.12
expected = slm_cost + escalation_rate * large_cost
print("expected cost/request: {:.5f}".format(expected))
print("reduction vs large-only: {:.1%}".format(1 - expected / large_cost))
~~~

## 10.5 Latency is not just average latency

If the SLM runs first and the large model runs sequentially on escalations, escalated requests have approximately the sum of both latencies plus routing overhead. The overall p95 can be dominated by the escalation path even when only a small fraction escalates. Measure each path separately and set timeout budgets.

Parallel execution can reduce latency but increases cost and may waste work. Speculative execution is appropriate only when the value of faster completion exceeds the extra compute and complexity.

## 10.6 Fallbacks are product behaviour

Define what happens when retrieval is empty or stale, the SLM times out, structured output is invalid, the large model is unavailable, the human review queue is full, or confidence is missing/malformed.

Fail closed for privileged actions. A fallback should preserve safety, not silently lower standards.

## 10.7 Avoid routing loops

Attach a bounded attempt count and explicit reason to every transition. Do not let the SLM repeatedly escalate to itself. Use idempotency keys for actions and persist the decision trace so retries do not duplicate side effects.

## 10.8 Knowledge check

1. With \(c_s=0.001\), \(c_l=0.01\), and escalation 20%, what is expected cost?
2. Why can p95 latency rise sharply despite low escalation volume?
3. Why is a calibrated confidence threshold still not an authorization check?

**Answers:** 1. \(0.001+0.2(0.01)=0.003\). 2. Escalated requests traverse sequential stages and can dominate the tail. 3. Authorization depends on identity, resource, policy, and state, not confidence.
