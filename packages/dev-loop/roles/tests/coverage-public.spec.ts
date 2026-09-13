/** Public Agent, Queue and model outcomes not covered by the original acceptance cases. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { maxTokensResponse, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { brief, fixture, policy, toolConfig } from './harness.ts'

const verification = { claim: 'The file is retained.', decisionRestingOnClaim: 'Reuse the assignment.',
  permittedSources: ['tracked.txt'], requiredEvidence: ['file content'] }

it('records a real cwd-less initiator failure after Queue admission without allocating a child', async () => {
  await fixture([], async (f) => {
    const handle = await f.ctx.get('agents')!.create({ sessionId: SessionId('without-workspace') })
    try {
      const record = await f.ctx.get('agents')!.withInitiator(handle.agent, () =>
        f.ctx.get('devLoopRoles')!.delegate(brief, new AbortController().signal))
      expect(record).toMatchObject({ status: 'failed', cleanup: 'quiescent', parentSessionId: handle.agent.id })
      expect(record.limitations.join(' ')).toMatch(/workspace cwd/i)
      expect(record.subagentSessionId).toBeUndefined()
      expect(record.worktreeAssignment).toBeUndefined()
      expect(f.adapter.requests).toEqual([])
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    } finally { await handle.dispose() }
  })
})

it('records a missing-piece admission failure without fabricating a child or completion', async () => {
  await fixture([], async (f) => {
    const record = await f.delegate({ ...brief, pieceId: '99.99' })
    expect(record).toMatchObject({ state: 'settled', status: 'failed', cleanup: 'quiescent' })
    expect(record.limitations.join(' ')).toContain('99.99')
    expect(record.subagentSessionId).toBeUndefined()
    expect(record.worktreeAssignment).toBeUndefined()
    expect(await f.ctx.get('devLoopRoles')!.getDelegations('99.99')).toEqual([record])
    expect(f.adapter.requests).toEqual([])
  })
})

it('records a caller-provided non-Error abort reason at Queue admission without calling a provider', async () => {
  await fixture([], async (f) => {
    const controller = new AbortController()
    controller.abort('caller cancelled this request')
    const record = await f.delegate(brief, controller.signal)
    expect(record).toMatchObject({ status: 'aborted', cleanup: 'quiescent', outcome: 'Role delegation did not complete.' })
    expect(record.limitations).toEqual(['Role execution failed.'])
    expect(record.subagentSessionId).toBeUndefined()
    expect(f.adapter.requests).toEqual([])
  })
})

it('forwards explicit model options, depth and verification and reopens the actual preset-attributed record', async () => {
  const config = policy()
  config.roles.Research.agentOptions = { provider: 'mock', model: 'role-specific', maxTokens: 777 }
  config.roles.Research.maxDepth = 1
  await fixture([textResponse('Verified retained content; reported by Research.')], async (f) => {
    const record = await f.delegate({ ...brief, verification })
    expect(record).toMatchObject({ status: 'completed', verification, effectivePreset: 'original',
      provenance: { kind: 'reported', role: 'Research', preset: 'original' } })
    expect(f.adapter.requests[0]).toMatchObject({ provider: 'mock', model: 'role-specific', maxTokens: 777 })
    const prompt = f.adapter.requests[0]!.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    expect(prompt).toContain(verification.claim)
    expect(prompt).toContain(verification.decisionRestingOnClaim)
    await f.ctx.fiber.dispose()
    const reopened = await f.mount()
    expect(await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  }, config, toolConfig, true)
})

it('records provider depth refusal while retaining the already acquired assignment', async () => {
  const config = policy()
  config.roles.Research.maxDepth = 0
  await fixture([], async (f) => {
    const record = await f.delegate()
    expect(record).toMatchObject({ status: 'failed', cleanup: 'unproven' })
    expect(record.limitations.join(' ')).toMatch(/depth/i)
    expect(record.worktreeAssignment?.worktreePath).toEqual(expect.any(String))
    expect(record.subagentSessionId).toBeUndefined()
    expect(f.adapter.requests).toEqual([])
  }, config)
})

it('retains a partial max-token report as failed with an explicit incompleteness limitation', async () => {
  await fixture([maxTokensResponse('partial reported text')], async (f) => {
    const record = await f.delegate()
    expect(record).toMatchObject({ status: 'failed', cleanup: 'quiescent', stopReason: 'max-tokens', outcome: 'partial reported text' })
    expect(record.limitations.join(' ')).toMatch(/partial|did not complete/i)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  })
})

it('records child-local cancellation from the actual provider result without aborting the parent request signal', async () => {
  let child: Agent | undefined
  await fixture([() => { child!.cancel({ kind: 'user' }); return textResponse('not emitted after cancellation') }], async (f) => {
    f.ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.parentSession === f.handle.agent.id) child = agent
    })
    const controller = new AbortController()
    const record = await f.delegate(brief, controller.signal)
    expect(controller.signal.aborted).toBe(false)
    expect(record).toMatchObject({ status: 'aborted', stopReason: 'aborted', cleanup: 'quiescent' })
    expect(record.limitations.join(' ')).toMatch(/partial|did not complete/i)
    expect(f.ctx.get('agents')!.get(record.subagentSessionId!)).toBeUndefined()
  })
})

it('records an actual model failure as failed rather than treating provider settlement as task completion', async () => {
  const failure: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error', failure: { code: 'fixture-error', message: 'model refused' } } }]
  await fixture([failure], async (f) => {
    const record = await f.delegate()
    expect(record).toMatchObject({ status: 'failed', stopReason: 'error', cleanup: 'quiescent' })
    expect(record.limitations.join(' ')).toMatch(/partial|did not complete/i)
  })
})

it.each(['00.06', '99.99'])('preserves requested verification when terminal metadata cannot fit after %s settles', async (pieceId) => {
  await fixture(pieceId === '00.06' ? [textResponse('completed report')] : [], async (f) => {
    const input = { ...brief, pieceId, verification }
    let failure: unknown
    try { await f.delegate(input) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(AggregateError)
    const errors = (failure as AggregateError).errors as unknown[]
    expect(errors).toHaveLength(pieceId === '00.06' ? 1 : 2)
    expect(String(errors.at(-1))).toMatch(/metadata.*maxOutcomeBytes/i)
    const requested = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    expect(requested).toHaveLength(1)
    expect(requested[0]).toMatchObject({ state: 'requested', verification, pieceId })
    await f.ctx.fiber.dispose()
    const reopened = await f.mount()
    expect(await reopened.get('devLoopRoles')!.getDelegations(pieceId)).toEqual(requested)
  }, { maxOutcomeBytes: 1 })
})
