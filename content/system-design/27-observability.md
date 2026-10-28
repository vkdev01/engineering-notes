---
section: "27"
title: "Observability"
kicker: "Building blocks"
abstract: "Three signals, three questions: metrics tell you something is wrong, traces tell you where, logs tell you what happened to one request."
time: "3 min"
order: 27
---

## What it is

The ability to answer questions about your system's behaviour from the outside, without
shipping new code. In practice: logs, metrics, traces, and the tooling that ties them
together.

| Signal | Answers | Cost driver | Retention |
| --- | --- | --- | --- |
| **Metrics** | Is something wrong, and how much? | Cardinality | Months, downsampled |
| **Traces** | Where did the time go across services? | Spans per request, sampling | Days to weeks |
| **Logs** | What happened to this specific request? | Volume | Days to weeks |
| **Events / deploys** | What changed just before? | Trivial | Months |

## Metrics: the two frameworks

**RED** for request-driven services: **R**ate, **E**rrors, **D**uration.

**USE** for resources: **U**tilisation, **S**aturation, **E**rrors.

Plus the four that catch most incidents early: queue age, cache hit rate, connection pool
saturation, and replication lag.

### Cardinality is the trap

A metric with a `user_id` label creates one time series per user, and your metrics bill
grows with your customer count. Rules:

- Labels must be bounded and known in advance: endpoint, status code, region, tenant tier.
- Never label with IDs, emails, raw URLs, or error messages.
- If you need per-request detail, that is a trace or a log, not a metric.

## Tracing

A trace is a tree of spans, one per unit of work, propagated via headers (`traceparent` in
W3C Trace Context). Each span records service, operation, start, duration, and status.

What tracing buys you in an interview answer: the ability to say *where* the p99 goes.
"Sixty percent of feed latency is the fan-out worker, not the read path" is a sentence you
can only earn with traces.

**Sampling** — head-based (decide at the start, cheap, may miss rare slow requests) or
tail-based (decide after the trace completes, keeps all the slow ones, needs buffering).
For latency debugging, tail-based sampling is worth the complexity.

## Logs

- **Structured, not prose.** JSON with `trace_id`, `user_id` (hashed), `route`, `status`,
  `duration_ms`.
- **Correlation ID** on every log line, matching the trace.
- **Never log secrets or personal data.** The log store becomes a compliance liability.
- **Log at boundaries** — inbound requests, outbound calls, state transitions. Not every
  function.

## Alerting that does not cause fatigue

| Alert type | Good | Bad |
| --- | --- | --- |
| Symptom-based | Error rate above SLO burn, p95 latency | "CPU above 80%" |
| User-facing | Checkout failure rate | "Disk 70% full" |
| Actionable | Has a runbook and an owner | Anything with "investigate" in it |

Alert on **burn rate** of the error budget: burning 10× the sustainable rate for five
minutes is a page; 2× for an hour is a ticket.

## Trade-offs

1. **Cost.** Observability frequently costs more than the compute it observes. Sample, aggregate
   and set retention deliberately.
2. **Instrumentation effort.** Every new service must be wired in; make it a template, not a
   task.
3. **Cardinality and volume surprises** — a debug log left in a hot loop can 100× your bill in
   a day.
4. **Vendor lock-in** — OpenTelemetry at the instrumentation layer keeps your options open.

## Interview soundbite

> "Every request carries a W3C trace ID into logs, metrics and spans. I'd page on SLO burn rate
> — 10× over five minutes — and put queue age and replica lag on dashboards, since those are
> the two numbers that predict user pain before it arrives."

## Where to go next

- [Can't see what broke → telemetry](/c/system-design/35-cannot-see-what-broke-telemetry/).
- [Metrics pipeline case study](/c/system-design/53-metrics-pipeline/).
