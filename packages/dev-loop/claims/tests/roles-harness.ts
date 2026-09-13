/** Private Git and real Loader services; only the model response is scripted. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import Directory from '@deepseek-ai/dsh-dev-loop-directory'
import Lifecycle from '@deepseek-ai/dsh-dev-loop-lifecycle'
import Queue from '@deepseek-ai/dsh-dev-loop-queue'
import Worktree from '@deepseek-ai/dsh-dev-loop-worktree'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import Subagents from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as acp from '@deepseek-ai/dsh-subagent-acp'
import * as fileTools from '@deepseek-ai/dsh-tool-fs'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import Roles from '@deepseek-ai/dsh-dev-loop-roles'
import * as tool from '../../roles/src/tool.ts'
import type { Config, DelegationBrief, DevLoopRole, ToolConfig } from '@deepseek-ai/dsh-dev-loop-roles'

export const roles: DevLoopRole[] = ['Research', 'Test Writer', 'Implementer', 'Utility']
export const brief: DelegationBrief = {
  pieceId: '00.06', role: 'Research', assignment: 'Read tracked.txt and report evidence.', rationale: 'Verify the retained input.',
}
export const toolConfig: ToolConfig = { maxToolOutputBytes: 32_768, maxHistoryRecords: 16 }
export function policy(): Config {
  const entry = (role: DevLoopRole) => ({ provider: 'spawn', persona: `${role}; cwd={{cwd}}; cite evidence and limitations.`,
    toolFilter: { allow: role === 'Research' ? ['read'] : ['read', 'write', 'edit'] } })
  return { roles: { Research: entry('Research'), 'Test Writer': entry('Test Writer'),
    Implementer: entry('Implementer'), Utility: entry('Utility') }, maxBriefBytes: 8192, maxOutcomeBytes: 16384 }
}

export async function fixture(
  script: ConstructorParameters<typeof MockAdapter>[0], run: (f: Fixture) => Promise<void>, overrides: Partial<Config> = {},
  consumerConfig: ToolConfig = toolConfig, withPreset = false, queueConcurrency = 1,
) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-roles-'))
  const contexts: Context[] = []
  try {
    const repo = join(root, 'repo')
    const data = join(root, 'storage')
    await mkdir(repo)
    const filename = join(repo, 'plans/pieces/00-dev-loop/00.06-role.md')
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, ['# 00.06 — Roles fixture', '',
      '**Set:** 00-dev-loop · **Queue:** 6 · **Depends on:** none', '**Status:** pending',
      '**Harness primitive:** subagent consumer · **Package:** `@deepseek-ai/dsh-dev-loop-roles`',
      ...['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References', 'How to see it',
        'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
        .flatMap(section => ['', `## ${section}`, '', `Private fixture material for ${section}.`]), ''].join('\n'))
    await writeFile(join(repo, '.gitignore'), '.worktrees/\n')
    await writeFile(join(repo, 'tracked.txt'), 'retained evidence\n')
    const git = async (...args: string[]) => {
      await promisify(execFile)('git', args, { cwd: repo, timeout: 20_000, maxBuffer: 128_000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'absent-config'),
          GIT_AUTHOR_NAME: 'Roles fixture', GIT_AUTHOR_EMAIL: 'roles@example.invalid',
          GIT_COMMITTER_NAME: 'Roles fixture', GIT_COMMITTER_EMAIL: 'roles@example.invalid',
          GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined } })
    }
    await git('init', '-q')
    await git('add', '.')
    await git('-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=' + join(root, 'no-hooks'), 'commit', '-qm', 'Private fixture')
    const config = { ...policy(), ...overrides }
    const presetRoot = join(root, 'presets')
    if (withPreset) {
      for (const id of ['original', 'actual']) {
        await mkdir(join(presetRoot, id), { recursive: true })
        await writeFile(join(presetRoot, id, 'agent.cordis.yml'), '[]\n')
        await writeFile(join(presetRoot, id, 'preset.yml'), `name: ${id}\ndescription: Private role composition\n`)
      }
    }
    const mount = async () => {
      const ctx = new Context()
      ctx.baseUrl = pathToFileURL(root + '/').href
      contexts.push(ctx)
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href })
      Object.assign(ctx.loader.builtins, { include: Include, fs: LocalFileSystem, subprocess: LocalSubprocessRuntime,
        directory: Directory, lifecycle: Lifecycle, queue: Queue, worktree: Worktree, storage: Storage,
        json: storageJson, domain: storageDomain, subagents: Subagents, spawn, acp, loop: AgentLoop,
        roles: Roles, 'role-tool': tool, 'file-tools': fileTools })
      const rows = [
        { name: 'cordis:fs', config: { cwd: repo } }, { name: 'cordis:subprocess' },
        { name: 'cordis:directory', config: { root: 'plans/pieces' } }, { name: 'cordis:lifecycle' },
        { name: 'cordis:queue', config: { maxConcurrency: queueConcurrency } },
        { name: 'cordis:worktree', config: { mainlinePath: repo, commandTimeoutMs: 20_000, outputMaxBytes: 128_000, terminationGraceMs: 1000 } },
        { name: 'cordis:storage' }, { name: 'cordis:json', config: { root: data } },
        { name: 'cordis:domain', config: { backend: 'json' } }, { name: 'cordis:subagents' },
        { name: 'cordis:spawn' }, { name: 'cordis:acp', config: { command: process.execPath, args: ['--version'] } },
        { name: 'cordis:loop', config: { agents: [] } },
        { name: 'cordis:file-tools' }, { name: 'cordis:roles', config },
      ]
      const hostFile = join(root, `host-${contexts.length}.yml`)
      await writeFile(hostFile, JSON.stringify(rows))
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(hostFile).href } })
      await ctx.loader.await()
      if (withPreset) await ctx.plugin(AgentPresets, { default: 'original', roots: [{ path: presetRoot, trust: 'system' }],
        includeShippedRoot: false, includeUserRoot: false })
      return ctx
    }
    const ctx = await mount()
    const adapter = new MockAdapter(script)
    ctx.get('llm')!.registerAdapter(['mock'], adapter)
    const consumer = join(root, 'brain.yml')
    await writeFile(consumer, JSON.stringify([{ name: 'cordis:role-tool', config: consumerConfig }]))
    const handle = await ctx.get('agents')!.create({ sessionId: SessionId('brain'), meta: { cwd: repo, ...withPreset ? { agentPreset: 'original' } : {} },
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => {
        if (withPreset) await ctx.get('agentPresets')!.mount(agentCtx, 'original')
        await agentCtx.plugin(Include, { path: pathToFileURL(consumer).href })
      },
    })
    const delegate = (input: DelegationBrief = brief, signal = new AbortController().signal) =>
      ctx.get('agents')!.withInitiator(handle.agent, () => ctx.get('devLoopRoles')!.delegate(input, signal))
    await run({ ctx, repo, data, adapter, handle, delegate, mount })
  } finally {
    try { for (const ctx of contexts.reverse()) await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  }
}
export interface Fixture {
  ctx: Context
  repo: string
  data: string
  adapter: MockAdapter
  handle: Awaited<ReturnType<Context['agents']['create']>>
  delegate(brief?: DelegationBrief, signal?: AbortSignal): ReturnType<Roles['delegate']>
  mount(): Promise<Context>
}
