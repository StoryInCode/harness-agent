/** Host-owned retained worktrees; allocation does not confine filesystem access. @module dsh-dev-loop-worktree */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import '@deepseek-ai/dsh-fs'
import '@deepseek-ai/dsh-subprocess'
import { Git } from './git.ts'
import type { AssignWorktreeRequest, Config, WorktreeAssignment, WorktreeAssignmentId, WorktreeRetirement } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopWorktree: DevLoopWorktree }
}

/** Process-lifetime assignments shared across roles; unload preserves all physical trees. */
export class DevLoopWorktree extends Service {
  static inject = ['fs', 'subprocess']
  static Config: z<Config> = z.object({
    mainlinePath: z.string().required(),
    worktreeRoot: z.string().default('.worktrees'),
    commandTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).required(),
    outputMaxBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
    terminationGraceMs: z.number().step(1).min(1).max(2_147_483_647).required(),
  })

  private readonly git: Git
  private readonly config: Required<Config>
  private readonly lifetime = new AbortController()
  private readonly assignments = new Map<string, { assignment: WorktreeAssignment; cwd: string }>()
  private readonly attempts = new Map<string, { cwd: Promise<string>; result: Promise<WorktreeAssignment> }>()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopWorktree')
    this.config = DevLoopWorktree.Config(config) as Required<Config>
    this.git = new Git(ctx, this.config)
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Worktree service disposed'))
      await this.tail
    })
  }

  private serialize<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      signal.throwIfAborted()
      return action()
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  private async wait<T>(result: Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => { reject(new Error('Worktree waiter cancelled', { cause: signal.reason })) }
      signal.addEventListener('abort', abort, { once: true })
    })
    try { return await Promise.race([result, cancelled]) }
    finally { signal.removeEventListener('abort', abort) }
  }

  /** Allocate or reuse a verified assignment, retaining files across role completion.
   * @param request - piece, starting directory and cancellation; the first caller owns a coalesced attempt.
   * @returns immutable assignment; cancellation joins owned commands and failures preserve residue.
   */
  async assignWorktree(request: AssignWorktreeRequest): Promise<WorktreeAssignment> {
    const signal = AbortSignal.any([request.signal, this.lifetime.signal])
    signal.throwIfAborted()
    if (!/^\d+(?:\.\d+)+$/.test(request.pieceId)) throw new Error('Invalid dotted piece ID')
    const existing = this.attempts.get(request.pieceId)
    if (existing) {
      return this.wait((async () => {
        const [cwd, ownerCwd] = await Promise.all([this.git.path(request.cwd), existing.cwd])
        if (cwd !== ownerCwd) throw new Error('Incompatible assignment cwd')
        return existing.result
      })(), signal)
    }
    const cwd = this.git.path(request.cwd)
    const result = this.serialize(signal, async () => {
      const canonical = await cwd
      const retained = this.assignments.get(request.pieceId)
      if (retained) {
        if (retained.cwd !== canonical) throw new Error('Incompatible assignment cwd')
        return retained.assignment
      }
      return this.allocate(request.pieceId, canonical, signal)
    })
    this.attempts.set(request.pieceId, { cwd, result })
    try { return await result }
    finally { this.attempts.delete(request.pieceId) }
  }

  private async allocate(pieceId: string, cwd: string, signal: AbortSignal): Promise<WorktreeAssignment> {
    let attempted = this.config.worktreeRoot
    try {
      const mainline = await this.git.path(this.config.mainlinePath)
      const main = await this.git.identity(mainline, signal)
      if (main.top !== mainline || main.git !== main.common || main.superproject) {
        throw new Error('Configured mainline must be a non-bare main Git checkout')
      }
      const start = await this.git.identity(cwd, signal)
      if (start.superproject) throw new Error('Submodule superproject isolation is unsupported')
      if (start.common !== main.common) throw new Error('Starting cwd belongs to another Git repository')
      const ownership = start.git !== start.common ? 'borrowed' : 'created'
      let baseCommit = start.head
      if (ownership === 'borrowed') {
        attempted = start.top
        if ([...this.assignments.values()].some(row => row.assignment.worktreePath === attempted)) {
          throw new Error('Borrowed tree already claimed by another piece assignment')
        }
      } else {
        const fs = this.ctx.fs
        const parent = await fs.resolve(mainline, { signal })
        const root = await fs.resolve(this.config.worktreeRoot, { cwd: mainline, signal })
        if (!fs.contains(parent, root) || fs.processPath(root) === mainline) throw new Error('Worktree root escapes mainline containment')
        const rootPath = fs.processPath(root)
        attempted = await this.git.path(pieceId, rootPath)
        const target = await fs.resolve(attempted, { signal })
        if (!fs.contains(root, target) || attempted === rootPath) throw new Error('Worktree target escapes root containment')
        await this.git.run(mainline, ['check-ignore', '--', rootPath + '/'], signal)
        if (await this.git.exists(attempted)) throw new Error('Occupied worktree path requires explicit recovery')
        const before = await this.git.inventory(mainline, signal)
        if (before.some(entry => entry.path === attempted)) throw new Error('Git inventory worktree path collision')
        baseCommit = main.head
        await this.git.run(mainline, ['worktree', 'add', '--detach', attempted, baseCommit], signal)
      }
      const inventory = await this.git.inventory(mainline, signal)
      const entry = inventory.find(row => row.path === attempted)
      if (!entry || entry.head !== baseCommit || (ownership === 'created' && !entry.detached)) {
        throw new Error('Invalid worktree registration inventory')
      }
      signal.throwIfAborted()
      const assignment: WorktreeAssignment = Object.freeze({
        id: brandString<WorktreeAssignmentId>(randomUUID()), pieceId, mainlinePath: mainline,
        worktreePath: attempted, baseCommit, ownership,
      })
      this.assignments.set(pieceId, { assignment, cwd })
      return assignment
    } catch (error) {
      throw new Error(`Worktree assignment failed at ${attempted}; residue preserved or undetermined: ${String(error)}`, { cause: error })
    }
  }

  /** Read the retained assignment without probing or changing Git.
   * @param pieceId - corpus dotted piece identity.
   * @returns published assignment, or undefined.
   */
  getAssignment(pieceId: string): WorktreeAssignment | undefined {
    return this.assignments.get(pieceId)?.assignment
  }

  /** Remove only an owned, clean, unchanged tree; callers must first stop every user.
   * @param id - retained assignment identity.
   * @param signal - caller cancellation.
   * @returns removal or preservation reason; failures retain both mapping and residue.
   */
  async retireWorktree(id: WorktreeAssignmentId, signal: AbortSignal): Promise<WorktreeRetirement> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    return this.serialize(signal, async () => {
      const row = [...this.assignments.values()].find(value => value.assignment.id === id)
      if (!row) throw new Error('Unknown worktree assignment')
      const a = row.assignment
      if (a.ownership === 'borrowed') return { kind: 'preserved', reason: 'borrowed' }
      try {
        const main = await this.git.identity(a.mainlinePath, signal)
        const tree = await this.git.identity(a.worktreePath, signal)
        if (tree.common !== main.common || tree.git === tree.common || tree.top !== a.worktreePath || tree.superproject) {
          throw new Error('Worktree Git identity changed')
        }
        if (tree.head !== a.baseCommit) return { kind: 'preserved', reason: 'head-changed' }
        const status = await this.git.run(a.worktreePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored'], signal)
        if (status !== '') return { kind: 'preserved', reason: 'dirty' }
        const inventory = await this.git.inventory(a.mainlinePath, signal)
        if (!inventory.some(entry => entry.path === a.worktreePath && entry.head === a.baseCommit && entry.detached)) {
          throw new Error('Worktree registration changed before retirement')
        }
        await this.git.run(a.mainlinePath, ['worktree', 'remove', a.worktreePath], signal)
        signal.throwIfAborted()
        this.assignments.delete(a.pieceId)
        return { kind: 'removed' }
      } catch (error) {
        throw new Error(`Worktree retirement failed at ${a.worktreePath}; mapping retained, residue preserved or undetermined: ${String(error)}`, { cause: error })
      }
    })
  }
}
export default DevLoopWorktree
