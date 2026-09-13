/** Authenticated command-only control of the shipped Web CLI; no browser or model injection. */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

/** Running private Web process; close drains persistence before callers inspect files. */
export interface CommandWebProcess {
  /**
   * Send one authenticated public Remote request.
   * @param method Public service/method path.
   * @param args Named wire arguments.
   * @returns Decoded successful Remote value.
   */
  request(method: string, args: Record<string, unknown>): Promise<unknown>
  /** @returns Child diagnostics with ephemeral HTTP URLs removed. */
  diagnostics(): string
  /**
   * Send SIGTERM and await stream closure; forced termination is a failure.
   * @returns Quiescent completion, rejecting on unsuccessful or forced exit.
   */
  close(): Promise<void>
}

/**
 * Launch the shipped profile with kernel-allocated port and isolated state.
 * @param repoRoot Source checkout or built artifact root.
 * @param root Private temporary home shared only across explicit restarts.
 * @param patch Absolute scenario patch.
 * @returns Authenticated public controller and awaited teardown.
 */
export async function launchCommandWeb(repoRoot: string, root: string, patch: string): Promise<CommandWebProcess> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|SECRET|TOKEN|PASSWORD)/iu.test(key)))
  const launch = resolveExampleLaunch({
    srcBin: join(repoRoot, 'apps/cli/src/bin.ts'),
    tsconfigPath: join(repoRoot, 'tsconfig.json'),
    sourceImport: 'tsx/esm',
    configArgs: ['--profile', 'web', '--patch', patch, '--no-open', '--port', '0'],
    env: { DSH_HOME: join(root, '.dsh'), DSH_AGENTS_HOME: join(root, '.agents'), DSH_TELEMETRY_DISABLED: '1', SSH_CONNECTION: '', SSH_TTY: '' },
  })
  const child = spawn(launch.command, launch.args, { cwd: root, env: { ...env, ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  const failure = new Promise<never>((_resolve, reject) => child.on('error', reject))
  void failure.catch(() => undefined)
  let output = ''
  const ready = Promise.withResolvers<string>()
  const append = (chunk: Buffer): void => {
    output = (output + String(chunk)).slice(-100_000)
    const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
    if (match?.[1] !== undefined) ready.resolve(match[1])
  }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  let stopping: Promise<void> | undefined
  const close = (): Promise<void> => stopping ??= (async () => {
    let forced = false
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL') }, 15_000)
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const result = await closed
      if (forced) throw new Error('Web command process required forced termination; persistence is not trustworthy')
      if (result.code !== 0) throw new Error(`Web command process exited ${String(result.code)} (${String(result.signal)}):\n${output.replace(/http:\/\/[^\s]+/gu, '<redacted-url>')}`)
    } finally { clearTimeout(timer) }
  })()
  const timer = setTimeout(() => ready.reject(new Error('Web command process readiness timed out')), 90_000)
  try {
    const launchUrl = await Promise.race([ready.promise, failure, closed.then((): never => { throw new Error('Web command process exited before readiness') })])
    clearTimeout(timer)
    const exchange = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
    if (exchange.status !== 303 || cookie === undefined) throw new Error('Web launch authentication did not exchange a cookie')
    const origin = new URL(launchUrl).origin
    let rpcId = 0
    return {
      close,
      diagnostics: () => output.replace(/http:\/\/[^\s]+/gu, '<redacted-url>'),
      async request(method, args) {
        const id = `command-snapshot-${String(++rpcId)}`
        const response = await fetch(`${origin}/api/${method}`, {
          method: 'POST', headers: { cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload: { args } }),
          signal: AbortSignal.timeout(30_000),
        })
        if (response.status !== 200) throw new Error(`Web ${method} HTTP ${String(response.status)}`)
        const envelope = await response.json() as { type: string; rpcId: string; result: { ok: boolean; value?: unknown; error?: unknown } }
        if (envelope.type !== 'server-response' || envelope.rpcId !== id || !envelope.result.ok) {
          throw new Error(`Web ${method} rejected: ${JSON.stringify(envelope.result)}`)
        }
        return envelope.result.value
      },
    }
  } catch (error) {
    await close()
    throw error
  } finally { clearTimeout(timer) }
}
