---
section: "4"
title: "Instruction architecture"
kicker: "Instructions"
abstract: "Why a 600-line AGENTS.md makes an agent worse, and where to put the rule that actually matters."
time: "14 min"
order: 4
outcomes:
  - "Explain why a 600-line instruction file makes an agent worse"
  - "Split a monolithic file into an entry point plus topic docs"
  - "Place a hard constraint where it will actually be read"
---

It started at 40 lines. Every mistake added a rule. Three months later a simple bug fix means reading deployment notes, six style opinions and a lesson from a WebSocket leak — and the security rule on line 300 gets ignored.

## 4.1 Four failures at once

**Context budget** disappears: a 600-line file can eat 10–20k tokens, 8–15% of a 128k window, before the agent reads a single source file. **Position matters**: Liu et al. (2023) showed models use information in the middle of a long context far less reliably than information at the start or end. **Priority flattens**: "never use `eval()`", "prefer functional style" and "watch for that leak" all look identical in a list. And **files only grow**, because deleting a rule feels riskier than adding one.

:::pull
The fix is architectural: a short entry file that routes, plus detail that is revealed on demand. 50–200 lines at the root; everything else behind a link the agent follows only when the task needs it.
:::

## 4.2 Routing instead of dumping

| Pattern | What the agent loads |
| --- | --- |
| One giant file | Every rule, on every task |
| Entry file + topic docs | The invariants, plus only the topic this task needs |
| Entry file + on-demand detail | The invariants, plus the detail when a step requires it |

:::note[Note 4.2.a — what belongs at the root]
Hard constraints, the startup workflow, and the definition of done. Nothing else earns a permanent place in the context window.
:::

## 4.3 Audit quarterly

Delete any rule that has not prevented an incident in the last two quarters. A rule you cannot point at a failure for is not a rule; it is a tax on every session.
