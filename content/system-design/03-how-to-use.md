---
section: "3"
title: "How to use this guide"
kicker: "Getting started"
abstract: "The conventions this guide uses, and three different ways to read it depending on how much time you have."
time: "2 min"
order: 3
---

## The shape of a page

Content pages share a skeleton, so you can skim them:

1. **A one-sentence summary** in a coloured bar under the title.
2. **What it is** — the mechanism, in plain language, no product names required.
3. **When to reach for it** — the conditions that justify it, and the conditions that
   do not.
4. **Trade-offs** — always at least three, each naming what you give up.
5. **Interview soundbite** — the sentence to say out loud.
6. **Where to go next** — related pages.

If you only have two minutes, read the summary and the trade-offs.

## Conventions

:::note[Assumptions are labelled]
Any number describing a real system's scale is an assumption, not a measurement.
Where you see "assume 10M DAU", treat it as a knob to turn, not a fact to memorise.
:::

:::note[Soundbites are meant to be stolen]
The *say it like this* lines are written to be spoken verbatim. They are short on
purpose — a candidate who says one clear sentence and then stops scores better than
one who says four hedged ones.
:::

:::warn[Out of scope]
Hardware, kernel tuning, and ML systems are out of scope. This guide assumes
application-level engineering and the infrastructure an application engineer
actually operates.
:::

Diagrams are Mermaid, written inline in the Markdown. They render on the site and stay
in version control next to the prose that describes them.

## Three reading paths

**One week to the interview.** [Anatomy of the interview](/c/system-design/04-interview-format/) → [the
answering framework](/c/system-design/01-answering-framework/) → [trade-off cheat
sheet](/c/system-design/74-trade-off-cheatsheet/) → three case studies out loud, timed. Skip
everything else. This path works because the trade-off sheet is a compressed version of
the whole guide.

**Learning properly, over a month.** Follow the [study plan](/c/system-design/05-study-plan/):
Fundamentals, then Building blocks, then the twelve patterns, then case studies with the
book closed.

**Looking up one answer.** Use search. Every page stands alone at the top; the first
screen is written for the reader who arrived from a search engine mid-task.

## A note on the code samples

The [code section](/c/system-design/) contains short, tested Python implementations of
the mechanisms that are easiest to describe and hardest to get right: exponential
backoff with jitter, a token bucket, a circuit breaker state machine, an idempotency
store, consistent hashing, shard routing, and an LRU cache.

They are teaching code, not library code — no thread pools, no async, no configuration.
Each is forty to eighty lines and has a test. The point is to make the failure modes
concrete: you can watch a token bucket refuse the eleventh request.
