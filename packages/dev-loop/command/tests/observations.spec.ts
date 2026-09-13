/** Read-only displays derive from actual Queue reservations and Directory/Lifecycle observations. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import { deferred, fixture } from './harness.ts'

type Fixture = Awaited<ReturnType<typeof fixture>>
function success(execution: CommandExecution | undefined): string {
  expect(execution?.result.kind, execution?.result.text).toBe('success')
  expect(execution?.result.text).toBeTruthy()
  return execution!.result.text!
}

/** Controlled worker startup/result are external inputs; Queue admission and reservation stay real. */
async function submit(f: Fixture, id: string, holdStart = false) {
  const start = deferred<undefined>()
  const started = deferred<undefined>()
  const running = deferred<undefined>()
  const result = deferred<SubagentResult>()
  const controller = new AbortController()
  const aborted: SubagentResult = { stopReason: 'aborted', output: [] }
  f.releases.push(() => { controller.abort(); start.resolve(undefined); result.resolve(aborted) })
  if (!holdStart) start.resolve(undefined)
  const run: SubagentRun = {
    id: SessionId(`command-worker-${id}`), localAgent: undefined,
    get result() { running.resolve(undefined); return result.promise },
    async dispose() { result.resolve(aborted) },
  }
  const dispatch = vi.fn(async () => { started.resolve(undefined); await start.promise; return run })
  const ticket = await f.ctx.agents.withInitiator(f.agent, () => f.queue.enqueue({ pieceId: id, signal: controller.signal, dispatch }))
  f.joins.push(ticket.result)
  void ticket.result.catch(() => undefined)
  return { start, started, running, result, dispatch, ticket }
}

function count(output: string, label: string, value: number): void {
  expect(output).toMatch(new RegExp(`(?:${label})[^\\d\\n]*${value}(?!\\d)`, 'i'))
}

describe('dev-loop live observations', () => {
  it.each(['list', 'status', 'queue'] as const)('%s explicitly describes empty state', async (route) => {
    const f = await fixture({ seeds: [] })
    const output = success(await f.call(route))
    if (route === 'status') {
      count(output, 'todo', 0)
      count(output, 'pending', 0)
      count(output, 'blocked', 0)
      count(output, 'done', 0)
      count(output, 'queued', 0)
    } else expect(output).toMatch(/empty|no pieces|no sets/i)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('lists deterministic set, queue, id order with paths, titles and logical rather than disk status', async () => {
    const f = await fixture({ seeds: [
      { id: '01.01', set: '01-command', queue: 1 },
      { id: '00.03', queue: 2 }, { id: '00.02', queue: 2 }, { id: '00.01', queue: 9, status: 'done' },
    ] })
    await f.lifecycle.transition('00.02', 'todo', 'pending', 'fixture')
    f.transition.mockClear()
    const output = success(await f.call('list'))
    const titles = ['Review 00.02', 'Review 00.03', 'Review 00.01', 'Review 01.01']
    const positions = titles.map(title => output.indexOf(title))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    for (const path of f.paths.values()) expect(output).toContain(path)
    const line = output.split('\n').find(line => line.includes('Review 00.02'))!
    expect(line).toContain('pending')
    expect(line).not.toMatch(/\btodo\b/)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['list', 'status'] as const)('%s retains malformed source path and actual Directory findings', async (route) => {
    const f = await fixture()
    const malformedPath = 'plans/pieces/00-command/00.99-broken.md'
    await writeFile(join(f.root, malformedPath), '# 00.99 — Broken\n**Status:** not-a-status\n')
    const scan = await f.directory.scanSet('00-command')
    expect(scan.rejected).toHaveLength(1)
    const output = success(await f.call(route))
    expect(output).toContain(malformedPath)
    expect(output).toContain(scan.rejected[0]!.code)
    if (route === 'status') {
      count(output, 'todo', 1)
      count(output, 'pending', 0)
      count(output, 'done', 0)
    }
  })

  it('status counts starting and running reservations plus queued work and logical state', async () => {
    const f = await fixture({ seeds: [
      { id: '00.01', status: 'pending' }, { id: '00.02', status: 'pending' },
      { id: '00.03' }, { id: '00.04', status: 'done' }, { id: '00.05', status: 'blocked' },
      { id: '00.06' },
    ], concurrency: 2 })
    await f.lifecycle.transition('00.03', 'todo', 'pending', 'fixture')
    const starting = await submit(f, '00.01', true)
    await starting.started.promise
    const running = await submit(f, '00.02')
    await running.running.promise
    const queued = await submit(f, '00.03')
    expect(f.queue.getActiveWorkers().map(entry => entry.status)).toEqual(['starting', 'running'])
    expect(f.queue.getQueuedEntries().map(entry => entry.pieceId)).toEqual(['00.03'])
    expect(queued.dispatch).not.toHaveBeenCalled()
    const before = Date.now()
    const output = success(await f.call('status'))
    const after = Date.now()
    count(output, 'workers|active', 2)
    count(output, 'maxConcurrency|ceiling|limit', 2)
    count(output, 'queued', 1)
    count(output, 'todo', 1)
    count(output, 'pending', 3)
    count(output, 'done', 1)
    count(output, 'blocked', 1)
    const observed = /\d{4}-\d{2}-\d{2}T[^\s]+|\b\d{13}\b/.exec(output)?.[0]
    expect(observed, 'timestamped observation').toBeDefined()
    const time = /^\d{13}$/.test(observed!) ? Number(observed) : Date.parse(observed!)
    expect(time).toBeGreaterThanOrEqual(before)
    expect(time).toBeLessThanOrEqual(after)
    starting.start.resolve(undefined)
    const completed: SubagentResult = { stopReason: 'completed', output: [] }
    starting.result.resolve(completed)
    running.result.resolve(completed)
    queued.result.resolve(completed)
    await Promise.all([starting.ticket.result, running.ticket.result, queued.ticket.result])
    const later = success(await f.call('status'))
    count(later, 'workers|active', 0)
    count(later, 'queued', 0)
    count(later, 'pending', 3)
  })

  it('queue preserves returned priority/FIFO order, numbered positions and per-dependency logical statuses', async () => {
    const f = await fixture({ seeds: [
      { id: '00.01', status: 'todo' }, { id: '00.02', status: 'done' },
      { id: '00.03', queue: 8, status: 'pending', dependencies: ['00.01', '00.02'] },
      { id: '00.04', queue: 3, status: 'pending', dependencies: ['00.01'] },
      { id: '00.05', queue: 3, status: 'pending', dependencies: ['00.01'] },
    ] })
    await f.lifecycle.transition('00.01', 'todo', 'pending', 'fixture')
    await submit(f, '00.03')
    await submit(f, '00.05')
    await submit(f, '00.04')
    const entries = f.queue.getQueuedEntries()
    expect(entries.map(entry => entry.pieceId)).toEqual(['00.05', '00.04', '00.03'])
    const output = success(await f.call('queue'))
    const positions = entries.map(entry => output.indexOf(entry.pieceId))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    for (const [index, entry] of entries.entries()) {
      const row = output.split('\n').find(line => line.includes(entry.pieceId))!
      expect(row).toMatch(new RegExp(`^\\s*${index + 1}[.) :|]`))
      expect(row).toContain(String(entry.queueOrder))
      expect(output).toContain(String(entry.enqueuedAt))
    }
    expect(output).toMatch(/00\.01[^\n]*pending/)
    expect(output).toMatch(/00\.02[^\n]*done/)
    expect(output).not.toMatch(/00\.01[^\n]*todo/)
  })

  it('queue reads current declared dependencies rather than inventing fields on QueueEntry', async () => {
    const f = await fixture({ seeds: [
      { id: '00.01' }, { id: '00.02', status: 'done' },
      { id: '00.03', status: 'pending', dependencies: ['00.01'] },
    ] })
    await submit(f, '00.03')
    await f.write('00.03', f.sources.get('00.03')!.replace('**Depends on:** 00.01', '**Depends on:** 00.02'))
    const output = success(await f.call('queue'))
    expect(output).toMatch(/00\.02[^\n]*done/)
    expect(output).not.toContain('00.01')
    expect(f.queue.getQueuedEntries()).toHaveLength(1)
  })

  it.each(['missing', 'malformed'] as const)('queue reports a dependency that becomes %s after real admission', async (condition) => {
    const f = await fixture({ seeds: [
      { id: '00.01' }, { id: '00.03', status: 'pending', dependencies: ['00.01'] },
    ] })
    const worker = await submit(f, '00.03')
    expect(worker.dispatch).not.toHaveBeenCalled()
    if (condition === 'missing') await rm(join(f.root, f.paths.get('00.01')!))
    else await f.write('00.01', f.sources.get('00.01')!.replace('**Status:** todo', '**Status:** invalid'))
    const output = success(await f.call('queue'))
    expect(output).toContain('00.03')
    expect(output).toContain('00.01')
    expect(output).toMatch(condition === 'missing' ? /not found|missing|no piece/i : /invalid|malformed|parse/i)
    expect(output).not.toMatch(/00\.01[^\n]*done/)
    expect(worker.dispatch).not.toHaveBeenCalled()
  })

  it.each(['queue', 'status'] as const)('%s overflow is a whole-result error, never partial entries or counts', async (route) => {
    const f = await fixture({ config: { maxOutputBytes: 256 }, seeds: [
      { id: '00.01' }, ...Array.from({ length: 15 }, (_, i) => ({
        id: `00.${String(i + 2).padStart(2, '0')}`, status: 'pending' as const, dependencies: ['00.01'],
      })),
    ] })
    for (const id of f.sources.keys()) if (id !== '00.01') await submit(f, id)
    // Rejected-source diagnostics are required status output, not optional detail to drop for space.
    await mkdir(join(f.root, 'plans/pieces/01-diagnostics'))
    for (let i = 0; i < 10; i++) await writeFile(join(f.root, `plans/pieces/01-diagnostics/01.${String(i).padStart(2, '0')}-malformed.md`), 'broken')
    const output = await f.call(route)
    expect(output?.result.kind).toBe('error')
    expect(output?.result.text).toMatch(/output|size|large|limit|bytes/i)
    expect(Buffer.byteLength(JSON.stringify(output!.result), 'utf8')).toBeLessThanOrEqual(256)
    expect(output?.result.text).not.toContain('00.02')
  })
})
