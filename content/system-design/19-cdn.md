---
section: "19"
title: "CDN"
kicker: "Building blocks"
abstract: "Puts copies of your bytes near your users. Turns a 200 ms cross-continent fetch into a 10 ms edge hit, and removes most of your origin's egress."
time: "2 min"
order: 19
---

## What it is

A globally distributed cache for HTTP responses. Requests are routed (by anycast or GeoDNS)
to a nearby edge node, which serves the response from its own cache or fetches it from your
origin.

## How it works

- **Cache key** — usually the URL, plus any `Vary` headers. Anything not in the key cannot
  vary the response.
- **TTL** — `Cache-Control: max-age`, `s-maxage` for shared caches, `stale-while-revalidate`
  to serve stale while refreshing in the background.
- **Invalidation** — purge by URL or tag. Fast on modern CDNs, but never instant everywhere.
- **Origin shield** — a mid-tier cache that collapses misses from many edges into one
  origin request.
- **Signed URLs / cookies** — time-limited access for private content.

:::mermaid[Diagram]
flowchart LR
    U[User in India] --> E[Edge node, Mumbai]
    E -->|miss| S[Origin shield]
    S -->|miss| O[Origin / object storage]
    E -->|hit, ~10 ms| U
:::

## When to reach for it

- Static assets — JS, CSS, images, fonts. Non-negotiable.
- Video segments and large downloads. The economics only work with a CDN.
- Public, cacheable API responses (product catalogue, public profiles).
- Anything with a wide geographic audience.

## Trade-offs

1. **Invalidation is slow and partial.** Design for immutable URLs with content hashes
   (`app.3f9c1a.js`) rather than purging mutable ones.
2. **You lose control of the edge.** Debugging means reasoning about a cache you do not
   operate; `X-Cache: HIT/MISS` headers and a `Cache-Control: no-cache` bypass are essential.
3. **Cost model changes.** Egress per GB is cheap at scale but a surprise at the wrong
   traffic pattern; a cache-miss storm costs 10–100× a normal day.
4. **Personalisation defeats it.** A response that varies per user cannot be cached publicly
   without care — use `private` and let the browser cache it, or split the personalised
   fragment out.

## Failure modes

- **Caching a personalised response publicly** — the classic incident where one user's
  account page is served to thousands. Always set `Vary` or `Cache-Control: private`
  deliberately.
- **Thundering herd on expiry** — a million clients miss at once when a popular object
  expires. Fix with `stale-while-revalidate` and jittered TTLs.
- **Cache poisoning** — an unkeyed header influences the response, and an attacker fills the
  cache with it. Normalise and validate.
- **Origin dependency** — a CDN miss for a hot object hammers the origin; that is what the
  shield is for.

## Interview soundbite

> "Media goes to object storage, and a CDN in front with content-hashed immutable URLs and a
> one-year TTL, so we never purge. Private media uses short-lived signed URLs, which the
> CDN honours without caching the authorisation."

## Where to go next

- [Object storage](object-storage.md) — the origin behind the CDN.
- [Slow files → object storage + CDN](../patterns/slow-files-object-storage-cdn.md).
