/** Continuable workspace identity at initial publication and cold reactivation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { queueHostSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'
import { TestSessionQuery } from './test-session-query.ts'
import { loadStoredSession } from './persistence-helpers.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function setup(parentHasCwd = true) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-continuation-cwd-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    rmSync(root, { recursive: true, force: true })
  })
  const parentCwd = join(root, 'parent')
  const childCwd = join(root, 'child')
  for (const cwd of [parentCwd, childCwd]) mkdirSync(cwd)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(Spawn, { providerName: 'spawn' })
  await ctx.plugin(Fork, { providerName: 'fork' })
  const adapter = new MockAdapter([textResponse('first'), textResponse('resumed')])
  ctx.llm.registerAdapter(['child-mock'], adapter)
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('notice'), textResponse('notice')]))
  ctx.systemPrompt.section({ name: 'cwd-observation', order: 0, text: 'Workspace: {{cwd}}' })
  const { agent: parent } = await ctx.agents.create({
    sessionId: SessionId('parent'),
    agentOptions: { provider: 'mock', model: 'mock' },
    ...(parentHasCwd ? { meta: { cwd: parentCwd } } : {}),
  })
  const publications: Array<{ id: SessionId; cwd: string | undefined }> = []
  ctx.on('agent/created', ({ agent }) => {
    publications.push({ id: agent.id, cwd: agent.session.header.cwd })
  })
  const start = (provider: string, cwd: string | undefined) => ctx.subagents.startContinuable({
    provider,
    label: 'workspace child',
    request: {
      parent,
      agentOptions: { provider: 'child-mock', model: 'mock' },
      prompt: [{ type: 'text', text: 'work' }],
      ...(cwd === undefined ? {} : { cwd }),
    },
    signal: new AbortController().signal,
  })
  const settled = async (id: SessionId) => {
    await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() })
    return loadStoredSession(ctx.sessionPersistence, id)
  }
  return { ctx, adapter, parent, parentCwd, childCwd, publications, start, settled }
}

describe.each(['spawn', 'fork'])('%s continuable child cwd', (provider) => {
  it('publishes the explicit workspace and retains it across cold resume', async () => {
    const { ctx, adapter, parent, parentCwd, childCwd, publications, start, settled } = await setup()
    const processCwd = process.cwd()
    const started = await start(provider, childCwd)
    const first = await settled(started.childId)
    await queueHostSubagentPrompt(ctx.subagents, parent, started.childId,
      [{ type: 'text', text: 'resume' }], { kind: 'user' }, new AbortController().signal)
    const resumed = await settled(started.childId)

    expect(adapter.requests).toHaveLength(2)
    expect.soft(publications).toEqual([
      { id: started.childId, cwd: childCwd },
      { id: started.childId, cwd: childCwd },
    ])
    expect.soft(first.meta.cwd).toBe(childCwd)
    expect.soft(resumed.meta.cwd).toBe(childCwd)
    for (const request of adapter.requests) {
      const text = request.messages.flatMap(message => message.content)
        .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      expect.soft(text).toContain(`Workspace: ${childCwd}`)
      expect.soft(text).not.toContain(`Workspace: ${parentCwd}`)
    }
    expect(parent.session.header.cwd).toBe(parentCwd)
    expect(process.cwd()).toBe(processCwd)
  })

  it('inherits the parent workspace when cwd is omitted', async () => {
    const { parent, parentCwd, publications, start, settled } = await setup()
    const started = await start(provider, undefined)
    const stored = await settled(started.childId)
    expect(publications).toEqual([{ id: started.childId, cwd: parentCwd }])
    expect(stored.meta.cwd).toBe(parentCwd)
    expect(parent.session.header.cwd).toBe(parentCwd)
  })

  it.each(['relative/child', ''])('rejects explicit %j before publishing a child or model request', async (cwd) => {
    const { adapter, publications, start, settled } = await setup()
    const starting = start(provider, cwd)
    // If the regression accepts the request, drain its activation before asserting rejection.
    const outcome = await starting.then(async (started) => {
      await settled(started.childId)
      return { accepted: true }
    }, (error: unknown) => ({ accepted: false, error }))
    expect.soft(outcome.accepted).toBe(false)
    expect.soft(publications).toEqual([])
    expect.soft(adapter.requests).toHaveLength(0)
  })

  it('uses explicit cwd even when the parent has no workspace', async () => {
    const { parent, childCwd, start, settled, adapter } = await setup(false)
    const started = await start(provider, childCwd)
    const stored = await settled(started.childId)
    expect.soft(stored.meta.cwd).toBe(childCwd)
    expect.soft(adapter.requests).toHaveLength(1)
    expect(parent.session.header.cwd).toBeUndefined()
  })
})
