import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime, { type SubagentDescriptorData } from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as antigravity from '../src/index.ts'
import { finalResponse, startAntigravityRun, type AntigravityRunSpec } from '../src/run.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const success = (response = 'answer') => JSON.stringify({
  event: 'result', result: { status: 'SUCCESS', response },
})

function child(text = success(), lossy = false) {
  const done = deferred<SubprocessOutcome>()
  const exited = deferred<boolean>()
  const terminate = vi.fn()
  const waitForExit = vi.fn(() => exited.promise)
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text, lossy, nextOffset: Buffer.byteLength(text) }) } },
    done: done.promise,
    terminate,
    waitForExit,
  }
  return { handle, done, exited, terminate, waitForExit }
}

function request(signal = new AbortController().signal) {
  return {
    parent: { session: { header: { cwd: process.cwd() } } } as unknown as Agent,
    prompt: [{ type: 'text' as const, text: 'private\n"task"' }],
    signal,
  }
}

function spec(spawn: AntigravityRunSpec['spawn']): AntigravityRunSpec {
  return {
    command: 'agy', cwd: process.cwd(), env: {}, timeoutMs: 60_000,
    maxOutputBytes: 1_048_576, disposeGraceMs: 100, spawn,
  }
}

const contexts: Context[] = []
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function context() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  return ctx
}

describe('Antigravity final response', () => {
  it('keeps exact final text and ignores valid intermediate and unknown events', () => {
    expect(finalResponse([
      '', JSON.stringify({ event: 'init', init: {} }),
      JSON.stringify({ event: 'step_update', step_update: { text_delta: 'not final' } }),
      JSON.stringify({ event: 'future-event' }), success(' final\n'), '',
    ].join('\n'))).toBe(' final\n')
  })

  it.each([
    ['not-json-secret', 'malformed-output'],
    ['null', 'malformed-output'],
    ['[]', 'malformed-output'],
    ['{}', 'malformed-output'],
    ['', 'missing-result'],
    ['{"event":"init"}', 'missing-result'],
    ['{"event":"result"}', 'invalid-result'],
    ['{"event":"result","result":[]}', 'invalid-result'],
    ['{"event":"result","result":{"status":"ERROR","error":"secret"}}', 'product-error'],
    ['{"event":"result","result":{"status":"WAITING"}}', 'product-error'],
    ['{"event":"result","result":{"status":"SUCCESS","response":3}}', 'invalid-result'],
    ['{"event":"result","result":{"status":"SUCCESS","response":"ok","error":"secret"}}', 'product-error'],
    [success(' \n '), 'invalid-result'],
    [success() + '\n' + success(), 'duplicate-result'],
    [success() + '\nmalformed-secret', 'malformed-output'],
  ])('rejects invalid output without copying product data: %s', (text, category) => {
    expect(() => finalResponse(text)).toThrow(`category: ${category}`)
    try { finalResponse(text) } catch (error: unknown) {
      expect(String(error)).not.toContain('secret')
    }
  })
})

describe('Antigravity managed run', () => {
  it('sends one stdin event, retains native permissions, and waits for tree exit', async () => {
    const fake = child()
    const spawn = vi.fn(() => fake.handle)
    const run = await startAntigravityRun(request(), {
      ...spec(spawn), command: '/installed/agy', model: 'chosen', env: { EXPLICIT_TOKEN: 'opt-in' },
    })
    const [spawnSpec] = spawn.mock.calls[0] as unknown as [SubprocessSpawnSpec]
    expect(spawnSpec.argv).toEqual([
      '/installed/agy', '--input-format', 'stream-json', '--output-format', 'stream-json',
      '--print-timeout', '60000ms', '--model', 'chosen',
    ])
    expect(spawnSpec.stdio).toEqual({
      stdin: { data: JSON.stringify({ event: 'user', message: { content: 'private\n"task"' } }) + '\n' },
      stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 1_048_576 },
    })
    expect(spawnSpec.env).toEqual({ EXPLICIT_TOKEN: 'opt-in' })
    expect(spawnSpec.cwd).toBe(process.cwd())
    let settled = false
    void run.result.then(() => { settled = true })
    fake.done.resolve({ exitCode: 0, signal: null })
    await Promise.resolve()
    expect(fake.waitForExit).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    fake.exited.resolve(true)
    expect(await run.result).toEqual({ output: [{ type: 'text', text: 'answer' }], stopReason: 'completed' })
    const disposal = run.dispose()
    expect(run.dispose()).toBe(disposal)
    await disposal
    expect(fake.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    [{ exitCode: 2, signal: null }, 'process-exit'],
    [{ exitCode: 0, signal: 'SIGTERM' }, 'process-exit'],
    [{ exitCode: null, signal: null }, 'process-exit'],
  ] as const)('rejects success JSON with unsuccessful process facts %o', async (outcome, category) => {
    const fake = child()
    const run = await startAntigravityRun(request(), spec(() => fake.handle))
    fake.done.resolve(outcome)
    fake.exited.resolve(true)
    expect(await run.result).toMatchObject({ stopReason: 'error', output: [], diagnostic: expect.stringContaining(category) as string })
    await run.dispose()
  })

  it.each([[success(), true, 'output-limit'], ['{secret', false, 'malformed-output']] as const)(
    'fails closed for incomplete or malformed collection', async (text, lossy, category) => {
      const fake = child(text, lossy)
      const run = await startAntigravityRun(request(), spec(() => fake.handle))
      fake.done.resolve({ exitCode: 0, signal: null })
      fake.exited.resolve(true)
      expect(await run.result).toMatchObject({ stopReason: 'error', output: [], diagnostic: expect.stringContaining(category) as string })
      await run.dispose()
    },
  )

  it('keeps cancellation pending until managed exit, even after successful JSON', async () => {
    const fake = child()
    const controller = new AbortController()
    const run = await startAntigravityRun(request(controller.signal), spec(() => fake.handle))
    controller.abort()
    const disposing = run.dispose()
    fake.done.resolve({ exitCode: 0, signal: null })
    let settled = false
    void run.result.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    fake.exited.resolve(true)
    await disposing
    expect(await run.result).toEqual({ output: [], stopReason: 'aborted' })
  })

  it('classifies timeout independently of a clean exit', async () => {
    vi.useFakeTimers()
    const fake = child()
    let spawnSpec!: SubprocessSpawnSpec
    const run = await startAntigravityRun(request(), {
      ...spec((value) => { spawnSpec = value; return fake.handle }), timeoutMs: 10,
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(spawnSpec.signal?.aborted).toBe(true)
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.resolve(true)
    expect(await run.result).toMatchObject({
      stopReason: 'error', diagnostic: expect.stringContaining('category: timeout; exit code: 0; signal: null') as string,
    })
    await run.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('contains synchronous spawn and published process failures without raw secrets', async () => {
    await expect(startAntigravityRun(request(), spec(() => { throw new Error('secret') })))
      .rejects.toThrow('category: startup')
    const fake = child()
    const run = await startAntigravityRun(request(), spec(() => fake.handle))
    fake.done.reject(new Error('secret'))
    fake.exited.resolve(true)
    expect(await run.result).toEqual({ output: [], stopReason: 'error', diagnostic: 'Antigravity subagent failure (category: process)' })
    await run.dispose()
  })

  it('reports teardown observation failure safely on both result and dispose', async () => {
    const fake = child()
    const run = await startAntigravityRun(request(), spec(() => fake.handle))
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.reject(new Error('secret'))
    expect(await run.result).toMatchObject({ stopReason: 'error', diagnostic: 'Antigravity subagent failure (category: teardown)' })
    await expect(run.dispose()).rejects.toThrow('category: teardown')
  })

  it('rejects blank, nontext, and already-cancelled requests without spawning', async () => {
    const spawn = vi.fn<AntigravityRunSpec['spawn']>()
    await expect(startAntigravityRun({ ...request(), prompt: [] }, spec(spawn))).rejects.toThrow('must not be empty')
    await expect(startAntigravityRun({ ...request(), prompt: [{ type: 'reasoning', text: 'hidden' }] }, spec(spawn)))
      .rejects.toThrow('only text blocks')
    await expect(startAntigravityRun(request(AbortSignal.abort()), spec(spawn))).rejects.toThrow('aborted before startup')
    expect(spawn).not.toHaveBeenCalled()
  })
})

describe('Antigravity provider registration', () => {
  it('advertises no unsupported start capabilities and unregisters on fiber disposal', async () => {
    const ctx = await context()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const fiber = await ctx.plugin(antigravity, {})
    expect('default' in antigravity).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
    expect(ctx.subagents.getProvider('antigravity')).toMatchObject({
      name: 'antigravity', inheritsParentContext: false,
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    })
    await fiber.dispose()
    expect(ctx.subagents.list()).toEqual([])
  })

  it('isolates named instances and inherits only an absolute parent cwd', async () => {
    const ctx = await context()
    const fake = child()
    const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(fake.handle)
    await ctx.plugin(antigravity, { providerName: 'ag-review', command: '/opt/ag-review', model: 'chosen' })
    const provider = ctx.subagents.getProvider('ag-review')!
    const run = await provider.start({ ...request(), descriptor: {} as SubagentDescriptorData })
    expect(spawn.mock.calls[0]?.[0].argv[0]).toBe('/opt/ag-review')
    fake.done.resolve({ exitCode: 0, signal: null })
    fake.exited.resolve(true)
    await run.result
    await run.dispose()
    for (const cwd of [undefined, 'relative']) {
      await expect(provider.start({
        ...request(), descriptor: {} as SubagentDescriptorData, parent: { session: { header: { cwd } } } as unknown as Agent,
      })).rejects.toThrow(cwd === undefined ? 'no working directory' : 'absolute path')
    }
    expect(spawn).toHaveBeenCalledOnce()
  })

  it.each([
    { command: '' }, { providerName: '' }, { model: '' },
    { timeoutMs: 0 }, { timeoutMs: Number.NaN }, { timeoutMs: MAX_TIMER_DELAY_MS + 1 },
    { disposeGraceMs: 0 }, { disposeGraceMs: Number.POSITIVE_INFINITY },
    { maxOutputBytes: 0 }, { maxOutputBytes: 0.5 },
  ])('rejects invalid config at mount: %o', async (config) => {
    const ctx = await context()
    await expect(ctx.plugin(antigravity, config)).rejects.toThrow()
    expect(ctx.subagents.list()).toEqual([])
  })
})
