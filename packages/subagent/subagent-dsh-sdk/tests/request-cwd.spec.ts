import { Context } from '@deepseek-ai/cordis'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createProcessDeepSeekHarness } from '../../../sdk/client/src/api.ts'
import * as sdk from '../src/index.ts'
import { internals } from '../src/run.ts'
import { cwdCase, cwdModes } from '../../subagent-acp/tests/request-cwd-cases.ts'

it.each([...cwdModes, 'omitted-configured'])('DSH SDK request cwd: %s', async (mode) => {
  const fixture = cwdCase(mode)
  const record = join(fixture.root, 'initialize.jsonl')
  const create = vi.spyOn(internals, 'createHarness').mockImplementation(options => createProcessDeepSeekHarness({
    command: process.execPath,
    args: [fileURLToPath(new URL('../../../sdk/client/tests/fake-runtime.ts', import.meta.url))],
    ...(options.processCwd === undefined ? {} : { cwd: options.processCwd }),
    environment: () => options.env ?? {},
    description: 'cwd protocol fixture',
    initializeTimeoutMs: 5000,
  }, options))
  onTestFinished(() => { create.mockRestore() })
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(sdk, {
    providerName: 'dsh-sdk', profile: 'sdk', patches: [], dshHome: fixture.root,
    provider: 'fake', model: 'fake', env: { FAKE_ECHO_CWD: '1', FAKE_TEXT: 'done', FAKE_RECORD_INIT: record },
    ...(mode === 'explicit' || mode === 'omitted-configured' ? { cwd: fixture.configured } : {}),
  })
  const starting = ctx.subagents.start('dsh-sdk', fixture.request)
  if (mode === 'relative' || mode === 'empty') {
    const outcome = await starting.then(async (run) => { await run.dispose(); return 'started' }, () => 'rejected')
    expect(outcome).toBe('rejected')
    expect(create).not.toHaveBeenCalled()
    return
  }
  const run = await starting
  onTestFinished(() => run.dispose())
  const result = await run.result
  expect(result.stopReason).toBe('completed')
  const expected = mode === 'omitted' ? fixture.parent : mode === 'omitted-configured' ? fixture.configured : fixture.explicit
  expect(result.output).toEqual([{ type: 'text', text: `cwd=${expected}\ndone` }])
  expect(JSON.parse(readFileSync(record, 'utf8'))).toMatchObject({ cwd: expected })
})
