---
section: "65"
title: "Idempotency store"
kicker: "Implementations"
abstract: "An idempotency store on a real SQL database: claim the key with one INSERT under a unique index, do the side effect once, commit the order and the stored response together, replay verbatim. Tested with 16 concurrent copies, then measured with threads: check-then-act charges once per copy, insert-first exactly once."
time: "14 min"
order: 65
outcomes:
  - "Implement claim → work → complete with a unique constraint and a stored response"
  - "Return the right answer for every duplicate: replay, 409, 422, or process again after a retryable failure"
  - "Show with real threads why check-then-act double-charges and insert-first cannot"
  - "Decide where the transaction boundary goes and how to recover keys stuck in progress"
---

A shopper taps **Pay** during checkout's flash sale. The provider is slow (p50 300 ms, p99 2 s, illustrative), the app times out at 1 s and retries, and the shopper taps again: three requests, one intent. [§22](/c/system-design/22-idempotency) showed that a handler which checks for the key, charges, and records the key afterwards double-charged 2,168 of 4,000 duplicates in a simulated sale. This section builds the store that charges exactly once — on SQLite from Python's standard library, so the unique constraint is a real database's — and races real threads against it.

:::key[First principle]
Make the *claim* a single atomic step that happens before any side effect: `INSERT` the key under a unique index. Exactly one request wins; every other copy sees the row and gets the stored response (if finished), `409` (if in progress) or `422` (if the body differs). The business write and the stored response then commit in one transaction, so the answer a retry replays is the answer that actually happened.
:::

## 65.1 The contract

| A request with key $k$ finds… | Answer | Why |
|---|---|---|
| No row | Insert `in_progress`, do the work, store the response | First copy |
| `completed`, same fingerprint | The stored status and body, verbatim | A retry must see exactly the original answer |
| `in_progress` | `409` + retry hint | The first copy is still working; never start a second |
| Any row, different fingerprint | `422` | The client reused a key for a different request |
| Nothing, because the first copy failed retryably and deleted its claim | Process normally | A genuine retry must be able to succeed |
| Nothing, because the TTL expired | Process normally — **a new charge** | Size the TTL to outlive retries ([§22.5](/c/system-design/22-idempotency): 24–72 h for checkout) |

Two numbers frame it. Keys are client-generated UUIDv4s — 122 random bits; at ~2 × 10⁹ keys a year the chance of any collision is ≈ 3.8 × 10⁻¹⁹ ([§22.2](/c/system-design/22-idempotency)). And without an atomic claim, a duplicate that arrives a gap $g$ after the first copy double-charges whenever the first is still running:

$$
P(\text{double charge}) = P(\text{latency} > g),
$$

which at a 300 ms median is 50% for a duplicate 300 ms behind. Duplicates arrive *because* the first copy was slow, so this is the common case, not a corner.

## 65.2 The implementation

`IdempotentEndpoint.handle` is the whole protocol in three steps. Each thread uses its own connection, as it would from a pool. The external charge happens **between** the claim and the final transaction — never inside an open transaction: at 2,000 orders/s with the provider's 0.3–2 s latency that would hold 600–4,000 transactions open at once (Little's law, [§10](/c/system-design/10-latency-and-throughput)).

```python run
import hashlib
import json
import sqlite3
import tempfile
import threading
import time


class Retryable(Exception): pass


class IdempotentEndpoint:
    """POST /orders with an Idempotency-Key. The PRIMARY KEY on (scope, key) is the claim."""

    def __init__(self, path, charge, ttl=24 * 3600, clock=time.time):
        self.path, self.charge, self.ttl, self.clock = path, charge, ttl, clock
        self.local = threading.local()
        self.db().executescript("""
          CREATE TABLE idem (scope TEXT, key TEXT, fp TEXT, status TEXT, response TEXT,
                             created REAL, PRIMARY KEY (scope, key));
          CREATE TABLE orders (id INTEGER PRIMARY KEY, scope TEXT, key TEXT, amount INTEGER);""")

    def db(self):                           # one connection per thread, as from a pool
        if not hasattr(self.local, "c"):
            self.local.c = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        return self.local.c

    def handle(self, scope, key, body):
        db, fp = self.db(), hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
        try:                                # 1. claim: a single INSERT, atomic by the unique index
            db.execute("INSERT INTO idem VALUES (?, ?, ?, 'in_progress', NULL, ?)",
                       (scope, key, fp, self.clock()))
        except sqlite3.IntegrityError:
            row = db.execute("SELECT fp, status, response FROM idem WHERE scope = ? AND key = ?",
                             (scope, key)).fetchone()
            if row is None: return self.handle(scope, key, body)   # released meanwhile
            if row[0] != fp: return 422, {"error": "key reused with a different body"}
            if row[1] == "in_progress": return 409, {"error": "in progress", "retry_after_s": 1}
            return tuple(json.loads(row[2]))                         # replay, verbatim
        try:                                # 2. the side effect, with the same key downstream
            charge_id = self.charge(key, body)
        except Retryable:
            db.execute("DELETE FROM idem WHERE scope = ? AND key = ?", (scope, key))
            return 503, {"error": "payment provider unavailable, retry"}
        resp = (201, {"order": key, "charge": charge_id})
        db.execute("BEGIN IMMEDIATE")       # 3. business write + stored response, one transaction
        db.execute("INSERT INTO orders (scope, key, amount) VALUES (?, ?, ?)", (scope, key, body["amount"]))
        db.execute("UPDATE idem SET status = 'completed', response = ? WHERE scope = ? AND key = ?",
                   (json.dumps(resp), scope, key))
        db.execute("COMMIT")
        return resp

    def expire(self):
        return self.db().execute("DELETE FROM idem WHERE status = 'completed' AND created < ?",
                                 (self.clock() - self.ttl,)).rowcount


charges, now, flaky = [], [0.0], {"k-flaky"}
def charge(key, body):
    if key in flaky: flaky.discard(key); raise Retryable()
    time.sleep(0.2 if key == "k-race" else 0); charges.append(key); return f"ch_{len(charges)}"

api = IdempotentEndpoint(tempfile.mkdtemp() + "/shop.db", charge, clock=lambda: now[0])
first = api.handle("merchant-1", "k-1", {"cart": 7, "amount": 4999})
assert first[0] == 201 and api.handle("merchant-1", "k-1", {"amount": 4999, "cart": 7}) == first
assert api.handle("merchant-1", "k-1", {"cart": 7, "amount": 1})[0] == 422
assert api.handle("merchant-2", "k-1", {"cart": 9, "amount": 100})[0] == 201, "keys are scoped"
assert api.handle("merchant-1", "k-flaky", {"amount": 5})[0] == 503
assert api.handle("merchant-1", "k-flaky", {"amount": 5})[0] == 201, "retry after a failure works"

barrier, codes = threading.Barrier(16), []
def dup(): barrier.wait(); codes.append(api.handle("merchant-1", "k-race", {"amount": 7})[0])
threads = [threading.Thread(target=dup) for _ in range(16)]
for t in threads: t.start()
for t in threads: t.join()
assert sorted(codes) == [201] + [409] * 15 and charges.count("k-race") == 1
assert api.handle("merchant-1", "k-race", {"amount": 7})[0] == 201, "after completion: replay"

now[0] += 25 * 3600
print("expired keys after 25 h:", api.expire())
assert api.handle("merchant-1", "k-1", {"cart": 7, "amount": 4999})[1]["charge"] != first[1]["charge"]
orders = api.db().execute("SELECT scope, key, COUNT(*) FROM orders GROUP BY 1, 2 ORDER BY 1, 2").fetchall()
print("16 concurrent copies of k-race ->", {c: codes.count(c) for c in sorted(set(codes))})
print("charges:", len(charges), "| orders per key:", orders)
print("all idempotency tests passed (the last k-1 order is the post-TTL replay charging again)")
```

```output
expired keys after 25 h: 4
16 concurrent copies of k-race -> {201: 1, 409: 15}
charges: 5 | orders per key: [('merchant-1', 'k-1', 2), ('merchant-1', 'k-flaky', 1), ('merchant-1', 'k-race', 1), ('merchant-2', 'k-1', 1)]
all idempotency tests passed (the last k-1 order is the post-TTL replay charging again)
```

What the tests pin down:

- **Replay is verbatim and insensitive to key order in the body**: the fingerprint is SHA-256 of canonical JSON (`sort_keys=True`), so `{"amount", "cart"}` and `{"cart", "amount"}` are the same request.
- **Scope**: the same key from another merchant is a different request.
- **Retryable failure releases the claim**: the first `k-flaky` attempt returns `503` and deletes its row, so the retry charges and creates one order.
- **16 concurrent copies, real threads, real database**: one `201`, fifteen `409`s, one charge. SQLite serialises the inserts; the unique index rejects all but one.
- **TTL is a trade, not a detail**: after the 24 h sweep, the same key charges again — the second `k-1` order. That is why the TTL must cover the retry tail and why checkout keeps a business-level guard too (a unique `orders(cart_id)`, [§22.5](/c/system-design/22-idempotency)).

## 65.3 Measuring the race

The same handler logic in three shapes, with the database replaced by a dict so the race is the only variable (provider call scaled down to 50 ms; one database round trip 2 ms, illustrative):

- **check, charge, record** — look the key up, charge, write the key at the end;
- **check, then insert** — look it up, then insert it in a second round trip, then charge;
- **insert-first** — one atomic insert (the lock stands in for the unique index), then charge.

All copies of an intent are released by one barrier; in the second table the second copy waits a gap first.

```python run
import threading
import time
from collections import Counter

PROVIDER, RTT = 0.05, 0.002        # provider call 50 ms, one DB round trip 2 ms (scaled down)


def run(pattern, copies, intents=25, gap=0.0):
    store, lock, charges, outcome = {}, threading.Lock(), Counter(), Counter()

    def charge(key):
        time.sleep(PROVIDER)
        with lock: charges[key] += 1

    def handle(key):
        if pattern == "check, charge, record":          # look up, charge, write the key at the end
            if key in store: return "replay"
            charge(key); store[key] = "done"; return "charged"
        if pattern == "check, then insert":             # SELECT, then INSERT: two round trips
            if key in store: return "409" if store[key] == "in_progress" else "replay"
            time.sleep(RTT)
            store[key] = "in_progress"; charge(key); store[key] = "done"; return "charged"
        with lock:                                      # insert-first: one atomic INSERT
            state = store.get(key)
            if state is None: store[key] = "in_progress"
        if state: return "409" if state == "in_progress" else "replay"
        charge(key); store[key] = "done"; return "charged"

    barrier = threading.Barrier(intents * copies)
    def client(key, delay):
        barrier.wait(); time.sleep(delay)
        r = handle(key)
        with lock: outcome[r] += 1
    threads = [threading.Thread(target=client, args=(f"order-{i}", gap * (c > 0)))
               for i in range(intents) for c in range(copies)]
    for t in threads: t.start()
    for t in threads: t.join()
    return sum(charges.values()) / intents, outcome


PATTERNS = ("check, charge, record", "check, then insert", "insert-first")
print("concurrent copies of one intent -> charges per intent (25 intents each)")
print("copies | check, charge, record | insert-first | insert-first outcomes")
chart = []
for k in (1, 2, 4, 8, 16):
    res = [run(p, k) for p in (PATTERNS[0], PATTERNS[2])]
    chart.append((k, res[0][0], res[1][0]))
    print("%6d | %21.2f | %12.2f | %s" % (k, res[0][0], res[1][0], dict(sorted(res[1][1].items()))))
print("\nsecond copy arrives after a gap (provider takes 50 ms): what does it get? (10 intents)")
for gap in (0.0, 0.02, 0.1, 0.2):
    row = []
    for p in PATTERNS:
        per_intent, out = run(p, 2, intents=10, gap=gap)
        row.append("%.0f charge(s), %s" % (per_intent, "/".join(sorted(out))))
    print("gap %3.0f ms | %s" % (1000 * gap, " | ".join(row)))
print("\nchart: copies, check-charge-record, insert-first")
for row in chart:
    print("%d, %.2f, %.2f" % row)
```

```output
concurrent copies of one intent -> charges per intent (25 intents each)
copies | check, charge, record | insert-first | insert-first outcomes
     1 |                  1.00 |         1.00 | {'charged': 25}
     2 |                  2.00 |         1.00 | {'409': 25, 'charged': 25}
     4 |                  4.00 |         1.00 | {'409': 75, 'charged': 25}
     8 |                  8.00 |         1.00 | {'409': 175, 'charged': 25}
    16 |                 16.00 |         1.00 | {'409': 375, 'charged': 25}

second copy arrives after a gap (provider takes 50 ms): what does it get? (10 intents)
gap   0 ms | 2 charge(s), charged | 2 charge(s), charged | 1 charge(s), 409/charged
gap  20 ms | 2 charge(s), charged | 1 charge(s), 409/charged | 1 charge(s), 409/charged
gap 100 ms | 1 charge(s), charged/replay | 1 charge(s), charged/replay | 1 charge(s), charged/replay
gap 200 ms | 1 charge(s), charged/replay | 1 charge(s), charged/replay | 1 charge(s), charged/replay

chart: copies, check-charge-record, insert-first
1, 1.00, 1.00
2, 2.00, 1.00
4, 4.00, 1.00
8, 8.00, 1.00
16, 16.00, 1.00
```

:::chart[Charges per intent vs concurrent copies of the same request (25 intents, real threads)]{type="line" x="concurrent copies" y="charges per intent" xlog="true" ylog="true" points="true"}
copies, check-charge-record, insert-first
1, 1.00, 1.00
2, 2.00, 1.00
4, 4.00, 1.00
8, 8.00, 1.00
16, 16.00, 1.00
:::

:::example[Worked example · reading the race]
- **Check, charge, record charges once per copy**: 16 copies → 16 charges, every time. Each copy's lookup happens while the first is still inside its 50 ms provider call, so every lookup finds nothing.
- **Insert-first charges once regardless**: 16 copies → 1 charge and 15 `409`s per intent. The `409` path is the normal case under concurrency, not an error path — clients must retry it with the same key.
- **Check-then-insert narrows the window to one round trip, not to zero.** A second copy 20 ms behind is caught (the first has inserted by 2 ms), but simultaneous copies all pass the check. With 16 copies its result also *varied between runs*: in four runs of an earlier version of this block it charged 8.2–12.0 times per intent at 16 copies and 6.6–8.0 at 8 (so the block above leaves it out of the copy sweep). A bug whose rate depends on scheduling is exactly the kind that passes tests and fails in a flash sale.
- **After the first copy finishes** (gaps of 100 and 200 ms against a 50 ms call) every pattern replays correctly. The race only exists while the first copy is in flight — which is when retries happen.
:::

## 65.4 Production notes

**The claim in real databases.**

| Store | Atomic claim | Notes |
|---|---|---|
| PostgreSQL | `INSERT … ON CONFLICT (scope, key) DO NOTHING RETURNING status` — no row returned means you lost | One round trip; same database as the order, so step 3 is a local transaction |
| MySQL | `INSERT` and catch the duplicate-key error | Avoid `INSERT IGNORE` hiding other errors |
| DynamoDB | `PutItem` with `attribute_not_exists(pk)` | Item TTL attribute for expiry; AWS Lambda Powertools' idempotency utility implements this pattern |
| Redis | `SET key value NX EX ttl` | Fast, but a different system from the order: a crash between them reopens the gap ([§22.6](/c/system-design/22-idempotency)) |

**Pass the key downstream.** `charge(key, body)` sends the same key to the provider; most payment APIs accept one (Stripe's `Idempotency-Key` header, for example, whose keys it may prune after 24 hours). The IETF has a draft standardising the `Idempotency-Key` HTTP header.

**Keys stuck `in_progress`.** If the process dies after charging and before committing, the row stays `in_progress` and every retry gets `409`. Run a sweeper over rows older than a few minutes (longer than the provider's timeout): ask the provider for the outcome *by the same key*, then complete the row (store the response, create the order) or delete it so the client's next retry proceeds. Never just delete — the charge may have happened.

**Answering `409`.** Either return it with `Retry-After: 1` and let the client back off ([§30](/c/system-design/30-retry)), or hold the duplicate server-side and poll the row for up to the provider's p99 (2 s) before answering — fewer client round trips, more server workers held.

**Size and cost.** Each row is key + scope + fingerprint + status + response, ~500 B with a small JSON body (illustrative); 5.52M orders/day × 24 h TTL ≈ 2.8 GB ([§22.5](/c/system-design/22-idempotency)). A separate key table adds an insert and an update per order — at the 2,000 orders/s peak, 4,000 extra writes/s on top of 8,000. When the operation creates a row anyway, put the unique key on that row (`orders(merchant_id, idem_key)`) and the claim and the business write become one insert.

:::warn[Failure modes of the code itself]
- **Claim read and write in two statements** → simultaneous copies all pass (§65.3).
- **Response not stored, or stored outside the order's transaction** → a replay returns a different answer from what happened.
- **Claim kept after a retryable failure** → the client can never succeed; every retry gets `409` or a stored error.
- **External call inside the database transaction** → hundreds of open transactions and lock waits at peak.
- **Fingerprint over non-canonical JSON** → harmless retries rejected with `422`.
:::

## 65.5 Interview angle

Cost per request: one indexed insert (a B-tree insert, $O(\log n)$ in the number of live keys) plus, on completion, one update in the business transaction; memory = keys/day × TTL × row size. Edge cases worth raising unprompted: duplicates arriving *while the first is in flight*; same key with a different body; per-tenant scope; the process crashing between side effect and commit; TTL shorter than the retry tail; storing error responses (store final ones like `402 card declined`, not retryable `503`s).

Follow-ups to expect:

- *Is this exactly-once?* No — the provider may still be called twice across a crash; it is at-most-once *charging* only because the provider deduplicates on the same key. End to end it is "effectively once": at-least-once delivery plus deduplication ([§9](/c/system-design/09-delivery-semantics)).
- *Why not generate the key on the server?* The server can't tell a retry from a new intent; only the client knows.
- *How would a queue consumer use this?* Same table, keyed by message ID, in the same transaction as the consumer's write ([§37](/c/system-design/37-duplicate-requests-idempotency)).
- *What if the store is down?* Fail closed for payments (reject), never "process without dedup".

## 65.6 Check yourself

:::qa[Two copies of a request hit `handle` within 1 ms of each other. Walk through what each sees in the SQLite implementation.]
Both run `INSERT INTO idem …`. The database serialises them; the first commits the `in_progress` row and goes on to charge. The second gets `IntegrityError`, reads the row (same fingerprint, `in_progress`) and returns `409`. When the client retries after the first commits, it reads `completed` and gets the stored `201` verbatim. One charge.
:::

:::qa[Why does the handler delete the claim on a `503` from the provider, but must not delete it on a crash after charging?]
A `Retryable` exception means the provider did not charge, so removing the claim lets the client's retry do the work. After a crash, the handler doesn't know whether the charge happened; deleting the row would let a retry charge again. Leave it `in_progress` and let the sweeper ask the provider by key.
:::

:::qa[In §65.3, a second copy arriving 20 ms behind is caught by check-then-insert. Why isn't that good enough?]
Because duplicates also arrive together — a proxy retry, two tabs, a double tap — and then both copies read "no key" before either inserts. The table shows 2 charges at a 0 ms gap, and with more copies the count varied run to run. Only a single atomic insert removes the window instead of narrowing it.
:::

:::qa[Checkout's key store keeps 24 h of keys. A mobile client replays an offline payment 30 hours later. What happens, and what stops a double charge?]
The key has expired, so the store processes it as new and charges. The backstop is a business-level unique constraint — one order per `cart_id` — or a longer TTL: §22.5 measured ~95 escaped retries/day at 24 h vs ~12 at 72 h, for 2.8 GB vs 8.3 GB.
:::

Next: [§66 LRU cache](/c/system-design/66-lru-cache) — O(1) recency with a hash map and a linked list.
