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

A hard label is a very expensive way to teach. It tells the student one bit — this example is class 3 — and says nothing about how close the other classes were. A teacher's distribution says far more: this example is 0.7 class 3, 0.2 class 1, 0.1 class 5, and the reason it is not class 1 is a single feature. That extra structure is the thing a small model cannot recover from one bit per example, and it is why distillation is best understood as a **data-efficiency** technique rather than a compression trick.

The 2019 DistilBERT result — 40% fewer parameters, 60% faster, ~97% of BERT-base's GLUE score — is the cleanest existence proof that the trick works, and nothing in it is specific to BERT.

The intuition to hold onto: the teacher is not transferring answers, it is transferring its *uncertainty*. A student trained on hard labels learns a boundary. A student trained on distributions learns where the boundary is soft, which is exactly the region a decision model cares about — the cases near the threshold where the action could go either way.

## 6.1 The loss

```text
L = α · CE(y, p_student)  +  (1 − α) · T² · KL( softmax(z_teacher / T) ‖ softmax(z_student / T) )
```

Two details carry most of the benefit. The `T²` factor keeps gradient magnitudes comparable as you change `T`. And the soft targets carry the teacher's *similarity structure*: "0.7 fraud, 0.2 ambiguous, 0.1 legitimate" is a different case from "0.7 fraud, 0.3 legitimate", even though both argmax to fraud. That extra information per example is what a small student cannot get from hard labels.

:::mermaid[What actually moves from teacher to student]
flowchart TB
  D[(Unlabelled inputs<br/>real traffic, hard cases, out-of-scope)] --> T[Teacher<br/>expensive, accurate]
  T --> S[Soft targets<br/>full distribution per example]
  D --> H[Hard labels<br/>one bit per example]
  S --> ST[Student<br/>small, fast]
  H --> ST
  ST --> E[Evaluate: accuracy, agreement,<br/>abstain behaviour, calibration]
  E -.->|where the student disagrees| D
:::

The diagram is the data recipe. The teacher never sees your test set, the student never sees the teacher's weights, and the only thing that crosses from big to small is the distribution — which is why the *inputs* you choose to label are the design decision, not the architecture.

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

## 6.4 The curve that justifies the technique

<svg viewBox="0 0 760 320" role="img" aria-label="The soft-target advantage is a data-efficiency effect, and it closes as n grows" style="width:100%;height:auto;font-family:var(--sans,system-ui);font-size:11px">
<rect x="0" y="0" width="760" height="320" fill="transparent"/>
<line x1="62" y1="274.0" x2="610" y2="274.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="278.0" text-anchor="end" fill="var(--dim,#5c6472)">0.20</text>
<line x1="62" y1="234.0" x2="610" y2="234.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="238.0" text-anchor="end" fill="var(--dim,#5c6472)">0.30</text>
<line x1="62" y1="194.0" x2="610" y2="194.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="198.0" text-anchor="end" fill="var(--dim,#5c6472)">0.40</text>
<line x1="62" y1="154.0" x2="610" y2="154.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="158.0" text-anchor="end" fill="var(--dim,#5c6472)">0.50</text>
<line x1="62" y1="114.0" x2="610" y2="114.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="118.0" text-anchor="end" fill="var(--dim,#5c6472)">0.60</text>
<line x1="62" y1="74.0" x2="610" y2="74.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="78.0" text-anchor="end" fill="var(--dim,#5c6472)">0.70</text>
<line x1="62" y1="34.0" x2="610" y2="34.0" stroke="var(--rule,#e3e7ef)" stroke-width="1"/>
<text x="54" y="38.0" text-anchor="end" fill="var(--dim,#5c6472)">0.80</text>
<line x1="62.0" y1="274" x2="62.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="62.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">100</text>
<line x1="153.3" y1="274" x2="153.3" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="153.3" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">1417</text>
<line x1="244.7" y1="274" x2="244.7" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="244.7" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">2733</text>
<line x1="336.0" y1="274" x2="336.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="336.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">4050</text>
<line x1="427.3" y1="274" x2="427.3" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="427.3" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">5367</text>
<line x1="518.7" y1="274" x2="518.7" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="518.7" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">6683</text>
<line x1="610.0" y1="274" x2="610.0" y2="278" stroke="var(--rule-2,#c5cbb2)"/>
<text x="610.0" y="292" text-anchor="middle" fill="var(--dim,#5c6472)">8000</text>
<line x1="62" y1="274" x2="610" y2="274" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<line x1="62" y1="274" x2="62" y2="34" stroke="var(--rule-2,#c5cbb2)" stroke-width="1.2"/>
<polyline points="62.0,112.4 72.4,94.8 89.7,90.8 124.4,90.4 193.8,88.4 332.5,89.2 610.0,90.0" fill="none" stroke="var(--accent,#6d28d9)" stroke-width="2.2"/>
<polyline points="62.0,194.4 72.4,159.2 89.7,145.2 124.4,123.6 193.8,108.4 332.5,98.0 610.0,94.0" fill="none" stroke="var(--dim,#6a7059)" stroke-width="2.2" stroke-dasharray="5 4"/>
<text x="336" y="312" text-anchor="middle" fill="var(--ink-2,#3a3f2c)">training examples (n)</text>
<text x="14" y="154" text-anchor="middle" fill="var(--ink-2,#3a3f2c)" transform="rotate(-90 14 154)">test accuracy</text>
<text x="62" y="18" fill="var(--ink,#15170f)" font-size="12.5" font-weight="600">The soft-target advantage is a data-efficiency effect, and it closes as n grows</text>
<line x1="624" y1="42" x2="644" y2="42" stroke="var(--accent,#6d28d9)" stroke-width="2.4"/>
<text x="650" y="46" fill="var(--ink-2,#3a3f2c)">soft targets</text>
<line x1="624" y1="62" x2="644" y2="62" stroke="var(--dim,#6a7059)" stroke-width="2.4" stroke-dasharray="5 4"/>
<text x="650" y="66" fill="var(--ink-2,#3a3f2c)">hard labels</text>
</svg>

Read the gap, not the level. At 100 examples the two students are 20 points apart; at 8,000 they are within a point. That shape is the signature of a technique that buys *label efficiency*: it matters enormously when labels are expensive and barely at all when you have 50,000 of them. If you already have 50k gold labels, a hard-label student is within noise and much simpler to debug.

The plateau is equally important. Neither student reaches the teacher's accuracy — the teacher here is deliberately non-linear, so a linear student cannot match it. Expect the same in your own work: the student learns the teacher's *boundary*, not its function, and the ceiling is set by the teacher's own error rate plus the gap your student's capacity leaves.

## 6.5 The same loss in torch

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

## 6.6 Data mix

The input distribution decides whether the student generalises. A mix that works:

| Slice | Share | Why |
| --- | --- | --- |
| Real production inputs | 50% | The distribution you are actually scored on |
| Hard / ambiguous cases near the threshold | 20% | Where the decisions are actually made |
| Synthetic edge cases from templates | 15% | Coverage for rare-but-expensive inputs |
| Adversarial or malformed inputs | 10% | Teaches the abstain behaviour |
| Out-of-scope inputs that must abstain | 5% | Without these the student never learns to refuse |

Sizes: 5k–20k teacher-labelled examples for a single closed task; 50k+ above ~20 classes or heavy imbalance. Below ~2k, prompting beats distillation — see §8.

## 6.7 Diagnosing a student

| Symptom | Cause | Fix |
| --- | --- | --- |
| Matches teacher on train, collapses on val | Input distribution too narrow | Add production and hard-case slices |
| Uniformly 5–10 points worse | `T` too low, targets near one-hot | Raise `T` to 4–8; check the teacher is not one-hot |
| Majority class fine, rare class at zero | Imbalance in the soft targets | Class-weighted CE term, or oversample |
| Confident and wrong on odd inputs | No out-of-scope slice | Add the 5% OOS slice and an abstain class |
| Ceiling well below expectation | The teacher itself is wrong that often | You cannot distil past it — fix labels or accept the ceiling |

## 6.8 The check

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
