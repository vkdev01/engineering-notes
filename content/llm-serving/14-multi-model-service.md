---
section: "14"
title: "The multi-model service, file by file"
kicker: "Code walkthroughs"
abstract: "An LRU cache capped at two models, a worker factory keyed on framework, and a Triton worker that unloads itself."
time: "4 min"
order: 14
---
`ch03/multi_model_serving/` — a FastAPI service that holds at most two models at a time, loads them on demand, and dispatches to a framework-specific worker. About 280 lines of Python, plus a Triton model repository.

```bash
pip install -r requirements.txt
python -m app.server            # http://localhost:8001
PORT=8002 python -m app.server  # custom port
```

## The request path

:::mermaid
flowchart TD
    A["POST /predict<br/>model_id + input_data"] --> B["server.py"]
    B --> C["ModelManager.get_model_worker(id)"]
    C --> D{"in OrderedDict?"}
    D -- yes --> E["move_to_end(id)<br/>return cached worker"]
    D -- no --> F{"len >= max_models (2)?"}
    F -- yes --> G["popitem(last=False)<br/>ModelEngine.delete_worker"]
    F -- no --> H["ModelEngine.create_worker(metadata)"]
    G --> H
    H --> I["TransformerWorker / TorchVisionWorker / TritonWorker"]
    I --> J["worker.predict(input_data)"]
:::

## `app/store.py` — metadata

A Pydantic model and a JSON file. `ModelMetadata` is `id`, `name`, `type`, `framework`, `version`, `description`; `ModelStore` loads `config/models.json` into a dict keyed by id.

The config declares four models, two per type:

| id | name | type | framework |
| --- | --- | --- | --- |
| `550e8400-…` | `distilbert-base-uncased-finetuned-sst-2-english` | text | transformers |
| `6ba7b810-…` | `mrm8488/bert-tiny-finetuned-sms-spam-detection` | text | transformers |
| `7c9e6679-…` | `pytorch/vision:mobilenet_v2` | image | torchvision |
| `8ba7b810-…` | `densenet_onnx` | image | triton |

Note the `framework` field: it is what the factory switches on, and it is why adding a framework means adding one class and one string.

## `app/manager.py` — the cache

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

The download step is deliberately absent, with the reason left in the code:

```python
# Download model if not already downloaded
# Skip the downlaod implementation for simplicity
```

So models must be resolvable by name at load time. That is fine for Hub models and not fine for anything private, which is the first thing you would fix.

## `app/engine.py` — the factory

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

One class attribute (`workers = {}`) shadowed by an instance attribute in `__init__`, and no locking. Both matter if you were taking this further: the class-level dict is shared state, and two concurrent misses on the same id would both construct a worker.

## `app/worker.py` — three implementations, one interface

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

That `__del__` is worth pausing on. Eviction from the LRU cache drops the worker, and dropping the worker unloads the model from Triton. The Python object lifecycle is the model lifecycle, which is elegant in a demo and fragile in a service (you cannot rely on `__del__` timing).

## The Triton side

`model_dir/densenet_onnx/` is a model repository with `config.pbtxt` declaring the input `data_0` as `TYPE_FP32 [3, 224, 224]` and the output `fc6_1` as `TYPE_FP32 [1000]`, served by:

```bash
docker run -p8009:8000 -p8010:8001 -p8011:8002 \
    -v $(pwd)/model_dir:/models \
    nvcr.io/nvidia/tritonserver:24.12-py3 \
    tritonserver --model-repository=/models --model-control-mode=explicit
```

Explicit mode means nothing loads until asked — which is the Triton-native equivalent of the LRU cache in `manager.py`. The repository thus contains two answers to the same residency question: a Python cache with eviction, and a serving runtime with explicit load/unload.

## Tests

`tests/test_models.py` exercises the HTTP surface and the text models; `tests/test_triton_densenet.py` needs a running Triton server and uses `tests/images/` for input. The split mirrors the architecture: the transformers path is testable without infrastructure, the Triton path is not.

## What you would change first

1. **Add a lock** around `get_model_worker`, and make `ModelEngine.workers` an instance attribute only.
2. **Implement download** (or make the store point at local paths).
3. **Replace `__del__`** with an explicit `unload(model_id)` on the manager.
4. **Parameterise the output name** in `TritonWorker` instead of hardcoding `fc6_1`.
