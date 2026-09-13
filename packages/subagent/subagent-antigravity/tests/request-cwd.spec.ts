import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as antigravity from '../src/index.ts'
import { cwdCase, cwdModes } from '../../subagent-acp/tests/request-cwd-cases.ts'

it.each(cwdModes)('Antigravity request cwd: %s', async (mode) => {
  const fixture = cwdCase(mode)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const text = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'done' } })
  const handle: SubprocessHandle = {
    stdin: undefined, stdout: undefined, stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text, lossy: false, nextOffset: Buffer.byteLength(text) }) } },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate: () => {}, waitForExit: async () => true,
  }
  const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(handle)
  onTestFinished(() => { spawn.mockRestore() })
  await ctx.plugin(antigravity, {})
  const starting = ctx.subagents.start('antigravity', fixture.request)
  if (mode === 'relative' || mode === 'empty') {
    const outcome = await starting.then(async (run) => { await run.dispose(); return 'started' }, () => 'rejected')
    expect(outcome).toBe('rejected')
    expect(spawn).not.toHaveBeenCalled()
    return
  }
  const run = await starting
  onTestFinished(() => run.dispose())
  expect((await run.result).stopReason).toBe('completed')
  expect(spawn.mock.calls.map(([spec]) => spec.cwd)).toEqual([mode === 'omitted' ? fixture.parent : fixture.explicit])
})
