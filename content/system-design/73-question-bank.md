---
section: "73"
title: "Question bank"
kicker: "Interview"
abstract: "Practice prompts grouped by what they actually test, so you can drill a weakness rather than a topic."
time: "2 min"
order: 73
---

## What each question is really testing

| Prompt | The real question |
| --- | --- |
| URL shortener | Key generation and read-heavy caching |
| Rate limiter | Distributed counters and atomicity |
| Unique ID generator | Coordination avoidance |
| Web crawler | Politeness, dedupe, a persistent frontier |
| News feed | Fan-out strategy |
| Chat | Per-conversation ordering and connection state |
| Video platform | Storage and egress economics |
| File sync | Chunking, dedupe, conflict resolution |
| Ride hailing | Geospatial indexing with freshness |
| Ticket booking | Concurrency control without overselling |
| Payments ledger | Idempotency and double-entry correctness |
| Notification system | Fan-out, priorities, provider limits |
| Metrics pipeline | High-volume ingestion and cardinality |
| Autocomplete | Prefix index and freshness |
| Distributed cache | Consistent hashing and failure handling |
| Key-value store | Storage engine and replication |
| Search engine | Crawl, index, rank |
| Distributed job scheduler | Leases, idempotency, exactly-once effects |
| API rate-limited public gateway | Edge concerns and tenant fairness |
| Top-K trending | Streaming aggregation and approximation |
| Proximity service | Geospatial index choice |
| Distributed transactions | Sagas versus 2PC |
| Leaderboard | Sorted sets and read scale |
| Paste bin / file drop | Expiry and object storage |
| Distributed queue | Delivery semantics and ordering |

## Drills by skill

### Estimation

- 100M daily active users, 50 requests each. What is peak QPS?
- A 4K video is 15 GB per hour. 500 hours uploaded per minute — how much storage per day?
- An SLO of 99.95% — how many minutes of downtime per month?

### Trade-off articulation

For each pair, say what you gain and what you pay, in two sentences:

- cache versus read replica
- queue versus rate limit
- sharding versus indexing
- synchronous versus asynchronous replication
- monolith versus microservices
- at-least-once versus at-most-once

### Failure reasoning

- Your primary database dies right now. What does the user see, in order?
- A dependency's p99 goes from 50 ms to 5 s. What happens to your service, and what stops it?
- A queue consumer is down for an hour. What is the state when it comes back?
- A cache node dies with 500 GB of hot data. What happens to the origin?

### Consistency

- A user posts a comment and refreshes. Walk the request through the system and find where it can
  go wrong.
- Two users book the last seat simultaneously. Show the mechanism that prevents the double sale.
- A payment times out. How do you decide whether it happened?

## A four-week rotation

| Week | Prompts | Focus |
| --- | --- | --- |
| 1 | URL shortener, rate limiter, ID generator | Estimation and cheap fixes |
| 2 | News feed, chat, notifications | Fan-out and messaging |
| 3 | Video platform, file sync, crawler | Storage and pipelines |
| 4 | Ticket booking, payments, distributed cache | Correctness under concurrency |

Do each one in twenty minutes with a timer, out loud. Reading a case study is not practice; talking
is.
