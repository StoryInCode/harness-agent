/** Repair regressions over private Git repositories and instance-local provider faults. */
import { execFile, spawn as spawnChild } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service, type Fiber } from '@deepseek-ai/cordis'
import DevLoopDirectory, { PIECE_ROOT, type PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import DevLoopLifecycle, { type PieceCompletedEvent } from '@deepseek-ai/dsh-dev-loop-lifecycle'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import type { FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import { scrubbedParentEnv, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle, SubprocessOutcome, SubprocessOutputReader, SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'

const ID = '00.01'
const SET = '00-repair'
const FILE = '00.01-repair.md'
const SOURCE = `${PIECE_ROOT}/${SET}/${FILE}`
const DESTINATION = `${PIECE_ROOT}/${SET}/done/${FILE}`
const TRACK = ['git', 'ls-files', '--error-unmatch', '--', FILE]
const STAGE = ['git', 'add', '-u', '--', FILE]
const MKDIR = ['mkdir', '-p', 'done']
const MOVE = ['git', 'mv', '--', FILE, `done/${FILE}`]
const command = promisify(execFile)
const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function pieceText(status: PieceStatus): string {
  const sections = ['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References',
    'How to see it', 'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
  return [
    `# ${ID} — Repair fixture`, '', `**Set:** ${SET} · **Queue:** 1 · **Depends on:** none`,
    `**Status:** ${status}`, '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-lifecycle`',
    ...sections.flatMap(section => ['', `## ${section}`, '', 'Fixture content.']), '',
  ].join('\n')
}

function output(read: () => string): SubprocessOutputReader {
  return { readFrom: (offset) => {
    const bytes = Buffer.from(read())
    return { text: bytes.subarray(offset).toString(), nextOffset: bytes.length, lossy: false }
  } }
}

/** Real filesystem with a barrier immediately before a mutation, outside its atomic guard. */
class ObservedFs extends LocalFileSystem {
  readonly mutations: { method: 'edit' | 'write'; expected: FsVersion | undefined; signal: AbortSignal | undefined }[] = []
  readonly observations: { method: string; signal: AbortSignal | undefined }[] = []
  readonly editedVersions: FsVersion[] = []
  readonly requests: string[] = []
  readonly resolutions: { path: string; signal: AbortSignal | undefined }[] = []
  beforeResolve: ((path: string, signal: AbortSignal | undefined) => Promise<void>) | undefined
  beforeMutation: ((target: FsTarget) => Promise<void>) | undefined

  override async resolve(...args: Parameters<LocalFileSystem['resolve']>) {
    this.requests.push('resolve')
    this.resolutions.push({ path: args[0], signal: args[1]?.signal })
    await this.beforeResolve?.(args[0], args[1]?.signal)
    return super.resolve(...args)
  }

  override async listDir(...args: Parameters<LocalFileSystem['listDir']>) {
    this.requests.push('listDir')
    return super.listDir(...args)
  }

  override async readText(...args: Parameters<LocalFileSystem['readText']>) {
    this.requests.push('readText')
    this.observations.push({ method: 'read', signal: args[1] })
    return super.readText(...args)
  }

  override async stat(...args: Parameters<LocalFileSystem['stat']>) {
    this.requests.push('stat')
    this.observations.push({ method: 'stat', signal: args[1] })
    return super.stat(...args)
  }

  override async editText(...args: Parameters<LocalFileSystem['editText']>) {
    this.requests.push('editText')
    this.mutations.push({ method: 'edit', expected: args[2]?.version, signal: args[3] })
    await this.beforeMutation?.(args[0])
    const outcome = await super.editText(...args)
    this.editedVersions.push(outcome.version)
    return outcome
  }

  override async writeText(...args: Parameters<LocalFileSystem['writeText']>) {
    this.requests.push('writeText')
    this.mutations.push({ method: 'write', expected: args[2]?.kind === 'replaceIfVersion' ? args[2].version : undefined, signal: args[3] })
    await this.beforeMutation?.(args[0])
    return super.writeText(...args)
  }
}

/** Real directory reads can hold their completed result before returning it to hydration. */
class ObservedDirectory extends DevLoopDirectory {
  readonly calls: { method: 'list' | 'scan'; signal: AbortSignal | undefined }[] = []
  hold: ((method: 'list' | 'scan', signal: AbortSignal | undefined) => Promise<void>) | undefined

  override async listSets(signal?: AbortSignal) {
    this.calls.push({ method: 'list', signal })
    const result = await super.listSets(signal)
    await this.hold?.('list', signal)
    return result
  }

  override async scanSet(setName: string, signal?: AbortSignal) {
    this.calls.push({ method: 'scan', signal })
    const result = await super.scanSet(setName, signal)
    await this.hold?.('scan', signal)
    return result
  }
}

/** Records real commands; one selected command may expose a manually settled process handle. */
class RecordingSubprocess extends SubprocessRuntime {
  readonly calls: SubprocessSpawnSpec[] = []
  readonly handles = new Set<SubprocessHandle>()
  readonly results: { argv: readonly string[]; outcome: SubprocessOutcome; stderr: string }[] = []
  onSpawn: ((spec: SubprocessSpawnSpec) => SubprocessHandle | undefined) | undefined
  decorate: ((spec: SubprocessSpawnSpec, handle: SubprocessHandle) => SubprocessHandle) | undefined

  override resolveExecutable(program: string) { return Promise.resolve(program) }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.calls.push(spec)
    const injected = this.onSpawn?.(spec)
    if (injected) return this.own(injected)
    const [program, ...args] = spec.argv
    if (!program) throw new Error('Fixture requires a program')
    const child = spawnChild(program, args, { cwd: spec.cwd, env: { ...scrubbedParentEnv(), ...spec.env } })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text })
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text })
    const terminate = () => { child.kill() }
    spec.signal?.addEventListener('abort', terminate, { once: true })
    if (spec.signal?.aborted) terminate()
    const done = new Promise<SubprocessOutcome>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => { resolve({ exitCode, signal }) })
    }).finally(() => { spec.signal?.removeEventListener('abort', terminate) })
    void done.then((outcome) => { this.results.push({ argv: spec.argv, outcome, stderr }) }, () => undefined)
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: output(() => stdout), stderr: output(() => stderr) }, done, terminate,
      waitForExit: async () => { await done; return true },
    }
    return this.own(this.decorate?.(spec, handle) ?? handle)
  }

  private own(handle: SubprocessHandle): SubprocessHandle {
    this.handles.add(handle)
    void handle.done.then(() => this.handles.delete(handle), () => this.handles.delete(handle))
    return handle
  }

  async stop(): Promise<void> {
    const handles = [...this.handles]
    for (const handle of handles) handle.terminate()
    await Promise.allSettled(handles.map(handle => handle.done))
  }

  override spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('No terminal is used by lifecycle'))
  }
}

async function mount(options: {
  tracked?: boolean
  status?: PieceStatus
  config?: { terminationGraceMs?: number; outputMaxBytes?: number }
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-repair-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const source = join(root, SOURCE)
  const destination = join(root, DESTINATION)
  await mkdir(dirname(source), { recursive: true })
  const original = pieceText(options.status ?? 'pending')
  await writeFile(source, original)
  const git = (...args: string[]) => command('git', args, { cwd: root })
  await git('init', '-q')
  await git('config', 'core.autocrlf', 'false')
  await git('config', 'core.hooksPath', join(root, '.git', 'absent-hooks'))
  // Index tracking is the lifecycle precondition; fixture commits are unnecessary.
  if (options.tracked !== false) await git('add', '--', SOURCE)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(ObservedFs, { cwd: root })
  await ctx.plugin(RecordingSubprocess)
  await ctx.plugin(ObservedDirectory, { root: PIECE_ROOT })
  const fiber = await ctx.plugin(DevLoopLifecycle, options.config)
  const directory = ctx.get('devLoopDirectory')
  const fs = ctx.get('fs')
  const runner = ctx.get('subprocess')
  const lifecycle = ctx.get('devLoopLifecycle')
  if (!(fs instanceof ObservedFs) || !(runner instanceof RecordingSubprocess) || !(directory instanceof ObservedDirectory) || !lifecycle) {
    throw new Error('Fixture providers did not activate')
  }
  cleanups.push(() => runner.stop())
  const completed: PieceCompletedEvent[] = []
  ctx.on('piece/completed', (event) => { completed.push(event) })
  fs.observations.length = 0
  return { root, source, destination, original, ctx, fs, runner, directory, lifecycle, fiber, completed, git }
}

type Mounted = Awaited<ReturnType<typeof mount>>

// Temporary call casts execute the baseline API without inventing production declarations.
type PreComplete = { pieceId: string; from: 'pending'; to: 'done'; reason?: string; signal: AbortSignal }
function preComplete(ctx: Context, listener: (event: PreComplete) => void | Promise<void>): () => boolean {
  const on = ctx.on.bind(ctx) as (name: 'piece/pre-complete', callback: typeof listener) => () => boolean
  return on('piece/pre-complete', listener)
}

function complete(m: Mounted, signal?: AbortSignal): Promise<void> {
  const transition: (
    id: string, expected: PieceStatus, to: PieceStatus, reason?: string, signal?: AbortSignal,
  ) => Promise<void> = m.lifecycle.transition.bind(m.lifecycle)
  return transition(ID, 'pending', 'done', 'verified', signal)
}

async function attempt(promise: Promise<void>): Promise<unknown> {
  try { await promise; return undefined } catch (error) { return error }
}

async function expectPending(m: Mounted, bytes = m.original) {
  expect(m.lifecycle.getStatus(ID)).toBe('pending')
  expect(m.completed).toEqual([])
  expect(existsSync(m.destination)).toBe(false)
  expect(await readFile(m.source, 'utf8')).toBe(bytes)
}

// Completion currently requires POSIX mkdir; portable directory creation is a declared gap.
describe.skipIf(process.platform === 'win32')('resolution cancellation and cleanup outcome priority', () => {
  it.each([
    { label: 'root', path: PIECE_ROOT },
    { label: 'set', path: `${PIECE_ROOT}/${SET}` },
    { label: 'done', path: `${PIECE_ROOT}/${SET}/done` },
  ])('caller abort reaches held $label resolution without starting another filesystem request', async ({ label, path }) => {
    const m = await mount()
    const caller = new AbortController()
    const entered = deferred<AbortSignal | undefined>()
    const release = deferred<undefined>()
    let settled = false
    m.fs.beforeResolve = async (requested, signal) => {
      if (requested !== path) return
      entered.resolve(signal)
      await release.promise
    }
    const operation = attempt((label === 'root'
      ? m.directory.listSets(caller.signal)
      : m.directory.scanSet(SET, caller.signal)).then(() => undefined))
      .then((error) => { settled = true; return error })
    try {
      const signal = await entered.promise
      const requestCount = m.fs.requests.length
      expect.soft(signal).toBe(caller.signal)
      caller.abort(new Error(`cancel during ${label} resolution`))
      expect.soft(signal?.aborted).toBe(true)
      expect(await readFile(m.source, 'utf8')).toBe(m.original)
      expect(settled).toBe(false)
      expect(m.fs.requests).toHaveLength(requestCount)
      release.resolve(undefined)
      expect(await operation).toBeInstanceOf(Error)
      expect(m.fs.requests).toHaveLength(requestCount)
      expect(m.fs.mutations).toEqual([])
    } finally {
      release.resolve(undefined)
      await operation
    }
  })

  it('threads a live caller signal through root, set and done resolution on successful traversal', async () => {
    const m = await mount()
    const caller = new AbortController()
    m.fs.resolutions.length = 0
    expect(await m.directory.listSets(caller.signal)).toContain(SET)
    const scan = await m.directory.scanSet(SET, caller.signal)
    expect(scan.pieces.map(piece => piece.id)).toEqual([ID])
    expect(m.fs.resolutions).toEqual([
      { path: PIECE_ROOT, signal: caller.signal },
      { path: `${PIECE_ROOT}/${SET}`, signal: caller.signal },
      { path: `${PIECE_ROOT}/${SET}/done`, signal: caller.signal },
    ])
    expect(caller.signal.aborted).toBe(false)
  })

  it('lifecycle startup disposal propagates through directory listing into held filesystem resolution', async () => {
    const m = await mount()
    await m.fiber.dispose()
    const entered = deferred<AbortSignal | undefined>()
    const release = deferred<undefined>()
    let loadingFiber: Fiber | undefined
    class CapturedLifecycle extends DevLoopLifecycle {
      protected override async [Service.init](): Promise<void> {
        loadingFiber = this.ctx.fiber
        await super[Service.init]()
      }
    }
    m.fs.beforeResolve = async (path, signal) => {
      if (path !== PIECE_ROOT) return
      entered.resolve(signal)
      await release.promise
    }
    const loading = m.ctx.plugin(CapturedLifecycle)
    const loadResult = Promise.resolve(loading).then(() => undefined, (error: unknown) => error)
    let disposal: Promise<void> | undefined
    let disposed = false
    try {
      const signal = await entered.promise
      const requestCount = m.fs.requests.length
      if (!loadingFiber) throw new Error('Loading lifecycle was not captured')
      expect.soft(signal).toBe(m.directory.calls.at(-1)?.signal)
      expect.soft(signal?.aborted).toBe(false)
      disposal = loadingFiber.dispose().then(() => { disposed = true })
      expect.soft(signal).toBeInstanceOf(AbortSignal)
      expect.soft(signal?.aborted).toBe(true)
      expect(await readFile(m.source, 'utf8')).toBe(m.original)
      expect(disposed).toBe(false)
      expect(m.fs.requests).toHaveLength(requestCount)
      release.resolve(undefined)
      await loadResult
      await disposal
      expect(m.fs.requests).toHaveLength(requestCount)
      expect(m.ctx.get('devLoopLifecycle')).toBeUndefined()
      expect(m.completed).toEqual([])
    } finally {
      release.resolve(undefined)
      await loadResult
      await disposal
    }
  })

  it.each(['range empty', 'range observation failure'] as const)('selects the final outcome after nonzero leader cleanup: %s', async (cleanup) => {
    const m = await mount()
    const caller = new AbortController()
    const reason = new Error('caller cancelled during nonzero-command cleanup')
    const cleanupFailure = new Error('managed range observation failed')
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    const waits: (AbortSignal | undefined)[] = []
    let terminated = false
    let settled = false
    m.runner.onSpawn = spec => spec.argv[1] !== 'ls-files' ? undefined : {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: output(() => ''), stderr: output(() => 'command refused\n') },
      done: Promise.resolve({ exitCode: 1, signal: null }),
      terminate: () => { terminated = true },
      waitForExit: async (signal) => {
        waits.push(signal)
        entered.resolve(undefined)
        await release.promise
        if (cleanup === 'range observation failure') throw cleanupFailure
        return true
      },
    }
    const operation = attempt(complete(m, caller.signal)).then((error) => { settled = true; return error })
    try {
      expect(await Promise.race([
        entered.promise.then(() => 'cleanup'), operation.then(() => 'settled'),
      ])).toBe('cleanup')
      expect(terminated).toBe(true)
      expect(waits).toEqual([undefined])
      caller.abort(reason)
      await expectPending(m)
      expect(settled).toBe(false)
      expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
      release.resolve(undefined)
      expect(await operation).toBe(cleanup === 'range empty' ? reason : cleanupFailure)
      expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
      expect(m.fs.mutations).toEqual([])
      await expectPending(m)
    } finally {
      release.resolve(undefined)
      await operation
    }
  })
})

describe.skipIf(process.platform === 'win32')('startup, managed ranges and completion publication', () => {
  it.each(['list', 'scan'] as const)('disposing during %s cancels hydration before joining initialization', async (point) => {
    const m = await mount()
    await m.fiber.dispose()
    await mkdir(join(m.root, PIECE_ROOT, '01-another-set'))
    m.directory.calls.length = 0
    const entered = deferred<AbortSignal | undefined>()
    const release = deferred<undefined>()
    m.directory.hold = async (method, signal) => {
      if (method !== point) return
      entered.resolve(signal)
      await release.promise
    }
    let loadingFiber: Fiber | undefined
    let readStatus: (() => PieceStatus) | undefined
    // Service availability is withheld during init; retain its public read without changing its work.
    class CapturedLifecycle extends DevLoopLifecycle {
      protected override async [Service.init](): Promise<void> {
        loadingFiber = this.ctx.fiber
        readStatus = () => this.getStatus(ID)
        await super[Service.init]()
      }
    }
    const loading = m.ctx.plugin(CapturedLifecycle)
    const loadResult = Promise.resolve(loading).then(() => undefined, (error: unknown) => error)
    let disposal: Promise<void> | undefined
    let disposed = false
    try {
      const signal = await entered.promise
      if (!loadingFiber || !readStatus) throw new Error('Loading lifecycle was not captured')
      const heldReadStatus = readStatus
      const heldFiber = loadingFiber
      disposal = heldFiber.dispose().then(() => { disposed = true })
      expect.soft(heldFiber.uid).toBeNull()
      expect.soft(signal, 'hydration receives the lifecycle lifetime').toBeInstanceOf(AbortSignal)
      expect.soft(signal?.aborted, 'disposal must abort before the kernel awaits Service.init').toBe(true)
      expect(await readFile(m.source, 'utf8')).toBe(m.original)
      expect(disposed).toBe(false)
      expect(m.directory.calls.map(call => call.method)).toEqual(point === 'list' ? ['list'] : ['list', 'scan'])
      release.resolve(undefined)
      await loadResult
      await disposal
      expect.soft(m.directory.calls.map(call => call.method)).toEqual(point === 'list' ? ['list'] : ['list', 'scan'])
      expect.soft(heldReadStatus).toThrow()
      expect(m.ctx.get('devLoopLifecycle')).toBeUndefined()
      expect(m.completed).toEqual([])
    } finally {
      release.resolve(undefined)
      await loadResult
      await disposal
    }
  })

  it.each(['continue', 'caller abort', 'lifecycle disposal'] as const)('joins the managed range after done settles: %s', async (mode) => {
    const m = await mount()
    const caller = new AbortController()
    const reason = new Error('caller stopped a process range')
    const spawned = deferred<undefined>()
    const leader = deferred<SubprocessOutcome>()
    const rangeEmpty = deferred<undefined>()
    const waiting = deferred<undefined>()
    const nextForward = deferred<undefined>()
    const waits: (AbortSignal | undefined)[] = []
    let terminated = 0
    let operationSettled = false
    let disposed = false
    let disposal: Promise<void> | undefined
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: output(() => FILE), stderr: output(() => '') },
      done: leader.promise,
      terminate: () => { terminated += 1 },
      waitForExit: async (signal) => {
        waits.push(signal)
        waiting.resolve(undefined)
        await rangeEmpty.promise
        return true
      },
    }
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] !== 'ls-files') { nextForward.resolve(undefined); return undefined }
      const onAbort = () => { handle.terminate() }
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      void rangeEmpty.promise.then(() => { spec.signal?.removeEventListener('abort', onAbort) })
      spawned.resolve(undefined)
      return handle
    }
    const operation = attempt(complete(m, caller.signal)).then((error) => { operationSettled = true; return error })
    try {
      await spawned.promise
      if (mode === 'caller abort') caller.abort(reason)
      if (mode === 'lifecycle disposal') disposal = m.fiber.dispose().then(() => { disposed = true })
      leader.resolve(mode === 'continue' ? { exitCode: 0, signal: null } : { exitCode: null, signal: 'SIGTERM' })
      expect(await Promise.race([
        waiting.promise.then(() => 'range'), nextForward.promise.then(() => 'forward'), operation.then(() => 'settled'),
      ])).toBe('range')
      expect(terminated).toBeGreaterThan(0)
      expect(waits).toEqual([undefined])
      await expectPending(m)
      expect(operationSettled).toBe(false)
      expect(disposed).toBe(false)
      expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
      rangeEmpty.resolve(undefined)
      const error = await operation
      await disposal
      if (mode === 'continue') {
        expect(error).toBeUndefined()
        expect(m.lifecycle.getStatus(ID)).toBe('done')
      } else {
        if (mode === 'caller abort') expect(error).toBe(reason)
        else expect(error).toBeInstanceOf(Error)
        expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
        await expectPending(m)
      }
    } finally {
      leader.resolve({ exitCode: null, signal: 'SIGTERM' })
      rangeEmpty.resolve(undefined)
      await operation
      await disposal
    }
  })

  it('surfaces a managed-range observation failure instead of reporting successful command cleanup', async () => {
    const m = await mount()
    const fault = new Error('provider can no longer observe its managed range')
    let terminated = false
    let waited = false
    m.runner.onSpawn = spec => spec.argv[1] !== 'ls-files' ? undefined : {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: output(() => FILE), stderr: output(() => '') },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => { terminated = true },
      waitForExit: () => { waited = true; return Promise.reject(fault) },
    }
    expect(await attempt(complete(m))).toBe(fault)
    expect(terminated).toBe(true)
    expect(waited).toBe(true)
    expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
    await expectPending(m)
  })

  it('cancellation queued after successful git mv reports the absent-source recovery failure before publication', async () => {
    const m = await mount()
    const caller = new AbortController()
    const reason = new Error('cancel after actual git mv')
    let observedMovedFile = false
    m.runner.decorate = (spec, handle) => {
      if (spec.argv[1] !== 'mv') return handle
      const stderr = handle.collected.stderr
      if (!stderr) throw new Error('Real collected stderr reader is missing')
      return {
        ...handle,
        collected: { ...handle.collected, stderr: { readFrom: (offset) => {
          const result = stderr.readFrom(offset)
          observedMovedFile = existsSync(m.destination) && !existsSync(m.source)
          // Dispatch immediately after the command's outcome check, before its awaiting caller resumes.
          queueMicrotask(() => { caller.abort(reason) })
          return result
        } } },
      }
    }
    const error = await attempt(complete(m, caller.signal))
    expect(observedMovedFile).toBe(true)
    expect(m.runner.results.find(result => result.argv[1] === 'mv')?.outcome).toEqual({ exitCode: 0, signal: null })
    expect(error).toMatchObject({ code: 'PIECE_RECOVERY_FAILED', cause: reason })
    expect(error instanceof Error ? error.cause : undefined).toBe(reason)
    expect(error).toHaveProperty('recoveryError', expect.objectContaining({ code: 'FS_STALE_VERSION' }))
    expect(m.fs.mutations).toHaveLength(2)
    expect(m.fs.mutations[1]).toMatchObject({ method: 'edit', expected: m.fs.editedVersions[0] })
    expect(existsSync(m.source)).toBe(false)
    expect(await readFile(m.destination, 'utf8')).toContain('**Status:** done')
    expect(m.lifecycle.getStatus(ID)).toBe('pending')
    expect(m.completed).toEqual([])
  })

  it.each([
    { label: 'defaults', config: {}, grace: 5000, bytes: 65536 },
    { label: 'deployment overrides', config: { terminationGraceMs: 1234, outputMaxBytes: 8192 }, grace: 1234, bytes: 8192 },
    { label: 'timer limit and minimum output', config: { terminationGraceMs: 2147483647, outputMaxBytes: 1 }, grace: 2147483647, bytes: 1 },
  ])('supplies $label to every command', async ({ config, grace, bytes }) => {
    const m = await mount({ config })
    await complete(m)
    expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK, STAGE, MKDIR, MOVE])
    for (const call of m.runner.calls) {
      expect(call.graceMs).toBe(grace)
      expect(call.stdio).toEqual({ stdin: 'ignore', stdout: { maxBytes: bytes }, stderr: { maxBytes: bytes } })
    }
  })

  it.each([
    { terminationGraceMs: 0 }, { terminationGraceMs: -1 }, { terminationGraceMs: 0.5 },
    { terminationGraceMs: 2147483648 }, { terminationGraceMs: Infinity }, { terminationGraceMs: NaN },
    { outputMaxBytes: 0 }, { outputMaxBytes: -1 }, { outputMaxBytes: 0.5 },
    { outputMaxBytes: Infinity }, { outputMaxBytes: NaN },
  ])('rejects invalid process budgets at mount: %o', async (config) => {
    expect(await attempt(mount({ config }).then(() => undefined))).toBeInstanceOf(Error)
  })

  it.each(['absent', 'missing status', 'invalid status'] as const)('rejects a post-hydration source that is %s, then releases the claim for retry', async (change) => {
    const m = await mount()
    if (change === 'absent') await rm(m.source)
    else await writeFile(m.source, m.original.replace('**Status:** pending', change === 'missing status' ? '' : '**Status:** nonsense'))
    expect(await attempt(complete(m))).toMatchObject({ code: change === 'absent' ? 'FS_NOT_FOUND' : 'FS_EDIT_NOT_FOUND' })
    expect(m.lifecycle.getStatus(ID)).toBe('pending')
    expect(m.completed).toEqual([])
    expect(m.fs.mutations).toEqual([])
    expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
    await writeFile(m.source, m.original)
    await complete(m)
    expect(m.lifecycle.getStatus(ID)).toBe('done')
    expect(await readFile(m.destination, 'utf8')).toBe(m.original.replace('**Status:** pending', '**Status:** done'))
  })

  it('without a format listener, a valid status in a header-only document can complete despite missing corpus sections', async () => {
    const m = await mount()
    const headerOnly = `# ${ID} — externally truncated\n\n**Status:** pending\n`
    await writeFile(m.source, headerOnly)
    await complete(m)
    expect(await readFile(m.destination, 'utf8')).toBe(headerOnly.replace('pending', 'done'))
    expect(m.lifecycle.getStatus(ID)).toBe('done')
    expect(m.completed).toHaveLength(1)
  })
})

describe.skipIf(process.platform === 'win32')('piece lifecycle repair', () => {
  it('awaits serial pre-complete listeners before mutation, rejects a competing claim, then completes', async () => {
    const m = await mount()
    const first = deferred<undefined>()
    const second = deferred<undefined>()
    const releaseFirst = deferred<undefined>()
    const releaseSecond = deferred<undefined>()
    cleanups.push(async () => { releaseFirst.resolve(undefined); releaseSecond.resolve(undefined) })
    const seen: PreComplete[] = []
    preComplete(m.ctx, async (event) => { seen.push(event); first.resolve(undefined); await releaseFirst.promise })
    preComplete(m.ctx, async (event) => { seen.push(event); second.resolve(undefined); await releaseSecond.promise })
    const operation = attempt(complete(m))
    try {
      expect(await Promise.race([first.promise.then(() => 'hook'), operation.then(() => 'settled')])).toBe('hook')
      expect(seen).toHaveLength(1)
      expect(m.fs.mutations).toEqual([])
      expect(m.runner.calls).toEqual([])
      await expectPending(m)
      expect(await attempt(complete(m))).toMatchObject({ code: 'PIECE_STALE_STATUS' })
      releaseFirst.resolve(undefined)
      await second.promise
      expect(seen).toHaveLength(2)
      expect(seen[0]).toMatchObject({ pieceId: ID, from: 'pending', to: 'done', reason: 'verified' })
      expect(seen[0]?.signal).toBeInstanceOf(AbortSignal)
      expect(m.fs.mutations).toEqual([])
      expect(m.runner.calls).toEqual([])
      releaseSecond.resolve(undefined)
      expect(await operation).toBeUndefined()
      expect(m.completed).toHaveLength(1)
    } finally {
      releaseFirst.resolve(undefined); releaseSecond.resolve(undefined)
      await operation
    }
  })

  it('a rejecting pre-complete listener leaves bytes and index untouched and releases the claim for retry', async () => {
    const m = await mount()
    const veto = new Error('verification veto')
    const remove = preComplete(m.ctx, async () => { throw veto })
    const index = await readFile(join(m.root, '.git', 'index'))
    expect(await attempt(complete(m))).toBe(veto)
    expect(m.fs.mutations).toEqual([])
    expect(m.runner.calls).toEqual([])
    expect(await readFile(join(m.root, '.git', 'index'))).toEqual(index)
    await expectPending(m)
    remove()
    await complete(m)
    expect(m.lifecycle.getStatus(ID)).toBe('done')
    expect(m.completed).toHaveLength(1)
  })

  it('checks tracking before any mutation and preserves untracked bytes', async () => {
    const m = await mount({ tracked: false })
    expect(await attempt(complete(m))).toMatchObject({ code: 'PIECE_MOVE_NOT_TRACKED', argv: TRACK })
    expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
    expect(m.fs.mutations).toEqual([])
    await expectPending(m)
    expect((await m.git('ls-files')).stdout).toBe('')
  })

  it('guards fs.editText with the observed version instead of overwriting a concurrent writer', async () => {
    const m = await mount()
    const target = await m.fs.resolve(SOURCE)
    const observed = await m.fs.stat(target)
    const concurrent = `${m.original}\nOther writer owns this edit.\n`
    let injected = false
    m.fs.beforeMutation = async () => {
      if (injected) return
      injected = true
      await writeFile(m.source, concurrent)
    }
    const error = await attempt(complete(m))
    expect(injected).toBe(true)
    expect(error).toMatchObject({ code: 'FS_STALE_VERSION' })
    expect(m.fs.mutations[0]).toMatchObject({ method: 'edit', expected: observed?.version })
    expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
    await expectPending(m, concurrent)
  })

  it.each(['stage', 'mkdir'] as const)('%s nonzero reports that exact command and stops later forward commands', async (point) => {
    const m = await mount()
    const failedArgv = point === 'stage' ? STAGE : MKDIR
    if (point === 'stage') await writeFile(join(m.root, '.git', 'index.lock'), 'external lock\n')
    else await writeFile(join(dirname(m.source), 'done'), 'not a directory\n')
    const error = await attempt(complete(m))
    const failed = m.runner.results.find(result => result.argv.join('\0') === failedArgv.join('\0'))
    expect(failed?.outcome.signal).toBeNull()
    expect(failed?.outcome.exitCode).not.toBe(0)
    expect(error).toMatchObject({ code: 'PIECE_MOVE_FAILED', pieceId: ID, argv: failedArgv, stderr: failed?.stderr })
    expect(m.runner.calls.map(call => call.argv)).toEqual(point === 'stage' ? [TRACK, STAGE] : [TRACK, STAGE, MKDIR])
    await expectPending(m)
  })

  it('a real post-header move failure restores the header without resetting unrelated staged bytes', async () => {
    const m = await mount()
    await writeFile(join(m.root, 'other.txt'), 'another staged change\n')
    await m.git('add', '--', 'other.txt')
    await mkdir(dirname(m.destination))
    await writeFile(m.destination, 'destination owned by somebody else\n')
    let headerAtMove = ''
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] === 'mv') headerAtMove = readFileSync(m.source, 'utf8')
      return undefined
    }
    const error = await attempt(complete(m))
    expect(headerAtMove).toBe(m.original.replace('**Status:** pending', '**Status:** done'))
    expect(error).toMatchObject({ code: 'PIECE_MOVE_FAILED', argv: MOVE })
    expect(m.lifecycle.getStatus(ID)).toBe('pending')
    expect(m.completed).toEqual([])
    expect(await readFile(m.source, 'utf8')).toBe(m.original)
    expect(await readFile(m.destination, 'utf8')).toBe('destination owned by somebody else\n')
    expect((await m.git('show', ':other.txt')).stdout).toBe('another staged change\n')
    expect(m.fs.mutations).toHaveLength(2)
    expect(m.fs.mutations.every(mutation => mutation.method === 'edit' && mutation.expected !== undefined)).toBe(true)
  })

  it('recovery conflicts preserve the other writer and report initiating and recovery failures', async () => {
    const m = await mount()
    await mkdir(dirname(m.destination))
    await writeFile(m.destination, 'occupied\n')
    const concurrent = `${m.original.replace('**Status:** pending', '**Status:** done')}\nOther writer after rewrite.\n`
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] === 'mv') writeFileSync(m.source, concurrent)
      return undefined
    }
    const error = await attempt(complete(m))
    expect(error).toMatchObject({ code: 'PIECE_RECOVERY_FAILED', pieceId: ID })
    // Error.cause and recoveryError retain the original objects, not only their messages.
    expect(error).toHaveProperty('cause', expect.objectContaining({ code: 'PIECE_MOVE_FAILED', argv: MOVE }))
    expect(error).toHaveProperty('recoveryError', expect.objectContaining({ code: 'FS_STALE_VERSION' }))
    expect(m.fs.editedVersions).toHaveLength(1)
    expect(m.fs.mutations).toHaveLength(2)
    expect(m.fs.mutations[1]).toMatchObject({ method: 'edit', expected: m.fs.editedVersions[0] })
    expect(await readFile(m.source, 'utf8')).toBe(concurrent)
    expect(m.lifecycle.getStatus(ID)).toBe('pending')
    expect(m.completed).toEqual([])
  })

  it('retries a live pending piece whose disk header is already done', async () => {
    const m = await mount()
    const done = m.original.replace('**Status:** pending', '**Status:** done')
    await writeFile(m.source, done)
    await complete(m)
    expect(await readFile(m.destination, 'utf8')).toBe(done)
    expect(m.lifecycle.getStatus(ID)).toBe('done')
    expect(m.completed).toHaveLength(1)
  })

  it('retries after a real failure reached git mv with an already rewritten header', async () => {
    const m = await mount()
    await mkdir(dirname(m.destination))
    await writeFile(m.destination, 'occupied\n')
    const headers: string[] = []
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] === 'mv') headers.push(readFileSync(m.source, 'utf8'))
      return undefined
    }
    expect(await attempt(complete(m))).toMatchObject({ code: 'PIECE_MOVE_FAILED', argv: MOVE })
    expect(headers).toEqual([m.original.replace('**Status:** pending', '**Status:** done')])
    await rm(m.destination)
    await complete(m)
    expect(headers).toHaveLength(2)
    expect(await readFile(m.destination, 'utf8')).toBe(m.original.replace('**Status:** pending', '**Status:** done'))
    expect(m.lifecycle.getStatus(ID)).toBe('done')
    expect(m.completed).toHaveLength(1)
  })

  it('completes an approved todo file using its actual disk header rather than the in-memory pending status', async () => {
    const m = await mount({ status: 'todo' })
    await m.lifecycle.transition(ID, 'todo', 'pending')
    await complete(m)
    expect(await readFile(m.destination, 'utf8')).toBe(m.original.replace('**Status:** todo', '**Status:** done'))
    expect(m.lifecycle.getStatus(ID)).toBe('done')
  })

  it('failed completion restores the actual prior todo header while keeping approved memory pending', async () => {
    const m = await mount({ status: 'todo' })
    await m.lifecycle.transition(ID, 'todo', 'pending')
    await mkdir(dirname(m.destination))
    await writeFile(m.destination, 'occupied\n')
    let atMove = ''
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] === 'mv') atMove = readFileSync(m.source, 'utf8')
      return undefined
    }
    expect(await attempt(complete(m))).toMatchObject({ code: 'PIECE_MOVE_FAILED' })
    expect(atMove).toBe(m.original.replace('**Status:** todo', '**Status:** done'))
    expect(await readFile(m.source, 'utf8')).toBe(m.original)
    expect(m.lifecycle.getStatus(ID)).toBe('pending')
    expect(m.completed).toEqual([])
  })

  it('propagates a synchronous completion listener error after publishing the committed state', async () => {
    const m = await mount()
    const fault = new Error('synchronous announcement fault')
    m.ctx.on('piece/completed', (event) => {
      expect(m.lifecycle.getStatus(ID)).toBe('done')
      expect(event.newPath).toBe(DESTINATION)
      expect(existsSync(m.destination)).toBe(true)
      throw fault
    })
    expect(await attempt(complete(m))).toBe(fault)
    expect(m.lifecycle.getStatus(ID)).toBe('done')
    expect(await readFile(m.destination, 'utf8')).toContain('**Status:** done')
    expect(existsSync(m.source)).toBe(false)
    expect(await attempt(complete(m))).toMatchObject({ code: 'PIECE_STALE_STATUS' })
  })

  it('resolves completion without awaiting an asynchronous announcement listener', async () => {
    const m = await mount()
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    const listenerSettled = deferred<undefined>()
    let listenerFinished = false
    let listenerStarted = false
    // This listener deliberately returns a promise to distinguish emit from awaited dispatch.
    const onCompleted: (name: 'piece/completed', listener: () => Promise<void>) => () => boolean = m.ctx.on.bind(m.ctx)
    onCompleted('piece/completed', async () => {
      listenerStarted = true
      entered.resolve(undefined)
      await release.promise
      listenerFinished = true
      listenerSettled.resolve(undefined)
    })
    const operation = attempt(complete(m))
    const cleanup = async () => {
      release.resolve(undefined)
      await operation
      if (listenerStarted) await listenerSettled.promise
    }
    cleanups.push(cleanup)
    try {
      expect(await Promise.race([
        entered.promise.then(() => 'listener'), operation.then(() => 'settled'),
      ])).toBe('listener')
      expect(await operation).toBeUndefined()
      expect(listenerFinished).toBe(false)
      expect(m.lifecycle.getStatus(ID)).toBe('done')
      expect(await readFile(m.destination, 'utf8')).toContain('**Status:** done')
    } finally {
      await cleanup()
    }
  })

  it('an already-aborted caller starts no file or Git work and can retry with a fresh signal', async () => {
    const m = await mount()
    const controller = new AbortController()
    const reason = new Error('cancelled before admission')
    controller.abort(reason)
    expect(await attempt(complete(m, controller.signal))).toBe(reason)
    expect(m.runner.calls).toEqual([])
    expect(m.fs.mutations).toEqual([])
    expect(m.fs.observations).toEqual([])
    await expectPending(m)
    await complete(m, new AbortController().signal)
    expect(m.completed).toHaveLength(1)
  })

  it('awaits safe header recovery after caller abort instead of forwarding an aborted recovery signal', async () => {
    const m = await mount()
    const controller = new AbortController()
    const entered = deferred<SubprocessSpawnSpec>()
    const settled = deferred<SubprocessOutcome>()
    const recoveryEntered = deferred<undefined>()
    const releaseRecovery = deferred<undefined>()
    let didCancel = false
    let finished = false
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: output(() => ''), stderr: output(() => '') },
      done: settled.promise,
      terminate: () => { didCancel = true },
      waitForExit: async () => { await settled.promise; return true },
    }
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] !== 'add') return undefined
      const onAbort = () => { handle.terminate() }
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      void settled.promise.then(() => spec.signal?.removeEventListener('abort', onAbort))
      entered.resolve(spec)
      return handle
    }
    m.fs.beforeMutation = async () => {
      if (m.fs.mutations.length !== 2) return
      recoveryEntered.resolve(undefined)
      await releaseRecovery.promise
    }
    const reason = new Error('cancel after header rewrite')
    const operation = attempt(complete(m, controller.signal)).then((error) => { finished = true; return error })
    try {
      await entered.promise
      expect(await readFile(m.source, 'utf8')).toBe(m.original.replace('**Status:** pending', '**Status:** done'))
      controller.abort(reason)
      expect(didCancel).toBe(true)
      expect(finished).toBe(false)
      settled.resolve({ exitCode: null, signal: 'SIGTERM' })
      expect(await Promise.race([
        recoveryEntered.promise.then(() => 'recovery'), operation.then(() => 'settled'),
      ])).toBe('recovery')
      expect(finished).toBe(false)
      expect(m.fs.mutations[1]?.method).toBe('edit')
      expect(m.fs.mutations[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(m.fs.mutations[1]?.signal?.aborted).toBe(false)
      expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK, STAGE])
      releaseRecovery.resolve(undefined)
      expect(await operation).toBe(reason)
      await expectPending(m)
    } finally {
      settled.resolve({ exitCode: null, signal: 'SIGTERM' })
      releaseRecovery.resolve(undefined)
      await operation
    }
  })

  it('shares one caller-linked operation signal across the hook, filesystem and subprocess operations', async () => {
    const m = await mount()
    const controller = new AbortController()
    const signals: AbortSignal[] = []
    preComplete(m.ctx, (event) => { signals.push(event.signal) })
    await complete(m, controller.signal)
    expect(signals).toHaveLength(1)
    const [operationSignal] = signals
    expect(operationSignal).toBeInstanceOf(AbortSignal)
    expect(operationSignal).not.toBe(controller.signal)
    expect(m.runner.calls.length).toBeGreaterThan(0)
    expect(m.runner.calls.every(call => call.signal === operationSignal)).toBe(true)
    expect(m.fs.mutations.length).toBeGreaterThan(0)
    expect(m.fs.mutations.every(call => call.signal === operationSignal)).toBe(true)
    expect(m.fs.observations.length).toBeGreaterThan(0)
    expect(m.fs.observations.every(call => call.signal === operationSignal)).toBe(true)
    const reason = new Error('caller abort after completion')
    controller.abort(reason)
    expect(operationSignal?.aborted).toBe(true)
    expect(operationSignal?.reason).toBe(reason)
  })

  it.each(['caller abort', 'lifecycle disposal'] as const)('%s cancels an in-flight handle and waits for settlement without new forward work', async (kind) => {
    const m = await mount()
    const controller = new AbortController()
    const entered = deferred<SubprocessSpawnSpec>()
    const cancelled = deferred<undefined>()
    const settled = deferred<SubprocessOutcome>()
    let didCancel = false
    let finished = false
    let disposed = false
    let disposal: Promise<unknown> | undefined
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined,
      collected: { stdout: output(() => ''), stderr: output(() => '') },
      done: settled.promise,
      terminate: () => { didCancel = true; cancelled.resolve(undefined) },
      waitForExit: async () => { await settled.promise; return true },
    }
    m.runner.onSpawn = (spec) => {
      if (spec.argv[1] !== 'ls-files') return undefined
      const onAbort = () => { handle.terminate() }
      spec.signal?.addEventListener('abort', onAbort, { once: true })
      void settled.promise.then(() => spec.signal?.removeEventListener('abort', onAbort))
      entered.resolve(spec)
      return handle
    }
    const operation = attempt(complete(m, controller.signal)).then((error) => { finished = true; return error })
    try {
      const spec = await entered.promise
      const observationsBeforeCancellation = m.fs.observations.length
      const reason = new Error('caller stopped')
      if (kind === 'caller abort') {
        controller.abort(reason)
        expect(didCancel, 'caller signal reaches the held process').toBe(true)
      } else {
        disposal = m.fiber.dispose().then(() => { disposed = true })
        expect(await Promise.race([
          cancelled.promise.then(() => 'cancelled'), disposal.then(() => 'disposed'),
        ])).toBe('cancelled')
      }
      expect(spec.signal).toBeInstanceOf(AbortSignal)
      expect(spec.signal?.aborted).toBe(true)
      // Observe the filesystem while the process remains unsettled, not after releasing it.
      await expectPending(m)
      expect(finished).toBe(false)
      expect(disposed).toBe(false)
      expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
      expect(m.fs.observations).toHaveLength(observationsBeforeCancellation)
      // A command may finish normally while cancellation is being delivered.
      settled.resolve({ exitCode: 0, signal: null })
      const error = await operation
      if (kind === 'caller abort') expect(error).toBe(reason)
      else expect(error).toBeInstanceOf(Error)
      await disposal
      expect(m.runner.calls.map(call => call.argv)).toEqual([TRACK])
      expect(m.fs.observations).toHaveLength(observationsBeforeCancellation)
      expect(m.fs.mutations).toEqual([])
      expect(m.completed).toEqual([])
      expect(await readFile(m.source, 'utf8')).toBe(m.original)
      if (kind === 'lifecycle disposal') expect(m.ctx.get('devLoopLifecycle')).toBeUndefined()
    } finally {
      settled.resolve({ exitCode: null, signal: 'SIGTERM' })
      await operation
      await disposal
    }
  })
})
