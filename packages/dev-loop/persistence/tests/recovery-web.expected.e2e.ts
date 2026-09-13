/** Preimplementation public-Web RED expectation; no fabricated canonical Session recording. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { latestPersistedSessionPaths } from '@deepseek-ai/dsh-session-snapshot'
import { launchCommandWeb } from '../../../../snapshots/web/command-process.ts'
import { createFixture } from './harness.ts'

const repoRoot = resolve(import.meta.dirname, '../../../..')

it('public Web recovery inspect logs its actual command without a model turn or workspace mutation', async () => {
  const fixture = await createFixture()
  const root = dirname(fixture.repository)
  const original = await readFile(fixture.sourcePath, 'utf8')
  const suffix = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
  const entry = (name: string) => join(repoRoot, 'packages/dev-loop', name, suffix)
  const recovery = join(repoRoot, 'packages/dev-loop/persistence',
    process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/command.js' : 'src/command.ts')
  const patch = join(root, 'recovery.patch.yml')
  await writeFile(patch, JSON.stringify([
    { id: 'session-persistence-jsonl', config: { root: join(root, '.dsh/sessions'), compression: 'none' } },
    { id: 'session-title-llm', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { insert: [
      { id: 'recovery-directory', name: entry('directory'), config: { root: join(fixture.repository, 'plans/pieces') } },
      { id: 'recovery-persistence', name: entry('persistence'), config: {
        repositoryRoot: fixture.repository, maxRecordBytes: 1048576, maxHistoryRecords: 100,
      } },
      { id: 'recovery-lifecycle', name: entry('lifecycle'), inject: ['devLoopPersistence'], config: { durability: 'required' } },
      { id: 'recovery-command', name: recovery, config: { maxInputBytes: 4096, maxOutputBytes: 65536 } },
    ] },
  ], null, 2))
  const web = await launchCommandWeb(repoRoot, root, patch)
  const text = JSON.stringify({ pieceId: '00.12', history: [], anomalies: [] })
  try {
    expect(await web.request('session/create', {
      request: { sessionId: 'recovery-web-root', cwd: fixture.repository, agentPreset: 'standard' },
    })).toMatchObject({ sessionId: 'recovery-web-root' })
    expect(await web.request('commands/execute', {
      agentId: 'recovery-web-root', line: '/dev-loop-recovery inspect 00.12', submittedAttachments: [],
    })).toMatchObject({ result: { kind: 'success', text } })
  } finally { await web.close() }
  expect(await readFile(fixture.sourcePath, 'utf8')).toBe(original)
  expect(await fixture.git('status', '--porcelain')).toBe('')
  const logRoot = join(root, '.dsh/sessions')
  const files = latestPersistedSessionPaths((await readdir(logRoot, { recursive: true })).map(path => join(logRoot, path)))
  expect(files).toHaveLength(1)
  const rows = (await readFile(files[0]!, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as {
    type: string
    data?: { commandId?: string; name?: string; args?: string; source?: { kind?: string }; kind?: string; text?: string }
  })
  const commands = rows.filter(row => row.type === 'command/run' || row.type === 'command/done')
  expect(commands).toHaveLength(2)
  expect(commands[0]).toMatchObject({ type: 'command/run', data: {
    name: 'dev-loop-recovery', args: ' inspect 00.12', source: { kind: 'user' },
  } })
  expect(commands[1]).toMatchObject({ type: 'command/done', data: {
    commandId: commands[0]?.data?.commandId, kind: 'success', text,
  } })
  expect(rows.some(row => /^(request\/|user\/message|assistant\/|turn\/|step\/)/u.test(row.type))).toBe(false)
})
