/** Evidence-bound completion gates Host service; inert Test Writer scaffold. @module dsh-dev-loop-gates */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { GateReport, GateStage, Config } from './types.ts'
export type * from './types.ts'
export type { HandoffRecord, FrozenHandoff } from './handoff-snapshot.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopGates: DevLoopGates }
}
/** Runs the four evidence checks and retains their actual observations; never accepts caller-supplied pass records. */
export class DevLoopGates extends Service {
  static inject = ['devLoopDirectory', 'devLoopTestHandoff', 'fs', 'subprocess', 'storageDomain']
  static Config: z<Config> = z.object({
    repositoryRoot: z.string().required(), mainlinePath: z.string().required(),
    formatExecutable: z.string().required(), formatArgv: z.array(z.string()).required(),
    runnerExecutable: z.string().required(), runnerArgv: z.array(z.string()).required(),
    selectedTests: z.array(z.string()).required(), lockfilePath: z.string().required(),
    commandTimeoutMs: z.number().required(), terminationGraceMs: z.number().required(),
    maxOutputBytes: z.number().required(), maxReportBytes: z.number().required(),
  })
  constructor(ctx: Context, _config: Config) { super(ctx, 'devLoopGates') }
  /**
   * Execute the configured checks at one stage and derive the report from actual observations.
   * Caller arguments cannot supply result flags, paths, commands, revisions or evidence.
   * Persisted intent precedes execution; terminal evidence precedes success.
   * @param pieceId - Canonical piece identifier in the configured repository.
   * @param stage - `worktree` before transfer, `post-transfer` after transfer in the mainline.
   * @param signal - Caller cancellation, combined with the service lifetime.
   * @returns Detached derived report including failures, staleness and exact checked identities.
   * @throws On missing referents, same-piece overlap, runner/cleanup failure or complete-value overflow.
   */
  runChecks(pieceId: string, stage: GateStage, signal: AbortSignal): Promise<GateReport> {
    void pieceId; void stage; void signal
    return Promise.reject(new Error('Missing Gates behavior: four-check execution and evidence binding'))
  }
  /**
   * Inspect the latest detached report for one piece without rerunning any command.
   * @param pieceId - Canonical piece identifier.
   * @returns Latest report with failures/staleness, or undefined when nothing has run.
   */
  getReport(pieceId: string): Promise<GateReport | undefined> {
    void pieceId
    return Promise.resolve(undefined)
  }
}
export default DevLoopGates
