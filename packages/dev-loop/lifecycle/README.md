---
description: "Guarded development-loop piece status changes, cancellable Git promotion, and header recovery for lifecycle consumers."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-lifecycle

## Summary

Change a development-loop piece's status through a compare-and-set writer that rejects stale or illegal transitions. Completion awaits policy listeners, rewrites the disk header, and stages a move into the set's `done/` directory. Cancellation waits for active work and guarded header recovery. Status remains in memory; this package alone does not enforce verification or provide restart durability.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the service through a host composition with `devLoopDirectory`, `fs`, and `subprocess`. The directory hydrates all valid pieces during `Service.init`, before mounting settles; malformed ids retain their parse errors. Disposal aborts an active listing or scan before Cordis joins initialization, and cancelled results are not published.

### Configuration

Cordis validates these optional fields at mount and supplies them to every subprocess request.

| Field | Default | Accepted values |
|---|---|---|
| `terminationGraceMs` | `5000` | Positive integer milliseconds, at most `2147483647` |
| `outputMaxBytes` | `65536` | Positive integer bytes per collected stream |

### Status changes

`getStatus(pieceId)` returns held logical state, not a fresh disk read. `canTransition(from, to)` checks the exported `LEGAL_TRANSITIONS` table: `todo → pending`, `pending → done`, `pending → blocked`, and `blocked → todo`. `done` has no outgoing edge.

Call `transition(pieceId, expected, to, reason?, signal?)` with the observed status. A stale or competing claim rejects with `StalePieceStatusError` (`PIECE_STALE_STATUS`); an illegal edge rejects with `InvalidStateTransitionError` (`INVALID_STATE_TRANSITION`). Non-completing transitions change memory only, so the disk header can still declare `todo` when approved memory holds `pending`.

### Completion policy and announcements

`piece/pre-complete` is an awaited serial hook before any completion filesystem or Git work. Its `PiecePreCompleteEvent` carries the pending-to-done request, optional reason, and combined caller/lifecycle signal. Listeners return void or reject to veto; they must settle their owned work before returning. Rejection releases the claim without publishing completion. No listeners means no verification ran: autonomous operation requires the composition's policy consumers.

`piece/approved`, `piece/blocked`, and `piece/completed` are post-publication `emit` announcements. Completion includes the relocated `newPath`. Cordis propagates a synchronous listener error, stops dispatch at that listener, and does not roll back the published state. It does not await asynchronous listeners; subscribers own their rejected promises. `blocked → todo` has no announcement. These events cannot provide awaited durable persistence.

### Failure and cancellation

Without cancellation, nonzero or signalled command exits raise `PieceMoveFailedError`, retaining the failed `argv`, captured `stderr`, and `pieceId`; its code is `PIECE_MOVE_NOT_TRACKED` for Git tracking refusals and `PIECE_MOVE_FAILED` otherwise. The service selects cancellation or ordinary exit failure only after terminating and joining the managed range. An abort during that wait takes precedence over a nonzero leader exit and preserves the original abort reason. Provider cleanup failures take priority over both: cancellation does not establish that the managed range is empty. This API does not report every command outcome alongside cancellation. An unsuccessful promotion leaves memory pending and emits no completion.

After a successful header edit, any pre-publication failure, including cancellation after `git mv`, triggers a guarded edit restoring the actual previous disk header, not the logical expected status. Recovery uses the forward edit's returned version and never resets the Git index. A recovery conflict or missing source raises `PieceRecoveryFailedError` (`PIECE_RECOVERY_FAILED`), with the initiating error in standard `cause` and the restoration error in `recoveryError`. Inspect the source, destination, and staged changes before retrying; an interrupted move may already have relocated the file.

The optional fifth argument cancels forward work together with lifecycle disposal. Filesystem calls and subprocess requests receive that signal, and disposal awaits active operations. Every command terminates its provider-managed range and awaits `waitForExit()` without the cancelled forward signal, even after the leader's `done` settles. No subsequent command begins before that wait succeeds. Header recovery uses a fresh, non-aborted lifetime and is awaited even after cancellation. Hooks and providers must settle when cancelled; the service does not abandon them to make teardown return early. Cancellation observed before publication prevents completion notification; it does not prove filesystem rollback.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The claim is synchronous, before the first await, while readers continue to see committed memory. Completion checks Git tracking, obtains a filesystem stat version, and edits the actual header through `fs.editText`. The literal edit includes the preceding header to avoid changing a matching example in the body. Already-done headers remain guarded and can be promoted by a live pending retry.

The checked command sequence is tracking → header edit → `git add -u` → `mkdir -p done` → `git mv` → memory publication → announcement. Tracking precedes mutation; `git add -u` cannot start tracking an untracked source. Git stages the header and rename without creating a commit. The filesystem API provides neither directory creation nor rename.

Header editing, Git index changes, file movement, and memory publication are not one transaction. Recovery restores only the owned header; the index can retain staged completion content, and directory creation can remain. A process crash may prevent recovery entirely. The required [00.12 persistence integration](../../../plans/pieces/00-dev-loop/00.12-loop-persistence.md) must reconcile location, header, and durable status and introduce an awaited persistence operation before notification.

No invariant companion is published: legality is enforced directly from one table rather than independently maintained observations. Cross-process file/index/record reconciliation is not supplied by that check. Exact operations and event declarations live in [src/index.ts](src/index.ts); shared event fields live in [src/types.ts](src/types.ts).

</details>

## Model Experience

None, as this host-side state machine registers no tool, prompt, or session event.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

The local operation does not constitute the full autonomous development loop.

- **Integration is required:** human approval (00.03), verification (00.10), persistence/reconciliation (00.12), and claim checks (00.13) remain separate obligations. Passing lifecycle tests proves none of those full-loop requirements.
- **State is process-local:** hydration occurs once at mount, external file edits do not refresh held status, and non-completing transitions do not update disk. There is no durable transition record or restart reconciliation here.
- **Completion is not a document-format validator:** it requires a valid status header but does not revalidate all corpus sections after an external edit. A format policy must be installed on `piece/pre-complete` when required.
- **Recovery is compensating, not atomic:** staged changes can remain after failure. Concurrent edits are protected by filesystem version guards, not by a cross-process Git transaction. Cancellation during movement can leave an uncertain outcome requiring inspection.
- **Completion requires a tracked Git source and a POSIX execution world:** `mkdir -p` is not portable to native Windows. Portable directory creation requires a filesystem capability change.
- **Reopening is unspecified:** 02.04 and the supervisor plan disagree on the target status; `done` stays absorbing until the plan owner resolves that policy.

### Dev Note

None.
