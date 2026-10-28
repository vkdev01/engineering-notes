---
section: "4"
title: "Instruction architecture"
kicker: "Instructions"
abstract: "Why a 600-line AGENTS.md makes an agent worse, and where to put the rule that actually matters."
time: "20 min"
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

## 4.6 Three repositories, three entry files

The pattern is stable; the content is not. Three shapes you are likely to meet.

```markdown
# service (one app, one deployable) — ~70 lines
## Startup: read progress.md → feature_list.json → ./init.sh
## Invariants: no secrets · all SQL via repo layer · every route behind requireAuth()
## Read on demand: API → docs/api.md · DB → docs/database.md
## Done: lint · unit · e2e · evidence recorded · cold clone starts
```

```markdown
# monorepo (many packages) — ~110 lines, mostly routing
## Startup: same three steps
## Invariants: no cross-package imports except through src/shared · no new deps without an ADR
## Packages: apps/web → apps/web/AGENTS.md · services/api → services/api/AGENTS.md
## Done: `pnpm -w check` (runs every package's gates)
```

```markdown
# library (published package) — ~50 lines
## Startup: read CHANGELOG.md → ./init.sh
## Invariants: no breaking change without a major bump · public API surface is src/index.ts
## Done: build · type tests · examples still compile
```

In all three, the shape is the same: how to start, what never to break, where to look next, how to prove it is done. The monorepo version is longer only because routing is a bigger share of its job.

## 4.7 Auditing 600 lines down to 90

A real pass, by category rather than by line.

| What you find | Where it goes | Why |
| --- | --- | --- |
| Hard invariants (no secrets, no `eval`) | stays at the top | must be in the first screenful |
| "How our API works" (140 lines) | `docs/api.md`, one pointer line | only needed on API work |
| Three conflicting style rules | pick one, delete two | contradiction is worse than absence |
| Historical incident notes | `docs/incidents.md` | useful, but not per-task |
| Rules with no incident behind them | deleted | a tax with no evidence |
| Definition of done (8 lines) | stays, promoted into `check` | becomes executable instead of prose |

:::figure[How an instruction file grows, and how to break the loop]{id="bloat" note="each individual rule was justified by a real failure"}
:::

The result is not a shorter file for its own sake. It is a file where the first twenty lines are the ones that matter, which is the only part of a long context models use reliably.

:::qa[How do you decide what stays at the root?]
Two tests. Does it apply to *every* change, or only to work in one area? And would violating it cause an incident rather than a preference? Both yes — root. Otherwise it is a topic doc. The exception is the definition of done, which stays at the root even though it is long, because it is the thing every task is judged against.
:::

:::qa[Our rules contradict each other. What now?]
Decide which one is true, delete the other, and note the decision in `progress.md` so nobody re-litigates it. Contradiction is more expensive than either rule being wrong, because the agent picks one at random and you cannot predict which.
:::
