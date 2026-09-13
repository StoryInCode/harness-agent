/** Actual CommandRuntime dispatch and Session log evidence; not a top-level replay claim. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, it } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { assertEntriesActivated } from '@deepseek-ai/dsh-app-boot'
import * as recovery from '../src/command.ts'
import { createFixture } from './harness.ts'

const OVERFLOW_TEXT = 'Recovery output exceeds maxOutputBytes; increase the configured limit.'
const MIN_OUTPUT_BYTES = Buffer.byteLength(JSON.stringify({ kind: 'error', text: OVERFLOW_TEXT }), 'utf8')

async function fixture(maxOutputBytes = 65536) {
  const f = await createFixture()
  await mkdir(dirname(f.destinationPath), { recursive: true })
  await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')).replace('**Status:** todo', '**Status:** done'))
  await rename(f.sourcePath, f.destinationPath)
  const ctx = await f.mount({ beforePersistence: async (context) => {
    await mountAgentLoopTestDependencies(context, { tools: { mode: 'native' } })
    await mountAgentLoopTestHarness(context)
  } })
  ctx.loader.builtins['recovery-runtime'] = CommandRuntime
  ctx.loader.builtins['recovery-consumer'] = recovery
  await ctx.loader.create({ name: 'cordis:recovery-runtime' })
  const entry = await ctx.loader.create({ name: 'cordis:recovery-consumer', config: { maxInputBytes: 4096, maxOutputBytes } })
  await ctx.loader.await()
  await assertEntriesActivated(ctx, 'recovery-fixture')
  const root = await ctx.agents.create({ sessionId: SessionId('recovery-root'), meta: { cwd: f.repository } })
  const execute = (input: string) => ctx.commands.execute(root.agent, `/dev-loop-recovery ${input}`, [], new AbortController().signal)
  return { ...f, ctx, root, entry, execute }
}

it('inspect registers without slash and logs actual command/run and command/done result pairing', async () => {
  const f = await fixture()
  const result = await f.execute('inspect 00.12')
  expect(result?.result.kind).toBe('success')
  expect(result?.result.text).toContain('unjournaled-done')
  expect(result?.result.text).toBe(JSON.stringify({ pieceId: '00.12',
    history: await f.ctx.devLoopPersistence.getHistory('00.12'), anomalies: await f.ctx.devLoopPersistence.getAnomalies() }))
  const events = f.root.agent.session.snapshotEvents().filter(event => event.type === 'command/run' || event.type === 'command/done')
  expect(events).toHaveLength(2)
  expect(events[0]).toMatchObject({ type: 'command/run', data: { commandId: result?.commandId, name: 'dev-loop-recovery', source: { kind: 'user' } } })
  expect(events[1]).toMatchObject({ type: 'command/done', data: { commandId: result?.commandId, kind: 'success', text: result?.result.text } })
})

it.each(['', 'inspect', 'inspect 00.12 trailing', 'inspect bad', 'acknowledge', 'acknowledge missing', 'repair 00.12', 'promote 00.12', 'done 00.12'])('rejects unsupported or incomplete grammar %j without changing status', async (input) => {
  const f = await fixture()
  const result = await f.execute(input)
  expect(result?.result.kind).toBe('error')
  expect(result?.result.text).toMatch(/inspect|acknowledge/)
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('acknowledgment records this actual root commandId and leaves the anomaly quarantined', async () => {
  const f = await fixture()
  const anomalies = await f.ctx.devLoopPersistence.getAnomalies()
  expect(anomalies).toHaveLength(1)
  const anomaly = anomalies[0]!
  const result = await f.execute(`acknowledge ${anomaly.id} Observed missing bootstrap evidence`)
  expect(result?.result.kind).toBe('success')
  const stored = (await f.ctx.devLoopPersistence.getAnomalies())[0]
  expect(stored?.id).toBe(anomaly.id)
  expect(stored?.acknowledgments).toEqual([expect.objectContaining({
    anomalyId: anomaly.id, reason: 'Observed missing bootstrap evidence',
    invocation: { commandId: result?.commandId, sessionId: f.root.agent.session.id },
  })])
  expect(result?.result.text).toBe(JSON.stringify(stored?.acknowledgments[0]))
  expect(() => f.ctx.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
})

it('a delegated child cannot acknowledge through actual command dispatch', async () => {
  const f = await fixture()
  const anomalies = await f.ctx.devLoopPersistence.getAnomalies()
  expect(anomalies).toHaveLength(1)
  const child = await f.ctx.agents.create({ sessionId: SessionId('recovery-child'), parentAgent: f.root.agent })
  const result = await f.ctx.commands.execute(child.agent, `/dev-loop-recovery acknowledge ${anomalies[0]!.id} child cannot authorize`, [], new AbortController().signal)
  expect(result?.result.kind).toBe('error')
  expect((await f.ctx.devLoopPersistence.getAnomalies())[0]?.acknowledgments).toEqual([])
})

it('complete multibyte input overflow refuses the command without a partial acknowledgment', async () => {
  const f = await fixture()
  const result = await f.execute(`acknowledge invalid ${'界'.repeat(4096)}`)
  expect(result?.result.kind).toBe('error')
  expect(Buffer.byteLength(JSON.stringify(result?.result), 'utf8')).toBeLessThanOrEqual(65536)
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('rejects an output budget too small for its complete refusal', async () => {
  await expect(fixture(MIN_OUTPUT_BYTES - 1).then(() => undefined)).rejects.toThrow(/maxOutputBytes/)
})

it('exact minimum budget returns a complete explicit refusal, never truncated history', async () => {
  const f = await fixture(MIN_OUTPUT_BYTES)
  const result = await f.execute('inspect 00.12')
  expect(result?.result).toEqual({ kind: 'error', text: OVERFLOW_TEXT })
  expect(Buffer.byteLength(JSON.stringify(result?.result), 'utf8')).toBe(MIN_OUTPUT_BYTES)
})

it('disposal removes the actual recovery registration', async () => {
  const f = await fixture()
  expect((await f.execute('inspect 00.12'))?.result.kind).toBe('success')
  await f.ctx.loader.remove(f.entry)
  expect(await f.execute('inspect 00.12')).toBeUndefined()
})
