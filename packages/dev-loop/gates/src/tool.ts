/** Scoped model consumer scaffold; Host owns commands and runner policy. @module dsh-dev-loop-gates/tool */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from './index.ts'
import type { ToolConfig } from './types.ts'
export type { ToolConfig } from './types.ts'
/** Loader identity of the agent-scoped Consumer. */
export const name = 'tool-dev-loop-gates'
/** Registries required by the real scoped executor. */
export const inject = ['tools', 'agents', 'devLoopGates', 'devLoopLifecycle']
/** Complete rendered UTF-8 budget, including error wrappers; no partial JSON is permitted. */
export const Config: z<ToolConfig> = z.object({ maxToolOutputBytes: z.number().required() })
const missing = (tool: string): never => {
  throw new Error(`Missing Gates behavior: ${tool} exact caller, cancellation and bounded receipt`)
}
/**
 * Register the three scoped tools with pure JSON output; effects unwind with their owner.
 * @param ctx - Actual agent-scoped tool registration owner.
 * @param config - Complete model result byte budget, not runner configuration.
 */
export function apply(ctx: Context, config: ToolConfig): void {
  void config
  ctx.tools.register(defineTool({
    name: 'dev_loop_check',
    description: 'Run the owner-configured evidence checks for one piece at one stage and retain the derived report.',
    parameters: {
      pieceId: { type: 'string', required: true, description: 'Canonical dotted piece id in this repository.' },
      stage: { type: 'string', required: true, description: 'Either worktree or post-transfer.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    async execute(): Promise<string> { return missing('dev_loop_check') },
  }))
  ctx.tools.register(defineTool({
    name: 'dev_loop_gate_report',
    description: 'Return the latest detached gate report for one piece without rerunning any command.',
    parameters: {
      pieceId: { type: 'string', required: true, description: 'Canonical dotted piece id in this repository.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    async execute(): Promise<string> { return missing('dev_loop_gate_report') },
  }))
  ctx.tools.register(defineTool({
    name: 'dev_loop_complete',
    description: 'Request Lifecycle completion of one pending piece; the actual gates hook validates evidence.',
    parameters: {
      pieceId: { type: 'string', required: true, description: 'Canonical dotted piece id in this repository.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    async execute(): Promise<string> { return missing('dev_loop_complete') },
  }))
}
