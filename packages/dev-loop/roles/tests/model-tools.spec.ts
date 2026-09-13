/** Real Loader-scoped tools and AgentLoop model/log projection; no delegation business mocks. */
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture, brief } from './harness.ts'
import * as tool from '../src/tool.ts'

it('exposes both scoped schemas, rejects Reviewer and parser-only authority fields without a child', async () => {
  await fixture([], async (f) => {
    const tools = f.ctx.get('tools')!
    expect('default' in tool).toBe(false)
    const schemas = tools.schemas(f.handle.agent)
    expect(schemas.map(schema => schema.name)).toEqual(expect.arrayContaining(['dev_loop_delegate', 'dev_loop_delegations']))
    expect(tools.schemas().map(schema => schema.name)).not.toContain('dev_loop_delegate')
    for (const args of [{ ...brief, role: 'Reviewer' }, { ...brief, cwd: f.repo }, { ...brief, preset: 'arbitrary' }]) {
      const result = await tools.execute({ callId: ToolCallId('invalid'), name: 'dev_loop_delegate',
        arguments: args, agent: f.handle.agent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
    }
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
    await f.handle.dispose()
    expect(tools.schemas().map(schema => schema.name)).not.toContain('dev_loop_delegations')
  })
})

it('logs delegation/history receipts exactly as the next Brain request sees them and denies Research write execution', async () => {
  await fixture([
    toolCallResponse('delegate', 'dev_loop_delegate', brief),
    toolCallResponse('forbidden-write', 'write', { file_path: 'forbidden.txt', content: 'must not execute' }),
    textResponse('Research reports: write denied; limitation: no external source checked.'),
    toolCallResponse('history', 'dev_loop_delegations', { pieceId: brief.pieceId }),
    textResponse('Reported by Research; no preset recorded.'),
  ], async (f) => {
    const logged: Array<{ id: string; isError: boolean; text: string }> = []
    await runFixtureTurn(f.ctx, { task: 'Delegate bounded research, then retrieve its history.', onEvent(_id, event) {
      if (event.type !== 'tool/result') return
      const block = event.data.message.content[0]
      logged.push({ id: block.toolCallId, isError: block.isError ?? false,
        text: block.content.filter(member => member.type === 'text').map(member => member.text).join('') })
    } })
    expect(logged.map(row => [row.id, row.isError])).toEqual([['delegate', false], ['history', false]])
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)
    expect(history).toHaveLength(1)
    const record = history[0]!
    expect(record.state).toBe('settled')
    if (record.state !== 'settled') throw new Error('Expected terminal durable observation')
    expect(record.provenance).toEqual({ kind: 'reported', role: 'Research' })
    expect(record.effectivePreset).toBeUndefined()
    expect(logged[0]!.text).toContain(record.delegationId)
    expect(logged[0]!.text).toMatch(/reported/i)
    expect(logged[1]!.text).toContain(record.delegationId)
    expect(f.adapter.requests).toHaveLength(5)
    expect(f.adapter.requests[1]!.tools?.map(schema => schema.name)).toEqual(['read'])
    const denied = f.adapter.requests[2]!.messages.flatMap(message => message.content)
      .find(block => block.type === 'tool-result' && block.toolCallId === 'forbidden-write')
    expect(denied).toMatchObject({ type: 'tool-result', isError: true })
    await expect(access(join(record.worktreeAssignment!.worktreePath, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    const replay = f.adapter.requests[4]!.messages.flatMap(message => message.content)
      .filter(block => block.type === 'tool-result').map(block => ({ id: block.toolCallId, isError: block.isError ?? false,
        text: block.content.filter(member => member.type === 'text').map(member => member.text).join('') }))
    expect(replay).toEqual(logged)
  })
})
