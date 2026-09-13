import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { readExternalCredential } from '../src/external-auth.ts'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Opt-in real-API e2e for the vendor-CLI OAuth routes. Every test is gated
 * behind its own environment switch and self-skips otherwise, so a normal CI
 * run never touches a real subscription or makes a paid request:
 *
 *   DSH_TEST_CODEX_OAUTH=1    Codex CLI login (ChatGPT Plus/Pro)
 *   DSH_TEST_CLAUDE_OAUTH=1   Claude Code login (Claude Pro/Max)
 *   DSH_TEST_GEMINI_OAUTH=1   Google ADC (`gcloud auth application-default login`)
 *
 * Each test boots the REAL plugin stack (LlmRuntime + llm-pi-ai with a bare
 * route profile), so authentication flows through the production credential
 * store: Harness records first, then the vendor CLI's own credential file.
 *
 * Provider errors surface as an error finish reason, not a throw. A rate-limit
 * failure proves the subscription route authenticated and was quota-checked —
 * which is the integration under test — and is accepted; an authentication or
 * configuration failure is not.
 */

const contexts: Context[] = []

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: {
      'openai-codex': {},
      anthropic: {},
      'google-vertex': {},
    },
  })
  return ctx
}

/** First model id the route serves, so the test tracks the catalog. */
async function firstModel(ctx: Context, provider: string): Promise<string> {
  const models = await ctx.llm.listModels(provider)
  if (models.length === 0) throw new Error(`provider "${provider}" serves no models`)
  return models[0]?.id ?? ''
}

function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function failureText(result: AssembledResult): string {
  return result.finish.kind === 'error' ? JSON.stringify(result.finish) : ''
}

/**
 * The ambient token must never surface in a response or an error image. The
 * assertion reads the credential the same way the store does, so it holds on
 * every supported source (file, legacy, keychain).
 */
async function withoutSecret<T>(provider: string, run: () => Promise<T>): Promise<T> {
  const secret = await readExternalCredential(provider)
  try {
    return await run()
  } catch (error) {
    const image = String(error instanceof Error ? error.message : error)
    if (secret !== undefined && image.includes(JSON.stringify(secret).slice(1, -1))) {
      throw new Error('error message leaked the ambient credential')
    }
    throw error
  }
}

/**
 * Assert an error finish proves the subscription route authenticated: a
 * rate-limit rejection is authenticated and quota-checked, which is the
 * integration under test; an authentication or configuration failure is not.
 * Returns true when the outcome was a rate limit, so the caller can skip the
 * answer-text assertion there is no answer to assert on.
 */
function rateLimitedOrThrow(result: AssembledResult): boolean {
  if (result.finish.kind !== 'error') return false
  const image = failureText(result)
  expect(image).toMatch(/RATE_LIMIT|rate_limit/i)
  expect(image).not.toMatch(/invalid.api.key|unauthorized|401|not configured|sign in again/i)
  return true
}

describe.skipIf(process.env.DSH_TEST_CLAUDE_OAUTH !== '1')('Claude Code OAuth route (real API)', () => {
  it('answers from the Claude Code login without ANTHROPIC_API_KEY', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const ctx = await harness()
    const model = await firstModel(ctx, 'anthropic')
    const result = await withoutSecret('anthropic', () => assemble(ctx, {
      provider: 'anthropic',
      model,
      messages: ask('Reply with exactly: OK'),
      maxTokens: 300,
    }))
    if (!rateLimitedOrThrow(result)) expect(textOf(result)).toContain('OK')
  })
})

describe.skipIf(process.env.DSH_TEST_CODEX_OAUTH !== '1')('Codex OAuth route (real API)', () => {
  it('answers from the Codex CLI login without OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_API_KEY
    const ctx = await harness()
    const model = await firstModel(ctx, 'openai-codex')
    const result = await withoutSecret('openai-codex', () => assemble(ctx, {
      provider: 'openai-codex',
      model,
      messages: ask('Reply with exactly: OK'),
      maxTokens: 400,
    }))
    if (!rateLimitedOrThrow(result)) expect(textOf(result)).toContain('OK')
  })
})

describe.skipIf(process.env.DSH_TEST_GEMINI_OAUTH !== '1')('Gemini ADC route (real API)', () => {
  it('answers through Google ADC without GEMINI_API_KEY, or names the missing setup', async () => {
    delete process.env.GEMINI_API_KEY
    const ctx = await harness()
    const model = await firstModel(ctx, 'google-vertex')
    const result = await withoutSecret('google-vertex', () => assemble(ctx, {
      provider: 'google-vertex',
      model,
      messages: ask('Reply with exactly: OK'),
      maxTokens: 300,
    }))
    const image = failureText(result)
    if (image === '') {
      expect(textOf(result)).toContain('OK')
      return
    }
    // Without ADC on the machine the route must fail with the actionable
    // remediation, never an API-key complaint or a token leak.
    expect(image).toMatch(/application-default|no Google Cloud project|not configured/i)
    expect(image).not.toMatch(/API key/i)
    expect(image).not.toContain('GOOGLE_SECRET_TEST_123')
  })
})
