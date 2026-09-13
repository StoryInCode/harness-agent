/** Local content identities and conservative reported-evidence admission. @module dsh-dev-loop-claims/evidence */
import { createHash } from 'node:crypto'
import { isAbsolute, win32 } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { ClaimFinding, Config } from './types.ts'

const assertNever = (value: never): never => { throw new Error(`Unexpected claim kind: ${String(value)}`) }

/** The filesystem owns fatal UTF-8 decoding; size equality rejects stripped BOMs and unknown byte identity. */
async function* byteFaithfulText(fs: FileSystem, target: FsTarget, signal: AbortSignal): AsyncIterable<string> {
  const info = await fs.stat(target, signal)
  if (info?.size === undefined) throw new Error('Raw source identity requires a known filesystem byte size')
  let bytes = 0
  for await (const chunk of await fs.streamText(target, signal)) {
    signal.throwIfAborted()
    bytes += Buffer.byteLength(chunk, 'utf8')
    yield chunk
  }
  signal.throwIfAborted()
  if (bytes !== info.size) throw new Error('Decoded UTF-8 byte size differs from the source; raw identity is unavailable')
}

/**
 * Hash complete UTF-8 text without normalizing whitespace.
 * @param text - Complete decoded source or serialized record.
 * @returns Lowercase SHA-256.
 */
export function fingerprint(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex') }

/**
 * Read a complete bounded source through the configured filesystem.
 * @param fs - Filesystem service.
 * @param path - Source path.
 * @param cwd - Resolution directory.
 * @param limit - Inclusive complete UTF-8 byte budget.
 * @param signal - Operation cancellation.
 * @returns Complete byte-faithful decoded source; unknown or mismatched backend byte size rejects.
 */
export async function readSource(fs: FileSystem, path: string, cwd: string, limit: number, signal: AbortSignal): Promise<string> {
  const root = await fs.resolve(cwd, { signal })
  const target = await fs.resolve(path, { cwd, signal })
  if (!fs.contains(root, target)) throw new Error('Source escapes repositoryRoot')
  let text = '', bytes = 0
  for await (const chunk of byteFaithfulText(fs, target, signal)) {
    signal.throwIfAborted()
    bytes += Buffer.byteLength(chunk, 'utf8')
    if (bytes > limit) throw new Error('Source exceeds complete byte limit')
    text += chunk
  }
  signal.throwIfAborted()
  return text
}

/**
 * Verify local evidence identities without claiming independent semantic inspection.
 * @param fs - Filesystem service.
 * @param finding - Attributed reported finding.
 * @param config - Repository and byte policies.
 * @param signal - Operation cancellation.
 * @returns Evidence qualifications; an empty array establishes only the required recorded identities.
 */
export async function checkEvidence(fs: FileSystem, finding: ClaimFinding, config: Config, signal: AbortSignal): Promise<string[]> {
  const issues: string[] = []
  if (!finding.evidence.length) issues.push('No evidence supports this finding.')
  const local = async (locator: string, digest: string | undefined) => {
    if (!digest) { issues.push('Local evidence lacks a content digest.'); return }
    if (isAbsolute(locator) || win32.isAbsolute(locator) || /[\u0000\r\n?#]/.test(locator) || /^[a-z][a-z\d+.-]*:/i.test(locator)) {
      issues.push('Local evidence requires a repository-relative file locator.'); return
    }
    try {
      const root = await fs.resolve(config.repositoryRoot, { signal })
      const target = await fs.resolve(locator, { cwd: config.repositoryRoot, signal })
      if (!fs.contains(root, target)) throw new Error('Evidence escapes repositoryRoot')
      const hash = createHash('sha256')
      for await (const chunk of byteFaithfulText(fs, target, signal)) {
        signal.throwIfAborted()
        hash.update(chunk, 'utf8')
      }
      if (hash.digest('hex') !== digest) issues.push(`Evidence identity changed: ${locator}`)
    } catch (error) {
      signal.throwIfAborted()
      issues.push(`Evidence cannot be checked: ${locator}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const evidence of finding.evidence) {
    switch (finding.kind) {
      case 'external':
        if (!/^https?:\/\//i.test(evidence.locator) || !evidence.version || !evidence.digest
          || /\/(?:latest|current)(?:[/?#]|$)/i.test(evidence.locator)) issues.push('External evidence requires an immutable version and digest.')
        break
      case 'measurement':
        if (!evidence.measurement || evidence.measurement.reportedExecution !== 'executed') {
          issues.push('Measurement evidence requires complete metadata and reported execution.')
        }
        await local(evidence.locator, evidence.digest)
        break
      case 'repository':
        await local(evidence.locator, evidence.digest)
        break
      case 'dependency':
        if (!evidence.version || !evidence.symbol) issues.push('Dependency evidence requires installed version and export or manifest identity.')
        await local(evidence.locator, evidence.digest)
        break
      case 'negative': {
        const corpus = evidence.corpus
        if (!evidence.query || !corpus || !Object.keys(corpus.contentManifest).length || !corpus.includedDirectories.length) {
          issues.push('Negative evidence requires an explicit inspected corpus and exact query.'); break
        }
        await local(evidence.locator, evidence.digest)
        for (const [path, digest] of Object.entries(corpus.contentManifest)) await local(path, digest)
        if (corpus.resultCount !== 0) issues.push('A nonzero result count cannot establish absence.')
        if (corpus.exportEntryPoints.some(path => !Object.hasOwn(corpus.contentManifest, path))) {
          issues.push('Every recorded export entry point requires an explicit content-manifest digest.')
        }
        break
      }
      default: assertNever(finding.kind)
    }
  }
  if (finding.kind === 'dependency') {
    const locators = finding.evidence.map(evidence => evidence.locator)
    if (!locators.some(path => path.endsWith('/package.json') || path === 'package.json')
      || !locators.some(path => /(?:^|\/)(?:pnpm-lock.yaml|package-lock.json|yarn.lock)$/.test(path))
      || !locators.some(path => !/(?:package.json|pnpm-lock.yaml|package-lock.json|yarn.lock)$/.test(path))) {
      issues.push('Dependency evidence must retain manifest, lockfile, and export entry-point identities.')
    }
  }
  return issues
}
