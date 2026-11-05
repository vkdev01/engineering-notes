---
section: "21"
title: "Unit testing"
kicker: "Testing"
abstract: "Test the policy, the cost arithmetic and the output contract exactly — with properties, mutants and generated inputs — and test the model only against a tolerance derived from binomial noise."
time: "15 min"
order: 21
outcomes:
  - "Write property tests for a cost-based policy: cut points, ties, monotonicity, scale invariance, fail-closed"
  - "Check a test suite by injecting realistic mutants and counting which tests catch them"
  - "Fuzz a model-output parser with generated malformed JSON and assert it never auto-approves"
  - "Size a model smoke test: error limit, false-failure rate and power from the binomial distribution"
---

A loan-triage service has three layers of code around one model call: a parser that turns the model's text into a probability, a policy that turns the probability into `decline`, `manual_review` or `auto_approve`, and the cost table both are built on. Six months in, someone rounds probabilities to two decimals "for the logs", someone else lets a parser accept `true` as 1.0, and a new review price is typed with a missing zero. None of these moves an offline AUC; all of them move decisions worth ₹24,000–₹120,000 each. Every one is caught in milliseconds by a test that never loads a model.

:::key[First principle]
Split the system into what is **deterministic** (policy arithmetic, parsing, contracts) and what is **statistical** (the model). Test the deterministic part exactly, as properties over thousands of inputs. Test the model only against a tolerance computed from sampling noise — never against an exact output.
:::

The deep course builds the full pyramid (policy, contract, golden set, metamorphic, shadow, canary) in [Testing decision systems](/c/practical-slm-decision-models/12-testing-decision-systems). This section is the unit layer as a working recipe.

## 21.1 What a unit test can and cannot see

| Target | Deterministic? | Assert | Runs |
| --- | --- | --- | --- |
| Cut points from the cost matrix | yes | exact edges, e.g. 0.125 and 0.975 | < 10 ms |
| Policy properties | yes | monotone in $p$, ties, scale invariance, fail-closed | < 1 s |
| Output parser / contract | yes | every malformed shape → review, never approve | < 1 s |
| Cost arithmetic and metrics | yes | hand-computed values on tiny inputs | < 10 ms |
| Calibrator | statistical | recovers a known temperature within a tolerance | ~10 ms |
| The model | statistical | error count ≤ a limit derived from binomial noise (§21.4) | seconds–minutes, marked `slow` |

The model's exact output — a string, a logit, a probability to six decimals — changes with every tokenizer update, quantisation or prompt edit. Assert the properties you depend on: the parsed action, the schema, the error rate within tolerance.

## 21.2 The policy is arithmetic: test its properties

With review priced at ₹3,000 (fully loaded, illustrative), the expected cost of each action at $p = P(\text{good})$ is

$$
E[\text{decline}] = 24{,}000\,p, \qquad E[\text{review}] = 3{,}000, \qquad E[\text{approve}] = 120{,}000\,(1-p),
$$

so the policy declines below \(3{,}000/24{,}000 = 0.125\), approves above \(1 - 3{,}000/120{,}000 = 0.975\), and reviews in between ([derivation](/c/practical-slm-decision-models/04-decision-theory)). The picture is the whole specification:

:::chart[Expected cost per application by action (review ₹3,000)]{type="line" x="p = P(good)" y="expected cost" prefix="₹" xfmt="dec2" marks="0.125:decline/review;0.8333:p* (no review);0.975:review/approve" dash="policy (min)" note="The policy is the lower envelope; approve is drawn from p = 0.75, where its cost falls below ₹30,000."}
p, decline, manual_review, auto_approve, policy (min)
0, 0, 3000, -, 0
0.05, 1200, 3000, -, 1200
0.1, 2400, 3000, -, 2400
0.125, 3000, 3000, -, 3000
0.15, 3600, 3000, -, 3000
0.2, 4800, 3000, -, 3000
0.3, 7200, 3000, -, 3000
0.4, 9600, 3000, -, 3000
0.5, 12000, 3000, -, 3000
0.6, 14400, 3000, -, 3000
0.7, 16800, 3000, -, 3000
0.75, 18000, 3000, 30000, 3000
0.8, 19200, 3000, 24000, 3000
0.8333, 19999, 3000, 20004, 3000
0.85, 20400, 3000, 18000, 3000
0.9, 21600, 3000, 12000, 3000
0.95, 22800, 3000, 6000, 3000
0.975, 23400, 3000, 3000, 3000
1, 24000, 3000, 0, 0
:::

Five properties follow from the chart, and each is a test:

1. **Cut points** sit at 0.125 and 0.975 — probe just either side.
2. **Ties are a decision.** At $p = 0.125$ decline and review both cost ₹3,000; break ties toward review (the conservative action) and pin it.
3. **Monotone in $p$.** A higher probability of repaying never yields a harsher action.
4. **Scale invariant.** Costs in paise or another currency change no decision.
5. **Fails closed.** `None`, NaN, ±∞, out-of-range values, strings and booleans all go to review.

The harness below is plain Python so it runs anywhere; under pytest, rename `t_*` to `test_*` and drop `run`.

```python run
ACTIONS = ("decline", "manual_review", "auto_approve")       # ordered: worst -> best for the applicant
COSTS = {"auto_approve": (120_000, 0), "decline": (0, 24_000),   # INR: (if bad, if good)
         "manual_review": (3_000, 3_000)}                         # fully loaded review, illustrative
TIES = ("manual_review", "decline", "auto_approve")               # tie-break order: review first


def policy(p, c=COSTS, ties=TIES):
    """Argmin of expected cost on p = P(good); anything that is not a probability goes to review."""
    if isinstance(p, bool) or not isinstance(p, (int, float)) or not 0.0 <= p <= 1.0:
        return "manual_review"                                    # NaN fails the range check too
    e = {a: (1 - p) * c[a][0] + p * c[a][1] for a in ACTIONS}
    return min(ties, key=e.get)                                   # min keeps the first of equal costs


def t_cut_points(pol):
    assert pol(0.1249) == "decline" and pol(0.1251) == "manual_review"
    assert pol(0.9749) == "manual_review" and pol(0.9751) == "auto_approve"


def t_ties_go_to_review(pol):
    assert pol(0.125) == pol(0.975) == "manual_review"


def t_monotone_in_p(pol):
    ranks = [ACTIONS.index(pol(i / 10_000)) for i in range(10_001)]
    assert all(a <= b for a, b in zip(ranks, ranks[1:]))


def t_currency_scale_invariant(pol):
    for k in (0.01, 83.0):                                        # paise, or another currency
        c = {a: (k * x, k * y) for a, (x, y) in COSTS.items()}
        assert all(pol(i / 997, c) == pol(i / 997) for i in range(998))


def t_fails_closed(pol):
    for x in (None, float("nan"), -0.01, 1.01, True, "0.99", float("inf")):
        assert pol(x) == "manual_review", x


TESTS = [t_cut_points, t_ties_go_to_review, t_monotone_in_p, t_currency_scale_invariant, t_fails_closed]


def run(pol):
    failed = []
    for t in TESTS:
        try:
            t(pol)
        except AssertionError:
            failed.append(t.__name__[2:])
    return failed


print("correct policy:", f"{len(TESTS) - len(run(policy))}/{len(TESTS)} tests pass")
```

```output
correct policy: 5/5 tests pass
```

:::warn[Two Python defaults that approve loans]
`isinstance(True, int)` is `True`, so without the explicit `bool` check a model that emits `true` is read as $p = 1$ and auto-approved. And every comparison with NaN is `False`: a guard written as `if p < 0 or p > 1: reject` lets NaN through, whereas `not 0.0 <= p <= 1.0` rejects it.
:::

### Do the tests catch anything? Inject mutants

A suite that passes proves little until you have seen it fail. **Mutation testing** makes one realistic edit to the code under test and checks that at least one test fails. Five edits that each look harmless in review (continuing the block above):

```python run
MUTANTS = {   # one realistic edit each; a good suite fails every one of them
    "approve cost typed 12,000": lambda p, c=COSTS: policy(p, {**c, "auto_approve": (12_000, 0)}),
    "ties broken toward decline": lambda p, c=COSTS: policy(p, c, ties=ACTIONS),
    "p rounded to 2 decimals": lambda p, c=COSTS: policy(round(p, 2) if type(p) is float else p, c),
    "bool accepted as 0/1": lambda p, c=COSTS: policy(float(p) if type(p) is bool else p, c),
    "out-of-range p clipped": lambda p, c=COSTS: policy(min(max(p, 0.0), 1.0) if type(p) is float else p, c),
}
killed = 0
for name, pol in MUTANTS.items():
    failed = run(pol)
    killed += bool(failed)
    print(f"{name:27s} caught by: {', '.join(failed) or 'NOTHING - add a test'}")
print(f"mutation score: {killed}/{len(MUTANTS)}")
```

```output
approve cost typed 12,000   caught by: cut_points, ties_go_to_review, currency_scale_invariant
ties broken toward decline  caught by: ties_go_to_review
p rounded to 2 decimals     caught by: ties_go_to_review
bool accepted as 0/1        caught by: fails_closed
out-of-range p clipped      caught by: fails_closed
mutation score: 5/5
```

- **Three of five mutants are caught by exactly one test.** Delete the tie test and two bugs ship; delete the fail-closed test and two more do. Tests that look redundant on the happy path are often the only guard on an edge.
- **The typo moves the approve edge** from 0.975 to \(1 - 3{,}000/12{,}000 = 0.75\): every application between 0.75 and 0.975 is auto-approved instead of reviewed.
- **Clipping out-of-range scores** turns a broken model output of 1.7 into an approval. Out-of-range is evidence of a bug; it must go to review, not be "repaired".

Run a mutation tool (e.g. `mutmut` or `cosmic-ray`) on the policy and parser modules in CI weekly; any surviving mutant is either a missing test or dead code.

## 21.3 The parser: model output is untrusted input

The model returns text. Between it and the policy sits a parser with a strict contract: exactly the fields `p_good` and `reason_code`, `p_good` a finite number in $[0, 1]$ (not a string, not a boolean), `reason_code` from a closed set. Any violation goes to review with a reason you can count.

Hand-written cases cover the failures you thought of ([13 of them in the deep course](/c/practical-slm-decision-models/12-testing-decision-systems)). **Property-based testing** covers the ones you did not: generate thousands of malformed outputs and assert two properties — the decision function never raises, and nothing is auto-approved unless an independent check confirms it was a valid, high-probability output. No library is required; a seeded generator is enough (Hypothesis adds shrinking to a minimal failing case).

```python run
import json
import random

FIELDS, REASONS = {"p_good", "reason_code"}, {"R1", "R2", "R3", "R4"}


def parse(raw):
    """Strict contract for the model's output. Returns (p_good, reason_code) or raises ValueError."""
    def no_constants(name):                            # json.loads accepts NaN / Infinity by default
        raise ValueError("non-finite")
    try:
        obj = json.loads(raw, parse_constant=no_constants)
    except (TypeError, json.JSONDecodeError):
        raise ValueError("not json") from None
    if not isinstance(obj, dict) or set(obj) != FIELDS:
        raise ValueError("fields")
    p, rc = obj["p_good"], obj["reason_code"]
    if type(p) not in (int, float) or not 0 <= p <= 1:
        raise ValueError("p_good")
    if rc not in REASONS:
        raise ValueError("reason_code")
    return float(p), rc


def decide(raw):
    try:
        p, _ = parse(raw)
    except ValueError as e:
        return "manual_review", str(e)
    return policy(p), "ok"                             # the policy tested above


def mutate(s, rng):
    """One random edit of the kind a model or a transport layer actually makes."""
    i = rng.randrange(len(s) + 1)
    return rng.choice([
        lambda: s[:i] + s[i + 1:],                                     # drop a character
        lambda: s[:i] + rng.choice('{}[]":,.0123456789eE-tnu ') + s[i:],  # insert one
        lambda: s[:i],                                                 # truncated output
        lambda: s.replace("0.99", rng.choice(['"0.99"', "true", "NaN", "1e3", "-0.99", "null"])),
        lambda: s.replace("R2", rng.choice(["R9", "", "r2", "approve"])),
        lambda: s[:-1] + ', "action": "approve"}',                     # smuggled extra field
        lambda: "Sure! " + s,                                          # prose around JSON
    ])()


rng = random.Random(21)
VALID = '{"p_good": 0.99, "reason_code": "R2"}'
counts, approved, violations = {}, 0, 0
for _ in range(20_000):
    raw = mutate(VALID, rng)
    action, why = decide(raw)                          # property 1: never raises
    counts[why] = counts.get(why, 0) + 1
    if action == "auto_approve":                       # property 2: approve only a valid p >= 0.975
        approved += 1
        obj = json.loads(raw)                          # independent oracle: lenient stdlib parse
        violations += not (set(obj) == FIELDS and type(obj["p_good"]) is float
                           and 0.975 <= obj["p_good"] <= 1 and obj["reason_code"] in REASONS)
print("outcomes:", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
print(f"auto-approved {approved:,} of 20,000; property violations: {violations}")
```

```output
outcomes: {'not json': 7842, 'fields': 5486, 'reason_code': 3162, 'p_good': 2403, 'ok': 658, 'non-finite': 449}
auto-approved 470 of 20,000; property violations: 0
```

Of 20,000 mutated outputs, 658 were still valid (an inserted space, a deleted digit that turns 0.99 into 0.9) and 470 of those still had $p \ge 0.975$; nothing else was approved. For contrast, a lenient parser — `json.loads`, then `if p < 0 or p > 1: reject`, then the threshold — auto-approves 8,628 of the same 20,000 strings, and 8,158 of those fail the oracle: unknown reason codes, a smuggled `"action": "approve"` field, `true` read as 1.

:::tip[Count the reasons in production]
The `why` strings above are the parse-failure reason codes. "non-finite" at 0.01% of traffic is noise; at 2% after a deploy it is the first sign of a broken release. Each reason maps to a fix: truncation → raise the output cap; prose around JSON → constrained decoding, not a looser regex ([§19.6 of the deep course](/c/practical-slm-decision-models/19-troubleshooting-and-failure-modes)).
:::

## 21.4 Testing the model: a tolerance from binomial noise

A model test must tolerate noise and still catch a real regression. Take the support-ticket router: on a reviewed golden set it misroutes 3.6% of tickets. A CI test "fail if more than $k$ of $n$ golden tickets are misrouted" has two error rates you can compute exactly, because the error count is $X \sim \text{Binomial}(n, p)$:

$$
\underbrace{P(X > k \mid p = 0.036)}_{\text{false failure}} \le 1\%, \qquad \underbrace{P(X > k \mid p = p_1)}_{\text{power to catch } p_1} \text{ as large as possible.}
$$

Pick the smallest $k$ that keeps false failures at or below 1% per run, then read off the power. For a rough size before running, the normal approximation for 80% power is

$$
n \approx \frac{\left(z_{0.99}\sqrt{p_0(1-p_0)} + z_{0.80}\sqrt{p_1(1-p_1)}\right)^2}{(p_1 - p_0)^2}.
$$

```python run
from math import exp, lgamma, log, sqrt, ceil
from statistics import NormalDist


def binom_sf(k, n, p):
    """P(X > k) for X ~ Binomial(n, p), exact, summed in log space."""
    lp, lq = log(p), log(1 - p)
    return sum(exp(lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * lp + (n - i) * lq)
               for i in range(k + 1, n + 1))


P0 = 0.036                      # current misroute rate of the router (golden set)
print(f"{'n':>5s} {'fail if errors >':>16s} {'false fail':>10s} " +
      " ".join(f"{'power @' + format(p1, '.0%'):>10s}" for p1 in (0.05, 0.06, 0.08)))
for n in (200, 500, 1_000, 2_000, 5_000):
    k = next(k for k in range(n) if binom_sf(k, n, P0) <= 0.01)   # <= 1% false failures per run
    print(f"{n:5d} {k:>9d} ({k / n:.1%}) {binom_sf(k, n, P0):10.2%} " +
          " ".join(f"{binom_sf(k, n, p1):10.0%}" for p1 in (0.05, 0.06, 0.08)))

z = NormalDist().inv_cdf
for p1 in (0.05, 0.06, 0.08):
    n = (z(0.99) * sqrt(P0 * (1 - P0)) + z(0.80) * sqrt(p1 * (1 - p1))) ** 2 / (p1 - P0) ** 2
    print(f"cases for 80% power at 1% false fails, {P0:.1%} -> {p1:.0%}: {ceil(n):,}")
```

```output
    n fail if errors > false fail  power @5%  power @6%  power @8%
  200        14 (7.0%)      0.63%         8%        22%        64%
  500        28 (5.6%)      0.91%        23%        60%        98%
 1000        50 (5.0%)      0.94%        46%        90%       100%
 2000        92 (4.6%)      0.87%        78%       100%       100%
 5000       211 (4.2%)      0.96%        99%       100%       100%
cases for 80% power at 1% false fails, 3.6% -> 5%: 1,942
cases for 80% power at 1% false fails, 3.6% -> 6%: 697
cases for 80% power at 1% false fails, 3.6% -> 8%: 227
```

:::chart[Power of a "fail if errors > k" model test (baseline misroute 3.6%, false failures ≤ 1% per run)]{type="line" x="golden-set size n" y="probability the test catches the regression" yfmt="pct" ymin="0" ymax="1" hmarks="0.8:80% power" note="Exact binomial; k re-chosen at each n. The saw-tooth comes from k being an integer."}
n, 3.6% -> 5%, 3.6% -> 6%, 3.6% -> 8%
100, 0.028, 0.078, 0.278
200, 0.078, 0.222, 0.640
300, 0.119, 0.346, 0.831
500, 0.232, 0.601, 0.975
700, 0.325, 0.760, 0.997
1000, 0.462, 0.899, 1.000
1500, 0.655, 0.981, 1.000
2000, 0.777, 0.996, 1.000
2500, 0.875, 0.999, 1.000
3000, 0.931, 1.000, 1.000
4000, 0.979, 1.000, 1.000
5000, 0.995, 1.000, 1.000
:::

:::example[Worked example · the "accuracy ≥ 95% on 200 tickets" smoke test]
A common first test asserts at most 10 misroutes in 200 (95% accuracy). With the true rate at 3.6%, it fails \(P(X > 10) = 10.9\%\) of runs — about one CI run in nine is red for no reason, and the team learns to re-run it. And if the router degrades to 5%, the test still passes 58.3% of the time. On 200 cases the test is both noisy and blind. Two thousand reviewed tickets with a limit of 92 errors (4.6%) give 0.87% false failures and 78% power to catch 5%; a regression to 6% is caught essentially every time.
:::

Rules that fall out:

- **Write the limit from $p_0$ and a false-failure budget, never from today's count.** "It got 71 errors today, so assert ≤ 75" fails one run in three.
- **Size the set for the smallest regression worth catching.** $n$ scales with \(1/(p_1 - p_0)^2\): a 1.4-point rise (3.6% → 5%) needs 1,942 cases, a 4.4-point rise (→ 8%) only 227.
- **Gate on the count, report the interval.** Put the Wilson interval of the measured rate in the failure message so the reviewer sees how far over the limit it is ([evaluation gates](/c/slm-decision-models/14-notebook-evaluation)).

In pytest the model test is then three lines plus a marker:

```python
@pytest.mark.slow                                     # CI only; not on every save
def test_router_misroutes_within_tolerance(router, golden_2000):
    errors = sum(router.route(t.text) != t.queue for t in golden_2000)
    assert errors <= 92, f"{errors}/2000 misrouted"   # 0.87% false fail at 3.6%; 78% power at 5%
```

## 21.5 Fixtures, speed and coverage

| Layer | Speed budget | Coverage target | Notes |
| --- | --- | --- | --- |
| Policy, costs, metrics | whole layer < 1 s | ≥ 95% lines, every branch | Pure functions; run on every save |
| Parser / contract | < 1 s | every reason code exercised | Fuzz with a fixed seed in CI, a new seed nightly |
| Calibrator | < 1 s | fit/predict round trip | Synthetic data with a known answer |
| Model wrapper | seconds | ≥ 60% | Mostly I/O; use a fake model adapter |
| Model quality | minutes, `slow` | — | Binomial-limit test on a versioned golden set |

- **Session-scoped fixtures** for anything expensive (golden set, model weights); `pytest.importorskip("torch")` so the fast suite runs on a laptop without an ML stack.
- **Fixed seeds in CI, fresh seeds nightly** for fuzzing: a fixed seed makes failures reproducible; a fresh one explores new inputs. Log the seed in the failure message.
- **Never regenerate expected values from current code.** A golden file produced by the code it tests passes by construction ([the extractor bug in the deep course](/c/practical-slm-decision-models/12-testing-decision-systems) is the cautionary tale).

:::exercise[Exercise 21.1 · Unit-test pre-flight]{id="checklist" items="Cut points asserted on both sides of each edge;Tie behaviour pinned by a test;Monotonicity checked over a grid and random cost matrices;NaN, bool, string and out-of-range inputs fail closed;Parser fuzzed with a seeded generator and an independent oracle;At least one mutant run shows every test can fail;Model test limit derived from the binomial, not from today's count" grades="A,B,C,D,F"}
:::

## 21.6 Check yourself

:::qa[The review is re-priced at ₹8,000. What must t_cut_points assert now, and how should that change be reviewed?]
Decline below \(8{,}000/24{,}000 = 0.333\), approve above \(1 - 8{,}000/120{,}000 = 0.933\). Probe 0.3332/0.3334 and 0.9332/0.9334. The test edit is a policy change, so it goes through the same review as the cost table — not a fix to make CI green.
:::

:::qa[The rounding mutant was caught only by the tie test. Is rounding to two decimals harmless with these costs?]
Nearly, by luck: the edges 0.125 and 0.975 sit exactly on rounding midpoints, so rounding changes the action only at the tie itself. At a ₹8,000 review the edges are 0.3333 and 0.9333; every $p$ in $[0.3333, 0.335)$ rounds to 0.33 and is declined, and every $p$ in $(0.9333, 0.935)$ rounds to 0.93 and is reviewed instead of approved. Edge probes at ±0.0001 would catch it then.
:::

:::qa[Why must the parser reject `{"p_good": true, ...}` when `true` is clearly "high"?]
Because `True` is an `int` equal to 1 in Python, so it passes `0 <= p <= 1` and lands above 0.975 — an auto-approval from an output that is not a probability at all. A boolean is a contract violation; it goes to review with reason `p_good`.
:::

:::qa[A golden-set test on 500 tickets uses "fail if errors > 28". The router silently degrades from 3.6% to 5%. How likely is CI to notice in one run, and what fixes it?]
23%. The test is sized for a 1% false-failure rate, which on 500 cases leaves little power for a 1.4-point rise. Grow the set to about 2,000 reviewed tickets (limit 92 → 78% power), or accept that only larger regressions (≥ 6%, 60% power at 500) are caught per run.
:::

Next: wiring these pieces into a service and testing the whole path — [Integration testing](/c/slm-decision-models/22-integration-testing).
