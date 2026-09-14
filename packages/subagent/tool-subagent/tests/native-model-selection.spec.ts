import { describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import * as tool from '../src/index.ts'
import { callSubagent, modelSelectionSetupAgent, setup, text, testToolSignal } from './harness.ts'

const nativeProvider = {
  capabilities: { agentOptions: false },
  listModels: async (_signal: AbortSignal) => [
    { id: 'fast-model', name: 'Fast', description: 'Native fast model' },
    { id: 'hidden', name: 'Hidden' },
  ],
}

describe('native subagent model selection', () => {
  it('passes an allowed native model without parent routing or LLM preflight', async () => {
    const requests: SubagentStartRequest[] = []
    const ctx = await setup({ provider: 'mock', withModelSelection: true,
      parentAgentOptions: { provider: 'alpha', model: 'parent-model' },
    }, { ...nativeProvider, onStart: (request) => { requests.push(request) } })
    try {
      const preflight = vi.spyOn(ctx.llm, 'resolveCallConfig')
      const agent = modelSelectionSetupAgent(ctx)
      const schema = ctx.tools.schemas(agent).find(entry => entry.name === 'subagent')!
      expect(schema.parameters).not.toHaveProperty('properties.reasoning_effort')
      expect(schema.description).toContain('parent LLM values are not inherited')
      const result = await callSubagent(ctx, { description: 'native selection', prompt: 'task', provider: 'subagent:mock', model: 'fast-model' })
      expect(result.isError).toBe(false)
      expect(requests[0]?.nativeModel).toBe('fast-model')
      expect(requests[0]?.agentOptions).toBeUndefined()
      expect(preflight).not.toHaveBeenCalled()
      expect((await callSubagent(ctx, { description: 'defaults', prompt: 'task' })).isError).toBe(false)
      expect(requests[1]?.nativeModel).toBeUndefined()
      expect(requests[1]?.agentOptions).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })

  it.each([
    { provider: 'alpha', model: 'fast-model' },
    { provider: 'subagent:other', model: 'fast-model' },
    { provider: 'subagent:mock', model: 'hidden' },
    { provider: 'subagent:mock' },
    { model: 'fast-model' },
    { provider: 'subagent:mock', model: '' },
    { provider: 'subagent:mock', model: 'fast-model', reasoning_effort: 'high' },
  ])('rejects unsupported native selection before start: %j', async (selection) => {
    const onStart = vi.fn()
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { ...nativeProvider, onStart })
    try {
      expect((await callSubagent(ctx, { description: 'invalid native', prompt: 'task', ...selection })).isError).toBe(true)
      expect(onStart).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects forced native selection when settings are disabled and on LLM tools', async () => {
    for (const enabled of [false, true]) {
      const ctx = await setup({ provider: 'mock', withModelSelection: enabled }, enabled ? {} : nativeProvider)
      try {
        const result = await callSubagent(ctx, { description: 'wrong route', prompt: 'task', provider: 'subagent:mock', model: 'fast-model' })
        expect(result.isError).toBe(true)
        expect(text(result)).toContain(enabled ? 'native subagent routes cannot be selected' : 'selection is disabled')
      } finally { await ctx.fiber.dispose() }
    }
  })

  it('discovers authorized native models and co-mounts distinct discovery tools', async () => {
    const listModels = vi.fn(nativeProvider.listModels)
    const ctx = await setup({ provider: 'mock', withModelSelection: true }, { ...nativeProvider, listModels })
    try {
      const agent = modelSelectionSetupAgent(ctx)
      const fiber = agent.ctx.inject(tool.inject, (runtime) => {
        tool.apply(runtime, { provider: 'mock', toolName: 'native_peer', modelSelectionSettings: true, listModelsToolName: 'list_native_peer_models' }, agent.session)
      })
      await fiber.await()
      expect(ctx.tools.get('list_native_peer_models', agent)).toBeDefined()
      const call = (args: unknown) => ctx.tools.execute({ signal: testToolSignal, callId: ToolCallId('native-discovery'), name: 'list_subagent_models', arguments: args, agent })
      expect(text(await call({}))).toContain('subagent:mock — mock (native models)')
      const catalog = text(await call({ provider: 'subagent:mock' }))
      expect(catalog).toBe('subagent:mock/fast-model — Fast: Native fast model')
      expect(listModels).toHaveBeenCalledWith(testToolSignal)
      expect(text(await call({ provider: 'subagent:mock', model: 'fast-model' }))).not.toContain('Reasoning efforts')
      listModels.mockClear()
      expect((await call({ provider: 'subagent:mock', model: 'hidden' })).isError).toBe(true)
      expect(listModels).not.toHaveBeenCalled()
      await fiber.dispose()
      expect(ctx.tools.get('list_native_peer_models', agent)).toBeUndefined()
      expect(ctx.tools.get('list_subagent_models', agent)).toBeDefined()
    } finally { await ctx.fiber.dispose() }
  })
})
