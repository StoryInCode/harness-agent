/** Authoritative write-ahead lifecycle history and observation-only recovery. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createHash, randomUUID } from 'node:crypto'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { persistenceDomain } from './records.ts'
import { readLocalPieces } from './reconcile.ts'
import type {
  AnomalyId, AnomalyKind, BeginTransitionRequest, Config, LifecycleHydration, PersistenceErrorCode,
  ReconciliationAcknowledgment, ReconciliationAnomaly, RecoveryInvocation, RepositoryId,
  SourceObservation, TransitionEffects, TransitionId, TransitionObservation, TransitionRecord,
} from './types.ts'
import '@deepseek-ai/dsh-storage-domain'
import '@deepseek-ai/dsh-dev-loop-directory'
import '@deepseek-ai/dsh-fs'

export type * from './types.ts'
export { observeSource } from './source.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopPersistence: DevLoopPersistence }
}

/** Recording rejection discloses independent filesystem uncertainty. */
export class DevLoopPersistenceError extends Error {
  /**
   * @param code - Stable operational rejection code.
   * @param message - Failure description.
   * @param effects - Independent forward-effect and cleanup observations, when known.
   * @param options - Underlying failure retained as the cause.
   */
  constructor(readonly code: PersistenceErrorCode, message: string, readonly effects?: TransitionEffects, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DevLoopPersistenceError'
  }
}

const noEffects: TransitionEffects = { header: 'none', index: 'none', move: 'none', cleanup: 'not-needed' }
const settled = () => {}
function sameBytes(a: SourceObservation, b: SourceObservation): boolean {
  return a.path === b.path && a.rawDigest === b.rawDigest && a.contentDigest === b.contentDigest
}

/** Sole dev_loop writer; activation waits for validated authoritative storage. */
export class DevLoopPersistence extends Service {
  static inject = ['storageDomain', 'devLoopDirectory', 'fs']
  static Config: z<Config> = z.object({
    repositoryRoot: z.string().required(),
    maxRecordBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    maxHistoryRecords: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  })

  private domain!: Domain<typeof persistenceDomain>
  private repositoryId!: RepositoryId
  private chain: Promise<void> = Promise.resolve()
  private draining = false
  private disposed = false
  private readonly attempted = new Set<TransitionId>()

  /**
   * @param ctx - Mounting context providing storageDomain, Directory, and filesystem services.
   * @param config - Explicit repository identity and retained-record budgets.
   */
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'devLoopPersistence') }

  async [Service.init](): Promise<void> {
    for (const key of ['maxRecordBytes', 'maxHistoryRecords'] as const) {
      if (!Number.isSafeInteger(this.config[key]) || this.config[key] < 1) throw new Error(`${key} must be a positive safe integer`)
    }
    const root = this.ctx.fs.processPath(await this.ctx.fs.resolve(this.config.repositoryRoot))
    this.repositoryId = createHash('sha256').update(root).digest('hex') as RepositoryId
    this.domain = await this.ctx.storageDomain.open(persistenceDomain)
    this.ctx.effect(() => async () => {
      this.draining = true
      // A caller that never reaches finishTransition (for example, a consumer that
      // drops the recording obligation after beginTransition) leaves an intent
      // permanently unattempted; drain joins in-flight recording but terminates
      // once a stable chain shows the same unresolved intents across a full pass,
      // because any arriving attempt reassigns the chain.
      let stalled: string | undefined
      for (;;) {
        const chain = this.chain
        await chain
        const pending = [...this.domain.table('transitions').entries()]
          .filter(([, row]) => row.terminal === undefined && !this.attempted.has(row.id))
          .map(([, row]) => row.id)
          .sort()
          .join(',')
        if (this.chain !== chain) { stalled = undefined; continue }
        if (pending === '' || pending === stalled) break
        stalled = pending
      }
      this.disposed = true
      await this.domain.close()
    })
    for (const table of ['transitions', 'anomalies'] as const) {
      for (const [key, row] of this.domain.table(table).entries()) {
        if (key !== row.id) throw new Error(`invalid-record: ${table} key conflicts with record id`)
        if (row.repositoryId !== this.repositoryId) throw new DevLoopPersistenceError('DEV_LOOP_REPOSITORY_MISMATCH', 'Stored repository identity differs from repositoryRoot')
        this.bound(row)
      }
    }
    const ids = new Set([...this.domain.table('transitions').entries()].map(([, row]) => row.pieceId))
    for (const id of ids) {
      const history = this.history(id)
      if (history.length > this.config.maxHistoryRecords) throw new DevLoopPersistenceError('DEV_LOOP_HISTORY_LIMIT', `History exceeds maxHistoryRecords for ${id}`)
      let status: TransitionRecord['from'] = 'todo'
      for (const [index, row] of history.entries()) {
        if (row.sequence !== index + 1 || row.from !== status) throw new Error(`invalid-record: transitions contain inconsistent sequence or state for ${id}`)
        if (row.terminal?.kind === 'committed') status = row.to
        if (row.terminal === undefined && index !== history.length - 1) throw new Error('invalid-record: transition follows unresolved intent')
      }
    }
  }

  private bound(row: unknown, effects?: TransitionEffects): void {
    if (Buffer.byteLength(JSON.stringify(row), 'utf8') > this.config.maxRecordBytes) {
      throw new DevLoopPersistenceError('DEV_LOOP_RECORD_TOO_LARGE', 'Complete record exceeds maxRecordBytes', effects)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new DevLoopPersistenceError('DEV_LOOP_DISPOSED', 'Persistence is disposed'))
    const result = this.chain.then(operation)
    this.chain = result.then(settled, settled)
    return result
  }

  private history(pieceId: string): TransitionRecord[] {
    return [...this.domain.table('transitions').entries()].map(([, row]) => row)
      .filter(row => row.pieceId === pieceId).sort((a, b) => a.sequence - b.sequence)
  }

  /**
   * Reconcile local files with committed history and durably retain new anomalies before Lifecycle admission.
   * Existing anomalies continue to quarantine their pieces; acknowledgment never changes that decision.
   * @param signal - Cancels filesystem reads; anomaly writes already admitted are not cancelled.
   * @returns Detached committed state, observed sources, and unresolved discrepancies after anomaly durability.
   * @throws On unreadable or byte-unfaithful source, storage or record-bound failure, or disposed service.
   */
  loadLifecycle(signal: AbortSignal): Promise<LifecycleHydration> {
    return this.enqueue(async () => {
      const local = await readLocalPieces(this.ctx, signal)
      const ids = new Set([...local.map(row => row.pieceId), ...[...this.domain.table('transitions').entries()].map(([, row]) => row.pieceId),
        ...[...this.domain.table('anomalies').entries()].map(([, row]) => row.pieceId)])
      const pieces: LifecycleHydration['pieces'][number][] = []
      const unresolvedIntentIds: TransitionId[] = []
      for (const pieceId of [...ids].sort()) {
        const files = local.filter(row => row.pieceId === pieceId)
        const observations = files.map(row => row.source)
        const history = this.history(pieceId)
        const last = history.at(-1)
        const committed = history.filter(row => row.terminal?.kind === 'committed').at(-1)
        const status = committed?.to ?? 'todo'
        const reference = committed?.terminal?.source ?? last?.source
        const kinds: { kind: AnomalyKind; transitionId?: TransitionId }[] = []
        for (const row of history) {
          if (row.terminal === undefined) {
            unresolvedIntentIds.push(row.id)
            kinds.push({ kind: 'unresolved-intent', transitionId: row.id })
          } else if (row.terminal.kind === 'failed' && (row.terminal.effects.move !== 'none'
            || row.terminal.effects.header === 'unknown' || row.terminal.effects.index === 'unknown'
            || row.terminal.effects.cleanup === 'failed' || row.terminal.effects.cleanup === 'unknown')) {
            kinds.push({ kind: 'uncertain-effect', transitionId: row.id })
          }
        }
        if (files.length === 0) kinds.push({ kind: 'missing-source' })
        else if (files.length > 1) kinds.push({ kind: 'duplicate-source' })
        else {
          const file = files[0]
          if (!file) throw new Error('Local piece observation is absent')
          if (reference && (!file.valid || !sameBytes(reference, file.source))) kinds.push({ kind: 'source-changed' })
          const donePath = /\/done\/[^/]+$/.test(file.source.path)
          if (!committed && (file.status === 'done' || donePath)) kinds.push({ kind: 'unjournaled-done' })
          else if (!file.valid || (status === 'done') !== donePath || file.status !== (status === 'done' ? 'done' : 'todo')) {
            kinds.push({ kind: 'status-path-mismatch' })
          }
        }
        for (const fact of kinds) {
          const previous = [...this.domain.table('anomalies').entries()].map(([, row]) => row).find(row =>
            row.pieceId === pieceId && row.kind === fact.kind && row.transitionId === fact.transitionId
            && row.observations.length === observations.length
            && row.observations.every((source, index) => {
              const current = observations[index]
              return current !== undefined && sameBytes(source, current) && source.version === current.version
            }))
          if (previous) continue
          const anomaly: ReconciliationAnomaly = { id: `dla-${randomUUID()}` as AnomalyId, repositoryId: this.repositoryId,
            pieceId, ...fact, observations, observedAt: Date.now(), acknowledgments: [] }
          this.bound(anomaly)
          await this.domain.table('anomalies').put(anomaly.id, anomaly)
        }
        const quarantined = [...this.domain.table('anomalies').entries()].some(([, row]) => row.pieceId === pieceId)
        const source = files[0]?.source ?? reference ?? [...this.domain.table('anomalies').entries()].find(([, row]) => row.pieceId === pieceId)?.[1].observations[0]
        if (source) pieces.push({ pieceId, status, source, sequence: last?.sequence ?? 0, quarantined })
      }
      return structuredClone({ pieces, unresolvedIntentIds, anomalies: this.anomalies() })
    })
  }

  /**
   * Record an intent before the caller performs policy or filesystem effects; the caller retains its claim until terminal settlement.
   * @param request - Held CAS, next sequence, current source, trusted authorization, and pre-write cancellation signal.
   * @returns Intent id only after the complete row is durable; cancellation during the write does not retract it.
   * @throws On quarantine, stale state or source, missing authorization, exhausted budgets, disposal, or intent write failure.
   */
  beginTransition(request: BeginTransitionRequest): Promise<TransitionId> {
    if (this.draining) return Promise.reject(new DevLoopPersistenceError('DEV_LOOP_DISPOSED', 'Persistence is disposing'))
    const { signal, ...facts } = request
    const retained = structuredClone(facts)
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const history = this.history(retained.pieceId)
      if (history.some(row => row.terminal === undefined) || this.anomalies().some(row => row.pieceId === retained.pieceId)) {
        throw new DevLoopPersistenceError('PIECE_QUARANTINED', 'Piece has unresolved durable observations')
      }
      const committed = history.filter(row => row.terminal?.kind === 'committed').at(-1)
      if (retained.from !== (committed?.to ?? 'todo') || retained.expected !== retained.from
        || !['todo:pending', 'pending:blocked', 'pending:done', 'blocked:todo'].includes(`${retained.from}:${retained.to}`)) {
        throw new DevLoopPersistenceError('DEV_LOOP_SEQUENCE_CONFLICT', 'Expected state conflicts with committed history')
      }
      if (retained.from === 'todo' && retained.authorization === undefined) throw new DevLoopPersistenceError('PIECE_AUTHORIZATION_REQUIRED', 'Acceptance requires human authorization')
      if (retained.authorization && (!sameBytes(retained.source, retained.authorization.source)
        || retained.source.version !== retained.authorization.source.version)) {
        throw new DevLoopPersistenceError('PIECE_REVIEW_STALE', 'Authorization does not identify current source')
      }
      if (retained.to === 'done' && committed?.terminal?.source && !sameBytes(retained.source, committed.terminal.source)) {
        throw new DevLoopPersistenceError('PIECE_REVIEW_STALE', 'Completion source differs from accepted source')
      }
      if (history.length >= this.config.maxHistoryRecords) throw new DevLoopPersistenceError('DEV_LOOP_HISTORY_LIMIT', 'History exceeds maxHistoryRecords')
      if (retained.sequence !== (history.at(-1)?.sequence ?? 0) + 1) throw new DevLoopPersistenceError('DEV_LOOP_SEQUENCE_CONFLICT', 'Transition sequence is not the next admitted intent')
      const row: TransitionRecord = { id: `dlt-${randomUUID()}` as TransitionId, repositoryId: this.repositoryId, ...retained, startedAt: Date.now() }
      this.bound(row)
      try { await this.domain.table('transitions').put(row.id, row) }
      catch (cause) { throw new DevLoopPersistenceError('DEV_LOOP_INTENT_WRITE_FAILED', 'Intent write failed before effects', noEffects, { cause }) }
      return row.id
    })
  }

  /**
   * Durably append a terminal to its intent row before Lifecycle publishes success or releases its claim.
   * This recording obligation has no cancellation signal; callers must join it before disposing their persistence dependency.
   * @param id - Existing unresolved intent id.
   * @param observation - Actual terminal facts from Lifecycle, never model input.
   * @returns Resolution after the complete terminal row is durable.
   * @throws On absent or already-terminal intent, record overflow, disposal, or terminal write failure; recording failures retain effects.
   */
  finishTransition(id: TransitionId, observation: TransitionObservation): Promise<void> {
    const retained = structuredClone(observation)
    return this.enqueue(async () => {
      this.attempted.add(id)
      const row = this.domain.table('transitions').get(id)
      if (!row || row.terminal) throw new DevLoopPersistenceError('DEV_LOOP_TERMINAL_CONFLICT', 'Intent is absent or already terminal', retained.effects)
      const complete: TransitionRecord = { ...row, terminal: { ...retained, recordedAt: Math.max(Date.now(), row.startedAt) } }
      this.bound(complete, retained.effects)
      try { await this.domain.table('transitions').put(id, complete) }
      catch (cause) { throw new DevLoopPersistenceError('DEV_LOOP_TERMINAL_WRITE_FAILED', 'Terminal write failed after observed effects', retained.effects, { cause }) }
    })
  }

  /**
   * Read durable rows without waiting for queued writes or inspecting local files.
   * @param pieceId - Piece to inspect.
   * @returns Detached sequence-ordered complete history, or an empty array when no intent exists.
   * @throws DEV_LOOP_DISPOSED once provider disposal begins.
   */
  getHistory(pieceId: string): Promise<readonly TransitionRecord[]> {
    if (this.disposed) return Promise.reject(new DevLoopPersistenceError('DEV_LOOP_DISPOSED', 'Persistence is disposed'))
    return Promise.resolve(structuredClone(this.history(pieceId)))
  }

  private anomalies(): ReconciliationAnomaly[] {
    return [...this.domain.table('anomalies').entries()].map(([, row]) => row)
      .sort((a, b) => a.pieceId.localeCompare(b.pieceId) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
  }

  /**
   * Read retained discrepancies without rescanning files or waiting for queued writes.
   * @returns Detached anomalies ordered by piece, kind, and id, including acknowledged observations.
   * @throws DEV_LOOP_DISPOSED once provider disposal begins.
   */
  getAnomalies(): Promise<readonly ReconciliationAnomaly[]> {
    if (this.disposed) return Promise.reject(new DevLoopPersistenceError('DEV_LOOP_DISPOSED', 'Persistence is disposed'))
    return Promise.resolve(structuredClone(this.anomalies()))
  }

  /**
   * Reread local observations and durably append human awareness without clearing quarantine or changing lifecycle state.
   * @param anomalyId - Exact retained discrepancy to acknowledge.
   * @param invocation - Actual root human command identity supplied by the authorized Consumer.
   * @param reason - Complete nonempty human explanation, retained without truncation.
   * @param signal - Cancels observation reads and admission, but not an acknowledgment write already admitted.
   * @returns Detached acknowledgment after its complete anomaly row is durable.
   * @throws On missing anomaly, changed observations, empty reason, record overflow, read or write failure, cancellation, or disposal.
   */
  acknowledgeAnomaly(
    anomalyId: AnomalyId, invocation: RecoveryInvocation, reason: string, signal: AbortSignal,
  ): Promise<ReconciliationAcknowledgment> {
    const retained = structuredClone(invocation)
    return this.enqueue(async () => {
      const row = this.domain.table('anomalies').get(anomalyId)
      if (!row) throw new DevLoopPersistenceError('DEV_LOOP_ANOMALY_NOT_FOUND', 'Anomaly does not exist')
      const observations = (await readLocalPieces(this.ctx, signal)).filter(file => file.pieceId === row.pieceId).map(file => file.source)
      if (JSON.stringify(observations) !== JSON.stringify(row.observations)) throw new DevLoopPersistenceError('DEV_LOOP_ANOMALY_STALE', 'Local anomaly observations changed; inspect again')
      if (!reason.trim()) throw new Error('Acknowledgment reason must not be empty')
      signal.throwIfAborted()
      const acknowledgment: ReconciliationAcknowledgment = { anomalyId, invocation: retained, reason, observations,
        recordedAt: Math.max(Date.now(), row.observedAt, row.acknowledgments.at(-1)?.recordedAt ?? 0) }
      const complete = { ...row, acknowledgments: [...row.acknowledgments, acknowledgment] }
      this.bound(complete)
      await this.domain.table('anomalies').put(row.id, complete)
      return structuredClone(acknowledgment)
    })
  }
}

export default DevLoopPersistence
