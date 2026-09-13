/**
 * Development-loop piece lifecycle (`ctx.devLoopLifecycle`).
 *
 * This package owns the guarded state machine for a piece's status. The guard
 * lives inside the single writer, so no caller can reach an illegal state, and
 * `transition` takes the expected current status as a compare-and-set argument
 * so two orchestrators cannot both win a race.
 *
 * Reaching `done` moves the piece file into `<set>/done/` with `git mv` through
 * `ctx.subprocess`: the filesystem seam exposes no rename, and the corpus is
 * version-controlled. Completion awaits a serial policy hook, edits and stages
 * the disk header, moves the file, then updates memory and announces it.
 * These operations are not atomic; persistence and crash reconciliation belong
 * to the required 00.12 integration, not to unawaited announcements.
 *
 * Status is held in memory: `getStatus` is synchronous while its only source,
 * `ctx.devLoopDirectory`, reads asynchronously, so the corpus is hydrated once
 * in `[Service.init]`, which cordis awaits before the mount settles.
 *
 * @module @deepseek-ai/dsh-dev-loop-lifecycle
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DONE_DIRECTORY,
  PieceNotFoundError,
  PieceParseError,
} from '@deepseek-ai/dsh-dev-loop-directory'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { PieceCompletedEvent, PiecePreCompleteEvent, StateTransitionEvent } from './types.ts'

export type { PieceCompletedEvent, PiecePreCompleteEvent, StateTransitionEvent } from './types.ts'

/**
 * Legal edges of the piece state machine.
 *
 * `done` has no outgoing edge: reopening is deliberately unspecified, because
 * `02.04` defines it as `done → todo` while `plans/12-supervisor-and-watchdog.md`
 * defines it as `done → blocked`, and no piece may implement a transition two
 * others define differently.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<PieceStatus, readonly PieceStatus[]>> = {
  todo: ['pending'],
  pending: ['done', 'blocked'],
  blocked: ['todo'],
  done: [],
}

/** Deployment budgets, defaulted and validated by the lifecycle's Config schema. */
export interface Config {
  /** Positive integer termination grace in milliseconds, at most the Node timer limit. */
  terminationGraceMs?: number
  /** Positive integer in-memory byte cap for each collected command stream. */
  outputMaxBytes?: number
}

/** Length of the dotted `NN.MM` id a piece filename opens with. */
const PIECE_ID_LENGTH = 5

/**
 * What git says when it refuses a path because the corpus is not a working
 * tree or the file is not in it: `ls-files --error-unmatch` reports the
 * pathspec, `mv` reports version control, and both report a missing
 * repository. Any other failure is a defect of this corpus rather than of its
 * tracking, and is classified generically.
 */
const UNTRACKED_REFUSALS: readonly string[] = [
  'not under version control',
  'not a git repository',
  'did not match any file(s) known to git',
]

declare module '@deepseek-ai/cordis' {
  interface Context {
    devLoopLifecycle: DevLoopLifecycle
  }

  interface Events {
    /**
     * Await completion policy before filesystem or Git work. Listeners return
     * void or reject to veto; an empty listener set enforces no verification.
     * @param event - the claimed request and its cancellation lifetime.
     * @mode serial
     */
    'piece/pre-complete'(event: PiecePreCompleteEvent): void | Promise<void>
    /**
     * A piece was approved at the junction and may enter the dispatch queue.
     * @param event - the recorded transition from `todo` to `pending`.
     * @mode emit
     */
    'piece/approved'(event: StateTransitionEvent): void
    /**
     * A piece completed, published strictly after the move committed.
     * @param event - the transition, carrying the piece's new path under `done/`.
     * @mode emit
     */
    'piece/completed'(event: PieceCompletedEvent): void
    /**
     * A piece was blocked by a failed gate, a failed subagent, or a contradicted claim.
     * @param event - the transition, carrying the recorded reason.
     * @mode emit
     */
    'piece/blocked'(event: StateTransitionEvent): void
  }
}

/** Rejection of a transition the state machine does not permit. */
export class InvalidStateTransitionError extends Error {
  /** Stable code consumers branch on. */
  readonly code = 'INVALID_STATE_TRANSITION'
  /** The piece whose transition was refused. */
  readonly pieceId: string

  /**
   * @param pieceId - the piece whose transition was refused.
   * @param from - the status it currently holds.
   * @param to - the status the caller asked for.
   */
  constructor(pieceId: string, from: PieceStatus, to: PieceStatus) {
    const allowed = LEGAL_TRANSITIONS[from]
    super(`piece "${pieceId}" cannot move from "${from}" to "${to}"; permitted: ${allowed.length === 0 ? 'none, this status is absorbing' : allowed.join(', ')}`)
    this.name = 'InvalidStateTransitionError'
    this.pieceId = pieceId
  }
}

/**
 * Rejection of a transition whose expected status no longer holds, so a second
 * writer cannot overwrite a transition it never observed.
 */
export class StalePieceStatusError extends Error {
  /** Stable code consumers branch on. */
  readonly code = 'PIECE_STALE_STATUS'
  /** The piece whose expected status was stale. */
  readonly pieceId: string

  /**
   * @param pieceId - the piece whose expected status was stale.
   * @param expected - the status the caller believed the piece held.
   * @param actual - the status it actually holds; a transition already
   *   committing presents its target, the status the piece is about to hold.
   */
  constructor(pieceId: string, expected: PieceStatus, actual: PieceStatus) {
    super(`piece "${pieceId}" expected status "${expected}" but holds "${actual}"; re-read before transitioning`)
    this.name = 'StalePieceStatusError'
    this.pieceId = pieceId
  }
}

/** Failure of a completion command, classified from its captured stderr; staged changes may remain. */
export class PieceMoveFailedError extends Error {
  /** `PIECE_MOVE_NOT_TRACKED` when git refused the source, `PIECE_MOVE_FAILED` otherwise. */
  readonly code: 'PIECE_MOVE_NOT_TRACKED' | 'PIECE_MOVE_FAILED'
  /** The piece whose completion was abandoned. */
  readonly pieceId: string
  /** The command as invoked, so the failure is reproducible by hand. */
  readonly argv: readonly string[]
  /** Captured standard error, retained because git explains itself there. */
  readonly stderr: string

  /**
   * @param pieceId - the piece whose completion was abandoned.
   * @param argv - the command as invoked.
   * @param stderr - captured standard error, which decides the code.
   */
  constructor(pieceId: string, argv: readonly string[], stderr: string) {
    const untracked = UNTRACKED_REFUSALS.some(refusal => stderr.includes(refusal))
    super(`piece "${pieceId}" could not be moved into done/: ${untracked ? 'its corpus is not a git working tree, or the file is untracked' : stderr.trim()}`)
    this.code = untracked ? 'PIECE_MOVE_NOT_TRACKED' : 'PIECE_MOVE_FAILED'
    this.name = 'PieceMoveFailedError'
    this.pieceId = pieceId
    this.argv = argv
    this.stderr = stderr
  }
}

/** Header recovery failed; memory stays pending, but disk and index require inspection. */
export class PieceRecoveryFailedError extends Error {
  /** Stable code consumers branch on. */
  readonly code = 'PIECE_RECOVERY_FAILED'

  /**
   * @param pieceId - the piece whose header could not be restored.
   * @param cause - the initiating failure, including a caller's cancellation reason.
   * @param recoveryError - the failed guarded restoration; no rollback is claimed.
   */
  constructor(readonly pieceId: string, cause: unknown, readonly recoveryError: unknown) {
    super(`piece "${pieceId}" header recovery failed; inspect the source, done/ destination and Git index before retrying`, { cause })
    this.name = 'PieceRecoveryFailedError'
  }
}

/**
 * Hydrated state of one piece. `status` is what a reader observes; `claim` is
 * the target of a transition that has been admitted but has not committed yet,
 * so a concurrent caller is rejected while the file is still moving.
 */
interface HydratedPiece {
  /** Committed status, the value {@link DevLoopLifecycle.getStatus} returns. */
  status: PieceStatus
  /** Path the piece file occupies, relative to the filesystem backend's base. */
  path: string
  /** Target of the transition currently committing, or `undefined` when none is. */
  claim: PieceStatus | undefined
}

/**
 * Build the payload one transition announces.
 * @param pieceId - the piece that moved.
 * @param from - the status it held.
 * @param to - the status it now holds.
 * @param reason - why it moved; omitted from the payload when absent, never published as an explicit `undefined`.
 * @returns the event, timestamped at the commit point.
 */
function transitionEvent(pieceId: string, from: PieceStatus, to: PieceStatus, reason: string | undefined): StateTransitionEvent {
  return { pieceId, from, to, timestamp: Date.now(), ...(reason === undefined ? {} : { reason }) }
}

/**
 * The guarded piece state machine.
 *
 * Every status change passes through {@link transition}, which is the only
 * writer, so the legality check cannot be bypassed by a caller reaching around
 * the service.
 */
export class DevLoopLifecycle extends Service {
  static inject = ['devLoopDirectory', 'fs', 'subprocess']
  static Config: z<Config> = z.object({
    terminationGraceMs: z.number().step(1).min(1).max(2_147_483_647).default(5_000),
    outputMaxBytes: z.number().step(1).min(1).default(65_536),
  })

  /** Schemastery supplies both fields before the constructor runs. */
  private readonly config: Required<Config>

  /** Hydrated status per piece id, keyed by the id the piece file declares. */
  private readonly pieces = new Map<string, HydratedPiece>()

  /** Teardown prevents admission and cancels all forward work. */
  private readonly lifetime = new AbortController()
  /** Includes recovery, so disposal cannot leave a compensating edit in flight. */
  private readonly active = new Set<Promise<void>>()

  /**
   * Failure to report for each id whose file the scan rejected, keyed by the
   * id that filename declares. A malformed piece has no status to hydrate, so
   * it is recorded here instead of dropped: a caller must be able to tell
   * "there is no such piece" from "that piece is malformed". The failure is
   * built when the scan observes it, so it carries the findings of that scan
   * rather than of the later read that reports it.
   */
  private readonly unparseable = new Map<string, PieceParseError>()

  /**
   * @param ctx - the mounting context; the directory, filesystem and subprocess services are injected.
   * @param config - process budgets validated and defaulted by Cordis.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopLifecycle')
    this.config = config as Required<Config>
    // Disposal is announced before the kernel joins Service.init; ordinary effects unload afterwards.
    ctx.on('internal/plugin', (fiber) => {
      if (fiber === ctx.fiber && fiber.uid === null) this.lifetime.abort(new Error('piece lifecycle disposed'))
    })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('piece lifecycle disposed'))
      await Promise.allSettled(this.active)
    })
  }

  /**
   * Hydrate every piece of the corpus once, before the mount settles.
   *
   * `getStatus` is synchronous and the directory reads asynchronously, so the
   * whole corpus is read here: a compare-and-set writer must know the current
   * status before its first call, and a synchronous reader cannot await one.
   */
  protected async [Service.init](): Promise<void> {
    const signal = this.lifetime.signal
    signal.throwIfAborted()
    const setNames = await this.ctx.devLoopDirectory.listSets(signal)
    signal.throwIfAborted()
    for (const setName of setNames) {
      const scan = await this.ctx.devLoopDirectory.scanSet(setName, signal)
      signal.throwIfAborted()
      for (const record of scan.pieces) {
        this.pieces.set(record.id, { status: record.status, path: record.path, claim: undefined })
      }
      for (const rejection of scan.rejected) {
        const pieceId = rejection.path.slice(rejection.path.lastIndexOf('/') + 1, rejection.path.lastIndexOf('/') + 1 + PIECE_ID_LENGTH)
        this.unparseable.set(pieceId, new PieceParseError(rejection.path, rejection.code, rejection.findings))
      }
    }
  }

  /**
   * Read a piece's current status.
   * @param pieceId - dotted piece id such as `00.01`.
   * @returns the in-memory status hydrated at mount and updated by this service; external edits are not refreshed.
   * @throws PieceNotFoundError when the corpus declares no such id, and PieceParseError when its file was rejected by the scan.
   */
  getStatus(pieceId: string): PieceStatus {
    return this.requirePiece(pieceId).status
  }

  /**
   * Whether an edge is legal, as a pure predicate callable before mutating, so
   * a caller can pre-check without duplicating the transition table.
   * @param from - the status a piece currently holds.
   * @param to - the status the caller intends.
   * @returns whether the state machine permits that edge.
   */
  canTransition(from: PieceStatus, to: PieceStatus): boolean {
    return LEGAL_TRANSITIONS[from].includes(to)
  }

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
  async transition(pieceId: string, expected: PieceStatus, to: PieceStatus, reason?: string, signal?: AbortSignal): Promise<void> {
    const operationSignal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    operationSignal.throwIfAborted()
    const piece = this.claim(pieceId, expected, to)
    if (to === 'done') {
      // Register before invoking hooks: a hook may synchronously start disposal.
      const operation = Promise.resolve().then(() => this.complete(pieceId, piece, expected, reason, operationSignal))
      this.active.add(operation)
      try {
        await operation
      } finally {
        this.active.delete(operation)
      }
      return
    }
    piece.status = to
    piece.claim = undefined
    const event = transitionEvent(pieceId, expected, to, reason)
    // No announcement is declared for returning a blocked piece to the queue.
    if (to === 'pending') this.ctx.emit('piece/approved', event)
    if (to === 'blocked') this.ctx.emit('piece/blocked', event)
  }

  /**
   * Admit one transition and claim the piece for it.
   * @param pieceId - the piece to claim.
   * @param expected - the status the caller observed.
   * @param to - the status it intends to reach.
   * @returns the hydrated piece, now claimed for `to`.
   */
  private claim(pieceId: string, expected: PieceStatus, to: PieceStatus): HydratedPiece {
    const piece = this.requirePiece(pieceId)
    const held = piece.claim ?? piece.status
    if (held !== expected) throw new StalePieceStatusError(pieceId, expected, held)
    if (!this.canTransition(expected, to)) throw new InvalidStateTransitionError(pieceId, expected, to)
    piece.claim = to
    return piece
  }

  /**
   * Await policy and the completing move before publishing memory and announcing.
   * Failure releases the claim; callers must inspect recovery failures before retrying.
   *
   * @param pieceId - the piece completing.
   * @param piece - its hydrated state, already claimed for `done`.
   * @param from - the status it held, recorded on the event.
   * @param reason - why it completed.
   * @param signal - combined caller and lifecycle cancellation.
   */
  private async complete(
    pieceId: string, piece: HydratedPiece, from: PieceStatus, reason: string | undefined, signal: AbortSignal,
  ): Promise<void> {
    let restoreHeader: (() => Promise<unknown>) | undefined
    let newPath: string
    try {
      signal.throwIfAborted()
      await this.ctx.serial('piece/pre-complete', {
        pieceId, from: 'pending', to: 'done', signal, ...(reason === undefined ? {} : { reason }),
      })
      signal.throwIfAborted()
      const fs = this.ctx.fs
      const path = piece.path
      const separator = path.lastIndexOf('/')
      const setPath = path.slice(0, separator)
      const fileName = path.slice(separator + 1)
      const destination = `${DONE_DIRECTORY}/${fileName}`
      newPath = `${setPath}/${destination}`
      const cwd = fs.processPath(await fs.resolve(setPath, { signal }))
      await this.run(pieceId, ['git', 'ls-files', '--error-unmatch', '--', fileName], cwd, signal)
      signal.throwIfAborted()
      const target = await fs.resolve(path, { signal })
      signal.throwIfAborted()
      const observed = await fs.stat(target, signal)
      signal.throwIfAborted()
      if (observed === undefined) throw new FsError(`piece file "${path}" is absent`, 'FS_NOT_FOUND')
      const content = await fs.readText(target, signal)
      signal.throwIfAborted()
      const section = content.search(/^## /m)
      const header = section < 0 ? content : content.slice(0, section)
      const status = /(?:^|·)[ \t]*\*\*Status:\*\*[ \t]*(todo|pending|done|blocked)(?=[ \t]*(?:·|\r?$))/m.exec(header)
      if (status === null) throw new FsError(`piece file "${path}" has no valid Status header`, 'FS_EDIT_NOT_FOUND')
      // Include the preceding header so a matching example in the body cannot be edited.
      const oldString = content.slice(0, status.index + status[0].length)
      const newString = oldString.replace(/(?:todo|pending|done|blocked)$/, 'done')
      // Already-done headers are guarded too; the resulting token still owns recovery.
      const edited = await fs.editText(target, { oldString, newString, replaceAll: false }, { version: observed.version }, signal)
      restoreHeader = () => fs.editText(target, {
        oldString: newString, newString: oldString, replaceAll: false,
      }, { version: edited.version }, new AbortController().signal)
      await this.run(pieceId, ['git', 'add', '-u', '--', fileName], cwd, signal)
      await this.run(pieceId, ['mkdir', '-p', DONE_DIRECTORY], cwd, signal)
      await this.run(pieceId, ['git', 'mv', '--', fileName, destination], cwd, signal)
      // All pre-publication awaits share the recovery owner, including this final cancellation check.
      signal.throwIfAborted()
    } catch (error) {
      try {
        await restoreHeader?.()
      } catch (recoveryError) {
        throw new PieceRecoveryFailedError(pieceId, error, recoveryError)
      } finally {
        piece.claim = undefined
      }
      throw error
    }
    piece.status = 'done'
    piece.path = newPath
    piece.claim = undefined
    this.ctx.emit('piece/completed', { ...transitionEvent(pieceId, from, 'done', reason), to: 'done', newPath })
  }

  /**
   * Collect the leader's outcome, terminate and join the managed range, then
   * select cancellation or ordinary exit failure. Cleanup failure takes priority.
   * @param pieceId - piece named in command failures.
   * @param argv - executable and arguments; never shell-interpreted.
   * @param cwd - absolute directory in the filesystem backend's execution world.
   * @param signal - aborts the process through the subprocess provider.
   */
  private async run(pieceId: string, argv: readonly string[], cwd: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd,
      signal,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.config.outputMaxBytes },
        stderr: { maxBytes: this.config.outputMaxBytes },
      },
      graceMs: this.config.terminationGraceMs,
    })
    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } finally {
      try {
        handle.terminate()
      } finally {
        await handle.waitForExit()
      }
    }
    signal.throwIfAborted()
    /* v8 ignore next -- the seam presents a reader for every stream spawned in collect mode, and both streams here are. */
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0 || outcome.signal !== null) throw new PieceMoveFailedError(pieceId, argv, stderr)
  }

  /**
   * Read one hydrated piece, or explain which kind of absence this id is.
   * @param pieceId - dotted piece id such as `00.01`.
   * @returns its hydrated state.
   */
  private requirePiece(pieceId: string): HydratedPiece {
    const piece = this.pieces.get(pieceId)
    if (piece === undefined) throw this.absence(pieceId)
    return piece
  }

  /**
   * Classify an id the corpus does not hold: never declared, or declared by a
   * file the scan could not parse.
   * @param pieceId - the id that resolved to no hydrated piece.
   * @returns the error naming that distinction, and the offending file when there is one.
   */
  private absence(pieceId: string): Error {
    return this.unparseable.get(pieceId) ?? new PieceNotFoundError(pieceId)
  }
}

export default DevLoopLifecycle
