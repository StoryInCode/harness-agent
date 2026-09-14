/** Install native model-selectable delegation in each snapshot Agent's scope. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'

export const name = 'antigravity-scoped-tool'
export const inject = ['agents', 'subagentModelSelection']

/**
 * Install the production delegation tool before a fixture Agent's first request.
 * @param ctx - Host fixture context carrying Agent creation notifications.
 */
export function apply(ctx: Context): void {
  const install = (agent: Agent): void => {
    agent.ctx.inject(ToolSubagent.inject, (runtimeCtx) => {
      ToolSubagent.apply(runtimeCtx, {
        provider: 'antigravity', toolName: 'subagent_antigravity',
        backgroundMode: 'one-shot', maxDepth: 'provider-managed', modelSelectionSettings: true,
      }, agent.session)
    })
  }
  ctx.on('agent/created', ({ agent }) => { install(agent) })
  for (const agent of ctx.agents.list()) install(agent)
}
