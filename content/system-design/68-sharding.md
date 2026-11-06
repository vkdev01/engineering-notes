---
section: "68"
title: "Shard router"
kicker: "Code"
abstract: "Tested hash, range and directory routers built on 1,024 logical shards, a rebalancer that moves the minimum when nodes are added, and simulations of hot keys under Zipf skew and of scatter-gather tail latency as the shard count grows."
time: "15 min"
order: 68
outcomes:
  - "Implement a router that maps key → logical shard → node, with range splits and per-key directory pins, and test what moves"
  - "Implement a rebalancer that moves exactly 1/n of the data when node n joins, and compare it with hash mod N and a hash ring"
  - "Measure node load under Zipf reads and decide between load-aware placement and caching the hot keys"
  - "Compute scatter-gather tail latency, 1 − (1 − p)^N, and what hedging buys at 16 shards"
---

The photo service's metadata will cross 10 TB within a year ([§34.1](/c/system-design/34-sharding)), so it is split by `hash(owner_id)` into 1,024 logical shards placed on 8 nodes, growing to 16 and then 32. Every service that touches metadata needs the same answer to "which node holds owner 42?", the answer must change safely while data moves, and the cluster must grow without re-keying 14.6 TB. This section writes the router and the rebalancer, tests them, and measures the two things routing can't fix on its own: hot keys and fan-out latency. Why to shard and how to pick the key are in [§34](/c/system-design/34-sharding) and [§46](/c/system-design/46-write-heavy-shard); the partitioning theory is in [§12.5–12.7](/c/system-design/12-replication-and-partitioning).

:::key[First principle]
Separate **which shard** a key belongs to from **where** that shard lives. The first is a pure function of the key — `hash(key) mod L` with $L$ fixed forever — so any process computes it with no lookup. The second is a small versioned table, so growing the cluster is moving whole logical shards and flipping table entries. Routing spreads keys evenly; it never splits one hot key, and every query that misses the shard key pays for the slowest shard.
:::

## 68.1 Three routers

| Router | Key → location | Lookup | Strength | Weakness |
|---|---|---|---|---|
| Hash + logical table | $\text{table}[\text{hash}(k) \bmod L]$ | $O(1)$ | Even spread, cheap moves | Range scans hit every shard |
| Range | first bound $> k$ (binary search) | $O(\log S)$ | Range scans touch few shards; split a hot range | Sequential keys pile onto the last range |
| Directory | explicit `key → node` entry | $O(1)$, memory per entry | Pin one tenant anywhere | The directory must be stored, cached, kept consistent |

The implementation uses all three: a hash router over logical shards, with a small directory of pinned keys on top, and a range router with splits. The photo id embeds the logical shard (10 bits for 1,024 shards), so "show photo X" routes from the id alone ([§52](/c/system-design/52-id-generator)).

```python run
"""Shard routers: hash -> logical shard -> node table (+ directory pins), range with splits, ids that route."""
import bisect
import hashlib


def h64(key: str) -> int:
    return int.from_bytes(hashlib.blake2b(key.encode(), digest_size=8).digest(), "big")


class HashRouter:
    """hash(key) -> one of L logical shards (fixed forever) -> node through a small, versioned table."""
    def __init__(self, nodes, logical=1024):
        self.L, self.version, self.pinned = logical, 1, {}     # pinned: key -> dedicated node
        self.table = [nodes[i % len(nodes)] for i in range(logical)]

    def shard(self, key):
        return h64(key) % self.L

    def node(self, key):
        return self.pinned.get(key) or self.table[self.shard(key)]

    def move(self, shard, node):                  # after the data copy + fence; bump the map version
        self.table[shard], self.version = node, self.version + 1


class RangeRouter:
    """Sorted split points: node i owns keys in [bounds[i-1], bounds[i])."""
    def __init__(self, bounds, nodes):
        assert len(nodes) == len(bounds) + 1 and bounds == sorted(bounds)
        self.bounds, self.nodes = list(bounds), list(nodes)

    def node(self, key):
        return self.nodes[bisect.bisect_right(self.bounds, key)]

    def scan(self, lo, hi):                       # nodes a range query [lo, hi] must touch
        return self.nodes[bisect.bisect_right(self.bounds, lo):bisect.bisect_right(self.bounds, hi) + 1]

    def split(self, at, new_node):                # new node takes the upper half of at's range
        i = bisect.bisect_right(self.bounds, at)
        self.bounds.insert(i, at)
        self.nodes.insert(i + 1, new_node)


def photo_id(ms, shard, seq):                     # 41-bit time | 10-bit logical shard | 12-bit seq
    return ms << 22 | shard << 12 | seq


nodes = [f"db{i}" for i in range(8)]
r, keys = HashRouter(nodes), [f"owner:{i}" for i in range(100_000)]
counts = {n: 0 for n in nodes}
for k in keys:
    counts[r.node(k)] += 1
spread = max(counts.values()) / (len(keys) / len(nodes))
assert spread < 1.03                              # 1,024 shards round-robin on 8 nodes: even
before = {k: r.node(k) for k in keys}
r.move(r.shard("owner:42"), "db8")                # move one logical shard to a new node
moved = [k for k in keys if r.node(k) != before[k]]
assert all(r.shard(k) == r.shard("owner:42") for k in moved) and r.version == 2
r.pinned["owner:7"] = "db-dedicated"              # a bulk importer gets its own node
assert r.node("owner:7") == "db-dedicated"
pid = photo_id(1_700_000_000_000, r.shard("owner:42"), 5)
assert r.table[pid >> 12 & 1023] == r.node("owner:42")   # "show photo X" routes from the id alone
print(f"hash router: max/mean over 8 nodes {spread:.3f}; moving 1 logical shard moved"
      f" {len(moved)} of {len(keys):,} keys ({len(moved) / len(keys):.3%}, 1/1024 = {1 / 1024:.3%})")

rr = RangeRouter(["g", "n", "t"], ["r0", "r1", "r2", "r3"])
assert [rr.node(k) for k in ("apple", "grape", "zebra")] == ["r0", "r1", "r3"]
assert rr.scan("h", "p") == ["r1", "r2"]          # a range scan touches only overlapping nodes
words = [f"{chr(97 + i % 26)}{i:05d}" for i in range(26_000)]
old = {w: rr.node(w) for w in words}
rr.split("q", "r4")                               # split the hot n..t range at q
changed = {w for w in words if rr.node(w) != old[w]}
assert changed and all("q" <= w < "t" for w in changed)
print(f"range router: split at 'q' moved {len(changed):,} of {len(words):,} keys, all in [q, t)")
```

```output
hash router: max/mean over 8 nodes 1.012; moving 1 logical shard moved 85 of 100,000 keys (0.085%, 1/1024 = 0.098%)
range router: split at 'q' moved 3,000 of 26,000 keys, all in [q, t)
```

What the tests pin down:

- **A move touches one logical shard and nothing else.** 85 of 100,000 keys moved — the sample's share of one shard, against an expected $1/1024$ = 0.098% — and every moved key has the moved shard's number. A key's logical shard never changes; only the table does, and each change bumps `version`.
- **Pins override the table.** A bulk importer ([§34.3](/c/system-design/34-sharding)) gets a dedicated node without touching the hash. Keep the directory small (hundreds of entries, not millions) or it becomes a database of its own.
- **A range split moves exactly the split-off range.** 3,000 of 26,000 keys moved, all in `[q, t)`; a range scan `h..p` touches two nodes, where the hash router would touch all of them.
- **Hash spread is even at the node level**: 1.012× the mean over 8 nodes with 128 logical shards each.

:::example[Worked example · how big is the map?]
1,024 entries × (2-byte shard number + an 8-byte node id) ≈ 10 KB, plus a version. Every router process can hold it in memory and refresh it on change; at 30,000 metadata reads/s ([§2](/c/system-design/02-estimation)) a lookup is an array index, so routing costs nanoseconds next to the ~5 ms database query (illustrative).
:::

## 68.2 Resharding with minimal movement

When node $n$ joins $n - 1$ nodes, balance requires it to end with $1/n$ of the data, so at least $1/n$ must move — and nothing else needs to. `hash mod N` instead keeps a key only when $h \bmod (n-1) = h \bmod n$, about one key in $n$, so it moves $(n-1)/n$:

$$
\text{moved}_{\min} = \frac{1}{n}, \qquad \text{moved}_{\bmod N} \approx \frac{n - 1}{n}.
$$

The rebalancer below hands the new node $\lfloor L/n \rfloor$ logical shards, one at a time from whichever node currently has the most. The tests assert the two properties that make it safe: old nodes only give shards (no shard moves between two old nodes), and node sizes stay within one shard of each other.

```python run
"""Resharding with minimal movement: logical-shard table vs hash mod N vs a consistent-hash ring."""
import bisect
import hashlib
from collections import Counter


def h64(s):
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


def add_node(table, new):
    """Give `new` its fair share by stealing one logical shard at a time from the fullest node."""
    table = list(table)
    load = Counter(table)
    for _ in range(len(table) // (len(load) + 1)):
        donor = max(load, key=lambda n: (load[n], n))
        i = max(j for j, n in enumerate(table) if n == donor)
        table[i] = new
        load[donor] -= 1
        load[new] += 1
    return table


def ring(n, vnodes=100):
    pts = sorted((h64(f"node{i}#{v}"), i) for i in range(n) for v in range(vnodes))
    return [p for p, _ in pts], [i for _, i in pts]


def ring_owner(r, x):
    pts, owner = r
    return owner[bisect.bisect(pts, x) % len(pts)]


L = 1024
keys = [h64(f"owner:{i}") for i in range(100_000)]
tables = {8: [i % 8 for i in range(L)]}
for n in range(9, 17):
    tables[n] = add_node(tables[n - 1], n - 1)
    old, new = Counter(tables[n - 1]), Counter(tables[n])
    assert all(new[m] <= old[m] for m in range(n - 1))      # old nodes only give, never swap
    assert max(new.values()) - min(new.values()) <= 1      # stays balanced to one shard
rings = {n: ring(n) for n in range(8, 17)}
place = {"hash mod N": lambda n, k: k % n,
         "ring, 100 vnodes": lambda n, k: ring_owner(rings[n], k),
         "1,024 logical shards": lambda n, k: tables[n][k % L]}
print("keys moved  ideal 1/n  " + "  ".join(f"{s:>20s}" for s in place))
for n in range(9, 17):
    moved = [sum(f(n, k) != f(n - 1, k) for k in keys) / len(keys) for f in place.values()]
    print(f"  {n - 1:>2} -> {n:<2} {1 / n:10.1%}  " + "  ".join(f"{m:20.1%}" for m in moved))
for name, f in place.items():
    c = Counter(f(16, k) for k in keys)
    print(f"16 nodes, {name:20s}: busiest node / mean = {max(c.values()) / (len(keys) / 16):.3f}")
```

```output
keys moved  ideal 1/n            hash mod N      ring, 100 vnodes  1,024 logical shards
   8 -> 9       11.1%                 89.1%                 11.7%                 11.1%
   9 -> 10      10.0%                 89.9%                  9.7%                 10.0%
  10 -> 11       9.1%                 90.8%                  9.3%                  9.0%
  11 -> 12       8.3%                 91.7%                  7.9%                  8.3%
  12 -> 13       7.7%                 92.2%                  6.3%                  7.5%
  13 -> 14       7.1%                 92.9%                  7.7%                  7.2%
  14 -> 15       6.7%                 93.3%                  7.2%                  6.8%
  15 -> 16       6.2%                 93.7%                  5.8%                  6.2%
16 nodes, hash mod N          : busiest node / mean = 1.025
16 nodes, ring, 100 vnodes    : busiest node / mean = 1.269
16 nodes, 1,024 logical shards: busiest node / mean = 1.024
```

:::chart[Share of keys that move when one node is added, growing 8 → 16 nodes one at a time (simulated, 100,000 keys)]{type="line" x="nodes after the add" y="keys moved (%)" ylog="true" points="true" dash="ideal 1/n"}
nodes, ideal 1/n, hash mod N, ring 100 vnodes, 1024 logical shards
9, 11.1, 89.1, 11.7, 11.1
10, 10.0, 89.9, 9.7, 10.0
11, 9.1, 90.8, 9.3, 9.0
12, 8.3, 91.7, 7.9, 8.3
13, 7.7, 92.2, 6.3, 7.5
14, 7.1, 92.9, 7.7, 7.2
15, 6.7, 93.3, 7.2, 6.8
16, 6.2, 93.7, 5.8, 6.2
:::

:::example[Worked example · adding the ninth node to photo metadata]
At one year the metadata is 14.6 TB ([§34.1](/c/system-design/34-sharding)). Logical shards move 11.1% of it, \(0.111 \times 14.6\) ≈ 1.6 TB, as 113 whole shards of ~14 GB each, every one onto the new node. `hash mod N` would move 89.1%, ≈ 13.0 TB, and every row would change home. The ring moves about the right amount (11.7%) but with 100 virtual nodes its busiest node holds 1.27× the mean at 16 nodes; the table stays within one shard of even (1.024× at key level, the residue being hash noise).
:::

The table moves the minimum *and* stays balanced because it is explicit: you choose which shards move. A ring decides for you, and its balance depends on the number of virtual nodes ([§64](/c/system-design/64-consistent-hashing) measures it). The price of the table is that it must be stored and distributed — which a database needs anyway for the move protocol: copy the shard, tail changes, fence writes, flip the entry, verify ([§34.5](/c/system-design/34-sharding)).

## 68.3 Hot keys under Zipf

Routing balances keys, not traffic. Photo metadata reads peak at 30,000/s ([§2](/c/system-design/02-estimation)); if owners' popularity is Zipf with $s$ = 1.0 over 1M owners, the hottest owner gets $1/H_{10^6}$ ≈ 6.95% of reads. The simulation computes the expected load on each of 1,024 logical shards and places them on 16 nodes three ways: the default round-robin table, a load-aware table (heaviest shard to emptiest node), and load-aware after caching the 1,000 hottest owners at a 90% hit rate (illustrative).

```python run
"""Hot keys: photo-metadata reads (Zipf s=1.0 over 1M owners, 30,000/s) on 16 nodes, three placements."""
import hashlib
import numpy as np

OWNERS, QPS, NODES, L, S = 1_000_000, 30_000, 16, 1024, 1.0
w = 1.0 / np.arange(1, OWNERS + 1) ** S
reads = QPS * w / w.sum()                        # expected reads/s per owner, hottest first


def h64(s):
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


rng = np.random.default_rng(68)
shard = rng.integers(0, L, OWNERS)               # stand-in for hash(owner) % 1024 (uniform)
shard[:20] = [h64(f"owner:{i}") % L for i in range(20)]   # the hot heads, by the real hash
shard_load = np.bincount(shard, weights=reads, minlength=L)


def by_round_robin(load):                        # default table: logical i -> node i % 16
    return np.bincount(np.arange(L) % NODES, weights=load, minlength=NODES)


def by_load(load):                               # greedy: heaviest logical shard to emptiest node
    nodes = np.zeros(NODES)
    for s in np.argsort(-load):
        nodes[nodes.argmin()] += load[s]
    return nodes


TOP = 1_000                                      # cache the 1,000 hottest owners (90% hit for them)
cached = reads.copy()
cached[:TOP] *= 0.1
cache_load = np.bincount(shard, weights=cached, minlength=L)

plans = {"hash, round-robin table": by_round_robin(shard_load),
         "load-aware table": by_load(shard_load),
         "cache top 1,000 + load-aware": by_load(cache_load)}
print(f"mean per node {QPS / NODES:,.0f} reads/s; hottest owner {reads[0]:,.0f}/s ({reads[0] / QPS:.2%});"
      f" hottest logical shard {shard_load.max():,.0f}/s")
print(f"cache absorbs {(reads[:TOP] * 0.9).sum() / QPS:.1%} of reads")
for name, load in plans.items():
    print(f"{name:30s} total {load.sum():6,.0f}/s  max {load.max():6,.0f}/s"
          f"  max/mean {load.max() / load.mean():4.2f}  min {load.min():6,.0f}/s")
assert plans["load-aware table"].max() >= shard_load.max()   # one logical shard can't be split
```

```output
mean per node 1,875 reads/s; hottest owner 2,084/s (6.95%); hottest logical shard 2,446/s
cache absorbs 46.8% of reads
hash, round-robin table        total 30,000/s  max  4,096/s  max/mean 2.18  min  1,306/s
load-aware table               total 30,000/s  max  2,446/s  max/mean 1.30  min  1,833/s
cache top 1,000 + load-aware   total 15,958/s  max  1,003/s  max/mean 1.01  min    993/s
```

:::chart[Metadata reads per node, 16 nodes sorted busiest first, Zipf s = 1.0 at 30,000 reads/s (simulated)]{type="bar" x="node (sorted)" y="reads per second" hmarks="1875:mean without cache"}
node, round-robin table, load-aware table, cache top 1000 + load-aware
n1, 4096, 2446, 1003
n2, 3216, 1844, 1003
n3, 2157, 1843, 1003
n4, 2087, 1843, 1003
n5, 1840, 1843, 1003
n6, 1830, 1843, 998
n7, 1665, 1836, 997
n8, 1612, 1833, 997
n9, 1575, 1833, 997
n10, 1489, 1833, 996
n11, 1473, 1833, 993
n12, 1465, 1833, 993
n13, 1431, 1833, 993
n14, 1380, 1833, 993
n15, 1377, 1833, 993
n16, 1306, 1833, 993
:::

- **The default table is 2.18× hot.** The node holding the top owner's shard serves 4,096 reads/s against a mean of 1,875: it also holds 63 other shards, some of them warm. The lower bound from [§12.6](/c/system-design/12-replication-and-partitioning) is $p_{\max} \cdot P$ = \(0.0695 \times 16\) = 1.11; the rest is the luck of what shares the node.
- **Load-aware placement fixes the node, not the shard.** Packing shards by measured load gives every node 1,833–1,844 except one: the node holding the 2,446/s logical shard alone. No table can split one logical shard, and the hottest owner by itself (2,084/s) already exceeds a node's mean share.
- **Caching the head flattens it.** The top 1,000 owners draw 52% of reads; at a 90% hit rate the cache absorbs 46.8%, the database sees 15,958/s, and placement gets every node within 1% of even. A hot key is the easiest thing to cache ([§18](/c/system-design/18-cache)); salting it (`owner#0…#7`) is for hot *writes*, and costs a fan-out on every read.

:::tip[Rebalance by load, not by count]
Move logical shards by their measured load (and bytes), not by how many each node has. The rebalancer in §68.2 balances counts because new clusters have no history; once traffic exists, feed it per-shard QPS and size and the same greedy loop balances what matters.
:::

## 68.4 Scatter-gather: tail latency vs shard count

A query without the shard key — "photos tagged #sunset", a global count — fans out to every shard and waits for the slowest. If each shard independently exceeds its own p99 with probability 0.01:

$$
P(\text{at least one of } N \text{ shards is slower than its p99}) = 1 - 0.99^{N}.
$$

The simulation gives each shard a lognormal query time with a 5 ms median (the course's illustrative DB query) and measures the gathered latency, plus one mitigation: hedging, i.e. asking a second replica of any shard that hasn't answered by its p95.

```python run
"""Scatter-gather: a query that fans out to N shards waits for the slowest. Tail math + hedging."""
import numpy as np

rng = np.random.default_rng(12)
TRIALS, MED, SIGMA = 100_000, 5.0, 0.6          # per-shard query: lognormal, median 5 ms (illustrative)


def shard_latency(shape):
    return MED * np.exp(SIGMA * rng.standard_normal(shape))


one = shard_latency(1_000_000)
p95, p99 = np.percentile(one, [95, 99])
print(f"one shard: p50 {np.median(one):.1f} ms, p95 {p95:.1f} ms, p99 {p99:.1f} ms")
print("\nshards  P(any shard > p99)  gather p50   p99  hedged p50   p99  extra calls")
for n in (1, 2, 4, 8, 16, 32, 64, 128):
    lat = shard_latency((TRIALS, n))
    gather = lat.max(axis=1)
    backup = p95 + shard_latency((TRIALS, n))   # hedge: ask a second replica once p95 has passed
    hedged = np.minimum(lat, backup).max(axis=1)
    p_any = 1 - 0.99 ** n
    assert abs((lat > p99).any(axis=1).mean() - p_any) < 0.01
    g50, g99 = np.percentile(gather, [50, 99])
    h50, h99 = np.percentile(hedged, [50, 99])
    print(f"{n:6d} {p_any:19.1%} {g50:11.1f} {g99:5.1f} {h50:11.1f} {h99:5.1f}"
          f" {(lat > p95).mean():12.1%}")
```

```output
one shard: p50 5.0 ms, p95 13.4 ms, p99 20.2 ms

shards  P(any shard > p99)  gather p50   p99  hedged p50   p99  extra calls
     1                1.0%         5.0  20.3         5.0  17.8         5.1%
     2                2.0%         6.9  23.5         6.9  19.3         5.1%
     4                3.9%         9.1  27.0         9.1  20.7         5.0%
     8                7.7%        11.5  30.7        11.5  22.1         5.0%
    16               14.9%        14.1  35.2        14.1  23.4         5.0%
    32               27.5%        16.8  39.0        16.1  24.9         5.0%
    64               47.4%        19.9  43.8        17.7  26.4         5.0%
   128               72.4%        23.1  48.0        19.1  27.9         5.0%
```

:::chart[Scatter-gather latency vs shards queried, per-shard median 5 ms (simulated)]{type="line" x="shards queried" y="query latency (ms)" xlog="true" points="true" dash="hedged p50,hedged p99"}
shards, gather p50, gather p99, hedged p50, hedged p99
1, 5.0, 20.3, 5.0, 17.8
2, 6.9, 23.5, 6.9, 19.3
4, 9.1, 27.0, 9.1, 20.7
8, 11.5, 30.7, 11.5, 22.1
16, 14.1, 35.2, 14.1, 23.4
32, 16.8, 39.0, 16.1, 24.9
64, 19.9, 43.8, 17.7, 26.4
128, 23.1, 48.0, 19.1, 27.9
:::

- **The median becomes a tail.** At 16 shards the *median* fan-out query (14.1 ms) is slower than one shard's p95 (13.4 ms), and 14.9% of queries include at least one shard above its p99. At 64 shards it is nearly half.
- **Hedging at the p95 costs 5% more calls** and cuts the 16-shard p99 from 35.2 to 23.4 ms. It needs a second replica per shard and an idempotent read.
- **This model is the kind case.** Lognormal with $\sigma$ = 0.6 has a light tail; real shards add GC pauses, compactions and one overloaded node (§68.3), which make the slow shard correlated and the curve steeper. The structural fix is to keep fan-out off hot paths: route by the shard key, maintain a [search index](/c/system-design/32-search-index) or precomputed aggregate for the rest, and return partial results with a timeout where the product allows.

## 68.5 Production notes

- **Thread safety.** Treat the map as immutable: build a new table, then swap one reference (copy-on-write). Readers never lock; a reader that grabbed the old map finishes with a consistent old view. `HashRouter.move` above mutates in place, which is fine in one thread and wrong under concurrent readers.
- **Distributing the map.** Store it in a strongly consistent config store, push changes to routers (watch) and poll as a backstop. Requests carry the router's map version; a node asked for a shard it no longer owns rejects the request with the newer version, and the router refreshes and retries once. That check — at the data node, not the router — is what makes a stale map safe during a move.
- **Where routing lives.** In a client library (no extra hop, but every language needs one), or a proxy tier such as Vitess's VTGate, a Citus coordinator or MongoDB's `mongos` (one implementation, one more hop). Cassandra and DynamoDB hide it inside the store; Cassandra places data on a ring with virtual nodes.
- **Ids that route.** Put the logical shard in every id you hand out (photo id, order id), so lookups by id never need the owner.
- **Cross-shard work.** Joins, transactions and unique constraints across owners don't survive sharding; [§34.6](/c/system-design/34-sharding) lists the replacement for each.

## 68.6 Interview angle

| Question | Answer with numbers |
|---|---|
| Lookup cost? | Hash + table: $O(1)$; range: $O(\log S)$ binary search over split points; the map is ~10 KB for 1,024 shards |
| Why logical shards? | Adding node 9 moves 11.1% (1.6 TB of 14.6 TB) instead of 89% with `hash mod N`, as whole ~14 GB units |
| Why not a hash ring? | It also moves ~1/n, but balance depends on virtual nodes (1.27× at 100 vnodes, 16 nodes); a table is exact and explicit |
| How many logical shards? | ≥ ~10× the largest node count you expect; each must stay small enough to copy in minutes (~43 GB at 3 years for photo metadata) |
| Hot key? | Can't be split by routing: cache it (46.8% of reads absorbed here), replicate its node, or pin it via the directory |
| Query without the shard key? | Fan-out: 16 shards → 15% of queries hit a p99-slow shard; hedge, index, or precompute |

Edge cases: a key whose shard is mid-move (fence writes, flip, then unfence); removing a node (its shards go to the least-loaded nodes, the mirror of `add_node`); a range router fed monotonically increasing keys (every write on the last range — hash the key or prefix it); hash function changes (never — $\text{hash}(k) \bmod L$ is a contract as permanent as the data).

## 68.7 Check yourself

:::qa[You run 1,024 logical shards on 12 nodes and add a 13th. How many shards move, and how many keys out of 50M?]
$\lfloor 1024/13 \rfloor$ = 78 shards, all to the new node: \(78/1024\) ≈ 7.6% of keys, ≈ 3.8M of 50M. `hash mod N` would move ~12/13 ≈ 92%, ≈ 46M.
:::

:::qa[Why must the data node, not just the router, check the shard-map version?]
Routers learn about a move at different moments. A router with the old map would write to the old node after the flip, and the write would be lost when the old copy is deleted. If the node rejects requests for shards it no longer owns, a stale router gets an error, refreshes and retries — correctness doesn't depend on every router updating in time.
:::

:::qa[The hottest owner draws 2,084 reads/s and a node's fair share is 1,875/s. What can placement achieve, and what fixes the rest?]
Placement can give that owner's logical shard a node to itself, but the node still runs above the mean (2,446/s for the whole shard here, 1.30×). Only removing load fixes it: a cache in front of the head (the top 1,000 owners at 90% hits takes 46.8% of all reads), or read replicas of that node.
:::

:::qa[A dashboard query fans out to 32 shards whose individual p99 is 20 ms. Estimate its p99 and one fix.]
Simulated: 39 ms, and 27.5% of queries include a shard above its p99 ($1 - 0.99^{32}$). Hedging at the per-shard p95 brings p99 to ~25 ms for 5% more calls; better, serve the dashboard from a precomputed aggregate so it touches one place.
:::

Next: [Token bucket](/c/system-design/69-token-bucket) — the rate limiter that protects each shard and dependency.
