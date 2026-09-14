/**
 * Type-only snapshot of the 00.09 `@deepseek-ai/dsh-dev-loop-test-handoff` durable DTO surface,
 * copied from `.worktrees/handoff-tests/packages/dev-loop/test-handoff/src/types.ts` at freeze time.
 * The 00.09 DTO is still being frozen and MAY CHANGE: re-verify against that file before relying on
 * this snapshot. Types only — no runtime code. Local substitutions are documented inline.
 * @module dsh-dev-loop-gates/handoff-snapshot
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { PieceScenario } from '@deepseek-ai/dsh-dev-loop-directory'
import type { DelegationId } from '@deepseek-ai/dsh-dev-loop-roles'

export type { DelegationId }
import type { GitCommit, WorktreeAssignment } from '@deepseek-ai/dsh-dev-loop-worktree'
import type { SessionId } from '@deepseek-ai/dsh-session'

// Snapshot substitution: `ClaimReportId` normally comes from `@deepseek-ai/dsh-dev-loop-claims`,
// which does not exist at this base commit (5327944e63). Local branded alias; reconcile when the
// real Claims package lands.
/** Snapshot-substituted Claims report identity. */
export type ClaimReportId = Branded<'DevLoopClaimsReportId'>
/** Owner-generated durable attempt identity. */
export type HandoffId = Branded<'DevLoopHandoffId'>
/** Raw file bytes hashed with SHA-256, encoded as lowercase hexadecimal. */
export type ContentSha256 = Branded<'DevLoopHandoffContentSha256'>
/** Owner-allocated nonce binds one fresh subprocess receipt to its invocation. */
export type HandoffRunId = Branded<'DevLoopHandoffRunId'>
/** Supplemental observed hook arguments; not a pass setter or a guarantee beyond the hook error snapshot. */
export interface IntegrityReceipt {
  readonly protocolVersion: 1
  readonly runnerVersion: '4.1.8'
  readonly runId: HandoffRunId
  readonly runnerIdentity: ContentSha256
  readonly completedHook: 'onTestRunEnd'
  readonly unhandledErrorCount: number
  readonly reason: 'passed' | 'failed' | 'interrupted'
}
/** Repository-relative file and runner fullName identify one selected test without delimiter ambiguity. */
export interface TestIdentity { readonly path: string; readonly fullName: string }
/** An assertion expectation supplied by Test Writer, checked against independently executed runner evidence. */
export interface ExpectedAssertion extends TestIdentity {
  /**
   * Exact first diagnostic line selected by Test Writer for the missing behavior; stack locations are excluded.
   * A prefix alone does not prove assertion origin. Runtime, collection, hook and setup errors never qualify.
   * Diagnostic matching does not establish semantic correctness or resist malicious tests.
   */
  readonly failureMessage: string
}
/** File identity includes mode and absence, so removal and symlink changes cannot disappear from comparisons. */
export interface FileIdentity {
  readonly path: string
  readonly sha256: ContentSha256 | null
  readonly bytes: number
  readonly mode: string
}
/** Git index, tracked working files and untracked files are separate observations; HEAD alone is insufficient. */
export interface BaselineManifest {
  readonly head: GitCommit
  readonly index: readonly FileIdentity[]
  readonly tracked: readonly FileIdentity[]
  readonly untracked: readonly FileIdentity[]
  /** Dirty production content is rejected; no implicit accepted-dirty baseline policy exists. */
  readonly production: readonly FileIdentity[]
}
/** Exact command inputs plus an explicit credential-free environment policy. */
export interface RunnerIdentity {
  readonly executable: string
  readonly executableSha256: ContentSha256
  readonly argv: readonly string[]
  readonly cwd: string
  readonly reporter: 'vitest-json'
  readonly version: string
  readonly reporterSource: readonly FileIdentity[]
  /** Fixed published ./integrity-reporter module; protocol version 1 is not configurable. */
  readonly integrityReporter: FileIdentity
  /**
   * SHA-256 of UTF-8 JSON.stringify({ reporterSource, integrityReporter, configuration }), in that key order.
   * Both arrays use ascending path UTF-16 code-unit order; FileIdentity keys are path, sha256, bytes, mode in that order.
   * Ephemeral receipt paths/nonces are excluded.
   */
  readonly integrityIdentity: ContentSha256
  readonly configuration: readonly FileIdentity[]
  readonly lockfile: FileIdentity
  /** Inherited variables containing KEY, SECRET, TOKEN or PASSWORD are removed; values are never recorded. */
  readonly environmentPolicy: 'scrub-credentials'
}
/** Untrusted complete Roles outcome JSON; discovery independently checks every declared identity. */
export interface AuthoredTests {
  /** Nonempty distinct allowed entrypoints; actual discovery must agree, with no duplicate path/fullName identity. */
  readonly testPaths: readonly string[]
  /** Complete distinct imported test-helper paths; undeclared local imports fail closed rather than escape pinning. */
  readonly helperPaths: readonly string[]
  /** Complete distinct data-fixture paths; all count toward maxTestFiles alongside entrypoints/helpers. */
  readonly fixturePaths: readonly string[]
  readonly expectedFailures: readonly ExpectedAssertion[]
  readonly passingControls: readonly TestIdentity[]
}
/** Independent process and cleanup facts are orthogonal, including exit zero after cancellation. */
export interface RunFacts {
  /** Fresh owner nonce and private output location belong to this execution, not static runner identity. */
  readonly runId: HandoffRunId
  readonly integrityPath: string
  /** Complete observed receipt bytes; missing receipt is explicit null, never a reused previous report. */
  readonly integrityOutput: string | null
  readonly integrityReceipt?: IntegrityReceipt
  readonly startedAt: number
  readonly finishedAt: number
  readonly exitCode: number | null
  readonly signal: string | null
  readonly timedOut: boolean
  readonly cancelled: boolean
  readonly truncated: boolean
  readonly cleanup: 'quiescent' | 'unproven'
  /** Complete bounded JSON reporter text from this execution, not a pre-existing output file. */
  readonly reporterOutput: string
  readonly stderr: string
}
/** Exact immutable RED baseline consumed by Gates; production changes at GREEN do not permit test/config changes. */
export interface FrozenRedEvidence {
  readonly classification: 'behavioral-red'
  readonly baseline: BaselineManifest
  readonly runner: RunnerIdentity
  readonly tests: readonly FileIdentity[]
  readonly discovered: readonly TestIdentity[]
  readonly expectedFailures: readonly ExpectedAssertion[]
  readonly passingControls: readonly TestIdentity[]
  readonly skipped: 0
  readonly todo: 0
  readonly run: RunFacts
  /** Other observed command writes; frozen-input writes always reject. A command is never called read-only. */
  readonly effects: readonly FileIdentity[]
}
/** Complete revision-bound specialist input, serialized into Roles' retained assignment. */
export interface TestBrief {
  readonly pieceId: string
  readonly pieceSha256: ContentSha256
  readonly claimsReportId: ClaimReportId
  readonly package: string
  readonly scenarios: readonly PieceScenario[]
  /** Exact nonempty References-section lines from observed source; citation syntax is not proof of inspection. */
  readonly citations: readonly string[]
  readonly allowedTestPaths: readonly string[]
  readonly executable: string
  readonly argv: readonly string[]
  readonly reporter: 'vitest-json'
  readonly reporterVersion: string
  readonly baselineCommit: GitCommit
  /** Scenario outcomes define required behavior before concrete tests exist. */
  readonly expectedBehaviors: readonly string[]
}
/** Durable intent does not imply a live operation or authorize automatic restart. */
export interface RequestedHandoff {
  readonly state: 'requested'
  readonly handoffId: HandoffId
  readonly pieceId: string
  readonly pieceSha256: ContentSha256
  readonly claimsReportId: ClaimReportId
  readonly parentSessionId: SessionId
  readonly requestedAt: number
  readonly brief: TestBrief
}
/** Durable successful handoff with independently classified evidence, never a role-written pass flag. */
export interface FrozenHandoff extends Omit<RequestedHandoff, 'state'> {
  readonly state: 'frozen'
  readonly finishedAt: number
  readonly delegationId: DelegationId
  readonly worktreeAssignment: WorktreeAssignment
  readonly evidence: FrozenRedEvidence
  readonly limitations: readonly string[]
}
/** Failed attempts preserve available observations without manufacturing frozen evidence. */
export interface FailedHandoff extends Omit<RequestedHandoff, 'state'> {
  readonly state: 'failed' | 'aborted'
  readonly finishedAt: number
  readonly delegationId?: DelegationId
  readonly worktreeAssignment?: WorktreeAssignment
  readonly run?: RunFacts
  readonly code: string
  readonly limitations: readonly string[]
}
/** Latest detached durable attempt, including unresolved restart residue. */
export type HandoffRecord = RequestedHandoff | FrozenHandoff | FailedHandoff
