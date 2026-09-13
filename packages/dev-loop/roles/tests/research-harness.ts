/** Research deployment extends the frozen Loader fixture without changing its historical baseline. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import * as fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import * as shellEnv from '@deepseek-ai/dsh-shell-env'
import * as bashTool from '@deepseek-ai/dsh-tool-bash'
import * as subagentTool from '@deepseek-ai/dsh-tool-subagent'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { fixture, policy, toolConfig, type Fixture } from './harness.ts'
import type { Config } from '../src/types.ts'

export type Mode = 'native' | 'ptc'
export type Provider = 'spawn' | 'fork'
export const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')
export const excluded = ['host_execute', 'preset_delegate', 'future_capability'] as const

export function researchConfig(provider: Provider = 'spawn'): Config {
  const config = policy()
  // Fork is installed before dispatch, but the frozen Host validates its provider at mount.
  config.roles.Research.toolFilter = { allow: ['read', 'read_image'] }
  if (provider === 'fork') config.roles.Research.provider = 'fork'
  return config
}

export async function researchFixture(
  script: Parameters<typeof fixture>[0],
  run: (f: Fixture & { calls: Record<string, number> }) => Promise<void>,
  mode: Mode = 'native', provider: Provider = 'spawn', override?: Config,
) {
  const config = override ?? researchConfig()
  await fixture(script, async (f) => {
    const calls: Record<string, number> = Object.fromEntries(excluded.map(name => [name, 0]))
    const probe = (name: string) => ({ name: `probe-${name}`, inject: ['tools'], apply(ctx: Context) {
      ctx.tools.register(defineContentToolFixture({ name, description: 'Excluded inherited acceptance probe.', parameters: {},
        execute: async () => { calls[name] = (calls[name] ?? 0) + 1; return [{ type: 'text', text: `${name} executed` }] },
      }))
    } })
    Object.assign(f.ctx.loader.builtins, {
      'research-attachments': LocalAttachmentStore,
      'research-worker': WorkerThreadCodeRuntime,
      'research-fork': fork,
      'research-bash': BashLocal, 'research-shell-env': shellEnv,
      'research-bash-tool': bashTool, 'research-delegation-tool': subagentTool,
      'research-host-probe': probe('host_execute'),
      'research-preset-probe': probe('preset_delegate'),
      'research-future-probe': probe('future_capability'),
      'research-presentation': { name: 'research-presentation', inject: ['tools'], apply(ctx: Context) { ctx.tools.presentAs(mode) } },
    })
    const root = dirname(f.repo)
    const hostFile = join(root, 'research-host.cordis.yml')
    await writeFile(hostFile, JSON.stringify([
      { name: 'cordis:research-attachments', config: { dshHome: join(root, 'images') } },
      { name: 'cordis:research-worker', config: { computeMs: 5000, maxWallMs: 20000, maxOutputBytes: 8192, maxOldGenerationSizeMb: 64 } },
      { name: 'cordis:research-fork' }, { name: 'cordis:research-host-probe' },
      { name: 'cordis:research-bash', config: { cwd: f.repo } },
      { name: 'cordis:research-shell-env', config: { dshHome: join(root, 'shell-home') } },
      { name: 'cordis:research-bash-tool', config: { enableRunInBackground: false } },
    ]))
    await f.ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(hostFile).href } })
    await f.ctx.loader.await()
    const preset = join(root, 'presets', 'research')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'preset.yml'), 'name: Research acceptance\ndescription: Inspected reading capabilities and excluded probes\n')
    await writeFile(join(preset, 'agent.cordis.yml'), JSON.stringify([
      { name: 'cordis:research-preset-probe' }, { name: 'cordis:research-presentation' },
      { name: 'cordis:research-delegation-tool', config: { provider: 'spawn', toolName: 'subagent', enableRunInBackground: false } },
    ]))
    await f.ctx.get('agentPresets')!.recompose(f.handle.agent.ctx, 'research')
    // The model endpoint is the only simulated execution owner; advertise its image input support.
    f.adapter.resolveModel = async (route: string, model: string): Promise<LlmResolvedModelInfo> =>
      ({ provider: route, id: model, name: model, inputModalities: ['text', 'image'] })
    if (provider === 'fork') {
      // Mount a new Roles owner through Loader with the fork provider already registered.
      const owner = [...f.ctx.loader.entries()].find(entry => entry.options.name === 'cordis:roles')!
      config.roles.Research.provider = 'fork'
      await owner.update({ config }, false, true)
      await f.ctx.loader.await()
    }
    await run({ ...f, calls })
  }, config, toolConfig, true)
}
