---
section: "64"
title: "Consistent hashing"
kicker: "Code"
abstract: "A ring with virtual nodes, so adding a cache node moves a slice of the keyspace instead of all of it."
time: "3 min"
order: 64
---

`hash(key) % N` is the trap. Adding one node to a ten-node cluster changes N, which remaps almost
every key, which means the cache is empty, which means the origin is hit by every request at once.
That is how a routine scale-up becomes an incident.

Consistent hashing puts nodes and keys on the same ring; a key belongs to the next node clockwise.
Adding a node moves only the keys in its arc — roughly 1/N.

Virtual nodes are not optional. With ten physical points the arcs are wildly uneven, and a dead
node dumps its entire keyspace on one unlucky neighbour. Giving each node around 150 points evens
the distribution and spreads a failure across all survivors.

## The code

```python
"""Consistent hashing with virtual nodes.

`hash(key) % N` remaps almost every key when N changes, so adding one node to a
ten-node cache cluster sends 90% of the keyspace to the origin at once.
Consistent hashing places nodes and keys on a ring, so adding a node moves only
the keys in its arc -- roughly 1/N.

Virtual nodes are not optional. With ten physical points the arcs are wildly
uneven; giving each node ~150 points evens the distribution and, more
importantly, spreads a dead node's keys across all survivors instead of dumping
them on one neighbour.
"""

from __future__ import annotations

import bisect
import hashlib
from typing import Dict, Iterable, List, Optional, Tuple

def _hash(value: str) -> int:
    return int.from_bytes(hashlib.sha1(value.encode()).digest()[:8], "big")

class HashRing:
    def __init__(self, nodes: Iterable[str] = (), vnodes: int = 150) -> None:
        if vnodes < 1:
            raise ValueError("vnodes must be at least 1")
        self.vnodes = vnodes
        self._ring: List[Tuple[int, str]] = []
        self._keys: List[int] = []
        self._nodes: set[str] = set()
        for node in nodes:
            self.add(node)

    def add(self, node: str) -> None:
        if node in self._nodes:
            return
        self._nodes.add(node)
        for i in range(self.vnodes):
            point = _hash(f"{node}#{i}")
            bisect.insort(self._ring, (point, node))
        self._keys = [p for p, _ in self._ring]

    def remove(self, node: str) -> None:
        if node not in self._nodes:
            return
        self._nodes.discard(node)
        self._ring = [(p, n) for p, n in self._ring if n != node]
        self._keys = [p for p, _ in self._ring]

    def get(self, key: str) -> Optional[str]:
        """The node that owns `key`: the first ring point clockwise from it."""
        if not self._ring:
            return None
        point = _hash(key)
        idx = bisect.bisect_left(self._keys, point)
        if idx == len(self._ring):
            idx = 0
        return self._ring[idx][1]

    def get_nodes(self, key: str, count: int = 2) -> List[str]:
        """`count` distinct nodes walking clockwise -- the replication set."""
        if not self._ring:
            return []
        point = _hash(key)
        idx = bisect.bisect_left(self._keys, point)
        seen: List[str] = []
        for offset in range(len(self._ring)):
            node = self._ring[(idx + offset) % len(self._ring)][1]
            if node not in seen:
                seen.append(node)
                if len(seen) == count:
                    break
        return seen

    def distribution(self, sample_keys: Iterable[str]) -> Dict[str, int]:
        """How many sampled keys land on each node. Used by the tests."""
        counts: Dict[str, int] = {n: 0 for n in self._nodes}
        for key in sample_keys:
            owner = self.get(key)
            if owner:
                counts[owner] += 1
        return counts
```

```

## What to notice

- `get_nodes` walks clockwise to produce a replication set, which is what lets a node failure be a
  cache miss rather than a cache wipe.
- `bisect` gives O(log n) lookup on a sorted list of ring points, which is fast enough that nobody
  has to build a tree.
- The test asserts that adding a fifth node moves between 12% and 28% of keys. That band is the
  property being protected: roughly 1/5, and nowhere near all of them.

## Exercises

1. Add weights, so a node with twice the memory receives twice the keys.
2. Implement bounded-load consistent hashing, which caps the keys any node can own — the fix for
   the remaining imbalance that virtual nodes leave.
3. Measure the distribution with 10, 50 and 150 virtual nodes, and plot the spread.
