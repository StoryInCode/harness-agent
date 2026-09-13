/** Inspect the public Antigravity Bundle through the shipped Profile Loader. */

import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-tools'
import { bootProductionProfile } from '../../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'
import type DormantSubprocess from './subprocess.ts'

const configPath = process.argv[2]
const bundlePatchPath = process.argv[3]
if (configPath === undefined || bundlePatchPath === undefined) {
  throw new Error('Antigravity Loader driver requires config and Bundle patch paths')
}

let starts = 0
const ctx = await bootProductionProfile({
  binName: 'subagent-antigravity-loader-composition',
  profile: 'headless',
  overlayPaths: [
    resolveConfigPath(bundlePatchPath, undefined),
    resolveConfigPath(configPath, undefined),
  ],
  prepare: (hostCtx) => {
    hostCtx.on('subagent/start', () => { starts += 1 })
  },
})

try {
  const provider = ctx.subagents.getProvider('antigravity')
  if (provider === undefined) throw new Error('Antigravity provider was not registered')
  const tool = ctx.tools.schemas().find(schema => schema.name === 'subagent_antigravity')
  if (tool === undefined) throw new Error('Antigravity tool was not registered')
  const properties = tool.parameters.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
    throw new Error('Antigravity tool has invalid parameter properties')
  }
  const subprocess = ctx.get('subprocess') as DormantSubprocess | undefined
  if (subprocess === undefined || typeof subprocess.calls !== 'number') {
    throw new Error('Subprocess guard was not mounted')
  }
  process.stdout.write(`${JSON.stringify({
    provider: {
      name: provider.name,
      capabilities: provider.capabilities,
      inheritsParentContext: provider.inheritsParentContext,
    },
    tool: {
      name: tool.name,
      parameterNames: Object.keys(properties).sort(),
      required: tool.parameters.required,
    },
    jobTools: ctx.tools.schemas().map(schema => schema.name)
      .filter(name => name === 'job_kill' || name === 'job_list' || name === 'job_output').sort(),
    starts,
    subprocessCalls: subprocess.calls,
  })}\n`)
} finally {
  await ctx.fiber.dispose()
}
