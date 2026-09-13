/**
 * Specification for the development-loop piece directory: the pure piece-file
 * grammar (`parsePiece`, `isPieceFilename`) and the `ctx.devLoopDirectory`
 * Service Provider that reads the corpus through the `fs` seam.
 *
 * Piece text is built inline by {@link buildPiece} so each case reads as the
 * one deviation it asserts; the real `plans/pieces` corpus is scanned once
 * through a local filesystem backend rooted at the repository.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import * as fsLocalPlugin from '@deepseek-ai/dsh-fs-local'
import * as directoryPlugin from '@deepseek-ai/dsh-dev-loop-directory'
import DevLoopDirectory, {
  DONE_DIRECTORY,
  DuplicatePieceError,
  HARNESS_PRIMITIVES,
  PIECE_MAX_LINES,
  PIECE_ROOT,
  PieceNotFoundError,
  PieceParseError,
  SetNotFoundError,
  isPieceFilename,
  parsePiece,
  type Config,
  type PieceParseOptions,
  type PieceRecord,
  type SetScan,
} from '@deepseek-ai/dsh-dev-loop-directory'

/** Repository root: this file sits at `packages/dev-loop/directory/tests/`. */
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** Path reported back in findings; `parsePiece` never reads it. */
const PIECE_PATH = 'plans/pieces/00-dev-loop/00.01-piece-directory.md'

/** The canonical `##` section order every piece file follows. */
const CANONICAL_SECTIONS = [
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
] as const

/** Sections whose absence rejects the file, per the blocker axioms in `plans/AGENTS.md`. */
const BLOCKER_SECTIONS = CANONICAL_SECTIONS.filter(section => section !== 'Reuse capture')

const DEFAULT_BODIES: Readonly<Record<string, readonly string[]>> = {
  Summary: [
    'Discovers, parses, and validates piece specification markdown files.',
    'It enforces the line ceiling and the canonical section order.',
  ],
  Behaviour: [
    '- **Given** a valid piece file **When** the directory parses it **Then** it returns a validated record',
    '- **Given** an oversized piece file **When** validation runs **Then** parsing fails with PIECE_SIZE_EXCEEDED',
  ],
  'Harness fit': ['A Service Provider mounted on the host plane as `ctx.devLoopDirectory`.'],
  Contracts: ['```text', 'validate(filePath, content): PieceRecord', '```'],
  Dependencies: ['None among pieces; it consumes the shipped `fs` service.'],
  References: ['| Source | Role | Question | Direct | Use |', '|---|---|---|---|---|'],
  'Resources and proof': [
    '| Claim | Citation | How established | Checked |',
    '|---|---|---|---|',
    '| The `fs` seam exposes `listDir` | `packages/fs/fs/src/index.ts` | Direct inspection | 2026-09-12 |',
    '',
    '- `docs/cordis-primer.md` — how a Service reaches `ctx`.',
  ],
  'How to see it': ['```bash', 'pnpm vitest run packages/dev-loop/directory/tests/directory.spec.ts', '```'],
  'Teach me while you build': ['- **Background** — a Cordis Service publishes one instance under one context key.'],
  'Reuse capture': ['- **Reuse candidate:** ordered-section markdown validator · medium confidence'],
  Acceptance: ['1. Unit tests pass.'],
}

interface PieceOptions {
  /** Dotted id written into the title line. */
  readonly id?: string
  /** Human title written after the id. */
  readonly title?: string
  /** Replaces the whole `# ...` title line. */
  readonly titleLine?: string
  readonly set?: string
  /** Queue value written verbatim, so a malformed value can be asserted. */
  readonly queue?: string
  readonly dependsOn?: string
  readonly status?: string
  readonly primitive?: string
  readonly pkg?: string
  /** Replaces the three metadata lines wholesale. */
  readonly headerLines?: readonly string[]
  /** Section names to leave out. */
  readonly omit?: readonly string[]
  /** Section order to emit instead of the canonical one. */
  readonly order?: readonly string[]
  /** Per-section body override. */
  readonly bodies?: Readonly<Record<string, readonly string[]>>
  /** Pad the file with filler lines until it is exactly this many lines long. */
  readonly lines?: number
  /** Emit the file without its final newline. */
  readonly noTrailingNewline?: boolean
}

/** Build one piece markdown file; every option expresses one deviation from a compliant piece. */
function buildPiece(options: PieceOptions = {}): string {
  const id = options.id ?? '00.01'
  const lines: string[] = [
    options.titleLine ?? `# ${id} — ${options.title ?? 'Piece Directory and Specification Parser'}`,
    '',
    ...(options.headerLines ?? [
      `**Set:** ${options.set ?? '00-dev-loop'} · **Queue:** ${options.queue ?? '1'} · **Depends on:** ${options.dependsOn ?? 'none'}`,
      `**Status:** ${options.status ?? 'todo'}`,
      `**Harness primitive:** ${options.primitive ?? 'Service Provider'} · **Package:** \`${options.pkg ?? '@deepseek-ai/dsh-dev-loop-directory'}\``,
    ]),
  ]
  for (const section of options.order ?? CANONICAL_SECTIONS) {
    if (options.omit?.includes(section) === true) continue
    lines.push('', `## ${section}`, '', ...(options.bodies?.[section] ?? DEFAULT_BODIES[section] ?? ['Body.']))
  }
  const target = options.lines
  if (target !== undefined) {
    if (lines.length > target) throw new Error(`piece already has ${lines.length} lines, cannot shrink to ${target}`)
    while (lines.length < target) lines.push(`- filler line ${lines.length}`)
  }
  return options.noTrailingNewline === true ? lines.join('\n') : `${lines.join('\n')}\n`
}

/** Physical line count as `wc -l` reports it for a newline-terminated file. */
function countLines(content: string): number {
  const parts = content.split('\n')
  return content.endsWith('\n') ? parts.length - 1 : parts.length
}

/** Parse expecting rejection, returning the `PieceParseError` for assertions. */
function parseFailure(content: string, options?: PieceParseOptions): PieceParseError {
  try {
    parsePiece(PIECE_PATH, content, options)
  } catch (error) {
    if (error instanceof PieceParseError) return error
    throw error
  }
  throw new Error('expected parsePiece to reject the piece')
}

/** Read one set under the amended `scanSet` contract. */
async function scanSetOf(directory: DevLoopDirectory, setName: string, signal?: AbortSignal): Promise<SetScan> {
  return await directory.scanSet(setName, signal)
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  const pending = cleanups.splice(0, cleanups.length).reverse()
  for (const cleanup of pending) await cleanup()
})

interface MountedDirectory {
  readonly ctx: Context
  readonly directory: DevLoopDirectory
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly root: string
}

/**
 * Write `files` (paths relative to the temp root) and mount a local filesystem
 * backend plus the directory service over it. `config` is passed through
 * verbatim, so a case can observe the schema defaults. Every temp path and
 * fiber is torn down by the shared `afterEach`.
 */
async function mountDirectory(
  files: Readonly<Record<string, string>>,
  config?: Config,
): Promise<MountedDirectory> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-directory-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, content)
  }
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root })
  const fiber = config === undefined ? await ctx.plugin(DevLoopDirectory) : await ctx.plugin(DevLoopDirectory, config)
  cleanups.push(async () => { await fiber.dispose() })
  const directory = ctx.get('devLoopDirectory')
  if (directory === undefined) throw new Error('devLoopDirectory service missing after mount')
  return { ctx, directory, fiber, root }
}

/** Mount over the `pieces/` root the fixtures below write into. */
function mountPieces(files: Readonly<Record<string, string>>): Promise<MountedDirectory> {
  return mountDirectory(files, { root: 'pieces' })
}

/** A queue-ordered set fixture: filename order deliberately disagrees with queue order. */
function orderedSetFixture(): Record<string, string> {
  return {
    'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '3' }),
    'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', queue: '1' }),
    'pieces/00-dev-loop/00.03-gamma-piece.md': buildPiece({ id: '00.03', queue: '2' }),
  }
}

describe('piece parsing', () => {
  it('returns a validated record carrying header metadata, summary, scenarios and no warnings', () => {
    const content = buildPiece()
    const record = parsePiece(PIECE_PATH, content)

    expect(record.id).toBe('00.01')
    expect(record.title).toBe('Piece Directory and Specification Parser')
    expect(record.set).toBe('00-dev-loop')
    expect(record.queue).toBe(1)
    expect(record.dependsOn).toEqual([])
    expect(record.status).toBe('todo')
    expect(record.primitive).toBe('Service Provider')
    expect(record.pkg).toBe('@deepseek-ai/dsh-dev-loop-directory')
    expect(record.path).toBe(PIECE_PATH)
    expect(record.lineCount).toBe(countLines(content))
    expect(record.summary).toContain('Discovers, parses, and validates piece specification markdown files.')
    expect(record.scenarios).toHaveLength(2)
    expect(record.warnings).toEqual([])
  })

  it('reads a comma-separated Depends on list as piece ids and `none` as an empty list', () => {
    expect(parsePiece(PIECE_PATH, buildPiece({ dependsOn: '00.01, 00.02' })).dependsOn).toEqual(['00.01', '00.02'])
    expect(parsePiece(PIECE_PATH, buildPiece({ dependsOn: 'none' })).dependsOn).toEqual([])
  })

  it('accepts every piece status in the closed vocabulary', () => {
    for (const status of ['todo', 'pending', 'done', 'blocked'] as const) {
      expect(parsePiece(PIECE_PATH, buildPiece({ status })).status).toBe(status)
    }
  })

  it('accepts every Harness primitive in the closed vocabulary', () => {
    for (const primitive of HARNESS_PRIMITIVES) {
      expect(parsePiece(PIECE_PATH, buildPiece({ primitive })).primitive).toBe(primitive)
    }
  })
})

describe('piece size ceiling', () => {
  it('accepts a file of exactly the default ceiling', () => {
    const content = buildPiece({ lines: PIECE_MAX_LINES })

    // Derived from the exported constant: the ceiling tracks `R-piece-size`, which has
    // moved twice, and a restated literal here would silently outlive the next move.
    expect(countLines(content)).toBe(PIECE_MAX_LINES)
    expect(parsePiece(PIECE_PATH, content).lineCount).toBe(PIECE_MAX_LINES)
  })

  it('rejects a file one line over the default ceiling with PIECE_SIZE_EXCEEDED', () => {
    const error = parseFailure(buildPiece({ lines: PIECE_MAX_LINES + 1 }))

    expect(error).toBeInstanceOf(PieceParseError)
    expect(error.code).toBe('PIECE_SIZE_EXCEEDED')
    expect(error.path).toBe(PIECE_PATH)
    expect(error.message).toContain(String(PIECE_MAX_LINES + 1))
    expect(error.message).toContain(String(PIECE_MAX_LINES))
    expect(error.findings.some(finding => finding.code === 'PIECE_SIZE_EXCEEDED' && finding.severity === 'blocker')).toBe(true)
  })

  it('counts a trailing newline as a line terminator rather than an extra line', () => {
    const terminated = buildPiece({ lines: 120 })
    const unterminated = buildPiece({ lines: 120, noTrailingNewline: true })

    expect(parsePiece(PIECE_PATH, terminated).lineCount).toBe(120)
    expect(parsePiece(PIECE_PATH, unterminated).lineCount).toBe(120)
  })

  it('measures against a maxLines override instead of the default ceiling', () => {
    const options: PieceParseOptions = { maxLines: 80 }

    expect(parsePiece(PIECE_PATH, buildPiece({ lines: 80 }), options).lineCount).toBe(80)
    expect(parseFailure(buildPiece({ lines: 81 }), options).code).toBe('PIECE_SIZE_EXCEEDED')
    expect(parsePiece(PIECE_PATH, buildPiece({ lines: 81 })).lineCount).toBe(81)
  })
})

describe('section order and severity', () => {
  it('rejects a piece missing `## Behaviour` and names the missing section', () => {
    const error = parseFailure(buildPiece({ omit: ['Behaviour'] }))

    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    expect(error.message).toContain('Behaviour')
  })

  it('rejects a piece missing `## How to see it` and names the missing section', () => {
    const error = parseFailure(buildPiece({ omit: ['How to see it'] }))

    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    expect(error.message).toContain('How to see it')
  })

  it('rejects a piece missing `## Teach me while you build` and names the missing section', () => {
    const error = parseFailure(buildPiece({ omit: ['Teach me while you build'] }))

    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    expect(error.message).toContain('Teach me while you build')
  })

  it('rejects a piece missing `## Resources and proof` and names the missing section', () => {
    const error = parseFailure(buildPiece({ omit: ['Resources and proof'] }))

    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    expect(error.message).toContain('Resources and proof')
  })

  it('rejects every blocker-required section that is absent, naming it', () => {
    for (const section of BLOCKER_SECTIONS) {
      const error = parseFailure(buildPiece({ omit: [section] }))
      expect(error.code, `omitting ## ${section}`).toBe('MISSING_REQUIRED_SECTION')
      expect(error.message, `omitting ## ${section}`).toContain(section)
    }
  })

  it('names the canonically-later section when two sections are transposed', () => {
    const swapped = CANONICAL_SECTIONS.map(section =>
      section === 'Harness fit' ? 'Contracts' : section === 'Contracts' ? 'Harness fit' : section)
    const error = parseFailure(buildPiece({ order: swapped }))

    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    // `Contracts` is canonically later than `Harness fit` and appeared before it.
    expect(error.message).toContain('Contracts')
  })

  it('reports one finding per descending step, so a double transposition yields two', () => {
    const swap = (order: readonly string[], left: string, right: string): string[] =>
      order.map(section => section === left ? right : section === right ? left : section)
    const doubled = swap(swap(CANONICAL_SECTIONS, 'Harness fit', 'Contracts'), 'References', 'How to see it')
    const error = parseFailure(buildPiece({ order: doubled }))

    expect(error.findings).toHaveLength(2)
    expect(error.findings.every(finding => finding.code === 'MISSING_REQUIRED_SECTION')).toBe(true)
    expect(error.message).toContain('Contracts')
    expect(error.message).toContain('How to see it')
  })

  it('reports one finding for a rotation, which descends only once', () => {
    const rotated = CANONICAL_SECTIONS.flatMap(section =>
      section === 'Harness fit' ? [] : section === 'Dependencies' ? [section, 'Harness fit'] : [section])
    const error = parseFailure(buildPiece({ order: rotated }))

    expect(error.findings).toHaveLength(1)
    expect(error.findings[0]?.code).toBe('MISSING_REQUIRED_SECTION')
  })

  it('accepts a piece lacking only `## Reuse capture` and records exactly one warning', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({ omit: ['Reuse capture'] }))

    expect(record.warnings).toHaveLength(1)
    expect(record.warnings[0]?.code).toBe('MISSING_RECOMMENDED_SECTION')
    expect(record.warnings[0]?.severity).toBe('warning')
    expect(record.warnings[0]?.message).toContain('Reuse capture')
    expect(record.status).toBe('todo')
  })

  it('treats a `##` line inside a fenced code block as content rather than a heading', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Contracts: [
          'The piece template this parser accepts:',
          '',
          '```markdown',
          '## Acceptance',
          '## Summary',
          '## Behaviour',
          '```',
        ],
      },
    }))

    expect(record.warnings).toEqual([])
    expect(record.id).toBe('00.01')
  })

  it('closes a fence whose marker carries up to three leading spaces', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Contracts: ['   ```markdown', '## Acceptance', '   ```', 'Back to ordinary content.'],
      },
    }))

    // An unrecognised closer would leave the fence open to end of file, reporting
    // every later section as absent.
    expect(record.warnings).toEqual([])
    expect(record.id).toBe('00.01')
  })

  it('treats a marker indented four spaces as code content rather than a fence', () => {
    const error = parseFailure(buildPiece({
      bodies: {
        Contracts: ['    ```markdown', '## Acceptance', '    ```'],
      },
    }))

    // Neither line opens a fence, so `## Acceptance` is a real heading in the wrong place.
    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    expect(error.findings).toHaveLength(1)
    expect(error.message).toContain('Acceptance')
  })

  it('treats a `##` line inside a tilde-fenced code block as content rather than a heading', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Contracts: ['~~~markdown', '## Acceptance', '## Summary', '~~~'],
      },
    }))

    expect(record.warnings).toEqual([])
    expect(record.id).toBe('00.01')
  })

  it('does not let a tilde-fenced `## Reuse capture` line satisfy the recommended section', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      omit: ['Reuse capture'],
      bodies: {
        Contracts: ['~~~markdown', '## Reuse capture', '~~~'],
      },
    }))

    expect(record.warnings).toHaveLength(1)
    expect(record.warnings[0]?.code).toBe('MISSING_RECOMMENDED_SECTION')
  })

  it('closes a fence on a longer run of the same character, as CommonMark allows', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Contracts: ['```markdown', '## Acceptance', '`````', 'Back to ordinary content.'],
      },
    }))

    expect(record.warnings).toEqual([])
    expect(record.id).toBe('00.01')
  })

  it('runs an unclosed fence to the end of the file, so later sections are content', () => {
    const error = parseFailure(buildPiece({
      bodies: {
        Contracts: ['```typescript', 'export class DevLoopDirectory extends Service {}'],
      },
    }))

    expect(error.code).toBe('MISSING_REQUIRED_SECTION')
    expect(error.message).toContain('Dependencies')
  })

  it('does not let a fenced `## Reuse capture` line satisfy the recommended section', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      omit: ['Reuse capture'],
      bodies: {
        Contracts: ['```markdown', '## Reuse capture', '```'],
      },
    }))

    expect(record.warnings).toHaveLength(1)
    expect(record.warnings[0]?.code).toBe('MISSING_RECOMMENDED_SECTION')
  })

  it('ignores a `##` heading that the canonical list does not name', () => {
    const withExtras = [
      ...CANONICAL_SECTIONS.flatMap(section => section === 'References' ? ['Glossary', section] : [section]),
      'Appendix',
    ]
    const record = parsePiece(PIECE_PATH, buildPiece({ order: withExtras }))

    expect(record.warnings).toEqual([])
    expect(record.status).toBe('todo')
  })
})

describe('closed vocabularies', () => {
  it('rejects an unapproved Harness primitive and lists the accepted vocabulary', () => {
    const error = parseFailure(buildPiece({ primitive: 'Plugin' }))

    expect(error.code).toBe('INVALID_HARNESS_PRIMITIVE')
    expect(error.message).toContain('Plugin')
    expect(error.message).toContain('Service Provider')
  })

  it('accepts only the primitives a `primitives` override names', () => {
    const options: PieceParseOptions = { primitives: ['Bespoke Primitive'] }

    expect(parsePiece(PIECE_PATH, buildPiece({ primitive: 'Bespoke Primitive' }), options).primitive).toBe('Bespoke Primitive')
    expect(parseFailure(buildPiece({ primitive: 'Service Provider' }), options).code).toBe('INVALID_HARNESS_PRIMITIVE')
  })

  it('rejects a status outside the four lifecycle states', () => {
    const error = parseFailure(buildPiece({ status: 'wibble' }))

    expect(error.code).toBe('INVALID_PIECE_STATUS')
    expect(error.message).toContain('wibble')
  })
})

describe('header grammar', () => {
  it('rejects a header missing the Status label', () => {
    const error = parseFailure(buildPiece({
      headerLines: [
        '**Set:** 00-dev-loop · **Queue:** 1 · **Depends on:** none',
        '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-directory`',
      ],
    }))

    expect(error.code).toBe('MALFORMED_PIECE_HEADER')
  })

  it('reports a missing Status label once, without also judging its absent value', () => {
    const error = parseFailure(buildPiece({
      headerLines: [
        '**Set:** 00-dev-loop · **Queue:** 1 · **Depends on:** none',
        '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-directory`',
      ],
    }))

    expect(error.findings).toHaveLength(1)
    expect(error.findings[0]?.code).toBe('MALFORMED_PIECE_HEADER')
    expect(error.findings.some(finding => finding.code === 'INVALID_PIECE_STATUS')).toBe(false)
  })

  it('reports a missing Harness primitive label once, without dumping the vocabulary', () => {
    const error = parseFailure(buildPiece({
      headerLines: [
        '**Set:** 00-dev-loop · **Queue:** 1 · **Depends on:** none',
        '**Status:** todo',
        '**Package:** `@deepseek-ai/dsh-dev-loop-directory`',
      ],
    }))

    expect(error.findings).toHaveLength(1)
    expect(error.findings[0]?.code).toBe('MALFORMED_PIECE_HEADER')
    // An absent label is a header defect, not a vocabulary violation of the empty string.
    expect(error.message).not.toContain('client UI extension')
  })

  it('rejects a header missing the Package label', () => {
    const error = parseFailure(buildPiece({
      headerLines: [
        '**Set:** 00-dev-loop · **Queue:** 1 · **Depends on:** none',
        '**Status:** todo',
        '**Harness primitive:** Service Provider',
      ],
    }))

    expect(error.code).toBe('MALFORMED_PIECE_HEADER')
  })

  it('rejects a header missing the Set label', () => {
    const error = parseFailure(buildPiece({
      headerLines: [
        '**Queue:** 1 · **Depends on:** none',
        '**Status:** todo',
        '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-directory`',
      ],
    }))

    expect(error.code).toBe('MALFORMED_PIECE_HEADER')
  })

  it('rejects a title line that declares no dotted piece id', () => {
    const error = parseFailure(buildPiece({ titleLine: '# Piece Directory and Specification Parser' }))

    expect(error.code).toBe('MALFORMED_PIECE_HEADER')
  })

  it('accepts a backticked Depends on list as piece ids', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({ dependsOn: '`00.01`, `00.02`' }))

    expect(record.dependsOn).toEqual(['00.01', '00.02'])
  })

  it('rejects a Depends on entry that is not a piece id', () => {
    // The real form that motivated this: `06-verification/06.20` writes a range.
    const error = parseFailure(buildPiece({ dependsOn: '`06.01` through `06.19`' }))

    expect(error.code).toBe('MALFORMED_PIECE_HEADER')
    expect(error.findings).toHaveLength(1)
    expect(error.message).toContain('06.01 through 06.19')
  })

  it('reports one finding per malformed Depends on entry', () => {
    const error = parseFailure(buildPiece({ dependsOn: 'first, 00.02, later' }))

    expect(error.findings).toHaveLength(2)
    expect(error.findings.every(finding => finding.code === 'MALFORMED_PIECE_HEADER')).toBe(true)
    expect(error.message).toContain('first')
    expect(error.message).toContain('later')
  })

  it('rejects an empty Depends on value, which declares neither ids nor `none`', () => {
    const error = parseFailure(buildPiece({ dependsOn: '' }))

    expect(error.code).toBe('MALFORMED_PIECE_HEADER')
    expect(error.findings).toHaveLength(1)
  })

  it('ignores a bold header segment that declares no label', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      headerLines: [
        '**A bold aside with no colon**',
        '**Set:** 00-dev-loop · **Queue:** 1 · **Depends on:** none',
        '**Status:** todo',
        '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-directory`',
      ],
    }))

    expect(record.set).toBe('00-dev-loop')
    expect(record.warnings).toEqual([])
  })

  it('rejects a queue position that is not a positive integer', () => {
    for (const queue of ['0', '-1', '1.5', 'first', '']) {
      expect(parseFailure(buildPiece({ queue })).code, `queue "${queue}"`).toBe('MALFORMED_PIECE_HEADER')
    }
  })
})

describe('piece filenames', () => {
  it('accepts `NN.MM-<kebab-slug>.md`', () => {
    expect(isPieceFilename('00.01-piece-directory.md')).toBe(true)
    expect(isPieceFilename('12.09-a.md')).toBe(true)
  })

  it('rejects names that are not piece specifications', () => {
    for (const name of [
      'PIECE-FORMAT.md',
      'README.md',
      '0.1-x.md',
      '00.01-Piece-Directory.md',
      '00.01-piece--directory.md',
      '00.01.md',
      '00.01-piece-directory.markdown',
      '00.01-piece-directory',
      'done',
    ]) {
      expect(isPieceFilename(name), name).toBe(false)
    }
  })
})

describe('scenario extraction', () => {
  it('returns the Given/When/Then parts of every Behaviour bullet in document order', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Behaviour: [
          '- **Given** a valid piece **When** the directory parses it **Then** it returns a record',
          '- **Given** an oversized piece **When** validation runs **Then** it fails with PIECE_SIZE_EXCEEDED',
          '- **Given** an unknown id **When** getPiece is called **Then** it rejects with PIECE_NOT_FOUND',
        ],
      },
    }))

    expect(record.scenarios).toEqual([
      { given: 'a valid piece', when: 'the directory parses it', then: 'it returns a record' },
      { given: 'an oversized piece', when: 'validation runs', then: 'it fails with PIECE_SIZE_EXCEEDED' },
      { given: 'an unknown id', when: 'getPiece is called', then: 'it rejects with PIECE_NOT_FOUND' },
    ])
  })

  it('ignores Behaviour lines that are not Given/When/Then bullets', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Behaviour: [
          'Given / When / Then scenarios follow.',
          '',
          '- a plain bullet carrying no markers',
          '- **Given** a half-written scenario **When** the author stops',
          '- **Given** a complete scenario **When** validation runs **Then** it is extracted',
        ],
      },
    }))

    expect(record.scenarios).toEqual([
      { given: 'a complete scenario', when: 'validation runs', then: 'it is extracted' },
    ])
  })

  it('ignores a bullet whose Then marker precedes its When marker', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({
      bodies: {
        Behaviour: [
          '- **Given** a piece **Then** an outcome **When** an action',
          '- **Given** a complete scenario **When** validation runs **Then** it is extracted',
        ],
      },
    }))

    expect(record.scenarios).toEqual([
      { given: 'a complete scenario', when: 'validation runs', then: 'it is extracted' },
    ])
  })

  it('accepts a Behaviour section that carries no scenario bullets at all', () => {
    const record = parsePiece(PIECE_PATH, buildPiece({ bodies: { Behaviour: ['Scenarios are still being written.'] } }))

    expect(record.scenarios).toEqual([])
    expect(record.warnings).toEqual([])
  })
})

describe('scanning a set directory', () => {
  it('returns the set ordered by queue position rather than by filename', async () => {
    const { directory } = await mountPieces(orderedSetFixture())

    const { pieces: records } = await scanSetOf(directory, '00-dev-loop')

    expect(records.map(record => record.id)).toEqual(['00.02', '00.03', '00.01'])
    expect(records.map(record => record.queue)).toEqual([1, 2, 3])
  })

  it('merges the set directory and its done/ subdirectory into one queue-ordered list', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '3' }),
      'pieces/00-dev-loop/00.03-gamma-piece.md': buildPiece({ id: '00.03', queue: '1' }),
      [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.02-beta-piece.md`]: buildPiece({ id: '00.02', queue: '2', status: 'done' }),
    })

    const { pieces: records } = await scanSetOf(directory, '00-dev-loop')

    expect(records.map(record => record.id)).toEqual(['00.03', '00.02', '00.01'])
    expect(records.map(record => record.status)).toEqual(['todo', 'done', 'todo'])
    expect(records[1]?.path).toContain(DONE_DIRECTORY)
  })

  it('scans a set that has no done/ subdirectory without failing', async () => {
    const { directory } = await mountPieces(orderedSetFixture())

    expect((await scanSetOf(directory, '00-dev-loop')).pieces).toHaveLength(3)
  })

  it('ignores directory entries that are not piece specification files', async () => {
    const { directory } = await mountPieces({
      ...orderedSetFixture(),
      'pieces/00-dev-loop/README.md': '# Set 00\n',
      'pieces/00-dev-loop/notes.txt': 'scratch\n',
      'pieces/00-dev-loop/PIECE-FORMAT.md': '# Piece format\n',
      'pieces/00-dev-loop/drafts/00.09-draft-piece.md': buildPiece({ id: '00.09', queue: '9' }),
    })

    const { pieces: records } = await scanSetOf(directory, '00-dev-loop')

    expect(records.map(record => record.id)).toEqual(['00.02', '00.03', '00.01'])
  })

  it('orders pieces sharing a queue position by id', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.05-epsilon-piece.md': buildPiece({ id: '00.05', queue: '2' }),
      'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', queue: '2' }),
    })

    const { pieces: records } = await scanSetOf(directory, '00-dev-loop')

    expect(records.map(record => record.id)).toEqual(['00.02', '00.05'])
  })

  it('stops on an already-aborted signal instead of reading the set', async () => {
    const { directory } = await mountPieces(orderedSetFixture())
    const controller = new AbortController()
    controller.abort()

    await expect(scanSetOf(directory, '00-dev-loop', controller.signal)).rejects.toThrow()
    await expect(directory.getPiece('00.02', controller.signal)).rejects.toThrow()
  })

  it('returns the valid pieces of a set and reports the malformed one as a rejection', async () => {
    const { directory } = await mountPieces({
      ...orderedSetFixture(),
      'pieces/00-dev-loop/00.04-delta-piece.md': buildPiece({ id: '00.04', queue: '4', primitive: 'Plugin' }),
    })

    const scan = await scanSetOf(directory, '00-dev-loop')

    expect(scan.pieces.map(record => record.id)).toEqual(['00.02', '00.03', '00.01'])
    expect(scan.rejected).toHaveLength(1)
    expect(scan.rejected[0]?.path).toContain('00.04-delta-piece.md')
    expect(scan.rejected[0]?.code).toBe('INVALID_HARNESS_PRIMITIVE')
    expect(scan.rejected[0]?.findings.some(finding => finding.severity === 'blocker')).toBe(true)
  })

  it('reports every malformed file of a set, each with its own code', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
      'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', queue: '2', primitive: 'Plugin' }),
      'pieces/00-dev-loop/00.03-gamma-piece.md': buildPiece({ id: '00.03', queue: '3', status: 'wibble' }),
      [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.04-delta-piece.md`]: buildPiece({ id: '00.04', queue: '4', omit: ['Behaviour'] }),
    })

    const scan = await scanSetOf(directory, '00-dev-loop')

    expect(scan.pieces.map(record => record.id)).toEqual(['00.01'])
    expect([...scan.rejected].map(rejection => rejection.code).sort()).toEqual(
      ['INVALID_HARNESS_PRIMITIVE', 'INVALID_PIECE_STATUS', 'MISSING_REQUIRED_SECTION'])
    expect(scan.rejected.some(rejection => rejection.path.includes(DONE_DIRECTORY))).toBe(true)
    expect(scan.rejected.every(rejection => rejection.findings.length > 0)).toBe(true)
  })

  it('returns no pieces and one rejection per file when every file of a set is malformed', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1', primitive: 'Plugin' }),
      'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', queue: '2', primitive: 'Plugin' }),
    })

    const scan = await scanSetOf(directory, '00-dev-loop')

    expect(scan.pieces).toEqual([])
    expect(scan.rejected).toHaveLength(2)
    expect([...scan.rejected].map(rejection => rejection.path.split('/').at(-1)).sort())
      .toEqual(['00.01-alpha-piece.md', '00.02-beta-piece.md'])
  })

  it('rejects an unmatched set name with SET_NOT_FOUND rather than an empty list', async () => {
    const { directory } = await mountPieces(orderedSetFixture())

    await expect(scanSetOf(directory, '00-dev-lop')).rejects.toBeInstanceOf(SetNotFoundError)
    await expect(scanSetOf(directory, '00-dev-lop')).rejects.toMatchObject({
      code: 'SET_NOT_FOUND',
      setName: '00-dev-lop',
    })
  })

  it('scans a set whose pieces have all moved into done/', async () => {
    const { directory } = await mountPieces({
      [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.01-alpha-piece.md`]: buildPiece({ id: '00.01', queue: '1', status: 'done' }),
      [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.02-beta-piece.md`]: buildPiece({ id: '00.02', queue: '2', status: 'done' }),
    })

    expect((await scanSetOf(directory, '00-dev-loop')).pieces.map(record => record.id)).toEqual(['00.01', '00.02'])
    expect(await directory.getQueueCandidates('00-dev-loop')).toEqual([])
  })

  it('rejects one id declared by both the set directory and done/ with DUPLICATE_PIECE_ID', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
      [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.01-alpha-piece.md`]: buildPiece({ id: '00.01', queue: '1', status: 'done' }),
    })

    const failure = await scanSetOf(directory, '00-dev-loop').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DuplicatePieceError)
    if (!(failure instanceof DuplicatePieceError)) throw new Error('expected a DuplicatePieceError')
    expect(failure.code).toBe('DUPLICATE_PIECE_ID')
    expect(failure.pieceId).toBe('00.01')
    expect(failure.paths).toHaveLength(2)
    expect(failure.paths.filter(path => path.includes(DONE_DIRECTORY))).toHaveLength(1)
    await expect(directory.getQueueCandidates('00-dev-loop')).rejects.toBeInstanceOf(DuplicatePieceError)
  })
})

describe('selecting queue candidates', () => {
  /** One set: a `done` piece in done/, a `todo` piece still in the set directory. */
  const completedFixture = (): Record<string, string> => ({
    'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
    [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.02-beta-piece.md`]: buildPiece({ id: '00.02', queue: '2', status: 'done' }),
  })

  it('excludes a completed piece from the candidates that getPiece still resolves', async () => {
    const { directory } = await mountPieces(completedFixture())

    const candidates = await directory.getQueueCandidates('00-dev-loop')

    expect(candidates.map(record => record.id)).toEqual(['00.01'])
    expect((await directory.getPiece('00.02')).status).toBe('done')
  })

  it('offers only todo and pending pieces as candidates', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1', status: 'todo' }),
      'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', queue: '2', status: 'pending' }),
      'pieces/00-dev-loop/00.03-gamma-piece.md': buildPiece({ id: '00.03', queue: '3', status: 'blocked' }),
      'pieces/00-dev-loop/00.04-delta-piece.md': buildPiece({ id: '00.04', queue: '4', status: 'done' }),
    })

    const candidates = await directory.getQueueCandidates('00-dev-loop')

    // A blocked piece waits on a human decision, a done piece on nothing at all.
    expect(candidates.map(record => record.status)).toEqual(['todo', 'pending'])
    expect(candidates.map(record => record.id)).toEqual(['00.01', '00.02'])
  })

  it('orders candidates by queue position then by id, matching scanSet', async () => {
    const { directory } = await mountPieces({
      ...orderedSetFixture(),
      'pieces/00-dev-loop/00.04-delta-piece.md': buildPiece({ id: '00.04', queue: '2' }),
    })

    const candidates = await directory.getQueueCandidates('00-dev-loop')
    const { pieces: scanned } = await scanSetOf(directory, '00-dev-loop')

    expect(candidates.map(record => record.id)).toEqual(['00.02', '00.03', '00.04', '00.01'])
    expect(candidates.map(record => record.id)).toEqual(scanned.map(record => record.id))
  })

  it('groups candidates by set before queue position when no set name is given', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', set: '00-dev-loop', queue: '1' }),
      'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', set: '00-dev-loop', queue: '2' }),
      'pieces/01-agent-pool/01.01-pool-piece.md': buildPiece({ id: '01.01', set: '01-agent-pool', queue: '1' }),
      [`pieces/01-agent-pool/${DONE_DIRECTORY}/01.02-done-piece.md`]: buildPiece({ id: '01.02', set: '01-agent-pool', queue: '2', status: 'done' }),
    })

    const candidates = await directory.getQueueCandidates()

    // Queue numbers are set-local, so set 00 finishes before set 01 is offered.
    expect(candidates.map(record => record.id)).toEqual(['00.01', '00.02', '01.01'])
    expect(candidates.map(record => record.set)).toEqual(['00-dev-loop', '00-dev-loop', '01-agent-pool'])
  })

  it('rejects an unmatched set name with SET_NOT_FOUND, like scanSet', async () => {
    const { directory } = await mountPieces(completedFixture())

    await expect(directory.getQueueCandidates('00-dev-lop')).rejects.toBeInstanceOf(SetNotFoundError)
    await expect(directory.getQueueCandidates('00-dev-lop')).rejects.toMatchObject({
      code: 'SET_NOT_FOUND',
      setName: '00-dev-lop',
    })
  })

  it('stops on an already-aborted signal instead of selecting candidates', async () => {
    const { directory } = await mountPieces(completedFixture())
    const controller = new AbortController()
    controller.abort()

    await expect(directory.getQueueCandidates('00-dev-loop', controller.signal)).rejects.toThrow()
    await expect(directory.getQueueCandidates(undefined, controller.signal)).rejects.toThrow()
  })

  it('selects the valid candidates of every set when some files are malformed', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', set: '00-dev-loop', queue: '1' }),
      'pieces/00-dev-loop/00.02-beta-piece.md': buildPiece({ id: '00.02', set: '00-dev-loop', queue: '2', primitive: 'Plugin' }),
      'pieces/01-agent-pool/01.01-pool-piece.md': buildPiece({ id: '01.01', set: '01-agent-pool', queue: '1' }),
      'pieces/01-agent-pool/01.02-broken-piece.md': buildPiece({ id: '01.02', set: '01-agent-pool', queue: '2', omit: ['Behaviour'] }),
    })

    // One malformed file must not deny the caller the rest of the corpus.
    expect((await directory.getQueueCandidates()).map(record => record.id)).toEqual(['00.01', '01.01'])
    expect((await directory.getQueueCandidates('01-agent-pool')).map(record => record.id)).toEqual(['01.01'])
  })
})

describe('enumerating the corpus', () => {
  it('returns every set directory name under the configured root, in name order', async () => {
    const { directory } = await mountPieces({
      'pieces/02-kanban/02.01-board-piece.md': buildPiece({ id: '02.01', set: '02-kanban', queue: '1' }),
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
      'pieces/01-agent-pool/01.01-pool-piece.md': buildPiece({ id: '01.01', set: '01-agent-pool', queue: '1' }),
    })

    // Sorted, so `getQueueCandidates()`'s set-before-queue ordering derives from this
    // rather than being ordered a second, independent way.
    expect(await directory.listSets()).toEqual(['00-dev-loop', '01-agent-pool', '02-kanban'])
  })

  it('ignores files at the root and a set\'s own done/ subdirectory', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
      [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.02-beta-piece.md`]: buildPiece({ id: '00.02', queue: '2', status: 'done' }),
      'pieces/PIECE-FORMAT.md': '# Piece format\n',
      'pieces/README.md': '# Sets\n',
    })

    // `done/` lives inside a set; it is not a set.
    expect(await directory.listSets()).toEqual(['00-dev-loop'])
  })

  it('returns an empty list for a root that holds no set directories', async () => {
    const { directory } = await mountPieces({ 'pieces/README.md': '# No sets yet\n' })

    // Enumerating an empty corpus is an answer, not a failure: unlike SET_NOT_FOUND,
    // no set was named, so there is nothing to be missing.
    expect(await directory.listSets()).toEqual([])
  })

  it('fails loudly when the configured root does not exist', async () => {
    const { directory } = await mountDirectory({ 'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece() }, { root: 'no-such-root' })

    // A missing configured root is misconfiguration, not an empty corpus: reading it as
    // "no work" would make every consumer silently idle. The error type is not pinned
    // here because the package exports none for this case.
    await expect(directory.listSets()).rejects.toThrow()
    await expect(directory.getQueueCandidates()).rejects.toThrow()
  })

  it('stops on an already-aborted signal instead of listing the root', async () => {
    const { directory } = await mountPieces(orderedSetFixture())
    const controller = new AbortController()
    controller.abort()

    await expect(directory.listSets(controller.signal)).rejects.toThrow()
  })

  it('offers candidates in the set order it reports', async () => {
    const { directory } = await mountPieces({
      'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
      'pieces/01-agent-pool/01.01-pool-piece.md': buildPiece({ id: '01.01', set: '01-agent-pool', queue: '1' }),
      'pieces/02-kanban/02.01-board-piece.md': buildPiece({ id: '02.01', set: '02-kanban', queue: '1' }),
    })

    const sets = await directory.listSets()
    const candidates = await directory.getQueueCandidates()

    // One enumeration order, two callers: the candidate sequence never disagrees with it.
    const positions = candidates.map(record => sets.indexOf(record.set))
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
    expect(positions).not.toContain(-1)
  })
})

describe('resolving one piece by id', () => {
  const fixture = (): Record<string, string> => ({
    'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1', dependsOn: '00.02' }),
    [`pieces/00-dev-loop/${DONE_DIRECTORY}/00.02-beta-piece.md`]: buildPiece({ id: '00.02', queue: '2', status: 'done' }),
  })

  it('returns the record a piece id names', async () => {
    const { directory } = await mountPieces(fixture())

    const record = await directory.getPiece('00.01')

    expect(record.id).toBe('00.01')
    expect(record.dependsOn).toEqual(['00.02'])
    expect(record.path).toContain('00.01-alpha-piece.md')
  })

  it('resolves a completed dependency that lives in done/', async () => {
    const { directory } = await mountPieces(fixture())

    const dependency = await directory.getPiece('00.02')

    expect(dependency.status).toBe('done')
    expect(dependency.path).toContain(DONE_DIRECTORY)
  })

  it('rejects an unknown piece id with PIECE_NOT_FOUND', async () => {
    const { directory } = await mountPieces(fixture())

    await expect(directory.getPiece('99.99')).rejects.toBeInstanceOf(PieceNotFoundError)
    await expect(directory.getPiece('99.99')).rejects.toMatchObject({ code: 'PIECE_NOT_FOUND', pieceId: '99.99' })
  })

  it('rejects an id whose set directory exists but holds no such piece', async () => {
    const { directory } = await mountPieces(fixture())

    await expect(directory.getPiece('00.07')).rejects.toBeInstanceOf(PieceNotFoundError)
  })

  /** A set holding one unparseable sibling beside the piece actually being asked for. */
  const siblingFixture = (): Record<string, string> => ({
    'pieces/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
    'pieces/00-dev-loop/00.04-delta-piece.md': buildPiece({ id: '00.04', queue: '4', primitive: 'Plugin' }),
  })

  it('returns a valid piece from a set that also holds a malformed file', async () => {
    const { directory } = await mountPieces(siblingFixture())

    const record = await directory.getPiece('00.01')

    expect(record.id).toBe('00.01')
  })

  it('raises the parse error only for the requested file, never for a malformed sibling', async () => {
    const { directory } = await mountPieces(siblingFixture())

    const failure = await directory.getPiece('00.04').catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PieceParseError)
    if (!(failure instanceof PieceParseError)) throw new Error('expected a PieceParseError')
    expect(failure.code).toBe('INVALID_HARNESS_PRIMITIVE')
    expect(failure.path).toContain('00.04-delta-piece.md')
    expect(failure.path).not.toContain('00.01-alpha-piece.md')
  })
})

describe('directory configuration', () => {
  /** The same fixture under the default root, so a case may omit `root` entirely. */
  const defaultRootFixture = (): Record<string, string> => ({
    [`${PIECE_ROOT}/00-dev-loop/00.01-alpha-piece.md`]: buildPiece({ id: '00.01', queue: '1' }),
  })

  it('applies every schema default when mounted with no configured field', async () => {
    const { directory } = await mountDirectory(defaultRootFixture())

    expect((await scanSetOf(directory, '00-dev-loop')).pieces.map(record => record.id)).toEqual(['00.01'])
    expect(directory.validate(PIECE_PATH, buildPiece({ lines: PIECE_MAX_LINES })).lineCount).toBe(PIECE_MAX_LINES)
    expect(() => directory.validate(PIECE_PATH, buildPiece({ lines: PIECE_MAX_LINES + 1 }))).toThrow(PieceParseError)
    for (const primitive of HARNESS_PRIMITIVES) {
      expect(directory.validate(PIECE_PATH, buildPiece({ primitive })).primitive).toBe(primitive)
    }
    expect(() => directory.validate(PIECE_PATH, buildPiece({ primitive: 'Plugin' }))).toThrow(PieceParseError)
  })

  it('keeps the remaining schema defaults when only one field is configured', async () => {
    const { directory } = await mountDirectory(defaultRootFixture(), { maxLines: 80 })

    expect((await scanSetOf(directory, '00-dev-loop')).pieces.map(record => record.id)).toEqual(['00.01'])
    expect(directory.validate(PIECE_PATH, buildPiece({ lines: 80 })).lineCount).toBe(80)
    expect(() => directory.validate(PIECE_PATH, buildPiece({ lines: 81 }))).toThrow(PieceParseError)
    expect(directory.validate(PIECE_PATH, buildPiece({ primitive: 'client UI extension' })).primitive).toBe('client UI extension')
  })

  it('applies the configured ceiling to validate()', async () => {
    const { directory } = await mountDirectory({}, { root: 'pieces', maxLines: 80 })

    expect(directory.validate(PIECE_PATH, buildPiece({ lines: 80 })).lineCount).toBe(80)
    expect(() => directory.validate(PIECE_PATH, buildPiece({ lines: 81 }))).toThrow(PieceParseError)
  })

  it('applies the configured primitive vocabulary to validate()', async () => {
    const { directory } = await mountDirectory({}, { root: 'pieces', primitives: ['Bespoke Primitive'] })

    expect(directory.validate(PIECE_PATH, buildPiece({ primitive: 'Bespoke Primitive' })).primitive).toBe('Bespoke Primitive')
    expect(() => directory.validate(PIECE_PATH, buildPiece({ primitive: 'Service Provider' }))).toThrow(PieceParseError)
  })

  it('reads sets from the configured root', async () => {
    const { directory } = await mountDirectory({
      'elsewhere/00-dev-loop/00.01-alpha-piece.md': buildPiece({ id: '00.01', queue: '1' }),
    }, { root: 'elsewhere' })

    expect((await scanSetOf(directory, '00-dev-loop')).pieces.map(record => record.id)).toEqual(['00.01'])
  })
})

/**
 * Properties every scan of one real set satisfies. The corpus grows, so nothing
 * here pins an id list: an enumeration of a growing set rots into an assertion
 * that passes while checking nothing real. `00.01` is kept as the one anchor id
 * because it is this package's own specification — if the scan cannot see that
 * file, the rest of the assertions are vacuous.
 */
function expectCorpusInvariants(records: readonly PieceRecord[], setName: string): void {
  expect(records.length).toBeGreaterThan(0)
  const queues = records.map(record => record.queue)
  expect(queues).toEqual([...queues].sort((left, right) => left - right))
  expect(new Set(queues).size, 'queue positions are unique, so the order is strictly increasing').toBe(queues.length)
  const ids = records.map(record => record.id)
  expect(new Set(ids).size, 'ids are unique across the set directory and done/').toBe(ids.length)
  expect(ids).toContain('00.01')
  // The declared `**Set:**` header agreeing with the directory that holds the file is
  // the load-bearing check here. A ceiling, vocabulary or path assertion would be
  // tautological: `parsePiece` already rejected any violation of the first two, and the
  // scan constructs the third.
  expect(records.every(record => record.set === setName)).toBe(true)
  // `R-done-pieces-moved` as an executable invariant. The forward direction is vacuous
  // while `00-dev-loop/done/` is empty; the reverse is live, and catches a `done` piece
  // left behind in the set root.
  const inDone = (record: PieceRecord): boolean => record.path.includes(`${setName}/${DONE_DIRECTORY}/`)
  expect(records.every(record => inDone(record) === (record.status === 'done'))).toBe(true)
}

/** Mount the directory over the real repository tree, rooted at the live `plans/pieces`. */
async function mountRealCorpus(): Promise<DevLoopDirectory> {
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: repositoryRoot })
  const fiber = await ctx.plugin(DevLoopDirectory, { root: PIECE_ROOT })
  cleanups.push(async () => { await fiber.dispose() })
  const directory = ctx.get('devLoopDirectory')
  if (directory === undefined) throw new Error('devLoopDirectory service missing after mount')
  return directory
}

/** Every set directory the live corpus holds, discovered rather than listed. */
async function realSetNames(): Promise<string[]> {
  const entries = await readdir(join(repositoryRoot, PIECE_ROOT), { withFileTypes: true })
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

describe('the real plans/pieces corpus', () => {
  it('returns every set-00 piece in queue order, wherever completion has moved it', async () => {
    const directory = await mountRealCorpus()

    const { pieces: records } = await scanSetOf(directory, '00-dev-loop')

    expectCorpusInvariants(records, '00-dev-loop')
  })

  it('defaults its ceiling to the line count the R-piece-size axiom enforces', async () => {
    const axioms = await readFile(join(repositoryRoot, 'plans', 'AGENTS.md'), 'utf8')
    const sizeAxiom = axioms.slice(axioms.indexOf('id: R-piece-size'))
    const declared = /NR>(\d+)/.exec(sizeAxiom)

    // The package claims to be the executable form of the axiom, so the number lives in
    // one place. This is the assertion that would have caught the ceiling moving to 280
    // in `plans/AGENTS.md` while `PIECE_MAX_LINES` stayed at 220.
    expect(declared, 'R-piece-size states its ceiling as an awk NR comparison').not.toBeNull()
    expect(PIECE_MAX_LINES).toBe(Number(declared?.[1]))
  })

  it('reports every set directory of the live corpus', async () => {
    const directory = await mountRealCorpus()

    const sets = await directory.listSets()

    expect(sets.length, 'the corpus holds at least one set').toBeGreaterThan(0)
    expect(sets).toEqual([...sets].sort())
    expect(sets, 'the set holding this package\'s own piece').toContain('00-dev-loop')
    // Compared against the directory listing rather than a pinned list of names: the
    // corpus gains sets, and an enumeration of it would rot the way the id lists did.
    expect(sets).toEqual(await realSetNames())
    for (const setName of sets) {
      const entries = await readdir(join(repositoryRoot, PIECE_ROOT, setName), { withFileTypes: true })
      const holdsWork = entries.some(entry =>
        (entry.isFile() && isPieceFilename(entry.name)) || (entry.isDirectory() && entry.name === DONE_DIRECTORY))
      expect(holdsWork, `${setName} holds piece files or a done/ subdirectory`).toBe(true)
    }
  })

  it('scans every set of the corpus without throwing, reporting malformed files instead', async () => {
    const directory = await mountRealCorpus()
    const setNames = await realSetNames()
    expect(setNames.length, 'the corpus holds more than one set').toBeGreaterThan(1)

    let scanned = 0
    let rejections = 0
    let anchor: PieceRecord | undefined
    for (const setName of setNames) {
      const scan = await scanSetOf(directory, setName)

      expect(Array.isArray(scan.pieces), `${setName} yields a SetScan`).toBe(true)
      expect(Array.isArray(scan.rejected), `${setName} yields a SetScan`).toBe(true)
      const queues = scan.pieces.map(record => record.queue)
      expect(queues, `${setName} is queue-ordered`).toEqual([...queues].sort((left, right) => left - right))
      const ids = scan.pieces.map(record => record.id)
      expect(new Set(ids).size, `${setName} ids are unique`).toBe(ids.length)
      for (const rejection of scan.rejected) {
        // A rejection names its own file and carries the evidence, never a bare flag.
        expect(rejection.path, `${setName} rejection`).toContain(setName)
        expect(rejection.findings.some(finding => finding.severity === 'blocker'), rejection.path).toBe(true)
      }
      anchor ??= scan.pieces[0]
      scanned += scan.pieces.length
      rejections += scan.rejected.length
    }

    expect(scanned, 'the corpus yields readable pieces').toBeGreaterThan(0)
    // Counts are not pinned: the corpus is amended continuously, and both a rising piece
    // count and a falling rejection count are healthy.
    expect(rejections).toBeGreaterThanOrEqual(0)

    const candidates = await directory.getQueueCandidates()
    expect(candidates.length, 'candidates survive malformed siblings').toBeGreaterThan(0)
    expect(candidates.every(record => record.status === 'todo' || record.status === 'pending')).toBe(true)

    // The first readable piece of the corpus resolves by id. Derived rather than pinned,
    // and unconditional: the earlier `mixedSet` form only ran when one set held both valid
    // and rejected files, which no set does today, so it asserted nothing. The
    // malformed-sibling variant of this is covered by the fixture case in `resolving one
    // piece by id`.
    if (anchor === undefined) throw new Error('expected the corpus to yield at least one piece')
    expect((await directory.getPiece(anchor.id)).id).toBe(anchor.id)
  })

  it('offers every set-00 piece that has not reached done as a queue candidate', async () => {
    const directory = await mountRealCorpus()

    const { pieces: scanned } = await scanSetOf(directory, '00-dev-loop')
    const candidates = await directory.getQueueCandidates('00-dev-loop')

    expect(candidates.map(record => record.id))
      .toEqual(scanned.filter(record => record.status === 'todo' || record.status === 'pending').map(record => record.id))
    expect(candidates.every(record => record.status !== 'done' && record.status !== 'blocked')).toBe(true)
  })
})

describe('real Loader composition', () => {
  it('publishes ctx.devLoopDirectory from a cordis.yml composition and reads the real corpus', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-directory-loader-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const configPath = join(root, 'cordis.yml')
    // Test-only composition: a local filesystem backend rooted at the repository,
    // then this package reading `plans/pieces` through it.
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-fs-local'",
      '  config:',
      `    cwd: '${repositoryRoot.replaceAll('\\', '/')}'`,
      "- name: '@deepseek-ai/dsh-dev-loop-directory'",
      '  config:',
      `    root: '${PIECE_ROOT}'`,
      '',
    ].join('\n'))

    const ctx = new Context()
    cleanups.push(async () => { await ctx.fiber.dispose() })
    ctx.baseUrl = `${pathToFileURL(root).href}/`
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-fs-local', fsLocalPlugin],
      ['@deepseek-ai/dsh-dev-loop-directory', directoryPlugin],
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

    const directory = ctx.get('devLoopDirectory')
    expect(directory).toBeInstanceOf(DevLoopDirectory)
    if (directory === undefined) throw new Error('devLoopDirectory service missing after Loader composition')

    const { pieces: records } = await scanSetOf(directory, '00-dev-loop')

    expectCorpusInvariants(records, '00-dev-loop')
    expect((await directory.getPiece('00.01')).set).toBe('00-dev-loop')
  })
})

describe('service lifecycle', () => {
  it('removes ctx.devLoopDirectory when the fiber that mounted it is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-directory-hmr-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const ctx = new Context()
    await ctx.plugin(LocalFileSystem, { cwd: root })
    const fiber = await ctx.plugin(DevLoopDirectory, {})

    expect(ctx.get('devLoopDirectory')).toBeInstanceOf(DevLoopDirectory)

    await fiber.dispose()

    expect(ctx.get('devLoopDirectory')).toBeUndefined()
  })
})
