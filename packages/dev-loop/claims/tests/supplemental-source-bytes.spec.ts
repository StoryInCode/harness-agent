/** Raw-byte claims require a complete fatal UTF-8 representation with known matching backend size. */
import { writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { fixture, pieceId, response } from './harness.ts'

it('refuses a real UTF-8 BOM piece rather than claiming its decoded-text digest identifies the original bytes', async () => {
  await fixture([response()], async (f) => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(f.source, 'utf8')])
    await writeFile(f.filename, bytes)
    const fs = f.ctx.get('fs')!
    const target = await fs.resolve(f.filename)
    expect((await fs.stat(target))!.size).toBe(bytes.length)
    const decoded = await fs.readText(target)
    expect(Buffer.byteLength(decoded)).toBe(bytes.length - 3)
    await expect(f.verify()).rejects.toThrow(/byte|UTF-8|size|BOM|identity/i)
    expect(f.adapter.requests).toEqual([])
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
  })
})

it('refuses an unknown piece byte size instead of inferring raw identity from decoded text alone', async () => {
  await fixture([response()], async (f) => {
    const fs = f.ctx.get('fs')!
    const pieceTarget = await fs.resolve(f.filename)
    const stat = fs.stat.bind(fs)
    const observation = vi.spyOn(fs, 'stat').mockImplementation(async (target, signal) => {
      const info = await stat(target, signal)
      if (target.targetKey !== pieceTarget.targetKey || !info) return info
      const { size: _, ...unknownSize } = info
      return unknownSize
    })
    try {
      await expect(f.verify()).rejects.toThrow(/byte|size|identity/i)
      expect(observation).toHaveBeenCalled()
      expect(f.adapter.requests).toEqual([])
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
    } finally { observation.mockRestore() }
  })
})

it('refuses actual malformed UTF-8 piece bytes without dispatching Research', async () => {
  await fixture([], async (f) => {
    await writeFile(f.filename, Buffer.concat([Buffer.from(f.source), Buffer.from([0xc3, 0x28])]))
    await expect(f.verify()).rejects.toThrow()
    expect(f.adapter.requests).toEqual([])
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
  })
})
