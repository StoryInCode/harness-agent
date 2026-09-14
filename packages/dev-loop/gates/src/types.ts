/** Evidence-bound completion gate reports, configuration, and scoped tool budgets. @module dsh-dev-loop-gates/types */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorktreeAssignment } from '@deepseek-ai/dsh-dev-loop-worktree'
import type { BaselineManifest, ContentSha256, FileIdentity, HandoffId, RunnerIdentity, RunFacts } from './handoff-snapshot.ts'

/** Owner-generated durable gate report identity. */
export type GateReportId = Branded<'DevLoopGateReportId'>
/** Evidence id of one exact owner-produced observation consumed by an evaluation. */
export type EvidenceId = Branded<'DevLoopGateEvidenceId'>
/** Execution stage that binds which directory a check runs in and which completion it can authorize. */
export type GateStage = 'worktree' | 'post-transfer'
/** The four required evidence checks; completion compares every one. */
export type CheckKind = 'format' | 'red' | 'green' | 'post-transfer'
/** Derived evaluation outcome; callers cannot supply it. */
export type GateStatus = 'pass' | 'fail' | 'stale'
/** Why an evaluation reached its status; closed vocabulary, extended only by the owner. */
export type GateReasonCode =
  | 'evidence-current' | 'missing-evidence' | 'stale-piece' | 'stale-tests' | 'stale-production'
  | 'cross-piece-evidence' | 'format-findings' | 'format-command-failed' | 'runner-failed'
  | 'runner-timeout' | 'runner-truncated' | 'cleanup-unproven' | 'selection-skipped' | 'no-tests-selected'
  | 'mainline-not-executed' | 'transferred-manifest-mismatch' | 'input-drift' | 'record-overflow'
/** One completed evidence evaluation. */
export interface GateEvaluation {
  readonly check: CheckKind
  readonly stage: GateStage
  readonly status: GateStatus
  readonly reasonCode: GateReasonCode
  readonly checkedIdentities: readonly FileIdentity[]
  readonly evidenceIds: readonly EvidenceId[]
  readonly observedAt: number
}
/** Complete detached observation for one piece at one stage; only the owner derives it. */
export interface GateReport {
  readonly reportId: GateReportId
  readonly pieceId: string
  readonly pieceSha256: ContentSha256
  readonly handoffId: HandoffId
  readonly stage: GateStage
  readonly worktreeAssignment: Pick<WorktreeAssignment, 'id' | 'worktreePath' | 'baseCommit'>
  /** Current Git and content identity captured before and after every command. */
  readonly productionManifest: BaselineManifest
  readonly runner: RunnerIdentity
  /** Runner/test/config input identities pinned for this report. */
  readonly testManifest: readonly FileIdentity[]
  readonly evaluations: readonly GateEvaluation[]
  readonly run?: RunFacts
  readonly observedAt: number
}
/** Complete Host-owned Gates policy; commands and selections never come from caller arguments. */
export interface Config {
  /** Absolute non-bare mainline repository root, validated against actual Git at first use. */
  repositoryRoot: string
  /** Absolute or repository-relative mainline checkout used for post-transfer execution. */
  mainlinePath: string
  /** Absolute executable of the applicable axiom/format check. */
  formatExecutable: string
  /** Complete argv of the format check, including explicit config selection. */
  formatArgv: string[]
  /** Absolute executable of the test runner. */
  runnerExecutable: string
  /** Complete runner argv, including explicit config/discovery filters and the JSON reporter. */
  runnerArgv: string[]
  /** Exact repository-relative pinned test selection; discovery drift rejects. */
  selectedTests: string[]
  /** Repository-relative lockfile, frozen by content. */
  lockfilePath: string
  /** Positive safe-integer milliseconds, at most 2147483647; deadline joins terminated children. */
  commandTimeoutMs: number
  /** Positive safe-integer milliseconds, at most 2147483647; termination/drain grace. */
  terminationGraceMs: number
  /** Positive safe-integer UTF-8 bytes of complete command output; overflow refuses, never clips. */
  maxOutputBytes: number
  /** Positive safe-integer UTF-8 bytes of complete persisted reports; overflow keeps unresolved intent. */
  maxReportBytes: number
}
/** Scoped tool policy for the complete content array, including JSON escaping and error wrappers. */
export interface ToolConfig {
  /** Positive safe-integer UTF-8 byte limit; values below the fixed overflow envelope reject mount. */
  maxToolOutputBytes: number
}
