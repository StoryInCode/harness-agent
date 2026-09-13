/** Startup rejection cannot prove disposal of a lease the consumer never received. */
import { expect, it } from 'vitest'
import { fixture, policy } from './harness.ts'

it('records cleanup unproven when actual provider startup rejects before returning its lease', async () => {
  const config = policy()
  config.roles.Research.maxDepth = 0
  await fixture([], async (f) => {
    const record = await f.delegate()
    expect(record.worktreeAssignment?.worktreePath).toEqual(expect.any(String))
    expect(record.subagentSessionId).toBeUndefined()
    expect(record.limitations.join(' ')).toMatch(/depth/i)
    expect(f.adapter.requests).toEqual([])
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(record).toMatchObject({ state: 'settled', status: 'failed', cleanup: 'unproven' })
    expect(await f.ctx.get('devLoopRoles')!.getDelegations('00.06')).toEqual([record])
  }, config)
})
