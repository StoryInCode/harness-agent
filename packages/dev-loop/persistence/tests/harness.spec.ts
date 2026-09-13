/** Source-plane Loader smoke over real Git, filesystem, subprocess, and JSON providers. */
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { expect, it } from 'vitest'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { createFixture } from './harness.ts'

it('rejects a required lifecycle entry whose persistence provider is absent', async () => {
  const fixture = await createFixture()
  await expect(fixture.mount({ persistence: false, entryPersistence: true }))
    .rejects.toThrow(/pending \(waiting for service: devLoopPersistence\)/)
})

it('completes a tracked piece in memory mode with JSON mounted and remounts the same corpus', async () => {
  const fixture = await createFixture()
  let hookDisposed = false
  const ctx = await fixture.mount({
    durability: 'memory',
    persistence: false,
    beforePersistence: (providers) => {
      expect(providers.get('devLoopLifecycle')).toBeUndefined()
      expect(providers.storage.backend.get('json')).toBeInstanceOf(JsonStorageBackend)
      providers.effect(() => () => { hookDisposed = true })
    },
  })
  expect(ctx.get('fs')).toBeInstanceOf(LocalFileSystem)
  expect(ctx.get('subprocess')).toBeInstanceOf(LocalSubprocessRuntime)
  expect(ctx.storage.backend.get('json')).toBeInstanceOf(JsonStorageBackend)
  expect(ctx.storage.domain).toBe(ctx.get('storageDomain'))

  const lifecycle = ctx.get('devLoopLifecycle')
  expect(lifecycle).toBeDefined()
  if (!lifecycle) throw new Error('Loader did not activate devLoopLifecycle')
  await lifecycle.transition('00.12', 'todo', 'pending', 'approved fixture')
  await lifecycle.transition('00.12', 'pending', 'done', 'completed fixture')

  await expect(readFile(fixture.sourcePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(fixture.destinationPath, 'utf8')).toContain('**Status:** done')
  const destination = relative(fixture.repository, fixture.destinationPath).replaceAll('\\', '/')
  expect((await fixture.git('ls-files', '--', destination)).trim()).toBe(destination)
  expect(await fixture.git('diff', '--cached', '--name-status', '--no-renames')).toContain(`A\t${destination}`)

  const remounted = await fixture.mount({ durability: 'memory', persistence: false })
  expect(remounted).not.toBe(ctx)
  expect(hookDisposed).toBe(true)
  expect(remounted.get('devLoopLifecycle')?.getStatus('00.12')).toBe('done')
  await fixture.dispose()
  await expect(readFile(fixture.destinationPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})
