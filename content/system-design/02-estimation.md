---
section: "2"
title: "Back-of-the-envelope maths"
kicker: "Getting started"
abstract: "The arithmetic worth being able to do in your head: DAU to QPS, payload to storage, and the order-of-magnitude latency table that justifies a design choice in one sentence."
time: "4 min"
order: 2
---

You are not being tested on precision. You are being tested on whether numbers influence
your design. Two decimal places of accuracy buys nothing; the right power of ten buys
everything.

## The one conversion to memorise

```
1 day ≈ 86,400 seconds ≈ 10^5 seconds
```

That single approximation turns any daily volume into a rate: **divide daily events by
100,000 and you have average QPS.** Then multiply by a peak factor of 2–5.

| Daily events | Average QPS | Peak at 3× |
| --- | --- | --- |
| 1 million | 10 | 30 |
| 10 million | 100 | 300 |
| 100 million | 1,000 | 3,000 |
| 1 billion | 10,000 | 30,000 |
| 10 billion | 100,000 | 300,000 |

:::note[Peak factor]
Consumer traffic peaks 2–5× average; B2B traffic is flatter; anything with a
scheduled event (ticket sales, exam results, a cricket final) can spike 10–100×.
Saying "and I'd size for a 10× spike because this is a ticketing flow" is a free
point.
:::

## Worked example: a photo-sharing service

Assume 20 million daily active users, each uploading 2 photos and viewing 50.

**Writes.** 40M uploads/day ÷ 10⁵ ≈ 400 write QPS average, ~1,200 at peak.

**Reads.** 1B views/day ÷ 10⁵ ≈ 10,000 read QPS average, ~30,000 at peak.

**Storage.** A photo is ~2 MB after compression, plus 10% for thumbnails.

```
40,000,000 uploads × 2 MB × 1.1 ≈ 88 TB per day
```

88 TB a day is 32 PB a year. That number immediately rules out block storage and makes
object storage non-negotiable. It also tells you the CDN is not an optimisation, it is
the only way the egress bill and the latency both work.

**Bandwidth.** 10,000 read QPS × 2 MB ≈ 20 GB/s at average, 60 GB/s at peak. Again: CDN,
and now you know why.

## Worked example: a text feed

Assume 10 million DAU, 20 feed reads and 2 posts each per day, 1 KB per post.

- Reads: 200M/day → 2,000 QPS average → 6,000 at peak.
- Writes: 20M/day → 200 QPS average.
- Storage: 20 GB/day → 7.3 TB/year, plus indexes.

7 TB a year fits comfortably on one well-indexed relational primary for years, and 200
write QPS is nothing. The bottleneck is the 6,000 read QPS of feed assembly, which is a
cache-and-fan-out problem. **Conclusion: do not shard.** Being able to say that, with the
numbers, is worth more than a sharded design you cannot justify.

## Latency numbers

Order-of-magnitude figures from the widely circulated "latency numbers every programmer
should know". Use them to justify choices, not to benchmark.

| Operation | Approximate latency | What it implies |
| --- | --- | --- |
| L1 cache reference | ~1 ns | — |
| Main memory reference | ~100 ns | In-process caches are effectively free. |
| Compress 1 KB | ~2 µs | Compressing responses is usually cheaper than the network. |
| SSD random read | ~100 µs | Still 1,000× memory; keep hot data in RAM. |
| Read 1 MB sequentially from memory | ~250 µs | — |
| Round trip within a datacenter | ~0.5 ms | A fan-out of 100 sequential calls costs 50 ms. |
| Read 1 MB sequentially from SSD | ~1 ms | — |
| Disk seek (spinning) | ~10 ms | Never put a seek on a request path. |
| Round trip India ↔ Europe | ~120–150 ms | Cross-region calls belong off the request path. |
| Round trip India ↔ US East | ~200–250 ms | Same. |

The two that matter most in interviews: **0.5 ms within a datacenter** (so a hundred
sequential service calls is a latency bug, not a scale problem) and **~150 ms across
regions** (so synchronous cross-region writes cost real user-visible time).

## Storage and capacity rules of thumb

- One modern server can hold roughly 256 GB–1 TB of RAM, and serve a few hundred thousand
  simple reads per second from it.
- A single relational primary handles low thousands of write transactions per second
  comfortably; beyond that, batch, then queue, then shard.
- A node of a key-value store handles tens of thousands of operations per second if the
  working set is in memory.
- SSD-backed nodes hold 1–10 TB each; plan a shard so that a node at 70% full still has
  headroom for compaction and a replica rebuild.
- Network egress is usually the surprise cost in media systems, not storage.

## Availability arithmetic

Nines are multiplicative across dependencies in series:

| Availability | Downtime per year | Downtime per month |
| --- | --- | --- |
| 99% | 3.65 days | 7.2 hours |
| 99.9% | 8.8 hours | 43 minutes |
| 99.95% | 4.4 hours | 22 minutes |
| 99.99% | 53 minutes | 4.3 minutes |
| 99.999% | 5.3 minutes | 26 seconds |

If a request path crosses five services at 99.9% each, the path is 99.5% — about 1.8 days
of downtime a year, before any of them are actually broken. This is the arithmetic behind
redundancy, retries, and graceful degradation, and it is worth doing out loud in an
interview.

## Powers of two, for storage

| Power | Value | Name |
| --- | --- | --- |
| 2¹⁰ | 1,024 | 1 KB |
| 2²⁰ | ~10⁶ | 1 MB |
| 2³⁰ | ~10⁹ | 1 GB |
| 2⁴⁰ | ~10¹² | 1 TB |
| 2⁵⁰ | ~10¹⁵ | 1 PB |

Good enough: treat 1 KB as 10³ bytes, 1 TB as 10¹². The error is under 10%, which never
changes a design decision.
