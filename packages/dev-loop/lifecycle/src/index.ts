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
 * Required durability records intent before policy or effects and terminal
 * outcome before publication. Recording uncertainty quarantines the piece.
 *
 * `[Service.init]` hydrates committed state before synchronous status reads or
 * admission. Memory mode explicitly omits durable recording and reconciliation.
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
import { DevLoopPersistenceError, observeSource } from '@deepseek-ai/dsh-dev-loop-persistence'
import type { DevLoopPersistence, HumanAuthorization, SourceObservation, TransitionEffects, TransitionId } from '@deepseek-ai/dsh-dev-loop-persistence'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { PieceCompletedEvent, PiecePreCompleteEvent, StateTransitionEvent } from './types.ts'

export type { PieceCompletedEvent, PiecePreCompleteEvent, StateTransitionEvent } from './types.ts'

/**
 * Legal edges of the piece state machine.
 *
 * `done` has no outgoing edge: reopening is deliberately unspecified, because
 * `02.04` defines it as `done → todo` while `archive/plans/12-supervisor-and-watchdog.md`
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
  /** Required mode refuses absent persistence; memory mode is explicitly nondurable. */
  durability?: 'memory' | 'required'
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
  sequence: number
  source?: SourceObservation
  quarantined: boolean
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
    durability: z.union(['memory', 'required']).default('memory'),
    terminationGraceMs: z.number().step(1).min(1).max(2_147_483_647).default(5_000),
    outputMaxBytes: z.number().step(1).min(1).default(65_536),
  })

  /** Schemastery supplies both fields before the constructor runs. */
  private readonly config: Required<Config>

  /** Hydrated status per piece id, keyed by the id the piece file declares. */
  private readonly pieces = new Map<string, HydratedPiece>()
  private persistence: DevLoopPersistence | undefined

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
    if (this.config.durability === 'required') {
      this.persistence = this.ctx.get('devLoopPersistence')
      if (this.persistence === undefined) {
        throw new DevLoopPersistenceError('DEV_LOOP_PERSISTENCE_REQUIRED', 'Required lifecycle durability needs devLoopPersistence')
      }
      const hydration = await this.persistence.loadLifecycle(signal)
      signal.throwIfAborted()
      for (const piece of hydration.pieces) {
        this.pieces.set(piece.pieceId, {
          status: piece.status, path: piece.source.path, source: piece.source,
          sequence: piece.sequence, quarantined: piece.quarantined, claim: undefined,
        })
      }
      return
    }
    const setNames = await this.ctx.devLoopDirectory.listSets(signal)
    signal.throwIfAborted()
    for (const setName of setNames) {
      const scan = await this.ctx.devLoopDirectory.scanSet(setName, signal)
      signal.throwIfAborted()
      for (const record of scan.pieces) {
        this.pieces.set(record.id, { status: record.status, path: record.path, claim: undefined, sequence: 0, quarantined: false })
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
   * @param _authorization - trusted human Consumer acceptance, required for durable todo-to-pending.
   * @returns after terminal recording in required mode, memory publication and synchronous announcement dispatch.
   * @throws Hook, filesystem, command or cancellation errors before publication leave committed memory unchanged.
   * Required-mode recording uncertainty quarantines the piece. Cancellation never cancels terminal recording.
   * Recovery is awaited on a fresh lifetime; PieceRecoveryFailedError retains both failures.
   * A synchronous announcement error propagates after commit without rollback; async listeners are not awaited.
   */
  async transition(
    pieceId: string, expected: PieceStatus, to: PieceStatus, reason?: string, signal?: AbortSignal, _authorization?: HumanAuthorization,
  ): Promise<void> {
    const operationSignal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    operationSignal.throwIfAborted()
    const piece = this.claim(pieceId, expected, to)
    // Register before invoking providers or hooks, which may synchronously dispose this service.
    const operation = Promise.resolve().then(() => this.execute(pieceId, piece, expected, to, reason, operationSignal, _authorization))
    this.active.add(operation)
    try {
      await operation
    } finally {
      this.active.delete(operation)
    }
  }

  /** Read complete source only when the provider's byte count establishes faithful UTF-8 decoding. */
  private async observe(path: string, signal: AbortSignal): Promise<SourceObservation> {
    const fs = this.ctx.fs
    const target = await fs.resolve(path, { signal })
    const before = await fs.stat(target, signal)
    if (before === undefined) throw new FsError(`piece file "${path}" is absent`, 'FS_NOT_FOUND')
    const content = await fs.readText(target, signal)
    const after = await fs.stat(target, signal)
    if (before.size === undefined || before.size !== Buffer.byteLength(content, 'utf8') || after?.version !== before.version) {
      throw new DevLoopPersistenceError('PIECE_REVIEW_STALE', `Cannot establish byte-faithful source for "${path}"`)
    }
    return observeSource(path, content, before.version)
  }

  /** An admitted intent owns terminal recording even after caller cancellation or disposal. */
  private async execute(
    pieceId: string, piece: HydratedPiece, from: PieceStatus, to: PieceStatus,
    reason: string | undefined, signal: AbortSignal, authorization: HumanAuthorization | undefined,
  ): Promise<void> {
    const effects: { -readonly [K in keyof TransitionEffects]: TransitionEffects[K] } = {
      header: 'none', index: 'none', move: 'none', cleanup: 'not-needed',
    }
    const persistence = this.persistence
    let id: TransitionId | undefined
    let source: SourceObservation | undefined
    let newPath = piece.path
    try {
      signal.throwIfAborted()
      if (persistence !== undefined) {
        if (to === 'pending' && authorization === undefined) {
          throw new DevLoopPersistenceError('PIECE_AUTHORIZATION_REQUIRED', `Piece "${pieceId}" requires human acceptance`)
        }
        source = await this.observe(piece.path, signal)
        const reviewed = to === 'pending' ? authorization?.source : to === 'done' ? piece.source : undefined
        if (reviewed !== undefined && (reviewed.path !== source.path || reviewed.rawDigest !== source.rawDigest
          || reviewed.contentDigest !== source.contentDigest || (to === 'pending' && reviewed.version !== source.version))) {
          throw new DevLoopPersistenceError('PIECE_REVIEW_STALE', `Piece "${pieceId}" differs from its accepted source`)
        }
        const separator = piece.path.lastIndexOf('/')
        const destinationPath = to === 'done'
          ? `${piece.path.slice(0, separator)}/${DONE_DIRECTORY}/${piece.path.slice(separator + 1)}` : piece.path
        try {
          id = await persistence.beginTransition({
            pieceId, expected: from, from, to, source, destinationPath, sequence: piece.sequence + 1,
            signal, ...(reason === undefined ? {} : { reason }), ...(authorization === undefined ? {} : { authorization }),
          })
        } catch (error) {
          if (error instanceof DevLoopPersistenceError) throw error
          throw new DevLoopPersistenceError('DEV_LOOP_INTENT_WRITE_FAILED', `Cannot record intent for "${pieceId}"`, effects, { cause: error })
        }
        piece.sequence++
      }
      signal.throwIfAborted()
      if (to === 'done') {
        const completed = await this.complete(pieceId, piece, reason, signal, effects, source)
        newPath = completed.path
        source = completed.source
      }
      signal.throwIfAborted()
      if (persistence !== undefined && id !== undefined) {
        const terminalSource = await this.observe(newPath, signal)
        if (source !== undefined && (terminalSource.contentDigest !== source.contentDigest
          || terminalSource.rawDigest !== source.rawDigest)) {
          throw new DevLoopPersistenceError('PIECE_REVIEW_STALE', `Piece "${pieceId}" changed during its transition`)
        }
        source = terminalSource
      }
    } catch (error) {
      if (effects.move !== 'none' || effects.header === 'unknown' || effects.index === 'unknown'
        || effects.cleanup === 'failed' || effects.cleanup === 'unknown') piece.quarantined = persistence !== undefined
      try {
        if (persistence !== undefined && id !== undefined) {
          await this.recordTerminal(persistence, id, { kind: 'failed', code: error instanceof Error && 'code' in error ? String(error.code) : 'PIECE_TRANSITION_FAILED', effects }, piece)
        }
      } finally {
        piece.claim = undefined
      }
      throw error
    }
    try {
      if (persistence !== undefined && id !== undefined && source !== undefined) {
        await this.recordTerminal(persistence, id, { kind: 'committed', source, effects }, piece)
      }
    } finally {
      piece.claim = undefined
    }
    piece.status = to
    piece.path = newPath
    if (source !== undefined) piece.source = source
    const event = transitionEvent(pieceId, from, to, reason)
    if (to === 'done') this.ctx.emit('piece/completed', { ...event, to: 'done', newPath })
    if (to === 'pending') this.ctx.emit('piece/approved', event)
    if (to === 'blocked') this.ctx.emit('piece/blocked', event)
  }

  /** Recording uncertainty leaves the intent unresolved and forbids further admission. */
  private async recordTerminal(
    persistence: DevLoopPersistence, id: TransitionId,
    observation: import('@deepseek-ai/dsh-dev-loop-persistence').TransitionObservation, piece: HydratedPiece,
  ): Promise<void> {
    try {
      await persistence.finishTransition(id, observation)
    } catch (error) {
      piece.quarantined = true
      if (error instanceof DevLoopPersistenceError) throw error
      throw new DevLoopPersistenceError('DEV_LOOP_TERMINAL_WRITE_FAILED', 'Cannot record lifecycle terminal outcome', observation.effects, { cause: error })
    }
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
    if (piece.claim !== undefined || held !== expected) throw new StalePieceStatusError(pieceId, expected, held)
    if (!this.canTransition(expected, to)) throw new InvalidStateTransitionError(pieceId, expected, to)
    piece.claim = to
    return piece
  }

  /** Locate Directory's last initial Status field; fenced headings do not end the header. */
  private headerStatus(content: string): { start: number; end: number } | undefined {
    let offset = 0
    let replacement: { start: number; end: number } | undefined
    let fence: string | undefined
    for (const physical of content.split(/(?<=\n)/u)) {
      const line = physical.replace(/\r?\n$/u, '')
      const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
      if (fence !== undefined) {
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      } else if (marker !== undefined) {
        fence = marker
      } else if (line.startsWith('## ')) {
        break
      }
      let segmentOffset = 0
      for (const segment of line.split('·')) {
        const match = /^(\s*\*\*Status:\*\*\s*)(todo|pending|blocked|done)(\s*)$/u.exec(segment)
        const prefix = match?.[1]
        const status = match?.[2]
        if (prefix !== undefined && status !== undefined) {
          const start = offset + segmentOffset + prefix.length
          replacement = { start, end: start + status.length }
        }
        segmentOffset += segment.length + 1
      }
      offset += physical.length
    }
    return replacement
  }

  /**
   * Await policy and the completing move, retaining independent effect and restoration facts.
   * The caller owns the claim through terminal recording and publication.
   *
   * @param pieceId - the piece completing.
   * @param piece - its hydrated state, already claimed for `done`.
   * @param reason - why it completed.
   * @param signal - combined caller and lifecycle cancellation.
   */
  private async complete(
    pieceId: string, piece: HydratedPiece, reason: string | undefined, signal: AbortSignal,
    effects: { -readonly [K in keyof TransitionEffects]: TransitionEffects[K] },
    source: SourceObservation | undefined,
  ): Promise<{ path: string; source: SourceObservation | undefined }> {
    let restoreHeader: (() => Promise<unknown>) | undefined
    let newPath: string
    let terminalSource: SourceObservation | undefined
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
      if (source !== undefined && (observed.size === undefined || observed.size !== Buffer.byteLength(content, 'utf8')
        || observed.version !== source.version || observeSource(path, content, observed.version).rawDigest !== source.rawDigest)) {
        throw new DevLoopPersistenceError('PIECE_REVIEW_STALE', `Piece "${pieceId}" changed before its header edit`)
      }
      const status = this.headerStatus(content)
      if (status === undefined) throw new FsError(`piece file "${path}" has no valid Status header`, 'FS_EDIT_NOT_FOUND')
      // The complete prefix distinguishes the parsed header from repeated body examples.
      const oldString = content.slice(0, status.end)
      const newString = content.slice(0, status.start) + 'done'
      // Already-done headers are guarded too; the resulting token still owns recovery.
      const edit = fs.editText(target, { oldString, newString, replaceAll: false }, { version: observed.version }, signal)
      const edited = await edit.catch(async (error: unknown) => {
        if (source !== undefined) {
          effects.header = 'unknown'
          effects.cleanup = 'unknown'
          let current: SourceObservation | undefined
          try {
            current = await this.observe(path, new AbortController().signal)
          } catch {
            // A failed observation cannot establish whether the rejected edit changed bytes.
          }
          if (current?.rawDigest === source.rawDigest) {
            effects.header = 'none'
            effects.cleanup = 'not-needed'
          } else if (current !== undefined
            && current.rawDigest === observeSource(path, newString + content.slice(oldString.length), current.version).rawDigest) {
            effects.header = 'applied'
            restoreHeader = () => fs.editText(target, {
              oldString: newString, newString: oldString, replaceAll: false,
            }, { version: current.version }, new AbortController().signal)
          }
        }
        throw error
      })
      effects.header = 'applied'
      if (source !== undefined) terminalSource = observeSource(newPath, newString + content.slice(oldString.length), edited.version)
      restoreHeader = () => fs.editText(target, {
        oldString: newString, newString: oldString, replaceAll: false,
      }, { version: edited.version }, new AbortController().signal)
      await this.run(pieceId, ['git', 'add', '-u', '--', fileName], cwd, signal, (value) => { effects.index = value })
      await this.run(pieceId, ['mkdir', '-p', DONE_DIRECTORY], cwd, signal)
      await this.run(pieceId, ['git', 'mv', '--', fileName, destination], cwd, signal, (value) => { effects.move = value })
      // All pre-publication awaits share the recovery owner, including this final cancellation check.
      signal.throwIfAborted()
    } catch (error) {
      try {
        if ((this.persistence === undefined || effects.move === 'none') && restoreHeader !== undefined) {
          await restoreHeader()
          effects.cleanup = 'restored'
        }
      } catch (recoveryError) {
        effects.cleanup = 'failed'
        throw new PieceRecoveryFailedError(pieceId, error, recoveryError)
      }
      throw error
    }
    return { path: newPath, source: terminalSource }
  }

  /**
   * Collect the leader's outcome, terminate and join the managed range, then
   * select cancellation or ordinary exit failure. Cleanup failure takes priority.
   * @param pieceId - piece named in command failures.
   * @param argv - executable and arguments; never shell-interpreted.
   * @param cwd - absolute directory in the filesystem backend's execution world.
   * @param signal - aborts the process through the subprocess provider.
   */
  private async run(
    pieceId: string, argv: readonly string[], cwd: string, signal: AbortSignal,
    effect?: (value: 'applied' | 'unknown') => void,
  ): Promise<void> {
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
      effect?.(outcome.exitCode === 0 && outcome.signal === null ? 'applied' : 'unknown')
    } catch (error) {
      effect?.('unknown')
      throw error
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
    if (piece.quarantined) throw new DevLoopPersistenceError('PIECE_QUARANTINED', `Piece "${pieceId}" requires inspection before admission`)
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
