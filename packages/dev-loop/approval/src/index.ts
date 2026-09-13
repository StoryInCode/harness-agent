/**
 * Human approval Consumer of the directory, lifecycle and user-question services.
 * Acceptance binds the actual tool invocation and displayed source to Lifecycle.
 * @module @deepseek-ai/dsh-dev-loop-approval
 */
import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import '@deepseek-ai/dsh-fs'
import { PieceNotFoundError } from '@deepseek-ai/dsh-dev-loop-directory'
import '@deepseek-ai/dsh-dev-loop-lifecycle'
import { observeSource } from '@deepseek-ai/dsh-dev-loop-persistence'
import type { PresentPieceResult } from './types.ts'

export type { ApprovalDecision, PresentPieceResult } from './types.ts'

export const name = 'dev-loop-approval'
export const inject = ['tools', 'userQuestions', 'devLoopDirectory', 'devLoopLifecycle', 'fs']

/** Append missing-teaching warnings without altering the source displayed for review. */
function reviewDetail(content: string): string {
  const missing = new Set(['Approaches considered', 'Prior art inspected'])
  let teaching = false
  let fence: string | undefined
  for (const line of content.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length
        && line.trim() === marker) fence = undefined
      continue
    }
    if (marker !== undefined) {
      fence = marker
      continue
    }
    if (line.startsWith('## ')) teaching = line.trim() === '## Teach me while you build'
    if (!teaching) continue
    const heading = /^#{3,6}\s+(.+?)(?:\s+#+)?\s*$/.exec(line)?.[1]
    const label = /^\s*(?:[-+*]|\d+[.)])\s+\*\*(.+?):?\*\*(?::|\s|$)/.exec(line)?.[1]
    if (heading !== undefined) missing.delete(heading)
    if (label !== undefined) missing.delete(label)
  }
  return content + [...missing].map(label => `\n\nReview warning: missing teaching subsection: ${label}.`).join('')
}

/** Require one exact decision and at most one independent feedback answer. */
function decisionResult(pieceId: string, answer: AskUserQuestionAnswer): PresentPieceResult {
  const decisions = answer.answers.filter(item => item.id === 'decision')
  const feedbacks = answer.answers.filter(item => item.id === 'feedback')
  const selected = decisions[0]
  if (selected === undefined || decisions.length !== 1 || selected.selected.length !== 1
    || (selected.custom?.trim() ?? '') !== '' || feedbacks.length > 1) {
    throw new HarnessError('Select exactly one of Accept, Question, or Change; put feedback in the separate question.',
      'APPROVAL_DECISION_REQUIRED')
  }
  const label = selected.selected[0]
  if (label !== 'Accept' && label !== 'Question' && label !== 'Change') {
    throw new HarnessError('Select exactly one of Accept, Question, or Change.', 'APPROVAL_DECISION_REQUIRED')
  }
  const decision = { Accept: 'accept', Question: 'question', Change: 'change' } as const
  const feedback = feedbacks[0]?.custom?.trim()
  return { pieceId, decision: decision[label], ...(feedback ? { feedback } : {}) }
}

/** Reject a source observation that cannot authorize the displayed revision. */
function staleReview(): HarnessError {
  return new HarnessError('The piece changed during review; present its current source again before accepting.', 'PIECE_REVIEW_STALE')
}

/** Read and validate one current source, then commit only a fresh, explicit human acceptance. */
async function presentPiece(ctx: Context, pieceId: string, exec: ToolRunContext, signal: AbortSignal): Promise<PresentPieceResult> {
  signal.throwIfAborted()
  if (exec.agent === undefined) throw new HarnessError('Approval requires a live root calling agent.', 'CALLER_NOT_LIVE')
  const record = await ctx.devLoopDirectory.getPiece(pieceId, signal)
  signal.throwIfAborted()
  if (ctx.devLoopLifecycle.getStatus(pieceId) !== 'todo') {
    throw new HarnessError(`Piece ${pieceId} is not todo and cannot be presented for approval.`, 'PIECE_NOT_APPROVABLE')
  }
  const target = await ctx.fs.resolve(record.path, { signal })
  signal.throwIfAborted()
  const observed = await ctx.fs.stat(target, signal)
  signal.throwIfAborted()
  if (observed === undefined) throw staleReview()
  const content = await ctx.fs.readText(target, signal)
  signal.throwIfAborted()
  const afterRead = await ctx.fs.stat(target, signal)
  signal.throwIfAborted()
  if (afterRead?.version !== observed.version) throw staleReview()
  const bytes = Buffer.byteLength(content, 'utf8')
  if (observed.size === undefined || afterRead.size === undefined || observed.size !== bytes || afterRead.size !== bytes) {
    throw new HarnessError('Source byte size is unknown or differs from the reviewed UTF-8 bytes.', 'PIECE_REVIEW_STALE')
  }
  const current = ctx.devLoopDirectory.validate(record.path, content)
  if (current.id !== pieceId) throw staleReview()
  const answer = await ctx.userQuestions.ask({
    agent: exec.agent,
    signal,
    questions: [
      { id: 'decision', question: `How should we proceed with piece ${pieceId}?`, detail: reviewDetail(content),
        options: [{ label: 'Accept' }, { label: 'Question' }, { label: 'Change' }], multiSelect: false },
      { id: 'feedback', question: 'Optional: what question or revision instructions should the orchestrator address?' },
    ],
  })
  signal.throwIfAborted()
  const result = decisionResult(pieceId, answer)
  if (result.decision === 'accept') {
    const reviewed = await ctx.fs.stat(target, signal)
    signal.throwIfAborted()
    if (reviewed?.version !== observed.version || reviewed.size !== bytes) throw staleReview()
    await ctx.devLoopLifecycle.transition(pieceId, 'todo', 'pending', undefined, signal, {
      kind: 'tool', callId: exec.callId, sessionId: exec.agent.session.id,
      decision: 'accept', answer: { id: 'decision', selected: ['Accept'] },
      source: observeSource(record.path, content, observed.version),
    })
  }
  return result
}

/**
 * Register the approval tool and own all pending reads, human waits and transitions.
 * Disposal aborts admission and waits for providers to settle before unloading.
 * @param ctx - mounting context with the declared services.
 */
export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  const active = new Set<Promise<PresentPieceResult>>()
  ctx.effect(() => async () => {
    lifetime.abort(new Error('Approval tool disposed'))
    await Promise.allSettled(active)
  })
  ctx.tools.register(defineTool({
    name: 'present_piece_for_approval',
    description: 'Present a specification piece for an explicit Accept, Question, or Change decision. '
      + 'Only a live root agent may ask. Acceptance queues an unchanged todo piece; questions and changes do not queue work.',
    parameters: {
      pieceId: { type: 'string', required: true, description: 'Specification piece id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pieceId: { type: 'string', required: true },
          decision: { type: 'string', enum: ['accept', 'question', 'change'], required: true },
          feedback: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const signal = AbortSignal.any([exec.signal, lifetime.signal])
      signal.throwIfAborted()
      const operation = Promise.resolve().then(() => presentPiece(ctx, args.pieceId, exec, signal))
      active.add(operation)
      try {
        return await operation
      } catch (error) {
        // Directory lookup errors are plain Errors; preserve their code in the tool's structured error projection.
        if (error instanceof PieceNotFoundError) throw new HarnessError(error.message, error.code, { cause: error })
        throw error
      } finally {
        active.delete(operation)
      }
    },
  }))
}
