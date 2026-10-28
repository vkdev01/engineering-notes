---
section: "15"
title: "ACID, BASE and transactions"
kicker: "Fundamentals"
abstract: "A transaction is a promise that a group of writes happens entirely or not at all. Across services that promise is expensive, and usually you should not buy it."
time: "3 min"
order: 15
---

## What it is

**ACID** describes a single database's guarantee:

- **Atomicity** — all writes in the transaction commit, or none do.
- **Consistency** — the transaction moves the database between valid states (constraints
  hold). Often the weakest link, because it depends on the schema and the application.
- **Isolation** — concurrent transactions do not see each other's partial work, at the
  level you asked for.
- **Durability** — once committed, it survives a crash.

**BASE** — basically available, soft state, eventual consistency — is the deliberate
opposite: give up immediate consistency for availability and scale.

## Isolation levels, and what each actually prevents

| Level | Prevents | Still allows |
| --- | --- | --- |
| Read uncommitted | Nothing much | Dirty reads |
| Read committed | Dirty reads | Non-repeatable reads, phantoms |
| Repeatable read | Non-repeatable reads | Phantoms (varies by engine) |
| Serializable | Everything | Reduced concurrency, retries on conflict |

Most production systems run read-committed or repeatable-read and handle the remaining
anomalies in application logic. Saying "serializable, because this is a ledger" and
accepting the retry cost is a legitimate senior answer; saying "we use transactions" with
no isolation level is not.

## The patterns that replace distributed transactions

Two-phase commit across services is rarely worth it: it is a synchronous coordinator, it
holds locks across network calls, and it fails badly when the coordinator dies.

| Pattern | How it works | Cost |
| --- | --- | --- |
| **Idempotent retries** | Make each step safe to repeat; retry until it lands. | Needs a key and a store. |
| **Saga (orchestration)** | A coordinator runs the steps and issues compensations on failure. | Compensations must exist and be correct; intermediate states are visible. |
| **Saga (choreography)** | Each service emits events; others react. | Harder to reason about globally. |
| **Outbox** | Write the domain change and an event row in one local transaction; a relay publishes it. | At-least-once publishing; consumers dedupe. |
| **Conditional write** | `UPDATE ... WHERE version = n` — optimistic concurrency. | Caller must retry on conflict. |

The **outbox pattern** deserves special attention because it solves the hardest everyday
problem: how to change your database *and* publish an event without a distributed
transaction. Both go in one local transaction; a separate process reads the outbox table
and publishes. The event is never lost and never published for a rolled-back write.

:::mermaid[Diagram]
sequenceDiagram
    participant S as Order service
    participant DB as Orders DB
    participant R as Outbox relay
    participant Q as Queue
    S->>DB: BEGIN; insert order; insert outbox row; COMMIT
    R->>DB: poll unpublished outbox rows
    R->>Q: publish event
    R->>DB: mark published
:::

## When you genuinely need strong consistency

- Money moving between accounts.
- Inventory decrement where overselling is unacceptable.
- Unique constraints — usernames, seat assignments, idempotency keys.
- Anything a regulator or an auditor will inspect.

For these, keep the data that must be consistent inside **one** database, and use
conditional writes plus idempotency keys at the boundary. That is far cheaper than
distributed transactions and it is what mature systems do.

## Interview soundbite

> "Placing an order touches inventory, payment and fulfilment. I wouldn't use a
> distributed transaction — I'd keep the order and the stock decrement in one database
> transaction with a conditional update so we cannot oversell, then publish an event via an
> outbox for payment and fulfilment, which are idempotent and can retry."

## Where to go next

- [Sagas and workflows](/c/system-design/31-sagas/) — the coordination patterns in detail.
- [Idempotency](/c/system-design/22-idempotency/) — the primitive that makes retries safe.
