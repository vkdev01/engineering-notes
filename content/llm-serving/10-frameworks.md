---
section: "10"
title: "Chapter 8 \u2014 Frameworks"
kicker: "Chapter notes"
abstract: "SGLang, TensorRT-LLM and llama.cpp side by side, compared on what it costs to start rather than on speed."
time: "3 min"
order: 10
---
**Covers:** vLLM internals, TensorRT-LLM, SGLang, llama.cpp, and how to choose.

**In the repository:** three notebooks, one per framework, all doing the same thing — generating text from a few prompts — so the comparison is about ergonomics and prerequisites rather than about speed.

| Notebook | Entry point | What you see |
| --- | --- | --- |
| `ch08/SGLang.ipynb` | Offline engine API from SGLang's getting-started tutorial | An async offline engine, prompts submitted as a batch, output collected |
| `ch08/TensorRT_LLM.ipynb` | `from tensorrt_llm import LLM, SamplingParams` | Install steps (`libopenmpi-dev`, `tensorrt_llm`), then a compile-and-generate call |
| `ch08/llamaCpp.ipynb` | `from llama_cpp import Llama` | Loading a GGUF from the Hub, then `create_chat_completion` |

## The three, side by side

**SGLang** is the notebook closest to a service: it builds an offline engine, submits several prompts, and prints results. The code is short because the framework is doing the batching. SGLang's distinguishing feature in the book's discussion — RadixAttention for prefix reuse — is what makes this the natural choice for workloads with long shared prompts.

**TensorRT-LLM** has the heaviest setup of the three, and the notebook shows why: system packages, a large wheel, and then an `LLM` object that compiles the model for your GPU. You are trading portability and install time for compiled kernels. The notebook also notes that the model argument accepts an HF name, a local path, or a quantised checkpoint — which is where the framework meets chapter 6.

**llama.cpp** is the smallest. The install is a `pip install llama-cpp-python` with `CMAKE_ARGS` for BLAS, the model is a GGUF pulled from the Hub, and the API is `create_chat_completion`. It runs on a laptop, which neither of the others does comfortably.

## What the notebooks let you compare

Not throughput — the prompts are tiny and the models differ. What they let you compare honestly is **what it costs to start**:

| | Install | Model format | Runs on |
| --- | --- | --- | --- |
| SGLang | `pip install uv`, then SGLang | HF weights | GPU |
| TensorRT-LLM | System packages, large wheel, compile step | HF or quantised checkpoint, compiled | NVIDIA GPU |
| llama.cpp | `pip install llama-cpp-python` with CMake args | GGUF | CPU, Metal, CUDA |

That table is the decision for most people. If you need the last few percent of throughput on fixed NVIDIA hardware, TensorRT-LLM. If you are serving many users with shared prefixes, SGLang. If you want to run a model at all, on whatever you have, llama.cpp.

## The fourth framework, everywhere else

vLLM is not in `ch08/` because it is the substrate for chapters 2, 6, 7 and 9. It appears in the notebook for chapter 2 as the comparison against plain Transformers, and in chapters 6, 7 and 9 as `vllm serve` plus `vllm bench serve`.

That is worth noticing: the repository treats vLLM as the default and the other three as alternatives, which mirrors the field.

## Reading the frameworks against chapter 3

Chapter 3 builds a serving service by hand — queue, batch, worker process, streaming bridge. Each `ch08` notebook is that entire service compressed into a constructor call. Comparing them is the fastest way to see what a framework actually does for you:

- SGLang's offline engine replaces the workload manager and executor
- TensorRT-LLM replaces the executor and the kernel selection
- llama.cpp replaces the executor and the memory layout

None of them replaces the API layer, which is why chapter 3's FastAPI code remains useful even after you adopt a framework.

## Checkpoint

1. Which notebook has the heaviest install, and what does that buy?
2. What model format does llama.cpp need, and where does the notebook get it?
3. Which of chapter 3's components does a framework *not* replace?
4. If your workload is an agent with a 4k-token system prompt repeated on every call, which framework's headline feature is aimed at you?

## Next

[Chapter 9](09-in-practice.md) is the capstone: a seven-phase plan you can re-run on your own hardware.
