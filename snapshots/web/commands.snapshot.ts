/** Canonical command/run input replayed over authenticated shipped-Web Remote RPC. */
import { cp, mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import {
  assertSessionFixtureVersion, captureExpectedWorkspaceSnapshot, captureWorkspaceSnapshot,
  latestPersistedSessionPaths, normalizeSessionSnapshot, parseSnapshotManifest,
  redactSessionSnapshotIds, resolveCommandSnapshotOperations,
  sessionFixtureFiles, sessionFixtureName, sessionHeaderVersion,
} from '@deepseek-ai/dsh-session-snapshot'
import { launchCommandWeb } from './command-process.ts'

const repoRoot = resolve(import.meta.dirname, '../..')
const mode = process.env.DSH_SNAPSHOT ?? 'replay'
if (!['replay', 'record', 'refresh'].includes(mode)) throw new Error(`Unknown snapshot mode: ${mode}`)

/** Preserve rawInput's leading whitespace: the command parser, not this adapter, owns tokenization. */
function commandLines(fixture: string): string[] {
  const rows = fixture.trim().split('\n').map(line => JSON.parse(line) as {
    type: string
    data?: { name?: string; args?: string; source?: { kind?: string } }
  })
  return rows.filter(row => row.type === 'command/run').map(({ data }) => {
    if (typeof data?.name !== 'string' || typeof data.args !== 'string' || data.source?.kind !== 'user') {
      throw new Error('Command replay requires recorded name, raw args, and user source')
    }
    return `/${data.name}${data.args}`
  })
}

/** Copy the shipped preset; only the temporary copy receives the scoped command Consumer. */
async function prepareCommandPreset(root: string): Promise<string> {
  const agentPreset = 'snapshot-command'
  const packagesRoot = join(root, '.dsh', 'profiles', 'node_modules', '@deepseek-ai')
  await mkdir(packagesRoot, { recursive: true })
  for (const provider of ['directory', 'lifecycle', 'queue', 'persistence']) {
    await symlink(join(repoRoot, 'packages/dev-loop', provider),
      join(packagesRoot, `dsh-dev-loop-${provider}`), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const presetRoot = join(root, '.dsh', '.agent-presets', agentPreset)
  await mkdir(presetRoot, { recursive: true })
  const standard = await readFile(join(repoRoot,
    'packages/preset/agent-presets/presets/standard/agent.cordis.yml'), 'utf8')
  const commandModule = join(repoRoot, 'packages/dev-loop/command',
    process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts')
  const consumer = [
    '- id: snapshot-dev-loop-command', `  name: ${JSON.stringify(commandModule)}`,
    '  config:', '    maxInputBytes: 4096', '    maxOutputBytes: 65536', '',
  ].join('\n')
  await writeFile(join(presetRoot, 'agent.cordis.yml'), `${standard}\n${consumer}`)
  await writeFile(join(presetRoot, 'preset.yml'),
    'name: Snapshot command\ndescription: Scoped command replay fixture\n')
  return agentPreset
}

it.each(['command-status', 'dev-loop-command-review', 'dev-loop-command-recovery'])(
  'shipped Web %s persists without any model request', async (name) => {
    const scenario = join(import.meta.dirname, name)
    const manifestPath = join(scenario, 'snapshot.yml')
    const manifest = parseSnapshotManifest(await readFile(manifestPath, 'utf8'), manifestPath)
    expect(manifest).toMatchObject({ profile: 'web', workspace: { final: true } })
    const fixture = sessionFixtureFiles(await readdir(scenario))[0]
    if (fixture === undefined) throw new Error('command scenario has no canonical Session')
    const expected = await readFile(join(scenario, fixture.name), 'utf8')
    assertSessionFixtureVersion(fixture.name, expected)
    const lines = commandLines(expected)
    expect(lines.length).toBeGreaterThan(0)
    const operations = resolveCommandSnapshotOperations(manifest.input?.operations, lines.length)
    const root = await mkdtemp(join(tmpdir(), 'dsh-web-command-'))
    const cwd = join(root, 'workspace')
    try {
      await mkdir(cwd)
      let agentPreset = 'standard'
      if (name !== 'command-status') {
        agentPreset = await prepareCommandPreset(root)
        await cp(join(scenario, 'workspace'), cwd, { recursive: true })
      }
      let web = await launchCommandWeb(repoRoot, root, join(scenario, 'cordis.patch.yml'))
      const createSession = async (): Promise<void> => {
        expect(await web.request('session/create', {
          request: { sessionId: 'command-snapshot', cwd, agentPreset },
        })).toMatchObject({ sessionId: 'command-snapshot' })
      }
      try {
        await createSession()
        for (const operation of operations) {
          switch (operation.kind) {
            case 'restart':
              await web.close()
              web = await launchCommandWeb(repoRoot, root, join(scenario, 'cordis.patch.yml'))
              await createSession()
              break
            case 'command':
              expect(await web.request('commands/execute', {
                agentId: 'command-snapshot', line: lines[operation.run]!, submittedAttachments: [],
              })).toMatchObject({ result: { kind: 'success' } })
              break
            default: assertNever(operation)
          }
        }
      } finally { await web.close() }
      const logRoot = join(root, '.dsh', 'sessions')
      const inventory = await readdir(logRoot, { recursive: true })
      const paths = latestPersistedSessionPaths(inventory.map(path => join(logRoot, path)))
      expect(paths, `${JSON.stringify(inventory)}\n${web.diagnostics()}`).toHaveLength(1)
      const raw = await readFile(paths[0]!, 'utf8')
      const [redacted] = redactSessionSnapshotIds([raw])
      if (redacted === undefined) throw new Error('normalizer omitted primary Session')
      const actual = normalizeSessionSnapshot(redacted, { cwd, sessionIds: [] }, { identityMode: 'preserve' })
      expect(actual).not.toMatch(/"type":"(?:request\/|user\/message|assistant\/|turn\/|step\/)/u)
      expect(redactSessionSnapshotIds([actual])).toEqual([actual])
      expect(normalizeSessionSnapshot(actual,
        { cwd: '{{cwd}}', sessionIds: [] }, { identityMode: 'preserve' })).toBe(actual)
      const expectedWorkspace = await captureExpectedWorkspaceSnapshot(join(scenario, 'workspace.expected'))
      expect(await captureWorkspaceSnapshot(cwd)).toEqual(expectedWorkspace)
      // An extra external effect must fail even when the command's text reports success.
      await writeFile(join(cwd, 'unexpected-effect.txt'), 'invalid command effect\n')
      const invalidWorkspace = await captureWorkspaceSnapshot(cwd)
      expect(() => expect(invalidWorkspace).toEqual(expectedWorkspace)).toThrow()
      await rm(join(cwd, 'unexpected-effect.txt'))
      if (mode === 'replay') expect(actual).toBe(expected)
      else {
        const output = sessionFixtureName(0, sessionHeaderVersion(raw, 'command Session'))
        await writeFile(join(scenario, output), actual)
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  },
)
