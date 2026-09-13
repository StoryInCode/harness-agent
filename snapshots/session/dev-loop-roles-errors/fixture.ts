/** Mount the actual Roles tool consumer only on the headless Brain's Agent scope. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import * as roleTools from '@deepseek-ai/dsh-dev-loop-roles/tool'

export const name = 'snapshot-role-tools'
export const inject = ['agents', 'devLoopRoles', 'tools']

/** Register the scoped consumer before the shipped runner submits its task. */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession === undefined) {
      agent.ctx.plugin(roleTools, { maxToolOutputBytes: 16384, maxHistoryRecords: 10 })
    }
  })
}
