---
section: "11"
title: "The harness kit"
kicker: "Output"
abstract: "Four files in the root of any repository: the instruction entry point, the feature list, the startup script and the progress log. Everything above converges here."
time: "8 min"
order: 11
outcomes:
  - "Name the four files that make a minimum viable harness"
  - "Write a definition of done that a command can check"
  - "Diagnose a failing session by layer, in one pass"
---

Ten sections of diagnosis reduce to four files you can copy. They are the minimum viable harness for any project, in any language.

## 11.1 The four files

| File | Job | Kept honest by |
| --- | --- | --- |
| `AGENTS.md` | Invariants, startup workflow, definition of done | Under ~200 lines, or it stops being read |
| `feature_list.json` | What is done, verified, blocked | The verification command on every row |
| `init.sh` | One command that makes the environment trustworthy | Running it before every session |
| `progress.md` | What happened, what is next, why | Written before the session ends |

## 11.2 The definition of done

- The user-visible behaviour is implemented.
- Lint and typecheck pass.
- The unit suite passes.
- A full user flow runs end to end.
- The command and its result are recorded in `feature_list.json`.
- The repository still starts from a cold clone via `./init.sh`.

:::note[Note 11.2.a — start with the environment]
If you only fix one thing this week, fix `init.sh`. A harness whose environment is unreliable produces unverifiable work no matter how good the instruction file is.
:::

:::exercise[Exercise 11.1 · Score the harness you are about to ship]{id="scorecard" labels="AGENTS.md under 200 lines,Feature list with commands,init.sh from cold clone,Progress log updated,Evidence recorded per feature" scale="4" unit="harness"}
:::

## 11.3 The one habit to keep

When a session goes wrong, do not reach for a bigger model. Name the layer: instructions, tools, environment, state, feedback. Fix that layer. Repeat.

:::pull
The model is not the variable you control. The harness is.
:::
