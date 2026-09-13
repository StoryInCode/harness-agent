/** Exact whitespace-delimited human grammar; reject keeps its literal remaining text. */
import type { CommandResult } from '@deepseek-ai/dsh-commands'

/** Complete grammar advertised and returned by the command. */
export const usage = 'Usage: /dev-loop help | status | list | queue | show <id> | approve <id> <sha256> | reject <id> <reason...>\nIds use NN.MM. SHA256 is 64 hexadecimal characters. No flags, quoting, or extra arguments are supported.'

/** Parsed command input; no route ignores trailing tokens. */
export type Request =
  | { verb: 'help' | 'status' | 'list' | 'queue' }
  | { verb: 'show'; id: string }
  | { verb: 'approve'; id: string; digest: string }
  | { verb: 'reject'; id: string; reason: string }

/** Expected human-input or changed-observation refusal. */
export class Refusal extends Error {}

/** Parse all input, preserving internal whitespace in reject reasons.
 * @param raw - Runtime-preserved input after the command name.
 * @returns One fully validated operation.
 */
export function parse(raw: string): Request {
  const input = raw.trim()
  if (!input) return { verb: 'help' }
  const [verb, id, digest, ...extra] = input.split(/\s+/u)
  switch (verb) {
    case 'help': case 'status': case 'list': case 'queue':
      if (id !== undefined) throw new Refusal(`Unexpected arguments for ${verb}.`)
      return { verb }
    case 'show': case 'approve': case 'reject':
      if (id === undefined) throw new Refusal(`Missing required id for ${verb}.`)
      if (!/^\d{2}\.\d{2}$/u.test(id)) throw new Refusal('Invalid piece id; use NN.MM.')
      if (verb === 'show') {
        if (digest !== undefined) throw new Refusal('Unexpected arguments for show.')
        return { verb, id }
      }
      if (verb === 'reject') {
        const reason = input.slice(verb.length).trimStart().slice(id.length).trim()
        if (!reason) throw new Refusal('A nonempty reject reason is required.')
        return { verb, id, reason }
      }
      if (extra.length) throw new Refusal('Unexpected arguments for approve.')
      if (digest === undefined || !/^[a-f\d]{64}$/iu.test(digest)) {
        throw new Refusal('A 64-character hexadecimal SHA256 digest is required.')
      }
      return { verb, id, digest: digest.toLowerCase() }
    default: throw new Refusal(`Unknown dev-loop operation: ${verb}.`)
  }
}

/** Fixed envelope remains useful at the exact configured minimum. */
export const overflow: CommandResult = { kind: 'error', text: 'Command output exceeds maxOutputBytes; increase the limit and retry. No complete observation is returned.' }

/** Measure the complete Consumer-owned UTF-8 JSON envelope.
 * @param result - The complete command result.
 * @returns Bytes emitted by JSON serialization.
 */
export function resultBytes(result: CommandResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8')
}
