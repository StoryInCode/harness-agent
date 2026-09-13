import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { brandString } from '@deepseek-ai/dsh-brand'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import Worktrees from '../src/index.ts'
import type { Config, WorktreeAssignmentId } from '../src/index.ts'

const policy = { commandTimeoutMs: 10_000, outputMaxBytes: 128_000, terminationGraceMs: 100 }
const signal = () => new AbortController().signal
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

// Every fixture owns its contexts, command deadlines, joined ranges and private repository.
async function fixture(run: (f: Fixture) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-worktree-'))
  const ctx = new Context()
  const contexts: Context[] = []
  const handles = new Set<SubprocessHandle>()
  try {
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(LocalSubprocessRuntime)
    const repo = join(root, 'main')
    await mkdir(repo)
    const git = async (cwd: string, ...args: string[]) => {
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, 10_000)
      let handle: SubprocessHandle | undefined
      try {
        const executable = await ctx.subprocess.resolveExecutable('git', undefined, controller.signal)
        handle = ctx.subprocess.spawn({ argv: [executable, ...args], cwd,
          stdio: { stdin: 'ignore', stdout: { maxBytes: 128_000 }, stderr: { maxBytes: 128_000 } },
          graceMs: 100, signal: controller.signal,
          env: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'absent-config'),
            GIT_AUTHOR_NAME: 'Private Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
            GIT_COMMITTER_NAME: 'Private Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
            GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
            GIT_COMMON_DIR: undefined, GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
            GIT_TERMINAL_PROMPT: '0' },
        })
        handles.add(handle)
        const outcome = await handle.done
        expect(controller.signal.aborted, 'fixture command deadline').toBe(false)
        expect(outcome, handle.collected.stderr?.readFrom(0).text).toEqual({ exitCode: 0, signal: null })
        const output = handle.collected.stdout!.readFrom(0)
        expect(output.lossy).toBe(false)
        return output.text.trim()
      } finally {
        clearTimeout(timer)
        if (handle) {
          handle.terminate()
          expect(await handle.waitForExit()).toBe(true)
          handles.delete(handle)
        }
      }
    }
    await git(repo, 'init', '--initial-branch=main')
    await writeFile(join(repo, '.gitignore'), '.worktrees/\n*.secret\n')
    await writeFile(join(repo, 'tracked.txt'), 'base\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'private fixture base')
    const base = await git(repo, 'rev-parse', 'HEAD')
    const mount = async (overrides: Partial<Config> = {}, loader = false) => {
      const owner = new Context()
      contexts.push(owner)
      const config = { ...policy, mainlinePath: repo, ...overrides }
      if (loader) {
        const file = join(root, 'cordis.yml')
        await writeFile(file, [
          '- name: fs-local', `  config: ${JSON.stringify({ cwd: repo })}`,
          '- name: subprocess-local', '- name: worktree', `  config: ${JSON.stringify(config)}`, '',
        ].join('\n'))
        owner.baseUrl = pathToFileURL(root).href + '/'
        await owner.plugin(Loader)
        owner.loader.builtins.include = Include
        const modules = new Map<string, unknown>([['fs-local', LocalFileSystem], ['subprocess-local', LocalSubprocessRuntime], ['worktree', Worktrees]])
        owner.loader.internal = { version: 'v2', async import(name: string) {
          if (!modules.has(name)) throw new Error(`unexpected module ${name}`)
          return modules.get(name)
        } } as unknown as NonNullable<typeof owner.loader.internal>
        await owner.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
        await owner.loader.await()
      } else {
        await owner.plugin(LocalFileSystem, { cwd: repo })
        await owner.plugin(LocalSubprocessRuntime)
        await owner.plugin(Worktrees, config)
      }
      expect(owner.get('devLoopWorktree'), 'service publication').toBeDefined()
      return owner
    }
    await run({ root, repo, base, git, mount })
  } finally {
    for (const owner of contexts.reverse()) await owner.fiber.dispose()
    for (const handle of handles) { handle.terminate(); await handle.waitForExit() }
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}
type Fixture = {
  root: string
  repo: string
  base: string
  git(cwd: string, ...args: string[]): Promise<string>
  mount(overrides?: Partial<Config>, loader?: boolean): Promise<Context>
}
const assign = (ctx: Context, cwd: string, pieceId = '00.05', abort = signal()) =>
  ctx.devLoopWorktree.assignWorktree({ pieceId, cwd, signal: abort })
const inventory = (f: Fixture) => f.git(f.repo, 'worktree', 'list', '--porcelain', '-z')

// A controllable process outcome and a separately controllable range-empty observation.
function gate(ctx: Context, mode: 'hold' | 'failure' | 'lossy' | 'malformed' | 'nonzero' | 'registration' = 'hold', action = 'add') {
  const entered = deferred<SubprocessSpawnSpec>()
  const release = deferred<undefined>()
  const waitEntered = deferred<AbortSignal | undefined>()
  const empty = deferred<boolean>()
  const aborted = deferred<undefined>()
  const terminated = vi.fn()
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  const specs: SubprocessSpawnSpec[] = []
  const handles: SubprocessHandle[] = []
  let claimed = false
  let added = false
  const spy = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    specs.push(spec)
    const isAdd = spec.argv.includes(action) && spec.argv.includes('worktree')
    const isInventory = spec.argv.includes('list') && spec.argv.includes('worktree')
    const corruptInventory = ['registration', 'malformed', 'lossy'].includes(mode)
    if (claimed || !(corruptInventory ? isInventory && added : isAdd)) {
      if (isAdd) added = true
      const handle = spawn(spec); handles.push(handle); return handle
    }
    claimed = true
    spec.signal?.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    const real = mode === 'hold' ? spawn(spec) : undefined
    if (real) handles.push(real)
    const terminate = () => { terminated(); real?.terminate() }
    const done = (async () => {
      if (real) {
        const outcome = await real.done
        expect(outcome).toEqual({ exitCode: 0, signal: null })
        expect(await real.waitForExit()).toBe(true)
      }
      entered.resolve(spec)
      await release.promise
      if (mode === 'failure') throw new Error('fixture provider fault')
      return { exitCode: mode === 'nonzero' ? 7 : 0, signal: null }
    })()
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined, done, terminate,
      collected: real?.collected ?? {
        stdout: { readFrom: () => ({ text: mode === 'malformed' ? 'not git inventory' : '', nextOffset: 0, lossy: mode === 'lossy' }) },
        stderr: { readFrom: () => ({ text: 'fixture diagnostic', nextOffset: 18, lossy: false }) },
      },
      async waitForExit(bound) { waitEntered.resolve(bound); return empty.promise },
    }
    return handle
  })
  return { entered, release, empty, aborted, waitEntered, specs, terminated,
    async close() {
      release.resolve(undefined); empty.resolve(true)
      spy.mockRestore()
      for (const h of handles) { h.terminate(); await h.done.catch(() => undefined); await h.waitForExit() }
    },
  }
}

// Rejection handlers attach immediately: barrier assertions never create unhandled rejections.
function observe<T>(promise: Promise<T>) {
  let settled = false
  const result = promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
    .finally(() => { settled = true })
  return { result, settled: () => settled }
}
async function enteredOrFailure<T>(entered: Promise<T>, operation: ReturnType<typeof observe>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([entered, operation.result.then((result) => {
      throw new Error(`allocation settled before subprocess barrier: ${result.ok ? 'unexpected success' : String(result.error)}`)
    }), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new Error('subprocess barrier not reached')) }, 20_000)
    })])
  } finally { clearTimeout(timer) }
}

// Real Git probes plus the 10s command-deadline subject must fit before the outer case bound.
describe('retained detached worktree allocation', { timeout: 30_000 }, () => {
  it('creates a real detached checkout and independent index without copying mainline changes or making a branch', () => fixture(async (f) => {
    await writeFile(join(f.repo, 'tracked.txt'), 'main staged\n')
    await f.git(f.repo, 'add', 'tracked.txt')
    await writeFile(join(f.repo, 'tracked.txt'), 'main unstaged\n')
    await writeFile(join(f.repo, 'untracked.txt'), 'main evidence')
    await writeFile(join(f.repo, 'key.secret'), 'private')
    const branches = await f.git(f.repo, 'show-ref', '--heads')
    const index = await readFile(join(f.repo, '.git', 'index'))
    const ctx = await f.mount()
    const fsResolve = vi.spyOn(ctx.fs, 'resolve')
    const a = await assign(ctx, f.repo)
    expect(a).toMatchObject({ pieceId: '00.05', ownership: 'created', baseCommit: f.base, mainlinePath: f.repo })
    expect(dirname(a.worktreePath)).toBe(join(f.repo, '.worktrees'))
    expect(await f.git(a.worktreePath, 'rev-parse', 'HEAD')).toBe(f.base)
    expect(await f.git(a.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD')
    expect(await f.git(a.worktreePath, 'rev-parse', '--git-path', 'index')).not.toBe(join(f.repo, '.git', 'index'))
    expect(await readFile(join(a.worktreePath, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(await readdir(a.worktreePath)).not.toContain('key.secret')
    expect(await readdir(a.worktreePath)).not.toContain('untracked.txt')
    await writeFile(join(a.worktreePath, 'tracked.txt'), 'worker staged')
    await f.git(a.worktreePath, 'add', 'tracked.txt')
    expect(await readFile(join(f.repo, '.git', 'index'))).toEqual(index)
    expect(await readFile(join(f.repo, 'tracked.txt'), 'utf8')).toBe('main unstaged\n')
    expect(await f.git(f.repo, 'show-ref', '--heads')).toBe(branches)
    expect(await inventory(f)).toContain(a.worktreePath)
    expect(fsResolve).toHaveBeenCalled()
    expect(Object.isFrozen(a)).toBe(true)
  }))

  it('retains Test Writer files and pinned base for the Implementer after mainline advances', () => fixture(async (f) => {
    const ctx = await f.mount()
    const a = await assign(ctx, f.repo)
    await writeFile(join(a.worktreePath, 'retained.spec.ts'), 'test evidence')
    await f.git(f.repo, 'commit', '--allow-empty', '-m', 'advance private fixture')
    const b = await assign(ctx, f.repo)
    expect(b).toBe(a)
    expect(ctx.devLoopWorktree.getAssignment('00.05')).toBe(a)
    expect(b.baseCommit).toBe(f.base)
    expect(await readFile(join(b.worktreePath, 'retained.spec.ts'), 'utf8')).toBe('test evidence')
  }))

  it('coalesces overlapping callers without allowing a cancelled waiter to abort the owner', () => fixture(async (f) => {
    const ctx = await f.mount(); const g = gate(ctx)
    const owner = observe(assign(ctx, f.repo))
    let waiter: ReturnType<typeof observe> | undefined
    let compatible: ReturnType<typeof observe> | undefined
    try {
      const spec = await enteredOrFailure(g.entered.promise, owner)
      const cancel = new AbortController()
      waiter = observe(assign(ctx, f.repo, '00.05', cancel.signal))
      compatible = observe(assign(ctx, f.repo))
      cancel.abort()
      await Promise.resolve()
      expect(spec.signal?.aborted).toBe(false)
      expect(owner.settled()).toBe(false)
      g.release.resolve(undefined); g.empty.resolve(true)
      const first = await owner.result; const second = await compatible.result
      expect(first.ok).toBe(true); expect(second.ok).toBe(true)
      if (first.ok && second.ok) expect(second.value).toBe(first.value)
      expect((await waiter.result).ok).toBe(false)
      expect(g.specs.filter(s => s.argv.includes('worktree') && s.argv.includes('add'))).toHaveLength(1)
    } finally { await g.close(); await owner.result; await waiter?.result; await compatible?.result }
  }))

  it('rejects coalesced waiters when their owner cancels and admits an explicit retry after settlement', () => fixture(async (f) => {
    const ctx = await f.mount(); const g = gate(ctx, 'nonzero')
    const cancel = new AbortController()
    const owner = observe(assign(ctx, f.repo, '00.05', cancel.signal))
    let waiter: ReturnType<typeof observe> | undefined
    try {
      await enteredOrFailure(g.entered.promise, owner)
      waiter = observe(assign(ctx, f.repo))
      cancel.abort(); g.release.resolve(undefined)
      expect(await enteredOrFailure(g.waitEntered.promise, owner)).toBeUndefined()
      expect(owner.settled()).toBe(false)
      g.empty.resolve(true)
      expect((await owner.result).ok).toBe(false)
      expect((await waiter.result).ok).toBe(false)
      expect(ctx.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
    } finally { await g.close(); await owner.result; await waiter?.result }
    expect((await assign(ctx, f.repo)).baseCommit).toBe(f.base)
  }))

  it.each(['detached', 'attached'] as const)('borrows %s linked isolation without nesting or claiming removal ownership', kind => fixture(async (f) => {
    const borrowed = join(f.root, 'borrowed')
    if (kind === 'attached') {
      await f.git(f.repo, 'checkout', '--detach')
      await f.git(f.repo, 'worktree', 'add', borrowed, 'main')
    } else await f.git(f.repo, 'worktree', 'add', '--detach', borrowed, f.base)
    await writeFile(join(borrowed, 'evidence'), 'borrowed evidence')
    const before = await inventory(f)
    const ctx = await f.mount(); const a = await assign(ctx, borrowed)
    expect(a).toMatchObject({ ownership: 'borrowed', worktreePath: borrowed, baseCommit: f.base })
    await expect(assign(ctx, borrowed, '00.06')).rejects.toThrow(/borrow|claim|assign|occup/i)
    await expect(assign(ctx, f.repo)).rejects.toThrow(/incompat|conflict|cwd|assign/i)
    expect(await ctx.devLoopWorktree.retireWorktree(a.id, signal())).toEqual({ kind: 'preserved', reason: 'borrowed' })
    await ctx.fiber.dispose()
    expect(await inventory(f)).toBe(before)
    expect(await readFile(join(borrowed, 'evidence'), 'utf8')).toBe('borrowed evidence')
  }))

  it('refuses an unignored root without modifying ignore files or creating a tree', () => fixture(async (f) => {
    const before = await inventory(f); const ignore = await readFile(join(f.repo, '.gitignore'))
    const ctx = await f.mount({ worktreeRoot: 'visible-workers' })
    await expect(assign(ctx, f.repo)).rejects.toThrow(/ignor/i)
    expect(ctx.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
    expect(await inventory(f)).toBe(before)
    expect(await readFile(join(f.repo, '.gitignore'))).toEqual(ignore)
    expect(await readdir(f.repo)).not.toContain('visible-workers')
  }))

  it('refuses an unrecorded occupied target after restart and preserves its files', () => fixture(async (f) => {
    const first = await f.mount(); const a = await assign(first, f.repo)
    await writeFile(join(a.worktreePath, 'evidence'), 'do not adopt')
    await first.fiber.dispose()
    const second = await f.mount()
    await expect(assign(second, f.repo)).rejects.toThrow(/occup|exist|recover|collision/i)
    expect(second.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
    expect(await readFile(join(a.worktreePath, 'evidence'), 'utf8')).toBe('do not adopt')
  }))

  it('rejects symlink escape without writing into the outside directory', () => fixture(async (f) => {
    const outside = join(f.root, 'outside'); await mkdir(outside)
    await symlink(outside, join(f.repo, '.worktrees'), process.platform === 'win32' ? 'junction' : 'dir')
    const ctx = await f.mount()
    await expect(assign(ctx, f.repo)).rejects.toThrow(/symlink|contain|escap|outside/i)
    expect(await readdir(outside)).toEqual([])
  }))

  it('rejects submodules rather than confusing their git file with linked isolation', () => fixture(async (f) => {
    const source = join(f.root, 'sub-source')
    await f.git(f.root, 'clone', '--no-hardlinks', f.repo, source)
    await f.git(f.repo, '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'module')
    const before = await inventory(f); const ctx = await f.mount()
    await expect(assign(ctx, join(f.repo, 'module'))).rejects.toThrow(/submodule|superproject/i)
    expect(await inventory(f)).toBe(before)
  }))

  it('rejects invalid repositories and traversal piece IDs without filesystem mutation', () => fixture(async (f) => {
    const ctx = await f.mount()
    await expect(assign(ctx, f.root)).rejects.toThrow(/git|repo/i)
    await expect(assign(ctx, f.repo, '../escape')).rejects.toThrow(/piece|invalid/i)
    expect(await readdir(f.repo)).not.toContain('.worktrees')
  }))

  it.each(['tracked', 'staged', 'untracked', 'ignored', 'head-changed'] as const)('preserves %s owned work on explicit nonforce retirement', kind => fixture(async (f) => {
    const ctx = await f.mount(); const a = await assign(ctx, f.repo)
    if (kind === 'head-changed') await f.git(a.worktreePath, 'commit', '--allow-empty', '-m', 'untransferred detached commit')
    else {
      const file = kind === 'ignored' ? 'proof.secret' : kind === 'untracked' ? 'proof.txt' : 'tracked.txt'
      await writeFile(join(a.worktreePath, file), 'retained evidence')
      if (kind === 'staged') await f.git(a.worktreePath, 'add', file)
    }
    const before = await inventory(f)
    expect(await ctx.devLoopWorktree.retireWorktree(a.id, signal())).toEqual({ kind: 'preserved', reason: kind === 'head-changed' ? kind : 'dirty' })
    expect(ctx.devLoopWorktree.getAssignment('00.05')).toBe(a)
    expect(await inventory(f)).toBe(before)
  }))

  it('removes only a clean unchanged owned tree and forgets it only after Git succeeds', () => fixture(async (f) => {
    const ctx = await f.mount(); const a = await assign(ctx, f.repo)
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    expect(await ctx.devLoopWorktree.retireWorktree(a.id, signal())).toEqual({ kind: 'removed' })
    expect(ctx.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
    expect(await inventory(f)).not.toContain(a.worktreePath)
    expect(await readdir(dirname(a.worktreePath))).not.toContain(a.worktreePath.split(/[\\/]/).at(-1))
    const remove = spawn.mock.calls.map(([s]) => s).filter(s => s.argv.includes('remove'))
    expect(remove).toHaveLength(1)
    expect(remove[0]!.argv).not.toContain('--force')
    await expect(ctx.devLoopWorktree.retireWorktree(brandString<WorktreeAssignmentId>('unknown'), signal())).rejects.toThrow(/unknown|assignment/i)
  }))

  it('retains the mapping and files when nonforce Git removal fails', () => fixture(async (f) => {
    const ctx = await f.mount(); const a = await assign(ctx, f.repo)
    const before = await inventory(f); const g = gate(ctx, 'nonzero', 'remove')
    const op = observe(ctx.devLoopWorktree.retireWorktree(a.id, signal()))
    try {
      const spec = await enteredOrFailure(g.entered.promise, op)
      expect(spec.argv).not.toContain('--force')
      g.release.resolve(undefined); g.empty.resolve(true)
      expect((await op.result).ok).toBe(false)
      expect(ctx.devLoopWorktree.getAssignment('00.05')).toBe(a)
      expect(await inventory(f)).toBe(before)
      expect(await readFile(join(a.worktreePath, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally { await g.close(); await op.result }
  }))

  it('loads the actual service through cordis.yml and unloading preserves its physical tree', () => fixture(async (f) => {
    const ctx = await f.mount({}, true)
    const a = await assign(ctx, f.repo)
    await writeFile(join(a.worktreePath, 'handoff.spec.ts'), 'retained tests')
    await ctx.fiber.dispose()
    expect(ctx.get('devLoopWorktree')).toBeUndefined()
    expect(await inventory(f)).toContain(a.worktreePath)
    expect(await readFile(join(a.worktreePath, 'handoff.spec.ts'), 'utf8')).toBe('retained tests')
  }))

  it.each(['cancel', 'deadline', 'dispose', 'provider'] as const)('%s starts termination but cannot settle before managed-range quiescence', cause => fixture(async (f) => {
    const ctx = await f.mount()
    const g = gate(ctx, cause === 'provider' ? 'failure' : 'hold')
    const cancel = new AbortController(); const op = observe(assign(ctx, f.repo, '00.05', cancel.signal))
    let disposal: ReturnType<typeof observe> | undefined
    try {
      const spec = await enteredOrFailure(g.entered.promise, op)
      expect(spec.stdio).toMatchObject({ stdin: 'ignore', stdout: { maxBytes: policy.outputMaxBytes }, stderr: { maxBytes: policy.outputMaxBytes } })
      expect(spec.graceMs).toBe(policy.terminationGraceMs)
      expect(spec.signal).toBeDefined()
      expect(spec.env?.GIT_TERMINAL_PROMPT).toBe('0')
      for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) {
        expect(Object.hasOwn(spec.env ?? {}, key), `explicit tombstone ${key}`).toBe(true)
        expect(spec.env?.[key]).toBeUndefined()
      }
      if (cause === 'cancel') cancel.abort()
      if (cause === 'dispose') disposal = observe(ctx.fiber.dispose())
      if (cause !== 'provider') await enteredOrFailure(g.aborted.promise, op)
      g.release.resolve(undefined)
      expect(await enteredOrFailure(g.waitEntered.promise, op), 'quiescence wait must not have a deadline').toBeUndefined()
      expect(g.terminated).toHaveBeenCalled()
      expect(op.settled()).toBe(false)
      expect(disposal?.settled() ?? false).toBe(false)
      g.empty.resolve(true)
      const result = await op.result
      expect(result.ok).toBe(false)
      if (!result.ok) expect(String(result.error)).toMatch(/abort|cancel|deadline|timeout|dispos|provider|fault/i)
      await disposal?.result
      if (cause !== 'dispose') expect(ctx.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
      if (cause !== 'provider') expect(await inventory(f)).toContain(join(f.repo, '.worktrees'))
    } finally { await g.close(); await op.result; await disposal?.result }
  }))

  it.each(['lossy', 'malformed', 'nonzero', 'registration'] as const)('rejects %s command output without publication or destructive recovery', mode => fixture(async (f) => {
    const ctx = await f.mount(); const g = gate(ctx, mode)
    const op = observe(assign(ctx, f.repo))
    try {
      await enteredOrFailure(g.entered.promise, op)
      g.release.resolve(undefined); g.empty.resolve(true)
      const result = await op.result
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(String(result.error)).toMatch(/trunc|loss|invalid|malform|registr|exit|fail|inventory/i)
        expect(String(result.error)).toMatch(/residu|remain|preserv|unknown|undetermin/i)
        expect(String(result.error)).toContain(join(f.repo, '.worktrees'))
      }
      expect(ctx.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
      expect(g.specs.some(s => s.argv.some(a => ['prune', 'reset', 'clean', '--force'].includes(a)))).toBe(false)
    } finally { await g.close(); await op.result }
  }))

  it('requires mainline and all command policy fields; only root defaults', () => {
    const config = { ...policy, mainlinePath: '/configured/mainline' }
    expect(Worktrees.Config(config)).toEqual({ ...config, worktreeRoot: '.worktrees' })
    for (const key of ['mainlinePath', 'commandTimeoutMs', 'outputMaxBytes', 'terminationGraceMs']) {
      const missing = Object.fromEntries(Object.entries(config).filter(([name]) => name !== key))
      // Loader configuration originates as untyped YAML, not a same-process request.
      expect(() => Worktrees.Config(missing as unknown as Config), key).toThrow()
    }
    for (const key of ['commandTimeoutMs', 'outputMaxBytes', 'terminationGraceMs']) {
      for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => Worktrees.Config({ ...config, [key]: value }), `${key}=${value}`).toThrow()
      }
    }
    for (const key of ['commandTimeoutMs', 'terminationGraceMs']) {
      expect(() => Worktrees.Config({ ...config, [key]: 2_147_483_648 })).toThrow()
    }
  })
})
