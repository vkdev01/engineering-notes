---
section: "8"
title: "Consistency models"
kicker: "Fundamentals"
abstract: "Consistency is a spectrum of promises about what a reader may see. The right level is a product decision, not a database feature."
time: "3 min"
order: 8
---

## What it is

A consistency model is a contract: given that a write happened, what is a subsequent
reader allowed to observe? Stronger models are easier to reason about and more expensive
to provide.

| Model | The promise | Cost |
| --- | --- | --- |
| **Linearisable / strong** | Every read sees the most recent completed write, as if there were one copy. | Coordination on every write; latency and reduced availability during partitions. |
| **Sequential** | All clients see writes in the same order, but not necessarily the latest. | Ordering service; still coordination. |
| **Causal** | Writes that are causally related are seen in order; concurrent writes may appear in any order. | Cheap-ish; requires tracking dependencies. |
| **Read-your-writes** | You always see your own writes. | Sticky routing or version tokens. |
| **Monotonic reads** | You never see time go backwards. | Pin a user to a replica. |
| **Eventual** | Replicas converge, given no new writes. | You must design the UI for staleness. |

## The CAP theorem, stated usefully

During a **network partition**, a distributed system must choose between **consistency**
(refuse to answer rather than answer wrongly) and **availability** (answer, possibly
stale). That is all CAP says. It is not a menu you pick from at design time; it describes
what happens *while a partition is in progress*.

The more useful framing is **PACELC**: even when there is no partition (E), you trade
**latency** (L) against **consistency** (C). Every cross-region synchronous write is this
trade: 200 ms of latency in exchange for a strong guarantee.

:::note[Say this instead of CAP]
"Under partition I'd choose availability — serve the last known feed and reconcile —
because a stale feed is better than no feed. On the write path for payments I'd choose
consistency, because a duplicate charge is worse than a retry."
:::

## Read-your-writes: the one users notice

The classic bug: a user posts a comment, the write goes to the primary, the confirmation
page reads from a lagging replica, and the comment is missing. To the user, the feature
is broken.

Fixes, in increasing order of complexity:

1. **Route that user's reads to the primary** for a short window after their write
   (session flag with a 5–10 second TTL).
2. **Version tokens**: return the write's sequence number, and require a replica to be at
   least that caught up before serving.
3. **Sticky to a single replica** per user, so at least their own view is monotonic.

## Where each level is appropriate

| Feature | Sensible model |
| --- | --- |
| Bank balance, payment state | Strong, or read-your-writes at minimum |
| Inventory / seat availability | Strong on the write path (conditional update); reads may be slightly stale with a "checking" step |
| Social feed | Eventual, seconds |
| Like counts, view counts | Eventual, with client-side increment |
| Search results | Eventual, minutes is fine |
| Chat message delivery | Causal per conversation |
| Analytics dashboard | Eventual, hours |

## The lie of the "single source of truth"

Even a single relational primary with replicas is eventually consistent from a client's
point of view, because the client may talk to a replica. The moment you have more than one
copy of anything, you have a consistency decision. Making it explicitly, per feature, is
the difference between a design and a wish.

## Interview soundbite

> "The feed can be eventually consistent — five seconds of staleness is invisible to a
> user scrolling. The follow action needs read-your-writes, so I'd route that user's reads
> to the primary for a few seconds after the write, or return a version token and require
> the replica to have caught up."

## Where to go next

- [Replication and partitioning](replication-and-partitioning.md) — where the lag comes from.
- [ACID, BASE and transactions](transactions.md) — consistency within one node.
