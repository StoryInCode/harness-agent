/** GREEN evidence binding: exact selection against the observed implementation revision, with drift refusal. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { fixture, helperPath, authoredPath, pieceId, pieceSource } from './harness.ts'
import { frozenHandoff, readTestIdentities } from './handoff-double.ts'

type Configure = NonNullable<Parameters<typeof fixture>[1]>['configureHandoff']
/** Serve the frozen RED record captured from the retained worktree. */
const serveFrozen: Configure = async (controls, { worktree, baseCommit }) => {
  controls.identities = await readTestIdentities(worktree, [authoredPath, helperPath])
  controls.serve = sought => sought === pieceId
    ? frozenHandoff(pieceId, pieceSource, controls.identities ?? [], worktree, baseCommit)
    : undefined
}

test('GREEN runs the exact pinned selection in the retained worktree against the implemented revision', async () => {
  await fixture(async (f) => {
    await f.implement()
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')
    expect(green).toBeDefined()
    expect(green!.status).toBe('pass')
    expect(green!.reasonCode).toBe('evidence-current')
  }, { configureHandoff: serveFrozen })
})

test('GREEN fails while the required behavior is still missing', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('fail')
    expect(green.reasonCode).toBe('runner-failed')
  }, { configureHandoff: serveFrozen })
})

test('a changed test file after the freeze refuses GREEN as test drift', async () => {
  await fixture(async (f) => {
    await f.implement()
    await writeFile(join(f.worktree, authoredPath),
      'import { expect, test } from \'vitest\'\nimport { value } from \'../production/value.js\'\ntest(\'required behavior\', () => { expect(value()).toBe(true) })\n')
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('stale')
    expect(green.reasonCode).toBe('stale-tests')
  }, { configureHandoff: serveFrozen })
})

test('a changed imported helper after the freeze refuses GREEN', async () => {
  await fixture(async (f) => {
    await f.implement()
    await writeFile(join(f.worktree, helperPath), 'export function doubled(n) { return n + 2 }\n')
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('stale')
    expect(green.reasonCode).toBe('stale-tests')
  }, { configureHandoff: serveFrozen })
})

test('a changed runner configuration after the freeze refuses GREEN', async () => {
  await fixture(async (f) => {
    await f.implement()
    await writeFile(join(f.worktree, 'vitest.config.mjs'), 'export default { test: { include: ["other/**/*.spec.js"] } }\n')
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).not.toBe('pass')
  }, { configureHandoff: serveFrozen })
})

test('a changed lockfile after the freeze refuses GREEN', async () => {
  await fixture(async (f) => {
    await f.implement()
    await writeFile(join(f.worktree, 'pnpm-lock.yaml'), 'lockfileVersion: 9.1\n')
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).not.toBe('pass')
  }, { configureHandoff: serveFrozen })
})

test('production input drift between capture and completion invalidates GREEN', async () => {
  await fixture(async (f) => {
    await f.implement()
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('pass')
    await writeFile(join(f.worktree, 'production/extra.js'), 'export const extra = 1\n')
    const refreshed = await f.run('worktree')
    expect(refreshed.reportId).not.toBe(report.reportId)
  }, { configureHandoff: serveFrozen })
})

test('unchanged HEAD with dirty working content cannot pass GREEN by HEAD identity alone', async () => {
  await fixture(async (f) => {
    await f.implement()
    const report = await f.run('worktree')
    const green = report.evaluations.find(evaluation => evaluation.check === 'green')!
    expect(green.status).toBe('pass')
    // The worktree HEAD is still the base commit while production/value.js differs from it.
    expect(report.productionManifest.head).toBe(f.handoff.record?.state === 'frozen'
      ? f.handoff.record.worktreeAssignment.baseCommit : report.productionManifest.head)
    expect(report.productionManifest.production.map(identity => identity.path)).toContain('production/value.js')
  }, { configureHandoff: serveFrozen })
})
