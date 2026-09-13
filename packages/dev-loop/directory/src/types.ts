/**
 * Piece record and validation-finding types shared by the directory service, its
 * pure parser, and every downstream development-loop consumer.
 * @module @deepseek-ai/dsh-dev-loop-directory/types
 */

/**
 * Lifecycle state a piece file declares in its `**Status:**` header line. The
 * four states are the closed vocabulary the lifecycle state machine transitions
 * between; a file declaring anything else is rejected rather than defaulted.
 */
export type PieceStatus = 'todo' | 'pending' | 'done' | 'blocked'

/**
 * Machine-readable reason one piece file failed or warned during validation.
 * Each code maps to exactly one rejected condition so a caller can branch on
 * the cause without matching message text.
 */
export type PieceFindingCode =
  | 'PIECE_SIZE_EXCEEDED'
  | 'MISSING_REQUIRED_SECTION'
  | 'MISSING_RECOMMENDED_SECTION'
  | 'INVALID_HARNESS_PRIMITIVE'
  | 'INVALID_PIECE_STATUS'
  | 'MALFORMED_PIECE_HEADER'

/**
 * Severity a finding carries, mirroring the `severity:` field of the `axiom`
 * blocks in `plans/AGENTS.md`. A blocker rejects the file; a warning is
 * recorded on the accepted record.
 */
export type PieceFindingSeverity = 'blocker' | 'warning'

/** One validation observation about one piece file. */
export interface PieceFinding {
  /** Which condition was observed. */
  readonly code: PieceFindingCode
  /** Whether the condition rejects the file or only annotates it. */
  readonly severity: PieceFindingSeverity
  /** Operator-facing explanation naming the offending value. */
  readonly message: string
}

/** One Given/When/Then scenario extracted from a piece's `## Behaviour` section. */
export interface PieceScenario {
  /** Precondition text following the `Given` marker. */
  readonly given: string
  /** Action text following the `When` marker. */
  readonly when: string
  /** Observable-outcome text following the `Then` marker. */
  readonly then: string
}

/** Header fields every piece file declares above its first section. */
export interface PieceMetadata {
  /** Dotted piece id such as `00.01`, taken from the title line. */
  readonly id: string
  /** Human title following the id on the title line. */
  readonly title: string
  /** Owning set name such as `00-dev-loop`. */
  readonly set: string
  /** Dispatch position within the set; lower runs earlier. */
  readonly queue: number
  /** Piece ids that must reach `done` before this one may be dispatched. */
  readonly dependsOn: readonly string[]
  /** Declared lifecycle state. */
  readonly status: PieceStatus
  /** Declared Harness primitive, validated against the closed vocabulary. */
  readonly primitive: string
  /** Single owning workspace package name. */
  readonly pkg: string
}

/** A parsed, validated piece file together with the evidence of its validation. */
export interface PieceRecord extends PieceMetadata {
  /** Path the content was read from, as supplied to the parser. */
  readonly path: string
  /** Physical line count measured against the configured ceiling. */
  readonly lineCount: number
  /** Full `## Summary` body, newline-joined. */
  readonly summary: string
  /** Scenarios extracted from `## Behaviour`, in document order. */
  readonly scenarios: readonly PieceScenario[]
  /** Non-blocking findings; a fully compliant piece carries none. */
  readonly warnings: readonly PieceFinding[]
}

/** One file a scan could not parse. A malformed sibling is data, not an exception. */
export interface PieceRejection {
  /** Path of the file that was rejected. */
  readonly path: string
  /** The first blocking condition, for callers that branch on one cause. */
  readonly code: PieceFindingCode
  /** Every finding observed on that file, blockers and warnings together. */
  readonly findings: readonly PieceFinding[]
}

/** Valid records and rejected files, reported together so neither hides the other. */
export interface SetScan {
  /** Every piece of the set that parsed, ordered by queue position then by id. */
  readonly pieces: readonly PieceRecord[]
  /** Every piece file of the set that did not parse, in scan order. */
  readonly rejected: readonly PieceRejection[]
}

/**
 * Outcome of parsing one file without throwing: `ok` discriminates the record
 * from the rejection, so a scan needs no exception to keep reading siblings.
 */
export type PieceParseResult =
  | { readonly ok: true; readonly record: PieceRecord }
  | { readonly ok: false; readonly rejection: PieceRejection }
