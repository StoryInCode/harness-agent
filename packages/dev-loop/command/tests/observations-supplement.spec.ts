/** Dynamic corpus visibility and unexpected observation failures through the real command registry. */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { PieceNotFoundError, PieceParseError } from '@deepseek-ai/dsh-dev-loop-directory'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { deferred, fixture, piece } from './harness.ts'

type Fixture = Awaited<ReturnType<typeof fixture>>

function success(execution: CommandExecution | undefined): string {
  expect(execution?.result.kind, execution?.result.text).toBe('success')
  expect(execution?.result.text).toBeTruthy()
  return execution!.result.text!
}

/** No callback should run for these real requests parked on a dependency or occupied capacity. */
async function park(f: Fixture, id = '00.03') {
  const controller = new AbortController()
  f.releases.push(() => { controller.abort(new Error('fixture request released')) })
  const dispatch = vi.fn(async (): Promise<SubagentRun> => { throw new Error('parked request unexpectedly dispatched') })
  const ticket = await f.ctx.agents.withInitiator(f.agent, () => f.queue.enqueue({
    pieceId: id, signal: controller.signal, dispatch,
  }))
  f.joins.push(ticket.result)
  void ticket.result.catch(() => undefined)
  expect(f.queue.getQueuedEntries().map(entry => entry.pieceId)).toContain(id)
  expect(dispatch).not.toHaveBeenCalled()
  return { ticket, dispatch }
}

/** Hold one real reservation at its external worker result until fixture cleanup releases it. */
async function occupyCapacity(f: Fixture) {
  const result = deferred<SubagentResult>()
  const observed = deferred<undefined>()
  const controller = new AbortController()
  const aborted: SubagentResult = { stopReason: 'aborted', output: [] }
  f.releases.push(() => { controller.abort(); result.resolve(aborted) })
  const run: SubagentRun = {
    id: SessionId('command-supplement-worker'), localAgent: undefined,
    get result() { observed.resolve(undefined); return result.promise },
    async dispose() { result.resolve(aborted) },
  }
  const ticket = await f.ctx.agents.withInitiator(f.agent, () => f.queue.enqueue({
    pieceId: '00.01', signal: controller.signal, dispatch: async () => run,
  }))
  f.joins.push(ticket.result)
  void ticket.result.catch(() => undefined)
  await Promise.race([observed.promise, ticket.result.then(() => { throw new Error('worker settled before observation') })])
  expect(f.queue.getActiveWorkers()).toMatchObject([{ pieceId: '00.01', status: 'running' }])
}

async function expectLoggedDefect(f: Fixture, route: string, defect: Error, signal = new AbortController().signal) {
  const before = f.agent.session.snapshotEvents().length
  await expect(f.call(route, f.agent, signal)).rejects.toBe(defect)
  const events = f.agent.session.snapshotEvents().slice(before)
  expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
  const run = events[0]
  expect(run?.type).toBe('command/run')
  if (run?.type !== 'command/run') throw new Error('missing admitted command event')
  expect(events[1]?.data).toEqual({ commandId: run.data.commandId, kind: 'error', text: defect.message })
  expect(f.transition).not.toHaveBeenCalled()
}

describe('dev-loop observation supplements', () => {
  it.each(['list', 'status'] as const)('%s keeps newly discovered valid source visible without inventing Lifecycle state', async (route) => {
    const f = await fixture()
    const path = 'plans/pieces/00-command/done/00.07-late.md'
    const source = piece({ id: '00.07', status: 'done' })
    await mkdir(dirname(join(f.root, path)), { recursive: true })
    await writeFile(join(f.root, path), source)
    expect(await f.directory.getPiece('00.07')).toMatchObject({ id: '00.07', status: 'done', path })
    expect(() => f.lifecycle.getStatus('00.07')).toThrow(PieceNotFoundError)
    const output = success(await f.call(route))
    expect(output).toContain(path)
    expect(output).toContain(new PieceNotFoundError('00.07').message)
    if (route === 'status') {
      expect(output).toMatch(/^todo: 1$/m)
      expect(output).toMatch(/^done: 0$/m)
      expect(output).toMatch(/^pending: 0$/m)
      expect(output).toMatch(/^blocked: 0$/m)
    } else expect(output).toContain('Review 00.03')
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['list', 'status'] as const)('%s propagates an unexpected Lifecycle observation defect and logs no success', async (route) => {
    const f = await fixture()
    const defect = new TypeError('fixture Lifecycle observation defect')
    const getStatus = f.lifecycle.getStatus.bind(f.lifecycle)
    const spy = vi.spyOn(f.lifecycle, 'getStatus').mockImplementation((id) => {
      if (id === '00.03') throw defect
      return getStatus(id)
    })
    f.restores.push(() => { spy.mockRestore() })
    await expectLoggedDefect(f, route, defect)
    expect(spy).toHaveBeenCalledWith('00.03')
  })

  it.each(['missing', 'malformed'] as const)('queue retains an admitted entry whose own source becomes %s', async (condition) => {
    const f = await fixture({ seeds: [
      { id: '00.01' }, { id: '00.03', status: 'pending', dependencies: ['00.01'] },
    ] })
    const queued = await park(f)
    const before = f.queue.getQueuedEntries()
    if (condition === 'missing') await rm(join(f.root, f.paths.get('00.03')!))
    else await f.write('00.03', f.sources.get('00.03')!.replace('**Status:** pending', '**Status:** invalid'))
    const failure: unknown = await f.directory.getPiece('00.03').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(condition === 'missing' ? PieceNotFoundError : PieceParseError)
    const output = success(await f.call('queue'))
    expect(output).toMatch(/^1\. 00\.03/m)
    expect(output).toContain(String(before[0]!.enqueuedAt))
    if (failure instanceof PieceParseError) {
      expect(output).toContain(failure.path)
      expect(output).toContain(failure.code)
      for (const finding of failure.findings) expect(output).toContain(finding.message)
    } else if (failure instanceof PieceNotFoundError) expect(output).toContain(failure.message)
    expect(f.queue.getQueuedEntries()).toEqual(before)
    expect(queued.dispatch).not.toHaveBeenCalled()
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('queue explicitly shows no dependencies while an independent worker holds capacity', async () => {
    const f = await fixture({ concurrency: 1, seeds: [
      { id: '00.01', status: 'pending' }, { id: '00.03', status: 'pending' },
    ] })
    await occupyCapacity(f)
    const queued = await park(f)
    expect((await f.directory.getPiece('00.03')).dependsOn).toEqual([])
    const output = success(await f.call('queue'))
    expect(output).toMatch(/^1\. 00\.03/m)
    expect(output).toMatch(/Dependencies: none/)
    expect(output).not.toContain('00.01')
    expect(f.queue.getActiveWorkers()).toHaveLength(1)
    expect(queued.dispatch).not.toHaveBeenCalled()
  })

  it('queue marks a newly declared valid dependency unavailable until Lifecycle knows its status', async () => {
    const f = await fixture({ seeds: [
      { id: '00.01' }, { id: '00.03', status: 'pending', dependencies: ['00.01'] },
    ] })
    const queued = await park(f)
    const source = piece({ id: '00.07', status: 'done' })
    await writeFile(join(f.root, 'plans/pieces/00-command/00.07-late.md'), source)
    await f.write('00.03', f.sources.get('00.03')!.replace('**Depends on:** 00.01', '**Depends on:** 00.07'))
    expect(await f.directory.getPiece('00.07')).toMatchObject({ id: '00.07', status: 'done' })
    expect(() => f.lifecycle.getStatus('00.07')).toThrow(PieceNotFoundError)
    const output = success(await f.call('queue'))
    expect(output).toMatch(/00\.07: unavailable/)
    expect(output).toContain(new PieceNotFoundError('00.07').message)
    expect(output).not.toMatch(/00\.07[^\n]*done/)
    expect(queued.dispatch).not.toHaveBeenCalled()
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['directory', 'lifecycle'] as const)('queue propagates an unexpected dependency %s defect rather than hiding it as unavailable', async (owner) => {
    const f = await fixture({ seeds: [
      { id: '00.01' }, { id: '00.03', status: 'pending', dependencies: ['00.01'] },
    ] })
    const queued = await park(f)
    const before = f.queue.getQueuedEntries()
    const controller = new AbortController()
    const defect = new TypeError(`fixture dependency ${owner} defect`)
    if (owner === 'directory') {
      const getPiece = f.directory.getPiece.bind(f.directory)
      const spy = vi.spyOn(f.directory, 'getPiece').mockImplementation(async (id, signal) => {
        if (id === '00.01') {
          expect(signal).toBe(controller.signal)
          throw defect
        }
        return getPiece(id, signal)
      })
      f.restores.push(() => { spy.mockRestore() })
    } else {
      const getStatus = f.lifecycle.getStatus.bind(f.lifecycle)
      const spy = vi.spyOn(f.lifecycle, 'getStatus').mockImplementation((id) => {
        if (id === '00.01') throw defect
        return getStatus(id)
      })
      f.restores.push(() => { spy.mockRestore() })
    }
    await expectLoggedDefect(f, 'queue', defect, controller.signal)
    expect(f.queue.getQueuedEntries()).toEqual(before)
    expect(queued.dispatch).not.toHaveBeenCalled()
  })
})
