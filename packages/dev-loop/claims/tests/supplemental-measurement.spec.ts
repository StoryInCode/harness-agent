/** Structured reported measurements require an identified log and explicit execution assertion. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cells, fixture, inventoryRow, proof, research, response, sha } from './harness.ts'
import { supplementalResearchSchema } from './supplemental-research-schema.ts'

const log = 'fixture benchmark; environment=fixture-v1; samples=100; elapsedMs=40\n'
const measuredCells = ['The recorded fixture-v1 run processed 100 samples in 40 milliseconds', ...cells.slice(1)]
function measurementReport() {
  const report = research()
  const finding = report.findings[0]!
  finding.claim = measuredCells[0]!
  finding.claimId = inventoryRow(1, measuredCells).claimId
  finding.kind = 'measurement'
  finding.decisionRestingOnClaim = 'Document this historical fixture-v1 measurement only; do not promise current performance.'
  finding.evidence = [{ locator: 'measurement.log', digest: sha(log), resultSummary: 'Reported historical run, scoped to its recorded environment.',
    measurement: { command: 'node fixture-benchmark.mjs --samples=100', environment: { runtime: 'fixture-v1', platform: 'recorded-linux' },
      recordedAt: 1_700_000_000_000, result: '100 samples completed in 40 milliseconds', reportedExecution: 'executed' } }]
  return report
}

it('admits a scoped supported reported measurement without claiming the owner executed it', async () => {
  const result = measurementReport()
  expect(supplementalResearchSchema.parse(result)).toEqual(result)
  await fixture([response(result)], async (f) => {
    await writeFile(join(f.repo, 'measurement.log'), log)
    const report = await f.verify()
    expect(report.state).toBe('completed')
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]!.status).toBe('supported')
    expect(report.findings[0]!.evidence).toEqual(result.findings[0]!.evidence)
    expect(report.findings[0]!.provenance.kind).toBe('reported')
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(report.pieceId)
    expect(history).toHaveLength(1)
    const instruction = history[0]!.assignment + JSON.stringify(history[0]!.verification)
    expect(instruction).toContain('reportedExecution')
    expect(instruction).toContain('recordedAt')
    expect(await f.admit()).toEqual(report)
    await writeFile(join(f.repo, 'measurement.log'), log + 'changed recorded result\n')
    await expect(f.admit()).rejects.toThrow('CLAIM_REPORT_STALE')
  }, { proof: proof([measuredCells]) })
})

for (const missing of ['not-executed', 'metadata', 'log digest', 'log file'] as const) {
  it(`cannot admit a supported-label measurement with ${missing}`, async () => {
    const result = measurementReport()
    const evidence = result.findings[0]!.evidence[0]!
    if (missing === 'not-executed') evidence.measurement!.reportedExecution = 'not-executed'
    if (missing === 'metadata') delete evidence.measurement
    if (missing === 'log digest') delete evidence.digest
    await fixture([response(result)], async (f) => {
      if (missing !== 'log file') await writeFile(join(f.repo, 'measurement.log'), log)
      const report = await f.verify()
      expect(report.state).toBe('completed')
      expect(report.findings[0]!.status).toBe('unverified')
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    }, { proof: proof([measuredCells]) })
  })
}

for (const invalid of ['empty command', 'empty environment', 'empty environment value', 'fractional time', 'negative time',
  'missing result', 'unknown execution', 'unknown field'] as const) {
  it(`records failed observation for structured measurement JSON with ${invalid}`, async () => {
    const result = measurementReport()
    const metadata = result.findings[0]!.evidence[0]!.measurement!
    if (invalid === 'empty command') metadata.command = ''
    if (invalid === 'empty environment') metadata.environment = {}
    if (invalid === 'empty environment value') metadata.environment = { platform: '' }
    if (invalid === 'fractional time') metadata.recordedAt = 0.5
    if (invalid === 'negative time') metadata.recordedAt = -1
    if (invalid === 'missing result') Reflect.deleteProperty(metadata, 'result')
    if (invalid === 'unknown execution') Reflect.set(metadata, 'reportedExecution', 'verified')
    if (invalid === 'unknown field') Reflect.set(metadata, 'allPassed', true)
    expect(supplementalResearchSchema.safeParse(result).success).toBe(false)
    await fixture([response(result)], async (f) => {
      await writeFile(join(f.repo, 'measurement.log'), log)
      const report = await f.verify()
      expect(report.state).toBe('failed')
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    }, { proof: proof([measuredCells]) })
  })
}
