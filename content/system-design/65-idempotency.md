---
section: "65"
title: "Idempotency store"
kicker: "Code"
abstract: "Claim a key atomically, do the work once, store the response, and return the same answer to every replay."
time: "4 min"
order: 65
---

A timeout is genuinely ambiguous: the charge may or may not have happened. Without an idempotency
key, the only safe client behaviour is to ask a human, which is not a design.

The critical property is that claiming a key is atomic. A read-then-write check races, and it races
exactly when it matters — two duplicate requests arriving together. In this sample `claim()` is a
single locked insert; in a real system it is a unique constraint on `(scope, key)` inside the same
transaction as the business write. That "same transaction" is what makes it correct rather than
nearly correct.

## The code

```python
"""An idempotency store.

The contract: the client sends a key, the server performs the operation at most
once, and a replay returns the *original* response rather than recomputing it.

The critical property is that claiming a key is atomic. A read-then-write check
races, and it races exactly when it matters -- two duplicate requests arriving
together. Here `claim()` is a single locked insert, standing in for the unique
constraint you would use in a real database:

    INSERT INTO idempotency (scope, key) VALUES (?, ?)   -- unique index
    ... in the same transaction as the business write ...

If the insert violates the constraint, the operation already happened (or is
happening) and the stored response is returned instead.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Optional, Tuple

class Outcome(str, Enum):
    FRESH = "fresh"        # we won the claim; caller should do the work
    REPLAY = "replay"      # already completed; return the stored response
    IN_FLIGHT = "in_flight"  # another caller holds the claim right now

@dataclass
class _Record:
    state: str = "in_flight"
    response: Optional[Tuple[int, Any]] = None
    created_at: float = field(default_factory=time.monotonic)

class IdempotencyStore:
    def __init__(self, ttl: float = 24 * 3600, clock: Callable[[], float] = time.monotonic):
        self.ttl = ttl
        self._clock = clock
        self._lock = threading.Lock()
        self._records: Dict[str, _Record] = {}

    def _key(self, scope: str, key: str) -> str:
        return f"{scope}\x00{key}"

    def _expire(self) -> None:
        now = self._clock()
        stale = [k for k, r in self._records.items() if now - r.created_at > self.ttl]
        for k in stale:
            del self._records[k]

    def claim(self, scope: str, key: str) -> Tuple[Outcome, Optional[Tuple[int, Any]]]:
        with self._lock:
            self._expire()
            k = self._key(scope, key)
            record = self._records.get(k)
            if record is None:
                self._records[k] = _Record()
                return Outcome.FRESH, None
            if record.state == "done":
                return Outcome.REPLAY, record.response
            return Outcome.IN_FLIGHT, None

    def complete(self, scope: str, key: str, status: int, body: Any) -> None:
        with self._lock:
            k = self._key(scope, key)
            record = self._records.setdefault(k, _Record())
            record.state = "done"
            record.response = (status, body)

    def release(self, scope: str, key: str) -> None:
        """Drop a failed claim, so a genuine retry can try again."""
        with self._lock:
            self._records.pop(self._key(scope, key), None)

    def execute(
        self,
        scope: str,
        key: str,
        fn: Callable[[], Tuple[int, Any]],
    ) -> Tuple[int, Any]:
        outcome, response = self.claim(scope, key)
        if outcome is Outcome.REPLAY and response is not None:
            return response
        if outcome is Outcome.IN_FLIGHT:
            return 409, {"error": "request with this idempotency key is in progress"}
        try:
            status, body = fn()
        except Exception:
            self.release(scope, key)
            raise
        self.complete(scope, key, status, body)
        return status, body
```

```

## What to notice

- Keys are scoped. A global key space invites collisions between endpoints, and a collision here
  means one request silently receives another's response.
- `IN_FLIGHT` is a distinct outcome from `REPLAY`. Returning a stored response for work that has
  not finished yet would be a lie; 409 is honest.
- A failed operation calls `release`, so a genuine retry can succeed. Keeping the claim after a
  failure means the client can never retry.
- The stored response is returned verbatim, status code included. Recomputing it would produce a
  different body for the same logical operation.

## Exercises

1. Add a TTL sweep and explain the two ways to get the retention period wrong.
2. Make `execute` reject a replay whose payload hash differs from the original — the same key with
   a different body is a client bug, not a retry.
3. Replace the in-memory dict with a SQL table using a unique constraint, and show the transaction
   boundary.
