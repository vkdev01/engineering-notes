---
section: "2"
title: "What a harness is"
kicker: "Definition"
abstract: "A harness is the engineering infrastructure outside the model weights. It has five subsystems. The prompt is one artefact inside the first of them, and treating it as the whole thing is the most common reason sessions fail."
time: "10 min"
order: 2
outcomes:
  - "Define the five subsystems of a harness and what each carries"
  - "Explain why the weakest subsystem sets your reliability ceiling"
  - "Score a real repository from 0 to 4 on each subsystem"
---

People say "harness" and mean "the system prompt I wrote." That is one of five subsystems. The other four are where most reliability actually comes from.

A new engineer joins your project with no README, no comments, nobody to ask, and CI config buried somewhere. Smart people still struggle. An agent has it worse: it can only see the files you put in front of it and the commands it can run.

## 2.1 Subsystem inventory

Every harness decomposes into the same five parts. Each has a distinct responsibility and a distinct way of failing, so the first job when a session goes wrong is to name which one broke.

| Subsystem | Responsibility | Artefacts |
| --- | --- | --- |
| Instructions | Rules, conventions, definition of done | `AGENTS.md`, `docs/` |
| Tools | What the agent can actually do | shell, test runner, linters |
| Environment | A runnable, isolated place to work | `init.sh`, lockfiles |
| State | What is done, why, and what is next | `feature_list.json` |
| Feedback | Evidence of what actually happened | tests, traces, logs |

:::note[Note 2.1.a — measurement]
To establish which subsystem is load-bearing today, remove one at a time and re-run an identical task. The largest regression identifies the investment; a removal with no effect identifies something you can delete.
:::

## 2.2 Minimum-strength rule

A harness is a chain, not a portfolio. Session reliability is bounded by the weakest subsystem, so improving any other layer produces no observable gain until the weakest one is repaired.

:::exercise[Exercise 02.1 · Score your own harness]{id="scorecard" labels="Instructions,Tools,Environment,State,Feedback" scale="4" unit="total"}
:::

:::warn[Common error 2.2.a]
Teams average their scores, see a healthy 3.2, and conclude the harness is fine. The single 1 in environment is the only number that predicts their next failed session.
:::

## 2.3 Worked example

A four-person team scores 3 / 2 / 1 / 2 / 3 across the five subsystems: 11 of 20, a mean of 2.2. Two of the three sessions in the following week ended with unverified work, and both failed in the environment layer — a cold clone could not install dependencies. The fix was one script, not a rewrite of the instruction file they had spent three weeks expanding.

## 2.4 The prompt is a file, not a system

Treating the instruction file as the whole harness has a predictable signature: the file grows after every incident, sessions get slower, and the same class of failure recurs because nothing executable changed.

:::exercise[Exercise 02.2 · Spend a context window]{id="budget" window="200000" perLine="30" perFile="1200" tool="30000"}
:::

The point of the exercise is arithmetic, not taste. A 600-line instruction file is roughly 10–20k tokens, which is the range where rules start crowding out code reading and reasoning.
