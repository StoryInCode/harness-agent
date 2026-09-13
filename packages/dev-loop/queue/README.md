---
description: "Bound approved development-loop one-shot delegations while preserving caller identity and waiting for complete worker cleanup."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-queue

English | [中文](README.zh.md)

## Summary

Submit an approved piece and a consumer-owned startup callback to a bounded dispatch queue. Canonical queue priority and dependencies control when the callback runs. A reservation covers startup, execution, and cleanup, including late startup after cancellation. This fork-owned service does not infer assignments from approval events or create subagents without a submitted request.

## Table of Contents

- [Use this package](#use-this-package)
- [Ownership and scheduling](#ownership-and-scheduling)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the service with `agents`, `devLoopDirectory`, and `devLoopLifecycle` available. Its validated `maxConcurrency` configuration is an integer from 1 through 32, defaulting to 4. This is a deployment convention, not a measured machine capacity or a global subagent limit.

A role consumer calls `ctx.devLoopQueue.enqueue({ pieceId, signal, dispatch })` under `ctx.agents.withInitiator(agent, ...)`. The callback receives that captured Agent and a combined cancellation signal and returns the existing one-shot `SubagentRun`. The consumer selects the provider, request, role, and worktree; the queue injects no dispatcher or subagent provider.

Admission requires an exact live initiator, canonical piece and dependencies, logical lifecycle status `pending`, and no outstanding request for the same piece. A live owned child may submit work; human-root authorization remains the approval consumer's concern. Admission reserves the piece id before asynchronous lookup and returns a ticket without waiting for worker capacity.

The ticket's `result` returns the worker's `SubagentResult` only after disposal and result observation settle. Child stop reasons, including `error` and `aborted`, remain result values unless this request was cancelled. Startup and infrastructure failures reject the ticket. `cancel(reason?)` is idempotent, aborts the request, and waits for its complete cleanup; cleanup failure rejects cancellation too. The same still-pending piece may be submitted for another role after ordinary settlement.

`getActiveWorkers()` reports detached scalar records for starting and running reservations, including cleanup. `getQueuedEntries()` reports admitted requests waiting for dependencies or capacity in dispatch order. Neither returns live Agent objects, callbacks, or run handles. A returned `subagentId` is the child's session id, not a continuable run epoch.

## Ownership and scheduling

Lower canonical queue numbers take precedence, with FIFO request order breaking ties. The scheduler checks current logical dependency statuses rather than stale disk status headers. Incomplete dependencies park a request; a blocked dependency causes a pending-to-blocked lifecycle transition and request rejection without preventing unrelated work. Lifecycle approval, completion, and blocking announcements only wake existing requests. Global subagent events do not create work or release capacity.

Scheduling clears ambient initiator attribution. Before startup, the queue rechecks both the captured Agent's exact live identity and the piece's pending state, then invokes the callback under that Agent's initiator scope. Capacity is reserved before the asynchronous callback is called, not after it returns a child handle.

Queued cancellation never invokes the callback. Cancellation during startup waits for it to settle and disposes any late returned run. Cancellation during execution starts disposal without waiting for the result first; both disposal and result observation must settle before capacity is reused. A callback or provider that does not settle can therefore delay teardown instead of being abandoned.

Disposal closes admission and wakeups, aborts all requests, and joins pending admission, startup, execution, and cleanup. If a run's disposal fails, the queue closes admission, cancels other requests, and retains the failed reservation because quiescence is unproven. The failure reaches the ticket and queue teardown rather than reporting that capacity as free.

[Implementation](src/index.ts) owns request claims, capacity selection, captured initiators and lease settlement; [public types](src/types.ts) define tickets and snapshots. No invariant companion is published: capacity queries derive from the same reservation entries the dispatch check owns, not an independent event counter. Provider quiescence is established by the run's disposal promise and cannot be inferred from a separate announcement count.

## Model Experience

None, as this host-side scheduler registers no tool, prompt, or session event.

#### KV Cache effect

The queue adds no model context. Its scheduling and snapshots do not alter a reusable request prefix; model-visible role results remain owned by the dispatching consumer.

## Known Limitations and Deferred Work

- **Process-local state:** admission, ordering, reservations, and failure closure are not persisted. Restart recovery and durable approval evidence belong to 00.12.
- **One-shot operations only:** the limit counts this queue's submitted leases, not unrelated subagents or provider-internal workers. Continuable residency epochs require a separate ownership design.
- **Consumer-owned work:** approval alone does not identify a parent, provider, assignment, or worktree. The role consumer must supply a callback and cancellation lifetime; no `/dev-loop` operator interface is installed here.
- **Quiescence depends on providers:** failed cleanup permanently closes this service instance. Stuck startup or cleanup delays cancellation and disposal; there is no detached timeout that falsely declares the worker stopped.
- **Dependency policy is event-driven:** parked requests wait for lifecycle wakeups or another scheduling trigger. Cyclic dependencies and priorities that starve lower-priority work are not resolved by this package.

<a id="dev-note"></a>
### Dev Note

The [decision record](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-queue.md) explains callback ownership and why capacity follows run cleanup rather than global event counts.
