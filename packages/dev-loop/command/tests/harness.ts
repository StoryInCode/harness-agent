/** Real source-plane Loader composition with private source files and memory-only Lifecycle. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import Commands from '@deepseek-ai/dsh-commands'
import type { CommandSubmitAttachment } from '@deepseek-ai/dsh-commands'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import Directory from '@deepseek-ai/dsh-dev-loop-directory'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import Lifecycle from '@deepseek-ai/dsh-dev-loop-lifecycle'
import Queue from '@deepseek-ai/dsh-dev-loop-queue'
import * as command from '../src/index.ts'
import type { Config } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Controllable asynchronous external boundary; no scheduler delay is evidence of readiness. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** Source bytes whose digest declares the reviewed revision. */
export function digest(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex')
}

/** Corpus input; creation order deliberately need not equal Directory order. */
export interface Seed {
  id: string
  set?: string
  queue?: number
  status?: PieceStatus
  dependencies?: string[]
  body?: string
}

/** Build valid Directory input rather than invented PieceRecord objects. */
export function piece(seed: Seed): string {
  return [
    `# ${seed.id} — Review ${seed.id}`, '',
    `**Set:** ${seed.set ?? '00-command'} · **Queue:** ${seed.queue ?? Number(seed.id.slice(3))} · **Depends on:** ${seed.dependencies?.join(', ') || 'none'}`,
    `**Status:** ${seed.status ?? 'todo'}`,
    '**Harness primitive:** command · **Package:** `@deepseek-ai/dsh-dev-loop-command`',
    ...['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References',
      'How to see it', 'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
      .flatMap(section => ['', `## ${section}`, '', `${section}: unabridged π 🧪.`]),
    seed.body ?? 'Last reviewed line: 終.', '',
  ].join('\n')
}

/** Boot actual registry, Agents, Directory, Lifecycle, Queue and local filesystem implementations. */
export async function fixture(options: { seeds?: Seed[]; config?: Partial<Config>; concurrency?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-command-'))
  const ctx = new Context()
  const releases: Array<() => void> = []
  const joins: Promise<unknown>[] = []
  const restores: Array<() => void> = []
  cleanups.push(async () => {
    for (const release of releases) release()
    await Promise.allSettled(joins)
    for (const restore of restores.reverse()) restore()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await mkdir(join(root, 'plans/pieces'), { recursive: true })
  const sources = new Map<string, string>()
  const paths = new Map<string, string>()
  for (const seed of options.seeds ?? [{ id: '00.03' }]) {
    const path = `plans/pieces/${seed.set ?? '00-command'}/${seed.status === 'done' ? 'done/' : ''}${seed.id}-review.md`
    const source = piece(seed)
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), source)
    paths.set(seed.id, path)
    sources.set(seed.id, source)
  }
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await mountAgentLoopTestHarness(ctx)
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href })
  Object.assign(ctx.loader.builtins, {
    include: Include, 'command-fs': LocalFileSystem, 'command-subprocess': LocalSubprocessRuntime,
    'command-directory': Directory, 'command-lifecycle': Lifecycle, 'command-queue': Queue,
    'command-registry': Commands, 'command-consumer': command,
  })
  const config = { maxInputBytes: 4096, maxOutputBytes: 65536, ...options.config }
  const yaml = [
    '- name: cordis:command-fs', '  config:', `    cwd: ${JSON.stringify(root)}`,
    '- name: cordis:command-subprocess', '- name: cordis:command-directory', '  config:', '    root: plans/pieces',
    '- name: cordis:command-lifecycle', '- name: cordis:command-queue', '  config:',
    `    maxConcurrency: ${options.concurrency ?? 2}`, '- name: cordis:command-registry',
    '- id: consumer', '  name: cordis:command-consumer', '  config:',
    `    maxInputBytes: ${config.maxInputBytes}`, `    maxOutputBytes: ${config.maxOutputBytes}`, '',
  ].join('\n')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, yaml)
  const composition = await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('command-root'), meta: { cwd: root } })
  const agent = handle.agent
  const lifecycle = ctx.get('devLoopLifecycle')!
  const directory = ctx.get('devLoopDirectory')!
  const queue = ctx.get('devLoopQueue')!
  const commands = ctx.get('commands')!
  const fs = ctx.get('fs')!
  const transitionMethod = lifecycle.transition.bind(lifecycle)
  const transition = vi.spyOn(lifecycle, 'transition')
  restores.push(() => { transition.mockRestore() })
  const call = (raw = '', caller: Agent = agent, signal = new AbortController().signal,
    attachments: readonly CommandSubmitAttachment[] = []) => {
    const pending = commands.execute(caller, `/dev-loop${raw ? ` ${raw}` : ''}`, attachments, signal)
    joins.push(pending)
    return pending
  }
  const write = async (id: string, source: string) => { await writeFile(join(root, paths.get(id)!), source) }
  return { root, ctx, composition, handle, agent, commands, lifecycle, directory, queue, fs, transition,
    sources, paths, config, call, write, releases, joins, restores, transitionMethod }
}
