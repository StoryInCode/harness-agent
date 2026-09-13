/** Shared source hashing preserves actual bytes and normalizes only the initial status header. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { observeSource } from '../src/index.ts'
import { createFixture } from './harness.ts'

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

it('shared observations preserve metadata, body Status examples, line endings and raw digests', async () => {
  const f = await createFixture()
  const initial = (await readFile(f.sourcePath, 'utf8')) + '\n```md\n**Status:** blocked\n```\n'
  const content = initial.replace('**Status:** todo', '**Status:** done').replaceAll('\n', '\r\n')
  await writeFile(f.sourcePath, content)
  const ctx = await f.mount({ durability: 'memory' })
  const target = await ctx.fs.resolve(f.sourcePath)
  const stat = await ctx.fs.stat(target)
  if (!stat) throw new Error('missing real source')
  const actual = await ctx.fs.readText(target)
  const piece = ctx.devLoopDirectory.validate(f.sourcePath, actual)
  expect(actual).toBe(content)
  expect(observeSource(piece.path, actual, stat.version)).toEqual({
    path: piece.path, version: stat.version, rawDigest: sha(content),
    contentDigest: sha(initial.replaceAll('\n', '\r\n')),
  })
})

it('the local provider rejects invalid UTF8 instead of inventing a raw source digest', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await writeFile(f.sourcePath, Buffer.concat([Buffer.from(await readFile(f.sourcePath, 'utf8')), Buffer.from([0xc0, 0xaf])]))
  const target = await ctx.fs.resolve(f.sourcePath)
  await expect(ctx.fs.readText(target)).rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('required hydration refuses BOM-stripped text instead of adopting an unverified raw identity', async () => {
  const f = await createFixture()
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(f.sourcePath)])
  await writeFile(f.sourcePath, bytes)
  await expect(f.mount().then(() => undefined)).rejects.toThrow(/size|byte/i)
  expect(await readFile(f.sourcePath)).toEqual(bytes)
})

it('required hydration refuses a provider observation whose byte size is unknown', async () => {
  const f = await createFixture()
  await expect(f.mount({ beforePersistence: (ctx) => {
    const stat = ctx.fs.stat.bind(ctx.fs)
    vi.spyOn(ctx.fs, 'stat').mockImplementation(async (...args) => {
      const info = await stat(...args)
      return info === undefined ? undefined : { type: info.type, version: info.version }
    })
  } }).then(() => undefined)).rejects.toThrow(/size|byte/i)
})
