/** Execute the independent Test Writer baseline through the actual installed DSH Subprocess provider. */
import { createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const owner = fileURLToPath(new URL('.', import.meta.url))
const gitPointerPath = join(repository, '.git')
const gitPointer = await readFile(gitPointerPath, 'utf8')
if (!gitPointer.startsWith('gitdir: ')) throw new Error('Independent baseline requires the retained detached worktree')
const gitHeadPath = resolve(repository, gitPointer.slice(8).trim(), 'HEAD')
const baselineCommit = (await readFile(gitHeadPath, 'utf8')).trim()
if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baselineCommit)) throw new Error('Independent baseline requires detached HEAD')
const main = '/home/sic/harness-agent'
const installed = JSON.parse(await readFile(`${main}/node_modules/vitest/package.json`, 'utf8'))
if (installed.version !== '4.1.8') throw new Error('Independent baseline requires installed Vitest 4.1.8')
const require = createRequire(`${main}/packages/subprocess/subprocess-local/package.json`)
const { Context } = await import(require.resolve('@deepseek-ai/cordis'))
const { default: LocalSubprocess } = await import(`${main}/packages/subprocess/subprocess-local/lib/index.js`)
const fingerprint = async path => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  const metadata = await stat(path)
  return { path, bytes: metadata.size, sha256: hash.digest('hex'), mode: metadata.mode.toString(8) }
}
const inputPaths = [process.execPath, join(owner, 'vitest.baseline.config.ts'), join(owner, 'runner-probe/integrity-reporter.mjs'),
  join(owner, 'run-baseline.mjs'), join(repository, 'vitest.shared.ts'), join(repository, 'tsconfig.base.json'),
  join(repository, 'pnpm-lock.yaml'), `${main}/node_modules/vitest/package.json`,
  `${main}/node_modules/vitest/vitest.mjs`, `${main}/node_modules/vitest/dist/chunks/index.UpGiHP7g.js`,
  `${main}/node_modules/vitest/dist/chunks/cli-api.BfdDOPPI.js`, `${main}/node_modules/vitest/dist/chunks/reporters.d.CtLUhkkA.d.ts`,
  require.resolve('@deepseek-ai/cordis'), `${main}/packages/subprocess/subprocess-local/lib/index.js`,
  `${main}/packages/subprocess/subprocess/lib/index.js`]
const inputs = await Promise.all(inputPaths.map(fingerprint))
const runnerIdentity = createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
const auditPaths = new Set([...inputPaths, gitPointerPath, gitHeadPath, join(owner, 'tsconfig.json'), join(owner, '../package.json'),
  join(owner, '../tsconfig.json'), join(owner, '../tsdown.config.ts'),
  join(repository, 'packages/core/agent-loop/tests/mock-adapter.ts'),
  join(repository, 'scripts/test-proxy-environment.ts'), join(repository, 'scripts/test-invariants.ts')])
for (const [directory, suffix] of [[owner, /\.(ts|mjs)$/], [join(owner, '../src'), /\.ts$/], [join(owner, '../lib'), /\.js$/]]) {
  for (const file of await readdir(directory, { withFileTypes: true })) {
    if (file.isFile() && suffix.test(file.name)) auditPaths.add(join(directory, file.name))
  }
}
for (const dependency of ['directory', 'lifecycle', 'queue', 'references', 'roles', 'worktree']) {
  const source = join(repository, 'packages/dev-loop', dependency, 'src')
  for (const file of await readdir(source, { withFileTypes: true })) {
    if (file.isFile() && file.name.endsWith('.ts')) auditPaths.add(join(source, file.name))
  }
}
const captureInputs = async () => Promise.all([...auditPaths].sort().map(fingerprint))
const beforeInputs = await captureInputs()
const directory = await mkdtemp(join(owner, 'baseline-'))
const runId = randomUUID()
const reportPath = join(directory, 'vitest.json')
const receiptPath = join(directory, 'integrity.json')
const argv = [process.execPath, `${main}/node_modules/vitest/vitest.mjs`, 'run', '--config', join(owner, 'vitest.baseline.config.ts'), '--configLoader', 'runner']
const context = new Context()
const fiber = await context.plugin(LocalSubprocess)
const controller = new AbortController()
let timedOut = false
const startedAt = Date.now()
const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Independent baseline deadline')) }, 300_000)
let handle
let facts
try {
  handle = await context.subprocess.spawn({ argv, cwd: repository,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 8_388_608 }, stderr: { maxBytes: 8_388_608 } },
    graceMs: 1000, signal: controller.signal,
    env: { PROBE_REPORT: reportPath, PROBE_RECEIPT: receiptPath, PROBE_RUN_ID: runId,
      PROBE_RUNNER_IDENTITY: runnerIdentity, PROBE_CONTROL: 'normal', PROBE_CACHE: join(directory, 'cache'), NO_COLOR: '1' } })
  const outcome = await handle.done
  const quiescent = await handle.waitForExit(AbortSignal.timeout(15_000))
  const stdout = handle.collected.stdout.readFrom(0)
  const stderr = handle.collected.stderr.readFrom(0)
  // The owned child tree is quiescent before checking sizes and reading these private output files.
  if ((await stat(reportPath)).size > 8_388_608 || (await stat(receiptPath)).size > 4096) {
    throw new Error('Independent baseline complete report overflow')
  }
  const reportRaw = await readFile(reportPath, 'utf8')
  const receiptRaw = await readFile(receiptPath, 'utf8')
  if (Buffer.byteLength(reportRaw, 'utf8') > 8_388_608 || Buffer.byteLength(receiptRaw, 'utf8') > 4096) {
    throw new Error('Independent baseline complete report overflow')
  }
  const report = JSON.parse(reportRaw)
  const receipt = JSON.parse(receiptRaw)
  const afterInputs = await captureInputs()
  const inputsUnchanged = JSON.stringify(beforeInputs) === JSON.stringify(afterInputs)
  const assertions = report.testResults.flatMap(file => file.assertionResults.map(result => ({ path: file.name, ...result })))
  const failures = assertions.filter(result => result.status === 'failed')
  const collected = report.testResults.every(file => file.message === '')
  const assertionFailures = failures.length > 0 && failures.every(result => result.failureMessages.length > 0
    && result.failureMessages.every(message => message.startsWith('AssertionError:')))
  const observedIntegrity = receipt.protocolVersion === 1 && receipt.runnerVersion === '4.1.8'
    && receipt.runId === runId && receipt.runnerIdentity === runnerIdentity && receipt.completedHook === 'onTestRunEnd'
    && receipt.unhandledErrorCount === 0 && receipt.reason === 'failed'
  facts = { baselineCommit, runId, runnerIdentity, inputs, beforeInputs, afterInputs, inputsUnchanged, argv, cwd: repository, node: process.version, vitestVersion: '4.1.8',
    environmentPolicy: 'scrub-credentials; explicit owner run metadata only', startedAt, finishedAt: Date.now(), outcome,
    timedOut, cancelled: controller.signal.aborted, quiescent, stdout, stderr, receipt, collected, assertionFailures,
    observedIntegrity, numTests: report.numTotalTests, numFailed: report.numFailedTests, numPassed: report.numPassedTests,
    numPending: report.numPendingTests, numTodo: report.numTodoTests, identities: assertions.map(({ path, fullName, status }) => ({ path, fullName, status })) }
  await writeFile(join(directory, 'facts.json'), `${JSON.stringify(facts, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await writeFile(join(directory, 'stdout.log'), stdout.text, { flag: 'wx', mode: 0o600 })
  await writeFile(join(directory, 'stderr.log'), stderr.text, { flag: 'wx', mode: 0o600 })
  const validRed = outcome.exitCode === 1 && outcome.signal === null && !timedOut && !controller.signal.aborted
    && quiescent && inputsUnchanged && !stdout.lossy && !stderr.lossy && collected && assertionFailures && observedIntegrity
    && report.numTotalTests === assertions.length && report.numFailedTests === failures.length
    && report.numPendingTests === 0 && report.numTodoTests === 0
  console.log(JSON.stringify({ directory, validRed, tests: facts.numTests, failed: facts.numFailed, passed: facts.numPassed,
    observedIntegrity, collected, assertionFailures, inputsUnchanged, outcome, quiescent, timedOut }))
  if (!validRed) process.exitCode = 1
} finally {
  clearTimeout(timer)
  if (handle) {
    controller.abort(new Error('Independent baseline cleanup'))
    await handle.done
    await handle.waitForExit(AbortSignal.timeout(15_000))
  }
  await fiber.dispose()
}
