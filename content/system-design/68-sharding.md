---
section: "68"
title: "Shard router"
kicker: "Code"
abstract: "Many more logical shards than physical nodes, so growing the cluster is a metadata change rather than a re-key of every row."
time: "3 min"
order: 68
---

The decision this file encodes is the one that makes sharding survivable: separate the *logical*
partition of the data from its *physical* placement. Create 1,024 logical shards, place them on 16
nodes, and keep the mapping in a small table. Going to 17 nodes then moves about 1/17 of the data,
and the application never learns that anything changed.

The naive alternative — assign shard `i` to node `i % len(nodes)` — is included in the test suite's
history because it is the mistake people actually make: it remaps almost every shard on every
scale-up.

## The code

```python
"""Shard routing with logical shards mapped to physical nodes.

The trick that makes sharding survivable: create many more logical shards than
physical nodes (1,024 logical shards on 16 nodes, say), and keep the mapping in
a small table. Growing the cluster is then a metadata change plus background
data movement, not a re-key of every row.

Routing by `hash(key) % number_of_nodes` instead means that going from 16 nodes
to 17 relocates almost every key.
"""

from __future__ import annotations

import hashlib
from typing import Dict, List

from consistent_hash import HashRing

def _hash(key: str) -> int:
    return int.from_bytes(hashlib.md5(key.encode()).digest()[:8], "big")

class ShardRouter:
    def __init__(self, logical_shards: int = 1024, nodes: List[str] | None = None) -> None:
        if logical_shards <= 0:
            raise ValueError("logical_shards must be positive")
        self.logical_shards = logical_shards
        self.nodes: List[str] = []
        self._shard_to_node: Dict[int, str] = {}
        for node in nodes or []:
            self.add_node(node)

    def add_node(self, node: str) -> None:
        """Add a node and rebalance logical shards evenly across all nodes."""
        if node in self.nodes:
            return
        self.nodes.append(node)
        self._rebalance()

    def remove_node(self, node: str) -> None:
        if node not in self.nodes:
            return
        self.nodes.remove(node)
        self._rebalance()

    def _rebalance(self) -> None:
        """Assign each logical shard to a node via consistent hashing.

        The naive `i % len(nodes)` assignment is the trap this class exists to
        avoid: going from four nodes to five remaps almost every shard. Hashing
        each logical shard onto a ring of nodes means adding a node takes over
        only about 1/(n+1) of the shards, and every other shard stays put.

        In a real system the movement is executed as background data migration;
        here the mapping is recomputed, which is the same arithmetic.
        """
        if not self.nodes:
            self._shard_to_node = {}
            return
        ring = HashRing(self.nodes, vnodes=100)
        self._shard_to_node = {
            i: ring.get(f"shard:{i}") for i in range(self.logical_shards)
        }

    def shard_for(self, key: str) -> int:
        return _hash(key) % self.logical_shards

    def node_for(self, key: str) -> str:
        if not self.nodes:
            raise RuntimeError("no nodes registered")
        return self._shard_to_node[self.shard_for(key)]

    def plan_add_node(self, node: str) -> Dict[str, List[int]]:
        """What would move if `node` were added: {node: [logical shard ids]}."""
        current = dict(self._shard_to_node)
        self.add_node(node)
        moved: Dict[str, List[int]] = {}
        for shard, owner in self._shard_to_node.items():
            if current.get(shard) != owner:
                moved.setdefault(owner, []).append(shard)
        # roll back so the plan is side-effect free
        self.nodes.remove(node)
        self._rebalance()
        return moved
```

```

## What to notice

- `shard_for` is a pure function of the key, so any service can compute it without a lookup. The
  table is only needed for the shard-to-node hop.
- `plan_add_node` computes the movement without performing it. Being able to answer "what would
  move?" before a migration is how you get a maintenance window approved.
- Consistent hashing over logical shards keeps the movement proportional and the distribution even.
- The real system executes the movement as background data migration with a cutover fence. This
  class only decides where things belong.

## Exercises

1. Add a `hot_shard` escape hatch: pin a specific tenant to a dedicated node.
2. Implement range-based sharding (by tenant ID prefix) and compare its movement profile with hash
   sharding.
3. Write the migration plan: for each moved logical shard, copy, verify, fence, and switch.
