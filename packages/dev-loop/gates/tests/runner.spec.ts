/** Runner semantics: real process outcomes classify through the owned adapter; no self-reported pass APIs. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { fixture, authoredPath, helperPath, pieceId, pieceSource } from './harness.ts'
import { frozenHandoff, readTestIdentities } from './handoff-double.ts'
import { classifyRun, type RunnerOutcomeClass } from '../src/runner.ts'
import type { HandoffRunId, RunFacts } from '../src/handoff-snapshot.ts'

/** Base run facts describing a clean failed assertion run; each test mutates one orthogonal facet. */
const baseFacts = (): RunFacts => ({
  runId: '11111111-1111-4111-8111-111111111111' as HandoffRunId, integrityPath: '/integrity.json',
  integrityOutput: '{"protocolVersion":1}', startedAt: 1, finishedAt: 2, exitCode: 1, signal: null,
  timedOut: false, cancelled: false, truncated: false, cleanup: 'quiescent',
  reporterOutput: '{"testResults":[{"name":"tests/behavior.spec.js","assertionResults":[{"fullName":"required behavior","status":"failed","failureMessages":["AssertionError: expected undefined to be true"]}]}]}',
  stderr: '',
})
/** Observe a classification without letting the scaffold rejection escape as infrastructure. */
const observeClassify = async (mutate: (facts: RunFacts) => RunFacts) => {
  try {
    return { kind: 'settled' as const, value: classifyRun(mutate(baseFacts())) }
  } catch (error) {
    return { kind: 'rejected' as const, error: String(error) }
  }
}
/** Each runner case demands one classification from actual facts, never from a caller flag. */
const classify = async (mutate: (facts: RunFacts) => RunFacts, expected: RunnerOutcomeClass): Promise<void> => {
  expect(await observeClassify(mutate)).toEqual({ kind: 'settled', value: expected })
}

test('an assertion RED classifies as behavioral and can only be cleared by executed evidence', async () => {
  await classify(() => baseFacts(), 'assertion-red')
})

test('a clean exit after the deadline is still a timeout failure', async () => {
  await classify(facts => ({ ...facts, exitCode: 0, timedOut: true }), 'timeout')
})

test('a SIGKILLed child classifies as killed, never as passed', async () => {
  await classify(facts => ({ ...facts, exitCode: null, signal: 'SIGKILL' }), 'killed')
})

test('truncated reporter output refuses classification as passed', async () => {
  await classify(facts => ({ ...facts, truncated: true }), 'truncated')
})

test('unproven child-tree cleanup refuses the outcome', async () => {
  await classify(facts => ({ ...facts, cleanup: 'unproven' }), 'cleanup-unproven')
})

test('zero collected tests and skipped selections refuse RED', async () => {
  await classify(facts => ({ ...facts, exitCode: 0,
    reporterOutput: '{"testResults":[],"numTotalTests":0,"numPassedTests":0,"numFailedTests":0,"numPendingTests":0,"numTodoTests":0}' }),
  'skipped-or-empty')
})

test('a collection-time syntax error is infrastructure, not behavioral RED', async () => {
  await classify(facts => ({ ...facts, exitCode: 1,
    reporterOutput: '{"testResults":[{"name":"tests/broken.spec.js","status":"failed","message":"SyntaxError","assertionResults":[]}]}',
    stderr: 'SyntaxError: Unexpected token' }), 'syntax-or-import-error')
})

test('an importer error is infrastructure, not behavioral RED', async () => {
  await classify(facts => ({ ...facts, exitCode: 1,
    reporterOutput: '{"testResults":[{"name":"tests/behavior.spec.js","status":"failed","message":"Cannot find module","assertionResults":[]}]}',
    stderr: 'Error: Cannot find module' }), 'syntax-or-import-error')
})

test('gates runChecks actually classifies the real fixture runner outcome at GREEN [real process]', async () => {
  await fixture(async (f) => {
    await f.implement()
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('pass')
    expect(report.run).toBeDefined()
    expect(report.run!.timedOut).toBe(false)
    expect(report.run!.truncated).toBe(false)
  }, { configureHandoff: async (controls, { worktree, baseCommit }) => {
    controls.identities = await readTestIdentities(worktree, [authoredPath, helperPath])
    controls.serve = sought => sought === pieceId
      ? frozenHandoff(pieceId, pieceSource, controls.identities ?? [], worktree, baseCommit) : undefined
  }, config: { commandTimeoutMs: 60_000 } })
})

test('the runner deadline terminates a hung child and joins its tree before reporting [real process]', async () => {
  await fixture(async (f) => {
    await mkdir(join(f.worktree, 'tests'), { recursive: true })
    await writeFile(join(f.worktree, 'tests/hang.spec.js'), [
      'import { test } from \'vitest\'', 'test(\'hangs\', async () => { await new Promise(() => {}) })', '',
    ].join('\n'))
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('fail')
    expect(green.reasonCode).toBe('runner-timeout')
  }, { config: { commandTimeoutMs: 30_000, terminationGraceMs: 1000 } })
})
