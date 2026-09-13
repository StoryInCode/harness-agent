import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAntigravityRun, type AntigravityRunSpec } from '../src/run.ts'

const fixture = fileURLToPath(new URL('./fixtures/native-cli.mjs', import.meta.url))
const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function harness() {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-agy-'))
  cleanups.push(() => rm(cwd, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalSubprocessRuntime)
  let handle!: SubprocessHandle
  const spec: AntigravityRunSpec = {
    command: process.execPath, cwd, timeoutMs: 60_000, maxOutputBytes: 4096, disposeGraceMs: 100,
    env: { ANTIGRAVITY_EXPLICIT_TOKEN: 'deliberate-opt-in' },
    // Substitute only the external executable; framing, env, collection, and tree ownership stay real.
    spawn: input => (handle = ctx.subprocess.spawn({ ...input, argv: [input.argv[0]!, fixture, ...input.argv.slice(1)] })),
  }
  const start = async (text: string, signal = new AbortController().signal, overrides: Partial<AntigravityRunSpec> = {}) => {
    const run = await startAntigravityRun({
      prompt: [{ type: 'text', text }], signal,
      parent: { session: { header: { cwd } } } as unknown as Agent,
    }, { ...spec, ...overrides })
    cleanups.push(() => run.dispose())
    return run
  }
  return { cwd, start, handle: () => handle }
}

describe('Antigravity over the real subprocess service', () => {
  it('delivers stdin, cwd and explicit env without forwarding managed ambient env or stderr', async () => {
    const fixture = await harness()
    const run = await fixture.start('environment')
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    const block = result.output[0]
    expect(block?.type).toBe('text')
    if (block?.type !== 'text') throw new Error('missing fixture output')
    const parsed = JSON.parse(block.text) as { cwd: string; token: string; inherited?: string; args: string[] }
    expect(parsed).toEqual({
      cwd: fixture.cwd, token: 'deliberate-opt-in',
      args: ['--input-format', 'stream-json', '--output-format', 'stream-json', '--print-timeout', '60000ms'],
    })
    expect(block.text).not.toContain('private-stderr')
    expect(await fixture.handle().waitForExit()).toBe(true)
  })

  it.each([1, 100])('rejects oversized UTF-8 output at a %i-byte collection bound', async (maxOutputBytes) => {
    const fixture = await harness()
    const run = await fixture.start('你'.repeat(200), undefined, { maxOutputBytes })
    expect(await run.result).toMatchObject({ output: [], stopReason: 'error', diagnostic: expect.stringContaining('output-limit') as string })
  })

  it('accepts exact UTF-8 output bounds and rejects one byte less', async () => {
    const fixture = await harness()
    const response = '你好'
    const maxOutputBytes = Buffer.byteLength(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response } }) + '\n')
    const exact = await fixture.start(response, undefined, { maxOutputBytes })
    expect(await exact.result).toEqual({ output: [{ type: 'text', text: response }], stopReason: 'completed' })
    const short = await fixture.start(response, undefined, { maxOutputBytes: maxOutputBytes - 1 })
    expect(await short.result).toMatchObject({ stopReason: 'error', diagnostic: expect.stringContaining('output-limit') as string })
  })

  it('cancels a running child and returns only after real managed exit', async () => {
    const fixture = await harness()
    const controller = new AbortController()
    const run = await fixture.start('wait', controller.signal)
    await vi.waitFor(() => {
      expect(fixture.handle().collected.stdout!.readFrom(0).text).toContain('"event":"init"')
    })
    controller.abort()
    expect(await run.result).toEqual({ output: [], stopReason: 'aborted' })
    expect(await fixture.handle().waitForExit()).toBe(true)
  })

  it('settles a missing installed executable as a safe error', async () => {
    const fixture = await harness()
    const run = await fixture.start('unused', undefined, { command: join(fixture.cwd, 'missing-agy') })
    expect(await run.result).toMatchObject({ stopReason: 'error', diagnostic: 'Antigravity subagent failure (category: process)' })
  })
})
