/** Frozen untrusted Research JSON schema; production must validate independently. */
import { z } from 'zod'
const nonempty = z.string().min(1)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const kind = z.enum(['repository', 'dependency', 'external', 'negative', 'measurement'])
const candidate = { claim: nonempty, kind, loadBearing: z.boolean(), decisionRestingOnClaim: nonempty }
const corpus = z.object({ contentManifest: z.record(z.string(), digest), versions: z.record(z.string(), nonempty),
  exportEntryPoints: z.array(nonempty), includedDirectories: z.array(nonempty).min(1), exclusions: z.array(nonempty),
  resultCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict()
export const researchSchema = z.object({
  inventoryCoverage: z.object({ complete: z.boolean(), limitations: z.array(nonempty) }).strict(),
  findings: z.array(z.object({ ...candidate, claimId: z.string().regex(/^claim:[a-f0-9]{64}$/),
    status: z.enum(['supported', 'contradicted', 'unverified']),
    evidence: z.array(z.object({ locator: nonempty, symbol: nonempty.optional(), version: nonempty.optional(),
      digest: digest.optional(), query: nonempty.optional(), corpus: corpus.optional(), resultSummary: nonempty }).strict()),
    limitations: z.array(nonempty) }).strict()),
  additionalClaims: z.array(z.object(candidate).strict()),
}).strict()
