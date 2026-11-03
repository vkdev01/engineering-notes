---
section: "13"
title: "Notebook: prompt experiments"
kicker: "Notebook"
abstract: "Measuring prompt changes instead of arguing about them: a 200-example golden set, four prompt variants, one table."
time: "5 min"
order: 13
outcomes:
  - "Run four prompt variants through one harness"
  - "Compare paired results with McNemar's test"
  - "Report cost per case alongside accuracy"
---

**File:** `notebooks/03-prompt-engineering.ipynb` · **Runtime:** ~2 min CPU (rule-based
simulator) or ~20 min with a real 360M model.

## Design

The notebook treats prompting as an experiment with a fixed evaluation harness. Four variants are compared on the
same 200 examples:

| Variant | Change | Hypothesis |
| --- | --- | --- |
| P0 | Zero-shot, terse instruction | Baseline |
| P1 | + explicit label definitions and tie-breakers | Removes adjacent-class confusion |
| P2 | + 4 similarity-selected examples (one abstain) | Biggest single gain |
| P3 | + JSON schema and an explicit fallback rule | Fewer parse failures, same accuracy |

## Harness

```python
def run_variant(prompt_fn, examples, model):
    rows = []
    for ex in examples:
        raw = model.generate(prompt_fn(ex.text))
        action, ok = parse_action(raw)          # falls back to 'review' on failure
        rows.append({"raw": raw, "action": action, "parse_ok": ok,
                     "gold": ex.label, "score": ex.teacher_score})
    return pd.DataFrame(rows)

def summarise(df):
    return {
        "accuracy": (df.action == df.gold).mean(),
        "macro_f1": macro_f1(df.action, df.gold),
        "parse_fail": 1 - df.parse_ok.mean(),
        "abstain_rate": (df.action == "review").mean(),
        "cost_per_case": expected_cost(spec, df.action, df.gold),
    }
```

## Expected output

```text
variant  accuracy  macro_f1  parse_fail  abstain_rate  cost_per_case
P0       0.685     0.531     0.075       0.135         1.60
P1       0.770     0.610     0.075       0.155         0.96
P2       0.845     0.688     0.060       0.155         0.47
P3       0.860     0.675     0.000       0.110         0.53

pairwise significance (P2 vs P1): McNemar p = 0.0001, n = 200
```

## Lessons

- **Examples beat wording.** P1 (better definitions) gained 8.5 points; P2 (four retrieved examples) gained another 7.5. Most prompt-engineering effort should go into example selection, not adjective tuning.
- **Schema changes reduce failures, not errors.** P3 eliminated every parse failure and left accuracy within 1.5 points — which is what you want from a formatting change.
- **200 examples is enough to detect a 5-point difference** at reasonable power, but not a 1-point one. Size your golden set against the effect you care about, not against a round number.
- **Always report cost per case.** Accuracy moved 13 points; cost per case nearly halved. The second number is the one that survives a budget review.

:::note[Statistical hygiene]
Use McNemar's test for paired prompt comparisons — the same examples are used across variants, so an unpaired test
overstates significance. The notebook includes the implementation in three lines.
:::
