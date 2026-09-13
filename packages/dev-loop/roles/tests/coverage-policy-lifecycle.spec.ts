/** Registered external-provider outcomes through real SubagentRuntime, Queue, storage, and tool dispatch. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import { expect, it } from 'vitest'
import { brief, fixture, policy, toolConfig, type Fixture } from './harness.ts'

async function selectExternalProvider(f: Fixture, failure: Error | undefined) {
  const observation = { starts: 0, disposals: 0, id: SessionId(randomUUID()) }
  // A simulated external transport owns this remote run, not a fabricated local Agent or Queue ticket.
  const provider: SubagentProvider = {
    name: 'coverage-external', inheritsParentContext: false,
    capabilities: { persona: true, toolFilter: true, agentOptions: false, outputSchema: false, depthLimit: false },
    async start(request) {
      expect(request.parent).toBe(f.handle.agent)
      expect(request.cwd).toContain('.worktrees')
      observation.starts++
      return {
        id: observation.id, localAgent: undefined,
        result: Promise.resolve({ output: [], stopReason: 'error', diagnostic: 'External endpoint refused the assignment.' }),
        async dispose() { observation.disposals++; if (failure !== undefined) throw failure },
      }
    },
  }
  await f.ctx.plugin({ name: 'coverage-external-provider', inject: ['subagents'], apply(ctx: Context) {
    ctx.subagents.registerProvider(provider)
  } })
  const config = policy()
  config.roles.Utility.provider = provider.name
  const owner = [...f.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:roles')!
  await owner.update({ config }, false, true)
  await f.ctx.loader.await()
  return observation
}

it('rejects an omitted generic filter on Utility independently of the Research allowlist requirement', async () => {
  const config = policy()
  config.roles.Utility.toolFilter = {}
  await expect(fixture([], async () => { throw new Error('Invalid Host policy mounted') }, config))
    .rejects.toThrow(/Utility.*explicit toolFilter/i)
})

it('retains a registered external provider diagnostic separately from assistant output after Queue disposal', async () => {
  await fixture([], async (f) => {
    const observed = await selectExternalProvider(f, undefined)
    const record = await f.delegate({ ...brief, role: 'Utility' })
    expect(record).toMatchObject({ state: 'settled', status: 'failed', cleanup: 'quiescent',
      subagentSessionId: observed.id, stopReason: 'error', outcome: '', provider: 'coverage-external' })
    expect(record.limitations).toContain('External endpoint refused the assignment.')
    expect(record.effectivePreset).toBeUndefined()
    expect(observed).toMatchObject({ starts: 1, disposals: 1 })
    expect(f.adapter.requests).toEqual([])
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  })
})

it('records unproven cleanup when real Queue cancellation rethrows a registered provider disposal fault', async () => {
  const failure = new Error('External transport disposal failed')
  await fixture([], async (f) => {
    const observed = await selectExternalProvider(f, failure)
    const record = await f.delegate({ ...brief, role: 'Utility' })
    expect(record).toMatchObject({ state: 'settled', status: 'failed', cleanup: 'unproven', subagentSessionId: observed.id })
    expect(record.limitations).toEqual(['Role execution and cleanup failed', 'Queue could not prove child cleanup quiescent.'])
    expect(observed).toMatchObject({ starts: 1, disposals: 1 })
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
    expect(f.adapter.requests).toEqual([])
  })
})

it.each(['missing', 'disposed'] as const)('requires a live initiator for a root-mounted real consumer with %s caller', async (kind) => {
  await fixture([], async (f) => {
    // Host mounting exposes the public optional-agent execution path; no Agent-shaped stand-in is used.
    await f.ctx.loader.create({ name: 'cordis:role-tool', config: toolConfig })
    await f.ctx.loader.await()
    const agent = f.handle.agent
    if (kind === 'disposed') await f.handle.dispose()
    const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId(`caller-${kind}`), name: 'dev_loop_delegations',
      arguments: { pieceId: brief.pieceId }, signal: new AbortController().signal,
      ...kind === 'disposed' ? { agent } : {},
    })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Error: Role tools require an exact live initiator' }])
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
  })
})
