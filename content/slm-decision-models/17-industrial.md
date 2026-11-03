---
section: "17"
title: "Industrial"
kicker: "Use cases"
abstract: "Maintenance, quality and supply-chain decisions where the SLM reads technician notes and the rulebook is 400 pages."
time: "5 min"
order: 17
outcomes:
  - "Join technician notes to a maintenance manual with retrieval"
  - "Cost downtime avoided against inference cost"
  - "Plan an air-gapped edge deployment with a rollback"
---

Industrial decisions rarely arrive as clean text. They arrive as a technician's note, a work order, a sensor
alarm, and a maintenance manual. The SLM's job is to join those into a structured decision: fix now, schedule,
monitor, or escalate.

## Decision inventory

| Decision | Input | Actions | Value driver |
| --- | --- | --- | --- |
| Work-order triage | Free-text fault report + asset id | immediate · next-shift · planned · monitor | Downtime hours avoided |
| Root-cause suggestion | Alarm sequence + manual excerpt | ranked causes with confidence | Mean time to repair |
| Quality hold | Inspection note + batch record | release · rework · scrap | Scrap cost vs recall risk |
| Supplier exception | Email/EDI text + history | accept · expedite · substitute · escalate | Line-stop avoidance |

## Numbers that justify the build

| Quantity | Before | After | Assumption |
| --- | --- | --- | --- |
| Work-order misclassification | 22% | 6% | 4-class triage, 8k labelled orders |
| Average dispatch delay | 4.2 h | 0.9 h | Planner queue time removed for auto-decided cases |
| Downtime cost | ₹8.5L/month | ₹6.1L/month | ₹1.2L per hour of unplanned stop, 2 stops avoided |
| Model cost | — | ₹4,000/month | 360M INT8 on an existing edge server |

*Illustrative plant economics. The pattern to copy is the
denominator: one avoided hour of unplanned downtime usually pays for a year of inference.*

## Spec and policy

```text
spec = DecisionSpec(
    name="work_order_triage",
    actions=["immediate", "next_shift", "planned", "monitor"],
    costs={
        ("immediate",  "critical"): 0,        ("immediate",  "minor"): 18_000,
        ("next_shift", "critical"): 120_000,  ("next_shift", "minor"): 2_000,
        ("planned",    "critical"): 260_000,  ("planned",    "minor"): 0,
        ("monitor",    "critical"): 480_000,  ("monitor",    "minor"): 0,
    },
    abstain="next_shift",
)
```

## Reading the manual: retrieval is mandatory

Plant rules live in PDFs that change quarterly. Retrieval over the maintenance manual is what makes the decision
correct rather than merely plausible:

```text
retriever = Retriever(index="maintenance-manual", embed_model="BAAI/bge-small-en-v1.5", top_k=4)
policy = HybridPolicy(spec, slm=slm, retriever=retriever,
                      template="Relevant procedure:\n{context}\n\nFault report:\n{query}\n\nPriority?")
# keep retrieved context <= ~40% of the 2k window; beyond that small models get worse
```

## Edge deployment reality

Plant networks are air-gapped and often offline. A 360M INT8 model (~360 MB) fits a fanless industrial PC with
4 GB RAM; a 66M encoder fits a Raspberry Pi 4 in under 200 MB. Sync the model artefact on a USB or an internal
registry — plan for the update path before you plan for the model.

- Model + tokenizer + calibration bundled as one signed artefact, verified on load.
- Graceful degradation: if the model fails to load, fall back to the deterministic rule table.
- Local logging with store-and-forward; never block a decision on network availability.
- Rollback in one command, offline.

## Human factors

Planners override models they do not trust, and they are usually right to. Show the model's suggestion *with*
the manual excerpt it used; override rates drop sharply when the evidence is visible, and every override is a free
label for the next training round.
