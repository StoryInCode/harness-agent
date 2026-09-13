/** Authoritative observation JSON validation. @module dsh-dev-loop-references/records */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ProvenanceObservation } from './types.ts'

const sha = z.string().regex(/^[a-f0-9]{64}$/)
const strings = z.array(z.string())
const observation = z.strictObject({
  pieceId: z.string().regex(/^\d+(?:\.\d+)+$/), pieceSha256: sha,
  checkedAt: z.number().int().nonnegative(), explicitEmpty: z.boolean(),
  structuralStatus: z.enum(['valid', 'invalid']), inspectionStatus: z.literal('unverified'),
  entries: z.array(z.strictObject({
    row: z.number().int().positive(), source: z.string(), sourceText: z.string(), attribution: z.string(),
    rolePreset: z.string().optional(), question: z.string().optional(), inspection: z.string().optional(), usage: z.string().optional(),
    explanatoryColumns: z.record(z.string(), z.string()),
    sourceStatus: z.enum(['resolved', 'missing', 'invalid', 'not-checked']),
    attributionStatus: z.enum(['linked-report', 'unverified', 'contradicted']), inspectionStatus: z.literal('unverified'),
    contentSha256: sha.optional(),
    lineRange: z.strictObject({ start: z.number().int().positive(), end: z.number().int().positive() }).optional(),
    fragment: z.string().optional(), limitations: strings,
    delegation: z.strictObject({ delegationId: z.uuid(), pieceId: z.string(), subagentSessionId: z.string().min(1),
      role: z.enum(['Research', 'Test Writer', 'Implementer', 'Utility']), preset: z.string().min(1).optional(),
      status: z.enum(['completed', 'aborted', 'failed']), limitations: strings }).optional(),
  })),
  errors: z.array(z.strictObject({ code: z.enum(['MISSING_REFERENCES', 'MALFORMED_REFERENCES', 'INVALID_COLUMNS',
    'INVALID_LOCATOR', 'ABSOLUTE_PATH', 'OUTSIDE_ROOT', 'SOURCE_MISSING', 'SOURCE_NOT_FILE', 'INVALID_RANGE',
    'PIECE_TOO_LARGE', 'SOURCE_TOO_LARGE', 'TOO_MANY_REFERENCES', 'INVALID_DELEGATION_ID']),
  message: z.string(), entryIndex: z.number().int().nonnegative().optional() })), limitations: strings,
})
// JSON validation establishes branded ids and optional DTO fields before domain admission.
const schema = observation.transform(value => value as unknown as ProvenanceObservation)
/** Single Host-owned latest-observation domain. */
export const referencesDomain = defineDomain({ name: 'dev_loop_references', version: 1, layout: 'single',
  tables: { observations: domainTable<string, ProvenanceObservation>(schema) } })
