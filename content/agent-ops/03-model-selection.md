---
section: "3"
title: "Choosing a model for the job"
kicker: "Routing"
abstract: "One model for everything is either too expensive or too weak. Route by task shape, and keep a small model for the work that has a verification command."
time: "6 min"
order: 3
outcomes:
  - "Match a task shape to a model tier"
  - "Explain when a cheaper model is the right call"
  - "Know the tasks that must not be delegated down"
---

Model choice is a harness decision, not a preference. The question is not "which is best" but "what does this task need, and what will prove it worked".

## 3.1 Three shapes of work

| Task shape | Needs | Sensible tier |
| --- | --- | --- |
| Mechanical, verifiable | A clear command that says pass or fail | Smallest model that passes the command |
| Multi-file feature | Planning, context retention, consistency | Mid tier, with a written plan |
| Ambiguous, high blast radius | Judgement, and a human in the loop | Frontier tier, human approves |

## 3.2 The rule that matters

If a task has a verification command that runs in seconds, run it on the cheapest model that passes and spend the difference on verification depth. If it has no verification, the model tier is not your problem — the missing check is.

:::note[Note 3.2.a — tier down after the harness improves]
As the harness matures, tasks move down a tier rather than up. That is the signal that the environment is doing the work instead of the model.
:::
