---
section: "32"
title: "Search index"
kicker: "Building blocks"
abstract: "A derived store optimised for relevance-ranked text search. It is a cache with a query language, never a source of truth."
time: "2 min"
order: 32
---

## What it is

An inverted index: term → list of documents containing it, with positions and frequencies.
That structure makes "find documents containing these words, ranked by relevance" cheap,
which no B-tree can do.

Elasticsearch / OpenSearch is the usual choice; Algolia and Typesense are managed
alternatives; Postgres full-text search is the zero-infrastructure option.

## How it works

1. **Analysers** — tokenise text, lowercase, stem, remove stop words. `"Running Shoes"` →
   `["run", "shoe"]`.
2. **Indexing** — write the inverted index. Near-real-time: a document becomes searchable
   after a refresh interval (default ~1 s).
3. **Querying** — the query is analysed the same way; matching documents are scored
   (BM25 by default).
4. **Sharding and replicas** — the index is split by shard; each shard is queried and results
   merged.

## The synchronisation problem

The index must be built from the source of truth, and it will lag. Three approaches:

| Approach | Mechanism | Lag | Failure |
| --- | --- | --- | --- |
| **Dual write** | App writes DB and index | Small | Partial failure leaves them divergent forever |
| **Outbox + consumer** | DB transaction writes an outbox row; a consumer indexes it | Seconds | Replayable; the standard answer |
| **Batch rebuild** | Periodic full or incremental export | Minutes–hours | Simple, but stale and expensive |

Dual write is the one to avoid: if the index write fails after the DB commit, no retry will
ever fix it. The outbox keeps the event durable alongside the data.

## When to reach for it

- Full-text search with relevance ranking.
- Faceted filtering (filters plus counts) over large catalogues.
- Fuzzy matching and typo tolerance.
- Log search — a different use case with the same engine.
- Autocomplete — often a separate, smaller index built for prefixes.

## Trade-offs

1. **Eventually consistent.** A newly created record may not be searchable for a second or
   two. Show a "just added" state or read from the database for the confirmation screen.
2. **A second store to operate** — memory-hungry, with its own sharding, upgrades and
   mapping changes.
3. **Schema mapping mistakes are expensive.** Changing an analyser means reindexing.
4. **Not transactional.** No joins, no multi-document atomicity, no constraints.
5. **Cost.** Search clusters are RAM-bound and typically the most expensive per GB in the
   stack.

## Failure modes

- **Index drift** — documents updated in the DB but not the index. Detect with periodic
  reconciliation counts.
- **Mapping explosion** — dynamic mapping on user-controlled keys creates thousands of fields
  and the cluster falls over.
- **Deep pagination** — `from=10000` is a full scan on every shard. Use `search_after`.
- **Using it as a primary store** — it will be rebuilt one day, and the data will be gone.

## Interview soundbite

> "Search is a derived index fed by an outbox consumer, so it is at most a couple of seconds
> behind. The database stays the source of truth, and I reconcile counts nightly to catch
> drift. Deep pagination uses `search_after`, not offsets."

## Where to go next

- [Data storage models](/c/system-design/14-storage-models/).
- [Search autocomplete case study](/c/system-design/48-autocomplete/).
