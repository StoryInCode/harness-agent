import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import * as acp from '../src/index.ts'
import { cwdCase, cwdModes } from './request-cwd-cases.ts'

it.each([...cwdModes, 'omitted-configured'])('ACP request cwd: %s', async (mode) => {
  const fixture = cwdCase(mode)
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(acp, {
    providerName: 'acp', command: process.execPath,
    args: [fileURLToPath(new URL('./mock-acp-server.ts', import.meta.url))],
    permission: 'reject', env: { MOCK_ECHO_CWD: '1' },
    ...(mode === 'explicit' || mode === 'omitted-configured' ? { cwd: fixture.configured } : {}),
  })
  const starting = ctx.subagents.start('acp', fixture.request)
  if (mode === 'relative' || mode === 'empty') {
    const outcome = await starting.then(async (run) => { await run.dispose(); return 'started' }, () => 'rejected')
    expect(outcome).toBe('rejected')
    return
  }
  const run = await starting
  onTestFinished(() => run.dispose())
  const result = await run.result
  expect(result.stopReason).toBe('completed')
  const expected = mode === 'omitted' ? fixture.parent : mode === 'omitted-configured' ? fixture.configured : fixture.explicit
  expect(result.output).toEqual([{ type: 'text', text: `${expected}\n${expected}` }])
})
