/** Owned runner adapter over Handoff's machine-readable outcome protocol; inert Test Writer scaffold. @module dsh-dev-loop-gates/runner */
import type { RunFacts } from './handoff-snapshot.ts'

/** Outcome classification demanded from every real runner execution; clean exit after timeout is still failure. */
export type RunnerOutcomeClass =
  | 'assertion-red' | 'passed' | 'skipped-or-empty' | 'syntax-or-import-error'
  | 'timeout' | 'cancelled' | 'truncated' | 'cleanup-unproven' | 'killed'
/**
 * Interpret one complete bounded reporter observation through Handoff's runner interpretation.
 * No truncated reporter or overflow can pass; a clean exit after cancellation is still failure.
 * @param facts - Independent process, output and cleanup facts from one owned execution.
 * @returns The derived outcome classification; never derived from caller flags.
 * @throws When required observation fields are absent.
 */
export function classifyRun(facts: RunFacts): RunnerOutcomeClass {
  void facts
  throw new Error('Missing Gates behavior: runner outcome classification')
}
