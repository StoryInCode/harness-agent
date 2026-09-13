/** Real human commands must retain reviewed source and runtime identity in durable authorization. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { assertEntriesActivated } from '@deepseek-ai/dsh-app-boot'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import Queue from '@deepseek-ai/dsh-dev-loop-queue'
import * as command from '@deepseek-ai/dsh-dev-loop-command'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { HumanAuthorization } from '../src/types.ts'
import { createFixture } from './harness.ts'

function digest(source: string) {
  return createHash('sha256').update(source, 'utf8').digest('hex')
}

async function fixture() {
  const files = await createFixture()
  const seeded = await readFile(files.sourcePath, 'utf8')
  await writeFile(files.sourcePath, `${seeded}\n\`\`\`markdown\n**Status:** blocked\n\`\`\`\n`)
  await files.git('add', '--', files.sourcePath)
  await files.git('commit', '-q', '-m', 'seed literal body status example')
  const ctx = await files.mount({
    durability: 'required',
    beforePersistence: async (context) => {
      await mountAgentLoopTestDependencies(context, { tools: { mode: 'native' } })
      await mountAgentLoopTestHarness(context)
    },
  })
  Object.assign(ctx.loader.builtins, { 'authorization-runtime': CommandRuntime, 'authorization-queue': Queue, 'authorization-command': command })
  const configPath = join(files.storageRoot, 'command.cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { name: 'cordis:authorization-runtime' },
    { name: 'cordis:authorization-queue', config: { maxConcurrency: 1 } },
    { name: 'cordis:authorization-command', config: { maxInputBytes: 4096, maxOutputBytes: 65536 } },
  ]))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  await assertEntriesActivated(ctx, 'command-authorization-fixture')
  const agent = (await ctx.agents.create({ sessionId: SessionId('authorization-root'), meta: { cwd: files.repository } })).agent
  const lifecycle = ctx.get('devLoopLifecycle')!
  const original = lifecycle.transition.bind(lifecycle)
  const transition = vi.spyOn(lifecycle, 'transition').mockImplementation((...args) => original(...args))
  onTestFinished(() => { transition.mockRestore() })
  const commands = ctx.get('commands')!
  const call = (input: string, caller = agent) => commands.execute(caller, `/dev-loop ${input}`, [], new AbortController().signal)
  const source = await readFile(files.sourcePath, 'utf8')
  const baseline = await files.git('status', '--porcelain=v1')
  return { ...files, ctx, agent, transition, call, source, baseline }
}

it.each(['transition argument six', 'durable history authorization'] as const)('retains reviewed root command facts in %s', async (observation) => {
  const f = await fixture()
  const shown = await f.call('show 00.12')
  expect(shown?.result.kind).toBe('success')
  expect(shown?.result.text).toContain(`SHA256: ${digest(f.source)}\n\n${f.source}`)
  const fs = f.ctx.get('fs')!
  const piece = await f.ctx.get('devLoopDirectory')!.getPiece('00.12')
  const target = await fs.resolve(piece.path)
  const stat = await fs.stat(target)
  expect(stat).toBeDefined()
  const execution = await f.call(`approve 00.12 ${digest(f.source)}`)
  expect(execution).toBeDefined()
  expect(execution!.commandId).not.toBe(shown!.commandId)
  const expected: HumanAuthorization = {
    kind: 'command', commandId: execution!.commandId, sessionId: f.agent.session.id, decision: 'accept',
    source: {
      path: piece.path, version: stat!.version,
      rawDigest: digest(f.source) as HumanAuthorization['source']['rawDigest'],
      contentDigest: digest(f.source.replace(/^(\*\*Status:\*\* )[a-z]+$/m, '$1todo')) as HumanAuthorization['source']['contentDigest'],
    },
  }
  expect(f.transition).toHaveBeenCalledTimes(1)
  const args: readonly unknown[] = f.transition.mock.calls[0]!
  expect(execution!.result).toEqual({ kind: 'success', text: 'Piece 00.12: pending.' })
  const events = f.agent.session.snapshotEvents().filter(event =>
    (event.type === 'command/run' || event.type === 'command/done') && event.data.commandId === execution!.commandId)
  expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
  expect(events[0]?.data).toEqual({ commandId: execution!.commandId, name: 'dev-loop', args: ` approve 00.12 ${digest(f.source)}`, source: { kind: 'user' } })
  expect(events[1]?.data).toEqual({ commandId: execution!.commandId, kind: 'success', text: 'Piece 00.12: pending.' })
  expect(args[4]).toBeInstanceOf(AbortSignal)
  if (observation === 'transition argument six') expect(args[5]).toEqual(expected)
  const history = await f.ctx.get('devLoopPersistence')!.getHistory('00.12')
  expect(history).toHaveLength(1)
  expect(history[0]?.authorization).toEqual(expected)
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.source)
  expect(await f.git('status', '--porcelain=v1')).toBe(f.baseline)
  const reopened = await f.mount({ durability: 'required' })
  expect((await reopened.get('devLoopPersistence')!.getHistory('00.12'))[0]?.authorization).toEqual(expected)
})

it('refuses a digest made stale by an actual source edit without transition or history', async () => {
  const f = await fixture()
  const shown = await f.call('show 00.12')
  expect(shown?.result.text).toContain(`SHA256: ${digest(f.source)}\n\n${f.source}`)
  const changed = f.source.replace('Fixture text for Summary.', 'Changed human review text for Summary.')
  await writeFile(f.sourcePath, changed)
  const status = await f.git('status', '--porcelain=v1')
  const diff = await f.git('diff', 'HEAD', '--')
  const execution = await f.call(`approve 00.12 ${digest(f.source)}`)
  expect(execution?.result.kind).toBe('error')
  expect(execution?.result.text).toContain('Stale SHA256 digest')
  expect(f.transition).not.toHaveBeenCalled()
  expect(await f.ctx.get('devLoopPersistence')!.getHistory('00.12')).toEqual([])
  expect(await readFile(f.sourcePath, 'utf8')).toBe(changed)
  expect(await f.git('status', '--porcelain=v1')).toBe(status)
  expect(await f.git('diff', 'HEAD', '--')).toBe(diff)
})

it('refuses a BOM-bearing source rather than publishing a digest of stripped bytes', async () => {
  const f = await fixture()
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f.source, 'utf8')])
  await writeFile(f.sourcePath, bytes)
  const rawDigest = createHash('sha256').update(bytes).digest('hex')
  expect(rawDigest).not.toBe(digest(f.source))
  const status = await f.git('status', '--porcelain=v1')
  const diff = await f.git('diff', 'HEAD', '--')
  const shown = await f.call('show 00.12')
  expect(f.transition).not.toHaveBeenCalled()
  expect(await f.ctx.get('devLoopPersistence')!.getHistory('00.12')).toEqual([])
  expect(await readFile(f.sourcePath)).toEqual(bytes)
  expect(await f.git('status', '--porcelain=v1')).toBe(status)
  expect(await f.git('diff', 'HEAD', '--')).toBe(diff)
  expect(shown?.result.kind).toBe('error')
  expect(shown?.result.text).not.toContain(`SHA256: ${digest(f.source)}`)
})

it('refuses a source whose provider cannot report its byte size', async () => {
  const f = await fixture()
  const fs = f.ctx.get('fs')!
  const target = await fs.resolve(f.sourcePath)
  const original = fs.stat.bind(fs)
  let observations = 0
  const stat = vi.spyOn(fs, 'stat').mockImplementation(async (...args) => {
    const info = await original(...args)
    if (args[0].targetKey !== target.targetKey || info === undefined) return info
    observations++
    const withoutSize = { ...info }
    delete withoutSize.size
    return withoutSize
  })
  onTestFinished(() => { stat.mockRestore() })
  const shown = await f.call('show 00.12')
  expect(observations).toBeGreaterThan(0)
  expect(f.transition).not.toHaveBeenCalled()
  expect(await f.ctx.get('devLoopPersistence')!.getHistory('00.12')).toEqual([])
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.source)
  expect(await f.git('status', '--porcelain=v1')).toBe(f.baseline)
  expect(shown?.result.kind).toBe('error')
  expect(shown?.result.text).not.toContain(`SHA256: ${digest(f.source)}`)
})

it('refuses an actual delegated child with the current digest without transition or history', async () => {
  const f = await fixture()
  const child = (await f.ctx.agents.create({ sessionId: SessionId('authorization-child'), parentAgent: f.agent, meta: { cwd: f.repository } })).agent
  expect(f.ctx.agents.roots()).not.toContain(child)
  const shown = await f.call('show 00.12', child)
  expect(shown?.result.text).toContain(`SHA256: ${digest(f.source)}\n\n${f.source}`)
  const execution = await f.call(`approve 00.12 ${digest(f.source)}`, child)
  expect(execution?.result.kind).toBe('error')
  expect(execution?.result.text).toContain('exact live root human agent')
  expect(f.transition).not.toHaveBeenCalled()
  expect(await f.ctx.get('devLoopPersistence')!.getHistory('00.12')).toEqual([])
  expect(await readFile(f.sourcePath, 'utf8')).toBe(f.source)
  expect(await f.git('status', '--porcelain=v1')).toBe(f.baseline)
})
