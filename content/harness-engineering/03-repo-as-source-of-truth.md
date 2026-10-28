---
section: "3"
title: "The repo as source of truth"
kicker: "Instructions"
abstract: "An agent has three inputs: the task, the contents of the repository, and the output of commands it runs. Slack, Jira and the decision you made on Friday are invisible to it."
time: "9 min"
order: 3
outcomes:
  - "Run the fresh-session test on your own repository"
  - "Decide which decisions belong in the repo, and where they go"
  - "Write a handoff the next session can act on without asking"
---

This is not a "write more documentation" problem. It is a "put the decision where it will be needed" problem. A 50-line `ARCHITECTURE.md` inside `src/api/` beats a 500-page wiki nobody maintains, because information only helps at the moment it is in front of the reader.

## 3.1 The fresh-session test

Open a brand-new session, give it nothing but the repository, and see whether it can answer five questions without asking you anything.

| Question | Where the answer must live |
| --- | --- |
| What is this system? | `README.md` or `AGENTS.md` |
| How is it organised? | `ARCHITECTURE.md`, module docs |
| How do I run it? | `init.sh`, `Makefile`, package scripts |
| How do I verify it? | test, lint and typecheck commands |
| Where are we now? | `feature_list.json`, progress log, `git log` |

:::note[Note 3.1.a — proximity beats length]
A 50-line file inside the module it describes is read. A 500-page space nobody maintains is not. Put the rule next to the code it constrains.
:::

## 3.2 Clean exits

Every session ends with a state the next one can trust. That is cheap to define and expensive to skip.

:::exercise[Exercise 03.1 · Grade your last session's exit]{id="checklist" items="The build passed when the session ended;All tests passed, including pre-existing ones;Verification ran in CI, not just locally;Feature state and progress were written down;Temp files and debug output were removed;A cold clone still starts via the standard path" grades="A,B,C,D,F"}
:::

:::warn[Warning 3.2.a]
A session that ends red is not finished — it is a debt the next session pays first, with interest. Fix the build before you leave, or write down that you did not.
:::
