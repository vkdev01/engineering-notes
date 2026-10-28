---
section: "30"
title: "Retry and backoff"
kicker: "Building blocks"
abstract: "Transient failures are commoner than permanent ones. Retrying converts them into successes — as long as the waiting is jittered and the operation is safe to repeat."
time: "2 min"
order: 30
---

## What it is

Re-attempting an operation that failed for a reason likely to be temporary: a timeout, a
connection reset, a 503, a lock conflict.

The three rules, in order of importance:

1. **Only retry what is safe to repeat** (idempotent, or made so with a key).
2. **Wait, and wait less predictably than everyone else** (exponential backoff with jitter).
3. **Stop eventually** (a cap, and a budget).

## Backoff strategies

| Strategy | Delay for attempt n | Problem |
| --- | --- | --- |
| Fixed | `d` | Synchronised retries hammer a recovering service |
| Linear | `n × d` | Still synchronised |
| Exponential | `d × 2ⁿ` | Synchronised, and can wait too long |
| Exponential + full jitter | `random(0, d × 2ⁿ)` | The default. Spreads load, bounded |
| Decorrelated jitter | `random(d, prev × 3)` | Good for long-lived clients |

```python
# full jitter
delay = random.uniform(0, min(cap, base * 2 ** attempt))
```

Full jitter is the one to remember. It costs nothing and it is the difference between a
recovering service seeing a ramp and seeing a wall.

## The retry budget

Retries multiply traffic. If every request retries three times, a service at 100% load
during an incident experiences 300% load — which is how a small failure becomes a total
outage.

Mitigations:

- **Cap attempts** — three to five.
- **A retry budget** — retries may not exceed, say, 10% of total requests in a window.
- **Circuit breaker** — stop retrying a dependency that is clearly down.
- **Server-side `Retry-After`** — honour it; it is the dependency telling you what it can take.

## Retrying at the wrong layer

Retries at every layer compose multiplicatively: browser × gateway × client library ×
service = 81 attempts for one user action. Decide **one** layer to own retries for a given
call, and make the others fail fast.

## What to retry, and what not to

| Retry | Do not retry |
| --- | --- |
| Timeouts, connection resets | 400 Bad Request |
| 429 (with `Retry-After`) | 401 / 403 |
| 500, 502, 503, 504 | 404 |
| Deadlock / serialisation failures | 422 validation errors |
| Leader election in progress | Anything with a non-idempotent side effect and no key |

## Trade-offs

1. **Latency tail.** A retried request takes longer than the timeout you set. A user waiting
   on three attempts of a 2-second timeout waits 6 seconds. Consider a hedged request
   (send a second copy after p95) for read paths instead.
2. **Amplified load during incidents.** See above; this is the big one.
3. **Duplicate side effects.** Retrying a payment without an idempotency key charges twice.
4. **Hidden fragility.** A system that always retries masks a dependency that is 5% broken.
   Track retry rate as a first-class metric.

## Interview soundbite

> "Exponential backoff with full jitter, capped at three attempts and 5 seconds total, only on
> idempotent calls. The write path carries an idempotency key, so a retry after a timeout
> cannot double-charge."

## Where to go next

- [Retry implementation](../code/retry.md).
- [Temporary failures → retry](../patterns/temporary-failures-retry.md).
- [Idempotency](idempotency.md).
