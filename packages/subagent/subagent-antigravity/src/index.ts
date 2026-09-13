/**
 * Optional installed-Antigravity CLI backend for fresh text delegations.
 * @module @deepseek-ai/dsh-subagent-antigravity
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  assertPositiveFinite,
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type ResolvedSubagentStartRequest,
  type SubagentProvider,
} from '@deepseek-ai/dsh-subagent'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { startAntigravityRun } from './run.ts'

export const name = 'subagent-antigravity'
export const inject = ['subagents', 'subprocess']

/** Deployment-selected executable, model, environment, and process bounds. */
export interface Config {
  /** Unique subagent registry name; defaults to `antigravity`. */
  providerName?: string
  /** Installed CLI executable, resolved by the subprocess provider; defaults to `agy`. */
  command?: string
  /** Native model slug; omission preserves native settings. */
  model?: string
  /** Explicit child environment layered after the subprocess provider's credential scrub. */
  env?: Record<string, string>
  /** Positive whole-run deadline in milliseconds; defaults to 300000. */
  timeoutMs?: number
  /** Retained UTF-8 byte cap per output stream; stdout overflow fails the run. Defaults to 1048576. */
  maxOutputBytes?: number
  /** Managed-range termination grace in milliseconds; defaults to 3000. */
  disposeGraceMs?: number
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default('antigravity'),
  command: z.string().min(1).default('agy'),
  model: z.string().min(1),
  env: z.dict(z.string()).default({}),
  timeoutMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(300_000),
  maxOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1_048_576),
  disposeGraceMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(3_000),
})

type ResolvedConfig = Required<Omit<Config, 'model'>> & Pick<Config, 'model'>

class AntigravityProvider implements SubagentProvider {
  readonly capabilities = NO_START_CAPABILITIES
  readonly inheritsParentContext = false
  readonly name: string

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    this.name = config.providerName
  }

  async start(request: ResolvedSubagentStartRequest) {
    const cwd = resolveChildCwd(name, undefined, request.parent.session.header.cwd)
    return startAntigravityRun(request, {
      ...this.config,
      cwd,
      spawn: spec => this.ctx.subprocess.spawn(spec),
    })
  }
}

/**
 * Register one dormant installed-CLI provider; mounting never authenticates or starts agy.
 * @param ctx - Host context with subagent and subprocess services.
 * @param config - deployment-selected executable, model, environment, and limits.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = Config(config) as ResolvedConfig
  for (const field of ['timeoutMs', 'disposeGraceMs', 'maxOutputBytes'] as const) {
    assertPositiveFinite(name, field, resolved[field])
  }
  ctx.subagents.registerProvider(new AntigravityProvider(ctx, resolved))
}
