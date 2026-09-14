/** Post-transfer evidence binding: real mainline execution after explicit transfer, never worktree substitution. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { fixture, authoredPath, helperPath, pieceId, pieceSource, productionPath,
  unrelatedMainlineSource } from './harness.ts'
import { frozenHandoff, readTestIdentities } from './handoff-double.ts'

type Configure = NonNullable<Parameters<typeof fixture>[1]>['configureHandoff']
/** Serve the frozen RED record captured from the retained worktree. */
const serveFrozen: Configure = async (controls, { worktree, baseCommit }) => {
  controls.identities = await readTestIdentities(worktree, [authoredPath, helperPath])
  controls.serve = sought => sought === pieceId
    ? frozenHandoff(pieceId, pieceSource, controls.identities ?? [], worktree, baseCommit)
    : undefined
}

test('worktree GREEN can never satisfy the post-transfer evaluation', async () => {
  await fixture(async (f) => {
    await f.implement()
    const worktreeReport = await f.run('worktree')
    expect(worktreeReport.evaluations.find(evaluation => evaluation.check === 'green')!.status).toBe('pass')
    const report = await f.run('post-transfer')
    const transfer = report.evaluations.find(evaluation => evaluation.check === 'post-transfer')
    expect(transfer).toBeDefined()
    expect(transfer!.status).toBe('fail')
    expect(transfer!.reasonCode).toBe('mainline-not-executed')
  }, { configureHandoff: serveFrozen })
})

test('post-transfer runs the same pinned selection in the mainline after explicit transfer', async () => {
  await fixture(async (f) => {
    await f.implement()
    await f.transfer()
    const report = await f.run('post-transfer')
    const transfer = report.evaluations.find(evaluation => evaluation.check === 'post-transfer')!
    expect(transfer.status).toBe('pass')
    expect(transfer.reasonCode).toBe('evidence-current')
    expect(transfer.stage).toBe('post-transfer')
  }, { configureHandoff: serveFrozen })
})

test('failed or missing mainline execution refuses completion', async () => {
  await fixture(async (f) => {
    const report = await f.run('post-transfer')
    const transfer = report.evaluations.find(evaluation => evaluation.check === 'post-transfer')!
    expect(transfer.status).toBe('fail')
    await expect(f.lifecycle.transition(pieceId, 'pending', 'done')).rejects.toThrow()
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
  }, { configureHandoff: serveFrozen })
})

test('unrelated mainline changes are recorded and tested, not overwritten', async () => {
  await fixture(async (f) => {
    await f.implement()
    await f.transfer()
    const edited = `${unrelatedMainlineSource}A retained mainline edit.\n`
    await writeFile(f.mainline('docs/notes.md'), edited)
    const report = await f.run('post-transfer')
    const transfer = report.evaluations.find(evaluation => evaluation.check === 'post-transfer')!
    expect(transfer.status).toBe('pass')
    expect(await readFile(f.mainline('docs/notes.md'), 'utf8')).toBe(edited)
  }, { configureHandoff: serveFrozen })
})

test('transferred implementation files are validated against the GREEN manifest', async () => {
  await fixture(async (f) => {
    await f.implement()
    await f.transfer()
    // Simulate a divergent mainline implementation that does not match the GREEN manifest.
    await writeFile(join(f.repo, productionPath), 'export function value() { return 42 }\n')
    const report = await f.run('post-transfer')
    const transfer = report.evaluations.find(evaluation => evaluation.check === 'post-transfer')!
    expect(transfer.status).toBe('stale')
    expect(transfer.reasonCode).toBe('transferred-manifest-mismatch')
  }, { configureHandoff: serveFrozen })
})

test('mainline drift after a passing post-transfer run refuses completion', async () => {
  await fixture(async (f) => {
    await f.implement()
    await f.transfer()
    const passing = await f.run('post-transfer')
    expect(passing.evaluations.find(evaluation => evaluation.check === 'post-transfer')!.status).toBe('pass')
    await writeFile(join(f.repo, productionPath), 'export function value() { return false }\n')
    await expect(f.lifecycle.transition(pieceId, 'pending', 'done')).rejects.toThrow()
    expect(f.lifecycle.getStatus(pieceId)).toBe('pending')
  }, { configureHandoff: serveFrozen })
})

test('test drift in the mainline refuses post-transfer even with a green run recorded', async () => {
  await fixture(async (f) => {
    await f.implement()
    await f.transfer()
    await writeFile(join(f.repo, 'tests/behavior.spec.js'), 'test("rewritten", () => {})\n')
    const report = await f.run('post-transfer')
    const transfer = report.evaluations.find(evaluation => evaluation.check === 'post-transfer')!
    expect(transfer.status).not.toBe('pass')
    expect(transfer.reasonCode).toBe('stale-tests')
  }, { configureHandoff: serveFrozen })
})
