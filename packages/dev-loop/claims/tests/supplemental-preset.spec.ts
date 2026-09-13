/** Actual inherited preset identity remains distinct from the parent's original creation label. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import Claims from '../src/index.ts'
import References from '@deepseek-ai/dsh-dev-loop-references'
import { fixture as rolesFixture, toolConfig } from './roles-harness.ts'
import { pieceId, proof, response, sha, signal } from './harness.ts'

it('retains the actual recomposed Research preset rather than the stale parent header label', async () => {
  await rolesFixture([response()], async (f) => {
    const filename = join(f.repo, 'plans/pieces/00-dev-loop/00.06-role.md')
    const source = (await readFile(filename, 'utf8'))
      .replace('Private fixture material for Resources and proof.', proof())
      .replace('Private fixture material for References.',
        '| Source | Provenance | Decision informed |\n|---|---|---|\n| `tracked.txt` | Parent direct inspection | Retained input |')
    await writeFile(filename, source)
    Object.assign(f.ctx.loader.builtins, { 'supplemental-references': References, 'supplemental-claims': Claims })
    const configFile = join(f.repo, 'supplemental-preset-claims.yml')
    await writeFile(configFile, JSON.stringify([
      { name: 'cordis:supplemental-references', config: { repositoryRoot: f.repo, maxPieceBytes: 65_536,
        maxSourceBytes: 32_768, maxObservationBytes: 131_072, maxReferences: 32 } },
      { name: 'cordis:supplemental-claims', config: { repositoryRoot: f.repo, maxPieceBytes: 65_536, maxClaims: 32,
        maxEvidenceBytes: 32_768, maxReportBytes: 131_072, verificationTimeoutMs: 60_000 } },
    ]))
    await f.ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configFile).href } })
    await f.ctx.loader.await()
    expect(f.handle.agent.session.header.agentPreset).toBe('original')
    await f.ctx.get('agentPresets')!.recompose(f.handle.agent.ctx, 'actual')
    expect(f.handle.agent.session.header.agentPreset).toBe('original')
    const claims = f.ctx.get('devLoopClaims')!
    const report = await f.ctx.get('agents')!.withInitiator(f.handle.agent, () => claims.verifyPieceClaims(pieceId, signal()))
    const history = await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ state: 'settled', effectivePreset: 'actual',
      provenance: { kind: 'reported', role: 'Research', preset: 'actual' } })
    expect(report.findings[0]!.provenance).toMatchObject({ kind: 'reported', role: 'Research', preset: 'actual' })
    expect(await claims.requireAdmissible(pieceId, sha(source), signal())).toEqual(report)
  }, { maxBriefBytes: 131_072, maxOutcomeBytes: 131_072 }, toolConfig, true)
})
