/**
 * Master queue generator and synchronizer for the autonomous development loop.
 *
 * Scans all set directories under `plans/pieces/` (or a configured plans directory),
 * parses each micro-gate piece file using `tryParsePiece`, extracts metadata,
 * queue positions, dependencies, and verification commands, and generates a
 * deterministic, canonical `QUEUE.md` progress ledger.
 *
 * Usage:
 *   pnpm exec tsx scripts/gen-queue.ts           # Regenerates plans/pieces/QUEUE.md
 *   pnpm exec tsx scripts/gen-queue.ts --check   # Verifies QUEUE.md freshness (CI gate)
 *   pnpm exec tsx scripts/gen-queue.ts <dir>     # Points at custom plans directory
 *
 * @module @deepseek-ai/dsh-dev-loop-directory/gen-queue
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { isPieceFilename, PieceRecord, tryParsePiece } from './parse-piece.ts'

/** Configuration options for scanning and queue generation. */
export interface QueueOptions {
  /** Base root directory for plans; defaults to `plans/pieces` (or `plans`). */
  readonly plansDir?: string | undefined
  /** Target QUEUE.md file path; defaults to `${plansDir}/QUEUE.md`. */
  readonly outputFile?: string | undefined
  /** Project title for the queue header. */
  readonly projectTitle?: string | undefined
}

/** One piece entry prepared for the master queue ledger. */
export interface QueuedPiece {
  /** Parsed record of the piece. */
  readonly record: PieceRecord
  /** Relative link path from the queue file location to the piece file. */
  readonly relativePath: string
  /** Extracted test or verification command from ## How to see it. */
  readonly verificationCommand: string
  /** Display status in the queue table. */
  readonly queueStatus: string
}

/** Queue of pieces grouped under one set. */
export interface SetQueue {
  /** Dotted or numbered set identifier (e.g. `00`, `01`). */
  readonly setId: string
  /** Raw directory name (e.g. `00-dev-loop`). */
  readonly setName: string
  /** Human-readable set title extracted from set README or formatted directory. */
  readonly setTitle: string
  /** Absolute path to the set directory. */
  readonly dirPath: string
  /** Pieces in this set, sorted by queue position then id. */
  readonly pieces: readonly QueuedPiece[]
}

/** Aggregate result of scanning plans across all sets. */
export interface QueueScanResult {
  /** Sets discovered, ordered by set identifier. */
  readonly sets: readonly SetQueue[]
  /** Total count of pieces across all sets. */
  readonly totalPieces: number
  /** Total count of pieces in `done` status. */
  readonly doneCount: number
  /** Total count of pieces currently in progress / pending. */
  readonly pendingCount: number
  /** Total count of pieces yet to be implemented or reviewed. */
  readonly todoCount: number
  /** Total count of pieces in blocked status. */
  readonly blockedCount: number
}

/**
 * Extract the primary verification or test command from the `## How to see it` section body.
 * Looks for fenced code blocks containing bash/sh/command lines.
 *
 * @param body - body text of the How to see it section.
 * @returns formatted command string or fallback placeholder.
 */
export function extractVerificationCommand(body: string): string {
  const codeBlockMatch = body.match(/```(?:bash|sh|cmd|console)?\s*\n([\s\S]*?)\n```/)
  if (codeBlockMatch && codeBlockMatch[1]) {
    const lines = codeBlockMatch[1]
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'))
    const firstCommand = lines[0]
    if (firstCommand) {
      return `\`${firstCommand}\``
    }
  }
  return '4-Gate Pipeline'
}

/**
 * Read the set title from `<setDir>/README.md`, falling back to Title Casing the directory name.
 *
 * @param setDir - absolute path to the set directory.
 * @param setName - directory name (e.g. `00-dev-loop`).
 * @returns extracted or derived title.
 */
export function readSetTitle(setDir: string, setName: string): string {
  const readmePath = join(setDir, 'README.md')
  if (existsSync(readmePath)) {
    try {
      const text = readFileSync(readmePath, 'utf8')
      const firstHeading = text.split('\n').find(line => line.startsWith('# '))
      if (firstHeading) {
        const titlePart = firstHeading.slice(2).trim()
        const dashMatch = titlePart.match(/^(?:Set\s+\d+\s*[—-]\s*)?(.*)$/i)
        if (dashMatch && dashMatch[1] && dashMatch[1].trim().length > 0) {
          return dashMatch[1].trim()
        }
        return titlePart
      }
    } catch {
      // Fall through to directory formatting
    }
  }

  // Derive title from directory name (e.g. "00-dev-loop" -> "Dev Loop")
  const stripped = setName.replace(/^\d+-/, '')
  return stripped
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Resolve the root plans directory, checking `plans/pieces` then `plans`.
 *
 * @param preferred - caller-supplied path or undefined.
 * @returns absolute path to the plans directory.
 */
export function resolvePlansDir(preferred?: string): string {
  if (preferred) return resolve(process.cwd(), preferred)
  const scriptDir = dirname(new URL(import.meta.url).pathname)
  const repoRoot = resolve(scriptDir, '..')
  const scriptPieces = resolve(repoRoot, 'plans/pieces')
  if (existsSync(scriptPieces)) return scriptPieces
  const scriptPlans = resolve(repoRoot, 'plans')
  if (existsSync(scriptPlans)) return scriptPlans
  const candidatePieces = resolve(process.cwd(), 'plans/pieces')
  if (existsSync(candidatePieces)) return candidatePieces
  const candidatePlans = resolve(process.cwd(), 'plans')
  if (existsSync(candidatePlans)) return candidatePlans
  return candidatePieces
}

/**
 * Scan all set directories and piece files under the given plans directory.
 *
 * @param plansDir - absolute path to plans directory.
 * @param queueFileDir - directory where the QUEUE.md will live, for relative links.
 * @returns aggregate scan result.
 */
export function scanPlansQueue(plansDir: string, queueFileDir: string = plansDir): QueueScanResult {
  if (!existsSync(plansDir)) {
    return { sets: [], totalPieces: 0, doneCount: 0, pendingCount: 0, todoCount: 0, blockedCount: 0 }
  }

  const entries = readdirSync(plansDir)
  const setDirs: { name: string; fullPath: string; id: string }[] = []

  for (const entry of entries) {
    if (entry === 'done' || entry === 'node_modules' || entry === '.git') continue
    const fullPath = join(plansDir, entry)
    if (!statSync(fullPath).isDirectory()) continue

    const match = entry.match(/^(\d+)/)
    const id = match?.[1] ?? entry
    setDirs.push({ name: entry, fullPath, id })
  }

  // Sort sets numerically or lexicographically
  setDirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

  const sets: SetQueue[] = []
  let totalPieces = 0
  let doneCount = 0
  let pendingCount = 0
  let todoCount = 0
  let blockedCount = 0

  for (const setDir of setDirs) {
    const candidateFiles: { filePath: string; isDone: boolean }[] = []

    // 1. Files in set root (todo / pending / blocked)
    for (const file of readdirSync(setDir.fullPath)) {
      if (isPieceFilename(file)) {
        candidateFiles.push({ filePath: join(setDir.fullPath, file), isDone: false })
      }
    }

    // 2. Files in set done/ subdirectory
    const doneDir = join(setDir.fullPath, 'done')
    if (existsSync(doneDir) && statSync(doneDir).isDirectory()) {
      for (const file of readdirSync(doneDir)) {
        if (isPieceFilename(file)) {
          candidateFiles.push({ filePath: join(doneDir, file), isDone: true })
        }
      }
    }

    const queuedPieces: QueuedPiece[] = []
    for (const { filePath } of candidateFiles) {
      const content = readFileSync(filePath, 'utf8')
      const result = tryParsePiece(filePath, content)
      if (!result.ok) continue

      const record = result.record
      totalPieces += 1

      if (record.status === 'done') doneCount += 1
      else if (record.status === 'pending') pendingCount += 1
      else if (record.status === 'blocked') blockedCount += 1
      else todoCount += 1

      const relPath = relative(queueFileDir, filePath).replaceAll('\\', '/')
      const verificationCommand = extractVerificationCommand(
        content.slice(content.indexOf('## How to see it')),
      )

      let queueStatus: string = record.status
      if (record.status === 'done') {
        queueStatus = 'done'
      } else if (record.status === 'pending') {
        queueStatus = 'pending'
      } else if (record.status === 'blocked') {
        queueStatus = 'blocked'
      } else {
        // In todo state, indicate whether pre-existing tests exist to review or if it requires green-field implementation
        queueStatus = verificationCommand !== '4-Gate Pipeline' ? 'to review & verify' : 'to implement'
      }

      queuedPieces.push({
        record,
        relativePath: relPath,
        verificationCommand,
        queueStatus,
      })
    }

    // Sort pieces by queue position ascending, then by ID
    queuedPieces.sort((a, b) => {
      if (a.record.queue !== b.record.queue) return a.record.queue - b.record.queue
      return a.record.id.localeCompare(b.record.id, undefined, { numeric: true })
    })

    if (queuedPieces.length > 0) {
      sets.push({
        setId: setDir.id,
        setName: setDir.name,
        setTitle: readSetTitle(setDir.fullPath, setDir.name),
        dirPath: setDir.fullPath,
        pieces: queuedPieces,
      })
    }
  }

  return {
    sets,
    totalPieces,
    doneCount,
    pendingCount,
    todoCount,
    blockedCount,
  }
}

/**
 * Format the queue scan result into canonical QUEUE.md markdown.
 *
 * @param scan - aggregate scan result.
 * @param options - optional overrides.
 * @returns complete, deterministic markdown document.
 */
export function formatQueueMarkdown(scan: QueueScanResult, options: QueueOptions = {}): string {
  const percent = scan.totalPieces > 0 ? Math.round((scan.doneCount / scan.totalPieces) * 100) : 0
  const title = options.projectTitle ?? 'Master Micro-Gate Queue & Progress Ledger'

  const lines: string[] = [
    `# ${title}`,
    '',
    'This ledger defines the sequential queue of micro-gates across all sets. Every gate is processed one-by-one by the Dev Loop Orchestrator in close collaboration with the human operator.',
    '',
    `- **Progress**: ${scan.doneCount} of ${scan.totalPieces} micro-gates completed (${percent}%) · **Status**: ${scan.doneCount === scan.totalPieces && scan.totalPieces > 0 ? 'Completed' : 'Active'}`,
    '- **To Review & Verify (Autonomous Work)**: The code already exists. The subagent extracts only the relevant files from the archive branch, runs the focused test suite, validates citations, and presents a PR and diff card for human inspection and sign-off.',
    '- **To Implement (New Work)**: The subagent follows the 4 Gates (Format, Red Baseline, Green Worktree, Mainline Transfer) to specify and build the feature from scratch.',
  ]

  for (const set of scan.sets) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push(`## Set ${set.setId} — ${set.setTitle}`)
    lines.push('')
    lines.push('| ID | Title | Lead Persona | Package | Status | Verification / Run Command |')
    lines.push('|---|---|---|---|---|---|')

    for (const piece of set.pieces) {
      const idCell = `\`${piece.record.id}\``
      const titleCell = `[${piece.record.title}](${piece.relativePath})`
      const leadCell = piece.record.lead ?? 'Lead Developer'
      const pkgCell = `\`${piece.record.pkg}\``
      const statusCell = piece.queueStatus
      const commandCell = piece.verificationCommand

      lines.push(`| ${idCell} | ${titleCell} | ${leadCell} | ${pkgCell} | ${statusCell} | ${commandCell} |`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Generate and write the master queue file, returning whether disk content was changed.
 *
 * @param options - configuration options.
 * @returns outcome with output path, content, and whether it was modified.
 */
export function generateQueue(options: QueueOptions = {}): { content: string; path: string; changed: boolean } {
  const plansDir = resolvePlansDir(options.plansDir)
  const outputPath = options.outputFile ? resolve(process.cwd(), options.outputFile) : join(plansDir, 'QUEUE.md')
  const queueFileDir = dirname(outputPath)

  const scan = scanPlansQueue(plansDir, queueFileDir)
  const content = formatQueueMarkdown(scan, options)

  let changed = true
  if (existsSync(outputPath)) {
    const existing = readFileSync(outputPath, 'utf8')
    if (existing === content) changed = false
  }

  if (changed) {
    writeFileSync(outputPath, content, 'utf8')
  }

  return { content, path: outputPath, changed }
}

/**
 * Check whether the existing queue file on disk matches the freshly generated queue.
 *
 * @param options - configuration options.
 * @returns freshness assertion.
 */
export function checkQueueFreshness(options: QueueOptions = {}): { fresh: boolean; message?: string } {
  const plansDir = resolvePlansDir(options.plansDir)
  const outputPath = options.outputFile ? resolve(process.cwd(), options.outputFile) : join(plansDir, 'QUEUE.md')
  const queueFileDir = dirname(outputPath)

  if (!existsSync(outputPath)) {
    return { fresh: false, message: `Queue file does not exist at ${outputPath}` }
  }

  const existing = readFileSync(outputPath, 'utf8')
  const scan = scanPlansQueue(plansDir, queueFileDir)
  const expected = formatQueueMarkdown(scan, options)

  if (existing === expected) {
    return { fresh: true }
  }

  return {
    fresh: false,
    message: `Queue file at ${outputPath} is out of date. Run 'pnpm exec tsx scripts/gen-queue.ts' to regenerate.`,
  }
}

// CLI entrypoint
if (process.argv[1] && (process.argv[1].endsWith('gen-queue.ts') || process.argv[1].endsWith('gen-queue.js'))) {
  const args = process.argv.slice(2)
  const isCheck = args.includes('--check')
  const plansDirArg = args.find(arg => !arg.startsWith('--'))

  const options: QueueOptions = {
    ...(plansDirArg !== undefined ? { plansDir: plansDirArg } : {}),
  }

  if (isCheck) {
    const result = checkQueueFreshness(options)
    if (!result.fresh) {
      console.error(`❌ ${result.message}`)
      process.exit(1)
    } else {
      console.log('✅ QUEUE.md is up to date.')
      process.exit(0)
    }
  } else {
    const { path, changed } = generateQueue(options)
    if (changed) {
      console.log(`✅ Updated ${path}`)
    } else {
      console.log(`✅ ${path} is already up to date.`)
    }
  }
}
