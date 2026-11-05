---
section: "16"
title: "Security, privacy, and governance"
kicker: "Trust boundaries"
abstract: "Threat-model the entire decision pipeline, minimise sensitive data, constrain model authority, and make decisions auditable."
time: "28 min"
order: 16
outcomes:
  - "Identify prompt injection, data leakage, model abuse, and supply-chain risks"
  - "Apply least privilege and deterministic authorization"
  - "Design privacy, audit, retention, and human-oversight controls"
---
# 16.1 The model is not a security boundary

A model can interpret text, but it does not enforce access control. A prompt saying "never disclose secrets" is not a substitute for preventing secrets from entering the context or restricting the tools available to the model.

Threat-model the complete path: user input, retrieved documents, prompt templates, model weights, inference service, tools, logs, feedback data, and deployment pipeline.

## 16.2 Prompt injection and untrusted data

Retrieved documents, emails, tickets, web pages, and code comments are data, not trusted instructions. An attacker may embed text that attempts to redirect the model or make it call a tool.

Defence in depth:
- label and isolate untrusted content in the prompt format;
- keep secrets out of context unless strictly necessary;
- provide read-only tools by default;
- use narrow typed tool schemas and server-side allowlists;
- authorize every resource access in deterministic code;
- require confirmation for high-impact side effects;
- log tool calls and provide rollback where possible.

Delimiters and system instructions can improve interpretation, but cannot guarantee that prompt injection is neutralised.

## 16.3 Least privilege

Give each model-backed component only the capabilities it needs. A ticket classifier should not possess a payment API credential. If it proposes an action, a separate service should verify the user's identity, account ownership, policy, and current resource state before execution.

Separate credentials by environment and service. Prefer short-lived tokens, scoped permissions, secret managers, and rotation. Never place API keys in prompts, notebooks, test fixtures, container images, or model artifacts.

## 16.4 Data minimisation and privacy

Send only fields needed for the task. Remove or tokenise direct identifiers when they are not necessary. Define purpose, lawful basis where applicable, retention, deletion, access controls, data residency, and vendor processing terms with the responsible privacy/legal teams.

Training data, fine-tuning examples, evaluation sets, traces, and feedback queues all require governance. Removing a user record from the source database does not automatically remove it from exported training data or model checkpoints.

## 16.5 Supply-chain and model provenance

Verify model source and license. Pin immutable revisions and record cryptographic hashes. Review dependencies, tokenizer files, custom code, adapters, and quantization tools. Scan container images and generate a software bill of materials (SBOM).

Treat downloaded model code as executable supply-chain input. Prefer safe weight formats and disable remote custom code unless you have reviewed and accepted the risk.

## 16.6 Auditability

For each consequential decision, retain the minimum information needed to reconstruct the event:
- request and correlation identifiers;
- model, tokenizer, prompt, calibration, and policy versions;
- decision and reason code;
- relevant evidence references;
- confidence or score with a clear definition;
- fallback/escalation path;
- timestamps, latency, and actor/service identity.

Do not log full sensitive prompts by default. Use redaction, access control, retention limits, and sampling. A trace should make a decision reviewable without creating a second database of sensitive personal information.

## 16.7 Human oversight and appeal

Define which decisions can be automated, which require review, and how users can challenge an outcome. Human review must have enough evidence and time to be meaningful; a nominal approval click on an opaque recommendation is not effective oversight.

Monitor reviewer disagreement and override rates. A high override rate may indicate poor model quality, unclear policy, or inadequate reviewer training.

## 16.8 Governance checklist

Before launch, document:
- intended purpose and prohibited uses;
- affected users and potential harms;
- data sources, retention, and access;
- model provenance and license;
- evaluation by important cohorts;
- decision thresholds and cost assumptions;
- escalation and appeal route;
- monitoring, incident response, and rollback owner.

Legal obligations vary by jurisdiction and application. This chapter is an engineering checklist, not legal advice; involve qualified counsel and domain risk owners for regulated or high-impact deployments.

## 16.9 Knowledge check

1. Why is a system prompt not an access-control mechanism?
2. What does least privilege mean for an SLM classifier?
3. Why can detailed logs create privacy risk?
4. What makes human oversight meaningful?

**Answers:** 1. Model instructions are probabilistic and do not enforce permissions. 2. It receives only the narrow inputs and capabilities required; privileged actions are separately authorized. 3. Logs may retain sensitive user data and secrets. 4. Reviewers can inspect relevant evidence, challenge outcomes, and actually change the decision.
