---
section: "14"
title: "The multi-model service, file by file"
kicker: "Code walkthroughs"
abstract: "Chapter 3's multi-model service read file by file \u2014 an LRU capped at two models, a worker factory keyed on framework, a Triton worker that unloads itself \u2014 with the numbers that decide whether the cache works: hit rate under skewed traffic, the price of a miss, the race on concurrent misses and the __del__ lifecycle."
time: "17 min"
order: 14
outcomes:
  - "Trace a /predict request through ModelStore, ModelManager, ModelEngine and a worker"
  - "Estimate an LRU's hit rate for a given capacity and traffic skew, and compare it with pinning the top-k models"
  - "Price a cache miss as load bytes over bandwidth and turn hit rate into mean and p99 latency"
  - "Explain why two concurrent misses build two workers, and fix it with a per-model lock"
  - "Decide when to replace __del__-driven unloads with explicit load and unload calls, as Triton's explicit mode does"
---
`ch03/multi_model_serving/` is a FastAPI service that holds at most two models at a time, loads them on demand, and dispatches to a framework-specific worker: about 280 lines of Python plus a Triton model repository. It is the residency problem in miniature. Every multi-tenant deployment — a dozen fine-tuned Gemma 3 1B variants, one per customer; a classifier zoo behind one endpoint — has more models than memory, so something decides what stays loaded. Here that something is an `OrderedDict`. This page reads the code, then asks the three questions the code leaves open: how often does the cache hit, what does a miss cost, and what happens when two requests miss at once?

:::key[First principle]
A model cache is worth what it saves: mean latency is $h\,t_{\text{hit}} + (1-h)\,t_{\text{miss}}$, and a miss costs a full model load — bytes divided by the slowest link they cross. Capacity is set by memory in bytes, not by a model count; and once misses exceed 1% of traffic, p99 latency *is* the load time.
:::

## 14.1 Run it, then follow one request

```bash
cd ch03/multi_model_serving
pip install -r requirements.txt
python -m app.server            # http://localhost:8001
PORT=8002 python -m app.server  # custom port
```

:::mermaid[The /predict path: a cache in front of a worker factory]
flowchart TD
    A[POST /predict<br/>model_id + input_data] --> B[server.py]
    B --> C[ModelManager.get_model_worker]
    C --> D{in OrderedDict?}
    D -- yes --> E[move_to_end<br/>return cached worker]
    D -- no --> F{cache full, max_models = 2?}
    F -- yes --> G[popitem last=False<br/>ModelEngine.delete_worker]
    F -- no --> H[ModelEngine.create_worker]
    G --> H
    H --> I[TransformerWorker, TorchVisionWorker or TritonWorker]
    E --> J[worker.predict]
    I --> J
:::

The service exposes two endpoints, `/models` and `/predict`. The design summary that sets this service against the single-model one is in [Chapter 3 — System design](/c/llm-serving/05-system-design).

## 14.2 `app/store.py` — metadata

A Pydantic model and a JSON file. `ModelMetadata` is `id`, `name`, `type`, `framework`, `version`, `description`; `ModelStore` loads `config/models.json` into a dict keyed by id. The config declares four models, two per type:

| id | name | type | framework |
| --- | --- | --- | --- |
| `550e8400-…` | `distilbert-base-uncased-finetuned-sst-2-english` | text | transformers |
| `6ba7b810-…` | `mrm8488/bert-tiny-finetuned-sms-spam-detection` | text | transformers |
| `7c9e6679-…` | `pytorch/vision:mobilenet_v2` | image | torchvision |
| `8ba7b810-…` | `densenet_onnx` | image | triton |

The `framework` field is what the factory switches on, which is why adding a framework means adding one class and one string. What the metadata lacks is a size: nothing in it tells the manager how many bytes a model will occupy, so the cache can only count models (14.5).

## 14.3 `app/manager.py` — the LRU

```python
def __init__(self, model_store: ModelStore, max_models: int = 2):
    self.max_models = max_models
    self.model_cache = OrderedDict()   # id -> worker
```

`get_model_worker` is the whole policy, and it reads like a textbook LRU:

1. Hit → `move_to_end(id)` (mark most recently used) → return the worker.
2. Miss → look up metadata; unknown id returns `None`, which the server turns into a 404.
3. Cache full → `popitem(last=False)` (evict least recently used) → `delete_worker`.
4. Create the worker and cache it.

An `OrderedDict` makes every step O(1): the dict finds the id, the linked order records recency. The download step is deliberately absent, with the reason left in the code:

```python
# Download model if not already downloaded
# Skip the downlaod implementation for simplicity
```

So models must be resolvable by name at load time. That is fine for Hub models and not fine for anything private — and it means a miss on a cold machine includes a network download (14.5).

## 14.4 How often does an LRU hit?

LRU bets that the recent past predicts the near future. Under *independent* requests, where model $k$ is asked for with probability $p_k$ regardless of history, the best fixed policy is to pin the $c$ most popular models, for a hit rate of $\sum_{k \le c} p_k$. LRU cannot match that, because a burst of rare requests evicts a popular model. At capacity 1 the LRU hit rate is exactly $\sum_k p_k^2$ — the chance that two consecutive requests name the same model.

Model popularity is typically skewed. A Zipf law, $p_k \propto 1/k^s$, is the standard model; $s = 1$ below is ILLUSTRATIVE — measure your own request log.

```python run
from collections import OrderedDict

import numpy as np

rng = np.random.default_rng(14)
N = 100_000  # requests


def zipf_stream(m, s=1.0):
    """Request stream over m models; model k is requested with weight 1 / k**s."""
    w = 1.0 / np.arange(1, m + 1) ** s
    p = w / w.sum()
    return rng.choice(m, size=N, p=p), p


def lru_hit_rate(stream, cap):
    cache, hits = OrderedDict(), 0
    for k in stream:
        if k in cache:
            cache.move_to_end(k)          # mark most recently used
            hits += 1
        else:
            if len(cache) >= cap:
                cache.popitem(last=False)  # evict least recently used
            cache[k] = True
    return hits / len(stream)


rows = {}
for m in (4, 8):
    stream, p = zipf_stream(m)
    print(f"{m} models, request share: " + " ".join(f"{x:.3f}" for x in p))
    for cap in (1, 2, 3, 4):
        h = lru_hit_rate(stream, cap)
        rows[(m, cap)] = (h, p[:cap].sum())
        print(f"  capacity {cap}: LRU hit {h:.3f}   pin top-{cap} {p[:cap].sum():.3f}")

print("chart: capacity, LRU 4 models, pinned 4 models, LRU 8 models, pinned 8 models")
for cap in (1, 2, 3, 4):
    a, b = rows[(4, cap)], rows[(8, cap)]
    print(f"{cap}, {a[0]:.3f}, {a[1]:.3f}, {b[0]:.3f}, {b[1]:.3f}")
```

```output
4 models, request share: 0.480 0.240 0.160 0.120
  capacity 1: LRU hit 0.330   pin top-1 0.480
  capacity 2: LRU hit 0.605   pin top-2 0.720
  capacity 3: LRU hit 0.827   pin top-3 0.880
  capacity 4: LRU hit 1.000   pin top-4 1.000
8 models, request share: 0.368 0.184 0.123 0.092 0.074 0.061 0.053 0.046
  capacity 1: LRU hit 0.208   pin top-1 0.368
  capacity 2: LRU hit 0.386   pin top-2 0.552
  capacity 3: LRU hit 0.537   pin top-3 0.675
  capacity 4: LRU hit 0.666   pin top-4 0.767
chart: capacity, LRU 4 models, pinned 4 models, LRU 8 models, pinned 8 models
1, 0.330, 0.480, 0.208, 0.368
2, 0.605, 0.720, 0.386, 0.552
3, 0.827, 0.880, 0.537, 0.675
4, 1.000, 1.000, 0.666, 0.767
```

:::chart[Hit rate vs cache capacity, Zipf (s = 1) traffic]{type="line" x="cache capacity (models)" y="hit rate" yfmt="pct" ymin="0" ymax="1" xfmt="int" marks="2:repo max_models" dash="pinned 4 models,pinned 8 models" note="100,000 independent requests, seed 14. Pinned = keep the c most popular models, the best fixed policy for independent requests."}
capacity, LRU 4 models, pinned 4 models, LRU 8 models, pinned 8 models
1, 0.330, 0.480, 0.208, 0.368
2, 0.605, 0.720, 0.386, 0.552
3, 0.827, 0.880, 0.537, 0.675
4, 1.000, 1.000, 0.666, 0.767
:::

- **The repo's setting — four models, capacity 2 — hits 60.5% of the time.** Four in ten requests pay a load. Pinning the two most popular models would hit 72.0%, if you knew which they were.
- **Capacity 1 matches the formula:** \(0.48^2 + 0.24^2 + 0.16^2 + 0.12^2 = 0.328\), against 0.330 simulated.
- **Doubling the catalogue hurts more than halving the cache helps.** With eight models, capacity 4 hits 66.6% — barely above four models at capacity 2.
- **Real traffic has bursts** (one tenant sends a batch), which help LRU relative to this independent-request model; a scan through every model once (a nightly evaluation job) flushes it completely. Exclude batch jobs from the online cache.

## 14.5 What a miss costs

A miss loads a model, and a load moves bytes: from the Hub over the network on a cold machine, from local disk if cached, then host to GPU over PCIe. Each hop is bounded by bytes ÷ bandwidth, and a framework adds fixed start-up work (imports, graph construction, warm-up) that dominates for small models:

$$
t_{\text{load}} \approx t_0 + \frac{\text{bytes}}{\text{bandwidth}},
\qquad
\mathbb{E}[T] = h\,t_{\text{hit}} + (1-h)\,(t_{\text{hit}} + t_{\text{load}}).
$$

The demo models' sizes follow from their parameter counts, computed from the BERT-family configs (bert-tiny: 2 layers, hidden 128; DistilBERT: 6 layers, hidden 768) and torchvision's published count for MobileNetV2. The ONNX DenseNet's count is not computed here; 8.0M (roughly DenseNet-121) is ILLUSTRATIVE. Bandwidths are ILLUSTRATIVE (Hub 100 MB/s, NVMe 2 GB/s) except PCIe Gen4 x16 at 32 GB/s per direction (spec); `t_hit` values and the classifier's 0.5 s load time are ILLUSTRATIVE.

```python run
def bert(V, H, L, I, P, T, labels, pooler=True, pre_cls=False):
    """Parameter count of a BERT-style sequence classifier from its config."""
    emb = V * H + P * H + T * H + 2 * H
    layer = 4 * (H * H + H) + 2 * H + (H * I + I) + (I * H + H) + 2 * H
    head = (H * H + H if pooler or pre_cls else 0) + H * labels + labels
    return emb + L * layer + head


params = {
    "bert-tiny (sms spam)": bert(30522, 128, 2, 512, 512, 2, 2),
    "distilbert (sst-2)": bert(30522, 768, 6, 3072, 512, 0, 2, pooler=False, pre_cls=True),
    "mobilenet_v2": 3_504_872,       # torchvision's published count
    "densenet_onnx (~DenseNet-121)": 8_000_000,  # ILLUSTRATIVE
}
BW = {"Hub 100 MB/s": 100e6, "NVMe 2 GB/s": 2e9, "PCIe 32 GB/s": 32e9}
print(f"{'model':30s} {'params':>11s} {'fp32 MB':>8s}" + "".join(f"{k:>14s}" for k in BW))
sizes = {k: 4 * v for k, v in params.items()}
sizes.update({"Gemma 3 1B bf16": 2.00e9, "Gemma 3 12B bf16": 23.53e9})
for name, b in sizes.items():
    n = f"{params[name]:,}" if name in params else "-"
    print(f"{name:30s} {n:>11s} {b / 1e6:8.0f}" + "".join(f"{b / bw:13.3f}s" for bw in BW.values()))

# Expected latency, 4 models with Zipf traffic; LRU hit rates from the simulation above
for name, h, t_hit, t_load in (("classifier, cap 2, 0.5 s load", 0.605, 0.020, 0.5),
                               ("Gemma 3 1B, cap 2, NVMe load", 0.605, 0.5, 2.00e9 / 2e9),
                               ("Gemma 3 12B, cap 1, NVMe load", 0.330, 0.5, 23.53e9 / 2e9)):
    t_miss = t_hit + t_load
    mean = h * t_hit + (1 - h) * t_miss
    print(f"{name:30s} h {h:.3f}  mean {mean:5.2f} s = {mean / t_hit:4.1f}x hit; p99 = {t_miss:5.2f} s")

# How many models fit on one L40S (46,068 MiB, 90% usable)?
usable = 46_068 * 2**20 * 0.90
for name, w in (("Gemma 3 1B", 2.00e9), ("Gemma 3 12B", 23.53e9)):
    per = w + 2e9   # + 2 GB KV pool per model, ILLUSTRATIVE
    print(f"{name}: usable {usable / 1e9:.2f} GB / {per / 1e9:.2f} GB each = {int(usable // per)} resident")
```

```output
model                               params  fp32 MB  Hub 100 MB/s   NVMe 2 GB/s  PCIe 32 GB/s
bert-tiny (sms spam)             4,386,178       18        0.175s        0.009s        0.001s
distilbert (sst-2)              66,955,010      268        2.678s        0.134s        0.008s
mobilenet_v2                     3,504,872       14        0.140s        0.007s        0.000s
densenet_onnx (~DenseNet-121)    8,000,000       32        0.320s        0.016s        0.001s
Gemma 3 1B bf16                          -     2000       20.000s        1.000s        0.062s
Gemma 3 12B bf16                         -    23530      235.300s       11.765s        0.735s
classifier, cap 2, 0.5 s load  h 0.605  mean  0.22 s = 10.9x hit; p99 =  0.52 s
Gemma 3 1B, cap 2, NVMe load   h 0.605  mean  0.90 s =  1.8x hit; p99 =  1.50 s
Gemma 3 12B, cap 1, NVMe load  h 0.330  mean  8.38 s = 16.8x hit; p99 = 12.27 s
Gemma 3 1B: usable 43.48 GB / 4.00 GB each = 10 resident
Gemma 3 12B: usable 43.48 GB / 25.53 GB each = 1 resident
```

:::example[Worked example · the same cache, three model sizes]
- **The demo classifiers** are 14–268 MB in fp32; even from the Hub the byte time is under 3 s, and from local disk it is milliseconds. Their load time is the fixed $t_0$ — Python objects, tokenizer files, warm-up. With an illustrative 0.5 s load and a 20 ms hit, a 60.5% hit rate makes the **mean 0.22 s, 10.9x a hit**.
- **Gemma 3 1B variants** (2.00 GB bf16) load from NVMe in 1.0 s of byte time. Mean 0.90 s, 1.8x a 0.5 s hit, and p99 = 1.50 s.
- **Gemma 3 12B** (23.53 GB) loads in 11.8 s from NVMe and 235 s from the Hub at 100 MB/s. Only one fits on an L40S next to a KV pool, so with four 12B variants the cache has capacity 1 and hits 33.0%: **mean 8.38 s, p99 12.27 s.** No cache policy fixes that; the answer is fewer full models — one base plus LoRA adapters ([Chapter 10](/c/llm-serving/12-advancements)) — or more GPUs.
:::

**Capacity is bytes, not a count.** `max_models = 2` is right for none of these cases. On an L40S, 46,068 MiB × 0.90 = 43.48 GB is usable; at 2.00 GB of weights plus an illustrative 2 GB KV pool, ten Gemma 3 1B variants fit — capacity 10, not 2 — while a single 12B fills the card. A size-aware manager evicts until the incoming model's bytes fit, and needs the size in the metadata to do it.

:::warn[A miss rate above 1% sets your p99]
If more than 1 request in 100 misses, the 99th-percentile request is a miss: p99 ≥ $t_{\text{hit}} + t_{\text{load}}$, whatever the mean says. At 60.5% hits the p99 of every row above is its miss time. Either keep the miss rate under 1% for latency-sensitive tenants (pin them) or publish an SLO that includes cold starts.
:::

## 14.6 `app/engine.py` — the factory, and the race on concurrent misses

```python
if model_metadata.framework == "transformers":
    self.workers[id] = TransformerWorker(model_metadata)
elif model_metadata.framework == "torchvision":
    self.workers[id] = TorchVisionWorker(model_metadata)
elif model_metadata.framework == "triton":
    self.workers[id] = TritonWorker(model_metadata)
else:
    raise ValueError(f"Unsupported framework: {model_metadata.framework}")
```

One class attribute (`workers = {}`) shadowed by an instance attribute in `__init__`, and no locking. The class-level dict is shared state across every `ModelEngine` — any code that writes to it before `__init__` runs, or from another instance, keeps workers alive that no cache knows about. The missing lock matters more.

`get_model_worker` is check-then-act: *is it cached? no → build it → store it*. Whether two requests can interleave there depends on how the endpoint is declared. A plain `def` handler runs in FastAPI's thread pool, so two threads can both see a miss for the same id and both construct a worker — two copies of the weights, briefly over `max_models`, the second overwriting the first in the dict. An `async def` handler that calls the blocking load cannot race, but it holds the event loop for the whole load, so *every* request, hits included, waits behind it. The fix is a lock per model id ("single flight"): requests for the same model wait for one load; requests for other models are not blocked.

```python run
import threading
import time

built = []


def load(model_id):
    built.append(model_id)
    time.sleep(0.2)            # stands in for from_pretrained / a Triton load
    return f"worker:{model_id}"


class NaiveManager:            # the shape of get_model_worker, without a lock
    def __init__(self):
        self.cache = {}

    def get(self, model_id):
        if model_id not in self.cache:
            self.cache[model_id] = load(model_id)
        return self.cache[model_id]


class SingleFlightManager:     # one lock per model id, a short global lock for the dict
    def __init__(self):
        self.cache, self.locks, self.guard = {}, {}, threading.Lock()

    def get(self, model_id):
        with self.guard:
            lock = self.locks.setdefault(model_id, threading.Lock())
        with lock:             # only requests for the same id wait here
            if model_id not in self.cache:
                self.cache[model_id] = load(model_id)
        return self.cache[model_id]


for mgr in (NaiveManager(), SingleFlightManager()):
    built.clear()
    ts = [threading.Thread(target=mgr.get, args=("distilbert",)) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    print(f"{type(mgr).__name__:20s} 4 concurrent misses -> built {len(built)} worker(s)")
```

```output
NaiveManager         4 concurrent misses -> built 4 worker(s)
SingleFlightManager  4 concurrent misses -> built 1 worker(s)
```

Four simultaneous requests for an unloaded Gemma 3 12B would mean four 23.53 GB loads on a card that holds one — an out-of-memory crash, not a slow request. A complete fix also puts eviction under the global lock and evicts only workers with no request in flight.

## 14.7 `app/worker.py` — three implementations, one interface

`ModelWorker` is an ABC with `_load_model()` and `predict(input_data)`. Three subclasses:

**`TransformerWorker`** — `AutoModelForSequenceClassification`, tokenise with padding and truncation, `torch.softmax(outputs.logits, dim=-1)`, return `{"predictions": predictions.tolist()}`. Works for both text models in the config because both are sequence classifiers.

**`TorchVisionWorker`** — `mobilenet_v2(weights=MobileNet_V2_Weights.DEFAULT)`, `eval()`, and a standard transform pipeline: resize 256, centre crop 224, tensor, normalise with ImageNet statistics.

**`TritonWorker`** — the interesting one, because the model is not in the process at all:

```python
input_tensor = httpclient.InferInput(name, array.shape, "FP32")
input_tensor.set_data_from_numpy(array)
response = self.client.infer(
    model_name=self.model_metadata.name,
    inputs=inputs,
    outputs=[httpclient.InferRequestedOutput("fc6_1")],
)
```

It converts whatever arrives into a float32 numpy array, builds Triton infer inputs, and hardcodes the output name `fc6_1` for the DenseNet model. Its `__del__` unloads the model from Triton by POSTing to `/v2/repository/models/<name>/unload` — which pairs with the server being started in explicit model-control mode.

**The `__del__` lifecycle.** Eviction drops the worker, and dropping the worker unloads the model: the Python object lifecycle *is* the model lifecycle. In CPython, `__del__` runs when the last reference disappears, which makes it look deterministic. The cases below show where it is not:

```python run
import gc


class Worker:
    def __init__(self, name):
        self.name = name

    def __del__(self):
        print(f"  __del__ -> POST /v2/repository/models/{self.name}/unload")


gc.disable()
print("1. last reference dropped (what LRU eviction does):")
w = Worker("densenet_onnx")
del w
print("2. a request still holds the evicted worker:")
w = Worker("densenet_onnx")
in_flight = w
del w
print("  evicted, but still loaded on Triton")
del in_flight
print("3. worker caught in a reference cycle:")
w = Worker("densenet_onnx")
w.self_ref = w
del w
print("  evicted, nothing printed yet")
gc.collect()
print("  ...unloaded only when the cycle collector ran")
```

```output
1. last reference dropped (what LRU eviction does):
  __del__ -> POST /v2/repository/models/densenet_onnx/unload
2. a request still holds the evicted worker:
  evicted, but still loaded on Triton
  __del__ -> POST /v2/repository/models/densenet_onnx/unload
3. worker caught in a reference cycle:
  evicted, nothing printed yet
  __del__ -> POST /v2/repository/models/densenet_onnx/unload
  ...unloaded only when the cycle collector ran
```

| Situation | When the unload happens | Consequence |
| --- | --- | --- |
| Evicted, no other reference | Immediately, inside the request that caused the miss | That request also pays a blocking HTTP round trip to Triton |
| Evicted while another request is mid-predict | When that request finishes | Correct, but more than `max_models` are briefly resident |
| Worker in a reference cycle (a callback, a traceback) | When the cyclic collector runs | Model stays loaded for an unbounded time |
| Unload call fails | Never; exceptions in `__del__` are printed and ignored | The manager believes the model is gone |
| Interpreter shutdown | Not guaranteed | Models stay loaded on Triton after the service stops |

Elegant in a demo, fragile in a service: make `unload(model_id)` an explicit manager method, call it on eviction, check its result, and call it for every resident model in a shutdown hook.

## 14.8 The Triton side — explicit mode as the runtime's version of the cache

`model_dir/densenet_onnx/` is a model repository with `config.pbtxt` declaring the input `data_0` as `TYPE_FP32 [3, 224, 224]` and the output `fc6_1` as `TYPE_FP32 [1000]`, served by:

```bash
docker run -p8009:8000 -p8010:8001 -p8011:8002 \
    -v $(pwd)/model_dir:/models \
    nvcr.io/nvidia/tritonserver:24.12-py3 \
    tritonserver --model-repository=/models --model-control-mode=explicit
```

The host maps Triton's HTTP, gRPC and metrics ports (8000, 8001, 8002) to 8009, 8010 and 8011. Explicit mode means nothing loads until asked: a client calls `POST /v2/repository/models/<name>/load` and `.../unload`, and the repository index endpoint reports what is resident. That is the Triton-native equivalent of the LRU cache in `manager.py` — with one difference worth noticing: Triton provides the *mechanism* (load, unload, status), and the *policy* (which model to evict, when) stays with the caller. The repository therefore contains two answers to the same residency question: a Python cache that owns both policy and mechanism, and a serving runtime that owns the mechanism and leaves the policy to you.

| | `manager.py` LRU | Triton explicit mode |
| --- | --- | --- |
| Who loads | The worker constructor, in the API process | The Triton server, on a load call |
| Who decides eviction | `popitem(last=False)` | Your code |
| Unload trigger | `__del__` | An explicit unload call |
| Capacity limit | A count, `max_models = 2` | GPU memory, enforced by load failures |
| Survives an API restart | No | Yes — models stay loaded in Triton |

## 14.9 Tests

`tests/test_models.py` exercises the HTTP surface and the text models; `tests/test_triton_densenet.py` needs a running Triton server and uses `tests/images/` for input. The split mirrors the architecture: the transformers path is testable without infrastructure, the Triton path is not. Missing, and cheap to add: a test that requests three models in sequence and asserts which one was evicted, and a test that fires two concurrent requests for an unloaded model and asserts one construction.

## 14.10 What you would change first

1. **Add a per-model lock** around `get_model_worker` (14.6), and make `ModelEngine.workers` an instance attribute only.
2. **Make capacity bytes, not a count:** add a size to `ModelMetadata` and evict until the new model fits.
3. **Implement download** (or make the store point at local paths), so a miss reads local disk instead of the Hub.
4. **Replace `__del__`** with an explicit `unload(model_id)` on the manager.
5. **Parameterise the output name** in `TritonWorker` instead of hardcoding `fc6_1`.

## 14.11 Check yourself

:::qa[With max_models = 2, requests arrive for A, B, A, C, D. What is evicted, and when?]
A and B load (two misses). A hits and becomes most recent. C misses with the cache full: the least recently used is B, so B is evicted. D misses: now A is least recent (C was just used), so A is evicted. Final cache: C, D. Four misses in five requests.
:::

:::qa[Four models, Zipf s = 1, capacity 1. Compute the LRU hit rate without simulating.]
At capacity 1 a request hits only if the previous request named the same model: $\sum_k p_k^2 = 0.48^2 + 0.24^2 + 0.16^2 + 0.12^2 = 0.230 + 0.058 + 0.026 + 0.014 = 0.328$. The simulation gives 0.330.
:::

:::qa[A tenant's Gemma 3 1B fine-tune is hit 99.5% of the time with t_hit = 0.5 s, and loads from NVMe in 1.0 s of byte time. What are the mean and p99?]
Mean $= 0.5 + 0.005 \times 1.0 = 0.505$ s. The miss rate is 0.5%, under 1%, so p99 is a hit: 0.5 s. At a 98% hit rate the p99 would jump to 1.5 s even though the mean only rises to 0.52 s.
:::

:::qa[Why does the race on concurrent misses not appear if /predict is an async def endpoint, and why is that not good news?]
An `async def` endpoint runs on the event loop; a blocking load inside it never yields, so no second request can reach the cache check until the load finishes. There is no double construction — but every other request, including hits for already-loaded models, waits for the whole load. Run the load in a worker thread with a per-model lock instead.
:::

Next: [the benchmark method](/c/llm-serving/15-benchmark-method).


