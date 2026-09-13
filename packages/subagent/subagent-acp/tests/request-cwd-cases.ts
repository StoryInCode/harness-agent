/** Shared cwd inputs for external-provider start regressions; each case owns its directories. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { onTestFinished } from 'vitest'

/** Allocate distinct existing directories and construct one typed request.
 * @param mode - requested cwd selection.
 * @returns owned paths and request.
 */
export function cwdCase(mode: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'provider-request-cwd-')))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const parent = join(root, 'parent')
  const configured = join(root, 'configured')
  const explicit = join(root, 'explicit')
  for (const path of [parent, configured, explicit]) mkdirSync(path)
  const cwd = mode === 'relative' ? 'relative-child' : mode === 'empty' ? '' : explicit
  const request: SubagentStartRequest = {
    parent: { id: 'cwd-parent', session: { header: mode === 'missing-parent' ? {} : { cwd: parent } } } as unknown as Agent,
    prompt: [{ type: 'text', text: 'report workspace' }],
    signal: new AbortController().signal,
    ...(mode.startsWith('omitted') ? {} : { cwd }),
  }
  return { root, parent, configured, explicit, request }
}

/** Finite selection matrix, including unchanged fallback controls. */
export const cwdModes = ['explicit', 'omitted', 'relative', 'empty', 'missing-parent'] as const
