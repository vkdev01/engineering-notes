---
section: "66"
title: "LRU cache"
kicker: "Code"
abstract: "O(1) recency with a hash map and a doubly linked list, and expiry kept strictly separate from eviction."
time: "4 min"
order: 66
---

Two operations must be O(1) or the cache becomes the bottleneck it was meant to remove: moving a
key to "most recently used", and evicting the least recently used one. A hash map gives O(1)
lookup; a doubly linked list gives O(1) move and remove. Together they give an LRU in constant
time, which is why this exact structure appears in every language's standard library.

Eviction and expiry are different things, and conflating them is a common bug. Eviction happens
when memory is full. Expiry happens when an entry's TTL has passed — and an expired entry must
never be returned, even if there is plenty of memory. A cache that only expires entries when it is
full will serve stale data indefinitely on a quiet system.

## The code

```python
"""An LRU cache with O(1) get and put, plus optional per-entry TTL.

The structure that makes LRU work: a dict from key to a linked-list node, and a
doubly linked list ordered by recency. Moving a key to the front and evicting
from the back are both O(1), which is why the cache does not slow down as it
fills.

Eviction and expiry are different things and both are implemented here:
  - eviction happens when the cache is full
  - expiry happens when an entry's TTL has passed, and must never return stale
    data even if there is plenty of memory
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Optional

class _Node:
    __slots__ = ("key", "value", "expires_at", "prev", "next")

    def __init__(self, key: Any, value: Any, expires_at: Optional[float]) -> None:
        self.key = key
        self.value = value
        self.expires_at = expires_at
        self.prev: Optional["_Node"] = None
        self.next: Optional["_Node"] = None

class LRUCache:
    def __init__(
        self,
        capacity: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        self.capacity = capacity
        self._clock = clock
        self._lock = threading.Lock()
        self._map: Dict[Any, _Node] = {}
        # sentinels: head.next is most recent, tail.prev is least recent
        self._head = _Node("__head__", None, None)
        self._tail = _Node("__tail__", None, None)
        self._head.next = self._tail
        self._tail.prev = self._head
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.expirations = 0

    # -- linked list helpers -------------------------------------------------
    def _unlink(self, node: _Node) -> None:
        node.prev.next = node.next
        node.next.prev = node.prev

    def _push_front(self, node: _Node) -> None:
        node.next = self._head.next
        node.prev = self._head
        self._head.next.prev = node
        self._head.next = node

    def _is_expired(self, node: _Node, now: float) -> bool:
        return node.expires_at is not None and node.expires_at <= now

    # -- public API ----------------------------------------------------------
    def get(self, key: Any, default: Any = None) -> Any:
        with self._lock:
            node = self._map.get(key)
            if node is None:
                self.misses += 1
                return default
            if self._is_expired(node, self._clock()):
                self._unlink(node)
                del self._map[key]
                self.expirations += 1
                self.misses += 1
                return default
            self._unlink(node)
            self._push_front(node)
            self.hits += 1
            return node.value

    def put(self, key: Any, value: Any, ttl: Optional[float] = None) -> None:
        with self._lock:
            now = self._clock()
            expires_at = None if ttl is None else now + ttl
            node = self._map.get(key)
            if node is not None:
                node.value = value
                node.expires_at = expires_at
                self._unlink(node)
                self._push_front(node)
                return
            if len(self._map) >= self.capacity:
                victim = self._tail.prev
                if victim is not None and victim is not self._head:
                    self._unlink(victim)
                    del self._map[victim.key]
                    self.evictions += 1
            node = _Node(key, value, expires_at)
            self._map[key] = node
            self._push_front(node)

    def __len__(self) -> int:
        return len(self._map)

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return 0.0 if total == 0 else self.hits / total

    def keys(self) -> list:
        """Keys from most to least recently used."""
        out = []
        node = self._head.next
        while node is not self._tail:
            out.append(node.key)
            node = node.next
        return out
```

```

## What to notice

- Sentinel head and tail nodes remove all the `if node.prev is None` special cases, which is where
  hand-written linked-list code usually breaks.
- `get` promotes the entry and counts a hit; a miss on an expired entry counts as an expiration and
  a miss, which keeps the two diagnostics separate.
- `hit_rate` is exposed because it is the number that decides whether the cache is worth its
  memory: 90% to 99% is a 10× reduction in origin load, and the improvement is entirely in the
  tail.

## Exercises

1. Add segmented LRU (a probationary segment and a protected segment) so a scan of cold keys cannot
   flush the hot working set.
2. Add single-flight: on a miss, only one caller recomputes and the rest wait for its result.
3. Implement LFU with a frequency sketch and compare hit rates on a workload where popularity
   shifts.
