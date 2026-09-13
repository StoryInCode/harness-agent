/** Durable lifecycle observations; no stored value reconstructs a live capability. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import type { FsVersion } from '@deepseek-ai/dsh-fs'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { CommandId } from '@deepseek-ai/dsh-commands'

/** Canonical lowercase UUID, prefixed `dlt-`, minted by the writer and parsed on durable reads. */
export type TransitionId = Branded<'DevLoopTransitionId'>
/** Canonical lowercase UUID prefixed `dla-`; stable discrepancy identity, not a repair capability. */
export type AnomalyId = Branded<'DevLoopAnomalyId'>
/** SHA-256 of complete UTF-8 source bytes, encoded as lowercase hexadecimal. */
export type SourceDigest = Branded<'DevLoopSourceDigest'>
/** Lowercase SHA-256 of the canonical absolute repository process path; relocation is unsupported. */
export type RepositoryId = Branded<'DevLoopRepositoryId'>

/** Both raw bytes and lifecycle-header-normalized content are retained. */
export interface SourceRevision {
  readonly rawDigest: SourceDigest
  readonly contentDigest: SourceDigest
  readonly version: FsVersion
}
/** Actual local source read, not a model assertion about passing verification. */
export interface SourceObservation extends SourceRevision {
  readonly path: string
}
/** Trusted Consumer observation; UserQuestions supplies answers, not receipt ids. */
export type HumanAuthorization = {
  readonly sessionId: SessionId
  readonly source: SourceObservation
  readonly decision: 'accept'
} & (
  | { readonly kind: 'tool'; readonly callId: ToolCallId; readonly answer: { readonly id: 'decision'; readonly selected: readonly ['Accept'] } }
  | { readonly kind: 'command'; readonly commandId: CommandId }
)
/** Root human command facts supplied by the recovery Consumer. */
export interface RecoveryInvocation {
  readonly commandId: CommandId
  readonly sessionId: SessionId
}
/** One held Lifecycle CAS claim; sequence starts at one and includes failed attempts. */
export interface BeginTransitionRequest {
  readonly pieceId: string
  readonly expected: PieceStatus
  readonly from: PieceStatus
  readonly to: PieceStatus
  readonly source: SourceObservation
  readonly destinationPath: string
  readonly sequence: number
  readonly reason?: string
  readonly authorization?: HumanAuthorization
  readonly signal: AbortSignal
}
/** Independent effects and cleanup facts are never collapsed into a success flag. */
export interface TransitionEffects {
  readonly header: 'none' | 'applied' | 'unknown'
  readonly index: 'none' | 'applied' | 'unknown'
  readonly move: 'none' | 'applied' | 'unknown'
  readonly cleanup: 'not-needed' | 'restored' | 'failed' | 'unknown'
}
/** Actual terminal outcome recorded by Lifecycle under its claim, after policy and Git. */
export type TransitionObservation =
  | { readonly kind: 'committed'; readonly source: SourceObservation; readonly effects: TransitionEffects }
  | { readonly kind: 'failed'; readonly code: string; readonly effects: TransitionEffects; readonly source?: SourceObservation }
/** One row owns intent and its optional terminal; timestamps are Unix milliseconds. */
export interface TransitionRecord {
  readonly id: TransitionId
  readonly repositoryId: RepositoryId
  readonly pieceId: string
  readonly expected: PieceStatus
  readonly from: PieceStatus
  readonly to: PieceStatus
  readonly source: SourceObservation
  readonly destinationPath: string
  readonly sequence: number
  readonly reason?: string
  readonly authorization?: HumanAuthorization
  readonly startedAt: number
  readonly terminal?: TransitionObservation & { readonly recordedAt: number }
}
/** Discrepancies remain unavailable even after acknowledgment. */
export type AnomalyKind = 'unresolved-intent' | 'missing-source' | 'duplicate-source' | 'unjournaled-done' | 'source-changed' | 'unknown-piece' | 'status-path-mismatch' | 'uncertain-effect'
/** Detached durable discrepancy and the raw observations that identify its version. */
export interface ReconciliationAnomaly {
  readonly id: AnomalyId
  readonly repositoryId: RepositoryId
  readonly pieceId: string
  readonly kind: AnomalyKind
  readonly transitionId?: TransitionId
  readonly observations: readonly SourceObservation[]
  readonly observedAt: number
  readonly acknowledgments: readonly ReconciliationAcknowledgment[]
}
/** Records awareness of this exact observation; never clears quarantine. */
export interface ReconciliationAcknowledgment {
  readonly anomalyId: AnomalyId
  readonly invocation: RecoveryInvocation
  readonly reason: string
  readonly observations: readonly SourceObservation[]
  readonly recordedAt: number
}
/** Committed status may differ from an unchanged non-done disk header. */
export interface HydratedLifecyclePiece {
  readonly pieceId: string
  readonly status: PieceStatus
  readonly source: SourceObservation
  readonly sequence: number
  readonly quarantined: boolean
}
/** Adopted once before Lifecycle admits direct callers. */
export interface LifecycleHydration {
  readonly pieces: readonly HydratedLifecyclePiece[]
  readonly unresolvedIntentIds: readonly TransitionId[]
  readonly anomalies: readonly ReconciliationAnomaly[]
}
/** Deployment choices must be explicit; no nondurable backend is selected here. */
export interface Config {
  /** Canonical absolute repository process path; its SHA-256 binds retained records to this repository. */
  readonly repositoryRoot: string
  /** Maximum UTF-8 JSON bytes per complete retained row, including terminal or acknowledgment metadata. */
  readonly maxRecordBytes: number
  /** Maximum retained transition intent rows per piece, including failed attempts; overflow rejects. */
  readonly maxHistoryRecords: number
}
/** Complete inspection text is JSON.stringify of these fields in declaration order. */
export interface RecoveryInspection {
  readonly pieceId: string
  readonly history: readonly TransitionRecord[]
  readonly anomalies: readonly ReconciliationAnomaly[]
}
/** Complete command input/result budgets, measured in UTF-8 bytes. */
export interface RecoveryCommandConfig {
  readonly maxInputBytes: number
  readonly maxOutputBytes: number
}
/** Stable operational failures; storage-domain parser failures retain their own codes. */
export type PersistenceErrorCode = 'DEV_LOOP_PERSISTENCE_REQUIRED' | 'PIECE_AUTHORIZATION_REQUIRED' | 'PIECE_REVIEW_STALE' | 'PIECE_QUARANTINED' | 'DEV_LOOP_INTENT_WRITE_FAILED' | 'DEV_LOOP_TERMINAL_WRITE_FAILED' | 'DEV_LOOP_RECORD_TOO_LARGE' | 'DEV_LOOP_HISTORY_LIMIT' | 'DEV_LOOP_SEQUENCE_CONFLICT' | 'DEV_LOOP_TERMINAL_CONFLICT' | 'DEV_LOOP_REPOSITORY_MISMATCH' | 'DEV_LOOP_ANOMALY_NOT_FOUND' | 'DEV_LOOP_ANOMALY_STALE' | 'DEV_LOOP_DISPOSED'
