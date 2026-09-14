/**
 * Live streaming LLM adapter connecting DeepSeek Harness to Google Antigravity.
 * @module @deepseek-ai/dsh-llm-antigravity/adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmProviderInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { discoverAntigravityModels, resolveModelMetadata } from './models.ts'
import type { ResolvedConfig } from './types.ts'

/**
 * Format conversation history into a standalone prompt suitable for Antigravity.
 * @param options - Generation options with system prompt and message history.
 * @returns Clean combined prompt text.
 */
export function formatConversationPrompt(options: GenerateOptions): string {
  const parts: string[] = []
  if (options.system !== undefined && options.system.trim().length > 0) {
    parts.push(`System:\n${options.system.trim()}`)
  }

  for (const msg of options.messages) {
    const textBlocks: string[] = []
    for (const block of msg.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text)
      } else if (block.type === 'tool-call') {
        textBlocks.push(`[Tool Call: ${block.name}(${block.arguments})]`)
      } else if (block.type === 'tool-result') {
        const resText = block.content
          .filter(b => b.type === 'text')
          .map(b => (b as { text: string }).text)
          .join('\n')
        textBlocks.push(`[Tool Result: ${resText}]`)
      }
    }
    const combined = textBlocks.join('\n').trim()
    if (combined.length === 0) continue

    if (msg.role === 'user') {
      parts.push(`User:\n${combined}`)
    } else if (msg.role === 'assistant') {
      parts.push(`Assistant:\n${combined}`)
    } else if (msg.role === 'system') {
      parts.push(`System:\n${combined}`)
    }
  }

  return parts.join('\n\n').trim()
}

/** Antigravity LLM provider adapter for DeepSeek Harness. */
export class AntigravityLlmAdapter extends LlmAdapter {
  constructor(
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return {
      id: provider,
      name: 'Google Antigravity',
    }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const controller = new AbortController()
    return discoverAntigravityModels(
      spec => this.ctx.subprocess.spawn(spec),
      this.config.command,
      this.config.env,
      controller.signal,
      provider,
    )
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return resolveModelMetadata(provider, model)
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) {
      yield {
        type: 'finish',
        reason: {
          kind: 'aborted',
          failure: { message: 'aborted before startup', code: 'ABORTED' },
        },
      }
      return
    }

    const prompt = formatConversationPrompt(options)
    if (prompt.length === 0) {
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'empty prompt', code: 'INVALID_PROMPT' },
        },
      }
      return
    }

    const controller = new AbortController()
    const onAbort = () => { controller.abort() }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const limit = deadline(controller.signal, this.config.timeoutMs, 'ANTIGRAVITY_STREAM_TIMEOUT')

    let child: SubprocessHandle
    try {
      child = this.ctx.subprocess.spawn({
        argv: [
          this.config.command,
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--model', options.model,
          '--dangerously-skip-permissions',
          '--print-timeout', `${this.config.timeoutMs}ms`,
          '-p', '',
        ],
        cwd: process.cwd(),
        env: this.config.env,
        graceMs: this.config.disposeGraceMs,
        signal: limit.signal,
        stdio: {
          stdin: { data: `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n` },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      })
    } catch (error) {
      options.signal?.removeEventListener('abort', onAbort)
      limit[Symbol.dispose]()
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: error instanceof Error ? error.message : 'failed to spawn agy',
            code: 'SPAWN_FAILED',
          },
        },
      }
      return
    }

    let textBlockStarted = false
    const textBlockIndex = 0
    let accumulatedText = ''
    let reasoningBlockStarted = false
    const reasoningBlockIndex = 1
    let accumulatedReasoning = ''
    let finished = false

    try {
      if (child.stdout !== undefined) {
        let buffer = ''
        for await (const rawChunk of child.stdout) {
          buffer += typeof rawChunk === 'string' ? rawChunk : rawChunk.toString('utf8')
          let lineEndIndex: number
          while ((lineEndIndex = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, lineEndIndex).trim()
            buffer = buffer.slice(lineEndIndex + 1)
            if (line.length === 0) continue

            let event: Record<string, unknown>
            try {
              event = JSON.parse(line) as Record<string, unknown>
            } catch {
              continue
            }

            if (event.event === 'step_update' && typeof event.step_update === 'object' && event.step_update !== null) {
              const step = event.step_update as Record<string, unknown>
              if (step.step_type === 'agent_response' && typeof step.text_delta === 'string') {
                if (!textBlockStarted) {
                  yield { type: 'block-start', index: textBlockIndex, blockType: 'text' }
                  textBlockStarted = true
                }
                accumulatedText += step.text_delta
                yield { type: 'text-delta', index: textBlockIndex, text: step.text_delta }
              }
              if (step.step_type === 'tool' && step.state === 'ACTIVE' && typeof step.tool_name === 'string') {
                if (!reasoningBlockStarted) {
                  yield { type: 'block-start', index: reasoningBlockIndex, blockType: 'reasoning' }
                  reasoningBlockStarted = true
                }
                const msg = `[Tool: ${step.tool_name}]\n`
                accumulatedReasoning += msg
                yield { type: 'reasoning-delta', index: reasoningBlockIndex, text: msg }
              }
            } else if (event.event === 'result' && typeof event.result === 'object' && event.result !== null) {
              const result = event.result as Record<string, unknown>
              if (result.status === 'SUCCESS') {
                if (!textBlockStarted && typeof result.response === 'string' && result.response.length > 0) {
                  yield { type: 'block-start', index: textBlockIndex, blockType: 'text' }
                  textBlockStarted = true
                  accumulatedText = result.response
                  yield { type: 'text-delta', index: textBlockIndex, text: result.response }
                }
                if (textBlockStarted) {
                  yield {
                    type: 'block-end',
                    index: textBlockIndex,
                    block: { type: 'text', text: accumulatedText },
                  }
                }
                if (reasoningBlockStarted) {
                  yield {
                    type: 'block-end',
                    index: reasoningBlockIndex,
                    block: { type: 'reasoning', text: accumulatedReasoning },
                  }
                }
                const usage = (typeof result.usage === 'object' && result.usage !== null)
                  ? result.usage as Record<string, number>
                  : undefined
                yield {
                  type: 'usage',
                  usage: {
                    inputTokens: usage?.input_tokens ?? 0,
                    outputTokens: usage?.output_tokens ?? 0,
                    reasoningTokens: usage?.thinking_tokens ?? 0,
                    totalTokens: usage?.total_tokens ?? 0,
                  },
                }
                yield { type: 'finish', reason: { kind: 'stop' } }
                finished = true
                return
              } else {
                yield {
                  type: 'finish',
                  reason: {
                    kind: 'error',
                    failure: {
                      message: typeof result.error === 'string' ? result.error : 'Antigravity run failed',
                      code: 'PRODUCT_ERROR',
                    },
                  },
                }
                finished = true
                return
              }
            }
          }
        }
      }

      await child.done
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      try {
        child.terminate()
        await child.waitForExit()
      } catch {
        // Idempotent teardown
      } finally {
        limit[Symbol.dispose]()
      }

      if (!finished) {
        if (timeoutOf(limit.signal) !== undefined) {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: { message: 'antigravity execution timed out', code: 'TIMEOUT' },
            },
          }
        } else if (options.signal?.aborted) {
          yield {
            type: 'finish',
            reason: {
              kind: 'aborted',
              failure: { message: 'aborted by caller', code: 'ABORTED' },
            },
          }
        } else if (textBlockStarted) {
          yield {
            type: 'block-end',
            index: textBlockIndex,
            block: { type: 'text', text: accumulatedText },
          }
          yield { type: 'finish', reason: { kind: 'stop' } }
        } else {
          yield {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: { message: 'process exited without a result', code: 'NO_RESULT' },
            },
          }
        }
      }
    }
  }
}
