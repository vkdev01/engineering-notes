---
section: "13"
title: "The single-model service, file by file"
kicker: "Code walkthroughs"
abstract: "Queue, batch, worker process, streaming bridge \u2014 and the one line that disables the KV cache on every streamed token."
time: "5 min"
order: 13
---
`ch03/single_model_llm_serving/` — a FastAPI service that serves `facebook/opt-125m`, with a workload manager, a separate worker process, and a vLLM path alongside the Transformers one. About 580 lines of Python across six files.

```bash
pip install -r requirements.txt
python main.py          # http://localhost:8000
```

## The request path

:::mermaid
flowchart TD
    A["POST /generate"] --> B["main.py: generate()"]
    B --> C["LLMEngine.generate()"]
    C --> D["WorkloadManager.add_request()<br/>queue"]
    D --> E["get_next_batch()<br/>up to 4 sequences"]
    E --> F["ModelExecutor.execute_batch()"]
    F --> G["mp.Queue → ModelWorker<br/>separate process"]
    G --> H["transformers generate()"]
    H --> F
    F --> E
    E --> C
    C --> A
:::

## `main.py` — the API layer

Four endpoints, one dependency, and a lock:

```python
_llm = None
_llm_lock = multiprocessing.Lock()

def get_llm():
    global _llm
    with _llm_lock:
        if _llm is None:
            _llm = LLMEngine()
            atexit.register(cleanup)
        return _llm
```

| Endpoint | Path | Behaviour |
| --- | --- | --- |
| `/basic_generate` | No queue | One prompt, executed directly through the executor |
| `/generate` | Batched | Many prompts, routed through the workload manager |
| `/generate_stream` | SSE | One prompt, tokens pushed as `text/event-stream` |
| `/generate_vllm` | Batched | The same batch through the vLLM model object |

The service runs on `0.0.0.0:8000` via `uvicorn.run(app, host="0.0.0.0", port=8000)`, with `SIGINT` and `SIGTERM` handlers that call `cleanup()`.

## `llm/llm.py` — orchestration

`LLMEngine.__init__` does three things: it starts a worker process for `facebook/opt-125m`, it loads a second copy of the same model through vLLM, and it starts a daemon thread running `requests_processing_loop`.

```python
self.model_executor.setup_worker("facebook/opt-125m")
self.vllm_model = VLLM(model="facebook/opt-125m")
self.thread = threading.Thread(target=self.requests_processing_loop, daemon=True)
self.thread.start()
```

The loop is the streaming path: pull a batch of streaming sequences, run one forward pass for the batch, then push each result back to its own client queue with `asyncio.run_coroutine_threadsafe`. That call is the bridge between a worker thread (no event loop) and an async endpoint (has one).

Note that two full copies of the model are resident — one in the worker process, one in vLLM. That is a demo convenience, not a design you would ship.

## `llm/workload_manager.py` — queueing and batching

Two queues, because streaming and non-streaming requests have different lifecycles:

```python
self.incoming_queue: Queue[Sequence] = Queue()
self.active_sequences: List[Sequence] = []
self.incoming_streaming_queue: Queue[Sequence] = Queue()
self.active_streaming_sequences: List[Sequence] = []
self.batch_size = 4
```

`get_next_batch()` tops the active list up to `batch_size` from the incoming queue and returns it. A `Sequence` carries its id, prompt, output list, token count, and — for streaming — the client's queue and event loop.

`update_sequence_output` is where the autoregressive loop actually lives:

```python
sequence.output.append(token)
sequence.prompt += token
sequence.token_count += 1
```

The prompt grows by one token each step. That is a correct mental model of generation and an inefficient implementation of it — see the `use_cache` note below.

## `llm/model_executor.py` — process isolation

Two `mp.Queue` objects, one `mp.Process`, and two methods that differ only in a flag:

```python
self.task_queue.put((prompts, False))   # execute_batch  → (results)
self.task_queue.put((prompts, True))    # execute_forward_batch → ('stream', results)
```

The batch path returns a completed result; the streaming path returns one token per prompt. The `__del__` terminates and joins the worker.

## `llm/model_worker.py` — the model

Two generation methods, and the difference between them is the most instructive thing in the directory.

```python
# batch: the whole completion, in one call
outputs = self.model.generate(inputs.input_ids, attention_mask=..., max_new_tokens=50, ...)

# streaming: exactly one token, recomputed from scratch
outputs = self.model(input_ids=encoded.input_ids, attention_mask=..., use_cache=False)
next_token_logits = outputs.logits[:, -1, :]
next_token = torch.multinomial(torch.softmax(next_token_logits / 0.7, dim=-1), num_samples=1)
```

`use_cache=False` means the KV cache is disabled: each streaming step re-runs the full forward pass over the entire prompt, which has been growing by one token per step. It is the single most expensive line in the repository, and it is there to keep the walkthrough simple — the `stream_states` dictionary is initialised in `__init__` with a comment about `(input_ids, attention_mask, past_key_values)` but is never used.

Reading this next to chapter 2's timing chart is the point: the chart shows what a KV cache buys, and this line shows what removing it costs.

Two smaller details worth noticing:

- The batch path generates up to 50 new tokens (`max_new_tokens=50`) while the engine's streaming loop stops at `max_tokens = 20`. Two different limits, set in two different files.
- End-of-sequence detection decodes the sampled token and compares it to the EOS token *string*: `'is_finished': token == self.tokenizer.eos_token`. Comparing ids would be more robust, since decoding can drop or alter special tokens.

## `llm/model_manager.py` — loading

Fifteen lines: create `model_cache/`, `from_pretrained` twice, return the pair. The cache directory is created and never used — there is no local model store, which is why the chapter's "fetch" stage is effectively delegated to the Hub's own cache.

## Tests

Three artefacts, each testing a different layer:

| File | Layer | How |
| --- | --- | --- |
| `tests/test_api.py` | HTTP | `fastapi.testclient.TestClient` with a session-scoped event loop fixture |
| `tests/test_vllm.py` | vLLM path | Exercises `/generate_vllm` |
| `tests/test_stream.sh` | Streaming | Boots the real server, waits up to 30 s for it, sends a streaming request, and parses each `data:` line with `jq` |

`test_stream.sh` is the interesting one, because streaming is exactly what in-process tests miss: a response that buffers instead of streaming passes a TestClient assertion and fails a human watching `curl -N`.

```bash
curl -N -H "Accept: text/event-stream" \
     -H "Content-Type: application/json" \
     -d '{"prompt": "Hello, I am"}' \
     http://localhost:8000/generate_stream
```

## What you would change first

1. **Turn the KV cache on** in `generate_forward_batch`, and pass `past_key_values` through `stream_states`. This is the one change that makes streaming realistic.
2. **Unify the token limits** — one parameter, threaded from the request.
3. **One model copy, not two.** Pick vLLM or the worker, not both.
4. **Make `batch_size` adaptive**, or at least configurable, instead of a constant 4 in `WorkloadManager.__init__`.

Each of these is a small diff and a large conceptual gain, which is what makes this directory a good teaching artefact.
