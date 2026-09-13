/** Exact source inventory and reported evidence through real Roles/Queue dispatch. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fixture, response, research, inventoryRow, sha, pieceId, proof, cells, signal } from './harness.ts'

it('loads actual dependency behavior independently of the missing Claims implementation', async () => {
  await fixture([response()], async (f) => {
    const observed = await f.ctx.get('devLoopReferences')!.verifyReferences(pieceId, signal())
    expect(observed).toMatchObject({ structuralStatus: 'valid', inspectionStatus: 'unverified' })
    const record = await f.delegate()
    expect(record).toMatchObject({ state: 'settled', status: 'completed', cleanup: 'quiescent', role: 'Research' })
  }, { realReferences: true })
})

it('maps actual proof rows, sends one full-source Research assignment, and preserves reported identity', async () => {
  await fixture([response()], async (f) => {
    const report = await f.verify()
    expect(report.inventory).toEqual([inventoryRow()])
    expect(report.pieceSha256).toBe(sha(f.source))
    expect(report.inventoryDigest).toBe(sha(JSON.stringify(report.inventory)))
    expect(report.referencesDigest).toBe(sha(JSON.stringify(report.references)))
    expect(report.reportId).toMatch(/^[0-9a-f-]{36}$/)
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    expect(history).toHaveLength(1)
    const actual = history[0]!
    expect(actual).toMatchObject({ state: 'settled', role: 'Research', status: 'completed', cleanup: 'quiescent' })
    expect(actual.verification!.permittedSources.length).toBeGreaterThan(0)
    expect(actual.verification!.requiredEvidence.length).toBeGreaterThan(0)
    expect(actual.assignment).toContain(f.source)
    expect(actual.assignment).toContain(report.reportId)
    expect(actual.assignment).toContain(inventoryRow().claimId)
    expect(actual.verification!.claim).toContain(cells[0])
    expect(actual.verification!.decisionRestingOnClaim).not.toBe('')
    expect(actual).not.toHaveProperty('outputSchema')
    expect(report.delegationIds).toEqual([actual.delegationId])
    if (actual.state !== 'settled') throw new Error('Expected settled Research evidence')
    expect(report.findings[0]!.provenance).toEqual({ kind: 'reported', role: 'Research', delegationId: actual.delegationId,
      subagentSessionId: actual.subagentSessionId })
    expect(report.references.entries[0]).toMatchObject({ attributionStatus: 'unverified', inspectionStatus: 'unverified' })
    expect(await f.admit()).toEqual(report)
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(await readFile(f.filename, 'utf8')).toBe(f.source)
  })
})

it('runs the same Loader chain with actual References instead of the isolated observation fixture', async () => {
  await fixture([response()], async (f) => {
    const report = await f.verify()
    expect(report.references).toEqual(await f.ctx.get('devLoopReferences')!.getProvenance(pieceId))
    expect(report.references.entries[0]).toMatchObject({ sourceStatus: 'resolved', attributionStatus: 'unverified', inspectionStatus: 'unverified' })
    expect(await f.admit()).toEqual(report)
  }, { realReferences: true })
})

it('keeps duplicate text rows distinct and escaped-pipe cell text exact', async () => {
  const values = ['A | B', '`tracked.txt`', 'UNVERIFIED', 'fixture source']
  const parsed = [inventoryRow(1, values), inventoryRow(2, values)]
  const result = research()
  result.findings = parsed.map(row => ({ ...result.findings[0]!, claimId: row.claimId, claim: row.claim }))
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect(report.inventory).toEqual(parsed)
    expect(new Set(report.inventory.map(row => row.claimId)).size).toBe(2)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toHaveLength(1)
  }, { proof: proof([['A \\| B', ...values.slice(1)], ['A \\| B', ...values.slice(1)]]) })
})

for (const status of ['contradicted', 'unverified'] as const) {
  it(`${status} load-bearing findings prevent actual Test Writer dispatch`, async () => {
    const result = research(); result.findings[0]!.status = status
    result.findings[0]!.limitations = ['No adequate support for the decision.']
    await fixture([response(result)], async (f) => {
      const report = await f.verify()
      expect(report.findings[0]!.status).toBe(status)
      const author = async () => {
        await f.admit()
        return f.delegate({ pieceId, role: 'Test Writer', assignment: 'Write tests', rationale: 'Author only after admission' })
      }
      await expect(author()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
      expect((await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).map(row => row.role)).toEqual(['Research'])
      expect(await readFile(f.filename, 'utf8')).toBe(f.source)
    })
  })
}

it('discloses non-load-bearing context without converting uncertainty into proved facts', async () => {
  const result = research(); result.findings[0]!.loadBearing = false; result.findings[0]!.status = 'unverified'
  result.findings[0]!.limitations = ['Context only; no product decision rests on it.']
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect((await f.admit()).reportId).toBe(report.reportId)
    expect(report.findings[0]).toMatchObject({ status: 'unverified', loadBearing: false, limitations: result.findings[0]!.limitations })
  })
})

for (const change of ['source', 'evidence', 'caller digest'] as const) {
  it(`rejects stale ${change} identity rather than reusing admission`, async () => {
    await fixture([response()], async (f) => {
      await f.verify()
      if (change === 'source') await writeFile(f.filename, f.source + '\nAmended requirement.\n')
      if (change === 'evidence') await writeFile(join(f.repo, 'tracked.txt'), 'changed evidence\n')
      await expect(f.admit(change === 'caller digest' ? sha('other revision') : sha(f.source))).rejects.toThrow('CLAIM_REPORT_STALE')
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toHaveLength(1)
    })
  })
}

it('refuses contradicted References identity even when the model says supported', async () => {
  await fixture([response()], async (f) => {
    f.observation.entries[0]!.attributionStatus = 'contradicted'
    await f.verify()
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  })
})

it('has no caller proof/pass setter and never admits an unchecked piece', async () => {
  await fixture([], async (f) => {
    for (const method of ['recordProofTable', 'recordProof', 'setAllPassed', 'approve', 'setAdmissible']) expect(f.claims).not.toHaveProperty(method)
    await expect(f.claims.requireAdmissible(pieceId, sha(f.source), signal())).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    expect(f.adapter.requests).toEqual([])
  })
})
