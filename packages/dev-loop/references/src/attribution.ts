/** Exact Roles report linkage without claiming source inspection. @module dsh-dev-loop-references/attribution */
import { z } from 'zod'
import type { DelegationRecord, DevLoopRole } from '@deepseek-ai/dsh-dev-loop-roles'
import type { ReferenceEntry, ReferenceError } from './types.ts'

const delegationIdSchema = z.uuid()
const canonicalRoles: readonly DevLoopRole[] = ['Research', 'Test Writer', 'Implementer', 'Utility']
const inspectionLimitation = 'Report attribution does not independently establish source inspection or source usage.'

/**
 * Mutate owner-produced entries with exact report identities and explicit evidence limitations.
 * @param entries - owned parsed entries; source observations remain unchanged.
 * @param records - detached history from this piece's single Roles getDelegations(pieceId) call, never other pieces.
 * @returns indexed malformed delegation-token errors; unavailable or contradictory evidence is not a structural error.
 */
export function attributeEntries(entries: ReferenceEntry[], records: readonly DelegationRecord[]): ReferenceError[] {
  const errors: ReferenceError[] = []
  const history = new Map(records.map(record => [String(record.delegationId), record]))
  for (const [entryIndex, entry] of entries.entries()) {
    entry.attributionStatus = 'unverified'
    entry.inspectionStatus = 'unverified'
    delete entry.delegation
    const limitations = new Set(entry.limitations)
    limitations.add(inspectionLimitation)
    const text = [entry.rolePreset, entry.attribution].filter(value => value !== undefined).join(' ')
    const ids = [...text.matchAll(/(?:^|\s)delegation:([^\s]*)/g)].map(match => match[0].slice(match[0].indexOf(':') + 1))
    const invalid = ids.some(id => !delegationIdSchema.safeParse(id).success)
    if (invalid) {
      errors.push({ code: 'INVALID_DELEGATION_ID', message: 'Delegation tokens must contain a complete UUID.', entryIndex })
    }
    const distinctIds = new Set(ids)
    const [id] = ids
    const record = !invalid && distinctIds.size === 1 && id !== undefined ? history.get(id) : undefined
    if (record?.state === 'settled' && record.subagentSessionId !== undefined) {
      entry.delegation = {
        delegationId: record.delegationId,
        pieceId: record.pieceId,
        subagentSessionId: record.subagentSessionId,
        role: record.role,
        ...(record.effectivePreset === undefined ? {} : { preset: record.effectivePreset }),
        status: record.status,
        limitations: [...record.limitations],
      }
      for (const limitation of record.limitations) limitations.add(limitation)
      const roles = canonicalRoles.filter(role =>
        entry.rolePreset?.trim() === role || new RegExp(`(?:^|\\s)role:${role}(?=\\s|$)`).test(text))
      const presets = [...text.matchAll(/(?:^|\s)preset:([^\s]+)/g)].map(match => match[0].slice(match[0].indexOf(':') + 1))
      const contradicted = roles.some(role => role !== record.role)
        || (record.effectivePreset !== undefined && presets.some(preset => preset !== record.effectivePreset))
      if (contradicted) {
        entry.attributionStatus = 'contradicted'
        limitations.add('An asserted role or preset contradicts the recorded report identity.')
      } else if (presets.length > 0 && record.effectivePreset === undefined) {
        limitations.add('The asserted preset is unverified because no actual preset was recorded.')
      } else {
        entry.attributionStatus = 'linked-report'
      }
    } else {
      limitations.add(ids.length === 0
        ? 'Attribution prose is an assertion without an exact delegation link.'
        : distinctIds.size > 1
          ? 'Multiple delegation ids do not identify one report.'
          : 'No settled report with an actual child identity is available for this piece and delegation id.')
    }
    entry.limitations = [...limitations]
  }
  return errors
}
