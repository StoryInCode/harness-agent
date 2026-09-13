/** Owner-specific configuration and complete model output bounds. */
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture, brief, policy, toolConfig } from './harness.ts'

it('requires four explicit Host role policies and positive safe-integer retention budgets', async () => {
  const config = policy()
  const { Utility: _utility, ...missing } = config.roles
  await expect(fixture([], () => Promise.resolve(), { ...config,
    roles: missing as typeof config.roles })).rejects.toThrow(/role|Utility|config/i)
  await expect(fixture([], () => Promise.resolve(), { maxBriefBytes: 0 })).rejects.toThrow(/brief|config|positive/i)
})

it('rejects a missing provider at mount instead of degrading the role policy', async () => {
  const config = policy()
  config.roles.Research.provider = 'missing-provider'
  await expect(fixture([], () => Promise.resolve(), config)).rejects.toThrow(/provider/i)
})

it('refuses the real ACP provider because it cannot enforce persona and tool filters', async () => {
  const config = policy()
  config.roles.Research.provider = 'acp'
  await expect(fixture([], () => Promise.resolve(), config)).rejects.toThrow(/capabilit|persona|toolFilter|filter/i)
})

it('rejects tool budgets too small for the complete fixed overflow envelope at the consumer mount', async () => {
  await expect(fixture([], () => Promise.resolve(), {}, { ...toolConfig, maxToolOutputBytes: 1 }))
    .rejects.toThrow(/output|budget|bytes|limit/i)
})

it('returns an explicit history overflow rather than silently returning a partial array', async () => {
  await fixture([textResponse('first'), textResponse('second')], async (f) => {
    await f.delegate()
    await f.delegate({ ...brief, role: 'Utility' })
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)
    expect(history).toHaveLength(2)
    const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('history-overflow'),
      name: 'dev_loop_delegations', arguments: { pieceId: brief.pieceId }, agent: f.handle.agent,
      signal: new AbortController().signal })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toMatch(/overflow|limit|too many/i)
    expect(text).not.toContain(history[0]!.assignment)
    expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(toolConfig.maxToolOutputBytes)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual(history)
  }, {}, { ...toolConfig, maxHistoryRecords: 1 })
})

it('names the durable id when a complete delegation tool result exceeds its consumer byte budget', async () => {
  await fixture([textResponse('界'.repeat(1500))], async (f) => {
    const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('output-overflow'), name: 'dev_loop_delegate',
      arguments: brief, agent: f.handle.agent, signal: new AbortController().signal })
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ state: 'settled', status: 'completed', outcome: '界'.repeat(1500) })
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain(history[0]!.delegationId)
    expect(text).toMatch(/overflow|limit|bytes|large/i)
    expect(text).not.toContain('界')
    expect(Buffer.byteLength(JSON.stringify(result.content))).toBeLessThanOrEqual(1024)
  }, {}, { ...toolConfig, maxToolOutputBytes: 1024 })
})
