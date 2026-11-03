---
section: "18"
title: "Gaming"
kicker: "Use cases"
abstract: "NPC behaviour, difficulty and dialogue where the decision must be fast, varied and never break character."
time: "5 min"
order: 18
outcomes:
  - "Classify and template instead of generating at frame rate"
  - "Keep output inside the character and the lore"
  - "Test for degenerate policies with a simulation harness"
---

Games are the domain where an SLM's decision model is judged on *experience* rather than cost. The
constraints are unusual: sub-frame latency for gameplay, variety as a feature (determinism is a bug), and a hard
requirement that output never escapes the game's tone or lore.

## Decision inventory

| Decision | Actions | Latency | Notes |
| --- | --- | --- | --- |
| Combat stance | aggressive · defensive · flank · flee · call-allies | < 16 ms | Use a tiny classifier on state features; no generation |
| Dialogue intent | greet · threaten · bargain · refuse · lore-dump | < 40 ms | Classify player line, then template the response |
| Quest gating | offer · defer · deny · hint | < 60 ms | Rules for state, SLM for phrasing |
| Difficulty adaptation | easier · same · harder | per-minute batch | Classify player frustration from telemetry text |

## The pattern: classify, then template

Generating dialogue at 60 fps is not viable. Classify the situation with a small model and render from an authored
template bank — the model chooses *which* line, the writers control what the line says.

```text
spec = DecisionSpec(
    name="npc_stance",
    actions=["aggressive", "defensive", "flank", "flee", "call_allies"],
    costs={("aggressive","won"): 0, ("aggressive","lost"): 40,
           ("defensive","won"): 8,  ("defensive","lost"): 8,
           ("flee","won"): 60,      ("flee","lost"): 0},
    abstain="defensive",
)
# state features -> 5-way logits -> action, 4 ms on CPU at batch 1
```

## Reference numbers

| Metric | Scripted AI | SLM decision layer |
| --- | --- | --- |
| Decision latency | < 1 ms | 4–9 ms (66M encoder, batch 1) |
| Perceived variety (playtest survey) | 2.9 / 5 | 3.9 / 5 |
| Player-reported "unfair" deaths | 12% | 7% |
| Memory footprint | < 1 MB | ~90 MB (66M INT8 + templates) |
| Dialogue line reuse | low | lower — model picks from a larger bank |

*Illustrative playtest figures. Variety and fairness are
subjective; treat survey deltas as directional and validate with a larger cohort.*

## Keeping it in character

Two mechanisms, both cheap:

1. **Closed action space + template bank.** The model can only choose an action id; the writers own every string the player reads. Nothing can be emitted out of character.
1. **Banned-token masking** if you must generate text: logits for lore-breaking tokens are set to −∞ before sampling. Cheap, effective, and auditable.

## Determinism is a bug here

Unlike finance, variety is the point. Use temperature 0.8–1.0 with a seeded RNG per encounter, so a replayed
encounter is reproducible for debugging while fresh encounters feel different. Store the seed with the save file —
that is what makes bug reports actionable.

## Testing in games

- **Simulation harness:** run 10,000 synthetic encounters, assert win rates stay inside a designed band.
- **Character conformance:** an automated check that no chosen template is tagged out-of-character for the NPC.
- **Latency p99 under load:** test with the frame budget, not in isolation — a 9 ms decision in a 16 ms frame leaves little room for everything else.
- **Degenerate-strategy detection:** verify the policy does not collapse to one action after tuning (entropy of the action distribution over a simulated session).
