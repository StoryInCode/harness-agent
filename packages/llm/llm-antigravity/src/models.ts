/**
 * Model directory resolution and discovery for Google Antigravity.
 * @module @deepseek-ai/dsh-llm-antigravity/models
 */

import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { deadline } from '@deepseek-ai/dsh-timeout'

/** Default fallback catalog matching native `agy models` output. */
export const DEFAULT_ANTIGRAVITY_MODELS: readonly { readonly id: string; readonly name: string }[] = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
  { id: 'gemini-3.7-flash-high', name: 'Gemini 3.7 Flash (High)' },
  { id: 'gemini-3.7-flash-medium', name: 'Gemini 3.7 Flash (Medium)' },
  { id: 'gemini-3.7-flash-low', name: 'Gemini 3.7 Flash (Low)' },
  { id: 'gemini-3.6-flash-high', name: 'Gemini 3.6 Flash (High)' },
  { id: 'gemini-3.6-flash-medium', name: 'Gemini 3.6 Flash (Medium)' },
  { id: 'gemini-3.6-flash-low', name: 'Gemini 3.6 Flash (Low)' },
  { id: 'gemini-3.1-pro-high', name: 'Gemini 3.1 Pro (High)' },
  { id: 'gemini-3.1-pro-low', name: 'Gemini 3.1 Pro (Low)' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', name: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)' },
]

/**
 * Parse tab-separated output from `agy models`.
 * @param text - Complete stdout from `agy models`.
 * @param provider - Owning provider id.
 * @returns Parsed model info array.
 */
export function parseModelsOutput(text: string, provider: string): LlmModelInfo[] {
  const models: LlmModelInfo[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const fields = line.split('\t')
    const [id, name] = fields
    if (fields.length !== 2 || id === undefined || name === undefined) continue
    const cleanId = id.trim()
    const cleanName = name.trim()
    if (cleanId.length === 0 || cleanName.length === 0 || seen.has(cleanId)) continue
    seen.add(cleanId)
    models.push({
      provider,
      id: cleanId,
      name: cleanName,
    })
  }
  return models
}

/**
 * Resolve full metadata including context window and reasoning effort for an Antigravity model.
 * @param provider - Provider route id.
 * @param modelId - Requested model identifier.
 * @param modelName - Optional display name.
 * @returns Fully resolved model information.
 */
export function resolveModelMetadata(
  provider: string,
  modelId: string,
  modelName?: string,
): LlmResolvedModelInfo {
  const fallback = DEFAULT_ANTIGRAVITY_MODELS.find(m => m.id === modelId)
  const name = modelName ?? fallback?.name ?? modelId

  let contextWindow = 1_048_576
  if (modelId.startsWith('claude')) {
    contextWindow = 200_000
  } else if (modelId.startsWith('gpt')) {
    contextWindow = 128_000
  }

  let reasoning: LlmResolvedModelInfo['reasoning']
  if (modelId.endsWith('-high')) {
    reasoning = {
      efforts: [{ id: ReasoningEffortId('high'), name: 'High' }],
      defaultEffort: ReasoningEffortId('high'),
    }
  } else if (modelId.endsWith('-medium')) {
    reasoning = {
      efforts: [{ id: ReasoningEffortId('medium'), name: 'Medium' }],
      defaultEffort: ReasoningEffortId('medium'),
    }
  } else if (modelId.endsWith('-low')) {
    reasoning = {
      efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }],
      defaultEffort: ReasoningEffortId('low'),
    }
  } else if (modelId.includes('thinking') || modelId.startsWith('claude')) {
    reasoning = {
      efforts: [{ id: ReasoningEffortId('high'), name: 'Thinking' }],
      defaultEffort: ReasoningEffortId('high'),
    }
  }

  return {
    provider,
    id: modelId,
    name,
    context: { contextWindow },
    defaultMaxTokens: 65_536,
    inputModalities: ['text'],
    ...(reasoning === undefined ? {} : { reasoning }),
  }
}

/**
 * Interrogate the native CLI for available models.
 * @param spawn - Subprocess spawn capability.
 * @param command - Installed executable name or path.
 * @param env - Child environment overlay.
 * @param signal - Abort signal for operation.
 * @param provider - Provider route id.
 * @returns Discovered models or fallback list if process execution is unavailable.
 */
export async function discoverAntigravityModels(
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  command: string,
  env: Record<string, string>,
  signal: AbortSignal,
  provider: string,
): Promise<readonly LlmModelInfo[]> {
  if (signal.aborted) {
    return DEFAULT_ANTIGRAVITY_MODELS.map(m => ({ provider, id: m.id, name: m.name }))
  }

  const limit = deadline(signal, 10_000, 'ANTIGRAVITY_MODELS_TIMEOUT')
  let child: SubprocessHandle
  try {
    child = spawn({
      argv: [command, 'models'],
      cwd: process.cwd(),
      env,
      graceMs: 1_000,
      signal: limit.signal,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 262_144 },
        stderr: { maxBytes: 65_536 },
      },
    })
  } catch {
    limit[Symbol.dispose]()
    return DEFAULT_ANTIGRAVITY_MODELS.map(m => ({ provider, id: m.id, name: m.name }))
  }

  try {
    const outcome = await child.done
    if (outcome.exitCode === 0 && outcome.signal === null) {
      const output = child.collected.stdout?.readFrom(0)
      if (output !== undefined && !output.lossy) {
        const parsed = parseModelsOutput(output.text, provider)
        if (parsed.length > 0) return parsed
      }
    }
  } catch {
    // Soft fallback on discovery error
  } finally {
    try {
      child.terminate()
      await child.waitForExit()
    } catch {
      // Safe teardown
    } finally {
      limit[Symbol.dispose]()
    }
  }

  return DEFAULT_ANTIGRAVITY_MODELS.map(m => ({ provider, id: m.id, name: m.name }))
}
