---
section: "23"
title: "Database indexes"
kicker: "Building blocks"
abstract: "An index is a sorted structure that turns 'look at every row' into 'jump to the rows'. It is the highest-return optimisation in this entire guide."
time: "3 min"
order: 23
---

## What it is

A separate data structure (usually a B-tree, sometimes a hash, LSM-tree, or inverted index)
maintained alongside the table, mapping indexed values to row locations.

- **B-tree** — ordered, supports equality, ranges and sorting. The default.
- **Hash** — equality only, faster for exact lookups.
- **Composite** — several columns in one index; the order of columns is the whole game.
- **Covering** — contains every column the query needs, so the table is never touched.
- **Partial / filtered** — indexes only rows matching a predicate (`WHERE status='open'`),
  smaller and cheaper.
- **Inverted** — term to document, for text search.

## The composite-index rule

An index on `(a, b, c)` serves queries filtering on:

- `a`
- `a, b`
- `a, b, c`

It does **not** serve `b` alone, or `b, c`. This is the **leftmost prefix** rule.

For a query like "my orders, newest first":

```sql
SELECT id, total, created_at
FROM orders
WHERE customer_id = ? AND status = 'shipped'
ORDER BY created_at DESC
LIMIT 20;
```

the right index is `(customer_id, status, created_at DESC)`: equality columns first, then
the sort column. Then `LIMIT 20` reads twenty entries instead of sorting a million rows.

## When to reach for it

- A query filters or sorts on a column that is not indexed.
- `EXPLAIN` shows a sequential scan or a filesort on a large table.
- A join key has no index on the foreign side.

## Trade-offs

1. **Write amplification.** Every index must be updated on insert, update, delete. Ten
   indexes make a write roughly ten times more expensive on the index side, and consume
   cache.
2. **Storage.** Often 20–50% of the table size, more for wide composite indexes.
3. **The planner may ignore it.** Low selectivity (a boolean column), stale statistics, or a
   type mismatch in the predicate will all produce a scan anyway. Check `EXPLAIN` after
   adding it, always.
4. **Too many indexes slow migrations** and make bulk loads painful.

## How to debug a slow query

1. `EXPLAIN ANALYZE` — see the plan and the actual rows examined.
2. Check for **full scans** on large tables, **filesorts**, and **nested loops** over large
   sets.
3. Check the **rows examined : rows returned** ratio. A ratio of 10,000:1 means an index is
   missing or useless.
4. Check **selectivity**. Indexing `status` on a table that is 95% `'active'` helps nothing;
   a partial index on the rare value does.
5. Consider **denormalisation** or a materialised view when the query shape is inherently
   expensive.

:::note[The interviewer's favourite follow-up]
"You added an index — what did you give up?" Answer: write throughput, storage, and
possibly a slower bulk import. Then say you would verify with `EXPLAIN` that the plan
actually changed.
:::

## Failure modes

- **Index on a low-cardinality column** — ignored by the planner.
- **Function on an indexed column** (`WHERE lower(email) = ?`) — the index is unusable unless
  you index the expression.
- **Implicit cast** (`WHERE varchar_col = 123`) — same problem.
- **Over-indexing a write-hot table** — the write path becomes the bottleneck.
- **Bloated indexes** — no maintenance after heavy deletes; rebuild or use `VACUUM`.

## Interview soundbite

> "The dominant query is orders for a customer, filtered by status, newest first, so I'd add
> a composite index on `(customer_id, status, created_at)` — equality columns first, sort
> column last — and confirm with `EXPLAIN` that the filesort disappears."

## Where to go next

- [Slow queries → indexes](/c/system-design/41-slow-queries-indexes/).
- [Data storage models](/c/system-design/14-storage-models/).
