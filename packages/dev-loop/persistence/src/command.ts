/** Human recovery inspection and acknowledgment; neither operation repairs lifecycle state. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-agent'
import { DevLoopPersistenceError } from './index.ts'
import type { AnomalyId, RecoveryCommandConfig } from './types.ts'

const overflow: CommandResult = {
  kind: 'error', text: 'Recovery output exceeds maxOutputBytes; increase the configured limit.',
}
const bytes = (result: CommandResult) => Buffer.byteLength(JSON.stringify(result), 'utf8')
const usage = 'Usage: /dev-loop-recovery inspect <pieceId> | acknowledge <anomalyId> <reason...>'

export const name = 'dev-loop-recovery'
export const inject = ['commands', 'agents', 'devLoopPersistence']
export const Config: z<RecoveryCommandConfig> = z.object({
  maxInputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxOutputBytes: z.number().step(1).min(bytes(overflow)).max(Number.MAX_SAFE_INTEGER).required(),
})

class Refusal extends Error {}

async function execute(ctx: Context, invocation: CommandInvocation): Promise<string> {
  const input = invocation.rawInput.trim()
  const inspect = /^inspect\s+(\d{2}\.\d{2})$/u.exec(input)
  const pieceId = inspect?.[1]
  if (pieceId !== undefined) {
    const history = await ctx.devLoopPersistence.getHistory(pieceId)
    const anomalies = (await ctx.devLoopPersistence.getAnomalies()).filter(item => item.pieceId === pieceId)
    return JSON.stringify({ pieceId, history, anomalies })
  }
  const acknowledge = /^acknowledge\s+(dla-[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})\s+([\s\S]+)$/u.exec(input)
  const anomalyId = acknowledge?.[1]
  const reason = acknowledge?.[2]?.trim()
  if (anomalyId === undefined || !reason) throw new Refusal(usage)
  if (ctx.agents.get(invocation.agent.id) !== invocation.agent || !ctx.agents.roots().includes(invocation.agent)) {
    throw new Refusal('Acknowledgment requires the exact live root human agent.')
  }
  const acknowledgment = await ctx.devLoopPersistence.acknowledgeAnomaly(
    anomalyId as AnomalyId,
    { commandId: invocation.commandId, sessionId: invocation.agent.session.id },
    reason, invocation.signal,
  )
  return JSON.stringify(acknowledgment)
}

/** Register a reversible human command with complete UTF-8 input and result limits.
 * @param ctx - Real command runtime, live agents and persistence provider.
 * @param config - Complete input/output budgets.
 */
export function apply(ctx: Context, config: RecoveryCommandConfig): void {
  ctx.effect(() => ctx.commands.register({
    name,
    description: 'Inspect durable development-loop history and acknowledge recovery anomalies.',
    input: { hint: 'inspect <pieceId> | acknowledge <anomalyId> <reason...>' },
    async handler(invocation) {
      let result: CommandResult
      try {
        invocation.signal.throwIfAborted()
        if (Buffer.byteLength(invocation.rawInput, 'utf8') > config.maxInputBytes) {
          throw new Refusal('Recovery input exceeds maxInputBytes; shorten the input.')
        }
        result = { kind: 'success', text: await execute(ctx, invocation) }
      } catch (error) {
        invocation.signal.throwIfAborted()
        if (!(error instanceof Refusal) && !(error instanceof DevLoopPersistenceError)) throw error
        result = { kind: 'error', text: error.message }
      }
      return bytes(result) > config.maxOutputBytes ? overflow : result
    },
  }))
}
