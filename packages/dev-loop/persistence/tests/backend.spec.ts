/** Instance-local barriers delegate actual JSON unit writes; no replacement persistence provider. */
import { createHash } from 'node:crypto'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import type { HumanAuthorization, SourceDigest } from '../src/types.ts'
import { createFixture } from './harness.ts'

function barrier() {
  let release!: () => void
  let enter!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  return { entered, release, wait: async () => { enter(); await held } }
}

async function accept(ctx: Context, signal?: AbortSignal) {
  const piece = await ctx.devLoopDirectory.getPiece('00.12')
  const target = await ctx.fs.resolve(piece.path)
  const stat = await ctx.fs.stat(target)
  if (!stat) throw new Error('missing fixture')
  const text = await ctx.fs.readText(target)
  const digest = createHash('sha256').update(text).digest('hex') as SourceDigest
  const authorization: HumanAuthorization = { kind: 'command', commandId: CommandId('cmd-backend-1'), sessionId: SessionId('backend-root'),
    decision: 'accept', source: { path: piece.path, version: stat.version, rawDigest: digest, contentDigest: digest } }
  return ctx.devLoopLifecycle.transition('00.12', 'todo', 'pending', undefined, signal, authorization)
}

function intercept(ctx: Context, put: (args: Parameters<KvUnit['putRecord']>, next: () => Promise<void>) => Promise<void>, closing?: () => void) {
  const kv = ctx.storage.backend.get('json').kv
  if (!kv) throw new Error('real JSON KV facet is required')
  const open = kv.open.bind(kv)
  const spy = vi.spyOn(kv, 'open').mockImplementation(async (descriptor) => {
    const unit = await open(descriptor)
    if (descriptor.name === 'dev_loop') {
      const write = unit.putRecord.bind(unit)
      vi.spyOn(unit, 'putRecord').mockImplementation((...args) => put(args, () => write(...args)))
      const close = unit.close.bind(unit)
      vi.spyOn(unit, 'close').mockImplementation(async () => { closing?.(); await close() })
    }
    return unit
  })
  ctx.effect(() => () => { spy.mockRestore() })
}

it('cancellation during actual intent write waits for admitted recording then refuses publication', async () => {
  const f = await createFixture()
  const gate = barrier()
  let armed = false
  const ctx = await f.mount({ beforePersistence: (context) => {
    intercept(context, async (_args, next) => {
      if (armed) { armed = false; await gate.wait() }
      await next()
    })
  } })
  armed = true
  const controller = new AbortController()
  const operation = accept(ctx, controller.signal)
  const settled = operation.then(() => 'committed', () => 'rejected')
  try {
    expect(await Promise.race([gate.entered.then(() => 'write'), settled])).toBe('write')
    controller.abort(new Error('cancel while actual storage write is held'))
    expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('todo')
  } finally { gate.release(); await settled }
  expect(await settled).toBe('rejected')
  expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('todo')
  expect(await f.git('status', '--porcelain')).toBe('')
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  expect(history).toHaveLength(1)
  expect(history[0]?.terminal).toMatchObject({ kind: 'failed', effects: { header: 'none', index: 'none', move: 'none' } })
})

it('disposal joins a non-done transition held inside the JSON writer before closing its unit', async () => {
  const f = await createFixture()
  const gate = barrier()
  const order: string[] = []
  let armed = false
  const ctx = await f.mount({ beforePersistence: (context) => {
    intercept(context, async (_args, next) => {
      if (armed) { armed = false; order.push('write-start'); await gate.wait() }
      await next()
      order.push('write-end')
    }, () => { order.push('close') })
  } })
  armed = true
  const operation = accept(ctx)
  const settled = operation.then(() => 'committed', () => 'rejected')
  let disposal: Promise<void> | undefined
  try {
    expect(await Promise.race([gate.entered.then(() => 'write'), settled])).toBe('write')
    disposal = ctx.fiber.dispose()
  } finally { gate.release(); await settled; await disposal }
  expect(order).toContain('close')
  expect(order.lastIndexOf('write-end')).toBeLessThan(order.indexOf('close'))
  const reopened = await f.mount()
  expect(reopened.devLoopLifecycle.getStatus('00.12')).toBe('todo')
  expect((await reopened.devLoopPersistence.getHistory('00.12'))[0]?.terminal?.kind).toBe('failed')
})

it('malformed authoritative JSON refuses opening without backup-and-skip or overwriting the bytes', async () => {
  const f = await createFixture()
  const filename = join(f.storageRoot, 'dev_loop.json')
  const malformed = '{"authoritative": broken JSON'
  await writeFile(filename, malformed)
  await expect(f.mount().then(() => undefined)).rejects.toThrow(/not valid JSON/)
  expect(await readFile(filename, 'utf8')).toBe(malformed)
})

it.each([
  { id: 'invalid', pieceId: '00.12', sequence: 1, to: 'done', terminal: { kind: 'committed' } },
  { id: 'invalid', pieceId: '00.12', sequence: -1, from: 'done', to: 'pending' },
  { id: 'invalid', pieceId: '00.12', sequence: 1, authorization: { approved: true } },
])('schema-invalid authoritative transition refuses the whole domain: %j', async (record) => {
  const f = await createFixture()
  const filename = join(f.storageRoot, 'dev_loop.json')
  const text = JSON.stringify({ unit: { name: 'dev_loop', version: 1 }, global: null,
    tables: { transitions: { invalid: record }, anomalies: {} } })
  await writeFile(filename, text)
  await expect(f.mount().then(() => undefined)).rejects.toThrow(/transitions|invalid.record/)
  expect(await readFile(filename, 'utf8')).toBe(text)
})

it('required entry dependency keeps Lifecycle unavailable while the actual dev_loop domain is opening', async () => {
  const f = await createFixture()
  const gate = barrier()
  let context: Context | undefined
  const mounting = f.mount({ beforePersistence: (ctx) => {
    context = ctx
    const kv = ctx.storage.backend.get('json').kv!
    const open = kv.open.bind(kv)
    vi.spyOn(kv, 'open').mockImplementation(async (descriptor) => {
      if (descriptor.name === 'dev_loop') await gate.wait()
      return open(descriptor)
    })
  } })
  const settled = mounting.then(() => 'mounted', () => 'rejected')
  try {
    expect(await Promise.race([gate.entered.then(() => 'opening'), settled])).toBe('opening')
    expect(context?.get('devLoopLifecycle')).toBeUndefined()
  } finally { gate.release(); await settled }
  expect(await settled).toBe('mounted')
})

it('copying authoritative records to a different repository refuses foreign identity rather than adopting pending', async () => {
  const original = await createFixture()
  const ctx = await original.mount()
  await accept(ctx)
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toHaveLength(1)
  await ctx.fiber.dispose()
  const foreign = await createFixture()
  await copyFile(join(original.storageRoot, 'dev_loop.json'), join(foreign.storageRoot, 'dev_loop.json'))
  await expect(foreign.mount().then(() => undefined)).rejects.toThrow(/repository/i)
})

it('record cap accepts the exact complete retained JSON byte size and refuses one byte less on reopen', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  await accept(ctx)
  const rows = await ctx.devLoopPersistence.getHistory('00.12')
  expect(rows).toHaveLength(1)
  const bytes = Buffer.byteLength(JSON.stringify(rows[0]), 'utf8')
  const exact = await f.mount({ maxRecordBytes: bytes })
  expect(exact.devLoopLifecycle.getStatus('00.12')).toBe('pending')
  await expect(f.mount({ maxRecordBytes: bytes - 1 }).then(() => undefined)).rejects.toThrow(/maxRecordBytes|record.*large/i)
})

it('history cap rejects another transition before writing or publishing it', async () => {
  const f = await createFixture()
  const ctx = await f.mount({ maxHistoryRecords: 1 })
  await accept(ctx)
  await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'blocked', 'second attempt'))
    .rejects.toMatchObject({ code: 'DEV_LOOP_HISTORY_LIMIT' })
  expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe('pending')
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toHaveLength(1)
})
