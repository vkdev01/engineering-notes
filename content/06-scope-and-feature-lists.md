---
section: "6"
title: "Scope and feature lists"
kicker: "Scope"
abstract: "One feature at a time, or nothing finishes. Attention as arithmetic, and the three fields a feature row needs before it can be verified."
time: "15 min"
order: 6
outcomes:
  - "Compute the attention budget for k tasks in flight"
  - "Write a feature row with behaviour, verification and state"
  - "Explain why the list must be machine-readable state in the repo"
---

Ask for "user authentication" and you get a schema change, routes, a mail service, bcrypt, a refactored error middleware and a reorganised test directory. Twelve files, eight hundred lines, nothing working end to end.

## 6.1 Attention is a finite resource

This is arithmetic, not personality. Give the agent capacity C and let it activate k tasks at once: each task gets C/k. Once C/k drops below what a single task needs to be reasoned about and verified, none of them finish. The agent did not get dumber — you divided its attention.

| Tasks in flight | Budget per task | What actually happens |
| --- | --- | --- |
| 1 | 100 | Implemented, verified, committed, recorded |
| 2 | 50 | Both survive; the slow verification gets skipped |
| 4 | 25 | Four half-features, no end-to-end check |
| 8 | 12 | Nothing finishes; the next session cannot tell what changed |

:::note[Note 6.1.a — WIP = 1]
Pick exactly one item, implement it, run end-to-end verification, commit, update the list, unlock the next. A blocker justifies a narrow supporting fix and nothing wider.
:::

## 6.2 A feature row needs three fields

Neither Claude Code nor Codex knows what "done" means. You say "add a shopping cart" and the model's interpretation may be "write a Cart component and an addToCart method", when you meant "a user can browse, add to cart, and complete checkout end to end".

- **User-visible behaviour** — the observable outcome, not the implementation.
- **Verification** — the exact command or steps that prove it.
- **State** — `not_started`, `in_progress`, `blocked` or `passing`.

A row missing the verification is a wish. This is why the list has to live in the repository as machine-readable state: the scheduler reads it to pick work, the verifier reads it to judge the work, and the handoff writer reads it to summarise.

:::exercise[Exercise 06.1 · Score the list you have]{id="scorecard" labels="Behaviour written,Verification command,State kept current,Evidence recorded,One active item" scale="4" unit="list"}
:::

:::warn[Common error 6.2.a]
Progress notes like "cart mostly done, payments left" cannot be acted on. What does mostly mean? Which checks passed? The next session has to guess, and guessing is where rework starts.
:::
