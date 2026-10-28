---
section: "8"
title: "Observability and clean exits"
kicker: "Feedback"
abstract: "Code review shows what was written; traces show what actually ran. Plus what clean state means, and why drift compounds when nobody pays it down."
time: "11 min"
order: 8
outcomes:
  - "Say what runtime observability buys that code review cannot"
  - "Define clean state as six checkable conditions"
  - "Explain how drift compounds and how to pay it down"
---

Ask why two tests are failing and a harness without observability answers "not sure, might be a timing thing". Every decision after that is a guess.

## 8.1 Four costs of a blind runtime

- You cannot distinguish **correct** from **looks correct** — code review shows what was written, not what ran.
- Evaluation becomes **mysticism**: two evaluators with implicit standards disagree and neither can say why.
- Retries become **blind**: the agent fixes unrelated paths while the real cause survives.
- The **handoff cliff** steepens, because the next session must diagnose the system from scratch.

:::note[Note 8.1.a — contract and evidence]
A planner that emits a sprint contract — components, per-component criteria, explicit exclusions — turns a 45-minute retry loop into a 15-minute fix. The difference is whether the standard exists outside the agent's head.
:::

## 8.2 Clean state is more than a compiling build

| Check | Why it matters |
| --- | --- |
| Build passes | The next session should not fix it first |
| Whole suite passes | Including tests that existed before this session |
| Verified in CI | "Works on my machine" is not evidence |
| Feature state updated | With the command and its result |
| Temp files removed | Debug prints and scaffolding are drift |
| Cold clone starts | `./init.sh` works from scratch |

## 8.3 Drift compounds by default

Lehman's laws say a changing system grows more complex unless actively managed. OpenAI observed Codex copying whatever patterns already exist in the repository, good or bad. Their team reserved about a fifth of weekly capacity for cleaning up "AI slop", then replaced it with encoded golden rules, periodic cleanup tasks, and rules promoted from documentation into tooling.

:::pull
Technical debt is a high-interest loan. Paying it in small increments is almost always cheaper than one massive payoff event.
:::

:::exercise[Exercise 08.1 · Grade your last session's exit]{id="checklist" items="The build passed when the session ended;All tests passed, including pre-existing ones;Verification ran in CI, not just locally;Feature state and progress were written down;Temp files and debug output were removed;A cold clone still starts via the standard path" grades="A,B,C,D,F"}
:::
