/** Author the initial recording through the real loop, tool pipeline, and persistence. */

import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class NativeDelegationModel extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result === undefined) {
      const id = ToolCallId('native-antigravity-call')
      const name = 'subagent_antigravity'
      const args = JSON.stringify({
        description: 'Verify native delegation',
        prompt: 'Return the native delegation marker.',
      })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    assert.deepEqual(result.content, [{ type: 'text', text: 'Native Antigravity delegation completed.' }])
    const text = 'Native Antigravity delegation completed.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'antigravity-authored-model'
export const inject = ['llm']

/**
 * Register the deterministic authoring adapter, never an inference provider.
 * @param ctx - Loader context supplying the LLM registry.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['deepseek-official'], new NativeDelegationModel())
}
