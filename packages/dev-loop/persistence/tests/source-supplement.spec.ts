/** Initial-header normalization follows real Directory fence and field parsing. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { observeSource } from '../src/index.ts'
import { createFixture } from './harness.ts'

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

it.each(['`', '~'])('preserves %s header fences, mismatched closers and packed metadata bytes', async (marker) => {
  const f = await createFixture()
  const initial = await readFile(f.sourcePath, 'utf8')
  const wrong = marker === '`' ? '~' : '`'
  const fence = [marker.repeat(4), '## Not a real section', wrong.repeat(5), marker.repeat(3), 'still fenced', marker.repeat(5)].join('\n')
  const content = initial.replace('**Status:** todo', `${fence}\n\t**Status:** done  · **Extra:** café`)
  await writeFile(f.sourcePath, content)
  const ctx = await f.mount({ durability: 'memory' })
  const target = await ctx.fs.resolve(f.sourcePath)
  const info = await ctx.fs.stat(target)
  if (info === undefined) throw new Error('private source absent')
  const actual = await ctx.fs.readText(target)
  expect(info.size).toBe(Buffer.byteLength(actual, 'utf8'))
  const piece = ctx.devLoopDirectory.validate(f.sourcePath, actual)
  expect(piece.status).toBe('done')
  expect(observeSource(piece.path, actual, info.version)).toEqual({
    path: piece.path, version: info.version, rawDigest: sha(content),
    contentDigest: sha(content.replace('\t**Status:** done  ·', '\t**Status:** todo  ·')),
  })
})
