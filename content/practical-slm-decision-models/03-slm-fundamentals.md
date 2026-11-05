---
section: "3"
title: "SLM fundamentals"
kicker: "Background"
abstract: "First-principles sizing for small language models: count the parameters from the config, turn them into bytes by dtype, add the KV cache, and estimate latency as bytes moved per token over memory bandwidth (decode) plus FLOPs over compute (prefill). Every number comes from a runnable calculator."
time: "22 min"
order: 3
outcomes:
  - "Count a transformer's parameters from its config and say where they live"
  - "Compute weight memory for fp32, bf16, int8 and int4 and the KV cache for any context and batch"
  - "Estimate decode time per token as bytes read ÷ memory bandwidth, and prefill time as FLOPs ÷ compute"
  - "Decide whether a decision call is prefill-bound or decode-bound, and what to shrink first"
  - "Size a model against a container or device budget before downloading anything"
---

The loan triage from §1–2 has a new input: a free-text summary of each applicant's bank statements, which the random forest cannot read. Someone proposes a small language model to score it. Before anyone downloads weights, the platform team asks three questions: *does it fit in a 4 GB container, how long does one decision take on our CPUs, and what changes if we move to a GPU?* All three have answers you can compute from the model's config file and two hardware numbers. This section derives them.

Throughout, "small" means roughly 0.1B–8B parameters — models that run on one CPU socket or one GPU. The worked numbers use the **Qwen2.5** family at 0.5B, 1.5B, 3B and 7B because their configs are public and span the range; the method applies to any decoder-only transformer.

:::key[First principle]
A model is a pile of numbers that must be **stored** (memory = parameters × bytes per parameter, plus the KV cache) and **moved** (each generated token reads every weight once, so decode time ≈ bytes read ÷ memory bandwidth). Reading the prompt is different: prefill is **computed** in parallel, so its time ≈ FLOPs ÷ compute throughput.
:::

## 3.1 Where the parameters live

A decoder-only transformer is an embedding table, a stack of $L$ identical layers, and an output head. Each layer has an attention block and an MLP block. With hidden size $d$, $h$ query heads, $h_{kv}$ key/value heads, head size $d_h = d/h$ and MLP width $f$:

$$
\begin{aligned}
\text{attention} &= \underbrace{d \cdot h d_h}_{W_Q} + \underbrace{2 \cdot d \cdot h_{kv} d_h}_{W_K,\,W_V} + \underbrace{h d_h \cdot d}_{W_O} \\
\text{gated MLP} &= 3 \cdot d \cdot f \qquad (\text{gate, up, down}) \\
N &\approx L\,(\text{attention} + \text{MLP}) + V d \times \begin{cases} 1 & \text{tied input/output embeddings} \\ 2 & \text{untied} \end{cases}
\end{aligned}
$$

Biases and layer norms add well under 1% and are ignored. $h_{kv} < h$ is **grouped-query attention** (GQA): several query heads share one K/V head, which shrinks $W_K$, $W_V$ and — far more importantly — the KV cache (§3.3).

:::example[Worked example · Qwen2.5-0.5B by hand]
Config: $L = 24$, $d = 896$, $h = 14$, $h_{kv} = 2$, $d_h = 64$, $f = 4{,}864$, vocabulary $V = 151{,}936$, tied embeddings.

| Block | Arithmetic | Parameters |
| --- | --- | ---: |
| $W_Q + W_O$ | $2 \times 896 \times 896$ | 1,605,632 |
| $W_K + W_V$ | $2 \times 896 \times (2 \times 64)$ | 229,376 |
| MLP | $3 \times 896 \times 4{,}864$ | 13,074,432 |
| **per layer** | | **14,909,440** |
| 24 layers | $24 \times 14{,}909{,}440$ | 357,826,560 |
| embeddings (tied) | $151{,}936 \times 896$ | 136,134,656 |
| **total** | | **493,961,216 ≈ 0.49B** |

The embedding table is **28%** of this model. A 152k-token vocabulary is a fixed cost that does not shrink with the layers, so it dominates the smallest models: the same table is 15% of the 1.5B, 10% of the 3B and 7% of the 7B.
:::

The MLP is 88% of each layer here ($13.07\text{M} / 14.91\text{M}$). That is typical: in a gated-MLP transformer with $f \approx 5d$, attention is the minority of the weights even though it gets most of the attention.

## 3.2 Parameters to bytes

Memory for the weights is parameters × bytes per parameter:

| dtype | Bits | Bytes / param | Notes |
| --- | ---: | ---: | --- |
| fp32 | 32 | 4 | Training master weights; almost never served |
| fp16 / bf16 | 16 | 2 | Default for GPU serving |
| int8 | 8 | 1 | Weight-only or weight+activation quantisation |
| int4 | 4 | 0.5 | Plus scales: one fp16 scale per group of $g$ weights adds $2/g$ bytes — 0.53 B/param at $g = 64$, 0.52 at $g = 128$ |

| Model | Params | fp32 | bf16 | int8 | int4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Qwen2.5-0.5B | 0.49B | 1.98 GB | 0.99 GB | 0.49 GB | 0.25 GB |
| Qwen2.5-1.5B | 1.54B | 6.17 GB | 3.09 GB | 1.54 GB | 0.77 GB |
| Qwen2.5-3B | 3.09B | 12.34 GB | 6.17 GB | 3.09 GB | 1.54 GB |
| Qwen2.5-7B | 7.61B | 30.46 GB | 15.23 GB | 7.61 GB | 3.81 GB |

:::chart[Weight memory vs parameter count, by dtype (Qwen2.5 sizes)]{type="line" x="parameters (billions)" y="weight memory" unit=" GB" hmarks="4:4 GB container;16:16 GB GPU" points="true"}
params_B, fp32, bf16, int8, int4
0.49, 1.98, 0.99, 0.49, 0.25
1.54, 6.17, 3.09, 1.54, 0.77
3.09, 12.34, 6.17, 3.09, 1.54
7.61, 30.46, 15.23, 7.61, 3.81
:::

The rule of thumb falls straight out: **in bf16, gigabytes ≈ 2 × billions of parameters; in int8, ≈ 1×; in int4, ≈ 0.5×.** Against a 4 GB container, the 1.5B fits at int8 with about 2.5 GB to spare for everything else; the 3B fits at int8 with under 1 GB left (tight) and comfortably at int4; the 7B squeezes in only at int4 (3.81 GB) with nothing left for the runtime — in practice, no. A 16 GB GPU holds the 7B in bf16 with under 1 GB left — not enough for a useful KV cache at long context, as the next subsection shows.

:::warn[Weights are the floor, not the footprint]
The process also holds the KV cache, activations for the current batch, the runtime itself and allocator slack. Those depend on the inference engine; measure peak resident memory under real load rather than adding a guessed percentage, and keep explicit headroom in the budget.
:::

## 3.3 The KV cache

To generate token $t$, attention needs the keys and values of every previous token in every layer. Recomputing them each step would make generation quadratic, so the runtime caches them. Per token, each layer stores one K and one V vector per KV head:

$$
\text{KV bytes} = 2 \times L \times h_{kv} \times d_h \times T_{\text{seq}} \times B \times \text{bytes per element}
$$

where $T_{\text{seq}}$ is tokens in context (prompt + generated so far) and $B$ the batch size. The factor 2 is K and V.

:::example[Worked example · KV cache for Qwen2.5-0.5B]
$2 \times 24 \text{ layers} \times 2 \text{ KV heads} \times 64 \times 2 \text{ bytes (bf16)} = 12{,}288$ bytes = **12 KiB per token**.

At 4,096 tokens: $12{,}288 \times 4{,}096 = 50.3$ MB. With 14 KV heads (one per query head, i.e. no GQA) it would be $2 \times 24 \times 14 \times 64 \times 2 = 86{,}016$ bytes = 84 KiB per token — **7× larger**. GQA is what makes long contexts affordable in small models.
:::

| Model | KV per token (bf16) | 4k context | 32k context |
| --- | ---: | ---: | ---: |
| Qwen2.5-0.5B | 12 KiB | 50 MB | 403 MB |
| Qwen2.5-1.5B | 28 KiB | 117 MB | 940 MB |
| Qwen2.5-3B | 36 KiB | 151 MB | 1,208 MB |
| Qwen2.5-7B | 56 KiB | 235 MB | 1,879 MB |

:::chart[KV cache for one sequence vs context length (bf16)]{type="line" x="context length (tokens)" y="KV cache" unit=" MB" xlog="true" ylog="true" points="true"}
tokens, Qwen2.5-0.5B, Qwen2.5-1.5B, Qwen2.5-3B, Qwen2.5-7B
512, 6, 15, 19, 29
1024, 13, 29, 38, 59
2048, 25, 59, 75, 117
4096, 50, 117, 151, 235
8192, 101, 235, 302, 470
16384, 201, 470, 604, 940
32768, 403, 940, 1208, 1879
:::

Two consequences for sizing:

- **The cache is linear in context *and* batch.** The 7B in bf16 is 15.23 GB of weights; one 32k-token sequence adds 1.88 GB, for 17.1 GB — over a 16 GB card before any activations. Eight concurrent 4k sequences on the 1.5B add $8 \times 117 = 940$ MB.
- **For decisions, the cache is usually small.** A 600-token prompt on the 1.5B needs about 17 MB per sequence. Decision workloads are short-context, so weights dominate memory and the cache matters mainly when you batch many requests.

## 3.4 Decode: latency is bytes moved

Generating one token at batch 1 multiplies a single activation vector by every weight matrix once. Each weight is fetched from memory, used for one multiply-add (2 FLOPs), and discarded. So per token:

$$
t_{\text{decode}} \;\approx\; \frac{\text{weight bytes read} + \text{KV bytes read}}{\text{memory bandwidth}}
$$

The ratio of FLOPs to bytes — **arithmetic intensity** — for int8 weights at batch 1 is about 2 FLOPs/byte. Hardware can do far more arithmetic per byte than that: an illustrative CPU with 50 GB/s and 1 TFLOP/s effective offers $10^{12}/(50\times10^9) = 20$ FLOPs per byte; an illustrative GPU with 300 GB/s and 50 TFLOP/s offers 167. Decode therefore waits on memory, and compute sits mostly idle.

One refinement: with tied embeddings the output head *is* the embedding table, so all of it is read every token. With untied embeddings (the 7B) the input table is only looked up one row at a time, so its $V d$ parameters drop out of the per-token read.

:::note[Illustrative hardware used in this section]
**CPU:** 50 GB/s memory bandwidth, 1 TFLOP/s effective compute. **GPU:** 300 GB/s, 50 TFLOP/s effective. These are round numbers to make the arithmetic visible, not measurements of any product. Real kernels reach only part of peak bandwidth, so every latency below is a **floor** — use it to compare options and to rule things out, then measure on your hardware.
:::

| Model | CPU int8 | CPU int4 | GPU int8 | GPU int4 |
| --- | ---: | ---: | ---: | ---: |
| Qwen2.5-0.5B | 10.13 ms | 5.19 ms | 1.69 ms | 0.87 ms |
| Qwen2.5-1.5B | 31.46 ms | 16.02 ms | 5.24 ms | 2.67 ms |
| Qwen2.5-3B | 62.47 ms | 31.61 ms | 10.41 ms | 5.27 ms |
| Qwen2.5-7B | 142.57 ms | 71.87 ms | 23.76 ms | 11.98 ms |

Decode floor per token, batch 1, 1k-token context, bf16 KV cache, illustrative hardware.

:::chart[Decode time per token vs model size (illustrative 50 GB/s CPU, 300 GB/s GPU)]{type="line" x="parameters (billions)" y="ms per generated token (floor)" unit=" ms" ylog="true" points="true" dash="GPU int8,GPU int4" note="Floor = bytes read per token ÷ bandwidth; real kernels are slower"}
params_B, CPU int8, CPU int4, GPU int8, GPU int4
0.49, 10.13, 5.19, 1.69, 0.87
1.54, 31.46, 16.02, 5.24, 2.67
3.09, 62.47, 31.61, 10.41, 5.27
7.61, 142.57, 71.87, 23.76, 11.98
:::

:::example[Worked example · Qwen2.5-1.5B, int8, on the illustrative CPU]
Bytes per token: 1.544 GB of weights (tied, so all read) + $28 \text{ KiB} \times 1{,}024 = 29.4$ MB of cache ≈ 1.573 GB.

$t_{\text{decode}} = 1.573 \times 10^9 / (50 \times 10^9) = 31.5$ ms per token, so at most ~32 tokens/s. Halving the bytes (int4) halves the time to 16.0 ms; the GPU's 6× bandwidth divides it by 6 to 5.2 ms. Nothing about the model's "intelligence" enters the calculation — only its size in bytes.
:::

**Batching** is how servers escape the bandwidth wall. At batch $B$, one decode step still reads the weights once but produces $B$ tokens; only the KV reads scale with $B$. On the illustrative GPU the step stays memory-bound until the FLOPs ($B \times 2N$) catch up with the bytes — around $B \approx 167/2 \approx 83$ for int8 weights, ignoring the cache:

| Batch (Qwen2.5-1.5B, int8, 1k context, GPU) | Step time | Throughput |
| ---: | ---: | ---: |
| 1 | 5.24 ms | 191 tokens/s |
| 8 | 5.93 ms | 1,349 tokens/s |
| 32 | 8.28 ms | 3,866 tokens/s |
| 128 | 17.67 ms | 7,243 tokens/s |

Throughput grows 38× from batch 1 to 128 while per-step latency grows 3.4×. At batch 128 the KV reads ($128 \times 29.4$ MB = 3.8 GB) outweigh the weights (1.5 GB) — at high concurrency, the cache, not the model, sets the speed.

## 3.5 Prefill: the prompt is computed, not streamed

Before the first output token, the model processes the whole prompt. All prompt tokens go through each weight matrix together, so every weight byte fetched is used $T_{\text{prompt}}$ times; intensity is high and prefill is **compute-bound**:

$$
t_{\text{prefill}} \;\approx\; \frac{2\,N\,T_{\text{prompt}}}{\text{compute throughput}}
$$

The $2N$ per token counts the matrix multiplies. Attention scores add roughly $4\,L\,h\,d_h\,T^2$ FLOPs (an upper bound, ignoring the causal-mask saving), which for Qwen2.5-0.5B is 5% of the matrix work at 600 tokens and 36% at 4,096 — negligible for short decision prompts, significant for long documents.

A decision call is a long prompt (instructions, the applicant's text, maybe a few examples) and a very short answer. Take 600 prompt tokens and 8 output tokens (a short JSON label), int8:

| Model | CPU prefill | CPU decode (8 tok) | CPU total | GPU prefill | GPU decode (8 tok) | GPU total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Qwen2.5-0.5B | 593 ms | 80 ms | 673 ms | 12 ms | 13 ms | 25 ms |
| Qwen2.5-1.5B | 1,852 ms | 250 ms | 2,102 ms | 37 ms | 42 ms | 79 ms |
| Qwen2.5-3B | 3,703 ms | 497 ms | 4,200 ms | 74 ms | 83 ms | 157 ms |
| Qwen2.5-7B | 9,137 ms | 1,137 ms | 10,274 ms | 183 ms | 189 ms | 372 ms |

:::chart[One decision on the illustrative CPU: 600-token prompt + 8 output tokens, int8]{type="bar" stacked="true" y="latency floor" unit=" ms"}
model, prefill, decode
Qwen2.5-0.5B, 593, 80
Qwen2.5-1.5B, 1852, 250
Qwen2.5-3B, 3703, 497
Qwen2.5-7B, 9137, 1137
:::

On the CPU, **prefill is 88–89% of the decision** for every size. That reverses the usual chatbot intuition (where long outputs make decode dominate) and tells you what to optimise:

- **Shorten the prompt.** On the 0.5B CPU path, every 100 prompt tokens cost $2 \times 0.494 \times 10^9 \times 100 / 10^{12} = 99$ ms. Trimming instructions and few-shot examples beats quantising further.
- **Make the first token decide.** If the label is a single token (or you score the label tokens' logits directly), the prefill pass already produces the answer and decode steps drop to zero.
- **Read only the logits you need.** With tied embeddings the output head is the 136M-parameter table on the 0.5B; computing logits for just the allowed label tokens drops it from the per-token read (10.1 → 7.4 ms per decode step at int8 on the illustrative CPU). This needs a custom head in most runtimes.

On the GPU, prefill and decode are similar in size because 50 TFLOP/s makes prefill cheap — the GPU's advantage is mostly in prefill (50× more compute against 6× more bandwidth in the illustrative numbers).

## 3.6 Tokens and context

Everything above is in **tokens**, not characters or words. A tokeniser splits text into sub-word pieces from a fixed vocabulary (151,936 entries for Qwen2.5). For English, roughly 4 characters per token is a common rule of thumb; scripts and languages under-represented in the tokeniser's training data split into many more tokens per character. Since prefill time and KV size are linear in tokens, a prompt that tokenises 3× longer costs about 3× the prefill.

Measure, don't assume. This sketch needs `transformers` and downloads a tokeniser, so it is not run here:

```python
# pip install transformers  (downloads only the tokenizer files)
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained("Qwen/Qwen2.5-0.5B-Instruct")
samples = {
    "en": "salary credited monthly, two EMIs bounced in March",
    "hi": "हर महीने वेतन जमा होता है, मार्च में दो ईएमआई बाउंस हुईं",
}
for lang, text in samples.items():
    n = len(tok(text).input_ids)
    print(f"{lang}: {len(text)} chars, {n} tokens, {len(text) / n:.2f} chars/token")
```

**Context** is the number of tokens the model attends over: prompt plus generated output. It sets three costs at once — prefill time (linear, plus the quadratic attention term), KV memory (linear) and per-token decode time (the KV read grows with it). A model's advertised maximum context is a ceiling, not a target; for decisions, the right context is the shortest that holds the evidence.

## 3.7 Encoder or decoder for a closed decision

If the action set is closed, the model only needs to output a distribution over a handful of labels. An **encoder-only** model with a classification head (BERT family) does that in one forward pass with no instructions in the prompt and no decoding. A **decoder** has to be told the task in the prompt and emit the answer as tokens.

:::example[Worked example · same input, two architectures, illustrative CPU]
A 128-token bank-statement summary.

- **Encoder**, DistilBERT-sized (≈ 66M parameters): $2 \times 66 \times 10^6 \times 128 / 10^{12} = 17$ ms.
- **Decoder**, Qwen2.5-0.5B on the same 128 tokens: prefill $2 \times 0.494 \times 10^9 \times 128 / 10^{12} = 126$ ms, plus 8 decode steps at ~10 ms = 79 ms, ≈ 205 ms — before adding any instruction tokens.

The encoder is ~12× faster here, almost all of it from having 7.5× fewer parameters and no decode loop.
:::

| Need | Prefer | Why (from the arithmetic above) |
| --- | --- | --- |
| One label from a closed set, short input | Encoder + classifier head | One pass, no prompt overhead, no decode |
| Long input (thousands of tokens) | Decoder with long context, or chunk + encoder | Encoder context is usually limited (512 for BERT-family) |
| A reason string or extracted evidence with the label | Decoder with constrained output | Needs generation; keep the output short |
| Few or no labelled examples yet | Decoder, prompted | Can work zero-shot; distil to an encoder later (§6) |
| Strict CPU latency budget at volume | Encoder, or the smallest decoder with a short prompt | Prefill dominates CPU cost |

## 3.8 The sizing calculator

Everything in this section from one script: parameter counts from config, weights by dtype, KV cache, decode floors, the decision-call latency split and the batching table. Swap in your model's config and your hardware's bandwidth and compute.

```python run
"""SLM sizing from first principles: params -> bytes -> KV cache -> latency floor."""
BYTES = {"fp32": 4.0, "bf16": 2.0, "int8": 1.0, "int4": 0.5}
CPU, GPU = (50, 1), (300, 50)        # illustrative: (memory GB/s, effective TFLOP/s)

# Qwen2.5 shapes from the published config.json: layers, hidden, heads, kv_heads, ffn, vocab, tied
CONFIGS = {
    "Qwen2.5-0.5B": (24, 896, 14, 2, 4864, 151_936, True),
    "Qwen2.5-1.5B": (28, 1536, 12, 2, 8960, 151_936, True),
    "Qwen2.5-3B":   (36, 2048, 16, 2, 11008, 151_936, True),
    "Qwen2.5-7B":   (28, 3584, 28, 4, 18944, 151_936, False),
}


def params(L, d, h, kv, ffn, V, tied):
    hd = d // h
    attn = d * h * hd + 2 * d * kv * hd + h * hd * d     # q, k, v, o (biases/norms ignored)
    mlp = 3 * d * ffn                                    # gated MLP: gate, up, down
    return L * (attn + mlp) + V * d * (1 if tied else 2)  # embeddings (+ separate head if untied)


def read_per_token(L, d, h, kv, ffn, V, tied):
    """Params streamed per decode step: all of them, minus the input table if untied (1 row read)."""
    return params(L, d, h, kv, ffn, V, tied) - (0 if tied else V * d)


def kv_bytes(L, d, h, kv, tokens, b=2.0):
    """2 (K and V) x layers x kv_heads x head_dim x tokens x bytes."""
    return 2 * L * kv * (d // h) * tokens * b


def decode_ms(cfg, dtype, hw, ctx=1024, batch=1):
    """Memory-bound step: weights once + every sequence's cache, divided by bandwidth."""
    byts = read_per_token(*cfg) * BYTES[dtype] + batch * kv_bytes(*cfg[:4], ctx)
    return byts / (hw[0] * 1e9) * 1e3


def prefill_ms(cfg, tokens, hw):
    """Compute-bound: ~2 FLOPs per parameter per prompt token."""
    return 2 * params(*cfg) * tokens / (hw[1] * 1e12) * 1e3


print(f"{'model':13s} {'params':>6s} {'vocab%':>6s} {'fp32':>6s} {'bf16':>6s} {'int8':>6s} {'int4':>6s} {'KV/tok':>7s} {'KV@4k':>6s}")
for name, cfg in CONFIGS.items():
    n, (L, d, h, kv, ffn, V, tied) = params(*cfg), cfg
    gb = " ".join(f"{n * BYTES[t] / 1e9:6.2f}" for t in BYTES)
    print(f"{name:13s} {n / 1e9:5.2f}B {V * d / n:6.0%} {gb} {kv_bytes(L, d, h, kv, 1) / 1024:4.0f}KiB"
          f" {kv_bytes(L, d, h, kv, 4096) / 1e6:4.0f}MB")

print("\ndecode floor, ms/token (1k context, bf16 KV, batch 1)")
print(f"{'model':13s} {'CPU int8':>9s} {'CPU int4':>9s} {'GPU int8':>9s} {'GPU int4':>9s}")
for name, cfg in CONFIGS.items():
    ms = [decode_ms(cfg, t, hw) for hw in (CPU, GPU) for t in ("int8", "int4")]
    print(f"{name:13s} " + " ".join(f"{m:9.2f}" for m in ms))

print("\none decision: 600-token prompt + 8 output tokens, int8")
for name, cfg in CONFIGS.items():
    out = []
    for hw in (CPU, GPU):
        pre, dec = prefill_ms(cfg, 600, hw), 8 * decode_ms(cfg, "int8", hw, ctx=608)
        out.append(f"{pre:7.0f} + {dec:5.0f} = {pre + dec:6.0f} ms")
    print(f"{name:13s} CPU {out[0]}   GPU {out[1]}")

cfg = CONFIGS["Qwen2.5-1.5B"]
print("\nbatching on the GPU, Qwen2.5-1.5B int8, 1k context")
for b in (1, 8, 32, 128):
    step = max(decode_ms(cfg, "int8", GPU, batch=b), b * 2 * params(*cfg) / (GPU[1] * 1e12) * 1e3)
    print(f"  batch {b:3d}: step {step:6.2f} ms -> {b / step * 1e3:8,.0f} tokens/s")
```

```output
model         params vocab%   fp32   bf16   int8   int4  KV/tok  KV@4k
Qwen2.5-0.5B   0.49B    28%   1.98   0.99   0.49   0.25   12KiB   50MB
Qwen2.5-1.5B   1.54B    15%   6.17   3.09   1.54   0.77   28KiB  117MB
Qwen2.5-3B     3.09B    10%  12.34   6.17   3.09   1.54   36KiB  151MB
Qwen2.5-7B     7.61B     7%  30.46  15.23   7.61   3.81   56KiB  235MB

decode floor, ms/token (1k context, bf16 KV, batch 1)
model          CPU int8  CPU int4  GPU int8  GPU int4
Qwen2.5-0.5B      10.13      5.19      1.69      0.87
Qwen2.5-1.5B      31.46     16.02      5.24      2.67
Qwen2.5-3B        62.47     31.61     10.41      5.27
Qwen2.5-7B       142.57     71.87     23.76     11.98

one decision: 600-token prompt + 8 output tokens, int8
Qwen2.5-0.5B  CPU     593 +    80 =    673 ms   GPU      12 +    13 =     25 ms
Qwen2.5-1.5B  CPU    1852 +   250 =   2102 ms   GPU      37 +    42 =     79 ms
Qwen2.5-3B    CPU    3703 +   497 =   4200 ms   GPU      74 +    83 =    157 ms
Qwen2.5-7B    CPU    9137 +  1137 =  10274 ms   GPU     183 +   189 =    372 ms

batching on the GPU, Qwen2.5-1.5B int8, 1k context
  batch   1: step   5.24 ms ->      191 tokens/s
  batch   8: step   5.93 ms ->    1,349 tokens/s
  batch  32: step   8.28 ms ->    3,866 tokens/s
  batch 128: step  17.67 ms ->    7,243 tokens/s
```

The parameter counts land on the published sizes (0.49B, 1.54B, 3.09B, 7.61B) without biases or norms, which is the check that the formula in §3.1 is right.

## 3.9 Practical sizing rules

| Question | Rule | Example from this section |
| --- | --- | --- |
| Will the weights fit? | GB ≈ params(B) × bytes/param | 1.5B int8 = 1.54 GB in a 4 GB container: yes |
| How much for context? | KV = $2 L h_{kv} d_h T B \times$ bytes | 1.5B, 8 × 4k sequences: 0.94 GB extra |
| Fastest possible decode? | bytes read per token ÷ bandwidth | 1.5B int8 at 50 GB/s: 31.5 ms/token |
| Prompt cost? | $2 N T$ ÷ compute | 0.5B, 100 tokens at 1 TFLOP/s: 99 ms |
| Which phase dominates? | Long prompt + short label on CPU → prefill | 88–89% prefill on the illustrative CPU |
| Does int4 halve latency? | Decode floor, roughly yes; prefill, only if compute uses int4 | 1.5B CPU decode 31.5 → 16.0 ms |

:::tip[Size before you download]
Write the config into the calculator, plug in your measured bandwidth (a memory-copy benchmark gives it) and a measured matmul throughput, and rule models out on paper. Only benchmark the ones that survive — and expect real latency above these floors.
:::

:::warn[Quantisation changes the model, not just its size]
int8 and int4 shrink bytes and speed up memory-bound decode, but they perturb the weights and therefore the probabilities. For a decision model that means re-checking calibration and cost per case after quantising (§7, §11). A model that is 2× faster and mis-calibrated can be more expensive per decision.
:::

## 3.10 Check yourself

:::qa[A 1.5B model must run in a 2 GB container. Which dtypes are candidates?]
Weights alone: bf16 3.09 GB (no), int8 1.54 GB (leaves 0.46 GB for runtime, activations and cache — tight; measure), int4 ≈ 0.77–0.82 GB with group scales (comfortable). For a short-context decision workload the KV cache is tens of MB, so int4 is the safe choice and int8 is a maybe pending a peak-RSS measurement.
:::

:::qa[Moving the 3B from the illustrative CPU (50 GB/s) to the GPU (300 GB/s), what happens to decode and prefill time per decision?]
Decode is bandwidth-bound: 62.5 → 10.4 ms per token (6×, the bandwidth ratio). Prefill is compute-bound: 3,703 → 74 ms for 600 tokens (50×, the compute ratio). The whole decision goes from 4.2 s to 157 ms — a 27× speed-up, mostly from prefill.
:::

:::qa[Why does the KV cache of Qwen2.5-0.5B take 12 KiB per token rather than 84 KiB?]
Grouped-query attention: 14 query heads share 2 KV heads, so the cache stores $2 \times 24 \times 2 \times 64 \times 2 = 12{,}288$ bytes per token instead of $2 \times 24 \times 14 \times 64 \times 2 = 86{,}016$. The 7× saving applies to every token of context and every sequence in the batch.
:::

:::qa[Your decision prompt is 1,500 tokens and the answer is one token. Where should you spend optimisation effort?]
On prefill. With a one-token answer there is no decode loop, so latency is essentially $2N \times 1{,}500$ ÷ compute. Halving the prompt halves latency; a smaller model reduces it in proportion to $N$; quantisation helps only if the runtime's matmuls actually run faster at lower precision on your hardware. Faster memory does little.
:::

:::qa[Why does batch 128 on the GPU get only 7,243 tokens/s instead of 128 × 191 = 24,448?]
Because each sequence carries its own KV cache, which must be read every step: $128 \times 29.4$ MB = 3.8 GB, more than double the 1.54 GB of weights. The weight read is amortised across the batch; the cache read is not. Shorter contexts or a quantised KV cache raise the ceiling.
:::

Next: with sizes and latencies in hand, return to the decision itself — derive thresholds, abstention and regret properly in [Decision theory](/c/practical-slm-decision-models/04-decision-theory).
