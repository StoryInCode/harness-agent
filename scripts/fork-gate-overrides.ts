/**
 * Fork-local gate policy.
 *
 * This module and its manifest exist only in this fork. Upstream
 * `deepseek-ai/deepseek-harness` has no counterpart, so neither file can
 * conflict when upstream is merged. Fork-local gate decisions are recorded
 * here instead of by deleting a gate script or editing its leaf list, both of
 * which touch upstream-owned lines and re-conflict on every upstream change.
 *
 * `run-gates.ts` applies disabled gates through `withForkGatePolicy()`.
 * `gen-cordis-catalog.ts` reads explicit English-only subsystem page choices;
 * other mapped pages retain the generator's bilingual requirements.
 *
 * A disabled gate's script stays on disk and remains runnable by name, so the
 * check is still available deliberately; it is only removed from the
 * aggregates this fork runs.
 *
 * @module scripts/fork-gate-overrides
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** One fork-local decision to keep a gate out of every aggregate. */
export interface DisabledGate {
  /** Gate id as declared in `run-gates.ts`. */
  id: string
  /** Why this fork does not run the gate. Required: an unexplained exclusion is indistinguishable from a mistake. */
  reason: string
}

/** Validated fields of `scripts/fork-gate-overrides.manifest.json`. */
export interface ForkGatePolicy {
  /** Gates this fork removes from every aggregate. */
  disabledGates: DisabledGate[]
  /** English subsystem basenames whose Chinese page is not maintained, each with a reason. */
  englishOnlySubsystemPages?: Record<string, string>
}

const MANIFEST = 'scripts/fork-gate-overrides.manifest.json'

/**
 * Read and validate the fork-local gate policy.
 *
 * Malformed policy fails loudly rather than degrading to "run everything":
 * a typo in the manifest must not silently restore a gate this fork removed,
 * nor silently remove one it still wants.
 *
 * @param root - repository root to resolve the manifest against.
 * @returns the validated policy.
 */
export function readForkGatePolicy(root: string): ForkGatePolicy {
  const path = resolve(root, MANIFEST)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${MANIFEST} is missing or not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${MANIFEST} must contain a JSON object`)
  }
  const disabled: unknown = (parsed as { disabledGates?: unknown }).disabledGates
  if (!Array.isArray(disabled)) {
    throw new Error(`${MANIFEST} must declare a "disabledGates" array`)
  }
  const seen = new Set<string>()
  const disabledGates = disabled.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${MANIFEST} disabledGates[${index}] must be an object`)
    }
    const { id, reason } = entry as { id?: unknown; reason?: unknown }
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`${MANIFEST} disabledGates[${index}] must declare a non-empty "id"`)
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error(`${MANIFEST} disabledGates[${index}] ("${id}") must declare a non-empty "reason"`)
    }
    if (seen.has(id)) {
      throw new Error(`${MANIFEST} disables gate "${id}" twice`)
    }
    seen.add(id)
    return { id, reason }
  })
  const pagePolicy: unknown = (parsed as { englishOnlySubsystemPages?: unknown }).englishOnlySubsystemPages
  if (pagePolicy === undefined) return { disabledGates }
  if (typeof pagePolicy !== 'object' || pagePolicy === null || Array.isArray(pagePolicy)) {
    throw new Error(`${MANIFEST} englishOnlySubsystemPages must be an object`)
  }
  const englishOnlySubsystemPages: Record<string, string> = {}
  for (const [page, reason] of Object.entries(pagePolicy)) {
    if (!/^[a-z][a-z0-9-]*\.md$/.test(page)) {
      throw new Error(`${MANIFEST} englishOnlySubsystemPages contains an invalid English basename: "${page}"`)
    }
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error(`${MANIFEST} englishOnlySubsystemPages["${page}"] must declare a non-empty reason`)
    }
    englishOnlySubsystemPages[page] = reason
  }
  return { disabledGates, englishOnlySubsystemPages }
}

/**
 * Select required language files for mapped subsystem pages.
 * English remains required; unnamed pages retain both language sides.
 * @param pages - English basenames discovered through the catalog's owning-page maps.
 * @param policy - validated fork-local choices, independent of disabled aggregate gates.
 * @returns each English basename and the language files its generator must validate and render.
 * @throws when an English-only choice names no mapped page.
 */
export function resolveForkSubsystemPages(pages: readonly string[], policy: ForkGatePolicy): Map<string, string[]> {
  const englishOnly = policy.englishOnlySubsystemPages ?? {}
  const mapped = new Set(pages)
  for (const page of Object.keys(englishOnly)) {
    if (!mapped.has(page)) {
      throw new Error(`${MANIFEST} englishOnlySubsystemPages names an unmapped subsystem: "${page}"`)
    }
  }
  return new Map(pages.map(page => [page, Object.hasOwn(englishOnly, page) ? [page] : [page, page.replace(/\.md$/, '.zh.md')]]))
}

/**
 * The subset of a gate this module reads. Declared structurally and applied
 * generically so the caller's own gate type flows through unchanged: importing
 * the upstream `Gate` would make this fork-owned file depend on an
 * upstream-owned declaration, and returning this narrow type instead of the
 * caller's would not typecheck.
 */
export interface ForkGateLike {
  /** Gate id the policy matches on. */
  id: string
  /** Gate ids that must pass first. */
  needs?: string[]
  /** Gate ids that must settle first, regardless of outcome. */
  after?: string[]
}

/**
 * Remove fork-disabled gates from one aggregate's gate list.
 *
 * A removed gate is also pruned from every surviving gate's `needs` and
 * `after` lists, because a dependency naming an absent gate would strand the
 * dependent as permanently unsatisfied.
 *
 * @param gates - the aggregate's gate list as upstream declares it.
 * @param policy - the fork-local policy to apply.
 * @returns the gates this fork runs, with dangling dependencies pruned.
 */
export function applyForkGatePolicy<T extends ForkGateLike>(gates: readonly T[], policy: ForkGatePolicy): T[] {
  const removed = new Set(policy.disabledGates.map(entry => entry.id))
  if (removed.size === 0) return [...gates]
  return gates
    .filter(gate => !removed.has(gate.id))
    .map((gate) => {
      const needs = gate.needs?.filter(id => !removed.has(id))
      const after = gate.after?.filter(id => !removed.has(id))
      if (needs === undefined && after === undefined) return gate
      const pruned: T = { ...gate }
      if (needs !== undefined) pruned.needs = needs
      if (after !== undefined) pruned.after = after
      return pruned
    })
}
