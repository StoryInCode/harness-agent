/** Timestamped independent Directory, Lifecycle and Queue observations, never transactional state. */
import type { Context } from '@deepseek-ai/cordis'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import { diagnostic } from './errors.ts'

/** Describe valid and rejected sources using current logical status.
 * @param ctx - Injected observation owners.
 * @param route - List rows or aggregate status.
 * @param signal - Runtime cancellation.
 * @returns Complete human observation text.
 */
export async function corpus(ctx: Context, route: 'list' | 'status', signal: AbortSignal): Promise<string> {
  const timestamp = new Date().toISOString()
  const counts: Record<PieceStatus, number> = { todo: 0, pending: 0, blocked: 0, done: 0 }
  const rows: string[] = []
  const findings: string[] = []
  const sets = await ctx.devLoopDirectory.listSets(signal)
  signal.throwIfAborted()
  for (const set of sets) {
    signal.throwIfAborted()
    const scan = await ctx.devLoopDirectory.scanSet(set, signal)
    signal.throwIfAborted()
    for (const piece of scan.pieces) {
      signal.throwIfAborted()
      try {
        const status = ctx.devLoopLifecycle.getStatus(piece.id)
        counts[status]++
        rows.push(`${piece.set} | ${piece.queue} | ${piece.id} | ${status} | ${piece.title} | ${piece.path}`)
      } catch (error) {
        const message = diagnostic(error)
        if (message === undefined) throw error
        findings.push(`${piece.path}: ${message}`)
      }
    }
    for (const rejected of scan.rejected) {
      findings.push(`${rejected.path}: ${rejected.code}: ${rejected.findings.map(item => item.message).join('; ')}`)
    }
  }
  if (route === 'list') return [...(rows.length ? rows : ['Pieces: empty']), ...findings].join('\n')
  return [
    `Observed: ${timestamp}`,
    `Active workers: ${ctx.devLoopQueue.getActiveWorkers().length}`,
    `maxConcurrency: ${ctx.devLoopQueue.maxConcurrency}`,
    `Queued: ${ctx.devLoopQueue.getQueuedEntries().length}`,
    ...Object.entries(counts).map(([status, count]) => `${status}: ${count}`),
    ...findings,
  ].join('\n')
}

/** Describe Queue's returned priority/FIFO order and current dependency declarations.
 * @param ctx - Injected observation owners.
 * @param signal - Runtime cancellation.
 * @returns Complete queue text, including missing or malformed referents.
 */
export async function queue(ctx: Context, signal: AbortSignal): Promise<string> {
  const entries = ctx.devLoopQueue.getQueuedEntries()
  if (!entries.length) return 'Queue: empty'
  const rows: string[] = []
  for (const [index, entry] of entries.entries()) {
    signal.throwIfAborted()
    rows.push(`${index + 1}. ${entry.pieceId} | queueOrder: ${entry.queueOrder} | enqueuedAt: ${entry.enqueuedAt}`)
    try {
      const piece = await ctx.devLoopDirectory.getPiece(entry.pieceId, signal)
      signal.throwIfAborted()
      if (!piece.dependsOn.length) rows.push('  Dependencies: none')
      for (const id of piece.dependsOn) {
        signal.throwIfAborted()
        try {
          await ctx.devLoopDirectory.getPiece(id, signal)
          signal.throwIfAborted()
          rows.push(`  ${id}: ${ctx.devLoopLifecycle.getStatus(id)}`)
        } catch (error) {
          signal.throwIfAborted()
          const message = diagnostic(error)
          if (message === undefined) throw error
          rows.push(`  ${id}: unavailable\n    ${message.replaceAll('\n', '\n    ')}`)
        }
      }
    } catch (error) {
      signal.throwIfAborted()
      const message = diagnostic(error)
      if (message === undefined) throw error
      rows.push(`  ${entry.pieceId}: ${message}`)
    }
  }
  return rows.join('\n')
}
