/** Loader-owned mount validation of the scoped Claims consumer's own output budget. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Include from '@deepseek-ai/cordis-plugin-include'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { fixture, pieceId, response } from './harness.ts'
import type { Fixture } from './harness.ts'

let mounts = 0

async function mountTool(f: Fixture, config?: unknown): Promise<void> {
  const path = join(f.repo, `claims-tool-${++mounts}.yml`)
  await writeFile(path, JSON.stringify([{ name: 'cordis:claims-tool', ...(config === undefined ? {} : { config }) }]))
  await f.handle.agent.ctx.plugin(Include, { path: pathToFileURL(path).href })
  await f.ctx.loader.await()
}

it('rejects a claims-tool mount without its own maxToolOutputBytes config', async () => {
  await fixture([response()], async (f) => {
    await expect(mountTool(f)).rejects.toThrow(/maxToolOutputBytes|required|config/i)
  })
})

it('rejects zero, negative, fractional, unsafe and non-number maxToolOutputBytes at mount', async () => {
  await fixture([response()], async (f) => {
    for (const maxToolOutputBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '32768', true]) {
      await expect(mountTool(f, { maxToolOutputBytes }), `config ${String(maxToolOutputBytes)}`)
        .rejects.toThrow(/maxToolOutputBytes/)
    }
  })
})

it('accepts a positive safe-integer budget and completes verification through the mounted tool', async () => {
  await fixture([response()], async (f) => {
    await mountTool(f, { maxToolOutputBytes: 262_144 })
    const result = await f.ctx.get('tools')!.execute({ name: 'dev_loop_verify_claims',
      callId: ToolCallId('amendment-config'), arguments: { pieceId }, agent: f.handle.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect(await f.claims.getReport(pieceId)).toMatchObject({ state: 'completed' })
  })
})
