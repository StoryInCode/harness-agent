/** Validate deployment-selected child capabilities before opening role history. @module dsh-dev-loop-roles/config */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type { Config } from './types.ts'
import { roleNames } from './records.ts'

/**
 * Refuse unavailable providers and unsupported policy before opening history.
 * @param ctx - Host subagent registry owner.
 * @param config - validated explicit role policies.
 */
export function validateProviders(ctx: Context, config: Config): void {
  if (config.roles.Research.toolFilter.allow === undefined || config.roles.Research.toolFilter.allow.length === 0) {
    throw new Error('Research requires a nonempty explicit toolFilter allowlist')
  }
  for (const name of roleNames) {
    const policy = config.roles[name]
    if (!policy.provider.trim() || !policy.persona.trim()) throw new Error(`${name} requires nonempty provider and persona config`)
    if (policy.toolFilter.allow === undefined && policy.toolFilter.deny === undefined) {
      throw new Error(`${name} requires an explicit toolFilter allow and/or deny`)
    }
    const provider = ctx.subagents.getProvider(policy.provider)
    if (provider === undefined) throw new Error(`${name}: missing subagent provider ${policy.provider}`)
    const needs = [
      ['persona', true], ['toolFilter', true],
      ['agentOptions', policy.agentOptions !== undefined], ['depthLimit', policy.maxDepth !== undefined],
    ] as const
    for (const [capability, required] of needs) {
      if (required && !provider.capabilities[capability]) {
        throw new Error(`${name}: provider ${policy.provider} lacks ${capability} capability`)
      }
    }
  }
}
