---
section: "11"
title: "Notebook: distillation basics"
kicker: "Notebook"
abstract: "Train a small student to imitate a teacher's label distribution, and measure how much agreement you actually bought."
time: "5 min"
order: 11
outcomes:
  - "Run a soft-target vs hard-label comparison end to end"
  - "Read the label-efficiency curve"
  - "See why temperature has to be measured, not copied"
---

**File:** `notebooks/01-distillation-basics.ipynb` · **Runtime:** ~4 min CPU ·
**Data:** synthetic 6-class intent set generated in-notebook (no downloads).

## What it does

1. Builds a toy "teacher" that is a hand-written scoring function over synthetic text features — so the notebook runs with zero downloads and still has non-trivial soft targets.
1. Generates 8,000 training and 2,000 held-out examples with teacher distributions.
1. Trains two students on identical data: one on hard labels, one on soft targets with T = 4, α = 0.3.
1. Plots the accuracy-vs-data-size curve for both, showing the label-efficiency gap.

## Key cells

```python
# 1 · teacher distribution over 6 intents, temperature-sharpened
def teacher_probs(text, T=1.0):
    z = np.array([score_intent(text, k) for k in range(6)])
    e = np.exp(z / T)
    return e / e.sum()

# 2 · the two students differ only in the loss
loss_hard = F.cross_entropy(student_logits, labels)
loss_soft = F.kl_div(F.log_softmax(student_logits / 4, -1), teacher_p, reduction="batchmean") * 16
loss = 0.3 * loss_hard + 0.7 * loss_soft

# 3 · label-efficiency sweep
for n in [100, 250, 500, 1000, 2000, 4000, 8000]:
    acc_hard[n] = train_eval(n, mode="hard")
    acc_soft[n] = train_eval(n, mode="soft")
```

## Expected output

```python
n_train   hard-label acc   soft-target acc   gap
100       0.399            0.604             0.205
500       0.522            0.658             0.136
2000      0.614            0.664             0.050
8000      0.650            0.660             0.010

agreement with teacher (n=8000):  hard 0.822  |  soft 0.836
teacher accuracy on the test split: 0.621
```

*Numbers from a CPU run of the committed notebook with seed 0.
Your run will differ slightly; the ordering and the shrinking gap at large n are the point.*

## What to take away

- The soft-target advantage is largest when data is scarce — 20 points at n=100, 1 point at n=8000. Distillation is a data-efficiency technique as much as a compression one.
- The gap never fully closes: the student learns the teacher's boundary, not its exact distribution. Expect ~82–86% agreement here, not 100% — the teacher is deliberately non-linear so the linear student cannot match it exactly.
- Temperature barely moves the argmax in this setup. That is the honest result, and the reason the notebook includes the sweep: measure T on your own task instead of copying a canonical value. It matters most when the student is capacity-limited or when you need the probabilities, not just the label.

## Run it

```bash
jupyter lab notebooks/01-distillation-basics.ipynb
# or headless:
jupyter nbconvert --to notebook --execute notebooks/01-distillation-basics.ipynb \
  --output /tmp/nb1.ipynb
```
