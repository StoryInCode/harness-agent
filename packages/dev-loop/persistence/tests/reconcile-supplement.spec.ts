/** Reconciliation refuses incomplete reads without publishing partial anomaly observations. */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createFixture } from './harness.ts'

it.each(['remove', 'replace', 'abort'])('refuses a source that changes at the completed-read checkpoint: %s', async (action) => {
  const f = await createFixture()
  const ctx = await f.mount()
  const target = await ctx.fs.resolve(f.sourcePath)
  const controller = new AbortController()
  const read = ctx.fs.readText.bind(ctx.fs)
  let observed = false
  const spy = vi.spyOn(ctx.fs, 'readText').mockImplementation(async (...args) => {
    const content = await read(...args)
    if (!observed && args[0].targetKey === target.targetKey) {
      observed = true
      if (action === 'remove') await rm(f.sourcePath)
      else if (action === 'replace') await writeFile(f.sourcePath, `${content}\nchanged after complete read\n`)
      else controller.abort(new Error('cancelled at actual complete read'))
    }
    return content
  })
  onTestFinished(() => { spy.mockRestore() })
  await expect(ctx.devLoopPersistence.loadLifecycle(controller.signal)).rejects.toThrow()
  expect(observed).toBe(true)
  expect(await ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
  expect(await ctx.devLoopPersistence.getAnomalies()).toEqual([])
})

it('propagates an actual missing source read rather than interpreting it as a malformed document', async () => {
  const f = await createFixture()
  const ctx = await f.mount()
  const target = await ctx.fs.resolve(f.sourcePath)
  const original = await readFile(f.sourcePath)
  const read = ctx.fs.readText.bind(ctx.fs)
  const spy = vi.spyOn(ctx.fs, 'readText').mockImplementation(async (...args) => {
    if (args[0].targetKey === target.targetKey) await rm(f.sourcePath)
    return read(...args)
  })
  onTestFinished(() => { spy.mockRestore() })
  await expect(ctx.devLoopPersistence.loadLifecycle(new AbortController().signal)).rejects.toMatchObject({ code: 'FS_NOT_FOUND' })
  expect(await ctx.devLoopPersistence.getAnomalies()).toEqual([])
  spy.mockRestore()
  await writeFile(f.sourcePath, original)
  expect((await ctx.devLoopPersistence.loadLifecycle(new AbortController().signal)).pieces).toHaveLength(1)
})
