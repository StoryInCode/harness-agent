import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { PassThrough } from 'node:stream'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as claude from '../src/index.ts'
import { cwdCase, cwdModes } from '../../subagent-acp/tests/request-cwd-cases.ts'

const query = vi.hoisted(() => vi.fn<(args: { prompt: string; options: Options }) => Query>())
vi.mock('@anthropic-ai/claude-agent-sdk', async original => ({
  ...await original<typeof import('@anthropic-ai/claude-agent-sdk')>(), query,
}))

it.each(cwdModes)('Claude Code request cwd: %s', async (mode) => {
  const fixture = cwdCase(mode)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const done = Promise.withResolvers<SubprocessOutcome>()
  const handle: SubprocessHandle = {
    stdin, stdout, stderr: undefined, collected: {}, done: done.promise,
    terminate: () => { done.resolve({ exitCode: 0, signal: null }) },
    waitForExit: async () => { await done.promise; return true },
  }
  onTestFinished(() => { stdin.destroy(); stdout.destroy(); query.mockReset() })
  const spawn = vi.spyOn(ctx.subprocess, 'spawn').mockReturnValue(handle)
  onTestFinished(() => { spawn.mockRestore() })
  query.mockImplementation(({ options }) => {
    options.spawnClaudeCodeProcess!({
      command: process.execPath, args: [], cwd: options.cwd!, env: options.env!,
      signal: options.abortController!.signal,
    })
    async function* messages(): AsyncGenerator<SDKMessage> {
      yield { type: 'result', subtype: 'success', is_error: false, result: 'done' } as SDKMessage
    }
    return Object.assign(messages(), { close: () => { done.resolve({ exitCode: 0, signal: null }) } }) as unknown as Query
  })
  await ctx.plugin(claude, { env: {}, disposeGraceMs: 100 })
  const starting = ctx.subagents.start('claude-code', fixture.request)
  if (mode === 'relative' || mode === 'empty') {
    const outcome = await starting.then(async (run) => { await run.dispose(); return 'started' }, () => 'rejected')
    expect(outcome).toBe('rejected')
    expect(query).not.toHaveBeenCalled()
    return
  }
  const run = await starting
  onTestFinished(() => run.dispose())
  const expected = mode === 'omitted' ? fixture.parent : fixture.explicit
  expect(query.mock.calls.map(([args]) => args.options.cwd)).toEqual([expected])
  expect(spawn.mock.calls.map(([spec]) => spec.cwd)).toEqual([expected])
})
