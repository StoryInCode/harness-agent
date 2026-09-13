/** Evidence identities, bounded negative conclusions and unmeasured assertions. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fixture, research, response, sha } from './harness.ts'
import type { ClaimEvidence } from '../src/types.ts'

for (const missing of ['evidence', 'digest', 'mutable external', 'unexecuted measurement'] as const) {
  it(`cannot support load-bearing premise with ${missing}`, async () => {
    const result = research(); const row = result.findings[0]!
    if (missing === 'evidence') row.evidence = []
    if (missing === 'digest') delete row.evidence[0]!.digest
    if (missing === 'mutable external') { row.kind = 'external'; row.evidence = [{ locator: 'https://example.invalid/latest', resultSummary: 'Unpinned current documentation' }] }
    if (missing === 'unexecuted measurement') { row.kind = 'measurement'; row.status = 'unverified'; row.evidence = []; row.limitations = ['No benchmark executed; throughput is guessed.'] }
    await fixture([response(result)], async (f) => {
      await f.verify()
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    })
  })
}

it('retains immutable external version as reported evidence without making network requests', async () => {
  const result = research(); const row = result.findings[0]!
  row.kind = 'external'
  row.evidence = [{ locator: 'https://example.invalid/spec/2024-01-01', version: '2024-01-01',
    digest: sha('pinned reported source'), resultSummary: 'Reported dated specification supports the scoped design.' }]
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect(report.findings[0]!.evidence).toEqual(row.evidence)
    expect((await f.admit()).reportId).toBe(report.reportId)
    expect(report.findings[0]!.provenance.kind).toBe('reported')
  })
})

const negative = (): ClaimEvidence => ({ locator: 'tracked.txt', digest: sha('retained evidence\n'),
  query: 'rg --count-matches missing tracked.txt', corpus: { contentManifest: { 'tracked.txt': sha('retained evidence\n') },
    versions: {}, exportEntryPoints: [], includedDirectories: ['.'], exclusions: ['node_modules', '.git'], resultCount: 0 },
  resultSummary: 'Not found in this inspected corpus with these queries; no universal absence is established.' })

it('retains complete negative-search corpus without upgrading it to universal absence', async () => {
  const result = research(); const row = result.findings[0]!
  row.kind = 'negative'; row.status = 'unverified'; row.evidence = [negative()]
  row.limitations = ['Decision requires absence across all providers, but inspected corpus contains only tracked.txt.']
  await fixture([response(result)], async (f) => {
    const report = await f.verify()
    expect(report.findings[0]!.evidence).toEqual([negative()])
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  })
})

for (const field of ['contentManifest', 'versions', 'exportEntryPoints', 'includedDirectories', 'exclusions', 'resultCount'] as const) {
  it(`rejects negative-search report missing explicit ${field}`, async () => {
    const result = research(); result.findings[0]!.kind = 'negative'; result.findings[0]!.evidence = [negative()]
    const corpus = { ...result.findings[0]!.evidence[0]!.corpus! }
    Reflect.deleteProperty(corpus, field)
    result.findings[0]!.evidence[0]!.corpus = corpus
    await fixture([response(result)], async (f) => {
      const report = await f.verify()
      expect(report.state).toBe('failed')
      await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    })
  })
}

for (const change of ['package.json', 'pnpm-lock.yaml', 'entry.ts']) {
  it(`invalidates dependency evidence when exact ${change} bytes drift`, async () => {
    const files = { 'package.json': '{"name":"fixture-dependency","version":"1.0.0","exports":"./entry.ts"}\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n', 'entry.ts': 'export const evidence = true\n' }
    const result = research(); const row = result.findings[0]!
    row.kind = 'dependency'; row.evidence = Object.entries(files).map(([name, bytes]) => ({ locator: `dep/${name}`,
      version: '1.0.0', symbol: name === 'entry.ts' ? 'evidence' : name, digest: sha(bytes), resultSummary: 'Installed package/export identity checked.' }))
    await fixture([response(result)], async (f) => {
      await mkdir(join(f.repo, 'dep'))
      for (const [name, bytes] of Object.entries(files)) await writeFile(join(f.repo, 'dep', name), bytes)
      await f.verify()
      await f.admit()
      await writeFile(join(f.repo, 'dep', change), 'identity drift\n')
      await expect(f.admit()).rejects.toThrow('CLAIM_REPORT_STALE')
    })
  })
}
