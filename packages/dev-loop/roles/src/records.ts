/** Durable JSON validation and detached role receipts. @module dsh-dev-loop-roles/records */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { GitCommit, WorktreeAssignmentId } from '@deepseek-ai/dsh-dev-loop-worktree'
import type { SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { DelegationId, DelegationRecord } from './types.ts'

/** Closed role names accepted at model and durable JSON inputs. */
export const roleNames = ['Research', 'Test Writer', 'Implementer', 'Utility'] as const
/** Canonical dotted piece identity, without path or repository authority. */
export const pieceIdSchema = z.string().regex(/^\d+(?:\.\d+)+$/, 'Invalid dotted piece ID')
const briefObject = z.strictObject({
  pieceId: pieceIdSchema,
  role: z.enum(roleNames, { error: 'UNKNOWN_DELEGATION_ROLE' }),
  assignment: z.string().min(1),
  rationale: z.string().min(1),
  verification: z.strictObject({
    claim: z.string().min(1), decisionRestingOnClaim: z.string().min(1),
    permittedSources: z.array(z.string()), requiredEvidence: z.array(z.string()),
  }).optional(),
})
/** Strict model request parser; extra execution-authority fields are rejected and absent fields stay absent. */
export const briefSchema = briefObject.transform(({ verification, ...brief }) => ({
  ...brief, ...verification === undefined ? {} : { verification },
}))
const sessionId = z.string().min(1).transform(value => brandString<SessionId>(value))
const requested = briefObject.extend({
  delegationId: z.uuid().transform(value => brandString<DelegationId>(value)),
  parentSessionId: sessionId,
  provider: z.string().min(1),
  requestedAt: z.number().int().nonnegative(),
  state: z.literal('requested'),
})
const settled = requested.extend({
  state: z.literal('settled'), finishedAt: z.number().int().nonnegative(),
  subagentSessionId: sessionId.optional(), effectivePreset: z.string().min(1).optional(),
  worktreeAssignment: z.strictObject({
    id: z.string().min(1).transform(value => brandString<WorktreeAssignmentId>(value)),
    pieceId: pieceIdSchema, mainlinePath: z.string().min(1), worktreePath: z.string().min(1),
    baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).transform(value => brandString<GitCommit>(value)),
    ownership: z.enum(['created', 'borrowed']),
  }).optional(),
  // Stop reasons are provider-extensible; unknown nonempty reasons remain failed observations.
  stopReason: z.string().min(1).transform(value => value as SubagentStopReason).optional(),
  status: z.enum(['completed', 'aborted', 'failed']), cleanup: z.enum(['quiescent', 'unproven']),
  outcome: z.string(), limitations: z.array(z.string()),
  provenance: z.strictObject({ kind: z.literal('reported'), role: z.enum(roleNames), preset: z.string().min(1).optional() }),
})
/** Authoritative requested/settled records; invalid reopened data refuses the entire domain. */
export const recordSchema: z.ZodType<DelegationRecord> = z.discriminatedUnion('state', [requested, settled]).transform((value) => {
  if (value.state === 'requested') {
    const { verification, ...record } = value
    return { ...record, ...verification === undefined ? {} : { verification } }
  }
  const { verification, subagentSessionId, effectivePreset, worktreeAssignment, stopReason, provenance, ...record } = value
  return {
    ...record, ...verification === undefined ? {} : { verification },
    ...subagentSessionId === undefined ? {} : { subagentSessionId },
    ...effectivePreset === undefined ? {} : { effectivePreset },
    ...worktreeAssignment === undefined ? {} : { worktreeAssignment },
    ...stopReason === undefined ? {} : { stopReason },
    provenance: { kind: provenance.kind, role: provenance.role, ...provenance.preset === undefined ? {} : { preset: provenance.preset } },
  }
})
/** Single Host-owned history domain; requests and terminal observations replace the same row. */
export const rolesDomain = defineDomain({
  name: 'dev_loop_roles', version: 1, layout: 'single',
  tables: { delegations: domainTable<DelegationId, DelegationRecord>(recordSchema) },
})

/**
 * Measure complete owned JSON, including wrappers and UTF-8 expansion.
 * @param value - detached serializable DTO, never a live Harness object.
 * @returns encoded byte count.
 */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
