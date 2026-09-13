import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import { PassThrough } from 'node:stream'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as codex from '../src/index.ts'
import { cwdCase, cwdModes } from '../../subagent-acp/tests/request-cwd-cases.ts'

it.each(cwdModes)('Codex request cwd: %s', async (mode) => {
  const fixture = cwdCase(mode)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const done = Promise.withResolvers<SubprocessOutcome>()
  let wireCwd: unknown
  let buffered = ''
  stdin.on('data', (chunk: Buffer) => {
    buffered += chunk.toString()
    for (;;) {
      const end = buffered.indexOf('\n')
      if (end < 0) break
      const frame = JSON.parse(buffered.slice(0, end)) as { id?: number; method?: string; params?: { cwd?: string } }
      buffered = buffered.slice(end + 1)
      if (frame.id === undefined) continue
      if (frame.method === 'thread/start') wireCwd = frame.params?.cwd
      const result = frame.method === 'initialize' ? { userAgent: 'cwd-fixture' }
        : frame.method === 'thread/start' ? { thread: { id: 'thread-cwd', ephemeral: true } }
          : { turn: { id: 'turn-cwd' } }
      stdout.write(`${JSON.stringify({ id: frame.id, result })}\n`)
    }
  })
  const handle: SubprocessHandle = {
    stdin, stdout, stderr: undefined, collected: {}, done: done.promise,
    terminate: () => { done.resolve({ exitCode: 0, signal: null }) },
    waitForExit: async () => { await done.promise; return true },
  }
  onTestFinished(() => { stdin.destroy(); stdout.destroy() })
  const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(handle)
  onTestFinished(() => { spawn.mockRestore() })
  await ctx.plugin(codex, { env: {}, disposeGraceMs: 100 })
  const starting = ctx.subagents.start('codex', fixture.request)
  if (mode === 'relative' || mode === 'empty') {
    const outcome = await starting.then(async (run) => { await run.dispose(); return 'started' }, () => 'rejected')
    expect(outcome).toBe('rejected')
    expect(spawn).not.toHaveBeenCalled()
    return
  }
  const run = await starting
  onTestFinished(() => run.dispose())
  const expected = mode === 'omitted' ? fixture.parent : fixture.explicit
  expect(spawn.mock.calls.map(([spec]) => spec.cwd)).toEqual([expected])
  expect(wireCwd).toBe(expected)
})
