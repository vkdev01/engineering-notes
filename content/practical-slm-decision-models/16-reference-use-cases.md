---
section: "16"
title: "Reference use cases and architecture patterns"
kicker: "Applied patterns"
abstract: "Translate recurring product requirements into SLM patterns, including extraction, routing, redaction, and on-device classification."
time: "18 min"
order: 16
outcomes:
  - "Map workload requirements to a reusable architecture pattern"
  - "Identify where retrieval, deterministic checks, and review belong"
  - "Define success metrics before implementation"
---
# 16.1 Pattern: structured extraction

Use when the source is semi-structured text and the output has a known schema. The SLM extracts candidate fields; deterministic validators check types, ranges, cross-field constraints, and evidence spans. Missing fields remain null or trigger review. Never invent a value to satisfy a required field.

## 16.2 Pattern: intent routing

Use a small label set with representative examples and an explicit needs-review class. Measure per-class recall, confusion matrix, abstention, and queue load. Revisit labels when teams or product taxonomy changes.

## 16.3 Pattern: redaction assistance

A model may identify candidate personal information, but deterministic recognisers and human sampling should validate recall. Measure missed sensitive spans separately from false redactions. Do not assume a general-purpose SLM catches every identifier or language variant.

## 16.4 Pattern: on-device assistance

On-device inference can reduce network dependency and data transfer, but device memory, thermal limits, battery, model update, and offline behaviour become product constraints. Test on the lowest supported device, not only a developer laptop.

## 16.5 Architecture selection table

| Requirement | Pattern | Non-model control |
|---|---|---|
| Extract invoice fields | SLM + schema | arithmetic and totals validation |
| Route support ticket | SLM classifier | allowed queue list and review |
| Summarise private docs | local SLM + retrieval | document ACL checks |
| Identify PII | SLM + recognisers | human audit and deletion controls |
| Answer changing policy questions | SLM + retrieval | source freshness and citation checks |

## 16.6 Knowledge check

1. Why should extraction return evidence spans?
2. Which metric is especially important for redaction?
3. Why test on the lowest supported device?

**Answers:** 1. To audit where the value came from and catch hallucinated fields. 2. Recall for sensitive spans, with false-redaction rate as a companion. 3. It defines the real memory, thermal, and latency constraints.
