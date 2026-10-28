---
section: "5"
title: "Study plan"
kicker: "Getting started"
abstract: "A four-week schedule that goes from vocabulary to a defensible answer, with a checkpoint at the end of each week."
time: "3 min"
order: 5
---

Roughly an hour a day, five days a week. If you have less time, do week one and week
four and skip the middle — the trade-off cheat sheet is a compressed version of weeks two
and three.

## Week 1 — Vocabulary and arithmetic

| Day | Read | Do |
| --- | --- | --- |
| 1 | [Scalability](../fundamentals/scalability.md), [latency and throughput](../fundamentals/latency-and-throughput.md) | Estimate QPS and storage for an imaginary Instagram. |
| 2 | [Availability](../fundamentals/availability.md) | Compute the availability of a five-service chain. |
| 3 | [Consistency models](../fundamentals/consistency.md) | Write down three product features that need strong consistency and three that do not. |
| 4 | [Replication and partitioning](../fundamentals/replication-and-partitioning.md) | Sketch replication lag's effect on a "post then read" flow. |
| 5 | [Estimation drills](estimation.md) | Redo the two worked examples from memory. |

**Checkpoint:** explain to someone, in under two minutes, why 7 TB a year does not need
sharding.

## Week 2 — Building blocks

Read two blocks a day from [building blocks](../building-blocks/index.md), in this order:
load balancer, API gateway, CDN, object storage, cache, queue, indexes, replicas,
sharding, rate limiter, circuit breaker, retry, idempotency, distributed locks, search,
service discovery, observability, sagas, batch and stream.

For each, write one line: *the symptom it fixes* and *what it costs*. Nine days of
reading compressed into five by doing two a day.

**Checkpoint:** without notes, list every block and its cost. Anything you cannot price,
reread.

## Week 3 — The twelve patterns and case studies

| Day | Read | Do |
| --- | --- | --- |
| 1 | [The twelve patterns](../patterns/index.md) plus [choosing between fixes](../patterns/choosing-between-fixes.md) | Recite the twelve from memory. |
| 2 | [URL shortener](../case-studies/url-shortener.md), [rate limiter](../case-studies/rate-limiter-service.md) | Redraw both from memory afterwards. |
| 3 | [News feed](../case-studies/news-feed.md), [chat](../case-studies/chat.md) | Note where each diverges from the other. |
| 4 | [Video platform](../case-studies/video-platform.md), [file sync](../case-studies/file-sync.md) | Estimate storage and egress for both. |
| 5 | [Ticket booking](../case-studies/ticket-booking.md), [payments](../case-studies/payments-ledger.md) | Focus on the correctness constraints. |

**Checkpoint:** two case studies, redrawn on blank paper, twenty minutes each.

## Week 4 — Performance

| Day | Do |
| --- | --- |
| 1 | Read [a framework for answering](answering-framework.md) and time yourself on one case study. |
| 2 | [Mock walkthrough](../interview/mock-walkthrough.md), out loud, with a timer. |
| 3 | [Common mistakes](../interview/common-mistakes.md); pick your two worst habits and write a fix for each. |
| 4 | Two case studies from the [question bank](../interview/question-bank.md) you have not read. |
| 5 | [Trade-off cheat sheet](../interview/trade-off-cheatsheet.md), then one full mock with a friend. |

**Checkpoint:** a forty-five minute session where you talk for at least thirty of the
minutes and the other person interrupts fewer than three times.

## What to do if you only have three days

Day 1: [answering framework](answering-framework.md), [estimation](estimation.md), and
the [twelve patterns](../patterns/index.md). Day 2: [trade-off cheat
sheet](../interview/trade-off-cheatsheet.md) and four case studies. Day 3: two timed
mock answers, out loud, recorded if possible. Listening to your own recording is
uncomfortable and effective.
