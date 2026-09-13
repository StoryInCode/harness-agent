/** Human decisions returned by the development-loop approval tool. @module @deepseek-ai/dsh-dev-loop-approval/types */

/** Accept queues a todo piece; Question and Change leave its lifecycle status untouched. */
export type ApprovalDecision = 'accept' | 'question' | 'change'

/** Canonical model-visible result, returned only after any accepted transition settles. */
export interface PresentPieceResult {
  /** Requested specification id. */
  pieceId: string
  /** Explicit selected decision, never inferred from feedback. */
  decision: ApprovalDecision
  /** Trimmed independent feedback; omitted when empty. */
  feedback?: string
}
