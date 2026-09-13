/** Public persistence admission and physical JSON publication failure behavior. */
import { mkdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import { observeSource } from '../src/index.ts'
import type { BeginTransitionRequest, HumanAuthorization, SourceObservation } from '../src/types.ts'
import { createFixture } from './harness.ts'

const signal = () => new AbortController().signal
const invocation = { commandId: CommandId('api-inspection'), sessionId: SessionId('api-root') }

async function observe(ctx: Context): Promise<SourceObservation> {
  const piece = await ctx.devLoopDirectory.getPiece('00.12')
  const path = await ctx.fs.resolve(piece.path)
  const stat = await ctx.fs.stat(path)
  if (!stat) throw new Error('Missing fixture source')
  return observeSource(piece.path, await ctx.fs.readText(path), stat.version)
}

async function acceptance(ctx: Context): Promise<BeginTransitionRequest> {
  const source = await observe(ctx)
  const authorization: HumanAuthorization = { ...invocation, kind: 'command', decision: 'accept', source }
  return { pieceId: '00.12', expected: 'todo', from: 'todo', to: 'pending', sequence: 1,
    source, destinationPath: source.path, authorization, signal: signal() }
}

async function accept(ctx: Context) {
  const request = await acceptance(ctx)
  await ctx.devLoopLifecycle.transition('00.12', 'todo', 'pending', undefined, undefined, request.authorization)
  return request
}

async function discrepancy() {
  const f = await createFixture()
  let ctx = await f.mount()
  await accept(ctx)
  await ctx.fiber.dispose()
  await writeFile(f.sourcePath, `${await readFile(f.sourcePath, 'utf8')}\nChanged acceptance requirements.\n`)
  ctx = await f.mount()
  const anomalies = await ctx.devLoopPersistence.getAnomalies()
  expect(anomalies).toHaveLength(1)
  return { f, ctx, anomaly: anomalies[0]! }
}

it('the sole writer rejects a stale independently retained CAS without another intent', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const stale = await acceptance(ctx)
  await accept(ctx)
  const before = await ctx.devLoopPersistence.getHistory('00.12')
  await expect(ctx.devLoopPersistence.beginTransition(stale)).rejects.toMatchObject({ code: 'DEV_LOOP_SEQUENCE_CONFLICT' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual(before)
  expect((await f.mount()).devLoopLifecycle.getStatus('00.12')).toBe('pending')
})

it.each(['expected', 'edge', 'sequence'] as const)('the writer rejects conflicting %s facts against admitted pending history', async (conflict) => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  const source = await observe(ctx)
  const request: BeginTransitionRequest = { pieceId: '00.12', expected: 'pending', from: 'pending', to: 'blocked',
    source, destinationPath: source.path, sequence: history.length + 1, signal: signal() }
  const conflicting: BeginTransitionRequest = conflict === 'expected' ? { ...request, expected: 'todo' }
    : conflict === 'edge' ? { ...request, to: 'todo' } : { ...request, sequence: history.length }
  await expect(ctx.devLoopPersistence.beginTransition(conflicting)).rejects.toMatchObject({ code: 'DEV_LOOP_SEQUENCE_CONFLICT' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual(history)
  expect(await f.git('status', '--porcelain')).toBe('')
})

it('the writer refuses acceptance without human authorization before retaining an intent', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const { authorization: _authorization, ...request } = await acceptance(ctx)
  await expect(ctx.devLoopPersistence.beginTransition(request)).rejects.toMatchObject({ code: 'PIECE_AUTHORIZATION_REQUIRED' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
  expect(await f.git('status', '--porcelain')).toBe('')
})

it('the writer refuses prior human source observations after a real source edit', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const reviewed = await acceptance(ctx)
  await writeFile(f.sourcePath, `${await readFile(f.sourcePath, 'utf8')}\nNew requirements.\n`)
  const source = await observe(ctx)
  expect(source.rawDigest).not.toBe(reviewed.source.rawDigest)
  await expect(ctx.devLoopPersistence.beginTransition({ ...reviewed, source }))
    .rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('unchanged reviewed bytes with a different actual filesystem version require fresh authorization', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const reviewed = await acceptance(ctx)
  await utimes(f.sourcePath, new Date(0), new Date(0))
  const source = await observe(ctx)
  expect(source.rawDigest).toBe(reviewed.source.rawDigest)
  expect(source.contentDigest).toBe(reviewed.source.contentDigest)
  expect(source.version).not.toBe(reviewed.source.version)
  await expect(ctx.devLoopPersistence.beginTransition({ ...reviewed, source }))
    .rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('the writer refuses completion of changed bytes despite a historically committed acceptance', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const before = await ctx.devLoopPersistence.getHistory('00.12')
  await writeFile(f.sourcePath, `${await readFile(f.sourcePath, 'utf8')}\nUnreviewed completion changes.\n`)
  const source = await observe(ctx)
  await expect(ctx.devLoopPersistence.beginTransition({ pieceId: '00.12', expected: 'pending', from: 'pending', to: 'done',
    source, destinationPath: f.destinationPath, sequence: before.length + 1, signal: signal() }))
    .rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual(before)
})

it('an unresolved admitted intent prevents a second public writer admission', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const request = await acceptance(ctx)
  const id = await ctx.devLoopPersistence.beginTransition(request)
  await expect(ctx.devLoopPersistence.beginTransition(request)).rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([expect.objectContaining({ id, sequence: 1 })])
  const reopened = await f.mount()
  expect(await reopened.devLoopPersistence.getAnomalies()).toEqual([
    expect.objectContaining({ kind: 'unresolved-intent', transitionId: id }),
  ])
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
})

it('a retained source discrepancy prevents direct writer admission after restart', async () => {
  const { ctx } = await discrepancy()
  const source = await observe(ctx)
  const before = await ctx.devLoopPersistence.getHistory('00.12')
  await expect(ctx.devLoopPersistence.beginTransition({ pieceId: '00.12', expected: 'pending', from: 'pending', to: 'blocked',
    source, destinationPath: source.path, sequence: before.length + 1, signal: signal() }))
    .rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual(before)
})

it('terminal settlement cannot overwrite an already committed lifecycle observation', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  const row = history[0]!
  if (!row.terminal) throw new Error('Missing real committed terminal')
  await expect(ctx.devLoopPersistence.finishTransition(row.id, row.terminal))
    .rejects.toMatchObject({ code: 'DEV_LOOP_TERMINAL_CONFLICT', effects: row.terminal.effects })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual(history)
  expect((await f.mount()).devLoopLifecycle.getStatus('00.12')).toBe('pending')
})

it('a terminal from another actual history cannot create an absent intent', async () => {
  const original = await createFixture()
  const producer = await original.mount()
  await accept(producer)
  const row = (await producer.devLoopPersistence.getHistory('00.12'))[0]!
  if (!row.terminal) throw new Error('Missing real committed terminal')
  const f = await createFixture()
  const ctx = await f.mount()
  await expect(ctx.devLoopPersistence.finishTransition(row.id, row.terminal))
    .rejects.toMatchObject({ code: 'DEV_LOOP_TERMINAL_CONFLICT', effects: row.terminal.effects })
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
  expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('todo')
})

it('a physical JSON publish obstruction refuses intent without changing durable or visible state', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const filename = join(f.storageRoot, 'dev_loop.json')
  const backup = join(f.storageRoot, 'committed.json')
  const bytes = await readFile(filename)
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  await rename(filename, backup)
  try {
    await mkdir(filename)
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked', 'verification refused'))
      .rejects.toMatchObject({ code: 'DEV_LOOP_INTENT_WRITE_FAILED', effects: { header: 'none', index: 'none', move: 'none' } })
    expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual(history)
    expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('pending')
    expect(await readFile(backup)).toEqual(bytes)
    expect(await f.git('status', '--porcelain')).toBe('')
  } finally {
    await rm(filename, { recursive: true, force: true })
    await rename(backup, filename)
  }
  expect((await f.mount()).devLoopLifecycle.getStatus('00.12')).toBe('pending')
})

it('a physical terminal publish failure preserves real completion effects and unresolved intent on restart', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const filename = join(f.storageRoot, 'dev_loop.json')
  const backup = join(f.storageRoot, 'intent.json')
  let obstructed = false
  ctx.on('piece/pre-complete', async () => {
    await rename(filename, backup)
    obstructed = true
    await mkdir(filename)
  })
  try {
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'done'))
      .rejects.toMatchObject({ code: 'DEV_LOOP_TERMINAL_WRITE_FAILED', effects: { header: 'applied', index: 'applied', move: 'applied' } })
    expect(obstructed).toBe(true)
    const history = await ctx.devLoopPersistence.getHistory('00.12')
    expect(history).toHaveLength(2)
    expect(history[1]?.terminal).toBeUndefined()
    expect(await readFile(f.destinationPath, 'utf8')).toContain('**Status:** done')
    expect(await f.git('diff', '--cached', '--name-status')).toContain('done/')
  } finally {
    if (obstructed) {
      await rm(filename, { recursive: true, force: true })
      await rename(backup, filename)
    }
  }
  const reopened = await f.mount()
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  expect(await reopened.devLoopPersistence.getAnomalies()).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'unresolved-intent' }),
  ]))
})

it('completed disposal refuses public reads and new queued writer work', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const request = await accept(ctx)
  const persistence = ctx.devLoopPersistence
  await ctx.fiber.dispose()
  await expect(persistence.getHistory('00.12')).rejects.toMatchObject({ code: 'DEV_LOOP_DISPOSED' })
  await expect(persistence.getAnomalies()).rejects.toMatchObject({ code: 'DEV_LOOP_DISPOSED' })
  await expect(persistence.beginTransition(request)).rejects.toMatchObject({ code: 'DEV_LOOP_DISPOSED' })
  expect((await f.mount()).devLoopLifecycle.getStatus('00.12')).toBe('pending')
})

it('acknowledgment rejects an actual anomaly id absent from this repository', async () => {
  const { anomaly } = await discrepancy()
  const f = await createFixture()
  const ctx = await f.mount()
  await expect(ctx.devLoopPersistence.acknowledgeAnomaly(anomaly.id, invocation, 'Inspected', signal()))
    .rejects.toMatchObject({ code: 'DEV_LOOP_ANOMALY_NOT_FOUND' })
  expect(await ctx.devLoopPersistence.getAnomalies()).toEqual([])
})

it('empty acknowledgment reasoning does not append awareness or clear quarantine', async () => {
  const { f, ctx, anomaly } = await discrepancy()
  const filename = join(f.storageRoot, 'dev_loop.json')
  const bytes = await readFile(filename)
  await expect(ctx.devLoopPersistence.acknowledgeAnomaly(anomaly.id, invocation, ' \n\t ', signal()))
    .rejects.toThrow('Acknowledgment reason must not be empty')
  expect(await readFile(filename)).toEqual(bytes)
  expect(await ctx.devLoopPersistence.getAnomalies()).toEqual([anomaly])
  expect(() => ctx.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
})

it('reopening below the retained real history count refuses rather than truncating history', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  await ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked', 'verification refused')
  await ctx.fiber.dispose()
  const filename = join(f.storageRoot, 'dev_loop.json')
  const bytes = await readFile(filename)
  await expect(f.mount({ maxHistoryRecords: 1 }).then(() => undefined)).rejects.toThrow('History exceeds maxHistoryRecords')
  expect(await readFile(filename)).toEqual(bytes)
  expect((await f.mount({ maxHistoryRecords: 2 })).devLoopLifecycle.getStatus('00.12')).toBe('blocked')
})
