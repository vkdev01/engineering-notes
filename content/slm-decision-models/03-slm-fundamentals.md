---
section: "3"
title: "SLM fundamentals"
kicker: "Background"
abstract: "A sizing cheat sheet for small language models: memory per dtype, the KV-cache formula, the decode latency floor (bytes per token ÷ bandwidth), prefill cost, a compact table for 0.5B–7B models, and when an encoder classifier beats a small decoder."
time: "12 min"
order: 3
outcomes:
  - "Estimate weight memory for any model and dtype in your head"
  - "Compute KV-cache size from a model config and context length"
  - "Derive a decode latency floor from bytes per token and memory bandwidth"
  - "Rule models in or out for a CPU or GPU budget before downloading anything"
  - "Choose between an encoder classifier and a small decoder for a closed decision"
---

The loan-triage service must run on a 4 GB CPU container and return a decision in under a second. Candidates range from a 66M-parameter encoder to a 7B decoder. You can rule most of them out on paper in five minutes, because the first-order cost of running a model is arithmetic on its size: how many bytes must be **stored**, and how many must be **moved** per generated token.

:::key[First principle]
Memory ≈ parameters × bytes per parameter + KV cache. Generating one token reads every weight once, so **decode time ≥ bytes read per token ÷ memory bandwidth**. Reading the prompt (prefill) is compute-bound: ≈ 2 × parameters × prompt tokens ÷ FLOP/s.
:::

## 3.1 Memory per dtype

| dtype | Bytes / param | GB per billion params | Use |
| --- | ---: | ---: | --- |
| fp32 | 4 | 4 | Training master weights; rarely served |
| bf16 / fp16 | 2 | 2 | Default GPU serving |
| int8 | 1 | 1 | Weight quantisation; CPU and GPU |
| int4 | 0.5 (+ group scales) | ≈ 0.5 | Smallest footprint; re-check quality |

int4 also stores a scale per group of $g$ weights: one fp16 scale per 64 weights adds $2/64 = 0.03$ bytes/param. Weights are the floor, not the footprint — add the KV cache, activations, the runtime and allocator slack, and measure peak resident memory under load.

## 3.2 The KV cache

Each generated token attends to the keys and values of every earlier token in every layer, so the runtime caches them:

$$
\text{KV bytes} = 2 \times L \times h_{kv} \times d_h \times T \times B \times \text{bytes per element}
$$

$L$ layers, $h_{kv}$ key/value heads of size $d_h$, $T$ tokens in context, batch $B$; the 2 is K and V.

:::example[Worked example · Qwen2.5-0.5B]
Config: $L = 24$, $h_{kv} = 2$, $d_h = 64$, bf16 cache. Per token: $2 \times 24 \times 2 \times 64 \times 2 = 12{,}288$ bytes = 12 KiB. At 4,096 tokens: 50 MB. With one KV head per query head (14, no grouped-query attention) it would be 84 KiB per token — 7× more. A 600-token decision prompt needs about 7 MB; for short decision workloads the cache only matters when you batch many requests.
:::

## 3.3 Latency: decode is bytes, prefill is FLOPs

At batch 1, each decode step multiplies one activation vector by every weight matrix: each weight is fetched, used for one multiply-add, and discarded. Memory bandwidth, not arithmetic, sets the pace:

$$
t_{\text{decode}} \ge \frac{\text{weight bytes} + \text{KV bytes read}}{\text{bandwidth}},
\qquad
t_{\text{prefill}} \approx \frac{2\,N\,T_{\text{prompt}}}{\text{FLOP/s}}
$$

:::note[Illustrative hardware used below]
**CPU:** 50 GB/s memory bandwidth, 1 TFLOP/s effective. **GPU:** 300 GB/s, 50 TFLOP/s effective. Round numbers chosen to make the arithmetic visible, not measurements of any product. Real kernels reach only part of peak, so every latency here is a **floor**: use it to rule options out, then measure.
:::

:::example[Worked example · Qwen2.5-1.5B, int8, illustrative CPU]
Bytes per token: 1.544 GB of weights + 28 KiB × 1,024 tokens = 29.4 MB of cache ≈ 1.573 GB. Floor: $1.573 \times 10^9 / (50 \times 10^9)$ = 31.5 ms per token, at most ~32 tokens/s. int4 halves the bytes (16.0 ms); the GPU's 6× bandwidth gives 5.2 ms.

A decision call is a long prompt and a short answer. With 600 prompt tokens: prefill $= 2 \times 1.54 \times 10^9 \times 600 / 10^{12}$ ≈ 1.85 s, plus 8 output tokens ≈ 0.25 s. **Prefill is 88% of the call** — shorten the prompt before quantising further.
:::

## 3.4 The cheat sheet: 0.5B to 7B

Qwen2.5 shapes from their published configs; latencies are floors on the illustrative hardware above (1k-token context for decode; "decision call" = 600-token prompt + 8 output tokens, int8).

| Model | Params | bf16 | int8 | int4 | KV / token | KV @ 4k | Decode CPU int8 | Decode GPU int8 | Decision call CPU | Decision call GPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Qwen2.5-0.5B | 0.49B | 0.99 GB | 0.49 GB | 0.25 GB | 12 KiB | 50 MB | 10.1 ms | 1.7 ms | 673 ms | 25 ms |
| Qwen2.5-1.5B | 1.54B | 3.09 GB | 1.54 GB | 0.77 GB | 28 KiB | 117 MB | 31.5 ms | 5.2 ms | 2,102 ms | 79 ms |
| Qwen2.5-3B | 3.09B | 6.17 GB | 3.09 GB | 1.54 GB | 36 KiB | 151 MB | 62.5 ms | 10.4 ms | 4,200 ms | 157 ms |
| Qwen2.5-7B | 7.61B | 15.23 GB | 7.61 GB | 3.81 GB | 56 KiB | 235 MB | 142.6 ms | 23.8 ms | 10,274 ms | 372 ms |

:::chart[Decode floor per generated token vs model size (illustrative 50 GB/s CPU, 300 GB/s GPU)]{type="line" x="parameters (billions)" y="ms per token (floor)" unit=" ms" ylog="true" points="true" dash="GPU int8,GPU int4" note="Floor = bytes read per token ÷ bandwidth; real kernels are slower"}
params_B, CPU int8, CPU int4, GPU int8, GPU int4
0.49, 10.1, 5.2, 1.7, 0.9
1.54, 31.5, 16.0, 5.2, 2.7
3.09, 62.5, 31.6, 10.4, 5.3
7.61, 142.6, 71.9, 23.8, 12.0
:::

Reading it against the 4 GB / 1 s CPU budget: the 7B is out (3.81 GB at int4 leaves nothing for the runtime, and the call floor is 10 s); the 3B fits at int4 but its call floor is 4.2 s; the 1.5B fits easily at int8 but its 2.1 s floor misses the budget; only the 0.5B (673 ms) passes on paper — or a GPU, where every size but the 7B is under 200 ms. Each line is straight with slope ≈ 1 on log-log axes: latency is proportional to bytes.

## 3.5 Encoder classifier or small decoder?

For a closed action set the model only has to output a distribution over a handful of labels. An **encoder** with a classification head (BERT family, e.g. DistilBERT ≈ 66M parameters) does that in one forward pass with no instructions and no decoding. A **decoder** must be told the task in the prompt and emit the answer as tokens.

:::example[Worked example · 128-token input, illustrative CPU]
Encoder, 66M: $2 \times 66 \times 10^6 \times 128 / 10^{12}$ = 17 ms. Decoder, Qwen2.5-0.5B: 126 ms of prefill on the same 128 tokens plus 8 decode steps ≈ 206 ms — before any instruction tokens. About 12× apart, from 7.5× fewer parameters and no decode loop.
:::

| Your situation | Prefer | Why |
| --- | --- | --- |
| Closed label set, short input, ≥ ~1k labelled examples | Encoder + classifier head | One pass, no prompt, native class probabilities |
| Strict CPU latency budget at volume | Encoder, or smallest decoder with a short prompt | Prefill dominates CPU cost |
| Long input (thousands of tokens) | Decoder with long context, or chunk + encoder | BERT-family context is usually 512 tokens |
| Need a reason string or extracted fields with the label | Decoder with constrained, short output | Requires generation |
| Few or no labels yet | Prompted decoder now, [distil](/c/slm-decision-models/06-distillation) to an encoder later | Works zero-shot; distillation recovers the speed |

## 3.6 The sizing calculator

Swap in your model's config and your measured bandwidth and FLOP/s.

```python run
"""SLM sizing cheat sheet: weights by dtype, KV cache, decode floor, one decision call."""
BYTES = {"bf16": 2.0, "int8": 1.0, "int4": 0.5}
CPU, GPU = (50e9, 1e12), (300e9, 50e12)   # illustrative: (bytes/s bandwidth, effective FLOP/s)
# Qwen2.5 config.json: layers, hidden, heads, kv_heads, mlp width, vocab, tied embeddings
CONFIGS = {"0.5B": (24, 896, 14, 2, 4864, 151_936, True),
           "1.5B": (28, 1536, 12, 2, 8960, 151_936, True),
           "3B":   (36, 2048, 16, 2, 11008, 151_936, True),
           "7B":   (28, 3584, 28, 4, 18944, 151_936, False)}


def params(L, d, h, kv, f, V, tied):
    hd = d // h
    per_layer = 2 * d * h * hd + 2 * d * kv * hd + 3 * d * f   # Q,O + K,V + gated MLP
    return L * per_layer + V * d * (1 if tied else 2)


def kv_per_token(L, d, h, kv, *_, b=2.0):
    return 2 * L * kv * (d // h) * b                           # K and V, bf16


def decode_ms(cfg, dtype, hw, ctx=1024):
    streamed = params(*cfg) - (0 if cfg[6] else cfg[5] * cfg[1])   # untied input table: 1 row/token
    return (streamed * BYTES[dtype] + kv_per_token(*cfg) * ctx) / hw[0] * 1e3


def decision_ms(cfg, hw, prompt=600, out=8):
    return 2 * params(*cfg) * prompt / hw[1] * 1e3 + out * decode_ms(cfg, "int8", hw, prompt + out)


print(f"{'model':5s} {'params':>6s} {'bf16':>5s} {'int8':>5s} {'int4':>5s} {'KV/tok':>6s} {'KV@4k':>6s}"
      f" {'CPU8':>6s} {'CPU4':>6s} {'GPU8':>5s} {'GPU4':>5s} {'callCPU':>7s} {'callGPU':>7s}")
for name, cfg in CONFIGS.items():
    n = params(*cfg)
    gb = " ".join(f"{n * BYTES[t] / 1e9:5.2f}" for t in BYTES)
    kv = kv_per_token(*cfg)
    dec = " ".join(f"{decode_ms(cfg, t, hw):{w}.1f}" for hw, w in ((CPU, 6), (GPU, 5)) for t in ("int8", "int4"))
    print(f"{name:5s} {n / 1e9:5.2f}B {gb} {kv / 1024:4.0f}Ki {kv * 4096 / 1e6:4.0f}MB {dec}"
          f" {decision_ms(cfg, CPU):7.0f} {decision_ms(cfg, GPU):7.0f}")

enc = 2 * 66e6 * 128 / CPU[1] * 1e3
dec05 = 2 * params(*CONFIGS["0.5B"]) * 128 / CPU[1] * 1e3 + 8 * decode_ms(CONFIGS["0.5B"], "int8", CPU, 136)
print(f"128-token input on CPU: encoder 66M {enc:.0f} ms vs 0.5B decoder + 8 tokens {dec05:.0f} ms")
```

```output
model params  bf16  int8  int4 KV/tok  KV@4k   CPU8   CPU4  GPU8  GPU4 callCPU callGPU
0.5B   0.49B  0.99  0.49  0.25   12Ki   50MB   10.1    5.2   1.7   0.9     673      25
1.5B   1.54B  3.09  1.54  0.77   28Ki  117MB   31.5   16.0   5.2   2.7    2102      79
3B     3.09B  6.17  3.09  1.54   36Ki  151MB   62.5   31.6  10.4   5.3    4200     157
7B     7.61B 15.23  7.61  3.81   56Ki  235MB  142.6   71.9  23.8  12.0   10274     372
128-token input on CPU: encoder 66M 17 ms vs 0.5B decoder + 8 tokens 206 ms
```

Weights in GB, KV cache per token and at 4k tokens, decode floors in ms/token (CPU/GPU × int8/int4), decision-call floors in ms. The parameter counts land on the published sizes (0.49B, 1.54B, 3.09B, 7.61B) while ignoring biases and norms — the check that the formula is right. Derivations of each term, batching and the full prefill analysis are in [the deep course §3](/c/practical-slm-decision-models/03-slm-fundamentals).

## 3.7 Rules of thumb

- **GB ≈ params (B) × bytes/param**: 2× in bf16, 1× in int8, ~0.5× in int4.
- **Decode floor = bytes per token ÷ bandwidth.** Halving bytes (int8 → int4) halves it; nothing about model quality enters.
- **On CPU, prefill dominates decision calls** (88–89% for every size above). Every 100 prompt tokens on the 0.5B cost $2 \times 0.494 \times 10^9 \times 100 / 10^{12}$ ≈ 99 ms.
- **Make the first token decide**: a single-token label (or scoring label logits directly) removes the decode loop.
- **Tokens, not characters.** Prefill and KV are linear in tokens; scripts under-represented in the tokeniser split into more tokens per word. Count tokens on real inputs before sizing.
- **Size for the smallest deployment target**, then benchmark only the survivors ([benchmarking](/c/slm-decision-models/24-benchmarking), [edge devices](/c/slm-decision-models/27-edge-devices)).

:::warn[Quantisation changes the probabilities]
int8/int4 shrink bytes and speed up decode, but they perturb the weights and therefore $P(\text{good})$. Every threshold in [§4](/c/slm-decision-models/04-decision-theory) assumes calibrated probabilities: re-check calibration and cost per case after quantising. A 2× faster, miscalibrated model can cost more per decision.
:::

## 3.8 Check yourself

:::qa[A 1.5B model must fit a 2 GB container. Which dtypes are candidates?]
bf16 needs 3.09 GB (no). int8 needs 1.54 GB, leaving 0.46 GB for runtime, activations and cache — tight, measure peak RSS. int4 needs ≈ 0.77–0.82 GB with group scales — comfortable.
:::

:::qa[What is the decode floor of a 3B int4 model on a device with 100 GB/s bandwidth?]
Bytes per token ≈ 3.09 × 10⁹ × 0.5 = 1.54 GB (plus a small cache). 1.54 / 100 ≈ 15.4 ms per token, so at most ~65 tokens/s. Real kernels will be slower.
:::

:::qa[Your decision prompt is 1,200 tokens on Qwen2.5-0.5B, illustrative CPU. Roughly how long is prefill?]
$2 \times 0.494 \times 10^9 \times 1{,}200 / 10^{12}$ ≈ 1.19 s — already over a 1 s budget before any decode. Shorten the prompt, move to an encoder, or move to a GPU.
:::

:::qa[When is a small decoder the right choice over an encoder?]
When you have few labels and need zero-shot behaviour now, the input is longer than the encoder's context, or the output must include generated text (a reason, extracted fields). Otherwise an encoder classifier is faster and returns class probabilities directly.
:::

Next: [Decision theory](/c/slm-decision-models/04-decision-theory) — turning those probabilities into actions.
