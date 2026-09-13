/** Different-piece Claims operations share real Queue capacity and real References observations. */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import type { ClaimId } from '../src/types.ts'
import { cells, fixture, pieceId, research, response, sha } from './harness.ts'

const secondId = '00.07'
const claimIdFor = (id: string) => `claim:${sha(JSON.stringify([id, 1, ...cells]))}` as ClaimId

function requestPiece(options: GenerateOptions): string {
  const text = options.messages.flatMap(message => message.content)
    .filter(block => block.type === 'text').map(block => block.text).join('\n')
  const matches = [pieceId, secondId].filter(id => text.includes(claimIdFor(id)))
  expect(matches, 'Research assignment must identify exactly one complete piece inventory').toHaveLength(1)
  expect(text).toContain(matches[0]!)
  return matches[0]!
}

it('runs different pieces concurrently at Queue capacity two while excluding another request for either active piece', async () => {
  const answer = (options: GenerateOptions) => {
    const report = research()
    report.findings[0]!.claimId = claimIdFor(requestPiece(options))
    return response(report)
  }
  await fixture([answer, answer], async (f) => {
    const secondFile = join(f.repo, 'plans/pieces/00-dev-loop/00.07-role.md')
    const secondSource = f.source.replaceAll(pieceId, secondId).replace('**Queue:** 6', '**Queue:** 7')
    await writeFile(secondFile, secondSource)
    // Roles allocates detached checkouts: both complete piece sources must belong to their shared Git inventory first.
    const git = (...args: string[]) => promisify(execFile)('git', args, { cwd: f.repo, timeout: 20_000, maxBuffer: 128_000,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(f.repo, 'absent-config'),
        GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined } })
    await git('add', '--', f.filename, secondFile)
    await git('-c', 'user.name=Claims fixture', '-c', 'user.email=claims@example.invalid', '-c', 'commit.gpgSign=false',
      '-c', `core.hooksPath=${join(f.repo, 'no-hooks')}`, 'commit', '-qm', 'Complete concurrent fixture inventory')
    // Lifecycle snapshots piece ids during mount, before any Queue admission uses its synchronous status view.
    await f.ctx.fiber.dispose()
    const ctx = await f.mount()
    ctx.get('llm')!.registerAdapter(['mock'], f.adapter)
    const claims = await f.mountClaims(ctx)
    const handle = await ctx.get('agents')!.create({ sessionId: SessionId('concurrent-brain'), meta: { cwd: f.repo },
      agentOptions: { provider: 'mock', model: 'mock' } })
    expect((await ctx.get('devLoopDirectory')!.getPiece(secondId)).id).toBe(secondId)
    expect(ctx.get('devLoopLifecycle')!.getStatus(secondId)).toBe('pending')
    const barriers = new Map([pieceId, secondId].map(id => [id, {
      entered: Promise.withResolvers<undefined>(), release: Promise.withResolvers<undefined>(),
    }]))
    const original = f.adapter.stream.bind(f.adapter)
    const stream = vi.spyOn(f.adapter, 'stream').mockImplementation(async function* (options) {
      const iterator = original(options)[Symbol.asyncIterator]()
      try {
        const first = await iterator.next()
        const barrier = barriers.get(requestPiece(options))!
        barrier.entered.resolve(undefined)
        await barrier.release.promise
        if (!first.done) yield first.value
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value
      } finally { await iterator.return?.() }
    })
    const controller = new AbortController()
    const verify = (id: string) => ctx.get('agents')!.withInitiator(handle.agent,
      () => claims.verifyPieceClaims(id, controller.signal))
    const first = verify(pieceId)
    const firstSettled = first.then(() => 'first-settled', () => 'first-settled')
    let second: ReturnType<typeof verify> | undefined
    let secondSettled: Promise<string> | undefined
    try {
      expect(await Promise.race([barriers.get(pieceId)!.entered.promise.then(() => 'entered'), firstSettled]),
        'first piece must enter the model before settling').toBe('entered')
      second = verify(secondId)
      let secondObservation: unknown
      secondSettled = second.then((report) => { secondObservation = report; return 'second-settled' },
        (error: unknown) => { secondObservation = String(error); return 'second-settled' })
      const arrival = await Promise.race([barriers.get(secondId)!.entered.promise.then(() => 'entered'), firstSettled, secondSettled])
      expect(arrival, `second piece must enter its model while the first model remains held; observation=${JSON.stringify(secondObservation)}`)
        .toBe('entered')
      expect(ctx.get('devLoopQueue')!.getActiveWorkers()).toHaveLength(2)
      expect(f.adapter.requests).toHaveLength(2)
      for (const id of [pieceId, secondId]) {
        expect(await ctx.get('devLoopRoles')!.getDelegations(id)).toHaveLength(1)
      }
      const file = join(f.data, 'dev_loop_claims.json')
      const before = await readFile(file, 'utf8')
      const intent = JSON.parse(before) as { tables: { attempts: Record<string, unknown>; reports: Record<string, unknown> } }
      expect(Object.values(intent.tables.attempts)).toHaveLength(2)
      expect(Object.values(intent.tables.reports)).toEqual([])
      for (const id of [pieceId, secondId]) await expect(verify(id)).rejects.toThrow()
      expect(await readFile(file, 'utf8')).toBe(before)
      expect(f.adapter.requests).toHaveLength(2)
      for (const id of [pieceId, secondId]) {
        expect(await ctx.get('devLoopRoles')!.getDelegations(id)).toHaveLength(1)
        barriers.get(id)!.release.resolve(undefined)
      }
      const reports = await Promise.all([first, second])
      expect(reports.map(report => report.pieceId)).toEqual([pieceId, secondId])
      for (const report of reports) {
        expect(report.state).toBe('completed')
        expect(report.findings[0]!.claimId).toBe(claimIdFor(report.pieceId))
        expect(await claims.getReport(report.pieceId)).toEqual(report)
        const history = await ctx.get('devLoopRoles')!.getDelegations(report.pieceId)
        expect(history).toEqual([expect.objectContaining({ state: 'settled', cleanup: 'quiescent' })])
        const record = history[0]!
        if (record.state !== 'settled') throw new Error('concurrent Research delegation must settle')
        expect(ctx.get('agents')!.get(record.subagentSessionId!)).toBeUndefined()
      }
      expect(ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    } finally {
      controller.abort(new Error('test cleanup'))
      for (const barrier of barriers.values()) barrier.release.resolve(undefined)
      await Promise.all([firstSettled, secondSettled])
      stream.mockRestore()
      await handle.dispose()
    }
  }, { queueConcurrency: 2, realReferences: true })
})
