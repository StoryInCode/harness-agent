/** Scoped claim verification with attributed JSON reports. @module dsh-dev-loop-claims/tool */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { z as json } from 'zod'
import type {} from './index.ts'

/** Loader identity of the scoped Claims consumer. */
export const name = 'dev-loop-claims-tool'
/** Host registries required for verification by a live caller. */
export const inject = ['tools', 'agents', 'devLoopClaims']

/** Consumer-owned bound over the complete rendered tool content; never a Host-private read. */
export interface Config {
  /** Maximum complete UTF-8 bytes of the rendered content array, including the report wrapper, proof rows and error prefixes. */
  maxToolOutputBytes: number
}
/** Loader-validated consumer-owned output budget. */
export const Config: z<Config> = z.object({
  maxToolOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
})

const input = json.strictObject({
  pieceId: json.string().regex(/^\d+(?:\.\d+)+$/, 'Invalid dotted piece ID'),
})
const textContent = (text: string) => [{ type: 'text' as const, text }]
const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const outputOverflow = (reportId: string) =>
  `Claims verification report ${reportId}: complete tool output exceeds byte limit; no partial report returned. Read durable evidence instead.`
const errorOverflow = 'Claims tool error exceeds output byte limit; inspect Host diagnostics.'

/**
 * Contribute verification to one Agent scope; authority comes from the exact live caller.
 * @param ctx - Scoped agent context owning the registration.
 * @param config - Consumer-owned output budget, never service-private policy.
 * @throws if the byte budget cannot hold the complete fixed error envelopes.
 */
export function apply(ctx: Context, config: Config): void {
  const limits = Config(config)
  // ToolRuntime prefixes thrown errors before content finalization; report ids are fixed-width UUID strings.
  const minimum = Math.max(jsonBytes(textContent(`Error: ${errorOverflow}`)),
    jsonBytes(textContent(`Error: ${outputOverflow('0'.repeat(36))}`)))
  if (limits.maxToolOutputBytes < minimum) {
    throw new Error(`maxToolOutputBytes output budget must be at least ${minimum} bytes`)
  }
  const finalizeContent = (_exec: unknown, result: { readonly content: readonly unknown[] }) =>
    jsonBytes(result.content) > limits.maxToolOutputBytes ? textContent(errorOverflow) : undefined
  ctx.tools.register(defineTool({
    name: 'dev_loop_verify_claims',
    description: 'Verify a piece’s Resources and proof claims through Research and retain attributed evidence. '
      + 'Findings are reported by Research, not your direct inspection; a report is not admission approval.',
    parameters: {
      pieceId: { type: 'string', required: true, description: 'Canonical dotted piece id in this repository.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => textContent(value),
    },
    finalizeContent,
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined || ctx.agents.get(agent.id) !== agent) {
        throw new Error('Claim verification requires an exact live initiator')
      }
      const { pieceId } = input.parse(args)
      const report = await ctx.agents.withInitiator(agent,
        () => ctx.devLoopClaims.verifyPieceClaims(pieceId, exec.signal))
      const rendered = JSON.stringify({
        report,
        'Resources and proof': report.findings.map(finding => ({
          claim: finding.claim,
          citation: finding.evidence.map(evidence => evidence.locator).join('; '),
          howEstablished: `Reported by ${finding.provenance.role} delegation ${finding.provenance.delegationId}`
            + ` (session ${finding.provenance.subagentSessionId}`
            + (finding.provenance.preset === undefined ? ')' : `, preset ${finding.provenance.preset})`)
            + `: ${finding.status}`,
          checkedAgainst: finding.evidence.map(evidence => ({
            locator: evidence.locator,
            ...(evidence.digest === undefined ? {} : { digest: evidence.digest }),
            ...(evidence.version === undefined ? {} : { version: evidence.version }),
          })),
        })),
      })
      if (jsonBytes(textContent(rendered)) > limits.maxToolOutputBytes) {
        throw new Error(outputOverflow(report.reportId))
      }
      return rendered
    },
  }))
}
