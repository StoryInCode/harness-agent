/** Owner-local independent test runner, separate from any Gates implementation's nested runner. */
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from '../../../../vitest.shared.ts'

const report = process.env.PROBE_REPORT
const cache = process.env.PROBE_CACHE
if (!report || !cache || !process.env.PROBE_RECEIPT || !process.env.PROBE_RUN_ID || !process.env.PROBE_RUNNER_IDENTITY) {
  throw new Error('Independent baseline requires owner-allocated report, receipt, nonce and runner identity')
}
export default defineConfig({
  cacheDir: cache,
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    include: ['packages/dev-loop/gates/tests/*.spec.ts'],
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    pool: 'forks', execArgv: vitestExecArgv, maxWorkers: 4,
    testTimeout: 30_000, hookTimeout: 30_000,
    reporters: ['json', fileURLToPath(new URL('./runner-probe/integrity-reporter.mjs', import.meta.url))],
    outputFile: { json: report },
  },
})
