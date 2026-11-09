---
section: "19"
title: "Sources"
kicker: "Reference"
abstract: "The repository, the book, the Gemma 3 model configs and GPU spec sheets the course computes from, the third-party projects the repository leans on, and a note on which numbers are derived, which are illustrative and which are the repository's."
time: "4 min"
order: 19
---
## The repository these notes cover

<https://github.com/orca3/llm-model-inference> — companion source code, notebooks and examples for the book. The course's structure, code walkthroughs and methods are drawn from it: `README.md`, `CHANGELOG.md`, the code under `ch02/`–`ch09/`, and what the notebooks vary and measure.

Files referenced most often:

| Path | Why it matters |
| --- | --- |
| `ch02/ch2_Workthrough_LLM_execution.ipynb` | Per-token timing chart — the prefill/decode asymmetry, measured |
| `ch02/ch2_Inside_the_Mind_of_a_Transformer.ipynb` | Model config, architecture, attention visualisation, memory calculation |
| `ch02/streaming.py` | Streaming with vLLM's async engine |
| `ch03/single_model_llm_serving/llm/*.py` | Engine, workload manager, executor, worker, model manager (demo model `facebook/opt-125m`) |
| `ch03/multi_model_serving/app/*.py` | Store, LRU manager, worker factory, three workers |
| `ch03/multi_model_serving/model_dir/densenet_onnx/config.pbtxt` | Triton model configuration |
| `ch06/quantization_3way_300.ipynb` | One model at fp16, GPTQ int4 and FP8-dynamic, benchmarked at concurrency 1, 10 and 100 |
| `ch07/SpecDecode.ipynb` | Four configurations of one target — no speculation, n-gram, tuned n-gram, EAGLE-3 — on Spec-Bench at concurrency 1 |
| `ch07/LMCache.ipynb` | Cold versus warm KV cache, 30 samples each |
| `ch08/*.ipynb` | SGLang, TensorRT-LLM, llama.cpp |
| `ch09/model_optimization_in_practice.ipynb` | Seven-phase study: GPU inventory, two workloads, metrics, baseline, an AWQ build of the same model, then tensor parallelism on `g6e` and `p4d` |

## The book

**Hands-On LLM Serving and Optimization: Hosting LLMs at Scale** — Chi Wang and Peiheng Hu, O'Reilly.

- Book website: <https://orca3.github.io/llm-model-inference/>
- Read on O'Reilly: <https://www.oreilly.com/library/view/hands-llm-serving/9798341621480/>
- Amazon: <https://www.amazon.com/Hands-LLM-Serving-Optimization-Hosting/dp/B0G48JRRMF>

These notes describe the repository's code and methods; they do not summarise the book's prose. Where a chapter is conceptual and ships no code (chapters 1 and 5), the notes say so and point at the later artefacts that make its ideas measurable.

## The model and hardware the numbers come from

**Gemma 3** (Google DeepMind) — the course's running example. Layer counts, hidden sizes, attention and KV head counts, head dimension, FFN width, vocabulary, sliding-window size and the 5 local : 1 global layer pattern are read from the published `config.json` of each instruction-tuned checkpoint on Hugging Face:

- <https://huggingface.co/google/gemma-3-1b-it>
- <https://huggingface.co/google/gemma-3-12b-it>
- <https://huggingface.co/google/gemma-3-27b-it>

The Gemma documentation and model cards are at <https://ai.google.dev/gemma>; the Gemma 3 technical report from Google DeepMind describes the architecture, including the interleaved local/global attention. Google also publishes quantisation-aware-trained int4 Gemma 3 checkpoints; the course mentions them but quotes no numbers for them. The checkpoints are gated: accept the licence on Hugging Face before downloading.

**GPUs** — NVIDIA's published data sheets for the **L40S** (48 GB GDDR6, 864 GB/s, about 362 dense bf16 TFLOPS, PCIe only; AWS `g6e`) and the **A100 40 GB SXM** (HBM2, 1,555 GB/s, 312 dense bf16 TFLOPS, NVLink; AWS `p4d`). The 46,068 MiB usable-memory figure for the L40S is what `nvidia-smi` reports on a `g6e`.

## How this reading started

A LinkedIn post by Kalyan KS sharing the book's chapter outline, which linked to the companion repository above. The repository is the primary source for the course's structure and methods.

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

The repository's notebooks were run on a different open-weight model than the one this course uses, so their recorded results are referenced **qualitatively only** — what each notebook varies, what it measures, and model-independent findings such as chapter 9's: tensor parallelism made things worse on PCIe-only `g6e` instances and better on NVLink `p4d` instances. No figure on this site is transcribed from a notebook.

Every number is instead one of three kinds, and each page says which:

| Kind | Where it comes from | Examples |
| --- | --- | --- |
| **Derived** | Gemma 3 `config.json` values and GPU spec-sheet bandwidth and FLOP/s, with the arithmetic shown or a script that runs as printed | 384 KiB of KV per token and a 27.2 ms bf16 decode floor for Gemma 3 12B on an L40S |
| **Illustrative** | Assumptions, labelled as such where they are used | GPU prices ($2.00 per L40S-hour, $4.00 per A100-hour), MFU, memory reserves, disk and network rates, acceptance rates, the HelpDesk workload and its SLO |
| **Simulated** | Seeded simulations whose inputs are illustrative | LRU hit rates, p99 confidence bands, semantic-cache thresholds |

Derived numbers are first-principles floors and estimates, not measurements: real kernels land above the bandwidth floor and below peak FLOP/s, and engines differ in how they allocate KV for sliding-window layers. The course therefore presents KV as a range (every layer full, upper bound; window-aware, lower bound) and asks you to read the KV-cache size from your server's startup log. Treat each prediction as the number a measurement should be checked against — the method in [The benchmark method](/c/llm-serving/15-benchmark-method) is how to take that measurement.

Where the repository records a method but no summary figure — chapter 6's three-way comparison produces plots rather than a table — this site says so instead of inventing one.
