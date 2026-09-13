/** Scoped Brain tools with consumer-owned rendering and history limits. @module dsh-dev-loop-roles/tool */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as json } from 'zod'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from './index.ts'
import { briefSchema, jsonBytes, pieceIdSchema, roleNames } from './records.ts'
import type { ToolConfig } from './types.ts'
export type { ToolConfig } from './types.ts'

/** Loader identity of the scoped consumer. */
export const name = 'tool-dev-loop-roles'
/** Host registries consumed by the Brain's scoped plugin. */
export const inject = ['tools', 'agents', 'devLoopRoles']
/** Consumer-owned positive safe-integer output and history limits. */
export const Config: z<ToolConfig> = z.object({
  maxToolOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxHistoryRecords: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

const historyInput = json.strictObject({ pieceId: pieceIdSchema })
const textContent = (text: string) => [{ type: 'text' as const, text }]
const outputOverflow = (id: string) => `Delegation ${id}: complete tool output exceeds byte limit; retrieve durable history with a larger output budget.`
const historyOverflow = 'Delegation history overflow: complete history exceeds the record or byte limit; no partial history returned.'
const errorOverflow = 'Role tool error exceeds output byte limit; inspect Host diagnostics.'

/**
 * Contribute bounded model tools to one Agent scope; registrations unwind with the plugin.
 * @param ctx - scoped registration owner with the shared Host service.
 * @param config - consumer-owned output and history budgets, never service-private policy.
 * @throws if the byte budget cannot hold the complete fixed error envelopes.
 */
export function apply(ctx: Context, config: ToolConfig): void {
  const limits = Config(config)
  // ToolRuntime prefixes thrown errors before content finalization.
  const minimum = Math.max(...[outputOverflow('00000000-0000-0000-0000-000000000000'), historyOverflow, errorOverflow]
    .map(text => jsonBytes(textContent(`Error: ${text}`))))
  if (limits.maxToolOutputBytes < minimum) throw new Error(`maxToolOutputBytes output budget must be at least ${minimum} bytes`)
  const requireCaller = (exec: ToolRunContext) => {
    const agent = exec.agent
    if (agent === undefined || ctx.agents.get(agent.id) !== agent) throw new Error('Role tools require an exact live initiator')
    return agent
  }
  const output = { schema: { type: 'string' as const }, render: (_args: unknown, value: string) => textContent(value) }
  const finalizeContent = (_exec: unknown, result: { readonly content: readonly unknown[] }) =>
    jsonBytes(result.content) > limits.maxToolOutputBytes ? textContent(errorOverflow) : undefined

  ctx.tools.register(defineTool({
    name: 'dev_loop_delegate',
    description: 'Delegate a bounded assignment to Research, Test Writer, Implementer, or Utility in the piece’s retained worktree. '
      + 'Returns durable reported evidence after child cleanup. Attribute reports to the recorded role and preset, not your direct inspection.',
    parameters: {
      pieceId: { type: 'string', required: true, description: 'Canonical dotted piece id in this repository.' },
      role: { type: 'string', enum: roleNames, required: true },
      assignment: { type: 'string', required: true, description: 'Complete bounded assignment.' },
      rationale: { type: 'string', required: true, description: 'Decision or work that requires this delegation.' },
      verification: { type: 'object', additionalProperties: false, properties: {
        claim: { type: 'string', required: true }, decisionRestingOnClaim: { type: 'string', required: true },
        permittedSources: { type: 'array', items: { type: 'string' }, required: true },
        requiredEvidence: { type: 'array', items: { type: 'string' }, required: true },
      } },
    },
    output, finalizeContent,
    async execute(args, exec) {
      const agent = requireCaller(exec)
      const brief = briefSchema.parse(args)
      const record = await ctx.agents.withInitiator(agent, () => ctx.devLoopRoles.delegate(brief, exec.signal))
      const text = JSON.stringify(record)
      if (jsonBytes(textContent(text)) > limits.maxToolOutputBytes) throw new Error(outputOverflow(record.delegationId))
      return text
    },
  }))
  ctx.tools.register(defineTool({
    name: 'dev_loop_delegations',
    description: 'Read complete ordered durable delegation history for a piece. Requested records are unresolved intent, not proof of running children. '
      + 'Reports are attributed to their recorded role and actual preset; an absent preset means no preset was recorded. Overflow returns no partial array.',
    parameters: { pieceId: { type: 'string', required: true, description: 'Canonical dotted piece id in this repository.' } },
    output, finalizeContent,
    async execute(args, exec) {
      const agent = requireCaller(exec)
      const { pieceId } = historyInput.parse(args)
      const records = await ctx.agents.withInitiator(agent, () => ctx.devLoopRoles.getDelegations(pieceId))
      if (records.length > limits.maxHistoryRecords) throw new Error(historyOverflow)
      const text = JSON.stringify(records)
      if (jsonBytes(textContent(text)) > limits.maxToolOutputBytes) throw new Error(historyOverflow)
      return text
    },
  }))
}
