---
section: "52"
title: "Design a unique ID generator"
kicker: "Case studies"
abstract: "Generate unique, roughly time-ordered 64-bit identifiers across many machines, without a round trip per ID."
time: "3 min"
order: 52
---

## 1 · Requirements

**Functional**

- Return a unique 64-bit ID on demand, at high rate.
- IDs roughly sortable by creation time.

**Non-functional**

- No coordination on the hot path — a network round trip per ID is too slow.
- No collisions, ever, across machines and restarts.
- At least 10k IDs per second per process.

## 2 · Estimates

| Quantity | Assumption | Result |
| --- | --- | --- |
| Rate | 10k per second per instance | ~10⁹ per day at 100 instances |
| Bit budget | 64 bits | 41 time + 10 machine + 12 sequence |
| Clock rollback | A few milliseconds | Wait, or borrow from the next millisecond |

## 3 · API

```text
GET /ids?count=100 -> 200 {ids: [1845678901234567890, ...]}
```

Usually a library call rather than an HTTP endpoint. The shape below is Twitter's Snowflake.

## 4 · Data model

| Store | Key | Notes |
| --- | --- | --- |
| — | — | The generator is stateless apart from machine ID and last timestamp |
| `machine_registry` | `machine_id` | Leased once per instance from etcd or the orchestrator |

## 5 · High-level design

:::mermaid[Diagram]
flowchart LR
    S[Service instance] --> G[ID generator<br/>41b time | 10b machine | 12b seq]
    G --> R[Return 64-bit ID]
    M[etcd] -.->|lease machine_id| G
    N[NTP] -.->|time| G
:::

## 6 · Deep dives

### The bit layout

41 bits of milliseconds since a custom epoch gives about 69 years. 10 bits of machine ID gives
1,024 instances. 12 bits of sequence gives 4,096 IDs per millisecond per instance.

The sequence is what makes it fast: within the same millisecond, increment the counter instead
of waiting for the clock. At 4,096 per millisecond, one instance can emit over four million IDs
per second — far beyond any real need.

### Clock problems

Two cases must be handled explicitly.

- **The clock goes backwards** (NTP correction, VM migration). Either refuse to generate until
  it catches up, or borrow from the last known timestamp and log loudly. Never emit an ID with a
  lower timestamp than one already issued, or ordering silently breaks.
- **Skew between machines** means IDs are only approximately ordered globally. That is the price
  of not coordinating.

If you need strict global ordering you need a coordinator — a sequence service or a database
sequence — and you pay a round trip per ID.

### Alternatives

- **UUIDv4** — no coordination, but random, so it destroys B-tree locality as a primary key.
- **UUIDv7** — time-ordered UUIDs; the modern default when you do not control the schema.
- **Database auto-increment** — simple and ordered, but a single writer and a round trip.
- **Ticket server with ranges** — hand out blocks of 10,000; loses ordering, gains availability.
- **Snowflake** — local generation with approximate ordering, as above.

## 7 · Bottlenecks

| Symptom | Fix | Cost |
| --- | --- | --- |
| More than 1,024 instances | Widen machine bits, or lease IDs dynamically | Fewer sequence bits |
| More than 4,096 IDs per ms | Wait for the next millisecond | Added latency under extreme load |
| IDs used as database keys | Time-ordered IDs cluster at the index end — a hot shard | Reverse bits, or hash for the shard key |
| Clock rollback | Ordering breaks silently | Detect and refuse; alert |

## 8 · Failure story

- Losing the machine-ID lease means refusing to start rather than risking a collision — fail
  closed, because a duplicate primary key is worse than an unavailable instance.
- A rollback is detected by comparing against the last emitted timestamp, and the generator
  waits.
- If the coordinator is down, running instances keep generating; only new instances cannot start.

## Interview soundbite

> "A Snowflake-style 64-bit ID — 41 bits of milliseconds, 10 bits of machine, 12 bits of
> sequence — generated locally so there is no round trip per ID. Machine IDs are leased from
> etcd, and a clock rollback makes the generator wait rather than emit an out-of-order ID."

## Where to go next

- [Sharding](/c/system-design/34-sharding/)
- [URL shortener](/c/system-design/60-url-shortener/)
- [Distributed locks](/c/system-design/21-distributed-locks/)
