---
section: "10"
title: "Graph engineering"
kicker: "Automation"
abstract: "A loop is a graph with one node. When a task needs specialisation, parallelism, shared state, verification and recovery at once, it has stopped being a loop."
time: "14 min"
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

## 10.3 The two shapes, side by side

:::figure[When a loop has to become a graph]{id="loopgraph" note="add a node only when the loop provably cannot express the step"}
:::

:::qa[When does a loop have to become a graph?]
When you need specialisation, parallelism, shared state, verification and recovery *at the same time*. Each alone is expressible in a loop; together they are a routing problem. Until then the loop is cheaper, and a single node is the cheapest thing you can debug.
:::

:::qa[What does a separate checker node buy over an in-loop check?]
The thing doing the work is no longer the thing judging it. Agents reliably praise their own output; a checker with its own rubric and its own evidence requirement does not. It also gives you a rejection path that is explicit rather than an implicit retry.
:::

:::qa[What is the orchestration tax?]
The cost of the edges, not the nodes. Four nodes and three edges means two failure paths to reason about, a shared-state contract to define, and a rollback path that has to be tested. It is worth paying only when recovery is genuinely required — otherwise you have bought debugging surface you did not need.
:::

## 10.4 A minimal graph, in about forty lines

If you need one, keep it small and explicit. The orchestration is the easy part; the state contract is what bites.

```ts
type State = { goal: string; artifacts: Record<string, string>; attempts: number; verdict?: string };

const nodes = {
  plan:    async (s: State) => ({ ...s, artifacts: { ...s.artifacts, plan: await plan(s.goal) } }),
  build:   async (s: State) => ({ ...s, artifacts: { ...s.artifacts, diff: await build(s.artifacts.plan) } }),
  check:   async (s: State) => ({ ...s, verdict: await review(s.artifacts.diff) }),
};

async function run(goal: string): Promise<State> {
  let s: State = { goal, artifacts: {}, attempts: 0 };
  s = await nodes.plan(s);
  while (s.attempts < 3) {
    s = await nodes.build(s);
    s = await nodes.check(s);
    if (s.verdict === "PASS") return s;           // accepted
    s = { ...s, attempts: s.attempts + 1 };        // rejection edge
  }
  return { ...s, verdict: "BLOCKED" };            // rollback / human gate
}
```

Three things to notice: the loop is still there (a graph is loops plus routing), the rejection edge is explicit, and the cap produces a *third* outcome — blocked — which is what a human gate attaches to.

## 10.5 When not to build one

| Situation | Do this instead |
| --- | --- |
| One goal, one check | a goal loop |
| Sequential steps that never branch | a script |
| Two roles (do / check) | maker-checker loop |
| Parallel work with no shared state | two loops, two worktrees |
| Shared state but no recovery needed | one loop, a bigger plan |
| You cannot draw the graph on a whiteboard | you do not need the graph |

The last row is the honest test. If the nodes and edges do not fit on one whiteboard, the failure is not going to be in the parts you drew — it will be in the parts you did not.

:::qa[What breaks first in a graph that works on paper?]
Shared state. Two nodes write to the same artefact, the second one wins, and the first one's assumptions are silently invalidated. The fix is either immutable artefacts per node or an explicit merge node — and a contract for what each node may read and write.
:::

:::qa[How do you test a graph before running it?]
Run each node in isolation against a fixture state, then the two-edge paths, then the rejection path. The rejection path is the one teams skip, and it is the one that runs in production at 2am.
:::
