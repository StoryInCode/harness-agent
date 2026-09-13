/**
 * One stdin NDJSON task per managed CLI process, with bounded collection and strict exit acceptance.
 * @module @deepseek-ai/dsh-subagent-antigravity/run
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  settleRunResult,
  subprocessRunHandle,
  type SubagentRun,
  type SubagentStartRequest,
} from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/** Fully resolved execution inputs; the subprocess provider owns environment scrubbing and process trees. */
export interface AntigravityRunSpec {
  /** Installed executable name or absolute path. */
  readonly command: string
  /** Validated absolute parent workspace. */
  readonly cwd: string
  /** Optional native model override. */
  readonly model?: string
  /** Explicit environment overlay, not a copy of ambient credentials. */
  readonly env: Record<string, string>
  /** Whole-run deadline in milliseconds. */
  readonly timeoutMs: number
  /** In-memory UTF-8 cap for each collected stream. */
  readonly maxOutputBytes: number
  /** Managed process termination grace in milliseconds. */
  readonly disposeGraceMs: number
  /** Shared subprocess spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(category: string, outcome?: SubprocessOutcome): Error {
  const facts = [`category: ${category}`]
  if (outcome !== undefined) {
    facts.push(`exit code: ${outcome.exitCode}`, `signal: ${outcome.signal}`)
  }
  return new Error(`Antigravity subagent failure (${facts.join('; ')})`)
}

/**
 * Read exactly one successful final result from documented CLI NDJSON output.
 * @param text - complete bounded stdout after process exit.
 * @returns final nonblank text, excluding native metadata and intermediate events.
 * @throws a fixed diagnostic for malformed, missing, duplicate, or unsuccessful results.
 */
export function finalResponse(text: string): string {
  let response: string | undefined
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      // JSON syntax failures contain raw process output and must not escape.
      throw failure('malformed-output')
    }
    if (!record(event) || typeof event.event !== 'string') throw failure('malformed-output')
    if (event.event !== 'result') continue
    if (response !== undefined) throw failure('duplicate-result')
    if (!record(event.result)) throw failure('invalid-result')
    if (event.result.status !== 'SUCCESS') throw failure('product-error')
    if ('error' in event.result) throw failure('product-error')
    if (typeof event.result.response !== 'string' || event.result.response.trim().length === 0) {
      throw failure('invalid-result')
    }
    response = event.result.response
  }
  if (response === undefined) throw failure('missing-result')
  return response
}

/**
 * Start a fresh native conversation with one stdin prompt and close input immediately.
 * @param request - standalone text task and parent cancellation signal.
 * @param spec - resolved executable, environment, workspace, and process bounds.
 * @returns a one-shot run whose result and disposal await managed-range quiescence.
 * @throws before publication for unsupported input, pre-cancellation, or synchronous spawn failure.
 */
// oxlint-disable-next-line typescript/require-await -- Startup validation must reject through the async provider API.
export async function startAntigravityRun(
  request: SubagentStartRequest,
  spec: AntigravityRunSpec,
): Promise<SubagentRun> {
  const texts: string[] = []
  for (const block of request.prompt) {
    if (block.type !== 'text') throw new Error('subagent-antigravity: task must contain only text blocks')
    texts.push(block.text)
  }
  const prompt = texts.join('')
  if (prompt.trim().length === 0) throw new Error('subagent-antigravity: task must not be empty')
  if (request.signal.aborted) throw new Error('subagent-antigravity: request aborted before startup')

  const controller = new AbortController()
  const requestCancel = (): void => { controller.abort() }
  const onAbort = requestCancel
  request.signal.addEventListener('abort', onAbort, { once: true })
  const limit = deadline(controller.signal, spec.timeoutMs, 'ANTIGRAVITY_TIMEOUT')
  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: [
        spec.command,
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        '--print-timeout', `${spec.timeoutMs}ms`,
        ...spec.model === undefined ? [] : ['--model', spec.model],
      ],
      cwd: spec.cwd,
      env: spec.env,
      graceMs: spec.disposeGraceMs,
      signal: limit.signal,
      stdio: {
        stdin: { data: `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n` },
        stdout: { maxBytes: spec.maxOutputBytes },
        stderr: { maxBytes: spec.maxOutputBytes },
      },
    })
  } catch {
    // Spawn failures can contain argv or environment values; expose only the stage.
    request.signal.removeEventListener('abort', onAbort)
    limit[Symbol.dispose]()
    throw failure('startup')
  }

  let cleanup: Promise<void> | undefined
  const teardown = (): Promise<void> => {
    cleanup ??= (async () => {
      try {
        child.terminate()
        await child.waitForExit()
      } catch {
        // Provider observation failures can carry raw child diagnostics.
        throw failure('teardown')
      } finally {
        limit[Symbol.dispose]()
      }
    })()
    return cleanup
  }
  let diagnostic: string | undefined
  const result = settleRunResult({
    attempt: async () => {
      let outcome: SubprocessOutcome
      try {
        try {
          outcome = await child.done
        } catch {
          // Published spawn/provider failures are result errors, not rejected runs.
          throw failure('process')
        } finally {
          await teardown()
        }
        if (timeoutOf(limit.signal) !== undefined) throw failure('timeout', outcome)
        if (outcome.exitCode !== 0 || outcome.signal !== null) throw failure('process-exit', outcome)
        const stdout = (child.collected.stdout as NonNullable<typeof child.collected.stdout>).readFrom(0)
        if (stdout.lossy) throw failure('output-limit', outcome)
        return {
          output: [{ type: 'text', text: finalResponse(stdout.text) }],
          stopReason: 'completed',
        }
      } catch (error: unknown) {
        // Every rejection above is provider-authored; subprocess and JSON errors are normalized locally.
        diagnostic = (error as Error).message
        throw error
      }
    },
    collectOutput: () => [],
    collectDiagnostic: () => diagnostic,
    cancelled: () => controller.signal.aborted,
    signal: request.signal,
    onAbort,
  })
  return subprocessRunHandle({
    id: brandString<SessionId>(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown,
  })
}
