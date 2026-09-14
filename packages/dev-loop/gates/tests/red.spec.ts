/** RED evidence binding: Gates consumes exact frozen Handoff records and refuses stale or cross-piece ones. */
import { expect, test } from 'vitest'
import { fixture, pieceId, pieceSource } from './harness.ts'
import { frozenHandoff, readTestIdentities, type HandoffControls } from './handoff-double.ts'
import type { HandoffRecord } from '../src/handoff-snapshot.ts'
import { authoredPath, helperPath } from './fixture-source.ts'

type Configure = NonNullable<Parameters<typeof fixture>[1]>['configureHandoff']
/** Serve an internally consistent frozen record for the fixture piece and retained worktree. */
const serveFrozen: Configure = async (controls, { worktree, baseCommit }) => {
  controls.serve = sought => sought === pieceId
    ? frozenRecord(controls, worktree, baseCommit)
    : undefined
}
const frozenRecord = (controls: HandoffControls, worktree: string, baseCommit: string): HandoffRecord =>
  frozenHandoff(pieceId, pieceSource, controls.identities ?? [], worktree, baseCommit)

test('a frozen behavioral RED record for the exact piece satisfies the RED evaluation', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')
    expect(red).toBeDefined()
    expect(red!.status).toBe('pass')
    expect(red!.reasonCode).toBe('evidence-current')
  }, { configureHandoff: async (controls, paths) => {
    controls.identities = await readTestIdentities(paths.worktree, [authoredPath, helperPath])
    await serveFrozen(controls, paths)
  } })
})

test('a missing Handoff record fails RED without rerunning arbitrary commands during the hook', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.status).toBe('fail')
    expect(red.reasonCode).toBe('missing-evidence')
  })
})

test('a failed Handoff record cannot masquerade as behavioral RED', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.status).toBe('fail')
  }, { configureHandoff: async (controls, paths) => {
    const record = frozenHandoff(pieceId, pieceSource, [], paths.worktree, paths.baseCommit)
    controls.serve = () => ({ ...record, state: 'failed' as const, finishedAt: 9,
      code: 'RUNNER_FAILED', limitations: ['never frozen'] }) as HandoffRecord
  } })
})

test('cross-piece evidence is refused instead of completing the wrong piece', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.status).toBe('fail')
    expect(red.reasonCode).toBe('cross-piece-evidence')
  }, { configureHandoff: (controls, paths) => {
    controls.serve = () => frozenHandoff('00.11-other-piece', pieceSource, [], paths.worktree, paths.baseCommit)
  } })
})

test('evidence whose piece digest no longer matches the current source is stale', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.status).toBe('stale')
    expect(red.reasonCode).toBe('stale-piece')
  }, { configureHandoff: (controls, paths) => {
    controls.serve = () => frozenHandoff(pieceId, '**Status:** pending, edited after the freeze', [], paths.worktree, paths.baseCommit)
  } })
})

test('RED evidence whose runner run timed out cannot authorize anything', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.status).toBe('fail')
  }, { configureHandoff: (controls, paths) => {
    controls.serve = () => {
      const record = frozenHandoff(pieceId, pieceSource, [], paths.worktree, paths.baseCommit)
      return { ...record, evidence: { ...record.evidence, run: { ...record.evidence.run, timedOut: true, exitCode: null } } }
    }
  } })
})

test('historical RED stays tied to its original production baseline, not GREEN’s changed revision', async () => {
  await fixture(async (f) => {
    await f.implement()
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.status).toBe('pass')
    expect(red.reasonCode).not.toBe('stale-tests')
  }, { configureHandoff: async (controls, paths) => {
    controls.identities = await readTestIdentities(paths.worktree, [authoredPath, helperPath])
    await serveFrozen(controls, paths)
  } })
})

test('the RED evaluation records the handoff and evidence ids of the consumed record', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const red = report.evaluations.find(evaluation => evaluation.check === 'red')!
    expect(red.evidenceIds.length).toBeGreaterThan(0)
    expect(f.handoff.reads).toContainEqual({ pieceId })
  }, { configureHandoff: async (controls, paths) => {
    controls.identities = await readTestIdentities(paths.worktree, [authoredPath, helperPath])
    await serveFrozen(controls, paths)
  } })
})
