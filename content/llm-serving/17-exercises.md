---
section: "17"
title: "Exercises"
kicker: "Plan"
abstract: "Twelve tasks, each naming a file and producing an artefact: a measurement, a diff, or a sentence."
time: "3 min"
order: 17
---
Each task names a file in the repository and produces a concrete artefact — a measurement, a diff, or a sentence. They are ordered so that each one uses something the previous one taught.

## 1 · Run all four endpoints

*`ch03/single_model_llm_serving/main.py`*

Start the service and call `/basic_generate`, `/generate`, `/generate_stream` and `/generate_vllm`. Time each.

Done when: you can say which endpoint used the workload manager and which bypassed it, and why `/generate_stream` needs `curl -N`.

## 2 · Find the missing KV cache

*`ch03/single_model_llm_serving/llm/model_worker.py`*

Find the line that disables the cache, then explain in one sentence what it costs per generated token.

Done when: you can predict, before running it, that per-token latency will be roughly flat rather than dropping after the first token — and you have confirmed it.

## 3 · Make streaming cheap

*Same file*

Pass `past_key_values` through `self.stream_states` so each step only processes the new token.

Done when: per-token latency for a long prompt drops after the first token, and the output text is unchanged.

## 4 · Unify the token limits

*`llm/llm.py` and `llm/model_worker.py`*

Two different limits exist — `max_tokens = 20` in the engine, `max_new_tokens=50` in the worker. Thread one value from the request through to the worker.

Done when: a single request parameter controls both paths, and the streaming path stops at the same length as the batch path.

## 5 · Watch the LRU evict

*`ch03/multi_model_serving/app/manager.py`*

With `max_models = 2`, request the four models in the config in a specific order and log each eviction.

Done when: you can state the eviction order for the sequence A, B, A, C, D — and your log agrees.

## 6 · Serve the same model twice

*`ch03/multi_model_serving/`*

Add a second entry to `config/models.json` that points at the same model name with a different id.

Done when: both ids are resident at once and you can explain why that is a memory bug rather than a feature.

## 7 · Replace `__del__`

*`app/worker.py`, `app/manager.py`*

Add an explicit `unload(model_id)` to the manager, call it on eviction, and remove the Triton unload from `__del__`.

Done when: eviction unloads the model deterministically, and you can say why relying on `__del__` is unsafe.

## 8 · Build a two-workload benchmark

*`ch09/`*

Using the notebook's helpers, benchmark one model on ShareGPT and on prefix repetition at the same request rate.

Done when: you have a table showing both, and one sentence explaining why the total-token throughput differs so much between them.

## 9 · Quantise, then re-run identically

*`ch09/`, `ch06/`*

Pick a model, benchmark it, quantise it, and re-run the *same* command with the same rate and concurrency.

Done when: your table has a before and after column per metric, and the only difference between the two runs is the model id.

## 10 · Predict the parallelism outcome

*`ch09/` phase 7*

Before running anything, predict whether tensor parallelism will help on the hardware you have. Write the prediction down, with a reason.

Done when: you have compared it with the result, and your explanation of any surprise names the interconnect rather than the GPU count.

## 11 · Read a framework's setup cost

*`ch08/`*

Install one of the three frameworks and get a single generation out of it.

Done when: you can state how long the install took, what it needed beyond `pip`, and what you would have to give up to use it instead of vLLM.

## 12 · Design multi-LoRA serving

*Nothing in the repository*

Write the design, not the code: one base model, N adapters, a per-request selection. Where does the adapter live, what is resident, and what does a cold adapter cost in TTFT?

Done when: you have two candidate designs and one measurement that would decide between them.
