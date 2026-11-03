---
section: "20"
title: "Autonomous systems"
kicker: "Use cases"
abstract: "Where the SLM advises and the classical stack decides — the safety architecture that keeps a language model out of the control loop."
time: "5 min"
order: 20
outcomes:
  - "Keep the model outside the control loop and say why"
  - "Write the guardrails that make an intent safe to act on"
  - "Set the readiness metrics for shadow mode"
---

In vehicles, drones and robots, an SLM does not drive. It converts messy human context — a passenger request, a
maintenance note, a scene description — into structured intent that a deterministic planner can act on. The
separation is not conservatism; it is the only way to get a certifiable system.

## Architecture: SLM outside the loop

```text
perception ──► planner ──► controller ──► actuators      (deterministic, certified)
                  ▲
                  │  structured intent, low rate (≤ 2 Hz)
                SLM decision layer                        (probabilistic, monitored)
```
| Layer | Decides | Rate | Verification |
| --- | --- | --- | --- |
| Controller | torque, steering | 100–1000 Hz | Formal, certified |
| Planner | trajectory, mission | 5–50 Hz | Simulation + reachability |
| SLM layer | intent, priority, exception handling | ≤ 2 Hz | Statistical + guardrails |

The SLM never emits a control value. It emits an intent from a closed enumeration, which the planner validates
against safety constraints before acting. If the intent is invalid or late, the planner falls back to a safe nominal
behaviour — that fallback is the design, not the exception path.

## Decision inventory

| Decision | Actions | SLM role |
| --- | --- | --- |
| Passenger request interpretation | reroute · stop · continue · clarify | Parse natural language into intent |
| Mission exception handling | return-to-base · hold · continue · abort | Interpret a human operator's instruction |
| Scene anomaly triage | nominal · slow · stop · handover | Summarise perception output for a remote operator |
| Fleet maintenance routing | ground · service-next · continue | Read fault logs and decide priority |

## Guardrails, in code

```python
ALLOWED = {"reroute", "stop", "continue", "clarify"}

def slm_intent(context, timeout_ms=250):
    try:
        raw = slm.decide(context, timeout_ms=timeout_ms)
    except TimeoutError:
        return "hold_nominal"                       # fail safe, not fail open
    if raw.action not in ALLOWED:
        return "hold_nominal"
    if raw.confidence < 0.55:
        return "clarify"                            # ask the human, do not guess
    if not planner.is_safe(raw.action, context):     # deterministic veto
        return "hold_nominal"
    return raw.action
```

- Hard timeout on every model call; the safe behaviour is always available without the model.
- Deterministic veto: the planner can reject any SLM intent, and does so on constraint violation.
- Closed action space, schema-validated, with an explicit unknown branch.
- No model update without a re-run of the scenario suite and a shadow-mode period.
- Every intent logged with model version, input hash, confidence and the planner's accept/reject.

## Numbers that matter

| Quantity | Target | Why |
| --- | --- | --- |
| Intent latency p99 | ≤ 250 ms | Must complete inside the operator interaction window |
| Invalid-intent rate | ≤ 0.1% | Every invalid intent costs a fallback event |
| Fallback rate | ≤ 2% | Above this the SLM is not adding value |
| False "continue" on unsafe context | 0 in the scenario suite | The one error class that cannot be traded off |
| Shadow-mode duration | ≥ 500 logged hours | Statistical floor before enabling |

:::warn[Certification is the constraint, not the model]
ISO 26262 (automotive), DO-178C (airborne) and IEC 61508 (industrial) do not currently provide a route to certify a
learned component in a safety-critical function. Keep the SLM in an advisory, low-rate, human-supervised role, and
keep the certified stack deterministic. Anything else is a research programme, not a product.
:::

## Simulation before silicon

Test in simulation with adversarial scenarios, then in shadow mode on real vehicles with the SLM's output logged
but not actuated. Compare the SLM's suggested intent against what the human operator actually did — that agreement
rate is your readiness metric, and it is cheap to collect.
