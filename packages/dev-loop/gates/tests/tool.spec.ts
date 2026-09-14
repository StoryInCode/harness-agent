/** Scoped dev_loop_check / dev_loop_gate_report / dev_loop_complete consumer: schemas, authority, budgets. */
import { expect, test } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { fixture, pieceId } from './harness.ts'

test('contributes exactly the three gate tools in the caller scope and removes them on disposal', async () => {
  await fixture(async (f) => {
    const tools = f.ctx.get('tools')!
    const names = () => tools.schemas(f.handle.agent).map(item => item.name)
    expect(names()).toEqual(expect.arrayContaining(['dev_loop_check', 'dev_loop_gate_report', 'dev_loop_complete']))
    expect(tools.schemas().map(item => item.name)).not.toContain('dev_loop_check')
    await f.handle.dispose()
    expect(names()).not.toContain('dev_loop_check')
    expect(names()).not.toContain('dev_loop_gate_report')
    expect(names()).not.toContain('dev_loop_complete')
  })
})

test('dev_loop_check accepts only pieceId and stage with the exact stage vocabulary', async () => {
  await fixture(async (f) => {
    const schema = f.ctx.get('tools')!.schemas(f.handle.agent).find(item => item.name === 'dev_loop_check')
    expect(JSON.stringify(schema)).toContain('worktree')
    expect(JSON.stringify(schema)).toContain('post-transfer')
  })
})

test.each([
  [{}], [{ pieceId }], [{ stage: 'worktree' }], [{ pieceId, stage: 'mainline' }], [{ pieceId: '' }],
])('dev_loop_check refuses malformed arguments: %j', async (args) => {
  await fixture(async (f) => {
    const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('malformed'), name: 'dev_loop_check',
      arguments: args, agent: f.handle.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/pieceId|stage|Invalid|invalid|Unrecognized/)
  })
})

test.each(['passed', 'evidence', 'revision', 'command', 'report', 'gateResult', 'evaluations', 'signal'])(
  'dev_loop_check rejects caller-written %s authority', async (field) => {
    await fixture(async (f) => {
      const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('authority'), name: 'dev_loop_check',
        arguments: { pieceId, stage: 'worktree', [field]: 'forged' },
        agent: f.handle.agent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toMatch(/Unrecognized|unexpected|Unknown|invalid/i)
    })
  })

test.each(['passed', 'evidence', 'revision', 'command', 'lifecycleResult', 'autoBlock'])(
  'dev_loop_complete rejects caller-written %s authority', async (field) => {
    await fixture(async (f) => {
      const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('authority-complete'), name: 'dev_loop_complete',
        arguments: { pieceId, [field]: 'forged' },
        agent: f.handle.agent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toMatch(/Unrecognized|unexpected|Unknown|invalid/i)
    })
  })

test('dev_loop_check calls the actual Gates runChecks through the live caller', async () => {
  await fixture(async (f) => {
    const result = await f.ctx.get('agents')!.withInitiator(f.handle.agent, () =>
      f.ctx.get('tools')!.execute({ callId: ToolCallId('check'), name: 'dev_loop_check',
        arguments: { pieceId, stage: 'worktree' }, agent: f.handle.agent, signal: new AbortController().signal }))
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('reportId')
    expect(f.handoff.reads.length).toBeGreaterThan(0)
  })
})

test('dev_loop_gate_report returns the detached report without rerunning checks', async () => {
  await fixture(async (f) => {
    await f.run('worktree')
    const readsBefore = f.handoff.reads.length
    const result = await f.ctx.get('agents')!.withInitiator(f.handle.agent, () =>
      f.ctx.get('tools')!.execute({ callId: ToolCallId('report'), name: 'dev_loop_gate_report',
        arguments: { pieceId }, agent: f.handle.agent, signal: new AbortController().signal }))
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('evaluations')
    expect(f.handoff.reads.length).toBe(readsBefore)
  })
})

test('dev_loop_complete requests the actual pending-to-done transition and reports its rejection only after settlement', async () => {
  await fixture(async (f) => {
    const result = await f.complete()
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/gate|evidence|rejected/i)
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
  })
})

test('dev_loop_complete never blocks, transfers or retires by itself', async () => {
  await fixture(async (f) => {
    await f.complete()
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
    expect(await f.ctx.get('devLoopWorktree')!.getAssignment(pieceId)).toBeUndefined()
  })
})

test('dev_loop_check requires a live caller even at the direct executor', async () => {
  await fixture(async (f) => {
    await f.handle.dispose()
    const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('disposed'), name: 'dev_loop_check',
      arguments: { pieceId, stage: 'worktree' }, agent: f.handle.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/live|caller|initiator/i)
  })
})

test('complete rendered results are bounded by maxToolOutputBytes; overflow refuses instead of clipping', async () => {
  await fixture(async (f) => {
    await f.run('worktree')
    const result = await f.ctx.get('agents')!.withInitiator(f.handle.agent, () =>
      f.ctx.get('tools')!.execute({ callId: ToolCallId('bounded'), name: 'dev_loop_gate_report',
        arguments: { pieceId }, agent: f.handle.agent, signal: new AbortController().signal }))
    const rendered = JSON.stringify(result.content)
    expect(Buffer.byteLength(rendered, 'utf8')).toBeLessThanOrEqual(64)
  }, { toolConfig: { maxToolOutputBytes: 64 } })
})

test('a maxToolOutputBytes below the fixed error envelope rejects the consumer at mount', async () => {
  await fixture(async (f) => {
    const tools = f.ctx.get('tools')!
    expect(tools.schemas(f.handle.agent).map(item => item.name)).not.toContain('dev_loop_check')
  }, { toolConfig: { maxToolOutputBytes: 8 } })
})
