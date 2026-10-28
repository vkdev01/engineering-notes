---
section: "1"
title: "Why capable agents fail"
kicker: "Diagnosis"
abstract: "Benchmark scores measure a clean task with a supplied environment. Your repository supplies neither, so the same model behaves differently. This section names the gap and the five ways sessions break."
time: "8 min"
order: 1
outcomes:
  - "Name the capability gap between a benchmark and your own repository"
  - "Recognise the five ways an agent session actually fails"
  - "Attribute a failure to a harness layer instead of the model"
---

Strong models do not imply reliable execution. Claude Sonnet 4.5 scored 77.2% on SWE-bench Verified, and then the same model hands you a broken feature in your own repository — vague ticket, no tests, conventions that live in a Slack thread.

## 1.1 The capability gap

Benchmarks hand the agent a clean issue description, an existing test suite and a working environment. Real work asks it to invent all three. The model did not get worse between the benchmark and your repo; the harness did.

Anthropic ran the same prompt — "build a 2D retro game editor" — on the same model under two different harnesses.

| Run | Harness | Time | Cost | Outcome |
| --- | --- | --- | --- | --- |
| Bare | Single prompt, no planner, no evaluator | 20 min | $9 | App opened; entities ignored input |
| Harnessed | Planner / generator / evaluator split | 6 h | $200 | Core loop playable; unfinished edges |

:::pull
Same weights, different tack. The harness, not the model, decided what the model could deliver.
:::

## 1.2 The five ways sessions fail

- **Vague requirements.** "Add a search feature" — search what, ranked how, paginated? The agent guesses, and a wrong guess costs several times more than the sentence that would have prevented it.
- **Unwritten conventions.** Your team is on SQLAlchemy 2.0 and every endpoint must pass OAuth 2.0. The agent has never seen that rule, so it cannot comply.
- **Broken environment.** Missing dependencies and version conflicts burn context on `pip install` errors instead of the task.
- **No verification.** Nothing executable says what "done" means, so the agent uses its own standard: "the code looks fine."
- **Cross-session amnesia.** Every new session re-explores the repository and re-litigates decisions.

:::note[Note 1.2.a — context anxiety]
Anthropic observed that as the context window fills, agents rush the finish, skip verification and choose the simple solution over the correct one. A harness that never leaves a written handoff guarantees this happens on every long task.
:::

## 1.3 Diagnostic habit

Attribute every failure to a layer before changing anything: was the task unclear, was context missing, was the environment broken, was there no verification, or was state lost? Execute, observe, attribute, fix that layer, re-execute.

:::warn[Warning 1.3.a]
"Try a bigger model" is the most expensive debugging strategy available, and it usually hides the layer that is actually broken. Swap models only after the harness has been ruled out.
:::

## 1.4 The same ticket, written two ways

The cheapest harness improvement is not a tool. It is the sentence you did not write.

```text
# what the agent received
add search to the products page

# what it needed
add product search to /products
- full-text over name + description, case-insensitive
- results paginated at 20, newest first
- empty query returns the full list
- must not break the existing sort dropdown
- verification: `npm run test:e2e -- search` passes
```

The second version is 40 seconds of writing and removes most of the guesswork. Every failure mode below is downstream of a sentence like the first one.

:::qa[Why does a model that scores 77% on SWE-bench still fail on my repository?]
Because the benchmark supplies what your repository does not: a clean issue description, an existing test suite, and a working environment. Those three things are the harness. A benchmark measures the model inside a good harness; your repo measures it inside whatever harness you happen to have.
:::

:::qa[An agent produced a broken pull request. What is the first question you ask?]
Not "which model", but "which layer failed". Was the task ambiguous, was the convention unstated, could the agent run the tests, did it know the current state? Nine times out of ten the answer is a missing artefact rather than a missing capability, and the fix is a file, not a subscription upgrade.
:::

:::qa[How would you explain the difference between a capability gap and a harness-induced failure?]
A capability gap is something the model genuinely cannot do. A harness-induced failure is something it can do, but could not do *here* — because it never saw the rule, could not run the check, or had no record of what the last session decided. The diagnostic value is that the second is fixable today, and the first usually is not.
:::
