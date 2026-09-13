/** Real-file restart recovery preserves history and scopes malformed-source quarantine to its piece. */
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { observeSource } from '../src/index.ts'
import { createFixture } from './harness.ts'

const invocation = { commandId: CommandId('recovery-audit'), sessionId: SessionId('recovery-audit-root') }
const signal = () => new AbortController().signal

async function observe(ctx: Context, pieceId: string) {
  const piece = await ctx.devLoopDirectory.getPiece(pieceId)
  const target = await ctx.fs.resolve(piece.path)
  const info = await ctx.fs.stat(target)
  if (!info) throw new Error('Fixture source is absent')
  const text = await ctx.fs.readText(target)
  expect(info.size).toBe(Buffer.byteLength(text, 'utf8'))
  return observeSource(piece.path, text, info.version)
}

async function accept(ctx: Context, pieceId: string) {
  await ctx.devLoopLifecycle.transition(pieceId, 'todo', 'pending', 'Reviewed actual source', undefined, {
    kind: 'command', ...invocation, decision: 'accept', source: await observe(ctx, pieceId),
  })
}

it('byte-identical inode replacement creates a current acknowledgeable anomaly without erasing prior recovery evidence', async () => {
  const f = await createFixture()
  const initial = await f.mount()
  await accept(initial, '00.12')
  const history = await initial.devLoopPersistence.getHistory('00.12')
  await writeFile(f.sourcePath, `${await readFile(f.sourcePath, 'utf8')}\nChanged acceptance requirements.\n`)
  const firstRestart = await f.mount()
  const oldAnomalies = await firstRestart.devLoopPersistence.getAnomalies()
  expect(oldAnomalies).toHaveLength(1)
  const old = oldAnomalies[0]!
  expect(old.kind).toBe('source-changed')
  const oldSource = await observe(firstRestart, '00.12')
  expect(old.observations).toEqual([oldSource])
  const oldAcknowledgment = await firstRestart.devLoopPersistence.acknowledgeAnomaly(
    old.id, invocation, 'Observed first source version', signal(),
  )
  const retainedOld = { ...old, acknowledgments: [oldAcknowledgment] }
  const bytes = await readFile(f.sourcePath)
  const before = await stat(f.sourcePath, { bigint: true })
  const replacement = `${f.sourcePath}.replacement`
  await writeFile(replacement, bytes, { flag: 'wx' })
  const allocated = await stat(replacement, { bigint: true })
  expect(allocated.ino).not.toBe(before.ino)
  await rename(replacement, f.sourcePath)
  expect((await stat(f.sourcePath, { bigint: true })).ino).toBe(allocated.ino)
  expect(await readFile(f.sourcePath)).toEqual(bytes)
  const currentSource = await observe(firstRestart, '00.12')
  expect(currentSource).toEqual({ ...oldSource, version: currentSource.version })
  expect(currentSource.version).not.toBe(oldSource.version)

  const reopened = await f.mount()
  const anomalies = await reopened.devLoopPersistence.getAnomalies()
  expect(anomalies).toHaveLength(2)
  expect(anomalies).toContainEqual(retainedOld)
  const current = anomalies.find(row => row.id !== old.id)!
  expect(current).toMatchObject({ kind: old.kind, pieceId: old.pieceId, observations: [currentSource], acknowledgments: [] })
  await expect(reopened.devLoopPersistence.acknowledgeAnomaly(old.id, invocation, 'Old observation', signal()))
    .rejects.toMatchObject({ code: 'DEV_LOOP_ANOMALY_STALE' })
  const acknowledgment = await reopened.devLoopPersistence.acknowledgeAnomaly(
    current.id, invocation, 'Observed replacement version', signal(),
  )
  expect(acknowledgment.observations).toEqual([currentSource])
  expect(await reopened.devLoopPersistence.getHistory('00.12')).toEqual(history)
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))

  const finalRestart = await f.mount()
  expect(await finalRestart.devLoopPersistence.getAnomalies()).toEqual(expect.arrayContaining([
    retainedOld, { ...current, acknowledgments: [acknowledgment] },
  ]))
  expect(await finalRestart.devLoopPersistence.getAnomalies()).toHaveLength(2)
  expect(await finalRestart.devLoopPersistence.getHistory('00.12')).toEqual(history)
  await expect(finalRestart.devLoopLifecycle.transition('00.12', 'pending', 'blocked'))
    .rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
  expect(await readFile(f.sourcePath)).toEqual(bytes)
})

it('malformed byte-faithful journaled source quarantines only that piece while recovery and another lifecycle remain usable', async () => {
  const f = await createFixture()
  const secondPath = f.sourcePath.replace('00.12-persistence-fixture.md', '00.13-persistence-fixture.md')
  await writeFile(secondPath, (await readFile(f.sourcePath, 'utf8')).replace('# 00.12', '# 00.13'), { flag: 'wx' })
  const initial = await f.mount()
  await accept(initial, '00.12')
  await accept(initial, '00.13')
  const originalHistory = await initial.devLoopPersistence.getHistory('00.12')
  const secondHistory = await initial.devLoopPersistence.getHistory('00.13')
  const validBytes = await readFile(secondPath)
  const malformed = (await readFile(f.sourcePath, 'utf8')).replace('**Status:** todo', '**Status:** invalidStatus')
  await writeFile(f.sourcePath, malformed)

  const reopened = await f.mount()
  const hydration = await reopened.devLoopPersistence.loadLifecycle(signal())
  expect(hydration.unresolvedIntentIds).toEqual([])
  expect(hydration.pieces).toEqual(expect.arrayContaining([
    expect.objectContaining({ pieceId: '00.12', status: 'pending', quarantined: true }),
    expect.objectContaining({ pieceId: '00.13', status: 'pending', quarantined: false }),
  ]))
  const target = await reopened.fs.resolve(f.sourcePath)
  const info = await reopened.fs.stat(target)
  if (!info) throw new Error('Malformed source is absent')
  expect(info.size).toBe(Buffer.byteLength(malformed, 'utf8'))
  const source = observeSource(originalHistory[0]!.source.path, malformed, info.version)
  expect(hydration.anomalies.map(row => [row.pieceId, row.kind, row.observations])).toEqual([
    ['00.12', 'source-changed', [source]], ['00.12', 'status-path-mismatch', [source]],
  ])
  expect(await reopened.devLoopPersistence.getHistory('00.12')).toEqual(originalHistory)
  expect(await reopened.devLoopPersistence.getHistory('00.13')).toEqual(secondHistory)
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  await expect(reopened.devLoopLifecycle.transition('00.12', 'pending', 'blocked'))
    .rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
  expect(reopened.devLoopLifecycle.getStatus('00.13')).toBe('pending')
  await reopened.devLoopLifecycle.transition('00.13', 'pending', 'blocked', 'Independent verification failed')
  expect(reopened.devLoopLifecycle.getStatus('00.13')).toBe('blocked')
  const advancedHistory = await reopened.devLoopPersistence.getHistory('00.13')
  expect(advancedHistory).toHaveLength(2)
  expect(advancedHistory.slice(0, 1)).toEqual(secondHistory)
  expect(advancedHistory[1]).toMatchObject({ sequence: 2, to: 'blocked', terminal: { kind: 'committed' } })
  expect(await readFile(secondPath)).toEqual(validBytes)
  expect(await readFile(f.sourcePath, 'utf8')).toBe(malformed)
})
