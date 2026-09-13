/** Backend withdrawal must await dependent terminal writes on captured units. */
import { expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '../src/index.ts'
import { barrier, loadDrainComposition } from './provider-drain-loader.ts'

it.each(['provider removal', 'root disposal'])('keeps JSON units writable through consumer drain: %s', async (mode) => {
  const entered = barrier()
  const release = barrier()
  const errors: unknown[] = []
  const events: string[] = []
  let disposed = 0
  let closes = 0
  const descriptor = { name: 'terminal', version: 1, tables: ['records'], hasGlobal: false }
  const consumer = {
    name: 'drain-consumer',
    inject: ['storage', storageBackendServiceKey('json')],
    async apply(ctx: Context) {
      const backend = ctx.storage.backend.get('json')
      const unit = await backend.kv!.open(descriptor)
      await unit.putRecord('records', 'work', { state: 'running' })
      const close = backend.close.bind(backend)
      backend.close = async () => { closes++; events.push('backend-close'); await close() }
      ctx.effect(() => async () => {
        entered.release()
        await release.promise
        try {
          await unit.putRecord('records', 'work', { state: 'terminal' })
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
  const fixture = await loadDrainComposition(consumer, false)
  let disposal: Promise<unknown> | undefined
  try {
    const hub = fixture.ctx.storage
    expect(hub.backend.get('json')).toBeDefined()
    const entry = [...fixture.ctx.loader.entries()].find(e => e.options.id === 'json')!
    disposal = mode === 'root disposal'
      ? fixture.ctx.fiber.dispose()
      : entry.parent.tree.remove(entry.options.id)
    await entered.promise
    expect.soft(closes).toBe(0)
    expect.soft(disposed).toBe(0)
    release.release()
    await disposal
    expect.soft(errors).toEqual([])
    expect.soft(events).toEqual(['terminal-write', 'consumer-drained', 'backend-close'])
    expect.soft(disposed).toBe(1)
    expect.soft(closes).toBe(1)
    expect.soft(() => hub.backend.get('json')).toThrow()
    const reopened = new JsonStorageBackend(fixture.media)
    try {
      const unit = await reopened.kv.open(descriptor)
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
