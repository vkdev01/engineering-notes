---
section: "12"
title: "Testing decision systems"
kicker: "Correctness"
abstract: "Test the model boundary, policy logic, data contracts, fallbacks, and safety properties with deterministic fixtures and adversarial cases."
time: "24 min"
order: 12
outcomes:
  - "Build unit, contract, integration, regression, and property-based tests"
  - "Separate model variability from deterministic policy correctness"
  - "Test abstention, malformed output, retries, and harmful edge cases"
---
# 12.1 Test the system, not only the model

A language model is a stochastic dependency. The surrounding system is ordinary software and should be tested with the same discipline as any other production service.

A useful test pyramid:

~~~text
             /  end-to-end         few, slow, realistic
            / integration   \      model + retrieval + policy
           / contract tests  \     schemas, adapters, tool boundaries
          / deterministic unit\    thresholds, costs, parsing, auth
         /_____________________\
~~~

The lower layers should be fast and deterministic. Do not make every unit test download a model or call a paid API.

## 12.2 Unit-test the policy independently

The policy receives probabilities or structured signals and chooses an action. Test its decision boundaries exactly, including equality behaviour.

~~~python
def choose_action(p_positive, threshold, in_scope=True):
    if not in_scope:
        return "review"
    if p_positive is None or not 0 <= p_positive <= 1:
        return "review"
    return "approve" if p_positive >= threshold else "decline"

def test_boundaries():
    assert choose_action(0.79, 0.80) == "decline"
    assert choose_action(0.80, 0.80) == "approve"
    assert choose_action(0.99, 0.80, in_scope=False) == "review"
    assert choose_action(None, 0.80) == "review"

test_boundaries()
print("4 policy assertions passed")
~~~

Expected output: `4 policy assertions passed`.

These tests are more valuable than asking an LLM to verify that your threshold code "looks right". The expected result is known exactly.

## 12.3 Contract-test model output

Treat generated text as untrusted input. Parse it, validate the schema, then validate semantics and authorization. Include cases for:

- missing fields and extra fields;
- wrong types, NaN, infinity, and values outside [0, 1];
- unknown labels and empty evidence;
- valid JSON with semantically contradictory fields;
- refusal, truncation, timeout, and non-UTF-8 payloads.

A parser should fail closed. Never convert a parsing error into a default high-confidence decision.

## 12.4 Integration tests with a fake model

Inject a model adapter rather than hard-coding a provider call inside business logic.

~~~python
class FakeModel:
    def __init__(self, response):
        self.response = response
    def classify(self, text):
        return self.response

def decide(text, model):
    raw = model.classify(text)
    if not isinstance(raw, dict):
        return {"action": "review", "reason": "invalid_response"}
    label = raw.get("label")
    score = raw.get("score")
    if label not in {"approve", "decline"}:
        return {"action": "review", "reason": "unknown_label"}
    if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= 1:
        return {"action": "review", "reason": "invalid_score"}
    return {"action": label, "reason": "model_result"}

assert decide("x", FakeModel({"label":"approve","score":0.9}))["action"] == "approve"
assert decide("x", FakeModel({"label":"root","score":0.99}))["action"] == "review"
assert decide("x", FakeModel("not-json"))["action"] == "review"
print("integration contract checks passed")
~~~

Expected output: `integration contract checks passed`.

## 12.5 Regression tests for probabilistic behaviour

Exact string equality is often too brittle for generative output. Define task-level assertions: correct label, schema validity, evidence grounded in input, no forbidden action, and acceptable latency. Keep a fixed, versioned evaluation set and compare metrics across releases.

For non-deterministic models, run repeated samples on a representative subset. Record model identifier, prompt hash, decoding parameters, seed when supported, provider/API version, timestamp, and dataset version.

## 12.6 Property-based and metamorphic tests

Property tests express invariants over many generated inputs. Examples:

- probability must always remain in [0, 1];
- increasing the estimated probability of a positive outcome must not reduce the expected utility of an action that benefits from that outcome, all else equal;
- reordering independent records must not change per-record predictions;
- adding irrelevant metadata must not change a decision;
- malformed or out-of-scope inputs must never result in privileged actions.

Metamorphic testing is useful when no single gold answer exists. You define transformations that should preserve or predictably alter behaviour, then test that relationship.

## 12.7 Failure injection

Simulate model timeout, provider 429/500, empty retrieval, stale evidence, malformed output, queue saturation, and duplicate delivery. Verify bounded retries, exponential backoff with jitter, deadlines, idempotency, and safe fallback. A retry is not harmless if the operation has already changed external state.

## 12.8 Test data governance

Do not put real secrets, credentials, or unnecessary personal data into fixtures. Use synthetic or properly de-identified examples. Restrict access to production traces and define retention. Tests themselves can become a data leak.

## 12.9 Knowledge check

1. Which tests should run without a model download?
2. Why is a valid JSON object not necessarily a valid decision?
3. What does a metamorphic test check?
4. Why must retries be bounded and idempotent?

**Answers:** 1. Policy, parser, schema, cost, and deterministic unit tests. 2. It may violate business semantics, evidence requirements, or authorization. 3. A predictable relationship between outputs under a controlled input transformation. 4. To prevent runaway load and duplicate side effects.
