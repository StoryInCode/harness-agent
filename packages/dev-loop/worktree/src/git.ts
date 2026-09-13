/**
 * Git command ownership and validated repository observations through the shared filesystem/subprocess world.
 * @module dsh-dev-loop-worktree/git
 */
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-fs'
import '@deepseek-ai/dsh-subprocess'
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { Config, GitCommit } from './types.ts'

/** Canonical repository directories and the observed commit; an empty superproject means none. */
interface Identity {
  top: string
  git: string
  common: string
  head: GitCommit
  superproject: string
  bare: false
}

/** One registered non-bare worktree, with a validated commit and explicit checkout mode. */
interface Entry {
  path: string
  head: GitCommit
  detached: boolean
}

function commit(value: string): GitCommit {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw new Error('Invalid Git commit identity')
  return value as GitCommit
}

function line(value: string): string {
  if (!value.endsWith('\n') || value.includes('\0')) throw new Error('Malformed Git identity output')
  return value.slice(0, -1)
}

/** Runs bounded Git commands and awaits managed-range exit; callers supply service disposal in their signal. */
export class Git {
  constructor(private readonly ctx: Context, private readonly config: Config) {}

  /**
   * Execute discrete Git arguments with prompts disabled and ambient repository redirection removed.
   * Cancellation and deadline initiate termination, never success; all acquired handles are terminated and
   * awaited without a wait deadline, including provider failures. No output is trimmed or recovered from spill.
   * @param cwd - working directory in the shared execution world.
   * @param args - Git arguments without the executable.
   * @param signal - caller cancellation combined with service disposal by the owner.
   * @returns complete stdout, rejecting lossy output, abnormal exit, cancellation, and observation failures.
   */
  async run(cwd: string, args: readonly string[], signal: AbortSignal): Promise<string> {
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort(new Error('Git command deadline exceeded')) }, this.config.commandTimeoutMs)
    const combined = AbortSignal.any([signal, deadline.signal])
    const errors: unknown[] = []
    try {
      combined.throwIfAborted()
      const executable = await this.ctx.subprocess.resolveExecutable('git', undefined, combined)
      combined.throwIfAborted()
      const env: NodeJS.ProcessEnv = {
        GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
        GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
        GIT_COMMON_DIR: undefined, GIT_OBJECT_DIRECTORY: undefined,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined, GIT_NAMESPACE: undefined,
        GIT_CEILING_DIRECTORIES: undefined, GIT_DISCOVERY_ACROSS_FILESYSTEM: undefined,
        GIT_CONFIG: undefined, GIT_CONFIG_PARAMETERS: undefined, GIT_CONFIG_COUNT: undefined,
        GIT_SHALLOW_FILE: undefined, GIT_REPLACE_REF_BASE: undefined,
      }
      const handle = this.ctx.subprocess.spawn({
        argv: [executable, ...args], cwd, env, signal: combined,
        stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.outputMaxBytes }, stderr: { maxBytes: this.config.outputMaxBytes } },
        graceMs: this.config.terminationGraceMs,
      })
      const terminate = () => {
        try { handle.terminate() } catch (error) { errors.push(error) }
      }
      combined.addEventListener('abort', terminate, { once: true })
      if (combined.aborted) terminate()
      let outcome: SubprocessOutcome | undefined
      try {
        try { outcome = await handle.done } catch (error) { errors.push(error) }
        terminate()
        try {
          if (!await handle.waitForExit()) errors.push(new Error('Git managed-range exit was not established'))
        } catch (error) { errors.push(error) }
      } finally {
        combined.removeEventListener('abort', terminate)
      }
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      if (combined.aborted) errors.push(combined.reason)
      if (outcome && (outcome.exitCode !== 0 || outcome.signal !== null)) {
        errors.push(new Error(`Git exitCode=${outcome.exitCode} signal=${outcome.signal}`))
      }
      if (!stdout || stdout.lossy || errors.length) {
        if (!stdout || stdout.lossy) errors.push(new Error('Git stdout is missing or lossy/truncated'))
        throw new AggregateError(errors, `Git ${args.join(' ')} failed in ${cwd}; aborted=${combined.aborted}; exitCode=${outcome?.exitCode}; signal=${outcome?.signal}: ${errors.map(String).join('; ')}${stderr ? `; stderr: ${stderr.text}` : ''}`)
      }
      return stdout.text
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Canonicalize a path with the filesystem provider rather than host path assumptions.
   * @param path - absolute or relative filesystem path, including a not-yet-created target.
   * @param cwd - base directory for a relative path; omitted uses the provider's base.
   * @returns canonical absolute subprocess-world path.
   */
  async path(path: string, cwd?: string): Promise<string> {
    return this.ctx.fs.processPath(await this.ctx.fs.resolve(path, cwd === undefined ? undefined : { cwd }))
  }

  /**
   * Probe a committed non-bare checkout and canonicalize its Git directory identities.
   * Bare repositories reject because they have no worktree top-level; submodule identity is returned for caller refusal.
   * @param cwd - checkout or directory beneath it.
   * @param signal - caller and service cancellation.
   * @returns top-level, private/common Git directories, validated HEAD, superproject or empty string, and bare=false.
   */
  async identity(cwd: string, signal: AbortSignal): Promise<Identity> {
    const probe = async (...args: string[]) => line(await this.run(cwd, ['rev-parse', ...args], signal))
    const bare = await probe('--is-bare-repository')
    if (bare !== 'false') throw new Error(bare === 'true' ? 'Bare Git repositories have no worktree' : 'Malformed Git bare status')
    const top = await this.path(await probe('--show-toplevel'), cwd)
    const git = await this.path(await probe('--absolute-git-dir'), cwd)
    const common = await this.path(await probe('--git-common-dir'), cwd)
    const head = commit(await probe('--verify', 'HEAD^{commit}'))
    const superprojectOutput = await this.run(cwd, ['rev-parse', '--show-superproject-working-tree'], signal)
    const superproject = superprojectOutput === '' ? '' : line(superprojectOutput)
    return { top, git, common, head, superproject: superproject ? await this.path(superproject, cwd) : '', bare: false }
  }

  /**
   * Parse Git's NUL-delimited porcelain records without shell quoting or whitespace trimming.
   * Reject incomplete, duplicate, unknown, bare, or contradictory records before returning any inventory.
   * @param main - repository directory from which to list worktrees.
   * @param signal - caller and service cancellation.
   * @returns canonical paths, validated commits, and detached status for every registered worktree.
   */
  async inventory(main: string, signal: AbortSignal): Promise<Entry[]> {
    const output = await this.run(main, ['worktree', 'list', '--porcelain', '-z'], signal)
    if (!output.endsWith('\0\0')) throw new Error('Malformed Git worktree inventory framing')
    const entries: Entry[] = []
    const paths = new Set<string>()
    for (const record of output.slice(0, -2).split('\0\0')) {
      const fields = record.split('\0')
      const first = fields.shift()
      if (!first?.startsWith('worktree ') || first.length === 9) throw new Error('Invalid Git inventory worktree path')
      const values = new Map<string, string>()
      for (const field of fields) {
        const space = field.indexOf(' ')
        const key = space < 0 ? field : field.slice(0, space)
        const value = space < 0 ? '' : field.slice(space + 1)
        if (!['HEAD', 'branch', 'detached', 'locked', 'prunable'].includes(key) || values.has(key)) throw new Error('Invalid Git inventory field')
        values.set(key, value)
      }
      const head = commit(values.get('HEAD') ?? '')
      const detached = values.has('detached')
      if (detached ? values.get('detached') !== '' || values.has('branch') : !values.get('branch')?.startsWith('refs/heads/')) {
        throw new Error('Invalid Git inventory checkout mode')
      }
      const path = await this.path(first.slice(9), main)
      if (paths.has(path)) throw new Error('Duplicate Git inventory path')
      paths.add(path)
      entries.push({ path, head, detached })
    }
    return entries
  }

  /**
   * Inspect occupancy without following a final symbolic link, including a dangling link.
   * @param path - candidate path in the filesystem provider's execution world.
   * @returns true for any existing entry; metadata failures reject rather than imply absence.
   */
  async exists(path: string): Promise<boolean> {
    return await this.ctx.fs.lstat(path) !== undefined
  }
}
