/** Recovery distinguishes observed refusal, filesystem failure, and caller cancellation. */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { assertEntriesActivated } from '@deepseek-ai/dsh-app-boot'
import Commands from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as recovery from '../src/command.ts'
import { createFixture } from './harness.ts'

async function fixture() {
  const f = await createFixture()
  await mkdir(dirname(f.destinationPath), { recursive: true })
  await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')).replace('**Status:** todo', '**Status:** done'))
  await rename(f.sourcePath, f.destinationPath)
  const ctx = await f.mount({ beforePersistence: async (context) => {
    await mountAgentLoopTestDependencies(context, { tools: { mode: 'native' } })
    await mountAgentLoopTestHarness(context)
  } })
  Object.assign(ctx.loader.builtins, { 'supplement-commands': Commands, 'supplement-recovery': recovery })
  await ctx.loader.create({ name: 'cordis:supplement-commands' })
  await ctx.loader.create({ name: 'cordis:supplement-recovery', config: { maxInputBytes: 4096, maxOutputBytes: 65536 } })
  await ctx.loader.await()
  await assertEntriesActivated(ctx, 'recovery-error-supplement')
  const { agent } = await ctx.agents.create({ sessionId: SessionId('recovery-errors'), meta: { cwd: f.repository } })
  const anomaly = (await ctx.devLoopPersistence.getAnomalies())[0]
  if (anomaly === undefined) throw new Error('real unjournaled completion anomaly absent')
  const controller = new AbortController()
  const execute = () => ctx.commands.execute(agent, `/dev-loop-recovery acknowledge ${anomaly.id} inspected the current observation`, [], controller.signal)
  return { ...f, ctx, agent, anomaly, controller, execute }
}

it('returns a real stale-observation refusal without recording acknowledgment', async () => {
  const f = await fixture()
  await writeFile(f.destinationPath, `${await readFile(f.destinationPath, 'utf8')}\nchanged before acknowledgment\n`)
  const result = await f.execute()
  expect(result?.result).toEqual({ kind: 'error', text: 'Local anomaly observations changed; inspect again' })
  expect(await f.ctx.devLoopPersistence.getAnomalies()).toEqual([f.anomaly])
})

it.each(['remove', 'abort'])('logs but does not translate a real %s failure into acknowledgment', async (action) => {
  const f = await fixture()
  const target = await f.ctx.fs.resolve(f.destinationPath)
  const read = f.ctx.fs.readText.bind(f.ctx.fs)
  let observed = false
  const abortReason = new Error('human cancelled the actual observation read')
  const spy = vi.spyOn(f.ctx.fs, 'readText').mockImplementation(async (...args) => {
    if (args[0].targetKey === target.targetKey) {
      observed = true
      if (action === 'remove') await rm(f.destinationPath)
      else f.controller.abort(abortReason)
    }
    return read(...args)
  })
  onTestFinished(() => { spy.mockRestore() })
  if (action === 'remove') await expect(f.execute()).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  else await expect(f.execute()).rejects.toBe(abortReason)
  spy.mockRestore()
  expect(observed).toBe(true)
  expect(await f.ctx.devLoopPersistence.getAnomalies()).toEqual([f.anomaly])
  const events = f.agent.session.snapshotEvents().filter(event => event.type === 'command/run' || event.type === 'command/done')
  expect(events).toHaveLength(2)
  expect(events[1]).toMatchObject({ type: 'command/done', data: { commandId: events[0]?.data.commandId, kind: 'error' } })
})
