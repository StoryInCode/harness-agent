/** Real JSON durability, cancellation and restart observations. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture, brief } from './harness.ts'
import type { DelegationRecord, RequestedDelegation } from '../src/types.ts'

it('persists requested intent before child execution, records cancellation after cleanup, and reopens it', async () => {
  const controller = new AbortController()
  let inspectStart: () => void = () => { throw new Error('fixture not initialized') }
  await fixture([() => { inspectStart(); controller.abort(new Error('human cancelled')); return textResponse('partial') }], async (f) => {
    let requested: RequestedDelegation | undefined
    inspectStart = () => {
      const persisted = JSON.parse(readFileSync(join(f.data, 'dev_loop_roles.json'), 'utf8')) as {
        tables: { delegations: Record<string, RequestedDelegation> }
      }
      requested = Object.values(persisted.tables.delegations)[0]
      expect(requested).toMatchObject({ state: 'requested', parentSessionId: f.handle.agent.id, role: 'Research' })
    }
    const record = await f.delegate(brief, controller.signal)
    expect(requested).toBeDefined()
    expect(record).toMatchObject({ state: 'settled', status: 'aborted', cleanup: 'quiescent' })
    expect(record.delegationId).toBe(requested!.delegationId)
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(f.ctx.get('agents')!.get(record.subagentSessionId!)).toBeUndefined()
    await f.ctx.fiber.dispose()
    const reopened = await f.mount()
    expect(await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([record])
  })
})

it('rejects an initial JSON write failure before starting a child or enqueueing', async () => {
  await fixture([], async (f) => {
    await mkdir(join(f.data, 'dev_loop_roles.json'), { recursive: true })
    await expect(f.delegate()).rejects.toThrow()
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
  })
})

it('rejects a terminal JSON write failure and preserves the prior unresolved request on reopen', async () => {
  let failTerminal: () => void = () => { throw new Error('fixture not initialized') }
  await fixture([() => { failTerminal(); return textResponse('child completed') }], async (f) => {
    const file = join(f.data, 'dev_loop_roles.json')
    const saved = join(f.data, 'requested.json')
    failTerminal = () => { renameSync(file, saved); mkdirSync(file) }
    await expect(f.delegate()).rejects.toThrow()
    expect(f.adapter.requests).toHaveLength(1)
    const prior = JSON.parse(await readFile(saved, 'utf8')) as { tables: { delegations: Record<string, DelegationRecord> } }
    const records = Object.values(prior.tables.delegations)
    expect(records).toHaveLength(1)
    expect(records[0]!.state).toBe('requested')
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual(records)
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    await f.ctx.fiber.dispose()
    // Restore the real previously durable file as crash residue, without inventing a record schema.
    const { rm, rename } = await import('node:fs/promises')
    await rm(file, { recursive: true })
    await rename(saved, file)
    const reopened = await f.mount()
    expect(await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual(records)
  })
})

it('refuses malformed authoritative records rather than silently skipping them on restart', async () => {
  await fixture([textResponse('complete')], async (f) => {
    await f.delegate()
    await f.ctx.fiber.dispose()
    await writeFile(join(f.data, 'dev_loop_roles.json'), JSON.stringify({ unit: { name: 'dev_loop_roles', version: 1 },
      global: null, tables: { delegations: { invalid: { state: 'settled', role: 'Reviewer' } } } }))
    await expect(f.mount()).rejects.toThrow(/invalid|record/i)
  })
})
