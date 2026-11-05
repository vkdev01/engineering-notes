---
section: "17"
title: "Capstone: build a decision service"
kicker: "End-to-end project"
abstract: "Design, implement, evaluate, and cost a support-ticket routing service with an SLM, explicit abstention, and a safe escalation path."
time: "35 min"
order: 17
outcomes:
  - "Write a workload and risk specification"
  - "Implement a testable routing and escalation policy"
  - "Produce an evaluation and deployment decision record"
---
# 17.1 The brief

Build a service that routes incoming support tickets to billing, technical, account access, or needs review. The service must not perform account actions. Its only side effect is to create a routing recommendation for a downstream queue.

Assume 50,000 tickets/month. The business values low latency and predictable cost, but wrong routing delays resolution. Treat account access and billing as higher-risk categories than generic technical routing.

## 17.2 Architecture

~~~mermaid
flowchart TD
  A[Ticket API] --> B[Validate request and tenant]
  B --> C[Remove or mask unnecessary PII]
  C --> D[SLM classifier]
  D --> E[Schema and label validation]
  E --> F{Policy gate}
  F -->|accepted| G[Queue recommendation]
  F -->|uncertain / invalid| H[Human triage queue]
  G --> I[Audit event]
  H --> I
~~~

The model does not own tenant access or queue permissions. The application validates those independently.

## 17.3 Define the contract

Input: ticket text, language if known, tenant ID, and optional product metadata. Output: one allowed queue, concise evidence, and a confidence estimate. The service must return needs_review when the input is empty, out of scope, ambiguous, or malformed.

## 17.4 Implement the policy boundary

~~~python
ALLOWED = {"billing", "technical", "account_access", "needs_review"}
HIGH_RISK = {"billing", "account_access"}

def accept_prediction(label, confidence, threshold=0.92):
    if label not in ALLOWED:
        return "needs_review"
    if label == "needs_review":
        return label
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool):
        return "needs_review"
    if not 0 <= confidence <= 1:
        return "needs_review"
    # Use a stricter threshold for the higher-impact queues.
    required = max(threshold, 0.97) if label in HIGH_RISK else threshold
    return label if confidence >= required else "needs_review"


tests = [
    ("technical", 0.95, "technical"),
    ("billing", 0.95, "needs_review"),
    ("billing", 0.99, "billing"),
    ("unknown", 0.99, "needs_review"),
    ("account_access", None, "needs_review"),
]
for label, confidence, expected in tests:
    actual = accept_prediction(label, confidence)
    assert actual == expected, (label, confidence, actual, expected)
print("capstone policy checks passed")
~~~

This is a policy demonstration, not a calibrated classifier. A production threshold must be selected on representative validation data and tied to measured error costs.

## 17.5 Evaluation plan

Create a time-based holdout and split by tenant where tenant-specific templates may leak. Include at least 200 reviewed examples per important class if feasible, plus rare, ambiguous, multilingual, empty, and adversarial inputs. Report macro-F1, per-class recall, confusion matrix, abstention, review volume, schema-valid rate, p95 latency, and cost per successful route.

For high-risk classes, report confidence intervals and inspect false negatives manually. Do not merge all classes into one accuracy number.

## 17.6 Deployment plan

Start in shadow mode: generate predictions without changing routing. Compare against human decisions and adjudicate disagreements. Next, enable recommendations for low-risk classes with human override. Only widen automation after the agreed evidence threshold is met. Keep a rollback switch and preserve an audit trace.

## 17.7 Deliverables

1. Workload specification and cost matrix.
2. Versioned data contract and split strategy.
3. Model/prompt artifact manifest.
4. Evaluation report with confidence intervals.
5. Cost and latency report.
6. Threat model and rollback plan.
7. Decision record: ship, pilot, or reject, with reasons.

## 17.8 Capstone review questions

- Which classes are safe to automate, and why?
- What is the cost of one additional percentage point of false routing?
- What conditions force abstention?
- What evidence would cause you to choose a larger model or deterministic rules instead?
