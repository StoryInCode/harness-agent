/** Behavioral RED specification for one-shot reservations; no scheduler is implemented by these fixtures. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from '@deepseek-ai/dsh-subagent'
import type { SubagentRun, SubagentResult } from '@deepseek-ai/dsh-subagent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import DevLoopDirectory from '@deepseek-ai/dsh-dev-loop-directory'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import DevLoopLifecycle from '@deepseek-ai/dsh-dev-loop-lifecycle'
import DevLoopQueue from '../src/index.ts'
import type { QueueRequest, QueueTicket } from '../src/index.ts'

const IDS = ['00.01', '00.02', '00.03', '00.04', '00.05', '00.06']
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  // Controls may fail before the queue reaches the corresponding startup/result observation.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

function outcome(stopReason: SubagentResult['stopReason'] = 'completed'): SubagentResult {
  return { stopReason, output: [{ type: 'text', text: `worker ${stopReason}` }] }
}

interface FixtureOptions {
  maxConcurrency?: number
  mount?: boolean
  composition?: boolean
  git?: boolean
  statuses?: Record<string, PieceStatus>
  dependencies?: Record<string, string[]>
  orders?: Record<string, number>
}

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-queue-'))
  const ctx = new Context()
  const releases: Array<() => void> = []
  const restores: Array<() => void> = []
  const admissions: Promise<unknown>[] = []
  const results: Promise<unknown>[] = []
  let expectedDisposalFailure: unknown
  cleanups.push(async () => {
    for (const release of releases) release()
    await Promise.allSettled(admissions)
    try { await ctx.fiber.dispose() } catch (error) {
      // Only the deliberately injected lease-cleanup failure may escape this fixture's teardown.
      if (error !== expectedDisposalFailure) throw error
    }
    await Promise.allSettled(results)
    for (const restore of restores) restore()
    await rm(root, { recursive: true, force: true })
  })
  for (const [index, id] of IDS.entries()) {
    const filename = join(root, `plans/pieces/00-queue/${id}-queue.md`)
    const source = [
      `# ${id} — Queue fixture`, '',
      `**Set:** 00-queue · **Queue:** ${options.orders?.[id] ?? index + 1} · **Depends on:** ${options.dependencies?.[id]?.join(', ') ?? 'none'}`,
      `**Status:** ${options.statuses?.[id] ?? 'pending'}`,
      '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-queue`',
      ...['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References', 'How to see it',
        'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
        .flatMap(section => ['', `## ${section}`, '', `Fixture material for ${section}.`]), '',
    ].join('\n')
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, source)
  }
  if (options.git) {
    const git = async (...args: string[]) => { await promisify(execFile)('git', args, { cwd: root }) }
    await git('init', '-q')
    await git('config', 'user.name', 'Queue fixture')
    await git('config', 'user.email', 'queue@example.invalid')
    await git('config', 'commit.gpgSign', 'false')
    await git('config', 'core.autocrlf', 'false')
    await git('config', 'core.hooksPath', join(root, '.git', 'no-hooks'))
    await git('add', '--', 'plans')
    await git('commit', '-qm', 'Fixture pieces')
  }
  await mountAgentLoopTestDependencies(ctx)
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(DevLoopDirectory, { root: 'plans/pieces' })
  await ctx.plugin(DevLoopLifecycle)
  const agents = ctx.get('agents')!
  const owner = await agents.create({ sessionId: SessionId('queue-owner'), meta: { cwd: root } })
  let fiber: Fiber | undefined
  if (options.mount !== false) {
    if (options.composition) {
      await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href })
      ctx.loader.builtins.include = Include
      ctx.loader.builtins['queue-fixture'] = DevLoopQueue
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, `- name: cordis:queue-fixture\n  config:\n    maxConcurrency: ${options.maxConcurrency}\n`)
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
    } else {
      fiber = await ctx.plugin(DevLoopQueue, options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency })
    }
  }
  const queue = ctx.get('devLoopQueue')!
  const lifecycle = ctx.get('devLoopLifecycle')!
  const directory = ctx.get('devLoopDirectory')!
  const submit = (pieceId: string, dispatch: QueueRequest['dispatch'], signal = new AbortController().signal, agent = owner.agent) => {
    const admission = agents.withInitiator(agent, () => queue.enqueue({ pieceId, signal, dispatch }))
    const observed = admission.then((ticket) => {
      results.push(ticket.result)
      void ticket.result.catch(() => {})
      return ticket
    })
    void observed.catch(() => {})
    admissions.push(observed)
    return observed
  }
  return { ctx, root, queue, fiber, agents, owner, lifecycle, directory, submit, releases, restores,
    expectDisposalFailure(error: unknown) { expectedDisposalFailure = error } }
}

type Fixture = Awaited<ReturnType<typeof fixture>>

function lease(f: Fixture, id: string, options: { holdStart?: boolean; holdCleanup?: boolean; holdResultOnDispose?: boolean } = {}) {
  const start = deferred<undefined>()
  const started = deferred<undefined>()
  const cleanup = deferred<undefined>()
  const disposing = deferred<undefined>()
  const observed = deferred<undefined>()
  const result = deferred<SubagentResult>()
  if (!options.holdStart) start.resolve(undefined)
  if (!options.holdCleanup) cleanup.resolve(undefined)
  f.releases.push(() => { start.resolve(undefined); cleanup.resolve(undefined); result.resolve(outcome('aborted')) })
  const dispose = vi.fn(() => {
    disposing.resolve(undefined)
    if (!options.holdResultOnDispose) result.resolve(outcome('aborted'))
    return cleanup.promise
  })
  const run: SubagentRun = {
    id: SessionId(`child-${id}`), localAgent: undefined, dispose,
    get result() { observed.resolve(undefined); return result.promise },
  }
  let caller: Agent | undefined
  let initiator: Agent | undefined
  let signal: AbortSignal | undefined
  let reservedBeforeDispatch = false
  const dispatch = vi.fn(async (agent: Agent, operationSignal: AbortSignal) => {
    caller = agent
    initiator = f.agents.currentInitiator()
    signal = operationSignal
    reservedBeforeDispatch = f.queue.getActiveWorkers().some(entry => entry.pieceId === id && entry.status === 'starting')
    started.resolve(undefined)
    await start.promise
    return run
  })
  return { run, dispatch, dispose, start, started, cleanup, disposing, observed, result,
    observation: () => ({ caller, initiator, signal, reservedBeforeDispatch }) }
}

async function started(worker: ReturnType<typeof lease>, ticket: QueueTicket): Promise<void> {
  await Promise.race([worker.started.promise, ticket.result.then(() => {
    throw new Error('ticket settled before dispatch started')
  })])
}

async function finish(worker: ReturnType<typeof lease>, ticket: QueueTicket, value = outcome()): Promise<void> {
  worker.result.resolve(value)
  worker.cleanup.resolve(undefined)
  await ticket.result
}

describe('DevLoopQueue one-shot ownership', () => {
  it.each([undefined, 1, 6, 32])('uses the configured concurrency ceiling (%j)', async (maxConcurrency) => {
    const f = await fixture(maxConcurrency === undefined ? {} : { maxConcurrency })
    expect(f.queue.maxConcurrency).toBe(maxConcurrency ?? 4)
  })

  it.each([0, 33, 1.5])('rejects invalid concurrency %s at mount', async (maxConcurrency) => {
    const f = await fixture({ mount: false })
    await expect(Promise.resolve(f.ctx.plugin(DevLoopQueue, { maxConcurrency })).then(() => undefined)).rejects.toThrow()
  })

  it('uses logical pending state, captures the caller, and reserves before dispatch', async () => {
    const f = await fixture({ statuses: { '00.01': 'todo' } })
    await f.lifecycle.transition('00.01', 'todo', 'pending')
    const worker = lease(f, '00.01', { holdStart: true })
    const ticket = await f.submit('00.01', worker.dispatch)
    await started(worker, ticket)
    const observed = worker.observation()
    expect(observed.reservedBeforeDispatch).toBe(true)
    expect(observed.caller === f.owner.agent).toBe(true)
    expect(observed.initiator === f.owner.agent).toBe(true)
    expect(observed.signal).toBeInstanceOf(AbortSignal)
    expect(ticket.pieceId).toBe('00.01')
    expect(f.queue.getActiveWorkers()).toMatchObject([{ pieceId: '00.01', status: 'starting' }])
    worker.start.resolve(undefined)
    await finish(worker, ticket)
  })

  it.each(['todo', 'blocked', 'done'] as const)('rejects admission in %s state', async (status) => {
    const f = await fixture({ statuses: { '00.01': status } })
    const worker = lease(f, '00.01')
    await expect(f.submit('00.01', worker.dispatch)).rejects.toThrow()
    expect(worker.dispatch).not.toHaveBeenCalled()
  })

  it.each(['piece', 'dependency'])('rejects a missing canonical %s at admission', async (kind) => {
    const f = await fixture(kind === 'dependency' ? { dependencies: { '00.01': ['00.99'] } } : {})
    const worker = lease(f, '00.01')
    await expect(f.submit(kind === 'piece' ? '00.99' : '00.01', worker.dispatch)).rejects.toThrow()
    expect(worker.dispatch).not.toHaveBeenCalled()
  })

  it.each(['absent', 'stale'])('rejects an %s initiating Agent', async (kind) => {
    const f = await fixture()
    const worker = lease(f, '00.01')
    if (kind === 'stale') await f.owner.dispose()
    const admission = kind === 'absent'
      ? f.agents.withoutInitiator(() => f.queue.enqueue({ pieceId: '00.01', signal: new AbortController().signal, dispatch: worker.dispatch }))
      : f.submit('00.01', worker.dispatch)
    await expect(admission).rejects.toThrow()
    expect(worker.dispatch).not.toHaveBeenCalled()
  })

  it('restores a live owned initiator at dispatch while scheduling without the waking caller', async () => {
    const f = await fixture({ maxConcurrency: 1 })
    const child = await f.agents.create({ sessionId: SessionId('owned-initiator'), parentAgent: f.owner.agent })
    const first = lease(f, '00.01')
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', first.dispatch)
    await started(first, one)
    const two = await f.submit('00.02', next.dispatch, undefined, child.agent)
    const seen: Array<Agent | undefined> = []
    const readStatus = f.lifecycle.getStatus.bind(f.lifecycle)
    const hook = vi.spyOn(f.lifecycle, 'getStatus').mockImplementation((id) => {
      seen.push(f.agents.currentInitiator())
      return readStatus(id)
    })
    f.restores.push(() => { hook.mockRestore() })
    f.agents.withInitiator(f.owner.agent, () => { first.result.resolve(outcome()) })
    await started(next, two)
    expect(next.observation().caller === child.agent).toBe(true)
    expect(next.observation().initiator === child.agent).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(agent => agent === undefined)).toBe(true)
    await one.result
    await finish(next, two)
  })

  it.each(['initiator', 'status'])('rechecks queued %s before dispatch', async (kind) => {
    const f = await fixture({ maxConcurrency: 1 })
    const first = lease(f, '00.01')
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', first.dispatch)
    await started(first, one)
    const two = await f.submit('00.02', next.dispatch)
    if (kind === 'initiator') await f.owner.dispose()
    else await f.lifecycle.transition('00.02', 'pending', 'blocked', 'changed during wait')
    await finish(first, one)
    await expect(two.result).rejects.toThrow()
    expect(next.dispatch).not.toHaveBeenCalled()
  })

  it('includes held startup in the default four reservations and returns parked tickets promptly', async () => {
    const f = await fixture()
    const workers = IDS.slice(0, 5).map(id => lease(f, id, { holdStart: true }))
    const tickets: QueueTicket[] = []
    for (const [index, worker] of workers.entries()) tickets.push(await f.submit(IDS[index]!, worker.dispatch))
    for (const [index, worker] of workers.slice(0, 4).entries()) await started(worker, tickets[index]!)
    expect(f.queue.getActiveWorkers()).toHaveLength(4)
    expect(f.queue.getQueuedEntries()).toMatchObject([{ pieceId: '00.05' }])
    expect(workers[4]!.dispatch).not.toHaveBeenCalled()
    workers[0]!.start.resolve(undefined)
    await finish(workers[0]!, tickets[0]!)
    await started(workers[4]!, tickets[4]!)
    for (const [index, worker] of workers.entries()) {
      worker.start.resolve(undefined)
      await finish(worker, tickets[index]!)
    }
  })

  it('selects lower canonical queue numbers then FIFO admission order for ties', async () => {
    const f = await fixture({ maxConcurrency: 1, orders: { '00.02': 20, '00.03': 10, '00.04': 10 } })
    const workers = ['00.01', '00.02', '00.04', '00.03'].map(id => lease(f, id))
    const tickets = []
    for (const [index, id] of ['00.01', '00.02', '00.04', '00.03'].entries()) tickets.push(await f.submit(id, workers[index]!.dispatch))
    await started(workers[0]!, tickets[0]!)
    for (const index of [0, 2, 3, 1]) {
      await started(workers[index]!, tickets[index]!)
      const remaining = [2, 3, 1].slice([0, 2, 3, 1].indexOf(index))
      for (const later of remaining) expect(workers[later]!.dispatch).not.toHaveBeenCalled()
      await finish(workers[index]!, tickets[index]!)
    }
  })

  it('parks an incomplete dependency and wakes after real lifecycle completion', async () => {
    const f = await fixture({ git: true, dependencies: { '00.02': ['00.01'] } })
    const worker = lease(f, '00.02')
    const ticket = await f.submit('00.02', worker.dispatch)
    expect(f.queue.getQueuedEntries()).toMatchObject([{ pieceId: '00.02' }])
    expect(worker.dispatch).not.toHaveBeenCalled()
    await f.lifecycle.transition('00.01', 'pending', 'done', 'dependency verified')
    await started(worker, ticket)
    await finish(worker, ticket)
  })

  it('blocks a dependent request while continuing unrelated eligible work', async () => {
    const f = await fixture({ dependencies: { '00.02': ['00.01'] } })
    const dependent = lease(f, '00.02')
    const independent = lease(f, '00.03')
    const parked = await f.submit('00.02', dependent.dispatch)
    await f.lifecycle.transition('00.01', 'pending', 'blocked', 'dependency unavailable')
    await expect(parked.result).rejects.toThrow()
    expect(f.lifecycle.getStatus('00.02')).toBe('blocked')
    const ticket = await f.submit('00.03', independent.dispatch)
    await started(independent, ticket)
    expect(dependent.dispatch).not.toHaveBeenCalled()
    await finish(independent, ticket)
  })

  it('does not manufacture work from approval or reclaim capacity from unrelated subagent events', async () => {
    const f = await fixture({ maxConcurrency: 1, statuses: { '00.06': 'todo' } })
    await f.lifecycle.transition('00.06', 'todo', 'pending')
    expect(f.queue.getActiveWorkers()).toEqual([])
    expect(f.queue.getQueuedEntries()).toEqual([])
    const first = lease(f, '00.01')
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', first.dispatch)
    await started(first, one)
    const two = await f.submit('00.02', next.dispatch)
    f.ctx.emit('subagent/end', { runId: SubagentRunId('unrelated-epoch'), provider: 'other',
      id: SessionId('unrelated-child'), local: false, stopReason: 'completed' })
    expect(f.queue.getActiveWorkers()).toMatchObject([{ pieceId: '00.01' }])
    expect(next.dispatch).not.toHaveBeenCalled()
    await finish(first, one)
    await started(next, two)
    await finish(next, two)
  })

  it('rejects concurrent duplicate admission but permits another role after settlement', async () => {
    const f = await fixture()
    const first = lease(f, '00.01')
    const duplicate = lease(f, '00.01')
    const admitted = f.submit('00.01', first.dispatch)
    const rejected = f.submit('00.01', duplicate.dispatch)
    const ticket = await admitted
    await expect(rejected).rejects.toThrow()
    await started(first, ticket)
    expect(duplicate.dispatch).not.toHaveBeenCalled()
    await finish(first, ticket)
    const later = await f.submit('00.01', duplicate.dispatch)
    await started(duplicate, later)
    await finish(duplicate, later)
  })

  it.each(['completed', 'aborted', 'error', 'max-tokens', 'refusal'] as const)('returns %s only after lease cleanup', async (stopReason) => {
    const f = await fixture()
    const worker = lease(f, '00.01', { holdCleanup: true })
    const ticket = await f.submit('00.01', worker.dispatch)
    await started(worker, ticket)
    const value = outcome(stopReason)
    worker.result.resolve(value)
    await worker.disposing.promise
    expect(f.queue.getActiveWorkers()).toHaveLength(1)
    worker.cleanup.resolve(undefined)
    await expect(ticket.result).resolves.toEqual(value)
    expect(worker.dispose).toHaveBeenCalledOnce()
    expect(f.queue.getActiveWorkers()).toEqual([])
  })

  it.each(['startup', 'result'])('releases a reservation after %s rejection and completed cleanup', async (phase) => {
    const f = await fixture({ maxConcurrency: 1 })
    const worker = lease(f, '00.01', { holdStart: true })
    const next = lease(f, '00.02')
    const first = await f.submit('00.01', worker.dispatch)
    await started(worker, first)
    const second = await f.submit('00.02', next.dispatch)
    const failure = new Error(`fixture ${phase} failure`)
    if (phase === 'startup') worker.start.reject(failure)
    else { worker.start.resolve(undefined); worker.result.reject(failure) }
    await expect(first.result).rejects.toBe(failure)
    expect(worker.dispose).toHaveBeenCalledTimes(phase === 'startup' ? 0 : 1)
    await started(next, second)
    await finish(next, second)
  })

  it('cancels a queued ticket without calling its dispatch callback', async () => {
    const f = await fixture({ maxConcurrency: 1 })
    const first = lease(f, '00.01')
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', first.dispatch)
    await started(first, one)
    const controller = new AbortController()
    const two = await f.submit('00.02', next.dispatch, controller.signal)
    controller.abort()
    await two.cancel('no longer needed')
    await expect(two.result).rejects.toThrow()
    await finish(first, one)
    expect(next.dispatch).not.toHaveBeenCalled()
    expect(f.queue.getQueuedEntries()).toEqual([])
  })

  it.each(['starting', 'running'])('joins %s cancellation, including a late returned lease, before reusing capacity', async (phase) => {
    const f = await fixture({ maxConcurrency: 1 })
    const worker = lease(f, '00.01', { holdStart: phase === 'starting', holdCleanup: true, holdResultOnDispose: true })
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', worker.dispatch)
    await started(worker, one)
    const two = await f.submit('00.02', next.dispatch)
    if (phase === 'running') await worker.observed.promise
    const cancelled = one.cancel('stop this role')
    const again = one.cancel('idempotent')
    expect(worker.observation().signal?.aborted).toBe(true)
    worker.start.resolve(undefined)
    await worker.disposing.promise
    expect(worker.dispose).toHaveBeenCalledOnce()
    expect(next.dispatch).not.toHaveBeenCalled()
    worker.cleanup.resolve(undefined)
    expect(f.queue.getActiveWorkers()).toHaveLength(1)
    worker.result.resolve(outcome('aborted'))
    await Promise.all([cancelled, again])
    await expect(one.result).rejects.toThrow()
    await started(next, two)
    await finish(next, two)
  })

  it('queue disposal aborts startup, awaits its returned lease, and removes admission', async () => {
    const f = await fixture({ maxConcurrency: 1 })
    const worker = lease(f, '00.01', { holdStart: true, holdCleanup: true })
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', worker.dispatch)
    await started(worker, one)
    const two = await f.submit('00.02', next.dispatch)
    const closed = f.fiber!.dispose()
    worker.start.resolve(undefined)
    await worker.disposing.promise
    expect(worker.observation().signal?.aborted).toBe(true)
    expect(next.dispatch).not.toHaveBeenCalled()
    worker.cleanup.resolve(undefined)
    await closed
    await expect(one.result).rejects.toThrow()
    await expect(two.result).rejects.toThrow()
    await expect(f.submit('00.03', next.dispatch)).rejects.toThrow()
    expect(f.ctx.get('devLoopQueue')).toBeUndefined()
  })

  it('fails closed when lease cleanup rejects rather than dispatching into unproven capacity', async () => {
    const f = await fixture({ maxConcurrency: 1 })
    const worker = lease(f, '00.01', { holdCleanup: true })
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', worker.dispatch)
    await started(worker, one)
    const two = await f.submit('00.02', next.dispatch)
    const failure = new Error('fixture cleanup could not establish quiescence')
    f.expectDisposalFailure(failure)
    worker.result.resolve(outcome())
    await worker.disposing.promise
    worker.cleanup.reject(failure)
    await expect(one.result).rejects.toBe(failure)
    await expect(two.result).rejects.toThrow()
    await expect(f.submit('00.03', next.dispatch)).rejects.toThrow()
    expect(next.dispatch).not.toHaveBeenCalled()
  })

  it('returns detached scalar snapshots with no callback, Agent, or run references', async () => {
    const f = await fixture({ maxConcurrency: 1 })
    const worker = lease(f, '00.01', { holdStart: true })
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', worker.dispatch)
    await started(worker, one)
    const two = await f.submit('00.02', next.dispatch)
    const active = f.queue.getActiveWorkers()
    const queued = f.queue.getQueuedEntries()
    for (const entry of [...active, ...queued]) {
      expect(Object.keys(entry).sort()).toEqual(['enqueuedAt', 'pieceId', 'queueOrder', 'status'])
      expect(Object.values(entry).every(value => typeof value === 'string' || typeof value === 'number')).toBe(true)
      expect(Number.isFinite(entry.enqueuedAt)).toBe(true)
    }
    active[0]!.pieceId = 'changed copy'
    queued[0]!.queueOrder = -1
    expect(f.queue.getActiveWorkers()[0]?.pieceId).toBe('00.01')
    expect(f.queue.getQueuedEntries()[0]?.queueOrder).toBe(2)
    worker.start.resolve(undefined)
    await finish(worker, one)
    await started(next, two)
    await next.observed.promise
    expect(f.queue.getActiveWorkers()).toMatchObject([{ pieceId: '00.02', subagentId: next.run.id }])
    await finish(next, two)
  })

  it('loads YAML with a non-default limit that includes held startup and cleanup', async () => {
    const f = await fixture({ maxConcurrency: 2, composition: true })
    const first = lease(f, '00.01', { holdStart: true, holdCleanup: true })
    const second = lease(f, '00.02', { holdStart: true })
    const third = lease(f, '00.03')
    const one = await f.submit('00.01', first.dispatch)
    const two = await f.submit('00.02', second.dispatch)
    const three = await f.submit('00.03', third.dispatch)
    await started(first, one)
    await started(second, two)
    expect(f.queue.maxConcurrency).toBe(2)
    expect(f.queue.getActiveWorkers()).toHaveLength(2)
    first.start.resolve(undefined)
    first.result.resolve(outcome())
    await first.disposing.promise
    expect(third.dispatch).not.toHaveBeenCalled()
    expect(f.queue.getActiveWorkers()).toHaveLength(2)
    first.cleanup.resolve(undefined)
    await one.result
    await started(third, three)
    second.start.resolve(undefined)
    await finish(second, two)
    await finish(third, three)
  })
})

describe('DevLoopQueue GREEN coverage additions', () => {
  it('rejects Error cancellation and the ticket result with the same lease cleanup error', async () => {
    const f = await fixture()
    const worker = lease(f, '00.01', { holdCleanup: true })
    const ticket = await f.submit('00.01', worker.dispatch)
    await started(worker, ticket)
    await worker.observed.promise
    const reason = new Error('stop this role')
    const failure = new Error('fixture cancellation cleanup failed')
    f.expectDisposalFailure(failure)
    const cancelled = ticket.cancel(reason)
    const cancelRejected = expect(cancelled).rejects.toBe(failure)
    const resultRejected = expect(ticket.result).rejects.toBe(failure)
    await worker.disposing.promise
    expect(worker.observation().signal?.reason).toBe(reason)
    worker.cleanup.reject(failure)
    await Promise.all([cancelRejected, resultRejected])
    expect(worker.dispose).toHaveBeenCalledOnce()
  })

  it('normalizes a parked external signal non-Error abort reason without dispatch', async () => {
    const f = await fixture({ maxConcurrency: 1 })
    const first = lease(f, '00.01')
    const next = lease(f, '00.02')
    const one = await f.submit('00.01', first.dispatch)
    await started(first, one)
    const controller = new AbortController()
    const two = await f.submit('00.02', next.dispatch, controller.signal)
    expect(f.queue.getQueuedEntries()).toMatchObject([{ pieceId: '00.02' }])
    const reason = 'external caller withdrew request'
    controller.abort(reason)
    await expect(two.result).rejects.toBeInstanceOf(Error)
    await expect(two.result).rejects.toHaveProperty('cause', reason)
    await finish(first, one)
    expect(next.dispatch).not.toHaveBeenCalled()
    expect(f.queue.getQueuedEntries()).toEqual([])
  })
})
