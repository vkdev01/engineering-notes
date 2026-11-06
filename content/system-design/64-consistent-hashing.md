---
section: "64"
title: "Consistent hashing"
kicker: "Implementations"
abstract: "A hash ring with virtual nodes, tested, then measured: load spread versus virtual nodes (std/mean ≈ 1/√v), and keys moved when the photo-metadata cluster grows from 8 to 9 nodes — 11% on the ring against 89% for hash mod N."
time: "16 min"
order: 64
outcomes:
  - "Implement a hash ring with virtual nodes, weights and replica sets, and test the properties that matter"
  - "Compute the load spread for v virtual nodes from the Dirichlet formula and pick v"
  - "Compute the share of keys that move on a resize for mod-N, a ring and jump hash"
  - "Explain how real systems keep every client's ring identical during membership changes"
---

The photo service's metadata lives on 8 storage nodes — 14.6 TB after a year ([§34](/c/system-design/34-sharding)). Placement is `hash(key) % 8`. Adding a ninth node changes the modulus, and a key stays put only if `h % 8 == h % 9`: 1 key in 9. The other 88.9% — 13 TB — has to be copied to a new home before the cluster is consistent again. On a cache tier the same arithmetic turns a scale-up into a cold cache and a database stampede. Consistent hashing makes a resize move only the keys the new node takes over: 1/9 of them, 1.6 TB.

:::key[First principle]
Hash nodes and keys onto the same circle; a key belongs to the first node point clockwise from it. Adding or removing a node changes ownership only of the arcs next to that node's points, so a resize from $N$ to $N+1$ moves an expected $1/(N+1)$ of the keys. One point per node gives wildly uneven arcs (std/mean ≈ 1); giving each node $v$ **virtual nodes** makes its share a sum of $v$ arcs, and the spread falls as $1/\sqrt{v}$.
:::

## 64.1 The math

**Mod-N moves almost everything.** For a uniform hash $h$, $h \bmod N = h \bmod (N+1)$ only when the residue is the same in both, which happens for $N$ of every $N(N+1)$ consecutive values:

$$
P(\text{stays}) = \frac{N}{N(N+1)} = \frac{1}{N+1}, \qquad P(\text{moves}) = \frac{N}{N+1}
$$

8 → 9 nodes moves \(8/9\) = 88.9%; 16 → 17 moves 94.1%. The bigger the cluster, the worse a single added node is.

**The ring moves the new node's share.** The new node's points split existing arcs; only keys on the split-off parts change owner, and all of them move *to the new node*. Expected fraction: $1/(N+1)$.

**Spread with virtual nodes.** Place $N v$ points uniformly at random. The gaps between consecutive points are exchangeable spacings, and a node's share is the sum of the $v$ gaps ending at its points, so the vector of shares is $\text{Dirichlet}(v, \dots, v)$:

$$
\mathbb{E}[\text{share}] = \frac{1}{N}, \qquad
\frac{\text{std}}{\text{mean}} = \sqrt{\frac{N-1}{N v + 1}} \approx \frac{1}{\sqrt{v}}
$$

For $N$ = 8: one point per node gives 0.88; 100 points give 0.094.

**Cost.** A lookup is a binary search over $N v$ sorted points: $O(\log Nv)$ — \(\log_2 800\) ≈ 10 comparisons for 8 nodes × 100. Memory is $N v$ (hash, node) pairs: 800 for this cluster; 1,000 nodes × 256 points = 256,000 pairs ≈ 3 MB at 12 B each in a compiled language.

:::example[Worked example · the photo-metadata cluster, 8 → 9 nodes]
- **Data moved.** Mod-N: \(0.889 \times 14.6\) ≈ 13.0 TB. Ring: \(14.6 / 9\) ≈ 1.6 TB, all of it landing on the new node (§34.5 measured 1.5 TB).
- **Capacity headroom.** The average node holds \(14.6 / 8\) ≈ 1.83 TB. The hottest node holds max/mean × that: with 100 virtual nodes, 1.14 × 1.83 ≈ 2.08 TB (§64.3); with one point per node, 3.03 × 1.83 ≈ 5.5 TB. You provision every node for the hottest one, so $v$ = 1 wastes most of the cluster.
- **A node dies.** With one point per node its whole share lands on its single successor. With 100 virtual nodes the test in §64.2 spreads the dead node's keys over all 8 survivors, the largest taking 16%.
:::

## 64.2 The implementation

`HashRing` keeps a sorted list of `(point, node)` pairs. Three details carry most of the correctness:

- **A stable hash.** Python's built-in `hash()` of a string is salted per process (`PYTHONHASHSEED`), so two processes would disagree about every key. Use a real hash (BLAKE2, MD5, xxHash, Murmur) and take 64 bits.
- **Rebuild, then swap.** A membership change builds a new ring and replaces it with one assignment. Readers take one reference and never see a half-built ring, so lookups need no lock.
- **Replica sets walk clockwise and skip repeats**, because consecutive points often belong to the same physical node.

```python run
import bisect
import hashlib
from collections import Counter


def h64(s):                                   # stable across processes, unlike built-in hash()
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


class HashRing:
    def __init__(self, vnodes=100):
        self.vnodes, self.weights, self._ring = vnodes, {}, ([], [])

    def _rebuild(self):                       # build a new ring, then swap it in one assignment
        pts = sorted((h64(f"{n}#{i}"), n) for n, w in self.weights.items()
                     for i in range(max(1, round(self.vnodes * w))))
        self._ring = ([p for p, _ in pts], [n for _, n in pts])

    def add(self, node, weight=1.0):
        self.weights[node] = weight; self._rebuild()

    def remove(self, node):
        self.weights.pop(node, None); self._rebuild()

    def get(self, key):
        points, owners = self._ring           # one read: a concurrent rebuild can't tear it
        if not points: return None
        return owners[bisect.bisect_left(points, h64(key)) % len(points)]

    def get_nodes(self, key, n):              # replica set: next n distinct nodes clockwise
        points, owners = self._ring
        out, i = [], bisect.bisect_left(points, h64(key))
        for j in range(len(points)):
            node = owners[(i + j) % len(points)]
            if node not in out:
                out.append(node)
                if len(out) == min(n, len(self.weights)): break
        return out


ring, keys = HashRing(), [f"photo:{i}" for i in range(40_000)]
assert ring.get("x") is None and ring.get_nodes("x", 3) == []
for i in range(8): ring.add(f"node-{i}")
before = {k: ring.get(k) for k in keys}
load = Counter(before.values())
print("8 nodes x 100 vnodes: max/mean load %.2f" % (max(load.values()) / (len(keys) / 8)))

ring.add("node-8")
moved = [k for k in keys if ring.get(k) != before[k]]
assert all(ring.get(k) == "node-8" for k in moved), "keys only move to the new node"
print("add node-8: %.1f%% of keys moved (1/9 = 11.1%%)" % (100 * len(moved) / len(keys)))

after_add = {k: ring.get(k) for k in keys}
ring.remove("node-3")
moved = [k for k in keys if ring.get(k) != after_add[k]]
assert all(after_add[k] == "node-3" for k in moved), "only the removed node's keys move"
spread = Counter(ring.get(k) for k in moved)
print("remove node-3: its %d keys spread over %d survivors, largest share %.0f%%" % (
    len(moved), len(spread), 100 * max(spread.values()) / len(moved)))
assert len(spread) == 8 and max(spread.values()) < 0.3 * len(moved)

reps = ring.get_nodes("photo:42", 3)
assert len(set(reps)) == 3 and reps[0] == ring.get("photo:42")
assert sorted(ring.get_nodes("photo:42", 99)) == sorted(ring.weights), "n > nodes: all nodes"

ring.add("node-big", weight=2.0)
load = Counter(ring.get(k) for k in keys)
ratio = load["node-big"] / (sum(v for n, v in load.items() if n != "node-big") / 8)
assert 1.6 < ratio < 2.4
print("weight 2.0 node gets %.2fx the average node's keys" % ratio)
print("all ring tests passed; replicas of photo:42 ->", reps)
```

```output
8 nodes x 100 vnodes: max/mean load 1.12
add node-8: 11.4% of keys moved (1/9 = 11.1%)
remove node-3: its 4730 keys spread over 8 survivors, largest share 16%
weight 2.0 node gets 2.07x the average node's keys
all ring tests passed; replicas of photo:42 -> ['node-7', 'node-0', 'node-2']
```

What the tests pin down: keys only ever move *to* an added node and only *from* a removed one (anything else is a data-moving bug); a removal spreads load; replica sets are distinct physical nodes; a node with weight 2 gets about twice the keys; and the empty ring and $n$ > nodes edge cases return something sensible.

## 64.3 Measuring the spread

The block computes each node's **exact** share of the hash space (the lengths of the arcs ending at its points) rather than sampling keys, so the only noise is the ring itself. It averages 40 rings per setting for 8 nodes, then removes node 0 and measures the busiest survivor. Output is one row per setting; the chart plots it directly.

```python run
import hashlib
import math
import numpy as np

M = 2.0 ** 64


def h64(s):
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


def shares(nodes, v, tag):
    """Exact share of the hash space each node owns: the arcs ending at its points."""
    pts = sorted((h64(f"{tag}-{n}#{i}"), n) for n in range(nodes) for i in range(v))
    pos = np.array([p for p, _ in pts], dtype=float)
    owner = np.array([n for _, n in pts])
    arc = np.diff(np.concatenate(([pos[-1] - M], pos)))   # first point also owns the wrap-around
    return np.bincount(owner, weights=arc, minlength=nodes) / M


N, SEEDS = 8, 40                     # 8 storage nodes, as in the photo-metadata cluster
print("vnodes, std/mean simulated, Dirichlet formula, hottest excess (max/mean - 1), "
      "hottest survivor excess after a node dies")
for v in (1, 2, 5, 10, 20, 50, 100, 200, 500, 1000):
    cv, mx, dead = [], [], []
    for s in range(SEEDS):
        sh = shares(N, v, s)
        cv.append(sh.std() / sh.mean()); mx.append(sh.max() * N)
        pts = sorted((h64(f"{s}-{n}#{i}"), n) for n in range(N) for i in range(v))
        owners = [n for _, n in pts]
        # node 0 dies: each of its arcs goes to the next surviving point clockwise
        after = sh.copy(); after[0] = 0
        for j, n in enumerate(owners):
            if n == 0:
                k = j
                while owners[k % len(owners)] == 0: k += 1
                arc = (pts[j][0] - pts[j - 1][0]) % (2 ** 64) / M
                after[owners[k % len(owners)]] += arc
        dead.append(after.max() * (N - 1))
    theory = math.sqrt((N - 1) / (N * v + 1))
    print("%d, %.3g, %.3g, %.3g, %.3g" % (v, np.mean(cv), theory, np.mean(mx) - 1, np.mean(dead) - 1))
```

```output
vnodes, std/mean simulated, Dirichlet formula, hottest excess (max/mean - 1), hottest survivor excess after a node dies
1, 0.96, 0.882, 2.03, 1.97
2, 0.654, 0.642, 1.29, 1.15
5, 0.369, 0.413, 0.615, 0.566
10, 0.281, 0.294, 0.51, 0.446
20, 0.213, 0.209, 0.368, 0.338
50, 0.125, 0.132, 0.2, 0.186
100, 0.0872, 0.0935, 0.139, 0.13
200, 0.0608, 0.0661, 0.096, 0.101
500, 0.0404, 0.0418, 0.0638, 0.0604
1000, 0.0257, 0.0296, 0.0402, 0.0431
```

:::chart[Load spread vs virtual nodes per node (8 nodes, exact arc shares, 40 rings each)]{type="line" x="virtual nodes per node" y="ratio" xlog="true" ylog="true" points="true" dash="Dirichlet formula" marks="100:100 vnodes" note="excess = max/mean - 1"}
vnodes, std/mean simulated, Dirichlet formula, hottest excess (max/mean - 1), hottest survivor excess after a node dies
1, 0.96, 0.882, 2.03, 1.97
2, 0.654, 0.642, 1.29, 1.15
5, 0.369, 0.413, 0.615, 0.566
10, 0.281, 0.294, 0.51, 0.446
20, 0.213, 0.209, 0.368, 0.338
50, 0.125, 0.132, 0.2, 0.186
100, 0.0872, 0.0935, 0.139, 0.13
200, 0.0608, 0.0661, 0.096, 0.101
500, 0.0404, 0.0418, 0.0638, 0.0604
1000, 0.0257, 0.0296, 0.0402, 0.0431
:::

:::example[Worked example · reading the table]
- **The formula holds.** Simulated std/mean tracks $\sqrt{(N-1)/(Nv+1)}$ within sampling error at every $v$: 0.087 vs 0.093 at 100.
- **Diminishing returns.** Going from 1 to 100 points cuts the hottest node's excess from +203% to +14%; 100 → 1,000 only takes it from +14% to +4%, for 10× the ring. 100–200 points per node is the usual sweet spot; the remaining imbalance is cheaper to fix with weights or bounded loads (§64.5) than with more points.
- **Failure stays proportional.** After a node dies, the busiest survivor sits 13% above the survivor mean with 100 points, against 197% with one point.
:::

## 64.4 Measuring what moves on a resize

Grow a cluster one node at a time from 2 to 17 nodes and count the keys whose owner changed, for mod-N, the ring, and **jump consistent hash** (Lamping and Veach): a few lines of arithmetic that map a key to a bucket number in $O(\log N)$ with no table at all. The theoretical $N/(N+1)$ and $1/(N+1)$ are printed alongside.

```python run
import hashlib
import numpy as np


def h64(s):
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


def ring_owner(n, keys, v=100):                 # consistent hashing, 100 virtual nodes per node
    pts = sorted((h64(f"node-{i}#{j}"), i) for i in range(n) for j in range(v))
    pos = np.array([p for p, _ in pts], dtype=np.uint64)
    own = np.array([o for _, o in pts])
    return own[np.searchsorted(pos, keys) % len(pos)]


def jump(key, n):                               # Lamping and Veach's jump consistent hash
    b, j = -1, 0
    while j < n:
        b, key = j, (key * 2862933555777941757 + 1) % 2 ** 64
        j = int((b + 1) * (2 ** 31 / ((key >> 33) + 1)))
    return b


raw = [h64(f"photo:{i}") for i in range(20_000)]
keys = np.array(raw, dtype=np.uint64)
place = {
    "hash mod N": lambda n: keys % np.uint64(n),
    "ring, 100 vnodes": lambda n: ring_owner(n, keys),
    "jump hash": lambda n: np.array([jump(k, n) for k in raw]),
}
print("load at 8 nodes, max/mean over 20,000 keys:",
      ", ".join("%s %.2f" % (p, np.bincount(f(8)).max() / 2500) for p, f in place.items()))
print("nodes before, hash mod N, ring 100 vnodes, jump hash, N/(N+1), 1/(N+1)")
prev = {p: f(2) for p, f in place.items()}
for n in range(2, 17):
    cur = {p: f(n + 1) for p, f in place.items()}
    moved = [(cur[p] != prev[p]).mean() for p in place]
    print("%d, %s, %.3f, %.3f" % (n, ", ".join("%.3f" % m for m in moved), n / (n + 1), 1 / (n + 1)))
    prev = cur
```

```output
load at 8 nodes, max/mean over 20,000 keys: hash mod N 1.04, ring, 100 vnodes 1.13, jump hash 1.01
nodes before, hash mod N, ring 100 vnodes, jump hash, N/(N+1), 1/(N+1)
2, 0.668, 0.337, 0.338, 0.667, 0.333
3, 0.754, 0.248, 0.251, 0.750, 0.250
4, 0.803, 0.169, 0.197, 0.800, 0.200
5, 0.834, 0.169, 0.168, 0.833, 0.167
6, 0.860, 0.137, 0.145, 0.857, 0.143
7, 0.875, 0.104, 0.126, 0.875, 0.125
8, 0.888, 0.113, 0.109, 0.889, 0.111
9, 0.899, 0.083, 0.099, 0.900, 0.100
10, 0.912, 0.091, 0.089, 0.909, 0.091
11, 0.918, 0.082, 0.081, 0.917, 0.083
12, 0.922, 0.083, 0.075, 0.923, 0.077
13, 0.930, 0.073, 0.075, 0.929, 0.071
14, 0.935, 0.060, 0.067, 0.933, 0.067
15, 0.938, 0.061, 0.064, 0.938, 0.062
16, 0.942, 0.060, 0.061, 0.941, 0.059
```

:::chart[Share of keys that move when one node is added (20,000 keys)]{type="line" x="nodes before adding one" y="share of keys moved" yfmt="pct" ymin="0" ymax="1" points="true" dash="N/(N+1),1/(N+1)" marks="8:photo metadata 8 to 9"}
nodes before, hash mod N, ring 100 vnodes, jump hash, N/(N+1), 1/(N+1)
2, 0.668, 0.337, 0.338, 0.667, 0.333
3, 0.754, 0.248, 0.251, 0.750, 0.250
4, 0.803, 0.169, 0.197, 0.800, 0.200
5, 0.834, 0.169, 0.168, 0.833, 0.167
6, 0.860, 0.137, 0.145, 0.857, 0.143
7, 0.875, 0.104, 0.126, 0.875, 0.125
8, 0.888, 0.113, 0.109, 0.889, 0.111
9, 0.899, 0.083, 0.099, 0.900, 0.100
10, 0.912, 0.091, 0.089, 0.909, 0.091
11, 0.918, 0.082, 0.081, 0.917, 0.083
12, 0.922, 0.083, 0.075, 0.923, 0.077
13, 0.930, 0.073, 0.075, 0.929, 0.071
14, 0.935, 0.060, 0.067, 0.933, 0.067
15, 0.938, 0.061, 0.064, 0.938, 0.062
16, 0.942, 0.060, 0.061, 0.941, 0.059
:::

- **Mod-N moves $N/(N+1)$**, exactly as derived: 88.8% at 8 → 9, 94.2% at 16 → 17.
- **The ring and jump hash move ~$1/(N+1)$.** The ring wobbles around it (16.9% at 4 → 5, where 20% was expected) because one new node's 100 points cut a random amount of the circle; jump hash is almost exactly on the line.
- **Balance:** jump hash is near-perfect (max/mean 1.01) and needs no memory; the ring with 100 points is at 1.13. Jump hash's catch: buckets are numbered $0 \dots N-1$ and you can only add or remove the *last* one. It fits "shards numbered 0..N-1 behind a replicated storage layer", not "any cache node can die".

## 64.5 Production notes

**Every client must hold the same ring.** If two API servers disagree about membership, they read and write different nodes for the same key. Real systems distribute membership deliberately: memcached clients read a server list from configuration; Cassandra and Dynamo-style stores gossip ring state between nodes; Redis Cluster clients cache a slot map and follow `MOVED` redirects when it is stale. Version the ring and log the version with each request; mismatches are then visible.

**Moving data is a protocol, not a lookup change.** On a cache tier, a resize just costs misses on the moved fraction (1/9 here — size the database for that burst, [§7.6](/c/system-design/07-caching)). On storage, the new owner must stream its ranges before it takes reads, and writes during the copy go to both. That is why many systems use a fixed number of **logical shards** (Redis Cluster's 16,384 hash slots) mapped to nodes by a table: you move one slot at a time, verify it, flip one entry ([§34.2](/c/system-design/34-sharding)).

**What libraries do.**

| System | Placement | Points per node |
|---|---|---|
| libketama-style memcached clients | Ring, MD5 points | ~160 by default, scaled by weight |
| Cassandra | Ring of tokens per node (`num_tokens`) | 256 historically; 16 by default since 4.0, with a token-allocation algorithm for balance |
| Redis Cluster | 16,384 fixed slots, CRC16(key) mod 16384, slot → node table | n/a: slots are moved explicitly |
| Jump hash | Arithmetic, numbered buckets | n/a: no table |
| Rendezvous (HRW) hashing | Score every node with hash(key, node), pick the max | n/a: $O(N)$ per lookup, trivially weighted |

**Bounded loads.** Virtual nodes even out *key counts*, not *traffic*. Consistent hashing with bounded loads caps each node at $(1+\varepsilon)$ × the average load and sends overflow to the next node clockwise; HAProxy exposes it as `hash-balance-factor`. Neither fixes a single hot key — one key lives on one node however you hash ([§12.6](/c/system-design/12-replication-and-partitioning)); that needs replicas, a local cache or key salting.

**Replicas across failure domains.** `get_nodes` returns distinct nodes; in production also skip nodes in a rack or zone already chosen, or a single zone outage takes every replica.

:::warn[Failure modes]
- **Built-in `hash()` in a multi-process service** → each process routes differently; hit rate collapses with no errors.
- **Membership flapping** (a node marked dead and alive every few seconds) → 1/N of keys move back and forth; add hysteresis before removing a node.
- **Too few points** → the hottest node runs 1.5–3× the mean and is the one that falls over.
- **Adding many nodes at once without throttled streaming** → the copy competes with production traffic on every receiver.
:::

## 64.6 Interview angle

| Operation | Ring with $Nv$ points | Mod-N | Jump hash |
|---|---|---|---|
| Lookup | $O(\log Nv)$ | $O(1)$ | $O(\log N)$ |
| Add / remove node | $O(Nv \log Nv)$ rebuild (or $O(v \log Nv)$ incremental) | $O(1)$, but moves $N/(N+1)$ of keys | Only the last bucket |
| Memory | $O(Nv)$ | $O(1)$ | $O(1)$ |
| Keys moved on add | ~$1/(N+1)$ | $N/(N+1)$ | $1/(N+1)$ |

Edge cases to mention unprompted: empty ring; wrap-around past the last point (`% len(points)`); adding a node twice; two points hashing to the same value (sort by `(point, node)` so ties are deterministic); asking for more replicas than nodes.

Follow-ups you should expect: *weights* (more points for bigger nodes — 2.07× in the test); *how is data actually moved* (§64.5); *what about hot keys* (not a hashing problem); *ring vs jump hash vs rendezvous* (the table above); *how do all clients agree* (config service, gossip, or redirects).

## 64.7 Check yourself

:::qa[A cache tier of 16 nodes serves 6,000 reads/s at a 90% hit rate. You add one node. Roughly how many extra database reads per second do you see right after, with mod-N and with a ring?]
Moved keys are misses until refilled. Mod-N moves \(16/17\) ≈ 94% of keys, so the hit rate briefly drops toward 0.9 × 0.06 ≈ 5%: database load jumps from 600 to ~5,700 reads/s. A ring moves ~\(1/17\) ≈ 5.9%: hit rate ≈ 0.9 × 0.94 ≈ 85%, database load ~900 reads/s, falling back to 600 as the new node warms.
:::

:::qa[With 8 nodes and 20 virtual nodes each, what is the expected std/mean of node load, and roughly how hot is the hottest node?]
\(\sqrt{7 / 161}\) ≈ 0.21 (simulated 0.213). The table in §64.3 measures the hottest at 1.37× the mean, so every node must be provisioned 37% above average. At 100 points it is 1.14×.
:::

:::qa[Why does the ring implementation swap a new list in instead of inserting points in place?]
Lookups run on many threads. In-place `insort` into the points list and the owners list is two mutations a reader can observe half-done, mapping a key to the wrong node. Building a new `(points, owners)` tuple and assigning it once makes the change atomic for readers, with no lock on the read path; membership changes are rare, so the $O(Nv \log Nv)$ rebuild is irrelevant.
:::

:::qa[When would you choose jump hash over a ring?]
When buckets are numbered and only grow or shrink at the end — e.g. 0..N-1 shards that are each a replicated group, so a "dead node" is handled inside the group. Jump hash gives perfect balance (1.01 measured) with no memory. If any member can disappear, as in a cache fleet, use a ring or rendezvous hashing.
:::

Next: [§65 Idempotency store](/c/system-design/65-idempotency) — making a retried request safe to process twice.
