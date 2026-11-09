---
section: "4"
title: "Chapter 2 \u2014 LLM serving"
kicker: "Chapter notes"
abstract: "How one token is generated, in numbers: Gemma 3 12B's parameters and FLOPs from its config, the KV bytes attention leaves behind, why on an L40S the first token costs 121.7 ms and each later one 27.7 ms, what generating without a KV cache costs, why batching is nearly free in decode, and what streaming hides. Plus what each of the five ch02 notebooks makes visible."
time: "22 min"
order: 4
outcomes:
  - "Count a decoder's parameters, FLOPs and KV bytes per token from its config.json"
  - "Predict time to first token and time per output token from FLOPs, bytes and two GPU spec numbers"
  - "Quantify what the KV cache saves, and explain why the time saved is far smaller than the FLOPs saved"
  - "Compute how batching multiplies decode throughput and what it costs each request"
  - "Place streaming in the request path and say which latency it hides"
---
HelpDesk (the course's illustrative workload) sends Gemma 3 12B a 1,024-token prompt and wants 256 tokens back. Before any scheduler, cache manager or framework enters the picture, what does the GPU actually do to produce one of those tokens, and how long should it take? Chapter 2 opens the transformer and the generation loop. This page derives the cost of each step from the model's `config.json` and two numbers on the L40S spec sheet, so the timing charts the ch02 notebooks draw become predictions you can check.

**Covers:** inside the transformer, autoregressive generation, decoder-only architecture, attention, the KV cache, prefill and decode, and running a model with vLLM.

:::key[First principle]
A decoder produces one token per forward pass, and every pass reads every weight from memory. The first pass pushes the whole prompt through at once and is limited by compute; every later pass pushes one token through, reuses the keys and values cached from earlier tokens, and is limited by memory bandwidth. Almost everything in LLM serving follows from that asymmetry.
:::

## 4.1 What is in the repository

Five notebooks in `ch02/`, plus a standalone `streaming.py`:

| Notebook | What it does |
| --- | --- |
| `ch2_Inside_the_Mind_of_a_Transformer.ipynb` | Loads a small open-weight model, prints `model.config`, computes the memory footprint with an explicit function, walks the architecture and the attention layer, and visualises attention with `bertviz` |
| `ch2_Workthrough_LLM_execution.ipynb` | Runs generation with a plain Transformers pipeline, then re-implements it step by step to time each token, plot the per-token latency, and show how context length affects generation |
| `ch2_Run_LLM_With_vLLM.ipynb` | Runs the same model through vLLM, then through plain Transformers, and prints the latency difference |
| `ch2_Batching.ipynb` | Sends a batch of prompts through vLLM and times it against one-at-a-time |
| `ch2_Streaming.ipynb` | Async streaming with `AsyncEngineArgs`; the notebook says to run `streaming.py` for the real thing because of the Jupyter event loop |

The notebooks use a different open-weight model; this guide re-derives the numbers on Gemma 3 so they stay consistent with the rest of the course.

Run `ch2_Workthrough_LLM_execution.ipynb` first: it is the chapter in executable form. Its per-token latency plot shows one tall bar and then a flat line, and §4.5 predicts both heights from first principles. `ch2_Inside_the_Mind_of_a_Transformer.ipynb` comes at the same model from the other side — its memory function is §4.3 and §4.4 in code; point it at a Gemma 3 config and it should reproduce the numbers below.

## 4.2 One token, end to end

Gemma 3 is a decoder-only transformer. Generation is a loop: run the whole sequence so far through the model, take the probability distribution over the next token, sample one, append it, repeat until an end-of-sequence token or `max_tokens`. Formally the model factorises

$$
p(x_1, \dots, x_T) = \prod_{t=1}^{T} p(x_t \mid x_1, \dots, x_{t-1}),
$$

and one forward pass evaluates one factor for every position it is given.

:::mermaid[One forward pass of a decoder]
flowchart LR
    A[token ids] --> B[embedding lookup]
    B --> C[48 decoder layers<br/>attention then MLP]
    C --> D[final norm]
    D --> E[LM head<br/>logits over the vocabulary]
    E --> F[sample next id]
    F -->|append and repeat| A
    C -.->|read and append K and V| G[(KV cache)]
:::

Each of the 48 layers does two things to every position's hidden vector: **attention** mixes in information from earlier positions, and a gated **MLP** transforms each position independently. Both add their result back to the input (the residual stream); Gemma 3 wraps each with normalisation layers whose weights are too small to count. The LM head shares its matrix with the input embedding (tied weights), turning the 3,840-wide hidden vector into 262,208 logits.

## 4.3 Parameters and FLOPs from `config.json`

Everything about cost starts with counting. With hidden size $d$, $H$ query heads, $K$ KV heads, head dim $d_h$, FFN width $F_{\text{ff}}$, vocabulary $V$ and $L$ layers:

$$
N = L\big(\underbrace{2dHd_h}_{W_q,\,W_o} + \underbrace{2dKd_h}_{W_k,\,W_v} + \underbrace{3dF_{\text{ff}}}_{\text{gate, up, down}}\big) + \underbrace{Vd}_{\text{tied embedding}}
$$

A matrix–vector product with an $m \times n$ matrix costs $2mn$ FLOPs (a multiply and an add per weight), so a forward pass costs about **2 FLOPs per non-embedding parameter per token**. The LM head adds \(2dV\) and attention adds a term that grows with context (§4.4).

:::example[Worked example · one Gemma 3 12B layer]
Attention projections: \(2 \times 3{,}840 \times 16 \times 256\) = 31.46M for $W_q$ and $W_o$, plus \(2 \times 3{,}840 \times 8 \times 256\) = 15.73M for $W_k$ and $W_v$ — 47.19M. MLP: \(3 \times 3{,}840 \times 15{,}360\) = 176.95M. One layer is 224.1M parameters; 48 layers are 10.758B. The embedding is \(262{,}208 \times 3{,}840\) = 1.007B. Total **11.765B**, and \(2 \times 10.758\) = **21.5 GFLOP per token** before the LM head (2.01 GFLOP) and attention scores.
:::

```python run
"""From config.json to parameters, FLOPs and KV bytes per token: Gemma 3 text models."""
# layers, query heads, KV heads, head_dim, hidden, FFN, vocab, sliding window
CFG = {"1B": (26, 4, 1, 256, 1152, 6912, 262_144, 512),
       "12B": (48, 16, 8, 256, 3840, 15_360, 262_208, 1024),
       "27B": (62, 32, 16, 128, 5376, 21_504, 262_208, 1024)}

print("model, embedding B, attention B, MLP B, total B, attn+MLP per layer M")
for name, (L, H, K, D, d, F, V, _) in CFG.items():
    attn = 2 * d * H * D + 2 * d * K * D       # W_q, W_o (H heads) + W_k, W_v (K heads)
    mlp = 3 * d * F                            # gate, up, down
    emb = V * d                                # tied: also the LM head
    print(f"{name}, {emb / 1e9:.3f}, {L * attn / 1e9:.3f}, {L * mlp / 1e9:.3f}, "
          f"{(emb + L * (attn + mlp)) / 1e9:.3f}, {(attn + mlp) / 1e6:.1f}")

L, H, K, D, d, F, V, WIN = CFG["12B"]
body = L * (2 * d * H * D + 2 * d * K * D + 3 * d * F)
n_glob = L // 6                                # 5 local : 1 global
kv_layer = 2 * K * D * 2                       # K and V, bf16, one token, one layer
print(f"\n12B: matmul FLOPs/token = 2 x {body / 1e9:.3f}B = {2 * body / 1e9:.1f} G; "
      f"LM head 2 x d x V = {2 * d * V / 1e9:.2f} G")
print(f"KV per token per layer {kv_layer} B; all {L} layers {L * kv_layer} B = "
      f"{L * kv_layer // 1024} KiB; {n_glob} global layers {n_glob * kv_layer // 1024} KiB")
print(f"GQA: {H} query heads share {K} KV heads -> KV is {H // K}x smaller than full MHA")


def attn_flops(ctx, window_aware=True):
    """QK^T scores + weighted sum of V for one new token, all layers."""
    per_ctx_tok = 4 * H * D                    # 2 FLOPs x (QK^T + AV) x heads x head_dim
    if not window_aware:
        return L * per_ctx_tok * ctx
    return per_ctx_tok * (n_glob * ctx + (L - n_glob) * min(ctx, WIN))


print("\ncontext, attention GFLOP/token (5:1 local), (all global), share of matmul (5:1 local) %")
for ctx in (512, 1024, 2048, 4096, 8192, 16384, 32768, 131072):
    a, g = attn_flops(ctx), attn_flops(ctx, False)
    print(f"{ctx}, {a / 1e9:.2f}, {g / 1e9:.2f}, {100 * a / (2 * body):.1f}")
```

```output
model, embedding B, attention B, MLP B, total B, attn+MLP per layer M
1B, 0.302, 0.077, 0.621, 1.000, 26.8
12B, 1.007, 2.265, 8.493, 11.765, 224.1
27B, 1.410, 4.096, 21.503, 27.008, 412.9

12B: matmul FLOPs/token = 2 x 10.758B = 21.5 G; LM head 2 x d x V = 2.01 G
KV per token per layer 8192 B; all 48 layers 393216 B = 384 KiB; 8 global layers 64 KiB
GQA: 16 query heads share 8 KV heads -> KV is 2x smaller than full MHA

context, attention GFLOP/token (5:1 local), (all global), share of matmul (5:1 local) %
512, 0.40, 0.40, 1.9
1024, 0.81, 0.81, 3.7
2048, 0.94, 1.61, 4.4
4096, 1.21, 3.22, 5.6
8192, 1.74, 6.44, 8.1
16384, 2.82, 12.88, 13.1
32768, 4.97, 25.77, 23.1
131072, 17.85, 103.08, 83.0
```

:::chart[Where Gemma 3's parameters live (billions)]{type="bar" x="model" y="parameters" unit="B" stacked="true" yfmt="dec1"}
model, embedding, attention, MLP
1B, 0.302, 0.077, 0.621
12B, 1.007, 2.265, 8.493
27B, 1.410, 4.096, 21.503
:::

Readings:

- **The MLP is the model.** 72% of the 12B's parameters and 80% of the 27B's are MLP weights; attention projections are 19% of the 12B. Weight bytes, and therefore decode time, are mostly MLP bytes.
- **Small models are mostly vocabulary.** The 262k-token embedding is 30% of the 1B. That is why the 1B shrinks only 2.06× in int4 (2.00 → 0.97 GB, [§1](/c/llm-serving/01-repository-tour)) when the embedding stays bf16.
- **The 21.5 GFLOP figure used across this course is a floor.** The LM head adds 2.01 GFLOP (9%) and attention scores add 0.81 GFLOP at 1,024 tokens of context — about 13% more work than the floor counts, one reason measured times sit above it.

## 4.4 Attention, and the KV bytes it leaves behind

Each layer projects the current position's hidden vector into a query $q_t$, and every position $i$ into a key $k_i$ and value $v_i$. The output for position $t$ is a weighted average of earlier values, weighted by how well each key matches the query:

$$
\text{attn}(t) = \sum_{i \in S(t)} \operatorname{softmax}_i\!\left(\frac{q_t \cdot k_i}{\sqrt{d_h}}\right) v_i,
\qquad
S(t) = \begin{cases} \{1, \dots, t\} & \text{global layer} \\ \{t - w + 1, \dots, t\} & \text{local layer, window } w \end{cases}
$$

Two Gemma 3 design choices shrink what this costs:

- **Grouped-query attention (GQA).** 16 query heads share 8 KV heads, so keys and values are stored for 8 heads, not 16.
- **Interleaved local attention.** Five of every six layers attend only to the last $w$ = 1,024 tokens; one in six (8 of 48) sees the whole context.

The causal mask makes $k_i$ and $v_i$ for a past position fixed forever: position 900's key does not change when position 1,000 arrives. So they can be computed once and kept — the **KV cache** — at a cost of

$$
\text{KV/token} = 2 \times L \times K \times d_h \times b = 2 \times 48 \times 8 \times 256 \times 2 = 393{,}216\ \text{B} = 384\ \text{KiB}.
$$

That is the **upper bound**, with every layer keeping every token. A window-aware allocator keeps all tokens only in the 8 global layers (64 KiB per token) and at most 1,024 tokens in the 40 local ones (320 KiB per token, capped). Whether your engine exploits the window is an engine detail; its startup log says how many tokens of KV it allocated.

:::example[Worked example · one HelpDesk request's KV]
A finished request holds 1,024 prompt + 256 output = 1,280 tokens. Upper bound: \(1{,}280 \times 384\) KiB = 480 MiB. Window-aware: \(1{,}280 \times 64 + 1{,}024 \times 320\) KiB = 400 MiB. Without GQA (16 KV heads) the upper bound would double to 960 MiB. A 16.57 GiB KV pool ([§1](/c/llm-serving/01-repository-tour), after an illustrative 2 GiB reserve) holds 35 such requests on the upper bound — [chapter 5](/c/llm-serving/07-challenges) works through the capacity arithmetic at 4k and 32k context.
:::

Attention also costs FLOPs that grow with context: for one new token, every visible cached token costs a dot product with $q_t$ and a weighted add of $v_i$ — \(4Hd_h\) = 16,384 FLOPs per layer per context token. With $L_g$ global and $L_\ell$ local layers,

$$
F_{\text{attn}}(c) = 4Hd_h\big(L_g\, c + L_\ell \min(c, w)\big).
$$

:::chart[Attention FLOPs per new token vs context, Gemma 3 12B]{type="line" x="context (tokens)" y="GFLOP per token" xlog="true" ylog="true" hmarks="21.5:matmul FLOPs per token" dash="all layers global"}
context, 5 local : 1 global, all layers global
512, 0.40, 0.40
1024, 0.81, 0.81
2048, 0.94, 1.61
4096, 1.21, 3.22
8192, 1.74, 6.44
16384, 2.82, 12.88
32768, 4.97, 25.77
131072, 17.85, 103.08
:::

At HelpDesk's 1k context attention is 4% of the work. At 32k it is 23% with Gemma's local layers — and would exceed the whole matmul budget (25.8 vs 21.5 GFLOP) if every layer were global. The local layers are what keep long context affordable in both FLOPs and KV bytes.

## 4.5 Prefill and decode: two operations in one loop

The first forward pass sees all $n$ prompt tokens at once: it does $nF$ FLOPs but reads the weights only once, so it is limited by compute. Every later pass sees one new token plus the cached KV of the $c$ tokens before it: $F$ FLOPs against $W + ck$ bytes, so it is limited by bandwidth. Take whichever limit is slower:

$$
t_{\text{prefill}}(n) \approx \max\!\left(\frac{nF}{\eta \cdot \text{peak}},\ \frac{W + nk}{\text{BW}}\right),
\qquad
t_{\text{decode}}(c) \approx \max\!\left(\frac{F}{\text{peak}},\ \frac{W + ck}{\text{BW}}\right)
$$

with $W$ = 23.53 GB of bf16 weights, $F$ = 21.5 GFLOP, $k$ = 393,216 B, BW = 864 GB/s and peak = 362 TFLOPS (L40S spec sheet), and $\eta$ = 0.50 the fraction of peak a prefill reaches (MFU — **illustrative**, the same value [§2](/c/llm-serving/02-benchmarks) uses).

:::example[Worked example · the HelpDesk request on one L40S]
**First token.** \(1{,}024 \times 21.5\) GFLOP = 22.0 TFLOP at \(0.50 \times 362\) TFLOPS = **121.7 ms**. Memory time for the same pass is only 27.7 ms, so it is compute-bound.

**Every later token.** \(23.53\) GB + \(1{,}024 \times 393{,}216\) B = 23.93 GB at 864 GB/s = **27.7 ms**. Compute time is 0.06 ms: memory-bound by more than 400×.

**Whole request.** \(121.7\) ms + 255 decode steps ≈ **7.20 s** (the steps creep up slowly as the context grows).
:::

The crossover prompt length is where the two prefill terms meet: \(n^* = (W/\text{BW}) / (F/(\eta\,\text{peak}) - k/\text{BW})\) = 27.2 ms ÷ (118.9 − 0.5) µs ≈ 230 tokens. Shorter prompts cost about one decode step; longer ones cost 118.9 µs per token. ([Chapter 5](/c/llm-serving/07-challenges) places both operations on the full roofline, at 100% of peak.)

```python run
"""Prefill vs decode, with and without a KV cache: Gemma 3 12B bf16, one L40S, batch 1.
Spec-sheet bandwidth and peak; prefill MFU is ILLUSTRATIVE; KV upper bound unless noted."""
BW, PEAK, MFU = 864e9, 362e12, 0.50
W, F, KV = 23.53e9, 2 * 10.758e9, 393_216      # weight bytes, FLOPs/token, KV bytes/token
P = 1024                                       # HelpDesk prompt


def step(new, cached):
    """One forward pass over `new` tokens with `cached` tokens of KV: slower of compute and memory."""
    return max(new * F / (PEAK * MFU), (W + (new + cached) * KV) / BW)


print("token, with cache ms, without cache ms")
for k in (1, 2, 3, 4, 5, 6, 7, 8):
    cached = step(P, 0) if k == 1 else step(1, P + k - 2)
    print(f"{k}, {cached * 1e3:.1f}, {step(P + k - 1, 0) * 1e3:.1f}")   # no cache: rerun everything

print("\ntokens generated, with cache s, without cache s, time ratio, FLOP ratio")
w, wo = 0.0, 0.0
for i in range(1024):
    w += step(P, 0) if i == 0 else step(1, P + i - 1)
    wo += step(P + i, 0)
    if i + 1 in (1, 64, 128, 256, 512, 768, 1024):
        flop_ratio = sum(P + j for j in range(i + 1)) / (P + i)    # tokens pushed through the model
        print(f"{i + 1}, {w:.2f}, {wo:.2f}, {wo / w:.1f}, {flop_ratio:.1f}")

print("\nTTFT ms (prefill alone) at 256, 1024, 4096 prompt tokens:",
      ", ".join(f"{step(n, 0) * 1e3:.1f}" for n in (256, 1024, 4096)))


def kv_read(ctx, window_aware):
    return ctx * KV if not window_aware else ctx * 65_536 + min(ctx, 1024) * 327_680


print("\ncontext, TPOT ms (upper bound), TPOT ms (window-aware)")
for ctx in (1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072):
    print(f"{ctx}, {(W + kv_read(ctx, False)) / BW * 1e3:.1f}, "
          f"{(W + kv_read(ctx, True)) / BW * 1e3:.1f}")
```

```output
token, with cache ms, without cache ms
1, 121.7, 121.7
2, 27.7, 121.8
3, 27.7, 122.0
4, 27.7, 122.1
5, 27.7, 122.2
6, 27.7, 122.3
7, 27.7, 122.4
8, 27.7, 122.6

tokens generated, with cache s, without cache s, time ratio, FLOP ratio
1, 0.12, 0.12, 1.0, 1.0
64, 1.87, 8.03, 4.3, 62.1
128, 3.64, 16.55, 4.5, 120.9
256, 7.20, 35.04, 4.9, 230.5
512, 14.34, 77.87, 5.4, 426.8
768, 21.50, 128.50, 6.0, 603.6
1024, 28.70, 186.91, 6.5, 768.1

TTFT ms (prefill alone) at 256, 1024, 4096 prompt tokens: 30.4, 121.7, 486.9

context, TPOT ms (upper bound), TPOT ms (window-aware)
1024, 27.7, 27.7
2048, 28.2, 27.8
4096, 29.1, 27.9
8192, 31.0, 28.2
16384, 34.7, 28.9
32768, 42.1, 30.1
65536, 57.1, 32.6
131072, 86.9, 37.6
```

:::chart[Per-token latency, first 8 tokens — the ch02 walkthrough's chart, predicted (Gemma 3 12B bf16, L40S, illustrative MFU)]{type="bar" x="output token" y="time for this token" unit=" ms"}
token, with KV cache, without KV cache
token 1, 121.7, 121.7
token 2, 27.7, 121.8
token 3, 27.7, 122.0
token 4, 27.7, 122.1
token 5, 27.7, 122.2
token 6, 27.7, 122.3
token 7, 27.7, 122.4
token 8, 27.7, 122.6
:::

The with-cache series is what the walkthrough notebook plots: one tall bar (prefill, a compute-bound pass over the prompt) and a flat tail (decode, a bandwidth-bound pass per token). It is two workloads, not a warm-up artefact. Two consequences fall out of the output:

- **TTFT scales with the prompt; TPOT barely does.** Quadrupling the prompt to 4,096 tokens takes prefill from 121.7 to 486.9 ms — nearly the whole 500 ms TTFT budget before any queueing — but moves the next decode step only from 27.7 to 29.1 ms.
- **Context length shows up in decode only through KV reads.** At 32k context a decode step reads 12 GiB of KV on the upper bound (42.1 ms) or 2.3 GiB window-aware (30.1 ms). This is the "context length affects generation" curve the walkthrough draws.

:::chart[Decode time per token vs context, Gemma 3 12B bf16 on one L40S (batch 1)]{type="line" x="context (tokens)" y="TPOT" unit=" ms" xlog="true" hmarks="50:HelpDesk TPOT SLO;27.2:weights alone" dash="window-aware"}
context, upper bound, window-aware
1024, 27.7, 27.7
2048, 28.2, 27.8
4096, 29.1, 27.9
8192, 31.0, 28.2
16384, 34.7, 28.9
32768, 42.1, 30.1
65536, 57.1, 32.6
131072, 86.9, 37.6
:::

## 4.6 Why the KV cache exists

Without a cache, every step must recompute keys and values for the whole sequence: step $t$ is a prefill of $n + t - 1$ tokens. Generating 256 tokens then pushes \(\sum_{j=0}^{255}(1{,}024 + j)\) = 294,784 token-passes through the model instead of 1,279 — **230.5× the FLOPs**. Yet the output says it takes only **4.9× the time** (35.04 s against 7.20 s). Why so little?

Because the cached decode step was wasting the GPU anyway. It moves 23.9 GB to do 21.5 GFLOP — under 1 FLOP per byte against the L40S's ridge of about 419 ([§7.4](/c/llm-serving/07-challenges)) — so the tensor cores sit idle 99% of the time. The uncached step fills them with redundant work: compute-bound at 121.7 ms instead of memory-bound at 27.7 ms. The ratio grows with length (6.5× at 1,024 tokens, ignoring the quadratic attention term that makes it worse still) because each uncached step carries the whole history.

:::warn[The cache costs memory, and memory is capacity]
The cache trades compute for memory: 480 MiB per HelpDesk request on the upper bound. Its size, not FLOPs, decides how many requests a GPU serves at once — [chapter 5](/c/llm-serving/07-challenges) sizes the pool, and [chapter 6](/c/llm-serving/08-essential-techniques) shows how paged attention and prefix caching stop it being wasted. The ch03 service generates with `use_cache=False`, paying the right-hand column of the table above on every streamed token ([walkthrough](/c/llm-serving/13-single-model-service)).
:::

## 4.7 Arithmetic intensity, and why batching helps decode

**Arithmetic intensity** is FLOPs per byte moved. A decode step for a batch of $B$ sequences reads the weights once and each sequence's KV:

$$
I(B) = \frac{B\,F}{W + B\,c\,k},
\qquad
I(1) = \frac{21.5\ \text{GFLOP}}{23.53 + 0.40\ \text{GB}} \approx 0.9\ \text{FLOP/byte}.
$$

Every extra sequence in the batch reuses weight bytes already being read, so tokens per step grow almost $B$-fold while step time grows only by the extra KV reads. That is why `ch2_Batching.ipynb` sees a batch finish far faster than the same prompts sent one at a time. The floor model below predicts the ratio for HelpDesk requests (all 256 tokens long — the best case for a fixed batch):

```python run
"""N HelpDesk requests one at a time vs as one batch: Gemma 3 12B bf16, one L40S.
Floor model; prefill MFU ILLUSTRATIVE; equal output lengths (best case for a static batch)."""
BW, PEAK, MFU = 864e9, 362e12, 0.50
W, F, KV = 23.53e9, 2 * 10.758e9, 393_216
P, OUT = 1024, 256


def prefill(n_tok):
    return max(n_tok * F / (PEAK * MFU), (W + n_tok * KV) / BW)


def decode(b, ctx):
    return max(b * F / PEAK, (W + b * ctx * KV) / BW)


print("requests, one at a time s, batched s, speed-up, batched tok/s")
for n in (1, 2, 4, 8, 16, 32):
    one = n * (prefill(P) + sum(decode(1, P + i) for i in range(OUT - 1)))
    bat = prefill(n * P) + sum(decode(n, P + i) for i in range(OUT - 1))
    print(f"{n}, {one:.2f}, {bat:.2f}, {one / bat:.1f}x, {n * OUT / bat:.0f}")
```

```output
requests, one at a time s, batched s, speed-up, batched tok/s
1, 7.20, 7.20, 1.0x, 36
2, 14.40, 7.46, 1.9x, 69
4, 28.80, 7.97, 3.6x, 129
8, 57.60, 8.99, 6.4x, 228
16, 115.20, 11.03, 10.4x, 371
32, 230.40, 15.11, 15.2x, 542
```

:::example[Worked example · batching eight requests]
Eight requests one after another take \(8 \times 7.20\) = 57.6 s. As one batch: one 8,192-token prefill (\(8 \times 121.7\) ms = 0.97 s, still compute-bound) plus 255 decode steps that each read the weights once and eight KV caches (31.4 ms each on average) — 8.99 s. Throughput rises 6.4× (36 → 228 tokens/s) while each request's own latency rises only 25% (7.20 → 8.99 s).
:::

The speed-up flattens because KV reads grow with $B$ while weight reads do not: at $c$ ≈ 1,152 intensity can never exceed \(F/(ck)\) = 47.5 FLOP/byte, a ninth of the ridge. Two other limits arrive first — the KV pool holds 35 HelpDesk requests ([§1](/c/llm-serving/01-repository-tour)) and the 50 ms TPOT target allows 43 ([§5.4](/c/llm-serving/05-system-design)). And real outputs are not all 256 tokens long: a batch that must wait for its longest member wastes slots, which is the static-versus-continuous story of [chapter 3](/c/llm-serving/05-system-design).

## 4.8 vLLM versus plain Transformers

`ch2_Run_LLM_With_vLLM.ipynb` loads the same weights through two runtimes. The transformer — and therefore every formula above — is identical. What differs is everything around the forward pass:

| Concern | Transformers `generate()` | vLLM |
| --- | --- | --- |
| Batch admission | A padded batch enters and leaves together | Sequences join and leave the running batch at every step (continuous batching) |
| KV memory | Per-sequence tensors that grow as tokens are appended | Fixed-size blocks from one pool sized at startup (paged attention) |
| Memory budget | Whatever the PyTorch allocator obtains | `--gpu-memory-utilization` × visible memory, minus weights and a profiled reserve |
| Per-step overhead | Python-level loop, many small kernel launches | CUDA graphs for decode steps, fused attention kernels |
| Shared prompt prefixes | Recomputed per request | Reusable KV blocks with prefix caching enabled |

How to read the notebook's latency difference: at batch 1 both runtimes pay the same weight reads per token, so the gap is per-step overhead. With many concurrent prompts the gap should widen, because only vLLM keeps one batch full and its KV memory unfragmented. Chapters [6](/c/llm-serving/08-essential-techniques) and [8](/c/llm-serving/10-frameworks) take these mechanisms apart.

## 4.9 Streaming: showing tokens as they are made

Streaming does not make generation faster; it changes which latency the user waits for. Without streaming, the HelpDesk user sees nothing for the whole request — 7.20 s at batch 1. With streaming, text appears after the TTFT (121.7 ms plus any queueing) and then arrives every 27.7 ms, about 36 tokens/s. That is why TTFT and TPOT, not end-to-end latency, are the SLOs this course uses.

`ch2_Streaming.ipynb` reaches for vLLM's async engine and then tells you to run `streaming.py` instead, because a notebook already owns an event loop and the engine wants to drive its own. The pattern, as a sketch (not the file verbatim):

```python
# Sketch: stream from vLLM's async engine; RequestOutput.text is cumulative.
from vllm import AsyncEngineArgs, AsyncLLMEngine, SamplingParams

engine = AsyncLLMEngine.from_engine_args(AsyncEngineArgs(model="google/gemma-3-12b-it"))

async def stream(prompt: str, request_id: str):
    sent = 0
    async for out in engine.generate(prompt, SamplingParams(max_tokens=256), request_id):
        text = out.outputs[0].text
        yield text[sent:]                       # only the new characters
        sent = len(text)
```

`ch03/single_model_llm_serving/llm/llm.py` solves the same problem by hand: a blocking worker thread produces tokens, and `asyncio.run_coroutine_threadsafe(queue.put(token), loop)` hands each one to the endpoint's event loop ([§13.3](/c/llm-serving/13-single-model-service) walks through it). Both answer "a blocking producer, an async consumer, and a client that may disconnect" — the first lets the framework own the loop, the second shows the moving parts.

:::warn[A disconnected client still holds KV]
If a streaming client goes away and nothing aborts its request, the engine keeps decoding into a 480 MiB KV allocation nobody will read. Cancel the request when the response stream closes (vLLM's async engine has an `abort(request_id)` call for this).
:::

## 4.10 Rules of thumb

| Quantity | Formula | Gemma 3 12B bf16, one L40S |
| --- | --- | ---: |
| Parameters | \(L(2dHd_h + 2dKd_h + 3dF_{\text{ff}}) + Vd\) | 11.765B |
| FLOPs per token | \(2 \times\) non-embedding params, + \(2dV\) + attention | 21.5 G (+2.01 G, +0.81 G at 1k) |
| KV per token | \(2LKd_hb\) | 384 KiB (64 KiB global layers only) |
| TTFT, prefill only | \(nF/(\eta\,\text{peak})\) for $n$ above ~230 | 121.7 ms at 1,024 tokens |
| TPOT at batch 1 | \((W + ck)/\text{BW}\) | 27.7 ms at 1,024 context |
| Decode intensity | \(BF/(W + Bck)\) | 0.9 FLOP/byte at B = 1; ceiling 47.5 |

## 4.11 Check yourself

:::qa[Compute the KV cache of one 4,096-token sequence on Gemma 3 27B in bf16, on both bounds.]
Per layer per token: \(2 \times 16 \times 128 \times 2\) = 8,192 B = 8 KiB. Upper bound, 62 layers: \(4{,}096 \times 496\) KiB = 1,984 MiB. Window-aware: 10 global layers keep all 4,096 tokens (80 KiB each) and 52 local layers keep 1,024 (416 KiB each): \(4{,}096 \times 80 + 1{,}024 \times 416\) KiB = 736 MiB.
:::

:::qa[HelpDesk's prompts grow from 1,024 to 4,096 tokens. What happens to TTFT and TPOT?]
Prefill is compute-bound and scales linearly: 121.7 → 486.9 ms at the illustrative 50% MFU, leaving 13 ms of the 500 ms TTFT budget for queueing. The first decode step only reads more KV: 27.7 → 29.1 ms on the upper bound. Long prompts are a TTFT problem; prefix caching the 768 shared tokens ([chapter 6](/c/llm-serving/08-essential-techniques)) is the first fix.
:::

:::qa[Turning off the KV cache multiplies FLOPs by 230 for a 256-token answer. Why does time grow only 4.9×?]
The cached decode step was bandwidth-bound at under 1 FLOP per byte, leaving the tensor cores almost idle. The uncached step does 1,024+ tokens of work per pass but reads the weights just once, so it becomes compute-bound at about 122 ms instead of 27.7 ms. Recomputation is largely absorbed by idle compute — until long contexts make it, and attention's quadratic term, dominate.
:::

:::qa[The vLLM notebook shows a large latency gap for many prompts and a small one for a single prompt. Is that consistent with this page?]
Yes. At batch 1 both runtimes read 23.53 GB per token, so only per-step overhead differs. With many prompts vLLM keeps one batch full and reads the weights once per step for all of them, while a loop of one-at-a-time calls pays the weight reads per prompt — the 6.4× at eight requests in §4.7.
:::

:::qa[Batching eight HelpDesk requests raises throughput 6.4×. What does it cost each user, and what stops you batching 100?]
Each request's end-to-end time goes from 7.20 to 8.99 s (25% longer), and TPOT rises from 27.7 to about 31.4 ms. At 100 the KV pool runs out first (35 requests at 480 MiB each in 16.57 GiB) and the 50 ms TPOT target would cap the batch at 43 even with infinite memory.
:::

Next: [Chapter 3 — System design](/c/llm-serving/05-system-design).
