/** Model-facing discovery of authorized LLM and native subagent routes. */

import type { Context } from '@deepseek-ai/cordis'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ModelSelectionPolicy } from './model-selection.ts'

interface ListSubagentModelsRequest {
  readonly provider?: string
  readonly model?: string
}

/** Resolve one registered provider with a model-correctable diagnostic. */
function registeredProvider(
  llm: LlmRuntime,
  policy: ModelSelectionPolicy,
  providerId: string,
): LlmProviderInfo {
  const providers = llm.listProviders()
  const provider = providers.find(candidate => candidate.id === providerId)
  if (provider !== undefined) return provider
  const available = providers
    .filter(candidate => policy.routes.some(route => route.provider === candidate.id))
    .map(candidate => candidate.id)
    .join(', ') || '(none)'
  throw new Error(`LLM provider "${providerId}" is not registered; available providers: ${available}`)
}

/** Render one advertised or resolved model. */
function modelLine(provider: string, model: { id: string; name: string; description?: string }): string {
  return `${provider}/${model.id} — ${model.name}${model.description === undefined ? '' : `: ${model.description}`}`
}

/** Read the requested provider, advertised models, or exact-model efforts. */
async function listSubagentModels(
  ctx: Context,
  policy: ModelSelectionPolicy,
  request: ListSubagentModelsRequest,
  signal: AbortSignal,
): Promise<string> {
  const llm = ctx.get('llm')
  const subagents = ctx.get('subagents')
  if (request.model !== undefined && request.provider === undefined) {
    throw new Error('`model` requires `provider`')
  }
  if (request.provider === undefined) {
    const providers = (llm?.listProviders() ?? [])
      .filter(provider => !provider.id.startsWith('subagent:') && policy.routes.some(route => route.provider === provider.id))
      .map(provider => `${provider.id} — ${provider.name}`)
    const nativeProviders = [...new Set(policy.routes.map(route => route.provider))]
      .filter(id => id.startsWith('subagent:') && subagents?.getProvider(id.slice('subagent:'.length))?.listModels !== undefined)
      .map(id => `${id} — ${id.slice('subagent:'.length)} (native models)`)
    if (llm === undefined && nativeProviders.length === 0) {
      throw new Error('cannot discover child LLM routes because the `llm` service is unavailable')
    }
    return [...providers, ...nativeProviders].join('\n') || '(no LLM providers)'
  }
  if (request.provider.length === 0) throw new Error('`provider` must be non-empty')
  const allowedRoutes = policy.routes.filter(route => route.provider === request.provider)
  if (allowedRoutes.length === 0) {
    const kind = request.provider.startsWith('subagent:') ? 'native' : 'LLM'
    throw new Error(`${kind} provider "${request.provider}" is not allowed for this Session`)
  }
  if (request.provider.startsWith('subagent:')) {
    if (request.model !== undefined && request.model.length === 0) throw new Error('`model` must be non-empty')
    const provider = subagents?.getProvider(request.provider.slice('subagent:'.length))
    if (provider?.listModels === undefined) throw new Error(`native provider "${request.provider}" is unavailable`)
    if (request.model !== undefined && !allowedRoutes.some(route => route.model === request.model)) {
      throw new Error(`native child route "${request.provider}/${request.model}" is not allowed for this Session`)
    }
    const models = (await provider.listModels(signal))
      .filter(model => allowedRoutes.some(route => route.model === model.id)
        && (request.model === undefined || request.model === model.id))
    signal.throwIfAborted()
    const providerId = request.provider
    return models.map(model => modelLine(providerId, model)).join('\n')
      || `(no advertised models for ${request.provider})`
  }
  if (llm === undefined) throw new Error('cannot discover child LLM routes because the `llm` service is unavailable')
  const provider = registeredProvider(llm, policy, request.provider)
  if (request.model === undefined) {
    const models = (await llm.listModels(provider.id))
      .filter(model => allowedRoutes.some(route => route.model === model.id))
    return models.length === 0
      ? `(no advertised models for ${provider.id})`
      : models.map(model => modelLine(provider.id, model)).join('\n')
  }
  if (request.model.length === 0) throw new Error('`model` must be non-empty')
  if (!allowedRoutes.some(route => route.model === request.model)) {
    throw new Error(`child LLM route "${provider.id}/${request.model}" is not allowed for this Session`)
  }
  const model = await llm.resolveModelInfo(provider.id, request.model, signal)
  const efforts = model.reasoning?.efforts.map(effort => (
    `${effort.id}${model.reasoning?.defaultEffort === effort.id ? ' (default)' : ''} — ${effort.name}`
    + (effort.description === undefined ? '' : `: ${effort.description}`)
  )).join('\n') || '(no advertised reasoning efforts)'
  return `${modelLine(provider.id, model)}\nReasoning efforts:\n${efforts}`
}

/**
 * Register `list_subagent_models` for one owning delegation-tool instance.
 * @param ctx - Context whose tool registry owns the discovery definition.
 * @param policy - Route policy captured for this Session.
 * @param toolName - Distinct discovery name for this delegation-tool instance.
 */
export function registerListSubagentModels(ctx: Context, policy: ModelSelectionPolicy, toolName = 'list_subagent_models'): void {
  ctx.tools.register(defineTool({
    name: toolName,
    description:
      'Discover LLM routes for subagents without changing the current Agent. Call with no arguments to list '
      + 'registered providers, with `provider` to list its advertised models, or with `provider` and `model` '
      + 'to inspect that exact model and its reasoning efforts. Catalog membership is advisory: an adapter may '
      + 'accept an unlisted model id. Use the returned ids with a delegation tool\'s `provider`, `model`, and '
      + '`reasoning_effort` fields. Native routes use provider ids prefixed with `subagent:` and expose no reasoning efforts; use them only with the delegation tool bound to that subagent provider.',
    parameters: {
      provider: {
        type: 'string',
        description: 'LLM provider id or subagent:<provider> for native models. Omit to list providers.',
      },
      model: {
        type: 'string',
        description: 'Exact model id to inspect. Requires provider; omit to list that provider\'s advertised models.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, result) => [{ type: 'text', text: result }],
    },
    execute(args, exec) {
      return listSubagentModels(ctx, policy, args, exec.signal)
    },
  }))
}
