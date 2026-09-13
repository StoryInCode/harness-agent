# Agent Note: Development-loop capacity follows owned run cleanup

Status: implemented

## Problem

A lifecycle approval announcement contains a status transition, not an Agent, provider, role assignment, or worktree. It cannot construct executable work. Separately, a worker result can settle before cleanup finishes, so counting completion announcements can free capacity while resources remain active.

## Decision

The [development-loop queue](../../../../packages/dev-loop/queue/README.md) admits a piece together with its consumer-owned start callback and cancellation signal. It captures the exact live initiating Agent, reserves capacity before calling the asynchronous factory, and retains that reservation until the returned one-shot run's result and disposal settle. Cleanup failure closes admission and retains the uncertain reservation.

Role consumers own the provider, assignment, and worktree; the queue owns ordering, dependencies, capacity, and cancellation. The [approval decision](2026-09-13-development-loop-approval.md) remains separate. Capturing the initiator before parking prevents a later wakeup's ambient caller from replacing the original delegator. Existing `SubagentRun` result and disposal promises provide settlement; its child SessionId is not a continuable run epoch.

## Alternatives considered

Direct queue-owned spawning would absorb role and worktree policy. A dispatcher registry would add another lifetime despite each invocation already owning its callback and signal. Counting global start/end announcements would lose startup-rejection and cleanup information and require correlation of unrelated runs.

A maintained priority queue such as [p-queue](https://raw.githubusercontent.com/sindresorhus/p-queue/main/readme.md) provides general scheduling. Its README documents that aborting a task does not automatically stop the work inside it. Piece dependencies, Agent identity, and joined resource cleanup would still require owned integration. The current implementation keeps these responsibilities in one request lifetime rather than introducing another queue layer. This comparison is documentation inspection, not a claim about a pinned library implementation; no code was reused.

## Consequences

The configurable default of four is a deployment convention, not a benchmark or process-wide child limit. State is process-local and accepts one-shot leases only. A callback or provider that never settles can hold teardown; a timeout cannot establish that its resources stopped. Provider failure and durable reconciliation remain separate responsibilities. Existing agent-loop scheduling and subagent catalog decisions retain their own scope; this feature does not supersede them.

## Verification

The [owner-local tests](../../../../packages/dev-loop/queue/tests/queue.spec.ts) exercise real Agent, Directory, Lifecycle, filesystem, subprocess, and Loader services with controllable external work leases. They distinguish held startup, result settlement, and held cleanup; check attribution and dependency wakeups; and prove cancellation joins late resources. Capacity snapshots derive from the same reservation records used for admission, not a separately maintained event counter.
