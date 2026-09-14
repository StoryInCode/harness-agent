/** Durable `dev_loop_gates` domain attempts and reports; inert Test Writer scaffold. @module dsh-dev-loop-gates/records */
import type { GateReport, GateStage } from './types.ts'

/** Domain name owned by Gates in the storage-domain service. */
export const GATES_DOMAIN = 'dev_loop_gates'
/** Single durable layout version; no migration or alternate layout exists. */
export const DOMAIN_VERSION = 1 as const
/** Persisted execution intent written before any check runs. */
export interface GateIntent {
  readonly domain: typeof GATES_DOMAIN
  readonly version: typeof DOMAIN_VERSION
  readonly pieceId: string
  readonly stage: GateStage
  readonly requestedAt: number
}
/** Schema-validate one persisted attempt or report read from the domain.
 * @param raw - Complete UTF-8 record bytes read from durable storage.
 * @returns The validated report; never a repaired or defaulted one.
 * @throws When bytes are not a complete version-1 Gates report.
 */
export function parseGateReport(raw: string): GateReport {
  void raw
  throw new Error('Missing Gates behavior: durable report validation')
}
