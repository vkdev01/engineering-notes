---
section: "5"
title: "Continuity and initialisation"
kicker: "State"
abstract: "Sessions end; understanding does not have to. Why long tasks lose the thread, what a written handoff contains, and why initialisation deserves its own phase."
time: "12 min"
order: 5
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
