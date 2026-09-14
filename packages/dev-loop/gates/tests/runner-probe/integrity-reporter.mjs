import { writeFile } from 'node:fs/promises'

/** Test-only observation of Vitest's run-end arguments; never assigns pass status. */
export default class IntegrityReporter {
  onTestRunStart() {
    if (process.env.PROBE_CONTROL === 'cancel') console.log(`PROBE_READY:${process.env.PROBE_RUN_ID}`)
  }

  async onTestRunEnd(_modules, unhandledErrors, reason) {
    if (process.env.PROBE_CONTROL === 'throw') throw new Error('probe reporter exploded before receipt')
    if (process.env.PROBE_CONTROL === 'missing') return
    const receipt = {
      protocolVersion: 1,
      runnerVersion: '4.1.8',
      runId: process.env.PROBE_RUN_ID,
      runnerIdentity: process.env.PROBE_RUNNER_IDENTITY,
      completedHook: 'onTestRunEnd',
      unhandledErrorCount: unhandledErrors.length,
      reason,
    }
    await writeFile(process.env.PROBE_RECEIPT, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 })
  }
}
