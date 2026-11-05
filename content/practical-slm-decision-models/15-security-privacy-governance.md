---
section: "15"
title: "Security, privacy, and governance"
kicker: "Responsible deployment"
abstract: "Threat-model model inputs and outputs, enforce tool permissions outside the model, protect training data, and build an auditable release process."
time: "22 min"
order: 15
outcomes:
  - "Identify prompt injection, data leakage, and model supply-chain risks"
  - "Apply least privilege and deterministic action validation"
  - "Define privacy, audit, and incident response controls"
---
# 15.1 Threat-model the complete pipeline

The attack surface includes user inputs, retrieved documents, training data, model weights, prompts, tools, logs, and downstream systems. A model can be manipulated by content that appears benign to the application. Treat all external text as untrusted, including retrieved web pages and uploaded files.

## 15.2 Prompt injection is not solved by wording

A prompt may instruct the model to ignore commands inside documents, but the model still processes the content in one context. Delimiters and instruction hierarchy help but cannot enforce security boundaries.

The reliable controls are architectural:
- tools have least privilege and narrow argument schemas;
- read-only tools are separate from write tools;
- secrets are not placed in prompts unnecessarily;
- every action checks user identity, resource ownership, and current state;
- high-impact operations require human confirmation;
- tool calls are logged with trace IDs and idempotency keys;
- output is treated as untrusted until validated.

## 15.3 Data protection

Before training or logging, identify personal and sensitive data, define a lawful purpose and retention period, minimise fields, redact where feasible, restrict access, and document lineage. Deleting a training example after model training may not remove its influence from model weights; retention and deletion requirements must be designed before training.

## 15.4 Supply-chain controls

Pin model revisions and tokenizer versions. Verify model provenance and licenses. Scan dependencies, protect model artifact storage, restrict who can publish models, and record hashes. Treat adapter weights and quantised derivatives as deployable artifacts that need review.

## 15.5 Abuse and safety evaluation

Test direct requests, indirect instructions in retrieved content, malformed inputs, data-exfiltration attempts, tool misuse, and cross-tenant access. Evaluate by attack family and severity, not one aggregate safety score. Red-team findings should become regression tests.

## 15.6 Governance record

For each production model, retain:
- intended use and prohibited use;
- owner and escalation contact;
- model/data/prompt revisions;
- evaluation protocol and results;
- known limitations and affected populations;
- access controls and retention policy;
- monitoring, incident response, and rollback procedure.

## 15.7 Knowledge check

1. Why is "ignore instructions in retrieved content" not a complete prompt-injection defence?
2. What must be checked before a model-generated tool call is executed?
3. Why are adapter weights also part of the supply chain?

**Answers:** 1. The model still sees attacker-controlled text; the prompt is not an isolation boundary. 2. Identity, authorization, resource ownership, current state, schema, and policy. 3. They change model behaviour and can introduce vulnerabilities or provenance/license issues.
