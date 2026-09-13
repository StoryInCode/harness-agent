/** Host role dispatch with durable intent and Queue-owned cleanup. @module dsh-dev-loop-roles */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import z from '@deepseek-ai/schemastery'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { QueueTicket } from '@deepseek-ai/dsh-dev-loop-queue'
import type { WorktreeAssignment } from '@deepseek-ai/dsh-dev-loop-worktree'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { validateProviders } from './config.ts'
import { briefSchema, jsonBytes, pieceIdSchema, rolesDomain } from './records.ts'
import type { Config, RoleConfig, DelegationBrief, DelegationId, DelegationRecord, RequestedDelegation, SettledDelegation } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopRoles: DevLoopRoles }
}

const positive = z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required()
const role: z<RoleConfig> = z.object({
  provider: z.string().min(1).required(), persona: z.string().min(1).required(),
  toolFilter: z.object({
    allow: z.array(z.string().min(1)).default(undefined as unknown as string[]) as z<readonly string[]>,
    deny: z.array(z.string().min(1)).default(undefined as unknown as string[]) as z<readonly string[]>,
  }).required(),
  agentOptions: z.object({
    provider: z.string().min(1), model: z.string().min(1),
    reasoningEffort: z.string().min(1) as z<NonNullable<AgentOptions['reasoningEffort']>>,
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  }).default(undefined as unknown as Required<AgentOptions>),
  maxDepth: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),
}).required()

/** Coordinates role policy, retained assignments, Queue leases and durable observations. */
export class DevLoopRoles extends Service {
  static inject = ['agents', 'subagents', 'devLoopQueue', 'devLoopWorktree', 'storageDomain']
  static Config: z<Config> = z.object({
    roles: z.object({ Research: role, 'Test Writer': role, Implementer: role, Utility: role }).required(),
    maxBriefBytes: positive, maxOutcomeBytes: positive,
  })
  private readonly config: Config
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<SettledDelegation>>()
  private table!: KvTable<DelegationId, DelegationRecord>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopRoles')
    this.config = DevLoopRoles.Config(config)
  }

  protected async [Service.init](): Promise<void> {
    validateProviders(this.ctx, this.config)
    const domain = await this.ctx.storageDomain.open(rolesDomain)
    this.table = domain.table('delegations')
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Roles service disposed'))
      // Writes use the domain lifetime, not cancellation; close only after all recording attempts.
      await Promise.allSettled(this.operations)
      await domain.close()
    })
  }

  /**
   * Delegate from the exact live initiator; persist intent before Queue admission.
   * Cancellation joins the ticket; uncertain startup or cleanup records failure, not quiescence. Assignments are never retired.
   * @param brief - complete bounded role assignment, without execution authority.
   * @param signal - caller cancellation lifetime, combined with service disposal.
   * @returns detached settled observation after Queue cleanup and terminal durability.
   * @throws on invalid input, stale initiator, closed service, or failed durable recording.
   */
  async delegate(brief: DelegationBrief, signal: AbortSignal): Promise<SettledDelegation> {
    const caller = this.ctx.agents.requireInitiator()
    if (this.ctx.agents.get(caller.id) !== caller) throw new Error('Roles requires an exact live initiator')
    const session = caller.session
    this.lifetime.signal.throwIfAborted()
    const input = briefSchema.parse(brief)
    if (jsonBytes(input) > this.config.maxBriefBytes) throw new Error('Delegation brief exceeds maxBriefBytes limit')
    const requested: RequestedDelegation = {
      ...input, delegationId: brandString<DelegationId>(randomUUID()), parentSessionId: session.id,
      provider: this.config.roles[input.role].provider, requestedAt: Date.now(), state: 'requested',
    }
    const operation = this.perform(caller, requested, AbortSignal.any([signal, this.lifetime.signal]))
    this.operations.add(operation)
    try { return await operation }
    finally { this.operations.delete(operation) }
  }

  /**
   * Read full durable history, including unresolved requests that do not imply activity.
   * @param pieceId - canonical piece identity in this Host's repository association.
   * @returns detached records ordered by requested time, then delegation id; never truncated.
   * @throws when the piece id is invalid or storage is closed.
   */
  getDelegations(pieceId: string): Promise<readonly DelegationRecord[]> {
    return Promise.resolve().then(() => {
      pieceIdSchema.parse(pieceId)
      return [...this.table.entries()].map(([, record]) => record).filter(record => record.pieceId === pieceId)
        .sort((a, b) => a.requestedAt - b.requestedAt || a.delegationId.localeCompare(b.delegationId))
        .map(record => structuredClone(record))
    })
  }

  private async perform(caller: Agent, requested: RequestedDelegation, signal: AbortSignal): Promise<SettledDelegation> {
    await this.table.put(requested.delegationId, requested)
    let ticket: QueueTicket | undefined
    let assignment: WorktreeAssignment | undefined
    const startup = { attempted: false }
    let childId: SettledDelegation['subagentSessionId']
    let preset: string | undefined
    let observation: { kind: 'result'; result: SubagentResult } | { kind: 'failed'; error: unknown }
    let cleanup: SettledDelegation['cleanup'] = 'quiescent'
    try {
      ticket = await this.ctx.agents.withInitiator(caller, () => this.ctx.devLoopQueue.enqueue({
        pieceId: requested.pieceId, signal,
        dispatch: async (agent, dispatchSignal) => {
          const cwd = agent.session.header.cwd
          if (cwd === undefined) throw new Error('Role delegation requires a parent workspace cwd')
          assignment = await this.ctx.devLoopWorktree.assignWorktree({ pieceId: requested.pieceId, cwd, signal: dispatchSignal })
          const policy = this.config.roles[requested.role]
          startup.attempted = true
          const run = await this.ctx.subagents.start(policy.provider, {
            parent: agent, signal: dispatchSignal, cwd: assignment.worktreePath,
            label: `${requested.role}: ${requested.pieceId}`,
            prompt: [{ type: 'text', text: this.prompt(requested) }],
            persona: policy.persona, toolFilter: policy.toolFilter,
            ...policy.agentOptions === undefined ? {} : { agentOptions: policy.agentOptions },
            ...policy.maxDepth === undefined ? {} : { maxDepth: policy.maxDepth },
          })
          childId = run.id
          preset = run.localAgent?.session.header.agentPreset
          // Queue must receive this actual lease before any result observation or additional await.
          return run
        },
      }))
      observation = { kind: 'result', result: await ticket.result }
    } catch (error) {
      observation = { kind: 'failed', error }
      // Startup may hide a disposal error; Queue can join only a lease it received.
      if (startup.attempted && childId === undefined) cleanup = 'unproven'
      if (ticket !== undefined) {
        try { await ticket.cancel(error) }
        catch (cleanupError) {
          cleanup = 'unproven'
          observation = { kind: 'failed', error: new AggregateError([error, cleanupError], 'Role execution and cleanup failed') }
        }
      }
    }
    let record: SettledDelegation = {
      ...requested, state: 'settled', finishedAt: Date.now(),
      ...childId === undefined ? {} : { subagentSessionId: childId },
      ...preset === undefined ? {} : { effectivePreset: preset },
      ...assignment === undefined ? {} : { worktreeAssignment: { ...assignment } },
      ...observation.kind === 'failed' ? {} : { stopReason: observation.result.stopReason },
      status: observation.kind === 'failed' ? (signal.aborted ? 'aborted' : 'failed') : this.status(observation.result),
      cleanup, outcome: '', limitations: [],
      provenance: { kind: 'reported', role: requested.role, ...preset === undefined ? {} : { preset } },
    }
    if (cleanup === 'unproven') record.status = 'failed'
    if (observation.kind === 'failed') {
      record.outcome = 'Role delegation did not complete.'
      record.limitations = [observation.error instanceof Error ? observation.error.message : 'Role execution failed.',
        ...cleanup === 'unproven' ? ['Queue could not prove child cleanup quiescent.'] : []]
    } else {
      const { result } = observation
      const output = result.output
      if (!output.every(block => block.type === 'text')) {
        record.status = 'failed'
        record.limitations = ['Provider outcome contains non-text content; no complete text report is available.']
      } else {
        record.outcome = output.map(block => block.text).join('')
        if (record.status !== 'completed') record.limitations = ['The reported outcome may be partial because the child did not complete.']
        if (result.diagnostic !== undefined) record.limitations = [...record.limitations, result.diagnostic]
      }
    }
    if (jsonBytes(record) > this.config.maxOutcomeBytes) {
      record = { ...record, status: 'failed', outcome: '', limitations: ['Complete outcome exceeds maxOutcomeBytes; report omitted.'] }
    }
    try {
      if (jsonBytes(record) > this.config.maxOutcomeBytes) {
        throw new Error('Required delegation metadata exceeds maxOutcomeBytes; terminal record cannot be retained')
      }
      await this.table.put(record.delegationId, record)
    } catch (error) {
      throw new AggregateError(observation.kind === 'result' ? [error] : [observation.error, error],
        `Delegation ${requested.delegationId}: terminal persistence failed; requested history remains unresolved`)
    }
    return structuredClone(record)
  }

  private status(result: SubagentResult): SettledDelegation['status'] {
    switch (result.stopReason) {
      case 'completed': return 'completed'
      case 'aborted': return 'aborted'
      default: return 'failed' // Provider-extensible stop reasons cannot establish completion.
    }
  }

  private prompt(request: RequestedDelegation): string {
    return `Role: ${request.role}\nPiece: ${request.pieceId}\nAssignment: ${request.assignment}\nRationale: ${request.rationale}`
      + (request.verification === undefined ? '' : `\nVerification: ${JSON.stringify(request.verification)}`)
      + '\nReport the evidence you inspected, cite sources, and state limitations. Your report is attributed to your role, not direct inspection by the parent.'
  }
}

export default DevLoopRoles
