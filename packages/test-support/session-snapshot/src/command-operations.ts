/** Declarative process restarts between canonical command/run records. */

/** A command ordinal selects recorded input; a restart contributes no command text. */
export type CommandSnapshotOperation =
  | { kind: 'command'; run: number }
  | { kind: 'restart' }

/**
 * Validate YAML controller operations without accepting executable scripts or duplicated input.
 * @param value Untrusted manifest operations.
 * @returns Commands in canonical order, separated only by nonadjacent internal restarts.
 */
export function parseCommandSnapshotOperations(value: unknown): CommandSnapshotOperation[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('input.operations must be a non-empty array')
  let nextRun = 0
  let previousRestart = false
  return value.map((item: unknown, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('input.operations entries must be objects')
    }
    const operation = item as Record<string, unknown>
    if (operation.kind === 'command') {
      if (Object.keys(operation).some(key => key !== 'kind' && key !== 'run')) {
        throw new Error('input.operations command has unknown fields')
      }
      if (!Number.isSafeInteger(operation.run) || Object.is(operation.run, -0) || operation.run !== nextRun) {
        throw new Error('input.operations command ordinals must be contiguous, ascending, and start at zero')
      }
      nextRun++
      previousRestart = false
      return { kind: 'command', run: operation.run }
    }
    if (operation.kind !== 'restart' || Object.keys(operation).length !== 1) {
      throw new Error('input.operations accepts only command and restart operations with their declared fields')
    }
    if (index === 0 || index === value.length - 1 || previousRestart) {
      throw new Error('input.operations restart must separate two commands')
    }
    previousRestart = true
    return { kind: 'restart' }
  })
}

/**
 * Require the manifest to consume every canonical command exactly once.
 * @param operations Parsed manifest operations, absent for uninterrupted replay.
 * @param commandCount Number of command/run records in the selected Session.
 * @returns The explicit operations or the canonical uninterrupted command sequence.
 */
export function resolveCommandSnapshotOperations(
  operations: readonly CommandSnapshotOperation[] | undefined,
  commandCount: number,
): readonly CommandSnapshotOperation[] {
  if (operations === undefined) return Array.from({ length: commandCount }, (_, run) => ({ kind: 'command', run }))
  if (operations.filter(operation => operation.kind === 'command').length !== commandCount) {
    throw new Error('input.operations must consume every canonical command/run exactly once')
  }
  return operations
}
