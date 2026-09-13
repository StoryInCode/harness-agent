/** Authoritative JSON history parsing and chronological tie ordering. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { brief, fixture } from './harness.ts'

it('reopens tied requested and partial settled records without fabricating missing child metadata', async () => {
  await fixture([], async (f) => {
    const firstId = '00000000-0000-4000-8000-000000000001'
    const secondId = '00000000-0000-4000-8000-000000000002'
    const otherId = '00000000-0000-4000-8000-000000000003'
    const base = { ...brief, parentSessionId: 'saved-parent', provider: 'spawn', requestedAt: 1 }
    const requested = { ...base, delegationId: secondId, state: 'requested', verification: {
      claim: 'Stored request claim', decisionRestingOnClaim: 'Stored decision', permittedSources: [], requiredEvidence: ['citation'],
    } }
    const partial = { ...base, delegationId: firstId, state: 'settled', finishedAt: 2,
      status: 'failed', cleanup: 'quiescent', outcome: '', limitations: ['Startup failed before a lease was acquired.'],
      effectivePreset: 'saved-preset', provenance: { kind: 'reported', role: 'Research', preset: 'saved-preset' } }
    const otherPiece = { ...requested, delegationId: otherId, pieceId: '88.88' }
    await f.ctx.fiber.dispose()
    // These are durable parser inputs representing prior observations, not claims that this fixture ran those children.
    await writeFile(join(f.data, 'dev_loop_roles.json'), JSON.stringify({ unit: { name: 'dev_loop_roles', version: 1 }, global: null,
      tables: { delegations: { [secondId]: requested, [otherId]: otherPiece, [firstId]: partial } } }))
    const reopened = await f.mount()
    const records = await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId)
    expect(records).toEqual([partial, requested])
    expect(records[0]).not.toHaveProperty('subagentSessionId')
    expect(records[0]).not.toHaveProperty('worktreeAssignment')
    expect(records[0]).not.toHaveProperty('stopReason')
    expect(records[1]!.state).toBe('requested')
    records[0]!.rationale = 'caller edited its detached copy'
    expect(await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([partial, requested])
    expect(await reopened.get('devLoopRoles')!.getDelegations('88.88')).toEqual([otherPiece])
    expect(f.adapter.requests).toEqual([])
  })
})
