/**
 * Bounded one-shot dispatch with consumer-owned callbacks and result/cleanup leases.
 * Reservations cover startup through quiescence; announcements only wake admitted work.
 * @module @deepseek-ai/dsh-dev-loop-queue
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import '@deepseek-ai/dsh-dev-loop-directory'
import '@deepseek-ai/dsh-dev-loop-lifecycle'
import type { Config, QueueEntry, QueueRequest, QueueTicket } from './types.ts'
export type { Config, QueueEntry, QueueRequest, QueueTicket } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopQueue: DevLoopQueue }
}

/** A promise whose settlement belongs to this queue. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

interface Entry {
  view: QueueEntry
  order: number
  agent: Agent
  dispatch: QueueRequest['dispatch']
  dependencies: readonly string[]
  signal: AbortSignal
  gate: ReturnType<typeof deferred<string | undefined>>
  cancelled: ReturnType<typeof deferred<void>>
  result: ReturnType<typeof deferred<SubagentResult>>
  cleanupFailure?: { error: unknown }
}

/** One process-local concurrency limit for approved, explicitly submitted role requests. */
export class DevLoopQueue extends Service {
  static inject = ['agents', 'devLoopDirectory', 'devLoopLifecycle']
  static Config: z<Config> = z.object({ maxConcurrency: z.number().step(1).min(1).max(32).default(4) })

  /** Maximum startup, execution and cleanup reservations held simultaneously. */
  readonly maxConcurrency: number
  private readonly lifetime = new AbortController()
  private readonly entries = new Map<string, Entry>()
  /** Includes asynchronous admission, before a public queue entry exists. */
  private readonly claims = new Set<string>()
  private readonly operations = new Set<Promise<unknown>>()
  private sequence = 0
  private failure: { error: unknown } | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopQueue')
    this.maxConcurrency = (config as Required<Config>).maxConcurrency
    ctx.on('piece/approved', () => { this.wake() })
    ctx.on('piece/completed', () => { this.wake() })
    ctx.on('piece/blocked', () => { this.wake() })
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Dispatch queue disposed'))
      await Promise.allSettled(this.operations)
      if (this.failure !== undefined) throw this.failure.error
    })
  }

  /**
   * Capture the exact live initiator and admit a canonical pending piece.
   * @param request - consumer-owned startup callback and cancellation signal.
   * @returns an admission ticket, without waiting for capacity or worker completion.
   * @throws if closed, cancelled, duplicated, not pending, missing a dependency, or lacking a live initiator.
   */
  async enqueue(request: QueueRequest): Promise<QueueTicket> {
    this.lifetime.signal.throwIfAborted()
    request.signal.throwIfAborted()
    const agent = this.ctx.agents.currentInitiator()
    if (agent === undefined || this.ctx.agents.get(agent.id) !== agent) throw new Error('Queue admission requires an exact live initiator')
    const pieceId = request.pieceId
    if (this.claims.has(pieceId)) throw new Error(`Piece ${pieceId} already has an outstanding queue request`)
    this.claims.add(pieceId)
    const order = this.sequence++
    const enqueuedAt = Date.now()
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, request.signal, this.lifetime.signal])
    const admission = this.ctx.agents.withoutInitiator(async () => {
      try {
        const record = await this.ctx.devLoopDirectory.getPiece(pieceId, signal)
        signal.throwIfAborted()
        this.requirePending(pieceId)
        for (const dependency of record.dependsOn) {
          await this.ctx.devLoopDirectory.getPiece(dependency, signal)
          signal.throwIfAborted()
          this.ctx.devLoopLifecycle.getStatus(dependency)
        }
        const entry: Entry = {
          view: { pieceId, queueOrder: record.queue, enqueuedAt, status: 'queued' },
          order, agent, dispatch: request.dispatch.bind(request), dependencies: record.dependsOn,
          signal, gate: deferred<string | undefined>(), cancelled: deferred<void>(), result: deferred<SubagentResult>(),
        }
        // A request may fail before its ticket reaches the caller; the original rejecting promise stays observable.
        void entry.result.promise.catch(() => undefined)
        const onAbort = () => {
          entry.gate.reject(this.cancelledError(signal))
          entry.cancelled.resolve()
        }
        signal.addEventListener('abort', onAbort, { once: true })
        this.entries.set(pieceId, entry)
        const done = this.own(this.run(entry).finally(() => { signal.removeEventListener('abort', onAbort) }))
        this.wake()
        return {
          pieceId,
          result: entry.result.promise,
          cancel: async (reason?: unknown) => {
            controller.abort(reason instanceof Error ? reason : new Error('Queue request cancelled', { cause: reason }))
            await done
            if (entry.cleanupFailure !== undefined) throw entry.cleanupFailure.error
          },
        }
      } catch (error) {
        this.claims.delete(pieceId)
        throw error
      }
    })
    return this.own(admission)
  }

  /**
   * Inspect currently occupied capacity.
   * @returns detached scalar records for startup, execution and cleanup reservations.
   */
  getActiveWorkers(): QueueEntry[] {
    return [...this.entries.values()].filter(entry => entry.view.status !== 'queued').map(entry => ({ ...entry.view }))
  }

  /**
   * Inspect requests awaiting dispatch.
   * @returns eligible or dependency-parked requests, in canonical priority and FIFO order.
   */
  getQueuedEntries(): QueueEntry[] {
    return this.queued().map(entry => ({ ...entry.view }))
  }

  private queued(): Entry[] {
    return [...this.entries.values()].filter(entry => entry.view.status === 'queued')
      .sort((a, b) => a.view.queueOrder - b.view.queueOrder || a.order - b.order)
  }

  private requirePending(pieceId: string): void {
    if (this.ctx.devLoopLifecycle.getStatus(pieceId) !== 'pending') throw new Error(`Piece ${pieceId} is not pending`)
  }

  private cancelledError(signal: AbortSignal): Error {
    return signal.reason instanceof Error ? signal.reason : new Error('Queue request cancelled', { cause: signal.reason })
  }

  /** Scheduling never inherits the agent that happened to emit a wakeup. */
  private wake(): void {
    if (this.lifetime.signal.aborted) return
    this.ctx.agents.withoutInitiator(() => {
      for (const entry of this.queued()) {
        try {
          entry.signal.throwIfAborted()
          this.requirePending(entry.view.pieceId)
          const statuses = entry.dependencies.map(id => this.ctx.devLoopLifecycle.getStatus(id))
          const blocked = statuses.indexOf('blocked')
          if (blocked >= 0) {
            // A blocked transition owns no worker permit, but its request still owns its claim and settlement.
            this.entries.delete(entry.view.pieceId)
            entry.gate.resolve(entry.dependencies[blocked])
          } else if (statuses.every(status => status === 'done') && this.getActiveWorkers().length < this.maxConcurrency) {
            entry.view.status = 'starting'
            entry.gate.resolve(undefined)
          }
        } catch (error) {
          this.entries.delete(entry.view.pieceId)
          entry.gate.reject(error)
        }
      }
    })
  }

  /** Startup, result observation and disposal are one owned reservation. */
  private async run(entry: Entry): Promise<void> {
    try {
      const blocked = await entry.gate.promise
      entry.signal.throwIfAborted()
      if (blocked !== undefined) {
        await this.ctx.devLoopLifecycle.transition(entry.view.pieceId, 'pending', 'blocked', `Dependency ${blocked} is blocked`, entry.signal)
        throw new Error(`Dependency ${blocked} is blocked`)
      }
      if (this.ctx.agents.get(entry.agent.id) !== entry.agent) throw new Error('Queued initiator is no longer live')
      this.requirePending(entry.view.pieceId)
      const run = await this.ctx.agents.withInitiator(entry.agent, () => entry.dispatch(entry.agent, entry.signal))
      entry.view.status = 'running'
      entry.view.subagentId = run.id
      const result = run.result
      const joined = Promise.allSettled([result])
      let value: SubagentResult
      try {
        if (!entry.signal.aborted) await Promise.race([result, entry.cancelled.promise])
        entry.signal.throwIfAborted()
        value = await result
      } finally {
        try {
          await run.dispose()
        } catch (error) {
          entry.cleanupFailure = { error }
          this.failure ??= { error }
          this.lifetime.abort(new Error('Dispatch queue closed after cleanup failure', { cause: error }))
          throw error
        } finally {
          await joined
        }
      }
      entry.signal.throwIfAborted()
      this.entries.delete(entry.view.pieceId)
      this.claims.delete(entry.view.pieceId)
      entry.result.resolve(value)
    } catch (error) {
      if (entry.cleanupFailure === undefined) this.entries.delete(entry.view.pieceId)
      this.claims.delete(entry.view.pieceId)
      entry.result.reject(error)
    } finally {
      this.wake()
    }
  }

  /** Keep teardown aware of admission and execution until their complete settlement. */
  private own<T>(operation: Promise<T>): Promise<T> {
    const owned = operation.finally(() => { this.operations.delete(owned) })
    this.operations.add(owned)
    return owned
  }
}

export default DevLoopQueue
