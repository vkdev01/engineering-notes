---
section: "11"
title: "The harness kit"
kicker: "Output"
abstract: "Four files in the root of any repository: the instruction entry point, the feature list, the startup script and the progress log. Everything above converges here."
time: "12 min"
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

## 11.4 The kit, as files you can copy

```markdown
# AGENTS.md — the entry file
## Startup
1. `pwd` · read `progress.md` · read `feature_list.json`
2. `./init.sh` — if the baseline is red, fix that first
3. `npm run e2e` before new work

## Invariants
- no secrets in the repo · all SQL via the query builder · every route behind requireAuth()

## Read on demand
API → `docs/api.md` · DB → `docs/database.md` · UI → `docs/ui.md`

## Done means
lint · unit · e2e · evidence recorded · cold clone starts
```

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
npm ci
npm run lint
npm run test --silent
npm run e2e --silent
echo "environment ready"
```

```json
{ "features": [ {
    "id": "feat-001", "priority": 1,
    "user_visible_behavior": "A user can sign in and see their dashboard",
    "verification": ["npm run e2e -- auth.signin"],
    "status": "not_started", "evidence": []
} ] }
```

:::qa[If you could ship only one file this week, which?]
`init.sh`. An unreliable environment produces unverifiable work no matter how good the instruction file is, and it is the cheapest of the four to write — one script that installs, lints and tests.
:::

:::qa[What is the smallest useful definition of done?]
One command that exits non-zero when the feature is not done, whose output is recorded. In most repositories that is `lint && test && e2e`, plus a line in the feature list with the command and its result.
:::

:::qa[How do you know the harness is working?]
Sessions get shorter, retries get aimed, "it said done and it wasn't" stops appearing, and the model tier you need for a given task goes down rather than up. The last one is the strongest signal: the environment is doing the work instead of the model.
:::

## 11.5 Applying the kit to a small repo

A worked example, start to finish, on a repository with no harness at all.

```text
before                              after (40 minutes of work)
├── src/                            ├── AGENTS.md            90 lines, routes to docs/
├── package.json                    ├── init.sh              4 commands, fails loud
├── README.md      "npm run dev"    ├── feature_list.json    one row, with its check
└── (no tests)                      ├── progress.md          3 headings
                                    ├── docs/api.md          the conventions
                                    ├── tests/e2e/           one flow, signed in
                                    └── package.json         + "check": lint && test && e2e
```

Order of work, and why:

1. **`package.json` + one e2e test.** Until something can fail, nothing else has a meaning. Write the smallest test that proves a user can do the main thing.
2. **`init.sh`.** Wrap install, lint, test and e2e. Fail fast, print one success line.
3. **`AGENTS.md`.** Now you know what to write: the invariants you just had to explain to yourself, and the `check` command.
4. **`feature_list.json`.** One row — the thing you are working on — with its verification.
5. **`progress.md`.** Three headings, filled at the end of the session, including on the days it went badly.

## 11.6 The thirty-minute retrofit

If the repo is already alive and busy, this is the sequence that causes the least disruption.

| Minutes | Do | Why this order |
| --- | --- | --- |
| 0–8 | add `check` = lint && test && e2e | gives every later step something to point at |
| 8–14 | write `init.sh`, run it on a cold clone | proves the environment before you document it |
| 14–22 | write `AGENTS.md`: startup, invariants, done | now it can reference real commands |
| 22–27 | create `feature_list.json` with the current work | converts the in-flight task into a verifiable row |
| 27–30 | create `progress.md`, commit everything | gives the next session a starting point |

Then leave it alone for a week and measure two numbers: time to first verified commit, and features reopened. If neither moves, the harness is decorative and you should find out why before adding more.

:::qa[What is the most common mistake when retrofitting a harness onto a busy repo?]
Writing the instruction file first. It ends up full of aspirations — "we value clean code" — because there are no commands to reference yet. Build the check first and the entry file writes itself, because it can only contain things that are true.
:::

:::qa[How do you get a team to adopt it without a mandate?]
Make the check the only path to merging, and make it fast. Adoption follows from a green check being easier than arguing in review. A document asking people to follow a process is ignored; a CI job that takes 90 seconds and blocks a red merge is not.
:::
