---
section: "14"
title: "Interview drills"
kicker: "Practice"
abstract: "Twenty-four questions in the shape an interviewer asks them, grouped by layer. Answer each in under ninety seconds, then check yourself."
time: "20 min"
order: 14
outcomes:
  - "Answer harness questions with a layer, a symptom and a fix"
  - "Tell a story from your own sessions, not from a blog post"
  - "Handle the three questions that decide the round"
---

Interviewers rarely ask "what is a harness". They ask what you did when something broke. Answer in the same shape every time: **name the layer, name the symptom, name the fix, name how you knew it worked.** That structure is worth more than any definition.

## 14.1 The three questions that decide the round

:::qa[Walk me through a time an AI agent produced bad work, and what you changed afterwards.]
Strong answers follow the four-part shape and end with a measurable change. Weak answers stop at "I rewrote the prompt". The interviewer is checking whether you can attribute a failure to a layer — that is the skill, and it is the one thing that separates someone who has actually operated an agent from someone who has read about one.
:::

:::qa[How do you know when to stop trusting the agent's output?]
The honest answer: you never trust it, you check it — and the check is a command, not a feeling. Then say how you made that cheap: a single `check` script, a definition of done in the entry file, a rule that a feature cannot move to passing without recorded evidence.
:::

:::qa[What would you do in your first week at a company that is rolling out coding agents?]
Do not start with policy. Run the tests, write `init.sh`, write down the feature state, then measure two numbers for a week — time to first verified commit and reopens. Come back with evidence and the changes will be accepted; come back with a slide and they will not.
:::

## 14.2 Diagnosis

:::qa[The agent says a task is done and it is not. Where do you look first?]
The definition of done. If nothing executable defines it, the agent used its own standard — "the code looks fine". Second, whether the verification it was given actually runs the full flow, because a green unit suite is the most common false signal.
:::

:::qa[The agent keeps re-reading the repository every session. What is missing?]
State. There is no artefact telling it what is done, what is in progress and what was decided. The fix is a feature list and a progress log read at startup, not a larger context window — a bigger window delays the loss, a written handoff removes it.
:::

:::qa[The agent ignores your team's conventions. Why, and what do you do?]
Because the conventions live in a place it cannot read. It has three inputs: the task, the repository, the command output. Move the rule into the repository — a short entry file for invariants, a topic doc next to the code for detail — and the ignoring stops.
:::

:::qa[Two tests fail intermittently after an agent's change. What is your next move?]
Get the trace, not a retry. Intermittent failures after a change usually mean state leaking across tests or an unawaited lifecycle — both invisible in the diff. Then check whether the suite has a shared fixture the change now mutates.
:::

## 14.3 Design

:::qa[How would you design a harness for a team of eight engineers and four agents?]
One repository-level harness, not eight personal ones: `init.sh`, an entry file, a feature list per repo, one `check` command. Then per-agent isolation through worktrees so two agents do not fight over a branch, and a written handoff standard so a session can be picked up by anyone.
:::

:::qa[Would you give the agent write access to main?]
No. Not because it will be malicious but because it will be confident. Worktrees or branches, verification in CI, and a human gate on merge. The harness's job is to make the safe path also the fast path — if branching slows you down, the harness is not finished.
:::

:::qa[How do you keep the harness from becoming bureaucracy?]
Budgets and deletion. Entry file under ~200 lines, one active feature, three headings in the progress log. Audit monthly and delete rules that have not prevented an incident — a rule with no failure behind it is a tax on every session.
:::

:::qa[When is a loop better than a graph?]
Almost always. A loop is one node with a goal, a check and a stop; it is the cheapest thing to debug. A graph is justified only when you need specialisation, parallelism, shared state, verification and recovery at the same time — otherwise you have bought failure paths you did not need.
:::

## 14.4 Trade-offs

:::qa[Is it worth spending $200 on a harnessed run when $9 gets a demo?]
If the artefact matters, yes — the cheap run produced something that did not work. The better framing: spend the $9 on the first attempt, then spend the next $20 on making the failure impossible to repeat. That is a harness, and it pays back on the second task.
:::

:::qa[What is the cost of a harness?]
Mostly maintenance and latency. Artefacts go stale, rules accumulate, and a strict gate slows the loop. The honest position: the harness costs about an hour a week to keep honest, and saves several times that in rework — but only if you prune it.
:::

:::qa[Where does a harness stop being worth it?]
On throwaway work: a one-off script, a spike, a prototype you will delete. There the harness is pure overhead. The threshold is roughly "will anyone run this twice" — if yes, write the check; if no, do not.
:::

:::qa[Would you use the biggest model everywhere and skip all this?]
No, and it does not work even when you do. The strongest model in an unharnessed repository still cannot see your conventions, cannot verify its work, and starts every session from zero. Capability raises the ceiling; the harness decides whether you reach it.
:::

## 14.5 The one-liners worth memorising

- **Harness** — everything outside the model weights that decides whether the model's capability becomes reliable work.
- **Capability gap** — benchmark performance versus performance on your repository, which supplies none of the benchmark's scaffolding.
- **Definition of done** — one command that exits non-zero when the work is not finished.
- **Context anxiety** — the rush to finish as the window fills, which is why long sessions need a written handoff.
- **Lost in the middle** — mid-context information is used less reliably than information at the edges, so invariants belong at the top.
- **WIP = 1** — attention divides arithmetically; below the threshold nothing is verified.
- **The orchestration tax** — the edges, not the nodes, are what you maintain in a graph.
