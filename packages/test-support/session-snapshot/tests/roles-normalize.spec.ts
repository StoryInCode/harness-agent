import { describe, expect, it } from 'vitest'
import { redactSessionSnapshotIds } from '../src/identity.ts'
import { visitRolesRecords } from '../src/roles-records.ts'
import { normalizeSessionSnapshots, scrubSessionSnapshot, tokenizeSessionFixtureCwd } from '../src/normalize.ts'

const parent = '11111111-1111-4111-8111-111111111111'
const child = '22222222-2222-4222-8222-222222222222'
const delegation = '33333333-3333-4333-8333-333333333333'
const assignment = '44444444-4444-4444-8444-444444444444'
const ctx = { cwd: '/tmp/private-roles', sessionIds: [parent, child] }
const receipt = {
  delegationId: delegation, parentSessionId: parent, subagentSessionId: child,
  pieceId: '00.06', role: 'Implementer', assignment: 'Implement one piece', rationale: 'Needed',
  provider: 'in-process', requestedAt: 100, finishedAt: 200, state: 'settled',
  effectivePreset: 'implementer', status: 'failed', stopReason: 'provider-error', cleanup: 'unproven',
  outcome: 'Error: failed after 37ms', limitations: ['No direct verification'],
  provenance: { kind: 'reported', role: 'Implementer', preset: 'implementer' },
  worktreeAssignment: { id: assignment, pieceId: '00.06', mainlinePath: ctx.cwd,
    worktreePath: `${ctx.cwd}/.worktrees/00.06`, baseCommit: 'a'.repeat(40), ownership: 'created' },
}
const jsonl = (records: unknown[]) => records.map(record => JSON.stringify(record)).join('\n') + '\n'
function result(callId: string, text: string, isError = false) {
  return { type: 'tool/result', data: { durationMs: 37, message: { role: 'tool', content: [
    { type: 'tool-result', toolCallId: callId, isError, content: [{ type: 'text', text }] },
  ] } } }
}
function log(text = JSON.stringify(receipt)) {
  return jsonl([
    { type: 'session', id: parent, cwd: ctx.cwd },
    { type: 'tool/call', data: { callId: 'delegate', name: 'dev_loop_delegate' } },
    result('delegate', text),
    { type: 'tool/call', data: { callId: 'history', name: 'dev_loop_delegations' } },
    result('history', JSON.stringify([receipt])),
  ])
}
function texts(log: string): string[] {
  return log.trim().split('\n').map(line => JSON.parse(line) as {
    type: string
    data: { message: { content: [{ content: [{ text: string }] }] } }
  })
    .filter(record => record.type === 'tool/result')
    .map(record => record.data.message.content[0].content[0].text)
}

describe('Roles receipt snapshot normalization', () => {
  it('leaves malformed receipt JSON byte-identical rather than normalizing a partial history', () => {
    const invalid: unknown[] = [
      null, [], { ...receipt, extra: 'unknown field' },
      { ...receipt, requestedAt: -1 }, { ...receipt, role: 'Unknown' },
      { ...receipt, verification: { claim: 'Claim', decisionRestingOnClaim: 'Decision', permittedSources: [], requiredEvidence: [42] } },
      { ...receipt, state: 'running' }, { ...receipt, finishedAt: -1 },
      { ...receipt, status: 'unknown' }, { ...receipt, cleanup: 'unknown' },
      { ...receipt, outcome: null }, { ...receipt, limitations: [42] },
      { ...receipt, provenance: { kind: 'inspected', role: 'Implementer' } },
      { ...receipt, provenance: { kind: 'reported', role: 'Implementer', preset: '' } },
      { ...receipt, subagentSessionId: '' }, { ...receipt, effectivePreset: 42 }, { ...receipt, stopReason: null },
      { ...receipt, worktreeAssignment: { ...receipt.worktreeAssignment, baseCommit: 'not-a-commit' } },
      { ...receipt, worktreeAssignment: { ...receipt.worktreeAssignment, ownership: 'unknown' } },
    ]
    for (const value of invalid) {
      for (const name of ['dev_loop_delegate', 'dev_loop_delegations']) {
        const text = JSON.stringify(name === 'dev_loop_delegate' ? value : [receipt, value], null, 2)
        const records = [{ type: 'tool/call', data: { callId: 'call', name } }, result('call', text)]
        const before = JSON.stringify(records)
        const visited: unknown[] = []
        visitRolesRecords(records, item => visited.push(item))
        expect(visited).toEqual([])
        expect(JSON.stringify(records)).toBe(before)
      }
    }
  })

  it('accepts a settled failure without invented child, preset, stop reason, or worktree fields', () => {
    const minimal: Record<string, unknown> = { ...receipt, provenance: { kind: 'reported', role: 'Implementer' } }
    delete minimal.subagentSessionId
    delete minimal.effectivePreset
    delete minimal.stopReason
    delete minimal.worktreeAssignment
    const source = jsonl([{ type: 'session', id: parent },
      { type: 'tool/call', data: { callId: 'delegate', name: 'dev_loop_delegate' } },
      result('delegate', JSON.stringify(minimal))])
    expect(JSON.parse(texts(scrubSessionSnapshot(source))[0]!)).toEqual({ ...minimal, requestedAt: 0, finishedAt: 0 })
  })

  it('requires a matching named call and text result block before inspecting receipt JSON', () => {
    const text = JSON.stringify(receipt)
    const content = { type: 'text', text }
    const block = { type: 'tool-result', toolCallId: 'call', content: [content] }
    const records: Record<string, unknown>[] = [
      result('call', text),
      { type: 'tool/call', data: null },
      { type: 'tool/call', data: { callId: 'call', name: 42 } },
      { type: 'tool/call', data: { callId: 'call', name: 'dev_loop_delegate' } },
      { type: 'tool/result', data: null },
      { type: 'tool/result', data: { message: null } },
      { type: 'tool/result', data: { message: { content: null } } },
      { type: 'tool/result', data: { message: { content: [null,
        { ...block, type: 'text' }, { ...block, isError: true }, { ...block, content: null },
        { ...block, toolCallId: 'unmatched' },
        { ...block, content: [null, { ...content, type: 'reasoning' }, { type: 'text', text: 42 }] },
      ] } } },
      result('call', JSON.stringify([receipt])),
      { type: 'tool/call', data: { callId: 'history', name: 'dev_loop_delegations' } },
      result('history', text),
    ]
    const before = JSON.stringify(records)
    const visited: unknown[] = []
    visitRolesRecords(records, item => visited.push(item))
    expect(visited).toEqual([])
    expect(JSON.stringify(records)).toBe(before)
  })

  it('preserves Roles identifiers quoted in nested semantic fields while tokenizing their identity fields', () => {
    const nested = { ...receipt, outcome: `Reported delegation ${delegation}`,
      limitations: [`Assignment ${assignment} remains unverified`],
      verification: { claim: delegation, decisionRestingOnClaim: assignment,
        permittedSources: [delegation], requiredEvidence: [assignment] } }
    const source = jsonl([{ type: 'session', id: parent },
      { type: 'tool/call', data: { callId: 'delegate', name: 'dev_loop_delegate' } },
      result('delegate', JSON.stringify(nested)),
      { type: 'tool/call', data: { callId: 'history', name: 'dev_loop_delegations' } },
      result('history', JSON.stringify([nested]))])
    const redacted = redactSessionSnapshotIds([source])
    const single = JSON.parse(texts(redacted[0]!)[0]!) as typeof nested
    expect(single).toMatchObject({ delegationId: '{{delegation:1}}', worktreeAssignment: { id: '{{worktree:1}}' },
      outcome: nested.outcome, limitations: nested.limitations, verification: nested.verification })
    expect(JSON.parse(texts(redacted[0]!)[1]!)).toEqual([single])
    expect(redactSessionSnapshotIds(redacted)).toEqual(redacted)
  })

  it('shares typed identities and assigned cwd across receipt, history, and child logs at a fixed point', () => {
    const childLog = jsonl([{ type: 'session', id: child, parentSession: parent, cwd: receipt.worktreeAssignment.worktreePath }])
    const normalized = normalizeSessionSnapshots([log(), childLog], ctx)
    const payloads = texts(normalized[0]!)
    const single = JSON.parse(payloads[0]!) as typeof receipt
    const history: unknown = JSON.parse(payloads[1]!)
    expect(single).toEqual({ ...receipt, delegationId: '{{delegation:1}}', parentSessionId: '{{session:1}}',
      subagentSessionId: '{{session:2}}', requestedAt: 0, finishedAt: 0,
      worktreeAssignment: { ...receipt.worktreeAssignment, id: '{{worktree:1}}', mainlinePath: '{{cwd}}', worktreePath: '{{cwd}}/.worktrees/00.06' } })
    expect(history).toEqual([single])
    expect(JSON.parse(normalized[1]!.trim())).toMatchObject({ id: single.subagentSessionId,
      parentSession: single.parentSessionId, cwd: single.worktreeAssignment.worktreePath })
    expect(normalized[0]).toContain('"durationMs":37')
    expect(normalizeSessionSnapshots(normalized, ctx)).toEqual(normalized)
    const refreshed = redactSessionSnapshotIds([log(), childLog].map(value => scrubSessionSnapshot(tokenizeSessionFixtureCwd(value, ctx))))
    expect(normalizeSessionSnapshots(refreshed, ctx)).toEqual(normalized)
    expect(redactSessionSnapshotIds(refreshed)).toEqual(refreshed)
  })

  it('normalizes unresolved intent without adding settled fields', () => {
    const requested = { delegationId: delegation, parentSessionId: parent, pieceId: '00.06', role: 'Research',
      assignment: 'Inspect', rationale: 'Evidence needed', provider: 'in-process', requestedAt: 100, state: 'requested',
      verification: { claim: 'Claim', decisionRestingOnClaim: 'Decision', permittedSources: [], requiredEvidence: ['Log'] } }
    const source = jsonl([{ type: 'session', id: parent },
      { type: 'tool/call', data: { callId: 'history', name: 'dev_loop_delegations' } },
      result('history', JSON.stringify([requested]))])
    const normalized = normalizeSessionSnapshots([source], ctx)[0]!
    expect(JSON.parse(texts(normalized)[0]!)).toEqual([{ ...requested,
      delegationId: '{{delegation:1}}', parentSessionId: '{{session:1}}', requestedAt: 0 }])
    expect(normalized).not.toContain('finishedAt')
  })

  it('does not discover identities or clocks in invalid JSON, non-Roles JSON, error results, or user prose', () => {
    const values = ['{invalid', JSON.stringify({ delegationId: delegation, requestedAt: 100 }),
      JSON.stringify({ ...receipt, delegationId: 'not-a-uuid' })]
    for (const value of values) {
      const normalized = normalizeSessionSnapshots([log(value)], ctx)[0]!
      expect(texts(normalized)[0]).toBe(value.replaceAll(parent, '{{session:1}}').replaceAll(ctx.cwd, '{{cwd}}'))
    }
    const prose = `Delegation ${delegation}; assignment ${assignment}; requestedAt 100; duration 37ms`
    const source = jsonl([{ type: 'session', id: parent, cwd: ctx.cwd },
      { type: 'user/message', data: { text: prose } },
      { type: 'tool/call', data: { callId: 'error', name: 'dev_loop_delegate' } },
      result('error', prose, true),
      { type: 'tool/call', data: { callId: 'other', name: 'other_tool' } },
      result('other', JSON.stringify(receipt)),
    ])
    const output = scrubSessionSnapshot(source)
    expect(texts(output)).toEqual([prose, JSON.stringify(receipt)])
    const withReceipts = redactSessionSnapshotIds([log(), source])[1]!
    expect(withReceipts).toContain(prose)
    expect(texts(withReceipts)[1]).toContain(delegation)
    expect(texts(withReceipts)[1]).toContain(assignment)
  })
})
