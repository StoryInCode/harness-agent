/** Domain fallback close must follow its dependent consumer's awaited disposal. */
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { defineDomain, descriptorOf, domainTable } from '../src/index.ts'
import { barrier, loadDrainComposition } from '../../storage-json/tests/provider-drain-loader.ts'

it.each(['provider removal', 'root disposal'])('keeps a captured table writable through consumer drain: %s', async (mode) => {
  const entered = barrier()
  const release = barrier()
  const errors: unknown[] = []
  const events: string[] = []
  let disposed = 0
  let closes = 0
  const spec = defineDomain({
    name: 'terminal', version: 1,
    tables: { records: domainTable<string, { state: string }>(z.object({ state: z.string() })) },
  })
  const consumer = {
    name: 'drain-consumer',
    inject: ['storageDomain'],
    async apply(ctx: Context) {
      const domain = await ctx.storageDomain.open(spec)
      const table = domain.table('records')
      await table.put('work', { state: 'running' })
      const close = domain.close.bind(domain)
      domain.close = async () => { closes++; events.push('domain-close'); await close() }
      ctx.effect(() => async () => {
        entered.release()
        await release.promise
        try {
          await table.put('work', { state: 'terminal' })
          events.push('terminal-write')
        } catch (error) {
          errors.push(error)
        } finally {
          disposed++
          events.push('consumer-drained')
        }
      })
    },
  }
  const fixture = await loadDrainComposition(consumer, true)
  let disposal: Promise<unknown> | undefined
  try {
    const hub = fixture.ctx.storage
    const facility = fixture.ctx.storageDomain
    const backend = hub.backend.get('json')
    const entry = [...fixture.ctx.loader.entries()].find(e => e.options.id === 'domain')!
    disposal = mode === 'root disposal'
      ? fixture.ctx.fiber.dispose()
      : entry.parent.tree.remove(entry.options.id)
    await entered.promise
    expect.soft(closes).toBe(0)
    expect.soft(disposed).toBe(0)
    release.release()
    await disposal
    expect.soft(errors).toEqual([])
    expect.soft(events).toEqual(['terminal-write', 'consumer-drained', 'domain-close'])
    expect.soft(disposed).toBe(1)
    expect.soft(closes).toBe(1)
    expect.soft(facility.get(spec.name)).toBeUndefined()
    expect.soft(() => hub.form('domain')).toThrow()
    if (mode === 'provider removal') expect.soft(hub.backend.get('json')).toBe(backend)
    else expect.soft(() => hub.backend.get('json')).toThrow()
    const reopened = new JsonStorageBackend(fixture.media)
    try {
      const unit = await reopened.kv.open(descriptorOf(spec))
      expect((await unit.loadAll()).tables['records']).toEqual({ work: { state: 'terminal' } })
    } finally {
      await reopened.close()
    }
  } finally {
    release.release()
    await disposal
    await fixture.cleanup()
  }
})
