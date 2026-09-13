/** Reads byte-faithful local observations without assigning authority to a done location. */
import type { Context } from '@deepseek-ai/cordis'
import { isPieceFilename, PieceParseError, type PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import { observeSource } from './source.ts'
import type { SourceObservation } from './types.ts'

/** One independently observed piece file. */
export interface LocalPiece {
  readonly pieceId: string
  readonly status: PieceStatus
  readonly source: SourceObservation
  /** False confines the fallback status to quarantined reconciliation, never lifecycle authority. */
  readonly valid: boolean
}

/**
 * Read piece files with matching filesystem versions and known UTF-8 byte counts, without writing storage.
 * Invalid piece documents retain observations and a validation flag so reconciliation can quarantine them independently.
 * @param ctx - Injected filesystem and Directory services.
 * @param signal - Cancellation forwarded to filesystem reads and Directory discovery.
 * @returns Every local piece copy ordered by id and path, preserving duplicates for reconciliation.
 * @throws On cancellation, filesystem failure, unexpected validation failure, missing byte size, changed version, or byte-count mismatch.
 */
export async function readLocalPieces(ctx: Context, signal: AbortSignal): Promise<LocalPiece[]> {
  const pieces: LocalPiece[] = []
  for (const set of await ctx.devLoopDirectory.listSets(signal)) {
    const base = `${ctx.devLoopDirectory.config.root}/${set}`
    for (const path of [base, `${base}/done`]) {
      const target = await ctx.fs.resolve(path, { signal })
      const info = await ctx.fs.stat(target, signal)
      if (info === undefined) continue
      for (const entry of await ctx.fs.listDir(target, signal)) {
        if (!isPieceFilename(entry.name)) continue
        const filePath = `${path}/${entry.name}`
        const before = await ctx.fs.stat(entry.target, signal)
        const content = await ctx.fs.readText(entry.target, signal)
        const after = await ctx.fs.stat(entry.target, signal)
        if (before === undefined || after === undefined || before.version !== after.version
          || before.size === undefined || before.size !== Buffer.byteLength(content, 'utf8')) {
          throw new Error(`Source ${filePath} cannot establish byte-faithful UTF-8 identity: missing size, changed version, or byte size mismatch`)
        }
        let record
        try { record = ctx.devLoopDirectory.validate(filePath, content) }
        catch (error) {
          if (!(error instanceof PieceParseError)) throw error
          // Invalid local documents remain inspectable; only their filename identifies the quarantined piece.
        }
        pieces.push({ pieceId: record?.id ?? entry.name.slice(0, 5), status: record?.status ?? 'todo',
          source: observeSource(filePath, content, after.version), valid: record !== undefined })
      }
    }
  }
  return pieces.sort((a, b) => a.pieceId.localeCompare(b.pieceId) || a.source.path.localeCompare(b.source.path))
}
