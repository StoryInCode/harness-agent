/** Complete UTF-8 result bounds and cancellation at observed filesystem/transition waits. */
import { describe, expect, it, vi } from 'vitest'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import * as command from '../src/index.ts'
import { deferred, digest, fixture } from './harness.ts'

function bytes(execution: CommandExecution | undefined): number {
  expect(execution).toBeDefined()
  return Buffer.byteLength(JSON.stringify(execution!.result), 'utf8')
}

function expectOverflow(execution: CommandExecution | undefined, limit: number): void {
  expect(execution?.result.kind).toBe('error')
  expect(execution?.result.text).toMatch(/output|size|large|limit|bytes/i)
  expect(bytes(execution)).toBeLessThanOrEqual(limit)
}

describe('dev-loop configured budgets', () => {
  it.each(['maxInputBytes', 'maxOutputBytes'] as const)('requires safe positive integer %s at config admission', (key) => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => command.Config({ maxInputBytes: 4096, maxOutputBytes: 65536, [key]: value }), String(value)).toThrow()
    }
    const other = key === 'maxInputBytes' ? 'maxOutputBytes' : 'maxInputBytes'
    // Config input originates in untyped YAML; this deliberately omits one required field.
    expect(() => command.Config({ [other]: 4096 } as unknown as command.Config)).toThrow()
  })

  it('refuses a tiny output budget at Loader mount instead of emitting an impossible useful error', async () => {
    await expect(fixture({ config: { maxOutputBytes: 1 } }).then(() => undefined))
      .rejects.toThrow(/config|maxOutputBytes|minimum|small|bytes/i)
  })

  it('derives the exact minimum from its fixed complete refusal, including the CommandResult wrapper', async () => {
    const f = await fixture({ config: { maxOutputBytes: 256 } })
    const overflow = await f.call('show 00.03')
    expectOverflow(overflow, 256)
    const minimum = bytes(overflow)
    expect(minimum).toBeGreaterThan(32)
    expect(() => command.Config({ maxInputBytes: 4096, maxOutputBytes: minimum - 1 })).toThrow()
    const exact = await fixture({ config: { maxOutputBytes: minimum } })
    const result = await exact.call('show 00.03')
    expectOverflow(result, minimum)
    expect(result?.result).toEqual(overflow?.result)
    expect(bytes(result)).toBe(minimum)
  })

  it('bounds raw input bytes, counting runtime-preserved separator whitespace and multibyte reasons', async () => {
    const reason = 'π🧪'.repeat(12)
    const raw = `reject 00.03 ${reason}`
    const limit = Buffer.byteLength(` ${raw}`, 'utf8')
    const exact = await fixture({ seeds: [{ id: '00.03', status: 'pending' }], config: { maxInputBytes: limit } })
    expect((await exact.call(raw))?.result.kind).toBe('success')
    expect(exact.lifecycle.getStatus('00.03')).toBe('blocked')
    const short = await fixture({ seeds: [{ id: '00.03', status: 'pending' }], config: { maxInputBytes: limit - 1 } })
    const rejected = await short.call(raw)
    expect(rejected?.result.kind).toBe('error')
    expect(rejected?.result.text).toMatch(/input|bytes|limit/i)
    expect(short.transition).not.toHaveBeenCalled()
  })

  it('allows an exact complete UTF-8 show but refuses one byte less without leaking a digest or partial review', async () => {
    const f = await fixture()
    const review = await f.call('show 00.03')
    expect(review?.result.kind).toBe('success')
    const limit = bytes(review)
    const exact = await fixture({ config: { maxOutputBytes: limit } })
    const full = await exact.call('show 00.03')
    expect(full?.result.kind).toBe('success')
    expect(full?.result.text).toContain(exact.sources.get('00.03')!)
    expect(full?.result.text).toContain(digest(exact.sources.get('00.03')!))
    expect(bytes(full)).toBe(limit)
    const short = await fixture({ config: { maxOutputBytes: limit - 1 } })
    const rejected = await short.call('show 00.03')
    expectOverflow(rejected, limit - 1)
    expect(rejected?.result.text).not.toContain(digest(short.sources.get('00.03')!))
    expect(rejected?.result.text).not.toContain('# 00.03')
    expect(short.transition).not.toHaveBeenCalled()
  })

  it.each(['help', 'frobnicate', 'list'] as const)('bounds complete %s including usage and result wrappers', async (route) => {
    const seeds = Array.from({ length: 20 }, (_, i) => ({ id: `00.${String(i + 1).padStart(2, '0')}` }))
    const full = await fixture({ seeds })
    const baseline = await full.call(route)
    expect(baseline?.result.kind).toBe(route === 'frobnicate' ? 'error' : 'success')
    if (route === 'frobnicate') expect(baseline?.result.text).toMatch(/unknown|unsupported/i)
    const f = await fixture({ config: { maxOutputBytes: 256 }, seeds })
    const result = await f.call(route)
    expect(bytes(result)).toBeLessThanOrEqual(256)
    if (bytes(baseline) > 256) expectOverflow(result, 256)
    else expect(result?.result).toEqual(baseline?.result)
  })
})

describe('dev-loop cancellation and review rechecks', () => {
  it('preserves runtime pre-abort rejection without entering the source or Lifecycle', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const reason = new Error('owner cancelled before dispatch')
    controller.abort(reason)
    const before = f.agent.session.snapshotEvents().length
    await expect(f.call('show 00.03', f.agent, controller.signal)).rejects.toBe(reason)
    expect(f.agent.session.snapshotEvents()).toHaveLength(before)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['show', 'approve'] as const)('%s forwards the live signal through filesystem reads and stops after cancellation', async (verb) => {
    const f = await fixture()
    const controller = new AbortController()
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    const finished = deferred<undefined>()
    f.releases.push(() => { release.resolve(undefined) })
    const original = f.fs.readText.bind(f.fs)
    const reads = vi.spyOn(f.fs, 'readText').mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      try {
        expect(args.at(-1)).toBe(controller.signal)
        await release.promise
        return await original(...args)
      } finally { finished.resolve(undefined) }
    })
    f.restores.push(() => { reads.mockRestore() })
    const call = f.call(`${verb} 00.03${verb === 'approve' ? ` ${digest(f.sources.get('00.03')!)}` : ''}`, f.agent, controller.signal)
    const settled = call.then(value => ({ value }), (error: unknown) => ({ error }))
    await Promise.race([entered.promise, settled.then(() => { throw new Error('command settled before source read') })])
    const reason = new Error('owner cancelled source review')
    controller.abort(reason)
    release.resolve(undefined)
    await finished.promise
    expect(await settled).toEqual({ error: reason })
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.lifecycle.getStatus('00.03')).toBe('todo')
    expect(f.agent.session.snapshotEvents().filter(event => event.type === 'command/done').at(-1)?.data)
      .toMatchObject({ kind: 'error', text: reason.message })
  })

  it('approve rechecks live root authority after asynchronous source lookup', async () => {
    const f = await fixture()
    const original = f.directory.getPiece.bind(f.directory)
    const lookup = vi.spyOn(f.directory, 'getPiece').mockImplementationOnce(async (...args) => {
      const record = await original(...args)
      await f.handle.dispose()
      return record
    })
    f.restores.push(() => { lookup.mockRestore() })
    const result = await f.call(`approve 00.03 ${digest(f.sources.get('00.03')!)}`)
    expect(result?.result.kind).toBe('error')
    expect(result?.result.text).toMatch(/root|live|human|authority/i)
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.lifecycle.getStatus('00.03')).toBe('todo')
  })

  it('cancellation at the transition boundary reaches the actual writer without a late memory change', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    const finished = deferred<undefined>()
    f.releases.push(() => { release.resolve(undefined) })
    f.transition.mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      try {
        expect(args[4]).toBe(controller.signal)
        await release.promise
        await f.transitionMethod(...args)
      } finally { finished.resolve(undefined) }
    })
    const call = f.call(`approve 00.03 ${digest(f.sources.get('00.03')!)}`, f.agent, controller.signal)
    const settled = call.then(value => ({ value }), (error: unknown) => ({ error }))
    await Promise.race([entered.promise, settled.then(() => { throw new Error('command settled before transition') })])
    const reason = new Error('owner cancelled before Lifecycle write')
    controller.abort(reason)
    release.resolve(undefined)
    await finished.promise
    expect(await settled).toEqual({ error: reason })
    expect(f.lifecycle.getStatus('00.03')).toBe('todo')
  })

  it('checks cancellation between set scans rather than continuing an observation', async () => {
    const f = await fixture({ seeds: [{ id: '00.03' }, { id: '01.01', set: '01-command' }] })
    const controller = new AbortController()
    const original = f.directory.scanSet.bind(f.directory)
    const scans = vi.spyOn(f.directory, 'scanSet').mockImplementationOnce(async (...args) => {
      const result = await original(...args)
      controller.abort(new Error('cancelled after first set'))
      return result
    })
    f.restores.push(() => { scans.mockRestore() })
    await expect(f.call('list', f.agent, controller.signal)).rejects.toThrow('cancelled after first set')
    expect(scans).toHaveBeenCalledTimes(1)
    expect(scans.mock.calls[0]?.[1]).toBe(controller.signal)
  })

  it.each(['show', 'approve'] as const)('%s refuses bytes changed during the review read', async (verb) => {
    const f = await fixture()
    const original = f.fs.readText.bind(f.fs)
    const lookup = f.directory.getPiece.bind(f.directory)
    // Arm the mutation after Directory lookup so it overlaps the command's review, not discovery.
    const getPiece = vi.spyOn(f.directory, 'getPiece').mockImplementationOnce(async (...args) => {
      const record = await lookup(...args)
      const read = vi.spyOn(f.fs, 'readText').mockImplementationOnce(async (...readArgs) => {
        const result = await original(...readArgs)
        await f.write('00.03', f.sources.get('00.03')!.replace('Last reviewed', 'Past reviewed'))
        return result
      })
      f.restores.push(() => { read.mockRestore() })
      return record
    })
    f.restores.push(() => { getPiece.mockRestore() })
    const output = await f.call(`${verb} 00.03${verb === 'approve' ? ` ${digest(f.sources.get('00.03')!)}` : ''}`)
    expect(output?.result.kind).toBe('error')
    expect(output?.result.text).toMatch(/stale|changed|revision|digest/i)
    expect(f.transition).not.toHaveBeenCalled()
  })
})
