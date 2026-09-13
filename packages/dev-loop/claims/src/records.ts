/** Strict durable Claims attempts and terminal observations. @module dsh-dev-loop-claims/records */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { findingSchema, researchSchema } from './research.ts'
import type { ClaimReportId, ClaimVerificationReport } from './types.ts'

/** Committed verification identity; a missing matching terminal report remains unresolved. */
export interface Attempt {
  /** Owner-generated UUID shared with the terminal report. */
  reportId: ClaimReportId
  /** Canonical piece id used as the durable table key. */
  pieceId: string
  /** SHA-256 of the complete decoded piece text. */
  pieceSha256: string
  /** SHA-256 of the complete ordered inventory JSON. */
  inventoryDigest: string
  /** SHA-256 of the complete References observation JSON. */
  referencesDigest: string
  /** Verification start time in Unix milliseconds. */
  checkedAt: number
}

const sha = z.string().regex(/^[a-f0-9]{64}$/)
const pieceId = z.string().regex(/^\d+(?:\.\d+)+$/)
const strings = z.array(z.string())
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const nonnegative = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const identity = {
  reportId: z.uuid(), pieceId, pieceSha256: sha, inventoryDigest: sha, referencesDigest: sha, checkedAt: nonnegative,
}
const references = z.strictObject({
  pieceId, pieceSha256: sha, checkedAt: nonnegative, explicitEmpty: z.boolean(),
  structuralStatus: z.enum(['valid', 'invalid']), inspectionStatus: z.literal('unverified'),
  entries: z.array(z.strictObject({
    row: positive, source: z.string(), sourceText: z.string(), attribution: z.string(),
    rolePreset: z.string().optional(), question: z.string().optional(), inspection: z.string().optional(), usage: z.string().optional(),
    explanatoryColumns: z.record(z.string(), z.string()),
    sourceStatus: z.enum(['resolved', 'missing', 'invalid', 'not-checked']),
    attributionStatus: z.enum(['linked-report', 'unverified', 'contradicted']), inspectionStatus: z.literal('unverified'),
    contentSha256: sha.optional(), lineRange: z.strictObject({ start: positive, end: positive }).optional(),
    fragment: z.string().optional(), limitations: strings,
    delegation: z.strictObject({
      delegationId: z.uuid(), pieceId: z.string(), subagentSessionId: z.string().min(1),
      role: z.enum(['Research', 'Test Writer', 'Implementer', 'Utility']), preset: z.string().min(1).optional(),
      status: z.enum(['completed', 'aborted', 'failed']), limitations: strings,
    }).optional(),
  })),
  errors: z.array(z.strictObject({
    code: z.enum(['MISSING_REFERENCES', 'MALFORMED_REFERENCES', 'INVALID_COLUMNS', 'INVALID_LOCATOR',
      'ABSOLUTE_PATH', 'OUTSIDE_ROOT', 'SOURCE_MISSING', 'SOURCE_NOT_FILE', 'INVALID_RANGE', 'PIECE_TOO_LARGE',
      'SOURCE_TOO_LARGE', 'TOO_MANY_REFERENCES', 'INVALID_DELEGATION_ID']),
    message: z.string(), entryIndex: nonnegative.optional(),
  })), limitations: strings,
})
const attempt = z.strictObject(identity).transform(value => value as Attempt)
const reportFields = z.strictObject({
  ...identity, references, delegationIds: z.array(z.uuid()),
  inventory: z.array(z.strictObject({
    claimId: z.string().regex(/^claim:[a-f0-9]{64}$/), row: positive,
    claim: z.string().min(1), citation: z.string().min(1), howEstablished: z.string().min(1), checkedAgainst: z.string().min(1),
  })),
  inventoryCoverage: researchSchema.shape.inventoryCoverage,
  findings: z.array(findingSchema.extend({
    provenance: z.strictObject({
      kind: z.literal('reported'), role: z.literal('Research'), delegationId: z.uuid(),
      subagentSessionId: z.string().min(1), preset: z.string().min(1).optional(),
    }),
  })),
  additionalClaims: researchSchema.shape.additionalClaims,
  limitations: strings, state: z.enum(['completed', 'failed', 'aborted']),
})

function jsonDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

const report = z.unknown().transform((input, ctx): ClaimVerificationReport => {
  const parsed = reportFields.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path })
    return z.NEVER
  }
  // Preserve original JSON property order: References and inventory digests cover those exact bytes.
  const value = input as ClaimVerificationReport
  const reject = (message: string) => { ctx.addIssue({ code: 'custom', message }) }
  if (value.pieceId !== value.references.pieceId || value.pieceSha256 !== value.references.pieceSha256) {
    reject('Claim report and References must identify the same piece revision.')
  }
  if (value.inventoryDigest !== jsonDigest(value.inventory) || value.referencesDigest !== jsonDigest(value.references)) {
    reject('Claim report inventory and References digests must match their complete JSON.')
  }
  for (const [index, row] of value.inventory.entries()) {
    const expected = `claim:${jsonDigest([value.pieceId, index + 1, row.claim, row.citation, row.howEstablished, row.checkedAgainst])}`
    if (row.row !== index + 1 || row.claimId !== expected) {
      reject('Claim inventory row ordinal and id must match its ordered cell text.')
    }
  }
  if (new Set(value.delegationIds).size !== value.delegationIds.length) {
    reject('Claim report delegation ids must be unique.')
  }
  if (value.state === 'completed') {
    const expected = new Map(value.inventory.map(row => [row.claimId, row.claim]))
    const seen = new Set<string>()
    for (const finding of value.findings) {
      if (seen.has(finding.claimId) || expected.get(finding.claimId) !== finding.claim) {
        reject('Completed claim findings must identify each unchanged inventory claim exactly once.')
      }
      seen.add(finding.claimId)
    }
    if (seen.size !== value.inventory.length) reject('Completed claim findings must cover the complete inventory.')
  }
  return value
})

/** Host-owned latest attempts and terminal reports, each keyed by canonical piece id. */
export const claimsDomain = defineDomain({ name: 'dev_loop_claims', version: 1, layout: 'single',
  tables: { attempts: domainTable<string, Attempt>(attempt), reports: domainTable<string, ClaimVerificationReport>(report) } })
