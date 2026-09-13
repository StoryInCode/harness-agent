/** Complete UTF-8 envelopes and count limits; no silent truncation. */
import { expect, it } from 'vitest'
import Claims from '../src/index.ts'
import { fixture, research, response, proof, cells, pieceId } from './harness.ts'
import { researchSchema } from './research-schema.ts'

it('freezes a complete strict Research JSON object independent of the production parser', () => {
  expect(researchSchema.parse(research())).toEqual(research())
  expect(researchSchema.safeParse({ ...research(), allPassed: true }).success).toBe(false)
})

for (const field of ['maxPieceBytes', 'maxClaims', 'maxEvidenceBytes', 'maxReportBytes', 'verificationTimeoutMs'] as const) {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    it(`rejects invalid configured ${field}=${value} before publishing service`, () => {
      expect(() => Claims.Config({ repositoryRoot: '.', maxPieceBytes: 65_536, maxClaims: 32,
        maxEvidenceBytes: 32_768, maxReportBytes: 131_072, verificationTimeoutMs: 10_000, [field]: value })).toThrow()
    })
  }
}

it('rejects piece overflow before Research without pretending Directory buffering is bounded', async () => {
  await fixture([], async (f) => {
    await expect(f.verify()).rejects.toThrow(/piece|byte|large|limit/i)
    expect(f.adapter.requests).toEqual([])
  }, { config: { maxPieceBytes: 100 }, proof: proof([['界'.repeat(100), ...cells.slice(1)]]) })
})

it('rejects more proof rows than maxClaims before starting Research', async () => {
  await fixture([], async (f) => {
    await expect(f.verify()).rejects.toThrow(/claim|count|limit/i)
    expect(f.adapter.requests).toEqual([])
  }, { config: { maxClaims: 1 }, proof: proof([cells, cells]) })
})

it('counts omitted candidates against maxClaims instead of silently dropping them', async () => {
  const result = research(); result.additionalClaims = [{ claim: 'Omitted premise', kind: 'repository', loadBearing: true, decisionRestingOnClaim: 'Critical decision' }]
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect(report.state).toBe('failed')
    expect(report.limitations.length).toBeGreaterThan(0)
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { config: { maxClaims: 1 } })
})

it('rejects multibyte complete evidence overflow instead of clipping a citation', async () => {
  const result = research(); result.findings[0]!.evidence[0]!.resultSummary = '界'.repeat(100)
  const evidence = JSON.stringify(result.findings.flatMap(row => row.evidence))
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect(report.state).toBe('failed')
    expect(report.limitations.length).toBeGreaterThan(0)
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { config: { maxEvidenceBytes: Buffer.byteLength(evidence) - 1 } })
})

it('accepts the exact complete evidence byte limit', async () => {
  const result = research()
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect(report.findings[0]!.evidence).toEqual(result.findings[0]!.evidence)
    expect(await f.admit()).toEqual(report)
  }, { config: { maxEvidenceBytes: Buffer.byteLength(JSON.stringify(result.findings.flatMap(row => row.evidence))) } })
})

it('never returns or retains an oversized terminal report wrapper', async () => {
  await fixture([response()], async (f) => {
    const result = await f.verify().then(report => ({ report }), (error: unknown) => ({ error: String(error) }))
    if ('report' in result) {
      expect(Buffer.byteLength(JSON.stringify(result.report))).toBeLessThanOrEqual(f.config.maxReportBytes)
      expect(result.report.state).toBe('failed')
    } else expect(result.error).toMatch(/report|byte|limit|large/i)
    const retained = await f.claims.getReport(pieceId)
    if (retained) expect(Buffer.byteLength(JSON.stringify(retained))).toBeLessThanOrEqual(f.config.maxReportBytes)
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { config: { maxReportBytes: 1024 } })
})
