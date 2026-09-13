/** Roles history is durable data, never a restored Queue callback or live initiator. */
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { assertEntriesActivated } from '@deepseek-ai/dsh-app-boot'
import { CommandId } from '@deepseek-ai/dsh-commands'
import Roles, { type Config, type DelegationBrief, type DelegationRecord } from '@deepseek-ai/dsh-dev-loop-roles'
import Queue from '@deepseek-ai/dsh-dev-loop-queue'
import Worktree from '@deepseek-ai/dsh-dev-loop-worktree'
import { SessionId } from '@deepseek-ai/dsh-session'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as fileTools from '@deepseek-ai/dsh-tool-fs'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { HumanAuthorization, SourceDigest } from '../src/types.ts'
import { createFixture } from './harness.ts'

const ID = '00.12'
const brief: DelegationBrief = { pieceId: ID, role: 'Research', assignment: 'Report retained corpus evidence.', rationale: 'Restart isolation.' }
const role = { provider: 'spawn', persona: 'Research in {{cwd}}; report limitations.', toolFilter: { allow: ['read'] } }
const policy: Config = { roles: { Research: role, 'Test Writer': role, Implementer: role, Utility: role }, maxBriefBytes: 8192, maxOutcomeBytes: 16384 }

async function authorize(ctx: Context): Promise<HumanAuthorization> {
  const piece = await ctx.devLoopDirectory.getPiece(ID)
  const path = await ctx.fs.resolve(piece.path)
  const stat = await ctx.fs.stat(path)
  if (!stat) throw new Error('private corpus absent')
  const text = await ctx.fs.readText(path)
  const digest = (value: string) => createHash('sha256').update(value).digest('hex') as SourceDigest
  return { kind: 'command', commandId: CommandId('roles-accept'), sessionId: SessionId('roles-human'), decision: 'accept',
    source: { path: piece.path, version: stat.version, rawDigest: digest(text),
      contentDigest: digest(text.replace(/(\*\*Status:\*\* )(todo|pending|blocked|done)/, '$1todo')) } }
}

async function scenario(durability: 'memory' | 'required') {
  const f = await createFixture()
  await writeFile(join(f.repository, '.gitignore'), '.worktrees/\n')
  await f.git('add', '.gitignore')
  await f.git('commit', '-qm', 'ignore private retained assignments')
  const mount = async (script: ConstructorParameters<typeof MockAdapter>[0]) => {
    const opens: string[] = []
    const announcements = vi.fn()
    const ctx = await f.mount({ durability, beforePersistence: async (ctx) => {
      const facility = ctx.get('storageDomain')!
      const open = facility.open.bind(facility)
      vi.spyOn(facility, 'open').mockImplementation((...args) => {
        opens.push(args[0].name)
        return open(...args)
      })
      ctx.on('piece/approved', announcements)
      await mountAgentLoopTestDependencies(ctx)
    } })
    Object.assign(ctx.loader.builtins, { 'roles-loop': AgentLoop, 'roles-queue': Queue, 'roles-worktree': Worktree,
      'roles-subagents': Subagents, 'roles-spawn': spawn, 'roles-service': Roles, 'roles-file-tools': fileTools })
    for (const row of [
      { name: 'cordis:roles-loop', config: { agents: [] } },
      { name: 'cordis:roles-queue', config: { maxConcurrency: 1 } },
      { name: 'cordis:roles-worktree', config: { mainlinePath: f.repository, commandTimeoutMs: 20000, outputMaxBytes: 128000, terminationGraceMs: 1000 } },
      { name: 'cordis:roles-subagents' }, { name: 'cordis:roles-spawn' },
      { name: 'cordis:roles-file-tools' },
      { name: 'cordis:roles-service', config: policy },
    ]) await ctx.loader.create(row)
    await ctx.loader.await()
    await assertEntriesActivated(ctx, 'roles-restart')
    const adapter = new MockAdapter(script)
    ctx.get('llm')!.registerAdapter(['mock'], adapter)
    expect(opens.filter(name => name === 'dev_loop_roles')).toEqual(['dev_loop_roles'])
    expect(ctx.get('devLoopPersistence')).toBeDefined()
    return { ctx, adapter, announcements }
  }
  const file = join(f.storageRoot, 'dev_loop_roles.json')
  const saved = join(f.storageRoot, 'roles-requested-residue.json')
  let displaced = false
  const first = await mount([() => {
    expect(first.ctx.devLoopQueue.getActiveWorkers()).toHaveLength(1)
    renameSync(file, saved)
    displaced = true
    mkdirSync(file)
    return textResponse('Real child completed; terminal storage is unavailable.')
  }])
  const { ctx } = first
  await ctx.devLoopLifecycle.transition(ID, 'todo', 'pending', 'human accepted', undefined, await authorize(ctx))
  const old = await ctx.agents.create({ sessionId: SessionId('roles-old'), meta: { cwd: f.repository }, agentOptions: { provider: 'mock', model: 'mock' } })
  let records: readonly DelegationRecord[] = []
  let retained = ''
  try {
    await expect(ctx.agents.withInitiator(old.agent, () => ctx.devLoopRoles.delegate(brief, new AbortController().signal)))
      .rejects.toThrow(/terminal persistence failed/)
    expect(first.adapter.requests).toHaveLength(1)
    records = await ctx.devLoopRoles.getDelegations(ID)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ state: 'requested', parentSessionId: old.agent.id })
    const disk = JSON.parse(await readFile(saved, 'utf8')) as { tables: { delegations: Record<string, DelegationRecord> } }
    expect(Object.values(disk.tables.delegations)).toEqual(records)
    expect(ctx.devLoopQueue.getActiveWorkers()).toEqual([])
    expect(ctx.devLoopQueue.getQueuedEntries()).toEqual([])
    const assignment = ctx.devLoopWorktree.getAssignment(ID)!
    expect(assignment.ownership).toBe('created')
    retained = assignment.worktreePath
    expect(await f.git('worktree', 'list', '--porcelain')).toContain(`worktree ${retained}`)
  } finally {
    await ctx.fiber.dispose()
    if (displaced) {
      await rm(file, { recursive: true, force: true })
      await rename(saved, file)
    }
  }
  const reopened = await mount([textResponse('Fresh explicit role request completed.')])
  const next = reopened.ctx
  expect(await next.devLoopRoles.getDelegations(ID)).toEqual(records)
  expect(next.devLoopQueue.getActiveWorkers()).toEqual([])
  expect(next.devLoopQueue.getQueuedEntries()).toEqual([])
  expect(next.agents.get(old.agent.id)).toBeUndefined()
  expect(next.agents.list()).toEqual([])
  expect(reopened.adapter.requests).toEqual([])
  expect(reopened.announcements).not.toHaveBeenCalled()
  expect(await f.git('worktree', 'list', '--porcelain')).toContain(`worktree ${retained}`)
  await expect(next.devLoopRoles.delegate(brief, new AbortController().signal)).rejects.toThrow('no initiating agent is active')
  await expect(next.agents.withInitiator(old.agent, () => next.devLoopRoles.delegate(brief, new AbortController().signal)))
    .rejects.toThrow(/live initiator/)
  expect(await next.devLoopRoles.getDelegations(ID)).toEqual(records)
  if (durability === 'required') {
    expect(next.devLoopLifecycle.getStatus(ID), 'required Lifecycle must hydrate committed pending acceptance').toBe('pending')
  } else {
    await next.devLoopLifecycle.transition(ID, 'todo', 'pending', 'new memory-only approval')
  }
  expect(reopened.adapter.requests).toEqual([])
  expect(next.devLoopQueue.getQueuedEntries()).toEqual([])
  const fresh = await next.agents.create({ sessionId: SessionId('roles-fresh'), meta: { cwd: retained }, agentOptions: { provider: 'mock', model: 'mock' } })
  const result = await next.agents.withInitiator(fresh.agent, () => next.devLoopRoles.delegate(brief, new AbortController().signal))
  expect(result).toMatchObject({ state: 'settled', status: 'completed', cleanup: 'quiescent', parentSessionId: fresh.agent.id,
    worktreeAssignment: { worktreePath: retained, ownership: 'borrowed' } })
  expect(result.delegationId).not.toBe(records[0]!.delegationId)
  expect(await next.devLoopRoles.getDelegations(ID)).toEqual(expect.arrayContaining([...records, result]))
  expect(reopened.adapter.requests).toHaveLength(1)
  expect(next.agents.get(result.subagentSessionId!)).toBeUndefined()
  expect(next.devLoopQueue.getActiveWorkers()).toEqual([])
  expect(next.devLoopQueue.getQueuedEntries()).toEqual([])
  await f.dispose()
}

// Real Git allocation and retained-tree verification exceed Vitest's default case budget.
it('memory control: actual Roles unresolved history never restores execution authority', { timeout: 30000 }, async () => { await scenario('memory') })
it('required lifecycle restart retains Roles history without automatic dispatch and needs a fresh live request', { timeout: 30000 }, async () => { await scenario('required') })
