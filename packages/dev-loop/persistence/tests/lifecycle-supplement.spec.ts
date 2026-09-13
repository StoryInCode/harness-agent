/** Lifecycle observes real source races and physical storage failure without inventing domain errors. */
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { observeSource } from '../src/index.ts'
import { createFixture } from './harness.ts'

async function authorization(ctx: Context) {
  const piece = await ctx.devLoopDirectory.getPiece('00.12')
  const target = await ctx.fs.resolve(piece.path)
  const info = await ctx.fs.stat(target)
  if (!info) throw new Error('Missing fixture source')
  return { kind: 'command' as const, commandId: CommandId('lifecycle-supplement'),
    sessionId: SessionId('lifecycle-supplement-root'), decision: 'accept' as const,
    source: observeSource(piece.path, await ctx.fs.readText(target), info.version) }
}

async function accept(ctx: Context) {
  await ctx.devLoopLifecycle.transition('00.12', 'todo', 'pending', undefined, undefined, await authorization(ctx))
}

it('a source removed after hydration fails observation before intent and releases the claim', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const bytes = await readFile(f.sourcePath)
  await rm(f.sourcePath)
  await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toHaveLength(1)
  await writeFile(f.sourcePath, bytes)
  await ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked')
  expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('blocked')
})

it.each(['cancel', 'replace'] as const)('source read %s before intent cannot publish a transition', async (mode) => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const controller = new AbortController()
  const cancellation = new Error('Caller cancelled source observation')
  const read = ctx.fs.readText.bind(ctx.fs)
  const spy = vi.spyOn(ctx.fs, 'readText').mockImplementationOnce(async (...args) => {
    const text = await read(...args)
    if (mode === 'cancel') controller.abort(cancellation)
    else {
      const replacement = `${f.sourcePath}.replacement`
      await writeFile(replacement, text, { flag: 'wx' })
      await rename(replacement, f.sourcePath)
    }
    return text
  })
  try {
    const operation = ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked', undefined, controller.signal)
    if (mode === 'cancel') await expect(operation).rejects.toMatchObject({ code: 'FS_ABORTED' })
    else await expect(operation).rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
  } finally { spy.mockRestore() }
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toHaveLength(1)
  expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('pending')
  await ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked')
})

it('source changed after durable intent records a failed terminal rather than publishing blocked', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const begin = ctx.devLoopPersistence.beginTransition.bind(ctx.devLoopPersistence)
  const spy = vi.spyOn(ctx.devLoopPersistence, 'beginTransition').mockImplementationOnce(async (request) => {
    const id = await begin(request)
    await writeFile(f.sourcePath, `${await readFile(f.sourcePath, 'utf8')}\nConcurrent source change.\n`)
    return id
  })
  try {
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked')).rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
  } finally { spy.mockRestore() }
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  expect(history).toHaveLength(2)
  expect(history[1]?.terminal).toMatchObject({ kind: 'failed', code: 'PIECE_REVIEW_STALE', effects: { header: 'none', index: 'none', move: 'none' } })
  expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('pending')
  const reopened = await f.mount()
  expect(await reopened.devLoopPersistence.getHistory('00.12')).toEqual(history)
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
})

it('policy-time source replacement refuses the header edit after recording intent', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const bytes = await readFile(f.sourcePath)
  ctx.on('piece/pre-complete', async () => {
    const replacement = `${f.sourcePath}.replacement`
    await writeFile(replacement, bytes, { flag: 'wx' })
    await rename(replacement, f.sourcePath)
  })
  await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')).rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
  expect(await readFile(f.sourcePath)).toEqual(bytes)
  expect(await f.git('diff', '--cached', '--name-only')).toBe('')
  expect((await ctx.devLoopPersistence.getHistory('00.12'))[1]?.terminal).toMatchObject({ kind: 'failed', effects: { header: 'none' } })
})

it('an edit that applies then rejects is observed and restored before failed terminal recording', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const bytes = await readFile(f.sourcePath)
  const edit = ctx.fs.editText.bind(ctx.fs)
  const failure = new Error('Provider lost edit response after applying bytes')
  const spy = vi.spyOn(ctx.fs, 'editText').mockImplementationOnce(async (...args) => {
    await edit(...args)
    expect(await readFile(f.sourcePath, 'utf8')).toContain('**Status:** done')
    throw failure
  })
  try {
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')).rejects.toBe(failure)
  } finally { spy.mockRestore() }
  expect(await readFile(f.sourcePath)).toEqual(bytes)
  expect(await f.git('diff', '--cached', '--name-only')).toBe('')
  expect((await ctx.devLoopPersistence.getHistory('00.12'))[1]?.terminal).toMatchObject({ kind: 'failed', effects: {
    header: 'applied', index: 'none', move: 'none', cleanup: 'restored',
  } })
  await ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked')
})

it.each(['removed', 'externally-edited'] as const)('a rejected applied edit with %s source retains unknown effects without restoring unowned bytes', async (mode) => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const original = await readFile(f.sourcePath, 'utf8')
  const changed = `${original.replace('**Status:** todo', '**Status:** done')}\nExternal body change after edit.\n`
  const edit = ctx.fs.editText.bind(ctx.fs)
  const spy = vi.spyOn(ctx.fs, 'editText').mockImplementationOnce(async (...args) => {
    await edit(...args)
    expect(await readFile(f.sourcePath, 'utf8')).toContain('**Status:** done')
    if (mode === 'removed') await rm(f.sourcePath)
    else await writeFile(f.sourcePath, changed)
    const missing = await ctx.fs.resolve(mode === 'removed' ? f.sourcePath : `${f.sourcePath}.missing`)
    await ctx.fs.readText(missing)
    throw new Error('Missing-file read unexpectedly succeeded')
  })
  try {
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { spy.mockRestore() }
  if (mode === 'removed') await expect(readFile(f.sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
  else expect(await readFile(f.sourcePath, 'utf8')).toBe(changed)
  expect(await f.git('diff', '--cached', '--name-only')).toBe('')
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  expect(history).toHaveLength(2)
  expect(history[1]?.terminal).toMatchObject({ kind: 'failed', code: 'FS_NOT_FOUND', effects: {
    header: 'unknown', index: 'none', move: 'none', cleanup: 'unknown',
  } })
  await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked')).rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
  const reopened = await f.mount()
  expect(await reopened.devLoopPersistence.getHistory('00.12')).toEqual(history)
  const anomalies = await reopened.devLoopPersistence.getAnomalies()
  expect(anomalies.map(row => row.kind)).toContain('uncertain-effect')
  expect(anomalies.map(row => row.kind)).toContain(mode === 'removed' ? 'missing-source' : 'source-changed')
  expect(anomalies.find(row => row.kind === 'uncertain-effect')?.transitionId).toBe(history[1]?.id)
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  if (mode === 'removed') await expect(readFile(f.sourcePath)).rejects.toMatchObject({ code: 'ENOENT' })
  else expect(await readFile(f.sourcePath, 'utf8')).toBe(changed)
})

it('completion preserves fenced header headings and body Status examples while editing the initial Status', async () => {
  const f = await createFixture()
  const original = await readFile(f.sourcePath, 'utf8')
  const text = original.replace('**Status:** todo', [
    '````md', '## Fenced heading', '```', '~~~~', '````',
    '~~~md', '## Another fenced heading', '~~~', '**Status:** todo',
  ].join('\n')) + '\n**Status:** todo\n'
  await writeFile(f.sourcePath, text)
  const ctx = await f.mount()
  await accept(ctx)
  await ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')
  expect(await readFile(f.destinationPath, 'utf8')).toBe(text.replace('**Status:** todo', '**Status:** done'))
  const reopened = await f.mount()
  expect(reopened.devLoopLifecycle.getStatus('00.12')).toBe('done')
})

it.each(['intent', 'terminal'] as const)('physical JSON parent obstruction rejects %s recording with actual effects', async (phase) => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const saved = `${f.storageRoot}.saved`
  let obstructed = false
  const obstruct = async () => {
    await rename(f.storageRoot, saved)
    obstructed = true
    await writeFile(f.storageRoot, 'Not a directory', { flag: 'wx' })
  }
  if (phase === 'terminal') ctx.on('piece/pre-complete', obstruct)
  try {
    if (phase === 'intent') await obstruct()
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')).rejects.toMatchObject({
      code: phase === 'intent' ? 'DEV_LOOP_INTENT_WRITE_FAILED' : 'DEV_LOOP_TERMINAL_WRITE_FAILED',
      effects: phase === 'intent' ? { header: 'none', index: 'none', move: 'none' }
        : { header: 'applied', index: 'applied', move: 'applied' },
    })
  } finally {
    if (obstructed) {
      await rm(f.storageRoot, { force: true })
      await rename(saved, f.storageRoot)
    }
  }
  const reopened = await f.mount()
  const history = await reopened.devLoopPersistence.getHistory('00.12')
  if (phase === 'intent') {
    expect(history).toHaveLength(1)
    expect(reopened.devLoopLifecycle.getStatus('00.12')).toBe('pending')
    expect(await readFile(f.sourcePath, 'utf8')).toContain('**Status:** todo')
    expect(await f.git('diff', '--cached', '--name-only')).toBe('')
  } else {
    expect(history).toHaveLength(2)
    expect(history[1]?.terminal).toBeUndefined()
    expect(await readFile(f.destinationPath, 'utf8')).toContain('**Status:** done')
    expect(await f.git('diff', '--cached', '--name-status')).toContain('done/')
    expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  }
})
