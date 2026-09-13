/** Retained per-piece Git worktree allocation types. @module dsh-dev-loop-worktree/types */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque retained assignment identity. */
export type WorktreeAssignmentId = Branded<'DevLoopWorktreeAssignmentId'>
/** Validated repository-format commit identity. */
export type GitCommit = Branded<'DevLoopGitCommit'>
/** Required command policy; only the root has a default (.worktrees). */
export interface Config {
  /** Main checkout directory; must identify a non-bare repository with a commit. */
  mainlinePath: string
  /** Ignored root beneath the canonical mainline; defaults to .worktrees. */
  worktreeRoot?: string
  /** Positive command deadline in milliseconds, at most 2147483647; expiry initiates cancellation. */
  commandTimeoutMs: number
  /** Positive safe-integer captured byte limit per output stream. */
  outputMaxBytes: number
  /** Positive termination/drain grace in milliseconds, at most 2147483647; not a command timeout. */
  terminationGraceMs: number
}
/** Immutable assignment retained across role lifetimes. */
export interface WorktreeAssignment {
  readonly id: WorktreeAssignmentId
  readonly pieceId: string
  readonly mainlinePath: string
  readonly worktreePath: string
  readonly baseCommit: GitCommit
  readonly ownership: 'created' | 'borrowed'
}
/** Assignment request; cancellation must settle owned commands before rejection. */
export interface AssignWorktreeRequest {
  readonly pieceId: string
  readonly cwd: string
  readonly signal: AbortSignal
}
/** Conservative explicit retirement result. */
export type WorktreeRetirement =
  | { readonly kind: 'removed' }
  | { readonly kind: 'preserved'; readonly reason: 'borrowed' | 'dirty' | 'head-changed' }
