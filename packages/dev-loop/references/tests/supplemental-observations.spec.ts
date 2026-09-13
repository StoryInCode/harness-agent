/** Additional reachable Markdown and filesystem failures through the real Loader owner. */
import { createHash, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { fixture, pieceId, signal, three } from './harness.ts'

it('multiple exact delegation tokens remain ambiguous instead of selecting one report', async () => {
  const attribution = `delegation:${randomUUID()} delegation:${randomUUID()}`
  await fixture(three('`tracked.txt`', attribution), async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation.structuralStatus).toBe('valid')
    expect(observation.entries[0]).toMatchObject({ attribution, attributionStatus: 'unverified', inspectionStatus: 'unverified' })
    expect(observation.entries[0]).not.toHaveProperty('delegation')
    expect(observation.entries[0]!.limitations.some(text => /multiple.*delegation/i.test(text))).toBe(true)
  })
})

it('reference definitions resolve case-insensitively and the first duplicate definition supplies the URL', async () => {
  const body = three('[local][Evidence]') + '\n\n[evidence]: ../../../tracked.txt\n\n[EVIDENCE]: ../../../missing.txt'
  await fixture(body, async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation.structuralStatus).toBe('valid')
    expect(observation.entries).toHaveLength(1)
    expect(observation.entries[0]).toMatchObject({ source: '../../../tracked.txt', sourceText: 'local', sourceStatus: 'resolved' })
  })
})

it('unresolved reference-style links remain unsupported prose rather than a guessed local path', async () => {
  await fixture(three('[local][absent-definition]'), async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation.structuralStatus).toBe('invalid')
    expect(observation.errors.map(error => error.code)).toContain('INVALID_LOCATOR')
    expect(observation.entries[0]).toMatchObject({ sourceText: '[local][absent-definition]', sourceStatus: 'invalid' })
  })
})

it.each([
  ['![display](../../../tracked.txt)', 'display'],
  ['![display][image]', 'display'],
  ['![](../../../tracked.txt)', ''],
  ['<span></span>', ''],
] as const)('image or HTML-only source %s never establishes a source locator', async (source, sourceText) => {
  await fixture(three(source) + '\n\n[image]: ../../../tracked.txt', async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation.structuralStatus).toBe('invalid')
    expect(observation.errors.map(error => error.code)).toContain('INVALID_LOCATOR')
    expect(observation.entries[0]).toMatchObject({ sourceText, sourceStatus: 'invalid', inspectionStatus: 'unverified' })
    expect(observation.entries[0]).not.toHaveProperty('contentSha256')
  })
})

it('inline HTML and image labels cannot add hidden locators beside an explicit code source', async () => {
  await fixture(three('`tracked.txt`<br>![caption](https://example.invalid/image)'), async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation.structuralStatus).toBe('valid')
    expect(observation.entries).toHaveLength(1)
    expect(observation.entries[0]).toMatchObject({ source: 'tracked.txt', sourceStatus: 'resolved' })
  })
})

it.each([
  ['', 'Parent'],
  ['`tracked.txt`', ''],
] as const)('empty source=%s or attribution=%s fails a populated table rather than becoming explicit empty', async (source, attribution) => {
  await fixture(three(source, attribution), async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation).toMatchObject({ structuralStatus: 'invalid', explicitEmpty: false })
    expect(observation.errors.map(error => error.code)).toContain('MALFORMED_REFERENCES')
  })
})

it.each([
  '[empty]()', '[fragment](#symbol)', '[control](<tracked.txt&#x0A;other>)', '[control](<tracked.txt&#x0D;other>)',
])('authored empty or decoded control locator %s rejects before filesystem lookup', async (source) => {
  await fixture(three(source), async (f) => {
    const fs = f.ctx.get('fs')!
    const resolve = vi.spyOn(fs, 'resolve')
    try {
      const observation = await f.references.verifyReferences(pieceId, signal())
      expect(observation.structuralStatus).toBe('invalid')
      expect(observation.errors.map(error => error.code)).toContain('INVALID_LOCATOR')
      expect(observation.entries[0]!.sourceStatus).toBe('invalid')
      expect(resolve.mock.calls.some(([path]) => path === '' || /[\r\n]/.test(path))).toBe(false)
    } finally { resolve.mockRestore() }
  })
})

it.each(['piece', 'source'] as const)('%s stream failure rejects without replacing the last durable observation', async (subject) => {
  await fixture('None.', async (f) => {
    const prior = await f.references.verifyReferences(pieceId, signal())
    await f.setReferences(three('`tracked.txt`'))
    const fs = f.ctx.get('fs')!
    const original = fs.streamText.bind(fs)
    const path = subject === 'piece' ? f.filename : join(f.repo, 'tracked.txt')
    const failure = new Error(`${subject} stream lost after first chunk`)
    let failedStreams = 0
    const stream = vi.spyOn(fs, 'streamText').mockImplementation(async (target, readSignal) => {
      const chunks = await original(target, readSignal)
      if (fs.processPath(target) !== path) return chunks
      return (async function* () {
        for await (const chunk of chunks) {
          yield chunk
          failedStreams++
          throw failure
        }
      })()
    })
    try {
      await expect(f.references.verifyReferences(pieceId, signal())).rejects.toThrow(failure.message)
      expect(failedStreams).toBe(1)
      expect(await f.references.getProvenance(pieceId)).toEqual(prior)
    } finally { stream.mockRestore() }
    await f.ctx.fiber.dispose()
    const reopened = await f.mount()
    expect(await (await f.mountReferences(reopened)).getProvenance(pieceId)).toEqual(prior)
  })
})

it.each(['missing', 'duplicate', 'end-of-document', 'setext-break'] as const)('fresh piece read observes %s References after Directory returns valid metadata', async (change) => {
  await fixture('None.', async (f) => {
    const initial = await f.setReferences('None.')
    const changed = change === 'missing'
      ? initial.replace('## References\n\nNone.', '## Other\n\nNone.')
      : change === 'duplicate'
        ? initial.replace('## References\n\nNone.', '## References\n\nNone.\n\n## References\n\nNone.')
        : change === 'setext-break'
          ? initial.replace('## References\n\nNone.', 'References\\\n&#32;\n---\n\nNone.')
          : initial.slice(0, initial.indexOf('## References')) + '## References\n\nNone.\n'
    const directory = f.ctx.get('devLoopDirectory')!
    const lookup = directory.getPiece.bind(directory)
    const getPiece = vi.spyOn(directory, 'getPiece').mockImplementation(async (...args) => {
      const record = await lookup(...args)
      await writeFile(f.filename, changed)
      return record
    })
    try {
      const observation = await f.references.verifyReferences(pieceId, signal())
      expect(getPiece).toHaveBeenCalledTimes(1)
      expect(observation.pieceSha256).toBe(createHash('sha256').update(changed).digest('hex'))
      if (change === 'end-of-document' || change === 'setext-break') {
        expect(observation).toMatchObject({ structuralStatus: 'valid', explicitEmpty: true, errors: [], entries: [] })
      } else {
        expect(observation).toMatchObject({ structuralStatus: 'invalid', explicitEmpty: false, entries: [] })
        expect(observation.errors.map(error => error.code)).toContain(change === 'missing' ? 'MISSING_REFERENCES' : 'MALFORMED_REFERENCES')
      }
      expect(await f.references.getProvenance(pieceId)).toEqual(observation)
    } finally { getPiece.mockRestore() }
  })
})

it('hard-break source syntax produces malformed authored table rows, not an invented AST break node', async () => {
  await fixture(three('first\\\nsecond'), async (f) => {
    const observation = await f.references.verifyReferences(pieceId, signal())
    expect(observation).toMatchObject({ structuralStatus: 'invalid', explicitEmpty: false })
    expect(observation.errors.map(error => error.code)).toContain('MALFORMED_REFERENCES')
  })
})
