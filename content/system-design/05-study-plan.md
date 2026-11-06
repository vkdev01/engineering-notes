---
section: "5"
title: "Study plan"
kicker: "Getting started"
abstract: "Twenty hours over four weeks — derivations, building blocks, patterns and case studies, then timed mocks — with a measurable checkpoint at the end of each week, plus one-week and three-day compressions."
time: "6 min"
order: 5
outcomes:
  - "Schedule four weeks of preparation at about an hour a day"
  - "Check each week's progress against a concrete, timed checkpoint"
  - "Compress the plan to one week or three days without losing the high-value parts"
---

An hour a day, five days a week, for four weeks: 20 hours. That is enough to go from vocabulary to a defensible 45-minute answer if every session ends with something you produced — an estimate, a redrawn diagram, a recorded answer — rather than pages read. Each day below names what to read and what to *do*.

:::key[First principle]
Recall under time pressure is the skill being tested, so practise retrieval, not reading. Every session ends with an artefact made from memory; every week ends with a timed checkpoint you either pass or repeat.
:::

## 5.1 The four weeks at a glance

| Week | Sections | Hours | Checkpoint (pass to move on) |
| ---: | --- | ---: | --- |
| 1 | Getting started + fundamentals (01–15) | 5 | Derive Pulse's numbers from memory in ≤ 5 min |
| 2 | Building blocks (16–34) | 5 | Name every block, its fix and its cost without notes |
| 3 | Patterns + case studies (35–62) | 5 | Two case studies on blank paper, 20 min each |
| 4 | Implementations, reference, mocks (63–74) | 5 | One 45-min mock: ≥ 30 min talking, < 3 interruptions |

## 5.2 Week 1 — Arithmetic and fundamentals

| Day | Read | Do |
| ---: | --- | --- |
| 1 | [Framework](/c/system-design/01-answering-framework), [estimation](/c/system-design/02-estimation) | Run the estimator; then redo Pulse and the photo service on paper |
| 2 | [Latency and throughput](/c/system-design/10-latency-and-throughput), [scalability](/c/system-design/13-scalability) | At what utilisation does mean latency reach 5× service time? (80%) |
| 3 | [Availability](/c/system-design/06-availability), [caching](/c/system-design/07-caching) | Compute the checkout path's availability; DB load at 90% vs 99% hit rate |
| 4 | [Consistency](/c/system-design/08-consistency), [replication and partitioning](/c/system-design/12-replication-and-partitioning) | Sketch read-your-writes for "post, then read my feed" under replica lag |
| 5 | [Delivery semantics](/c/system-design/09-delivery-semantics), [transactions](/c/system-design/15-transactions), skim [networking](/c/system-design/11-networking) and [storage models](/c/system-design/14-storage-models) | List three Pulse features that need strong consistency and three that don't |

**Checkpoint.** Without notes, in five minutes: Pulse's peak read and write QPS, storage per year, and why it doesn't need sharding (600 peak writes, 7.3 TB/yr, a 200 GB hot set).

## 5.3 Week 2 — Building blocks

Nineteen blocks in five days, about four a day, in the order a request meets them:

| Day | Blocks |
| ---: | --- |
| 1 | [Load balancer](/c/system-design/24-load-balancer), [API gateway](/c/system-design/16-api-gateway), [CDN](/c/system-design/19-cdn), [object storage](/c/system-design/26-object-storage) |
| 2 | [Cache](/c/system-design/18-cache), [read replicas](/c/system-design/29-read-replicas), [indexes](/c/system-design/23-indexes), [sharding](/c/system-design/34-sharding) |
| 3 | [Message queue](/c/system-design/25-message-queue), [batch and stream](/c/system-design/17-batch-and-stream), [search index](/c/system-design/32-search-index), [service discovery](/c/system-design/33-service-discovery) |
| 4 | [Rate limiter](/c/system-design/28-rate-limiter), [circuit breaker](/c/system-design/20-circuit-breaker), [retry](/c/system-design/30-retry), [idempotency](/c/system-design/22-idempotency) |
| 5 | [Distributed locks](/c/system-design/21-distributed-locks), [sagas](/c/system-design/31-sagas), [observability](/c/system-design/27-observability) |

For each block write one line: *symptom it fixes · what it costs · the number that says you need it* — e.g. "CDN · cache invalidation and egress fees · origin egress > a few Gbit/s (photos: 160 Gbit/s)".

**Checkpoint.** All nineteen lines rewritten from memory. Any block you cannot price, reread.

## 5.4 Week 3 — Patterns and case studies

| Day | Read | Do |
| ---: | --- | --- |
| 1 | [Choosing between fixes](/c/system-design/36-choosing-between-fixes), patterns 35–41 | For each pattern: the metric and threshold that diagnoses it |
| 2 | Patterns 42–47 | Apply each to Pulse or checkout with one number |
| 3 | [URL shortener](/c/system-design/60-url-shortener), [rate limiter service](/c/system-design/57-rate-limiter-service) | Redraw both from memory afterwards |
| 4 | [News feed](/c/system-design/54-news-feed), [chat](/c/system-design/49-chat) | Note where fan-out differs between them |
| 5 | [Ticket booking](/c/system-design/59-ticket-booking), [payments ledger](/c/system-design/56-payments-ledger) | Write the correctness invariant for each in one sentence |

**Checkpoint.** Two case studies you read this week, on blank paper, 20 minutes each, with an estimate in the first five minutes.

## 5.5 Week 4 — Code, reference and performance

| Day | Do |
| ---: | --- |
| 1 | Run two [implementations](/c/system-design/63-circuit-breaker) (breaker and [retry](/c/system-design/67-retry)); predict each output before running |
| 2 | [Mock walkthrough](/c/system-design/72-mock-walkthrough) aloud, timed against the 45-minute budget in [§4](/c/system-design/04-interview-format) |
| 3 | [Common mistakes](/c/system-design/70-common-mistakes): pick your two worst habits and write the fix for each |
| 4 | Two unseen problems from the [question bank](/c/system-design/73-question-bank), 45 min each, recorded |
| 5 | [Cheat sheet](/c/system-design/74-trade-off-cheatsheet), then one full mock with a person |

**Checkpoint.** A 45-minute mock scored with the signals in [§4.5](/c/system-design/04-interview-format): numbers by minute 10, ≥ 30 minutes of talking, fewer than three interruptions, a cost on every choice.

## 5.6 Compressed plans

| Time | Plan |
| --- | --- |
| **One week** (~7 h) | Day 1 framework + estimation · Day 2 [cheat sheet](/c/system-design/74-trade-off-cheatsheet) + [choosing between fixes](/c/system-design/36-choosing-between-fixes) · Days 3–5 one case study a day, timed · Day 6 [mock walkthrough](/c/system-design/72-mock-walkthrough) · Day 7 one full mock |
| **Three days** (~4 h) | Day 1 framework, estimation, choosing between fixes · Day 2 cheat sheet and two case studies · Day 3 two timed answers aloud, recorded |

Listening to a recording of yourself is uncomfortable and the fastest feedback available: count the minutes before your first number and the choices you made without a cost.

:::warn[Common ways the plan fails]
- **Reading without producing.** If a session ends with no artefact, it did not count.
- **Skipping week 1.** Every later page assumes the §2 arithmetic; without it, patterns become a list to memorise.
- **Never timing yourself.** Untimed practice hides the real failure — running out of minutes before the failure modes.
:::

## 5.7 Check yourself

:::qa[You have ten days. Which parts do you keep?]
Week 1 days 1–3 (framework, estimation, latency, availability, caching), then the one-week plan. The fundamentals make every case study faster; the timed mocks are non-negotiable.
:::

:::qa[Your week-3 checkpoint ran 35 minutes per case study. What do you change?]
Find where the time went. Usually it's scoping and the diagram; cap scope at 5 minutes and use the [framework's](/c/system-design/01-answering-framework) budget table. Repeat the checkpoint before moving to week 4.
:::

Next: [§6 Availability and reliability](/c/system-design/06-availability) — the first fundamental.
