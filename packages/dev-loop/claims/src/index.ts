/** Revision-bound Research evidence with durable fail-closed admission. @module dsh-dev-loop-claims */
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-dev-loop-directory'
import type {} from '@deepseek-ai/dsh-dev-loop-roles'
import type {} from '@deepseek-ai/dsh-dev-loop-references'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { parseInventory } from './inventory.ts'
import { parseResearchJson } from './research.ts'
import { claimsDomain } from './records.ts'
import type { Attempt } from './records.ts'
import { checkEvidence, fingerprint, readSource } from './evidence.ts'
import type { Config, ClaimReportId, ClaimVerificationReport } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopClaims: DevLoopClaims }
}
const positive = z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required()
const outstanding = () => new Error('CLAIM_VERIFICATION_OUTSTANDING: current supported evidence is required')
const stale = () => new Error('CLAIM_REPORT_STALE: source or evidence identity changed')

/** Reads approved source and retains attributed evidence before admission. */
export class DevLoopClaims extends Service {
  static inject = ['agents', 'devLoopDirectory', 'devLoopRoles', 'devLoopReferences', 'fs', 'storageDomain']
  static Config: z<Config> = z.object({
    repositoryRoot: z.string().pattern(/\S/).required(), maxPieceBytes: positive, maxClaims: positive,
    maxEvidenceBytes: positive, maxReportBytes: positive, verificationTimeoutMs: positive,
  })
  private readonly config: Config
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly verifying = new Set<string>()
  private attempts!: KvTable<string, Attempt>
  private reports!: KvTable<string, ClaimVerificationReport>

  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopClaims')
    this.config = DevLoopClaims.Config(config)
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(claimsDomain)
    this.attempts = domain.table('attempts')
    this.reports = domain.table('reports')
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Claims service disposed'))
      await Promise.allSettled(this.operations)
      await domain.close()
    })
  }

  /**
   * Inventory the actual piece and persist intent before Research, then terminal evidence before return.
   * @param pieceId - Canonical approved piece identifier.
   * @param signal - Cancellation lifetime; admitted cleanup and writes remain joined.
   * @returns Detached owner-produced report, including failed observations.
   */
  async verifyPieceClaims(pieceId: string, signal: AbortSignal): Promise<ClaimVerificationReport> {
    this.lifetime.signal.throwIfAborted()
    this.validatePieceId(pieceId)
    const caller = this.ctx.agents.requireInitiator()
    if (this.ctx.agents.get(caller.id) !== caller) throw new Error('Claims requires an exact live initiator')
    if (this.verifying.has(pieceId)) throw new Error('Claim verification already in progress for this piece')
    this.verifying.add(pieceId)
    const deadline = new AbortController()
    const started = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const remaining = this.config.verificationTimeoutMs - (performance.now() - started)
      if (remaining <= 0) { deadline.abort(new Error('Claim verification deadline timed out')); return }
      timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647))
    }
    schedule()
    const combined = AbortSignal.any([signal, this.lifetime.signal, deadline.signal])
    try { return await this.track(this.verify(caller, pieceId, combined)) }
    finally { clearTimeout(timer); this.verifying.delete(pieceId) }
  }

  /**
   * Read the last retained observation without approving changed source.
   * @param pieceId - Canonical piece identifier.
   * @returns Detached latest terminal report, or undefined for absent/incomplete attempts.
   */
  getReport(pieceId: string): Promise<ClaimVerificationReport | undefined> {
    return Promise.resolve().then(() => {
      this.lifetime.signal.throwIfAborted()
      this.validatePieceId(pieceId)
      return this.readReport(pieceId)
    })
  }

  /**
   * Recheck exact piece and evidence identities; unresolved work rejects OUTSTANDING, changed identity STALE.
   * @param pieceId - Canonical piece identifier.
   * @param pieceDigest - Caller-captured raw SHA-256 of approved source.
   * @param signal - Cancellation lifetime for rechecks.
   * @returns Current admissible report only, never an exception-authorized report.
   */
  requireAdmissible(pieceId: string, pieceDigest: string, signal: AbortSignal): Promise<ClaimVerificationReport> {
    return this.track(this.admit(pieceId, pieceDigest, AbortSignal.any([signal, this.lifetime.signal])))
  }

  private async track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    try { return await operation }
    finally { this.operations.delete(operation) }
  }

  private validatePieceId(pieceId: string): void {
    if (!/^\d+(?:\.\d+)+$/.test(pieceId)) throw new Error('Invalid canonical piece id')
  }

  private readReport(pieceId: string): ClaimVerificationReport | undefined {
    const attempt = this.attempts.get(pieceId)
    const report = this.reports.get(pieceId)
    if (!attempt || !report || attempt.reportId !== report.reportId) return undefined
    if (attempt.pieceId !== pieceId || report.pieceId !== pieceId || attempt.pieceSha256 !== report.pieceSha256
      || attempt.inventoryDigest !== report.inventoryDigest || attempt.referencesDigest !== report.referencesDigest
      || attempt.checkedAt !== report.checkedAt) throw new Error('Invalid durable Claims attempt/report identity')
    return structuredClone(report)
  }

  private async source(pieceId: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const piece = await this.ctx.devLoopDirectory.getPiece(pieceId)
    return readSource(this.ctx.fs, piece.path, this.config.repositoryRoot, this.config.maxPieceBytes, signal)
  }

  private async verify(caller: Agent, pieceId: string, signal: AbortSignal): Promise<ClaimVerificationReport> {
    const source = await this.source(pieceId, signal)
    const inventory = parseInventory(pieceId, source, this.config.maxClaims)
    const references = await this.ctx.devLoopReferences.verifyReferences(pieceId, signal)
    signal.throwIfAborted()
    const attempt: Attempt = {
      reportId: randomUUID() as ClaimReportId, pieceId, pieceSha256: fingerprint(source),
      inventoryDigest: fingerprint(JSON.stringify(inventory)), referencesDigest: fingerprint(JSON.stringify(references)),
      checkedAt: Date.now(),
    }
    await this.attempts.put(pieceId, attempt)
    const report: ClaimVerificationReport = {
      ...attempt, references, delegationIds: [], inventory, inventoryCoverage: { complete: false, limitations: [] },
      findings: [], additionalClaims: [], limitations: [], state: 'failed',
    }
    try {
      const delegation = await this.ctx.agents.withInitiator(caller, () => this.ctx.devLoopRoles.delegate({
        pieceId, role: 'Research', rationale: 'Verify all load-bearing premises before authoring.',
        assignment: this.assignment(report, source),
        verification: {
          claim: inventory.length ? inventory.map(row => row.claim).join('\n') : 'The full piece contains no load-bearing claims.',
          decisionRestingOnClaim: 'Whether every premise of this complete piece has adequate revision-bound evidence for authoring.',
          permittedSources: [this.config.repositoryRoot, 'Explicitly cited immutable external sources'],
          requiredEvidence: ['Exact file digests, installed versions and export entry points; actual reported provenance.',
            'Complete inventory coverage, omitted candidates, decision-scoped limitations, and exactly one strict Research JSON object.'],
        },
      }, signal))
      report.delegationIds = [delegation.delegationId]
      if (delegation.status !== 'completed' || delegation.cleanup !== 'quiescent' || !delegation.subagentSessionId) {
        report.state = signal.aborted || delegation.status === 'aborted' ? 'aborted' : 'failed'
        report.limitations = [...delegation.limitations, `Research ${delegation.status}; cleanup ${delegation.cleanup}.`]
      } else {
        const parsed = parseResearchJson(delegation.outcome, inventory, this.config)
        report.limitations = [...delegation.limitations]
        report.inventoryCoverage = parsed.inventoryCoverage
        report.additionalClaims = parsed.additionalClaims
        const subagentSessionId = delegation.subagentSessionId
        report.findings = parsed.findings.map(finding => ({ ...finding, provenance: {
          kind: 'reported', role: 'Research', delegationId: delegation.delegationId, subagentSessionId,
          ...delegation.effectivePreset === undefined ? {} : { preset: delegation.effectivePreset },
        } }))
        for (const finding of report.findings) {
          if (finding.status !== 'supported') continue
          const issues = await checkEvidence(this.ctx.fs, finding, this.config, signal)
          if (issues.length) { finding.status = 'unverified'; finding.limitations.push(...issues) }
        }
        report.state = 'completed'
      }
      if (signal.aborted) {
        report.state = 'aborted'
        report.limitations.push(signal.reason instanceof Error ? signal.reason.message : 'Claim verification cancelled')
      }
    } catch (error) {
      report.state = signal.aborted ? 'aborted' : 'failed'
      report.limitations.push(error instanceof Error ? error.message : String(error))
    }
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') > this.config.maxReportBytes) {
      throw new Error('Complete report exceeds maxReportBytes limit; intent remains unresolved')
    }
    await this.reports.put(pieceId, report)
    return structuredClone(report)
  }

  private assignment(report: ClaimVerificationReport, source: string): string {
    return `Assess the full source and every explicit claim. Report id: ${report.reportId}\nInventory: ${JSON.stringify(report.inventory)}\n`
      + 'Do not rewrite the approved source. Preserve claimId and exact claim text. Assess omitted load-bearing premises. '
      + 'Negative support covers only the recorded corpus and query; broader required absence remains unverified. '
      + 'Every export entry point needs an explicit content-manifest digest. Measurements require an exact local log digest '
      + 'and reported execution metadata; scope results to the recorded environment and time, never current performance. '
      + 'Return exactly one JSON object, without fences or surrounding prose, with no unknown fields:\n'
      + '{"inventoryCoverage":{"complete":boolean,"limitations":string[]},"findings":[{"claimId":string,"claim":string,'
      + '"kind":"repository"|"dependency"|"external"|"negative"|"measurement","loadBearing":boolean,'
      + '"decisionRestingOnClaim":string,"status":"supported"|"contradicted"|"unverified",'
      + '"evidence":[{"locator":string,"symbol"?:string,"version"?:string,"digest"?:SHA256,"query"?:string,'
      + '"corpus"?:{"contentManifest":Record<string,SHA256>,"versions":Record<string,string>,"exportEntryPoints":string[],'
      + '"includedDirectories":string[],"exclusions":string[],"resultCount":number},'
      + '"measurement"?:{"command":string,"environment":Record<string,string>,"recordedAt":number,"result":string,'
      + '"reportedExecution":"executed"|"not-executed"},"resultSummary":string}],"limitations":string[]}],'
      + '"additionalClaims":[{"claim":string,"kind":"repository"|"dependency"|"external"|"negative"|"measurement",'
      + '"loadBearing":boolean,"decisionRestingOnClaim":string}]}\nFull source:\n' + source
  }

  private async admit(pieceId: string, pieceDigest: string, signal: AbortSignal): Promise<ClaimVerificationReport> {
    signal.throwIfAborted()
    this.validatePieceId(pieceId)
    const report = this.readReport(pieceId)
    if (!report || this.verifying.has(pieceId)) throw outstanding()
    if (pieceDigest !== report.pieceSha256 || fingerprint(await this.source(pieceId, signal)) !== report.pieceSha256) throw stale()
    if (report.state !== 'completed' || report.limitations.length > 0 || !report.inventoryCoverage.complete
      || (report.inventory.length === 0 && report.inventoryCoverage.limitations.length === 0)
      || (report.inventory.length > 0 && report.inventoryCoverage.limitations.length > 0)
      || report.additionalClaims.some(claim => claim.loadBearing)
      || report.findings.some(finding => finding.status === 'contradicted'
        || (finding.loadBearing && (finding.status !== 'supported' || finding.limitations.length > 0)))) throw outstanding()
    const references = await this.ctx.devLoopReferences.verifyReferences(pieceId, signal)
    if (references.pieceSha256 !== report.pieceSha256) throw stale()
    if (references.structuralStatus !== 'valid' || report.references.structuralStatus !== 'valid'
      || references.entries.some(entry => entry.attributionStatus === 'contradicted')
      || report.references.entries.some(entry => entry.attributionStatus === 'contradicted')) throw outstanding()
    if (JSON.stringify(references.entries.map(entry => [entry.source, entry.contentSha256]))
      !== JSON.stringify(report.references.entries.map(entry => [entry.source, entry.contentSha256]))) throw stale()
    const history = await this.ctx.devLoopRoles.getDelegations(pieceId)
    if (report.delegationIds.length !== 1) throw outstanding()
    const delegation = history.find(record => record.delegationId === report.delegationIds[0])
    if (!delegation || delegation.state !== 'settled' || delegation.pieceId !== pieceId || delegation.role !== 'Research'
      || delegation.status !== 'completed' || delegation.cleanup !== 'quiescent' || !delegation.subagentSessionId
      || delegation.limitations.length > 0) throw outstanding()
    let parsed: ReturnType<typeof parseResearchJson>
    try { parsed = parseResearchJson(delegation.outcome, report.inventory, this.config) }
    catch { throw outstanding() } // Malformed durable Research text cannot authorize handoff.
    if (!isDeepStrictEqual(parsed.inventoryCoverage, report.inventoryCoverage)
      || !isDeepStrictEqual(parsed.additionalClaims, report.additionalClaims)) throw outstanding()
    for (const finding of report.findings) {
      if (finding.provenance.delegationId !== delegation.delegationId
        || delegation.subagentSessionId !== finding.provenance.subagentSessionId
        || delegation.effectivePreset !== finding.provenance.preset) throw outstanding()
      const original = parsed.findings.find(row => row.claimId === finding.claimId)
      const { provenance: _, ...retained } = finding
      if (!original || !isDeepStrictEqual({ ...retained, status: original.status, limitations: original.limitations }, original)
        || (finding.status !== original.status && !(original.status === 'supported' && finding.status === 'unverified'))
        || !original.limitations.every((limitation, index) => finding.limitations[index] === limitation)) throw outstanding()
      if (finding.status === 'supported' && (await checkEvidence(this.ctx.fs, finding, this.config, signal)).length) throw stale()
    }
    signal.throwIfAborted()
    if (this.readReport(pieceId)?.reportId !== report.reportId || this.verifying.has(pieceId)) throw outstanding()
    return structuredClone(report)
  }
}
export default DevLoopClaims
