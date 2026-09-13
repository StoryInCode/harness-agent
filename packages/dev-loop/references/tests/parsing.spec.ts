/** Authored Markdown profiles remain distinct from epistemic confidence. */
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { fixture, pieceId, signal, three } from './harness.ts'

it('Loader consumer sees structural validity without elevating a direct inspection assertion', async () => {
  await fixture(three('`tracked.txt`'), async (f) => {
    const before = Date.now()
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value).toMatchObject({ pieceId, structuralStatus: 'valid', inspectionStatus: 'unverified', explicitEmpty: false, errors: [] })
    expect(value.checkedAt).toBeGreaterThanOrEqual(before)
    expect(value.checkedAt).toBeLessThanOrEqual(Date.now())
    expect(value.pieceSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(value.entries).toHaveLength(1)
    expect(value.entries[0]).toMatchObject({ row: 1, source: 'tracked.txt', sourceText: 'tracked.txt',
      attribution: 'Parent direct inspection', sourceStatus: 'resolved', attributionStatus: 'unverified', inspectionStatus: 'unverified',
      explanatoryColumns: { 'Decision informed': 'Decision informed by source' },
      contentSha256: createHash('sha256').update('retained evidence\n').digest('hex') })
    expect(value.entries[0]!.limitations.length).toBeGreaterThan(0)
    expect(value.entries[0]).not.toHaveProperty('delegation')
    expect(value).not.toHaveProperty('verified')
    expect(await f.references.getProvenance(pieceId)).toEqual(value)
  })
})

it('canonical five columns retain question, mode and usage with inline Markdown headings', async () => {
  const body = '| **Source** | Role/preset that inspected it | Question it answered | Direct inspection or reported | How it was used |\n'
    + '|---|---|---|---|---|\n| `tracked.txt` | Research, preset not recorded | Does it exist? | Reported | Choose storage |'
  await fixture(body, async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.entries[0]).toMatchObject({ attribution: 'Research, preset not recorded', question: 'Does it exist?',
      inspection: 'Reported', usage: 'Choose storage', explanatoryColumns: {}, attributionStatus: 'unverified' })
  })
})

it.each([
  ['Source | Role/preset and provenance | Decision informed', '`tracked.txt` | Reported by Research | Choose API', 'Reported by Research', { 'Decision informed': 'Choose API' }],
  ['Source | Question answered | Provenance', '`tracked.txt` | Which API? | Parent direct inspection', 'Parent direct inspection', { 'Question answered': 'Which API?' }],
  ['Source | Provenance | Decision informed', '`tracked.txt` | Reported by Utility | Choose API', 'Reported by Utility', { 'Decision informed': 'Choose API' }],
] as const)('authored three-column profile %s preserves absent canonical fields', async (heading, row, attribution, explanatoryColumns) => {
  await fixture(`| ${heading} |\n|---|---|---|\n| ${row} |`, async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.entries[0]).toMatchObject({ attribution, explanatoryColumns })
    expect(value.entries[0]).not.toHaveProperty('question')
    expect(value.entries[0]).not.toHaveProperty('inspection')
    expect(value.entries[0]).not.toHaveProperty('usage')
  })
})

it('four-column authored profile retains role cell separately from provenance', async () => {
  await fixture('| Source | Role/preset | Provenance | Decision informed |\n|---|---|---|---|\n'
    + '| `tracked.txt` | Research, preset not recorded | Reported | Choose API |', async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.entries[0]).toMatchObject({ rolePreset: 'Research, preset not recorded', attribution: 'Reported',
      explanatoryColumns: { 'Decision informed': 'Choose API' } })
  })
})

it('multiple links and escaped pipes in inline code expand locators without splitting prose', async () => {
  await fixture(three('[one](../../../tracked.txt) and `https://example.invalid/a\\|b` and [web](https://example.invalid/doc#part)',
    'Parent direct inspection', 'Choose A \\| B'), async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.entries.map(entry => entry.source)).toEqual(['../../../tracked.txt', 'https://example.invalid/a|b', 'https://example.invalid/doc#part'])
    expect(value.entries.map(entry => entry.sourceStatus)).toEqual(['resolved', 'not-checked', 'not-checked'])
    for (const entry of value.entries) {
      expect(entry.row).toBe(1)
      expect(entry.explanatoryColumns).toEqual({ 'Decision informed': 'Choose A | B' })
      expect(entry.inspectionStatus).toBe('unverified')
    }
  })
})

it('inline code in a link label is display text, not a second source locator', async () => {
  await fixture(three('[`FileSystem.readText`](../../../tracked.txt)'), async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries).toHaveLength(1)
    expect(value.entries[0]).toMatchObject({ source: '../../../tracked.txt', sourceText: 'FileSystem.readText', sourceStatus: 'resolved' })
  })
})

it.each(['None.', 'No references.'])('plain %s is an explicit durable empty declaration', async (body) => {
  await fixture(body, async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value).toMatchObject({ explicitEmpty: true, structuralStatus: 'valid', inspectionStatus: 'unverified', entries: [], errors: [] })
    expect(await f.references.getProvenance(pieceId)).toEqual(value)
  })
})

it.each([
  ['', 'MALFORMED_REFERENCES'],
  ['Maybe none', 'MALFORMED_REFERENCES'],
  ['`None.`', 'MALFORMED_REFERENCES'],
  ['**None.**', 'MALFORMED_REFERENCES'],
  ['| Source | Provenance | Decision informed |\n|---|---|---|', 'MALFORMED_REFERENCES'],
  ['| Source | Provenance | Decision informed |\n|---|---|---|\n| `tracked.txt` | Parent |', 'MALFORMED_REFERENCES'],
  ['| Source | Provenance | Decision informed |\n|---|---|---|\n| `tracked.txt` | Parent | reason | extra |', 'MALFORMED_REFERENCES'],
  ['| Source | Source | Provenance |\n|---|---|---|\n| `tracked.txt` | `tracked.txt` | Parent |', 'INVALID_COLUMNS'],
  ['| Provenance | Source | Decision informed |\n|---|---|---|\n| Parent | `tracked.txt` | reason |', 'INVALID_COLUMNS'],
  ['| Source | Author | Decision informed |\n|---|---|---|\n| `tracked.txt` | Parent | reason |', 'INVALID_COLUMNS'],
  ['| Thing | Provenance | Decision informed |\n|---|---|---|\n| `tracked.txt` | Parent | reason |', 'INVALID_COLUMNS'],
  ['None.\n\n' + three('`tracked.txt`'), 'MALFORMED_REFERENCES'],
] as const)('malformed structure %s is never accepted as empty', async (body, code) => {
  await fixture(body, async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('invalid')
    expect(value.explicitEmpty).toBe(false)
    expect(value.errors.map(error => error.code)).toContain(code)
  })
})

it('References inside a code fence is not a References section', async () => {
  await fixture('None.', async (f) => {
    const content = await f.setReferences('None.')
    await writeFile(f.filename, content.replace('## References\n\nNone.', '## Other\n\n```md\n## References\nNone.\n```'))
    await expect(f.references.verifyReferences(pieceId, signal())).rejects.toMatchObject({ code: 'MISSING_REQUIRED_SECTION' })
    expect(await f.references.getProvenance(pieceId)).toBeUndefined()
  })
})
