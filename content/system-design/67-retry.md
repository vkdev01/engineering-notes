---
section: "67"
title: "Retry with backoff"
kicker: "Code"
abstract: "Exponential backoff with full jitter, a total time budget, and a hard rule that only safe operations are retried."
time: "3 min"
order: 67
---

Three rules, in order of importance: only retry what is safe to repeat, wait in a way that is less
predictable than everyone else, and stop eventually.

The jitter is not cosmetic. Without it, every client that failed at the same moment retries at the
same moment, and a service that was recovering is hit by a synchronised wall of traffic. Full
jitter — a uniform draw from zero to the exponential ceiling — costs nothing and prevents it.

:::warn[What this sample deliberately does not do]
It does not add a retry budget, and it does not consult a circuit breaker. In production you
want both: a cap on retries as a fraction of total traffic, so retries cannot triple your load
during an incident, and a breaker so you stop retrying a dependency that is clearly down.
:::

## The code

```python
"""Exponential backoff with full jitter.

The point of this module is the jitter: without it, every client that failed at
the same moment retries at the same moment, and a recovering service is hit by
a synchronised wall of traffic.

Run the tests with:  pytest -q code/python/tests
"""

from __future__ import annotations

import functools
import random
import time
from dataclasses import dataclass
from typing import Callable, Tuple, Type

@dataclass(frozen=True)
class RetryPolicy:
    """How hard to try, and for how long.

    attempts: total tries, including the first one.
    base:     the first backoff interval, in seconds.
    cap:      the largest single sleep, in seconds.
    budget:   the total wall-clock time we are willing to spend retrying.
    """

    attempts: int = 4
    base: float = 0.05
    cap: float = 2.0
    budget: float = 5.0

    def delay(self, attempt: int, rng: random.Random | None = None) -> float:
        """Full jitter: a uniform draw from zero to the exponential ceiling."""
        rng = rng or random
        ceiling = min(self.cap, self.base * (2 ** attempt))
        return rng.uniform(0, ceiling)

def retry(
    policy: RetryPolicy | None = None,
    retryable: Tuple[Type[BaseException], ...] = (TimeoutError, ConnectionError),
    sleep: Callable[[float], None] = time.sleep,
    rng: random.Random | None = None,
) -> Callable:
    """Wrap a function so that transient failures are retried.

    Only exceptions in `retryable` are caught. Anything else -- a validation
    error, a 400, a bug -- propagates immediately, because retrying it cannot
    help. That distinction is the whole safety argument for retries.
    """
    policy = policy or RetryPolicy()

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            started = time.monotonic()
            for attempt in range(policy.attempts):
                try:
                    return fn(*args, **kwargs)
                except retryable:
                    is_last = attempt == policy.attempts - 1
                    if is_last:
                        raise
                    delay = policy.delay(attempt, rng)
                    if time.monotonic() - started + delay > policy.budget:
                        raise
                    sleep(delay)
            raise AssertionError("unreachable")

        return wrapper

    return decorator
```

```

## What to notice

- `retryable` is an explicit allow-list of exception types. A `ValueError` propagates immediately,
  because retrying a validation failure cannot help.
- The `budget` check happens before sleeping, so a request cannot be held for longer than the
  caller agreed to wait.
- `sleep` and `rng` are injected. That is what makes the tests deterministic and instant.

## Exercises

1. Add a retry budget: track the ratio of retries to first attempts, and stop retrying when it
   exceeds 10%.
2. Add a `Retry-After` hint: when the exception carries a suggested delay, use it instead of the
   computed backoff.
3. Implement hedged requests instead: after the p95 latency elapses, send a second copy of the
   request and take the first answer.
