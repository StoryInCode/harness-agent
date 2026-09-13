import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SubagentRuntime, { type SubagentDescriptorData, type SubagentRun } from '@deepseek-ai/dsh-subagent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { expect, it, vi } from 'vitest'
import * as antigravity from '../src/index.ts'

// Native cached authentication and metered inference are explicitly opt-in.
it.skipIf(process.env.DSH_TEST_ANTIGRAVITY !== '1')('reads the parent workspace through installed Antigravity', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-agy-native-'))
  const ctx = new Context()
  let run: SubagentRun | undefined
  try {
    const nonce = `ag-${randomUUID()}`
    const path = join(cwd, 'nonce.txt')
    await writeFile(path, nonce, { flag: 'wx', mode: 0o600 })
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalSubprocessRuntime)
    const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
    let handle: SubprocessHandle | undefined
    let captured: SubprocessSpawnSpec | undefined
    vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
      captured = spec
      handle = spawn(spec)
      return handle
    })
    await ctx.plugin(antigravity, {
      ...process.env.DSH_TEST_ANTIGRAVITY_COMMAND === undefined
        ? {} : { command: process.env.DSH_TEST_ANTIGRAVITY_COMMAND },
      ...process.env.DSH_TEST_ANTIGRAVITY_MODEL === undefined
        ? {} : { model: process.env.DSH_TEST_ANTIGRAVITY_MODEL },
      timeoutMs: 120_000,
    })
    run = await ctx.subagents.getProvider('antigravity')!.start({
      parent: { session: { header: { cwd } } } as unknown as Agent,
      descriptor: {} as SubagentDescriptorData,
      prompt: [{ type: 'text', text: 'Read nonce.txt in the current workspace. Reply with its exact contents and nothing else. Do not modify any file or execute a shell command.' }],
      signal: new AbortController().signal,
    })
    const result = await run.result
    const terminalFacts: {
      resultIsObject: boolean
      statusIsSuccess: boolean
      responseType: string
      responseLength: number | null
      hasError: boolean
    }[] = []
    if (result.stopReason !== 'completed') {
      for (const line of handle?.collected.stdout?.readFrom(0).text.split('\n') ?? []) {
        let frame: unknown
        try { frame = JSON.parse(line) } catch { continue /* Only valid frames contribute safe metadata. */ }
        if (typeof frame !== 'object' || frame === null || !('event' in frame) || frame.event !== 'result') continue
        const terminal: unknown = 'result' in frame ? frame.result : undefined
        const value = typeof terminal === 'object' && terminal !== null ? terminal : undefined
        const response: unknown = value !== undefined && 'response' in value ? value.response : undefined
        terminalFacts.push({
          resultIsObject: value !== undefined,
          statusIsSuccess: value !== undefined && 'status' in value && value.status === 'SUCCESS',
          responseType: typeof response,
          responseLength: typeof response === 'string' ? response.length : null,
          hasError: value !== undefined && 'error' in value,
        })
      }
    }
    expect(result.stopReason, `${result.diagnostic ?? ''}; terminal facts: ${JSON.stringify(terminalFacts)}`).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: expect.stringContaining(nonce) as string }])
    expect(await readFile(path, 'utf8')).toBe(nonce)
    expect(captured?.cwd).toBe(cwd)
    expect(captured?.argv).toContain('120000ms')
    expect(captured?.argv).not.toContain('--dangerously-skip-permissions')
    await run.dispose()
    expect(await handle?.waitForExit()).toBe(true)
  } finally {
    try {
      await run?.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  }
}, 180_000)
