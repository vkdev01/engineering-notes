---
section: "6"
title: "Chapter 4 \u2014 Best practices"
kicker: "Chapter notes"
abstract: "A working agent read as a serving client, the arithmetic of agent traffic (latency that adds across calls, prefill that prefix caching removes), the four-rung AWS build-or-buy ladder, a break-even utilisation for self-hosting Gemma 3 12B, and what each latency number actually includes."
time: "16 min"
order: 6
outcomes:
  - "Compute end-to-end latency and GPU-seconds for an 8-call agent task, with and without prefix caching"
  - "Size the per-call tail you need for a task-level p99"
  - "Place a deployment on the build-or-buy ladder and compute its break-even utilisation against a managed per-token price"
  - "Compare a managed latency with a self-hosted one without counting the queue on only one side"
---
**Covers:** serving in an agentic world (agents, RAG, CAG), enterprise serving architecture, open-source stack versus cloud vendor, build-or-buy, performance measurement.

The HelpDesk team adds an agent: each support ticket becomes 8 sequential Gemma 3 12B calls with a prompt that starts near 1,500 tokens and grows every step, and 60-token outputs (the agent variant of the running example, illustrative). Two questions land at once. What does one task cost in seconds and GPU time on the L40S from [chapter 3](/c/llm-serving/05-system-design)? And should the team host this at all, or call a managed endpoint? Both have arithmetic answers.

:::key[First principle]
An agent is a serving client whose calls are sequential and whose prompts are mostly text the server has already seen. Latency adds across calls, tails compound across calls, and most GPU time goes to re-reading the prompt unless the prefix is cached. Whether to build or buy is a utilisation question: a GPU-hour costs the same whether it is busy or not.
:::

## 6.1 What is in the repository

A working agent and four AWS deployment examples.

| Path | What it is |
| --- | --- |
| `ch04/KnowledgeAgent/` | A RAG-plus-planning agent: `agent.py`, `planner.py`, `rag_system.py`, `actions.py`, `llm_manager.py`, plus a `knowledge_files/` corpus of PDFs and its own tests |
| `ch04/bedrock/aws_bedrock_examples.ipynb` | Calling a managed model through `boto3` and a Bedrock model id (the notebook uses an Anthropic Claude model) |
| `ch04/jumpstart/aws_jumpstart.ipynb` | Deploying a model through SageMaker JumpStart's `JumpStartModel` |
| `ch04/dlc/aws_dlc_serving.ipynb` | Two container routes: TorchServe for a self-built PyTorch model, and an AWS DJL image running vLLM for an LLM |
| `ch04/dlc_customization/aws_dlc_serving_customization.ipynb` | Writing your own `model.py` and `requirements.txt`, packaging them, uploading to S3, and deploying on the DJL container |

## 6.2 The agent, read as a serving client

`ch04/KnowledgeAgent/` is the only place in the repository where a *client* of a model is the subject. Its file split is the right one:

- `planner.py` decides what to do next
- `rag_system.py` retrieves context from `knowledge_files/`
- `actions.py` holds the things the agent can do
- `llm_manager.py` talks to the model — the only file that changes when you swap providers or move from self-hosted to managed
- `agent.py` is the loop that ties them together

:::mermaid[One agent task: every arrow back to the model is another full call]
flowchart LR
    U[ticket] --> P[planner.py]
    P --> R[rag_system.py]
    R --> L[llm_manager.py<br/>model call]
    L --> A[actions.py<br/>tool call]
    A --> P
    L --> D[answer]
:::

`llm_manager.py` is also where serving behaviour is decided from the client side: which prefix is sent verbatim on every call, whether history is appended or rewritten, and what timeout and retry policy wraps each call.

## 6.3 Agent traffic: latency adds, tails compound, prefill dominates

For a task of $n$ sequential calls with output $o$ tokens each, nothing overlaps:

$$
T_{\text{task}} = \sum_{k=1}^{n} \Big( Q_k + \text{TTFT}_k + (o - 1)\,\text{TPOT}_k \Big) + \sum_{k=1}^{n-1} T_{\text{tool},k}
$$

where $Q_k$ is queue wait. Prefill work depends on what the server can reuse. If history is append-only, call $k$'s prompt $p_k$ starts with call $k-1$'s prompt, so a prefix cache only has to prefill $p_k - p_{k-1}$ new tokens — and on the first call everything after the 768-token shared system prompt and tool schema.

:::example[Worked example · prefill tokens for one task]
Prompts grow by about 200 tokens per step (60 output plus a tool result, illustrative): 1,500, 1,700, …, 2,900.

**No cache.** \(\sum p_k = 8 \times 1{,}500 + 200 \times (0 + 1 + \dots + 7)\) = 12,000 + 5,600 = 17,600 prefill tokens.

**Prefix cache.** \((1{,}500 - 768) + 7 \times 200\) = 732 + 1,400 = 2,132 tokens — 87.9% fewer.

Against 480 output tokens, the uncached task prefills 36.7 tokens per output token; the HelpDesk chat workload prefills \(1{,}024 / 256\) = 4.
:::

The script prices the task on the floor model from [chapter 3](/c/llm-serving/05-system-design): prefill at the compute floor (21.5 GFLOP per token ÷ 362 TFLOPS), decode at the memory-bound step for a server running 16 sequences (illustrative), and 250 ms per tool call (illustrative).

```python run
"""Agent task: 8 sequential Gemma 3 12B calls. Latency adds up; prefix caching cuts prefill."""
W, KV_TOK, BW, PEAK, FLOP_TOK = 23.53e9, 393_216, 864e9, 362e12, 21.5e9
CALLS, OUT, SHARED, B = 8, 60, 768, 16       # B = batch the server runs at (illustrative)
TOOL_S = 0.25                                # tool execution between calls (illustrative)
prompts = [1500 + 200 * k for k in range(CALLS)]   # history grows ~200 tokens per step


def tpot(ctx):
    return (W + B * ctx * KV_TOK) / BW       # memory-bound decode step at batch B


def task(cached):
    new = [p - SHARED if k == 0 else p - prompts[k - 1] for k, p in enumerate(prompts)] \
        if cached else prompts
    prefill = sum(new) * FLOP_TOK / PEAK     # compute floor for the uncached tokens
    decode = sum((OUT - 1) * tpot(p + OUT // 2) for p in prompts)
    return sum(new), prefill, decode


for cached in (False, True):
    toks, pre, dec = task(cached)
    wall = pre + dec + (CALLS - 1) * TOOL_S
    gpu = pre + sum(OUT * tpot(p + OUT // 2) / B for p in prompts)  # this task's GPU-seconds
    print("%-15s prefill %6d tok %5.2f s | decode %5.2f s | end-to-end %5.2f s | "
          "GPU-s %4.2f (prefill share %3.0f%%)" % ("prefix cache" if cached else "no cache",
                                                   toks, pre, dec, wall, gpu, 100 * pre / gpu))
print("prefill tokens per output token: %.1f" % (sum(prompts) / (CALLS * OUT)))
for p_tail in (0.01, 0.001):
    print("P(at least one of %d calls lands beyond its %.1f%% tail) = %.1f%%"
          % (CALLS, 100 * (1 - p_tail), 100 * (1 - (1 - p_tail) ** CALLS)))
```

```output
no cache        prefill  17600 tok  1.05 s | decode 20.52 s | end-to-end 23.31 s | GPU-s 2.35 (prefill share  44%)
prefix cache    prefill   2132 tok  0.13 s | decode 20.52 s | end-to-end 22.40 s | GPU-s 1.43 (prefill share   9%)
prefill tokens per output token: 36.7
P(at least one of 8 calls lands beyond its 99.0% tail) = 7.7%
P(at least one of 8 calls lands beyond its 99.9% tail) = 0.8%
```

What the numbers say — including one correction to the usual story:

- **The user waits on decode, not prefill.** 472 decode steps (8 calls × 59) take 20.5 s of the 23.3 s task; prefill is about a second even uncached. The wall-clock levers are TPOT and the number of calls: quantisation, a smaller model, speculative decoding with Gemma 3 1B as the draft ([chapter 7](/c/llm-serving/09-advanced-techniques)), or fewer planner steps. TTFT dominates a single call only once queue wait $Q_k$ grows.
- **The GPU pays for prefill.** Without caching, prefill is 44% of the task's 2.35 GPU-seconds; with a prefix cache it is 9% of 1.43. Same hardware, \(2.35 / 1.43\) = 1.64× more tasks per GPU. That is why agent workloads reward prefix caching: it buys capacity first and latency second.
- **Tails compound.** If each call independently has a 1% chance of a slow outlier, 7.7% of tasks contain one. To hold a task-level p99 you need roughly per-call p99.9 inside the budget (0.8% of tasks affected).

:::warn[Prefix caching needs byte-identical prefixes]
The cache matches tokens from the start of the prompt. A timestamp, a request id or a reordered tool list near the top changes every token after it and silently turns a 2,132-token prefill back into 17,600. Put volatile fields at the end, keep the system prompt and tool schema stable, and append history instead of rewriting it. Check the engine's prefix-cache hit-rate metric after any prompt change.
:::

## 6.4 The build-or-buy ladder, as four notebooks

The four AWS notebooks form a ladder from least to most control:

| Rung | Notebook | You own | The provider owns |
| --- | --- | --- | --- |
| 1. Managed API | Bedrock | The request and the bill | Model, runtime, hardware, scaling, queue |
| 2. Packaged model | JumpStart | Instance choice, endpoint config | Packaging and serving container |
| 3. Managed container | DLC with TorchServe or DJL (vLLM) | Model artefacts, engine flags | Container image, instance lifecycle |
| 4. Custom container | DLC customisation | `model.py`, dependencies, the serving logic | Hardware and orchestration |

Each rung trades operational work for control — over the model weights (fine-tunes, quantisation), over engine flags (`--gpu-memory-utilization`, `--max-model-len`, prefix caching), and over where the queue lives. The notebooks are deliberately trimmed (`the sample code are compiled from AWS tutorial, to show the concept clearly, we trim lots of setup code`); they illustrate the decision rather than a deployable stack. From rung 2 up you pay per instance-hour, so the question in §6.5 applies.

## 6.5 Build versus buy: the break-even utilisation

A managed API charges per token; a self-hosted GPU charges per hour whether it serves or idles. With GPU price $g$ per hour, floor capacity $R$ requests/s, an achieved fraction $a$ of that floor, utilisation $u$ and $m$ tokens per request:

$$
\text{cost per 1M tokens} = \frac{g}{3600 \cdot R \cdot a \cdot u \cdot m} \times 10^6,
\qquad
u_{\text{break-even}} = \frac{\text{self-hosted cost at } u = 1}{\text{managed price}}.
$$

$R$ comes from chapter 3's floor model: per request, prefill the 256 uncached prompt tokens and occupy a decode slot for 256 steps. $B$ is capped by the KV pool.

:::example[Worked example · Gemma 3 12B bf16 on one L40S]
KV pool 16.58 GiB → B = 35, step 45.6 ms. Per request: \(256 \times 59.4\) µs = 15.2 ms of prefill plus 256 steps × 45.6 ms ÷ 35 sequences ≈ 333 ms of decode slot time, ≈ 349 ms in all → 2.87 req/s at the floor. At an achieved 60% (illustrative), 1.72 req/s × 1,280 tokens ≈ 2,200 tokens/s, 7.93M tokens per hour. At $2.00 per GPU-hour (illustrative): \(2.00 / 7.93\) = **$0.252 per 1M tokens at 100% utilisation**.

The managed price, illustrative: $0.10 per 1M input and $0.40 per 1M output tokens. Blended over HelpDesk's 1,024 in and 256 out: \((1{,}024 \times 0.10 + 256 \times 0.40) / 1{,}280\) = **$0.160 per 1M tokens**.

Break-even \(0.252 / 0.160\) = 158%: at these prices self-hosting bf16 never pays.
:::

```python run
"""Build vs buy: self-hosted cost per 1M tokens at utilisation u vs a managed price."""
GiB, MiB = 2**30, 2**20
BW, PEAK, FLOP_TOK, KV_TOK = 864e9, 362e12, 21.5e9, 393_216
GPU_HOUR = 2.00                    # L40S, $/GPU-hour (illustrative)
ACHIEVED = 0.6                     # share of the model's floor capacity reached (illustrative)
PRICE_IN, PRICE_OUT = 0.10, 0.40   # managed $/1M input and output tokens (illustrative)
IN, OUT, NEW_IN = 1024, 256, 256   # HelpDesk request; 768 prompt tokens hit the prefix cache

managed = (IN * PRICE_IN + OUT * PRICE_OUT) / (IN + OUT)    # blended $/1M tokens


def capacity(weights):
    """Requests/s one L40S sustains at the floor, batch capped by the KV pool."""
    pool = 46_068 * MiB * 0.90 - weights - 2 * GiB
    b = int(pool // ((IN + OUT) * KV_TOK))
    step = (weights + b * (IN + OUT // 2) * KV_TOK) / BW
    per_req = NEW_IN * FLOP_TOK / PEAK + OUT * step / b      # GPU-seconds per request
    return b, step, 1 / per_req


def cost_per_m(weights, u):
    tok_per_s = capacity(weights)[2] * ACHIEVED * u * (IN + OUT)
    return GPU_HOUR / 3600 / tok_per_s * 1e6


print("managed, blended for the HelpDesk mix: $%.3f per 1M tokens" % managed)
for name, w in (("bf16", 23.53e9), ("int4", 7.73e9)):
    b, step, r = capacity(w)
    full = cost_per_m(w, 1.0)
    print("%s: batch %d, step %.1f ms, %.2f req/s floor, %.2f req/s achieved, "
          "$%.3f/1M at u=100%%, break-even u = %.0f%%"
          % (name, b, step * 1e3, r, r * ACHIEVED, full, 100 * full / managed))
print()
print("utilisation, self-hosted bf16, self-hosted int4, managed")
for u in (0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0):
    print("%.2f, %.3f, %.3f, %.3f" % (u, cost_per_m(23.53e9, u), cost_per_m(7.73e9, u), managed))
```

```output
managed, blended for the HelpDesk mix: $0.160 per 1M tokens
bf16: batch 35, step 45.6 ms, 2.87 req/s floor, 1.72 req/s achieved, $0.252/1M at u=100%, break-even u = 158%
int4: batch 66, step 43.5 ms, 5.43 req/s floor, 3.26 req/s achieved, $0.133/1M at u=100%, break-even u = 83%

utilisation, self-hosted bf16, self-hosted int4, managed
0.05, 5.044, 2.664, 0.160
0.10, 2.522, 1.332, 0.160
0.15, 1.681, 0.888, 0.160
0.20, 1.261, 0.666, 0.160
0.30, 0.841, 0.444, 0.160
0.40, 0.630, 0.333, 0.160
0.50, 0.504, 0.266, 0.160
0.60, 0.420, 0.222, 0.160
0.70, 0.360, 0.190, 0.160
0.80, 0.315, 0.166, 0.160
0.90, 0.280, 0.148, 0.160
1.00, 0.252, 0.133, 0.160
```

:::chart[Cost per 1M tokens vs GPU utilisation — self-hosted Gemma 3 12B on one L40S against a managed price (all prices illustrative)]{type="line" x="GPU utilisation" y="cost per 1M tokens" prefix="$" xfmt="pct" ylog="true" marks="0.83:int4 break-even" dash="managed"}
utilisation, self-hosted bf16, self-hosted int4, managed
0.05, 5.044, 2.664, 0.160
0.10, 2.522, 1.332, 0.160
0.15, 1.681, 0.888, 0.160
0.20, 1.261, 0.666, 0.160
0.30, 0.841, 0.444, 0.160
0.40, 0.630, 0.333, 0.160
0.50, 0.504, 0.266, 0.160
0.60, 0.420, 0.222, 0.160
0.70, 0.360, 0.190, 0.160
0.80, 0.315, 0.166, 0.160
0.90, 0.280, 0.148, 0.160
1.00, 0.252, 0.133, 0.160
:::

Reading the curve:

- **Cost scales as \(1/u\).** Halving utilisation doubles the price of every token. At 30% utilisation — common for interactive traffic with a daily peak — int4 costs $0.444 per 1M, 2.8× the managed price.
- **Quantisation moves the break-even, not the shape.** int4 frees KV pool (B = 66 instead of 35) and nearly doubles floor capacity, so its break-even drops from 158% to 83%. Even so, it needs a GPU busy most of the day.
- **The model leaves costs out on purpose.** No engineering or on-call time, no idle replicas for redundancy, no cached-input discount on the managed side. Each moves the break-even further right. The break-even also scales directly with your GPU price and inversely with the managed price: halve the managed price and int4's break-even passes 100%.

:::tip[When building wins anyway]
Self-host when the deciding factor is not price per token: weights you must control (fine-tunes, a specific quantisation), data that cannot leave your network, latency you must own end to end, or volume steady enough to keep utilisation above the break-even. Otherwise start on rung 1 and move up the ladder when one of those becomes true.
:::

## 6.6 Measured against what?

The measurement discipline — `vllm bench serve`, throughput, TTFT, TPOT, p99 — lives in chapters 6 and 9 ([benchmark method](/c/llm-serving/15-benchmark-method)). What chapter 4 adds is the framing question: which segments of the request does each number contain?

| Segment | Managed endpoint, provider metric | Self-hosted, `vllm bench serve` | Client-side timestamps |
| --- | --- | --- | --- |
| Your gateway, rate-limit retries, 429 back-off | no | no | yes |
| Network round trip | no | partly (benchmark host to server) | yes |
| Server queue wait | provider's, opaque | yes (your scheduler) | yes |
| Prefill, decode | yes | yes | yes |

A managed number that starts when the provider accepts the request excludes the queue you built in front of it; a self-hosted benchmark includes your scheduler's queue. Compare like with like: client-side timestamps (arrival, first token, last token) for both, the same prompts, the same concurrency.

Sanity-check any closed-loop benchmark with Little's law: with $C$ clients and no think time, throughput ≈ \(C / (\text{TTFT} + \text{TPOT} \times (o - 1))\). For 16 HelpDesk clients at TTFT 0.2 s (illustrative) and the 45.6 ms TPOT from chapter 3: \(16 / (0.2 + 0.0456 \times 255)\) = \(16 / 11.83\) = 1.35 req/s. A report that claims much more at those latencies measured something else.

## 6.7 Check yourself

:::qa[Which KnowledgeAgent file changes when you move from a managed API to a self-hosted Gemma 3 endpoint, and what else should it own?]
`llm_manager.py`. Besides the provider client it should own the stable prompt prefix (so the prefix cache keeps hitting), the append-only history, and the per-call timeout and retry policy — the client-side decisions that set the server's traffic shape.
:::

:::qa[The agent's system prompt gains a timestamp on its first line. What happens to prefill per task?]
Every call's prompt now differs from the first token, so nothing is reused: prefill goes from 2,132 to 17,600 tokens per task, and the task's GPU-seconds from 1.43 to 2.35 in the floor model — 39% fewer tasks per GPU. Wall-clock time barely moves (22.4 s to 23.3 s), which is why this regression hides in latency dashboards and shows up in the GPU bill.
:::

:::qa[Each call has p99 latency of 3 s. Is the task-level p99 about 8 × 3 s?]
No. A task contains a per-call p99 outlier 7.7% of the time, so the task-level p99 is set by the per-call p99.9 (0.8% of tasks) plus seven typical calls. Budget the per-call p99.9.
:::

:::qa[Name the rung where you stop controlling the model and start controlling only the container, and what you gain by climbing one more.]
Rung 3 (DLC with TorchServe or DJL): you supply model artefacts and engine flags to a container image you did not write. Rung 4 (DLC customisation) adds your own `model.py` and dependencies — control over the serving logic itself.
:::

:::qa[With the illustrative prices, at what utilisation does self-hosted int4 Gemma 3 12B match the managed price, and what if the GPU costs $1.50 per hour?]
83%. Cost scales linearly with the GPU price, so at $1.50 the cost at full utilisation is \(0.133 \times 1.50 / 2.00\) = $0.100 per 1M, and break-even falls to \(0.100 / 0.160\) ≈ 62%.
:::

Next: [Chapter 5 — Challenges](/c/llm-serving/07-challenges).
