---
section: "6"
title: "Chapter 4 \u2014 Best practices"
kicker: "Chapter notes"
abstract: "A working agent read as a serving client, and the four-rung build-or-buy ladder of AWS notebooks."
time: "3 min"
order: 6
---
**Covers:** serving in an agentic world (agents, RAG, CAG), enterprise serving architecture, open-source stack versus cloud vendor, build-or-buy, performance measurement.

**In the repository:** a working agent and four AWS deployment examples.

| Path | What it is |
| --- | --- |
| `ch04/KnowledgeAgent/` | A RAG-plus-planning agent: `agent.py`, `planner.py`, `rag_system.py`, `actions.py`, `llm_manager.py`, plus a `knowledge_files/` corpus of PDFs and its own tests |
| `ch04/bedrock/aws_bedrock_examples.ipynb` | Calling a managed model through `boto3` — the notebook uses `us.anthropic.claude-3-5-sonnet-20240620-v1:0` |
| `ch04/jumpstart/aws_jumpstart.ipynb` | Deploying a model through SageMaker JumpStart's `JumpStartModel` |
| `ch04/dlc/aws_dlc_serving.ipynb` | Two container routes: TorchServe for a self-built PyTorch model, and an AWS DJL image running vLLM for an LLM |
| `ch04/dlc_customization/aws_dlc_serving_customization.ipynb` | Writing your own `model.py` and `requirements.txt`, packaging them, uploading to S3, and deploying on the DJL container |

## The agent, read as a serving client

`ch04/KnowledgeAgent/` is the only place in the repository where a *client* of a model is the subject rather than the model itself. Its file split is instructive:

- `planner.py` decides what to do next
- `rag_system.py` retrieves context from `knowledge_files/`
- `actions.py` holds the things the agent can do
- `llm_manager.py` talks to the model
- `agent.py` is the loop that ties them together

Two serving consequences follow, and they are the chapter's real point for anyone running a server.

**Traffic shape changes.** An agent makes many sequential calls with small outputs and long, repetitive system prompts. That is the opposite of a chat workload's shape, and it shifts the optimisations that matter: time-to-first-token dominates, and prefix caching pays for itself immediately.

**Latency is additive across steps.** A single call that is 200 ms faster is worth little; a planner that makes ten calls makes it 2 seconds. This is why agent workloads care about p99 TTFT more than about peak throughput.

## The build-or-buy ladder, as four notebooks

The four AWS notebooks form a ladder from least to most control:

1. **Bedrock** — call a model you do not host. Least control, least work.
2. **JumpStart** — deploy a model SageMaker knows how to package.
3. **DLC with TorchServe or DJL** — deploy your model on a managed container.
4. **DLC customisation** — bring your own `model.py` and run it inside that container.

Each rung trades operational work for control, and the notebooks are deliberately trimmed (`the sample code are compiled from AWS tutorial, to show the concept clearly, we trim lots of setup code`). They are illustrations of the decision, not deployable stacks.

## Performance measurement

The repository's measurement discipline lives in chapters 6 and 9 rather than here: `vllm bench serve`, the four metrics (throughput, TTFT, TPOT, p99), and JSON results you plot afterwards. The [benchmark method walkthrough](/c/llm-serving/15-benchmark-method/) covers it.

What chapter 4 adds is the framing question: measured against what? A managed endpoint's latency excludes the queue you did not build; a self-hosted number includes your scheduler. Comparing the two without noting that is the most common error in this area.

## Checkpoint

1. Which file in `KnowledgeAgent` would you change to swap model providers, and why is it separate?
2. Name the rung of the AWS ladder where you stop controlling the model and start controlling only the container.
3. Why does an agent workload reward prefix caching more than a chat workload?

## Next

[Chapter 6](06-essential.md) begins the optimisation chapters, with a three-way quantisation comparison you can re-run.
