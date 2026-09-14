/**
 * Axiom checkers for `plans/pieces/**` specification files.
 *
 * The `axiom` blocks in `plans/AGENTS.md` name five shell checkers. Each one is
 * a thin wrapper over this module, and this module validates through the same
 * parser the development loop uses at runtime
 * (`@deepseek-ai/dsh-dev-loop-directory`). Sharing the parser is the point: an
 * axiom and the runtime that enforces it cannot drift apart if they are the
 * same code.
 *
 * FORK-LOCAL: this file exists only in this fork (see FORK.md).
 *
 * @module scripts/check-pieces
 */

import { globSync, readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import {
  DONE_DIRECTORY,
  PieceParseError,
  fenceMarkerAt,
  isPieceFilename,
  parsePiece,
} from '@deepseek-ai/dsh-dev-loop-directory'
import type { FenceMarker, PieceFinding, PieceRecord } from '@deepseek-ai/dsh-dev-loop-directory'

const root = resolve(import.meta.dirname, '..')
const PIECE_GLOB = 'plans/pieces/*/**/*.md'

/** How a proof row may be established, per the `resources and citations of proof` axiom. */
const ESTABLISHED = [
  'direct inspection',
  'measured',
  'reported by',
  'readme only',
  'unverified',
]

/** One axiom violation, rendered as a single operator-facing line. */
export interface Violation {
  /** Repository-relative piece path. */
  path: string
  /** What the axiom requires that this file does not satisfy. */
  message: string
}

/**
 * Parse one piece, returning its record or the findings that rejected it.
 * The parser throws on a blocker; every checker needs the findings either way,
 * so the throw is converted back into data here rather than propagated.
 * @param path - repository-relative piece path.
 * @param content - complete file text.
 * @returns the record on success, or the observed findings on rejection.
 */
export function inspectPiece(path: string, content: string): { record?: PieceRecord; findings: readonly PieceFinding[] } {
  try {
    const record = parsePiece(path, content)
    return { record, findings: record.warnings }
  } catch (error) {
    if (error instanceof PieceParseError) return { findings: error.findings }
    throw error
  }
}

/**
 * Every piece specification file under `plans/pieces`, including completed ones.
 * @returns repository-relative paths, sorted.
 */
export function pieceFiles(): string[] {
  return globSync(PIECE_GLOB, { cwd: root })
    .map(match => match.replaceAll('\\', '/'))
    .filter(path => isPieceFilename(basename(path)))
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Check that a piece declares an approved Harness primitive and names its package.
 * @param path - repository-relative piece path.
 * @param content - complete file text.
 * @returns the violations observed.
 */
export function checkPrimitive(path: string, content: string): Violation[] {
  const { record, findings } = inspectPiece(path, content)
  const violations = findings
    .filter(finding => finding.code === 'INVALID_HARNESS_PRIMITIVE' || finding.code === 'MALFORMED_PIECE_HEADER')
    .map(finding => ({ path, message: finding.message }))
  if (record !== undefined && record.pkg.length === 0) {
    violations.push({ path, message: 'declares no owning package' })
  }
  return violations
}

/**
 * Check that a piece carries every required section in canonical order.
 * @param path - repository-relative piece path.
 * @param content - complete file text.
 * @returns the violations observed.
 */
export function checkSections(path: string, content: string): Violation[] {
  return inspectPiece(path, content).findings
    .filter(finding => finding.code === 'MISSING_REQUIRED_SECTION')
    .map(finding => ({ path, message: finding.message }))
}

/**
 * Check that the proof table marks how each claim was established.
 *
 * The parser owns section presence; this checker owns the table's contents,
 * which is an axiom rule rather than a piece-format rule.
 *
 * @param path - repository-relative piece path.
 * @param content - complete file text.
 * @returns the violations observed.
 */
export function checkClaimCitations(path: string, content: string): Violation[] {
  const lines = content.split('\n')
  const start = lines.findIndex(line => line === '## Resources and proof')
  if (start === -1) return [{ path, message: 'has no `## Resources and proof` section' }]
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const body = lines.slice(start + 1, end === -1 ? lines.length : end)
  const rows = body.filter(line => line.startsWith('|') && !/^\|[\s|:-]+\|$/.test(line))
  const data = rows.slice(1)
  if (data.length === 0) return [{ path, message: '`## Resources and proof` carries no claim rows' }]
  const violations: Violation[] = []
  for (const row of data) {
    const cells = tableCells(row)
    const established = (cells[2] ?? '').toLowerCase()
    if (!ESTABLISHED.some(form => established.includes(form))) {
      violations.push({ path, message: `proof row does not state how it was established: ${row.trim().slice(0, 90)}` })
    }
  }
  return violations
}

/**
 * Split one markdown table row into its cells.
 *
 * Only an unescaped pipe delimits a cell: a proof row routinely quotes a
 * TypeScript union such as `string \| undefined` inside a code span, and
 * treating that as a delimiter shifts every later column. Interior empty cells
 * are preserved for the same reason — dropping them moves the columns that
 * follow.
 *
 * @param row - one row including its leading and trailing pipe.
 * @returns the row's cells, trimmed, in column order.
 */
export function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim())
}

/**
 * Check that no piece declaring `done` remains in its set directory.
 * @param path - repository-relative piece path.
 * @param content - complete file text.
 * @param readIndex - supplies the set README text; defaults to reading it from disk.
 * @returns the violations observed.
 */
export type IndexReader = (readmePath: string) => string | undefined

/**
 * Read a set README from disk, treating an absent one as no index.
 * @param readmePath - absolute path of the set README.
 * @returns its text, or undefined when the set has no README.
 */
function readIndex(readmePath: string): string | undefined {
  try {
    return readFileSync(readmePath, 'utf8')
  } catch {
    return undefined
  }
}

export function checkDonePlacement(path: string, content: string, readIndex?: IndexReader): Violation[] {
  const { record } = inspectPiece(path, content)
  if (record?.status !== 'done') return []
  const parent = basename(dirname(path))
  if (parent !== DONE_DIRECTORY) {
    return [{ path, message: `declares status \`done\` but sits in the set directory; move it to ${dirname(path)}/${DONE_DIRECTORY}/` }]
  }
  return checkSetIndex(path, record.id, readIndex)
}

/**
 * Check that the set README records a completed piece as done.
 *
 * `R-done-pieces-moved` requires both halves — the file moves and the index
 * reflects it — because the README is what answers "what is left" without
 * reading the tree. The lifecycle service deliberately does not write this
 * index: it is a different file with a different lifetime, so the obligation is
 * verified here for every set at once rather than edited per completion.
 *
 * The index text arrives through a reader rather than being read here, so the
 * rule stays a pure function of its inputs: a test supplies the index it means
 * to check instead of reaching the real corpus, which is the same separation
 * the piece parser keeps between its grammar and `ctx.fs`.
 *
 * @param path - repository-relative path of the completed piece, under `done/`.
 * @param id - the piece's declared id, as it appears in the index.
 * @param read - supplies the set README text, or undefined when the set has none.
 * @returns the violations observed.
 */
export function checkSetIndex(path: string, id: string, read: IndexReader = readIndex): Violation[] {
  const readme = resolve(dirname(dirname(path)), 'README.md')
  const text = read(readme)
  if (text === undefined) {
    // A set with no README has no index to disagree with the tree.
    return []
  }
  // Match the row whose first cell declares the id; a dependency column in an
  // earlier row can also mention the id and must not shadow the piece's row.
  const rows = text.split('\n').filter(line => line.startsWith('|'))
  const row = rows.find(line => line.startsWith(`| \`${id}\``)) ??
    rows.find(line => line.includes(`\`${id}\``))
  if (row === undefined) {
    return [{ path, message: `is done but ${relative(process.cwd(), readme)} lists no row for \`${id}\`` }]
  }
  if (!/\bdone\b/i.test(row)) {
    return [{ path, message: `is done but its row in ${relative(process.cwd(), readme)} does not say done` }]
  }
  return []
}

/** Non-creating `git branch` flags for listing, deletion, renaming, or querying. */
const NON_CREATING_BRANCH_FLAGS = /^(?:-[dDamrMlv]+|--(?:delete|all|remotes|move|list|show-current|verbose|merged|no-merged|contains|no-contains|edit-description|help))$/

/**
 * Extract the contents of all inline backtick code spans from a line.
 *
 * Follows CommonMark code-span grammar: an opening run of N backticks is closed
 * only by the next matching run of exactly N backticks.
 *
 * @param line - one physical line of markdown outside any fenced code block.
 * @returns the code text inside each backtick span found on the line.
 */
export function extractInlineSpans(line: string): string[] {
  const spans: string[] = []
  let index = 0
  while (index < line.length) {
    if (line[index] === '`') {
      let openLength = 0
      while (index + openLength < line.length && line[index + openLength] === '`') {
        openLength += 1
      }
      let closeIndex = -1
      let search = index + openLength
      while (search < line.length) {
        if (line[search] === '`') {
          let closeLength = 0
          while (search + closeLength < line.length && line[search + closeLength] === '`') {
            closeLength += 1
          }
          if (closeLength === openLength) {
            closeIndex = search
            break
          }
          search += closeLength
        } else {
          search += 1
        }
      }
      if (closeIndex !== -1) {
        spans.push(line.slice(index + openLength, closeIndex))
        index = closeIndex + openLength
      } else {
        index += openLength
      }
    } else {
      index += 1
    }
  }
  return spans
}

/**
 * Test whether a shell command snippet instructs creating a git branch.
 *
 * Matches branch-creating invocations of `git checkout` (-b/--branch),
 * `git switch` (-c/--create), `git worktree add -b`, and `git branch <name>`.
 * Non-creating forms such as bare `git branch`, listing flags (`-a`, `-r`,
 * `--list`, `--show-current`), deletion flags (`-d`, `-D`, `--delete`),
 * move flags (`-m`, `-M`), detached worktrees (`git worktree add --detach`),
 * and non-branch checkout commands (`git checkout <ref>`) are excluded.
 *
 * @param snippet - code snippet from a fenced code block or an inline code span.
 * @returns the matched offending command, or `undefined` when none found.
 */
export function findBranchCreation(snippet: string): string | undefined {
  const gitPattern = /\bgit\s+([a-z-]+)\b([^;&|\n]*)/g
  let match: RegExpExecArray | null
  while ((match = gitPattern.exec(snippet)) !== null) {
    // Both capture groups always participate when the overall match succeeds:
    // group 1 is `[a-z-]+` and group 2 is `(...)*`, which matches empty.
    const subcommand = match[1] ?? ''
    const args = match[2] ?? ''
    if (subcommand === 'checkout') {
      if (/(?:^|\s)(?:-[bB]|--branch)(?:\s|$)/.test(args)) return match[0].trim()
    } else if (subcommand === 'switch') {
      if (/(?:^|\s)(?:-[cC]|--create)(?:\s|$)/.test(args)) return match[0].trim()
    } else if (subcommand === 'worktree') {
      if (/(?:^|\s)add\b/.test(args) && /(?:^|\s)-[bB](?:\s|$)/.test(args)) return match[0].trim()
    } else if (subcommand === 'branch') {
      const tokens = args.trim().split(/\s+/).filter(Boolean)
      if (tokens.length === 0) continue
      if (tokens.some(token => NON_CREATING_BRANCH_FLAGS.test(token))) continue
      if (tokens.some(token => !token.startsWith('-'))) return match[0].trim()
    }
  }
  return undefined
}

/**
 * Check that no piece creates or instructs creating a git branch.
 *
 * Per `R-no-feature-branches`, isolation uses detached worktrees under
 * `.worktrees/` and merges to mainline. Branch creation inside fenced code
 * blocks or inline code spans is forbidden, while prose mentions remain allowed.
 *
 * @param path - repository-relative piece path.
 * @param content - complete file text.
 * @returns the violations observed.
 */
export function checkNoBranches(path: string, content: string): Violation[] {
  const violations: Violation[] = []
  const lines = content.split('\n')
  let fence: FenceMarker | undefined

  for (const line of lines) {
    const marker = fenceMarkerAt(line)
    if (fence !== undefined) {
      if (marker !== undefined && marker.char === fence.char && marker.length >= fence.length) {
        fence = undefined
      } else {
        const trigger = findBranchCreation(line)
        if (trigger !== undefined) {
          violations.push({ path, message: `instructs creating a git branch: \`${trigger}\`` })
        }
      }
      continue
    }

    if (marker !== undefined) {
      fence = marker
      continue
    }

    const spans = extractInlineSpans(line)
    for (const span of spans) {
      const trigger = findBranchCreation(span)
      if (trigger !== undefined) {
        violations.push({ path, message: `instructs creating a git branch: \`${trigger}\`` })
      }
    }
  }

  return violations
}

/** The checker each wrapper selects. */
const CHECKS = {
  primitive: checkPrimitive,
  sections: checkSections,
  claims: checkClaimCitations,
  done: checkDonePlacement,
  branches: checkNoBranches,
} as const

/** Name of a checker this module exposes to its shell wrappers. */
export type CheckName = keyof typeof CHECKS

/**
 * Run one checker over explicit files, or over the whole corpus when none are given.
 * @param name - the checker to run.
 * @param files - repository-relative paths; empty means the whole corpus.
 * @returns every violation observed, in file order.
 */
export function runCheck(name: CheckName, files: readonly string[]): Violation[] {
  // Explicit arguments are filtered by the piece-filename grammar exactly as
  // discovery is: these checkers are defined over piece specifications, and a
  // set README expanded by a caller's glob would otherwise be judged as a piece
  // and report every canonical section missing.
  const targets = (files.length > 0 ? [...files] : pieceFiles())
    .filter(file => isPieceFilename(basename(file)))
  return targets.flatMap((file) => {
    const path = relative(root, resolve(root, file)).replaceAll('\\', '/')
    return CHECKS[name](path, readFileSync(resolve(root, file), 'utf8'))
  })
}

/**
 * Count the pieces a run covers, applying the same filename filter.
 * @param files - explicit paths, or empty for the whole corpus.
 * @returns the number of piece files checked.
 */
function targetCount(files: readonly string[]): number {
  return files.length > 0 ? files.filter(file => isPieceFilename(basename(file))).length : pieceFiles().length
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const [name, ...files] = process.argv.slice(2)
  if (name === undefined || !(name in CHECKS)) {
    console.error(`check-pieces: first argument must be one of ${Object.keys(CHECKS).join(', ')}`)
    process.exit(2)
  }
  const violations = runCheck(name as CheckName, files)
  for (const violation of violations) console.error(`${violation.path}: ${violation.message}`)
  if (violations.length > 0) {
    console.error(`check-pieces ${name}: ${String(violations.length)} violation(s)`)
    process.exitCode = 1
  } else {
    console.log(`check-pieces ${name}: ${String(targetCount(files))} piece(s) conform.`)
  }
}
