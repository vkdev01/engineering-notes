---
section: "6"
title: "Availability and reliability"
kicker: "Fundamentals"
abstract: "Availability is a budget you spend deliberately. The design question is never 'can we be up 100% of the time' but 'which failures must not be visible'."
time: "3 min"
order: 6
---

## What it is

**Availability** is the fraction of time a system is able to serve requests. **Reliability**
is the probability it does so correctly for a given period. They are related but distinct:
a system can be available and wrong.

Availability is usually expressed in nines, and the arithmetic is unforgiving:

| Nines | Per year | Per month | Per week |
| --- | --- | --- | --- |
| 99% | 3.65 days | 7.2 h | 1.7 h |
| 99.9% | 8.8 h | 43 min | 10 min |
| 99.95% | 4.4 h | 22 min | 5 min |
| 99.99% | 53 min | 4.3 min | 1 min |
| 99.999% | 5.3 min | 26 s | 6 s |

## Serial and parallel composition

**In series** — availability multiplies. A request path across five services at 99.9%
each is 0.999⁵ ≈ 99.5%, which is 1.8 days of downtime a year even though every component
is "three nines".

**In parallel** — unavailability multiplies. Two independent replicas at 99% give
1 − 0.01² = 99.99%. Redundancy works, but only if the failures are genuinely independent.
Two replicas in the same rack sharing a power supply are one replica with extra steps.

:::warn[Correlated failure is the whole game]
Most real outages are correlated: one bad config pushed to all replicas, one shared
dependency, one expiring certificate, one full disk on the shared volume. Redundancy
that shares a control plane does not provide availability; it provides the illusion of
it.
:::

## The mechanisms, ranked by cost-effectiveness

1. **Timeouts.** Without them, a slow dependency consumes your threads until you are down.
2. **Health checks and removal from rotation.** A failing instance that keeps receiving
   traffic is worse than one that is gone.
3. **Redundancy across failure domains** — racks, availability zones, regions.
4. **Graceful degradation.** Serve a stale cache, hide a non-critical widget, accept the
   write into a queue. Most features do not need to be correct during an incident; they
   need to be absent rather than broken.
5. **Circuit breakers** so one dead dependency does not become five.
6. **Bulkheads** — separate thread pools or connection pools per dependency, so one slow
   dependency cannot starve the rest.
7. **Backups and tested restores.** An untested backup is a hypothesis.

## SLOs, SLIs and error budgets

An **SLI** is the measurement ("fraction of feed requests served under 300 ms"). An
**SLO** is the target ("99.9% over 28 days"). The **error budget** is what remains: 0.1%
of 28 days ≈ 40 minutes of allowed badness.

The point of an error budget is to convert an argument into arithmetic: if you have spent
the month's budget in a week, you stop shipping features and fix reliability. Alerting on
**burn rate** — how fast you are consuming the budget — beats alerting on raw CPU,
because it measures what users feel.

## Recovery objectives

- **RTO** (recovery time objective): how long you may be down.
- **RPO** (recovery point objective): how much data you may lose, expressed as time.

An RPO of five minutes forces asynchronous replication with a five-minute lag budget. An
RPO of zero forces synchronous replication, which costs you latency on every write. These
two numbers decide the entire data architecture, and they are almost never asked for
explicitly — asking for them is a strong senior signal.

## Interview soundbite

> "I'd target 99.9% for the read path and 99.95% for writes, because a lost write is worse
> than a delayed read. That rules out synchronous cross-region replication — 200 ms per
> write — so I'd use async replication with an RPO of about a minute, and accept that a
> regional failover loses the last minute of writes."

## Where to go next

- [Consistency models](consistency.md) — the trade you make to get availability.
- [Circuit breaker](../building-blocks/circuit-breaker.md) and [retry](../building-blocks/retry.md) — the mechanical defences.
- [Observability](../building-blocks/observability.md) — how you find out before users do.
