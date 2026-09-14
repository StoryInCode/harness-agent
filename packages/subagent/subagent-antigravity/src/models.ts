/** Bounded discovery of the installed CLI's tab-separated native model directory. */

import type { SubagentModelInfo } from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { AntigravityRunSpec } from './run.ts'

/** Discovery uses the Host workspace and shares the provider's process bounds. */
export type AntigravityModelsSpec = Omit<AntigravityRunSpec, 'model'>

function failure(category: string): Error {
  return new Error(`Antigravity model discovery failed (category: ${category})`)
}

/**
 * Parse the native CLI's exact tab-separated id and display-name records.
 * @param text - complete bounded stdout after a successful process exit.
 * @returns unique native model records; malformed or empty output rejects safely.
 */
export function parseAntigravityModels(text: string): SubagentModelInfo[] {
  const models: SubagentModelInfo[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const fields = line.split('\t')
    const [id, name] = fields
    if (fields.length !== 2 || id === undefined || name === undefined
      || id.length === 0 || /\s|[\x00-\x1f\x7f]/.test(id)
      || name.trim().length === 0 || /[\x00-\x1f\x7f]/.test(name) || seen.has(id)) {
      throw failure('malformed-output')
    }
    seen.add(id)
    models.push({ id, name })
  }
  if (models.length === 0) throw failure('empty-output')
  return models
}

/**
 * Read native models without starting a conversation or requesting credentials.
 * @param signal - caller cancellation, retained through managed process cleanup.
 * @param spec - executable, explicit environment, process bounds, and spawn capability.
 * @returns native model metadata only after the process tree exits; failures omit raw output.
 */
export async function listAntigravityModels(
  signal: AbortSignal,
  spec: AntigravityModelsSpec,
): Promise<readonly SubagentModelInfo[]> {
  if (signal.aborted) throw failure('aborted')
  const limit = deadline(signal, spec.timeoutMs, 'ANTIGRAVITY_MODELS_TIMEOUT')
  let child: SubprocessHandle
  try {
    child = spec.spawn({
      argv: [spec.command, 'models'],
      cwd: spec.cwd,
      env: spec.env,
      graceMs: spec.disposeGraceMs,
      signal: limit.signal,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: spec.maxOutputBytes },
        stderr: { maxBytes: spec.maxOutputBytes },
      },
    })
  } catch {
    // Subprocess startup errors may contain executable arguments or environment values.
    limit[Symbol.dispose]()
    throw failure('startup')
  }
  try {
    let outcome
    try {
      outcome = await child.done
    } catch {
      // Process observations may contain native diagnostics or credentials.
      throw failure('process')
    }
    if (signal.aborted) throw failure('aborted')
    if (limit.signal.aborted) throw failure('timeout')
    if (outcome.exitCode !== 0 || outcome.signal !== null) throw failure('process-exit')
    const output = child.collected.stdout?.readFrom(0)
    if (output === undefined || output.lossy) throw failure('output-limit')
    return parseAntigravityModels(output.text)
  } finally {
    try {
      child.terminate()
      await child.waitForExit()
    } catch {
      // Teardown observations can contain native diagnostics; no raw text crosses the API.
      throw failure('teardown')
    } finally {
      limit[Symbol.dispose]()
    }
  }
}
