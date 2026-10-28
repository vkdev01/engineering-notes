---
section: "33"
title: "Service discovery"
kicker: "Building blocks"
abstract: "How a caller finds a healthy instance of a service whose addresses change constantly. Boring when it works, catastrophic when it is stale."
time: "2 min"
order: 33
---

## What it is

A registry of service instances and their health, plus a mechanism for callers to resolve a
service name to a set of addresses.

## The two models

| Model | How | Example |
| --- | --- | --- |
| **Client-side discovery** | The client queries the registry and load-balances itself | Consul + a smart client, gRPC resolver |
| **Server-side discovery** | The client calls a stable name; a proxy resolves and balances | Kubernetes Service, an internal load balancer |

Client-side is more efficient (no extra hop) and pushes complexity into every client.
Server-side is simpler for the application and adds a hop plus a component.

## Registration patterns

- **Self-registration** — the instance registers on start and heartbeats. Simple; dies with
  the process if heartbeats stop (which is the point).
- **Third-party registration** — a sidecar or orchestrator registers on the instance's behalf.
  Kubernetes does this natively via endpoints.
- **DNS-based** — the registry publishes records. Universal, but TTL caching delays updates.

## Kubernetes, concretely

In Kubernetes you mostly get discovery for free: a `Service` gives you a stable name and a
virtual IP; endpoints are updated as pods become ready. The subtleties that bite:

- **Readiness versus liveness** — only ready pods receive traffic. A pod that is starting or
  failing its dependency check is removed.
- **Endpoint propagation delay** — a new pod is not instantly in the endpoint list, and a dead
  one lingers briefly. Clients need retries for that window.
- **DNS caching in clients** — some runtimes cache DNS forever and keep calling dead pods.
  Use a client that re-resolves, or a service mesh sidecar.

## Trade-offs

1. **The registry is a dependency.** If it is unavailable and clients cache aggressively, you
   are fine; if they do not cache at all, you are down. Design for cached resolution with a
   TTL.
2. **Staleness is inherent.** There is always a window where a caller has an address that no
   longer works. Retries and connection pooling make it a non-event.
3. **Health checks can lie.** "Healthy" means "answering the health endpoint", not "able to
   serve". Keep checks cheap and shallow, and let load balancing handle the rest.
4. **Another thing to operate** if you are not on Kubernetes.

## Failure modes

- **Thundering herd on restart** — every client re-resolves simultaneously when the registry
  flaps. Add jitter.
- **Zombie instances** — a partitioned instance keeps its registration alive. Lease-based
  registration with a short TTL fixes it.
- **Cross-zone traffic** — discovery returns all instances; without topology awareness, half
  your calls cross an availability zone. Use zone-aware routing.

## Interview soundbite

> "Services resolve each other by name through the platform's service registry, with readiness
> checks so only healthy pods get traffic. Clients cache the resolution for a few seconds and
> retry on connection failure, which covers the propagation window."

## Where to go next

- [Load balancer](/c/system-design/24-load-balancer/).
- [Circuit breaker](/c/system-design/20-circuit-breaker/) — what to do when the address is fine but the service
  is not.
