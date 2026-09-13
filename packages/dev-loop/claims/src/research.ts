/** Whole-outcome Research JSON validation and bounded inventory correspondence. @module dsh-dev-loop-claims/research */
import { z } from 'zod'
import type { Config, InventoryClaim, ResearchReport } from './types.ts'

const nonempty = z.string().min(1)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const candidate = {
  claim: nonempty,
  kind: z.enum(['repository', 'dependency', 'external', 'negative', 'measurement']),
  loadBearing: z.boolean(),
  decisionRestingOnClaim: nonempty,
}
const corpus = z.strictObject({
  contentManifest: z.record(z.string(), digest), versions: z.record(z.string(), nonempty),
  exportEntryPoints: z.array(nonempty), includedDirectories: z.array(nonempty).min(1), exclusions: z.array(nonempty),
  resultCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
const measurement = z.strictObject({
  command: nonempty, environment: z.record(nonempty, nonempty).refine(value => Object.keys(value).length > 0),
  recordedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), result: nonempty,
  reportedExecution: z.enum(['executed', 'not-executed']),
})
/** Untrusted finding fields, without owner-produced provenance. */
export const findingSchema = z.strictObject({
  ...candidate, claimId: z.string().regex(/^claim:[a-f0-9]{64}$/),
  status: z.enum(['supported', 'contradicted', 'unverified']),
  evidence: z.array(z.strictObject({
    locator: nonempty, symbol: nonempty.optional(), version: nonempty.optional(), digest: digest.optional(),
    query: nonempty.optional(), corpus: corpus.optional(), measurement: measurement.optional(), resultSummary: nonempty,
  })),
  limitations: z.array(nonempty),
})
/** Complete Research JSON fields; unknown fields are rejected at every object level. */
export const researchSchema = z.strictObject({
  inventoryCoverage: z.strictObject({ complete: z.boolean(), limitations: z.array(nonempty) }),
  findings: z.array(findingSchema), additionalClaims: z.array(z.strictObject(candidate)),
})

/**
 * Parse one complete JSON value and require one unchanged finding per inventory row.
 * @param text - Entire terminal Research output; fences and surrounding prose are invalid.
 * @param inventory - Owner-parsed inventory in document order.
 * @param limits - Complete evidence UTF-8 and combined finding/candidate count limits.
 * @returns Validated detached report; malformed, mismatched, or oversized reports throw.
 */
export function parseResearchJson(text: string, inventory: InventoryClaim[],
  limits: Pick<Config, 'maxClaims' | 'maxEvidenceBytes'>): ResearchReport {
  const report = researchSchema.parse(JSON.parse(text) as unknown)
  if (report.findings.length + report.additionalClaims.length > limits.maxClaims) {
    throw new Error('Research claim count exceeds maxClaims.')
  }
  if (Buffer.byteLength(JSON.stringify(report.findings.flatMap(finding => finding.evidence))) > limits.maxEvidenceBytes) {
    throw new Error('Research evidence bytes exceed maxEvidenceBytes.')
  }
  const expected = new Map(inventory.map(row => [String(row.claimId), row.claim]))
  const seen = new Set<string>()
  for (const finding of report.findings) {
    if (seen.has(finding.claimId) || expected.get(finding.claimId) !== finding.claim) {
      throw new Error('Research findings must identify each inventory claim exactly once without rewriting it.')
    }
    seen.add(finding.claimId)
  }
  if (seen.size !== inventory.length) throw new Error('Research findings omit inventory claims.')
  // JSON validation establishes the branded claim ids.
  return report as ResearchReport
}
