/** Real JSON commit/reopen failures and model-barrier admission, with simulated References observations. */
import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { ClaimVerificationReport } from '../src/types.ts'
import { fixture, pieceId, response, sha, signal } from './harness.ts'

interface ClaimsFile {
  unit: { name: string; version: number }
  tables: { attempts: Record<string, unknown>; reports: Record<string, ClaimVerificationReport> }
}

const decode = (text: string) => JSON.parse(text) as ClaimsFile
const filename = (data: string) => join(data, 'dev_loop_claims.json')

it('commits intent before the model and the complete terminal report before verify returns', async () => {
  let inspectIntent: () => void = () => { throw new Error('fixture not initialized') }
  let intent: ClaimsFile | undefined
  await fixture([() => { inspectIntent(); return response() }], async (f) => {
    inspectIntent = () => {
      intent = decode(readFileSync(filename(f.data), 'utf8'))
      expect(intent.unit).toEqual({ name: 'dev_loop_claims', version: 1 })
      expect(Object.values(intent.tables.attempts)).toHaveLength(1)
      expect(Object.values(intent.tables.reports)).toEqual([])
    }
    const report = await f.verify()
    expect(intent, 'Research must observe a committed Claims intent').toBeDefined()
    expect(report.state).toBe('completed')
    const durable = decode(await readFile(filename(f.data), 'utf8'))
    expect(Object.values(durable.tables.reports)).toEqual([report])
    expect(await f.claims.getReport(pieceId)).toEqual(report)
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    for (const finding of report.findings) {
      expect(f.ctx.get('agents')!.get(finding.provenance.subagentSessionId)).toBeUndefined()
    }
  })
})

it('reopens the exact report and detaches nested values returned by verify, getReport and admission', async () => {
  await fixture([response()], async (f) => {
    const result = await f.verify()
    const expected = structuredClone(result)
    result.findings[0]!.evidence[0]!.resultSummary = 'caller mutation'
    result.references.entries[0]!.limitations = [...result.references.entries[0]!.limitations, 'caller mutation']
    result.inventoryCoverage.limitations.push('caller mutation')
    expect(await f.claims.getReport(pieceId)).toEqual(expected)
    await f.ctx.fiber.dispose()
    const reopened = await f.mount()
    const claims = await f.mountClaims(reopened)
    const read = await claims.getReport(pieceId)
    expect(read).toEqual(expected)
    read!.inventory[0]!.claim = 'caller mutation'
    read!.delegationIds.length = 0
    expect(await claims.getReport(pieceId)).toEqual(expected)
    const admitted = await claims.requireAdmissible(pieceId, sha(f.source), signal())
    expect(admitted).toEqual(expected)
    admitted.findings[0]!.limitations.push('caller mutation')
    expect(await claims.getReport(pieceId)).toEqual(expected)
    expect(reopened.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
  })
})

it('blocks absent report admission after reopen without dispatching Research', async () => {
  await fixture([], async (f) => {
    await f.ctx.fiber.dispose()
    const reopened = await f.mount()
    const claims = await f.mountClaims(reopened)
    expect(await claims.getReport(pieceId)).toBeUndefined()
    await expect(claims.requireAdmissible(pieceId, sha(f.source), signal())).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    expect(await reopened.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
    expect(reopened.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(f.adapter.requests).toEqual([])
  })
})

it('reopens an incomplete durable intent as unresolved and never retries Research automatically', async () => {
  let captureIntent: () => void = () => { throw new Error('fixture not initialized') }
  let intent = ''
  await fixture([() => { captureIntent(); return response() }], async (f) => {
    captureIntent = () => { intent = readFileSync(filename(f.data), 'utf8') }
    await f.verify()
    expect(intent, 'Research must leave replayable durable intent bytes').not.toBe('')
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    await f.ctx.fiber.dispose()
    await writeFile(filename(f.data), intent)
    const reopened = await f.mount()
    const claims = await f.mountClaims(reopened)
    expect(await claims.getReport(pieceId)).toBeUndefined()
    await expect(claims.requireAdmissible(pieceId, sha(f.source), signal())).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    expect(await reopened.get('devLoopRoles')!.getDelegations(pieceId)).toEqual(history)
    expect(await readFile(filename(f.data), 'utf8')).toBe(intent)
    expect(reopened.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(f.adapter.requests).toHaveLength(1)
  })
})

it.each(['attempts', 'reports'] as const)('rejects malformed authoritative %s records on reopen', async (table) => {
  await fixture([], async (f) => {
    await f.ctx.fiber.dispose()
    await mkdir(f.data, { recursive: true })
    await writeFile(filename(f.data), JSON.stringify({ unit: { name: 'dev_loop_claims', version: 1 }, global: null,
      tables: { attempts: {}, reports: {}, [table]: { invalid: { pieceId, state: 'completed', reportId: '../invalid', allPassed: true } } } }))
    const reopened = await f.mount()
    await expect(f.mountClaims(reopened)).rejects.toThrow(/invalid|record|schema/i)
    expect(f.adapter.requests).toEqual([])
  })
})

it('rejects an initial backend write failure before Roles intent, Queue admission or model execution', async () => {
  await fixture([], async (f) => {
    await mkdir(filename(f.data), { recursive: true })
    await expect(f.verify()).rejects.toThrow()
    expect(await f.claims.getReport(pieceId)).toBeUndefined()
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
  })
})

it('rejects terminal write failure without publishing a report and reopens the prior unresolved intent', async () => {
  let failTerminal: () => void = () => { throw new Error('fixture not initialized') }
  await fixture([() => { failTerminal(); return response() }], async (f) => {
    const file = filename(f.data)
    const saved = join(f.data, 'claims-intent.json')
    failTerminal = () => { renameSync(file, saved); mkdirSync(file) }
    await expect(f.verify()).rejects.toThrow()
    expect(f.adapter.requests, 'terminal failure must occur after actual Research execution').toHaveLength(1)
    expect(await f.claims.getReport(pieceId)).toBeUndefined()
    expect(Object.values(decode(await readFile(saved, 'utf8')).tables.reports)).toEqual([])
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ state: 'settled', cleanup: 'quiescent' })
    await f.ctx.fiber.dispose()
    await rm(file, { recursive: true })
    await rename(saved, file)
    const reopened = await f.mount()
    const claims = await f.mountClaims(reopened)
    expect(await claims.getReport(pieceId)).toBeUndefined()
    await expect(claims.requireAdmissible(pieceId, sha(f.source), signal())).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    expect(await reopened.get('devLoopRoles')!.getDelegations(pieceId)).toEqual(history)
  })
})

it('excludes overlapping same-piece verification before another intent and releases admission after joined cleanup', async () => {
  await fixture([response(), response()], async (f) => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = f.adapter.stream.bind(f.adapter)
    const stream = vi.spyOn(f.adapter, 'stream').mockImplementation(async function* (options) {
      const iterator = original(options)[Symbol.asyncIterator]()
      try {
        const first = await iterator.next()
        entered.resolve(undefined)
        await release.promise
        if (!first.done) yield first.value
        for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value
      } finally { await iterator.return?.() }
    })
    const controller = new AbortController()
    const pending = f.verify(controller.signal)
    const settled = pending.then(() => 'settled' as const, () => 'settled' as const)
    try {
      expect(await Promise.race([entered.promise.then(() => 'model-entered' as const), settled]),
        'first verification must reach the model barrier before settling').toBe('model-entered')
      const before = await readFile(filename(f.data), 'utf8')
      await expect(f.verify()).rejects.toThrow()
      expect(await readFile(filename(f.data), 'utf8')).toBe(before)
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toHaveLength(1)
      expect(f.adapter.requests).toHaveLength(1)
      release.resolve(undefined)
      await pending
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
      stream.mockRestore()
      await f.verify()
      expect(f.adapter.requests).toHaveLength(2)
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toHaveLength(2)
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    } finally {
      controller.abort(new Error('test cleanup'))
      release.resolve(undefined)
      await settled
      stream.mockRestore()
    }
  })
})
