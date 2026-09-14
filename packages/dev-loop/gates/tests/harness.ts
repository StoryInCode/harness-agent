/** Private Git/Loader fixture: actual Gates, Lifecycle and tools; scripted Handoff record. */
import { execFile } from 'node:child_process'
import { mkdir, copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
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
import * as fileTools from '@deepseek-ai/dsh-tool-fs'
import Gates from '../src/index.ts'
import * as tool from '../src/tool.ts'
import type { Config, GateStage, ToolConfig } from '../src/types.ts'
import { handoffDouble, type HandoffControls } from './handoff-double.ts'
import { authoredPath, authoredSource, helperPath, helperSource, pieceId, piecePath, pieceSource,
  productionPath, unrelatedMainlinePath, unrelatedMainlineSource } from './fixture-source.ts'

export { authoredPath, authoredSource, helperPath, helperSource, pieceId, piecePath, pieceSource,
  productionPath, unrelatedMainlinePath, unrelatedMainlineSource } from './fixture-source.ts'

/** Explicit policies and repository setup before its initial Git commit. */
export interface FixtureOptions {
  config?: Partial<Config>
  toolConfig?: ToolConfig
  /** Observe and adjust the Handoff dependency controls before the first mount. */
  configureHandoff?: (controls: HandoffControls, paths: { repo: string; worktree: string; baseCommit: string }) => Promise<void> | void
  /** Additional repository content committed before the worktree is cut. */
  setupRepo?: (repo: string) => Promise<void>
}
/** Real caller and mounted services; remounts reuse only this fixture's durable storage. */
export interface Fixture {
  ctx: Context
  root: string
  repo: string
  worktree: string
  data: string
  config: Config
  handoff: HandoffControls
  handle: Awaited<ReturnType<Context['agents']['create']>>
  run(stage: GateStage, signal?: AbortSignal): ReturnType<Gates['runChecks']>
  report(signal?: AbortSignal): ReturnType<Gates['getReport']>
  complete(signal?: AbortSignal): ReturnType<Context['tools']['execute']>
  lifecycle: Context['devLoopLifecycle']
  /** Overwrite the worktree production module with the fixture implementation. */
  implement(): Promise<void>
  /** Copy the fixture implementation into the mainline, preserving unrelated content. */
  transfer(): Promise<void>
  /** Absolute path of a repository file in the mainline. */
  mainline(path: string): string
  mount(): Promise<Context>
  unmount(ctx?: Context): Promise<void>
}
/** Run a callback with an actual mainline Git checkout, retained worktree and real Lifecycle.
 * @param run - Assertions and orchestration using a real initiating Agent.
 * @param options - Per-test policies and Handoff record simulation.
 * @returns Resolves after every owned context is disposed and its temporary root removed.
 */
export async function fixture(run: (fixture: Fixture) => Promise<void>, options: FixtureOptions = {}): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-gates-'))
  const contexts = new Set<Context>()
  try {
    const repo = join(root, 'repo')
    const worktree = join(root, 'piece-worktree')
    const data = join(root, 'storage')
    await mkdir(dirname(join(repo, piecePath)), { recursive: true })
    await mkdir(join(repo, 'production'))
    await mkdir(join(repo, 'tests'))
    await mkdir(join(repo, 'scripts'))
    await mkdir(dirname(join(repo, unrelatedMainlinePath)), { recursive: true })
    await writeFile(join(repo, piecePath), pieceSource)
    await writeFile(join(repo, '.gitignore'), '.worktrees/\nnode_modules/\n.cache/\n')
    await writeFile(join(repo, productionPath), 'export function value() { return undefined }\n')
    await writeFile(join(repo, unrelatedMainlinePath), unrelatedMainlineSource)
    await writeFile(join(repo, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    await writeFile(join(repo, 'vitest.config.mjs'), [
      'export default { cacheDir: ".cache", test: { include: ["tests/**/*.spec.js"],',
      'reporters: ["json"], maxWorkers: 1, fileParallelism: false, globals: false } }', '',
    ].join('\n'))
    await writeFile(join(repo, 'scripts/fmt-probe.mjs'), [
      'process.stdout.write(JSON.stringify({ tool: "fmt-probe", version: "1.0.0", findings: [] }))', '',
    ].join('\n'))
    await options.setupRepo?.(repo)
    const require = createRequire(import.meta.url)
    const vitestPackage = require.resolve('vitest/package.json')
    const metadata: unknown = JSON.parse(await readFile(vitestPackage, 'utf8'))
    if (typeof metadata !== 'object' || metadata === null || !('version' in metadata) || typeof metadata.version !== 'string') {
      throw new Error('Installed Vitest package lacks a version')
    }
    const modules = join(repo, 'node_modules')
    await mkdir(join(modules, '@deepseek-ai'), { recursive: true })
    await symlink(dirname(vitestPackage), join(modules, 'vitest'), process.platform === 'win32' ? 'junction' : 'dir')
    await symlink(new URL('../', import.meta.url), join(modules, '@deepseek-ai/dsh-dev-loop-gates'),
      process.platform === 'win32' ? 'junction' : 'dir')
    const git = async (...args: string[]) => {
      await promisify(execFile)('git', args, { cwd: repo, timeout: 20_000, maxBuffer: 128_000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'absent-config'),
          GIT_AUTHOR_NAME: 'Gates fixture', GIT_AUTHOR_EMAIL: 'gates@example.invalid',
          GIT_COMMITTER_NAME: 'Gates fixture', GIT_COMMITTER_EMAIL: 'gates@example.invalid',
          GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined } })
    }
    await git('init', '-q')
    await git('add', '.')
    await git('-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${join(root, 'no-hooks')}`, 'commit', '-qm', 'Private fixture')
    const baseCommit = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: repo, maxBuffer: 4096 })).stdout.trim()
    await git('worktree', 'add', '--detach', worktree)
    // Retained Test Writer output lives in the worktree; the mainline never sees these test files.
    await writeFile(join(worktree, authoredPath), authoredSource)
    await writeFile(join(worktree, helperPath), helperSource)
    const config: Config = { repositoryRoot: repo, mainlinePath: repo,
      formatExecutable: process.execPath, formatArgv: ['scripts/fmt-probe.mjs'],
      runnerExecutable: process.execPath,
      runnerArgv: [join(dirname(vitestPackage), 'vitest.mjs'), 'run', '--config', 'vitest.config.mjs', '--configLoader', 'runner'],
      selectedTests: [authoredPath], lockfilePath: 'pnpm-lock.yaml',
      commandTimeoutMs: 30_000, terminationGraceMs: 1000,
      maxOutputBytes: 1_048_576, maxReportBytes: 2_097_152, ...options.config }
    const handoff: HandoffControls = { record: undefined, reads: [] }
    await options.configureHandoff?.(handoff, { repo, worktree, baseCommit })
    let mountCount = 0
    const mount = async (): Promise<Context> => {
      const ctx = new Context()
      contexts.add(ctx)
      ctx.baseUrl = pathToFileURL(root + '/').href
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(Loader, { baseUrl: ctx.baseUrl })
      Object.assign(ctx.loader.builtins, { include: Include, fs: LocalFileSystem, subprocess: LocalSubprocessRuntime,
        directory: Directory, lifecycle: Lifecycle, queue: Queue, worktree: Worktree, storage: Storage,
        json: storageJson, domain: storageDomain, loop: AgentLoop, 'file-tools': fileTools,
        handoff: handoffDouble(handoff), gates: Gates, 'gates-tool': tool })
      const rows = [
        { name: 'cordis:fs', config: { cwd: repo } }, { name: 'cordis:subprocess' },
        { name: 'cordis:directory', config: { root: 'plans/pieces' } }, { name: 'cordis:lifecycle' },
        { name: 'cordis:queue', config: { maxConcurrency: 1 } },
        { name: 'cordis:worktree', config: { mainlinePath: repo, commandTimeoutMs: 20_000, outputMaxBytes: 128_000, terminationGraceMs: 1000 } },
        { name: 'cordis:storage' }, { name: 'cordis:json', config: { root: data } },
        { name: 'cordis:domain', config: { backend: 'json' } },
        { name: 'cordis:loop', config: { agents: [] } },
        { name: 'cordis:gates', config },
      ]
      const hostFile = join(root, `host-${++mountCount}.yml`)
      await writeFile(hostFile, JSON.stringify(rows))
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(hostFile).href } })
      await ctx.loader.await()
      return ctx
    }
    const ctx = await mount()
    const consumer = join(root, 'caller.yml')
    await writeFile(consumer, JSON.stringify([{ name: 'cordis:gates-tool', config: options.toolConfig ?? { maxToolOutputBytes: 131_072 } }]))
    const handle = await ctx.get('agents')!.create({ sessionId: SessionId('gates-caller'), meta: { cwd: repo },
      agentOptions: { provider: 'mock', model: 'mock' },
      setup: async (agentCtx) => { await agentCtx.plugin(Include, { path: pathToFileURL(consumer).href }) },
    })
    const unmount = async (target = ctx): Promise<void> => {
      await target.fiber.dispose()
      contexts.delete(target)
    }
    await run({ ctx, root, repo, worktree, data, config, handoff, handle, mount, unmount,
      lifecycle: ctx.get('devLoopLifecycle')!,
      run: (stage, signal = new AbortController().signal) =>
        ctx.get('devLoopGates')!.runChecks(pieceId, stage, signal),
      report: (signal = new AbortController().signal) => {
        void signal
        return ctx.get('devLoopGates')!.getReport(pieceId)
      },
      complete: (signal = new AbortController().signal) => ctx.get('agents')!.withInitiator(handle.agent, () =>
        ctx.get('tools')!.execute({ callId: 'gates-complete' as never, name: 'dev_loop_complete',
          arguments: { pieceId }, agent: handle.agent, signal })),
      implement: async () => {
        await writeFile(join(worktree, productionPath), 'export function value() { return true }\n')
      },
      transfer: async () => {
        await copyFile(join(worktree, productionPath), join(repo, productionPath))
      },
      mainline: (path: string) => join(repo, path),
    })
  } finally {
    try {
      const settlements = await Promise.allSettled([...contexts].reverse().map(ctx => ctx.fiber.dispose()))
      const failures = settlements.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length) throw new AggregateError(failures.map((result): unknown => result.reason), 'Fixture context disposal failed')
    } finally { await rm(root, { recursive: true, force: true }) }
  }
}
