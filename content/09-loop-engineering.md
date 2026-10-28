---
section: "9"
title: "Loop engineering"
kicker: "Automation"
abstract: "Everything so far assumed you were at the keyboard. A loop has exactly three parts: a goal, a way to verify it, and a stopping condition."
time: "12 min"
order: 9
---

In early 2026 Claude Code and Codex independently shipped `/goal`. You type a terminal state, close the laptop, and the agent analyses, codes, tests, fixes and retries until the condition holds.

## 9.1 What changes when you stop prompting

| | Traditional prompt | `/goal` |
| --- | --- | --- |
| What you provide | What to do next | What the end state looks like |
| What the agent does | Execute once | Loop until achieved |
| Who judges done | You | A verifiable stopping condition |
| When you can walk away | You cannot | The moment you type it |

:::note[Note 9.1.a — the missing third part]
A goal without verification cannot tell success from failure. A goal without a stopping condition either quits early or never quits. Keep an iteration cap: it is the difference between autonomous and unsupervised.
:::

## 9.2 The six primitives

Automations, worktrees, skills, connectors, sub-agents and external state. Each removes one reason you had to be present: the trigger, the isolation, the reusable procedure, the data source, the specialisation, and the memory that outlives a single context window.

:::pull
Harness engineering builds the vehicle. Loop engineering designs the road it drives on — and you design the road from outside the car.
:::

## 9.3 The four silent costs

Loops are cheap to start and expensive to observe. Retry storms, context growth inside a single loop, verification that quietly stops running, and decisions made without a human in the path. Every one of them is invisible until you instrument the loop itself.

:::warn[Warning 9.3.a]
A loop that cannot be stopped from outside is not automation, it is an outage with a schedule.
:::
