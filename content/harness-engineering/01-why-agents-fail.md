---
section: "1"
title: "Why capable agents fail"
kicker: "Diagnosis"
abstract: "Benchmark scores measure a clean task with a supplied environment. Your repository supplies neither, so the same model behaves differently. This section names the gap and the five ways sessions break."
time: "14 min"
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

## 1.5 Three transcripts, three layers

The fastest way to learn attribution is to read three failures side by side. All three are real shapes; the names are invented.

```text
# A — wrong output
agent: added a /search endpoint returning all products
       tests: 14 passing
you:   "did you use the existing repository layer?"
agent: "there was no repository layer mentioned, so I created one"
→ LAYER: instructions. The convention existed; it was not in the repo.
```

```text
# B — no output
agent: [40 minutes] reading files, running migrations, failing, re-reading
you:   "why did it take 40 minutes to start?"
agent: "the test database was not initialised, so I rebuilt it twice"
→ LAYER: environment. init.sh did not exist, so every session paid this.
```

```text
# C — slow output
agent: rewrote the export component four times, each time a different approach
you:   "why four rewrites?"
agent: "I could not tell which version was correct, so I tried another"
→ LAYER: feedback. No e2e check, so no way to stop and say "this one passes".
```

:::figure[Which layer did the session fail in?]{id="triage" note="attribute first, change second"}
:::

The discipline is one sentence long: name the layer before you change anything. It is also the thing that stops "the model isn't good enough" from becoming your default explanation, which is expensive because it leads to a model swap that fixes nothing.

## 1.6 The economics of a vague spec

A wrong guess is not one mistake. It is the guess, plus the code written on top of it, plus the review, plus the removal, plus the second attempt — and the second attempt often needs the spec you did not write the first time.

| Path | What you spend | What you get |
| --- | --- | --- |
| Vague ticket | 40 seconds of writing saved | 3–5× rework, plus a review cycle |
| Written spec | ~3 minutes | One attempt, verifiable |
| Written spec + check | ~6 minutes | One attempt, verifiable, *and* the next one is cheaper |

The third row is the one people skip, and it is the only one that compounds. A check you write today is a check every future session inherits.

:::qa[Why is "the agent is bad at X" usually the wrong conclusion?]
Because it is unfalsifiable and it stops the investigation. "Bad at following conventions" is really "the conventions are not in the repo". "Bad at long tasks" is really "there is no state between sessions". Both are fixable this afternoon; neither is fixed by a better model.
:::

:::qa[What does a wrong guess actually cost, in a session?]
Roughly: the work to build it, the work to notice it, the work to undo it, and the second attempt — and if the guess was structural, the second attempt touches everything the first one touched. The written sentence that would have prevented it takes under a minute.
:::
