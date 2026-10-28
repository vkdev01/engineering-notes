---
section: "63"
title: "Circuit breaker"
kicker: "Code"
abstract: "A three-state machine that stops calling a dependency it has decided is dead, and probes carefully before trusting it again."
time: "3 min"
order: 63
---

A failing dependency has two costs: the error, and the time you spend waiting for it. With a
30-second timeout and 200 threads, a dead dependency exhausts your pool in seconds and your service
goes down with it. The breaker turns an unbounded wait into an instant decision.

Two details are usually missing from examples and always needed in production. A **minimum
volume**, so one failure out of two requests does not trip the circuit. And a **fallback**, because
a breaker without one just relocates the error — the user still sees a failure, you have only
changed its shape.

## The code

```python
"""A circuit breaker.

    closed  -> calls pass through, failures are counted
    open    -> calls fail immediately, without touching the dependency
    half    -> a limited number of probes decide whether to close again

Two details that are usually missing from examples and always needed in
production: a *minimum volume* before the circuit may open (so one failure out
of two requests does not trip it), and a *fallback*, because a breaker without a
fallback only relocates the error.
"""

from __future__ import annotations

import threading
import time
from enum import Enum
from typing import Callable, Optional

class State(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitOpenError(RuntimeError):
    """Raised when a call is rejected because the circuit is open."""

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold: float = 0.5,
        min_volume: int = 20,
        window: float = 10.0,
        cooldown: float = 10.0,
        half_open_probes: int = 1,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.min_volume = min_volume
        self.window = window
        self.cooldown = cooldown
        self.half_open_probes = half_open_probes
        self._clock = clock
        self._lock = threading.Lock()
        self._state = State.CLOSED
        self._opened_at = 0.0
        self._probes = 0
        self._events: list[tuple[float, bool]] = []  # (timestamp, succeeded)

    @property
    def state(self) -> State:
        with self._lock:
            self._maybe_half_open()
            return self._state

    def _maybe_half_open(self) -> None:
        if self._state is State.OPEN and self._clock() - self._opened_at >= self.cooldown:
            self._state = State.HALF_OPEN
            self._probes = 0

    def _prune(self, now: float) -> None:
        cutoff = now - self.window
        self._events = [e for e in self._events if e[0] >= cutoff]

    def _record(self, ok: bool) -> None:
        now = self._clock()
        self._prune(now)
        self._events.append((now, ok))
        if self._state is State.HALF_OPEN:
            if ok:
                self._state = State.CLOSED
                self._events.clear()
            else:
                self._state = State.OPEN
                self._opened_at = now
            return
        total = len(self._events)
        failures = sum(1 for _, ok_ in self._events if not ok_)
        if total >= self.min_volume and failures / total > self.failure_threshold:
            self._state = State.OPEN
            self._opened_at = now

    def call(self, fn: Callable, fallback: Optional[Callable] = None, *args, **kwargs):
        """Run fn through the breaker. Uses `fallback` when the circuit is open."""
        with self._lock:
            self._maybe_half_open()
            if self._state is State.OPEN:
                allowed = False
            elif self._state is State.HALF_OPEN:
                allowed = self._probes < self.half_open_probes
                self._probes += 1
            else:
                allowed = True

        if not allowed:
            if fallback is not None:
                return fallback(*args, **kwargs)
            raise CircuitOpenError("circuit is open")

        try:
            result = fn(*args, **kwargs)
        except Exception:
            with self._lock:
                self._record(False)
            raise
        with self._lock:
            self._record(True)
        return result
```

```

## What to notice

- `min_volume` is checked before the failure ratio, which is what stops a single blip from opening
  the circuit.
- The half-open state admits a bounded number of probes. Letting all traffic through on recovery
  is how a recovering service is killed a second time.
- Failures are recorded under the same lock as the state read, so the count and the decision cannot
  disagree.
- `fallback` is a parameter of `call`, not a property of the breaker, because the right fallback
  differs per call site.

## Exercises

1. Add jitter to the cool-down so a fleet of instances does not probe simultaneously.
2. Distinguish counted failures from ignored ones — 4xx responses should not open the circuit.
3. Add a metric: time spent open, and the rate at which the fallback is served. A breaker open for
   a week means a feature has been dead for a week.
