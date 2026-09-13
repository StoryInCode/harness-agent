/** Current-source review uses both provider versions and exact content digests. */
import { observeSource } from '@deepseek-ai/dsh-dev-loop-persistence'
import type { Context } from '@deepseek-ai/cordis'
import { Refusal } from './input.ts'

/** Read one validated stable source without substituting a clipped review.
 * @param ctx - Injected Directory and filesystem owners.
 * @param id - Canonical piece id.
 * @param signal - Runtime cancellation.
 * @returns Full source, current metadata, and SHA256 of exactly those UTF-8 bytes.
 */
export async function review(ctx: Context, id: string, signal: AbortSignal) {
  const record = await ctx.devLoopDirectory.getPiece(id, signal)
  signal.throwIfAborted()
  const target = await ctx.fs.resolve(record.path, { signal })
  signal.throwIfAborted()
  const before = await ctx.fs.stat(target, signal)
  signal.throwIfAborted()
  if (before === undefined) throw new Refusal(`Source for ${id} is missing; show its current source again.`)
  const content = await ctx.fs.readText(target, signal)
  signal.throwIfAborted()
  const current = ctx.devLoopDirectory.validate(record.path, content)
  const recheck = await ctx.fs.readText(target, signal)
  signal.throwIfAborted()
  const after = await ctx.fs.stat(target, signal)
  signal.throwIfAborted()
  if (current.id !== id || after?.version !== before.version || content !== recheck) {
    throw new Refusal(`Source for ${id} changed during review; show its current revision again.`)
  }
  const bytes = Buffer.byteLength(content, 'utf8')
  if (before.size === undefined || after.size === undefined || before.size !== bytes || after.size !== bytes) {
    throw new Refusal(`Source byte size for ${id} is unknown or differs from the reviewed UTF-8 bytes.`)
  }
  const source = observeSource(current.path, content, before.version)
  return { record: current, content, digest: source.rawDigest, source }
}
