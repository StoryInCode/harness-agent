/** Claims cancellation joins actual model cleanup; References observations remain simulated. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { fixture, pieceId } from './harness.ts'
import type { Fixture } from './harness.ts'
import type { ClaimVerificationReport } from '../src/types.ts'

function holdModelCleanup(f: Fixture) {
  const entered = Promise.withResolvers<undefined>()
  const cleaning = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const original = f.adapter.stream.bind(f.adapter)
  const spy = vi.spyOn(f.adapter, 'stream').mockImplementation(async function* (options) {
    try {
      for await (const chunk of original(options)) {
        entered.resolve(undefined)
        yield chunk
      }
    } finally {
      cleaning.resolve(undefined)
      await release.promise
    }
  })
  return { entered, cleaning, release, restore: () => { spy.mockRestore() } }
}

async function expectDurable(f: Fixture, report: ClaimVerificationReport) {
  const persisted = JSON.parse(await readFile(join(f.data, 'dev_loop_claims.json'), 'utf8')) as {
    tables: { reports: Record<string, ClaimVerificationReport> }
  }
  expect(Object.values(persisted.tables.reports)).toContainEqual(report)
}

it('cancellation waits for model cleanup before returning a durable aborted non-admissible report', async () => {
  await fixture(['hang'], async (f) => {
    const model = holdModelCleanup(f)
    const controller = new AbortController()
    const operation = f.verify(controller.signal)
    const settled = operation.then(() => 'settled' as const, () => 'settled' as const)
    try {
      expect(await Promise.race([model.entered.promise.then(() => 'entered'), settled]),
        'verification must enter the actual model before cancellation').toBe('entered')
      controller.abort(new Error('human cancelled verification'))
      expect(await Promise.race([model.cleaning.promise.then(() => 'cleaning'), settled]),
        'verification must join model cleanup rather than return early').toBe('cleaning')
      expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending')
      expect(await f.claims.getReport(pieceId)).toBeUndefined()
      model.release.resolve(undefined)
      const report = await operation
      expect(report.state).toBe('aborted')
      await expectDurable(f, report)
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
      const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({ state: 'settled', status: 'aborted', cleanup: 'quiescent' })
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
      const delegation = history[0]!
      if (delegation.state !== 'settled') throw new Error('cancelled Research delegation must be settled')
      expect(f.ctx.get('agents')!.get(delegation.subagentSessionId!)).toBeUndefined()
    } finally {
      controller.abort(new Error('test cleanup'))
      model.release.resolve(undefined)
      await settled
      model.restore()
    }
  })
})

it('configured timeout cancels an actual hung model and joins cleanup before durable settlement', async () => {
  await fixture(['hang'], async (f) => {
    const model = holdModelCleanup(f)
    const controller = new AbortController()
    const operation = f.verify(controller.signal)
    const settled = operation.then(() => 'settled' as const, () => 'settled' as const)
    try {
      expect(await Promise.race([model.entered.promise.then(() => 'entered'), settled]),
        'verification must reach the model before its configured deadline').toBe('entered')
      expect(await Promise.race([model.cleaning.promise.then(() => 'cleaning'), settled]),
        'timeout must cancel the model and join its held cleanup').toBe('cleaning')
      expect(controller.signal.aborted).toBe(false)
      expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending')
      model.release.resolve(undefined)
      const report = await operation
      expect(['aborted', 'failed']).toContain(report.state)
      expect(report.limitations.join(' ')).toMatch(/timeout|timed out|deadline/i)
      await expectDurable(f, report)
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([
        expect.objectContaining({ state: 'settled', cleanup: 'quiescent' }),
      ])
    } finally {
      controller.abort(new Error('test cleanup'))
      model.release.resolve(undefined)
      await settled
      model.restore()
    }
  }, { config: { verificationTimeoutMs: 10_000 } })
}, 30_000)

it('host disposal waits for admitted verification model cleanup and retains its terminal report for reopen', async () => {
  await fixture(['hang'], async (f) => {
    const model = holdModelCleanup(f)
    const controller = new AbortController()
    const operation = f.verify(controller.signal)
    const settled = operation.then(() => 'settled' as const, () => 'settled' as const)
    let disposal: Promise<unknown> | undefined
    try {
      expect(await Promise.race([model.entered.promise.then(() => 'entered'), settled]),
        'verification must reach the model before host disposal').toBe('entered')
      disposal = Promise.resolve(f.ctx.fiber.dispose())
      const disposed = disposal.then(() => 'disposed' as const)
      expect(await Promise.race([model.cleaning.promise.then(() => 'cleaning'), settled, disposed]),
        'host disposal must cancel and join the admitted model').toBe('cleaning')
      expect(await Promise.race([disposed, Promise.resolve('pending')])).toBe('pending')
      expect(await Promise.race([settled, Promise.resolve('pending')])).toBe('pending')
      model.release.resolve(undefined)
      const report = await operation
      await disposal
      expect(['aborted', 'failed']).toContain(report.state)
      await expectDurable(f, report)
      const reopened = await f.mount()
      const claims = await f.mountClaims(reopened)
      expect(await claims.getReport(pieceId)).toEqual(report)
      expect(reopened.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    } finally {
      controller.abort(new Error('test cleanup'))
      model.release.resolve(undefined)
      await settled
      await disposal
      model.restore()
    }
  })
})

it('retains actual startup cleanup uncertainty as non-admissible rather than supported evidence', async () => {
  await fixture([], async (f) => {
    const controller = new AbortController()
    let published: SessionId | undefined
    f.ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.parentSession !== f.handle.agent.id) return
      published = agent.id
      controller.abort(new Error('cancel at actual child publication'))
    })
    const report = await f.verify(controller.signal)
    expect(published, 'Research must publish an actual child before cancellation').toEqual(expect.any(String))
    expect(['aborted', 'failed']).toContain(report.state)
    expect(report.findings.filter(finding => finding.status === 'supported')).toEqual([])
    expect(report.limitations.join(' ')).toMatch(/cleanup|unproven/i)
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ state: 'settled', status: 'failed', cleanup: 'unproven' })
    expect(report.delegationIds).toEqual([history[0]!.delegationId])
    expect(f.ctx.get('agents')!.get(published!)).toBeUndefined()
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(f.adapter.requests).toEqual([])
    await expectDurable(f, report)
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  })
})
