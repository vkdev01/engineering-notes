---
section: "9"
title: "Delivery semantics"
kicker: "Fundamentals"
abstract: "'Exactly once' is a marketing phrase. What you actually choose is at-most-once or at-least-once, and then you make the second one safe."
time: "2 min"
order: 9
---

## The three options

| Guarantee | Mechanism | Failure mode | Where used |
| --- | --- | --- | --- |
| **At most once** | Fire and forget; no retry | Messages lost | Metrics, logs, non-critical telemetry |
| **At least once** | Retry until acknowledged | Duplicates | Almost everything |
| **Effectively once** | At-least-once delivery + idempotent consumer (or dedupe by key) | Nothing, if the dedupe store is reliable | Payments, orders |

The third is not a delivery guarantee; it is an *end-to-end* property you build. Broker
claims of exactly-once (Kafka transactions, for instance) hold within the broker's own
scope — produce-consume-transform — and stop at your side effects. Writing to an external
system is still at-least-once.

## Why duplicates are unavoidable

A consumer processes a message, then crashes before committing its offset. On restart, the
message is redelivered. There is no way for the broker to know whether the side effect
happened, because the side effect and the offset are two different systems.

The only robust fix: **make the side effect idempotent**, keyed by a stable identifier from
the message. See [idempotency](/c/system-design/22-idempotency/).

## Ordering

- Ordering is per partition, not per topic. Two messages with the same key land on the same
  partition and stay ordered; different keys have no relationship.
- Choose the partition key from the thing that needs ordering: `user_id`, `order_id`,
  `conversation_id`.
- Global ordering requires a single partition, which caps throughput at one consumer.
- A consumer group with more consumers than partitions leaves consumers idle — partition
  count is a capacity decision.

## Backpressure and flow control

A queue that grows faster than it drains is a countdown timer. What to watch and do:

| Signal | Meaning | Response |
| --- | --- | --- |
| Consumer lag rising | Arrivals exceed capacity | Add consumers (up to partition count), or optimise the handler |
| Oldest message age rising | User-visible delay | This is the alert that matters, not queue depth |
| Poison message looping | One message always fails | Retry limit, then dead-letter queue |
| Retry storm | Failures begetting retries | Exponential backoff with jitter, and a circuit breaker |

:::note[Alert on age, not depth]
A queue of a million tiny messages drained in ten seconds is healthy. A queue of ten
messages stuck for an hour is an outage. Age is the metric that maps to user pain.
:::

## Dead-letter queues

Every consumer needs one. A message that fails repeatedly goes to the DLQ with its error
context, and someone inspects it. Without a DLQ, a single malformed message either blocks
the partition forever or is silently dropped — both worse than a queue nobody reads until
Monday.

## Interview soundbite

> "The queue is at-least-once, so the consumer is idempotent on `order_id` — a redelivered
> message is a no-op. I alert on the age of the oldest unprocessed message, and anything
> failing three times goes to a dead-letter queue rather than blocking the partition."

## Where to go next

- [Message queue](/c/system-design/25-message-queue/) — the component.
- [Idempotency](/c/system-design/22-idempotency/) — making duplicates harmless.
