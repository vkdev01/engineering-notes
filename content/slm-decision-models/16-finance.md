---
section: "16"
title: "Finance"
kicker: "Use cases"
abstract: "Fraud, credit and KYC decisions under hard latency budgets and an auditor who will ask why."
time: "5 min"
order: 16
outcomes:
  - "Size a decision against a hard latency budget"
  - "Produce an explanation an auditor accepts"
  - "Add fairness and adverse-action controls"
---

Finance is the best-documented commercial home for SLM decision models: high volume, closed label sets, asymmetric
costs, strict latency and a regulator who wants explanations. All five of those push toward small, self-hosted,
deterministic models.

## Decision inventory

| Decision | Actions | Latency budget | SLM fit |
| --- | --- | --- | --- |
| Card transaction scoring | approve · step-up · block | < 50 ms p99 | Poor alone — SLM enriches a gradient-boosted model's features |
| KYC document consistency | pass · manual · reject | < 2 s | Excellent — extraction + consistency check |
| Loan application narrative | auto · review · decline | < 800 ms | Good — combine with bureau features |
| Dispute / chargeback triage | auto-resolve · investigate · escalate | < 5 s | Excellent — text-heavy, cost-asymmetric |
| Adverse-media screening | clear · flag · escalate | batch | Good — recall matters more than precision |

## The cost matrix is the model

```text
spec = DecisionSpec(
    name="chargeback_triage",
    actions=["auto_resolve", "investigate", "escalate"],
    costs={
        ("auto_resolve", "fraudulent"): 45_000,   # paid out on fraud
        ("auto_resolve", "legitimate"): 0,
        ("investigate",  "fraudulent"): 1_200,    # analyst hour
        ("investigate",  "legitimate"): 1_200,
        ("escalate",     "fraudulent"): 6_500,    # senior + legal
        ("escalate",     "legitimate"): 6_500,
    },
    abstain="investigate", max_abstain_rate=0.35,
)
```

With a 37:1 ratio between a bad auto-resolve and an investigation, the optimal policy investigates anything above
~2.6% fraud probability — a far wider band than intuition suggests. Publishing that derivation is what makes the
policy defensible in an audit.

## Reference numbers

| Metric | Manual baseline | SLM-assisted |
| --- | --- | --- |
| Cases auto-decided | 0% | 62% |
| Cost per case | ₹1,200 | ₹470 |
| Fraud leakage (bad auto-resolves) | — | 0.7% of fraud cases |
| Analyst throughput | ~90 cases/day | ~140 cases/day (pre-sorted queue) |
| p95 latency | n/a | 310 ms |

*Illustrative. Every regulated deployment needs model risk
management sign-off, ongoing validation and documented limits.*

## Explainability that satisfies a reviewer

Not SHAP waterfalls — reviewers want the specific evidence. Make the SLM emit a reason code from a closed set and
store the evidence spans:

```json
{"action": "investigate",
 "confidence": 0.68,
 "reason_code": "R7",                 # R7 = merchant category mismatch
 "evidence": ["MCC 5999 vs stated 5411", "3 prior disputes in 90 days"],
 "model": "slm-360m-chargeback@v4", "prompt_hash": "9f2c…", "calib_T": 1.31}
```

## Fairness and adverse action

A decline is an adverse action. In most jurisdictions it requires a stated reason, and in India, RBI's digital
lending and fair-practices directions constrain automated decisioning. Practical controls:

- Never let the SLM see protected attributes directly; test for disparate impact on proxy variables.
- Track approval rate by slice monthly, with a documented threshold for investigation (e.g. ±5 points).
- Keep a counterfactual review set: 2% of auto-decisions are human-reviewed regardless of score.
- Retain inputs, scores and decisions for the statutory period — often 5–8 years.

## Latency engineering

Sub-50 ms decisions cannot afford a 360M decoder in the hot path. The pattern that works: pre-compute SLM features
for slow-moving entities (merchant, customer, device) offline, then let the real-time model consume them.

```text
offline  : SLM(merchant_profile)  -> embedding + risk tag, refreshed nightly
realtime : gradient_boosted(txn_features, slm_features)  -> action,   p99 18 ms
```

This keeps the SLM's judgement without its latency, and it is the most common production pattern in payments.
