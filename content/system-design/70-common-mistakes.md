---
section: "70"
title: "Common mistakes"
kicker: "Interview"
abstract: "The eleven habits that cost candidates offers, each with the specific replacement behaviour."
time: "3 min"
order: 70
---

## 1 · Designing before scoping

You start drawing boxes two minutes in, and the interviewer has to interrupt to ask what the
system does.

**Instead:** restate the problem, ask three questions that change the design, and say what you are
leaving out. Five minutes, then draw.

## 2 · Skipping the estimate

Without numbers, every later decision is unfalsifiable — and the interviewer cannot tell whether
you chose a cache because it was right or because you like caches.

**Instead:** derive peak QPS and storage per year on the board, write them in a corner, and refer
back to them explicitly.

## 3 · Reaching for the expensive fix first

Proposing sharding for 7 TB of data, or Kafka for 50 events per second, reads as pattern-matching
rather than engineering.

**Instead:** walk the cost ladder out loud — index, then cache, then replicate, then shard — and
say why you stopped where you did.

## 4 · Naming technology without a reason

"Then we put Redis here" is not a design decision. "Then we put Redis here, because the mapping is
immutable and 30 seconds of staleness is invisible" is.

**Instead:** every component gets a because-clause, and the because-clause names the trade-off.

## 5 · Ignoring the second-order effects

A cache means invalidation. A queue means duplicates. Replicas mean lag. Sharding means
cross-shard queries. Every component brings a failure mode.

**Instead:** after each choice, say what breaks next. This is the single highest-value habit on
this page.

## 6 · No failure story

The system works perfectly, forever, in your diagram. Interviewers are looking for what happens
when a dependency dies.

**Instead:** reserve two minutes for "what happens if X is down" for the three most critical
dependencies, and name the fallback each time.

## 7 · Silent whiteboard work

Thirty seconds of drawing without talking loses the interviewer, who then interrupts to catch up —
and the interruption costs you the narrative.

**Instead:** narrate while drawing. "I'm putting the cache here because the read path hits it
first."

## 8 · Designing every feature

Treating "design Twitter" as a mandate to design timelines, DMs, search, ads and moderation
produces a shallow pass over everything.

**Instead:** pick the two flows that matter, say the rest are out of scope, and go deep. Depth on
one flow beats breadth on six.

## 9 · Hand-waving the hard part

"Then the system handles consistency" is where interviews are lost. The interviewer will ask how,
and now you are improvising.

**Instead:** if you do not know, say what you would look up and what the shape of the answer is.
"I know this is where I'd need to choose between optimistic and pessimistic locking; I'd start
optimistic with a retry because contention is low here."

## 10 · Never mentioning operations

A design that cannot be deployed, monitored or rolled back is not a design.

**Instead:** finish with what you would measure, what you would alert on, and what you would ship
first. One sentence each.

## 11 · Arguing instead of reasoning

When the interviewer pushes back — "why not shard?" — defending your choice is a mistake if the
pushback is right.

**Instead:** treat pushback as information. "That's fair — sharding would help write throughput,
but at 200 write QPS I'd rather not pay for cross-shard queries yet. If you expect 10× growth,
that changes."

## A self-check to run after every mock

Answer these five honestly:

1. Did I put numbers on the board in the first ten minutes?
2. Did every component I named come with a reason?
3. Did I volunteer a failure mode before being asked?
4. Did I say what I would measure in production?
5. Did I talk for most of the time, without being interrupted more than twice?

Any "no" is your next practice target. Fixing the first one alone tends to lift an answer by a
level.
