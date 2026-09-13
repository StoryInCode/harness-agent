/** Durable JSON corruption cases derived from real Loader and Lifecycle writes. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { observeSource } from '../src/index.ts'
import type { HumanAuthorization } from '../src/types.ts'
import { createFixture } from './harness.ts'

type Capture = 'command' | 'tool' | 'done' | 'failed' | 'ack'
type JsonObject = { [key: string]: unknown }

function object(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null) throw new Error('Expected captured JSON object')
  return value as JsonObject
}

async function capture(kind: Capture) {
  const f = await createFixture()
  let ctx = await f.mount()
  const piece = await ctx.devLoopDirectory.getPiece('00.12')
  const target = await ctx.fs.resolve(piece.path)
  const stat = await ctx.fs.stat(target)
  if (!stat) throw new Error('Missing real fixture source')
  const source = observeSource(piece.path, await ctx.fs.readText(target), stat.version)
  const human = { sessionId: SessionId('records-root'), decision: 'accept' as const, source }
  const authorization: HumanAuthorization = kind === 'tool'
    ? { ...human, kind: 'tool', callId: ToolCallId('records-call'), answer: { id: 'decision', selected: ['Accept'] } }
    : { ...human, kind: 'command', commandId: CommandId('records-accept') }
  await ctx.devLoopLifecycle.transition('00.12', 'todo', 'pending', 'Reviewed source', undefined, authorization)
  if (kind === 'done') await ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')
  if (kind === 'failed') {
    ctx.on('piece/pre-complete', () => { throw new Error('Real policy veto') })
    await expect(ctx.devLoopLifecycle.transition('00.12', 'pending', 'done')).rejects.toThrow('Real policy veto')
  }
  if (kind === 'ack') {
    await ctx.fiber.dispose()
    await writeFile(f.sourcePath, `${await readFile(f.sourcePath, 'utf8')}\nChanged requirements.\n`)
    ctx = await f.mount()
    const anomalies = await ctx.devLoopPersistence.getAnomalies()
    expect(anomalies).toHaveLength(1)
    const anomaly = anomalies[0]!
    expect(anomaly.kind).toBe('source-changed')
    await ctx.devLoopPersistence.acknowledgeAnomaly(anomaly.id,
      { commandId: CommandId('records-ack'), sessionId: SessionId('records-root') },
      'Observed discrepancy without authorizing repair', new AbortController().signal)
  }
  const history = await ctx.devLoopPersistence.getHistory('00.12')
  expect(history.at(-1)?.terminal?.kind).toBe(kind === 'failed' ? 'failed' : 'committed')
  ctx = await f.mount()
  if (kind === 'ack') {
    expect(() => ctx.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  } else {
    expect(ctx.devLoopLifecycle.getStatus('00.12')).toBe(kind === 'done' ? 'done' : 'pending')
  }
  await ctx.fiber.dispose()
  const filename = join(f.storageRoot, 'dev_loop.json')
  const document = object(JSON.parse(await readFile(filename, 'utf8')))
  const table = object(object(document.tables)[kind === 'ack' ? 'anomalies' : 'transitions'])
  const row = Object.values(table).at(-1)
  expect(row).toBeDefined()
  return { f, filename, document, row: object(row) }
}

const cases: { kind: Capture; field: string; value: unknown; error: RegExp }[] = [
  ...[
    ['id', 'dlt-NOT-A-UUID'], ['repositoryId', 'F'.repeat(64)], ['pieceId', '0.12'],
    ['expected', 'other'], ['from', 1], ['to', 'todo'], ['expected', 'pending'],
    ['source', null], ['source.path', ''], ['source.version', ''],
    ['source.rawDigest', 'a'.repeat(63)], ['source.contentDigest', 'G'.repeat(64)],
    ['destinationPath', ''], ['sequence', 0], ['sequence', 1.5], ['sequence', Number.MAX_SAFE_INTEGER + 1],
    ['startedAt', -1], ['startedAt', '1'], ['reason', ''],
    ['authorization', undefined], ['authorization.sessionId', ''], ['authorization.commandId', ''],
    ['authorization.kind', 'model'], ['authorization.decision', 'reject'],
    ['authorization.source.version', 'different-version'],
    ['terminal.kind', 'successful'], ['terminal.effects.header', 'invalid'],
    ['terminal.effects.cleanup', 'invalid'], ['terminal.recordedAt', 0],
    ['terminal.source.path', 'different-path'], ['terminal.source.contentDigest', '0'.repeat(64)],
    ['terminal.source.rawDigest', '0'.repeat(64)], ['terminal.effects.move', 'applied'],
  ].map(([field, value]) => ({ kind: 'command' as const, field: field as string, value, error: /does not match its schema/ })),
  { kind: 'command', field: 'sequence', value: 2, error: /inconsistent sequence/ },
  { kind: 'command', field: 'id', value: 'dlt-00000000-0000-0000-0000-000000000000', error: /key conflicts/ },
  ...[
    ['authorization.callId', ''], ['authorization.answer', null],
    ['authorization.answer.id', 'other'], ['authorization.answer.selected', ['Accept', 'Change']],
  ].map(([field, value]) => ({ kind: 'tool' as const, field: field as string, value, error: /does not match its schema/ })),
  ...['header', 'index', 'move'].map(field => ({ kind: 'done' as const,
    field: `terminal.effects.${field}`, value: 'none', error: /does not match its schema/ })),
  { kind: 'failed', field: 'terminal.code', value: '', error: /does not match its schema/ },
  ...[
    ['id', 'invalid'], ['repositoryId', 'bad'], ['pieceId', 'bad'], ['kind', 'repaired'],
    ['observations', null], ['observations.0.version', ''], ['observedAt', -1], ['acknowledgments', null],
    ['acknowledgments.0.anomalyId', 'dla-00000000-0000-0000-0000-000000000000'],
    ['acknowledgments.0.invocation.commandId', ''], ['acknowledgments.0.invocation.sessionId', ''],
    ['acknowledgments.0.reason', ''], ['acknowledgments.0.observations', []],
    ['acknowledgments.0.recordedAt', 0],
  ].map(([field, value]) => ({ kind: 'ack' as const, field: field as string, value, error: /does not match its schema/ })),
]

it.each(cases)('refuses captured $kind history with altered $field = $value', async ({ kind, field, value, error }) => {
  const { f, filename, document, row } = await capture(kind)
  const segments = field.split('.')
  const leaf = segments.pop()!
  const owner = segments.reduce((current, key) => object(current[key]), row)
  expect(owner[leaf]).not.toEqual(value)
  owner[leaf] = value
  const corrupted = JSON.stringify(document)
  await writeFile(filename, corrupted)
  const sourceBefore = await readFile(kind === 'done' ? f.destinationPath : f.sourcePath)
  const gitBefore = await f.git('status', '--porcelain')
  await expect(f.mount().then(() => undefined)).rejects.toThrow(error)
  expect(await readFile(filename, 'utf8')).toBe(corrupted)
  expect(await readFile(kind === 'done' ? f.destinationPath : f.sourcePath)).toEqual(sourceBefore)
  expect(await f.git('status', '--porcelain')).toBe(gitBefore)
})

it('quarantines a captured acceptance whose terminal field is lost without inventing completion', async () => {
  const { f, filename, document, row } = await capture('command')
  delete row.terminal
  await writeFile(filename, JSON.stringify(document))
  const sourceBefore = await readFile(f.sourcePath)
  const reopened = await f.mount()
  expect(() => reopened.devLoopLifecycle.getStatus('00.12')).toThrow(expect.objectContaining({ code: 'PIECE_QUARANTINED' }))
  await expect(reopened.devLoopLifecycle.transition('00.12', 'todo', 'pending'))
    .rejects.toMatchObject({ code: 'PIECE_QUARANTINED' })
  expect(await reopened.devLoopPersistence.getHistory('00.12')).toEqual([row])
  expect(await reopened.devLoopPersistence.getAnomalies()).toEqual([
    expect.objectContaining({ kind: 'unresolved-intent', transitionId: row.id, acknowledgments: [] }),
  ])
  expect(await readFile(f.sourcePath)).toEqual(sourceBefore)
  expect(await f.git('status', '--porcelain')).toBe('')
})
