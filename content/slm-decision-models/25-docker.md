---
section: "25"
title: "Docker"
kicker: "Deployment"
abstract: "Package a decision model as a small, pinned, non-root image: size it from params × bytes, predict cold start as pull + load + warm-up, set the memory limit from weights + KV cache, and gate traffic on a readiness check that proves the model decides."
time: "14 min"
order: 25
outcomes:
  - "Compute image and weight sizes from parameters × bytes per weight, and know why weights barely compress"
  - "Predict cold start on a cold and a warm node from pull, extract, load and warm-up rates"
  - "Set a container memory limit from weights, runtime and KV cache instead of guessing"
  - "Write a pinned, non-root, read-only image whose readiness check runs a known-answer decision"
---

The loan-triage service from [§3](/c/slm-decision-models/03-slm-fundamentals) must run in a 4 GB CPU container, scale out when partner traffic spikes, and never serve a decision before the model is loaded and calibrated. Whether a new replica is useful in 6 seconds or 50, and whether it gets OOM-killed under load, is decided by three numbers you can compute before writing a Dockerfile: bytes of weights, bytes per second you can move them, and bytes of memory each request needs.

:::key[First principle]
An image is weights + runtime + code, and every byte is paid for on every scale-out: **cold start ≈ pull + extract + import + weight load + warm-up**. Ship the fewest bytes, order layers so code changes never re-ship weights, and only report *ready* after a real decision has succeeded.
:::

## 25.1 Size: parameters × bytes per weight

Weights dominate the image for anything above an encoder:

$$
\text{weight bytes} = P \times b_w, \qquad b_w = 4 \;(\text{fp32}),\; 2 \;(\text{fp16}),\; 1 \;(\text{int8}),\; 0.5 + \tfrac{2}{64} \;(\text{int4, one fp16 scale per 64})
$$

Compression does not rescue you: quantised weights look almost random to a general-purpose compressor, so the registry stores (and every node pulls) nearly the raw size.

```python run
"""Weight bytes per dtype, and how well weights compress (synthetic Gaussian weights)."""
import zlib
import numpy as np

# params: 66M encoder; Qwen2.5 sizes from the section 3 calculator (published 0.49B / 1.54B / 3.09B)
P = {"encoder 66M": 66e6, "Qwen2.5-0.5B": 0.494e9, "Qwen2.5-1.5B": 1.544e9, "Qwen2.5-3B": 3.086e9}
BPP = {"fp32": 4.0, "fp16": 2.0, "int8": 1.0, "int4+g64": 0.5 + 2 / 64}   # int4: one fp16 scale per 64

print(f"{'model':14s}" + "".join(f"{k:>10s}" for k in BPP) + "   (MB)")
for name, n in P.items():
    print(f"{name:14s}" + "".join(f"{n * b / 1e6:10,.0f}" for b in BPP.values()))

rng = np.random.default_rng(25)
w = (rng.standard_normal(4_000_000) * 0.02).astype(np.float32)
q8 = np.clip(np.round(w / (np.abs(w).max() / 127)), -127, 127).astype(np.int8)
g = w.reshape(-1, 64)
s4 = np.abs(g).max(1, keepdims=True) / 7
q4 = (np.clip(np.round(g / s4), -7, 7).astype(np.int8) + 8).astype(np.uint8).ravel()
packed4 = (q4[0::2] << 4 | q4[1::2]).astype(np.uint8)
for name, buf in (("fp16", w.astype(np.float16).tobytes()), ("int8", q8.tobytes()),
                  ("int4+scales", packed4.tobytes() + s4.astype(np.float16).tobytes())):
    c = zlib.compress(buf, 6)
    print(f"{name:12s} raw {len(buf) / 1e6:5.1f} MB -> zlib {len(c) / 1e6:5.1f} MB ({len(c) / len(buf):.0%})")
```

```output
model               fp32      fp16      int8  int4+g64   (MB)
encoder 66M          264       132        66        35
Qwen2.5-0.5B       1,976       988       494       262
Qwen2.5-1.5B       6,176     3,088     1,544       820
Qwen2.5-3B        12,344     6,172     3,086     1,639
fp16         raw   8.0 MB -> zlib   7.4 MB (92%)
int8         raw   4.0 MB -> zlib   3.4 MB (85%)
int4+scales  raw   2.1 MB -> zlib   1.9 MB (88%)
```

The compression test uses synthetic Gaussian weights; real checkpoints differ a little (measure yours with `docker image inspect` and the registry's reported layer sizes), but the lesson holds: **pick the dtype, not the compressor**. Going from fp16 to int8 removes 494 MB from the 0.5B image; gzip removes about 15% of what is left.

| Layer (top = changes most often) | Typical size | Rebuilt when |
| --- | ---: | --- |
| Application code | KB–MB | every commit |
| Model bundle: weights + tokenizer + calibration + policy | 35 MB – 3 GB (table above) | new model release |
| Python dependencies (pinned lockfile) | hundreds of MB, illustrative | dependency bump |
| Base image, pinned by digest | tens to ~100 MB, illustrative | base patch |

Order the Dockerfile from the bottom of this table up. A code-only change then rebuilds and pushes one small layer; nodes that already hold the weights layer pull kilobytes. Put the weights *after* the code layer and every commit re-ships the model.

:::tip[The biggest runtime lever is the framework, not the base image]
A full training framework wheel can outweigh a 0.5B int8 model. For CPU inference, an export to a dedicated inference runtime (ONNX Runtime, llama.cpp-style runtimes) usually cuts the dependency layer by hundreds of MB. Measure with `docker history <image>` before and after; switching `slim` to `alpine` saves far less and breaks prebuilt wheels.
:::

## 25.2 Cold start: pull + extract + import + load + warm-up

A new replica on a node that has never seen the image pays every stage; a node that already has the layers skips pull and extract:

$$
t_{\text{cold}} \approx \frac{\text{compressed bytes}}{BW_{\text{registry}}} + \frac{\text{raw bytes}}{BW_{\text{extract}}} + t_{\text{import}} + \frac{\text{weight bytes}}{BW_{\text{disk}}} + k \cdot t_{\text{call}}
$$

The last term is $k$ warm-up decisions, at the CPU decision-call floor from [§3](/c/slm-decision-models/03-slm-fundamentals) (600-token prompt, 8 output tokens). All rates below are illustrative — a 1 Gbit/s registry link, a local SSD — replace them with your own.

```python run
"""Cold start = pull + extract + import + weight load + warm-up; memory limit for the container."""
# all rates illustrative: replace with your registry, node disk and measured call times
PULL, EXTRACT, DISK = 125e6, 400e6, 1e9      # bytes/s: 1 Gbit/s registry, layer extract, local SSD read
RUNTIME_GZ, RUNTIME_RAW = 250e6, 600e6       # python + onnxruntime + tokenizers + app layers
IMPORT_S, RSS_RUNTIME = 2.0, 300e6           # interpreter + runtime import; resident runtime memory
WEIGHT_GZ = 0.85                             # int8 weights barely compress (previous cell)
# int8 weight bytes, KV bytes/token (fp16 cache), CPU decision-call floor in s (section 3)
M = {"encoder 66M": (66e6, 0, 0.017), "Qwen2.5-0.5B": (494e6, 12_288, 0.673),
     "Qwen2.5-1.5B": (1544e6, 28_672, 2.102), "Qwen2.5-3B": (3086e6, 36_864, 4.200)}
WARMUP, CTX, CONC, HEADROOM = 3, 1024, 2, 1.3

print(f"{'model':13s} {'pull':>6s} {'extract':>7s} {'import':>6s} {'load':>5s} {'warm':>5s}"
      f" {'cold node':>9s} {'warm node':>9s} {'mem limit':>9s}")
for name, (wb, kv, call) in M.items():
    pull = (RUNTIME_GZ + WEIGHT_GZ * wb) / PULL
    extract = (RUNTIME_RAW + wb) / EXTRACT
    load = wb / DISK
    warm = WARMUP * call
    cold, hot = pull + extract + IMPORT_S + load + warm, IMPORT_S + load + warm
    limit = HEADROOM * (wb + RSS_RUNTIME + kv * CTX * CONC)
    print(f"{name:13s} {pull:5.1f}s {extract:6.1f}s {IMPORT_S:5.1f}s {load:4.1f}s {warm:4.1f}s"
          f" {cold:8.1f}s {hot:8.1f}s {limit / 1e9:7.2f}GB")
```

```output
model           pull extract import  load  warm cold node warm node mem limit
encoder 66M     2.4s    1.7s   2.0s  0.1s  0.1s      6.2s      2.1s    0.48GB
Qwen2.5-0.5B    5.4s    2.7s   2.0s  0.5s  2.0s     12.6s      4.5s    1.06GB
Qwen2.5-1.5B   12.5s    5.4s   2.0s  1.5s  6.3s     27.7s      9.8s    2.47GB
Qwen2.5-3B     23.0s    9.2s   2.0s  3.1s 12.6s     49.9s     17.7s    4.50GB
```

:::chart[Cold start on a node without the image (int8 weights, illustrative rates)]{type="bar" stacked="true" x="model" y="seconds to ready" unit=" s" note="1 Gbit/s registry, 400 MB/s extract, 1 GB/s SSD, 3 warm-up calls at the section 3 CPU floor"}
model, pull, extract, import, load weights, warm-up
encoder 66M, 2.4, 1.7, 2.0, 0.1, 0.1
Qwen2.5-0.5B, 5.4, 2.7, 2.0, 0.5, 2.0
Qwen2.5-1.5B, 12.5, 5.4, 2.0, 1.5, 6.3
Qwen2.5-3B, 23.0, 9.2, 2.0, 3.1, 12.6
:::

:::example[Worked example · Qwen2.5-0.5B int8 on a cold node]
Compressed bytes \(250 + 0.85 \times 494 = 670\) MB at 125 MB/s → 5.4 s pull. Raw bytes \(600 + 494 = 1{,}094\) MB at 400 MB/s → 2.7 s extract. Import 2 s, load 494 MB at 1 GB/s → 0.5 s, three warm-up calls at 0.673 s → 2.0 s. **Total 12.6 s**; on a node that already has the layers, 4.5 s.
:::

Three things follow:

- **Pull dominates on cold nodes, and it scales with weight bytes.** For the 3B model, pull + extract is 32 of 50 seconds. Pre-pull images onto nodes (a DaemonSet or the node image itself) and the 3B starts in 17.7 s.
- **Warm-up grows with the call time, not the weight size.** A decoder that takes 4.2 s per call needs 12.6 s of warm-up for three calls. Warm up with short known-answer inputs, not production-length prompts.
- **Startup budgets come from this table.** Give the startup/readiness grace period about 3× the measured warm-node start (0.5B: \(3 \times 4.5\) ≈ 15 s) and size autoscaling lead time from the cold-node column ([§26](/c/slm-decision-models/26-cloud)).

| Where the weights live | Start | Reproducibility | Use when |
| --- | --- | --- | --- |
| Baked into the image | pull cost on cold nodes; nothing at runtime | image digest pins weights, code and runtime together | default for ≤ ~1–2 GB of weights |
| Read-only volume, mounted | no pull of weights; disk or network-volume read | pin by bundle hash, verified at start | large weights, many images sharing one model |
| Downloaded at start | network fetch on *every* start | only if the hash is verified before use | avoid — adds a runtime dependency and an attack path |

## 25.3 Memory limit: weights + runtime + KV cache

A container limit that is too low turns a traffic spike into OOM kills; one that is too high wastes the node. Size it:

$$
M_{\text{limit}} \approx h \times \big(P\,b_w + M_{\text{runtime}} + n_{\text{conc}} \cdot n_{\text{ctx}} \cdot 2\,L\,h_{kv}\,d_h\,b_{kv}\big)
$$

with headroom $h$ = 1.3 for allocator slack and activations. The `mem limit` column above uses an illustrative 300 MB runtime, two concurrent 1,024-token sequences and the KV sizes from §3 (12 KiB/token for the 0.5B): **1.06 GB for the 0.5B, 2.47 GB for the 1.5B, 4.50 GB for the 3B** — the 3B does not fit the 4 GB container even at int8. The KV term is small here (25 MB for the 0.5B); it grows with concurrency and context, which is why one in-process model per container with **one worker process** is the rule: four uvicorn workers load four copies of the weights. Scale with replicas. Then confirm with the measured peak RSS under your load test ([§24](/c/slm-decision-models/24-benchmarking)) — the formula is the starting point, the measurement is the limit.

## 25.4 Liveness, readiness and the known-answer check

| Probe | Question | Fails when | Effect of failing |
| --- | --- | --- | --- |
| Startup | Has the process finished loading? | still loading after the grace period | container restarted |
| Liveness (`/livez`) | Is the process stuck? | event loop blocked, deadlock | container restarted |
| Readiness (`/readyz`) | Should traffic be sent here? | model not loaded, warm-up or known-answer check failed, queue past its limit | removed from the load balancer, *not* restarted |

Readiness must prove the bundle decides correctly, not that the process exists. At start-up, after warm-up, run a few **known-answer cases** — inputs whose action is fixed by policy ([§21](/c/slm-decision-models/21-unit-testing)) — and only then flip to ready. That catches a wrong tokenizer, a missing calibration file or a mis-pinned bundle before a single customer request. Keep liveness cheap and independent of the model: a slow model must make the replica *unready*, not trigger a restart loop that reloads the weights again.

```python
# src/serve.py — sketch; the model wrapper is yours (ONNX Runtime, llama.cpp bindings, ...)
import hashlib, json, os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from src.model import DecisionModel        # your wrapper: load(), decide(text) -> dict

MODEL_DIR = os.environ.get("MODEL_DIR", "/opt/model")
state = {"ready": False, "model": None, "bundle_id": None}


@asynccontextmanager
async def lifespan(app):
    load()
    yield


app = FastAPI(lifespan=lifespan)


def load() -> None:
    manifest = open(f"{MODEL_DIR}/manifest.json", "rb").read()
    state["bundle_id"] = "sha256:" + hashlib.sha256(manifest).hexdigest()
    model = DecisionModel.load(MODEL_DIR)                  # verifies SHA256SUMS before loading
    for case in json.load(open(f"{MODEL_DIR}/known_answers.json")):
        out = model.decide(case["text"])                   # doubles as warm-up
        if out["action"] != case["action"]:
            raise RuntimeError(f"known-answer case {case['id']} failed")  # startup fails, never ready
    state.update(model=model, ready=True)


class Req(BaseModel):
    request_id: str = Field(max_length=64)
    text: str = Field(min_length=1, max_length=8_000)      # bound input before tokenising


@app.post("/decide")
def decide(req: Req):
    if not state["ready"]:
        raise HTTPException(503, "not ready")
    out = state["model"].decide(req.text)                  # fallback to manual_review inside
    return {"request_id": req.request_id, **out, "bundle_id": state["bundle_id"]}


@app.get("/livez")
def livez():
    return {"ok": True}


@app.get("/readyz")
def readyz():
    if not state["ready"]:
        raise HTTPException(503, "loading")
    return {"ready": True, "bundle_id": state["bundle_id"]}
```

## 25.5 The Dockerfile

Pinned base by digest, dependencies installed from a hash-locked file, the bundle verified at build time, layers ordered so code is last, a non-root user, and no credentials anywhere in the build. (Digests below are placeholders.)

```dockerfile
# syntax=docker/dockerfile:1
ARG PY_IMAGE=python:3.12-slim@sha256:<pinned-digest>

# ---- dependencies: compilers and caches stay in this stage ----
FROM ${PY_IMAGE} AS deps
WORKDIR /build
COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes --prefix=/install -r requirements.lock

# ---- model bundle: fail the build if any file does not match its hash ----
FROM ${PY_IMAGE} AS bundle
WORKDIR /bundle
COPY artifacts/loan-triage-bundle/ .
RUN sha256sum -c SHA256SUMS

# ---- runtime ----
FROM ${PY_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 MODEL_DIR=/opt/model
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app
COPY --from=deps /install /usr/local
# weights before code: a code-only commit rebuilds one small layer
COPY --from=bundle /bundle /opt/model
COPY src/ /opt/app/src/
WORKDIR /opt/app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=2s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2)"]
CMD ["python", "-m", "uvicorn", "src.serve:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

Files are copied as root and the process runs as UID 10001, so the application can read the model but cannot modify it. `urlopen` raises on any non-2xx response, which makes the health check fail without needing `curl` in the image. Add a `.dockerignore` that excludes `.git`, `.env*`, notebooks, raw data and local caches — the build context is uploaded to the builder, and anything in it can end up in a layer.

```yaml
# compose.yaml — local run with the production hardening on
services:
  decision:
    image: registry.example.com/loan-triage@sha256:<digest>   # deploy by digest, never :latest
    user: "10001:10001"
    read_only: true
    tmpfs: ["/tmp:size=64m"]
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 1100m          # 1.06 GB from 25.3, rounded up; confirm with measured peak RSS
    cpus: 4
    pids_limit: 256
    environment:
      OMP_NUM_THREADS: "4"    # match cpus: oversubscribed threads add latency
    ports: ["127.0.0.1:8000:8000"]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz', timeout=2)"]
      interval: 10s
      timeout: 2s
      start_period: 15s
      retries: 3
```

:::warn[Secrets never go in the image]
Anything in a layer — `ENV`, a copied `.env`, a `--build-arg` token — is readable by anyone who can pull the image, and deleting it in a later layer does not remove it. A decision service usually needs no secrets at runtime at all; when it does (a log sink, a downstream API), inject them at run time from the platform's secret store or workload identity, and use BuildKit `--mount=type=secret` for build-time credentials such as a private package index.
:::

## 25.6 Release checklist for the image

| Check | Why | How |
| --- | --- | --- |
| Base image and every dependency pinned (digest, hash lockfile) | rebuilds are reproducible; no silent upgrades | `@sha256:` base; `pip install --require-hashes` |
| Bundle hash verified at build *and* at load | a corrupted or swapped model fails loudly | `sha256sum -c`; recheck in `load()` |
| Weights in safetensors / ONNX, no pickles, no remote code | loading a pickle can execute code ([threat model](/c/practical-slm-decision-models/16-security-privacy-and-governance)) | reject `.bin`/`.pkl` in CI |
| Non-root, read-only root filesystem, all capabilities dropped | limits what a compromised process can do | `USER 10001`, `read_only`, `cap_drop: ALL` |
| One worker per container; threads = CPUs | memory scales with workers; oversubscription adds latency | `--workers 1`, `OMP_NUM_THREADS` |
| Image scanned and SBOM attached | known CVEs in dependencies are caught before deploy | scanner + SBOM step in CI ([§28](/c/slm-decision-models/28-cicd)) |
| Readiness runs known-answer cases | a wrong tokenizer or calibration never serves traffic | `/readyz` as in 25.4 |
| `bundle_id` returned and logged per decision | any decision can be replayed against its exact bundle | response field + decision log |

The deep course covers the bundle manifest, rollout patterns and the per-decision log in [serving and deployment](/c/practical-slm-decision-models/13-serving-and-deployment): version weights, tokenizer, prompt, calibration and policy as one immutable bundle, and roll back the bundle, never the weights alone.

## 25.7 Check yourself

:::qa[Your 1.5B model is shipped in fp16 inside the image. What does switching to int8 save in pull time on a cold node, at the same 1 Gbit/s?]
fp16 is 3,088 MB and compresses to about 92% (2,841 MB); int8 is 1,544 MB at about 85% (1,312 MB). The pull shrinks by 1,529 MB, about 12.2 s at 125 MB/s; extract saves \(1{,}544 / 400\) ≈ 3.9 s and load 1.5 s — roughly 17.6 s off every cold start. Then re-check calibration and cost per case — int8 changes the probabilities ([§3](/c/slm-decision-models/03-slm-fundamentals)).
:::

:::qa[The 0.5B container is OOM-killed only at peak. The limit is 1 GB and uvicorn runs 4 workers. What happened?]
Four workers load four copies of 494 MB of weights plus runtime — about 3.2 GB before any KV cache, so even off-peak the container only survives if workers start lazily, and peak concurrency tips it over. Run one worker, set the limit from 25.3 (≈ 1.1 GB), and add replicas for throughput.
:::

:::qa[Readiness returns 200 as soon as the process starts, and a new release silently routes 100% of loans to manual review. Which control would have caught it before traffic?]
A readiness check that runs known-answer cases after loading. A bundle with a missing calibration file or the wrong tokenizer produces the wrong action on a case whose answer is fixed by policy, so the replica never becomes ready and the rollout stalls instead of shipping.
:::

:::qa[Why put the weights layer before the code layer?]
Docker rebuilds every layer after the first changed one. With code last, a code commit rebuilds and pushes a few KB and nodes reuse the cached weights layer; with weights after code, every commit re-ships hundreds of MB and every cold node pays the 2–23 s pull again.
:::

Next: [Cloud](/c/slm-decision-models/26-cloud).
