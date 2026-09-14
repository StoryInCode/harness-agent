/** Completion veto semantics through actual Lifecycle.transition and the real piece/pre-complete event. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { PiecePreCompleteEvent } from '@deepseek-ai/dsh-dev-loop-lifecycle'
import { fixture, pieceId, piecePath } from './harness.ts'

const observe = async <T>(operation: Promise<T>) => {
  try {
    return { kind: 'settled' as const, value: await operation }
  } catch (error) {
    return { kind: 'rejected' as const, error: String(error) }
  }
}
const gitStatus = async (repo: string): Promise<string> =>
  (await promisify(execFile)('git', ['status', '--porcelain'], { cwd: repo, maxBuffer: 65_536 })).stdout

test('an ordinary throwing listener leaves the piece pending with no completion filesystem effects [control]', async () => {
  await fixture(async (f) => {
    f.ctx.on('piece/pre-complete', async (event: PiecePreCompleteEvent) => {
      expect(event.from).toBe('pending')
      expect(event.to).toBe('done')
      throw new Error('veto')
    })
    const result = await observe(f.lifecycle.transition(pieceId, 'pending', 'done'))
    expect(result).toMatchObject({ kind: 'rejected', error: expect.stringContaining('veto') })
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
    const source = await readFile(f.mainline(piecePath), 'utf8')
    expect(source).toContain('**Status:** pending')
    expect(await readdir(f.mainline('plans/pieces/00-dev-loop'))).toContain('00.10-verification-gates.md')
    expect(await readdir(f.mainline('plans/pieces/00-dev-loop'))).not.toContain('done')
    expect(await gitStatus(f.repo)).toBe('')
  })
})

test('a nested pending-to-blocked request inside the held done claim is illegal [control]', async () => {
  await fixture(async (f) => {
    let observed: 'unattempted' | 'illegal' | 'legal' = 'unattempted'
    f.ctx.on('piece/pre-complete', async () => {
      const nested = await observe(f.lifecycle.transition(pieceId, 'pending', 'blocked'))
      observed = nested.kind === 'rejected' ? 'illegal' : 'legal'
    })
    await observe(f.lifecycle.transition(pieceId, 'pending', 'done'))
    expect(observed).toBe('illegal')
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
  })
})

test('after the veto releases the claim, an explicit caller may legally block [control]', async () => {
  await fixture(async (f) => {
    f.ctx.on('piece/pre-complete', async () => { throw new Error('veto') })
    await observe(f.lifecycle.transition(pieceId, 'pending', 'done'))
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
    await f.lifecycle.transition(pieceId, 'pending', 'blocked', 'gate failed')
    expect(f.lifecycle.getStatus(pieceId)).toBe('blocked')
  })
})

test('todo-to-done never reaches the pre-complete listeners [control]', async () => {
  await fixture(async (f) => {
    let called = false
    f.ctx.on('piece/pre-complete', async () => { called = true })
    const result = await observe(f.lifecycle.transition(pieceId, 'todo', 'done'))
    expect(result).toMatchObject({ kind: 'rejected', error: expect.stringMatching(/INVALID_STATE_TRANSITION/) })
    expect(called).toBe(false)
    expect(f.lifecycle.getStatus(pieceId)).toBe('todo')
  })
})

test('the mounted Gates service vetoes an unevidenced completion', async () => {
  await fixture(async (f) => {
    const result = await observe(f.lifecycle.transition(pieceId, 'pending', 'done'))
    expect(result).toMatchObject({ kind: 'rejected' })
    expect(JSON.stringify(result)).toMatch(/gate|evidence|Gates/i)
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
  })
})

test('a Gates veto keeps the Git index free of the piece move', async () => {
  await fixture(async (f) => {
    await observe(f.lifecycle.transition(pieceId, 'pending', 'done'))
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
    expect(await gitStatus(f.repo)).toBe('')
    expect(await readdir(f.mainline('plans/pieces/00-dev-loop'))).toContain('00.10-verification-gates.md')
    expect(await readdir(f.mainline('plans/pieces/00-dev-loop'))).not.toContain('done')
    expect(await readFile(join(f.mainline(piecePath)), 'utf8')).toContain('**Status:** pending')
  })
})
