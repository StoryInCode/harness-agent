/** Real in-process providers carry child workspace selection into setup and model history. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime, { type SubagentRun } from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const contexts: Context[] = []
const runs: SubagentRun[] = []
const parentCwd = resolve('parent-workspace')
const firstCwd = resolve('first-child-workspace')
const secondCwd = resolve('second-child-workspace')

afterEach(async () => {
  for (const run of runs.splice(0).reverse()) await run.dispose()
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

async function setup(cwd: string | undefined) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include,
    llm: LlmRuntime,
    sessions: SessionStore,
    projections: SessionProjectionRegistry,
    prompt: SystemPrompt,
    tools: ToolRuntime,
    agents: AgentRegistry,
    loop: AgentLoop,
    subagents: SubagentRuntime,
    spawn,
    fork,
  })
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: new URL('./fixtures/cwd.cordis.yml', import.meta.url).href },
  })
  await ctx.loader.await()
  const adapter = new MockAdapter(Array.from({ length: 3 }, () => textResponse('done')))
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('cwd-parent'), { provider: 'mock', model: 'mock' },
    cwd === undefined ? {} : { cwd })
  const beforeSetup: { id: string; cwd: string | undefined }[] = []
  const create = ctx.agents.create.bind(ctx.agents)
  vi.spyOn(ctx.agents, 'create').mockImplementation(request => create({
    ...request,
    setup: async (childCtx, child) => {
      beforeSetup.push({ id: child.id, cwd: child.session.header.cwd })
      return await request.setup?.(childCtx, child)
    },
  }))
  return { ctx, parent, adapter, beforeSetup }
}

async function start(ctx: Context, parent: Agent, provider: string, cwd?: string) {
  const run = await ctx.subagents.start(provider, {
    parent,
    signal: new AbortController().signal,
    prompt: [{ type: 'text', text: 'report workspace' }],
    ...cwd === undefined ? {} : { cwd },
  })
  runs.push(run)
  await run.result
  return run
}

function systemText(request: GenerateOptions | undefined): string {
  return request?.messages.filter(message => message.role === 'system')
    .flatMap(message => message.content)
    .flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') ?? ''
}

for (const provider of ['spawn', 'fork']) {
  describe(`${provider} child cwd through real Loader composition`, () => {
    it('selects distinct sibling workspaces before setup and in actual model requests without changing the parent', async () => {
      const { ctx, parent, adapter, beforeSetup } = await setup(parentCwd)
      parent.followup(createUserMessage({ content: [{ type: 'text', text: 'parent turn' }], source: { kind: 'user' } }))
      await parent.whenIdle()
      const parentHeader = parent.session.header
      const parentEvents = parent.session.snapshotEvents()
      const first = await start(ctx, parent, provider, firstCwd)
      const second = await start(ctx, parent, provider, secondCwd)

      expect(parent.session.header).toBe(parentHeader)
      expect(parent.session.header.cwd).toBe(parentCwd)
      expect(parent.session.snapshotEvents().slice(0, parentEvents.length)).toEqual(parentEvents)
      expect(parent.session.snapshotEvents().slice(parentEvents.length).map(event => event.type))
        .toEqual(['subagent/catalog', 'subagent/catalog'])
      expect(first.localAgent?.session.header.isSeeded).toBe(provider === 'fork')
      expect(first.id).not.toBe(second.id)
      expect.soft(beforeSetup).toEqual([{ id: first.id, cwd: firstCwd }, { id: second.id, cwd: secondCwd }])
      expect.soft(first.localAgent?.session.header.cwd).toBe(firstCwd)
      expect.soft(second.localAgent?.session.header.cwd).toBe(secondCwd)
      expect.soft(systemText(adapter.requests[1])).toContain(`Workspace ${firstCwd}.`)
      expect.soft(systemText(adapter.requests[2])).toContain(`Workspace ${secondCwd}.`)
      expect(systemText(adapter.requests[0])).toContain(`Workspace ${parentCwd}.`)
    })

    it('inherits omitted cwd into the real header and model request', async () => {
      const { ctx, parent, adapter, beforeSetup } = await setup(parentCwd)
      const run = await start(ctx, parent, provider)
      expect(beforeSetup).toEqual([{ id: run.id, cwd: parentCwd }])
      expect(run.localAgent?.session.header.cwd).toBe(parentCwd)
      expect(systemText(adapter.requests[0])).toContain(`Workspace ${parentCwd}.`)
    })

    it.each(['relative/child', ''])('rejects explicit invalid cwd %j without child setup or model work', async (cwd) => {
      const { ctx, parent, adapter, beforeSetup } = await setup(parentCwd)
      const outcome = await start(ctx, parent, provider, cwd).then(
        () => 'accepted',
        (error: unknown) => error instanceof Error ? error.message : String(error),
      )
      expect(outcome).toMatch(/cwd.*absolute|absolute.*cwd/)
      expect(beforeSetup).toEqual([])
      expect(adapter.requests).toEqual([])
      expect(parent.session.header.cwd).toBe(parentCwd)
    })

    it('accepts a valid explicit cwd when the parent has no cwd', async () => {
      const { ctx, parent, adapter, beforeSetup } = await setup(undefined)
      const run = await start(ctx, parent, provider, firstCwd)
      expect(parent.session.header.cwd).toBeUndefined()
      expect.soft(beforeSetup).toEqual([{ id: run.id, cwd: firstCwd }])
      expect.soft(run.localAgent?.session.header.cwd).toBe(firstCwd)
      expect.soft(systemText(adapter.requests[0])).toContain(`Workspace ${firstCwd}.`)
    })
  })
}
