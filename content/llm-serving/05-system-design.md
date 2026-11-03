---
section: "5"
title: "Chapter 3 \u2014 System design"
kicker: "Chapter notes"
abstract: "The centre of gravity: two runnable services, four hops in the request path, and the trade each one makes."
time: "4 min"
order: 5
---
**Covers:** building online single-model and multi-model serving services from scratch, batching and streaming, NVIDIA Triton, cost- versus latency-optimised designs.

**In the repository:** the heart of it. Two runnable services and a Triton example.

```
ch03/single_model_llm_serving/     FastAPI on :8000, facebook/opt-125m
  main.py                          4 endpoints
  llm/llm.py                       LLMEngine: orchestration + vLLM path
  llm/workload_manager.py          queues, batching, sequence state
  llm/model_executor.py            multiprocessing queues, one worker process
  llm/model_worker.py              the actual forward passes
  llm/model_manager.py             model + tokenizer loading
  tests/                           test_api.py, test_vllm.py, test_stream.sh

ch03/multi_model_serving/          FastAPI on :8001, up to 2 models
  app/server.py                    /predict, /models
  app/store.py                     model metadata from config/models.json
  app/manager.py                   LRU cache over workers
  app/engine.py                    worker factory by framework
  app/worker.py                    ModelWorker ABC + 3 implementations
  model_dir/densenet_onnx/         Triton model repository + config.pbtxt
```

Two [walkthroughs](/c/llm-serving/13-single-model-service/) go through these file by file. This page is the design summary.

## The single-model architecture

The request path has four hops, and each hop exists for a reason you can name:

:::mermaid
flowchart LR
    A["POST /generate"] --> B["LLMEngine.generate"]
    B --> C["WorkloadManager<br/>queue + batch of 4"]
    C --> D["ModelExecutor<br/>mp.Queue"]
    D --> E["ModelWorker<br/>(separate process)"]
    E --> D
    D --> C
    C --> B
    B --> A
:::

**API layer** (`main.py`) — four endpoints: `/basic_generate` for one prompt with no queueing, `/generate` for a batch, `/generate_stream` for server-sent events, `/generate_vllm` for the vLLM path.

**Orchestration** (`llm.py`) — `LLMEngine` owns the workload manager and the executor, and runs a background thread (`requests_processing_loop`) that pulls a batch, executes a forward pass, and pushes tokens back to per-client queues.

**Queueing and batching** (`workload_manager.py`) — two separate queues, one for streaming and one for batch, a `batch_size = 4`, and a `Sequence` object holding the prompt, the output, a token count and the client's queue.

**Process isolation** (`model_executor.py`, `model_worker.py`) — a single `mp.Process` running the model, with `task_queue` and `result_queue` for IPC. The executor sends `(prompts, is_streaming)` and reads back either a finished batch or a streamed token list.

## The multi-model architecture

The same four-way split, with a cache instead of a queue:

:::mermaid
flowchart LR
    A["POST /predict"] --> B["ModelManager.get_model_worker"]
    B --> C{"in cache?"}
    C -- yes --> D["move_to_end<br/>return worker"]
    C -- no --> E{"len(cache) >= 2?"}
    E -- yes --> F["popitem(last=False)<br/>delete_worker"]
    E -- no --> G["ModelEngine.create_worker"]
    F --> G
    G --> H["TransformerWorker<br/>TorchVisionWorker<br/>TritonWorker"]
:::

`ModelStore` reads `config/models.json` and holds metadata for four models — two text classifiers, a MobileNetV2 image classifier, and a DenseNet served through Triton. `ModelManager` keeps an `OrderedDict` of workers capped at two, evicting the least recently used. `ModelEngine` is a factory that picks the worker class from the metadata's `framework` field.

The Triton example is the industrial version of the same idea: `model_dir/densenet_onnx/config.pbtxt` declares the model's inputs and outputs, and the server is started with `--model-control-mode=explicit` so models load on request rather than at boot.

## The design question the two services pose

Put them side by side and you get the chapter's central trade:

| | Single-model | Multi-model |
| --- | --- | --- |
| Scarce resource | Latency under load | Memory for residency |
| Complexity lives in | Batching, queueing, streaming | Cache, metadata, worker dispatch |
| Failure mode | A slow request blocks the batch | A cache miss costs a full model load |
| Cost story | Throughput per GPU | Utilisation across many small models |

Neither service is a production system, and both are honest about it. The single-model service batches at a fixed size of four with no admission control; the multi-model service downloads nothing (`# Skip the downlaod implementation for simplicity`) and has no request queue at all.

## Checkpoint

1. Which component would you change to make batching adaptive rather than fixed at four?
2. In the multi-model service, what happens on the third distinct model request, and in what order?
3. What does Triton's explicit model-control mode buy you over loading everything at startup?

## Next

The [single-model walkthrough](/c/llm-serving/13-single-model-service/) reads the code line by line, including two details that change how you think about streaming.
