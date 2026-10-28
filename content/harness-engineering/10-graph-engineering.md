---
section: "10"
title: "Graph engineering"
kicker: "Automation"
abstract: "A loop is a graph with one node. When a task needs specialisation, parallelism, shared state, verification and recovery at once, it has stopped being a loop."
time: "10 min"
order: 10
outcomes:
  - "Place prompt, context, loop and graph on one stack"
  - "Decide when a loop has to become a graph, and when it must not"
  - "Recognise unverified performance claims about orchestration"
---

The term arrived in July 2026 through a joke between two engineers that the timeline took seriously. The idea is real; most of the numbers around it are not.

## 10.1 Four layers, one stack

| Layer | Shapes | Answers |
| --- | --- | --- |
| Prompt engineering | the instruction | What do we tell the model? |
| Context engineering | the information | What should it know before deciding? |
| Loop engineering | the runtime | How does it iterate until the goal holds? |
| Graph engineering | the system | How do agents, loops and evaluators compose? |

Each layer keeps the one below it. Every node in a graph still carries its own prompt, its own context, its own loop. What the graph adds is routing between them — and a bill.

## 10.2 What a graph adds

- **Fan-out** — independent workstreams that do not need each other's output.
- **A separate checker** — the thing doing the work is no longer the thing judging it.
- **Rollback** — the system can undo, not just retry.
- **A human gate** — approval on the path to merge.

:::note[Note 10.2.a — the orchestration tax]
Four nodes and three edges means two failure paths to reason about. Worth paying only when recovery is genuinely required; a loop with one node is the cheapest thing you can debug.
:::

:::warn[Warning 10.2.b — invented benchmarks]
The widely quoted "+18% accuracy, −85% cost" figures come from a paper about chemical piping diagrams and compare different baselines. Treat performance claims about orchestration patterns as unverified until you reproduce them on your own task.
:::

:::pull
Once an agent needs specialisation, parallelism, shared state, verification and recovery at the same time, it has stopped being a loop. Until then, the loop is cheaper.
:::
