/**
 * Test coverage for fork-local gate overrides policy.
 *
 * Covers disabled-gate parsing, dependency pruning, English-only page
 * validation and selective catalog language requirements.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { applyForkGatePolicy, readForkGatePolicy, resolveForkSubsystemPages } from './fork-gate-overrides.ts'
import type { ForkGateLike } from './fork-gate-overrides.ts'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-fork-gate-policy-'))
  onTestFinished(() => {
    rmSync(root, { recursive: true, force: true })
  })
  return root
}

function writeManifest(root: string, content: string): void {
  const absolute = join(root, 'scripts/fork-gate-overrides.manifest.json')
  mkdirSync(dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
}

describe('fork-gate-overrides', () => {
  describe('readForkGatePolicy - disabledGates regression', () => {
    it('rejects a missing manifest file', () => {
      const root = fixture()
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json is missing or not valid JSON',
      )
    })

    it('rejects a manifest with invalid JSON syntax', () => {
      const root = fixture()
      writeManifest(root, '{ invalid: json')
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json is missing or not valid JSON',
      )
    })

    it.each(['[]', 'null', '"string"', '123', 'true'])(
      'rejects root manifest that is not a JSON object: %s',
      (raw) => {
        const root = fixture()
        writeManifest(root, raw)
        expect(() => readForkGatePolicy(root)).toThrow(
          'scripts/fork-gate-overrides.manifest.json must contain a JSON object',
        )
      },
    )

    it.each([
      '{}',
      '{"disabledGates": null}',
      '{"disabledGates": "not-an-array"}',
      '{"disabledGates": 42}',
      '{"disabledGates": {}}',
    ])('rejects manifest without disabledGates array: %s', (raw) => {
      const root = fixture()
      writeManifest(root, raw)
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json must declare a "disabledGates" array',
      )
    })

    it.each([
      '{"disabledGates": ["gate-id"]}',
      '{"disabledGates": [null]}',
      '{"disabledGates": [[]]}',
      '{"disabledGates": [42]}',
    ])('rejects non-object entry in disabledGates: %s', (raw) => {
      const root = fixture()
      writeManifest(root, raw)
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json disabledGates[0] must be an object',
      )
    })

    it.each([
      '{"disabledGates": [{"reason": "why"}]}',
      '{"disabledGates": [{"id": "", "reason": "why"}]}',
      '{"disabledGates": [{"id": 123, "reason": "why"}]}',
      '{"disabledGates": [{"id": null, "reason": "why"}]}',
    ])('rejects disabledGates entry without a non-empty string id: %s', (raw) => {
      const root = fixture()
      writeManifest(root, raw)
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json disabledGates[0] must declare a non-empty "id"',
      )
    })

    it.each([
      '{"disabledGates": [{"id": "gate-a"}]}',
      '{"disabledGates": [{"id": "gate-a", "reason": ""}]}',
      '{"disabledGates": [{"id": "gate-a", "reason": "   \\t\\n"}]}',
      '{"disabledGates": [{"id": "gate-a", "reason": 123}]}',
      '{"disabledGates": [{"id": "gate-a", "reason": null}]}',
    ])('rejects disabledGates entry without a non-empty string reason: %s', (raw) => {
      const root = fixture()
      writeManifest(root, raw)
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json disabledGates[0] ("gate-a") must declare a non-empty "reason"',
      )
    })

    it('rejects duplicate gate ids in disabledGates', () => {
      const root = fixture()
      writeManifest(
        root,
        JSON.stringify({
          disabledGates: [
            { id: 'dup-gate', reason: 'first' },
            { id: 'dup-gate', reason: 'second' },
          ],
        }),
      )
      expect(() => readForkGatePolicy(root)).toThrow(
        'scripts/fork-gate-overrides.manifest.json disables gate "dup-gate" twice',
      )
    })

    it('parses a valid disabledGates manifest', () => {
      const root = fixture()
      writeManifest(
        root,
        JSON.stringify({
          disabledGates: [
            { id: 'gate-one', reason: 'first reason' },
            { id: 'gate-two', reason: 'second reason' },
          ],
        }),
      )
      expect(readForkGatePolicy(root)).toEqual({
        disabledGates: [
          { id: 'gate-one', reason: 'first reason' },
          { id: 'gate-two', reason: 'second reason' },
        ],
      })
    })
  })

  describe('resolveForkSubsystemPages', () => {
    it('requires both languages by default even when translation-pairing is disabled', () => {
      expect(resolveForkSubsystemPages(['core.md'], {
        disabledGates: [{ id: 'translation-pairing', reason: 'aggregate-only choice' }],
      })).toEqual(new Map([['core.md', ['core.md', 'core.zh.md']]]))
    })

    it('omits only the explicitly named Chinese page while retaining English and other pairs', () => {
      expect(resolveForkSubsystemPages(['core.md', 'development-loop.md'], {
        disabledGates: [],
        englishOnlySubsystemPages: { 'development-loop.md': 'fork-local English documentation' },
      })).toEqual(new Map([
        ['core.md', ['core.md', 'core.zh.md']],
        ['development-loop.md', ['development-loop.md']],
      ]))
    })

    it('an empty page policy preserves every mapped pair', () => {
      expect(resolveForkSubsystemPages(['core.md', 'tools.md'], {
        disabledGates: [], englishOnlySubsystemPages: {},
      })).toEqual(new Map([
        ['core.md', ['core.md', 'core.zh.md']],
        ['tools.md', ['tools.md', 'tools.zh.md']],
      ]))
    })

    it('rejects a stale or misspelled English-only owner instead of silently ignoring it', () => {
      expect(() => resolveForkSubsystemPages(['core.md'], {
        disabledGates: [], englishOnlySubsystemPages: { 'missing.md': 'no such owner' },
      })).toThrow('englishOnlySubsystemPages names an unmapped subsystem: "missing.md"')
    })
  })

  describe('applyForkGatePolicy - dependency pruning regression', () => {
    it('returns a shallow copy of gates unchanged when disabledGates is empty', () => {
      const gates: ForkGateLike[] = [
        { id: 'gate-a' },
        { id: 'gate-b', needs: ['gate-a'], after: ['gate-a'] },
      ]
      const result = applyForkGatePolicy(gates, { disabledGates: [] })
      expect(result).toEqual(gates)
      expect(result).not.toBe(gates)
    })

    it('removes gates listed in disabledGates', () => {
      const gates: ForkGateLike[] = [{ id: 'gate-a' }, { id: 'gate-b' }, { id: 'gate-c' }]
      const result = applyForkGatePolicy(gates, {
        disabledGates: [{ id: 'gate-b', reason: 'skipped in fork' }],
      })
      expect(result.map(g => g.id)).toEqual(['gate-a', 'gate-c'])
    })

    it('prunes disabled gates from needs dependencies', () => {
      const gates: ForkGateLike[] = [
        { id: 'gate-a' },
        { id: 'gate-b' },
        { id: 'gate-c', needs: ['gate-a', 'gate-b', 'gate-d'] },
      ]
      const result = applyForkGatePolicy(gates, {
        disabledGates: [{ id: 'gate-b', reason: 'skipped in fork' }],
      })
      const gateC = result.find(g => g.id === 'gate-c')
      expect(gateC?.needs).toEqual(['gate-a', 'gate-d'])
    })

    it('prunes disabled gates from after dependencies', () => {
      const gates: ForkGateLike[] = [
        { id: 'gate-a' },
        { id: 'gate-b' },
        { id: 'gate-c', after: ['gate-a', 'gate-b', 'gate-d'] },
      ]
      const result = applyForkGatePolicy(gates, {
        disabledGates: [{ id: 'gate-b', reason: 'skipped in fork' }],
      })
      const gateC = result.find(g => g.id === 'gate-c')
      expect(gateC?.after).toEqual(['gate-a', 'gate-d'])
    })

    it('prunes both needs and after simultaneously on surviving gates', () => {
      const gates: ForkGateLike[] = [
        { id: 'gate-a' },
        { id: 'gate-b' },
        { id: 'gate-c', needs: ['gate-b'], after: ['gate-b'] },
      ]
      const result = applyForkGatePolicy(gates, {
        disabledGates: [{ id: 'gate-b', reason: 'skipped in fork' }],
      })
      expect(result).toEqual([
        { id: 'gate-a' },
        { id: 'gate-c', needs: [], after: [] },
      ])
    })

    it('returns unmodified gate objects when neither needs nor after is declared', () => {
      const gateA = { id: 'gate-a' }
      const gateB = { id: 'gate-b' }
      const result = applyForkGatePolicy([gateA, gateB], {
        disabledGates: [{ id: 'gate-b', reason: 'skip' }],
      })
      expect(result[0]).toBe(gateA)
    })

    it('preserves custom generic gate properties and does not mutate input', () => {
      interface CustomGate extends ForkGateLike {
        command: string
        order: number
      }
      const originalNeeds = ['gate-b']
      const originalGate: CustomGate = {
        id: 'gate-a',
        command: 'pnpm test',
        order: 1,
        needs: originalNeeds,
      }
      const inputGates: CustomGate[] = [originalGate, { id: 'gate-b', command: 'pnpm lint', order: 2 }]
      const result = applyForkGatePolicy(inputGates, {
        disabledGates: [{ id: 'gate-b', reason: 'skip' }],
      })

      expect(result).toEqual([
        {
          id: 'gate-a',
          command: 'pnpm test',
          order: 1,
          needs: [],
        },
      ])
      expect(inputGates).toHaveLength(2)
      expect(originalGate.needs).toBe(originalNeeds)
      expect(originalGate.needs).toEqual(['gate-b'])
    })
  })

  describe('readForkGatePolicy - englishOnlySubsystemPages addition', () => {
    describe('compatibility and preservation', () => {
      it('remains compatible when englishOnlySubsystemPages is absent', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [{ id: 'translation-pairing', reason: 'English-only docs' }],
          }),
        )
        const policy = readForkGatePolicy(root)
        expect(policy.disabledGates).toEqual([
          { id: 'translation-pairing', reason: 'English-only docs' },
        ])
        expect(policy.englishOnlySubsystemPages).toBeUndefined()
      })

      it('accepts supplied empty object for englishOnlySubsystemPages', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: {},
          }),
        )
        const policy = readForkGatePolicy(root)
        expect(policy.englishOnlySubsystemPages).toEqual({})
      })

      it('preserves valid englishOnlySubsystemPages entries matching ^[a-z][a-z0-9-]*\\.md$', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: {
              'alpha.md': 'Alpha subsystem docs are English-only in this fork.',
              'subsystem-two.md': 'Maintained without Chinese counterpart.',
              'beta-3-docs.md': 'Fork-local subsystem documentation.',
            },
          }),
        )
        const policy = readForkGatePolicy(root)
        expect(policy.englishOnlySubsystemPages).toEqual({
          'alpha.md': 'Alpha subsystem docs are English-only in this fork.',
          'subsystem-two.md': 'Maintained without Chinese counterpart.',
          'beta-3-docs.md': 'Fork-local subsystem documentation.',
        })
      })
    })

    describe('type validation rejection', () => {
      it('rejects null englishOnlySubsystemPages with attributed error', () => {
        const root = fixture()
        writeManifest(root, JSON.stringify({ disabledGates: [], englishOnlySubsystemPages: null }))
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects array englishOnlySubsystemPages with attributed error', () => {
        const root = fixture()
        writeManifest(root, JSON.stringify({ disabledGates: [], englishOnlySubsystemPages: ['alpha.md'] }))
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects string englishOnlySubsystemPages with attributed error', () => {
        const root = fixture()
        writeManifest(root, JSON.stringify({ disabledGates: [], englishOnlySubsystemPages: 'alpha.md' }))
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects numeric englishOnlySubsystemPages with attributed error', () => {
        const root = fixture()
        writeManifest(root, JSON.stringify({ disabledGates: [], englishOnlySubsystemPages: 42 }))
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects boolean englishOnlySubsystemPages with attributed error', () => {
        const root = fixture()
        writeManifest(root, JSON.stringify({ disabledGates: [], englishOnlySubsystemPages: true }))
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })
    })

    describe('basename validation rejection', () => {
      it('rejects Chinese counterpart basenames ending in .zh.md', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'subsystem.zh.md': 'English-only justification' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects basenames containing forward slashes', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'docs/subsystems/alpha.md': 'English-only justification' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects basenames containing backslashes', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'subsystems\\alpha.md': 'English-only justification' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects directory traversal sequences in basename', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { '../subsystem.md': 'English-only justification' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects uppercase letters in basename', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'Alpha.md': 'English-only justification' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it.each(['1subsystem.md', '-subsystem.md'])(
        'rejects basename starting with a digit or hyphen: %s',
        (basename) => {
          const root = fixture()
          writeManifest(
            root,
            JSON.stringify({
              disabledGates: [],
              englishOnlySubsystemPages: { [basename]: 'English-only justification' },
            }),
          )
          expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
        },
      )

      it.each(['alpha.txt', 'alpha.markdown', 'alpha', 'alpha.'])(
        'rejects basename without .md extension: %s',
        (basename) => {
          const root = fixture()
          writeManifest(
            root,
            JSON.stringify({
              disabledGates: [],
              englishOnlySubsystemPages: { [basename]: 'English-only justification' },
            }),
          )
          expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
        },
      )

      it('rejects empty string basename', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { '': 'English-only justification' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it.each(['sub_system.md', 'sub@system.md', 'sub system.md'])(
        'rejects basename containing disallowed character: %s',
        (basename) => {
          const root = fixture()
          writeManifest(
            root,
            JSON.stringify({
              disabledGates: [],
              englishOnlySubsystemPages: { [basename]: 'English-only justification' },
            }),
          )
          expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
        },
      )

      it.each(['.md', '.zh.md'])(
        'rejects bare dot extensions as basenames: %s',
        (basename) => {
          const root = fixture()
          writeManifest(
            root,
            JSON.stringify({
              disabledGates: [],
              englishOnlySubsystemPages: { [basename]: 'English-only justification' },
            }),
          )
          expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
        },
      )
    })

    describe('reason validation rejection', () => {
      it('rejects empty string reason with attributed error', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'alpha.md': '' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it('rejects whitespace-only reason with attributed error', () => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'alpha.md': '   \t\n' },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })

      it.each([
        ['null', null],
        ['numeric', 123],
        ['boolean', true],
        ['array', []],
        ['object', {}],
      ])('rejects non-string %s reason with attributed error', (_kind, reason) => {
        const root = fixture()
        writeManifest(
          root,
          JSON.stringify({
            disabledGates: [],
            englishOnlySubsystemPages: { 'alpha.md': reason },
          }),
        )
        expect(() => readForkGatePolicy(root)).toThrow(/englishOnlySubsystemPages/i)
      })
    })
  })
})
