/**
 * Cordis plugin for the Antigravity LLM provider adapter.
 * @module @deepseek-ai/dsh-llm-antigravity
 */

import type { Context } from '@deepseek-ai/cordis'
import { AntigravityLlmAdapter } from './adapter.ts'
import { Config, type ResolvedConfig } from './types.ts'

export * from './types.ts'
export * from './models.ts'
export * from './adapter.ts'

export const name = 'llm-antigravity'
export const inject = ['llm', 'subprocess']

/**
 * Register the Antigravity LLM adapter on ctx.llm.
 * @param ctx - Cordis context containing llm and subprocess services.
 * @param config - Plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = Config(config) as ResolvedConfig
  const adapter = new AntigravityLlmAdapter(ctx, resolved)
  ctx.effect(() => {
    return ctx.llm.registerAdapter([resolved.providerName], adapter)
  }, 'llm-antigravity.registerAdapter()')
}

export default { name, inject, Config, apply }

