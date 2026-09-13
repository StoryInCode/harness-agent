/** Classify only declared domain failures; programming defects stay thrown. */
import { DuplicatePieceError, PieceNotFoundError, PieceParseError, SetNotFoundError } from '@deepseek-ai/dsh-dev-loop-directory'
import { InvalidStateTransitionError, StalePieceStatusError } from '@deepseek-ai/dsh-dev-loop-lifecycle'
import { FsError } from '@deepseek-ai/dsh-fs'
import { DevLoopPersistenceError } from '@deepseek-ai/dsh-dev-loop-persistence'
import { Refusal } from './input.ts'

/** Recover the actionable diagnostic of a known failure.
 * @param error - A dependency or input exception.
 * @returns Its diagnostic, or undefined for a programming defect or cancellation.
 */
export function diagnostic(error: unknown): string | undefined {
  if (error instanceof PieceParseError) {
    return `${error.path}: ${error.code}\n${error.findings.map(finding => finding.message).join('\n')}`
  }
  if (error instanceof Refusal || error instanceof PieceNotFoundError
    || error instanceof SetNotFoundError || error instanceof DuplicatePieceError
    || error instanceof InvalidStateTransitionError || error instanceof StalePieceStatusError
    || error instanceof DevLoopPersistenceError || error instanceof FsError) {
    return error.message
  }
  return undefined
}
