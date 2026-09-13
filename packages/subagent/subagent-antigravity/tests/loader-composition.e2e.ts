/** Built Profile Loader evidence for dormant native Antigravity delegation. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const fixtureDir = fileURLToPath(new URL('./fixtures/loader/', import.meta.url))
const driver = join(fixtureDir, 'driver.ts')
const configPath = join(fixtureDir, 'antigravity.patch.yml')
const packageDir = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
  dsh?: { bundle?: { patch?: string } }
}
const bundlePatch = manifest.dsh?.bundle?.patch
if (bundlePatch === undefined) throw new Error('Antigravity package must declare a Bundle patch')
const tsconfigPath = fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url))

// Profile startup owns its deadline; the outer test leaves time for process cleanup.
const processTimeoutMs = 60_000

describe('Antigravity provider public Loader composition', () => {
  it('loads the built Bundle and production one-shot tool without invoking a model or native CLI', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'subagent-antigravity Loader composition',
      tempDirPrefix: 'dsh-subagent-antigravity-loader-',
      binScript: driver,
      libBinScript: driver,
      mode: 'lib',
      configPath,
      binArgs: [configPath, join(packageDir, bundlePatch)],
      tsconfigPath,
      processTimeoutMs,
      env: { PATH: '' },
    })

    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toEqual({
      provider: {
        name: 'antigravity',
        capabilities: {
          agentOptions: false,
          outputSchema: false,
          depthLimit: false,
          toolFilter: false,
          persona: false,
        },
        inheritsParentContext: false,
      },
      tool: {
        name: 'subagent_antigravity',
        parameterNames: ['description', 'prompt', 'run_in_background'],
        required: ['description', 'prompt'],
      },
      jobTools: ['job_kill', 'job_list', 'job_output'],
      starts: 0,
      subprocessCalls: 0,
    })
  }, processTimeoutMs + 15_000)
})
