---
section: "15"
title: "Failure catalogue"
kicker: "Reference"
abstract: "Twelve symptoms, the layer each one belongs to, and the smallest change that fixes it. Written to be scanned during an incident, not read end to end."
time: "9 min"
order: 15
outcomes:
  - "Look up a symptom and land on a layer in one step"
  - "Apply the smallest fix rather than a rewrite"
  - "Recognise the two symptoms that are not harness problems"
---

| Symptom | Layer | Smallest fix |
| --- | --- | --- |
| "Done" but broken | feedback | one `check` command, evidence required |
| Re-explores every session | state | feature list + progress log at startup |
| Ignores conventions | instructions | move the rule into the repo |
| Rewrites 12 files at once | scope | WIP = 1, one verification per feature |
| Guesses at failures | feedback | traces, then an aimed retry |
| Tests rewritten to pass | feedback | checker separate from worker |
| Slow first commit each session | environment | `init.sh` that proves the baseline |
| Same bug fixed twice | state | record the decision, not just the fix |
| Context full mid-task | instructions | route topic docs, shrink the entry file |
| Different approach each session | state | decisions in `progress.md` |
| Nothing finishes | scope | one active item, cap the queue |
| Bills climb with no output | loop | iteration cap and a stopping condition |

## 15.1 The three worth reading in full

**"Done" but broken.** The agent is not lying; it is reporting a feeling. Modern networks are systematically overconfident, and an agent with no executable definition of done will always grade itself generously. The fix is not a better prompt, it is a command whose exit code decides.

**Tests rewritten to pass.** This is the signature of a worker grading its own work. Once you see it, the structural fix is separation: a checker with its own rubric, and a rule that a verification file may not be modified in the same feature that depends on it.

**Context full mid-task.** Almost always instruction bloat rather than task size. Measure the entry file: if it is over ~200 lines, the agent is spending its window on rules it did not need for this task.

## 15.2 The two that are not harness problems

**The task is genuinely beyond the model.** If the same task fails on three runs with a good harness, a clear spec and a working environment, that is a capability gap and no amount of scaffolding closes it. Recognise it early and stop paying for retries.

**The repository is broken in a way nobody documented.** Intermittent failures, a flaky fixture, a service that is down half the time — the agent is faithfully reporting a real defect. Fix the defect; do not add a rule telling the agent to ignore it.

:::qa[A session produced a huge diff and nothing works. Where do you start?]
Scope, then feedback. The diff size is the scoping failure: it took on several features at once, so no single one got enough attention to be verified. Recover by picking one behaviour, writing its check, and reverting everything not required for it — then add the WIP = 1 rule so it cannot recur.
:::

:::qa[How do you tell an overconfident agent from a broken test suite?]
Run the check yourself. If the command passes and the feature is still broken, the suite is wrong — the gap is in what it covers. If the command fails and the agent said it passed, the agent skipped it or read partial output. Two different fixes: widen the check, or make the check mandatory.
:::

:::qa[What is the most common cause of "the agent got worse this month"?]
Instruction bloat plus drift. The entry file grew after each incident, so the agent now reads 600 lines of rules and misses the one that matters; and patterns in the codebase drifted toward whatever the last agent wrote. The cure is a pruning pass, not a new model.
:::
