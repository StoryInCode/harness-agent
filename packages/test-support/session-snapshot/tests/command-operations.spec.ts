/** Command replay metadata cannot duplicate input, omit commands, or execute arbitrary scripts. */
import { describe, expect, it } from 'vitest'
import { parseCommandSnapshotOperations, resolveCommandSnapshotOperations } from '../src/command-operations.ts'
import { parseSnapshotManifest } from '../src/manifest.ts'

const command = (run: number) => ({ kind: 'command', run })
const restart = { kind: 'restart' }

describe('command snapshot operations', () => {
  it('resolves uninterrupted and restarted canonical command sequences', () => {
    const operations = parseCommandSnapshotOperations([command(0), restart, command(1), command(2)])
    expect(resolveCommandSnapshotOperations(operations, 3)).toEqual(operations)
    expect(resolveCommandSnapshotOperations(undefined, 2)).toEqual([command(0), command(1)])
    expect(resolveCommandSnapshotOperations(undefined, 0)).toEqual([])
  })

  it.each([
    null, {}, [], [null], [[]], [false],
    [{ kind: 'script', code: 'arbitrary()' }],
    [{ ...command(0), line: '/duplicated input' }],
    [command(-1)], [command(-0)], [command(0.5)], [command(Number.MAX_SAFE_INTEGER + 1)],
    [{ kind: 'command', run: '0' }], [{ kind: 'command' }],
    [command(1)], [command(0), command(0)], [command(0), command(2)],
    [restart, command(0)], [command(0), restart],
    [command(0), restart, restart, command(1)],
    [command(0), { ...restart, run: 0 }, command(1)],
  ].map(value => ({ value })))('rejects invalid operation metadata %#', ({ value }) => {
    expect(() => parseCommandSnapshotOperations(value)).toThrow()
  })

  it.each([1, 3])('rejects a canonical command count different from the manifest (%i)', (count) => {
    const operations = parseCommandSnapshotOperations([command(0), restart, command(1)])
    expect(() => resolveCommandSnapshotOperations(operations, count)).toThrow('every canonical command/run')
  })

  it('admits Web command-only manifests', () => {
    expect(parseSnapshotManifest(JSON.stringify({
      version: 1, profile: 'web', input: { operations: [command(0), restart, command(1)] },
    })).input?.operations).toEqual([command(0), restart, command(1)])
  })

  it.each([
    { profile: 'headless', input: { operations: [command(0)] } },
    { profile: 'web', input: { operations: [command(0)], task: 'invented user input' } },
    { profile: 'web', input: { operations: [command(0)], attachments: [] } },
    { profile: 'web', input: { operations: [command(0)], script: 'arbitrary()' } },
  ])('rejects mixed or unsupported controller manifests %#', (value) => {
    expect(() => parseSnapshotManifest(JSON.stringify({ version: 1, ...value }))).toThrow()
  })
})
