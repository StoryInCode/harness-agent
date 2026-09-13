/** Exact complete UTF-8 byte budgets, including terminal report metadata. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { cells, fixture, inventoryRow, pieceId, proof, research, response, sha } from './harness.ts'
import type { ClaimVerificationReport } from '../src/types.ts'

const values = ['证据文件包含保留输入', ...cells.slice(1)]
function unicodeResearch() {
  const report = research()
  report.findings[0]!.claim = values[0]!
  report.findings[0]!.claimId = inventoryRow(1, values).claimId
  return report
}

it('accepts the exact full-piece UTF-8 byte limit including headings and all source text', async () => {
  await fixture([response(unicodeResearch())], async (f) => {
    const bytes = Buffer.byteLength(f.source)
    expect(bytes).toBeGreaterThan(f.source.length)
    expect(f.config.maxPieceBytes).toBe(bytes)
    const report = await f.verify()
    expect(report.state).toBe('completed')
    expect(report.pieceSha256).toBe(sha(f.source))
    expect(report.inventory).toEqual([inventoryRow(1, values)])
    expect(await f.admit()).toEqual(report)
  }, { proof: proof([values]), config: source => ({ maxPieceBytes: Buffer.byteLength(source) }) })
})

it('rejects full-piece bytes one above the limit before any Research intent or child', async () => {
  await fixture([], async (f) => {
    expect(Buffer.byteLength(f.source)).toBe(f.config.maxPieceBytes + 1)
    await expect(f.verify()).rejects.toThrow(/piece|byte|large|limit/i)
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(pieceId)).toEqual([])
    expect(f.adapter.requests).toEqual([])
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
  }, { proof: proof([values]), config: source => ({ maxPieceBytes: Buffer.byteLength(source) - 1 }) })
})

async function completeReportBytes() {
  let bytes: number | undefined
  await fixture([response()], async (f) => {
    const report = await f.verify()
    expect(report.state).toBe('completed')
    expect(report.reportId).toHaveLength(36)
    expect(report.checkedAt.toString()).toHaveLength(13)
    const payloadOnly = Buffer.byteLength(JSON.stringify(report.findings.flatMap(finding => finding.evidence)))
    bytes = Buffer.byteLength(JSON.stringify(report))
    expect(bytes).toBeGreaterThan(payloadOnly)
    const persisted = JSON.parse(await readFile(join(f.data, 'dev_loop_claims.json'), 'utf8')) as {
      tables: { reports: Record<string, ClaimVerificationReport> }
    }
    expect(Object.values(persisted.tables.reports)).toEqual([report])
  })
  if (bytes === undefined) throw new Error('Expected complete owner report bytes from the probe')
  return bytes
}

it('accepts exactly the complete report budget without dropping metadata, References, inventory or limitations', async () => {
  const maxReportBytes = await completeReportBytes()
  await fixture([response()], async (f) => {
    const report = await f.verify()
    expect(report.state).toBe('completed')
    expect(Buffer.byteLength(JSON.stringify(report))).toBe(maxReportBytes)
    expect(report.inventory).toEqual([inventoryRow()])
    expect(report.references).toEqual(f.observation)
    expect(report.findings[0]!.evidence).toEqual(research().findings[0]!.evidence)
    expect(report.delegationIds).toHaveLength(1)
    expect(await f.admit()).toEqual(report)
    expect(await f.claims.getReport(pieceId)).toEqual(report)
  }, { config: { maxReportBytes } })
})

it('cannot return supported success when the complete report exceeds the budget by one byte', async () => {
  const maxReportBytes = await completeReportBytes() - 1
  await fixture([response()], async (f) => {
    const outcome = await f.verify().then(report => ({ report }), (error: unknown) => ({ error }))
    if ('report' in outcome) {
      expect(outcome.report.state).toBe('failed')
      expect(outcome.report.limitations.length).toBeGreaterThan(0)
      expect(Buffer.byteLength(JSON.stringify(outcome.report))).toBeLessThanOrEqual(maxReportBytes)
    } else expect(String(outcome.error)).toMatch(/report|byte|limit|large/i)
    expect(f.adapter.requests).toHaveLength(1)
    await expect(f.admit()).rejects.toThrow('CLAIM_VERIFICATION_OUTSTANDING')
    const retained = await f.claims.getReport(pieceId)
    if (retained) {
      expect(retained.state).toBe('failed')
      expect(Buffer.byteLength(JSON.stringify(retained))).toBeLessThanOrEqual(maxReportBytes)
    }
  }, { config: { maxReportBytes } })
})
