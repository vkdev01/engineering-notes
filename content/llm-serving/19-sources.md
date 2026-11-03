---
section: "19"
title: "Sources"
kicker: "Reference"
abstract: "The repository, the book, the third-party projects it leans on, and a note on what the numbers are worth."
time: "3 min"
order: 19
---
## The repository these notes cover

<https://github.com/orca3/llm-model-inference> — companion source code, notebooks and examples for the book. Everything on this site is drawn from it: `README.md`, `CHANGELOG.md`, the code under `ch02/`–`ch09/`, and the results recorded inside the notebooks.

Files referenced most often:

| Path | Why it matters |
| --- | --- |
| `ch02/ch2_Workthrough_LLM_execution.ipynb` | Per-token timing chart — the prefill/decode asymmetry, measured |
| `ch02/ch2_Inside_the_Mind_of_a_Transformer.ipynb` | Model config, architecture, attention visualisation, memory calculation |
| `ch02/streaming.py` | Streaming with vLLM's async engine |
| `ch03/single_model_llm_serving/llm/*.py` | Engine, workload manager, executor, worker, model manager |
| `ch03/multi_model_serving/app/*.py` | Store, LRU manager, worker factory, three workers |
| `ch03/multi_model_serving/model_dir/densenet_onnx/config.pbtxt` | Triton model configuration |
| `ch06/quantization_3way_300.ipynb` | Three-precision quantisation comparison with a concurrency sweep |
| `ch07/SpecDecode.ipynb` | Four speculative-decoding configurations on Qwen3-32B |
| `ch07/LMCache.ipynb` | Cold versus warm KV cache, 30 samples each |
| `ch08/*.ipynb` | SGLang, TensorRT-LLM, llama.cpp |
| `ch09/model_optimization_in_practice.ipynb` | Seven-phase optimisation study on Qwen3-14B, with recorded JSON results |

## The book

**Hands-On LLM Serving and Optimization: Hosting LLMs at Scale** — Chi Wang and Peiheng Hu, O'Reilly.

- Book website: <https://orca3.github.io/llm-model-inference/>
- Read on O'Reilly: <https://www.oreilly.com/library/view/hands-llm-serving/9798341621480/>
- Amazon: <https://www.amazon.com/Hands-LLM-Serving-Optimization-Hosting/dp/B0G48JRRMF>

These notes describe the repository's code and results; they do not summarise the book's prose. Where a chapter is conceptual and ships no code (chapters 1 and 5), the notes say so and point at the later artefacts that make its ideas measurable.

## How this reading started

A LinkedIn post by Kalyan KS sharing the book's chapter outline, which linked to the companion repository above. The repository is the primary source for everything on this site.

## Third-party projects the repository uses

- vLLM — serving and benchmarking in chapters 2, 6, 7 and 9
- SGLang — `ch08/SGLang.ipynb`
- TensorRT-LLM — `ch08/TensorRT_LLM.ipynb`
- llama.cpp / llama-cpp-python — `ch08/llamaCpp.ipynb`
- NVIDIA Triton Inference Server — the `densenet_onnx` example
- LMCache — `ch07/LMCache.ipynb`
- Spec-Bench — the benchmark harness in `ch07/SpecDecode.ipynb`
- ShareGPT dataset — the benchmark traffic in chapters 6 and 9
- Hugging Face Transformers and Hub — everywhere
- AWS Bedrock, SageMaker JumpStart, Deep Learning Containers — `ch04/`

## A note on the numbers

Every benchmark figure quoted on this site is transcribed from the recorded results inside the notebooks, and each table names the model, dataset, request rate and concurrency it was run at. They are properties of the hardware the authors used — `g6e` and `p4d` EC2 instances for chapter 9 — not universal constants. The ratios and the ordering of experiments transfer; the absolute values do not.

Where the repository records a method but no summary figure — chapter 6's three-way comparison produces plots rather than a table — this site says so instead of inventing one.
