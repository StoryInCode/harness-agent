/** Queue requests, completion tickets and detached observations. @module @deepseek-ai/dsh-dev-loop-queue/types */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'

/** Deployment-owned concurrency ceiling, defaulted and validated at mount. */
export interface Config {
  /** Integer in [1, 32]; defaults to 4. Counts startup through complete cleanup. */
  maxConcurrency?: number
}

/** One consumer-owned delegation; no provider or assignment is inferred by the queue. */
export interface QueueRequest {
  /** Canonical pending piece to schedule. */
  pieceId: string
  /** Role-owned cancellation lifetime. */
  signal: AbortSignal
  /**
   * Start a one-shot run after capacity is reserved. Must settle even on cancellation;
   * a late returned run is disposed and joined by the queue.
   * @param agent - exact live initiator captured at admission and restored for this callback.
   * @param signal - combined request, ticket and queue cancellation.
   * @returns the existing one-shot lease, including its result and disposal promises.
   */
  dispatch(agent: Agent, signal: AbortSignal): Promise<SubagentRun>
}

/** Admission receipt; a terminal result is not published before lease cleanup settles. */
export interface QueueTicket {
  /** Piece associated with this invocation. */
  readonly pieceId: string
  /** Worker result after cleanup; rejects on cancellation, startup or infrastructure failure. */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel idempotently and await startup, result observation and cleanup.
   * @param reason - optional cancellation cause; the first cancellation remains authoritative.
   * @returns after owned work settles; rejects if cleanup could not prove quiescence.
   */
  cancel(reason?: unknown): Promise<void>
}

/** Detached scalar record; never an Agent, callback, or lease reference. */
export interface QueueEntry {
  /** Canonical piece id. */
  pieceId: string
  /** Canonical queue priority; lower values run first. */
  queueOrder: number
  /** Epoch milliseconds at request admission. */
  enqueuedAt: number
  /** Starting includes reserved startup; running retains its reservation during cleanup. */
  status: 'queued' | 'starting' | 'running'
  /** Child session id after startup returns; not a continuable run epoch. */
  subagentId?: SessionId
}
