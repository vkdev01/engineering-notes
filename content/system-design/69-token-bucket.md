---
section: "69"
title: "Token bucket"
kicker: "Code"
abstract: "A burst allowance and a sustained rate as two independent knobs, with the check-and-decrement done as one atomic step."
time: "3 min"
order: 69
---

`capacity` is how large a burst you will tolerate. `refill_per_sec` is the sustained rate. Keeping
them independent is why the token bucket is the right default: a fixed window cannot express "100
per minute, but up to 200 in a burst", and it has the boundary bug where a client sends the full
allowance at 12:00:59 and again at 12:01:00.

The distributed version of this is a single Lua script in Redis. Splitting the check and the
decrement into two operations is the bug that lets two concurrent requests both consume the last
token — which is exactly what happens under load, and never in a demo.

## The code

```python
"""A token bucket rate limiter.

Tokens refill at a steady rate; each request takes one. `capacity` sets how
large a burst is allowed, `refill_per_sec` sets the sustained rate, and the two
are independent -- which is why this is the right default algorithm.

The single-process version here is the logic that a distributed implementation
must run atomically (in Redis, as one Lua script). Splitting the check and the
decrement into two operations is the bug that lets two requests both consume the
last token.
"""

from __future__ import annotations

import threading
import time
from typing import Callable

class TokenBucket:
    def __init__(
        self,
        capacity: float,
        refill_per_sec: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if refill_per_sec < 0:
            raise ValueError("refill_per_sec cannot be negative")
        self.capacity = float(capacity)
        self.refill_per_sec = float(refill_per_sec)
        self._clock = clock
        self._tokens = float(capacity)
        self._last = clock()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = self._clock()
        elapsed = max(0.0, now - self._last)
        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)
        self._last = now

    def allow(self, tokens: float = 1.0) -> bool:
        """Consume `tokens` if available. One atomic step, under a lock."""
        with self._lock:
            self._refill()
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            return False

    @property
    def tokens(self) -> float:
        with self._lock:
            self._refill()
            return self._tokens

    def retry_after(self, tokens: float = 1.0) -> float:
        """Seconds until the request would succeed. Useful for Retry-After."""
        with self._lock:
            self._refill()
            missing = tokens - self._tokens
            if missing <= 0:
                return 0.0
            if self.refill_per_sec == 0:
                return float("inf")
            return missing / self.refill_per_sec
```

```

## What to notice

- `_refill` is lazy: tokens are computed from elapsed time on access rather than by a background
  ticker. No thread, no timer, no drift.
- `retry_after` returns a number you can put straight into a `Retry-After` header. Add jitter
  before you serve it, or every rejected client returns at the same instant.
- The lock makes `allow` atomic within a process. Across processes you need a shared store and an
  atomic script — the same logic, executed server-side.

## Exercises

1. Add a `cost` parameter so an expensive endpoint consumes several tokens per request.
2. Implement the same algorithm as a Redis Lua script, and explain why a `GET` followed by a `SET`
   is not equivalent.
3. Add a second bucket keyed by tenant, and describe what happens when a tenant has several API
   keys.
