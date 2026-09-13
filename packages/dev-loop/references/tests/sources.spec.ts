/** Canonical containment, line semantics and complete UTF-8 bounds. */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, writeFile, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { expect, it, vi } from 'vitest'
import { fixture, pieceId, signal, three } from './harness.ts'

it('code resolves from repositoryRoot while Markdown links resolve from the piece directory', async () => {
  await fixture(three('`tracked.txt` and [near](near.txt)'), async (f) => {
    await writeFile(join(dirname(f.filename), 'near.txt'), 'near\n')
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('valid')
    expect(value.entries.map(entry => entry.contentSha256)).toEqual(['retained evidence\n', 'near\n'].map(text => createHash('sha256').update(text).digest('hex')))
  })
})
it.each([
  ['`tracked.txt:1`', 'resolved', undefined],
  ['`tracked.txt:1-2`', 'resolved', undefined],
  ['`tracked.txt:0`', 'invalid', 'INVALID_RANGE'],
  ['`tracked.txt:2-1`', 'invalid', 'INVALID_RANGE'],
  ['`tracked.txt:3`', 'invalid', 'INVALID_RANGE'],
  ['`tracked.txt:-1`', 'invalid', 'INVALID_RANGE'],
  ['`tracked.txt:1.5`', 'invalid', 'INVALID_RANGE'],
  ['`tracked.txt:9007199254740992`', 'invalid', 'INVALID_RANGE'],
  ['`absent.txt`', 'missing', 'SOURCE_MISSING'],
  ['`plans`', 'invalid', 'SOURCE_NOT_FILE'],
  ['`../outside.txt`', 'invalid', 'OUTSIDE_ROOT'],
  ['[unsupported](ftp://example.invalid/doc)', 'invalid', 'INVALID_LOCATOR'],
  ['unmarked/path.txt', 'invalid', 'INVALID_LOCATOR'],
  ['[query](../../../tracked.txt?revision=1)', 'invalid', 'INVALID_LOCATOR'],
] as const)('locator %s reports %s without interpreting confidence as structure', async (source, status, code) => {
  await fixture(three(source), async (f) => {
    await writeFile(join(f.repo, 'tracked.txt'), 'line one\nline two')
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ sourceStatus: status, attributionStatus: 'unverified', inspectionStatus: 'unverified' })
    expect(value.structuralStatus).toBe(code === undefined ? 'valid' : 'invalid')
    if (code !== undefined) expect(value.errors.map(error => error.code)).toContain(code)
    if (status === 'missing') expect(value.entries[0]!.limitations.length).toBeGreaterThan(0)
  })
})
it('line ranges are retained and decoded-text SHA-256 includes CRLF and multibyte characters', async () => {
  await fixture(three('`tracked.txt:2-3`'), async (f) => {
    const text = 'first\r\n界\r\nlast'
    await writeFile(join(f.repo, 'tracked.txt'), text)
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ lineRange: { start: 2, end: 3 }, sourceStatus: 'resolved',
      contentSha256: createHash('sha256').update(text, 'utf8').digest('hex') })
  })
})
it('fragment is retained but no semantic symbol verification is claimed', async () => {
  await fixture(three('[symbol](../../../tracked.txt#nonexistent-symbol)'), async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.entries[0]).toMatchObject({ source: '../../../tracked.txt#nonexistent-symbol', fragment: 'nonexistent-symbol',
      sourceStatus: 'resolved', inspectionStatus: 'unverified' })
    expect(value.entries[0]!.limitations.length).toBeGreaterThan(0)
  })
})
it('absolute local paths reject even when inside repositoryRoot', async () => {
  await fixture('None.', async (f) => {
    await f.setReferences(three('`' + join(f.repo, 'tracked.txt') + '`'))
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.errors.map(error => error.code)).toContain('ABSOLUTE_PATH')
    expect(value.entries[0]!.sourceStatus).toBe('invalid')
  })
})
it.skipIf(process.platform === 'win32')('intermediate symlink escape rejects before reading outside content (POSIX symlink privilege)', async () => {
  await fixture(three('`escape/secret.txt`'), async (f) => {
    const outside = join(dirname(f.repo), 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.txt'), 'must not be read')
    await symlink(outside, join(f.repo, 'escape'), 'dir')
    const fs = f.ctx.get('fs')!
    const stream = vi.spyOn(fs, 'streamText')
    const read = vi.spyOn(fs, 'readText')
    const bytes = vi.spyOn(fs, 'readBytes')
    try {
      const value = await f.references.verifyReferences(pieceId, signal())
      expect(value.errors.map(error => error.code)).toContain('OUTSIDE_ROOT')
      expect(value.entries[0]!.sourceStatus).toBe('invalid')
      for (const spy of [stream, read, bytes]) {
        expect(spy.mock.calls.some(([target]) => fs.processPath(target) === join(outside, 'secret.txt'))).toBe(false)
      }
    } finally { stream.mockRestore(); read.mockRestore(); bytes.mockRestore() }
  })
})
it('HTTP and HTTPS sources remain not-checked and are never handed to filesystem resolution', async () => {
  await fixture(three('[plain](http://example.invalid/a) [secure](https://example.invalid/b)'), async (f) => {
    const resolve = vi.spyOn(f.ctx.get('fs')!, 'resolve')
    try {
      const value = await f.references.verifyReferences(pieceId, signal())
      expect(value.entries.map(entry => entry.sourceStatus)).toEqual(['not-checked', 'not-checked'])
      for (const entry of value.entries) { expect(entry).not.toHaveProperty('contentSha256'); expect(entry.inspectionStatus).toBe('unverified') }
      expect(resolve.mock.calls.some(([path]) => /^https?:/.test(path))).toBe(false)
    } finally { resolve.mockRestore() }
  })
})
it('external reference checking makes no HTTP request to the cited server', async () => {
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end('not trusted inspection evidence') })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Expected allocated TCP address')
    await fixture(three(`[external](http://127.0.0.1:${address.port}/source)`), async (f) => {
      const value = await f.references.verifyReferences(pieceId, signal())
      expect(value.entries[0]).toMatchObject({ sourceStatus: 'not-checked', inspectionStatus: 'unverified' })
      expect(requests).toBe(0)
    })
    expect(requests).toBe(0)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  }
})

it.each([[6, 'valid'], [5, 'invalid']] as const)('maxSourceBytes %i measures UTF-8 bytes inclusively', async (maxSourceBytes, status) => {
  await fixture(three('`tracked.txt`'), async (f) => {
    await writeFile(join(f.repo, 'tracked.txt'), '界界')
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe(status)
    if (status === 'invalid') {
      expect(value.errors.map(error => error.code)).toContain('SOURCE_TOO_LARGE')
      expect(value.entries[0]).not.toHaveProperty('contentSha256')
    }
  }, { maxSourceBytes })
})
it('maxPieceBytes rejects a multibyte piece without silently clipping retained evidence', async () => {
  await fixture(three('`tracked.txt`', 'Parent', '界'.repeat(2048)), async (f) => {
    await expect(f.references.verifyReferences(pieceId, signal())).rejects.toThrow(/maxPieceBytes|piece.*(byte|limit|large)/i)
    expect(await f.references.getProvenance(pieceId)).toBeUndefined()
  }, { maxPieceBytes: 4096 })
})
it('maxReferences counts locators rather than source table rows', async () => {
  await fixture(three('`tracked.txt` and [second](../../../tracked.txt)'), async (f) => {
    const value = await f.references.verifyReferences(pieceId, signal())
    expect(value.structuralStatus).toBe('invalid')
    expect(value.errors.map(error => error.code)).toContain('TOO_MANY_REFERENCES')
  }, { maxReferences: 1 })
})
it('maxObservationBytes applies to the complete retained JSON and rejects rather than truncates', async () => {
  await fixture(three('`tracked.txt`', 'Parent', '界'.repeat(4096)), async (f) => {
    await expect(f.references.verifyReferences(pieceId, signal())).rejects.toThrow(/maxObservationBytes|observation.*(byte|limit|large)/i)
    expect(await f.references.getProvenance(pieceId)).toBeUndefined()
  }, { maxObservationBytes: 4096 })
})
