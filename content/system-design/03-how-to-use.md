---
section: "3"
title: "How to use this guide"
kicker: "Getting started"
abstract: "How the 74 sections are organised, the three running examples every section reuses, the conventions for numbers and notation, and three reading paths matched to the time you have."
time: "5 min"
order: 3
outcomes:
  - "Find the right part of the guide for a derivation, a mechanism, a symptom or a full design"
  - "Recall the three running examples and their headline numbers"
  - "Tell a computed number from an illustrative one"
  - "Pick a reading path for one day, one week or one month"
---

The guide has 74 sections, and nobody preparing for an interview reads them in order. This page tells you where each kind of answer lives, which numbers recur, and which path through the material fits the time you have.

:::key[First principle]
Every section builds on the same three systems and the same arithmetic. Learn the running examples once in [§2](/c/system-design/02-estimation) and every later page becomes a variation you can check rather than a fact you must memorise.
:::

## 3.1 How the guide is organised

| Part | Sections | What a page gives you | Use it when |
| --- | --- | --- | --- |
| Getting started | 01–05 | Framework, estimation, interview mechanics, plan | First, always |
| Fundamentals | 06–15 | Derivations: queueing, availability, caching, consistency, replication | You need the *why* behind a number |
| Building blocks | 16–34 | How a component works inside, its sizing maths, knobs and failure modes | You need to justify one box on the diagram |
| Patterns | 35–47 | Symptom → diagnosis with a metric → fix → cost | The interviewer says "now it's slow" |
| Case studies | 48–62 | Requirements → estimates → API → data → design → deep dives | Practising full answers |
| Implementations | 63–69 | Tested Python for breakers, hashing, idempotency, LRU, retry, sharding, token bucket | You want to see the failure mode run |
| Reference | 70–74 | Mistakes, glossary, a mock walkthrough, question bank, cheat sheet | Revision in the last days |

Links follow the same direction: a pattern links to the building block it uses, the block links to the fundamental that derives its numbers, and the implementation shows the code.

## 3.2 The running examples

Three systems recur across the guide. Their numbers are derived once in [§2](/c/system-design/02-estimation) and kept identical everywhere; when a page needs a new number it derives it from these and shows the arithmetic.

| Example | Inputs | Headline numbers | Used for |
| --- | --- | --- | --- |
| **Pulse** (feed app) | 10M DAU; 20 reads + 2 posts/user/day; 1 KB/post | 6,000 peak read QPS, 600 peak write QPS, 7.3 TB/yr | Caching, replicas, fan-out, consistency, indexes, sharding |
| **Photo service** | 20M DAU; 50 views + 2 uploads/day; 2 MB + 10% | 30,000 peak read QPS, 88 TB/day, 20 GB/s egress | Object storage, CDN, bandwidth, batch |
| **Checkout** | 50 orders/s steady, 2,000/s flash sale; payment p50 300 ms, p99 2 s | 40× spike, 8,000 DB writes/s, 600–4,000 calls in flight | Idempotency, retries, sagas, queues, rate limits, breakers |

## 3.3 Conventions

:::note[Computed vs illustrative]
Numbers derived from the running examples are computed, with the arithmetic shown. Hardware rates, per-server throughput, prices and provider latencies are **illustrative** and labelled so — they are knobs to turn, not facts to quote. Runnable code blocks (`python run`) are followed by their real output.
:::

| Symbol / term | Meaning | Example |
| --- | --- | --- |
| QPS, $\lambda$ | Requests (or events) per second | Pulse reads: $\lambda$ = 2,000 avg |
| Peak factor | Peak ÷ average rate | 3× consumer, 40× flash sale |
| $\rho$ | Utilisation = arrival rate ÷ capacity | Target ≈ 0.6 |
| $W$, $S$ | Time in system, service time | $W = S/(1-\rho)$ |
| p50 / p99 | Median / 99th-percentile latency | Payment: 300 ms / 2 s |
| $A$, nines | Availability; 99.9% = "three nines" | 43.2 min/30 days of downtime |
| $h$ | Cache hit rate | DB load = $(1-h)\lambda$ |
| 1 KB, 1 day | 10³ bytes, 10⁵ seconds (rounded) | Error ≤ 14%, see §2 |

Callouts have fixed meanings: **First principle** is the idea to keep, **Worked example** shows real numbers, **Warning** is a failure mode seen in production or interviews, and **Check yourself** questions have worked answers you can expand.

:::warn[Out of scope]
Hardware design, kernel tuning and ML systems are out of scope. The guide covers application-level engineering and the infrastructure an application engineer actually operates.
:::

## 3.4 Three reading paths

| Time you have | Path | Why it works |
| --- | --- | --- |
| **One day** | [Framework](/c/system-design/01-answering-framework) → [estimation](/c/system-design/02-estimation) → [cheat sheet](/c/system-design/74-trade-off-cheatsheet) → one case study ([URL shortener](/c/system-design/60-url-shortener)) out loud, timed | The cheat sheet compresses the blocks and patterns; one timed answer exposes your gaps |
| **One week** | Day 1 the above; days 2–3 [patterns](/c/system-design/36-choosing-between-fixes); days 4–6 one case study a day; day 7 [mock walkthrough](/c/system-design/72-mock-walkthrough) | Patterns are what the second half of an interview asks for |
| **One month** | The [study plan](/c/system-design/05-study-plan): fundamentals → blocks → patterns → case studies → mocks | Builds the derivations you can reconstruct under pressure |

**Looking up one answer.** Use search. Every page opens with the problem it solves and a one-line principle, so the first screen is enough when you arrive mid-task.

## 3.5 The code

The [implementations](/c/system-design/63-circuit-breaker) (§63–69) are short, tested Python for the mechanisms that are easiest to describe and hardest to get right: a circuit breaker, consistent hashing, an idempotency store, an LRU cache, retry with backoff and jitter, shard routing and a token bucket. They are teaching code — single-threaded, no configuration — and each ships with a simulation that measures its behaviour: you can watch the token bucket refuse the request after the burst, or the breaker open after the failure threshold.

## 3.6 Check yourself

:::qa[The interviewer asks why you'd put a cache in front of the feed. Which part of the guide has the derivation and which has the sizing?]
The derivation (hit rate vs cache size, effective latency, DB load) is in fundamentals — [caching](/c/system-design/07-caching). Sizing, eviction and failure modes for the component are in the building block — [cache](/c/system-design/18-cache). The "reads are slow" symptom-to-fix walk is the pattern — [slow reads](/c/system-design/42-slow-reads-cache).
:::

:::qa[A page says "one server handles 1,000 QPS". Is that a fact?]
No — it is an illustrative assumption, labelled as such. Replace it with your own load-test number; every derived figure (e.g. 12 Pulse feed servers) changes with it.
:::

:::qa[Which running example would you use to discuss retries and idempotency, and why?]
Checkout: a payment call with p99 2 s, a 40× flash-sale spike and a ledger that must not double-charge. Pulse and photos tolerate a duplicate far better than a payment does.
:::

Next: [§4 Anatomy of the interview](/c/system-design/04-interview-format) — what is scored and where the 45 minutes go.
