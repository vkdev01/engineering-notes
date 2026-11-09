---
section: "10"
title: "Chapter 8 \u2014 Frameworks"
kicker: "Chapter notes"
abstract: "vLLM, SGLang, TensorRT-LLM and llama.cpp judged on what a framework can change and what it cannot: GGUF sizes and laptop fit for Gemma 3 1B, 12B and 27B, the bytes-over-bandwidth decode ceiling on laptops and GPUs, what radix-tree prefix reuse saves on a multi-turn HelpDesk, and the fleet size at which a compile-ahead engine pays for its rebuilds."
time: "26 min"
order: 10
outcomes:
  - "Size a GGUF file for Gemma 3 at a given quant type and decide whether it fits a laptop together with its KV cache"
  - "Bound decode speed as bytes \u00f7 memory bandwidth and laptop TTFT as prefill FLOPs \u00f7 compute"
  - "Quantify what prefix reuse saves on a multi-turn conversation and the KV it takes to keep branches warm"
  - "Compute the number of busy GPUs at which a compiled engine's speed-up pays for its rebuilds"
  - "Choose a framework from deployment target, workload shape and change rate"
---
**Covers:** vLLM internals, TensorRT-LLM, SGLang, llama.cpp, and how to choose.

The HelpDesk team needs two deployments of the same assistant: production on L40S GPUs, and a build that engineers run on their laptops to test prompts offline. Four frameworks are on the table, and their benchmarks all claim to be fastest. None of them can beat the arithmetic of [§7](/c/llm-serving/07-challenges): a decode step reads every weight once, and a prompt token costs about \(2N\) FLOPs. This page uses that arithmetic to answer the questions that actually decide the choice — will it fit, how fast can it possibly be, which bytes does the framework let you skip, and what does it cost before the first token.

:::key[First principle]
A framework cannot change the bytes a token needs or the bandwidth that moves them. It changes three things: how close kernels get to the bytes ÷ bandwidth floor, which work you skip (prefix reuse, quantised formats), and what you pay before serving (install, compile, load). Choose by where the model must run, how much of each prompt repeats, and how often the model or hardware changes.
:::

## 10.1 What the repository contains

Three notebooks, one per framework, all doing the same thing — generating text from a few prompts — so the comparison is about ergonomics and prerequisites rather than speed.

| Notebook | Entry point | What you see |
| --- | --- | --- |
| `ch08/SGLang.ipynb` | Offline engine API from SGLang's getting-started tutorial | An async offline engine, prompts submitted as a batch, output collected |
| `ch08/TensorRT_LLM.ipynb` | `from tensorrt_llm import LLM, SamplingParams` | Install steps (`libopenmpi-dev`, `tensorrt_llm`), then a compile-and-generate call; the model argument accepts an HF name, a local path or a quantised checkpoint |
| `ch08/llamaCpp.ipynb` | `from llama_cpp import Llama` | `pip install llama-cpp-python` with `CMAKE_ARGS` for BLAS, a GGUF pulled from the Hub, then `create_chat_completion` |

The notebooks use other open-weight models; this guide re-derives the numbers on Gemma 3 so they stay consistent with the rest of the course. They do not measure throughput — the prompts are tiny and the models differ — so what they let you compare honestly is the cost to start:

| | Install | Model format | Runs on |
| --- | --- | --- | --- |
| SGLang | `pip install uv`, then SGLang | HF weights | GPU |
| TensorRT-LLM | System packages, large wheel, compile step | HF or quantised checkpoint, compiled to an engine | NVIDIA GPU |
| llama.cpp | `pip install llama-cpp-python` with CMake args | GGUF | CPU, Metal, CUDA |

**vLLM** is not in `ch08/` because it is the substrate everywhere else: the comparison against plain Transformers in chapter 2, and `vllm serve` plus its benchmark script in chapters 6, 7 and 9. The repository treats vLLM as the default and the other three as alternatives, which mirrors the field.

Each notebook is also chapter 3's hand-built service ([§13](/c/llm-serving/13-single-model-service)) compressed into a constructor call. SGLang's engine replaces the workload manager and executor; TensorRT-LLM replaces the executor and kernel selection; llama.cpp replaces the executor and memory layout. None replaces the API layer, which is why chapter 3's FastAPI code stays useful after you adopt a framework.

## 10.2 The floor no framework moves

For a model with \(N_{\text{body}}\) transformer weights stored in \(W\) bytes, on a device with bandwidth BW and effective compute \(F\):

$$
\text{TPOT} \;\ge\; \frac{W + B\,K_{\text{read}}}{\text{BW}},
\qquad
\text{TTFT} \;\ge\; \frac{2\,N_{\text{body}}\; n_{\text{new}}}{F}.
$$

Frameworks differ in the fraction of BW and \(F\) their kernels reach, in which formats they accept (which sets \(W\)), in \(n_{\text{new}}\) — the prompt tokens they must actually prefill after reusing cached ones — and in the fixed costs outside the formula. A benchmark that shows framework A beating framework B by more than the bytes allow is comparing different quantisation, KV dtype, batch or prompt reuse, not different engines.

## 10.3 llama.cpp and GGUF: will it fit, and how fast can it be?

GGUF stores weights in blocks with their own scales. Q8_0 packs 32 int8 weights plus one fp16 scale into 34 bytes — **8.5 bits per weight**. Q4_0 packs 32 4-bit weights plus a scale into 18 bytes — **4.5**. Q6_K is 6.5625. The `_K_M` recipes keep sensitive tensors at higher precision, so their average depends on the model; this page uses about 4.85 for Q4_K_M and you should read the real file size before trusting it. Unlike the int4 g128 scheme of [§8.2](/c/llm-serving/08-essential-techniques), GGUF quantises the embedding too.

On a laptop the budget is the memory the OS lets the runtime have, and the decode ceiling is bandwidth ÷ weight bytes. The laptop classes below are illustrative: a 16 GB machine with ~100 GB/s, and 32 GB and 64 GB unified-memory machines (Apple-silicon class) with ~200 and ~400 GB/s. "window" means it fits only if the runtime trims local layers to their 1,024-token window (512 for 1B).

```python run
"""Gemma 3 as GGUF: file size by quant type, KV for 8k context, fit and decode ceiling per machine."""
MODELS = {  # params incl. tied embedding; (global, local) layers; window; f16 KV bytes per layer-token
    "1B": (1.000e9, (4, 22), 512, 2 * 1 * 256 * 2),
    "12B": (11.765e9, (8, 40), 1024, 2 * 8 * 256 * 2),
    "27B": (27.008e9, (10, 52), 1024, 2 * 16 * 128 * 2),
}
QUANTS = {"F16": 16, "Q8_0": 8.5, "Q6_K": 6.5625, "Q4_K_M": 4.85, "Q4_0": 4.5}  # bits/weight; K_M approx
MACHINES = {  # usable GB for the model, memory bandwidth B/s -- laptops ILLUSTRATIVE, L40S spec
    "16GB laptop": (11, 100e9), "32GB unified": (22, 200e9),
    "64GB unified": (46, 400e9), "L40S": (43.5, 864e9)}
CTX = 8192


def kv_gb(model, window_aware):
    _, (glob, loc), win, per = MODELS[model]
    return (glob * CTX + loc * (min(CTX, win) if window_aware else CTX)) * per / 1e9


print(f"KV at {CTX} tokens, f16 (window-aware .. all layers): "
      + "; ".join(f"{m} {kv_gb(m, True):.2f}..{kv_gb(m, False):.2f} GB" for m in MODELS))
print(f"\n{'model quant':<12} {'GB':>6}  " + " ".join(f"{k:>13}" for k in MACHINES))
for m, (n, *_) in MODELS.items():
    for q, bpw in QUANTS.items():
        w = n * bpw / 8 / 1e9
        cells = []
        for usable, bw in MACHINES.values():
            fit = ("fits" if w + kv_gb(m, False) <= usable else
                   "window" if w + kv_gb(m, True) <= usable else "no")
            cells.append(f"{fit:>6} {bw / (w * 1e9):4.0f}/s" if fit != "no" else f"{'no':>13}")
        print(f"{m + ' ' + q:<12} {w:6.2f}  " + " ".join(f"{c:>13}" for c in cells))

PREFILL = {"CPU, 1 TFLOP/s": 1e12, "laptop GPU, 10 TFLOP/s": 10e12, "L40S at MFU 0.5": 181e12}
flops = 2 * 10.758e9                        # 12B matmul FLOPs per prompt token (attention ignored)
print("\n12B prompt processing (effective rates ILLUSTRATIVE except L40S):")
for name, rate in PREFILL.items():
    print(f"  {name:<24} 1,024 tokens {1024 * flops / rate:6.2f} s;"
          f" 256 new after a cached 768 {256 * flops / rate:6.2f} s")
```

```output
KV at 8192 tokens, f16 (window-aware .. all layers): 1B 0.05..0.22 GB; 12B 0.87..3.22 GB; 27B 1.11..4.16 GB

model quant      GB    16GB laptop  32GB unified  64GB unified          L40S
1B F16         2.00    fits   50/s   fits  100/s   fits  200/s   fits  432/s
1B Q8_0        1.06    fits   94/s   fits  188/s   fits  376/s   fits  813/s
1B Q6_K        0.82    fits  122/s   fits  244/s   fits  488/s   fits 1053/s
1B Q4_K_M      0.61    fits  165/s   fits  330/s   fits  660/s   fits 1425/s
1B Q4_0        0.56    fits  178/s   fits  356/s   fits  711/s   fits 1536/s
12B F16       23.53             no            no   fits   17/s   fits   37/s
12B Q8_0      12.50             no   fits   16/s   fits   32/s   fits   69/s
12B Q6_K       9.65  window   10/s   fits   21/s   fits   41/s   fits   90/s
12B Q4_K_M     7.13    fits   14/s   fits   28/s   fits   56/s   fits  121/s
12B Q4_0       6.62    fits   15/s   fits   30/s   fits   60/s   fits  131/s
27B F16       54.02             no            no            no            no
27B Q8_0      28.70             no            no   fits   14/s   fits   30/s
27B Q6_K      22.16             no            no   fits   18/s   fits   39/s
27B Q4_K_M    16.37             no   fits   12/s   fits   24/s   fits   53/s
27B Q4_0      15.19             no   fits   13/s   fits   26/s   fits   57/s

12B prompt processing (effective rates ILLUSTRATIVE except L40S):
  CPU, 1 TFLOP/s           1,024 tokens  22.03 s; 256 new after a cached 768   5.51 s
  laptop GPU, 10 TFLOP/s   1,024 tokens   2.20 s; 256 new after a cached 768   0.55 s
  L40S at MFU 0.5          1,024 tokens   0.12 s; 256 new after a cached 768   0.03 s
```

:::chart[GGUF file size by quant type — Gemma 3 text weights]{type="bar" x="GGUF quant type" y="file size" unit=" GB" yfmt="dec1" hmarks="11:16 GB laptop;22:32 GB unified;43.5:L40S" note="Bits per weight 16, 8.5, 6.5625, about 4.85, 4.5. Usable budgets illustrative. Add the KV cache and, for 12B and 27B images, a vision projector of about 0.84 GB at f16."}
quant, 1B, 12B, 27B
F16, 2.00, 23.53, 54.02
Q8_0, 1.06, 12.50, 28.70
Q6_K, 0.82, 9.65, 22.16
Q4_K_M, 0.61, 7.13, 16.37
Q4_0, 0.56, 6.62, 15.19
:::

:::chart[Decode ceiling for Gemma 3 12B vs bits per weight — bandwidth ÷ bytes, batch 1]{type="line" x="bits per weight" y="tokens per second" yfmt="int" ylog="true" points="true" hmarks="20:HelpDesk TPOT SLO (50 ms)" note="Upper bound: weights only, no KV read, perfect bandwidth. Laptop bandwidths illustrative; L40S 864 GB/s spec. A gap means weights plus 8k of window-aware KV do not fit."}
bits per weight, 16GB laptop, 32GB unified, 64GB unified, L40S
16, , , 17.0, 36.7
8.5, , 16.0, 32.0, 69.1
6.5625, 10.4, 20.7, 41.4, 89.5
4.85, 14.0, 28.0, 56.1, 121.1
4.5, 15.1, 30.2, 60.4, 130.6
:::

:::example[Worked example · Gemma 3 12B on an engineer's 16 GB laptop]
- **File:** \(11.765\text{B} \times 4.85 / 8\) = **7.13 GB** at Q4_K_M. Add 8,192 tokens of f16 KV: 0.87 GB if the runtime is window-aware, 3.22 GB if not. 10.35 GB at worst, inside the illustrative 11 GB budget. Q8_0 (12.50 GB) does not fit at all.
- **Decode ceiling:** 100 GB/s ÷ 7.13 GB = **14 tokens/s**, about 71 ms per token — over the 50 ms HelpDesk TPOT SLO before any KV read. Fine for testing prompts, not for serving users.
- **The number users feel is TTFT.** A 1,024-token HelpDesk prompt is \(1{,}024 \times 21.5\) GFLOP = 22 TFLOP. At an illustrative 1 TFLOP/s on CPU cores that is **22 s**; at 10 TFLOP/s on the laptop's GPU, 2.2 s. llama.cpp keeps the previous prompt's KV and reports a prefix-match hit when the next prompt starts the same way, so with the 768-token system prompt reused only 256 tokens are new: 5.5 s and 0.55 s.
- **27B** needs the 32 GB machine at Q4_K_M (16.37 GB, 12 tokens/s), and the 1B at Q4_K_M is 0.61 GB — small enough for a phone-class device.
:::

Two GGUF-specific details matter for Gemma 3. The 12B and 27B accept images; in GGUF form the vision tower ships as a separate projector file, about 0.84 GB at f16 for a ~0.42B-parameter tower. And the llama-cpp-python constructor takes an `n_ctx` argument whose default has historically been far below Gemma 3's 32k (1B) and 128k (12B, 27B) windows — set it explicitly, and size the KV for the value you set.

## 10.4 SGLang and RadixAttention: reuse that follows the conversation

[§8.6](/c/llm-serving/08-essential-techniques) derived what the 768-token shared system prompt saves on a single HelpDesk call: prefill falls from 22.4 to 5.7 TFLOP, and every engine with a prefix cache gets that. SGLang's RadixAttention stores the cache as a radix tree of token sequences: every request inserts its prompt *and its generated tokens* as a path, a new request walks the tree to its longest match, and eviction removes least-recently-used leaves first, so shared trunks outlive individual branches. The scheduler can also order queued requests to maximise hits.

The difference shows on multi-turn traffic. Take an illustrative HelpDesk variant: 4 turns per conversation, each turn adding 256 user tokens, each answer 256 tokens, so turn \(t\) has a prompt of \(1{,}024 + 512\,(t-1)\) tokens. vLLM's hashed blocks can hit on the history too; what decides the saving is whether a conversation's branch is still cached when the next turn arrives.

```python run
"""RadixAttention on a multi-turn HelpDesk variant: prefill per scheme, and memory to keep branches warm."""
BODY, FLOPS = 10_758_389_760, 362e12 * 0.5      # Gemma 3 12B; MFU 0.5 is ILLUSTRATIVE
KV_TOK = 393_216                                 # bf16 KV per token, all layers
SHARED, USER, ANSWER, TURNS = 768, 256, 256, 4   # multi-turn variant: ILLUSTRATIVE


def flops(start, end):
    """Matmul + attention FLOPs to prefill positions start..end-1."""
    att = sum(8 * (i + 1) + 40 * min(i + 1, 1024) for i in range(start, end)) * 4 * 16 * 256
    return (end - start) * 2 * BODY + att


prompts = [SHARED + USER + t * (USER + ANSWER) for t in range(TURNS)]
schemes = {"no prefix reuse": lambda t, p: 0,
           "system prompt only": lambda t, p: SHARED,          # history evicted between turns
           "full history reused": lambda t, p: p - USER}       # branch (incl. last answer) warm
print("prompt tokens per turn:", ", ".join(map(str, prompts)))
print(f"{'scheme':<24} {'tokens':>6} {'TFLOP':>6} {'turn-4 prefill':>14}")
for name, cached in schemes.items():
    toks = sum(p - cached(t, p) for t, p in enumerate(prompts))
    tf = sum(flops(cached(t, p), p) for t, p in enumerate(prompts))
    last = flops(cached(TURNS - 1, prompts[-1]), prompts[-1]) / FLOPS * 1e3
    print(f"{name:<24} {toks:6d} {tf / 1e12:6.1f} {last:11.0f} ms")

RATE, TURN_S = 10, 40                     # req/s; think time + answer per turn, s: ILLUSTRATIVE
live = (RATE / TURNS) * (TURNS * TURN_S)  # Little's law: arrivals x lifetime
branch = sum(t * (USER + ANSWER) + USER for t in range(TURNS)) / TURNS   # mean own tokens
need = live * branch * KV_TOK / 2**30
print(f"\nlive conversations {live:.0f}, mean branch {branch:.0f} tokens -> {need:.0f} GiB of KV"
      f" to keep every branch warm (int4 GPU pool: 31.29 GiB)")
```

```output
prompt tokens per turn: 1024, 1536, 2048, 2560
scheme                   tokens  TFLOP turn-4 prefill
no prefix reuse            7168  158.6         314 ms
system prompt only         4096   91.6         222 ms
full history reused        1024   22.9          32 ms

live conversations 400, mean branch 1024 tokens -> 150 GiB of KV to keep every branch warm (int4 GPU pool: 31.29 GiB)
```

:::chart[Prompt tokens prefilled per turn — 4-turn HelpDesk variant, Gemma 3 12B]{type="bar" x="turn" y="tokens prefilled" yfmt="int" labels="true" note="Illustrative conversation: 768 shared tokens, 256 user tokens per turn, 256-token answers."}
turn, no prefix reuse, system prompt only, full history reused
turn 1, 1024, 256, 256
turn 2, 1536, 768, 256
turn 3, 2048, 1280, 256
turn 4, 2560, 1792, 256
:::

:::example[Worked example · what the tree buys, and what it costs to keep]
- **Prefill:** over a 4-turn conversation the system-prompt cache cuts prefilled tokens from 7,168 to 4,096; keeping each conversation's branch cuts them to **1,024** — 158.6 TFLOP down to 22.9, and the fourth turn's prefill from 314 ms to 32 ms on one L40S at the illustrative MFU.
- **Memory:** at 10 req/s and an illustrative 40 s per turn (reading, typing, answering), Little's law gives \(2.5 \times 160\) = **400** live conversations, each holding about 1,024 tokens of its own: **150 GiB** of KV. The int4 12B pool on one L40S is 31.29 GiB.
- **So:** a GPU-only tree keeps the trunk and only the most recent branches; most conversations come back to find their branch evicted and pay the 222 ms path. A host-memory KV tier ([§9.5](/c/llm-serving/09-advanced-techniques)) holding the branches turns that into a 12–64 ms load.
:::

## 10.5 TensorRT-LLM: when does compiling ahead pay?

TensorRT-LLM builds an engine for one GPU architecture, precision, maximum batch and maximum sequence length, with kernels and fusions chosen for that combination. The notebook's `LLM(...)` call hides the build inside model loading, but not its cost: change the model, the GPU type, the quantisation or the length limits, and the engine is rebuilt and re-validated. Whether that pays is a break-even between a fixed cost per rebuild and a saving proportional to the busy GPUs the speed-up frees:

$$
G_{\text{break-even}} = \frac{r \times (h_{\text{GPU}}\,p_{\text{GPU}} + h_{\text{eng}}\,p_{\text{eng}})}{730 \times p_{\text{GPU}} \times \left(1 - \frac{1}{1+g}\right)},
$$

with \(r\) rebuilds a month, \(g\) the throughput gain, and 730 hours a month. Every input below is illustrative — the gain especially; measure it on your model.

```python run
"""Compile-ahead engines: how many busy GPUs before a faster compiled engine pays for its rebuilds?"""
GPU_HOUR, ENG_HOUR = 2.00, 100.0          # $/hour: ILLUSTRATIVE
BUILD_GPU_H, BUILD_ENG_H = 0.5, 4.0       # per rebuild (compile + validate): ILLUSTRATIVE
per_rebuild = BUILD_GPU_H * GPU_HOUR + BUILD_ENG_H * ENG_HOUR
print(f"cost per rebuild ${per_rebuild:.0f}")
print("throughput gain, saved per busy GPU-month, break-even busy GPUs at 1 / 4 / 20 rebuilds a month")
for gain in (0.05, 0.15, 0.30):
    saved = 730 * GPU_HOUR * (1 - 1 / (1 + gain))   # same traffic on fewer GPU-hours
    print(f"{gain:4.0%}, ${saved:5.0f}, " + ", ".join(f"{r * per_rebuild / saved:5.1f}" for r in (1, 4, 20)))
```

```output
cost per rebuild $401
throughput gain, saved per busy GPU-month, break-even busy GPUs at 1 / 4 / 20 rebuilds a month
  5%, $   70,   5.8,  23.1, 115.4
 15%, $  190,   2.1,   8.4,  42.1
 30%, $  337,   1.2,   4.8,  23.8
```

:::chart[Busy GPUs needed before a compiled engine pays — by rebuild rate and speed-up]{type="line" x="rebuilds per month" y="break-even busy GPUs" yfmt="dec1" xlog="true" ylog="true" points="true" hmarks="2:HelpDesk peak fleet" note="L40S at $2.00 per GPU-hour, 0.5 GPU-hours and 4 engineer-hours at $100 per rebuild: all illustrative."}
rebuilds per month, 5% gain, 15% gain, 30% gain
1, 5.8, 2.1, 1.2
2, 11.5, 4.2, 2.4
4, 23.1, 8.4, 4.8
8, 46.1, 16.8, 9.5
16, 92.3, 33.7, 19.0
30, 173.0, 63.2, 35.7
:::

:::example[Worked example · should HelpDesk compile its engine?]
- **Rebuild:** 0.5 GPU-hours × $2.00 + 4 engineer-hours × $100 = **$401**, almost all of it people.
- **Saving:** a 15% throughput gain serves the same traffic on \(1/1.15\) of the GPU-hours, saving 13.0% of \(730 \times\) $2.00 = **$190** per busy GPU per month.
- **Break-even:** at 4 rebuilds a month (a prompt-format change, two engine upgrades, a quantisation trial), \(4 \times 401 / 190\) = **8.4 busy GPUs**. The HelpDesk peak runs on 2 L40S. Compile-ahead pays here only if the gain is large and rebuilds are rare: 30% and one rebuild a month breaks even at 1.2 GPUs.
- **Read the shape, not the point:** the break-even scales with rebuild rate and inversely with gain, so a fixed model on a large, stable fleet is TensorRT-LLM's home ground.
:::

## 10.6 Choosing

| Situation | Choose | Number that decides it |
| --- | --- | --- |
| Must run on a laptop, CPU or Apple-silicon-class machine, one user | llama.cpp with GGUF | 12B Q4_K_M is 7.13 GB, ~14 tokens/s at 100 GB/s; prefill, not decode, sets TTFT |
| Default GPU serving; models and engines change often | vLLM | No compile step; paged KV and prefix caching ([§8.5](/c/llm-serving/08-essential-techniques)) |
| Multi-turn or agent traffic with long shared histories | SGLang | 7,168 → 1,024 prefilled tokens per 4-turn conversation if branches stay cached |
| One model on a fixed NVIDIA fleet, rare rebuilds | TensorRT-LLM | Pays above \(G_{\text{break-even}}\): 8.4 busy GPUs at 15% gain and 4 rebuilds a month |
| Draft model, edge device or test fixture | llama.cpp or any engine | Gemma 3 1B at Q4_K_M is 0.61 GB |

:::warn[Failure modes]
- **Comparing frameworks with different defaults.** Quantisation, KV dtype, maximum batch, chat template and sampling settings all move the numbers more than the engine does. Fix them, then measure the [§2](/c/llm-serving/02-benchmarks) metrics on the same traffic.
- **Weights plus KV exceed RAM on a laptop.** The OS swaps, and decode falls to SSD bandwidth: 7.13 GB ÷ an illustrative 5 GB/s is 1.4 s per token. Check resident memory, not file size.
- **The wrong chat template.** A GGUF carries its template in metadata, and a mismatch with Gemma's turn markers degrades answers without raising an error. Diff the rendered prompt against the reference template once.
- **A compiled engine built with a maximum length below production prompts** rejects or truncates them; the fix is a rebuild, which is exactly the cost §10.5 counts.
- **Prefix reuse broken by the prompt itself** — a timestamp or request id ahead of the shared part defeats every framework's cache equally ([§8.6](/c/llm-serving/08-essential-techniques)).
:::

## 10.7 Check yourself

:::qa[Does Gemma 3 27B at Q6_K fit the 32 GB unified-memory laptop, and what decode ceiling does the 64 GB machine give?]
The file is \(27.008 \times 6.5625 / 8\) = 22.16 GB, already above the illustrative 22 GB budget before any KV, so no. On the 64 GB machine it fits with 8k of KV (1.11–4.16 GB), and the ceiling is 400 GB/s ÷ 22.16 GB = 18 tokens/s.
:::

:::qa[A teammate reports 40 tokens/s for Gemma 3 12B Q8_0 on a 200 GB/s laptop. Is that plausible?]
No. Q8_0 is 12.50 GB, and every token reads all of it: 200 ÷ 12.50 = 16 tokens/s is the ceiling. 40 tokens/s means a smaller file (a lower quant or the 1B), a cached response, or a measurement that counts prompt tokens as output.
:::

:::qa[Why is TTFT, not TPOT, the problem when the HelpDesk prompt runs on CPU cores?]
Decode needs bytes: 7.13 GB per token at 100 GB/s is 71 ms. Prefill needs FLOPs: 1,024 tokens × 21.5 GFLOP = 22 TFLOP, 22 s at an illustrative 1 TFLOP/s. Reusing the 768-token prefix cuts it to 5.5 s, which is why llama.cpp's prefix match matters more on a laptop than on a GPU.
:::

:::qa[In the 4-turn variant, what happens to prefill when conversations' branches are evicted between turns, and what would it take to avoid that?]
Each conversation falls from 1,024 to 4,096 prefilled tokens (91.6 instead of 22.9 TFLOP), and turn 4 waits 222 ms instead of 32 ms. Keeping every branch needs about 150 GiB of KV for 400 live conversations — five times the 31.29 GiB GPU pool — so the branches belong in a host-memory tier.
:::

:::qa[With a 30% compiled-engine gain and 20 rebuilds a month, how many busy GPUs before TensorRT-LLM pays?]
\(20 \times 401 / 337\) = 23.8 busy GPUs. A frequently changing model needs a large fleet before compile-ahead beats a framework that loads weights directly.
:::

Next: [Chapter 9 — In practice](/c/llm-serving/11-in-practice).
