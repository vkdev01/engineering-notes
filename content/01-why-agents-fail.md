---
section: "1"
title: "Why capable agents fail"
kicker: "Diagnosis"
abstract: "Benchmark scores measure a clean task with a supplied environment. Your repository supplies neither, so the same model behaves differently. This section names the gap and the five ways sessions break."
time: "8 min"
order: 1
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
