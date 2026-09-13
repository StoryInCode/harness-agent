import { Context, type Plugin } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

/** Public framework regressions for dependency teardown during terminal disposal. */
describe('Cordis terminal dependency drain', () => {
  for (const mode of ['root', 'simultaneous', 'chain', 'nested', 'registry-delete'] as const) {
    it(`joins terminal consumers before resource close: ${mode}`, async () => {
      const root = new Context()
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      const withdrawn = Promise.withResolvers<undefined>()
      const independent = Promise.withResolvers<undefined>()
      const events: string[] = []
      let closing: Promise<unknown> | undefined
      const provider = await root.plugin((ctx) => {
        ctx.effect(() => {
          // The public provide declaration erases its asynchronous disposer result.
          const unprovide: () => unknown = ctx.provide('drain-source', {})
          return [() => { events.push('close') }, unprovide, () => { withdrawn.resolve(undefined) }]
        })
      })
      const middle = mode === 'chain' ? await root.plugin({
        inject: ['drain-source'],
        apply(ctx) {
          ctx.effect(() => {
            const unprovide = ctx.provide('drain-middle', {})
            return [() => { events.push('middle-close') }, unprovide]
          })
        },
      }) : undefined
      const group = mode === 'nested' ? await root.plugin(() => {}) : undefined
      const consumerPlugin: Plugin = {
        inject: [middle ? 'drain-middle' : 'drain-source'],
        apply(ctx) {
          ctx.effect(() => async () => {
            events.push('terminal')
            entered.resolve(undefined)
            await release.promise
            events.push('drained')
          })
        },
      }
      const consumer = await (group?.ctx ?? root).plugin(consumerPlugin)
      await root.plugin((ctx) => {
        ctx.effect(() => () => { independent.resolve(undefined) })
      })
      try {
        if (mode === 'root' || mode === 'chain' || mode === 'nested') {
          closing = root.fiber.dispose()
          await independent.promise
        } else {
          if (mode === 'registry-delete') {
            const runtime = root.registry.get(consumerPlugin)
            expect(root.registry.delete(consumerPlugin)).toBe(runtime)
            expect(root.registry.get(consumerPlugin)).toBeUndefined()
            expect(root.registry.has(consumerPlugin)).toBe(false)
          } else {
            closing = Promise.resolve(consumer.dispose())
          }
          await entered.promise
          closing = Promise.all([closing, provider.dispose()])
        }
        await entered.promise
        await withdrawn.promise
        expect(root.reflect.notify([middle ? 'drain-middle' : 'drain-source'])).toContain(consumer)
      } finally {
        release.resolve(undefined)
        await closing
        await consumer.await()
        await root.fiber.dispose()
      }
      expect(events.indexOf('terminal')).toBeLessThan(events.indexOf('drained'))
      expect(events.indexOf('drained')).toBeLessThan(events.indexOf('close'))
      if (middle) expect(events.indexOf('drained')).toBeLessThan(events.indexOf('middle-close'))
      expect(consumer.uid).toBeNull()
      expect(root.registry.has(consumerPlugin)).toBe(false)
      expect([...root.registry.values()].flatMap(runtime => [...runtime.fibers])).toEqual([])
    })
  }

  it('keeps a re-registered runtime after the deleted runtime finishes draining', async () => {
    const root = new Context()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let executions = 0
    const plugin = (ctx: Context) => {
      executions += 1
      if (executions !== 1) return
      ctx.effect(() => async () => {
        entered.resolve(undefined)
        await release.promise
      })
    }
    const oldFiber = await root.plugin(plugin)
    const oldRuntime = root.registry.get(plugin)
    let replacement: Awaited<ReturnType<Context['plugin']>> | undefined
    try {
      expect(root.registry.delete(plugin)).toBe(oldRuntime)
      expect(root.registry.delete(plugin)).toBeUndefined()
      expect(root.registry.get(plugin)).toBeUndefined()
      await entered.promise
      replacement = await root.plugin(plugin)
      expect(root.registry.get(plugin)).not.toBe(oldRuntime)
      release.resolve(undefined)
      await oldFiber.await()
      expect(root.registry.get(plugin)).toBe(replacement.runtime)
      expect(root.registry.has(plugin)).toBe(true)
      expect(executions).toBe(2)
    } finally {
      release.resolve(undefined)
      await oldFiber.await()
      await root.fiber.dispose()
    }
    expect(root.registry.has(plugin)).toBe(false)
  })

  it('does not reactivate a terminal consumer when its service is republished during cleanup', async () => {
    const root = new Context()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let executions = 0
    const unprovide: () => unknown = root.provide('republished-drain', {})
    const plugin = {
      inject: ['republished-drain'],
      apply(ctx: Context) {
        executions += 1
        ctx.effect(() => async () => {
          entered.resolve(undefined)
          await release.promise
        })
      },
    }
    const consumer = await root.plugin(plugin)
    const disposing = consumer.dispose()
    let withdrawal: Promise<unknown> | undefined
    try {
      await entered.promise
      expect(consumer.uid).toBeNull()
      expect(() => consumer.ctx.plugin(() => {})).toThrow()
      withdrawal = Promise.resolve(unprovide())
      root.provide('republished-drain', {})
    } finally {
      release.resolve(undefined)
      await disposing
      await withdrawal
      await root.fiber.dispose()
    }
    expect(executions).toBe(1)
    expect(root.registry.has(plugin)).toBe(false)
  })
})
