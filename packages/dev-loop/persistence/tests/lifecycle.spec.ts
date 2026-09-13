/** Direct Lifecycle callers must cross durable intent and terminal publication points. */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import type { HumanAuthorization, SourceDigest, SourceObservation } from '../src/types.ts'
import { createFixture } from './harness.ts'

const ID = '00.12'
const digest = (value: string) => createHash('sha256').update(value).digest('hex') as SourceDigest

async function observe(ctx: Context): Promise<SourceObservation> {
  const piece = await ctx.devLoopDirectory.getPiece(ID)
  const target = await ctx.fs.resolve(piece.path)
  const stat = await ctx.fs.stat(target)
  if (!stat) throw new Error('fixture source is absent')
  const text = await ctx.fs.readText(target)
  return { path: piece.path, version: stat.version, rawDigest: digest(text),
    contentDigest: digest(text.replace(/(\*\*Status:\*\* )(todo|pending|blocked|done)/, '$1todo')) }
}

async function authorization(ctx: Context): Promise<HumanAuthorization> {
  return { kind: 'command', commandId: CommandId('cmd-fixture-1'), sessionId: SessionId('fixture-root'),
    source: await observe(ctx), decision: 'accept' }
}

async function accept(ctx: Context) {
  await ctx.devLoopLifecycle.transition(ID, 'todo', 'pending', 'reviewed', undefined, await authorization(ctx))
}

function barrier() {
  let release!: () => void
  let enter!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  return { entered, release, wait: async () => { enter(); await held } }
}

describe('required direct Lifecycle durable integration', () => {
  it('refuses required mount without persistence rather than silently accepting memory mode', async () => {
    const f = await createFixture()
    await expect(f.mount({ persistence: false }).then(() => undefined)).rejects.toThrow(/devLoopPersistence/)
  })

  it('requires human authorization even when called directly rather than through the command wrapper', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await expect(ctx.devLoopLifecycle.transition(ID, 'todo', 'pending')).rejects.toMatchObject({ code: 'PIECE_AUTHORIZATION_REQUIRED' })
    expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('todo')
    expect(await ctx.devLoopPersistence.getHistory(ID)).toEqual([])
  })

  it('rechecks reviewed source in the sole writer and refuses substantive changes', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    const reviewed = await authorization(ctx)
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')) + '\nSubstantive changed acceptance.\n')
    await expect(ctx.devLoopLifecycle.transition(ID, 'todo', 'pending', undefined, undefined, reviewed))
      .rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
    expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('todo')
  })

  it('historical pending acceptance does not authorize completion of subsequently edited source', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    const changed = (await readFile(f.sourcePath, 'utf8')) + '\nNew unaccepted completion requirements.\n'
    await writeFile(f.sourcePath, changed)
    await expect(ctx.devLoopLifecycle.transition(ID, 'pending', 'done')).rejects.toMatchObject({ code: 'PIECE_REVIEW_STALE' })
    expect(await readFile(f.sourcePath, 'utf8')).toBe(changed)
    expect(await f.git('diff', '--cached', '--name-only')).toBe('')
  })

  it('journals every legal edge including blocked-to-todo and actual Git completion in one ordered history', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    await ctx.devLoopLifecycle.transition(ID, 'pending', 'blocked', 'verification refused')
    await ctx.devLoopLifecycle.transition(ID, 'blocked', 'todo', 'revise')
    await accept(ctx)
    await ctx.devLoopLifecycle.transition(ID, 'pending', 'done', 'verified')
    expect(await readFile(f.destinationPath, 'utf8')).toContain('**Status:** done')
    expect(await f.git('diff', '--cached', '--name-status')).toContain('done/')
    const records = await ctx.devLoopPersistence.getHistory(ID)
    expect(records.map(row => [row.sequence, row.from, row.to, row.terminal?.kind])).toEqual([
      [1, 'todo', 'pending', 'committed'], [2, 'pending', 'blocked', 'committed'],
      [3, 'blocked', 'todo', 'committed'], [4, 'todo', 'pending', 'committed'], [5, 'pending', 'done', 'committed'],
    ])
    for (const record of records) {
      expect(record.id).toMatch(/^dlt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      expect(record.repositoryId).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(records[0]?.authorization).toEqual(expect.objectContaining({ kind: 'command', commandId: 'cmd-fixture-1', sessionId: 'fixture-root' }))
    const final = records[4]
    expect(final?.terminal).toMatchObject({ source: { contentDigest: final?.source.contentDigest } })
    expect(final?.terminal && 'source' in final.terminal && final.terminal.source?.rawDigest).not.toBe(final?.source.rawDigest)
    const reopened = await f.mount()
    expect(reopened.devLoopLifecycle.getStatus(ID)).toBe('done')
    expect(await reopened.devLoopPersistence.getHistory(ID)).toEqual(records)
  })

  it.each<PieceStatus>(['pending', 'blocked'])('hydrates committed %s despite unchanged todo header before direct admission', async (status) => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    if (status === 'blocked') await ctx.devLoopLifecycle.transition(ID, 'pending', 'blocked', 'failed check')
    expect(await readFile(f.sourcePath, 'utf8')).toContain('**Status:** todo')
    const reopened = await f.mount()
    expect(reopened.devLoopLifecycle.getStatus(ID)).toBe(status)
  })

  it('waits for intent before effects and holds the synchronous claim against a concurrent CAS', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    const gate = barrier()
    const begin = ctx.devLoopPersistence.beginTransition.bind(ctx.devLoopPersistence)
    vi.spyOn(ctx.devLoopPersistence, 'beginTransition').mockImplementation(async (request) => { await gate.wait(); return begin(request) })
    const auth = await authorization(ctx)
    const first = ctx.devLoopLifecycle.transition(ID, 'todo', 'pending', undefined, undefined, auth)
    const settled = first.then(() => 'settled', () => 'rejected')
    try {
      expect(await Promise.race([gate.entered.then(() => 'intent'), settled])).toBe('intent')
      expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('todo')
      await expect(ctx.devLoopLifecycle.transition(ID, 'todo', 'pending', undefined, undefined, auth))
        .rejects.toMatchObject({ code: 'PIECE_STALE_STATUS' })
      expect(await f.git('status', '--porcelain')).toBe('')
    } finally { gate.release(); await settled }
  })

  it('does not publish status or notification before terminal recording completes', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    const gate = barrier()
    const finish = ctx.devLoopPersistence.finishTransition.bind(ctx.devLoopPersistence)
    vi.spyOn(ctx.devLoopPersistence, 'finishTransition').mockImplementation(async (...args) => { await gate.wait(); return finish(...args) })
    const announcements: string[] = []
    ctx.on('piece/approved', () => { announcements.push('approved') })
    const operation = accept(ctx)
    const settled = operation.then(() => 'settled', () => 'rejected')
    try {
      expect(await Promise.race([gate.entered.then(() => 'terminal'), settled])).toBe('terminal')
      expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('todo')
      expect(announcements).toEqual([])
    } finally { gate.release(); await settled }
    expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('pending')
    expect(announcements).toEqual(['approved'])
  })

  it('failed intent prevents even the completion policy and leaves Git and bytes untouched', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    const original = await readFile(f.sourcePath)
    let policyCalls = 0
    ctx.on('piece/pre-complete', () => { policyCalls++ })
    vi.spyOn(ctx.devLoopPersistence, 'beginTransition').mockRejectedValue(new Error('private write failure'))
    await expect(ctx.devLoopLifecycle.transition(ID, 'pending', 'done')).rejects.toMatchObject({
      code: 'DEV_LOOP_INTENT_WRITE_FAILED', effects: { header: 'none', index: 'none', move: 'none' },
    })
    expect(policyCalls).toBe(0)
    expect(await readFile(f.sourcePath)).toEqual(original)
    expect(await f.git('status', '--porcelain')).toBe('')
    expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('pending')
  })

  it('terminal failure after Git move discloses effects, quarantines, and remains unresolved after remount', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    vi.spyOn(ctx.devLoopPersistence, 'finishTransition').mockRejectedValue(new Error('private terminal write failure'))
    await expect(ctx.devLoopLifecycle.transition(ID, 'pending', 'done')).rejects.toMatchObject({
      code: 'DEV_LOOP_TERMINAL_WRITE_FAILED', effects: { header: 'applied', index: 'applied', move: 'applied' },
    })
    expect(await readFile(f.destinationPath, 'utf8')).toContain('**Status:** done')
    await expect(ctx.devLoopLifecycle.transition(ID, 'pending', 'done')).rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
    const reopened = await f.mount()
    expect(() => reopened.devLoopLifecycle.getStatus(ID)).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
    expect(await reopened.devLoopPersistence.getAnomalies()).toEqual(expect.arrayContaining([
      expect.objectContaining({ pieceId: ID, kind: 'unresolved-intent' }),
    ]))
  })

  it('unjournaled done location is an anomaly rather than completion authorization', async () => {
    const f = await createFixture()
    await mkdir(dirname(f.destinationPath), { recursive: true })
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')).replace('**Status:** todo', '**Status:** done'))
    await rename(f.sourcePath, f.destinationPath)
    const ctx = await f.mount()
    expect(() => ctx.devLoopLifecycle.getStatus(ID)).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
    expect(await ctx.devLoopPersistence.getAnomalies()).toEqual(expect.arrayContaining([
      expect.objectContaining({ pieceId: ID, kind: 'unjournaled-done' }),
    ]))
  })

  it('changed committed source is quarantined on restart rather than inheriting historical acceptance', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')) + '\nChanged implementation requirements.\n')
    const reopened = await f.mount()
    expect(() => reopened.devLoopLifecycle.getStatus(ID)).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
    expect(await reopened.devLoopPersistence.getAnomalies()).toEqual(expect.arrayContaining([
      expect.objectContaining({ pieceId: ID, kind: 'source-changed' }),
    ]))
  })

  it.each(['missing-source', 'duplicate-source'] as const)('%s remains a known unavailable piece rather than being silently dropped', async (kind) => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    if (kind === 'missing-source') await rm(f.sourcePath)
    else {
      await mkdir(dirname(f.destinationPath), { recursive: true })
      await copyFile(f.sourcePath, f.destinationPath)
    }
    const reopening = f.mount()
    await expect(reopening.then(() => undefined)).resolves.toBeUndefined()
    const reopened = await reopening
    expect(() => reopened.devLoopLifecycle.getStatus(ID)).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
    expect(await reopened.devLoopPersistence.getAnomalies()).toEqual(expect.arrayContaining([
      expect.objectContaining({ pieceId: ID, kind }),
    ]))
  })

  it('stale anomaly acknowledgment refuses changed local observations', async () => {
    const f = await createFixture()
    await mkdir(dirname(f.destinationPath), { recursive: true })
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')).replace('**Status:** todo', '**Status:** done'))
    await rename(f.sourcePath, f.destinationPath)
    const ctx = await f.mount()
    const anomalies = await ctx.devLoopPersistence.getAnomalies()
    expect(anomalies).toHaveLength(1)
    await writeFile(f.destinationPath, (await readFile(f.destinationPath, 'utf8')) + '\nChanged anomaly observation.\n')
    await expect(ctx.devLoopPersistence.acknowledgeAnomaly(anomalies[0]!.id,
      { commandId: CommandId('cmd-stale-1'), sessionId: SessionId('root-stale') }, 'I saw the old version', new AbortController().signal))
      .rejects.toMatchObject({ code: 'DEV_LOOP_ANOMALY_STALE' })
    expect((await ctx.devLoopPersistence.getAnomalies())[0]?.acknowledgments).toEqual([])
  })

  it('acknowledgment survives remount but never clears quarantine', async () => {
    const f = await createFixture()
    await mkdir(dirname(f.destinationPath), { recursive: true })
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')).replace('**Status:** todo', '**Status:** done'))
    await rename(f.sourcePath, f.destinationPath)
    const ctx = await f.mount()
    const anomalies = await ctx.devLoopPersistence.getAnomalies()
    expect(anomalies).toHaveLength(1)
    const anomaly = anomalies[0]!
    const acknowledgment = await ctx.devLoopPersistence.acknowledgeAnomaly(anomaly.id,
      { commandId: CommandId('cmd-inspection-1'), sessionId: SessionId('root-inspection') }, 'Inspect only; no repair authorized.', new AbortController().signal)
    expect(acknowledgment.observations).toEqual(anomaly.observations)
    const reopened = await f.mount()
    expect((await reopened.devLoopPersistence.getAnomalies())[0]?.acknowledgments).toEqual([acknowledgment])
    expect(() => reopened.devLoopLifecycle.getStatus(ID)).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  })

  it.each(['before-edit', 'after-edit', 'after-stage', 'after-move'] as const)('cancellation at %s records actual effects rather than inventing rollback', async (checkpoint) => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    const gate = barrier()
    if (checkpoint === 'before-edit' || checkpoint === 'after-edit') {
      const edit = ctx.fs.editText.bind(ctx.fs)
      let first = true
      vi.spyOn(ctx.fs, 'editText').mockImplementation(async (...args) => {
        const selected = first
        first = false
        if (selected && checkpoint === 'before-edit') await gate.wait()
        const result = await edit(...args)
        if (selected && checkpoint === 'after-edit') await gate.wait()
        return result
      })
    } else {
      const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
      vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
        const handle = spawn(spec)
        const selected = spec.argv[0] === 'git' && spec.argv[1] === (checkpoint === 'after-stage' ? 'add' : 'mv')
        return selected ? { ...handle, done: handle.done.then(async (outcome) => { await gate.wait(); return outcome }) } : handle
      })
    }
    const controller = new AbortController()
    const operation = ctx.devLoopLifecycle.transition(ID, 'pending', 'done', undefined, controller.signal)
    const settled = operation.then(() => 'committed', () => 'rejected')
    try {
      expect(await Promise.race([gate.entered.then(() => 'checkpoint'), settled])).toBe('checkpoint')
      controller.abort(new Error(`cancel ${checkpoint}`))
    } finally { gate.release(); await settled }
    expect(await settled).toBe('rejected')
    const records = await ctx.devLoopPersistence.getHistory(ID)
    expect(records).toHaveLength(2)
    expect(records[1]?.terminal).toMatchObject({ kind: 'failed', effects: {
      header: checkpoint === 'before-edit' ? 'none' : 'applied',
      index: checkpoint === 'after-stage' || checkpoint === 'after-move' ? 'applied' : 'none',
      move: checkpoint === 'after-move' ? 'applied' : 'none',
    } })
    if (checkpoint === 'after-move') {
      expect(await readFile(f.destinationPath, 'utf8')).toContain('**Status:** done')
      await expect(ctx.devLoopLifecycle.transition(ID, 'pending', 'done')).rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
    } else {
      expect(await readFile(f.sourcePath, 'utf8')).toContain('**Status:** todo')
      expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('pending')
    }
  })

  it('policy veto records failure, keeps committed pending and releases claim before pending-to-blocked', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    await accept(ctx)
    ctx.on('piece/pre-complete', () => { throw new Error('verification veto') })
    await expect(ctx.devLoopLifecycle.transition(ID, 'pending', 'done')).rejects.toThrow('verification veto')
    await ctx.devLoopLifecycle.transition(ID, 'pending', 'blocked', 'policy refused')
    expect((await ctx.devLoopPersistence.getHistory(ID)).map(row => [row.to, row.terminal?.kind])).toEqual([
      ['pending', 'committed'], ['done', 'failed'], ['blocked', 'committed'],
    ])
    expect(await f.git('status', '--porcelain')).toBe('')
  })

  it('announcement failure cannot erase a durable committed transition on reopen', async () => {
    const f = await createFixture()
    const ctx = await f.mount()
    ctx.on('piece/approved', () => { throw new Error('observer defect') })
    await accept(ctx).catch((error: unknown) => { expect(error).toMatchObject({ message: 'observer defect' }) })
    const reopened = await f.mount()
    expect(reopened.devLoopLifecycle.getStatus(ID)).toBe('pending')
    expect((await reopened.devLoopPersistence.getHistory(ID))[0]?.terminal?.kind).toBe('committed')
  })

  it('complete UTF-8 record overflow rejects before visible mutation', async () => {
    const f = await createFixture()
    const ctx = await f.mount({ maxRecordBytes: 1024 })
    await expect(ctx.devLoopLifecycle.transition(ID, 'todo', 'pending', '界'.repeat(1024), undefined, await authorization(ctx)))
      .rejects.toMatchObject({ code: 'DEV_LOOP_RECORD_TOO_LARGE' })
    expect(ctx.devLoopLifecycle.getStatus(ID)).toBe('todo')
    expect(await ctx.devLoopPersistence.getHistory(ID)).toEqual([])
  })
})
