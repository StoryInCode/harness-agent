/** Accepted long verification lifetimes must not become Node's one-millisecond overflow timeout. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fixture, pieceId, response } from './harness.ts'
import type { ClaimVerificationReport } from '../src/types.ts'

it('completes actual Research with a configured lifetime above the signed 32-bit timer limit', async () => {
  let modelEntered = false
  await fixture([(options) => {
    modelEntered = true
    expect(options.signal?.aborted, 'the long Claims lifetime must still be live at model execution').toBe(false)
    return response()
  }], async (f) => {
    expect(f.config.verificationTimeoutMs).toBe(2_147_483_648)
    const controller = new AbortController()
    const report = await f.verify(controller.signal)
    expect(modelEntered, 'verification must execute actual Research rather than expire during asynchronous setup').toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(report.state).toBe('completed')
    expect(report.limitations).toEqual([])
    expect(f.adapter.requests).toHaveLength(1)
    expect(await f.admit()).toEqual(report)
    const durable = JSON.parse(await readFile(join(f.data, 'dev_loop_claims.json'), 'utf8')) as {
      tables: { reports: Record<string, ClaimVerificationReport> }
    }
    expect(Object.values(durable.tables.reports)).toEqual([report])
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    expect(history).toEqual([expect.objectContaining({ state: 'settled', status: 'completed', cleanup: 'quiescent' })])
    const delegation = history[0]!
    if (delegation.state !== 'settled') throw new Error('long-lifetime Research delegation must settle')
    expect(f.ctx.get('agents')!.get(delegation.subagentSessionId!)).toBeUndefined()
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
  }, { config: { verificationTimeoutMs: 2_147_483_648 } })
})
