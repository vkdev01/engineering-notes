---
section: "12"
title: "Chapter 10 \u2014 Advancements"
kicker: "Chapter notes"
abstract: "Chapter 10 has no code in the repository, so this page supplies the arithmetic: multi-LoRA memory for Gemma 3 12B, a semantic-cache threshold chosen from costs, a per-request latency waterfall, and what an image costs in tokens, KV and prefill."
time: "26 min"
order: 12
outcomes:
  - "Compute the size of a LoRA adapter for Gemma 3 12B at any rank and how many fit beside the base model"
  - "Choose a semantic-cache similarity threshold from the cost of a wrong answer, not by eye"
  - "Decompose TTFT into queue wait and prefill from four timestamps and explain a p99 regression"
  - "Size the KV and prefill cost of image inputs at 256 tokens per image"
---
A team serving the HelpDesk assistant on Gemma 3 12B gets four requests in one quarter: serve twelve customer-specific fine-tunes, add a cache for repeated questions, explain why p99 TTFT doubled last Tuesday, and accept screenshots. Chapter 10 of the book surveys exactly these directions — multi-LoRA serving, semantic caching, profiling, multimodal — plus edge AI and serving for reinforcement learning. The repository has no `ch10/` directory, so this page does what the code would have done: put numbers on each one.

:::key[First principle]
Each advancement moves a cost somewhere else. LoRA trades full model copies for small resident deltas; a semantic cache trades GPU time for the risk of a wrong answer; profiling trades a few timestamps for an explanation; images trade a picture for hundreds of tokens. Compute the trade before adopting the feature.
:::

## 12.1 What exists, and what is next to it

| Chapter 10 direction | Nearest thing in the repository | The gap |
| --- | --- | --- |
| Semantic caching | `ch07/LMCache.ipynb` caches KV blocks by prefix | Semantic caching matches by *meaning*, which is a different index and a different correctness risk |
| Performance profiling | `vllm bench serve` output, `--disable-log-requests` and `vllm.log` | Aggregate and per-request metrics exist; end-to-end traces do not |
| Multimodal serving | `ch03/multi_model_serving/` serves an image model (`TorchVisionWorker`, DenseNet via Triton) | Single-image classification, not a multimodal LLM with vision tokens in the KV cache |
| Edge AI | `ch08/llamaCpp.ipynb` runs a GGUF locally | No power, thermal or cold-start measurement |
| Multi-LoRA serving | Nothing | This is the real gap: the repository never serves two adapters over one base model |
| Serving for RL | Nothing | Generation as a rollout, with throughput and determinism as the metrics |

Every number below is computed from the Gemma 3 config, a spec sheet, or a labelled assumption. None is a measurement; the scripts are there so you can swap in yours.

## 12.2 Multi-LoRA: one base, many deltas

Twelve customers each want their own fine-tune of Gemma 3 12B. Merged, that is twelve 23.53 GB checkpoints — and two copies (47.06 GB) don't fit on one L40S, so it is twelve GPUs before a single request arrives. LoRA keeps the base frozen and learns a low-rank update for selected matrices:

$$
W' = W + B A, \qquad A \in \mathbb{R}^{r \times d_{\text{in}}},\; B \in \mathbb{R}^{d_{\text{out}} \times r},
\qquad \text{params} = r \sum_{\text{layers}} \sum_{\text{targets}} (d_{\text{in}} + d_{\text{out}}).
$$

For Gemma 3 12B with all seven projections targeted (q, k, v, o, gate, up, down) the inner sum is the same in every layer, so the adapter is a fixed number of parameters per unit of rank. A server keeps one base resident and applies $BA$ per request: the extra compute is \(2 r (d_{\text{in}} + d_{\text{out}})\) FLOPs per matrix per token, and — because decode is bandwidth-bound — the real cost is the adapter bytes each step must read.

```python run
"""LoRA adapters for Gemma 3 12B: size, residency and per-step cost (first principles)."""
L, HID, FF = 48, 3840, 15360                    # Gemma 3 12B layers, hidden, FFN width
Q, KV = 16 * 256, 8 * 256                       # query and key/value projection widths
TARGETS = {"q": (HID, Q), "k": (HID, KV), "v": (HID, KV), "o": (Q, HID),
           "gate": (HID, FF), "up": (HID, FF), "down": (FF, HID)}
BASE, KV_TOK, SEQ = 23.53e9, 393_216, 1280      # bf16 weights, KV B/token, HelpDesk tokens
POOL = 16.58 * 2**30                            # bf16 KV pool on one L40S (section 11.2)
BW, DISK, H2D = 864e9, 2e9, 25e9                # L40S spec; disk and host-to-GPU illustrative
STEP = 35.6e-3                                  # bf16 decode step at C=16 (section 2.3)

per_rank = L * sum(i + o for i, o in TARGETS.values())   # A: d_in x r, B: r x d_out
attn = L * sum(TARGETS[k][0] + TARGETS[k][1] for k in ("q", "k", "v", "o"))
print(f"params per unit rank: {per_rank:,} (attention projections only: {attn:,})")
print("rank, params M, MB bf16, adapters = base, = KV tokens, cold load ms, read ms/step")
for r in (8, 16, 32, 64):
    b = 2 * r * per_rank
    print(f"{r}, {r * per_rank / 1e6:.1f}, {b / 1e6:.0f}, {BASE / b:.0f}, "
          f"{b / KV_TOK:,.0f}, {(b / DISK + b / H2D) * 1e3:.0f}, {b / BW * 1e3:.3f}")

a16 = 2 * 16 * per_rank
print(f"\nr=16 compute: {2 * 16 * per_rank / 1e6:.0f} MFLOP/token = "
      f"{2 * 16 * per_rank / 21.5e9:.2%} of the base 21.5 GFLOP")
for n in (0, 12, 32):
    seqs = int((POOL - n * a16) // (SEQ * KV_TOK))
    print(f"{n:2d} resident r=16 adapters: {n * a16 / 1e9:.2f} GB -> {seqs} HelpDesk sequences fit")
for k in (1, 4, 12):
    print(f"{k:2d} distinct adapters in one batch: +{k * a16 / BW * 1e3:.2f} ms per "
          f"{STEP * 1e3:.1f} ms step ({k * a16 / BW / STEP:.1%})")
```

```output
params per unit rank: 4,091,904 (attention projections only: 1,327,104)
rank, params M, MB bf16, adapters = base, = KV tokens, cold load ms, read ms/step
8, 32.7, 65, 359, 166, 35, 0.076
16, 65.5, 131, 180, 333, 71, 0.152
32, 130.9, 262, 90, 666, 141, 0.303
64, 261.9, 524, 45, 1,332, 283, 0.606

r=16 compute: 131 MFLOP/token = 0.61% of the base 21.5 GFLOP
 0 resident r=16 adapters: 0.00 GB -> 35 HelpDesk sequences fit
12 resident r=16 adapters: 1.57 GB -> 32 HelpDesk sequences fit
32 resident r=16 adapters: 4.19 GB -> 27 HelpDesk sequences fit
 1 distinct adapters in one batch: +0.15 ms per 35.6 ms step (0.4%)
 4 distinct adapters in one batch: +0.61 ms per 35.6 ms step (1.7%)
12 distinct adapters in one batch: +1.82 ms per 35.6 ms step (5.1%)
```

:::chart[GPU memory for N fine-tunes of Gemma 3 12B: merged copies vs one base plus rank-16 adapters]{type="line" x="fine-tunes N" y="weights" unit=" GB" xlog="true" ylog="true" points="true" hmarks="43.5:usable on one L40S" note="N × 23.53 GB vs 23.53 GB + N × 131 MB, bf16. Usable = 0.90 × 46,068 MiB. KV pool not included."}
N, merged copies, base + LoRA r=16
1, 23.5, 23.66
2, 47.1, 23.79
4, 94.1, 24.05
8, 188.2, 24.58
12, 282.4, 25.10
16, 376.5, 25.63
32, 753.0, 27.72
64, 1505.9, 31.91
:::

:::example[Worked example · twelve customers on one L40S]
- **Size.** At rank 16 an adapter is 65.5 M parameters, 131 MB in bf16 — \(1/180\) of the base. Twelve of them are 1.57 GB.
- **What they displace.** 1.57 GB is about 4,000 tokens of KV at 384 KiB each: the bf16 pool drops from 35 to 32 HelpDesk sequences. Merged, the same twelve tenants need 282 GB — twelve L40S.
- **Compute is noise; bytes are not.** Rank 16 adds 0.61% to the FLOPs per token. But a decode step reads each *distinct* adapter in the batch once: 0.15 ms per adapter, so a batch mixing all twelve tenants pays 1.82 ms on a 35.6 ms step (5.1%) — before real kernel inefficiency, which makes it larger.
- **Cold adapters cost TTFT.** Loading 131 MB at an illustrative 2 GB/s from disk plus 25 GB/s host-to-GPU is 71 ms, paid by the first request to that adapter. Keep the hot set resident.
:::

In vLLM this is a handful of flags; requests pick an adapter by putting its name in the `model` field:

```bash
vllm serve google/gemma-3-12b-it --enable-lora \
    --lora-modules acme=/adapters/acme globex=/adapters/globex \
    --max-loras 4 --max-lora-rank 16 --max-cpu-loras 12
```

`--max-loras` is how many distinct adapters one batch may contain (GPU slots sized at `--max-lora-rank`); `--max-cpu-loras` is how many stay cached in host memory. With twelve tenants and four slots, requests for a fifth adapter wait for a slot — a queueing delay that shows up in TTFT, not in any memory number.

**Rules.** Many fine-tunes of one base, each with little traffic: multi-LoRA on one replica, as long as adapter bytes stay small against the KV pool (1.57 GB of 16.58 GiB here). A fine-tune with enough traffic to fill a GPU on its own (≥ 2.7 req/s bf16, §11.5): merge it and give it a replica, which removes the per-step adapter read. Tenants mixed in every batch: set `--max-loras` to the hot-set size and budget about 0.15 ms per distinct adapter per step. Fine-tunes of *different* bases are not LoRA's problem — that is the residency cache of §14.

:::warn[Failure modes]
- **Adapter trained on another base revision or precision.** An adapter trained against bf16 weights and served on an int4 base is a different model; re-run its evaluation (§8.7).
- **Rank above `--max-lora-rank`** is rejected at load time; size the slot for the largest adapter you accept.
- **Too few slots** turn tenant mix into queue wait: a p99 TTFT problem that looks like load.
:::

## 12.3 Semantic caching: a threshold is a price

A prefix cache (§8.6) is exact: identical tokens give identical KV, so it can never return a wrong answer. A semantic cache embeds the question, finds the nearest cached question, and if the cosine similarity $s$ exceeds a threshold $\tau$ it returns the cached *answer* without running the model. It can be wrong: *"reset my password"* and *"reset my 2FA device"* are close in embedding space and need different answers.

Price both outcomes. A miss costs one generation, $C_{\text{serve}}$ — 0.28 USD per 1,000 requests for the bf16 prefix-cached deployment of §11.8. A hit costs nothing if the cached answer is right and $C_{\text{wrong}}$ if it is not (a support escalation, a refund, a lost user — 0.05 USD here, illustrative). Serving a hit at similarity $s$ is worth it when its expected cost is below a miss:

$$
\bigl(1 - p(s)\bigr)\,C_{\text{wrong}} < C_{\text{serve}}
\iff
p(s) = P(\text{right} \mid s) > 1 - \frac{C_{\text{serve}}}{C_{\text{wrong}}},
\qquad
\mathbb{E}[\text{cost}](\tau) = P(s < \tau)\,C_{\text{serve}} + P(s \ge \tau,\ \text{wrong})\,C_{\text{wrong}}.
$$

With these prices the break-even is \(1 - 0.00028/0.05\) = 0.9944: a hit must be right more than 99.4% of the time. The threshold is wherever $p(s)$ crosses that line, which depends on how similar *wrong* neighbours look. Simulate it with three kinds of traffic — true duplicates, near-misses, novel questions — whose similarity distributions you would estimate from a few hundred labelled log pairs:

```python run
"""Semantic-cache threshold from costs, on SIMULATED similarity scores (all inputs illustrative)."""
import numpy as np

rng = np.random.default_rng(10)
N = 200_000
# Similarity of each request to its nearest cached question: share, mean, sd per kind
KINDS = {"duplicate": (0.30, 0.95, 0.025),     # same intent: the cached answer is right
         "near-miss": (0.15, 0.87, 0.025),     # similar wording, different answer
         "novel": (0.55, 0.70, 0.08)}          # nothing close in the cache
kind = rng.choice(3, size=N, p=[v[0] for v in KINDS.values()])
mu, sd = (np.array([v[i] for v in KINDS.values()]) for i in (1, 2))
sim = np.minimum(rng.normal(mu[kind], sd[kind]), 1.0)  # cosine similarity <= 1
right = kind == 0
C_SERVE = 0.28 / 1000                          # USD per generated answer (section 11.8)

pdf = lambda s, m, d: np.exp(-0.5 * ((s - m) / d) ** 2) / (d * np.sqrt(2 * np.pi))


def cost(tau, c_wrong):
    """Expected USD per request: misses are generated, wrong hits cost c_wrong."""
    hit = sim >= tau
    return (~hit).mean() * C_SERVE + (hit & ~right).mean() * c_wrong, hit


TAUS = np.round(np.arange(0.85, 0.996, 0.001), 3)
C_WRONG = 0.05                                 # USD per wrong answer served (illustrative)
print(f"tau, hit %, wrong per 10k, USD per 10k (no cache: {C_SERVE * 1e4:.2f})")
for tau in TAUS[::20]:
    c, hit = cost(tau, C_WRONG)
    print(f"{tau:.2f}, {hit.mean() * 100:.1f}, {(hit & ~right).mean() * 1e4:.1f}, {c * 1e4:.3f}")

grid = np.linspace(0.80, 1.0, 2001)
dens = np.array([w * pdf(grid, m, d) for w, m, d in KINDS.values()])
post = dens[0] / dens.sum(0)                   # P(right | similarity)
print("\nc_wrong USD, break-even P(right), tau analytic, tau simulated, hit, wrong per 10k, "
      "saving %")
for cw in (0.0028, 0.01, 0.05, 0.5):
    q = 1 - C_SERVE / cw                       # serve a hit only if P(right) > q
    t_an = f"{grid[np.argmax(post >= q)]:.3f}" if (post >= q).any() else "none"
    costs = [cost(t, cw)[0] for t in TAUS]
    t_sim = TAUS[int(np.argmin(costs))]
    c, hit = cost(t_sim, cw)
    if c >= C_SERVE:                           # no threshold beats switching the cache off
        print(f"{cw}, {q:.4f}, {t_an}, off, 0.0%, 0.0, 0.0%")
        continue
    print(f"{cw}, {q:.4f}, {t_an}, {t_sim:.3f}, {hit.mean():.1%}, "
          f"{(hit & ~right).mean() * 1e4:.1f}, {1 - c / C_SERVE:.1%}")
```

```output
tau, hit %, wrong per 10k, USD per 10k (no cache: 2.80)
0.85, 43.5, 1351.5, 69.156
0.87, 38.5, 846.8, 44.060
0.89, 33.4, 366.4, 20.184
0.91, 29.4, 104.1, 7.183
0.93, 23.9, 23.3, 3.295
0.95, 15.1, 6.2, 2.689
0.97, 6.4, 1.6, 2.702
0.99, 1.7, 0.6, 2.785

c_wrong USD, break-even P(right), tau analytic, tau simulated, hit, wrong per 10k, saving %
0.0028, 0.9000, 0.923, 0.924, 25.9%, 36.6, 22.2%
0.01, 0.9720, 0.935, 0.934, 22.4%, 17.4, 16.1%
0.05, 0.9944, 0.954, 0.958, 11.3%, 3.5, 5.1%
0.5, 0.9994, none, off, 0.0%, 0.0, 0.0%
```

:::chart[Simulated similarity to the nearest cached question, weighted by traffic share (ILLUSTRATIVE)]{type="line" x="cosine similarity" y="density × share" yfmt="dec1" marks="0.954:threshold at USD 0.05 per wrong answer" note="Normal densities of the KINDS above, times their share. Near-misses overlap duplicates between 0.88 and 0.92; the threshold must sit above that overlap."}
similarity, duplicate, near-miss, novel
0.78, 0.00, 0.00, 1.66
0.80, 0.00, 0.05, 1.26
0.82, 0.00, 0.32, 0.89
0.84, 0.00, 1.17, 0.59
0.86, 0.01, 2.21, 0.37
0.88, 0.09, 2.21, 0.22
0.90, 0.65, 1.17, 0.12
0.92, 2.33, 0.32, 0.06
0.94, 4.42, 0.05, 0.03
0.96, 4.42, 0.00, 0.01
0.98, 2.33, 0.00, 0.01
:::

:::chart[Expected cost per 10,000 requests vs threshold, wrong answer = 0.05 USD (ILLUSTRATIVE)]{type="line" x="threshold τ" y="USD per 10k requests" ylog="true" points="true" hmarks="2.8:no cache" note="Below about τ = 0.94 the cache costs more than it saves; the minimum is shallow."}
tau, expected cost
0.85, 69.156
0.87, 44.060
0.89, 20.184
0.91, 7.183
0.93, 3.295
0.95, 2.689
0.97, 2.702
0.99, 2.785
:::

:::example[Worked example · what the threshold buys]
- **The analytic and simulated thresholds agree**: 0.954 from the break-even rule, 0.958 from minimising simulated cost. At that point 11.3% of requests hit, 3.5 per 10,000 get a wrong answer, and generation cost falls 5.1%.
- **An eyeballed 0.89 is a disaster.** It hits 33.4% of traffic — it looks great on a dashboard — and serves 366 wrong answers per 10,000, costing 20.18 USD per 10k against 2.80 without a cache.
- **The threshold is a function of the price.** If a wrong answer costs no more than 10 generations (0.0028 USD), τ drops to 0.92 and the cache saves 22%. At 0.50 USD per wrong answer no threshold pays: the right setting is *off*.
- **On cost alone, a cache in front of a cheap model is marginal.** Its stronger case is latency — a hit returns in milliseconds instead of an 11 s answer — or a model whose generation is much more expensive than this one.
:::

:::warn[Failure modes]
- **Thresholds don't transfer.** τ is a property of *your* embedding model and *your* traffic. Change either and the distributions move; re-label a sample and recompute.
- **Stale or cross-tenant answers.** Key the cache by tenant, adapter, model version and system-prompt hash; expire answers that depend on changing data (order status, prices).
- **Unaudited hits.** Log every hit with its similarity and the cached question; sample them weekly. Wrong hits are silent — no error, no latency spike.
:::

## 12.4 Profiling: the TTFT waterfall

Last Tuesday p99 TTFT on the HelpDesk fleet went from 163 ms to 429 ms. `vllm bench serve` and a dashboard tell you *that* it moved. To know *why*, split it. Four timestamps per request are enough — arrival $a$, scheduled $s$, first token $f$, last token $e$:

$$
\text{TTFT} = \underbrace{(s - a)}_{\text{queue}} + \underbrace{(f - s)}_{\text{prefill}},
\qquad
\text{E2E} = \text{TTFT} + \underbrace{(e - f)}_{\text{decode}}.
$$

Each segment has different causes. Queue wait is capacity: no free slot or KV room. Prefill is prompt length and prefix-cache hit rate. Decode is batch size and output length. One trap: percentiles don't add — p99 TTFT is not p99 queue plus p99 prefill. Decompose the requests that *are* at the p99, as below, on a synthetic log shaped like HelpDesk at 10 req/s with the shared prefix cached:

```python run
"""TTFT waterfall from four timestamps per request, on a SYNTHETIC log (illustrative)."""
import numpy as np

rng = np.random.default_rng(12)
PF_MS_PER_TOK = 21.5e9 / (362e12 * 0.5) * 1e3   # Gemma 3 12B prefill, MFU 0.5 illustrative


def log(n, queue_mean_ms):
    """Arrival, scheduled, first token, last token for n requests, in ms."""
    arrive = np.cumsum(rng.exponential(100, n))                 # 10 req/s
    sched = arrive + rng.exponential(queue_mean_ms, n)          # waits for a free slot
    new_tok = rng.lognormal(np.log(256), 0.4, n)                # uncached prompt tokens
    first = sched + new_tok * PF_MS_PER_TOK + rng.normal(30, 5, n).clip(10)
    done = first + 255 * rng.normal(45, 3, n)                   # 255 more tokens
    return arrive, sched, first, done


print("period, pct, queue ms, prefill ms, TTFT ms, decode s")
for name, qmean in (("normal", 20), ("incident", 80)):
    a, s, f, d = log(50_000, qmean)
    queue, prefill, ttft, decode = s - a, f - s, f - a, d - f
    for pct in (50, 99):
        cut = np.percentile(ttft, pct)
        near = np.abs(ttft - cut) <= 0.01 * cut                # requests at that percentile
        print(f"{name}, p{pct}, {queue[near].mean():.0f}, {prefill[near].mean():.0f}, "
              f"{cut:.0f}, {decode[near].mean() / 1e3:.1f}")
```

```output
period, pct, queue ms, prefill ms, TTFT ms, decode s
normal, p50, 15, 63, 78, 11.5
normal, p99, 78, 85, 163, 11.4
incident, p50, 55, 65, 120, 11.5
incident, p99, 362, 67, 429, 11.2
```

:::chart[TTFT waterfall at p50 and p99, before and during the incident (SYNTHETIC)]{type="bar" stacked="true" x="requests at percentile" y="TTFT" unit=" ms" hmarks="500:p99 TTFT SLO" note="Synthetic log; mean queue wait 20 ms normally, 80 ms during the incident."}
requests, queue wait, prefill + first step
normal p50, 15, 63
normal p99, 78, 85
incident p50, 55, 65
incident p99, 362, 67
:::

The p99 request went from 78 ms of queue and 85 ms of prefill to 362 ms of queue and 67 ms of prefill. Prefill didn't move, so prompts and the prefix cache are not the story; decode didn't move either. **The regression is queue wait — a capacity problem.** That is what queueing theory predicts for a small change in load: in an M/M/1-style queue mean wait scales as \(u/(1-u)\), so utilisation going from 0.75 to 0.94 — one replica of five lost at peak — multiplies wait by \((0.94/0.06)/(0.75/0.25)\) ≈ 5.2.

| Segment that moved | Likely cause | First fix |
| --- | --- | --- |
| Queue wait | Fewer replicas, more traffic, KV pool full, too few LoRA slots | Add capacity or admission control; check replica count and KV usage |
| Prefill | Longer prompts, prefix-cache hit rate dropped, images added | Check prompt-length histogram and cache hit rate |
| Decode (TPOT) | Larger batches, longer contexts, prefill interference | Lower `--max-num-seqs`, enable chunked prefill, add replicas |

Where the timestamps come from: log them in your API layer (the single-model service of [§13](/c/llm-serving/13-single-model-service) has one obvious place), or read the per-phase latency histograms that recent vLLM versions export on `/metrics` — check which names your version exposes. The repository's benchmark output has TTFT percentiles but no per-request segments; that is the gap.

## 12.5 Multimodal: an image is 256 tokens and two prefills

The multi-model service serves an image *classifier*: a different input type, the same request shape. A multimodal LLM changes the arithmetic. Gemma 3 12B and 27B pass an 896×896 image through a SigLIP vision tower (about 0.42B parameters, 14-pixel patches, so 4,096 patches), pool the result to `mm_tokens_per_image` = 256 soft tokens, and splice them into the prompt. From there an image is just 256 more prompt tokens — they take KV like any other token and cost a full prefill each — plus the encoder's own compute:

$$
\text{KV}_{\text{image}} = 256 \times 384\ \text{KiB} = 96\ \text{MiB},
\qquad
t_{\text{image}} = \frac{F_{\text{SigLIP}} + 256 \cdot 21.5\ \text{GFLOP}}{P \cdot \text{MFU}}.
$$

```python run
"""What an image costs Gemma 3 12B on one L40S (first principles; MFU illustrative)."""
PEAK, MFU = 362e12, 0.5                          # L40S bf16 spec; MFU illustrative
F_TOK, KV_TOK = 21.5e9, 393_216                  # Gemma 3 12B FLOPs and KV bytes per token
POOL = 16.58 * 2**30                             # bf16 KV pool (section 11.2)
IMG_TOK = 256                                    # mm_tokens_per_image
# SigLIP tower: 27 layers, width 1152, MLP 4304; 896 px / 14 px patches = 4,096 patches
SL, SW, SF, PATCH = 27, 1152, 4304, (896 // 14) ** 2
vit = 2 * SL * (4 * SW * SW + 2 * SW * SF) * PATCH + SL * 4 * PATCH**2 * SW
vit_ms = vit / (PEAK * MFU) * 1e3
llm_ms = IMG_TOK * F_TOK / (PEAK * MFU) * 1e3
text_ms = 256 * F_TOK / (PEAK * MFU) * 1e3       # new text tokens, shared prefix cached
print(f"per image: {IMG_TOK} tokens, KV {IMG_TOK * KV_TOK / 2**20:.0f} MiB (upper bound)")
print(f"  vision encoder {vit / 1e12:.2f} TFLOP = {vit_ms:.0f} ms, "
      f"LLM prefill of image tokens {IMG_TOK * F_TOK / 1e12:.2f} TFLOP = {llm_ms:.0f} ms")
print("images, tokens/seq, KV MiB/seq, extra prefill ms, seqs in bf16 pool, prefill cap req/s")
for n in (0, 1, 2, 4, 8):
    tok = 1024 + n * IMG_TOK + 256               # HelpDesk prompt + images + output
    pf = text_ms + n * (vit_ms + llm_ms)
    print(f"{n}, {tok}, {tok * KV_TOK / 2**20:.0f}, {n * (vit_ms + llm_ms):.0f}, "
          f"{int(POOL // (tok * KV_TOK))}, {1e3 / pf:.1f}")
```

```output
per image: 256 tokens, KV 96 MiB (upper bound)
  vision encoder 5.45 TFLOP = 30 ms, LLM prefill of image tokens 5.50 TFLOP = 30 ms
images, tokens/seq, KV MiB/seq, extra prefill ms, seqs in bf16 pool, prefill cap req/s
0, 1280, 480, 0, 35, 32.9
1, 1536, 576, 61, 29, 11.0
2, 1792, 672, 121, 25, 6.6
4, 2304, 864, 242, 19, 3.7
8, 3328, 1248, 484, 13, 1.9
```

:::chart[Gemma 3 12B bf16 on one L40S: capacity vs images per HelpDesk request (first principles)]{type="bar" x="images per request" y="value" labels="true" note="Sequences: KV upper bound, 16.58 GiB pool. Prefill cap: GPU fully busy prefilling, MFU 0.5 illustrative, shared text prefix cached."}
images, sequences in KV pool, prefill cap req/s
0, 35, 32.9
1, 29, 11.0
2, 25, 6.6
4, 19, 3.7
8, 13, 1.9
:::

:::example[Worked example · HelpDesk accepts one screenshot per ticket]
- **KV grows by a step, not a slope.** Each image adds 96 MiB to the sequence: 480 → 576 MiB, and the bf16 pool holds 29 sequences instead of 35.
- **Prefill triples.** With the shared prefix cached a text request prefills 256 tokens (30 ms). One image adds 30 ms in the encoder and 30 ms prefilling its 256 tokens: 91 ms. The prefill ceiling of a replica falls from 32.9 to 11.0 req/s.
- **The fleet changes.** At the 10 req/s peak, image prefill alone keeps \(10/11.0\) = 91% of one GPU busy. The §11.8 plan, sized on text, is now short of capacity — and the prefix cache can't help, because every screenshot is unique.
- **The token count is not fixed.** Engines that split large or non-square images into crops (Gemma 3's pan-and-scan) add 256 tokens per crop. Read the prompt-token count the server reports, not the image count.
:::

## 12.6 Edge AI: the same arithmetic on a smaller budget

Chapter 8's `llamaCpp.ipynb` runs a GGUF model on a local machine. On a laptop or phone the budget is the same three numbers — weight bytes, bandwidth, memory — with smaller values. Decode floor is still bytes ÷ bandwidth. With an illustrative 100 GB/s (laptop unified memory) and 50 GB/s (phone):

| Model | Weights | Floor at 100 GB/s | Floor at 50 GB/s |
| --- | ---: | ---: | ---: |
| Gemma 3 1B int4 | 0.97 GB | 9.7 ms (≈103 tok/s) | 19.4 ms (≈52 tok/s) |
| Gemma 3 1B bf16 | 2.00 GB | 20.0 ms (50 tok/s) | 40.0 ms (25 tok/s) |
| Gemma 3 12B int4 | 7.73 GB | 77.3 ms (≈13 tok/s) | 154.6 ms (≈6 tok/s) |

The 1B's KV is small — 26 KiB/token, 32.5 MiB for a 1,280-token conversation — so on-device the weights are the whole problem. Prefill is compute: 1,024 tokens × 1.4 GFLOP = 1.43 TFLOP, about 287 ms at an illustrative 5 TFLOPS of effective on-device compute. What the arithmetic doesn't give you, and the notebook doesn't measure: sustained clocks under thermal throttling, energy per answer, and cold start (load bytes ÷ storage bandwidth, about 1 s for the 1B int4 at an illustrative 1 GB/s). Google publishes QAT int4 Gemma 3 checkpoints and the Gemma 3n family for on-device use; start there.

**Rule:** edge when privacy, offline use or network latency dominate, with a 1B-class model on phones; a 12B-class model is laptop-only and slower than a shared L40S at batch 1 (27.2 ms bf16, 8.9 ms int4).

## 12.7 Serving for RL: rollouts are a throughput job

In reinforcement learning on a language model, the policy generates *rollouts* — many sampled answers per prompt — the trainer scores them and updates the weights, and the new weights go back to the generator. Generation is batch inference with no user waiting: TTFT is irrelevant, throughput and the slowest rollout are everything.

:::example[Worked example · one RL step on Gemma 3 12B]
- **Rollout volume.** 512 prompts × 8 samples × 512 output tokens = 2,097,152 tokens per step. At the ~538 output tok/s the §2.3 model gives bf16 at $C = 32$ on one L40S (HelpDesk-shaped, illustrative), that is 3,898 s — 65 minutes per GPU per step.
- **Weight sync is cheap by comparison.** Moving 23.53 GB of new weights takes 0.08 s over NVLink (300 GB/s), 0.74 s over PCIe (32 GB/s), 1.9 s over a 100 Gb/s network. Generation dominates by three orders of magnitude.
- **The straggler sets the step.** With output lengths roughly geometric around 512, the longest of 4,096 rollouts is about \(512 \times (\ln 4096 + 0.577)\) ≈ 4,554 tokens. The batch empties while it finishes, at near batch-1 speed (28 ms/token): minutes of an almost idle GPU every step. Cap the length, or start the next step's rollouts while stragglers finish.
:::

Two serving problems are specific to RL. **Weight updates without restarts**: the engine must accept new weights in place, since an 11.8 s reload from NVMe (§14) every step adds up. **Numerical mismatch**: token log-probabilities computed by the inference engine (batched, possibly different kernels) differ slightly from the trainer's, so trainers recompute them or correct for the gap. Neither has code in the repository.

## 12.8 What to adopt first

| Direction | Adopt when | The number that decides |
| --- | --- | --- |
| Multi-LoRA | ≥ 2 fine-tunes of one base, each below one GPU of traffic | 131 MB per r=16 adapter vs 23.53 GB per merged copy |
| Semantic cache | Duplicate-heavy traffic and a wrong answer costs at most a few hundred generations (simulated: 179× still saves 5%, 1,786× saves nothing) | Break-even \(P(\text{right}) = 1 - C_{\text{serve}}/C_{\text{wrong}}\) |
| Per-request profiling | Always — before any p99 incident | Queue vs prefill vs decode at the percentile |
| Image inputs | The product needs them; re-size the fleet first | +96 MiB KV and +61 ms prefill per image |
| Edge | Privacy, offline, or network latency | Weight bytes ÷ device bandwidth |
| RL serving | You train with rollouts | Rollout tokens ÷ throughput, plus the longest rollout |

## 12.9 Check yourself

:::qa[How large is a rank-32 LoRA adapter for Gemma 3 12B on all seven projections, and what does it displace?]
\(32 \times 4{,}091{,}904\) = 130.9 M parameters, 262 MB in bf16 — \(1/90\) of the base. In KV terms that is 666 tokens at 384 KiB each, about half a HelpDesk sequence. Twelve of them (3.1 GB) would cut the bf16 pool from 35 to about 29 sequences.
:::

:::qa[A wrong cached answer costs 0.01 USD and a generation 0.00028 USD. What must P(right | s) exceed at the threshold?]
\(1 - 0.00028/0.01\) = 0.972. In the simulated traffic that puts τ at 0.935 and the cache saves 16.1% of generation cost with 17.4 wrong answers per 10,000. If wrong answers cost 0.50 USD, the break-even is 0.9994 and no threshold pays.
:::

:::qa[p99 TTFT doubled; at the p99, queue wait rose from 78 to 362 ms and prefill fell from 85 to 67 ms. What do you check first?]
Capacity, not prompts: replica count and health, request rate, KV-pool usage (preemptions), and LoRA slot contention. Prefill unchanged rules out longer prompts and a prefix-cache regression.
:::

:::qa[Each HelpDesk ticket now carries two screenshots. How many L40S replicas does the 10 req/s peak need on prefill alone?]
One replica's prefill ceiling with two images is 6.6 req/s (30 ms text + 2 × 61 ms images), so \(10/6.6\) = 1.5 GPUs of pure prefill — at least 2 replicas before any decode time, and the KV pool holds 25 sequences each instead of 35. Re-run the §11.5 model with 1,792-token sequences.
:::

:::qa[Why does an RL rollout step care about the longest output when a chat server cares about p99 TTFT?]
The trainer can't update until every rollout in the step is scored, so the step ends with the slowest one — about 4,554 tokens for 4,096 geometric-length rollouts with mean 512, decoded at near batch-1 speed while the GPU idles. No user is waiting on the first token, so TTFT doesn't matter.
:::

Next: [The single-model service, file by file](/c/llm-serving/13-single-model-service).
