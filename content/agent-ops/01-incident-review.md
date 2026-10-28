---
section: "1"
title: "Reviewing a run you did not watch"
kicker: "Incident review"
abstract: "An agent session is a black box that produced a commit. Reconstructing what happened is a skill, and it is the same skill as debugging — just with worse logs."
time: "7 min"
order: 1
outcomes:
  - "Reconstruct a session from its artefacts alone"
  - "Separate a wrong decision from a wrong outcome"
  - "Write an incident note the next session can use"
---

You come back to a branch with fourteen commits, three of them reverting each other, and a pull request that says "implemented the feature". Nothing about that tells you what happened.

## 1.1 Read the artefacts in order

The commit history is the only honest record, because it is the only thing the agent could not edit after the fact. Read it first, before the diff, before the summary.

- **Commit order** — where did the work start, where did it stall, what got reverted.
- **Diff shape** — a healthy feature touches a few files with a consistent story; a struggling one touches the same file repeatedly.
- **Test files** — were tests written before or after the implementation, and were they ever modified to pass?
- **Leftovers** — debug prints, commented-out blocks, temporary scripts.

:::note[Note 1.1.a — the revert trail]
Two reverts of the same file is the clearest signal that the agent was guessing. Three is a harness problem: it had no way to verify, so it oscillated.
:::

## 1.2 Wrong decision, wrong outcome

Separate the two before you write anything down. A session can make every correct decision and still fail because the task was under-specified; it can also stumble into a passing result with a decision you would never accept.

| | Outcome good | Outcome bad |
| --- | --- | --- |
| **Decision good** | Ship it | Fix the task, not the agent |
| **Decision bad** | Rewrite the rule that allowed it | Fix the harness layer that hid it |

:::warn[Warning 1.2.a]
A green build from a bad decision is the most expensive kind of luck. It teaches the harness nothing and sets the precedent for the next session.
:::

## 1.3 The incident note

Three lines, in the repo, next to the work: what the agent did, what it should have done, and which harness layer would have caught it. That note is worth more than a paragraph in a chat thread, because the next session reads the repository and nothing else.
