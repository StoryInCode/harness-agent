/** Real Loader, Roles, Queue, model, fs and JSON backend; isolated cases simulate only the typed References observation. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import References from '@deepseek-ai/dsh-dev-loop-references'
import type { ProvenanceObservation } from '@deepseek-ai/dsh-dev-loop-references'
import type { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture as rolesFixture, toolConfig } from './roles-harness.ts'
import type { Fixture as RolesFixture } from './roles-harness.ts'
import Claims from '../src/index.ts'
import * as tool from '../src/tool.ts'
import type { ClaimId, Config, InventoryClaim, ResearchReport } from '../src/types.ts'

export const pieceId = '00.06'
export const signal = () => new AbortController().signal
export const sha = (text: string) => createHash('sha256').update(text).digest('hex')
export const cells = ['tracked.txt contains retained evidence', '`tracked.txt`', 'UNVERIFIED', 'fixture source']
export const proof = (rows = [cells]) => '| Claim | Citation | How established | Checked against |\n|---|---|---|---|\n'
  + rows.map(row => `| ${row.join(' | ')} |`).join('\n')
export const inventoryRow = (row = 1, values = cells): InventoryClaim => ({
  claimId: `claim:${sha(JSON.stringify([pieceId, row, ...values]))}` as ClaimId,
  row, claim: values[0]!, citation: values[1]!, howEstablished: values[2]!, checkedAgainst: values[3]!,
})
export const research = (): ResearchReport => ({ inventoryCoverage: { complete: true, limitations: [] },
  findings: [{ claimId: inventoryRow().claimId, claim: cells[0]!, kind: 'repository', loadBearing: true,
    decisionRestingOnClaim: 'Use tracked.txt as retained input', status: 'supported',
    evidence: [{ locator: 'tracked.txt', digest: sha('retained evidence\n'), resultSummary: 'Exact file bytes contain retained evidence.' }], limitations: [] }],
  additionalClaims: [] })
export const response = (report = research()) => textResponse(JSON.stringify(report))
export interface Fixture extends RolesFixture {
  claims: Claims
  filename: string
  source: string
  config: Config
  observation: ProvenanceObservation
  verify(signal?: AbortSignal): ReturnType<Claims['verifyPieceClaims']>
  admit(digest?: string): ReturnType<Claims['requireAdmissible']>
  mountClaims(ctx: Context, overrides?: Partial<Config>): Promise<Claims>
}
export async function fixture(script: ConstructorParameters<typeof MockAdapter>[0], run: (f: Fixture) => Promise<void>,
  options: {
    config?: Partial<Config> | ((source: string) => Partial<Config>)
    proof?: string
    realReferences?: boolean
    queueConcurrency?: number
  } = {}) {
  await rolesFixture(script, async (f) => {
    const filename = join(f.repo, 'plans/pieces/00-dev-loop/00.06-role.md')
    const source = (await readFile(filename, 'utf8'))
      .replace('Private fixture material for Resources and proof.', options.proof ?? proof())
      .replace('Private fixture material for References.', '| Source | Provenance | Decision informed |\n|---|---|---|\n| `tracked.txt` | Parent direct inspection | Retained input |')
    await writeFile(filename, source)
    const observation: ProvenanceObservation = { pieceId, pieceSha256: sha(source), checkedAt: 1,
      explicitEmpty: false, structuralStatus: 'valid', inspectionStatus: 'unverified', errors: [], limitations: [],
      entries: [{ row: 1, source: 'tracked.txt', sourceText: '`tracked.txt`', attribution: 'Parent direct inspection',
        explanatoryColumns: { 'Decision informed': 'Retained input' }, sourceStatus: 'resolved', attributionStatus: 'unverified',
        inspectionStatus: 'unverified', contentSha256: sha('retained evidence\n'), limitations: ['No independent source usage observation.'] }] }
    const config: Config = { repositoryRoot: f.repo, maxPieceBytes: 65_536, maxClaims: 32, maxEvidenceBytes: 32_768,
      maxReportBytes: 131_072, verificationTimeoutMs: 60_000,
      ...(typeof options.config === 'function' ? options.config(source) : options.config) }
    let mounts = 0
    const restore: (() => void)[] = []
    const mountClaims = async (ctx: Context, overrides: Partial<Config> = {}) => {
      Object.assign(ctx.loader.builtins, { references: References, claims: Claims, 'claims-tool': tool })
      const path = join(f.repo, `claims-${++mounts}.yml`)
      await writeFile(path, JSON.stringify([{ name: 'cordis:references', config: { repositoryRoot: f.repo,
        maxPieceBytes: 65_536, maxSourceBytes: 32_768, maxObservationBytes: 131_072, maxReferences: 32 } },
      { name: 'cordis:claims', config: { ...config, ...overrides } }]))
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
      await ctx.loader.await()
      if (!options.realReferences) {
        const spy = vi.spyOn(ctx.get('devLoopReferences')!, 'verifyReferences').mockImplementation(async () => structuredClone(observation))
        restore.push(() => { spy.mockRestore() })
      }
      return ctx.get('devLoopClaims')!
    }
    try {
      const claims = await mountClaims(f.ctx)
      const verify = (abort = signal()) => f.ctx.get('agents')!.withInitiator(f.handle.agent, () => claims.verifyPieceClaims(pieceId, abort))
      const admit = (digest = sha(source)) => claims.requireAdmissible(pieceId, digest, signal())
      await run({ ...f, claims, filename, source, config, observation, mountClaims, verify, admit })
    } finally { for (const undo of restore) undo() }
  }, { maxBriefBytes: 131_072, maxOutcomeBytes: 131_072 }, toolConfig, false, options.queueConcurrency ?? 1)
}
