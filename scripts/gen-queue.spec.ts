/**
 * Unit tests for the generalizable master queue generator.
 *
 * Covers verification command extraction, set title resolution,
 * directory scanning, markdown ledger formatting, and freshness checks.
 */

import { describe, expect, it } from 'vitest'
import {
  checkQueueFreshness,
  extractVerificationCommand,
  formatQueueMarkdown,
  readSetTitle,
  QueueScanResult,
  SetQueue,
} from './gen-queue.ts'
import { PieceRecord } from './parse-piece.ts'

describe('extractVerificationCommand', () => {
  it('extracts the first active command from a bash fenced code block', () => {
    const body = `
Run:
\`\`\`bash
# Run the test suite
pnpm exec vitest run tests/example.spec.ts -t 'scenario'
\`\`\`
Expected output:
\`\`\`
✓ scenario
\`\`\`
`
    expect(extractVerificationCommand(body)).toBe('`pnpm exec vitest run tests/example.spec.ts -t \'scenario\'`')
  })

  it('handles sh and console fence headers', () => {
    const body = `
\`\`\`sh
pytest tests/test_core.py
\`\`\`
`
    expect(extractVerificationCommand(body)).toBe('`pytest tests/test_core.py`')
  })

  it('falls back to 4-Gate Pipeline when no code block is present', () => {
    const body = 'No executable test command given yet.'
    expect(extractVerificationCommand(body)).toBe('4-Gate Pipeline')
  })
})

describe('readSetTitle', () => {
  it('derives a title from a kebab-case name when no README exists', () => {
    expect(readSetTitle('/nonexistent/path', '00-dev-loop')).toBe('Dev Loop')
    expect(readSetTitle('/nonexistent/path', '01-agent-pool')).toBe('Agent Pool')
    expect(readSetTitle('/nonexistent/path', 'auth-service')).toBe('Auth Service')
  })
})

describe('formatQueueMarkdown', () => {
  const dummyRecord = (id: string, queue: number, status: 'todo' | 'pending' | 'done'): PieceRecord => ({
    id,
    title: `Title of ${id}`,
    set: '00-test',
    queue,
    dependsOn: [],
    status,
    primitive: 'Service',
    pkg: 'test-pkg',
    lead: 'Lead Dev',
    path: `plans/pieces/00-test/${id}.md`,
    lineCount: 100,
    summary: 'Summary text',
    scenarios: [],
    warnings: [],
  })

  it('generates header, progress summary, and set table', () => {
    const set: SetQueue = {
      setId: '00',
      setName: '00-test',
      setTitle: 'Test Subsystem',
      dirPath: '/fake/00-test',
      pieces: [
        {
          record: dummyRecord('00.01', 1, 'done'),
          relativePath: '00-test/done/00.01.md',
          verificationCommand: '`vitest run`',
          queueStatus: 'done',
        },
        {
          record: dummyRecord('00.02', 2, 'todo'),
          relativePath: '00-test/00.02.md',
          verificationCommand: '4-Gate Pipeline',
          queueStatus: 'to implement',
        },
      ],
    }

    const scan: QueueScanResult = {
      sets: [set],
      totalPieces: 2,
      doneCount: 1,
      pendingCount: 0,
      todoCount: 1,
      blockedCount: 0,
    }

    const markdown = formatQueueMarkdown(scan)
    expect(markdown).toContain('# Master Micro-Gate Queue & Progress Ledger')
    expect(markdown).toContain('1 of 2 micro-gates completed (50%)')
    expect(markdown).toContain('## Set 00 — Test Subsystem')
    expect(markdown).toContain('| `00.01` | [Title of 00.01](00-test/done/00.01.md) | Lead Dev | `test-pkg` | done | `vitest run` |')
    expect(markdown).toContain('| `00.02` | [Title of 00.02](00-test/00.02.md) | Lead Dev | `test-pkg` | to implement | 4-Gate Pipeline |')
    expect(markdown.endsWith('\n')).toBe(true)
  })
})

describe('checkQueueFreshness', () => {
  it('reports fresh for up-to-date queue file', () => {
    const result = checkQueueFreshness()
    expect(result.fresh).toBe(true)
  })
})
