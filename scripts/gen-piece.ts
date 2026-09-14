/**
 * Micro-gate piece scaffolder for any project following the autonomous development loop.
 *
 * Given an ID and title, generates a conforming, 11-section micro-gate specification
 * validated against parsePiece and the repository axioms.
 *
 * Usage:
 *   pnpm exec tsx scripts/gen-piece.ts <id> <title> [options]
 *
 * Examples:
 *   pnpm exec tsx scripts/gen-piece.ts 01.01 "User Authentication Service" --set 01-auth --primitive Service --pkg auth
 *   pnpm exec tsx scripts/gen-piece.ts 02.01 "Button Component" --set 02-ui --primitive Component --pkg ui
 *
 * @module @deepseek-ai/dsh-dev-loop-directory/gen-piece
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { parsePiece } from './parse-piece.ts'
import { resolvePlansDir } from './gen-queue.ts'

/** Parameters for scaffolding one new micro-gate specification. */
export interface ScaffoldPieceOptions {
  /** Dotted micro-gate ID (e.g. `00.01`, `01.05a`). */
  readonly id: string
  /** Human-readable component title. */
  readonly title: string
  /** Target set folder name (e.g. `00-dev-loop`, `01-auth`). */
  readonly set?: string | undefined
  /** Lead persona or engineer champion. */
  readonly lead?: string | undefined
  /** Software primitive (e.g. `Service`, `Module`, `Component`, `CLI`). */
  readonly primitive?: string | undefined
  /** Owning package or module name. */
  readonly pkg?: string | undefined
  /** Dependencies (comma-separated IDs or `none`). */
  readonly dependsOn?: string | undefined
  /** Queue order number within the set. */
  readonly queue?: number | undefined
  /** Verification command to run in `## How to see it`. */
  readonly howToSee?: string | undefined
  /** Base plans directory; defaults to autodetected `plans/pieces` or `plans`. */
  readonly plansDir?: string | undefined
}

/**
 * Format a human-readable title into a URL/kebab-friendly slug.
 *
 * @param title - raw title string.
 * @returns lower-case hyphenated slug.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Convert a string to PascalCase for interface and type naming.
 *
 * @param str - raw input string.
 * @returns PascalCase identifier.
 */
export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .split(' ')
    .filter(word => word.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

/**
 * Generate conforming markdown specification content for a micro-gate.
 *
 * @param options - specification options.
 * @returns complete, valid markdown document adhering to PIECE-FORMAT.md.
 */
export function formatPieceContent(options: ScaffoldPieceOptions): string {
  const id = options.id.trim()
  const title = options.title.trim()
  const set = options.set ?? '00-core'
  const lead = options.lead ?? 'Lead Developer'
  const primitive = options.primitive ?? 'Service'
  const pkg = options.pkg ?? set.replace(/^\d+-/, '')
  const dependsOn = options.dependsOn ?? 'none'
  const queue = options.queue ?? 1
  const howToSee = options.howToSee ?? `pnpm exec vitest run tests/${slugify(title)}.spec.ts`
  const pascalName = toPascalCase(title)

  const lines = [
    `# ${id} — ${title}`,
    '',
    `**Set:** ${set} · **Queue:** ${queue} · **Depends on:** ${dependsOn}`,
    `**Lead Developer:** ${lead}`,
    '**Status:** todo',
    `**Primitive:** ${primitive} · **Package:** \`${pkg}\``,
    '',
    '## Summary',
    '',
    `Implements ${title} within \`${pkg}\`, establishing core behavior, typed contracts, and test verification.`,
    '',
    '### Human Decision Point: Option A vs Option B',
    '- **Option A (Active)**: Standard modular implementation with isolated unit and behavioral tests.',
    '- **Option B (Alternative)**: Monolithic coupling without explicit boundary contracts.',
    '',
    '## Behaviour',
    '',
    '- **Given** valid configuration and inputs **When** executed **Then** returns expected outcome matching specification',
    '',
    '## Architecture fit',
    '',
    `Implements the ${primitive} capability within \`${pkg}\`, ensuring clean separation of concerns.`,
    '',
    '## Contracts',
    '',
    '```typescript',
    `export interface ${pascalName}Config {`,
    '  readonly enabled: boolean',
    '}',
    '```',
    '',
    '## Dependencies',
    '',
    `- **Prerequisites:** ${dependsOn}`,
    '',
    '## References',
    '',
    '| Source | Role | Question it answered | Direct inspection or reported | How it was used |',
    '|---|---|---|---|---|',
    '| `README.md:1-10` | Lead Developer | Architectural boundaries and package responsibilities | direct inspection | Context definition |',
    '',
    '## How to see it',
    '',
    'Run:',
    '```bash',
    howToSee,
    '```',
    'Expected output:',
    '```',
    `✓ ${id} verification suite passing`,
    '```',
    '',
    '## Teach me while you build',
    '',
    `- **Background**: Architecture and design patterns for ${title}.`,
    `- **How it works here**: Implemented in \`${pkg}\` as a ${primitive}.`,
    '- **Why this approach**: Provides modularity, testability, and clear separation of concerns.',
    '- **Approaches considered**: Option A vs Option B.',
    '- **Prior art inspected**: Standard patterns in the codebase.',
    '- **What we get for free**: Framework capabilities and language primitives.',
    '- **What to notice**: Strict contract boundary and fail-closed error handling.',
    '- **Concepts to own**: Asymmetric capability distribution and clean interfaces.',
    '- **Interview angle**: Why is modular decomposition preferred over monolithic coupling?',
    '- **Decisions you can now make alone**: Safe extension of internal contracts without leaking implementation details.',
    '- **What you should learn from this**: Reliable software emerges from verified micro-gates and explicit invariants.',
    '',
    '## Resources and proof',
    '',
    '| Claim | Citation | How established | Checked against |',
    '|---|---|---|---|',
    '| Contract specification conforms to project architecture | `README.md:1-10` | direct inspection | Current checkout |',
    '',
    '## Reuse capture',
    '',
    `Reuse candidate: ${title} Pattern`,
    `What it does: Implements reusable ${primitive} contracts.`,
    `Current usage: In \`${pkg}\`.`,
    'Potential reuse: Across related modules.',
    'What would need to become generic: Domain-specific parameters.',
    `Evidence: \`${pkg}\``,
    'Confidence: high',
    '',
    '## Acceptance',
    '',
    '- [ ] Core interfaces and types defined in contracts.',
    '- [ ] Behavioral tests passing.',
    '- [ ] Integration with owning package verified.',
    '- Next Gate: Proceed to next verified milestone.',
    '',
  ]

  return lines.join('\n')
}

/**
 * Scaffold a piece file onto disk, verifying it parses without error.
 *
 * @param options - scaffolding options.
 * @returns path to created file.
 */
export function scaffoldPiece(options: ScaffoldPieceOptions): string {
  const plansDir = resolvePlansDir(options.plansDir)
  const set = options.set ?? '00-core'
  const setDir = join(plansDir, set)
  if (!existsSync(setDir)) {
    mkdirSync(setDir, { recursive: true })
  }

  const slug = slugify(options.title)
  const filename = `${options.id}-${slug}.md`
  const filePath = join(setDir, filename)

  const content = formatPieceContent(options)

  // Pre-validate with parsePiece to guarantee compliance
  parsePiece(filePath, content)

  writeFileSync(filePath, content, 'utf8')
  return filePath
}

// CLI entrypoint
if (process.argv[1] && (process.argv[1].endsWith('gen-piece.ts') || process.argv[1].endsWith('gen-piece.js'))) {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.log('Usage: pnpm exec tsx scripts/gen-piece.ts <id> <title> [--set <set>] [--lead <lead>] [--primitive <prim>] [--pkg <pkg>]')
    process.exit(1)
  }

  const id = args[0] ?? ''
  const title = args[1] ?? ''

  let set: string | undefined
  let lead: string | undefined
  let primitive: string | undefined
  let pkg: string | undefined
  let dependsOn: string | undefined
  let queue: number | undefined
  let howToSee: string | undefined

  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--set' && args[i + 1]) set = args[++i]
    else if (args[i] === '--lead' && args[i + 1]) lead = args[++i]
    else if (args[i] === '--primitive' && args[i + 1]) primitive = args[++i]
    else if (args[i] === '--pkg' && args[i + 1]) pkg = args[++i]
    else if (args[i] === '--depends' && args[i + 1]) dependsOn = args[++i]
    else if (args[i] === '--queue' && args[i + 1]) queue = Number(args[++i])
    else if (args[i] === '--how-to-see' && args[i + 1]) howToSee = args[++i]
  }

  try {
    const filePath = scaffoldPiece({
      id,
      title,
      set,
      lead,
      primitive,
      pkg,
      dependsOn,
      queue,
      howToSee,
    })
    console.log(`✅ Scaffolded conforming piece at ${filePath}`)
  } catch (error) {
    console.error('❌ Failed to scaffold piece:', error)
    process.exit(1)
  }
}
