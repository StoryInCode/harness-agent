/** Temporary owner-local live recorder; never an alternate application entrypoint or authored Session. */
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import {
  captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot, latestPersistedSessionPaths,
  normalizeSessionSnapshot, redactSessionSnapshotIds, sessionFixtureName, sessionHeaderVersion,
} from '@deepseek-ai/dsh-session-snapshot'
import { launchCommandWeb } from '../snapshots/web/command-process.ts'

it('records only observed successful recovery after actual Web teardown and relaunch', async () => {
  expect(process.env.DSH_SNAPSHOT).toBe('record')
  const repoRoot = resolve(import.meta.dirname, '..')
  const scenario = join(repoRoot, 'snapshots/web/dev-loop-command-recovery')
  const root = await mkdtemp(join(tmpdir(), 'dsh-command-recovery-record-'))
  const cwd = join(root, 'workspace')
  try {
    await cp(join(scenario, 'workspace'), cwd, { recursive: true })
    const source = await readFile(join(cwd, 'plans/pieces/00-command/00.12-recovery.md'), 'utf8')
    const digest = createHash('sha256').update(source).digest('hex')
    const packages = join(root, '.dsh/profiles/node_modules/@deepseek-ai')
    await mkdir(packages, { recursive: true })
    for (const provider of ['directory', 'lifecycle', 'queue', 'persistence']) {
      await symlink(join(repoRoot, 'packages/dev-loop', provider), join(packages, `dsh-dev-loop-${provider}`),
        process.platform === 'win32' ? 'junction' : 'dir')
    }
    const preset = join(root, '.dsh/.agent-presets/snapshot-command')
    await mkdir(preset, { recursive: true })
    const standard = await readFile(join(repoRoot, 'packages/preset/agent-presets/presets/standard/agent.cordis.yml'), 'utf8')
    const entry = join(repoRoot, 'packages/dev-loop/command', process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts')
    await writeFile(join(preset, 'agent.cordis.yml'), `${standard}\n- id: snapshot-dev-loop-command\n  name: ${JSON.stringify(entry)}\n  config:\n    maxInputBytes: 4096\n    maxOutputBytes: 65536\n`)
    await writeFile(join(preset, 'preset.yml'), 'name: Snapshot command\ndescription: Scoped command replay fixture\n')
    const patch = join(scenario, 'cordis.patch.yml')
    let web = await launchCommandWeb(repoRoot, root, patch)
    const create = async (): Promise<void> => {
      expect(await web.request('session/create', {
        request: { sessionId: 'command-snapshot', cwd, agentPreset: 'snapshot-command' },
      })).toMatchObject({ sessionId: 'command-snapshot' })
    }
    const execute = async (line: string): Promise<{ result: { kind: string; text: string } }> =>
      await web.request('commands/execute', {
        agentId: 'command-snapshot', line, submittedAttachments: [],
      }) as { result: { kind: string; text: string } }
    try {
      await create()
      expect((await execute('/dev-loop-recovery inspect 00.12')).result).toEqual({
        kind: 'success', text: JSON.stringify({ pieceId: '00.12', history: [], anomalies: [] }),
      })
      const todo = await execute('/dev-loop show 00.12')
      expect(todo.result).toMatchObject({ kind: 'success' })
      expect(todo.result.text).toContain(`Status: todo\nPath: ${cwd}/plans/pieces/00-command/00.12-recovery.md`)
      expect((await execute(`/dev-loop approve 00.12 ${digest}`)).result).toEqual({
        kind: 'success', text: 'Piece 00.12: pending.',
      })
      await web.close()
      web = await launchCommandWeb(repoRoot, root, patch)
      await create()
      const pending = await execute('/dev-loop show 00.12')
      expect(pending.result).toMatchObject({ kind: 'success' })
      expect(pending.result.text).toContain(`Status: pending\nPath: ${cwd}/plans/pieces/00-command/00.12-recovery.md`)
    } finally { await web.close() }
    expect(await captureWorkspaceSnapshot(cwd)).toEqual(await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected')))
    const logRoot = join(root, '.dsh/sessions')
    const paths = latestPersistedSessionPaths((await readdir(logRoot, { recursive: true })).map(path => join(logRoot, path)))
    expect(paths).toHaveLength(1)
    const raw = await readFile(paths[0]!, 'utf8')
    const rows = raw.trim().split('\n').map(line => JSON.parse(line) as { type: string })
    expect(rows.filter(row => row.type === 'command/run')).toHaveLength(4)
    expect(rows.filter(row => row.type === 'command/done')).toHaveLength(4)
    expect(rows.some(row => /^(request\/|user\/message|assistant\/|turn\/|step\/)/u.test(row.type))).toBe(false)
    const [redacted] = redactSessionSnapshotIds([raw])
    expect(redacted).toBeDefined()
    const actual = normalizeSessionSnapshot(redacted!, { cwd, sessionIds: [] }, { identityMode: 'preserve' })
    expect(redactSessionSnapshotIds([actual])).toEqual([actual])
    expect(normalizeSessionSnapshot(actual, { cwd: '{{cwd}}', sessionIds: [] }, { identityMode: 'preserve' })).toBe(actual)
    await writeFile(join(scenario, sessionFixtureName(0, sessionHeaderVersion(raw, 'observed recovery Session'))), actual, { flag: 'wx' })
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120_000)
