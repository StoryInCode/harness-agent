/** Exact complete UTF-8 budgets through public Roles and ToolRuntime operations. */
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { brief, fixture, toolConfig, type Fixture } from './harness.ts'
import * as tool from '../src/tool.ts'

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

it('accepts an exact multibyte brief budget and rejects one byte less before recording intent', async () => {
  const input = { ...brief, assignment: 'Verify 界 evidence.' }
  const exact = bytes(input)
  await fixture([textResponse('bounded report')], async (f) => {
    expect((await f.delegate(input)).status).toBe('completed')
  }, { maxBriefBytes: exact })
  await fixture([], async (f) => {
    await expect(f.delegate(input)).rejects.toThrow(/brief|byte|limit/i)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(input.pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
  }, { maxBriefBytes: exact - 1 })
})

it('counts the complete settled record at exact outcome equality, including metadata and multibyte text', async () => {
  const report = '界'.repeat(512)
  let exact = 0
  await fixture([textResponse(report)], async (f) => { exact = bytes(await f.delegate()) })
  expect(exact).toBeGreaterThan(Buffer.byteLength(report))
  // Private roots, UUIDs, Git ids and epoch timestamps have equal serialized widths in these adjacent fixtures.
  // The equality assertion verifies that premise instead of silently normalizing metadata away.
  await fixture([textResponse(report)], async (f) => {
    const record = await f.delegate()
    expect(bytes(record)).toBe(exact)
    expect(record).toMatchObject({ status: 'completed', outcome: report })
  }, { maxOutcomeBytes: exact })
  await fixture([textResponse(report)], async (f) => {
    const record = await f.delegate()
    expect(record.status).toBe('failed')
    expect(record.limitations.join(' ')).toMatch(/outcome|byte|limit/i)
    expect(record.outcome).not.toContain('界')
    expect(bytes(record)).toBeLessThanOrEqual(exact - 1)
  }, { maxOutcomeBytes: exact - 1 })
})

async function historyAtBudget(f: Fixture, maxToolOutputBytes: number) {
  const handle = await f.ctx.get('agents')!.create({ sessionId: SessionId(randomUUID()), meta: { cwd: f.repo },
    setup: async (ctx) => { await ctx.plugin(tool, { ...toolConfig, maxToolOutputBytes }) } })
  try {
    return await f.ctx.get('tools')!.execute({ name: 'dev_loop_delegations', callId: ToolCallId(randomUUID()),
      arguments: { pieceId: brief.pieceId }, agent: handle.agent, signal: new AbortController().signal })
  } finally { await handle.dispose() }
}

it('accepts the exact complete rendered history envelope and refuses one byte less without a partial array', async () => {
  await fixture([textResponse('界'.repeat(200))], async (f) => {
    const record = await f.delegate()
    const generous = await historyAtBudget(f, toolConfig.maxToolOutputBytes)
    expect(generous.isError).toBe(false)
    const exact = bytes(generous.content)
    const accepted = await historyAtBudget(f, exact)
    expect(accepted.isError).toBe(false)
    expect(accepted.content).toEqual(generous.content)
    expect(bytes(accepted.content)).toBe(exact)
    const refused = await historyAtBudget(f, exact - 1)
    expect(refused.isError).toBe(true)
    expect(bytes(refused.content)).toBeLessThanOrEqual(exact - 1)
    const error = refused.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(error).toMatch(/history.*overflow|complete.*limit/i)
    expect(error).not.toContain('界')
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  })
})

it('records a non-text provider report as failed rather than claiming complete text evidence', async () => {
  const reasoningOnly: StreamChunk[] = [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: 'Private reasoning is not a reported text outcome.' },
    { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Private reasoning is not a reported text outcome.' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
  await fixture([reasoningOnly], async (f) => {
    const record = await f.delegate()
    expect(record).toMatchObject({ status: 'failed', cleanup: 'quiescent', outcome: '' })
    expect(record.limitations.join(' ')).toMatch(/non.text|text report/i)
    expect(bytes(record)).toBeLessThanOrEqual(16384)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  })
})
