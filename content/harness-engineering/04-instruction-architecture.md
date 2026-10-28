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

## 4.4 The budget, drawn

:::figure[One window, two instruction strategies]{id="budget" note="same rules, different loading strategy"}
:::

## 4.5 An entry file that routes instead of dumping

```markdown
# AGENTS.md

This repo is set up for long-running agent work. Leave it in a state where the
next session can continue without guessing.

## Startup
1. `pwd`, then read `progress.md` and `feature_list.json`.
2. `./init.sh` — install, lint, test. Baseline red? Fix that first.
3. Run `npm run e2e` before starting anything new.

## Invariants (non-negotiable)
- Never commit secrets or `.env` files.
- All SQL goes through the query builder — no string concatenation.
- Every endpoint is behind `requireAuth()`.

## When you touch…      read first
- the API               `docs/api.md`
- the database          `docs/database.md`
- the frontend          `docs/ui.md`

## Definition of done
lint · unit · e2e · evidence recorded · cold clone still starts
```

Sixty lines, and every hard constraint is in the first screenful.

:::qa[Why does adding rules to AGENTS.md eventually make the agent worse?]
Three reasons at once. The file eats context that the task needs. Position matters — a rule in the middle of a long file is used far less reliably than one at the top or bottom. And priority flattens: "never use eval" and "prefer functional style" look identical in a list, so the agent cannot tell a red line from a preference.
:::

:::qa[What is an entry file, and what belongs in it?]
A short root file whose job is to route, not to contain everything. In it: the hard invariants, the startup workflow, the definition of done, and pointers to topic docs. Roughly 50–200 lines. Everything else is revealed on demand when the task touches that area.
:::

:::qa[You have 600 lines of accumulated rules. How do you cut it down?]
Sort by consequence, not by topic. Anything that prevented an incident stays at the root. Anything that describes how a subsystem works moves into that subsystem's doc. Anything you cannot point at a failure for gets deleted — a rule with no incident behind it is a tax on every session. Then add the routing table so nothing is lost.
:::
