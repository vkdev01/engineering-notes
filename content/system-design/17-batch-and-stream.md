---
section: "17"
title: "Batch and stream processing"
kicker: "Building blocks"
abstract: "Batch computes over a bounded input you can rerun; stream computes over an unbounded input as it arrives. Stream results trade freshness against completeness through allowed lateness, throughput is capped by partitions and the hottest key, and recovery time is backlog divided by spare capacity."
time: "13 min"
order: 17
outcomes:
  - "Choose batch, stream or both from a freshness requirement and a correctness requirement"
  - "Pick an allowed lateness from an event-delay distribution and quantify what it drops"
  - "Size partition and consumer counts from peak event rate, and detect when one hot key caps the pipeline"
  - "Compute catch-up time after an outage and backfill time for reprocessing"
---

Every Pulse feed read shows ~20 posts, and the app reports each one as an **impression**: 200M feed reads a day × 20 = 4B impressions a day, ≈ 40,000/s on average and 120,000/s at peak (1 day ≈ 10⁵ s, 3× peak, [§2](/c/system-design/02-estimation)). Two products want them. Ranking wants "impressions per post over the last few minutes", fresh within a minute, to spot trending posts. Creator analytics wants "impressions per post per day", exact, on an invoice-grade report. The first is a stream problem, the second a batch problem — and the interesting engineering is in the numbers each one forces: how long to wait for late events, how many partitions, and how long recovery takes.

:::key[First principle]
**Batch** runs over a bounded, stored input: always complete, always late, trivially rerun. **Stream** runs over an unbounded input incrementally: fresh, but it must decide when a window is "done" while some events are still in flight. Stream throughput is set by partitions × per-consumer rate — and by the hottest key, which no partition count can split. Recovery time after any outage is backlog ÷ spare capacity.
:::

## 17.1 Batch and stream, side by side

| | Batch | Stream |
| --- | --- | --- |
| Input | A bounded set: yesterday's files, a table partition | An unbounded log: Kafka topic, CDC feed |
| Freshness | Schedule interval + job runtime (nightly + 2 h job → up to 26 h old) | Processing delay + allowed lateness (seconds to minutes) |
| Completeness | All data present when the job starts | Late events after the window closes are dropped or corrected |
| Reprocessing | Rerun the job | Replay the log (needs retention) or run a batch path |
| Cost profile | Bursty; can use cheap spare capacity | Always on; sized for peak |
| State | Recomputed each run | Kept, checkpointed, restored on failure |
| Typical tools | SQL in a warehouse, Spark, dbt | Kafka Streams, Flink, Spark Structured Streaming |

The volume is modest in bytes. With an illustrative 100-byte impression event, 120,000 events/s is 12 MB/s at peak and 400 GB a day; seven days of retention at replication factor 3 is \(7 \times 400 \times 3\) = 8.4 TB of broker disk. What makes stream processing hard is not bytes but **time** and **skew**.

## 17.2 Windows

An aggregate over an unbounded stream needs a window:

- **Tumbling** — fixed, non-overlapping: impressions per post per minute. Each event updates one window.
- **Sliding (hopping)** — size $W$, advancing every $s$: "last 10 minutes, updated each minute". Each event updates $W/s$ windows (10 here), so state and work are $W/s$ times the tumbling cost.
- **Session** — grouped by an inactivity gap: a user's session ends after 30 minutes idle. Window count depends on behaviour, not the clock.

Windows are defined on **event time** (when the impression happened on the phone), not **processing time** (when it reached the server). Processing time is easy and wrong: a phone that reconnects after an hour would credit its impressions to the wrong minute.

## 17.3 Watermarks and allowed lateness

A **watermark** is the processor's claim "no more events older than $t$ will arrive". A common rule is bounded out-of-orderness: watermark = (largest event time seen) − $L$, where $L$ is the **allowed lateness**. A window $[w, w+60)$ emits its result once the watermark passes $w + 60$; an event that arrives after that is **late**.

$$
\text{result delay} = L, \qquad \text{open windows per key} = \frac{W + L}{W}, \qquad P(\text{late}) \approx P(\text{delay} > L + \text{slack})
$$

where slack is how much of its window remained when the event happened. $L$ trades freshness and state against completeness. The simulation replays six hours of impressions with an illustrative delay distribution: 95% from online phones (median 0.5 s), 5% from phones that were offline (delay exponential, mean 30 minutes).

```python run
import numpy as np

rng = np.random.default_rng(3)
N = 1_000_000                     # impression events over six hours of event time
WINDOW = 60.0                     # tumbling 1-minute windows (event time)

event_t = np.sort(rng.uniform(0, 21600, N))
# Delay from event to arrival (illustrative): 95% online, lognormal median 0.5 s;
# 5% from phones that were offline, exponential with mean 30 minutes.
offline = rng.random(N) < 0.05
delay = np.where(offline, rng.exponential(1800, N), rng.lognormal(np.log(0.5), 1.0, N))
arrive_t = event_t + delay

order = np.argsort(arrive_t)
ev, off = event_t[order], offline[order]
seen_max = np.maximum.accumulate(ev)                 # max event time seen so far
prev_max = np.concatenate(([-np.inf], seen_max[:-1]))
window_end = (np.floor(ev / WINDOW) + 1) * WINDOW

print("delay p50 %.2f s, p99 %.0f s, p99.9 %.0f s" % tuple(np.percentile(delay, [50, 99, 99.9])))
print("lateness L | dropped: all | online | offline | open windows per key")
for L in (1, 5, 30, 120, 600, 1800, 3600):
    watermark = prev_max - L                         # bounded out-of-orderness watermark
    late = window_end <= watermark                   # window already closed when it arrives
    print("%8d s | %10.2f%% | %5.2f%% | %6.1f%% | %8.1f" % (
        L, 100 * late.mean(), 100 * late[~off].mean(), 100 * late[off].mean(),
        (WINDOW + L) / WINDOW))
```

```output
delay p50 0.54 s, p99 2893 s, p99.9 7011 s
lateness L | dropped: all | online | offline | open windows per key
       1 s |       5.22% |  0.37% |   98.0% |      1.0
       5 s |       4.90% |  0.04% |   97.8% |      1.1
      30 s |       4.80% |  0.00% |   96.5% |      1.5
     120 s |       4.54% |  0.00% |   91.4% |      3.0
     600 s |       3.38% |  0.00% |   68.1% |     11.0
    1800 s |       1.64% |  0.00% |   32.9% |     31.0
    3600 s |       0.55% |  0.00% |   11.2% |     61.0
```

:::chart[Events dropped as late vs allowed lateness (1-minute windows, illustrative delays)]{type="line" x="allowed lateness L (s)" y="events dropped" xlog="true" yfmt="pct" points="true" marks="30:L = 30 s"}
L, all events, online phones, offline phones
1, 0.0522, 0.0037, 0.980
5, 0.0490, 0.0004, 0.978
30, 0.0480, 0.0000, 0.965
120, 0.0454, 0.0000, 0.914
600, 0.0338, 0.0000, 0.681
1800, 0.0164, 0.0000, 0.329
3600, 0.0055, 0.0000, 0.112
:::

The delay distribution has two populations, and no single $L$ serves both:

1. **Five seconds of lateness captures essentially all online events** (0.04% dropped). Waiting longer buys nothing for them.
2. **Offline phones need hours.** Even $L$ = 1 h drops 11% of their events and keeps 61 windows open per key — 61× the state of $L$ = 0, and every result an hour stale.

So the design splits: the stream uses $L$ ≈ 30 s and emits a ranking signal that is 95.2% complete and 30 s late; late events go to a side output, and a **batch job** recomputes the exact daily numbers from the stored log for the report. Ranking tolerates 5% missing impressions spread evenly; an invoice does not.

:::tip[Measure the delay distribution before choosing L]
Plot arrival time − event time from a day of logs. The shape — usually a tight online mode plus a long offline tail — decides $L$ directly: set it just past the online mode and route the tail to a correction path.
:::

## 17.4 Partitions: sizing the pipeline

A log is split into partitions; each partition is consumed by exactly one consumer in a group, in order. So **parallelism ≤ partitions**, and per-key ordering holds because a key always hashes to the same partition ([§9.6](/c/system-design/09-delivery-semantics)).

$$
P \ge \max\left(\frac{\text{peak bytes/s}}{\text{per-partition write rate}},\ \frac{\text{peak events/s}}{\text{per-consumer event rate}}\right) \times \text{growth headroom}
$$

:::example[Worked example · partitions for Pulse impressions (rates illustrative)]
Per-partition write rate ~10 MB/s; one consumer instance processes ~5,000 events/s (0.2 ms each: parse, update state, emit).

- Bytes: 12 MB/s ÷ 10 MB/s → 2 partitions.
- Events: 120,000/s ÷ 5,000/s → **24 consumers, so ≥ 24 partitions**.
- Headroom 2× for growth → **48 partitions**, 48 consumers at peak, running at 50%.

Choose generously up front: adding partitions later changes the key → partition mapping, which breaks per-key ordering at the switch and forces stateful consumers to reshuffle their state.
:::

That arithmetic assumes keys spread evenly. Keying impressions by `post_id` — natural, since we count per post — inherits Pulse's Zipf popularity ([§7.1](/c/system-design/07-caching)). With $s$ = 1 over 140M posts, the single most popular post receives $1/H_N \approx 1/19.3$ = 5.2% of all impressions: **6,200 events/s at peak, more than one consumer can process**, whatever the partition count. The block below hashes a Zipf trace into partitions and measures the hottest partition against the mean (scaled to 1M posts, where the top post's share is 6.9%), then computes the recovery numbers of §17.5.

```python run
import numpy as np

rng = np.random.default_rng(8)
POSTS, USERS, EVENTS = 1_000_000, 1_000_000, 2_000_000
p = 1.0 / np.arange(1, POSTS + 1)                    # Zipf s = 1 post popularity
p /= p.sum()
post = rng.choice(POSTS, EVENTS, p=p)
user = rng.integers(0, USERS, EVENTS)
salt = rng.integers(0, 8, EVENTS)
mix = np.uint64(0x9E3779B97F4A7C15)                  # cheap integer hash before modulo


def skew(keys, parts):
    counts = np.bincount((keys.astype(np.uint64) * mix >> np.uint64(40)) % np.uint64(parts),
                         minlength=parts)
    return counts.max() / counts.mean()


salted = np.where(post < 100, post * 8 + salt, post * 8)   # spread the top 100 posts over 8 keys
print("top post share of events: %.1f%%" % (100 * (post == 0).mean()))
print("partitions | max/mean by user_id | by post_id | post_id, top-100 salted x8")
for parts in (8, 16, 24, 48, 96, 192):
    print("%10d | %19.2f | %10.2f | %10.2f" % (
        parts, skew(user, parts), skew(post, parts), skew(salted, parts)))

print("\nCatch-up after a consumer outage: t = t_down * lam / (C - lam)")
C = 48 * 5000                                        # 48 consumers x 5,000 events/s (illustrative)
for lam, label in ((40_000, "average"), (120_000, "peak")):
    print("  1 h outage at %-7s %6d/s: backlog %4.0fM, catch-up %5.0f min" % (
        label, lam, 3600 * lam / 1e6, 3600 * lam / (C - lam) / 60))

print("\nBackfill 30 days of impressions (120B events)")
for name, rate in (("stream cluster spare at avg load", C - 40_000),
                   ("batch: 100 workers x 50k events/s", 100 * 50_000)):
    print("  %-34s %9.0f events/s -> %6.1f h" % (name, rate, 120e9 / rate / 3600))

photos = 40e6 * 365                                  # one year of uploads
for cores in (1000, 5000):
    s = photos * 0.05 / cores                        # 50 ms CPU per resize (illustrative)
    print("  new thumbnail size, %4d cores: %.2f days, reading %.0f GB/s" % (
        cores, s / 86400, photos * 2e6 / s / 1e9))
```

```output
top post share of events: 6.9%
partitions | max/mean by user_id | by post_id | post_id, top-100 salted x8
         8 |                1.00 |       1.45 |       1.06
        16 |                1.01 |       2.05 |       1.15
        24 |                1.01 |       2.47 |       1.17
        48 |                1.01 |       4.09 |       1.39
        96 |                1.02 |       7.28 |       1.83
       192 |                1.03 |      13.90 |       2.71

Catch-up after a consumer outage: t = t_down * lam / (C - lam)
  1 h outage at average  40000/s: backlog  144M, catch-up    12 min
  1 h outage at peak    120000/s: backlog  432M, catch-up    60 min

Backfill 30 days of impressions (120B events)
  stream cluster spare at avg load      200000 events/s ->  166.7 h
  batch: 100 workers x 50k events/s    5000000 events/s ->    6.7 h
  new thumbnail size, 1000 cores: 8.45 days, reading 40 GB/s
  new thumbnail size, 5000 cores: 1.69 days, reading 200 GB/s
```

:::chart[Hottest partition load ÷ mean partition load, by partition key]{type="line" x="partitions" y="max / mean load" xlog="true" ylog="true" points="true" marks="48:Pulse plan"}
partitions, by user_id, by post_id, post_id with top-100 salted ×8
8, 1.00, 1.45, 1.06
16, 1.01, 2.05, 1.15
24, 1.01, 2.47, 1.17
48, 1.01, 4.09, 1.39
96, 1.02, 7.28, 1.83
192, 1.03, 13.90, 2.71
:::

Keyed by `post_id` at 48 partitions, the hottest partition carries 4.09× the mean: \(4.09 \times 120{,}000 / 48\) ≈ 10,200 events/s on a consumer that handles 5,000. That partition lags forever while the other 47 idle at ~50%. **Adding partitions makes the ratio worse**, because the mean shrinks and the hot key doesn't. Three fixes, in order of preference:

1. **Pre-aggregate before the shuffle.** Each upstream task sums counts per post per second and emits `(post_id, count)`; the top post's 6,200 events/s become at most one message per upstream task per second.
2. **Salt the hot keys.** Key the top 100 posts as `post_id#0…7` and merge the eight partial counts downstream: 4.09× → 1.39× at 48 partitions.
3. **Key by something uniform** (`user_id`: 1.01×) when the computation allows it, and re-key only aggregated data.

## 17.5 Catch-up and backfill

Every stream pipeline stops sometimes — a deploy, a crashed consumer group, a broker failover. While it is down, a backlog of $\lambda\, t_{down}$ events builds; afterwards the consumers drain it with only their **spare** capacity $C - \lambda$:

$$
t_{catch\text{-}up} = \frac{\lambda\, t_{down}}{C - \lambda}
$$

With 48 consumers × 5,000 events/s, $C$ = 240,000 events/s. A one-hour outage at average load (40,000/s, backlog 144M) catches up in 12 minutes; the same outage at peak (120,000/s, backlog 432M) takes 60 minutes — the outage effectively lasts two hours. Headroom is recovery speed:

:::chart[Catch-up time after a 1-hour outage vs consumer capacity ÷ arrival rate]{type="line" x="capacity ÷ arrival rate (C/λ)" y="catch-up time (minutes)" ylog="true" points="true" marks="2:Pulse at peak;6:Pulse at average"}
C over lambda, catch-up minutes
1.1, 600
1.25, 240
1.5, 120
2, 60
3, 30
4, 20
6, 12
:::

A **backfill** is the same equation with a huge backlog. Recomputing 30 days of impressions (120B events) on the stream cluster's spare capacity at average load takes 166.7 h — a week. A batch job reading the same events from columnar files in object storage at an illustrative 5M events/s (100 workers × 50k events/s each: a scan and a count is cheap) takes 6.7 h. This is the practical argument for keeping a batch path even in a "streaming" architecture: **the log is the source of truth, but stored files are the fast way to reread it.**

:::example[Worked example · a new thumbnail size for the photo service]
The photo service stores 40M photos a day (20M DAU × 2 uploads), 14.6B a year. Adding a thumbnail size means decoding and resizing every one: at an illustrative 50 ms of CPU each, that is 730M CPU-seconds.

| Cores | Wall time | Read throughput from object storage |
|---:|---:|---:|
| 1,000 | 8.45 days | 40 GB/s |
| 5,000 | 1.69 days | 200 GB/s |

Five times the cores cuts the wall time 5×, but the job now reads 200 GB/s — ten times the service's entire user-facing egress (20 GB/s). Either throttle the backfill to protect production reads, or generate thumbnails lazily on first request and backfill only the popular photos.
:::

## 17.6 Exactly-once, checkpoints and CDC

- **Exactly-once inside the framework.** Stream processors checkpoint operator state and input offsets together, and on failure restore both and replay. Effects are exactly-once *within* the pipeline; a sink outside it (a database, an email) still needs idempotent writes keyed by event ID ([§9.4](/c/system-design/09-delivery-semantics)).
- **Checkpoint interval sets the replay.** With checkpoints every 60 s, a crash replays up to \(60 \times 120{,}000\) = 7.2M events at peak — 60 s of catch-up at 120,000/s spare. Shorter intervals mean less replay and more checkpoint I/O.
- **Change data capture (CDC)** tails the database's write-ahead log and publishes row changes as events. It is how you get a stream of "post created" without dual-writing to the database and a broker — dual writes diverge on the first partial failure.

## 17.7 Lambda, kappa, and choosing

- **Lambda** — a batch path for correctness and a stream path for freshness, merged at query time. Two implementations of the same logic: they *will* disagree, so test them against each other daily.
- **Kappa** — one streaming implementation; reprocess by replaying the retained log through a new version. One code path, but backfill speed is bounded by §17.5.

Most real systems are a pragmatic mix: stream for the live signal, batch over the same log (stored as files) for the authoritative numbers and backfills.

| Requirement | Choose | Why |
|---|---|---|
| Invoices, payouts, creator reports | Batch (or stream + batch correction) | Must include the offline tail; rerun on bugs |
| Trending, fraud scores, alerting | Stream, $L$ of seconds | A minute-old answer is worth more than a perfect one tomorrow |
| ML training sets | Batch | Reproducible snapshots |
| Live dashboard + historical charts | Stream into an OLAP store + batch backfill | Fresh today, correct history |
| Search index, cache invalidation | Stream from CDC | Seconds of lag, no dual writes |

## 17.8 Failure modes

| Failure | Symptom | Detect with | Fix |
|---|---|---|---|
| Hot key | One partition's lag grows while others idle | Lag per partition, not the total | Pre-aggregate, salt hot keys (§17.4) |
| Too little headroom | Catch-up after every deploy takes an hour | Oldest unprocessed event age | $C/\lambda \ge 2$ at peak |
| Watermark stalls | No results emitted; one idle partition holds the watermark back | Watermark age per source | Idle-source timeout in the framework |
| Late data silently dropped | Daily totals 5% below batch | Count of late events (side output) | Side output + batch correction |
| Retention shorter than a backfill | Can't reprocess after a bug | Retention vs §17.5 backfill time | Archive the log to object storage |
| Lambda paths disagree | Dashboard ≠ report | Daily reconciliation job | One shared library for the logic |

## 17.9 Rules of thumb

- **Freshness = interval + runtime for batch; processing delay + $L$ for stream.** State which one the product needs, in minutes.
- **Set $L$ just past the online delay mode** (seconds); send the offline tail to a correction path.
- **Partitions ≥ peak events/s ÷ per-consumer rate, × 2**; then check the hottest key against one consumer.
- **Keep $C/\lambda \ge 2$ at peak**: a 1-hour outage then catches up in ≤ 1 hour.
- **Backfill from files, not the stream**: 6.7 h instead of a week for 30 days of Pulse impressions.

## 17.10 Check yourself

:::qa[A sliding window of 10 minutes advancing every 30 seconds: how many windows does each event update, and why does it matter?]
\(W/s = 600/30\) = 20 windows, so 20× the state and update work of a tumbling window. Alternatives: a 1-minute tumbling count plus a query-time sum over the last 10 minutes (10 small reads instead of 20 writes per event).
:::

:::qa[Your consumers can process 150,000 events/s and peak arrival is 120,000/s. How long does a 20-minute outage at peak take to recover?]
Backlog \(120{,}000 \times 1{,}200\) = 144M events; spare 30,000/s; catch-up 4,800 s = 80 minutes — the 20-minute outage lasts 100 minutes in total. \(C/\lambda\) = 1.25 is too little headroom.
:::

:::qa[Lag is growing on partition 17 only. Total consumer capacity is twice the arrival rate. Diagnose and fix.]
A hot key: one key's rate exceeds a single consumer. More partitions or consumers won't help — the key stays on one partition. Pre-aggregate before the keyed shuffle, or salt that key across several sub-keys and merge downstream.
:::

:::qa[Product wants creator impression counts "real-time and exact". What do you build?]
Two numbers. A stream with $L$ ≈ 30 s gives a live count that is ~95% complete within 30 s (§17.3); the exact count needs the offline tail, which arrives over hours, so a batch job over the stored log finalises each day. Show the live number as provisional until the batch result replaces it.
:::

Next: [§18 Cache](/c/system-design/18-cache) — the building block that serves those counts and feeds at 6,000 reads a second.
