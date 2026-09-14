/** Repository inputs, tests and frozen RED identities for real gates fixtures. */
import type { AuthoredTests, ExpectedAssertion, TestIdentity } from '../src/handoff-snapshot.ts'

/** Canonical fixture piece id. */
export const pieceId = '00.10'
/** Tracked piece location in the private repository. */
export const piecePath = 'plans/pieces/00-dev-loop/00.10-verification-gates.md'
/** Mainline production file the fixture implementation changes at GREEN. */
export const productionPath = 'production/value.js'
/** Test Writer's repository-relative output inside the worktree. */
export const authoredPath = 'tests/behavior.spec.js'
/** Test helper imported by the authored entry; helper drift must fail GREEN. */
export const helperPath = 'tests/behavior-helper.js'
/** Model-authored behavioral expectation and passing control; not approval of a reporter adapter. */
export const authoredSource = `import { expect, test } from 'vitest'
import { value } from '../production/value.js'
import { doubled } from './behavior-helper.js'
test('required behavior', () => { expect(value()).toBe(true) })
test('passing control', () => { expect(doubled(2)).toBe(4) })
`
export const helperSource = 'export function doubled(n) { return n * 2 }\n'
/** Untrusted role report; the owner must independently observe every identity and failure. */
export const authoredOutcome: AuthoredTests = {
  testPaths: [authoredPath], helperPaths: [helperPath], fixturePaths: [],
  expectedFailures: [expectedFailure()], passingControls: [passingControl()],
}
/** The one behavioral RED expectation the frozen baseline pins. */
export function expectedFailure(): ExpectedAssertion {
  return { path: authoredPath, fullName: 'required behavior',
    failureMessage: 'AssertionError: expected undefined to be true // Object.is equality' }
}
/** The control identity that must keep passing at GREEN and post-transfer. */
export function passingControl(): TestIdentity {
  return { path: authoredPath, fullName: 'passing control' }
}
/** Four complete source scenarios, retained as actual Git-tracked bytes with pending status. */
export const pieceSource = ['# 00.10 — Verification gates fixture', '',
  '**Set:** 00-dev-loop · **Queue:** 10 · **Depends on:** none', '**Status:** pending',
  '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-gates`',
  ...['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References', 'How to see it',
    'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance'].flatMap(section => ['', `## ${section}`, '',
    section === 'Behaviour' ? [
      '- **Given** the pending value implementation **When** value is called **Then** it returns true',
      '- **Given** the value implementation **When** value is called twice **Then** both results are true',
      '- **Given** the value implementation **When** doubled is called **Then** it doubles its argument',
      '- **Given** the completed value module **When** the mainline runs the pinned tests **Then** all of them pass',
    ].join('\n')
      : section === 'References' ? 'None.' : `Private fixture material for ${section}.`]), ''].join('\n')
/** Unchanged mainline file unrelated to the piece; transfer must preserve its bytes. */
export const unrelatedMainlinePath = 'docs/notes.md'
export const unrelatedMainlineSource = 'Retained mainline notes.\n'
