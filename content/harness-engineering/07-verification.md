---
section: "7"
title: "Verification"
kicker: "Feedback"
abstract: "Done is a claim; evidence is a fact. The blind spots of unit tests, the three-layer termination check, and why end-to-end verification changes how the agent writes code."
time: "13 min"
order: 7
outcomes:
  - "Name four defect classes a green unit suite cannot see"
  - "Run the three-layer termination check on a feature"
  - "Separate the agent doing the work from the agent judging it"
---

Modern neural networks are systematically overconfident — reported confidence runs above actual accuracy, as Guo et al. showed in 2017. An agent that feels finished is reporting a feeling.

## 7.1 The blind spots of unit tests

Unit tests isolate by design: mock the dependency, test the unit. Every module passes while the system is broken. Four classes of defect survive a green suite.

| Defect class | Why the unit suite misses it |
| --- | --- |
| Interface mismatch | Both sides mock the boundary, so a relative-vs-absolute path never meets |
| State propagation | A fresh mock environment each test hides stale cache entries |
| Resource lifecycle | Handles and connections are created and torn down per test |
| Environment dependency | Correct against mocks, wrong against real config or latency |

## 7.2 The three-layer termination check

Lint and types prove the code is well formed. The test suite proves the units behave. Only a full flow proves the system works — configuration, migrations, external services and behaviour over time all surface there and nowhere else.

:::note[Note 7.2.a — the test changes the code]
When the agent knows a full flow will be executed, it starts asking how its interface connects upstream, respects architectural boundaries, and handles error paths. End-to-end verification is not only a filter; it is a constraint on the shape of the solution.
:::

## 7.3 Separate the worker from the checker

Agents praise their own output. The structural fix is to give the checker its own rubric and its own evidence requirement, and to make "looks good" an invalid verdict.

:::exercise[Exercise 07.1 · Audit your definition of done]{id="checklist" items="Lint and typecheck run in CI;The unit suite passes;A full user flow runs end to end;Failures are recorded with the command output;The checker is separate from the implementer;A feature cannot move to passing without evidence" grades="A,B,C,D,F"}
:::

:::warn[Warning 7.3.a]
If your definition of done stops at "tests are green", you have automated exactly the gap the agent is worst at.
:::
