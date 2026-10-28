---
section: "17"
title: "Batch and stream processing"
kicker: "Building blocks"
abstract: "Two ways to process data at volume: periodically in bulk, or continuously as it arrives. Most systems need both, for different questions."
time: "2 min"
order: 17
---

## What they are

**Batch** — process a bounded chunk of stored data on a schedule. Simple, efficient, and
always late.

**Stream** — process unbounded data as it arrives, continuously. Fresh, and more complex.

| | Batch | Stream |
| --- | --- | --- |
| Input | A day's files, a table partition | An endless event log |
| Latency | Minutes to hours | Milliseconds to seconds |
| Reprocessing | Trivial — rerun the job | Hard — replay the log, or maintain versions |
| Correctness | Easy: all data present | Hard: late events, out-of-order arrivals, windows |
| Cost profile | Bursty, efficient | Always-on |
| Tools | Spark, dbt + warehouse, plain SQL | Kafka Streams, Flink, Spark Structured Streaming |

## The concepts that come up in interviews

- **Windowing** — tumbling (fixed, non-overlapping), sliding (overlapping), session (grouped by
  activity gap).
- **Watermarks** — "we believe all events before time T have arrived", which decides when a
  window can emit a result.
- **Late data** — events that arrive after the watermark. Either drop them, or keep the window
  open and emit corrections.
- **Exactly-once in stream processing** — achievable inside the framework (checkpointed state
  plus idempotent sinks), not across arbitrary side effects.
- **Change data capture (CDC)** — tailing a database's log to turn row changes into events.
  This is how you get streaming without dual writes.

## The lambda and kappa shapes

- **Lambda** — a batch layer for correctness and a speed layer for freshness, merged at query
  time. Two code paths, therefore two sets of bugs.
- **Kappa** — one streaming path, with replay for reprocessing. Fewer code paths, and it needs
  a log that retains history.

Modern practice leans kappa where the log is durable, and plain batch where "yesterday's
numbers" is genuinely sufficient.

## When to reach for which

- Reporting, invoicing, ML training sets → batch.
- Fraud detection, alerting, live dashboards, feed ranking signals → stream.
- Aggregates over billions of events → batch into an analytical store, even if the events
  arrived by stream.
- "Show me today's numbers" → stream into an OLAP store, batch for the historical backfill.

## Trade-offs

1. **Streaming is a permanently running system** with state, checkpoints and rebalance
   behaviour — a much bigger operational commitment than a cron job.
2. **Batch is always late**, and lateness is sometimes the actual product requirement.
3. **Two paths diverge.** Lambda's batch and speed layers computing different numbers is a
   classic, embarrassing bug. Test them against each other.
4. **Backfills are the hard part of streaming** — you need the log retained, or a batch path
   anyway.

## Interview soundbite

> "Events go to Kafka and a stream job maintains a per-user counter for the live dashboard,
> while a nightly batch recomputes the authoritative daily totals into the warehouse. The
> stream is for freshness; the batch is the number we put in the report."

## Where to go next

- [Metrics pipeline case study](../case-studies/metrics-pipeline.md).
- [Data storage models](../fundamentals/storage-models.md).
