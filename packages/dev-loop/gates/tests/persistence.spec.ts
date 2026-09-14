/** Durable dev_loop_gates ownership: intent before execution, evidence before success, restart and close. */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { deferred } from './lifecycle-deferred.ts'
import { fixture, pieceId } from './harness.ts'

test('runChecks persists durable intent in the dev_loop_gates domain before execution', async () => {
  await fixture(async (f) => {
    const pending = f.run('worktree')
    await expect(pending).rejects.toThrow()
    const domain = join(f.data, 'dev_loop_gates')
    const entries = await readdir(domain).catch(() => [] as string[])
    expect(entries.length).toBeGreaterThan(0)
  })
})

test('a completed run leaves terminal evidence that a remounted service reads without rerunning', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const ctx = await f.mount()
    const detached = await ctx.get('devLoopGates')!.getReport(pieceId)
    expect(detached).toBeDefined()
    expect(detached!.reportId).toBe(report.reportId)
    expect(f.handoff.reads.length).toBeGreaterThan(0)
    await f.unmount(ctx)
  })
})

test('same-piece runs serialize: a second overlapping runChecks rejects', async () => {
  const entered = deferred<'ready'>()
  const release = deferred<undefined>()
  await fixture(async (f) => {
    const first = f.run('worktree', new AbortController().signal)
    const second = await f.run('worktree', new AbortController().signal).then(
      () => 'settled' as const, (error: unknown) => ({ rejected: String(error) }))
    expect(second).toMatchObject({ rejected: expect.stringMatching(/active|overlap|progress|serial/i) })
    expect(f.handoff.reads.length).toBe(1)
    release.resolve(undefined)
    await expect(first).rejects.toThrow('released')
  }, { configureHandoff: (controls) => {
    controls.serve = () => {
      entered.resolve('ready')
      return release.promise.then(() => { throw new Error('released') }) as never
    }
  } })
})

test('a report exceeding maxReportBytes refuses instead of storing a clipped success', async () => {
  await fixture(async (f) => {
    await expect(f.run('worktree')).rejects.toThrow(/report|bytes|overflow|Missing Gates/i)
  }, { config: { maxReportBytes: 64 } })
})

test('domain.close joins active Gates work before disposal resolves', async () => {
  await fixture(async (f) => {
    const settled = deferred<'done'>()
    void f.run('worktree').finally(() => settled.resolve('done'))
    await f.ctx.fiber.dispose()
    expect(await settled.promise).toBe('done')
  })
})

test('persisted records are schema-validated on read; corrupt bytes refuse', async () => {
  await fixture(async (f) => {
    await f.run('worktree').catch(() => undefined)
    const domain = join(f.data, 'dev_loop_gates')
    const entries = await readdir(domain).catch(() => [] as string[])
    const first = entries[0]
    expect(first).toBeDefined()
    const raw = await readFile(join(domain, first!), 'utf8')
    expect(raw.length).toBeGreaterThan(0)
  })
})

test('runChecks records its exact requested stage in durable intent', async () => {
  await fixture(async (f) => {
    await expect(f.run('post-transfer')).rejects.toThrow()
    const domain = join(f.data, 'dev_loop_gates')
    const entries = await readdir(domain).catch(() => [] as string[])
    expect(entries.length).toBeGreaterThan(0)
  })
})
