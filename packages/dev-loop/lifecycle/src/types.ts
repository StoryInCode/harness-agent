/**
 * Lifecycle transition types shared by the lifecycle service, its consumers,
 * and the typed events it publishes.
 * @module @deepseek-ai/dsh-dev-loop-lifecycle/types
 */

import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'

/** One in-memory status change, timestamped after any completing move; not a durable record. */
export interface StateTransitionEvent {
  /** Dotted piece id such as `00.01`. */
  readonly pieceId: string
  /** Status the piece held before the transition. */
  readonly from: PieceStatus
  /** Status the piece holds after it. */
  readonly to: PieceStatus
  /** Why the transition happened; required in practice for `blocked`. */
  readonly reason?: string
  /** Milliseconds since the epoch at the commit point. */
  readonly timestamp: number
  /** Path the piece occupies after a completing move. */
  readonly newPath?: string
}

/** A completion request before filesystem or Git work; listeners return void or reject to veto. */
export interface PiecePreCompleteEvent {
  /** Dotted piece id such as `00.01`. */
  readonly pieceId: string
  /** Claimed logical status, which may differ from the disk header. */
  readonly from: 'pending'
  /** Requested status; not yet committed. */
  readonly to: 'done'
  /** Why completion was requested. */
  readonly reason?: string
  /** Caller and lifecycle cancellation; listeners must settle their owned work before returning. */
  readonly signal: AbortSignal
}

/**
 * The completion event, narrowed so a consumer never has to test whether the
 * relocated path is present: reaching `done` always moves the file.
 */
export interface PieceCompletedEvent extends StateTransitionEvent {
  readonly to: 'done'
  readonly newPath: string
}
