---
section: "1"
title: "Repository tour"
kicker: "Getting started"
abstract: "What is in each chapter directory, which chapters ship code, what runs where, and the three passes that make the repository readable."
time: "4 min"
order: 1
---
<https://github.com/orca3/llm-model-inference> — companion source code, notebooks and examples for *Hands-On LLM Serving and Optimization* by Chi Wang and Peiheng Hu (O'Reilly).

## Layout

| Directory | Chapter | What is in it |
| --- | --- | --- |
| `ch02/` | Large Language Model Serving | Five notebooks on transformer internals, execution, vLLM, batching and streaming, plus `streaming.py` |
| `ch03/single_model_llm_serving/` | Model-Serving System Design | A FastAPI service serving one LLM, with a workload manager, a model executor, a separate worker process, and a vLLM path |
| `ch03/multi_model_serving/` | Model-Serving System Design | A FastAPI service caching up to two models with an LRU, a worker factory per framework, and a Triton client |
| `ch04/KnowledgeAgent/` | Model Serving Best Practices | A RAG-plus-planning agent, with `planner.py`, `rag_system.py`, `actions.py`, `llm_manager.py` |
| `ch04/bedrock/`, `jumpstart/`, `dlc/`, `dlc_customization/` | Model Serving Best Practices | AWS deployment examples: Bedrock, SageMaker JumpStart, Deep Learning Containers, and a custom container |
| `ch06/quantization_3way_300.ipynb` | Essential Techniques | Qwen2.5-7B served three ways — fp16, GPTQ-Int4, FP8-dynamic — benchmarked with vLLM's own benchmark script |
| `ch07/SpecDecode.ipynb`, `LMCache.ipynb` | Advanced Techniques | Qwen3-32B with four speculative-decoding configurations; cold-versus-warm KV cache with LMCache |
| `ch08/SGLang.ipynb`, `TensorRT_LLM.ipynb`, `llamaCpp.ipynb` | Frameworks | The same generation in three frameworks |
| `ch09/model_optimization_in_practice.ipynb` | In Practice | Seven phases on Qwen3-14B: GPU inspection, traffic generation, metrics, baseline, quantisation, distributed serving |

Chapters 1 and 5 are conceptual and ship no code. There is no `ch01/` or `ch05/`.

## What runs where

Most chapters are notebooks with a Colab badge at the top, so the cheapest way to read the code is also the way to run it.

| Chapter | Runs on | Note |
| --- | --- | --- |
| 2 | Colab, GPU runtime | `ch2_Inside_the_Mind_of_a_Transformer` needs a GPU for the attention visualisations; the rest is lighter |
| 3 | Local machine | Install the chapter's requirements, then start either service: port 8000 for the single-model one, 8001 for the multi-model one |
| 4 | AWS account | Bedrock, SageMaker and S3 calls; the notebooks are trimmed to key steps |
| 6 | GPU with vLLM | Clones the vLLM repository to get its benchmark script; needs a CUDA box |
| 7 | GPU with vLLM | Speculative decoding wants a large model (Qwen3-32B) to show a win; LMCache needs a KV-transfer-capable setup |
| 8 | Depends | llama.cpp runs anywhere; TensorRT-LLM needs NVIDIA tooling; SGLang needs a GPU for meaningful numbers |
| 9 | GPU with vLLM | Two GPU types are used in the recorded results: `g6e` and `p4d` EC2 instances |

## The two runnable services

Both are in `ch03/` and both are small enough to read in an afternoon.

```bash
# single-model service — port 8000
cd ch03/single_model_llm_serving
pip install -r requirements.txt
python main.py

# multi-model service — port 8001
cd ch03/multi_model_serving
pip install -r requirements.txt
python -m app.server
```

The single-model service exposes four endpoints: `/basic_generate` (one prompt, no queue), `/generate` (many prompts, batched through the workload manager), `/generate_stream` (server-sent events, one token at a time) and `/generate_vllm` (the same batch through vLLM). The multi-model service exposes two: `/models` and `/predict`.

## How to read this repository

Three passes, in this order.

**First, read chapter 3.** It is the only place where a whole serving system is assembled from parts, and every other chapter either explains one of those parts or replaces it with a framework. The [single-model walkthrough](/c/llm-serving/13-single-model-service/) goes through it file by file.

**Second, run chapter 2's notebooks.** They answer the question chapter 3's code raises but does not explain: what is actually being recomputed on each token, and why the first token is slow.

**Third, work through chapter 9's phases.** It is the method — inspect, generate traffic, define metrics, baseline, quantise, distribute — and it is the one chapter whose structure you will reuse on your own hardware.

Chapters 6, 7 and 8 are reference material you will come back to when you have a specific problem: quantisation choices, speculative decoding, or a framework swap.

## What the repository does not include

Worth knowing before you look for it:

- No chapter 1 or 5 code — those chapters are conceptual.
- No Kubernetes or Terraform; deployment examples are notebook-level AWS calls.
- The multi-model service's model download step is commented out (`# Skip the downlaod implementation for simplicity` in `manager.py`), so models are expected to be resolvable by name from the Hub.
- No shared benchmark harness across chapters — each notebook carries its own setup, which is why comparing across chapters is not apples-to-apples.

That last point matters more than it looks. Chapter 6 benchmarks Qwen2.5-7B, chapter 7 benchmarks Qwen3-32B, chapter 9 benchmarks Qwen3-14B. The *method* transfers between them; the numbers do not.
