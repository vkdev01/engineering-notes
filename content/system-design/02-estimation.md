---
section: "2"
title: "Back-of-the-envelope maths"
kicker: "Getting started"
abstract: "Turn daily volumes into peak QPS, storage, bandwidth, server counts and path availability with arithmetic you can do aloud — and derive the numbers for the three running examples the rest of the course reuses."
time: "18 min"
order: 2
outcomes:
  - "Convert daily events to average and peak QPS, and justify the peak factor from the shape of a day"
  - "Size storage, bandwidth and server count for the feed, photo and checkout examples"
  - "Compute in-flight requests with Little's law and explain why servers run at about 60% utilisation"
  - "Compute the availability of a request path and the error budget it leaves"
---

An interviewer says "design a feed for 10 million daily users". Before any box is drawn, four questions decide the architecture: how many requests per second at peak, how many bytes per day, how much bandwidth, and how many things must all be up for a request to succeed. This section derives each one from first principles, then pins down the three running examples — the **Pulse** feed, the **photo service** and **checkout** — whose numbers every later section reuses.

:::key[First principle]
Every capacity number is a rate times a size: events per second × bytes per event, requests per second × seconds per request. Get the power of ten right and the design follows; precision beyond one significant figure never changes a decision.
:::

## 2.1 From daily volume to a rate

A day has 86,400 seconds. Round it to \(10^5\) and any daily count becomes an average rate by deleting five zeros:

$$
\bar\lambda = \frac{N_\text{day}}{86{,}400\ \text{s}} \approx \frac{N_\text{day}}{10^5\ \text{s}}
$$

The shortcut undershoots the exact average by a factor of \(86{,}400/10^5 = 0.864\) (the true average is 1.157× the shortcut). Three times the *rounded* average is therefore \(3 \times 0.864 = 2.59\) times the *exact* average. The rounding and the peak factor partly cancel, and §2.2 shows that about 2.6× the true mean is the right capacity for a single-region consumer app.

| Daily events | Average QPS (÷10⁵) | Exact average | Peak at 3× |
| ---: | ---: | ---: | ---: |
| 1 million | 10 | 12 | 30 |
| 10 million | 100 | 116 | 300 |
| 100 million | 1,000 | 1,157 | 3,000 |
| 1 billion | 10,000 | 11,574 | 30,000 |
| 10 billion | 100,000 | 115,741 | 300,000 |

:::example[Worked example · Pulse and the photo service]
**Pulse** — 10M DAU, 20 feed reads and 2 posts per user per day:

- Reads: \(10^7 \times 20 = 2 \times 10^8\)/day → 2,000 QPS average (exact 2,315) → **6,000 peak**.
- Writes: \(10^7 \times 2 = 2 \times 10^7\)/day → **200 QPS** average (exact 231) → 600 peak.

**Photo service** — 20M DAU, 50 views and 2 uploads per user per day:

- Views: \(2 \times 10^7 \times 50 = 10^9\)/day → 10,000 QPS average → **30,000 peak**.
- Uploads: \(4 \times 10^7\)/day → **400 QPS** average → 1,200 peak.

Read-to-write ratio is 10:1 for Pulse and 25:1 for photos. Both are read-heavy, which already points at caches and replicas before sharding.
:::

## 2.2 Peak: where the factor of three comes from

Users sleep, eat lunch and scroll in the evening, so traffic is a curve, not a constant. The peak factor is the ratio of that curve's maximum to its mean. The script below builds an illustrative single-region day for Pulse (night trough, morning, lunch and a dominant evening peak), scales it to Pulse's exact read average, and compares it with the same users spread across three regions eight hours apart.

```python run
import numpy as np


def bump(h, centre, width):
    d = np.minimum(abs(h - centre), 24 - abs(h - centre))   # distance on a 24-hour clock
    return np.exp(-0.5 * (d / width) ** 2)


def shape(h):
    """Illustrative single-region consumer day: night trough, morning, lunch and evening peaks."""
    return 0.12 + 0.25 * bump(h, 9, 1.5) + 0.45 * bump(h, 13, 2.5) + 1.0 * bump(h, 21, 2.2)


AVG = 200e6 / 86_400                       # Pulse feed reads, exact average QPS
minutes = np.arange(0, 24, 1 / 60)
one = shape(minutes) / shape(minutes).mean() * AVG

# Same users split across three regions 8 hours apart (50% / 30% / 20%)
mix = sum(w * shape((minutes + 8 * k) % 24) for k, w in enumerate((0.5, 0.3, 0.2)))
three = mix / mix.mean() * AVG

for name, q in (("one region", one), ("three regions", three)):
    print(f"{name:13s} avg {q.mean():,.0f}  peak {q.max():,.0f} ({q.max() / AVG:.2f}x)"
          f"  trough {q.min():,.0f} ({q.min() / AVG:.2f}x)")

hourly = one.reshape(24, 60).mean(axis=1)
print(f"busiest 4 hours carry {np.sort(hourly)[-4:].sum() / hourly.sum():.0%} of the day's reads")

# Second-to-second noise at the peak: Poisson arrivals for one hour
rng = np.random.default_rng(2)
per_sec = rng.poisson(one.max(), 3_600)
print(f"peak hour: busiest second {per_sec.max():,} vs mean {one.max():,.0f}"
      f" (+{per_sec.max() / one.max() - 1:.1%}; sd = sqrt(rate) = {np.sqrt(one.max()):.0f})")
print(f"3x the rounded average (6,000) leaves {6_000 / one.max() - 1:.0%} headroom over this peak")
```

```output
one region    avg 2,315  peak 5,132 (2.22x)  trough 580 (0.25x)
three regions avg 2,315  peak 3,274 (1.41x)  trough 1,711 (0.74x)
busiest 4 hours carry 33% of the day's reads
peak hour: busiest second 5,368 vs mean 5,132 (+4.6%; sd = sqrt(rate) = 72)
3x the rounded average (6,000) leaves 17% headroom over this peak
```

:::chart[Pulse feed reads over an illustrative day: the evening peak, not the average, sizes the fleet]{type="line" x="hour of day" y="feed reads per second" xmin="0" xmax="24" ymin="0" yfmt="int" hmarks="2315:exact average;6000:sized peak (3 × 2,000)" dash="three regions"}
hour, one region, three regions
0, 2352, 2078
1, 1424, 1790
2, 894, 1713
3, 660, 1821
4, 585, 2016
5, 600, 2119
6, 745, 2051
7, 1134, 1928
8, 1742, 1910
9, 2263, 2015
10, 2465, 2200
11, 2512, 2494
12, 2603, 2832
13, 2644, 2981
14, 2481, 2791
15, 2153, 2375
16, 1895, 2002
17, 1996, 1878
18, 2631, 2077
19, 3688, 2544
20, 4711, 3052
21, 5132, 3274
22, 4674, 3057
23, 3573, 2557
24, 2352, 2078
:::

Three things to take from the simulation:

- **The day's shape gives about 2×, not 3×.** One region peaks at 2.2× its mean; the 3× rule on the rounded average (6,000) leaves 17% headroom for a busier-than-usual day. Spreading users over time zones flattens the curve to 1.4×.
- **Random noise is small at scale.** Poisson arrivals have standard deviation \(\sqrt{\lambda}\): 72 on 5,132 QPS, so the busiest second of the peak hour is only 4.6% above the mean. At 10 QPS the same noise is \(\sqrt{10} \approx 3\), or 32% — small services need proportionally more headroom.
- **Scheduled events break the rule.** Checkout runs at 50 orders/s and peaks at 2,000 during a flash sale: **40×**. Ticket releases, exam results and sporting finals behave the same way. Size those from the event (expected buyers ÷ seconds the sale stays open), not from the daily average.

| Traffic type | Peak ÷ average | How to get the number |
| --- | ---: | --- |
| Single-region consumer app | ≈ 2–3 | Diurnal shape (above: 2.2) plus headroom |
| Global consumer app | ≈ 1.5 | Overlapping regions (above: 1.4) |
| B2B, business hours only | ≈ 3 | 24 h ÷ ~8 working hours, flat within them |
| Scheduled event (flash sale) | 10–100 | Buyers ÷ sale duration; checkout: 40 |

## 2.3 Storage: size × count × copies × time

$$
S = \underbrace{N_\text{writes/day} \cdot b}_{\text{raw bytes/day}} \cdot (1 + o_\text{idx}) \cdot k_\text{copies} \cdot T_\text{days}
$$

where $b$ is bytes per record, $o_\text{idx}$ the index overhead, $k_\text{copies}$ the replication (or erasure-coding) factor and $T$ the retention.

:::example[Worked example · Pulse posts]
- Raw: \(2 \times 10^7\) posts/day × 1 KB = **20 GB/day** → × 365 = **7.3 TB/year**.
- Indexes (author + time, post id): assume +30% (illustrative; measure yours) → 9.5 TB/year per copy.
- Three replicas: 28.5 TB/year of disk across the fleet, but each node holds one copy: 9.5 TB/year.
- **Hot set**: feeds mostly show the last few days. Ten days of posts is 10 × 20 GB = **200 GB** — it fits in the RAM of a small cache cluster.
:::

Is 9.5 TB a year "too big for one machine"? Take an illustrative database node with ~30 TB of NVMe, kept below 70% full so compaction, backups and a replica rebuild have room: 21 TB usable.

:::chart[Pulse posts per database node: tiering old posts keeps one primary viable indefinitely]{type="line" x="years since launch" y="TB per node (incl. +30% indexes)" ymin="0" yfmt="int" unit=" TB" hmarks="21:illustrative node, 70% full" dash="primary keeps 12 months"}
year, all posts on primary, primary keeps 12 months
0, 0.0, 0.0
0.5, 4.7, 4.7
1, 9.5, 9.5
1.5, 14.2, 9.5
2, 19.0, 9.5
2.5, 23.7, 9.5
3, 28.5, 9.5
3.5, 33.2, 9.5
4, 38.0, 9.5
4.5, 42.7, 9.5
5, 47.5, 9.5
:::

Keeping every post on the primary crosses 21 TB after \(21 / 9.5 = 2.2\) years. Moving posts older than a year to object storage (read rarely, by id) caps the primary at 9.5 TB forever. With 600 peak write QPS — far below what one relational primary sustains — **Pulse does not need sharding**; it needs tiering, a cache and read replicas.

:::example[Worked example · the photo service]
- Raw: \(4 \times 10^7\) uploads × 2 MB × 1.1 (thumbnails) = **88 TB/day** → 32 PB/year.
- Three full replicas: 96 PB/year. Erasure coding at 1.5× overhead (e.g. 6 data + 3 parity fragments): 48 PB/year.
- At 21 TB usable per node that is ~2,300 nodes for each year of uploads, even with erasure coding. This is object storage's job, not a database's: [object storage](/c/system-design/26-object-storage).
:::

For unit conversions, treat 1 KB as 10³ B. The binary prefixes drift further from decimal at each step, but stay inside the error you already accept:

| Power of two | Value | Decimal shortcut | Shortcut error |
| --- | --- | --- | ---: |
| 2¹⁰ | 1,024 | 10³ (KB) | 2.4% |
| 2²⁰ | 1,048,576 | 10⁶ (MB) | 4.9% |
| 2³⁰ | ≈ 1.07 × 10⁹ | 10⁹ (GB) | 7.4% |
| 2⁴⁰ | ≈ 1.10 × 10¹² | 10¹² (TB) | 10.0% |
| 2⁵⁰ | ≈ 1.13 × 10¹⁵ | 10¹⁵ (PB) | 12.6% |

## 2.4 Bandwidth: requests × payload

$$
B = \lambda \cdot b_\text{response}, \qquad \text{bits/s} = 8 \times \text{bytes/s}
$$

- **Pulse**: a feed page is 20 posts × 1 KB = 20 KB. 2,000 QPS × 20 KB = **40 MB/s** average (0.3 Gbit/s), 120 MB/s at peak ≈ 1 Gbit/s. One server's network card handles it; bandwidth is not Pulse's problem.
- **Photo service**: 10,000 views/s × 2 MB = **20 GB/s** = 160 Gbit/s average, 60 GB/s = 480 Gbit/s at peak. With illustrative 25 Gbit/s server NICs that is 20 NICs running flat out for egress alone. Ingress is small by comparison: 88 TB/day ÷ 86,400 s ≈ 1 GB/s.

:::example[Worked example · the egress bill]
20 GB/s × 86,400 s × 30 days ≈ 52 PB/month. At an illustrative USD 0.02 per GB, that is about USD 1.0 million a month — before storage. Serving from a [CDN](/c/system-design/19-cdn) with a high hit rate is what makes both the latency and the bill work.
:::

:::warn[Bits versus bytes]
Network links are quoted in bits per second, storage and payloads in bytes. Mixing them is an 8× error — larger than every other approximation in this section combined. Write the unit on every line.
:::

## 2.5 Servers, utilisation and concurrency

The fleet must carry the peak with headroom, and survive losing an instance during a deploy:

$$
n = \left\lceil \frac{\lambda_\text{peak}}{\mu_\text{server} \cdot \rho_\text{target}} \right\rceil + n_\text{spare}
$$

where $\mu_\text{server}$ is one server's maximum throughput (measure it with a load test) and $\rho_\text{target}$ the utilisation you are willing to run at. Why not run at 95%? Queueing. In the simplest model (M/M/1: random arrivals, one server, mean service time $S$) the mean response time and its 99th percentile are

$$
W = \frac{S}{1-\rho}, \qquad W_{p99} = \ln(100)\,\frac{S}{1-\rho} \approx \frac{4.6\,S}{1-\rho}
$$

Latency doubles from 50% to 75% utilisation and doubles again by 87.5%. Around 60% the curve is still shallow; beyond 80% small traffic changes cause large latency changes. The derivation and multi-server versions are in [latency and throughput](/c/system-design/10-latency-and-throughput).

:::chart[Response time in multiples of service time S (M/M/1): the hockey stick behind the 60% rule]{type="line" x="utilisation ρ" y="response time ÷ S" xfmt="pct" ymin="0" ymax="100" marks="0.6:target 60%;0.8:danger zone" dash="p99"}
rho, mean, p99
0.1, 1.11, 5.12
0.2, 1.25, 5.76
0.3, 1.43, 6.58
0.4, 1.67, 7.68
0.5, 2.00, 9.21
0.6, 2.50, 11.51
0.65, 2.86, 13.16
0.7, 3.33, 15.35
0.75, 4.00, 18.42
0.8, 5.00, 23.03
0.85, 6.67, 30.70
0.9, 10.00, 46.05
0.92, 12.50, 57.56
0.94, 16.67, 76.75
0.95, 20.00, 92.10
:::

**Little's law** gives the other half of capacity — how many requests are in flight at once, which sizes thread pools, connection pools and memory:

$$
L = \lambda W
$$

:::example[Worked example · servers and in-flight requests]
**Pulse feed service.** Peak 6,000 QPS; assume one server handles 1,000 QPS at saturation (illustrative). At 60%: \(\lceil 6{,}000 / 600 \rceil = 10\), plus 2 spares (one in deploy, one failed) = **12 servers**. That is the first-pass answer; sizing so the fleet survives losing a whole zone raises it to 15, 5 per zone ([§10.4](/c/system-design/10-latency-and-throughput), [§13.5](/c/system-design/13-scalability)), the figure later sections use.

**Checkout payment calls.** At the 2,000 orders/s flash peak, with the provider at its p50 of 300 ms: \(L = 2{,}000 \times 0.3 = 600\) calls in flight. If the provider degrades so that every call takes its p99 of 2 s: \(L = 2{,}000 \times 2 = 4{,}000\). The arrival rate did not change, yet concurrency rose 6.7× — enough to exhaust a pool sized for 600 and stall every other request on the same workers. That is the arithmetic behind timeouts and [circuit breakers](/c/system-design/38-one-service-failing-breaker).
:::

## 2.6 The estimator for the running examples

The whole method in one script. Change an input and every derived number follows — which is how you should handle "what if it's 10× bigger?" in an interview.

```python run
import math

DAY, YEAR, PEAK = 86_400, 365, 3          # seconds/day, days/year, peak-to-average factor


def human(b):
    for unit, k in (("PB", 1e15), ("TB", 1e12), ("GB", 1e9), ("MB", 1e6), ("KB", 1e3)):
        if b >= k:
            return f"{b / k:,.1f} {unit}"
    return f"{b:,.0f} B"


def servers(peak_qps, per_server_qps, target_util=0.6, spare=2):
    """Instances to hold peak at the target utilisation, plus spares for a deploy and a failure."""
    return math.ceil(peak_qps / (per_server_qps * target_util)) + spare


def app(name, dau, reads_pp, writes_pp, write_bytes, read_bytes):
    reads, writes = dau * reads_pp, dau * writes_pp
    r, w = reads / 1e5, writes / 1e5      # the 10^5 s/day shortcut
    stored = writes * write_bytes         # bytes/day, one copy
    print(f"== {name}")
    print(f"  reads  {reads:>13,.0f}/day -> avg {r:>7,.0f} QPS (exact {reads / DAY:,.0f}), peak {PEAK * r:,.0f}")
    print(f"  writes {writes:>13,.0f}/day -> avg {w:>7,.0f} QPS (exact {writes / DAY:,.0f}), peak {PEAK * w:,.0f}")
    print(f"  storage {human(stored)}/day, {human(stored * YEAR)}/yr (x3 replicas {human(3 * stored * YEAR)})")
    print(f"  ingress {human(stored / DAY)}/s; egress avg {human(r * read_bytes)}/s"
          f" = {r * read_bytes * 8 / 1e9:,.1f} Gbit/s, peak {human(PEAK * r * read_bytes)}/s")
    return PEAK * r


# Pulse: 10M DAU, 20 feed reads + 2 posts each; a post is 1 KB, a feed page is 20 posts
peak = app("Pulse feed", 10e6, 20, 2, 1e3, 20 * 1e3)
print(f"  feed servers at an illustrative 1,000 QPS each: {servers(peak, 1_000)}")

# Photo service: 20M DAU, 50 views + 2 uploads; 2 MB photo + 10% thumbnails stored, 2 MB served
app("Photo service", 20e6, 50, 2, 2e6 * 1.1, 2e6)

# Checkout: rates are given per second, not per day
steady, flash, writes_per_order = 50, 2_000, 4   # inventory, order row, 2 ledger entries
print("== Checkout")
print(f"  flash/steady = {flash / steady:.0f}x; DB writes at peak {flash * writes_per_order:,}/s")
for label, w_s in (("p50 300 ms", 0.3), ("p99 2 s", 2.0)):
    print(f"  in-flight payment calls if every call takes {label}: L = {flash} x {w_s} = {flash * w_s:,.0f}")
print(f"  orders/day at steady rate: {steady * DAY:,}")
```

```output
== Pulse feed
  reads    200,000,000/day -> avg   2,000 QPS (exact 2,315), peak 6,000
  writes    20,000,000/day -> avg     200 QPS (exact 231), peak 600
  storage 20.0 GB/day, 7.3 TB/yr (x3 replicas 21.9 TB)
  ingress 231.5 KB/s; egress avg 40.0 MB/s = 0.3 Gbit/s, peak 120.0 MB/s
  feed servers at an illustrative 1,000 QPS each: 12
== Photo service
  reads  1,000,000,000/day -> avg  10,000 QPS (exact 11,574), peak 30,000
  writes    40,000,000/day -> avg     400 QPS (exact 463), peak 1,200
  storage 88.0 TB/day, 32.1 PB/yr (x3 replicas 96.4 PB)
  ingress 1.0 GB/s; egress avg 20.0 GB/s = 160.0 Gbit/s, peak 60.0 GB/s
== Checkout
  flash/steady = 40x; DB writes at peak 8,000/s
  in-flight payment calls if every call takes p50 300 ms: L = 2000 x 0.3 = 600
  in-flight payment calls if every call takes p99 2 s: L = 2000 x 2.0 = 4,000
  orders/day at steady rate: 4,320,000
```

These are the course's reference numbers. When a later section needs a new one, it derives it from this table:

| Running example | Average | Peak | Storage | Bandwidth | What the numbers decide |
| --- | ---: | ---: | --- | --- | --- |
| **Pulse feed** (10M DAU) | 2,000 read / 200 write QPS | 6,000 / 600 | 20 GB/day, 7.3 TB/yr | 40 MB/s | Cache + replicas; tier old posts; don't shard yet |
| **Photo service** (20M DAU) | 10,000 read / 400 write QPS | 30,000 / 1,200 | 88 TB/day | 20 GB/s out | Object storage + CDN; egress dominates cost |
| **Checkout** (flash sale) | 50 orders/s | 2,000 orders/s (40×) | 4 writes/order | — | Queue the spike, idempotency, timeouts, breaker |

## 2.7 Latency numbers and round-trip counting

Order-of-magnitude figures from the widely circulated "latency numbers every programmer should know". Use them to count, not to benchmark.

| Operation | ≈ Latency | What it implies |
| --- | ---: | --- |
| L1 cache reference | 1 ns | — |
| Main memory reference | 100 ns | In-process caches are effectively free |
| Compress 1 KB | 2 µs | Compressing responses is cheaper than the network |
| SSD random read | 100 µs | 1,000× RAM; keep hot data in memory |
| Read 1 MB sequentially from memory | 250 µs | — |
| Round trip within a datacenter | 0.5 ms | 100 sequential calls cost 50 ms |
| Read 1 MB sequentially from SSD | 1 ms | — |
| Disk seek (spinning) | 10 ms | Never on a request path |
| Cross-region round trip | 150 ms | Synchronous cross-region writes are user-visible |

The method is to count round trips on the critical path and multiply:

$$
T_\text{path} \approx \sum_{\text{sequential steps}} \text{RTT}_i \quad\text{vs.}\quad T_\text{parallel} \approx \max_i \text{RTT}_i
$$

:::example[Worked example · assembling a Pulse feed page]
A page shows 20 posts held in the cache. Fetching them one by one costs 20 × 0.5 ms = **10 ms** of round trips; one multi-get costs ~**0.5 ms**. Neither matters next to a 150 ms cross-region hop, which is why a synchronous write to a replica in another region costs more than the whole read path. Fan-out has a second cost — the slowest of $N$ parallel calls sets the latency — derived in [latency and throughput](/c/system-design/10-latency-and-throughput).
:::

## 2.8 Availability arithmetic

A request that needs every component in a chain succeeds only if all of them are up; redundant copies fail only if all of them fail. With independent failures:

$$
A_\text{series} = \prod_{i=1}^{N} A_i, \qquad A_\text{parallel} = 1 - \prod_{i=1}^{N} (1 - A_i)
$$

| Availability | Downtime per year | Downtime per 30 days |
| ---: | ---: | ---: |
| 99% | 3.65 days | 7.2 h |
| 99.9% | 8.8 h | 43.2 min |
| 99.95% | 4.4 h | 21.6 min |
| 99.99% | 53 min | 4.3 min |
| 99.999% | 5.3 min | 26 s |

:::chart[Path availability vs number of dependencies in series: nines decay linearly; redundancy restores them]{type="line" x="dependencies on the request path" y="path availability" ymin="97" ymax="100" unit="%" hmarks="99.9:99.9% SLO" dash="99.9% redundant pairs"}
N, 99.99% each, 99.95% each, 99.9% each, 99.9% redundant pairs
1, 99.990, 99.950, 99.900, 99.9999
2, 99.980, 99.900, 99.800, 99.9998
3, 99.970, 99.850, 99.700, 99.9997
4, 99.960, 99.800, 99.601, 99.9996
5, 99.950, 99.750, 99.501, 99.9995
6, 99.940, 99.700, 99.401, 99.9994
8, 99.920, 99.601, 99.203, 99.9992
10, 99.900, 99.501, 99.004, 99.9990
12, 99.880, 99.402, 98.807, 99.9988
15, 99.850, 99.253, 98.510, 99.9985
20, 99.800, 99.005, 98.019, 99.9980
25, 99.750, 98.757, 97.530, 99.9975
30, 99.700, 98.511, 97.043, 99.9970
:::

For small unavailabilities $u_i = 1 - A_i$, $\prod A_i \approx 1 - \sum u_i$: **downtime adds up**. Five dependencies at 99.9% give 99.5% — 43.7 hours a year (1.8 days) with nothing actually broken beyond each component's normal budget. Apply it to checkout, with illustrative per-component figures:

```python run
from math import prod


def series(*a):
    """All must be up: availabilities multiply."""
    return prod(a)


def parallel(*a):
    """Any one up is enough (independent failures): unavailabilities multiply."""
    return 1 - prod(1 - x for x in a)


def downtime(a):
    return f"{(1 - a) * 365 * 24:6.1f} h/yr = {(1 - a) * 30 * 24 * 60:6.1f} min per 30 days"


# Checkout path, illustrative per-component availabilities
lb = 0.9999
api = parallel(0.999, 0.999, 0.999)         # three stateless instances
inventory = 0.9995                          # primary DB with automated failover
payment = 0.999                             # external provider's stated SLA
ledger = 0.9995

path = series(lb, api, inventory, payment, ledger)
print(f"checkout path      {path:.5f}  {downtime(path)}")
print(f"payment alone      {payment:.5f}  {downtime(payment)}")
print(f"5 deps at 99.9%    {series(*[0.999] * 5):.5f}  {downtime(series(*[0.999] * 5))}")

# Two independent payment providers with failover
path2 = series(lb, api, inventory, parallel(payment, 0.999), ledger)
print(f"with 2nd provider  {path2:.5f}  {downtime(path2)}")

# Error budget: a 99.9% monthly SLO on the checkout path
budget_min = (1 - 0.999) * 30 * 24 * 60
print(f"\n99.9% SLO budget: {budget_min:.1f} min/30 days; "
      f"one 15-min bad deploy spends {15 / budget_min:.0%} of it")
```

```output
checkout path      0.99790    18.4 h/yr =   90.7 min per 30 days
payment alone      0.99900     8.8 h/yr =   43.2 min per 30 days
5 deps at 99.9%    0.99501    43.7 h/yr =  215.6 min per 30 days
with 2nd provider  0.99890     9.6 h/yr =   47.5 min per 30 days

99.9% SLO budget: 43.2 min/30 days; one 15-min bad deploy spends 35% of it
```

The checkout path comes out at 99.79% — **you cannot promise 99.9% end to end when one hard dependency is itself 99.9%**. Three replicated API instances contribute almost nothing to the downtime; the payment provider and the two databases dominate. A second provider with failover lifts the path to 99.89%, still just short: the remaining budget is spent by the databases. Either relax the SLO, make the databases more available, or take the payment call off the synchronous path (accept the order, charge asynchronously). The budget is also small in absolute terms: one 15-minute bad deploy spends 35% of a 99.9% month. Error budgets and SLOs are developed in [availability](/c/system-design/06-availability).

:::warn[Independence is the assumption that fails]
The parallel formula assumes replicas fail independently. Two replicas in the same rack, behind the same bad config push, or depending on the same DNS provider fail together, and the "99.9999%" pair behaves like a single 99.9% component. Count shared dependencies as their own series term.
:::

## 2.9 Rules of thumb and failure modes

| Rule | Number | Where it comes from |
| --- | --- | --- |
| Daily → average rate | ÷ 10⁵ | 86,400 s ≈ 10⁵ s (−14%) |
| Average → peak | × 3 consumer, × 1.5 global, event-specific for sales | Diurnal shape: 2.2× (§2.2) |
| Target utilisation | ≈ 60% | Latency 2.5× S at 60%, 5× at 80% (M/M/1) |
| Spares | N + 2 | One instance deploying, one failed |
| Disk fill | ≤ 70% | Room for compaction, backups, rebuilds |
| Serial nines | Add downtimes | \(1 - \prod A_i \approx \sum u_i\) |
| Bits ↔ bytes | × 8 | Links in bits, payloads in bytes |

:::warn[Estimation mistakes that change the design]
- **Sizing for the average.** Pulse at 2,315 QPS needs half the fleet that 6,000 does — and falls over every evening.
- **Forgetting copies and indexes.** 7.3 TB of posts is 28.5 TB of disk once you add 30% indexes and three replicas.
- **Using the median for concurrency.** Little's law with p50 latency gave 600 in-flight payment calls; a slow provider makes it 4,000.
- **Estimating and then ignoring it.** If the numbers say 600 write QPS, a sharded design needs a reason other than write load.
:::

## 2.10 Check yourself

:::qa[A messaging app has 50M DAU sending 40 messages each per day. What are the average and peak write QPS?]
\(5 \times 10^7 \times 40 = 2 \times 10^9\) messages/day ÷ 10⁵ = **20,000 QPS** average (exact 23,148). At 3×, **60,000 peak**. At 60,000 writes/s, a single primary is no longer plausible; this is where partitioning enters.
:::

:::qa[Pulse grows to 100M DAU with the same behaviour. Does the "don't shard" conclusion survive?]
Everything scales 10×: 60,000 peak reads, 6,000 peak writes, 200 GB/day = 73 TB/year (95 TB with indexes). Reads are still a cache problem, but 6,000 writes/s and a year of posts at 95 TB exceed one node (21 TB usable in §2.3) even with tiering. Now partition the posts — by author id — and keep the cache in front.
:::

:::qa[A service handles 400 QPS with mean latency 50 ms. How many requests are in flight, and how many worker threads does it need?]
\(L = 400 \times 0.05 = 20\) in flight on average. Size the pool for the tail and for slowdowns, not the mean: if latency can rise to 250 ms under a slow dependency, \(L = 100\). A pool of ~100 with a 250 ms timeout keeps the slow case bounded.
:::

:::qa[A request path has 8 services at 99.95%. What is the path availability and monthly downtime? What one change helps most?]
\(0.9995^8 = 0.9960\): 99.60%, about \(8 \times 21.6 = 173\) minutes per 30 days. The biggest lever is removing services from the synchronous path (cache, async calls) — each one removed saves 21.6 minutes a month. Making any single service redundant helps only if its own failures dominate.
:::

:::qa[The photo service's CDN hit rate drops from 95% to 80%. What happens to origin egress?]
Origin serves the misses: \((1 - h) \times 20\) GB/s. At 95%, 1 GB/s; at 80%, 4 GB/s — **4× the origin load** from a 15-point drop. Hit rate is the number to alert on for a media origin.
:::

Next: [§3 How to use this guide](/c/system-design/03-how-to-use) — the page shapes, conventions and reading paths.
