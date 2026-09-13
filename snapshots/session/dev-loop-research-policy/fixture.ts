/** Mount the production Roles consumer on the headless Brain before its first task. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import * as roleTools from '@deepseek-ai/dsh-dev-loop-roles/tool'

/** Scenario plugin identity. */
export const name = 'snapshot-research-role-tools'
/** Host services consumed by the scoped Roles consumer. */
export const inject = ['agents', 'devLoopRoles', 'tools']

/**
 * Register the actual consumer only on the root Agent; the child inherits its restriction.
 * @param ctx - scenario Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.parentSession === undefined) {
      agent.ctx.plugin(roleTools, { maxToolOutputBytes: 32768, maxHistoryRecords: 16 })
    }
  })
}
