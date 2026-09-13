/** Typed Roles tool-result JSON traversal for snapshot identities and clocks. */

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function role(value: unknown): boolean {
  return ['Research', 'Test Writer', 'Implementer', 'Utility'].includes(value as string)
}

const requestedKeys = ['pieceId', 'role', 'assignment', 'rationale', 'verification', 'delegationId', 'parentSessionId', 'provider', 'requestedAt', 'state']
const settledKeys = [...requestedKeys, 'finishedAt', 'subagentSessionId', 'effectivePreset', 'worktreeAssignment', 'stopReason', 'status', 'cleanup', 'outcome', 'limitations', 'provenance']

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

function receipt(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !onlyKeys(value, value.state === 'requested' ? requestedKeys : settledKeys)
    || !['delegationId', 'parentSessionId', 'provider', 'assignment', 'rationale'].every(key => typeof value[key] === 'string' && value[key] !== '')
    || !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\{\{delegation:[1-9]\d*\}\})$/i.test(value.delegationId as string)
    || typeof value.pieceId !== 'string' || !/^\d+(?:\.\d+)+$/.test(value.pieceId)
    || !role(value.role) || !Number.isSafeInteger(value.requestedAt) || (value.requestedAt as number) < 0) return false
  if (value.verification !== undefined && (!isRecord(value.verification)
    || !onlyKeys(value.verification, ['claim', 'decisionRestingOnClaim', 'permittedSources', 'requiredEvidence'])
    || typeof value.verification.claim !== 'string' || value.verification.claim === ''
    || typeof value.verification.decisionRestingOnClaim !== 'string' || value.verification.decisionRestingOnClaim === ''
    || !strings(value.verification.permittedSources) || !strings(value.verification.requiredEvidence))) return false
  if (value.state === 'requested') return true
  if (value.state !== 'settled' || !Number.isSafeInteger(value.finishedAt) || (value.finishedAt as number) < 0
    || !['completed', 'aborted', 'failed'].includes(value.status as string)
    || !['quiescent', 'unproven'].includes(value.cleanup as string)
    || typeof value.outcome !== 'string' || !strings(value.limitations)
    || !isRecord(value.provenance) || !onlyKeys(value.provenance, ['kind', 'role', 'preset'])
    || value.provenance.kind !== 'reported' || !role(value.provenance.role)
    || value.provenance.preset !== undefined && (typeof value.provenance.preset !== 'string' || value.provenance.preset === '')) return false
  for (const key of ['subagentSessionId', 'effectivePreset', 'stopReason']) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key] === '')) return false
  }
  if (value.worktreeAssignment !== undefined) {
    const assignment = value.worktreeAssignment
    if (!isRecord(assignment) || !onlyKeys(assignment, ['id', 'pieceId', 'mainlinePath', 'worktreePath', 'baseCommit', 'ownership'])
      || typeof assignment.pieceId !== 'string' || !/^\d+(?:\.\d+)+$/.test(assignment.pieceId)
      || !['id', 'pieceId', 'mainlinePath', 'worktreePath'].every(key => typeof assignment[key] === 'string' && assignment[key] !== '')
      || typeof assignment.baseCommit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(assignment.baseCommit)
      || !['created', 'borrowed'].includes(assignment.ownership as string)) return false
  }
  return true
}

/**
 * Visit validated JSON receipts only in successful, named Roles tool results.
 * @param records - one Session's parsed records, including tool calls.
 * @param visit - mutate only the receipt fields owned by the caller.
 */
export function visitRolesRecords(records: readonly Record<string, unknown>[], visit: (record: Record<string, unknown>) => void): void {
  const calls = new Map<unknown, string>()
  for (const record of records) {
    if (record.type === 'tool/call' && isRecord(record.data) && typeof record.data.name === 'string') {
      calls.set(record.data.callId, record.data.name)
    }
    if (record.type !== 'tool/result' || !isRecord(record.data) || !isRecord(record.data.message)
      || !Array.isArray(record.data.message.content)) continue
    for (const block of record.data.message.content) {
      if (!isRecord(block) || block.type !== 'tool-result' || block.isError === true || !Array.isArray(block.content)) continue
      const name = calls.get(block.toolCallId)
      if (name !== 'dev_loop_delegate' && name !== 'dev_loop_delegations') continue
      for (const content of block.content) {
        if (!isRecord(content) || content.type !== 'text' || typeof content.text !== 'string') continue
        let parsed: unknown
        try { parsed = JSON.parse(content.text) }
        catch { continue /* Non-JSON tool diagnostics are not Roles receipts. */ }
        const values = name === 'dev_loop_delegations' && Array.isArray(parsed) ? parsed : [parsed]
        if ((name === 'dev_loop_delegations') !== Array.isArray(parsed) || !values.every(receipt)) continue
        for (const value of values) visit(value)
        content.text = JSON.stringify(parsed)
      }
    }
  }
}
