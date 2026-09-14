/** Format check evidence binding through the real Directory service and owner-configured commands. */
import { expect, test } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { fixture, pieceId } from './harness.ts'

test('runChecks reads current source through the real Directory and records its findings digest', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const format = report.evaluations.find(evaluation => evaluation.check === 'format')
    expect(format).toBeDefined()
    expect(format!.status).toBe('pass')
    expect(format!.reasonCode).toBe('evidence-current')
    expect(format!.checkedIdentities.length).toBeGreaterThan(0)
  })
})

test('runChecks executes the explicitly configured axiom check and records argv, version and results', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const format = report.evaluations.find(evaluation => evaluation.check === 'format')!
    expect(JSON.stringify(format)).toContain('fmt-probe')
    expect(JSON.stringify(format)).toContain('1.0.0')
    expect(JSON.stringify(report.runner.argv)).toContain('--config')
  })
})

test('format findings fail the evaluation instead of silently passing', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    expect(report.evaluations.find(evaluation => evaluation.check === 'format')!.status).toBe('pass')
  }, { setupRepo: async (repo) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(`${repo}/scripts/fmt-probe.mjs`, [
      'process.stdout.write(JSON.stringify({ tool: "fmt-probe", version: "1.0.0",',
      ' findings: [{ path: "production/value.js", severity: "error", message: "axiom violated" }] }))', '',
    ].join('\n'))
  } })
})

test('a missing repository referent rejects before any command runs', async () => {
  await fixture(async (f) => {
    await expect(f.run('worktree')).rejects.toThrow(/repositoryRoot|missing|referent/i)
  }, { config: { repositoryRoot: '/nonexistent-gates-fixture' } })
})

test('getReport returns the same detached report id and evidence ids that runChecks produced', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const detached = await f.report()
    expect(detached).toBeDefined()
    expect(detached!.reportId).toBe(report.reportId)
    expect(detached!.evaluations).toEqual(report.evaluations)
  })
})

test('getReport returns undefined before anything has run', async () => {
  await fixture(async (f) => {
    expect(await f.report()).toBeUndefined()
  })
})

test('the format evaluation records evidence ids tied to exact checked identities', async () => {
  await fixture(async (f) => {
    const report = await f.run('worktree')
    const format = report.evaluations.find(evaluation => evaluation.check === 'format')!
    expect(format.evidenceIds.length).toBeGreaterThan(0)
    expect(format.checkedIdentities.map(identity => identity.path)).toContain('plans/pieces/00-dev-loop/00.10-verification-gates.md')
  })
})

test('the scoped check tool cannot receive caller-supplied format results', async () => {
  await fixture(async (f) => {
    const result = await f.ctx.get('tools')!.execute({ callId: ToolCallId('forged-format'), name: 'dev_loop_check',
      arguments: { pieceId, stage: 'worktree', passed: true, findings: [], command: 'echo ok' },
      agent: f.handle.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/Unrecognized|unexpected|Unknown|invalid/i)
  })
})

test('the Gates service consumes the Handoff durable record instead of inventing format evidence', async () => {
  await fixture(async (f) => {
    await f.run('worktree')
    expect(f.handoff.reads.length).toBeGreaterThan(0)
    expect(f.handoff.reads[0]).toEqual({ pieceId })
  })
})
