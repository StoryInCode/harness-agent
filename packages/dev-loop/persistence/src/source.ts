/** Pure byte-faithful source digests shared by Lifecycle and human Consumers. */
import { createHash } from 'node:crypto'
import type { FsVersion } from '@deepseek-ai/dsh-fs'
import type { SourceDigest, SourceObservation } from './types.ts'

/** Preserve whitespace and body examples while normalizing the parsed initial Status value. */
function normalize(content: string): string {
  let offset = 0
  let replacement: { start: number; end: number } | undefined
  let fence: string | undefined
  for (const physical of content.split(/(?<=\n)/u)) {
    const line = physical.replace(/\r?\n$/u, '')
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
    } else if (marker !== undefined) {
      fence = marker
    } else if (line.startsWith('## ')) {
      break
    }
    let segmentOffset = 0
    for (const segment of line.split('·')) {
      const match = /^(\s*\*\*Status:\*\*\s*)(todo|pending|blocked|done)(\s*)$/u.exec(segment)
      const prefix = match?.[1]
      const status = match?.[2]
      if (prefix !== undefined && status !== undefined) {
        const start = offset + segmentOffset + prefix.length
        replacement = { start, end: start + status.length }
      }
      segmentOffset += segment.length + 1
    }
    offset += physical.length
  }
  return replacement === undefined ? content : content.slice(0, replacement.start) + 'todo' + content.slice(replacement.end)
}

/**
 * Describe a current source without fetching, authorizing, or storing it.
 * @param path - canonical Directory path for this source.
 * @param content - complete fatal-decoded UTF-8 text whose encoded byte count equals its known observed file size.
 * @param version - actual provider version observed with these exact bytes.
 * @returns raw and initial-Status-header-only normalized digests with source identity.
 */
export function observeSource(path: string, content: string, version: FsVersion): SourceObservation {
  const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex') as SourceDigest
  return { path, version, rawDigest: digest(content), contentDigest: digest(normalize(content)) }
}
