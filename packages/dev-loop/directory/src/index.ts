/**
 * Development-loop piece directory (`ctx.devLoopDirectory`).
 *
 * This package owns the Service Provider role for piece specification
 * discovery: it reads `plans/pieces` through the filesystem seam, validates
 * each file against the `axiom` blocks in `plans/AGENTS.md`, and exposes
 * queue-ordered {@link PieceRecord} values to the approval junction, the
 * dispatch queue, and the verification gates. Parsing itself is a pure
 * function exported from `./parse.ts`, so a consumer holding file text can
 * validate it without touching the filesystem.
 *
 * A scan reports what it could read: a file the parser rejects becomes a
 * {@link PieceRejection} beside the valid {@link PieceRecord} values of its
 * {@link SetScan}, so one malformed piece withholds only itself. The parse
 * failure reaches a caller only through {@link DevLoopDirectory.getPiece}, and
 * only for the id that caller asked for.
 *
 * @module @deepseek-ai/dsh-dev-loop-directory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  DONE_DIRECTORY,
  HARNESS_PRIMITIVES,
  PIECE_MAX_LINES,
  PIECE_ROOT,
  PieceParseError,
  isPieceFilename,
  parsePiece,
  pieceIdFromPath,
  tryParsePiece,
} from './parse.ts'
import type { PieceParseOptions } from './parse.ts'
import type { PieceRecord, PieceRejection, SetScan } from './types.ts'

export {
  DONE_DIRECTORY,
  HARNESS_PRIMITIVES,
  PIECE_MAX_LINES,
  PIECE_ROOT,
  PieceParseError,
  fenceMarkerAt,
  isPieceFilename,
  parsePiece,
} from './parse.ts'
export type { FenceMarker, PieceParseOptions } from './parse.ts'
export type {
  PieceFinding,
  PieceFindingCode,
  PieceFindingSeverity,
  PieceMetadata,
  PieceRecord,
  PieceRejection,
  PieceScenario,
  PieceStatus,
  SetScan,
} from './types.ts'

/**
 * Directory configuration; every field is deployment-varying and set from
 * `cordis.yml`. All are optional so a row may set one and inherit the rest
 * from the schema defaults.
 */
export interface Config {
  /** Directory holding the set directories, relative to the filesystem backend's base. */
  root?: string
  /** Inclusive line ceiling enforced by `R-piece-size`. */
  maxLines?: number
  /** Accepted Harness primitives; a piece declaring anything else is rejected. */
  primitives?: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    devLoopDirectory: DevLoopDirectory
  }
}

/** Lookup failure for a piece id that no set directory contains. */
export class PieceNotFoundError extends Error {
  /** Stable code consumers branch on. */
  readonly code = 'PIECE_NOT_FOUND'
  /** The id that resolved to no file. */
  readonly pieceId: string

  /**
   * @param pieceId - the id that resolved to no file.
   */
  constructor(pieceId: string) {
    super(`no piece specification found for id "${pieceId}"`)
    this.name = 'PieceNotFoundError'
    this.pieceId = pieceId
  }
}

/** Lookup failure for a set name that no directory under the configured root matches. */
export class SetNotFoundError extends Error {
  /** Stable code consumers branch on. */
  readonly code = 'SET_NOT_FOUND'
  /** The set name that matched no directory. */
  readonly setName: string

  /**
   * @param setName - the set name that matched no directory.
   */
  constructor(setName: string) {
    super(`no set directory found for "${setName}"`)
    this.name = 'SetNotFoundError'
    this.setName = setName
  }
}

/**
 * Corpus defect: one piece id occupies two files at once, which a half-finished
 * move into `done/` produces. It is reported rather than resolved by precedence,
 * because either file could be the stale one and guessing would hide the defect.
 */
export class DuplicatePieceError extends Error {
  /** Stable code consumers branch on. */
  readonly code = 'DUPLICATE_PIECE_ID'
  /** The id found more than once. */
  readonly pieceId: string
  /** Every path declaring that id, in scan order. */
  readonly paths: readonly string[]

  /**
   * @param pieceId - the id found more than once.
   * @param paths - every path declaring that id, in scan order.
   */
  constructor(pieceId: string, paths: readonly string[]) {
    super(`piece id "${pieceId}" is declared by more than one file: ${paths.join(', ')}`)
    this.name = 'DuplicatePieceError'
    this.pieceId = pieceId
    this.paths = paths
  }
}

/** Configuration after schemastery applied every default. */
type ResolvedConfig = Required<Config>

/**
 * Order pieces of one set: queue position first, then id, so a set that
 * accidentally reuses a queue number still has one deterministic order.
 * @param left - first record to compare.
 * @param right - second record to compare.
 * @returns a negative, zero, or positive ordering value.
 */
function byQueueThenId(left: PieceRecord, right: PieceRecord): number {
  return left.queue - right.queue || left.id.localeCompare(right.id)
}

/**
 * Reject a set whose pieces do not agree on which file owns an id.
 *
 * A half-finished move into `done/` leaves the same id in both directories.
 * Either copy could be the stale one, so the defect is reported rather than
 * resolved by precedence.
 *
 * @param records - every record read from one set, in scan order.
 */
function assertUniquePieceIds(records: readonly PieceRecord[]): void {
  const pathsById = new Map<string, string[]>()
  for (const record of records) {
    const paths = pathsById.get(record.id)
    if (paths === undefined) pathsById.set(record.id, [record.path])
    else paths.push(record.path)
  }
  for (const [pieceId, paths] of pathsById) {
    if (paths.length > 1) throw new DuplicatePieceError(pieceId, paths)
  }
}

/**
 * Reads and validates the piece corpus.
 *
 * A set's pieces live in `<root>/<set>` until they complete, then move to
 * `<root>/<set>/done` per `R-done-pieces-moved`; every read merges both so the
 * directory stays the whole-set view regardless of completion state.
 */
export class DevLoopDirectory extends Service {
  static inject = ['fs']

  static Config: Schema<Config> = z.object({
    root: z.string().default(PIECE_ROOT),
    maxLines: z.natural().min(1).default(PIECE_MAX_LINES),
    primitives: z.array(z.string()).default([...HARNESS_PRIMITIVES]),
  })

  /** Validated configuration; schemastery applied the defaults before construction. */
  readonly config: ResolvedConfig

  /** Ceiling and vocabulary every read of this directory parses against. */
  private readonly parseOptions: PieceParseOptions

  /**
   * @param ctx - the mounting context; `fs` is injected.
   * @param config - validated directory configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopDirectory')
    const resolved = config as ResolvedConfig
    this.config = resolved
    this.parseOptions = { maxLines: resolved.maxLines, primitives: resolved.primitives }
  }

  /**
   * Validate one piece file's text without reading the filesystem.
   * @param filePath - path the content came from, reported in findings.
   * @param content - complete file text.
   * @returns the validated record, carrying any warnings.
   */
  validate(filePath: string, content: string): PieceRecord {
    return parsePiece(filePath, content, this.parseOptions)
  }

  /**
   * Read every piece of one set, pending and completed together.
   *
   * A file this parser rejects is reported in `rejected` rather than thrown, so
   * one malformed piece never denies the caller the rest of its set. The defects
   * that still throw belong to the request or the set as a whole rather than to
   * one file's contents: an unmatched set name, and one id owned by two files.
   *
   * @param setName - set directory name such as `00-dev-loop`.
   * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
   * @returns the parsed records ordered by queue position then by id, beside every rejected file.
   */
  async scanSet(setName: string, signal?: AbortSignal): Promise<SetScan> {
    signal?.throwIfAborted()
    const setPath = `${this.config.root}/${setName}`
    const setTarget = await this.ctx.fs.resolve(setPath, signal === undefined ? undefined : { signal })
    signal?.throwIfAborted()
    const setInfo = await this.ctx.fs.stat(setTarget, signal)
    if (setInfo === undefined || setInfo.type !== 'directory') throw new SetNotFoundError(setName)

    const scan = await this.readPieceDirectory(setPath, setTarget, signal)
    const donePath = `${setPath}/${DONE_DIRECTORY}`
    const doneTarget = await this.ctx.fs.resolve(donePath, signal === undefined ? undefined : { signal })
    signal?.throwIfAborted()
    const doneInfo = await this.ctx.fs.stat(doneTarget, signal)
    if (doneInfo !== undefined && doneInfo.type === 'directory') {
      const done = await this.readPieceDirectory(donePath, doneTarget, signal)
      scan.pieces.push(...done.pieces)
      scan.rejected.push(...done.rejected)
    }

    assertUniquePieceIds(scan.pieces)
    return { pieces: scan.pieces.sort(byQueueThenId), rejected: scan.rejected }
  }

  /**
   * List the set directories under the configured root, in name order.
   *
   * Only direct subdirectories of the root are sets: a file beside them is not
   * one, a set's own `done/` subdirectory lives one level deeper and is part of
   * its set, and no listing recurses. A root holding no set directory returns an
   * empty list, which is the answer for an empty corpus; a configured root that
   * does not exist is misconfiguration and rejects, as reading it as "no work"
   * would idle every consumer silently.
   *
   * @param signal - aborts root resolution and listing; cancellation after resolution prevents the listing.
   * @returns every set directory name under the root, sorted by name.
   */
  async listSets(signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted()
    const rootTarget = await this.ctx.fs.resolve(this.config.root, signal === undefined ? undefined : { signal })
    signal?.throwIfAborted()
    const entries = await this.ctx.fs.listDir(rootTarget, signal)
    return entries.filter(entry => entry.type === 'directory').map(entry => entry.name).sort()
  }

  /**
   * Select the pieces available for dispatch: those declaring `todo` or
   * `pending`. A `done` piece stays resolvable through {@link getPiece} but is
   * never a candidate, and a `blocked` piece is excluded because it waits on a
   * human decision rather than on a dispatch slot. Selection reads the valid
   * pieces of every set it scans, so a malformed file elsewhere in the corpus
   * withholds only itself.
   * @param setName - set to select from; omitted selects across every set. An unmatched name rejects with {@link SetNotFoundError}.
   * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
   * @returns candidates ordered by queue position then id within one set, and by set before
   * queue when selecting across every set, because queue numbers are set-local.
   */
  async getQueueCandidates(setName?: string, signal?: AbortSignal): Promise<PieceRecord[]> {
    signal?.throwIfAborted()
    const setNames = setName === undefined ? await this.listSets(signal) : [setName]
    const candidates: PieceRecord[] = []
    for (const name of setNames) {
      const { pieces } = await this.scanSet(name, signal)
      candidates.push(...pieces.filter(record => record.status === 'todo' || record.status === 'pending'))
    }
    return candidates
  }

  /**
   * Read one piece by id, searching the set directory its id prefix names.
   *
   * A malformed sibling never decides this call: the parse failure surfaces
   * only when the requested id owns the rejected file, which its filename
   * declares.
   *
   * @param id - dotted piece id such as `00.01`.
   * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
   * @returns the validated record.
   * @throws PieceParseError when the requested id's own file failed to parse.
   */
  async getPiece(id: string, signal?: AbortSignal): Promise<PieceRecord> {
    signal?.throwIfAborted()
    const setPrefix = id.slice(0, id.indexOf('.'))
    const setNames = await this.listSets(signal)
    const setName = setNames.find(name => name.startsWith(`${setPrefix}-`))
    if (setName === undefined) throw new PieceNotFoundError(id)
    const { pieces, rejected } = await this.scanSet(setName, signal)
    const record = pieces.find(candidate => candidate.id === id)
    if (record !== undefined) return record
    const rejection = rejected.find(candidate => pieceIdFromPath(candidate.path) === id)
    if (rejection !== undefined) throw new PieceParseError(rejection.path, rejection.code, rejection.findings)
    throw new PieceNotFoundError(id)
  }

  /**
   * Read and validate every piece file of one directory.
   * @param directoryPath - path the directory was resolved from, used to report each file.
   * @param target - the resolved directory.
   * @param signal - aborts the listing and the reads.
   * @returns one record or one rejection per entry whose basename is a piece filename, in listing order.
   */
  private async readPieceDirectory(
    directoryPath: string,
    target: FsTarget,
    signal?: AbortSignal,
  ): Promise<{ pieces: PieceRecord[]; rejected: PieceRejection[] }> {
    const entries = await this.ctx.fs.listDir(target, signal)
    const pieces: PieceRecord[] = []
    const rejected: PieceRejection[] = []
    for (const entry of entries) {
      if (!isPieceFilename(entry.name)) continue
      const content = await this.ctx.fs.readText(entry.target, signal)
      const result = tryParsePiece(`${directoryPath}/${entry.name}`, content, this.parseOptions)
      if (result.ok) pieces.push(result.record)
      else rejected.push(result.rejection)
    }
    return { pieces, rejected }
  }
}

export default DevLoopDirectory
