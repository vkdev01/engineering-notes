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
| 1 | [Scalability](/c/system-design/13-scalability/), [latency and throughput](/c/system-design/10-latency-and-throughput/) | Estimate QPS and storage for an imaginary Instagram. |
| 2 | [Availability](/c/system-design/06-availability/) | Compute the availability of a five-service chain. |
| 3 | [Consistency models](/c/system-design/08-consistency/) | Write down three product features that need strong consistency and three that do not. |
| 4 | [Replication and partitioning](/c/system-design/12-replication-and-partitioning/) | Sketch replication lag's effect on a "post then read" flow. |
| 5 | [Estimation drills](/c/system-design/02-estimation/) | Redo the two worked examples from memory. |

**Checkpoint:** explain to someone, in under two minutes, why 7 TB a year does not need
sharding.

## Week 2 — Building blocks

Read two blocks a day from [building blocks](/c/system-design/), in this order:
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
| 1 | [The twelve patterns](/c/system-design/) plus [choosing between fixes](/c/system-design/36-choosing-between-fixes/) | Recite the twelve from memory. |
| 2 | [URL shortener](/c/system-design/60-url-shortener/), [rate limiter](/c/system-design/57-rate-limiter-service/) | Redraw both from memory afterwards. |
| 3 | [News feed](/c/system-design/54-news-feed/), [chat](/c/system-design/49-chat/) | Note where each diverges from the other. |
| 4 | [Video platform](/c/system-design/61-video-platform/), [file sync](/c/system-design/51-file-sync/) | Estimate storage and egress for both. |
| 5 | [Ticket booking](/c/system-design/59-ticket-booking/), [payments](/c/system-design/56-payments-ledger/) | Focus on the correctness constraints. |

**Checkpoint:** two case studies, redrawn on blank paper, twenty minutes each.

## Week 4 — Performance

| Day | Do |
| --- | --- |
| 1 | Read [a framework for answering](/c/system-design/01-answering-framework/) and time yourself on one case study. |
| 2 | [Mock walkthrough](/c/system-design/72-mock-walkthrough/), out loud, with a timer. |
| 3 | [Common mistakes](/c/system-design/70-common-mistakes/); pick your two worst habits and write a fix for each. |
| 4 | Two case studies from the [question bank](/c/system-design/73-question-bank/) you have not read. |
| 5 | [Trade-off cheat sheet](/c/system-design/74-trade-off-cheatsheet/), then one full mock with a friend. |

**Checkpoint:** a forty-five minute session where you talk for at least thirty of the
minutes and the other person interrupts fewer than three times.

## What to do if you only have three days

Day 1: [answering framework](/c/system-design/01-answering-framework/), [estimation](/c/system-design/02-estimation/), and
the [twelve patterns](/c/system-design/). Day 2: [trade-off cheat
sheet](/c/system-design/74-trade-off-cheatsheet/) and four case studies. Day 3: two timed
mock answers, out loud, recorded if possible. Listening to your own recording is
uncomfortable and effective.
