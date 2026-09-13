/** Configuration refusal and final model-tool behavior through the real runtime. */
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { brief, fixture, policy, toolConfig } from './harness.ts'

it.each(['provider', 'persona'] as const)('refuses whitespace-only Research %s at Host mounting', async (field) => {
  const config = policy()
  config.roles.Research[field] = '   '
  await expect(fixture([], () => Promise.resolve(), config)).rejects.toThrow(/nonempty provider and persona/i)
})

it('refuses a configuration that supplies neither allow nor deny tool policy', async () => {
  const config = policy()
  config.roles.Research.toolFilter = {}
  await expect(fixture([], () => Promise.resolve(), config)).rejects.toThrow(/explicit toolFilter/i)
})

it('accepts an explicit deny-only policy and applies it to actual inherited model schemas', async () => {
  const config = policy()
  config.roles.Utility.toolFilter = { deny: ['write', 'edit'] }
  await fixture([(options) => {
    expect(options.tools?.map(tool => tool.name)).toContain('read')
    expect(options.tools?.map(tool => tool.name)).not.toContain('write')
    expect(options.tools?.map(tool => tool.name)).not.toContain('edit')
    return textResponse('Inspected read-only inherited tool policy.')
  }], async (f) => {
    expect(await f.delegate({ ...brief, role: 'Utility' })).toMatchObject({ status: 'completed' })
  }, config)
})

it('bounds a complete oversized JSON-parser diagnostic at final tool rendering without recording intent', async () => {
  await fixture([], async (f) => {
    const result = await f.ctx.get('tools')!.execute({ name: 'dev_loop_delegate', callId: ToolCallId('oversized-parser-error'),
      arguments: { ...brief, ['界'.repeat(4000)]: 'unrecognized JSON field' }, agent: f.handle.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Role tool error exceeds output byte limit; inspect Host diagnostics.' }])
    expect(Buffer.byteLength(JSON.stringify(result.content), 'utf8')).toBeLessThanOrEqual(1024)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
  }, {}, { ...toolConfig, maxToolOutputBytes: 1024 })
})

it('refuses an actual published caller disposed during the extensible pre-execute gate', async () => {
  await fixture([], async (f) => {
    f.ctx.on('tools/pre-execute', async (exec, next) => {
      if (exec.name === 'dev_loop_delegations') await f.handle.dispose()
      return next()
    })
    const result = await f.ctx.get('tools')!.execute({ name: 'dev_loop_delegations', callId: ToolCallId('disposed-during-policy'),
      arguments: { pieceId: brief.pieceId }, agent: f.handle.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(result.content.filter(block => block.type === 'text').map(block => block.text).join(' '))
      .toMatch(/live initiator|unavailable|unknown|disposed/i)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
  })
})
