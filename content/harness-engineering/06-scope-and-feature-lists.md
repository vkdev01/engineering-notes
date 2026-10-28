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

## 6.3 The list, as a file

```json
{
  "project": "acme-api",
  "rules": { "single_active_feature": true, "passing_requires_evidence": true },
  "features": [
    {
      "id": "orders-005",
      "priority": 5,
      "title": "Cursor pagination on /orders",
      "user_visible_behavior": "GET /orders?cursor=… returns the next 20 orders; the last page has no next cursor",
      "status": "in_progress",
      "verification": ["npm run e2e -- orders.pagination"],
      "evidence": [],
      "notes": "keyset on (created_at, id); offset rejected — see progress.md"
    }
  ]
}
```

Three fields make a row usable: the observable behaviour, the exact check, and the state. A row missing the check is a wish, and the agent will grade it against its own standard — usually "the code looks fine".

:::qa[Why is WIP = 1 the rule rather than a preference?]
Because attention divides arithmetically. With capacity C and k active tasks, each gets C/k. Below the threshold a task needs to be reasoned about *and* verified, nothing finishes — you get k half-features and no end-to-end check. One item, verified and committed, is the only configuration where "done" means something.
:::

:::qa[What makes a feature list a harness primitive rather than a to-do list?]
A to-do list is read by a human. This list is read by the scheduler (to pick work), the verifier (to decide pass/fail) and the handoff writer (to summarise). That is why it must be machine-readable, in the repository, with a verification command per row — it is the shared data structure the whole harness runs on.
:::

:::qa[How do you stop an agent from doing "a little extra" while it is in there?]
Give it a boundary it can check: the selected feature's behaviour and its verification command. Anything outside that is a new row in the list, not a detour. If a blocker forces a supporting change, the rule is "narrow and documented", not "while I'm here".
:::
