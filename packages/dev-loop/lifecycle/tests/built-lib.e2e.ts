/** Keyless published-artifact proof through plain Node, Loader, and real local providers. */
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const requireFromPackage = createRequire(new URL('../package.json', import.meta.url))
const packages = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/dsh-fs-local',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-dev-loop-directory',
  '@deepseek-ai/dsh-dev-loop-lifecycle',
]
// A missing dependency is a test setup failure, not a reason to hide this smoke.
const missingLibraries = packages.filter(name =>
  !existsSync(join(dirname(requireFromPackage.resolve(`${name}/package.json`)), 'lib/index.js')))

const sourcePath = 'plans/pieces/00-built-smoke/00.01-built-smoke.md'
const destinationPath = 'plans/pieces/00-built-smoke/done/00.01-built-smoke.md'
const piece = [
  '# 00.01 — Built lifecycle smoke',
  '',
  '**Set:** 00-built-smoke · **Queue:** 1 · **Depends on:** none',
  '**Status:** todo',
  '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-lifecycle`',
  ...['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References',
    'How to see it', 'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
    .flatMap(section => ['', `## ${section}`, '', 'The built composition stages this piece without committing it.']),
  '',
].join('\n')

const suite = missingLibraries.length === 0
  ? 'built lifecycle Loader composition (plain Node)'
  : `built lifecycle Loader composition — build missing libraries: ${missingLibraries.join(', ')}`

describe.skipIf(missingLibraries.length > 0)(suite, () => {
  it('approves and completes a todo file with a staged rename, unchanged HEAD, and provider teardown', { timeout: 60_000, retry: 0 }, async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-lifecycle-built-')))
    try {
      const script = `
        import assert from 'node:assert/strict'
        import { execFile } from 'node:child_process'
        import { existsSync } from 'node:fs'
        import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
        import { dirname, join } from 'node:path'
        import { fileURLToPath, pathToFileURL } from 'node:url'
        import { promisify } from 'node:util'
        import { Context } from '@deepseek-ai/cordis'
        import Loader from '@deepseek-ai/cordis-plugin-loader'
        import Include from '@deepseek-ai/cordis-plugin-include'
        import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
        import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
        import DevLoopDirectory from '@deepseek-ai/dsh-dev-loop-directory'
        import DevLoopLifecycle from '@deepseek-ai/dsh-dev-loop-lifecycle'

        const root = ${JSON.stringify(root)}
        const repository = join(root, 'repository')
        const sourcePath = ${JSON.stringify(sourcePath)}
        const destinationPath = ${JSON.stringify(destinationPath)}
        const original = ${JSON.stringify(piece)}
        const expected = original.replace('**Status:** todo', '**Status:** done')
        const providerNames = [
          '@deepseek-ai/dsh-fs-local', '@deepseek-ai/dsh-subprocess-local',
          '@deepseek-ai/dsh-dev-loop-directory', '@deepseek-ai/dsh-dev-loop-lifecycle',
        ]
        for (const name of ${JSON.stringify(packages)}) {
          assert.ok(new URL(import.meta.resolve(name)).pathname.endsWith('/lib/index.js'), name)
        }
        await mkdir(dirname(join(repository, sourcePath)), { recursive: true })
        await writeFile(join(repository, sourcePath), original)
        await mkdir(join(root, 'no-hooks'))
        const git = async (...args) => (await promisify(execFile)('git', args, { cwd: repository })).stdout
        await git('init', '-q')
        await git('config', 'user.name', 'Built lifecycle fixture')
        await git('config', 'user.email', 'lifecycle-fixture@example.invalid')
        await git('config', 'commit.gpgSign', 'false')
        await git('config', 'core.autocrlf', 'false')
        await git('config', 'core.hooksPath', join(root, 'no-hooks'))

        // Include resolves bare rows relative to its own configuration directory.
        // Its private package links point only at the actual published package roots.
        await mkdir(join(root, 'node_modules', '@deepseek-ai'), { recursive: true })
        for (const name of providerNames) {
          const packageRoot = dirname(fileURLToPath(import.meta.resolve(name + '/package.json')))
          await symlink(packageRoot, join(root, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir')
        }
        const configPath = join(root, 'cordis.yml')
        await writeFile(configPath, [
          '- name: "@deepseek-ai/dsh-fs-local"',
          '  config:',
          '    cwd: ' + JSON.stringify(repository),
          '- name: "@deepseek-ai/dsh-subprocess-local"',
          '- name: "@deepseek-ai/dsh-dev-loop-directory"',
          '  config:',
          '    root: plans/pieces',
          '- name: "@deepseek-ai/dsh-dev-loop-lifecycle"',
          '',
        ].join('\\n'))
        await git('add', '--', sourcePath)
        await git('commit', '-qm', 'Initial fixture')
        const initialHead = (await git('rev-parse', 'HEAD')).trim()
        assert.equal(await git('status', '--porcelain=v1'), '')

        const ctx = new Context()
        try {
          await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href })
          assert.ok(ctx.loader.internal, 'Node internal loader must resolve rows from the Include directory')
          ctx.loader.builtins.include = Include
          await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
          await ctx.loader.await()
          const fs = ctx.get('fs')
          const subprocess = ctx.get('subprocess')
          const directory = ctx.get('devLoopDirectory')
          const lifecycle = ctx.get('devLoopLifecycle')
          assert.ok(fs instanceof LocalFileSystem)
          assert.ok(subprocess instanceof LocalSubprocessRuntime)
          assert.ok(directory instanceof DevLoopDirectory)
          assert.ok(lifecycle instanceof DevLoopLifecycle)
          const completed = []
          ctx.on('piece/completed', event => {
            completed.push({ pieceId: event.pieceId, newPath: event.newPath })
          })
          assert.equal(lifecycle.getStatus('00.01'), 'todo')
          await lifecycle.transition('00.01', 'todo', 'pending', 'fixture approval')
          assert.equal(lifecycle.getStatus('00.01'), 'pending')
          await lifecycle.transition('00.01', 'pending', 'done', 'fixture verification')
          assert.equal(lifecycle.getStatus('00.01'), 'done')
          assert.deepEqual(completed, [{ pieceId: '00.01', newPath: destinationPath }])
          assert.equal(existsSync(join(repository, sourcePath)), false)
          assert.deepEqual(await readFile(join(repository, destinationPath)), Buffer.from(expected))
          const relocated = await directory.getPiece('00.01')
          assert.equal(relocated.status, 'done')
          assert.equal(relocated.path, destinationPath)
          const rename = (await git('diff', '--cached', '--name-status', '--find-renames')).trim().split('\\t')
          assert.match(rename[0], /^R[0-9]{3}$/)
          assert.deepEqual(rename.slice(1), [sourcePath, destinationPath])
          assert.equal(await git('diff', '--exit-code'), '')
          assert.equal((await git('rev-parse', 'HEAD')).trim(), initialHead)
          assert.equal((await git('rev-list', '--count', 'HEAD')).trim(), '1')
        } finally {
          await ctx.fiber.dispose()
        }
        assert.equal(ctx.get('devLoopLifecycle'), undefined)
        assert.equal(ctx.get('devLoopDirectory'), undefined)
        assert.equal(ctx.get('subprocess'), undefined)
        assert.equal(ctx.get('fs'), undefined)
        console.log('BUILT_LIFECYCLE_OK')
      `
      const { exitCode, stdout, stderr } = await execa(process.execPath, [
        '--expose-internals', '--input-type=module', '-e', script,
      ], {
        cwd: packageDirectory,
        env: { ...scrubbedParentEnv(), NODE_OPTIONS: undefined },
        extendEnv: false,
        stdin: 'ignore',
        timeout: 55_000,
        killSignal: 'SIGKILL',
        reject: false,
      })
      expect(exitCode, stderr).toBe(0)
      expect(stdout.trim().split('\n').at(-1)).toBe('BUILT_LIFECYCLE_OK')
    } finally {
      // The child awaits Cordis/provider disposal before closing; removal follows child settlement.
      await rm(root, { recursive: true, force: true })
    }
  })
})
