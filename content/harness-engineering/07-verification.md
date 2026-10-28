---
section: "7"
title: "Verification"
kicker: "Feedback"
abstract: "Done is a claim; evidence is a fact. The blind spots of unit tests, the three-layer termination check, and why end-to-end verification changes how the agent writes code."
time: "19 min"
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

## 7.4 The gates, drawn

:::figure[Three gates, three classes of defect]{id="layers" note="stop at gate two and you automate the gap"}
:::

## 7.5 One command that runs all three

```json
{
  "scripts": {
    "lint":  "eslint . --max-warnings 0 && tsc --noEmit",
    "test":  "vitest run",
    "e2e":   "playwright test --reporter=line",
    "check": "npm run lint && npm run test && npm run e2e"
  }
}
```

`npm run check` is the definition of done in executable form. If it is not one command, it is not a definition — it is three things someone has to remember, and the agent will remember two.

:::qa[A unit suite is green. Why is that not evidence the feature works?]
Because unit tests isolate by design: mock the dependency, test the unit. Every module passes while the wiring is broken. Interface mismatches, stale caches across a migration, unreleased file handles, and environment-specific config all live in the seams that mocks remove.
:::

:::qa[What is the three-layer termination check?]
Lint and types (is it well formed), the unit suite (do the units behave), then a full user flow (does the system work). All three must pass before a feature can be marked done. Each layer catches a class of defect the others structurally cannot see.
:::

:::qa[How do you stop an agent from declaring victory early?]
Take "done" away from it. Replace the agent's judgement with an external command whose output is recorded. Then separate the worker from the checker: give the checker its own rubric and make "looks good" an invalid verdict, because agents reliably praise their own output.
:::

## 7.6 An end-to-end test the agent cannot fake

The point of an e2e test is that it exercises the real path. If it mocks the seam, it inherits the unit suite's blind spot.

```ts
// tests/e2e/orders.pagination.spec.ts
import { test, expect } from "@playwright/test";

test("second page continues where the first ended", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", process.env.E2E_USER!);
  await page.fill("#password", process.env.E2E_PASS!);
  await page.click("button[type=submit]");

  await page.goto("/orders");
  const first = await page.locator("[data-testid=order-id]").allInnerTexts();
  expect(first).toHaveLength(20);

  await page.click("[data-testid=next-page]");
  const second = await page.locator("[data-testid=order-id]").allInnerTexts();
  expect(second).toHaveLength(20);
  expect(second[0]).not.toBe(first[0]);        // no overlap
  expect(new Set([...first, ...second]).size).toBe(40);
});
```

Three properties make it hard to game: it signs in for real, it asserts *no overlap* rather than merely "returns data", and it runs against the real database rather than a fixture. An agent can make a unit test pass by adjusting the mock; it cannot make this pass without the cursor working.

## 7.7 The checker's rubric

When you split the worker from the checker, the checker needs a standard of its own — otherwise it inherits the worker's optimism.

```text
You are reviewing a completed feature. Do not fix anything; produce a verdict.

Inputs: the feature row, the diff, the recorded verification output.
For each dimension, give a verdict and cite evidence:

1. BEHAVIOUR   — does the diff implement the stated user-visible behaviour?
2. SCOPE       — does it change anything outside that behaviour?
3. VERIFICATION— does the recorded output actually prove it, or merely accompany it?
4. REGRESSION  — do pre-existing tests still pass, unmodified?
5. CLEANLINESS — debug output, dead code, commented-out blocks, stray files?

Verdict: PASS only if 1–5 all pass with evidence.
"Looks good" is not a verdict. Quote the command output or the line of code.
```

| Weak verdict | Strong verdict |
| --- | --- |
| "Looks correct" | "Behaviour met: POST /orders returns 201 (e2e log line 14)" |
| "Tests pass" | "3 e2e passed; note that `orders.pagination` was modified in this diff — flag" |
| "No issues" | "No changes outside `src/orders/**`; no debug prints found" |

:::qa[Why does the checker need a different model call rather than the same one reviewing itself?]
Because self-review shares the same context and the same reasoning that produced the work — including its mistaken assumptions. A separate call with a rubric and only the artefacts sees the diff as an artefact, not as a memory, which is exactly the outside view you want.
:::

:::qa[What is the single strongest anti-gaming rule?]
A verification file may not be modified in the same feature that depends on it. Without that rule, the cheapest way to make a failing test pass is to change the test, and an agent optimising for a green check will eventually find it.
:::
