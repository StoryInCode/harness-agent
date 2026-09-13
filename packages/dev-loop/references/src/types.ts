/** Detached structural observations; report attribution never proves source usage. @module dsh-dev-loop-references/types */
import type { DelegationId, DevLoopRole } from '@deepseek-ai/dsh-dev-loop-roles'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Required host policy; byte limits measure UTF-8 encoded decoded text or complete JSON. */
export interface Config {
  /** Explicit repository root for inline-code paths and canonical local-source containment. */
  repositoryRoot: string
  /** Positive safe-integer UTF-8 byte limit on this owner's decoded piece read; overflow rejects without an observation or digest. */
  maxPieceBytes: number
  /** Positive safe-integer UTF-8 byte limit on decoded source text; overflow retains an invalid entry without a content fingerprint. */
  maxSourceBytes: number
  /**
   * Positive safe-integer UTF-8 byte limit on complete observation JSON;
   * must fit minimum error envelopes and rejects overflow before persistence.
   */
  maxObservationBytes: number
  /** Positive safe-integer maximum number of source locators, including multiple locators in one row. */
  maxReferences: number
}
/** Explicit structural failures; absent epistemic evidence is not a structural error. */
export type ReferenceErrorCode = 'MISSING_REFERENCES' | 'MALFORMED_REFERENCES' | 'INVALID_COLUMNS'
  | 'INVALID_LOCATOR' | 'ABSOLUTE_PATH' | 'OUTSIDE_ROOT' | 'SOURCE_MISSING' | 'SOURCE_NOT_FILE'
  | 'INVALID_RANGE' | 'PIECE_TOO_LARGE' | 'SOURCE_TOO_LARGE' | 'TOO_MANY_REFERENCES'
  | 'INVALID_DELEGATION_ID'
/** One failure in the checked piece; entryIndex is present only for a retained entry. */
export interface ReferenceError { code: ReferenceErrorCode; message: string; entryIndex?: number }
/** Actual terminal report identity copied from Roles; no requested preset substitution. */
export interface LinkedDelegation {
  delegationId: DelegationId
  pieceId: string
  subagentSessionId: SessionId
  role: DevLoopRole
  preset?: string
  status: 'completed' | 'aborted' | 'failed'
  limitations: readonly string[]
}
/** One locator in document order; multiple locators in a row each retain that row's prose. */
export interface ReferenceEntry {
  row: number
  source: string
  sourceText: string
  attribution: string
  rolePreset?: string
  question?: string
  inspection?: string
  usage?: string
  explanatoryColumns: Readonly<Record<string, string>>
  sourceStatus: 'resolved' | 'missing' | 'invalid' | 'not-checked'
  attributionStatus: 'linked-report' | 'unverified' | 'contradicted'
  inspectionStatus: 'unverified'
  contentSha256?: string
  lineRange?: { start: number; end: number }
  fragment?: string
  delegation?: LinkedDelegation
  limitations: readonly string[]
}
/** Latest durable check of exact decoded piece text, not a claim about subsequent edits. */
export interface ProvenanceObservation {
  pieceId: string
  pieceSha256: string
  checkedAt: number
  explicitEmpty: boolean
  structuralStatus: 'valid' | 'invalid'
  inspectionStatus: 'unverified'
  entries: readonly ReferenceEntry[]
  errors: readonly ReferenceError[]
  limitations: readonly string[]
}
