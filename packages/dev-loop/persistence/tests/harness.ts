/** Real source-plane Loader composition with an isolated Git corpus and JSON storage. */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { assertEntriesActivated } from '@deepseek-ai/dsh-app-boot'
import * as fsLocal from '@deepseek-ai/dsh-fs-local'
import * as subprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as directory from '@deepseek-ai/dsh-dev-loop-directory'
import * as lifecycle from '@deepseek-ai/dsh-dev-loop-lifecycle'
import * as storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import * as persistence from '../src/index.ts'

const run = promisify(execFile)
const sections = [
  'Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References',
  'How to see it', 'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance',
]

/** Options written into the test-only composition before each mount. */
export interface MountOptions {
  durability?: 'memory' | 'required'
  persistence?: boolean
  /** Override the lifecycle entry's persistence dependency to exercise missing referents. */
  entryPersistence?: boolean
  maxRecordBytes?: number
  maxHistoryRecords?: number
  /** Install instance-local IO observation after providers mount and before persistence opens its domain. */
  beforePersistence?: (ctx: Context) => void | Promise<void>
}

/**
 * Allocate a tracked todo piece and register teardown with the current Vitest case.
 * Each mount drains the preceding Context before reopening the same repository and storage.
 * @returns fixture paths, Git command helper, remount operation, and idempotent teardown.
 */
export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-dev-loop-persistence-'))
  let context: Context | undefined
  let disposal: Promise<void> | undefined
  const dispose = (): Promise<void> => disposal ??= (async () => {
    await context?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })()
  onTestFinished(dispose)

  const repository = join(root, 'repository')
  const storageRoot = join(root, 'storage')
  const sourcePath = join(repository, directory.PIECE_ROOT, '00-persistence-fixtures', '00.12-persistence-fixture.md')
  const destinationPath = join(dirname(sourcePath), directory.DONE_DIRECTORY, '00.12-persistence-fixture.md')
  const configPath = join(root, 'cordis.yml')
  const providersPath = join(root, 'providers.cordis.yml')

  /** Run Git to completion in the private repository, rejecting nonzero exits. */
  const git = async (...args: string[]): Promise<string> => {
    const result = await run('git', args, { cwd: repository })
    return result.stdout
  }

  try {
    await mkdir(dirname(sourcePath), { recursive: true })
    await mkdir(storageRoot)
    await writeFile(sourcePath, [
      '# 00.12 — Persistence Fixture',
      '',
      '**Set:** 00-persistence-fixtures · **Queue:** 1 · **Depends on:** none',
      '**Status:** todo',
      '**Harness primitive:** Service Provider · **Package:** `@deepseek-ai/dsh-dev-loop-persistence`',
      ...sections.flatMap(section => ['', `## ${section}`, '', `Fixture text for ${section}.`]),
      '',
    ].join('\n'))
    await git('init', '-q', '.')
    await git('config', 'user.email', 'dev-loop@example.invalid')
    await git('config', 'user.name', 'Dev Loop Fixture')
    await git('config', 'commit.gpgsign', 'false')
    await git('config', 'core.hooksPath', join(repository, '.git', 'absent-hooks'))
    await git('add', '-f', '--', sourcePath)
    await git('commit', '-q', '-m', 'seed persistence fixture')
  } catch (error) {
    await dispose()
    throw error
  }

  /**
   * Mount the real providers through Include; JSON is mounted even in memory mode.
   * @param options - lifecycle durability and persistence record limits.
   * @returns the fully settled Context; failed mounts are disposed before rejection.
   */
  const mount = async (options: MountOptions = {}): Promise<Context> => {
    if (disposal) throw new Error('persistence fixture is disposed')
    await context?.fiber.dispose()
    const ctx = new Context()
    context = ctx
    try {
      const providers = [
        { name: 'cordis:fs-local', config: { cwd: repository } },
        { name: 'cordis:subprocess-local' },
        { name: 'cordis:storage' },
        { name: 'cordis:storage-json', config: { root: storageRoot } },
        { name: 'cordis:storage-domain', config: { backend: 'json' } },
        { name: 'cordis:directory', config: { root: directory.PIECE_ROOT } },
      ]
      const rows = [
        ...(options.persistence === false ? [] : [{
          name: 'cordis:persistence',
          config: {
            repositoryRoot: repository,
            maxRecordBytes: options.maxRecordBytes ?? 1_048_576,
            maxHistoryRecords: options.maxHistoryRecords ?? 100,
          },
        }]),
        {
          name: 'cordis:lifecycle',
          ...((options.entryPersistence ?? options.persistence !== false) && options.durability !== 'memory'
            ? { inject: ['devLoopPersistence'] }
            : {}),
          config: { durability: options.durability ?? 'required' },
        },
      ]
      await writeFile(providersPath, `${JSON.stringify(providers, null, 2)}\n`)
      await writeFile(configPath, `${JSON.stringify(rows, null, 2)}\n`)
      ctx.baseUrl = `${pathToFileURL(root).href}/`
      await ctx.plugin(Loader)
      Object.assign(ctx.loader.builtins, {
        include: Include,
        'fs-local': fsLocal,
        'subprocess-local': subprocessLocal,
        storage,
        'storage-json': storageJson,
        'storage-domain': storageDomain,
        directory,
        lifecycle,
        persistence,
      })
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(providersPath).href } })
      await ctx.loader.await()
      await assertEntriesActivated(ctx, 'persistence-fixture')
      await options.beforePersistence?.(ctx)
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      await assertEntriesActivated(ctx, 'persistence-fixture')
      for (const service of ['fs', 'subprocess', 'storage', 'storageDomain', 'devLoopDirectory', 'devLoopLifecycle'] as const) {
        if (!ctx.get(service)) throw new Error(`Loader did not activate ${service}`)
      }
      if (options.persistence !== false && !ctx.get('devLoopPersistence')) {
        throw new Error('Loader did not activate devLoopPersistence')
      }
      return ctx
    } catch (error) {
      await ctx.fiber.dispose()
      throw error
    }
  }

  return { repository, sourcePath, destinationPath, storageRoot, git, mount, dispose }
}
