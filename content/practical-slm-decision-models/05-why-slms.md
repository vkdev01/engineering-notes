---
section: "5"
title: "Why SLMs for decisions"
kicker: "Economics"
abstract: "The cost arithmetic behind the build-versus-buy decision, run as code: cost per case for an API, a self-hosted 7B and a distilled 360M, with the break-even volume and the cases where none of it applies."
time: "12 min"
order: 5
outcomes:
  - "Cost a decision per case for three deployment shapes"
  - "Compute the volume at which distillation pays for itself"
  - "Name the four situations where an SLM is the wrong tool"
---

The argument for a small self-hosted model is not that it is better. It is that a closed decision has a different cost structure from open-ended generation, and at volume the gap is large — in the model below, four orders of magnitude between a frontier API call and a distilled 66M. The ratio moves with your token counts, your instance prices and your utilisation, so compute it rather than quoting someone else's.

## 5.1 Cost per case, for three shapes

Every input below is a number you can look up or estimate. Nothing is hidden in a constant:

```python run
"""Cost per decision for an API call, a self-hosted 7B and a distilled 360M."""

def api_cost_per_case(in_tokens, out_tokens, usd_per_mtok_in, usd_per_mtok_out, usd_inr=88.0,
                      retries=0.02):
    """Vendor pricing, plus a 2% retry/fallback allowance by default."""
    per_call = (in_tokens / 1e6) * usd_per_mtok_in + (out_tokens / 1e6) * usd_per_mtok_out
    return per_call * (1 + retries) * usd_inr


def selfhosted_cost_per_case(instance_usd_per_hour, req_per_second, usd_inr=88.0,
                             utilisation=0.35, replicas=1):
    """Instance cost divided by the requests it actually serves.

    utilisation is the fraction of the hour spent serving traffic - an idle
    replica still bills, which is why a warm minimum costs what it costs.
    """
    served = req_per_second * 3600 * utilisation
    return (instance_usd_per_hour * replicas / served) * usd_inr


def break_even_cases(one_off_inr, per_case_baseline, per_case_new):
    """How many decisions before the cheaper option repays the build."""
    saving = per_case_baseline - per_case_new
    return float("inf") if saving <= 0 else one_off_inr / saving


SHAPES = {
    "frontier API":        api_cost_per_case(600, 12, 3.0, 15.0),
    "frontier API (cheap)": api_cost_per_case(600, 12, 0.15, 0.60),
    "self-hosted 7B (T4)":  selfhosted_cost_per_case(0.53, req_per_second=25),
    "self-hosted 360M (CPU)": selfhosted_cost_per_case(0.042, req_per_second=40),
    "distilled 66M (CPU)":  selfhosted_cost_per_case(0.021, req_per_second=180),
}

print("%-24s %12s" % ("shape", "INR per case"))
for name, cost in SHAPES.items():
    print("%-24s %12.5f" % (name, cost))

print()
VOLUME = 5_000_000                                   # cases per month
print("monthly bill at %s cases:" % f"{VOLUME:,}")
for name, cost in SHAPES.items():
    print("  %-24s INR %12s" % (name, f"{cost * VOLUME:,.0f}"))

print()
BUILD_INR = 41_000                                   # teacher labels + GPU hours, see 5.2
for name in ("frontier API", "self-hosted 7B (T4)"):
    n = break_even_cases(BUILD_INR, SHAPES[name], SHAPES["self-hosted 360M (CPU)"])
    print("break-even vs %-22s %12s cases  (%.1f days at this volume)" % (name, f"{n:,.0f}", n / (VOLUME / 30)))
```

```text
shape                    INR per case
frontier API                  0.17772
frontier API (cheap)          0.00872
self-hosted 7B (T4)           0.00148
self-hosted 360M (CPU)        0.00007
distilled 66M (CPU)           0.00001

monthly bill at 5,000,000 cases:
  frontier API             INR      888,624
  frontier API (cheap)     INR       43,623
  self-hosted 7B (T4)      INR        7,403
  self-hosted 360M (CPU)   INR          367
  distilled 66M (CPU)      INR           41

break-even vs frontier API                230,789 cases  (1.4 days at this volume)
break-even vs self-hosted 7B (T4)      29,133,769 cases  (174.8 days at this volume)
```

:::warn[Warning 5.1.a — these are model inputs, not quotes]
Prices change and your utilisation is not 0.35. Every argument in this section survives a 3× error in the constants; what does not survive is comparing an API's *list* price against a self-hosted instance that sits idle. Put your own utilisation in, and count the second replica you keep warm for tail latency.
:::

## 5.2 What the one-off build actually costs

`BUILD_INR = 41,000` is not a guess; it decomposes:

| Line | Quantity | Unit | INR |
| --- | --- | --- | --- |
| Teacher labelling | 100,000 prompts | ₹0.40 each | 40,000 |
| Distillation run | 3 epochs, 1× A10G, 6 h | ₹100/h | 600 |
| Evaluation + calibration | CPU hours | — | ~400 |
| **One-off total** | | | **41,000** |

Then the recurring line nobody budgets: **maintenance**. A distilled model is a service. Expect to re-label drift, re-distil and re-validate quarterly; at two engineer-days a quarter that is ₹40,000–₹80,000 a year in most Indian teams, which is a fifth of the build cost. Put it in the business case or the model gets switched off in month seven.

## 5.3 The four cases where an SLM is the wrong tool

The arithmetic above is necessary and not sufficient. These four situations kill the project regardless of cost:

| Situation | Why the SLM loses | Do this instead |
| --- | --- | --- |
| The output is prose people read | Fluency is parameter-bound; a 360M model writes badly | Frontier API, or SLM for the label + templates for the prose |
| The decision needs this week's facts | Weights are frozen at the training cutoff | Retrieval in front of the SLM, and cite the retrieved text |
| Multi-step planning over many hops | Error compounds; 3+ hops degrades sharply at this size | Planner LLM, SLM as the executor for each step |
| You cannot label or teacher-label 5k cases | Prompting alone is brittle at 360M | Prompt a large model, log its decisions, distil later |

Notice the second and third are architecture problems with an SLM component, not rejections of SLMs. The first and fourth are genuine no-gos at this scale.

One more reading from the output: breaking even against a *self-hosted 7B* took 175 days at this volume, while breaking even against a frontier API took 1.4. Distilling from a 360M to a 66M is a much weaker business case than replacing an API call — do the second one first.

## 5.4 Accuracy you should expect, and how to check it here

Published results suggest agreement with a strong teacher on a narrow task of roughly 95–99% for intent classification, 85–95% F1 for span extraction, and 55–80% on arithmetic reasoning. Those ranges are from specific datasets; §6 measures your own agreement in about a minute of CPU.

```python run
# sanity checks on the business case before you take it to anyone
distilled, api, hosted = (SHAPES["self-hosted 360M (CPU)"], SHAPES["frontier API"],
                          SHAPES["self-hosted 7B (T4)"])

assert distilled < hosted < api, "the ordering in this table must hold"
assert break_even_cases(BUILD_INR, api, distilled) > 0, "no saving against the API - do not build"
assert break_even_cases(BUILD_INR, api, distilled) / VOLUME < 1.0, "build does not repay within a month"

# the decision is robust to a 3x error in the API price
for mult in (0.33, 1.0, 3.0):
    n = break_even_cases(BUILD_INR, api * mult, distilled)
    print("api price x%.2f -> break-even %9.0f cases (%.1f months)" % (mult, n, n / VOLUME))

print()
print("annual saving at %s cases: INR %s" % (f"{VOLUME * 12:,}", f"{(api - distilled) * VOLUME * 12:,.0f}"))
print("annual maintenance allowance: INR 60,000 -> net %s" %
      f"{(api - distilled) * VOLUME * 12 - 60_000:,.0f}")
```

```text
api price x0.33 -> break-even    699947 cases (0.1 months)
api price x1.00 -> break-even    230789 cases (0.0 months)
api price x3.00 -> break-even     76908 cases (0.0 months)

annual saving at 60,000,000 cases: INR 10,659,088
annual maintenance allowance: INR 60,000 -> net 10,599,088
```

:::note[Note 5.1.a — the question that ends the meeting early]
"Which decision are we automating, and what does a wrong one cost?" If nobody in the room can answer both halves, the project is not ready for a model choice. Every number in this section is downstream of that answer.
:::
