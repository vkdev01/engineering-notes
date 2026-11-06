---
section: "23"
title: "Database indexes"
kicker: "Building blocks"
abstract: "An index is a sorted copy of some columns that turns a scan of N rows into about log_f(N) page reads. Size it from bytes per entry, order composite columns equality-then-sort, check selectivity before trusting it, and verify the plan with EXPLAIN — demonstrated on Pulse's posts in SQLite."
time: "14 min"
order: 23
outcomes:
  - "Compute B-tree fanout, depth and cached-RAM for an index over a year of Pulse posts"
  - "Size a table's indexes and their write cost from bytes per entry and the insert rate"
  - "Order composite-index columns so one index serves the filter and the sort"
  - "Estimate the selectivity at which an index stops beating a scan, and when a covering index changes that"
  - "Read EXPLAIN QUERY PLAN output and spot a scan or a temp B-tree sort"
---

Pulse stores 20 million posts a day — 7.3 billion rows and 7.3 TB after a year ([§14](/c/system-design/14-storage-models)). Every profile view runs "this user's 20 newest posts". Without an index the database reads every row to find a user's handful: terabytes per query. With the right index it reads about five pages. With an index on the right columns in the wrong *order*, it is back to scanning. This section sizes Pulse's indexes and shows each of those outcomes happening.

:::key[First principle]
An index is a second copy of some columns, **sorted**, with a pointer back to each row. Sorting is what lets the database jump instead of scan: a B-tree finds a key in $\lceil \log_f N \rceil$ page reads. It serves a query only if the query's filter matches a **leftmost prefix** of its columns, and it costs a write on every insert and space in RAM. Every index is a bet that its reads outweigh those costs.
:::

## 23.1 B-tree depth from fanout

A B-tree page (8 KB in PostgreSQL) holds sorted entries; internal pages point to children. With entry size $e$ and fill factor $\phi$, the fanout and depth are ([derivation in §14.4](/c/system-design/14-storage-models)):

$$
f \approx \frac{\text{page} \times \phi}{e}, \qquad \text{depth} = \lceil \log_f N \rceil, \qquad \text{internal pages} \approx \frac{N}{f} \cdot \frac{1}{f-1}.
$$

:::example[Worked example · Pulse's index on (user_id, created_at), one year]
Entry ≈ 32 B (8 B user, 8 B timestamp, row pointer and per-entry overhead; illustrative), 70% fill: \(f = 8{,}192 \times 0.7 / 32\) ≈ 179.

- Depth: \(\lceil \log_{179} (7.3 \times 10^9) \rceil = \lceil 4.38 \rceil\) = 5 levels.
- Leaves: \(7.3 \times 10^9 / 179\) ≈ 41M pages = 334 GB (the figure from §14.2).
- Internal levels: ~1.9 GB. That fits in RAM, so a lookup costs **one SSD read** (the leaf), ~100 µs, plus one more per table row it must fetch.

"This user's 20 newest posts" with this index: one leaf read finds 20 adjacent entries; fetching 20 rows scattered over the table is 20 more random reads — ~2.1 ms of SSD time. If the index also holds every column the query needs (*covering*), it's the single leaf read: ~0.1 ms.
:::

The point of a logarithm with base ~179: going from a thousand rows to ten billion adds only three levels, while a full scan grows ten-million-fold.

:::chart[Page reads to find one key: full scan vs B-tree (8 rows per table page, fanout 179)]{type="line" x="rows in table" y="page reads" xlog="true" ylog="true" points="true" marks="7300000000:Pulse after 1 year"}
rows, full scan, B-tree lookup
1000, 125, 2
10000, 1250, 2
100000, 12500, 3
1000000, 125000, 3
10000000, 1250000, 4
100000000, 12500000, 4
1000000000, 125000000, 4
10000000000, 1250000000, 5
:::

## 23.2 What indexes cost: space and writes

| Index on one year of posts | Entry (illustrative) | Fanout | Depth | Size at 70% fill | Internal pages (RAM) |
|---|---:|---:|---:|---:|---:|
| `post_id` (primary key) | 24 B | 239 | 5 | 250 GB | 1.0 GB |
| `(user_id, created_at)` | 32 B | 179 | 5 | 334 GB | 1.9 GB |
| Both | | | | 584 GB (8% of the 7.3 TB table) | 2.9 GB |

Narrow indexes are cheap next to 1 KB rows. A *covering* index that included `body` would be a second copy of the table — 7.3 TB — which is why covering indexes carry only small columns.

Writes are the real cost. Each new post updates the table and every index — a page write each, in different places. At Pulse's 600 posts/s peak, 2 indexes mean \(600 \times 3\) = 1,800 page writes/s; 5 indexes mean 3,600. Indexes also compete for the buffer cache: an index nobody queries still has its hot pages pushed in on every insert.

:::tip[Insert pattern matters]
An index whose first column is time (`created_at`, an auto-increment id) receives every insert on its right-most page — sequential and cache-friendly, but one hot page under concurrency. An index led by `user_id` spreads inserts across the whole tree: more random I/O, no hotspot. The same split decides range vs hash partitioning in [§12](/c/system-design/12-replication-and-partitioning).
:::

## 23.3 Composite indexes: column order is the design

A composite index on `(a, b, c)` is sorted by `a`, then `b` within equal `a`, then `c`. It can jump straight to any **leftmost prefix**: `a`, `a,b`, `a,b,c`. It can't jump to `b` alone — `b` values are scattered across every `a`.

Order columns by **equality, then sort, then range**:

```sql
SELECT post_id, created_at FROM posts
WHERE user_id = :u AND lang = :l          -- equality filters
ORDER BY created_at DESC                   -- sort
LIMIT 20;
-- index (user_id, lang, created_at): jump to (u, l), read 20 entries backwards, stop. No sort.
```

| Index | Serves `WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`? |
|---|---|
| `(user_id, created_at)` | Yes: jump to the user, entries already in time order, stop after 20 |
| `(user_id)` | Partly: jump to the user, then fetch and **sort all** their posts |
| `(created_at, user_id)` | No jump: walk the whole index newest-first, checking `user_id` |
| `(created_at)` | No: same walk, plus a table fetch per entry to read `user_id` |

A range condition ends the useful prefix: in `(user_id, created_at, lang)`, the query `user_id = ? AND created_at > ? AND lang = ?` uses `user_id` and the `created_at` range, then filters `lang` entry by entry.

## 23.4 Watch it in SQLite

300,000 posts, ~15 per user, plus one brand account holding 1% of all posts. The same query runs under four index choices. "VM ops" counts SQLite's virtual-machine instructions — deterministic work, independent of the machine — and the speed-up is wall-clock against the no-index scan, floored to a power of ten so the output is reproducible.

```python run
"""Pulse posts in SQLite: one query, four index choices. Work = SQLite VM ops (deterministic)."""
import sqlite3, time
import numpy as np

rng = np.random.default_rng(23)
N, USERS, HEAVY, TYPICAL = 300_000, 20_000, 7, 4_242
users = rng.integers(0, USERS, N)              # ~15 posts per user
users[rng.random(N) < 0.01] = HEAVY            # a brand account: 1% of all posts
db = sqlite3.connect(":memory:")
db.execute("CREATE TABLE posts (post_id INTEGER PRIMARY KEY, user_id INT, created_at INT, body TEXT)")
db.executemany("INSERT INTO posts VALUES (?,?,?,?)",
               ((i, int(u), 1_700_000_000 + i, "x" * 200) for i, u in enumerate(users)))
QUERY = "SELECT post_id, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 20"
ops = [0]


def tick():
    ops[0] += 10
    return 0                                   # 0 = keep running


def measure(user):
    ops[0] = 0
    db.set_progress_handler(tick, 10)          # called every 10 VM instructions
    db.execute(QUERY, (user,)).fetchall()
    db.set_progress_handler(None, 0)
    times = []
    for _ in range(15):
        t = time.perf_counter()
        db.execute(QUERY, (user,)).fetchall()
        times.append(time.perf_counter() - t)
    return ops[0], float(np.median(times))


def cell(user):
    work, sec = measure(user)
    speedup = max(1, 10 ** int(np.floor(np.log10(scan[user] / sec))))   # vs the full scan, floored
    return f"{work:>9,} ops {'≥' + format(speedup, ','):>7s}x"


count = lambda u: db.execute("SELECT count(*) FROM posts WHERE user_id=?", (u,)).fetchone()[0]
print(f"SQLite {sqlite3.sqlite_version}, {N:,} posts. typical user: {count(TYPICAL)} posts,"
      f" brand account: {count(HEAVY):,} posts\n")
scan = {u: measure(u)[1] for u in (TYPICAL, HEAVY)}
print(f"{'index':22s} {'typical user':>22s} {'brand account':>22s}   (VM ops, speed-up vs no index)")
for name, ddl in [("none", None),
                  ("(created_at, user_id)", "CREATE INDEX i ON posts(created_at, user_id)"),
                  ("(user_id)", "CREATE INDEX i ON posts(user_id)"),
                  ("(user_id, created_at)", "CREATE INDEX i ON posts(user_id, created_at)")]:
    db.execute("DROP INDEX IF EXISTS i")
    if ddl:
        db.execute(ddl)
    plan = "; ".join(r[3] for r in db.execute("EXPLAIN QUERY PLAN " + QUERY, (TYPICAL,)))
    print(f"{name:22s} {cell(TYPICAL):>22s} {cell(HEAVY):>22s}\n{'':22s} plan: {plan}")
```

```output
SQLite 3.54.1, 300,000 posts. typical user: 11 posts, brand account: 3,027 posts

index                            typical user          brand account   (VM ops, speed-up vs no index)
none                     900,120 ops      ≥1x   927,280 ops      ≥1x
                       plan: SCAN posts; USE TEMP B-TREE FOR ORDER BY
(created_at, user_id)    900,050 ops      ≥1x     6,200 ops    ≥100x
                       plan: SCAN posts USING COVERING INDEX i
(user_id)                    160 ops  ≥1,000x    36,360 ops     ≥10x
                       plan: SEARCH posts USING INDEX i (user_id=?); USE TEMP B-TREE FOR ORDER BY
(user_id, created_at)         80 ops  ≥1,000x       130 ops  ≥1,000x
                       plan: SEARCH posts USING COVERING INDEX i (user_id=?)
```

Read the plans, not just the numbers. `SCAN` means every row (or index entry) is visited; `SEARCH … (user_id=?)` means a B-tree jump; `USE TEMP B-TREE FOR ORDER BY` means a sort after the fact.

- **Wrong column order** `(created_at, user_id)` still `SCAN`s. For the typical user it walks all 300,000 entries; for the brand account it gets lucky — 1% of posts are theirs, so 20 turn up within ~2,000 entries. A plan that's fast for your test user and slow for everyone else.
- **`(user_id)` alone** jumps to the user but must fetch and sort *all* of their posts: trivial for 11, 36,360 ops for 3,027. Cost grows with the user's history.
- **`(user_id, created_at)`** does 80–130 ops for both — a jump plus 20 entries in order, and it is *covering* (SQLite's rowid is `post_id`), so the table is never touched.

On the author's laptop (illustrative), one run measured ~17 ms for the scan, ~5 ms for the wrong-order index on the typical user, ~0.85 ms for `(user_id)` on the brand account and 3–5 µs for `(user_id, created_at)`. At 7.3 billion rows instead of 300,000, the scan grows 24,000-fold; the composite lookup adds two B-tree levels.

## 23.5 Selectivity: when an index loses to a scan

An index is worth using only if the query keeps a small fraction $s$ of the rows (the **selectivity**). Compare page reads for a table of $N$ rows with $r$ rows per page, where a random page read costs $c$ times a sequential one:

$$
\text{scan} = \frac{N}{r}, \qquad \text{index (non-covering)} \approx s\,N\,c \;\;\text{(one random table page per match)}, \qquad s^* = \frac{1}{r\,c}.
$$

With 1 KB posts on 8 KB pages ($r$ = 8) and PostgreSQL's default planner ratio $c$ = 4, the break-even is \(s^* = 1/32\) ≈ 3%. Above that, the planner rightly ignores the index. A covering index reads its own leaves sequentially (179 entries per page) and never visits the table, so it stays cheaper up to $s$ = 1.

:::chart[Query cost relative to a full scan vs selectivity (r = 8 rows/page, random:sequential = 4)]{type="line" x="fraction of rows matching" y="cost ÷ full scan" xlog="true" ylog="true" xfmt="pct" marks="0.03125:break-even 3.1%"}
selectivity, full scan, index + table fetch, covering index
0.0001, 1, 0.0032, 0.000004464
0.0003, 1, 0.0096, 0.00001339
0.001, 1, 0.032, 0.00004464
0.003, 1, 0.096, 0.0001339
0.01, 1, 0.32, 0.0004464
0.03, 1, 0.96, 0.001339
0.1, 1, 3.2, 0.004464
0.3, 1, 9.6, 0.01339
1, 1, 32, 0.04464
:::

:::example[Worked example · indexing Pulse's `lang` column]
60% of posts are `lang = 0`. A query for those has $s$ = 0.6 — 19× past break-even — so an index on `lang` would be ignored or, if forced, ~19× slower than scanning. For the 5% language, $s$ = 0.05 is still above 3%. Useful alternatives: a **partial index** on the rare value (`CREATE INDEX … WHERE lang = 3`), putting `lang` *second* in a composite after `user_id` (where it filters within one user's posts), or a column store for "count posts per language" ([§14.3](/c/system-design/14-storage-models)).
:::

## 23.6 When the index exists but isn't used

| Cause | Example | Fix |
|---|---|---|
| Function on the column | `WHERE lower(email) = ?` | Expression index on `lower(email)`, or store normalised |
| Implicit cast | `WHERE phone = 5551234` on a text column | Compare with the column's type |
| Leading wildcard | `WHERE handle LIKE '%sam'` | Trigram / full-text index ([§32](/c/system-design/32-search-index)) |
| Not a leftmost prefix | `(user_id, created_at)` for `WHERE created_at > ?` | Add an index led by `created_at`, if the query matters |
| Low selectivity | `WHERE lang = 0` (60% of rows) | Partial or composite index; or accept the scan |
| Stale statistics | Planner thinks a table is tiny | `ANALYZE` after bulk loads |
| `OR` across columns | `WHERE user_id = ? OR reply_to = ?` | Two indexes + `UNION`, or rewrite |

Debug loop: run `EXPLAIN ANALYZE` (PostgreSQL) or `EXPLAIN QUERY PLAN` (SQLite); look for scans and sorts on large tables; compare **rows examined to rows returned** — 30,000 : 20 means the index isn't matching the query shape; fix; re-run the plan.

## 23.7 Rules of thumb

- **One index per dominant query shape**, columns ordered equality → sort → range; verify the sort disappears from the plan.
- **Size it**: entries × bytes ÷ 0.7; keep internal pages (~1/f of the size) in RAM.
- **Selectivity under ~3%** for a non-covering index on wide rows; covering indexes for hot, narrow queries.
- **Count the write cost**: every index adds a random page write per insert (Pulse peak: +600 writes/s per index).
- **Drop indexes nobody reads** — check index usage statistics before adding the next one.

## 23.8 Check yourself

:::qa[An index on (user_id, created_at) over 7.3 billion posts has fanout ~179. How many page reads does a lookup take, and how many hit the SSD?]
\(\lceil \log_{179} 7.3 \times 10^9 \rceil\) = 5 levels. The ~1.9 GB of internal pages stay in RAM, so one SSD read (the leaf), ~100 µs — plus one per table row fetched, unless the index is covering.
:::

:::qa[The query is `WHERE status = 'shipped' AND customer_id = ? ORDER BY created_at DESC LIMIT 20`. Which composite index, and why that order?]
`(customer_id, status, created_at)`: both equality columns first (most selective first is conventional, but either order of the two works for equality), then the sort column, so the database jumps to `(customer, shipped)` and reads 20 entries already in order — no sort step.
:::

:::qa[A column has 40% of rows with value X. Should `WHERE col = 'X'` use an index on a table of 1 KB rows?]
No. Break-even is ~1/(8 × 4) ≈ 3% for a non-covering index; at 40% the random table fetches cost ~13× a sequential scan. Scan, or make the index covering if the query only needs a few columns.
:::

:::qa[Pulse adds three more indexes to the posts table. What does that cost at peak?]
Each insert now updates 1 table + 5 indexes instead of 1 + 2: 600 posts/s × 6 = 3,600 page writes/s instead of 1,800, plus the space (hundreds of GB per year for narrow indexes) and buffer-cache pressure.
:::

Next: [§24 Load balancer](/c/system-design/24-load-balancer) — spreading Pulse's 6,000 requests/s across its API servers.
