/** Typed Handoff dependency double; admission here is NOT proof of actual Handoff behavior. */
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { GitCommit, WorktreeAssignment, WorktreeAssignmentId } from '@deepseek-ai/dsh-dev-loop-worktree'
import type { ClaimReportId, ContentSha256, DelegationId, FileIdentity, FrozenHandoff, HandoffId, HandoffRecord, HandoffRunId } from '../src/handoff-snapshot.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { GateStage } from '../src/types.ts'

/** Public dependency methods only; production Handoff lifecycle is not simulated by inheritance. */
type HandoffDependency = {
  executeHandoff(pieceId: string, signal: AbortSignal): Promise<HandoffRecord>
  getHandoff(pieceId: string): Promise<HandoffRecord | undefined>
}

/** Mutable test controls shared by mounts; callbacks may defer, reject or observe cancellation. */
export interface HandoffControls {
  /** Latest detached record returned by getHandoff; undefined models absent durable intent. */
  record: HandoffRecord | undefined
  /** Complete override hook for stale/cross-piece observations. */
  serve?: (pieceId: string) => HandoffRecord | undefined
  /** Observed getHandoff reads, proving Gates consumes the durable record instead of inventing evidence. */
  reads: { pieceId: string }[]
  /** Frozen test/helper identities captured from the retained worktree by the fixture. */
  identities?: FileIdentity[]
}
const sha = (content: string): ContentSha256 => createHash('sha256').update(content, 'utf8').digest('hex') as ContentSha256
/** Identity of one present file computed from its exact bytes. */
export function fileIdentity(path: string, content: string, mode = '100644'): FileIdentity {
  return { path, sha256: sha(content), bytes: Buffer.byteLength(content, 'utf8'), mode }
}
/** Read the retained worktree test inputs and compute their exact frozen identities.
 * @param worktree - Retained assignment directory holding the RED baseline.
 * @param paths - Repository-relative test and helper file paths.
 * @returns Present-file identities in the given order.
 */
export async function readTestIdentities(worktree: string, paths: readonly string[]): Promise<FileIdentity[]> {
  const { readFile } = await import('node:fs/promises')
  return Promise.all(paths.map(async path => fileIdentity(path, await readFile(`${worktree}/${path}`, 'utf8'))))
}
/** Build an internally consistent frozen record for the fixture piece.
 * @param pieceId - Canonical fixture piece id.
 * @param pieceSource - Exact tracked piece bytes.
 * @param testIdentities - Frozen test/helper identities observed at RED time.
 * @param worktreePath - Retained assignment directory holding the RED baseline.
 * @param baseCommit - Assignment base commit.
 * @returns A frozen handoff whose evidence matches the fixture repository bytes.
 */
export function frozenHandoff(
  pieceId: string, pieceSource: string, testIdentities: readonly FileIdentity[],
  worktreePath: string, baseCommit: string,
): FrozenHandoff {
  const tests = testIdentities
  const run = {
    runId: '11111111-1111-4111-8111-111111111111' as HandoffRunId,
    integrityPath: `${worktreePath}/.gate-integrity.json`,
    integrityOutput: '{"protocolVersion":1}',
    integrityReceipt: { protocolVersion: 1 as const, runnerVersion: '4.1.8' as const,
      runId: '11111111-1111-4111-8111-111111111111' as HandoffRunId,
      runnerIdentity: sha('runner'),
      completedHook: 'onTestRunEnd' as const, unhandledErrorCount: 0, reason: 'failed' as const },
    startedAt: 1, finishedAt: 2, exitCode: 1, signal: null, timedOut: false, cancelled: false,
    truncated: false, cleanup: 'quiescent' as const, reporterOutput: '{"testResults":[]}', stderr: '',
  }
  const assignment: WorktreeAssignment = {
    id: '00000000-0000-4000-8000-000000000005' as WorktreeAssignmentId, pieceId,
    mainlinePath: '/mainline', worktreePath, baseCommit: baseCommit as GitCommit, ownership: 'created',
  }
  return {
    state: 'frozen', handoffId: '00000000-0000-4000-8000-000000000009' as HandoffId,
    pieceId, pieceSha256: sha(pieceSource), claimsReportId: '00000000-0000-4000-8000-000000000001' as ClaimReportId,
    parentSessionId: 'handoff-caller' as SessionId, requestedAt: 1,
    brief: {
      pieceId, pieceSha256: sha(pieceSource), claimsReportId: '00000000-0000-4000-8000-000000000001' as ClaimReportId,
      package: 'production', scenarios: [], citations: [], allowedTestPaths: ['tests/'],
      executable: process.execPath, argv: ['vitest'], reporter: 'vitest-json', reporterVersion: '4.1.8',
      baselineCommit: baseCommit as GitCommit, expectedBehaviors: ['value returns true'],
    },
    finishedAt: 3, delegationId: '00000000-0000-4000-8000-000000000007' as DelegationId,
    worktreeAssignment: assignment,
    evidence: {
      classification: 'behavioral-red', baseline: { head: baseCommit as GitCommit, index: [], tracked: [], untracked: [], production: [] },
      runner: {
        executable: process.execPath, executableSha256: sha('node'), argv: ['vitest', 'run'], cwd: worktreePath,
        reporter: 'vitest-json', version: '4.1.8', reporterSource: [], integrityReporter: tests[0] ?? fileIdentity('tests/none.js', ''),
        integrityIdentity: sha('integrity'), configuration: [], lockfile: fileIdentity('pnpm-lock.yaml', 'lockfileVersion: 9.0\n'),
        environmentPolicy: 'scrub-credentials',
      },
      tests, discovered: [{ path: tests[0]?.path ?? 'tests/behavior.spec.js', fullName: 'required behavior' }],
      expectedFailures: [{ path: tests[0]?.path ?? 'tests/behavior.spec.js', fullName: 'required behavior',
        failureMessage: 'AssertionError: expected undefined to be true // Object.is equality' }],
      passingControls: [{ path: tests[0]?.path ?? 'tests/behavior.spec.js', fullName: 'passing control' }],
      skipped: 0, todo: 0, run, effects: [],
    },
    limitations: ['Simulated Handoff record; not actual Handoff evidence.'],
  }
}
/** Make a Loader service with the actual Handoff public TypeScript methods and controlled records.
 * @param controls - Per-fixture record and read log.
 * @returns A real Loader Service implementing the typed public dependency.
 */
export function handoffDouble(controls: HandoffControls): new (ctx: Context) => Service & HandoffDependency {
  return class SimulatedHandoff extends Service implements HandoffDependency {
    constructor(ctx: Context) { super(ctx, 'devLoopTestHandoff') }
    async executeHandoff(_pieceId: string, signal: AbortSignal): Promise<HandoffRecord> {
      signal.throwIfAborted()
      throw new Error('GATES-FIXTURE: handoff execution is simulated; freeze RED through Handoff itself')
    }
    async getHandoff(pieceId: string): Promise<HandoffRecord | undefined> {
      controls.reads.push({ pieceId })
      if (controls.serve) return controls.serve(pieceId)
      return structuredClone(controls.record)
    }
  }
}
/** Observed gate-check call recorded by the Gates double consumers. */
export interface CheckCall { pieceId: string; stage: GateStage }
