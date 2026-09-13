/** Complete normalized error-envelope minimum measured through public tool execution. */
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { brief, fixture, toolConfig, type Fixture } from './harness.ts'

async function overflowReceipt(f: Fixture) {
  const result = await f.ctx.get('tools')!.execute({ name: 'dev_loop_delegate', callId: ToolCallId('minimum-overflow'),
    arguments: brief, agent: f.handle.agent, signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  const history = await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)
  expect(history).toHaveLength(1)
  expect(history[0]).toMatchObject({ state: 'settled', status: 'completed' })
  const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
  expect(text).toContain(history[0]!.delegationId)
  expect(text).toMatch(/complete.*output.*byte.*limit/i)
  return Buffer.byteLength(JSON.stringify(result.content), 'utf8')
}

it('preserves the durable id at the measured normalized error minimum and refuses one byte less at mount', async () => {
  const report = '界'.repeat(1500)
  let exact = 0
  await fixture([textResponse(report)], async (f) => {
    exact = await overflowReceipt(f)
  }, {}, { ...toolConfig, maxToolOutputBytes: 1024 })
  expect(exact).toBeGreaterThan(0)
  expect(exact).toBeLessThan(1024)
  await fixture([textResponse(report)], async (f) => {
    expect(await overflowReceipt(f)).toBe(exact)
  }, {}, { ...toolConfig, maxToolOutputBytes: exact })
  await expect(fixture([], () => Promise.resolve(), {}, { ...toolConfig, maxToolOutputBytes: exact - 1 }))
    .rejects.toThrow(/output.*budget|output.*bytes|at least/i)
})
