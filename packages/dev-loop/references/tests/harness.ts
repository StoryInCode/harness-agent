/** Real Loader host, filesystem, directory, Roles and JSON storage in a private repository. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import References from '../src/index.ts'
import type { Config } from '../src/types.ts'
import { fixture as rolesFixture } from '../../roles/tests/harness.ts'
import type { Fixture as RolesFixture } from '../../roles/tests/harness.ts'

export const pieceId = '00.06'
export const signal = () => new AbortController().signal
export const three = (source: string, attribution = 'Parent direct inspection', explanation = 'Decision informed by source') =>
  `| Source | Provenance | Decision informed |\n|---|---|---|\n| ${source} | ${attribution} | ${explanation} |`
export interface Fixture extends RolesFixture {
  references: References
  filename: string
  config: Config
  setReferences(body: string): Promise<string>
  mountReferences(ctx: Context, overrides?: Partial<Config>): Promise<References>
}
export async function fixture(body: string, run: (f: Fixture) => Promise<void>, overrides: Partial<Config> = {}) {
  await rolesFixture([textResponse('I inspected every cited file. This assertion is deliberately unsupported.')], async (f) => {
    const filename = join(f.repo, 'plans/pieces/00-dev-loop/00.06-role.md')
    const initial = await readFile(filename, 'utf8')
    const setReferences = async (text: string) => {
      const content = initial.replace('Private fixture material for References.', text)
      await writeFile(filename, content)
      return content
    }
    await setReferences(body)
    const config: Config = { repositoryRoot: f.repo, maxPieceBytes: 65_536, maxSourceBytes: 8192,
      maxObservationBytes: 65_536, maxReferences: 32, ...overrides }
    let mounts = 0
    const mountReferences = async (ctx: Context, extra: Partial<Config> = {}) => {
      ctx.loader.builtins['references'] = References
      const file = join(f.repo, `references-${++mounts}.yml`)
      await writeFile(file, JSON.stringify([{ name: 'cordis:references', config: { ...config, ...extra } }]))
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
      await ctx.loader.await()
      return ctx.get('devLoopReferences')!
    }
    const references = await mountReferences(f.ctx)
    await run({ ...f, references, filename, config, setReferences, mountReferences })
  })
}
