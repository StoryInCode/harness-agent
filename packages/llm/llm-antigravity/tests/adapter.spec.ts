import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as llmAntigravity from '../src/index.ts'
import { AntigravityLlmAdapter, formatConversationPrompt } from '../src/adapter.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function testContext() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  return ctx
}

describe('Antigravity LLM Adapter', () => {
  it('formats conversation prompts correctly', () => {
    const options: GenerateOptions = {
      provider: 'antigravity',
      model: 'gemini-3.8-flash-high',
      system: 'You are a test assistant.',
      messages: [
        {
          id: '1' as any,
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Hello!' }],
        },
        {
          id: '2' as any,
          role: 'assistant',
          source: { kind: 'model', provider: 'antigravity', model: 'gemini-3.8-flash-high' },
          content: [{ type: 'text', text: 'Hi there!' }],
        },
        {
          id: '3' as any,
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'How are you?' }],
        },
      ],
    }

    const prompt = formatConversationPrompt(options)
    expect(prompt).toContain('System:\nYou are a test assistant.')
    expect(prompt).toContain('User:\nHello!')
    expect(prompt).toContain('Assistant:\nHi there!')
    expect(prompt).toContain('User:\nHow are you?')
  })

  it('registers on ctx.llm and provides models', async () => {
    const ctx = await testContext()
    await ctx.plugin(llmAntigravity, { providerName: 'antigravity-test' })

    const providers = ctx.llm.listProviders()
    expect(providers.some(p => p.id === 'antigravity-test')).toBe(true)

    const models = await ctx.llm.listModels('antigravity-test')
    expect(models.length).toBeGreaterThanOrEqual(14)

    const resolved = await ctx.llm.resolveModelInfo('antigravity-test', 'gemini-3.8-flash-high')
    expect(resolved.id).toBe('gemini-3.8-flash-high')
    expect(resolved.context?.contextWindow).toBe(1_048_576)
  })

  it('streams text deltas, reasoning, and usage chunks from agy output', async () => {
    const stdoutLines = [
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'tool', state: 'ACTIVE', tool_name: 'view_file' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'Hello ' },
      }),
      JSON.stringify({
        event: 'step_update',
        step_update: { step_type: 'agent_response', text_delta: 'world!' },
      }),
      JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          response: 'Hello world!',
          usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, total_tokens: 17 },
        },
      }),
    ]

    const stdoutStream = Readable.from(stdoutLines.map(l => l + '\n'))
    const done = deferred<SubprocessOutcome>()
    const exited = deferred<boolean>()
    const terminate = vi.fn(() => {
      done.resolve({ exitCode: 0, signal: null })
      exited.resolve(true)
    })
    const waitForExit = vi.fn(() => exited.promise)

    const handle: SubprocessHandle = {
      stdin: undefined,
      stdout: stdoutStream as any,
      stderr: undefined,
      collected: {},
      done: done.promise,
      terminate,
      waitForExit,
    }

    const spawn = vi.fn(() => handle)
    const mockCtx = {
      subprocess: { spawn },
    } as unknown as Context

    const adapter = new AntigravityLlmAdapter(mockCtx, {
      providerName: 'antigravity',
      command: 'agy',
      timeoutMs: 30_000,
      disposeGraceMs: 1_000,
      env: {},
    })

    const options: GenerateOptions = {
      provider: 'antigravity',
      model: 'gemini-3.8-flash-high',
      messages: [
        {
          id: '1' as any,
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Greet the world' }],
        },
      ],
    }

    // Resolve done promise when stream ends
    stdoutStream.on('end', () => {
      done.resolve({ exitCode: 0, signal: null })
      exited.resolve(true)
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) {
      chunks.push(chunk)
    }

    const textDeltas = chunks
      .filter((c): c is { type: 'text-delta'; index: number; text: string } => c.type === 'text-delta')
      .map(c => c.text)
      .join('')

    expect(textDeltas).toBe('Hello world!')

    const reasoningDeltas = chunks
      .filter((c): c is { type: 'reasoning-delta'; index: number; text: string } => c.type === 'reasoning-delta')
      .map(c => c.text)
      .join('')

    expect(reasoningDeltas).toContain('[Tool: view_file]')

    const usageChunk = chunks.find((c): c is { type: 'usage'; usage: any } => c.type === 'usage')
    expect(usageChunk?.usage.outputTokens).toBe(5)
    expect(usageChunk?.usage.reasoningTokens).toBe(2)

    const finishChunk = chunks.find((c): c is { type: 'finish'; reason: any } => c.type === 'finish')
    expect(finishChunk?.reason.kind).toBe('stop')
  })

  it('handles error results gracefully', async () => {
    const stdoutLines = [
      JSON.stringify({
        event: 'result',
        result: {
          status: 'ERROR',
          error: 'Rate limit exceeded',
        },
      }),
    ]

    const stdoutStream = Readable.from(stdoutLines.map(l => l + '\n'))
    const done = deferred<SubprocessOutcome>()
    const exited = deferred<boolean>()
    const terminate = vi.fn(() => {
      done.resolve({ exitCode: 1, signal: null })
      exited.resolve(true)
    })

    const handle: SubprocessHandle = {
      stdin: undefined,
      stdout: stdoutStream as any,
      stderr: undefined,
      collected: {},
      done: done.promise,
      terminate,
      waitForExit: vi.fn(() => exited.promise),
    }

    const spawn = vi.fn(() => handle)
    const mockCtx = {
      subprocess: { spawn },
    } as unknown as Context

    const adapter = new AntigravityLlmAdapter(mockCtx, {
      providerName: 'antigravity',
      command: 'agy',
      timeoutMs: 30_000,
      disposeGraceMs: 1_000,
      env: {},
    })

    const options: GenerateOptions = {
      provider: 'antigravity',
      model: 'gemini-3.8-flash-high',
      messages: [{ id: '1' as any, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hi' }] }],
    }

    stdoutStream.on('end', () => {
      done.resolve({ exitCode: 1, signal: null })
      exited.resolve(true)
    })

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) {
      chunks.push(chunk)
    }

    const finishChunk = chunks.find((c): c is { type: 'finish'; reason: any } => c.type === 'finish')
    expect(finishChunk?.reason.kind).toBe('error')
    expect(finishChunk?.reason.failure.message).toBe('Rate limit exceeded')
  })

  it('handles cancellation signal before startup', async () => {
    const mockCtx = {
      subprocess: { spawn: vi.fn() },
    } as unknown as Context

    const adapter = new AntigravityLlmAdapter(mockCtx, {
      providerName: 'antigravity',
      command: 'agy',
      timeoutMs: 30_000,
      disposeGraceMs: 1_000,
      env: {},
    })

    const controller = new AbortController()
    controller.abort()

    const options: GenerateOptions = {
      provider: 'antigravity',
      model: 'gemini-3.8-flash-high',
      messages: [{ id: '1' as any, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Hi' }] }],
      signal: controller.signal,
    }

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(options)) {
      chunks.push(chunk)
    }

    expect(chunks.length).toBe(1)
    expect(chunks[0]?.type).toBe('finish')
    expect((chunks[0] as any).reason.kind).toBe('aborted')
  })
})
