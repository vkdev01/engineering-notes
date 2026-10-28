---
section: "9"
title: "Loop engineering"
kicker: "Automation"
abstract: "Everything so far assumed you were at the keyboard. A loop has exactly three parts: a goal, a way to verify it, and a stopping condition."
time: "16 min"
order: 9
outcomes:
  - "State the three parts every loop must have"
  - "Convert a prompt into a terminal-state goal with a stopping condition"
  - "Name the four silent costs of an unattended loop"
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

## 9.4 Writing a goal, not a prompt

```text
# instead of
"fix the flaky checkout test"

# write
/goal "checkout e2e suite passes 10 consecutive runs on main"
      --verify "npm run e2e -- checkout --repeat 10"
      --stop "report after 3 failed attempts or 45 minutes"
      --max-iterations 10
```

Three parts, always: the end state, the check, and the stopping condition. The iteration cap is not bureaucracy — it is what separates *autonomous* from *unsupervised*.

:::qa[What are the three parts of a loop?]
A goal (the terminal state), a verification (how you know it holds), and a stopping condition (when to give up). A loop missing the second cannot tell success from failure; missing the third, it either quits early or never quits.
:::

:::qa[How is /goal different from a prompt that says "keep trying until it works"?]
The verification is a command, not the model's opinion, and the stopping condition is explicit and bounded. That means you can walk away: the loop has an exit that does not depend on anyone watching. "Keep trying" is still a prompt, just an optimistic one.
:::

:::qa[What are the silent costs of an unattended loop?]
Four. Retry storms when the failure is environmental. Context growth inside a single loop until quality degrades. Verification that quietly stops running — the loop reports success because nothing checked. And decisions made with no human in the path, which you discover later in the diff.
:::

## 9.5 Three loop patterns

Almost every useful loop is one of these three. Start with the first; add the others only when you have hit their limitation.

```text
# 1. goal loop — run until a condition holds
/goal "checkout e2e passes 10 consecutive runs"
      --verify "npm run e2e -- checkout --repeat 10"
      --stop "report after 3 failed attempts"
Good for: a known failure with an unknown fix.
Fails when: the goal is not machine-checkable.
```

```text
# 2. timer loop — run on a schedule, one task per tick
every 30 min: pick the highest-priority not_started feature,
              implement it, run its verification, commit, record
Good for: a backlog of small, independent, verifiable features.
Fails when: features interact, or the queue runs dry and it invents work.
```

```text
# 3. maker-checker loop — generate, judge, retry with the verdict
generate → check against rubric → PASS? commit : retry with the verdict attached
Good for: work where "does this meet the standard" is the hard part.
Fails when: the rubric is vague — then it is two agents agreeing with each other.
```

## 9.6 What each pattern costs

| Pattern | Main risk | What to instrument | When it pays off |
| --- | --- | --- | --- |
| Goal | retry storms on an environmental failure | attempts per run, failure reason | one flaky or failing check |
| Timer | inventing work when the queue is empty | queue depth, features touched per tick | a long backlog of small rows |
| Maker-checker | rubric drift, both agents wrong together | rejection rate, reasons cited | quality-sensitive changes |

:::qa[Which loop would you run overnight, and why?]
The goal loop, with an iteration cap and a stopping condition. It has the narrowest blast radius: one goal, one check, a bounded number of attempts, and a report either way. A timer loop overnight can touch many features and produce a queue of diffs nobody reviewed.
:::

:::qa[How do you stop a maker-checker loop from just agreeing with itself?]
Give the checker evidence requirements it cannot satisfy by assertion: quote the command output, cite the line. Then measure the rejection rate — a checker that never rejects is not checking, and one that rejects everything has a rubric that does not match reality.
:::
