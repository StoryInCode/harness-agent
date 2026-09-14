import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { listAntigravityModels, parseAntigravityModels, type AntigravityModelsSpec } from '../src/models.ts'
import * as antigravity from '../src/index.ts'

function discovery(text = 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n', lossy = false) {
  const done = Promise.withResolvers<SubprocessOutcome>()
  const exited = Promise.withResolvers<boolean>()
  const terminate = vi.fn()
  const waitForExit = vi.fn(() => exited.promise)
  const handle: SubprocessHandle = {
    stdin: undefined, stdout: undefined, stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text, lossy, nextOffset: Buffer.byteLength(text) }) } },
    done: done.promise, terminate, waitForExit,
  }
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => handle)
  const spec: AntigravityModelsSpec = {
    command: 'agy', cwd: process.cwd(), env: {}, timeoutMs: 60_000,
    maxOutputBytes: 10_000, disposeGraceMs: 100, spawn,
  }
  return { done, exited, terminate, waitForExit, handle, spawn, spec }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Antigravity model discovery', () => {
  it('parses tab-separated native ids and names without interpreting model families', () => {
    expect(parseAntigravityModels('\r\nclaude-sonnet-4-6\tClaude Sonnet 4.6\r\ngpt-oss-120b-medium\tGPT OSS 120B (Medium)\n')).toEqual([
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'gpt-oss-120b-medium', name: 'GPT OSS 120B (Medium)' },
    ])
  })

  it.each([
    ['', 'empty-output'], ['\n \n', 'empty-output'], ['secret', 'malformed-output'],
    ['\tSecret', 'malformed-output'], ['model\t ', 'malformed-output'],
    ['model id\tName', 'malformed-output'], ['model\tName\textra', 'malformed-output'],
    ['model\tName\nmodel\tOther', 'malformed-output'], ['model\tName\u001b[0m', 'malformed-output'],
  ])('rejects malformed directory records safely: %j', (text, category) => {
    expect(() => parseAntigravityModels(text)).toThrow(`category: ${category}`)
    expect(() => parseAntigravityModels(text)).not.toThrow('secret')
  })

  it('requests only the native model directory and awaits managed exit', async () => {
    const fake = discovery()
    const result = listAntigravityModels(new AbortController().signal, fake.spec)
    expect(fake.spawn.mock.calls[0]?.[0]).toMatchObject({
      argv: ['agy', 'models'], cwd: process.cwd(), env: {}, graceMs: 100,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 10_000 }, stderr: { maxBytes: 10_000 } },
    })
    let settled = false
    void result.then(() => { settled = true })
    fake.done.resolve({ exitCode: 0, signal: null })
    await Promise.resolve()
    expect(fake.terminate).toHaveBeenCalledOnce()
    expect(fake.waitForExit).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    fake.exited.resolve(true)
    expect(await result).toEqual([{ id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' }])
  })

  it.each([
    { exitCode: 2, signal: null }, { exitCode: 0, signal: 'SIGTERM' as const },
  ])('rejects unsuccessful process facts %o', async (outcome) => {
    const fake = discovery()
    const result = listAntigravityModels(new AbortController().signal, fake.spec)
    fake.done.resolve(outcome)
    fake.exited.resolve(true)
    await expect(result).rejects.toThrow('category: process-exit')
    expect(fake.waitForExit).toHaveBeenCalledOnce()
  })

  it.each([true, false])('rejects incomplete or missing output (lossy=%s)', async (lossy) => {
    const fake = discovery('model\tName\n', lossy)
    if (!lossy) fake.spawn.mockReturnValue({ ...fake.handle, collected: {} })
    const result = listAntigravityModels(new AbortController().signal, fake.spec)
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.resolve(true)
    await expect(result).rejects.toThrow('category: output-limit')
  })

  it('cleans startup, observation, and teardown failures without exposing raw diagnostics', async () => {
    const fake = discovery()
    fake.spawn.mockImplementationOnce(() => { throw new Error('secret startup') })
    await expect(listAntigravityModels(new AbortController().signal, fake.spec)).rejects.toThrow('category: startup')
    const result = listAntigravityModels(new AbortController().signal, fake.spec)
    fake.done.reject(new Error('secret process'))
    fake.exited.resolve(true)
    await expect(result).rejects.toThrow('category: process')
    const broken = discovery()
    const brokenResult = listAntigravityModels(new AbortController().signal, broken.spec)
    broken.done.resolve({ exitCode: 0, signal: null })
    broken.exited.reject(new Error('secret teardown'))
    await expect(brokenResult).rejects.toThrow('category: teardown')
  })

  it('does not spawn after cancellation and waits for active cancellation cleanup', async () => {
    const fake = discovery()
    await expect(listAntigravityModels(AbortSignal.abort(), fake.spec)).rejects.toThrow('category: aborted')
    expect(fake.spawn).not.toHaveBeenCalled()
    const controller = new AbortController()
    const result = listAntigravityModels(controller.signal, fake.spec)
    controller.abort()
    expect(fake.spawn.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.resolve(true)
    await expect(result).rejects.toThrow('category: aborted')
  })

  it('reports deadline expiry even when the native process exits successfully', async () => {
    vi.useFakeTimers()
    const fake = discovery()
    const result = listAntigravityModels(new AbortController().signal, { ...fake.spec, timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(fake.spawn.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.resolve(true)
    await expect(result).rejects.toThrow('category: timeout')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels in-flight discovery when the provider fiber is disposed', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const fake = discovery()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(fake.handle)
    const fiber = await ctx.plugin(antigravity, {})
    const result = ctx.subagents.getProvider('antigravity')!.listModels!(new AbortController().signal)
    onTestFinished(() => {
      fake.done.resolve({ exitCode: 0, signal: null })
      fake.exited.resolve(true)
    })
    const rejected = expect(result).rejects.toThrow('category: aborted')
    const signal = spawn.mock.calls[0]![0].signal!
    const aborted = new Promise<void>(resolve => signal.addEventListener('abort', () => { resolve() }, { once: true }))
    const disposed = fiber.dispose()
    await aborted
    expect(signal.aborted).toBe(true)
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.resolve(true)
    await disposed
    await rejected
    expect(ctx.subagents.getProvider('antigravity')).toBeUndefined()
  })
})
