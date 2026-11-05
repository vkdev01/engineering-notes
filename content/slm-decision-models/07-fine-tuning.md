---
section: "7"
title: "Fine-tuning"
kicker: "Training"
abstract: "When fine-tuning is the right fix, what LoRA and QLoRA change and cost (Qwen2.5-0.5B: 8.8M trainable parameters at r = 16; 7.9 GB full vs 1.1 GB LoRA vs 0.6 GB QLoRA before activations), how many labels and how clean, the prior correction after rebalancing, and an adapter you can reproduce."
time: "14 min"
order: 7
outcomes:
  - "Pick prompting, retrieval, a classifier head, LoRA or distillation from the failure you observe"
  - "Compute LoRA trainable parameters and training memory for full fine-tuning, LoRA and QLoRA"
  - "Size train / validation / calibration / test splits and read a learning curve"
  - "Correct the probabilities of a rebalanced model before applying a cost threshold"
  - "Version base + adapter + calibration as one reproducible artefact"
---

The ticket router keeps confusing `billing` with `account_access` whenever a refund is tied to a login problem. You have 20,000 historically routed tickets and a GPU budget. Before reaching for LoRA, the question is which intervention removes **this** error at the lowest total cost; if it is fine-tuning, you then need three numbers — how many parameters to train, how much memory that takes, and how many clean labels it needs.

:::key[First principle]
Fine-tuning changes the **mapping** from input to output; it does not reliably add facts and cannot add capacity the base model lacks. LoRA restricts the change to a low-rank update $\Delta W = BA$, so you train ~1–2% of the parameters and pay optimizer memory only on those. How far the mapping moves is set by the labels — their count, their noise and their class balance — and all three show up in the probabilities you threshold.
:::

## 7.1 Diagnose before you train

| Observed failure | First fix | Fine-tune? |
| --- | --- | --- |
| Missing or changing facts (prices, policies, account state) | Retrieval or a tool call | No — facts change weekly, weights do not |
| Invalid JSON, drifting format | Constrained decoding + validator ([§8](/c/slm-decision-models/08-prompt-engineering)) | No |
| Consistent confusion between two labels | Label definitions and 4–5 examples in the prompt; then fine-tune | Yes, if examples do not fix it |
| Domain jargon across many inputs | LoRA fine-tune | Yes |
| Accurate but too slow or costly at volume | Distil into a smaller student ([§6](/c/slm-decision-models/06-distillation)) | Yes (the student) |
| Multi-step reasoning the model cannot do | Larger model or task decomposition | Rarely |
| Closed label set, labelled data, need calibrated $P(y \mid x)$ | Classification head (± LoRA on the body) | Yes |

For a decision model the **classification head** is usually the right shape: one forward pass, no parsing, no format failures, and a probability vector you can calibrate directly. It adds $K(d+1)$ parameters — \(4 \times 897 = 3{,}588\) on Qwen2.5-0.5B (hidden size 896). Generative fine-tuning (prompt → JSON completion) is for when you need extracted fields or a reason string; mask the prompt tokens out of the loss so the gradient teaches the answer, not the ticket text.

## 7.2 LoRA: parameters

A linear layer computes $h = Wx$, $W \in \mathbb{R}^{d_{out} \times d_{in}}$. LoRA freezes $W$ and learns

$$
h = Wx + \frac{\alpha}{r} B A x, \qquad A \in \mathbb{R}^{r \times d_{in}},\; B \in \mathbb{R}^{d_{out} \times r}
$$

with $r(d_{in} + d_{out})$ parameters instead of $d_{in} d_{out}$. $B$ starts at zero, so training starts exactly at the base model; $\alpha/r$ keeps the update's scale stable when you change $r$; after training, merge $W' = W + \frac{\alpha}{r}BA$ and serve the base architecture with zero added latency. [Derivation and Llama-3.2 shapes](/c/practical-slm-decision-models/08-fine-tuning-and-adaptation).

:::example[Worked example · one 896 × 896 projection (Qwen2.5-0.5B q_proj)]
Full update: \(896^2 = 802{,}816\) parameters. $r = 8$: \(8 \times (896 + 896) = 14{,}336\) (1.79%, i.e. \(2r/d\)). $r = 16$: 28,672 (3.57%). The update can move the layer along at most $r$ input directions — the bet is that a routing adaptation needs few. Across the whole model, adapters on all seven linear layers of every block at $r = 16$ are **8.80M parameters, 1.78%** of 0.494B.
:::

## 7.3 LoRA and QLoRA: memory

Mixed-precision Adam keeps, per **trainable** parameter, a bf16 weight (2 bytes), a bf16 gradient (2), an fp32 master copy (4) and two fp32 moments (8): **16 bytes**. Frozen parameters cost only their storage — 2 bytes in bf16, about 4.127 bits in QLoRA's NF4 with double-quantised block scales (Dettmers et al., 2023). Quantisation libraries typically leave the embedding in bf16.

$$
\begin{aligned}
\text{Full FT, 0.494B:}\quad & 0.494 \times 10^9 \times 16 = 7.90\ \text{GB} \\
\text{LoRA } r{=}16\text{:}\quad & 0.494 \times 10^9 \times 2 + 8.80 \times 10^6 \times 16 = 0.99 + 0.14 = 1.13\ \text{GB} \\
\text{QLoRA } r{=}16\text{:}\quad & \underbrace{0.358 \times 10^9 \times \tfrac{4.127}{8}}_{\text{NF4 body}} + \underbrace{0.136 \times 10^9 \times 2}_{\text{bf16 embedding}} + 0.14 = 0.18 + 0.27 + 0.14 = 0.60\ \text{GB}
\end{aligned}
$$

```python run
"""LoRA parameter counts and training memory (before activations) for the Qwen2.5 sizes in section 3."""
# Qwen2.5 config.json: layers, hidden, heads, kv_heads, MLP width, vocab (0.5B-3B tie embeddings)
CONFIGS = {"Qwen2.5-0.5B": (24, 896, 14, 2, 4864, 151_936),
           "Qwen2.5-1.5B": (28, 1536, 12, 2, 8960, 151_936),
           "Qwen2.5-3B": (36, 2048, 16, 2, 11008, 151_936)}


def linear_shapes(d, h, kv, f):
    """(d_in, d_out) of each linear layer in one transformer block."""
    kvw = kv * (d // h)
    return {"q": (d, d), "k": (d, kvw), "v": (d, kvw), "o": (d, d),
            "gate": (d, f), "up": (d, f), "down": (f, d)}


def lora(L, shapes, r, names):
    return L * sum(r * (i + o) for n, (i, o) in shapes.items() if n in names)


ATTN, ALL = {"q", "k", "v", "o"}, {"q", "k", "v", "o", "gate", "up", "down"}
print(f"{'model':13s} {'params':>7s} {'r=8 attn':>9s} {'r=16 all':>9s} {'%':>6s}"
      f" {'full FT':>8s} {'LoRA':>6s} {'QLoRA':>6s}   (GB before activations)")
for name, (L, d, h, kv, f, V) in CONFIGS.items():
    sh = linear_shapes(d, h, kv, f)
    body = L * sum(i * o for i, o in sh.values())
    emb = V * d
    n = body + emb
    a8, r16 = lora(L, sh, 8, ATTN), lora(L, sh, 16, ALL)
    full = 16 * n                       # bf16 weight + bf16 grad + fp32 master + Adam m, v
    lo = 2 * n + 16 * r16               # frozen bf16 base + adapters at 16 bytes
    ql = body * 4.127 / 8 + 2 * emb + 16 * r16   # NF4 body (+ block scales), bf16 embedding
    print(f"{name:13s} {n / 1e9:6.2f}B {a8 / 1e6:8.2f}M {r16 / 1e6:8.2f}M {r16 / n:6.2%}"
          f" {full / 1e9:8.2f} {lo / 1e9:6.2f} {ql / 1e9:6.2f}")

# One square 896 x 896 projection (Qwen2.5-0.5B q_proj): full update vs rank-r update
for r in (8, 16, 64):
    print(f"896x896 layer, r={r:2d}: {r * 2 * 896:7,} params = {r * 2 * 896 / 896 ** 2:.2%} of {896 ** 2:,}")

# How precise is a test set? 95% half-width of an accuracy estimate at 85%
for n in (500, 1000, 2000, 5000):
    print(f"test n={n:5d}: 85% accuracy +/- {1.96 * (0.85 * 0.15 / n) ** 0.5:.3f}")


def prior_shift(p, pi_train, pi_true):
    odds = p / (1 - p) * (pi_true / (1 - pi_true)) / (pi_train / (1 - pi_train))
    return odds / (1 + odds)


print(f"balanced model says 0.30, true base rate 3.45%: corrected p = {prior_shift(0.30, 0.5, 0.0345):.4f}"
      f" vs threshold {400 / (400 + 5000):.4f}")

# Training compute: ~6 N per token for full FT, ~4 N for LoRA (no weight gradients on frozen layers)
tokens = 14_000 * 128 * 2                               # train split x tokens/ticket x epochs
for label, k in (("full FT", 6), ("LoRA", 4)):
    print(f"0.5B {label}: {k * 0.494e9 * tokens:.2e} FLOP = {k * 0.494e9 * tokens / 50e12:.0f} s at 50 TFLOP/s")
```

```output
model          params  r=8 attn  r=16 all      %  full FT   LoRA  QLoRA   (GB before activations)
Qwen2.5-0.5B    0.49B     1.08M     8.80M  1.78%     7.90   1.13   0.60
Qwen2.5-1.5B    1.54B     2.18M    18.46M  1.20%    24.70   3.38   1.44
Qwen2.5-3B      3.09B     3.69M    29.93M  0.97%    49.37   6.65   2.53
896x896 layer, r= 8:  14,336 params = 1.79% of 802,816
896x896 layer, r=16:  28,672 params = 3.57% of 802,816
896x896 layer, r=64: 114,688 params = 14.29% of 802,816
test n=  500: 85% accuracy +/- 0.031
test n= 1000: 85% accuracy +/- 0.022
test n= 2000: 85% accuracy +/- 0.016
test n= 5000: 85% accuracy +/- 0.010
balanced model says 0.30, true base rate 3.45%: corrected p = 0.0151 vs threshold 0.0741
0.5B full FT: 1.06e+16 FLOP = 212 s at 50 TFLOP/s
0.5B LoRA: 7.08e+15 FLOP = 142 s at 50 TFLOP/s
```

:::chart[Training memory before activations (16 bytes per trainable parameter; adapters on all linear layers, r = 16)]{type="bar" x="model" y="GB" yfmt="dec1" labels="true"}
model, full fine-tune, LoRA r=16, QLoRA r=16
Qwen2.5-0.5B, 7.90, 1.13, 0.60
Qwen2.5-1.5B, 24.70, 3.38, 1.44
Qwen2.5-3B, 49.37, 6.65, 2.53
:::

Reading it:

- **LoRA cuts memory ~7×**, almost all of it optimizer state: full fine-tuning of the 1.5B (24.7 GB) does not fit a 24 GB GPU even before activations; LoRA (3.4 GB) does comfortably.
- **QLoRA helps less on small models.** On the 0.5B, the 136M-parameter embedding stays in bf16 and is 0.27 of the 0.60 GB; QLoRA saves 47% over LoRA here vs 62% on the 3B. It also adds dequantisation compute every step — use it when memory, not time, is the limit.
- **Activations are not in the chart** and often dominate: they scale with batch × sequence length × layers × hidden. Truncate tickets at their p99 length and use gradient checkpointing (≈ one extra forward pass).
- **Compute is small for a router.** 14,000 tickets × 128 tokens × 2 epochs is 3.6M tokens: \(4 \times 0.494 \times 10^9 \times 3.6 \times 10^6\) ≈ \(7.1 \times 10^{15}\) FLOP for LoRA — 142 s at §3's illustrative 50 TFLOP/s. Real runs reach a fraction of that rate, so treat it as a floor: minutes, not days.
- **An encoder needs none of this.** A 66M DistilBERT-size classifier fully fine-tuned is \(66 \times 10^6 \times 16\) ≈ 1.1 GB of training state; LoRA is optional there.

## 7.4 How many labels, and how clean

Measure your own **learning curve**: train on 25%, 50% and 100% of the training split, plot held-out cost per case (or accuracy) against $n$ on a log axis. On the deep course's linear analogue ([§8.5](/c/practical-slm-decision-models/08-fine-tuning-and-adaptation) — synthetic data, not an SLM) clean accuracy rose 15 points from 50 to 500 examples and 1.1 points from 2,000 to 30,000. Two kinds of noise behaved differently:

- **20% random label noise cost data, not the ceiling** — noisy labels at 5,000 matched clean labels at 1,000 (0.777 vs 0.778).
- **Systematic noise set a new ceiling** — with 40% of one queue filed under another, accuracy plateaued at 0.716 and that queue's recall stayed near 0.49 (clean: 0.82) at any $n$. Teacher labels from §6 are systematic by construction.

Splits for the 20,000 tickets, each used for one job only:

| Split | Job | Tickets |
| --- | --- | ---: |
| Train | Gradient updates | 14,000 |
| Validation | Early stopping, hyperparameters, checkpoint | 2,000 |
| Calibration | Fit temperature / isotonic ([§6](/c/slm-decision-models/06-distillation)), check thresholds | 2,000 |
| Test | One final number per release | 2,000 |

At 85% accuracy a 2,000-ticket test set gives ±1.6 points (95%), 1,000 gives ±2.2, 500 gives ±3.1 — smaller sets cannot see most fine-tuning gains. **Split by customer or thread, then by time**: near-duplicate tickets on both sides of a random row split inflate the test score.

## 7.5 Class imbalance: correct the prior, don't reweight blindly

Rebalancing (`class_weight="balanced"`, oversampling) trains the model on a 50% base rate, so its outputs are calibrated for 50%. Apply a cost threshold to them and you flag far too much. If you rebalanced, shift the odds back:

$$
\frac{p'}{1-p'} = \frac{p}{1-p} \times \frac{\pi/(1-\pi)}{0.5/0.5}
$$

:::example[Worked example · a legal-complaint flag at 3.45% base rate]
Illustrative costs: a missed legal ticket ₹5,000, a needless legal review ₹400, so $t = 400/5{,}400 = 0.0741$. The balanced model says $p = 0.30$: flagged. Corrected: odds \(0.4286 \times 0.0357 = 0.0153\), $p' = 0.0151$: not flagged. In the [deep course run](/c/practical-slm-decision-models/08-fine-tuning-and-adaptation) the balanced model with the cost threshold flagged 60.5% of tickets at ₹239.4 per ticket; corrected, 4.1% at ₹30.2; unweighted with no correction, ₹33.4.
:::

With a cost-derived threshold on calibrated probabilities, rebalancing is rarely needed: the threshold already encodes how much the rare class matters. The same goes for cost-weighted losses — they distort probabilities, so if you use one, recalibrate on the calibration split before applying any threshold.

## 7.6 Recipe

1. **Freeze the evaluation first**: test set, cost per ticket at the derived threshold, per-class recall, ECE, and the prompted baseline's numbers on the same set.
2. **Pick the shape**: closed labels → classification head + LoRA on the body; fields or reasons → SFT with prompt-masked loss.
3. **Start with LoRA on all linear layers, $r = 16$, 2 epochs.** Evaluate on validation every few hundred steps; stop on validation loss.
4. **Learning curve at 25/50/100%.** If the last doubling bought < 1 point, stop buying volume: audit confusions, adjudicate the confused pairs, or try a larger base.
5. **Calibrate on the calibration split, apply the cost threshold, score the test set once.**
6. **Ship one artefact**: base revision + adapter + head + calibration + tokenizer + data snapshot id.

Starting points — **typical ranges** from LoRA practice, not tuned values for your task:

| Knob | Typical range | First try | Note |
| --- | --- | --- | --- |
| Rank $r$ | 8–64 | 16 | Raise only if the learning curve says capacity, not data, is the limit |
| $\alpha$ | $r$ to \(2r\) | 32 | Effective scale $\alpha/r$ |
| Target modules | attention only … all linear | all linear | All-linear at $r = 8$ on the 0.5B is 4.40M vs 1.08M attention-only |
| Learning rate | LoRA 1e-4 – 3e-4; full FT 1e-5 – 5e-5 | 2e-4 | LoRA tolerates ~10× higher |
| Epochs | 1–5 | 2 | Small sets memorise quickly |
| Effective batch | 16–128 | 32 | Gradient accumulation to reach it |
| Max length | p99 of ticket tokens | — | Truncation is silent label noise |

```python
from peft import LoraConfig, get_peft_model             # sketch, not run here
from transformers import AutoModelForSequenceClassification

model = AutoModelForSequenceClassification.from_pretrained("Qwen/Qwen2.5-0.5B", num_labels=4)
model.config.pad_token_id = model.config.eos_token_id
model = get_peft_model(model, LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05, task_type="SEQ_CLS",
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
model.print_trainable_parameters()   # adapters (~8.8M by the arithmetic above) + the 4-way head
```

The adapter directory is a few tens of MB (8.80M parameters × 2 bytes ≈ 18 MB in bf16), small enough to version like code:

```text
out/ticket-router-lora-v3/
├── adapter_model.safetensors   # LoRA A, B and the classification head
├── adapter_config.json         # r, alpha, target modules, base model + revision hash
├── calibration.json            # method, parameters, fit split id, ECE before/after
├── eval_report.json            # cost/ticket at threshold, per-class recall, ECE, test n
└── manifest.json               # data snapshot id, tokenizer hash, code commit
```

:::warn[Failure modes]
- **Group leakage.** A 6-point jump after fine-tuning that disappears when you re-split by customer was never real. Check exact and near-duplicate text across splits first.
- **Fine-tuning facts.** Prices and policies in the weights go stale; retrieve them instead.
- **Teacher labels treated as gold.** Their confusions are systematic; measure the teacher's per-class confusion on adjudicated gold before training on them.
- **Shipping without the calibration file.** The threshold is tied to calibrated probabilities; an adapter without its calibration cannot reproduce a decision.
- **Sensitive data in training text.** Fine-tuned weights can reproduce it, and deleting a record later means retraining.
:::

## 7.7 Check yourself

:::qa[LoRA r = 8 on one 2048 × 2048 projection: how many parameters, what fraction?]
\(8 \times (2048 + 2048) = 32{,}768\) of \(4{,}194{,}304\) — \(2r/d = 16/2048 = 0.78\%\).
:::

:::qa[Why does full fine-tuning of Qwen2.5-0.5B need ~7.9 GB before activations when its bf16 weights are under 1 GB?]
16 bytes per trainable parameter (bf16 weight 2 + gradient 2 + fp32 master 4 + Adam moments 8): \(0.494 \times 10^9 \times 16\) = 7.9 GB. LoRA pays the 16 bytes only on 8.8M adapter parameters.
:::

:::qa[Your curve went 0.84 at 4k labels → 0.845 at 8k. The PM asks for 16k more. Answer?]
The last doubling bought half a point; the next will likely buy less. Spend the budget on a confusion audit — adjudicate the most-confused pair — or test a larger base on the same 8k.
:::

:::qa[A rebalanced model outputs 0.5; the true base rate is 2%. Corrected probability?]
Odds \(1 \times 0.02/0.98 = 0.0204\), $p' = 0.020$ — a 0.5 from a balanced model means "base rate".
:::

:::qa[Your test set has 800 tickets and the new adapter is 1.5 points better at ~85% accuracy. Ship?]
Not on that evidence: the 95% half-width at 800 is about \(1.96\sqrt{0.85 \times 0.15/800} = 2.5\) points. Compare both models on the same tickets with a paired test, or grow the test set to ≥ 2,000.
:::

Next: [Prompt engineering](/c/slm-decision-models/08-prompt-engineering) — when you are not training, the prompt is the interface, and it must still produce a calibrated probability.
