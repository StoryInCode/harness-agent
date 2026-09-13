/** Exact piece-scoped report identity is weaker than observed source usage. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { DelegationId, DelegationRecord, SettledDelegation } from '@deepseek-ai/dsh-dev-loop-roles'
import { expect, it, vi } from 'vitest'
import { fixture, pieceId, signal, three } from './harness.ts'
import type { Fixture } from './harness.ts'

const id = () => brandString<DelegationId>(randomUUID())
function settled(overrides: Partial<SettledDelegation> = {}): SettledDelegation {
  return { delegationId: id(), pieceId, role: 'Research', assignment: 'Inspect source', rationale: 'Choose API',
    parentSessionId: SessionId('parent-record'), provider: 'spawn', requestedAt: 1000, state: 'settled', finishedAt: 2000,
    subagentSessionId: SessionId('actual-child'), status: 'completed', cleanup: 'quiescent', outcome: 'I inspected it.',
    limitations: [], provenance: { kind: 'reported', role: 'Research' }, ...overrides }
}
async function retain(f: Fixture, record: DelegationRecord) {
  await f.ctx.get('storageDomain')!.get('dev_loop_roles')!.table('delegations').put(record.delegationId, record)
}

it('real lying child report links exact identity but never verifies cited source inspection', async () => {
  await fixture('None.', async (f) => {
    const report = await f.delegate()
    expect(report.status).toBe('completed')
    expect(report.outcome).toContain('deliberately unsupported')
    await f.setReferences(three('`tracked.txt`', `role:Research delegation:${report.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.inspectionStatus).toBe('unverified')
    expect(value.entries[0]).toMatchObject({ sourceStatus: 'resolved', attributionStatus: 'linked-report', inspectionStatus: 'unverified',
      delegation: { delegationId: report.delegationId, pieceId, subagentSessionId: report.subagentSessionId, role: 'Research', status: 'completed', limitations: [] } })
    expect(value.entries[0]!.delegation).not.toHaveProperty('preset')
    expect(value.entries[0]!.limitations.length).toBeGreaterThan(0)
  })
})
it('human prose naming a historical role does not select the newest report', async () => {
  await fixture(three('`tracked.txt`', 'Reported by Research, preset not recorded; opened everything'), async (f) => {
    await retain(f, settled())
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]!.attributionStatus).toBe('unverified')
    expect(value.entries[0]).not.toHaveProperty('delegation')
  })
})
it('exact id selects an older report rather than another latest record', async () => {
  await fixture('None.', async (f) => {
    const old = settled({ effectivePreset: 'actual', provenance: { kind: 'reported', role: 'Research', preset: 'actual' } })
    await retain(f, old)
    await retain(f, settled({ requestedAt: 3000, finishedAt: 4000, role: 'Utility', provenance: { kind: 'reported', role: 'Utility' } }))
    await f.setReferences(three('`tracked.txt`', `role:Research preset:actual delegation:${old.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ attributionStatus: 'linked-report', delegation: { delegationId: old.delegationId, role: 'Research', preset: 'actual' } })
  })
})
it.each(['role:Utility', 'preset:requested-other'])('visible identity mismatch %s is contradicted independently of existing source', async (assertion) => {
  await fixture('None.', async (f) => {
    const record = settled({ effectivePreset: 'actual', provenance: { kind: 'reported', role: 'Research', preset: 'actual' } })
    await retain(f, record)
    await f.setReferences(three('`tracked.txt`', `${assertion} delegation:${record.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.entries[0]).toMatchObject({ sourceStatus: 'resolved', attributionStatus: 'contradicted', inspectionStatus: 'unverified',
      delegation: { role: 'Research', preset: 'actual' } })
  })
})
it('an entire canonical role cell is a role assertion in the four-column profile', async () => {
  await fixture('None.', async (f) => {
    const record = settled()
    await retain(f, record)
    await f.setReferences(`| Source | Role/preset | Provenance | Decision informed |\n|---|---|---|---|\n| \`tracked.txt\` | Utility | delegation:${record.delegationId} | Choose API |`)
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ rolePreset: 'Utility', attributionStatus: 'contradicted', delegation: { role: 'Research' } })
  })
})
it('asserted preset with no actual preset is unavailable, not contradicted or filled from prose', async () => {
  await fixture('None.', async (f) => {
    const record = settled()
    await retain(f, record)
    await f.setReferences(three('`tracked.txt`', `preset:requested delegation:${record.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]!.attributionStatus).toBe('unverified')
    expect(value.entries[0]!.delegation).not.toHaveProperty('preset')
  })
})
it.each(['failed', 'aborted'] as const)('partial %s report retains terminal status and limitations', async (status) => {
  await fixture('None.', async (f) => {
    const record = settled({ status, limitations: ['Partial report; cleanup unavailable'], cleanup: 'unproven' })
    await retain(f, record)
    await f.setReferences(three('`tracked.txt`', `delegation:${record.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ attributionStatus: 'linked-report', inspectionStatus: 'unverified',
      delegation: { status, limitations: record.limitations } })
  })
})
it('requested-only residue is not an executed report', async () => {
  await fixture('None.', async (f) => {
    const requested: DelegationRecord = { delegationId: id(), pieceId, role: 'Research', assignment: 'Inspect', rationale: 'Decide',
      parentSessionId: SessionId('parent'), provider: 'spawn', requestedAt: 1000, state: 'requested' }
    await retain(f, requested)
    await f.setReferences(three('`tracked.txt`', `delegation:${requested.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]!.attributionStatus).toBe('unverified')
    expect(value.entries[0]).not.toHaveProperty('delegation')
  })
})
it('settlement without actual child identity is not a linked report', async () => {
  await fixture('None.', async (f) => {
    const record = settled()
    delete record.subagentSessionId
    await retain(f, record)
    await f.setReferences(three('`tracked.txt`', `delegation:${record.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]!.attributionStatus).toBe('unverified')
    expect(value.entries[0]).not.toHaveProperty('delegation')
  })
})
it.each([false, true])('unavailable id from other piece=%s remains unverified without cross-piece enumeration', async (otherPiece) => {
  await fixture('None.', async (f) => {
    const record = settled({ pieceId: '00.99' })
    if (otherPiece) await retain(f, record)
    await f.setReferences(three('`tracked.txt`', `delegation:${record.delegationId}`))
    const history = vi.spyOn(f.ctx.get('devLoopRoles')!, 'getDelegations')
    try {
      const value = await f.references.verifyReferences(pieceId, signal())
      expect(value.entries[0]!.attributionStatus).toBe('unverified')
      expect(value.entries[0]).not.toHaveProperty('delegation')
      expect(history.mock.calls.every(([requested]) => requested === pieceId)).toBe(true)
    } finally { history.mockRestore() }
  })
})
it.each(['not-a-uuid', '123', '00000000-0000-4000-8000-000000000000suffix', ''])('malformed exact delegation id %s fails parser rather than prefix-matching', async (invalid) => {
  await fixture(three('`tracked.txt`', `delegation:${invalid}`), async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('invalid')
    expect(value.errors.map(error => error.code)).toContain('INVALID_DELEGATION_ID')
    expect(value.entries[0]!.attributionStatus).toBe('unverified')
  })
})
it('missing source and linked report are independent observations, not proof of historical fabrication', async () => {
  await fixture('None.', async (f) => {
    const record = settled()
    await retain(f, record)
    await f.setReferences(three('`removed.txt`', `delegation:${record.delegationId}`))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ sourceStatus: 'missing', attributionStatus: 'linked-report', inspectionStatus: 'unverified' })
    expect(value.errors.map(error => error.code)).toContain('SOURCE_MISSING')
    expect(JSON.stringify(value)).not.toMatch(/"(?:fabricated|verified)":true/)
  })
})
