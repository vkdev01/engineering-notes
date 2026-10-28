---
section: "5"
title: "Continuity and initialisation"
kicker: "State"
abstract: "Sessions end; understanding does not have to. Why long tasks lose the thread, what a written handoff contains, and why initialisation deserves its own phase."
time: "18 min"
order: 5
outcomes:
  - "Explain why a larger context window does not solve continuity"
  - "List the five artefacts a written handoff needs"
  - "Separate initialisation from implementation inside a session"
---

The agent runs thirty minutes, gets most of a feature done, and runs out of context. The next session remembers none of it: not the decisions, not which files changed, not what the tests said.

## 5.1 Why bigger windows do not fix it

The information an agent produces is not uniformly valuable. Intermediate reasoning carries the *why* — why option A beat option B, why that library, why this shortcut was taken. The final output carries only the *what*. Compaction strategies keep the artefact and drop the reasoning, so the next session sees the code and "optimises" away a decision that was deliberate.

:::note[Note 5.1.a — context anxiety]
Anthropic observed that as the window fills, agents rush the finish, skip verification and take the simple path. A harness that never leaves a written handoff guarantees every session is somebody's first day.
:::

## 5.2 What a handoff actually contains

| Artefact | Answers |
| --- | --- |
| `feature_list.json` | What is done, what is active, what is blocked — with the command that proves it |
| `progress.md` | What happened last session, what is verified, what is next |
| Decision notes | Why this approach and not the obvious one |
| Git checkpoint | The exact repository state to start from |
| `init.sh` | The one command that makes the environment trustworthy again |

## 5.3 Initialisation is a phase, not a chore

Implementation maximises verified features. Initialisation maximises the reliability of everything that follows. Mixed together, the agent does what is visible — it writes code — and skips what is invisible — verifying that the test framework works. The cost lands in session two, when nobody can run anything.

:::pull
Unverified accumulation is the expensive part. Code written before the test framework works is code you may have to design twice.
:::

:::warn[Warning 5.3.a]
A session that begins without running the startup path is a session whose "passing" means "it compiled on my machine ten minutes ago".
:::

## 5.4 Two sessions, drawn

:::figure[Where the minutes actually go]{id="timeline" note="same model, same task, different handoff"}
:::

## 5.5 The handoff, as files

```markdown
# progress.md

## Verified state
- build passing · lint clean · 142 unit tests passing · e2e green
- `feat-004` complete and recorded with its command output

## Active
- `feat-005` — add cursor pagination to /orders (in progress)

## Decisions
- keyset pagination over offset: offset degrades past 100k rows
- kept `created_at` index; the composite was slower in the query plan

## Next step
1. finish the cursor encoder
2. run `npm run e2e -- orders`
3. record evidence, move to passing
```

```bash
#!/usr/bin/env bash
# init.sh — the one command that makes the environment trustworthy
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "==> install"; npm ci
echo "==> lint";    npm run lint
echo "==> test";    npm run test --silent
echo "==> e2e";     npm run e2e --silent
echo "ready"
```

:::qa[Why doesn't a bigger context window solve continuity?]
Because the information that matters is not proportional to the window. The reasoning behind a decision — why option A beat B — is exactly what compaction discards, while keeping the code that resulted from it. A larger window delays the loss; a written handoff removes it.
:::

:::qa[What belongs in a handoff, minimally?]
Four things: the verified state (what passes), the active item (what is half-done), the decisions with their reasons, and the next step. A fifth optional: the git checkpoint that state corresponds to. If the next session can start work without re-reading the codebase, the handoff is sufficient.
:::

:::qa[Why should initialisation be a separate phase?]
Because it optimises a different objective. Implementation maximises verified features; initialisation maximises the reliability of everything after it. Mixed together, the agent does what is visible — writes code — and skips what is invisible — proving the test runner works. You then pay for that in session two, when nobody can run anything.
:::

## 5.6 The same task, two transcripts

The difference between a state-less session and a stateful one is visible in the first three actions.

```text
# no state
agent: [reads 34 files over 8 minutes]
agent: "I see a Next.js app with an API layer. I'll start by exploring the schema."
agent: [20 minutes] implements 40% of the feature
agent: [context fills] "I've made good progress" → session ends
→ next session starts from zero and picks a different approach
```

```text
# with state
agent: reads progress.md → "feat-004 passing, feat-005 in progress, next: cursor encoder"
agent: reads feature_list.json → verification is `npm run e2e -- orders.pagination`
agent: runs ./init.sh → green in 40 seconds
agent: [20 minutes] finishes the encoder, runs the check, records evidence
→ next session starts on feat-006 with no re-reading at all
```

:::figure[What a session leaves behind]{id="handoff" note="four artefacts, none of them a chat transcript"}
:::

## 5.7 init.sh for three stacks

The script is boring on purpose. What matters is that it is one command and that it fails loudly.

```bash
# node
set -euo pipefail
npm ci && npm run lint && npm run test --silent && npm run e2e --silent

# python
set -euo pipefail
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]" && ruff check . && mypy app && pytest -q

# monorepo
set -euo pipefail
pnpm install --frozen-lockfile && pnpm -w lint && pnpm -w test && pnpm -w e2e
```

Three rules that make the difference between a script people trust and one they skip: fail fast (`-e`), fail loud (no `|| true`), and print a single success line so the agent can tell the difference between "passed" and "printed nothing".

:::qa[Why does the script matter more than the prose describing it?]
Because the agent runs commands and reads output; it does not absorb prose about running commands. A `README` that says "run the tests" is a hint. A script that runs them and exits non-zero is a fact, and facts are what verification needs.
:::

:::qa[What goes wrong if init.sh takes six minutes?]
Sessions stop running it. Six minutes at the start of every session is a real cost, and the agent — like a person — will skip a slow step under time pressure and then work on an unverified baseline. Keep it under a minute where you can: cache dependencies, parallelise the gates, and split the slow e2e into a separate command the definition of done can still call.
:::
