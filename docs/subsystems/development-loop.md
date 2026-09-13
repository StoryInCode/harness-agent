# Development loop

## Summary

Discover development-loop piece specifications, inspect validation results, and request guarded status changes. This reference owns the shared types and Cordis API of [packages/dev-loop](../../packages/dev-loop/README.md). The directory reads files; the lifecycle service holds process-local status and promotes completed files through Git. Neither service supplies human approval enforcement, durable transition records, or a complete autonomous development loop.

## Table of Contents

- [Directory values](#directory-values)
- [Lifecycle state](#lifecycle-state)
- [Completion and events](#completion-and-events)
- [Failure and cancellation](#failure-and-cancellation)
- [Cordis API](#cordis-surface)
- [Dev Note](#dev-note)

-----

## Directory values

The [directory type declarations](../../packages/dev-loop/directory/src/types.ts) define parsed records and per-file validation results. Directory configuration and the accepted file grammar belong to the [directory package](../../packages/dev-loop/directory/README.md#use-this-package).

| Type | Meaning |
|---|---|
| `PieceStatus` | Closed status union: `todo`, `pending`, `done`, or `blocked`. A directory record reports the file's declared status, not the lifecycle service's current memory. |
| `PieceMetadata` | Header metadata: dotted id, title, set, set-local queue position, dependency ids, status, Harness primitive, and owning package. |
| `PieceRecord` | Validated metadata plus source path, physical line count, summary, extracted `PieceScenario` values, and non-blocking warnings. |
| `PieceScenario` | One extracted Given/When/Then scenario, with `given`, `when`, and `then` text in document order. |
| `PieceFinding` | A machine-readable `PieceFindingCode`, `PieceFindingSeverity` (`blocker` or `warning`), and explanation. Blockers reject a file; warnings accompany an accepted record. |
| `PieceRejection` | Rejected path, first blocking code, and all findings. |
| `SetScan` | Accepted `pieces`, sorted by queue then id, alongside `rejected` files in scan order. |

A scan combines a set directory and its `done/` child. Malformed files remain visible as rejections without withholding valid siblings; missing sets, duplicate ids among accepted records, and filesystem failures still reject the request. Single-piece lookup distinguishes an absent id from its rejected file. Queue candidates include only valid `todo` and `pending` records; selection alone proves neither dependency completion nor approval.

## Lifecycle state

The lifecycle service hydrates valid records once during mounting. `getStatus` reads committed memory, not a fresh directory scan; external edits do not refresh it. Rejected files retain their parse errors instead of acquiring a status.

`LEGAL_TRANSITIONS` permits `todo → pending`, `pending → done`, `pending → blocked`, and `blocked → todo`. `done` has no outgoing edge. `transition` requires the expected status and claims the piece before asynchronous work; stale or competing claims reject. Readers continue to see committed status while completion is in flight. Non-completing transitions change memory only, so logical `pending` can coexist with a disk header declaring `todo`.

## Completion and events

The [lifecycle type declarations](../../packages/dev-loop/lifecycle/src/types.ts) distinguish a cancellable request from a published result.

| Type | Meaning |
|---|---|
| `PiecePreCompleteEvent` | Uncommitted `pending → done` request: piece id, optional reason, and combined caller/lifecycle `AbortSignal`. It carries no committed timestamp or destination. |
| `StateTransitionEvent` | In-memory transition: piece id, `from`, `to`, epoch-millisecond timestamp at publication, optional reason, and optional relocated path. It is not a durable record. |
| `PieceCompletedEvent` | A `StateTransitionEvent` narrowed to `to: 'done'` with required `newPath`. |

`piece/pre-complete` is awaited serial policy before completion touches files or Git. Listeners return void or reject to veto and must settle their owned work before returning. An empty listener set performs no verification. The lifecycle service does not enforce human approval merely because a transition emits `piece/approved`.

Completion requires a tracked source, edits its actual disk header to `done` using a filesystem version guard, stages the edited file, and moves it into the set's `done/` directory. Memory publication and `piece/completed` follow successful movement; Git staging creates no commit. Header edits, index updates, movement, and memory publication are not atomic.

`piece/approved`, `piece/blocked`, and `piece/completed` use `emit` after memory publication. Synchronous listener errors propagate without rollback; asynchronous listeners are not awaited. These announcements cannot provide awaited persistence. `blocked → todo` has no announcement, and the service does not require a non-empty blocking reason.

## Failure and cancellation

Pre-publication failures leave memory unchanged and release the claim. Every failure after the header edit and before publication attempts to restore only the previous disk header with the forward edit's returned version, including cancellation after successful movement; recovery does not reset the Git index. `PieceRecoveryFailedError` retains both failures and requires inspection of the source, destination, and index before retrying. A cancelled or interrupted move does not prove rollback.

Caller cancellation and lifecycle disposal cancel forward work. Disposal signals startup listing or scanning before joining initialization, and awaits active completion work including header recovery on a fresh lifetime. Each command terminates and awaits its provider-managed process range rather than treating leader exit as quiescence; hooks and providers must settle their operations. The [lifecycle package](../../packages/dev-loop/lifecycle/README.md#failure-and-cancellation) owns the error codes and recovery details; its [limitations](../../packages/dev-loop/lifecycle/README.md#known-limitations-and-deferred-work) cover restart reconciliation, policy integration, and the POSIX command requirement.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevloopdirectory--devloopdirectory"></a>

### `ctx.devLoopDirectory` — `DevLoopDirectory`

Reads and validates the piece corpus.

A set's pieces live in `<root>/<set>` until they complete, then move to `<root>/<set>/done` per `R-done-pieces-moved`; every read merges both so the directory stays the whole-set view regardless of completion state.

```ts cordis-catalog
/**
 * Validate one piece file's text without reading the filesystem.
 * @param filePath - path the content came from, reported in findings.
 * @param content - complete file text.
 * @returns the validated record, carrying any warnings.
 */
validate(filePath: string, content: string): PieceRecord

/**
 * Read every piece of one set, pending and completed together.
 *
 * A file this parser rejects is reported in `rejected` rather than thrown, so
 * one malformed piece never denies the caller the rest of its set. The defects
 * that still throw belong to the request or the set as a whole rather than to
 * one file's contents: an unmatched set name, and one id owned by two files.
 *
 * @param setName - set directory name such as `00-dev-loop`.
 * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
 * @returns the parsed records ordered by queue position then by id, beside every rejected file.
 */
async scanSet(setName: string, signal?: AbortSignal): Promise<SetScan>

/**
 * List the set directories under the configured root, in name order.
 *
 * Only direct subdirectories of the root are sets: a file beside them is not
 * one, a set's own `done/` subdirectory lives one level deeper and is part of
 * its set, and no listing recurses. A root holding no set directory returns an
 * empty list, which is the answer for an empty corpus; a configured root that
 * does not exist is misconfiguration and rejects, as reading it as "no work"
 * would idle every consumer silently.
 *
 * @param signal - aborts root resolution and listing; cancellation after resolution prevents the listing.
 * @returns every set directory name under the root, sorted by name.
 */
async listSets(signal?: AbortSignal): Promise<string[]>

/**
 * Select the pieces available for dispatch: those declaring `todo` or
 * `pending`. A `done` piece stays resolvable through {@link getPiece} but is
 * never a candidate, and a `blocked` piece is excluded because it waits on a
 * human decision rather than on a dispatch slot. Selection reads the valid
 * pieces of every set it scans, so a malformed file elsewhere in the corpus
 * withholds only itself.
 * @param setName - set to select from; omitted selects across every set. An unmatched name rejects with {@link SetNotFoundError}.
 * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
 * @returns candidates ordered by queue position then id within one set, and by set before
 * queue when selecting across every set, because queue numbers are set-local.
 */
async getQueueCandidates(setName?: string, signal?: AbortSignal): Promise<PieceRecord[]>

/**
 * Read one piece by id, searching the set directory its id prefix names.
 *
 * A malformed sibling never decides this call: the parse failure surfaces
 * only when the requested id owns the rejected file, which its filename
 * declares.
 *
 * @param id - dotted piece id such as `00.01`.
 * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
 * @returns the validated record.
 * @throws PieceParseError when the requested id's own file failed to parse.
 */
async getPiece(id: string, signal?: AbortSignal): Promise<PieceRecord>
```

Source: [`packages/dev-loop/directory/src/index.ts`](../../packages/dev-loop/directory/src/index.ts)

<a id="ctxdevlooplifecycle--devlooplifecycle"></a>

### `ctx.devLoopLifecycle` — `DevLoopLifecycle`

The guarded piece state machine.

Every status change passes through transition, which is the only writer, so the legality check cannot be bypassed by a caller reaching around the service.

```ts cordis-catalog
/**
 * Read a piece's current status.
 * @param pieceId - dotted piece id such as `00.01`.
 * @returns the in-memory status hydrated at mount and updated by this service; external edits are not refreshed.
 * @throws PieceNotFoundError when the corpus declares no such id, and PieceParseError when its file was rejected by the scan.
 */
getStatus(pieceId: string): PieceStatus

/**
 * Whether an edge is legal, as a pure predicate callable before mutating, so
 * a caller can pre-check without duplicating the transition table.
 * @param from - the status a piece currently holds.
 * @param to - the status the caller intends.
 * @returns whether the state machine permits that edge.
 */
canTransition(from: PieceStatus, to: PieceStatus): boolean

/**
 * Move a piece to a new status, committing any completing move first.
 *
 * The claim on `expected` is taken synchronously, before the first `await`,
 * so two callers that both observed the same status cannot both reach the
 * move: the second one rejects while the first is still committing.
 *
 * @param pieceId - dotted piece id such as `00.01`.
 * @param expected - the status the caller observed; a mismatch rejects with {@link StalePieceStatusError}.
 * @param to - the status to move to.
 * @param reason - why the transition happened; recorded on the event.
 * @param signal - optional caller cancellation, combined with lifecycle disposal.
 * @returns after memory publication and synchronous announcement dispatch; no durable record is written.
 * @throws Hook, filesystem, command or cancellation errors before publication leave memory unchanged.
 * Recovery is awaited on a fresh lifetime; PieceRecoveryFailedError retains both failures.
 * A synchronous announcement error propagates after commit without rollback; async listeners are not awaited.
 */
async transition(pieceId: string, expected: PieceStatus, to: PieceStatus, reason?: string, signal?: AbortSignal): Promise<void>
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="piece-events"></a>

### `piece/*` events

<a id="pieceapproved--emit"></a>

#### `piece/approved` — emit

A piece was approved at the junction and may enter the dispatch queue.

```ts cordis-catalog
/**
 * A piece was approved at the junction and may enter the dispatch queue.
 * @param event - the recorded transition from `todo` to `pending`.
 * @mode emit
 */
'piece/approved'(event: StateTransitionEvent): void
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="pieceblocked--emit"></a>

#### `piece/blocked` — emit

A piece was blocked by a failed gate, a failed subagent, or a contradicted claim.

```ts cordis-catalog
/**
 * A piece was blocked by a failed gate, a failed subagent, or a contradicted claim.
 * @param event - the transition, carrying the recorded reason.
 * @mode emit
 */
'piece/blocked'(event: StateTransitionEvent): void
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="piececompleted--emit"></a>

#### `piece/completed` — emit

A piece completed, published strictly after the move committed.

```ts cordis-catalog
/**
 * A piece completed, published strictly after the move committed.
 * @param event - the transition, carrying the piece's new path under `done/`.
 * @mode emit
 */
'piece/completed'(event: PieceCompletedEvent): void
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="piecepre-complete--serial"></a>

#### `piece/pre-complete` — serial

Await completion policy before filesystem or Git work. Listeners return void or reject to veto; an empty listener set enforces no verification.

```ts cordis-catalog
/**
 * Await completion policy before filesystem or Git work. Listeners return
 * void or reject to veto; an empty listener set enforces no verification.
 * @param event - the claimed request and its cancellation lifetime.
 * @mode serial
 */
'piece/pre-complete'(event: PiecePreCompleteEvent): void | Promise<void>
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Dev Note

None.
