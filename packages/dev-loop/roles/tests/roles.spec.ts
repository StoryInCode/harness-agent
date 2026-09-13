/** Canonical role dispatch, retained assignment, caller and durable-history acceptance. */
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture, brief, roles, toolConfig } from './harness.ts'

// Private Git commands and real Loader/AgentLoop disposal use the repository lane's timeout.
describe('Host role delegation', () => {
  it.each(roles)('%s records the actual child, caller, assigned cwd and reported provenance after cleanup', async (role) => {
    await fixture([textResponse('Reported evidence; limitation: no external verification.')], async (f) => {
      const parent = f.handle.agent
      const parentCwd = parent.session.header.cwd
      const observed: Array<{ id: string; cwd: string | undefined; parent: string | undefined }> = []
      f.ctx.on('agent/created', ({ agent }) => {
        if (agent.session.header.parentSession === parent.id) observed.push({ id: agent.id,
          cwd: agent.session.header.cwd, parent: agent.session.header.parentSession })
      })
      const result = await f.delegate({ ...brief, role })
      expect(result).toMatchObject({ state: 'settled', status: 'completed', cleanup: 'quiescent',
        parentSessionId: parent.id, role, stopReason: 'completed',
        outcome: 'Reported evidence; limitation: no external verification.', provenance: { kind: 'reported', role } })
      expect(result.delegationId).toEqual(expect.any(String))
      expect(result.subagentSessionId).toBe(observed[0]?.id)
      expect(observed).toHaveLength(1)
      expect(observed[0]?.cwd).toBe(result.worktreeAssignment?.worktreePath)
      expect(observed[0]?.parent).toBe(parent.id)
      expect(result.worktreeAssignment?.mainlinePath).toBe(f.repo)
      expect(result.worktreeAssignment?.worktreePath).not.toBe(parentCwd)
      expect(parent.session.header.cwd).toBe(parentCwd)
      expect(result.effectivePreset).toBeUndefined()
      expect(result.provenance.preset).toBeUndefined()
      expect(f.ctx.get('agents')!.get(result.subagentSessionId!)).toBeUndefined()
      expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
      expect(f.adapter.requests).toHaveLength(1)
      const prompt = f.adapter.requests[0]!.messages.flatMap(message => message.content)
        .filter(block => block.type === 'text').map(block => block.text).join('\n')
      expect(prompt).toContain(result.worktreeAssignment!.worktreePath)
      expect(prompt).toContain(role)
      expect(await readFile(join(result.worktreeAssignment!.worktreePath, 'tracked.txt'), 'utf8')).toBe('retained evidence\n')
    })
  })

  it('records the actual live inherited preset rather than the stale parent creation label', async () => {
    await fixture([textResponse('Reported under the actual composition.')], async (f) => {
      await f.ctx.get('agentPresets')!.recompose(f.handle.agent.ctx, 'actual')
      expect(f.handle.agent.session.header.agentPreset).toBe('original')
      const result = await f.delegate()
      expect(result.effectivePreset).toBe('actual')
      expect(result.provenance).toEqual({ kind: 'reported', role: 'Research', preset: 'actual' })
      expect(f.handle.agent.session.header.agentPreset).toBe('original')
    }, {}, toolConfig, true)
  })

  it('retains the Test Writer file for Implementer and after Host dispose/remount', async () => {
    await fixture([
      toolCallResponse('write-test', 'write', { file_path: 'handoff.txt', content: 'frozen test evidence\n' }),
      textResponse('Test Writer reported a retained file.'),
      toolCallResponse('read-test', 'read', { file_path: 'handoff.txt' }),
      textResponse('Implementer reported reading the Test Writer file.'),
    ], async (f) => {
      const writer = await f.delegate({ ...brief, role: 'Test Writer' })
      expect(writer.status).toBe('completed')
      const implementer = await f.delegate({ ...brief, role: 'Implementer' })
      expect(implementer.worktreeAssignment).toEqual(writer.worktreeAssignment)
      const handoff = join(writer.worktreeAssignment!.worktreePath, 'handoff.txt')
      expect(await readFile(handoff, 'utf8')).toBe('frozen test evidence\n')
      const lastRequest = f.adapter.requests.at(-1)!
      const reads = lastRequest.messages.flatMap(message => message.content).filter(block => block.type === 'tool-result')
      expect(reads.some(block => block.content.some(member => member.type === 'text' && member.text.includes('frozen test evidence')))).toBe(true)
      await f.ctx.fiber.dispose()
      expect(await readFile(handoff, 'utf8')).toBe('frozen test evidence\n')
      const reopened = await f.mount()
      const records = await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId)
      expect(records).toEqual([writer, implementer].sort((a, b) =>
        a.requestedAt - b.requestedAt || a.delegationId.localeCompare(b.delegationId)))
      expect(records).not.toBe(await reopened.get('devLoopRoles')!.getDelegations(brief.pieceId))
      await access(handoff)
    })
  })

  it('rejects a service call without the exact live initiator before any history exists', async () => {
    await fixture([], async (f) => {
      await expect(f.ctx.get('devLoopRoles')!.delegate(brief, new AbortController().signal))
        .rejects.toThrow('no initiating agent is active')
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
      const stale = f.handle.agent
      await f.handle.dispose()
      await expect(f.ctx.get('agents')!.withInitiator(stale, () =>
        f.ctx.get('devLoopRoles')!.delegate(brief, new AbortController().signal))).rejects.toThrow(/initiator|live/i)
      expect(f.adapter.requests).toEqual([])
    })
  })

  it('rejects a complete multibyte brief above the Host byte budget without enqueue or persistence', async () => {
    await fixture([], async (f) => {
      await expect(f.delegate({ ...brief, rationale: '界'.repeat(4000) })).rejects.toThrow(/brief|bytes|limit/i)
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
      expect(f.ctx.get('devLoopQueue')!.getQueuedEntries()).toEqual([])
      expect(f.adapter.requests).toEqual([])
    })
  })

  it('records outcome overflow as failed with an explicit limitation, never clipped completion', async () => {
    await fixture([textResponse('界'.repeat(6000))], async (f) => {
      const result = await f.delegate()
      expect(result.status).toBe('failed')
      expect(result.cleanup).toBe('quiescent')
      expect(result.limitations.join(' ')).toMatch(/outcome|bytes|limit|oversiz/i)
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(16384)
      expect(result.outcome).not.toContain('界')
      expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([result])
    })
  })
})
