/** Approved additive measurement JSON schema; original frozen schema bytes remain unchanged. */
import { z } from 'zod'
import { researchSchema } from './research-schema.ts'
const nonempty = z.string().min(1)
export const reportedMeasurementSchema = z.object({ command: nonempty,
  environment: z.record(nonempty, nonempty).refine(value => Object.keys(value).length > 0),
  recordedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), result: nonempty,
  reportedExecution: z.enum(['executed', 'not-executed']),
}).strict()
const finding = researchSchema.shape.findings.element
export const supplementalResearchSchema = researchSchema.extend({ findings: z.array(finding.extend({
  evidence: z.array(finding.shape.evidence.element.extend({ measurement: reportedMeasurementSchema.optional() })),
})) })
