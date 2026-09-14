/** Browser catalogs for parent LLM routes and task-only subagent routes. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/**
 * Build the browser model catalog without requiring a Session.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
        }
      }))
      return {
        kind: 'group' as const,
        group: { id: provider.id, name: provider.name, models: entries },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  return {
    default: { ...defaultSelection },
    routableProviders: providers.map(provider => provider.id),
    groups: catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
      .filter(group => group.models.length > 0),
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Describe LLM and native task routes without changing the parent model catalog.
 * @param ctx - Host context carrying the LLM and optional subagent registries.
 * @param signal - Caller lifetime forwarded to native model discovery.
 * @returns Combined groups with provider-local discovery failures isolated.
 */
export async function buildSubagentModelCatalog(ctx: Context, signal: AbortSignal): Promise<ModelCatalog> {
  const subagents = ctx.get('subagents')
  const providers = (subagents?.list() ?? []).flatMap((name) => {
    const provider = subagents?.getProvider(name)
    const listModels = provider?.listModels?.bind(provider)
    return provider === undefined || listModels === undefined ? [] : [{ name: provider.name, listModels }]
  })
  const [llm, native] = await Promise.all([
    buildModelCatalog(ctx),
    Promise.all(providers.map(async (provider) => {
      const id = `subagent:${provider.name}`
      const name = provider.name
      try {
        const models = await provider.listModels(signal)
        return {
          kind: 'group' as const,
          group: { id, name, models: models.map(model => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          })) },
        }
      } catch (error) {
        return {
          kind: 'failure' as const,
          failure: { id, name, message: error instanceof Error ? error.message : String(error) },
        }
      }
    })),
  ])
  return {
    ...llm,
    routableProviders: [...llm.routableProviders.filter(id => !id.startsWith('subagent:')),
      ...providers.map(provider => `subagent:${provider.name}`)],
    groups: [...llm.groups.filter(group => !group.id.startsWith('subagent:')), ...native.flatMap(item => item.kind === 'group' && item.group.models.length > 0
      ? [item.group] : [])],
    failures: [...llm.failures.filter(failure => !failure.id.startsWith('subagent:')),
      ...native.flatMap(item => item.kind === 'failure' ? [item.failure] : [])],
  }
}
