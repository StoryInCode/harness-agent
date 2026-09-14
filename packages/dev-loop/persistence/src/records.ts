/** Durable JSON parsers for the authoritative dev_loop tables. */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { ReconciliationAnomaly, TransitionRecord } from './types.ts'

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid record object')
  return value as Record<string, unknown>
}
function text(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('invalid record string')
}
function matching(value: unknown, pattern: RegExp): void {
  text(value)
  if (!pattern.test(value)) throw new Error('invalid record identifier or digest')
}
function integer(value: unknown, minimum = 0): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('invalid record integer')
}
function member(value: unknown, values: readonly string[]): void {
  if (typeof value !== 'string' || !values.includes(value)) throw new Error('invalid record status')
}
const digest = /^[0-9a-f]{64}$/
const transitionId = /^dlt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const anomalyId = /^dla-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
function source(value: unknown): void {
  const row = object(value)
  text(row.path); text(row.version)
  matching(row.rawDigest, digest); matching(row.contentDigest, digest)
}
function sources(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('invalid record observations')
  value.forEach(source)
}
function invocation(value: unknown): void {
  const row = object(value)
  text(row.commandId); text(row.sessionId)
}
function effects(value: unknown): void {
  const row = object(value)
  for (const key of ['header', 'index', 'move']) member(row[key], ['none', 'applied', 'unknown'])
  member(row.cleanup, ['not-needed', 'restored', 'failed', 'unknown'])
}
function authorization(value: unknown): void {
  const row = object(value)
  text(row.sessionId); source(row.source)
  member(row.decision, ['accept']); member(row.kind, ['tool', 'command'])
  if (row.kind === 'command') text(row.commandId)
  else {
    text(row.callId)
    const answer = object(row.answer)
    if (answer.id !== 'decision' || JSON.stringify(answer.selected) !== '["Accept"]') throw new Error('invalid record answer')
  }
}
function acknowledgment(value: unknown, id: unknown): void {
  const row = object(value)
  if (row.anomalyId !== id) throw new Error('invalid record acknowledgment identity')
  invocation(row.invocation); text(row.reason); sources(row.observations); integer(row.recordedAt)
}
function parseTransition(value: unknown): TransitionRecord {
  const row = object(value)
  matching(row.id, transitionId); matching(row.repositoryId, digest); matching(row.pieceId, /^\d{2}\.\d{2}[a-z]?$/)
  for (const key of ['expected', 'from', 'to']) member(row[key], ['todo', 'pending', 'blocked', 'done'])
  if (row.expected !== row.from || !['todo:pending', 'pending:blocked', 'pending:done', 'blocked:todo'].includes(`${String(row.from)}:${String(row.to)}`)) throw new Error('invalid record transition edge')
  source(row.source); text(row.destinationPath); integer(row.sequence, 1); integer(row.startedAt)
  if (row.reason !== undefined) text(row.reason)
  if (row.authorization !== undefined) {
    authorization(row.authorization)
    const accepted = object(object(row.authorization).source)
    const observed = object(row.source)
    if (['path', 'version', 'rawDigest', 'contentDigest'].some(key => accepted[key] !== observed[key])) throw new Error('invalid record authorization source')
  }
  if (row.from === 'todo' && row.authorization === undefined) throw new Error('invalid record missing authorization')
  if (row.terminal !== undefined) {
    const terminal = object(row.terminal)
    member(terminal.kind, ['committed', 'failed']); effects(terminal.effects); integer(terminal.recordedAt)
    if ((terminal.recordedAt as number) < (row.startedAt as number)) throw new Error('invalid record timestamp order')
    if (terminal.kind === 'committed') {
      source(terminal.source)
      const initial = object(row.source)
      const final = object(terminal.source)
      const applied = object(terminal.effects)
      if (final.path !== row.destinationPath || final.contentDigest !== initial.contentDigest) throw new Error('invalid record committed source')
      if (row.to === 'done') {
        if (['header', 'index', 'move'].some(key => applied[key] !== 'applied')) throw new Error('invalid record completion effects')
      } else if (final.rawDigest !== initial.rawDigest || final.path !== initial.path
        || ['header', 'index', 'move'].some(key => applied[key] !== 'none')) throw new Error('invalid record non-completion effects')
    } else { text(terminal.code); if (terminal.source !== undefined) source(terminal.source) }
  }
  return structuredClone(value) as TransitionRecord
}
function parseAnomaly(value: unknown): ReconciliationAnomaly {
  const row = object(value)
  matching(row.id, anomalyId); matching(row.repositoryId, digest); matching(row.pieceId, /^\d{2}\.\d{2}[a-z]?$/)
  member(row.kind, ['unresolved-intent', 'missing-source', 'duplicate-source', 'unjournaled-done', 'source-changed', 'unknown-piece', 'status-path-mismatch', 'uncertain-effect'])
  if (row.transitionId !== undefined) matching(row.transitionId, transitionId)
  sources(row.observations); integer(row.observedAt)
  if (!Array.isArray(row.acknowledgments)) throw new Error('invalid record acknowledgments')
  let recordedAt = row.observedAt as number
  row.acknowledgments.forEach((value) => {
    acknowledgment(value, row.id)
    const entry = object(value)
    if ((entry.recordedAt as number) < recordedAt || JSON.stringify(entry.observations) !== JSON.stringify(row.observations)) throw new Error('invalid record acknowledgment observations or timestamp')
    recordedAt = entry.recordedAt as number
  })
  return structuredClone(value) as ReconciliationAnomaly
}

function table<K extends string, V>(parse: (value: unknown) => V) {
  return domainTable<K, V>(z.unknown().transform(parse))
}

/** Single-row intents and terminals; invalid authoritative data refuses the entire open. */
export const persistenceDomain = defineDomain({
  name: 'dev_loop', version: 1, layout: 'single',
  tables: {
    transitions: table<string, TransitionRecord>(parseTransition),
    anomalies: table<string, ReconciliationAnomaly>(parseAnomaly),
  },
})
