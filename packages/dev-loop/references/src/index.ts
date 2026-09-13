/** Host-owned durable source checks with explicitly unverified inspection. @module dsh-dev-loop-references */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-dev-loop-directory'
import type {} from '@deepseek-ai/dsh-dev-loop-roles'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { parseReferences } from './parser.ts'
import { attributeEntries } from './attribution.ts'
import { boundedText, checkSources, fingerprint } from './sources.ts'
import { referencesDomain } from './records.ts'
import type { Config, ProvenanceObservation } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { devLoopReferences: DevLoopReferences }
}
const positive = z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).required()
const observationLimitation = 'Source existence and report attribution do not establish source usage or claim truth.'
const minimumObservationBytes = Buffer.byteLength(JSON.stringify({
  pieceId: '0.0', pieceSha256: '0'.repeat(64), checkedAt: 0, explicitEmpty: false,
  structuralStatus: 'invalid', inspectionStatus: 'unverified', entries: [],
  errors: [{ code: 'MISSING_REFERENCES', message: 'The piece has no References section.' }], limitations: [observationLimitation],
} satisfies ProvenanceObservation), 'utf8')
/** Resolves sources and retains report identity without claiming verified inspection. */
export class DevLoopReferences extends Service {
  static inject = ['devLoopDirectory', 'devLoopRoles', 'fs', 'storageDomain']
  static Config: z<Config> = z.object({
    repositoryRoot: z.string().pattern(/\S/).required(), maxPieceBytes: positive,
    maxSourceBytes: positive, maxObservationBytes: z.number().step(1).min(minimumObservationBytes).max(Number.MAX_SAFE_INTEGER).required(),
    maxReferences: positive,
  })
  private readonly config: Config
  private readonly lifetime = new AbortController()
  private pending: Promise<unknown> = Promise.resolve()
  private table!: KvTable<string, ProvenanceObservation>
  constructor(ctx: Context, config: Config) {
    super(ctx, 'devLoopReferences')
    this.config = DevLoopReferences.Config(config)
  }
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(referencesDomain)
    this.table = domain.table('observations')
    this.ctx.effect(() => async () => {
      this.lifetime.abort(new Error('References service disposed'))
      await this.pending
      await domain.close()
    })
  }
  /**
   * Check the current piece and publish only after durable storage succeeds.
   * @param pieceId - canonical piece id in the configured repository.
   * @param signal - stops new checks, not an already-admitted domain write.
   * @returns a detached observation of structural checks and unverified inspection.
   */
  verifyReferences(pieceId: string, signal: AbortSignal): Promise<ProvenanceObservation> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    const operation = this.pending.then(() => this.verify(pieceId, combined))
    this.pending = operation.then(() => undefined, () => undefined)
    return operation
  }
  /**
   * Read the last durable observation without reinterpreting changed piece contents.
   * @param pieceId - canonical piece id.
   * @returns detached latest observation or undefined when never checked.
   */
  getProvenance(pieceId: string): Promise<ProvenanceObservation | undefined> {
    return Promise.resolve().then(() => {
      this.lifetime.signal.throwIfAborted()
      const value = this.table.get(pieceId)
      return value === undefined ? undefined : structuredClone(value)
    })
  }
  private async verify(pieceId: string, signal: AbortSignal): Promise<ProvenanceObservation> {
    signal.throwIfAborted()
    const piece = await this.ctx.devLoopDirectory.getPiece(pieceId)
    signal.throwIfAborted()
    const target = await this.ctx.fs.resolve(piece.path, { signal })
    let text: string
    try { text = await boundedText(this.ctx.fs, target, this.config.maxPieceBytes, signal) }
    catch (error) {
      if (!(error instanceof RangeError)) throw error
      throw new Error('Piece exceeds maxPieceBytes limit', { cause: error })
    }
    const parsed = parseReferences(text, this.config.maxReferences)
    const records = await this.ctx.devLoopRoles.getDelegations(pieceId)
    signal.throwIfAborted()
    const errors = [...parsed.errors, ...attributeEntries(parsed.entries, records),
      ...await checkSources(this.ctx.fs, parsed.entries, parsed.kinds, this.ctx.fs.processPath(target), this.config, signal)]
    const observation: ProvenanceObservation = {
      pieceId, pieceSha256: fingerprint(text), checkedAt: Date.now(), explicitEmpty: parsed.explicitEmpty,
      structuralStatus: errors.length ? 'invalid' : 'valid', inspectionStatus: 'unverified', entries: parsed.entries, errors,
      limitations: [observationLimitation],
    }
    if (Buffer.byteLength(JSON.stringify(observation), 'utf8') > this.config.maxObservationBytes) {
      throw new Error('Complete observation exceeds maxObservationBytes limit')
    }
    signal.throwIfAborted()
    await this.table.put(pieceId, observation)
    return structuredClone(observation)
  }
}
export default DevLoopReferences
