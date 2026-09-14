/**
 * Configuration and option types for the Antigravity LLM provider adapter.
 * @module @deepseek-ai/dsh-llm-antigravity/types
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Configuration schema for the Antigravity LLM provider plugin. */
export interface Config {
  /** Route provider name registered on ctx.llm; defaults to 'antigravity'. */
  providerName?: string
  /** Installed executable name or path; defaults to 'agy'. */
  command?: string
  /** Timeout in milliseconds for model inference turns; defaults to 300000 (5 minutes). */
  timeoutMs?: number
  /** Process disposal grace time in milliseconds; defaults to 3000. */
  disposeGraceMs?: number
  /** Child process environment overlays. */
  env?: Record<string, string>
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default('antigravity'),
  command: z.string().min(1).default('agy'),
  timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(300_000),
  disposeGraceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(3_000),
  env: z.dict(z.string()).default({}),
})

export type ResolvedConfig = Required<Config>
