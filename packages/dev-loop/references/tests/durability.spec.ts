/** Real JSON persistence and deterministic lifetime barriers for References. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import { expect, it } from 'vitest'
import { fixture, pieceId, signal, three } from './harness.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const barrier = () => Promise.withResolvers<undefined>()

/** Observe only this host's real References unit; every unblocked operation delegates. */
function interceptUnit(ctx: Context, wrap: (unit: KvUnit) => KvUnit) {
  const kv = ctx.get('storage')!.backend.get('json').kv!
  const open = kv.open.bind(kv)
  kv.open = async (descriptor) => {
    const unit = await open(descriptor)
    return descriptor.name === 'dev_loop_references' ? wrap(unit) : unit
  }
}

it('reopens the durable observation and refreshes exact piece and source fingerprints only on verification', async () => {
  await fixture(three('`source.txt`'), async (f) => {
    const source = join(f.repo, 'source.txt')
    await writeFile(source, 'first source\n')
    const before = await f.references.verifyReferences(pieceId, signal())
    expect(before.pieceSha256).toBe(sha(await readFile(f.filename, 'utf8')))
    expect(before.entries[0]!.contentSha256).toBe(sha('first source\n'))
    await f.ctx.fiber.dispose()
    const ctx = await f.mount()
    const references = await f.mountReferences(ctx)
    expect(await references.getProvenance(pieceId)).toEqual(before)
    const text = await f.setReferences(three('`source.txt`', 'Parent direct inspection', 'Changed decision'))
    await writeFile(source, 'other source\n')
    expect(await references.getProvenance(pieceId)).toEqual(before)
    const after = await references.verifyReferences(pieceId, signal())
    expect(after.pieceSha256).toBe(sha(text))
    expect(after.pieceSha256).not.toBe(before.pieceSha256)
    expect(after.entries[0]!.contentSha256).toBe(sha('other source\n'))
    expect(await references.getProvenance(pieceId)).toEqual(after)
  })
})

it('detaches verification and query results including nested entry metadata', async () => {
  await fixture(three('`source.txt:1`'), async (f) => {
    await writeFile(join(f.repo, 'source.txt'), 'source\n')
    const result = await f.references.verifyReferences(pieceId, signal())
    const expected = structuredClone(result)
    const first = await f.references.getProvenance(pieceId)
    expect(first).toEqual(expected)
    expect(first).not.toBe(result)
    expect(first!.entries[0]).not.toBe(result.entries[0])
    expect(first!.entries[0]!.explanatoryColumns).not.toBe(result.entries[0]!.explanatoryColumns)
    expect(first!.entries[0]!.lineRange).not.toBe(result.entries[0]!.lineRange)
    // Frozen detached DTOs may reject mutation; writable detached DTOs must not affect the owner.
    Reflect.set(result.entries[0]!, 'source', 'forged.txt')
    Reflect.set(first!.entries[0]!.lineRange!, 'end', 999)
    Reflect.set(first!.entries[0]!.explanatoryColumns, 'Decision informed', 'forged')
    expect(await f.references.getProvenance(pieceId)).toEqual(expected)
    await f.ctx.fiber.dispose()
    const ctx = await f.mount()
    expect(await (await f.mountReferences(ctx)).getProvenance(pieceId)).toEqual(expected)
  })
})

it.each([
  ['invalid fingerprint', (record: Record<string, unknown>) => { record.pieceSha256 = 'not-a-sha256' }],
  ['invalid inspection claim', (record: Record<string, unknown>) => { record.inspectionStatus = 'verified' }],
  ['invalid entries', (record: Record<string, unknown>) => { record.entries = [{ sourceStatus: 'invented' }] }],
] as const)('refuses authoritative JSON with %s rather than skipping or replacing it', async (_name, damage) => {
  await fixture('None.', async (f) => {
    await f.references.verifyReferences(pieceId, signal())
    await f.ctx.fiber.dispose()
    const filename = join(f.data, 'dev_loop_references.json')
    const stored = JSON.parse(await readFile(filename, 'utf8')) as {
      tables: Record<string, Record<string, Record<string, unknown>>>
    }
    const records = Object.values(stored.tables).flatMap(table => Object.values(table))
    expect(records).toHaveLength(1)
    damage(records[0]!)
    const corrupt = JSON.stringify(stored)
    await writeFile(filename, corrupt)
    const ctx = await f.mount()
    await expect((async () => {
      const references = await f.mountReferences(ctx)
      await references.getProvenance(pieceId)
    })()).rejects.toThrow(/invalid|record|schema|validation/i)
    expect(await readFile(filename, 'utf8')).toBe(corrupt)
  })
})

it('rejects a backend write failure without publishing and preserves the prior observation on reopen', async () => {
  await fixture('None.', async (f) => {
    const prior = await f.references.verifyReferences(pieceId, signal())
    await f.ctx.fiber.dispose()
    const ctx = await f.mount()
    const failure = new Error('selected References backend write failure')
    let writes = 0
    interceptUnit(ctx, unit => ({
      loadAll: () => unit.loadAll(),
      putRecord: async () => { writes++; throw failure },
      deleteRecord: (table, key) => unit.deleteRecord(table, key),
      setGlobal: value => unit.setGlobal(value),
      close: () => unit.close(),
    }))
    const references = await f.mountReferences(ctx)
    await f.setReferences('No references.')
    await expect(references.verifyReferences(pieceId, signal())).rejects.toThrow(failure.message)
    expect(writes).toBe(1)
    expect(await references.getProvenance(pieceId)).toEqual(prior)
    await ctx.fiber.dispose()
    const reopened = await f.mount()
    expect(await (await f.mountReferences(reopened)).getProvenance(pieceId)).toEqual(prior)
  })
})

it('serializes verification through the durable write before reading the next piece version', async () => {
  await fixture('None.', async (f) => {
    await f.ctx.fiber.dispose()
    const ctx = await f.mount()
    const entered = barrier(), release = barrier()
    const events: string[] = []
    const directory = ctx.get('devLoopDirectory')!
    const getPiece = directory.getPiece.bind(directory)
    let reads = 0
    directory.getPiece = async (...args) => {
      events.push(`piece-read-${++reads}`)
      return getPiece(...args)
    }
    let writes = 0
    interceptUnit(ctx, unit => ({
      loadAll: () => unit.loadAll(),
      putRecord: async (table, key, value) => {
        const write = ++writes
        if (write === 1) { entered.resolve(undefined); await release.promise }
        await unit.putRecord(table, key, value)
        events.push(`write-durable-${write}`)
      },
      deleteRecord: (table, key) => unit.deleteRecord(table, key),
      setGlobal: value => unit.setGlobal(value), close: () => unit.close(),
    }))
    const references = await f.mountReferences(ctx)
    const first = references.verifyReferences(pieceId, signal())
    let second: ReturnType<typeof references.verifyReferences> | undefined
    try {
      await Promise.race([entered.promise, first])
      expect(writes).toBe(1)
      second = references.verifyReferences(pieceId, signal())
      // Attach rejection handling before yielding while the first write is blocked.
      void second.catch(() => undefined)
      const currentText = await f.setReferences('No references.')
      expect(writes).toBe(1)
      release.resolve(undefined)
      const [a, b] = await Promise.all([first, second])
      expect(events).toEqual(['piece-read-1', 'write-durable-1', 'piece-read-2', 'write-durable-2'])
      expect(a.pieceSha256).not.toBe(b.pieceSha256)
      expect(b.pieceSha256).toBe(sha(currentText))
      expect(await references.getProvenance(pieceId)).toEqual(b)
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([first, ...(second ? [second] : [])])
    }
  })
})

it('honors pre-read cancellation without resolving files or publishing an observation', async () => {
  await fixture('None.', async (f) => {
    const fs = f.ctx.get('fs')!
    const resolve = fs.resolve.bind(fs)
    let reads = 0
    fs.resolve = async (...args) => { reads++; return resolve(...args) }
    const controller = new AbortController()
    controller.abort(new Error('cancel before reading References'))
    await expect(f.references.verifyReferences(pieceId, controller.signal)).rejects.toThrow(/cancel before reading|abort/i)
    expect(reads).toBe(0)
    expect(await f.references.getProvenance(pieceId)).toBeUndefined()
  })
})

it('cancels at a source barrier without checking later sources or publishing', async () => {
  await fixture(`${three('`first.txt`')}\n| \`second.txt\` | Direct inspection | another decision |`, async (f) => {
    await writeFile(join(f.repo, 'first.txt'), 'first\n')
    await writeFile(join(f.repo, 'second.txt'), 'second\n')
    const fs = f.ctx.get('fs')!
    const resolve = fs.resolve.bind(fs)
    const entered = barrier(), release = barrier()
    const checked: string[] = []
    fs.resolve = async (path, options) => {
      if (path.endsWith('first.txt')) { checked.push('first'); entered.resolve(undefined); await release.promise }
      if (path.endsWith('second.txt')) checked.push('second')
      return resolve(path, options)
    }
    const controller = new AbortController()
    const operation = f.references.verifyReferences(pieceId, controller.signal)
    try {
      await Promise.race([entered.promise, operation])
      expect(checked).toEqual(['first'])
      controller.abort(new Error('cancel at source barrier'))
      release.resolve(undefined)
      await expect(operation).rejects.toThrow(/cancel at source barrier|abort/i)
      expect(checked).toEqual(['first'])
      expect(await f.references.getProvenance(pieceId)).toBeUndefined()
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([operation])
    }
  })
})

it('drains an admitted write despite cancellation and disposal before closing the domain', async () => {
  await fixture('None.', async (f) => {
    await f.ctx.fiber.dispose()
    const ctx = await f.mount()
    const entered = barrier(), release = barrier()
    const events: string[] = []
    interceptUnit(ctx, unit => ({
      loadAll: () => unit.loadAll(),
      putRecord: async (table, key, value) => {
        events.push('write-entered'); entered.resolve(undefined); await release.promise
        await unit.putRecord(table, key, value); events.push('write-durable')
      },
      deleteRecord: (table, key) => unit.deleteRecord(table, key),
      setGlobal: value => unit.setGlobal(value),
      close: async () => { events.push('close'); await unit.close() },
    }))
    const references = await f.mountReferences(ctx)
    const controller = new AbortController()
    const operation = references.verifyReferences(pieceId, controller.signal)
    let disposing: Promise<unknown> | undefined
    try {
      await Promise.race([entered.promise, operation])
      expect(events).toEqual(['write-entered'])
      controller.abort(new Error('cancel after write admission'))
      disposing = ctx.fiber.dispose()
      void disposing.catch(() => undefined)
      release.resolve(undefined)
      await Promise.allSettled([operation])
      await disposing
      expect(events).toEqual(['write-entered', 'write-durable', 'close'])
      const reopened = await f.mount()
      const durable = await (await f.mountReferences(reopened)).getProvenance(pieceId)
      expect(durable).toMatchObject({ pieceId, explicitEmpty: true, structuralStatus: 'valid' })
      expect(durable!.pieceSha256).toBe(sha(await readFile(f.filename, 'utf8')))
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([operation, ...(disposing ? [disposing] : [])])
    }
  })
})

it('refuses verification and queries through a stale service after disposal', async () => {
  await fixture('None.', async (f) => {
    const stale = f.references
    await f.ctx.fiber.dispose()
    await expect(stale.verifyReferences(pieceId, signal())).rejects.toThrow(/closed|dispos|stopp/i)
    await expect(stale.getProvenance(pieceId)).rejects.toThrow(/closed|dispos|stopp/i)
  })
})
