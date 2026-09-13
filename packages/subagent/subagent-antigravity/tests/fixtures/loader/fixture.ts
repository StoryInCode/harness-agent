/** Fail closed if the composition-only test requests paid inference. */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class CompositionOnlyAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('Antigravity Loader composition must not invoke a model')
  }
}

export const name = 'antigravity-loader-composition-fixture'
export const inject = ['llm']

/**
 * Complete the host LLM registry without allowing model requests.
 * @param ctx - Loader context supplying the LLM registry.
 */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['mock'], new CompositionOnlyAdapter())
}
