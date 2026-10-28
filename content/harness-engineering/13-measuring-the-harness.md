---
section: "13"
title: "Measuring the harness"
kicker: "Evidence"
abstract: "Six numbers that tell you whether the harness is working, how to collect each one without new tooling, and the removal audit that tells you what is load-bearing."
time: "11 min"
order: 13
outcomes:
  - "Track six numbers that move when the harness improves"
  - "Run a removal audit and read the result"
  - "Distinguish a harness problem from a task problem"
---

Opinions about harnesses are cheap. Six numbers, collected from artefacts you already have, will settle most arguments in a week.

## 13.1 The six

| Metric | Where it comes from | Healthy direction |
| --- | --- | --- |
| Time to first verified commit | Session log timestamps | Down |
| Sessions ending clean | progress.md end state | Up, above ~80% |
| Rework rate | commits that revert or rewrite another in the same session | Down, under ~10% |
| Retries per feature | tool-call log, e2e attempts | Down, and aimed |
| Features marked done then reopened | feature_list.json history | Near zero |
| Model tier needed per task shape | your own routing table | Down over months |

None of these require instrumentation you do not have. Commit timestamps, the feature list, and the e2e output cover all six.

## 13.2 What each one actually tells you

**Time to first verified commit** is the honest measure of onboarding. If a new session takes forty minutes to produce its first passing check, the repository is not self-sufficient — the agent is reading its way in.

**Rework rate** separates a scoping problem from a verification problem. High rework with low retries means the agent understood the task and changed its mind; high rework *with* high retries means it was guessing, which is a feedback problem.

**Features reopened** is the only direct measure of premature completion. Every reopen is a session where "done" was a claim.

**Model tier** is the long-run signal. When a task that needed the frontier model a quarter ago passes on a mid tier, the harness is carrying the difference — which is the entire point of the discipline.

## 13.3 The removal audit

Once you have a baseline, delete one subsystem at a time and re-run an identical task:

```text
baseline            task T, 3 runs        mean 22 min, 1.0 rework
- state             no feature_list.json  mean 41 min, 2.3 rework   ← load-bearing
- instructions      no AGENTS.md          mean 26 min, 1.4 rework   ← moderate
- feedback          skip e2e              mean 19 min, 3.0 rework   ← fast but wrong
```

Read it like a sensitivity table, not a scoreboard. The largest regression is where the next hour goes. A removal with *no* effect is a finding too: that subsystem is not contributing today, and the honest response is either to fix it or to delete it rather than maintain it out of guilt.

:::qa[How would you prove a harness change actually helped?]
Pick one task, run it three times before and three times after, and compare the same two numbers: time to first verified commit and rework count. One run is an anecdote; three is a direction. If you cannot afford six runs, measure the artefact instead — did the reopen count fall?
:::

:::qa[Which metric would you look at first, and why?]
Features marked done then reopened. It is the most expensive failure in the system — it means work was reported complete and was not — and it is the one the harness is supposed to eliminate. Everything else is a proxy for it.
:::

:::qa[The removal audit shows one subsystem has no effect. What do you conclude?]
That it is not load-bearing *for that task*, which is not the same as useless. Check whether the task actually exercised it — removing e2e from a CSS tweak proves nothing. If the task did exercise it and performance did not move, the subsystem is decorative and should be fixed or deleted.
:::
