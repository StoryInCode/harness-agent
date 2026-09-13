/** Real Loader fixture shared by storage provider teardown regressions. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as Json from '@deepseek-ai/dsh-storage-json'
import * as Domain from '@deepseek-ai/dsh-storage-domain'

/** Create a manually released lifecycle barrier. @returns barrier and release function. */
export function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

/**
 * Load actual storage plugins and an explicitly dependent test consumer.
 * @param consumer - Consumer using public storage APIs.
 * @param domain - Whether to mount the domain provider.
 * @returns isolated Loader context, JSON root, and awaited cleanup.
 */
export async function loadDrainComposition(consumer: unknown, domain: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-provider-drain-'))
  const ctx = new Context()
  const media = join(root, 'media')
  const cleanup = async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
  try {
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: hub',
      "  name: '@deepseek-ai/dsh-storage'",
      '- id: json',
      "  name: '@deepseek-ai/dsh-storage-json'",
      `  config: ${JSON.stringify({ root: media })}`,
      ...(domain ? [
        '- id: domain',
        "  name: '@deepseek-ai/dsh-storage-domain'",
        '  config: { backend: json }',
      ] : []),
      '- id: consumer',
      '  name: drain-consumer',
      '',
    ].join('\n'))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', Json],
      ['@deepseek-ai/dsh-storage-domain', Domain],
      ['drain-consumer', consumer],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    return { ctx, media, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
