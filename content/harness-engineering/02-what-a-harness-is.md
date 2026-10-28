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

## 2.5 The whole thing on one page

:::figure[The five subsystems, and where the model sits]{id="subsystems" note="one artefact inside box one is not the harness"}
:::

The practical test for whether you have a harness or a prompt: can you name, for each of the five boxes, a file in your repository that does that job? If environment has no `init.sh`, if state has no feature list, if feedback has no command — those are the boxes to work on, in that order of cheapness.

```markdown
# the smallest AGENTS.md that is still a harness (about 40 lines)

## Startup
1. Read progress.md — last verified state and next step.
2. Read feature_list.json — pick the highest-priority not_started item.
3. Run ./init.sh. If the baseline is red, fix that before anything else.

## Rules
- One feature at a time. WIP = 1.
- Do not mark a feature done because code was added.
- Never change the verification rules mid-task.

## Definition of done
- behaviour implemented
- `npm run lint && npm run test && npm run e2e` pass
- evidence recorded in feature_list.json
- repo still starts from a cold clone
```

:::qa[Is a good system prompt a harness?]
No. It is one artefact inside the instructions subsystem, which is one of five. A prompt can tell the agent what you want; it cannot give it a working environment, a record of what was already done, or a command that proves the work is correct. Those are the other four boxes, and they carry most of the reliability.
:::

:::qa[How do you decide which subsystem to improve first?]
Remove one at a time and re-run an identical task. The removal that hurts most is the one to invest in. When you cannot run that experiment, fix in order of cheapness and blast radius: environment first (one script), then state (two files), then feedback (a command), then instructions, then tools.
:::

:::qa[What does "the repo is the spec" mean in practice?]
That anything the agent needs to know must live in the repository, because the repository is the only thing it can read. A decision in Slack, a convention in someone's head, a runbook in Confluence — all of it is invisible. "In practice" means: if a rule matters, there is a file that states it, close to the code it constrains.
:::
