/** Complete rendered-content budgets for the scoped Claims tool through the real ToolRuntime. */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { fixture, pieceId, research, response } from './harness.ts'
import type { Fixture } from './harness.ts'
import type { ResearchReport } from '../src/types.ts'
import * as tool from '../src/tool.ts'

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const textOf = (result: { readonly content: readonly unknown[] }) =>
  result.content.filter(block => (block as { type: string }).type === 'text')
    .map(block => (block as { text: string }).text).join('')

/** Bulk that reaches only the rendered report wrapper and proof rows, never the durable evidence bytes. */
const bulky = (): ResearchReport => ({ ...research(), additionalClaims: [{
  claim: `界 ${'界'.repeat(1_200)}`, kind: 'repository', loadBearing: false,
  decisionRestingOnClaim: 'Complete rendered envelope sizing only.' }] })

async function toolRun(f: Fixture, maxToolOutputBytes: number, args: { pieceId: string } = { pieceId }) {
  const handle = await f.ctx.get('agents')!.create({ sessionId: SessionId(randomUUID()), meta: { cwd: f.repo },
    agentOptions: { provider: 'mock', model: 'mock' },
    setup: async (ctx) => { await ctx.plugin(tool, { maxToolOutputBytes }) } })
  try {
    return await f.ctx.get('tools')!.execute({ name: 'dev_loop_verify_claims', callId: ToolCallId(randomUUID()),
      arguments: args, agent: handle.agent, signal: new AbortController().signal })
  } finally { await handle.dispose() }
}

it('accepts the exact complete rendered envelope and refuses one byte less without partial report text', async () => {
  await fixture([response(bulky()), response(bulky()), response(bulky())], async (f) => {
    const generous = await toolRun(f, 262_144)
    expect(generous.isError).toBe(false)
    expect(textOf(generous)).toContain('Resources and proof')
    const exact = bytes(generous.content)
    expect(exact).toBeGreaterThan(Buffer.byteLength('界'.repeat(1_200)))

    const accepted = await toolRun(f, exact)
    expect(accepted.isError).toBe(false)
    // Only random UUID and epoch widths appear between runs; the equality premise is the byte assertion.
    expect(bytes(accepted.content)).toBe(exact)
    expect(textOf(accepted)).toContain('Resources and proof')

    const refused = await toolRun(f, exact - 1)
    expect(refused.isError).toBe(true)
    expect(bytes(refused.content)).toBeLessThanOrEqual(exact - 1)
    const text = textOf(refused)
    expect(text).toMatch(/exceed|byte|limit/i)
    expect(text).not.toContain('界')
    const report = await f.claims.getReport(pieceId)
    expect(report).toMatchObject({ state: 'completed' })
    expect(text).toContain(report!.reportId)
  })
})

it('bounds a pre-execution policy error through the real native error prefix path', async () => {
  const reason = `Policy denial: ${'界'.repeat(2_000)}`
  await fixture([], async (f) => {
    f.ctx.on('tools/pre-execute', async (_exec, _next) => { throw new Error(reason) })
    const result = await toolRun(f, 4_096)
    expect(result.isError).toBe(true)
    expect(bytes(result.content)).toBeLessThanOrEqual(4_096)
    const text = textOf(result)
    expect(text).not.toContain('界')
    expect(text).toMatch(/byte|limit/i)
    expect(f.adapter.requests).toEqual([])
  })
})

it('bounds parsed-input validation errors carrying a large unknown field name', async () => {
  await fixture([], async (f) => {
    const result = await toolRun(f, 4_096, { pieceId, [`dev_loop_${'未知'.repeat(400)}`]: true } satisfies { pieceId: string } & Record<string, boolean>)
    expect(result.isError).toBe(true)
    expect(bytes(result.content)).toBeLessThanOrEqual(4_096)
    const text = textOf(result)
    expect(text).not.toContain('未知')
    expect(text).toMatch(/byte|limit|unrecognized|key/i)
    expect(f.adapter.requests).toEqual([])
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
  })
})
