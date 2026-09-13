/** Whole-outcome JSON validation and full-piece completeness fail closed. */
import { expect, it } from 'vitest'
import { textResponse, maxTokensResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture, research, response, pieceId, proof, cells } from './harness.ts'

const malformed: [string, (value: ReturnType<typeof research>) => unknown][] = [
  ['markdown fence', value => '```json\n' + JSON.stringify(value) + '\n```'],
  ['prefix prose', value => 'Report: ' + JSON.stringify(value)],
  ['two objects', value => JSON.stringify(value) + JSON.stringify(value)],
  ['array root', value => [value]], ['null root', () => null],
  ['unknown root field', value => ({ ...value, allPassed: true })],
  ['missing coverage', value => ({ findings: value.findings, additionalClaims: [] })],
  ['missing additionalClaims', value => ({ inventoryCoverage: value.inventoryCoverage, findings: value.findings })],
  ['unknown coverage field', value => ({ ...value, inventoryCoverage: { ...value.inventoryCoverage, approved: true } })],
  ['missing findings', value => ({ inventoryCoverage: value.inventoryCoverage, additionalClaims: [] })],
  ['empty explicit findings', value => ({ ...value, findings: [] })],
  ['duplicate claim id', value => ({ ...value, findings: [...value.findings, ...value.findings] })],
  ['unknown claim id', value => ({ ...value, findings: [{ ...value.findings[0], claimId: 'claim:' + 'a'.repeat(64) }] })],
  ['invalid claim id', value => ({ ...value, findings: [{ ...value.findings[0], claimId: '../escape' }] })],
  ['rewritten explicit claim', value => ({ ...value, findings: [{ ...value.findings[0], claim: 'Different premise' }] })],
  ['unknown kind', value => ({ ...value, findings: [{ ...value.findings[0], kind: 'guess' }] })],
  ['unknown status', value => ({ ...value, findings: [{ ...value.findings[0], status: 'verified' }] })],
  ['unknown finding field', value => ({ ...value, findings: [{ ...value.findings[0], allPassed: true }] })],
  ['missing loadBearing', (value) => { const { loadBearing: _, ...row } = value.findings[0]!; return { ...value, findings: [row] } }],
  ['missing decision', (value) => { const { decisionRestingOnClaim: _, ...row } = value.findings[0]!; return { ...value, findings: [row] } }],
  ['missing limitations', (value) => { const { limitations: _, ...row } = value.findings[0]!; return { ...value, findings: [row] } }],
  ['unknown evidence field', (value) => { value.findings[0]!.evidence[0] = { ...value.findings[0]!.evidence[0]!, verified: true } as never; return value }],
  ['invalid digest', (value) => { value.findings[0]!.evidence[0]!.digest = 'not-a-sha256'; return value }],
  ['wrong evidence type', (value) => { value.findings[0]!.evidence = 'citation' as never; return value }],
  ['missing evidence locator', (value) => { value.findings[0]!.evidence = [{ resultSummary: 'Trust me' } as never]; return value }],
  ['missing evidence result', (value) => { value.findings[0]!.evidence = [{ locator: 'tracked.txt' } as never]; return value }],
  ['unknown additional field', value => ({ ...value, additionalClaims: [{ claim: 'Omitted', kind: 'repository', loadBearing: true, decisionRestingOnClaim: 'Decision', allPassed: true }] })],
]
for (const [name, mutate] of malformed) {
  it(`retains a failed non-admissible observation for ${name}`, async () => {
    const changed = mutate(research())
    const text = typeof changed === 'string' ? changed : JSON.stringify(changed)
    await fixture([textResponse(text)], async (f) => {
      const report = await f.verify()
      expect(report.state).toBe('failed')
      expect(report.limitations.length).toBeGreaterThan(0)
      expect(await f.claims.getReport(pieceId)).toEqual(report)
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    })
  })
}

for (const kind of ['incomplete assessment', 'omitted load-bearing claim', 'undermining limitation'] as const) {
  it(`cannot authorize handoff with ${kind}`, async () => {
    const report = research()
    if (kind === 'incomplete assessment') report.inventoryCoverage = { complete: false, limitations: ['Full source not assessed.'] }
    if (kind === 'omitted load-bearing claim') report.additionalClaims = [{ claim: 'An omitted premise in Summary', kind: 'repository', loadBearing: true, decisionRestingOnClaim: 'Required API choice' }]
    if (kind === 'undermining limitation') report.findings[0]!.limitations = ['Installed dependency identity was not checked; this decision depends on it.']
    await fixture([response(report)], async (f) => {
      const observed = await f.verify()
      expect(observed.additionalClaims).toEqual(report.additionalClaims)
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toHaveLength(1)
    })
  })
}

for (const body of ['No table was supplied.', '| Claim | Citation |\n|---|---|\n| x | y |',
  '| Claim | Citation | How established | Checked against |\n|---|---|---|---|',
  proof([cells.slice(0, 3)]), '```markdown\n' + proof() + '\n```']) {
  it(`rejects malformed proof structure without empty success: ${JSON.stringify(body)}`, async () => {
    await fixture([], async (f) => {
      await expect(f.verify()).rejects.toThrow(/proof|inventory|claim/i)
      expect(f.adapter.requests).toEqual([])
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    }, { proof: body })
  })
}

it('explicit no-load-bearing declaration needs an explained complete full-source assessment', async () => {
  const report = research(); report.findings = []
  report.inventoryCoverage = { complete: true, limitations: ['Reviewed full piece: this is an editorial index and introduces no product premises.'] }
  await fixture([response(report)], async (f) => {
    const observed = await f.verify()
    expect(observed.inventory).toEqual([])
    expect(observed.inventoryCoverage).toEqual(report.inventoryCoverage)
    expect(await f.admit()).toEqual(observed)
  }, { proof: 'No load-bearing claims.' })
})

it('empty parser plus unexplained model assessment cannot establish no load-bearing claims', async () => {
  const report = research(); report.findings = []
  await fixture([response(report)], async (f) => {
    await f.verify()
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { proof: 'No load-bearing claims.' })
})

it('JSON-looking partial provider output remains failed evidence after actual cleanup', async () => {
  await fixture([maxTokensResponse(JSON.stringify(research()))], async (f) => {
    const report = await f.verify()
    expect(report.state).not.toBe('completed')
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
  })
})
