---
section: "6"
title: "Distillation"
kicker: "Training"
abstract: "The distillation loss, a complete trainer that runs on CPU in a minute, the label-efficiency numbers it produces, and the diagnostics that tell you which of five things went wrong."
time: "18 min"
order: 6
outcomes:
  - "Implement the temperature-scaled distillation loss and train a student"
  - "Measure the label-efficiency gain on your own data"
  - "Diagnose a student that memorises, collapses or never learns to abstain"
---

Distillation moves a teacher's decision behaviour into a smaller model. The 2019 DistilBERT result — 40% fewer parameters, 60% faster, ~97% of BERT-base's GLUE score — is the cleanest existence proof, and nothing in the trick is specific to BERT. What follows is the loss, a trainer you can run in a minute, and the numbers to expect.

## 6.1 The loss

```text
L = α · CE(y, p_student)  +  (1 − α) · T² · KL( softmax(z_teacher / T) ‖ softmax(z_student / T) )
```

Two details carry most of the benefit. The `T²` factor keeps gradient magnitudes comparable as you change `T`. And the soft targets carry the teacher's *similarity structure*: "0.7 fraud, 0.2 ambiguous, 0.1 legitimate" is a different case from "0.7 fraud, 0.3 legitimate", even though both argmax to fraud. That extra information per example is what a small student cannot get from hard labels.

## 6.2 A complete trainer, in numpy

Everything below is the whole thing: data, teacher, student, training loop, evaluation. It runs in about a minute on CPU because the student is a linear softmax over 60 features — enough to demonstrate the effect and small enough to read.

```python run
"""Soft targets vs hard labels: the same student, the same data, two losses."""
import numpy as np

N_CLASSES, N_FEATURES = 6, 60
rng = np.random.default_rng(0)


def make_data(n):
    """Synthetic features with a class-dependent block, plus 12% label noise."""
    y = rng.integers(0, N_CLASSES, n)
    X = rng.normal(0, 1.0, (n, N_FEATURES))
    for c in range(N_CLASSES):
        lo, hi = (c * N_FEATURES) // N_CLASSES, ((c + 1) * N_FEATURES) // N_CLASSES
        X[y == c, lo:hi] += 0.6
    flip = rng.random(n) < 0.12
    y[flip] = rng.integers(0, N_CLASSES, flip.sum())
    return X, y


def teacher_probs(X, temperature=2.0):
    """A deliberately non-linear teacher: a linear one would be fitted exactly."""
    z = np.zeros((len(X), N_CLASSES))
    for c in range(N_CLASSES):
        lo, hi = (c * N_FEATURES) // N_CLASSES, ((c + 1) * N_FEATURES) // N_CLASSES
        block = X[:, lo:hi]
        z[:, c] = 2.5 * np.tanh(1.4 * block.mean(axis=1)) - 0.8 * block.std(axis=1) ** 2
    z = z / temperature
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def train_student(X, targets, soft, epochs=200, lr=0.5, l2=1e-4, T=4.0):
    """Multinomial logistic regression. soft=True uses the KL term, soft=False plain CE."""
    n, d = X.shape
    W, b = np.zeros((d, N_CLASSES)), np.zeros(N_CLASSES)
    for _ in range(epochs):
        logits = X @ W + b
        if soft:
            # soften the teacher targets, then match the student at the same T
            t = targets ** (1.0 / T)
            t = t / t.sum(axis=1, keepdims=True)
            grad = (softmax(logits / T) - t) * T / n
        else:
            grad = (softmax(logits) - np.eye(N_CLASSES)[targets]) / n
        W -= lr * (X.T @ grad + l2 * W)
        b -= lr * grad.sum(axis=0)
    return W, b


def accuracy(W, b, X, y):
    return float((softmax(X @ W + b).argmax(1) == y).mean())


def agreement(W, b, X, teacher_p):
    return float((softmax(X @ W + b).argmax(1) == teacher_p.argmax(1)).mean())


X_train, y_train = make_data(8000)
X_test, y_test = make_data(2000)
T_train, T_test = teacher_probs(X_train), teacher_probs(X_test)

print("teacher accuracy on test: %.3f" % float((T_test.argmax(1) == y_test).mean()))

print()
print("%8s %10s %10s %8s" % ("n_train", "hard acc", "soft acc", "gap"))
for n in (100, 250, 500, 1000, 2000, 4000, 8000):
    Wh, bh = train_student(X_train[:n], y_train[:n], soft=False)
    Ws, bs = train_student(X_train[:n], T_train[:n], soft=True)
    a_hard, a_soft = accuracy(Wh, bh, X_test, y_test), accuracy(Ws, bs, X_test, y_test)
    print("%8d %10.3f %10.3f %8.3f" % (n, a_hard, a_soft, a_soft - a_hard))

Wh, bh = train_student(X_train, y_train, soft=False)
Ws, bs = train_student(X_train, T_train, soft=True)
print()
print("at n=8000  hard: acc %.3f agreement %.3f" % (accuracy(Wh, bh, X_test, y_test),
                                                    agreement(Wh, bh, X_test, T_test)))
print("at n=8000  soft: acc %.3f agreement %.3f" % (accuracy(Ws, bs, X_test, y_test),
                                                    agreement(Ws, bs, X_test, T_test)))
```

```text
teacher accuracy on test: 0.621

 n_train   hard acc   soft acc      gap
     100      0.399      0.604    0.205
     250      0.487      0.648    0.161
     500      0.522      0.658    0.136
    1000      0.576      0.659    0.084
    2000      0.614      0.664    0.050
    4000      0.640      0.662    0.022
    8000      0.650      0.660    0.010

at n=8000  hard: acc 0.650 agreement 0.823
at n=8000  soft: acc 0.660 agreement 0.836
```

## 6.3 Reading the curve

The gap is largest where data is scarce and closes as data grows — that is the signature of a *data-efficiency* technique, not a compression trick. Two practical consequences:

- **Distillation is worth most when labels are expensive.** If you have 50k gold labels, a hard-label student is close behind and much simpler.
- **Agreement plateaus below 1.0.** The student learns the teacher's decision boundary, not its exact distribution. If you need the probabilities, calibrate the student afterwards (§2) rather than expecting distillation to preserve them.

## 6.4 The same loss in torch

The numpy trainer above is a teaching device. For a real student, this is the step function — complete, and the only part of a training loop that differs from ordinary fine-tuning:

```python
import torch
import torch.nn.functional as F


def distill_step(student, teacher, batch, T=4.0, alpha=0.3):
    """One optimisation step. Returns the scalar loss."""
    input_ids = batch["input_ids"]
    attention_mask = batch["attention_mask"]
    labels = batch["labels"]

    with torch.no_grad():
        t_logits = teacher(input_ids=input_ids, attention_mask=attention_mask).logits
    s_logits = student(input_ids=input_ids, attention_mask=attention_mask).logits

    hard = F.cross_entropy(s_logits, labels)
    soft = F.kl_div(
        F.log_softmax(s_logits / T, dim=-1),
        F.softmax(t_logits / T, dim=-1),
        reduction="batchmean",
    ) * (T ** 2)
    return alpha * hard + (1 - alpha) * soft


def train_epoch(student, teacher, loader, optimiser, T=4.0, alpha=0.3, grad_clip=1.0):
    student.train()
    total, seen = 0.0, 0
    for batch in loader:
        loss = distill_step(student, teacher, batch, T=T, alpha=alpha)
        optimiser.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(student.parameters(), grad_clip)
        optimiser.step()
        total += float(loss) * len(batch["labels"])
        seen += len(batch["labels"])
    return total / max(seen, 1)
```

:::note[Note 6.1.a — pre-compute the teacher]
Teacher inference is the expensive part of distillation. Run it once over the whole dataset, store the distributions as float16 (a 20-class problem costs 40 bytes per example), then train the student as many times as you like without touching the teacher. This turns a three-hour loop into a three-minute one, and it is the single highest-leverage engineering decision in this section.
:::

## 6.5 Data mix

The input distribution decides whether the student generalises. A mix that works:

| Slice | Share | Why |
| --- | --- | --- |
| Real production inputs | 50% | The distribution you are actually scored on |
| Hard / ambiguous cases near the threshold | 20% | Where the decisions are actually made |
| Synthetic edge cases from templates | 15% | Coverage for rare-but-expensive inputs |
| Adversarial or malformed inputs | 10% | Teaches the abstain behaviour |
| Out-of-scope inputs that must abstain | 5% | Without these the student never learns to refuse |

Sizes: 5k–20k teacher-labelled examples for a single closed task; 50k+ above ~20 classes or heavy imbalance. Below ~2k, prompting beats distillation — see §8.

## 6.6 Diagnosing a student

| Symptom | Cause | Fix |
| --- | --- | --- |
| Matches teacher on train, collapses on val | Input distribution too narrow | Add production and hard-case slices |
| Uniformly 5–10 points worse | `T` too low, targets near one-hot | Raise `T` to 4–8; check the teacher is not one-hot |
| Majority class fine, rare class at zero | Imbalance in the soft targets | Class-weighted CE term, or oversample |
| Confident and wrong on odd inputs | No out-of-scope slice | Add the 5% OOS slice and an abstain class |
| Ceiling well below expectation | The teacher itself is wrong that often | You cannot distil past it — fix labels or accept the ceiling |

## 6.7 The check

```python run
# what must be true before you call a distillation run successful
best_n = 8000
Wh, bh = train_student(X_train[:best_n], y_train[:best_n], soft=False)
Ws, bs = train_student(X_train[:best_n], T_train[:best_n], soft=True)

assert accuracy(Ws, bs, X_test, y_test) >= accuracy(Wh, bh, X_test, y_test) - 0.01, \
    "soft targets should never be materially worse at equal n"
assert agreement(Ws, bs, X_test, T_test) > 0.75, "student does not resemble the teacher"
assert 0.0 <= agreement(Ws, bs, X_test, T_test) <= 1.0

# and the thing that actually matters for a decision model: the abstain behaviour
# (a student with no out-of-scope slice will not have one - see the data mix)
print("hard %.3f | soft %.3f | agreement %.3f" % (accuracy(Wh, bh, X_test, y_test),
                                                  accuracy(Ws, bs, X_test, y_test),
                                                  agreement(Ws, bs, X_test, T_test)))
```

```text
hard 0.650 | soft 0.660 | agreement 0.836
```
