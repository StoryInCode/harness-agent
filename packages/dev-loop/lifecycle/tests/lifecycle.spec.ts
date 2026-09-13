/**
 * Specification for the development-loop piece lifecycle: the exported
 * transition table, the guarded `ctx.devLoopLifecycle` state machine, the
 * compare-and-set writer, and the `git mv` that commits a completion.
 *
 * Every case owns a temp directory and, where the move is exercised, a real
 * git repository inside it — `git mv` refuses an untracked source, so a fake
 * would not pin the mechanism. The subprocess seam is served by
 * {@link RecordingSubprocess}, a real {@link SubprocessRuntime} subclass that
 * executes the spec it is handed and journals the call; that is what makes the
 * move/record/emit ordering observable from outside the service.
 *
 * Two contracts this suite deliberately does NOT pin, because the piece does
 * not decide them, are recorded at their cases: when the synchronous
 * `getStatus` hydrates from the asynchronous directory, and whether a
 * synchronously-throwing `emit` listener surfaces to the caller.
 */

import { execFile, spawn as spawnChild } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as fsLocalPlugin from '@deepseek-ai/dsh-fs-local'
import * as directoryPlugin from '@deepseek-ai/dsh-dev-loop-directory'
import DevLoopDirectory, {
  DONE_DIRECTORY,
  PIECE_ROOT,
  PieceNotFoundError,
  PieceParseError,
  type PieceStatus,
} from '@deepseek-ai/dsh-dev-loop-directory'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputRead,
  SubprocessOutputReader,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import * as lifecyclePlugin from '@deepseek-ai/dsh-dev-loop-lifecycle'
import DevLoopLifecycle, {
  InvalidStateTransitionError,
  LEGAL_TRANSITIONS,
  StalePieceStatusError,
  type StateTransitionEvent,
} from '@deepseek-ai/dsh-dev-loop-lifecycle'

/** The closed lifecycle vocabulary, in the order the sixteen-pair sweeps walk it. */
const PIECE_STATUSES = ['todo', 'pending', 'done', 'blocked'] as const satisfies readonly PieceStatus[]

/** The three transition announcements the package declares on the host bus. */
const LIFECYCLE_EVENTS = ['piece/approved', 'piece/completed', 'piece/blocked'] as const

type LifecycleEventName = (typeof LIFECYCLE_EVENTS)[number]

/** Fixture set directory; its `00-` prefix is what `getPiece` resolves a `00.xx` id against. */
const SET_NAME = '00-lifecycle-fixtures'

/** The `##` sections a piece file must carry, in the order the parser demands. */
const PIECE_SECTIONS: readonly string[] = [
  'Summary',
  'Behaviour',
  'Harness fit',
  'Contracts',
  'Dependencies',
  'References',
  'How to see it',
  'Teach me while you build',
  'Resources and proof',
  'Reuse capture',
  'Acceptance',
]

/**
 * The one primitive outside the closed vocabulary the axiom names, so a
 * fixture file that is otherwise well formed is still rejected by the parser.
 */
const REJECTED_PRIMITIVE = 'Plugin'

/**
 * Build a minimal piece file the directory parser accepts.
 * @param id - dotted piece id, also written into the title line.
 * @param status - the `**Status:**` the file declares.
 * @param queue - queue position, unique per fixture set.
 * @param primitive - declared Harness primitive; {@link REJECTED_PRIMITIVE} makes the parser reject the file.
 * @returns complete piece markdown, newline-terminated.
 */
function pieceFile(id: string, status: PieceStatus, queue: number, primitive = 'Service Provider'): string {
  const header = [
    `# ${id} — Lifecycle Fixture ${id}`,
    '',
    `**Set:** ${SET_NAME} · **Queue:** ${queue} · **Depends on:** none`,
    `**Status:** ${status}`,
    `**Harness primitive:** ${primitive} · **Package:** \`@deepseek-ai/dsh-dev-loop-lifecycle\``,
  ]
  const body = PIECE_SECTIONS.flatMap(section => ['', `## ${section}`, '', `Fixture text for ${section}.`])
  return `${[...header, ...body].join('\n')}\n`
}

/**
 * The `**Status:**` a piece file on disk declares right now.
 *
 * Read synchronously so the spawn journal can snapshot it at the instant a
 * command is handed to the subprocess seam, which is what makes the
 * rewrite-before-move ordering observable.
 *
 * @param root - fixture root the filesystem backend is based at.
 * @param id - dotted piece id.
 * @returns the declared status, or `undefined` when no file for that id exists.
 */
function declaredStatus(root: string, id: string): string | undefined {
  for (const candidate of [piecePath(id), completedPath(id)]) {
    const absolute = join(root, candidate)
    if (!existsSync(absolute)) continue
    const declared = /^\*\*Status:\*\* (?<status>.+)$/m.exec(readFileSync(absolute, 'utf8'))
    return declared?.groups?.['status']
  }
  return undefined
}

/**
 * Filename a piece id owns; completion must preserve it exactly.
 * @param id - dotted piece id.
 * @returns the `NN.MM-<slug>.md` basename.
 */
function pieceFileName(id: string): string {
  return `${id}-lifecycle-fixture.md`
}

/**
 * Path of a piece still in its set directory.
 * @param id - dotted piece id.
 * @returns the path relative to the filesystem backend's base.
 */
function piecePath(id: string): string {
  return `${PIECE_ROOT}/${SET_NAME}/${pieceFileName(id)}`
}

/**
 * Path a completed piece must occupy.
 * @param id - dotted piece id.
 * @returns the path relative to the filesystem backend's base.
 */
function completedPath(id: string): string {
  return `${PIECE_ROOT}/${SET_NAME}/${DONE_DIRECTORY}/${pieceFileName(id)}`
}

/**
 * Resolve a path a transition reported against the fixture root.
 * @param root - fixture root the filesystem backend is based at.
 * @param path - absolute path, or one relative to that base.
 * @returns an absolute path.
 */
function absoluteOf(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path)
}

const runCommand = promisify(execFile)

/**
 * Make the fixture root a git working tree.
 *
 * `user.email`/`user.name` are set locally rather than inherited, gpg signing
 * and hooks are disabled, so the fixture commits on a host with any ambient
 * git configuration.
 *
 * @param root - fixture root to initialise.
 * @param trackPieces - whether the piece files are committed; `false` leaves them untracked, which is the state the real corpus is in.
 */
async function initRepository(root: string, trackPieces: boolean): Promise<void> {
  const git = async (...args: readonly string[]): Promise<void> => {
    await runCommand('git', [...args], { cwd: root })
  }
  await git('init', '-q', '.')
  await git('config', 'user.email', 'dev-loop@example.invalid')
  await git('config', 'user.name', 'Dev Loop Fixture')
  await git('config', 'commit.gpgsign', 'false')
  await git('config', 'core.hooksPath', join(root, '.git', 'absent-hooks'))
  await writeFile(join(root, 'FIXTURE.md'), 'lifecycle fixture repository\n')
  await git('add', trackPieces ? '-A' : 'FIXTURE.md')
  await git('commit', '-q', '-m', 'fixture corpus')
}

/** How a recorded spawn behaves: run the command, or fail the way a provider fails. */
type SpawnBehaviour = 'execute' | 'provider-error'

/**
 * Expose one collected stream as the seam's offset reader.
 * @param read - returns everything captured so far.
 * @returns a reader over that text.
 */
function readerOver(read: () => string): SubprocessOutputReader {
  return {
    readFrom: (fromByte: number): SubprocessOutputRead => {
      const text = read()
      return { text: text.slice(fromByte), nextOffset: text.length, lossy: false }
    },
  }
}

/**
 * Subprocess provider that really runs what it is given and journals every
 * call. Being a real {@link SubprocessRuntime} keeps the seam honest: the
 * service under test sees the declared service, and `git mv` genuinely runs
 * against the fixture repository.
 */
class RecordingSubprocess extends SubprocessRuntime {
  /** Every spec handed to {@link spawn}, in call order. */
  readonly calls: SubprocessSpawnSpec[] = []
  /** Invoked synchronously inside {@link spawn}, before the child starts. */
  onSpawn: ((spec: SubprocessSpawnSpec) => void) | undefined
  /** Switches the next spawns to a provider failure instead of execution. */
  behaviour: SpawnBehaviour = 'execute'

  override resolveExecutable(command: string): Promise<string> {
    return Promise.resolve(command)
  }

  override spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.calls.push(spec)
    this.onSpawn?.(spec)
    if (this.behaviour === 'provider-error') return failedHandle()
    const [program, ...args] = spec.argv
    if (program === undefined) throw new Error('recording subprocess: spec carries an empty argv')
    const child = spawnChild(program, args, {
      cwd: spec.cwd,
      env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
    })
    let stdoutText = ''
    let stderrText = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { stdoutText += chunk })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderrText += chunk })
    const done = new Promise<SubprocessOutcome>((settle, fail) => {
      child.once('error', fail)
      child.once('close', (exitCode: number | null, signal: NodeJS.Signals | null) => { settle({ exitCode, signal }) })
    })
    // A consumer that never awaits `done` must not turn a provider failure into
    // an unhandled rejection that fails an unrelated case in this worker.
    void done.catch(() => undefined)
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: { stdout: readerOver(() => stdoutText), stderr: readerOver(() => stderrText) },
      done,
      terminate: () => { child.kill() },
      waitForExit: async () => {
        await done.catch(() => undefined)
        return true
      },
    }
  }

  override spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('recording subprocess: the lifecycle never allocates a terminal'))
  }
}

/**
 * A handle whose process never started, the seam's provider-failure result.
 * @returns a handle whose `done` rejects.
 */
function failedHandle(): SubprocessHandle {
  const done = Promise.reject(new Error('recording subprocess: the provider failed before the child started'))
  void done.catch(() => undefined)
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done,
    terminate: () => undefined,
    waitForExit: () => Promise.resolve(true),
  }
}

/** A status read that may legitimately fail while the piece is unknown to the service. */
type StatusObservation = PieceStatus | 'unreadable'

/** One journalled observation: either a spawn, or an announcement on the bus. */
type JournalEntry =
  | {
    readonly kind: 'spawn'
    readonly argv: readonly string[]
    readonly cwd: string
    /** Status of every fixture piece at the instant the command was handed to the seam. */
    readonly statuses: Readonly<Record<string, StatusObservation>>
    /** What each fixture piece file declared on disk at that same instant. */
    readonly declared: Readonly<Record<string, string | undefined>>
  }
  | {
    readonly kind: 'event'
    readonly name: LifecycleEventName
    readonly event: StateTransitionEvent
    /** Status of every fixture piece at the instant the announcement was dispatched. */
    readonly statuses: Readonly<Record<string, StatusObservation>>
    /** What each fixture piece file declared on disk at that same instant. */
    readonly declared: Readonly<Record<string, string | undefined>>
    /** Whether the piece file is still in the set root when the announcement fires. */
    readonly sourceExists: boolean
    /** Whether `newPath` already exists when the announcement fires. */
    readonly destinationExists: boolean
  }

/** Declared statuses of the fixture pieces, keyed by id. */
type PieceFixture = Readonly<Record<string, PieceStatus>>

/** One piece in each lifecycle state; the `done` one already lives in `done/`. */
const EVERY_STATUS: PieceFixture = { '00.01': 'todo', '00.02': 'pending', '00.03': 'blocked', '00.04': 'done' }

/** No completed piece, so the set has no `done/` directory yet — the first completion must create it. */
const NOTHING_COMPLETED: PieceFixture = { '00.01': 'todo', '00.02': 'pending' }

interface MountOptions {
  /** Declared status per piece id; a `done` piece is written into `done/`. */
  readonly pieces?: PieceFixture
  /** Ids whose file declares a primitive outside the vocabulary, so the scan rejects it. */
  readonly malformed?: PieceFixture
  /** Extra files written under the fixture root before git sees it, keyed by path relative to that root. */
  readonly extraFiles?: Readonly<Record<string, string>>
  /** Whether the fixture root is a git working tree, and whether the pieces are tracked in it. */
  readonly git?: 'tracked' | 'untracked' | 'no-repository'
}

interface Mounted {
  readonly ctx: Context
  readonly root: string
  readonly lifecycle: DevLoopLifecycle
  readonly directory: DevLoopDirectory
  readonly runner: RecordingSubprocess
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  /** Spawns and announcements in the order they happened. */
  readonly journal: readonly JournalEntry[]
  /** Status of every fixture piece right now, or `'unreadable'` where the service refuses. */
  readonly statuses: () => Readonly<Record<string, StatusObservation>>
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  const pending = cleanups.splice(0, cleanups.length).reverse()
  for (const cleanup of pending) await cleanup()
})

/**
 * Write the fixture corpus, make it a git working tree, and mount the
 * filesystem backend, the recording subprocess provider, the piece directory
 * and the lifecycle over it. Every temp path and fiber is owned by the shared
 * `afterEach`.
 *
 * @param options - fixture pieces and git state.
 * @returns the mounted services plus the observation journal.
 */
async function mountLifecycle(options: MountOptions = {}): Promise<Mounted> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-lifecycle-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))

  const pieces = options.pieces ?? EVERY_STATUS
  const malformed = options.malformed ?? {}
  let queue = 0
  for (const [id, status] of Object.entries({ ...pieces, ...malformed })) {
    queue += 1
    const absolute = join(root, status === 'done' ? completedPath(id) : piecePath(id))
    await mkdir(dirname(absolute), { recursive: true })
    const primitive = id in malformed ? REJECTED_PRIMITIVE : undefined
    await writeFile(absolute, pieceFile(id, status, queue, primitive))
  }
  for (const [relative, content] of Object.entries(options.extraFiles ?? {})) {
    const absolute = join(root, relative)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }

  const git = options.git ?? 'tracked'
  if (git !== 'no-repository') await initRepository(root, git === 'tracked')

  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(RecordingSubprocess)
  await ctx.plugin(DevLoopDirectory, { root: PIECE_ROOT })
  const fiber = await ctx.plugin(DevLoopLifecycle)

  const lifecycle = ctx.get('devLoopLifecycle')
  if (lifecycle === undefined) throw new Error('devLoopLifecycle service missing after mount')
  const directory = ctx.get('devLoopDirectory')
  if (directory === undefined) throw new Error('devLoopDirectory service missing after mount')
  const runner = ctx.get('subprocess')
  if (!(runner instanceof RecordingSubprocess)) throw new Error('the recording subprocess provider is not mounted')

  const observedIds = Object.keys({ ...pieces, ...malformed })
  const declared = (): Record<string, string | undefined> => {
    const snapshot: Record<string, string | undefined> = {}
    for (const id of observedIds) snapshot[id] = declaredStatus(root, id)
    return snapshot
  }
  const statuses = (): Record<string, StatusObservation> => {
    const snapshot: Record<string, StatusObservation> = {}
    for (const id of observedIds) {
      try {
        snapshot[id] = lifecycle.getStatus(id)
      } catch {
        // The service may legitimately refuse an id it never hydrated; the
        // journal records that refusal rather than failing the observation.
        snapshot[id] = 'unreadable'
      }
    }
    return snapshot
  }

  const journal: JournalEntry[] = []
  runner.onSpawn = (spec): void => {
    journal.push({ kind: 'spawn', argv: [...spec.argv], cwd: spec.cwd, statuses: statuses(), declared: declared() })
  }
  const record = (name: LifecycleEventName) => (event: StateTransitionEvent): void => {
    journal.push({
      kind: 'event',
      name,
      event,
      statuses: statuses(),
      declared: declared(),
      sourceExists: existsSync(join(root, piecePath(event.pieceId))),
      destinationExists: event.newPath !== undefined && existsSync(absoluteOf(root, event.newPath)),
    })
  }
  ctx.on('piece/approved', record('piece/approved'))
  ctx.on('piece/completed', record('piece/completed'))
  ctx.on('piece/blocked', record('piece/blocked'))

  return { ctx, root, lifecycle, directory, runner, fiber, journal, statuses }
}

/**
 * Run a transition and return whatever it threw.
 *
 * The declaration-only scaffold throws synchronously from a method declared to
 * return a promise, so a case that assumed a rejection would report a
 * confusing failure instead of the not-implemented throw. Normalising both
 * keeps every red result legible.
 *
 * @param run - the call under test.
 * @returns the error, or `undefined` when the call succeeded.
 */
async function attempt(run: () => Promise<void>): Promise<unknown> {
  try {
    await run()
    return undefined
  } catch (error) {
    return error
  }
}

/**
 * Run a synchronous read and return whatever it threw, so a case can assert on
 * the error's identity rather than only on the fact that one was raised.
 * @param read - the call under test.
 * @returns the error, or `undefined` when the call succeeded.
 */
function attemptSync(read: () => unknown): unknown {
  try {
    read()
    return undefined
  } catch (error) {
    return error
  }
}

/**
 * Announcements of one kind in journal order.
 * @param mounted - the mounted fixture.
 * @param name - event to select, or every event when omitted.
 * @returns the matching journal entries.
 */
function announcements(mounted: Mounted, name?: LifecycleEventName): Extract<JournalEntry, { kind: 'event' }>[] {
  return mounted.journal.filter((entry): entry is Extract<JournalEntry, { kind: 'event' }> =>
    entry.kind === 'event' && (name === undefined || entry.name === name))
}

/**
 * The `git` invocations the service made.
 * @param mounted - the mounted fixture.
 * @returns the spawn entries whose program is git.
 */
function gitCalls(mounted: Mounted): Extract<JournalEntry, { kind: 'spawn' }>[] {
  return mounted.journal.filter((entry): entry is Extract<JournalEntry, { kind: 'spawn' }> =>
    entry.kind === 'spawn' && entry.argv[0] === 'git')
}

/**
 * The `git mv` invocations, separated from the staging the rewrite needs.
 *
 * A completion legitimately makes more than one git call — the header edit is
 * staged before the move — so "the move happened once" is counted here rather
 * than over every git invocation.
 *
 * @param mounted - the mounted fixture.
 * @returns the spawn entries that move a file.
 */
function gitMoves(mounted: Mounted): Extract<JournalEntry, { kind: 'spawn' }>[] {
  return gitCalls(mounted).filter(entry => entry.argv.includes('mv'))
}

describe('the exported transition table', () => {
  it('permits exactly the four specified edges and leaves done absorbing', () => {
    expect(Object.keys(LEGAL_TRANSITIONS).sort()).toEqual(['blocked', 'done', 'pending', 'todo'])
    expect(LEGAL_TRANSITIONS.todo).toEqual(['pending'])
    expect(LEGAL_TRANSITIONS.pending).toEqual(['done', 'blocked'])
    expect(LEGAL_TRANSITIONS.blocked).toEqual(['todo'])
    // Reopening is defined as `done -> todo` by 02.04 and as `done -> blocked`
    // by the supervisor plan, so this package implements neither.
    expect(LEGAL_TRANSITIONS.done).toEqual([])
  })

  it('is the only table this suite derives its legal and illegal edges from', () => {
    // The sweeps below enumerate every from/to pair and consult the constant,
    // so a future edge is exercised without editing a second copy of the table.
    const edges = PIECE_STATUSES.flatMap(from => LEGAL_TRANSITIONS[from].map(to => `${from}->${to}`))
    expect(edges.sort()).toEqual(['blocked->todo', 'pending->blocked', 'pending->done', 'todo->pending'])
  })
})

describe('canTransition', () => {
  it('agrees with LEGAL_TRANSITIONS on every one of the sixteen from/to pairs', async () => {
    const { lifecycle } = await mountLifecycle()

    for (const from of PIECE_STATUSES) {
      for (const to of PIECE_STATUSES) {
        expect(lifecycle.canTransition(from, to), `${from} -> ${to}`).toBe(LEGAL_TRANSITIONS[from].includes(to))
      }
    }
  })

  it('is a pure predicate: it needs no piece, repeats its answer, and mutates no status', async () => {
    const { lifecycle, journal } = await mountLifecycle()
    const before = lifecycle.getStatus('00.01')

    expect(lifecycle.canTransition('todo', 'pending')).toBe(true)
    expect(lifecycle.canTransition('todo', 'pending')).toBe(true)
    expect(lifecycle.canTransition('done', 'todo')).toBe(false)

    expect(lifecycle.getStatus('00.01')).toBe(before)
    expect(journal).toEqual([])
  })
})

describe('reading a status', () => {
  /**
   * SPECIFICATION GAP. `getStatus` is synchronous, but the only source of a
   * piece's declared status is `ctx.devLoopDirectory`, whose reads are
   * asynchronous. The piece does not say when hydration happens. Mount time is
   * the only instant that makes the rest of the contract satisfiable — a
   * compare-and-set writer must know the current status before its first call,
   * and a synchronous reader cannot await one. These cases therefore pin the
   * weakest defensible reading: once `ctx.plugin()` has settled, every piece of
   * the corpus reads back the status its file declares. Cache invalidation
   * after an out-of-band edit is NOT pinned here; the piece decides nothing
   * about it.
   */
  it('reads back the status every piece file declares, once the mount has settled', async () => {
    const { lifecycle } = await mountLifecycle()

    expect(lifecycle.getStatus('00.01')).toBe('todo')
    expect(lifecycle.getStatus('00.02')).toBe('pending')
    expect(lifecycle.getStatus('00.03')).toBe('blocked')
    // Hydrating this one is what makes the absorbing guard enforceable after a
    // restart: the completed piece already lives in `done/`.
    expect(lifecycle.getStatus('00.04')).toBe('done')
  })

  it('refuses an id the corpus does not declare rather than inventing a status', async () => {
    const { lifecycle } = await mountLifecycle()

    // The return type admits no absent value, so the only total alternatives
    // are throwing and fabricating a default; fabricating `todo` would let a
    // transition proceed against a piece that does not exist. Reading a known
    // id first keeps this from passing on a reader that refuses everything.
    expect(lifecycle.getStatus('00.01')).toBe('todo')
    expect(() => lifecycle.getStatus('99.99')).toThrow(PieceNotFoundError)
  })

  it('tells a malformed piece apart from one the corpus never declared', async () => {
    // The distinction is the whole point: a caller that cannot tell "there is
    // no such piece" from "that piece is malformed" reports the wrong defect,
    // and one unreadable file must not masquerade as an absent one.
    const { lifecycle } = await mountLifecycle({ malformed: { '00.09': 'todo' } })

    const malformed = attemptSync(() => lifecycle.getStatus('00.09'))
    const absent = attemptSync(() => lifecycle.getStatus('99.99'))

    expect(malformed).toBeInstanceOf(PieceParseError)
    expect(malformed).toMatchObject({ code: 'INVALID_HARNESS_PRIMITIVE' })
    // The failure names the file that could not be parsed, not merely the id.
    expect(malformed).toHaveProperty('message', expect.stringContaining(pieceFileName('00.09')))
    expect(absent).toBeInstanceOf(PieceNotFoundError)
    expect(absent).not.toBeInstanceOf(PieceParseError)
    expect(absent).toMatchObject({ code: 'PIECE_NOT_FOUND' })
  })

  it('refuses to transition a malformed piece, with the same parse failure', async () => {
    const { lifecycle } = await mountLifecycle({ malformed: { '00.09': 'todo' } })

    const error = await attempt(() => lifecycle.transition('00.09', 'todo', 'pending'))

    // A file whose status could not be read has no status to compare against,
    // so the parse failure surfaces rather than a stale-status rejection.
    expect(error).toBeInstanceOf(PieceParseError)
    expect(error).not.toBeInstanceOf(StalePieceStatusError)
    expect(error).toHaveProperty('message', expect.stringContaining(pieceFileName('00.09')))
  })

  it('reads the well-formed pieces of a set that also holds a malformed file', async () => {
    const { lifecycle } = await mountLifecycle({ malformed: { '00.09': 'todo' } })

    // One unreadable file withholds only itself, exactly as a directory scan does.
    expect(lifecycle.getStatus('00.01')).toBe('todo')
    expect(lifecycle.getStatus('00.04')).toBe('done')
  })
})

describe('legal edges', () => {
  it('moves todo to pending and announces piece/approved', async () => {
    const mounted = await mountLifecycle()
    const opened = Date.now()

    await mounted.lifecycle.transition('00.01', 'todo', 'pending', 'user approved at the junction')

    const closed = Date.now()
    expect(mounted.lifecycle.getStatus('00.01')).toBe('pending')
    const [announced, ...rest] = announcements(mounted)
    expect(rest).toEqual([])
    expect(announced?.name).toBe('piece/approved')
    expect(announced?.event.pieceId).toBe('00.01')
    expect(announced?.event.from).toBe('todo')
    expect(announced?.event.to).toBe('pending')
    expect(announced?.event.reason).toBe('user approved at the junction')
    expect(announced?.event.newPath).toBeUndefined()
    expect(announced?.event.timestamp).toBeGreaterThanOrEqual(opened)
    expect(announced?.event.timestamp).toBeLessThanOrEqual(closed)
  })

  it('approves without a reason, leaving the optional field absent', async () => {
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.01', 'todo', 'pending')

    expect(announcements(mounted, 'piece/approved')[0]?.event.reason).toBeUndefined()
  })

  it('moves pending to blocked and announces piece/blocked carrying the reason', async () => {
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.02', 'pending', 'blocked', 'CLAIM_CONTRADICTION')

    expect(mounted.lifecycle.getStatus('00.02')).toBe('blocked')
    const [announced] = announcements(mounted)
    expect(announced?.name).toBe('piece/blocked')
    expect(announced?.event.from).toBe('pending')
    expect(announced?.event.to).toBe('blocked')
    expect(announced?.event.reason).toBe('CLAIM_CONTRADICTION')
    // Blocking does not relocate the file, so there is no path to announce.
    expect(announced?.event.newPath).toBeUndefined()
    expect(gitCalls(mounted)).toEqual([])
  })

  it('reopens a blocked piece to todo', async () => {
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.03', 'blocked', 'todo', 'user issued revision instructions')

    expect(mounted.lifecycle.getStatus('00.03')).toBe('todo')
    expect(gitCalls(mounted)).toEqual([])
  })

  it('announces nothing for blocked to todo, because the event map declares no such member', async () => {
    // SPECIFICATION GAP, pinned rather than papered over: `Events` declares
    // `piece/approved`, `piece/completed` and `piece/blocked` only, so the one
    // edge that returns a piece to the queue is unobservable to a consumer.
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.03', 'blocked', 'todo')

    expect(announcements(mounted)).toEqual([])
  })

  it('runs no command for a transition that does not complete a piece', async () => {
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.01', 'todo', 'pending')

    expect(mounted.runner.calls).toEqual([])
  })
})

describe('illegal edges', () => {
  it('rejects todo to done with INVALID_STATE_TRANSITION and changes nothing', async () => {
    const mounted = await mountLifecycle()

    const error = await attempt(() => mounted.lifecycle.transition('00.01', 'todo', 'done'))

    expect(error).toBeInstanceOf(InvalidStateTransitionError)
    expect(error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', pieceId: '00.01' })
    expect(error).toHaveProperty('message', expect.stringContaining('pending'))
    expect(mounted.lifecycle.getStatus('00.01')).toBe('todo')
    expect(mounted.journal).toEqual([])
    expect(existsSync(join(mounted.root, piecePath('00.01')))).toBe(true)
    expect(existsSync(join(mounted.root, completedPath('00.01')))).toBe(false)
  })

  it('permits no edge out of done, which is absorbing', async () => {
    const mounted = await mountLifecycle()

    for (const to of PIECE_STATUSES) {
      const error = await attempt(() => mounted.lifecycle.transition('00.04', 'done', to))

      expect(error, `done -> ${to}`).toBeInstanceOf(InvalidStateTransitionError)
      expect(error, `done -> ${to}`).toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
      // The message names the absorbing property rather than an empty list of
      // permitted targets, so a caller reading the log learns why.
      expect(error, `done -> ${to}`).toHaveProperty('message', expect.stringContaining('absorbing'))
      expect(mounted.lifecycle.getStatus('00.04')).toBe('done')
    }
    expect(mounted.journal).toEqual([])
  })

  it('rejects every from/to pair the table does not name, including each self-edge', async () => {
    const mounted = await mountLifecycle()
    const pieceOf: Readonly<Record<PieceStatus, string>> = {
      todo: '00.01',
      pending: '00.02',
      blocked: '00.03',
      done: '00.04',
    }

    for (const from of PIECE_STATUSES) {
      for (const to of PIECE_STATUSES) {
        if (LEGAL_TRANSITIONS[from].includes(to)) continue
        const pieceId = pieceOf[from]

        const error = await attempt(() => mounted.lifecycle.transition(pieceId, from, to))

        expect(error, `${from} -> ${to}`).toBeInstanceOf(InvalidStateTransitionError)
        expect(error, `${from} -> ${to}`).toMatchObject({ code: 'INVALID_STATE_TRANSITION', pieceId })
        expect(mounted.lifecycle.getStatus(pieceId), `${from} -> ${to}`).toBe(from)
      }
    }
    expect(mounted.journal).toEqual([])
  })
})

describe('compare-and-set', () => {
  it('rejects a stale expected status with PIECE_STALE_STATUS and mutates nothing', async () => {
    const mounted = await mountLifecycle()
    await mounted.lifecycle.transition('00.01', 'todo', 'pending')
    const journalled = announcements(mounted).length

    const error = await attempt(() => mounted.lifecycle.transition('00.01', 'todo', 'pending'))

    expect(error).toBeInstanceOf(StalePieceStatusError)
    expect(error).toMatchObject({ code: 'PIECE_STALE_STATUS', pieceId: '00.01' })
    expect(error).toHaveProperty('message', expect.stringContaining('pending'))
    expect(mounted.lifecycle.getStatus('00.01')).toBe('pending')
    expect(announcements(mounted)).toHaveLength(journalled)
  })

  it('lets exactly one of two orchestrators racing the same completion win', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    const [first, second] = await Promise.allSettled([
      mounted.lifecycle.transition('00.02', 'pending', 'done'),
      mounted.lifecycle.transition('00.02', 'pending', 'done'),
    ])

    const settled = [first, second]
    expect(settled.filter(result => result?.status === 'fulfilled')).toHaveLength(1)
    const loser = settled.find(result => result?.status === 'rejected')
    expect(loser?.status === 'rejected' ? loser.reason : undefined).toBeInstanceOf(StalePieceStatusError)
    expect(loser?.status === 'rejected' ? loser.reason : undefined).toMatchObject({ code: 'PIECE_STALE_STATUS' })
    // The loser must not have moved anything: one completion, one move, one announcement.
    expect(gitMoves(mounted)).toHaveLength(1)
    expect(announcements(mounted, 'piece/completed')).toHaveLength(1)
    expect(mounted.lifecycle.getStatus('00.02')).toBe('done')
    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(true)
  })

  it('lets exactly one of two orchestrators racing different targets win', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    const results = await Promise.allSettled([
      mounted.lifecycle.transition('00.02', 'pending', 'done'),
      mounted.lifecycle.transition('00.02', 'pending', 'blocked', 'a gate rejected it'),
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(announcements(mounted)).toHaveLength(1)
    // Whichever won, the record and the filesystem agree afterwards.
    const status = mounted.lifecycle.getStatus('00.02')
    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(status === 'done')
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(status === 'blocked')
  })
})

describe('the completing move', () => {
  it('moves the piece into done/ with git mv, preserving the filename and the id', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    const before = await readFile(join(mounted.root, piecePath('00.02')), 'utf8')

    await mounted.lifecycle.transition('00.02', 'pending', 'done', 'every gate passed')

    const [moved, ...extraMoves] = gitMoves(mounted)
    expect(extraMoves).toEqual([])
    expect(moved?.argv[0]).toBe('git')
    // The command must be runnable as issued: its trailing source and
    // destination resolve against its own cwd. A `--` separator or a flag
    // between the subcommand and the paths stays the implementation's choice.
    const paths = moved?.argv.slice(-2) ?? []
    expect(absoluteOf(moved?.cwd ?? '', paths[0] ?? '')).toBe(join(mounted.root, piecePath('00.02')))
    expect(absoluteOf(moved?.cwd ?? '', paths[1] ?? '')).toBe(join(mounted.root, completedPath('00.02')))
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(false)
    // The moved file carries the rewritten header and nothing else changed. A
    // completion that relocated the bytes untouched would leave a file under
    // `done/` still declaring `pending`, which 00.01's corpus invariant —
    // a file sits under `done/` if and only if it declares `done` — rejects.
    expect(before).toContain('**Status:** pending')
    expect(await readFile(join(mounted.root, completedPath('00.02')), 'utf8'))
      .toBe(before.replace('**Status:** pending', '**Status:** done'))
  })

  it('leaves one staged rename and a clean worktree, not a rename plus an unstaged edit', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    const { stdout } = await runCommand('git', ['status', '--porcelain'], { cwd: mounted.root })
    // A staged rename, not an untracked addition beside a deleted file: `done/`
    // is the record of what was built, and a lost history is a lost record.
    // `R ` and not `RM`: staging the header rewrite before the move is what
    // distinguishes the specified ordering from rewriting afterwards.
    expect(stdout.split('\n').filter(line => line !== ''))
      .toEqual([`R  ${piecePath('00.02')} -> ${completedPath('00.02')}`])
  })

  it('stages the rewritten header with the rename rather than leaving it in the worktree', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    const unstaged = await runCommand('git', ['diff', '--name-only'], { cwd: mounted.root })
    expect(unstaged.stdout).toBe('')
    // The blob git holds for the moved path, which is what a later commit records.
    const staged = await runCommand('git', ['show', `:${completedPath('00.02')}`], { cwd: mounted.root })
    expect(staged.stdout).toContain('**Status:** done')
    expect(staged.stdout).not.toContain('**Status:** pending')
  })

  it('announces piece/completed carrying the relocated path', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    const opened = Date.now()

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    const [announced, ...rest] = announcements(mounted)
    expect(rest).toEqual([])
    expect(announced?.name).toBe('piece/completed')
    expect(announced?.event.to).toBe('done')
    expect(announced?.event.from).toBe('pending')
    expect(announced?.event.newPath).toBeDefined()
    expect(absoluteOf(mounted.root, announced?.event.newPath ?? '')).toBe(join(mounted.root, completedPath('00.02')))
    expect(announced?.event.newPath).toContain(`/${DONE_DIRECTORY}/`)
    expect(announced?.event.newPath).toContain(pieceFileName('00.02'))
    expect(announced?.event.timestamp).toBeGreaterThanOrEqual(opened)
  })

  it('creates the done/ directory on the first completion of a set', async () => {
    // `git mv` fails with "No such file or directory" when the destination
    // directory is absent, and `ctx.fs` exposes no mkdir, so the first
    // completion of any set has to create it through the subprocess seam.
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    expect(existsSync(join(mounted.root, PIECE_ROOT, SET_NAME, DONE_DIRECTORY))).toBe(false)

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(true)
  })

  it('completes into a done/ directory that already holds an earlier piece', async () => {
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(true)
    expect(existsSync(join(mounted.root, completedPath('00.04')))).toBe(true)
  })

  it('leaves a completed dependency resolvable by id under done/', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    const resolved = await mounted.directory.getPiece('00.02')
    expect(resolved.id).toBe('00.02')
    expect(resolved.path).toBe(completedPath('00.02'))
  })
})

describe('ordering across git, in-memory status and the bus', () => {
  it('commits the move before the in-memory status and announces only after both', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    const spawnIndex = mounted.journal.findIndex(entry =>
      entry.kind === 'spawn' && entry.argv[0] === 'git' && entry.argv.includes('mv'))
    const eventIndex = mounted.journal.findIndex(entry => entry.kind === 'event')
    expect(spawnIndex).toBeGreaterThanOrEqual(0)
    expect(eventIndex).toBeGreaterThan(spawnIndex)

    const move = mounted.journal[spawnIndex]
    // The spawn journal observes pending memory; it supplies no persistence evidence.
    expect(move?.statuses['00.02']).toBe('pending')

    const announced = mounted.journal[eventIndex]
    expect(announced?.kind === 'event' ? announced.statuses['00.02'] : undefined).toBe('done')
    expect(announced?.kind === 'event' ? announced.destinationExists : undefined).toBe(true)
    expect(announced?.kind === 'event' ? announced.sourceExists : undefined).toBe(false)
  })

  it('announces an approval only after the record already holds the new status', async () => {
    const mounted = await mountLifecycle()

    await mounted.lifecycle.transition('00.01', 'todo', 'pending')

    expect(announcements(mounted)[0]?.statuses['00.01']).toBe('pending')
  })

  it('rewrites the header before the move, so a crash leaves a done file the placement checker flags', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })

    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    const move = mounted.journal.find(entry =>
      entry.kind === 'spawn' && entry.argv[0] === 'git' && entry.argv.includes('mv'))
    // Observed from the file itself at the instant the move was handed to the
    // subprocess seam. Rewriting afterwards would leave a file under `done/`
    // declaring `pending`, which no runtime checker flags; this order leaves a
    // `done` file in the set root instead, which `check-done-pieces` does.
    expect(move?.declared['00.02']).toBe('done')
  })
})

describe('a move that fails', () => {
  it('leaves the status at pending, announces nothing, and surfaces the failure', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED, git: 'no-repository' })

    const error = await attempt(() => mounted.lifecycle.transition('00.02', 'pending', 'done'))

    expect(error).toBeInstanceOf(Error)
    expect(mounted.lifecycle.getStatus('00.02')).toBe('pending')
    expect(announcements(mounted)).toEqual([])
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(true)
    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(false)
  })

  it('refuses an untracked piece file loudly instead of failing deep inside git', async () => {
    // The precondition the piece never stated: `git mv` requires a tracked
    // source, and the real `plans/` corpus is untracked today. A false
    // completion is worse than a failed one, and a `mv` fallback would discard
    // the history `done/` exists to preserve, so the only correct outcome is a
    // loud, attributable refusal.
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED, git: 'untracked' })

    const error = await attempt(() => mounted.lifecycle.transition('00.02', 'pending', 'done'))

    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(InvalidStateTransitionError)
    expect(error).not.toBeInstanceOf(StalePieceStatusError)
    // Attributable: the failure names the piece whose move was refused.
    expect(error).toHaveProperty('message', expect.stringContaining('00.02'))
    expect(mounted.lifecycle.getStatus('00.02')).toBe('pending')
    expect(announcements(mounted)).toEqual([])
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(true)
    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(false)
  })

  it('aborts the transition when the subprocess provider itself fails', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    mounted.runner.behaviour = 'provider-error'

    const error = await attempt(() => mounted.lifecycle.transition('00.02', 'pending', 'done'))

    expect(error).toBeInstanceOf(Error)
    expect(mounted.lifecycle.getStatus('00.02')).toBe('pending')
    expect(announcements(mounted)).toEqual([])
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(true)
  })

  it('attributes failed directory creation to mkdir and never starts git mv', async () => {
    // A regular file at `done` makes directory creation fail before any move.
    const mounted = await mountLifecycle({
      pieces: NOTHING_COMPLETED,
      extraFiles: { [`${PIECE_ROOT}/${SET_NAME}/${DONE_DIRECTORY}`]: 'not a directory\n' },
    })

    const error = await attempt(() => mounted.lifecycle.transition('00.02', 'pending', 'done'))

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      code: 'PIECE_MOVE_FAILED', pieceId: '00.02', argv: ['mkdir', '-p', DONE_DIRECTORY],
    })
    expect(error).toHaveProperty('message', expect.stringContaining('00.02'))
    expect(error).toHaveProperty('stderr', expect.stringContaining('mkdir'))
    expect(gitMoves(mounted)).toEqual([])
    expect(mounted.lifecycle.getStatus('00.02')).toBe('pending')
    expect(announcements(mounted)).toEqual([])
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(true)
  })

  it('allows a retry after a failed move once the precondition holds', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    mounted.runner.behaviour = 'provider-error'
    await attempt(() => mounted.lifecycle.transition('00.02', 'pending', 'done'))
    mounted.runner.behaviour = 'execute'

    // The failed attempt consumed nothing: `pending` is still the expected
    // status, so the same compare-and-set call succeeds. The header rewrite
    // must therefore tolerate a file that already declares `done`, because the
    // abandoned attempt left it that way.
    await mounted.lifecycle.transition('00.02', 'pending', 'done')

    expect(mounted.lifecycle.getStatus('00.02')).toBe('done')
    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(true)
    expect(await readFile(join(mounted.root, completedPath('00.02')), 'utf8')).toContain('**Status:** done')
  })
})

describe('announcement dispatch', () => {
  /**
   * UNRESOLVED IN THE PIECE. All three events are `@mode emit`, and
   * `vendor/cordis/src/events.ts` implements emit as
   * `this.dispatch('emit', args).map(cb => cb(...args))` — a synchronous throw
   * from a listener therefore propagates to the caller. The piece says the
   * announcement is "never a transaction participant", which these assertions
   * pin in the only way that holds either way: the move and the record are
   * already committed when a listener runs, so a faulting listener cannot
   * revert them. Whether `transition` itself rejects is left open, because the
   * piece does not decide it and cordis does not isolate the fault.
   */
  it('commits the completion before any listener runs, so a faulting listener cannot revert it', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    mounted.ctx.on('piece/completed', () => { throw new Error('listener fault') })

    await attempt(() => mounted.lifecycle.transition('00.02', 'pending', 'done'))

    expect(mounted.lifecycle.getStatus('00.02')).toBe('done')
    expect(existsSync(join(mounted.root, completedPath('00.02')))).toBe(true)
    expect(existsSync(join(mounted.root, piecePath('00.02')))).toBe(false)
  })

  it('keeps the state machine consistent after a faulting listener', async () => {
    const mounted = await mountLifecycle({ pieces: NOTHING_COMPLETED })
    mounted.ctx.on('piece/approved', () => { throw new Error('listener fault') })
    await attempt(() => mounted.lifecycle.transition('00.01', 'todo', 'pending'))

    // The committed status is the one the next compare-and-set must present.
    const stale = await attempt(() => mounted.lifecycle.transition('00.01', 'todo', 'pending'))
    expect(stale).toBeInstanceOf(StalePieceStatusError)
    await mounted.lifecycle.transition('00.01', 'pending', 'blocked', 'a gate rejected it')
    expect(mounted.lifecycle.getStatus('00.01')).toBe('blocked')
  })

  it('delivers one payload to every listener of the same announcement', async () => {
    const mounted = await mountLifecycle()
    const seen: StateTransitionEvent[] = []
    mounted.ctx.on('piece/blocked', (event) => { seen.push(event) })
    mounted.ctx.on('piece/blocked', (event) => { seen.push(event) })

    await mounted.lifecycle.transition('00.02', 'pending', 'blocked', 'a subagent failed')

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]?.reason).toBe('a subagent failed')
  })
})

describe('service lifecycle', () => {
  it('removes ctx.devLoopLifecycle when the fiber that mounted it is disposed', async () => {
    const mounted = await mountLifecycle()

    expect(mounted.ctx.get('devLoopLifecycle')).toBeInstanceOf(DevLoopLifecycle)

    await mounted.fiber.dispose()

    expect(mounted.ctx.get('devLoopLifecycle')).toBeUndefined()
  })
})

describe('real Loader composition', () => {
  it('publishes ctx.devLoopLifecycle from a cordis.yml composition and completes a piece through it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-lifecycle-loader-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const absolute = join(root, piecePath('00.02'))
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, pieceFile('00.02', 'pending', 1))
    await initRepository(root, true)

    const configPath = join(root, 'cordis.yml')
    // Test-only composition: a local filesystem backend rooted at the fixture
    // corpus, the piece directory reading it, and the lifecycle over both.
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: '${root.replaceAll('\\', '/')}'`,
      "- name: '@deepseek-ai/dsh-dev-loop-directory'",
      '  config:',
      `    root: '${PIECE_ROOT}'`,
      "- name: '@deepseek-ai/dsh-dev-loop-lifecycle'",
      '',
    ].join('\n'))

    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    // The subprocess seam has no row of its own: the shipped local provider is
    // not a dependency of this package, so the composition consumes the
    // recording provider mounted on the context the Loader composes into.
    await ctx.plugin(RecordingSubprocess)
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-fs-local', fsLocalPlugin],
      ['@deepseek-ai/dsh-dev-loop-directory', directoryPlugin],
      ['@deepseek-ai/dsh-dev-loop-lifecycle', lifecyclePlugin],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        const module = modules.get(specifier)
        if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
        return module
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    const lifecycle = ctx.get('devLoopLifecycle')
    expect(lifecycle).toBeInstanceOf(DevLoopLifecycle)
    if (lifecycle === undefined) throw new Error('devLoopLifecycle service missing after Loader composition')

    expect(lifecycle.getStatus('00.02')).toBe('pending')
    expect(lifecycle.canTransition('pending', 'done')).toBe(true)

    await lifecycle.transition('00.02', 'pending', 'done', 'composed through the Loader')

    expect(lifecycle.getStatus('00.02')).toBe('done')
    expect(existsSync(join(root, completedPath('00.02')))).toBe(true)
  })
})
