---
section: "2"
title: "Cost control without stalling"
kicker: "Budget"
abstract: "Agent cost is not a per-token problem, it is a re-work problem. Most of the bill comes from sessions that explored, failed and explored again."
time: "6 min"
order: 2
outcomes:
  - "Estimate the cost of a task before running it"
  - "Spot the patterns that triple a bill"
  - "Set limits that stop waste without stopping work"
---

The cheapest session is the one that already knew where to look. Everything that improves a harness — a written handoff, a scoped feature, a verification command — shows up in the bill as fewer wasted turns.

## 2.1 Where the money goes

| Pattern | What it looks like | Cost |
| --- | --- | --- |
| Exploration | Reading thirty files to find one | Paid every session, not once |
| Re-work | Two approaches, one abandoned | Roughly double |
| Retry storms | Same failure, four attempts | Multiplies with context growth |
| Over-scoped tasks | Four features, none finished | Paid again next session |

## 2.2 Limits that help

A token budget is a blunt instrument; an iteration cap is a sharp one. Cap the number of attempts, not the number of tokens, and make the cap visible to the agent so it plans within it.

:::note[Note 2.2.a — the stopping condition is a cost control]
"Stop and report after three failed attempts" is both a safety rule and the single most effective cost control in the harness. It converts an unbounded loop into a bounded one.
:::

:::warn[Warning 2.2.b]
Cutting cost by removing verification is the only saving that reliably costs more than it saves. You pay it back in review time, and occasionally in an incident.
:::
