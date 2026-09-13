/** Human-only development-loop command Consumer; Lifecycle owns all mutations. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-dev-loop-directory'
import '@deepseek-ai/dsh-dev-loop-lifecycle'
import type { HumanAuthorization } from '@deepseek-ai/dsh-dev-loop-persistence'
import '@deepseek-ai/dsh-dev-loop-queue'
import '@deepseek-ai/dsh-fs'
import { diagnostic } from './errors.ts'
import { overflow, parse, Refusal, resultBytes, usage } from './input.ts'
import { corpus, queue } from './observations.ts'
import { review } from './review.ts'

/** Deployment limits for raw input and the complete UTF-8 serialized CommandResult. */
export interface Config {
  /** Positive safe integer byte ceiling for raw input. */
  maxInputBytes: number
  /** Safe integer byte ceiling large enough for a useful overflow refusal. */
  maxOutputBytes: number
}

export const name = 'dev-loop-command'
export const inject = ['commands', 'agents', 'devLoopDirectory', 'devLoopLifecycle', 'devLoopQueue', 'fs']
export const Config: z<Config> = z.object({
  maxInputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required(),
  maxOutputBytes: z.number().step(1).min(resultBytes(overflow)).max(Number.MAX_SAFE_INTEGER).required(),
})

/** Exact object identity, not a copied Session id, authorizes a human mutation. */
function requireRoot(ctx: Context, invocation: CommandInvocation): void {
  if (ctx.agents.get(invocation.agent.id) !== invocation.agent || !ctx.agents.roots().includes(invocation.agent)) {
    throw new Refusal('Mutation requires the exact live root human agent.')
  }
}

/** Route a fully validated request; no command creates a Queue callback. */
async function execute(ctx: Context, invocation: CommandInvocation): Promise<string> {
  const { signal } = invocation
  const request = parse(invocation.rawInput)
  switch (request.verb) {
    case 'help': return usage
    case 'list': case 'status': return corpus(ctx, request.verb, signal)
    case 'queue': return queue(ctx, signal)
    case 'show': {
      const { record, content, digest } = await review(ctx, request.id, signal)
      return [`${record.id} — ${record.title}`, `Set: ${record.set}`, `Queue: ${record.queue}`,
        `Status: ${ctx.devLoopLifecycle.getStatus(record.id)}`, `Path: ${record.path}`,
        `Primitive: ${record.primitive}`, `Package: ${record.pkg}`,
        `Depends on: ${record.dependsOn.join(', ') || 'none'}`, `SHA256: ${digest}`, '', content].join('\n')
    }
    case 'approve': case 'reject': {
      requireRoot(ctx, invocation)
      let authorization: HumanAuthorization | undefined
      if (request.verb === 'approve') {
        const observed = await review(ctx, request.id, signal)
        if (observed.digest !== request.digest) throw new Refusal('Stale SHA256 digest; show the current source before approving.')
        authorization = { kind: 'command', commandId: invocation.commandId,
          sessionId: invocation.agent.session.id, decision: 'accept', source: observed.source }
      } else {
        await ctx.devLoopDirectory.getPiece(request.id, signal)
      }
      signal.throwIfAborted()
      requireRoot(ctx, invocation)
      const expected = request.verb === 'approve' ? 'todo' : 'pending'
      const next = request.verb === 'approve' ? 'pending' : 'blocked'
      const status = ctx.devLoopLifecycle.getStatus(request.id)
      if (status !== expected) throw new Refusal(`Piece ${request.id} is ${status}; ${request.verb} requires ${expected}.`)
      if (request.verb === 'approve') {
        await ctx.devLoopLifecycle.transition(request.id, expected, next, undefined, signal, authorization)
      } else {
        await ctx.devLoopLifecycle.transition(request.id, expected, next, request.reason, signal)
      }
      return `Piece ${request.id}: ${next}.`
    }
    /* v8 ignore next -- the local parser returns only the exhaustive Request variants. */
    default: return assertNever(request)
  }
}

/** Mount the reversible command; expected domain failures return, defects and cancellation reject.
 * @param ctx - Host context supplying the declared services.
 * @param config - Validated complete UTF-8 input and result ceilings.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.commands.register({
    name: 'dev-loop',
    description: 'Inspect and review development-loop pieces.',
    input: { hint: 'help | status | list | queue | show <id> | approve <id> <sha256> | reject <id> <reason...>' },
    async handler(invocation) {
      let result: CommandResult
      try {
        invocation.signal.throwIfAborted()
        if (Buffer.byteLength(invocation.rawInput, 'utf8') > config.maxInputBytes) {
          throw new Refusal('Command input exceeds maxInputBytes; shorten the input.')
        }
        result = { kind: 'success', text: await execute(ctx, invocation) }
      } catch (error) {
        invocation.signal.throwIfAborted()
        const message = diagnostic(error)
        if (message === undefined) throw error
        result = { kind: 'error', text: `${message}\n${usage}` }
      }
      return resultBytes(result) > config.maxOutputBytes ? overflow : result
    },
  }))
}
