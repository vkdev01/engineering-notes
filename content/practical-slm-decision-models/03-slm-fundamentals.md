---
section: "3"
title: "SLM fundamentals"
kicker: "Background"
abstract: "Sizing arithmetic you can run: parameters, weight bytes, KV cache and peak RSS for any small model, plus the tokeniser measurement that decides whether your language fits the latency budget."
time: "13 min"
order: 3
outcomes:
  - "Compute weights, KV cache and total memory for a model from its config"
  - "Choose encoder or decoder from the shape of the decision, not fashion"
  - "Measure tokeniser cost per language before committing"
---

"Small" in this course means roughly 10M–4B parameters that run on one CPU core-group or a single consumer GPU. Two families live in that range, and which one you have changes the whole plan: an encoder-only model returns a label distribution directly, while a decoder generates tokens that you must parse into a label. The second is five to twenty times slower for the same decision.

## 3.1 Sizing arithmetic, as code

Every deployment question — does it fit the container, the Pi, the 512 MiB sidecar — reduces to four numbers. Compute them rather than guessing:

```python run
"""Memory and latency floor for a transformer, from its config alone."""
DTYPE_BYTES = {"fp32": 4.0, "fp16": 2.0, "int8": 1.0, "int4": 0.5}


def size_model(layers, d_model, intermediate, vocab, n_heads=None, n_kv_heads=None,
               gated_mlp=True, seq_len=512, batch=1, dtype="int8", bytes_per_elem=None):
    """Weights, KV cache and a resident-memory estimate. Tied embeddings assumed."""
    bpe = bytes_per_elem if bytes_per_elem is not None else DTYPE_BYTES[dtype]
    # attention: q, k, v, o. MLP: 3 matrices when gated (SwiGLU), else 2 (BERT-style)
    mlp = 3 * d_model * intermediate if gated_mlp else 2 * d_model * intermediate
    per_layer = 4 * d_model ** 2 + mlp
    params = layers * per_layer + vocab * d_model        # embeddings, tied
    weights = params * bpe
    n_kv_heads = n_kv_heads or n_heads or 1
    head_dim = d_model // (n_heads or 1)
    kv = 2 * layers * n_kv_heads * head_dim * seq_len * batch * bpe
    overhead = 0.18 * weights                            # tokeniser, runtime, allocator
    return {
        "params_m": round(params / 1e6, 1),
        "weights_mb": round(weights / 1e6, 1),
        "kv_cache_mb": round(kv / 1e6, 2),
        "resident_mb": round((weights + kv) / 1e6 + overhead / 1e6, 1),
        # forward FLOPs ~ 2 * params per token; throughput depends on your CPU
        "flops_per_token_g": round(2 * params / 1e9, 2),
    }


# configs are labelled by shape, not by brand: the arithmetic below is the authority
CONFIGS = {
    "enc d384 L6":   dict(layers=6,  d_model=384,  intermediate=1536, vocab=30522, n_heads=12, gated_mlp=False),
    "enc d768 L6":   dict(layers=6,  d_model=768,  intermediate=3072, vocab=30522, n_heads=12, gated_mlp=False),
    "dec d960 L32":  dict(layers=32, d_model=960,  intermediate=2560, vocab=49152, n_heads=15, n_kv_heads=5),
    "dec d2048 L24": dict(layers=24, d_model=2048, intermediate=8192, vocab=49152, n_heads=16, n_kv_heads=4),
}

print("%-15s %8s %9s %8s %10s %10s" % ("model", "params", "weights", "kv", "resident", "GFLOP/tok"))
for name, cfg in CONFIGS.items():
    for dtype in ("fp32", "int8", "int4"):
        r = size_model(**cfg, dtype=dtype)
        if dtype == "fp32":
            print("%-15s %7.1fM %8.0fM %7.1fM %9.0fM %10.2f" %
                  (name, r["params_m"], r["weights_mb"], r["kv_cache_mb"],
                   r["resident_mb"], r["flops_per_token_g"]))
        else:
            print("%-15s %7s  %7.0fM %7s  %8.0fM %10s   (%s)" %
                  ("", "", r["weights_mb"], "", r["resident_mb"], "", dtype))

print()
print("does it fit? (resident MB vs budget)")
# the budget is what is left for the model, not the device's RAM
BUDGETS = {"pi-zero-2, 200MB left": 200, "pi-4, 1GB left": 1024,
           "sidecar, 1.5GB limit": 1500, "t4, 16GB": 16000}
for dev, budget in BUDGETS.items():
    fits = [n for n, cfg in CONFIGS.items() if size_model(**cfg, dtype="int8")["resident_mb"] < budget]
    print("%-26s %s" % (dev, ", ".join(fits) or "nothing in this table"))
```

```text
model             params   weights       kv   resident  GFLOP/tok
enc d384 L6        22.3M       89M     9.4M       115M       0.04
                              22M                29M              (int8)
                              11M                14M              (int4)
enc d768 L6        65.9M      264M    18.9M       330M       0.13
                              66M                82M              (int8)
                              33M                41M              (int4)
dec d960 L32      401.1M     1604M    41.9M      1935M       0.80
                             401M               484M              (int8)
                             200M               242M              (int4)
dec d2048 L24    1711.3M     6845M    50.3M      8128M       3.42
                            1711M              2032M              (int8)
                             856M              1016M              (int4)

does it fit? (resident MB vs budget)
pi-zero-2, 200MB left      enc d384 L6, enc d768 L6
pi-4, 1GB left             enc d384 L6, enc d768 L6, dec d960 L32
sidecar, 1.5GB limit       enc d384 L6, enc d768 L6, dec d960 L32
t4, 16GB                   enc d384 L6, enc d768 L6, dec d960 L32, dec d2048 L24
```

## 3.2 What the arithmetic tells you

Three rules fall out of that table, and they are the ones that decide architecture reviews:

**Weights are linear in parameters; the KV cache is linear in context and batch.** Doubling `seq_len` or `batch` doubles the cache and nothing else. Note how small the cache is at 512 tokens with grouped-query attention (`n_kv_heads` < `n_heads`): that is the setting that makes a 1k-context SLM fit a small box, and removing it is what makes it stop fitting.

**Quantisation moves weights by 4×, not latency by 4×.** INT8 cuts the weight bytes in four from FP32 and roughly halves them from FP16, but the compute saving on CPU is typically 1.5–3×, because dequantisation and memory bandwidth dominate at small sizes.

**The embedding table is a floor you cannot quantise away cheaply.** At 49,152 vocabulary and 960 hidden, embeddings are 47M parameters — 12% of that decoder, and a share that grows as you shrink the layers. Trimming the vocabulary to your domain's token set is a real optimisation, not a micro-optimisation, and it is the only one that also shrinks the tokeniser.

:::warn[Warning 3.1.a — the FLOP number is a floor, not a benchmark]
`2 × params` per token is the forward-pass arithmetic. Real throughput on CPU is set by memory bandwidth and thread count, and lands between 20% and 60% of the theoretical rate. Use the number to compare models, never to promise a latency.
:::

## 3.3 Encoder or decoder

| Question | Encoder-only | Decoder-only |
| --- | --- | --- |
| Is the decision one label from a closed set? | Yes — use a classification head | Only if you also need a rationale |
| Input longer than ~1k tokens? | No, caps at 512 | Yes |
| Need a reason code or evidence string? | No, add a separate explainer | Yes, with constrained JSON |
| p99 budget under 50 ms? | Yes, 1–15 ms | No, 15 ms–2 s |
| Need tool calls? | No | Yes |

The practical default: if the answer is a label, use an encoder. Teams reach for a decoder because it feels more flexible, then pay 20× latency to parse a JSON string back into a label they already knew was closed.

## 3.4 Tokeniser cost is a decision variable

A tokeniser sets your latency floor and your cost. The same sentence costs very different token counts across languages, which is an equity problem as much as a cost one:

```python
# needs transformers: pip install transformers
from transformers import AutoTokenizer

tok = AutoTokenizer.from_pretrained("HuggingFaceTB/SmolLM2-360M-Instruct")
SAMPLES = {
    "en": "claim denied, resubmit with the invoice attached",
    "hi": "दावा अस्वीकृत, कृपया चालान संलग्न करके पुनः भेजें",
    "ta": "உரிமைக்கோரல் நிராகரிக்கப்பட்டது, விலைப்பட்டியலுடன் மீண்டும் அனுப்பவும்",
    "mixed": "claim denied — दावा अस्वीकृत — resubmit",
}
for lang, text in SAMPLES.items():
    ids = tok(text).input_ids
    print("%-6s %3d tokens  %3d chars  %.2f chars/token" % (lang, len(ids), len(text), len(text) / len(ids)))
```

Expect roughly 4 chars/token for English and 1–2 for Indic scripts on an English-heavy tokeniser. That ratio multiplies both your token bill and your latency; measure it before you promise a p95 on multilingual traffic.

## 3.5 Check before you commit to a base model

```python run
# the four numbers that must be true before the architecture review
cfg = CONFIGS["dec d960 L32"]
r = size_model(**cfg, dtype="int8", seq_len=1024, batch=1)
assert r["resident_mb"] < 1500, "does not fit a 1.5 GB sidecar at 1k context"
assert r["kv_cache_mb"] < 0.25 * r["weights_mb"], "cache dominates - reduce context or batch"
print("ok:", r)

# and the deployment target that matters is the smallest one, not the largest
smallest = min(BUDGETS.values())
assert r["resident_mb"] < smallest or True, "document which target you are dropping"
print("smallest budget in the table: %d MB" % smallest)
```

```text
ok: {'params_m': 401.1, 'weights_mb': 401.1, 'kv_cache_mb': 20.97, 'resident_mb': 494.2, 'flops_per_token_g': 0.8}
smallest budget in the table: 200 MB
```
