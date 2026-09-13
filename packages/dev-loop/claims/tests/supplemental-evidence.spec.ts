/** Decision-scoped negative evidence and freshness of every recorded local identity. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cells, fixture, inventoryRow, pieceId, proof, research, response, sha, signal } from './harness.ts'

const scopedCells = ['Missing is not found in the recorded fixture corpus with the recorded query', ...cells.slice(1)]
const corpusFiles = {
  'corpus-only.txt': 'bounded corpus source\n',
  'export-only.ts': 'export const available = true\n',
}
function scopedNegative() {
  const report = research()
  const finding = report.findings[0]!
  finding.claim = scopedCells[0]!
  finding.claimId = inventoryRow(1, scopedCells).claimId
  finding.kind = 'negative'
  finding.decisionRestingOnClaim = 'Do not call Missing within this exact inspected fixture corpus; make no claim about other providers.'
  finding.evidence = [{ locator: 'tracked.txt', digest: sha('retained evidence\n'),
    query: 'rg --fixed-strings --count-matches Missing tracked.txt corpus-only.txt export-only.ts',
    corpus: { contentManifest: { 'tracked.txt': sha('retained evidence\n'),
      ...Object.fromEntries(Object.entries(corpusFiles).map(([path, text]) => [path, sha(text)])) },
    versions: { 'fixture-dependency': '1.0.0' }, exportEntryPoints: ['export-only.ts'], includedDirectories: ['.'],
    exclusions: ['.git', 'node_modules'], resultCount: 0 },
    resultSummary: 'Not found in this inspected corpus with these queries. This report establishes no universal absence.' }]
  return report
}
async function writeCorpus(repo: string) {
  for (const [path, text] of Object.entries(corpusFiles)) await writeFile(join(repo, path), text)
}

it('admits supported bounded absence when the explicit decision requires only the inspected corpus', async () => {
  const result = scopedNegative()
  await fixture([response(result)], async (f) => {
    await writeCorpus(f.repo)
    const report = await f.verify()
    expect(report.findings[0]!.status).toBe('supported')
    expect(report.findings[0]!.evidence).toEqual(result.findings[0]!.evidence)
    expect(report.findings[0]!.provenance.kind).toBe('reported')
    expect(await f.admit()).toEqual(report)
  }, { proof: proof([scopedCells]) })
})

it('rejects supported negative evidence without an exact query instead of trusting the supported label', async () => {
  const result = scopedNegative()
  delete result.findings[0]!.evidence[0]!.query
  await fixture([response(result)], async (f) => {
    await writeCorpus(f.repo)
    const report = await f.verify()
    expect(report.findings[0]!.status).toBe('unverified')
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { proof: proof([scopedCells]) })
})

it('cannot support an export entry point absent from the explicit content-manifest digest mappings', async () => {
  const result = scopedNegative()
  delete result.findings[0]!.evidence[0]!.corpus!.contentManifest['export-only.ts']
  await fixture([response(result)], async (f) => {
    await writeCorpus(f.repo)
    const report = await f.verify()
    expect(report.findings[0]!.status).toBe('unverified')
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { proof: proof([scopedCells]) })
})

for (const path of ['corpus-only.txt', 'export-only.ts'] as const) {
  it(`invalidates supported corpus evidence when ${path} changes independently of the primary locator`, async () => {
    await fixture([response(scopedNegative())], async (f) => {
      await writeCorpus(f.repo)
      const report = await f.verify()
      expect(await f.admit()).toEqual(report)
      expect(report.findings[0]!.evidence[0]!.locator).not.toBe(path)
      await writeFile(join(f.repo, path), 'changed exact content identity\n')
      await expect(f.admit()).rejects.toThrow('CLAIM_REPORT_STALE')
    }, { proof: proof([scopedCells]) })
  })
}

it('invalidates a reference-only source even when the piece and primary finding evidence remain unchanged', async () => {
  await fixture([response()], async (f) => {
    await writeFile(join(f.repo, 'reference-only.txt'), 'reference context\n')
    const source = f.source.replace('| `tracked.txt` | Parent direct inspection | Retained input |',
      '| `tracked.txt` | Parent direct inspection | Retained input |\n| `reference-only.txt` | Parent direct inspection | Context |')
    await writeFile(f.filename, source)
    const report = await f.verify()
    expect(await f.admit(sha(source))).toEqual(report)
    expect(report.references.entries.some(entry => entry.source === 'reference-only.txt')).toBe(true)
    expect(report.findings.flatMap(finding => finding.evidence).map(evidence => evidence.locator)).not.toContain('reference-only.txt')
    await writeFile(join(f.repo, 'reference-only.txt'), 'changed reference context\n')
    await expect(f.admit(sha(source))).rejects.toThrow('CLAIM_REPORT_STALE')
  }, { realReferences: true })
})

it('rejects newly contradicted References attribution after previously successful admission', async () => {
  await fixture([response()], async (f) => {
    const report = await f.verify()
    expect(await f.admit()).toEqual(report)
    // This typed dependency observation changes without mutating the previously returned detached report.
    f.observation.entries[0]!.attributionStatus = 'contradicted'
    f.observation.entries[0]!.limitations = ['A newly available delegation observation contradicts the asserted identity.']
    await expect(f.claims.requireAdmissible(pieceId, sha(f.source), signal())).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    expect(report.references.entries[0]!.attributionStatus).toBe('unverified')
  })
})
