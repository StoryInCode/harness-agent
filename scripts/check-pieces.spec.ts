/**
 * Detection-boundary tests for the `plans/AGENTS.md` axiom checkers.
 *
 * `scripts/AGENTS.md` requires a source-ownership gate to test every admitted
 * and excluded form that moves its boundary. Each case here pins a form that
 * has already produced, or could produce, a wrong verdict: a false positive
 * accuses conforming work, and a false negative lets an axiom violation land.
 *
 * FORK-LOCAL: this file exists only in this fork (see FORK.md).
 */

import { describe, expect, it } from 'vitest'
import {
  checkClaimCitations,
  checkDonePlacement,
  checkSetIndex,
  checkPrimitive,
  checkSections,
  tableCells,
} from './check-pieces.ts'

/** Canonical section order; a piece built from this conforms. */
const SECTIONS = [
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

interface PieceOptions {
  readonly status?: string
  readonly primitiveLine?: string
  readonly omit?: readonly string[]
  readonly proofRows?: readonly string[]
  readonly extra?: Readonly<Record<string, readonly string[]>>
}

/**
 * Build a conforming piece, minus anything the caller omits.
 * @param options - status, primitive header line, omitted sections, proof rows, and extra section bodies.
 * @returns the complete piece text.
 */
function piece(options: PieceOptions = {}): string {
  const proofRows = options.proofRows ?? ['| a claim | `packages/fs/fs/src/index.ts` | Direct inspection | 2026-09-12 |']
  const lines = [
    '# 00.01 — A Title',
    '',
    '**Set:** 00-dev-loop · **Queue:** 1 · **Depends on:** none',
    `**Status:** ${options.status ?? 'todo'}`,
    options.primitiveLine ?? '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-x`',
    '',
  ]
  for (const section of SECTIONS) {
    if (options.omit?.includes(section) === true) continue
    lines.push(`## ${section}`, '')
    if (section === 'Resources and proof') {
      lines.push('| Claim | Citation | How established | Checked against |', '|---|---|---|---|', ...proofRows, '')
    } else {
      lines.push(...options.extra?.[section] ?? ['body.'], '')
    }
  }
  return `${lines.join('\n')}\n`
}

describe('proof-row cell splitting', () => {
  it('does not treat an escaped pipe inside a code span as a cell delimiter', () => {
    // A proof row routinely quotes a TypeScript union. Splitting on it shifted
    // every later column and accused four conforming pieces.
    const cells = tableCells('| a claim | `string \\| undefined` | Direct inspection | 2026-09-12 |')
    expect(cells).toEqual(['a claim', '`string \\| undefined`', 'Direct inspection', '2026-09-12'])
  })

  it('preserves an interior empty cell so later columns keep their position', () => {
    expect(tableCells('| a |  | Measured | today |')).toEqual(['a', '', 'Measured', 'today'])
  })

  it('accepts a row whose How-established cell quotes a union', () => {
    const rows = ['| guard signature | `ToolGuard = (e) => string \\| undefined` | Direct inspection | 2026-09-12 |']
    expect(checkClaimCitations('p.md', piece({ proofRows: rows }))).toEqual([])
  })
})

describe('claim citations', () => {
  it('accepts every recognised form of establishment', () => {
    for (const form of ['Direct inspection', 'Measured', 'Reported by Research role (cordis preset)', 'README only', 'UNVERIFIED — path does not exist']) {
      const rows = [`| a claim | a citation | ${form} | 2026-09-12 |`]
      expect(checkClaimCitations('p.md', piece({ proofRows: rows })), form).toEqual([])
    }
  })

  it('rejects a row that states no form of establishment', () => {
    const rows = ['| a claim | a citation | probably fine | 2026-09-12 |']
    expect(checkClaimCitations('p.md', piece({ proofRows: rows }))).toHaveLength(1)
  })

  it('rejects a proof section carrying only its header row', () => {
    const text = piece().replace('| a claim | `packages/fs/fs/src/index.ts` | Direct inspection | 2026-09-12 |\n', '')
    expect(checkClaimCitations('p.md', text)[0]?.message).toContain('no claim rows')
  })

  it('rejects a piece with no proof section at all', () => {
    const violations = checkClaimCitations('p.md', piece({ omit: ['Resources and proof'] }))
    expect(violations[0]?.message).toContain('`## Resources and proof` section')
  })
})

describe('required sections', () => {
  it('accepts a piece carrying every canonical section in order', () => {
    expect(checkSections('p.md', piece())).toEqual([])
  })

  it('names each absent blocker section', () => {
    const violations = checkSections('p.md', piece({ omit: ['Resources and proof'] }))
    expect(violations).toHaveLength(1)
    expect(violations[0]?.message).toContain('Resources and proof')
  })

  it('does not report the warning-severity section as a required one', () => {
    expect(checkSections('p.md', piece({ omit: ['Reuse capture'] }))).toEqual([])
  })

  it('ignores a ## heading inside a fenced code block', () => {
    const fenced = { Contracts: ['```markdown', '## Acceptance', '## Summary', '```'] }
    expect(checkSections('p.md', piece({ extra: fenced }))).toEqual([])
  })
})

describe('declared primitive', () => {
  it('accepts a primitive from the closed vocabulary with a named package', () => {
    expect(checkPrimitive('p.md', piece())).toEqual([])
  })

  it('rejects a primitive outside the vocabulary', () => {
    const line = '**Harness primitive:** Plugin · **Package:** `@deepseek-ai/dsh-x`'
    expect(checkPrimitive('p.md', piece({ primitiveLine: line }))).toHaveLength(1)
  })

  it('rejects a header whose Package label lost its bold markers', () => {
    // The exact defect found in 02.13: `Package:` instead of `**Package:**`,
    // invisible on reading and fatal to the parser.
    const line = '**Harness primitive:** Service Provider · Package: `@deepseek-ai/dsh-x`'
    expect(checkPrimitive('p.md', piece({ primitiveLine: line }))).not.toEqual([])
  })
})

describe('done placement', () => {
  it('accepts a done piece living under done/ whose index records it', () => {
    const text = piece({ status: 'done' })
    const index = () => '| `00.01` | A Title | pkg | none | 1 | done |\n'
    expect(checkDonePlacement('plans/pieces/00-dev-loop/done/00.01-a.md', text, index)).toEqual([])
  })

  it('accepts a done piece whose set has no README, since there is no index to disagree', () => {
    const text = piece({ status: 'done' })
    expect(checkDonePlacement('plans/pieces/00-dev-loop/done/00.01-a.md', text, () => undefined)).toEqual([])
  })

  it('rejects a done piece the set index still lists as todo', () => {
    const text = piece({ status: 'done' })
    const index = () => '| `00.01` | A Title | pkg | none | 1 | todo |\n'
    const violations = checkDonePlacement('plans/pieces/00-dev-loop/done/00.01-a.md', text, index)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.message).toContain('does not say done')
  })

  it('rejects a done piece the set index omits entirely', () => {
    const text = piece({ status: 'done' })
    const index = () => '| `00.02` | Another | pkg | none | 2 | todo |\n'
    const violations = checkDonePlacement('plans/pieces/00-dev-loop/done/00.01-a.md', text, index)
    expect(violations[0]?.message).toContain('lists no row')
  })

  it('matches the index row by backticked id, not by bare substring', () => {
    // `00.010` must not satisfy a lookup for `00.01`.
    const index = () => '| `00.010` | Decoy | pkg | none | 1 | done |\n'
    expect(checkSetIndex('plans/pieces/00-dev-loop/done/00.01-a.md', '00.01', index)).toHaveLength(1)
  })

  it('rejects a done piece left in the set directory', () => {
    const violations = checkDonePlacement('plans/pieces/00-dev-loop/00.01-a.md', piece({ status: 'done' }))
    expect(violations).toHaveLength(1)
    expect(violations[0]?.message).toContain('done')
  })

  it('accepts an unfinished piece in the set directory', () => {
    expect(checkDonePlacement('plans/pieces/00-dev-loop/00.01-a.md', piece({ status: 'todo' }))).toEqual([])
  })

  it('reports nothing for a piece it cannot parse, leaving that to the section and primitive checkers', () => {
    expect(checkDonePlacement('plans/pieces/00-dev-loop/00.01-a.md', '# not a piece\n')).toEqual([])
  })
})
