/** Bounded decoded-text reads and canonical local locator checks. @module dsh-dev-loop-references/sources */
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, win32 } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { Config, ReferenceEntry, ReferenceError, ReferenceErrorCode } from './types.ts'

/**
 * Hash the UTF-8 encoding of complete decoded text without newline normalization.
 * @param text - Complete text.
 * @returns SHA-256 hex.
 */
export function fingerprint(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }

/**
 * Read no more than the allowed decoded UTF-8 representation.
 * @param fs - Filesystem owner.
 * @param target - Resolved file.
 * @param limit - Inclusive bytes.
 * @param signal - Check lifetime.
 * @returns Complete decoded text.
 */
export async function boundedText(fs: FileSystem, target: FsTarget, limit: number, signal: AbortSignal): Promise<string> {
  let text = '', bytes = 0
  for await (const chunk of await fs.streamText(target, signal)) {
    signal.throwIfAborted()
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes > limit) throw new RangeError('Decoded text exceeds byte limit')
    text += chunk
  }
  signal.throwIfAborted()
  return text
}

/**
 * Check local files without upgrading inspection assertions.
 * @param fs - Filesystem owner.
 * @param entries - Owned entries to update.
 * @param kinds - AST locator origins.
 * @param piecePath - Piece file path.
 * @param config - Explicit read policy.
 * @param signal - Check lifetime.
 * @returns Structural failures.
 */
export async function checkSources(
  fs: FileSystem, entries: ReferenceEntry[], kinds: readonly string[], piecePath: string, config: Config, signal: AbortSignal,
): Promise<ReferenceError[]> {
  const errors: ReferenceError[] = []
  const root = await fs.resolve(config.repositoryRoot, { signal })
  for (const [entryIndex, entry] of entries.entries()) {
    signal.throwIfAborted()
    const fail = (code: ReferenceErrorCode, message: string) => {
      entry.sourceStatus = code === 'SOURCE_MISSING' ? 'missing' : 'invalid'
      errors.push({ code, message, entryIndex })
    }
    if (kinds[entryIndex] === 'invalid') { entry.sourceStatus = 'invalid'; continue }
    let path = entry.source
    if (/^https?:\/\//i.test(path)) {
      entry.limitations = [...entry.limitations, 'External content was not fetched or inspected.']
      continue
    }
    if (isAbsolute(path) || win32.isAbsolute(path)) { fail('ABSOLUTE_PATH', 'Absolute local paths are not accepted.'); continue }
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(path) || path.includes('?')) { fail('INVALID_LOCATOR', 'Unsupported source locator.'); continue }
    const hash = path.indexOf('#')
    if (hash >= 0) {
      entry.fragment = path.slice(hash + 1); path = path.slice(0, hash)
      entry.limitations = [...entry.limitations, 'Fragment semantics were not verified.']
    }
    const colon = path.lastIndexOf(':')
    if (colon >= 0) {
      const range = /^(\d+)(?:-(\d+))?$/.exec(path.slice(colon + 1))
      const start = Number(range?.[1]), end = Number(range?.[2] ?? range?.[1])
      if (!range || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        fail('INVALID_RANGE', 'Line range requires positive ordered safe integers.'); continue
      }
      entry.lineRange = { start, end }; path = path.slice(0, colon)
    }
    if (!path || /[\u0000\r\n]/.test(path)) { fail('INVALID_LOCATOR', 'Unsupported empty or control-character path.'); continue }
    const target = await fs.resolve(path, { cwd: kinds[entryIndex] === 'link' ? dirname(piecePath) : config.repositoryRoot, signal })
    signal.throwIfAborted()
    if (!fs.contains(root, target)) { fail('OUTSIDE_ROOT', 'Source escapes repositoryRoot.'); continue }
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      fail('SOURCE_MISSING', 'Source does not currently exist.')
      entry.limitations = [...entry.limitations, 'A missing source now does not prove historical fabrication.']; continue
    }
    if (info.type !== 'file') { fail('SOURCE_NOT_FILE', 'Source is not a regular file.'); continue }
    let text: string
    try { text = await boundedText(fs, target, config.maxSourceBytes, signal) }
    catch (error) {
      if (!(error instanceof RangeError)) throw error
      fail('SOURCE_TOO_LARGE', 'Source exceeds maxSourceBytes.'); continue
    }
    if (entry.lineRange && entry.lineRange.end > text.split(/\r\n|\n|\r/).length) {
      fail('INVALID_RANGE', 'Line range exceeds decoded line count.'); continue
    }
    entry.sourceStatus = 'resolved'; entry.contentSha256 = fingerprint(text)
  }
  return errors
}
