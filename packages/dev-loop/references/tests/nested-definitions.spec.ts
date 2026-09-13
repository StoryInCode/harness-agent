/** Markdown definitions apply globally even when authored inside an earlier blockquote. */
import { writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { fixture, pieceId, signal, three } from './harness.ts'

it('a reference link resolves the globally visible definition nested in an earlier blockquote', async () => {
  await fixture(three('[evidence]'), async (f) => {
    const initial = await f.setReferences(three('[evidence]'))
    await writeFile(f.filename, initial.replace('Private fixture material for Summary.',
      'Summary of the decision.\n\n> [evidence]: ../../../tracked.txt'))
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation.errors).toEqual([])
    expect(observation.structuralStatus).toBe('valid')
    expect(observation.entries).toHaveLength(1)
    expect(observation.entries[0]).toMatchObject({
      source: '../../../tracked.txt', sourceText: 'evidence', sourceStatus: 'resolved', inspectionStatus: 'unverified',
    })
    expect(observation.entries[0]!.contentSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(await f.references.getProvenance(pieceId)).toEqual(observation)
  })
})
