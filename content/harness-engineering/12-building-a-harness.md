---
section: "12"
title: "Build one in a week"
kicker: "Practice"
abstract: "A day-by-day walkthrough: environment, state, instructions, feedback, then a loop. Five working days for a minimum viable harness, and the honest order to do them in."
time: "16 min"
order: 12
outcomes:
  - "Stand up a working harness in five sessions"
  - "Choose the order of work by cost and blast radius"
  - "Know what to measure before you add anything else"
---

Everything before this explained a part. This is the build order, because doing it in the wrong sequence is how people conclude the whole idea does not work.

:::figure[The five subsystems, and where the model sits]{id="subsystems" note="build the boxes, not the prompt"}
:::

The order below is chosen by cost and blast radius, not by elegance: environment first because it is one script and everything else depends on it, state second because two files unlock multi-session work, instructions third because you now know what to write down, feedback fourth because that is the expensive one, and the loop last because it multiplies whatever you already have — including its flaws.

## 12.1 Day one — make the environment boring

Goal: one command that a stranger can run on a cold clone, that either succeeds or fails loudly.

```bash
#!/usr/bin/env bash
# init.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> dependencies"; npm ci
echo "==> lint";         npm run lint
echo "==> unit";         npm run test --silent
echo "==> smoke";        curl -fsS localhost:3000/health || (npm run dev & sleep 5 && curl -fsS localhost:3000/health)
echo "environment ready"
```

Do not skip the smoke step. An environment that installs but does not start is the most common reason a session burns its first twenty minutes.

Done when: `git clone && ./init.sh` works on a machine that has never seen the repo, and a failing baseline is obvious rather than mysterious.

## 12.2 Day two — write down where you are

Goal: the next session can start without reading the codebase.

Create `feature_list.json` with **one** row — the thing you are actually working on — and `progress.md` with three headings: verified state, active item, next step. Fill both at the end of every session, even when the session failed. Especially then.

```markdown
## Verified state
- build passing · lint clean · 142 tests passing · e2e not yet run

## Active
- feat-001 sign-in flow — form done, session cookie pending

## Next step
1. set the cookie on POST /auth/signin
2. run `npm run e2e -- auth.signin`
```

Done when: you start a new session, read only those two files, and know what to do.

## 12.3 Day three — write the entry file

Goal: an `AGENTS.md` that a careful engineer would call sufficient, and that an agent reads in one screenful.

Three sections only: the startup workflow, the invariants, and the definition of done. If you are tempted to explain architecture, put a pointer to `docs/architecture.md` instead — the agent will open it when it needs it.

Done when: you can delete any line and say what breaks. Lines that survive that test are the file.

## 12.4 Day four — make "done" executable

Goal: one command whose exit code decides whether a feature is finished.

```json
{ "scripts": {
    "lint":  "eslint . --max-warnings 0 && tsc --noEmit",
    "test":  "vitest run",
    "e2e":   "playwright test",
    "check": "npm run lint && npm run test && npm run e2e"
} }
```

Then wire the rule: a feature moves to `passing` only with the command and its output recorded in the feature list. This is the day the harness starts paying for itself, because it is the day "the agent said it was done" stops being an input.

Done when: you have caught a defect that a unit suite missed. You will, usually within a day.

## 12.5 Day five — close the loop

Goal: something that runs without you at the keyboard.

Start smaller than you want to. A goal with a verification and an iteration cap is enough:

```text
/goal "checkout e2e passes 10 consecutive runs"
      --verify "npm run e2e -- checkout --repeat 10"
      --stop "report after 3 failed attempts"
      --max-iterations 10
```

Done when: you have walked away for an hour and come back to either a verified result or a report explaining the blocker. Both are successes; a loop that produces neither is a loop with a missing stopping condition.

## 12.6 Week two to four — harden

| Week | What to add | Why now, not sooner |
| --- | --- | --- |
| 2 | Topic docs, routed from the entry file | You now know which rules recur |
| 2 | A second e2e flow | One flow catches wiring; two catch assumptions |
| 3 | Trace/log line per decision | You have retries worth diagnosing |
| 3 | A checker with its own rubric | Self-review is now the visible failure |
| 4 | Removal audit: delete one subsystem, measure | You need a baseline to compare against |

:::qa[Why environment before instructions?]
Because instructions are worthless if the agent cannot run anything. A perfect rule file in a repo where `npm test` fails produces confident, unverified work. Environment is also the cheapest of the five — one script — so doing it first buys the most reliability per hour spent.
:::

:::qa[What would you do in the first hour on an unfamiliar repo with an agent?]
Run the tests. Whatever happens tells you the state of the harness: if there is no command, that is the first thing to write; if it fails, that is the first thing to fix; if it passes, you have a baseline and can start on state. Nothing else is worth doing before that.
:::

:::qa[How do you keep a harness from becoming a second project?]
Keep every artefact to its budget: entry file under ~200 lines, feature list one active row, progress log three headings, init one script. Audit monthly and delete anything that has not prevented an incident. A harness that grows without pruning turns into the instruction-bloat problem with better branding.
:::
