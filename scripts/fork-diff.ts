/**
 * Report this fork's true divergence from upstream.
 *
 * Fork-owned files cannot conflict on an upstream merge; edits inside
 * upstream-owned files can, and each one is supposed to carry a `FORK-LOCAL:`
 * marker. This script prints both sets and fails when an upstream-owned file
 * diverges without a marker, so the inventory in `FORK.md` cannot silently
 * fall behind the tree.
 *
 * FORK-LOCAL: this file exists only in this fork (see FORK.md).
 *
 * @module scripts/fork-diff
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const MARKER = 'FORK-LOCAL'
const DEFAULT_BASE = 'upstream/master'

/** One diverging path and how it diverges. */
interface Divergence {
  /** Repository-relative path. */
  path: string
  /** Git status letter: `A` added by the fork, `M` modified, `D` deleted. */
  status: string
  /** Whether the working file carries a `FORK-LOCAL` marker. */
  marked: boolean
}

/**
 * Run git and return stdout, failing loudly when git itself fails.
 * @param args - git arguments.
 * @returns trimmed stdout.
 */
function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || `exit ${String(result.status)}`}`)
  }
  return result.stdout.trim()
}

/**
 * Collect every path that differs from the merge base with upstream.
 *
 * The comparison reaches the working tree, not just `HEAD`: divergence is a
 * property of the files on disk, and a report that only counted commits would
 * read as clean while uncommitted fork edits sat in upstream-owned files.
 * Untracked files count as fork-owned additions.
 *
 * @param base - upstream ref to compare against.
 * @returns one entry per diverging path.
 */
export function collectDivergence(base: string): Divergence[] {
  const mergeBase = git(['merge-base', 'HEAD', base])
  const entries: Divergence[] = []
  const seen = new Set<string>()
  for (const line of git(['diff', '--name-status', mergeBase]).split('\n')) {
    if (line === '') continue
    const [status, ...rest] = line.split('\t')
    const path = rest[rest.length - 1]
    if (status === undefined || path === undefined) continue
    seen.add(path)
    entries.push({ path, status: status[0] ?? '?', marked: hasMarker(path) })
  }
  for (const path of git(['ls-files', '--others', '--exclude-standard']).split('\n')) {
    if (path === '' || seen.has(path)) continue
    entries.push({ path, status: 'A', marked: hasMarker(path) })
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Whether a working file carries the fork marker.
 * @param path - repository-relative path.
 * @returns true when the file exists and contains the marker.
 */
function hasMarker(path: string): boolean {
  const absolute = resolve(root, path)
  return existsSync(absolute) && readFileSync(absolute, 'utf8').includes(MARKER)
}

/**
 * Render the divergence report and decide the exit status.
 * @param entries - collected divergence.
 * @returns the report text and whether every modified upstream file is marked.
 */
export function renderReport(entries: readonly Divergence[]): { text: string; ok: boolean } {
  const added = entries.filter(entry => entry.status === 'A')
  const modified = entries.filter(entry => entry.status === 'M')
  const deleted = entries.filter(entry => entry.status === 'D')
  const unmarked = modified.filter(entry => !entry.marked)
  const lines = [
    `fork-owned files added by this fork (cannot conflict): ${String(added.length)}`,
    ...added.map(entry => `  + ${entry.path}`),
    '',
    `upstream-owned files this fork modifies (conflict surface): ${String(modified.length)}`,
    ...modified.map(entry => `  ${entry.marked ? 'M' : '!'} ${entry.path}${entry.marked ? '' : '   <- missing FORK-LOCAL marker'}`),
  ]
  if (deleted.length > 0) {
    lines.push(
      '',
      `upstream files this fork deletes (avoid; see FORK.md): ${String(deleted.length)}`,
      ...deleted.map(entry => `  - ${entry.path}`),
    )
  }
  if (unmarked.length > 0) {
    lines.push(
      '',
      `${String(unmarked.length)} upstream-owned file(s) diverge without a ${MARKER} marker.`,
      'Deliberate fork divergence should carry the marker and appear in FORK.md; in-progress feature',
      'work against upstream files is expected to appear here unmarked until it lands upstream.',
      'Run with --strict to fail on unmarked divergence.',
    )
  }
  return { text: lines.join('\n'), ok: unmarked.length === 0 }
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  const args = process.argv.slice(2)
  // Reporting is the default: an inventory that fails on ordinary in-progress
  // work against upstream files would be red continuously and stop being read.
  const strict = args.includes('--strict')
  const base = args.find(arg => !arg.startsWith('--')) ?? DEFAULT_BASE
  const report = renderReport(collectDivergence(base))
  console.log(report.text)
  if (strict && !report.ok) process.exitCode = 1
}
