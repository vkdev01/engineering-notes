---
section: "14"
title: "Data storage models"
kicker: "Fundamentals"
abstract: "Choose the store from the access pattern, not from the logo. Each model makes one kind of query cheap and everything else expensive."
time: "3 min"
order: 14
---

## The comparison

| Model | Examples | Cheap | Expensive | Reach for it when |
| --- | --- | --- | --- | --- |
| **Relational (OLTP)** | PostgreSQL, MySQL | Joins, transactions, ad-hoc queries, constraints | Horizontal write scale, huge blobs | Data has relationships and invariants that must hold |
| **Key-value** | Redis, DynamoDB, Riak | Single-key get/put at any scale | Anything requiring a scan or a join | You know the exact key for every access |
| **Document** | MongoDB, Couchbase | Nested objects, flexible schema | Cross-document joins | Entities are naturally trees and vary in shape |
| **Wide-column** | Cassandra, HBase, ScyllaDB | Massive writes, range scans within a partition | Ad-hoc queries, joins | Time-series and message-shaped data at scale |
| **Search** | Elasticsearch, OpenSearch | Full-text, faceting, fuzzy matching | Being a source of truth | You need relevance-ranked search |
| **Graph** | Neo4j | Multi-hop traversals | Bulk writes, sharding | Relationship queries several hops deep |
| **Time-series** | InfluxDB, TimescaleDB, Prometheus | High-cardinality-by-time ingestion, downsampling | Anything transactional | Metrics, IoT, monitoring |
| **Object / blob** | S3, GCS | Large immutable bytes, cheap, durable | Partial updates, low latency | Files, images, backups, video |
| **Analytical (OLAP)** | ClickHouse, BigQuery, Redshift | Aggregates over billions of rows | Point updates, high concurrency small reads | Dashboards, reporting, event analysis |
| **Queue / log** | Kafka, SQS, Pulsar | Durable ordered append, replay | Random access, mutation | Decoupling, event sourcing, buffering |

## The three questions that decide it

1. **What is the dominant query?** Write it down with its filters and sort order. If it is
   "get by exact key", a key-value store wins. If it is "all orders for this customer,
   newest first, filtered by status", you need a composite index — relational or
   wide-column.
2. **What must be transactional?** Anything with an invariant (balance, inventory,
   uniqueness) wants a relational engine with constraints, unless you implement the
   invariant yourself very carefully.
3. **How big, and how fast does it grow?** 100 GB fits anywhere. 100 TB forces partitioning.
   1 PB forces object storage plus a metadata database.

## Polyglot persistence, honestly

Real systems use several stores: relational for the transactional core, Redis for cache,
Elasticsearch for search, object storage for blobs, ClickHouse for analytics, Kafka for the
event log.

The cost is real: each store is a consistency boundary, a backup story, an on-call
rotation, and a schema to keep in sync. The honest rule is **one store until it hurts, and
when it hurts, add exactly one more for exactly one access pattern.** "Polyglot persistence"
as an aspiration produces systems nobody can operate.

:::warn[Search indexes are not databases]
Elasticsearch is a derived store. Treat it as a cache with a query language: it is
rebuilt from the source of truth, it can lag, and it must never be the only place a
record exists.
:::

## Reading and writing patterns worth knowing

- **CQRS** — separate the write model from the read model. Writes are normalised and
  validated; reads are denormalised projections, often rebuilt from events. Powerful, and
  it doubles the schema you maintain.
- **Event sourcing** — store the sequence of events rather than current state. Gives you a
  perfect audit log and time travel; costs you snapshotting, schema evolution, and
  everyone's ability to write a simple `SELECT`.
- **Materialised views** — precomputed query results, refreshed on write or on schedule.
  The simplest useful denormalisation.

## Interview soundbite

> "The access pattern is 'conversation messages, newest first, by conversation' — one
> partition, one range scan. That is a wide-column table keyed by conversation with
> time-ordered clustering, not a relational join. Metadata and membership stay relational,
> because those need transactions."

## Where to go next

- [Indexes](/c/system-design/23-indexes/) — making the dominant query cheap.
- [Search index](/c/system-design/32-search-index/).
- [Batch and stream processing](/c/system-design/17-batch-and-stream/).
