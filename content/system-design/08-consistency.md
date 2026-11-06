---
section: "8"
title: "Consistency models"
kicker: "Fundamentals"
abstract: "Consistency is a promise about what a reader may see after a write. Two numbers decide it in practice: whether read and write quorums overlap (R + W > N) and how long replicas lag. The right level is a per-feature product decision, priced in latency and availability."
time: "15 min"
order: 8
outcomes:
  - "Compute the probability that a read is stale from the replication-lag distribution and the time since the write"
  - "Choose N, W and R for a quorum store and state its staleness, latency and availability"
  - "Decide between primary pinning and version tokens for read-your-writes, and price each in primary load"
  - "State CAP and PACELC as concrete latency and availability costs"
  - "Assign a consistency level and a staleness number to each feature of a design"
---

A Pulse user taps *Post*. The write goes to the Postgres primary and returns in a few milliseconds; the app reloads the feed 200 ms later, and that read is served by an asynchronous replica. If the replica hasn't applied the write yet, the user's own post is missing and the feature looks broken. How often does that happen, and what does it cost to stop it? Checkout has the opposite problem: two buyers must not both get the last unit in a 2,000 orders/s flash sale. This section turns both into arithmetic.

:::key[First principle]
Once there is more than one copy of the data, every read is a choice about which copy to trust. **A read is guaranteed fresh only if it overlaps a copy the write is known to have reached** — either by quorum overlap ($R + W > N$) or by waiting out the replication lag. Every stronger guarantee is bought with latency or availability; the job is to buy it only for the features that need it.
:::

## 8.1 The ladder of promises

| Model | The promise | What it costs | Typical use |
|---|---|---|---|
| **Linearisable** (strong) | Every read sees the latest completed write, as if there were one copy | Coordination on each write; unavailable on the minority side of a partition | Locks, leader election, balances, inventory decrement |
| **Sequential** | Everyone sees writes in the same order, not necessarily the latest | A total order (single leader or consensus log) | Replicated logs |
| **Causal** | Causally related writes appear in order; concurrent ones in any order | Tracking dependencies (versions, vector clocks) | Comments and replies, chat |
| **Read-your-writes** | A client sees its own writes | Primary pinning or version tokens (§8.4) | Profile edits, posting |
| **Monotonic reads** | A client never sees time go backwards | Pin each client to one replica | Feeds, timelines |
| **Eventual** | Replicas converge if writes stop | UI must tolerate staleness | Counters, search, analytics |

Read-your-writes and monotonic reads are *session* guarantees: they constrain what one client sees, so they are much cheaper than linearisability and fix most user-visible bugs.

## 8.2 Replication lag turns into stale reads

With asynchronous replication, the primary acknowledges a write before replicas apply it. Each replica applies it after a lag $L$. A read at time $t$ after the write, served by that replica, is stale when $L > t$:

$$
P(\text{stale at } t) = P(L > t) = e^{-t/\bar L} \quad \text{(model: exponentially distributed lag with mean } \bar L \text{)}
$$

The exponential is an illustrative shape; real lag has a heavier tail during load spikes, vacuum, or long transactions, so measure the distribution from replica metrics.

:::example[Worked example · Pulse's missing posts]
Pulse writes 200 posts/s on average. Each poster reloads the feed 200 ms after posting. With mean replica lag $\bar L$ = 100 ms (illustrative):

$$
P(\text{stale}) = e^{-200/100} = e^{-2} = 13.5\%
$$

That is \(200 \times 0.135\) ≈ 27 users a second, or ≈ 2.7 million a day (1 day ≈ \(10^5\) s), who post and don't see their post. To get below 1% the reload would need to wait \(100 \ln 100\) ≈ 460 ms — the wrong fix. The right fix is a session guarantee (§8.4).
:::

:::chart[P(read is stale) vs time since the write, for three mean replica lags (exponential model)]{type="line" x="time since write (ms)" y="P(stale read)" xlog="true" yfmt="pct" ymin="0" ymax="1" marks="200:feed reload"}
ms, mean lag 10 ms, mean lag 100 ms, mean lag 1 s
1, 0.905, 0.990, 0.999
2, 0.819, 0.980, 0.998
5, 0.607, 0.951, 0.995
10, 0.368, 0.905, 0.990
20, 0.135, 0.819, 0.980
50, 0.007, 0.607, 0.951
100, 0.000, 0.368, 0.905
200, 0.000, 0.135, 0.819
500, 0.000, 0.007, 0.607
1000, 0.000, 0.000, 0.368
2000, 0.000, 0.000, 0.135
5000, 0.000, 0.000, 0.007
:::

**Lag is a queue.** A replica applies changes at some rate $\mu$; when the primary writes faster ($\lambda > \mu$), the backlog grows by $(\lambda - \mu)$ per second and the lag grows with it. A backfill writing 8,000 rows/s for 60 s to a replica that applies 5,000 rows/s (illustrative) leaves a backlog of \((8{,}000 - 5{,}000) \times 60\) = 180,000 rows — 36 s of lag, during which every replica read is 36 s stale. Alert on lag in seconds, and throttle bulk jobs against it ([§10](/c/system-design/10-latency-and-throughput) covers why queues blow up near saturation).

## 8.3 Quorums: R + W > N

A leaderless or quorum store keeps $N$ copies. A write is acknowledged after $W$ replicas apply it; a read asks $R$ replicas and keeps the newest version. If

$$
R + W > N
$$

every read set shares at least one replica with every acknowledged write set (pigeonhole: $R + W$ picks from $N$ slots must repeat one), so the read sees the latest acknowledged write. With $R + W \le N$, the sets can miss each other.

The price is in the order statistics: a write waits for the $W$-th fastest replica, and needs $W$ replicas up; a read needs $R$ up. The simulation below measures all three for $N = 3$, with each replica applying a write after an exponential delay of mean 20 ms and being up 99.9% of the time (both illustrative).

```python run
from math import comb
import numpy as np

rng = np.random.default_rng(3)
TRIALS = 200_000
N = 3
MEAN_LAG_MS = 20.0       # illustrative: network + apply delay to each replica
A_REPLICA = 0.999        # illustrative availability of one replica

d = rng.exponential(MEAN_LAG_MS, size=(TRIALS, N))   # when each replica applies the write
d_sorted = np.sort(d, axis=1)
order = np.argsort(rng.random((TRIALS, N)), axis=1)  # random replica order for reads


def stale_rate(W, R, gap_ms):
    """Client writes, waits for W acks, waits gap_ms, then reads R random replicas
    and keeps the newest value. Stale = none of the R had applied the write."""
    read_at = d_sorted[:, W - 1] + gap_ms
    picked = np.take_along_axis(d, order[:, :R], axis=1)
    return 1 - (picked <= read_at[:, None]).any(axis=1).mean()


def at_least(k):
    """P(at least k of N replicas are up)."""
    return sum(comb(N, i) * A_REPLICA**i * (1 - A_REPLICA)**(N - i) for i in range(k, N + 1))


print("N W R  R+W>N  stale@0ms  stale@20ms  ack p50  ack p99  write nines  read nines")
for W, R in ((1, 1), (1, 2), (2, 1), (2, 2), (3, 1), (1, 3)):
    ack = d_sorted[:, W - 1]
    print("%d %d %d  %5s  %9.3f  %10.3f  %5.1f ms %5.1f ms  %11.1f  %10.1f" % (
        N, W, R, "yes" if R + W > N else "no",
        stale_rate(W, R, 0), stale_rate(W, R, 20),
        np.percentile(ack, 50), np.percentile(ack, 99),
        -np.log10(1 - at_least(W)), -np.log10(1 - at_least(R))))
```

```output
N W R  R+W>N  stale@0ms  stale@20ms  ack p50  ack p99  write nines  read nines
3 1 1     no      0.665       0.246    4.6 ms  30.6 ms          9.0         9.0
3 1 2     no      0.334       0.046    4.6 ms  30.6 ms          9.0         5.5
3 2 1     no      0.332       0.123   14.0 ms  56.8 ms          5.5         9.0
3 2 2    yes      0.000       0.000   14.0 ms  56.8 ms          5.5         5.5
3 3 1    yes      0.000       0.000   31.6 ms 114.5 ms          2.5         9.0
3 1 3    yes      0.000       0.000    4.6 ms  30.6 ms          9.0         2.5
```

How to read it:

- **$W = R = 1$ is stale 2 times in 3 immediately after the write** (the read hits a non-acking replica with probability 2/3) and still 25% of the time 20 ms later.
- **$W = R = 2$ is never stale and survives one replica down** (5.5 nines for both reads and writes, before correlated failures — [§6.3](/c/system-design/06-availability)). It pays the 2nd-fastest replica on writes: p99 56.8 ms vs 30.6 ms for $W = 1$.
- **$W = 3$ is fresh with $R = 1$ but writes fail when any replica is down** (2.5 nines) and wait for the slowest replica (p99 114.5 ms). $R = 3$ mirrors it for reads.

The same trade at $N = 5$ (same 20 ms mean delay, simulated): each extra required ack moves the write onto a slower order statistic, while a single-replica read immediately after the ack is stale with probability exactly $1 - W/N$ (at ack time only the $W$ fastest replicas have the write).

:::chart[Write ack latency vs W for N = 5 replicas (simulated, exponential 20 ms delays)]{type="line" x="W (acks required)" y="ack latency (ms)" points="true" marks="3:majority"}
W, p50, p99
1, 2.8, 18.6
2, 7.6, 30.2
3, 13.9, 44.7
4, 23.2, 68.8
5, 40.9, 123.2
:::

The jump from $W = 4$ to $W = 5$ (p99 68.8 → 123.2 ms) is the cost of waiting for the slowest of five; majority ($W = 3$) is the usual compromise.

:::warn[R + W > N is necessary, not sufficient]
Quorum overlap gives "reads see the latest acknowledged write" only if writes are ordered (versions or timestamps that compare correctly) and a failed write doesn't leave a partial value that some reads see and others don't. Sloppy quorums (writing to stand-in nodes during failures) and last-write-wins with skewed clocks both break the guarantee. Linearisable operations such as compare-and-set need consensus (Raft, Paxos) on top.
:::

## 8.4 Read-your-writes: the guarantee users notice

Fixes for the missing-post bug, with their cost on Pulse (200 posts/s, 2,000 reads/s average):

| Fix | How | Extra primary load | Caveat |
|---|---|---:|---|
| **Pin to primary** for a window | Session flag for 5 s after a write; that user's reads go to the primary | Posters × reads in window: \(200 \times 2\) = 400 reads/s (20% of all reads), assuming ~2 reads per poster in 5 s (illustrative) | Window must exceed worst lag, or the bug returns during a lag spike |
| **Version token** | Write returns its log position (e.g. Postgres LSN); a replica serves the read only if it has applied that position, else wait briefly or fall back to primary | Only lagging reads: ≤ 13.5% of 400 ≈ 54 reads/s at 100 ms mean lag | Needs replicas that expose applied position |
| **Write-through to the client** | App inserts the new post into the feed it renders locally | 0 | Only fixes the author's own view; other devices still lag |
| **Sticky replica** | Hash user to one replica | 0 | Gives monotonic reads, not read-your-writes |

Version tokens are the precise fix: they make the read wait for exactly the write it depends on. Pinning is simpler and fine when the extra primary load is affordable.

**Monotonic reads** fail differently: a user's first refresh hits a caught-up replica and shows a new comment; the second hits a lagging one and the comment vanishes. Sticky routing (hash `user_id` to a replica) removes the flip-flop for free, and degrades to "move to another replica" when that replica dies.

## 8.5 CAP and PACELC, as costs

**CAP**: during a network partition, a replicated system must either refuse some requests (stay consistent) or answer them with possibly stale data (stay available). It describes behaviour *during* a partition, not a menu chosen at design time.

**PACELC** adds the everyday trade: **E**lse, with no partition, choose between **L**atency and **C**onsistency. That one bites daily:

:::example[Worked example · the latency price of strong consistency]
Using the [§2](/c/system-design/02-estimation) latency table:

| Write path | Added latency per write |
|---|---:|
| Async replication (eventual) | 0 (ack from primary) |
| Sync to a replica in another zone, same region | ~0.5 ms (one intra-DC RTT) |
| Majority of 3 regions (consensus) | ~150 ms (RTT to the nearest other region) |

At checkout's 2,000 orders/s flash-sale peak, a 150 ms cross-region commit means \(2{,}000 \times 0.15\) = 300 orders in flight at once (Little's law) — 300 held connections and locks — versus ~1 at 0.5 ms. Cross-region strong consistency is a capacity decision, not just a latency one.
:::

:::note[Say this instead of reciting CAP]
"Under partition the feed stays available — serve the last known feed and reconcile — because a stale feed beats no feed. The inventory decrement and the payment ledger choose consistency: refuse and retry rather than sell the same unit twice."
:::

## 8.6 Strong where it matters: the checkout example

Inventory must not oversell. That does not require the whole checkout to be linearisable — only the decrement. Make it a single conditional write on the primary:

```sql
UPDATE inventory SET available = available - 1
WHERE sku = :sku AND available >= 1;   -- 1 row updated = reserved, 0 = sold out
```

The row's primary serialises concurrent decrements, so two buyers can't both take the last unit. Product pages may read stock from replicas or a cache seconds stale ("only a few left") because the decrement re-checks. The cost: one hot row on one primary during a flash sale — at 2,000 orders/s for one SKU, each row lock must be held well under 0.5 ms. Split stock across several rows (buckets) if it can't be ([§15](/c/system-design/15-transactions) covers isolation levels and locking).

## 8.7 A consistency budget per feature

| Feature | Model | Staleness allowed | Mechanism |
|---|---|---|---|
| Payment state, ledger | Linearisable | 0 | Primary / consensus, sync replica in-region |
| Inventory decrement | Linearisable on write | 0 for the decrement | Conditional update (§8.6) |
| Stock shown on product page | Eventual | ~5 s | Replica or cache; decrement re-checks |
| Own post, profile edit | Read-your-writes | 0 for the author | Version token or primary pin |
| Feed for others | Eventual + monotonic | ~5–30 s | Replicas, cache TTL ([§7](/c/system-design/07-caching)) |
| Chat in one conversation | Causal | Order preserved | Partition by conversation |
| Like and view counts | Eventual | Minutes | Async counters |
| Analytics dashboards | Eventual | Hours | Batch pipeline |

The cache is just another replica: its staleness bound is the TTL, unless writes invalidate it. Counting it as one keeps the table honest.

## 8.8 Rules of thumb

- **Default to eventual + session guarantees** (read-your-writes, monotonic reads); they fix the bugs users notice at a fraction of the cost of linearisability.
- **Make the one invariant strong, not the whole flow**: a conditional update or a uniqueness constraint on the primary usually suffices.
- **With N = 3, use W = R = 2** when you need quorum reads; it tolerates one replica down on both paths.
- **Measure lag in seconds and alert on it**; a lag spike silently turns every replica read stale.
- **Write the staleness number next to each feature** — "5 s", "0 for the author" — and design to it.

## 8.9 Check yourself

:::qa[Mean replica lag is 50 ms and users reload 200 ms after posting. What fraction see a stale feed, under the exponential model?]
$e^{-200/50} = e^{-4}$ ≈ 1.8%. At 200 posts/s that's ~4 users a second — still ~370,000 a day, so you still want a session guarantee; reducing lag alone rarely gets to zero.
:::

:::qa[A store has N = 5. Which (W, R) pairs give overlapping quorums with the cheapest writes, and what does each tolerate?]
$R + W > 5$: (1, 5), (2, 4), (3, 3), (4, 2), (5, 1). Cheapest writes is $W = 1$, but then $R = 5$ makes every read fail if any replica is down. $W = R = 3$ tolerates 2 replicas down on both paths and is the usual choice.
:::

:::qa[Pinning posters to the primary for 5 s costs 400 reads/s. A replica lag spike to 8 s happens. What breaks?]
Reads after the 5 s window go to replicas that are still 3 s behind the write, so the missing-post bug returns for every poster during the spike. Version tokens don't have this failure: they wait for, or bypass, exactly the lagging replica.
:::

:::qa[Why does a cross-region linearisable write cost capacity, not just latency, at 2,000 writes/s?]
Little's law: in-flight = rate × time = \(2{,}000 \times 0.15\) = 300 concurrent writes, each holding a connection, a request slot and possibly a lock for 150 ms. Locks held 300× longer also increase contention on hot rows.
:::

Next: [§9 Delivery semantics](/c/system-design/09-delivery-semantics) — the same "which copy happened?" question, asked about messages instead of rows.
