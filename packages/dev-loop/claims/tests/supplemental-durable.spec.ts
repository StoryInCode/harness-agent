/** Single-field corruption of otherwise genuine durable reports must never authorize admission. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { fixture, pieceId, response, sha, signal } from './harness.ts'

const corruptions = [
  { name: 'valid-format wrong evidence SHA', anchor: '"findings"', key: 'digest', value: sha('different evidence') },
  { name: 'valid-format wrong nested References SHA', anchor: '"references"', key: 'contentSha256', value: sha('different reference') },
  { name: 'changed finding claim text', anchor: '"findings"', key: 'claim', value: 'A different load-bearing claim' },
  { name: 'valid-format wrong finding claim id', anchor: '"findings"', key: 'claimId', value: `claim:${sha('different claim')}` },
  { name: 'unknown nested evidence field', anchor: '"findings"', key: 'resultSummary', value: undefined },
] as const

it.each(corruptions)('rejects $name after reopening an otherwise unchanged actual backend report', async (corruption) => {
  await fixture([response()], async (f) => {
    const report = await f.verify()
    expect(report.state).toBe('completed')
    expect(await f.admit()).toEqual(report)
    const file = join(f.data, 'dev_loop_claims.json')
    const captured = await readFile(file, 'utf8')
    await f.ctx.fiber.dispose()

    const reportsStart = captured.indexOf('"reports"')
    expect(reportsStart).toBeGreaterThanOrEqual(0)
    const anchor = captured.indexOf(corruption.anchor, reportsStart)
    expect(anchor).toBeGreaterThan(reportsStart)
    const field = new RegExp(`"${corruption.key}"\\s*:\\s*"(?:[^"\\\\]|\\\\.)*"`).exec(captured.slice(anchor))
    expect(field, 'captured report must contain the one targeted nested field').not.toBeNull()
    const start = anchor + field!.index
    const original = field![0]
    const replacement = corruption.value === undefined
      ? `"unknownEvidenceField":true,${original}`
      : original.replace(/"(?:[^"\\]|\\.)*"$/, JSON.stringify(corruption.value))
    expect(replacement).not.toBe(original)
    const mutated = captured.slice(0, start) + replacement + captured.slice(start + original.length)
    // The same prefix and suffix preserve every other backend byte, including attempts and identities.
    expect(mutated.slice(0, start) + original + mutated.slice(start + replacement.length)).toBe(captured)
    await writeFile(file, mutated)
    const reopened = await f.mount()
    await expect((async () => {
      const claims = await f.mountClaims(reopened)
      return claims.requireAdmissible(pieceId, sha(f.source), signal())
    })()).rejects.toThrow()
    expect(f.adapter.requests).toHaveLength(1)
    expect(reopened.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(mutated)
  })
})
