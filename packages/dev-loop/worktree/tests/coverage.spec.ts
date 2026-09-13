import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Worktrees from '../src/index.ts'
import { Git } from '../src/git.ts'
import type { Config } from '../src/types.ts'

const policy = { commandTimeoutMs: 10_000, outputMaxBytes: 128_000, terminationGraceMs: 100 }
const signal = () => new AbortController().signal
const hash = 'a'.repeat(40)
const execute = promisify(execFile)

function output(text: string): SubprocessHandle {
  return {
    stdin: undefined, stdout: undefined, stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) } },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate() {},
    async waitForExit() { return true },
  }
}

async function fixture(run: (f: {
  ctx: Context
  root: string
  repo: string
  git: Git
  mount: (config?: Partial<Config>) => Promise<void>
  command: (cwd: string, ...args: string[]) => Promise<string>
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-worktree-coverage-'))
  const repo = join(root, 'main')
  const ctx = new Context()
  try {
    await mkdir(repo)
    await ctx.plugin(LocalFileSystem, { cwd: repo })
    await ctx.plugin(LocalSubprocessRuntime)
    const git = new Git(ctx, { ...policy, mainlinePath: repo })
    const command = async (cwd: string, ...args: string[]) => {
      const result = await execute('git', args, { cwd, timeout: 10_000, env: {
        ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'no-config'),
        GIT_AUTHOR_NAME: 'Coverage Fixture', GIT_AUTHOR_EMAIL: 'coverage@example.invalid',
        GIT_COMMITTER_NAME: 'Coverage Fixture', GIT_COMMITTER_EMAIL: 'coverage@example.invalid',
        GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined,
      } })
      return result.stdout.trim()
    }
    await run({ ctx, root, repo, git, command,
      async mount(config = {}) {
        await command(repo, 'init', '--initial-branch=main')
        await writeFile(join(repo, '.gitignore'), '.worktrees/\n')
        await command(repo, 'add', '.')
        await command(repo, 'commit', '-m', 'fixture')
        await ctx.plugin(Worktrees, { ...policy, mainlinePath: repo, ...config })
      },
    })
  } finally {
    vi.restoreAllMocks()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

function respond(ctx: Context, reply: (spec: SubprocessSpawnSpec) => SubprocessHandle) {
  vi.spyOn(ctx.subprocess, 'resolveExecutable').mockResolvedValue('git')
  return vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(reply)
}

const record = (path: string, head = hash, mode = 'detached') => `worktree ${path}\0HEAD ${head}\0${mode}\0\0`
const assign = (ctx: Context, cwd: string, pieceId = '00.05') =>
  ctx.devLoopWorktree.assignWorktree({ cwd, pieceId, signal: signal() })

describe('Git external output validation', () => {
  it.each([
    ['missing newline', 'false', 'Malformed Git identity output'],
    ['NUL identity', 'false\0\n', 'Malformed Git identity output'],
    ['bare repository', 'true\n', 'Bare Git repositories'],
    ['unknown bare status', 'maybe\n', 'Malformed Git bare status'],
  ])('rejects %s', (_name, text, error) => fixture(async ({ ctx, git, repo }) => {
    respond(ctx, () => output(text))
    await expect(git.identity(repo, signal())).rejects.toThrow(error)
  }))

  it.each(['bad', 'A'.repeat(40), 'a'.repeat(39)])('rejects malformed commit %s', head => fixture(async ({ ctx, git, repo }) => {
    respond(ctx, spec => output(spec.argv.includes('--is-bare-repository') ? 'false\n'
      : spec.argv.includes('--verify') ? head + '\n' : repo + '\n'))
    await expect(git.identity(repo, signal())).rejects.toThrow('Invalid Git commit identity')
  }))

  it('accepts a SHA-256 identity and an explicitly empty superproject line', () => fixture(async ({ ctx, git, repo }) => {
    respond(ctx, spec => output(spec.argv.includes('--is-bare-repository') ? 'false\n'
      : spec.argv.includes('--verify') ? 'b'.repeat(64) + '\n'
        : spec.argv.includes('--show-superproject-working-tree') ? '\n' : repo + '\n'))
    expect(await git.identity(repo, signal())).toMatchObject({ head: 'b'.repeat(64), superproject: '' })
  }))

  it.each([
    ['empty path', 'worktree \0HEAD ' + hash + '\0detached\0\0', 'worktree path'],
    ['wrong first field', 'path /repo\0HEAD ' + hash + '\0detached\0\0', 'worktree path'],
    ['unknown field', record('/repo', hash, 'unknown'), 'inventory field'],
    ['duplicate field', record('/repo', hash, 'detached\0detached'), 'inventory field'],
    ['missing HEAD', 'worktree /repo\0detached\0\0', 'commit identity'],
    ['invalid HEAD', record('/repo', 'no-commit'), 'commit identity'],
    ['valued detached', record('/repo', hash, 'detached yes'), 'checkout mode'],
    ['contradictory mode', record('/repo', hash, 'detached\0branch refs/heads/main'), 'checkout mode'],
    ['missing mode', `worktree /repo\0HEAD ${hash}\0\0`, 'checkout mode'],
    ['invalid branch', record('/repo', hash, 'branch refs/tags/main'), 'checkout mode'],
    ['duplicate paths', record('/repo') + record('/repo'), 'Duplicate Git inventory path'],
  ])('rejects NUL-framed inventory with %s', (_name, text, error) => fixture(async ({ ctx, git, repo }) => {
    respond(ctx, () => output(text))
    await expect(git.inventory(repo, signal())).rejects.toThrow(error)
  }))

  it('preserves spaces and newlines in paths and accepts optional reason fields', () => fixture(async ({ ctx, git, repo }) => {
    const path = join(repo, 'with space\nand newline')
    respond(ctx, () => output(record(path, hash, 'branch refs/heads/main\0locked maintenance\0prunable missing')))
    expect(await git.inventory(repo, signal())).toEqual([{ path, head: hash, detached: false }])
  }))

  it.each(['terminate throws', 'wait false', 'wait rejects', 'missing stdout', 'sync abort'] as const)(
    'joins process ownership after %s', mode => fixture(async ({ ctx, git, repo }) => {
      const abort = new AbortController()
      const terminate = vi.fn(() => { if (mode === 'terminate throws') throw new Error('termination provider fault') })
      const wait = vi.fn(async () => {
        if (mode === 'wait rejects') throw new Error('exit observation fault')
        return mode !== 'wait false'
      })
      respond(ctx, () => {
        const handle = output('')
        if (mode === 'sync abort') abort.abort(new Error('spawn cancellation'))
        return { ...handle, terminate, waitForExit: wait,
          collected: mode === 'missing stdout' ? {} : handle.collected }
      })
      await expect(git.run(repo, ['status'], abort.signal)).rejects.toThrow({
        'terminate throws': 'termination provider fault', 'wait false': 'managed-range exit',
        'wait rejects': 'exit observation fault', 'missing stdout': 'stdout is missing', 'sync abort': 'spawn cancellation',
      }[mode])
      expect(wait).toHaveBeenCalledExactlyOnceWith()
      expect(terminate).toHaveBeenCalledTimes(mode === 'sync abort' ? 2 : 1)
    }),
  )
})

// Filesystem and registration decisions retain real Git; only selected process observations are substituted.
describe('worktree allocation and retirement observations', { timeout: 30_000 }, () => {
  it('rejects incompatible coalesced cwd without cancelling the owner', () => fixture(async ({ ctx, repo, mount }) => {
    await mount()
    const owner = assign(ctx, repo)
    const incompatible = assign(ctx, join(repo, '.git'))
    await expect(incompatible).rejects.toThrow('Incompatible assignment cwd')
    expect((await owner).ownership).toBe('created')
  }))

  it.each(['subdirectory', 'linked'] as const)('rejects configured mainline %s', mode => fixture(async ({ ctx, root, repo, mount, command }) => {
    const configured = join(root, 'configured')
    await mount({ mainlinePath: mode === 'linked' ? configured : join(repo, 'sub') })
    if (mode === 'linked') await command(repo, 'worktree', 'add', '--detach', configured)
    else await mkdir(join(repo, 'sub'))
    await expect(assign(ctx, repo)).rejects.toThrow('Configured mainline must be')
  }))

  it('rejects a starting cwd in a different repository', () => fixture(async ({ ctx, root, repo, mount, command }) => {
    await mount()
    const other = join(root, 'other')
    await command(root, 'clone', '--local', repo, other)
    await expect(assign(ctx, other)).rejects.toThrow('another Git repository')
  }))

  it('rejects a final target symlink escaping the worktree root', () => fixture(async ({ ctx, root, repo, mount }) => {
    await mount()
    await mkdir(join(repo, '.worktrees'))
    await symlink(root, join(repo, '.worktrees', '00.05'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(assign(ctx, repo)).rejects.toThrow('target escapes root containment')
    expect((await lstat(join(repo, '.worktrees', '00.05'))).isSymbolicLink()).toBe(true)
  }))

  it('refuses inventory collision even when the physical checkout is absent', () => fixture(async ({ ctx, repo, mount, command }) => {
    await mount()
    const target = join(repo, '.worktrees', '00.05')
    await command(repo, 'worktree', 'add', '--detach', target)
    await rm(target, { recursive: true })
    await expect(assign(ctx, repo)).rejects.toThrow('inventory worktree path collision')
    expect(await command(repo, 'worktree', 'list', '--porcelain')).toContain(target)
  }))

  it.each(['missing', 'head', 'attached'] as const)('rejects framed post-add registration: %s', mode => fixture(async ({ ctx, repo, mount, command }) => {
    await mount()
    const base = await command(repo, 'rev-parse', 'HEAD')
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    let added = false
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      if (spec.argv.includes('add')) added = true
      if (added && spec.argv.includes('list')) return output(record(mode === 'missing' ? repo : join(repo, '.worktrees', '00.05'),
        mode === 'head' ? hash : base, mode === 'attached' ? 'branch refs/heads/main' : 'detached'))
      return spawn(spec)
    })
    await expect(assign(ctx, repo)).rejects.toThrow('Invalid worktree registration inventory')
    expect(ctx.devLoopWorktree.getAssignment('00.05')).toBeUndefined()
    expect((await lstat(join(repo, '.worktrees', '00.05'))).isDirectory()).toBe(true)
  }))

  it.each(['common', 'main-checkout', 'top', 'superproject', 'registration-path', 'registration-head', 'registration-mode'] as const)(
    'retains mapping and files after retirement %s changes', mode => fixture(async ({ ctx, repo, mount, command }) => {
      await mount()
      const assignment = await assign(ctx, repo)
      const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
      vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
        if (spec.cwd === assignment.worktreePath) {
          if (mode === 'common' && spec.argv.includes('--git-common-dir')) return output(repo + '\n')
          if (mode === 'main-checkout' && spec.argv.includes('--absolute-git-dir')) return output(join(repo, '.git') + '\n')
          if (mode === 'top' && spec.argv.includes('--show-toplevel')) return output(repo + '\n')
          if (mode === 'superproject' && spec.argv.includes('--show-superproject-working-tree')) return output(repo + '\n')
        }
        if (mode.startsWith('registration') && spec.argv.includes('list')) return output(record(
          mode === 'registration-path' ? repo : assignment.worktreePath,
          mode === 'registration-head' ? hash : assignment.baseCommit,
          mode === 'registration-mode' ? 'branch refs/heads/main' : 'detached'))
        return spawn(spec)
      })
      await expect(ctx.devLoopWorktree.retireWorktree(assignment.id, signal())).rejects.toThrow(
        mode.startsWith('registration') ? 'registration changed before retirement' : 'Git identity changed')
      expect(ctx.devLoopWorktree.getAssignment('00.05')).toBe(assignment)
      expect(await command(assignment.worktreePath, 'rev-parse', 'HEAD')).toBe(assignment.baseCommit)
    }),
  )
})
