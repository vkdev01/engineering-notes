---
section: "16"
title: "Sources, annotated"
kicker: "Reading"
abstract: "What to read next, and specifically what to take from each source. Six references, ranked by how much of this course rests on them."
time: "7 min"
order: 16
outcomes:
  - "Know which primary source answers which question"
  - "Avoid the secondary material that repeats without evidence"
  - "Find the research behind the claims about position and calibration"
---

## 16.1 Primary sources

**OpenAI — *Harness engineering: leveraging Codex in an agent-first world*.**
The clearest statement of "the repo is the spec", the ~100-line `AGENTS.md` as a directory page, and the operational habits: golden rules, periodic cleanup, rules promoted into tooling. Read it for the framing and for the drift problem. Take: the entry-file size discipline and the cleanup loop.

**Anthropic — *Effective harnesses for long-running agents*.**
Where the state discipline comes from: one feature at a time, verification before completion, written progress, explicit recovery paths. Read it for the operating procedure. Take: WIP = 1 and the handoff artefacts.

**Anthropic — *Harness design for long-running application development*.**
The planner/generator/evaluator split, and the honest reporting of a six-hour, $200 run that still did not finish. Read it for the architecture of the checker and for the calibration of expectations. Take: separate the worker from the checker.

**Learn Harness Engineering** — `github.com/walkinglabs/learn-harness-engineering` (MIT).
A structured course with lectures, projects and copy-ready templates, plus reverse-engineered breakdowns of how Claude Code, Codex, Pi and DeepSeek build their harnesses. Read it if you want the long form with exercises. Take: the templates, and the frontier breakdowns.

## 16.2 Research behind the claims

**Liu et al., *Lost in the Middle* (2023).** The evidence that models use information in the middle of a long context less reliably than information at either end. This is why invariants go at the top of the entry file and topic docs are routed rather than concatenated.

**Guo et al., *On Calibration of Modern Neural Networks* (ICML 2017).** The evidence that reported confidence exceeds accuracy. This is why "the agent said it was done" is not an input, and why the definition of done has to be external.

**Lehman's laws of software evolution.** Systems under continuous change grow more complex unless actively managed. This is the argument for pruning the harness and for periodic cleanup rather than one heroic refactor.

**The testing pyramid (Google).** Useful for the shape of a suite, and for understanding exactly what a unit-heavy suite cannot see: the seams between components.

## 16.3 What to skip

Material that quotes benchmark deltas for orchestration patterns without a reproducible task, articles that present a prompt template as a harness, and anything that reports a cost saving from removing verification. The first two are unverifiable; the third is a way to buy a cheaper bill with an incident.

:::qa[If someone reads only one source, which?]
Anthropic's *Effective harnesses for long-running agents*. It is the shortest path from "agents are unreliable" to a concrete operating procedure — one feature at a time, verify, record, hand off — and it is written from production experience rather than from first principles.
:::

:::qa[What would you check before trusting a claim about agent performance?]
Three things: the task set (is it public and reproducible), the harness (was the comparison run with the same environment and verification), and the baseline (what exactly is the delta measured against). Most published numbers fail at least one, and a surprising number of quoted figures come from unrelated papers.
:::

:::qa[How would you keep this material current?]
Track the primary sources, not the summaries: the two labs' engineering blogs and the course repository. Everything else is downstream, and downstream material ages badly — the underlying constraints (context, verification, state) have been stable far longer than the tooling around them.
:::
