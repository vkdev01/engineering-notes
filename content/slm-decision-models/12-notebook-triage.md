---
section: "12"
title: "Notebook: triage under costs"
kicker: "Notebook"
abstract: "A three-action triage decision under an asymmetric cost matrix — where abstention is the point, not the failure."
time: "5 min"
order: 12
outcomes:
  - "Turn a three-action cost matrix into an operating point"
  - "Watch an abstain cap trade cost against capacity"
  - "Explain why exact-match accuracy needs an acceptable-action map"
---

**File:** `notebooks/02-finetuning-medical.ipynb` · **Runtime:** ~6 min CPU ·
**Data:** synthetic symptom notes, 3,000 train / 1,000 test, generated in-notebook.

:::warn[Not a medical device]
This notebook is a methodology demonstration on synthetic text. Nothing here is validated for clinical use, and no
model output should ever be used for patient care without regulatory clearance and clinician oversight.
:::

## The decision

| Action | Meaning | Cost of being wrong |
| --- | --- | --- |
| `routine` | Book a standard appointment | Severe missed case: 100 (relative units) |
| `urgent` | Same-day clinician review | Over-triage: 12 |
| `escalate` | Immediate human triage nurse | Nurse time: 4 per case |

With those costs the unconstrained optimum escalates almost everything, which is exactly the trap described in
[decision theory](/c/slm-decision-models/04-decision-theory). The notebook adds a capacity constraint of 30% and
optimises inside it.

## Pipeline

```python
# 1 · features: hashed bag-of-words in numpy (no downloads, no sklearn needed)
X = hashed_features(notes, dim=2048)      # log1p counts, L2 normalised

# 2 · model: logistic regression (swap in sklearn or a fine-tuned 66M encoder here)
w, b = train_logreg(X[:split], y[:split])

# 3 · probabilities -> actions under the cost matrix, with a 30% abstain cap
policy = CostOptimalPolicy(spec, max_abstain_rate=0.30)
actions = policy.act_batch(proba)

# 4 · report
evaluate_policy(spec, policy, y_true=y_test, probs=proba)
```

## Expected output

```text
policy                    accuracy  cost_per_case  abstain  coverage
argmax @ 0.5                 0.756        31.37       0.00     1.00
cost-optimal, 30% cap        1.000         8.99       0.30     0.70
cost-optimal, 10% cap        1.000        10.11       0.10     0.90

severe misses : 8.9% of true deterioration cases routed to routine
ECE           : 0.107 raw -> 0.049 calibrated (T = 0.60)
note          : the 1.000 accuracy is against the *acceptable* action set
                ({"bad": ["escalate", "urgent"], "good": ["routine", "urgent"]})
```

## What the notebook demonstrates

- **Thresholds come from costs, not from 0.5.** Moving from argmax@0.5 to the cost-optimal rule cuts cost per case by 71% — from 31.4 to 9.0.
- **The abstain cap is a business constraint.** Tightening it from 30% to 10% raises cost per case from 9.0 to 10.1; that trade-off is a staffing conversation, not an ML one.
- **Accuracy needs a definition.** Under a three-action cost matrix the cost-minimising action is never "urgent", so exact-match accuracy would score a sensible policy at zero. The spec's `acceptable` map fixes that.
- **Noise sets the floor.** 20% of notes carry the other class's vocabulary, which is why severe misses settle near 9% no matter how the threshold moves.

## Extending it

Swap the TF-IDF + logistic head for a fine-tuned 66M encoder (see [fine-tuning](/c/slm-decision-models/07-fine-tuning))
and keep everything downstream identical — same spec, same policy, same report. That swap is the whole argument for
separating the decision layer from the model layer.
