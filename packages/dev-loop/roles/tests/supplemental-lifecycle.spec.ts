/** Cancellation through actual Git/provider/Agent lifetimes. */
import { watch } from 'node:fs'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { brief, fixture } from './harness.ts'

it.skipIf(process.platform === 'win32')('cancels during actual Git worktree allocation before any child starts', async () => {
  // Git's POSIX executable hook is the external process barrier; no Worktree/Queue method is replaced.
  await fixture([], async (f) => {
    const controller = new AbortController()
    const hookDir = join(f.repo, '.git', 'hooks')
    const marker = join(f.data, 'allocation-entered')
    const script = join(f.data, 'allocation-hook.cjs')
    await mkdir(hookDir, { recursive: true })
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'entered'); setInterval(() => {}, 1000);\n`)
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    const hook = join(hookDir, 'post-checkout')
    await writeFile(hook, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)}\n`)
    await chmod(hook, 0o700)
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const watcher = watch(f.data, (_event, filename) => { if (filename?.toString() === 'allocation-entered') entered() })
    const operation = f.delegate(brief, controller.signal)
    try {
      await Promise.race([ready, operation.then(() => { throw new Error('Allocation settled without entering the Git hook') })])
      controller.abort(new Error('cancel during Git allocation'))
      const record = await operation
      expect(record).toMatchObject({ state: 'settled', status: 'aborted', cleanup: 'quiescent' })
      expect(record.subagentSessionId).toBeUndefined()
      expect(f.adapter.requests).toEqual([])
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
    } finally {
      watcher.close()
      controller.abort(new Error('fixture cleanup'))
      await operation.catch(() => undefined)
    }
  })
})

it('cancels in real child publication before SubagentRuntime.start returns its lease', async () => {
  await fixture([], async (f) => {
    const controller = new AbortController()
    let published: SessionId | undefined
    f.ctx.on('agent/created', ({ agent }) => {
      if (agent.session.header.parentSession !== f.handle.agent.id) return
      published = agent.id
      controller.abort(new Error('cancel at child publication'))
    })
    const record = await f.delegate(brief, controller.signal)
    expect(published).toEqual(expect.any(String))
    expect(record).toMatchObject({ state: 'settled', status: 'failed', cleanup: 'unproven' })
    // The registry publication is test-observed; the failed start returns no child lease to Roles.
    expect(record.subagentSessionId).toBeUndefined()
    expect(record.worktreeAssignment?.worktreePath).toEqual(expect.any(String))
    expect(f.ctx.get('agents')!.get(published!)).toBeUndefined()
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(f.adapter.requests).toEqual([])
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  })
})
