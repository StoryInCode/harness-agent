/** Roles PTC denial and the existing SubagentRuntime child-local capture guarantee. */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread'
import { expect, it } from 'vitest'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { fixture, toolConfig } from './harness.ts'

it('denies a Research inherited write through a real PTC worker and leaves its body without a filesystem effect', async () => {
  await fixture([
    toolCallResponse('ptc-write', 'run_code', {
      code: 'return await tools.write({ file_path: "ptc-forbidden.txt", content: "must not execute" })',
      description: 'Try the inherited write capability',
    }),
    textResponse('Research reports: PTC write refused.'),
  ], async (f) => {
    await f.ctx.plugin(WorkerThreadCodeRuntime, { computeMs: 5000, maxWallMs: 20_000,
      maxOutputBytes: 8192, maxOldGenerationSizeMb: 64 })
    f.ctx.loader.builtins['supplemental-ptc'] = {
      name: 'supplemental-ptc-presentation', inject: ['tools'],
      apply(ctx: Context) { ctx.tools.presentAs('ptc') },
    }
    const preset = join(dirname(f.repo), 'presets', 'ptc')
    await mkdir(preset, { recursive: true })
    await writeFile(join(preset, 'agent.cordis.yml'), '[{"name":"cordis:supplemental-ptc"}]\n')
    await writeFile(join(preset, 'preset.yml'), 'name: PTC acceptance\ndescription: Private PTC presentation\n')
    await f.ctx.get('agentPresets')!.recompose(f.handle.agent.ctx, 'ptc')
    const results: Array<{ id: string; isError: boolean }> = []
    f.ctx.on('session/event', (session, event) => {
      if (session.header.parentSession !== f.handle.agent.id || event.type !== 'tool/result') return
      const block = event.data.message.content[0]
      results.push({ id: block.toolCallId, isError: block.isError ?? false })
    })
    const record = await f.delegate()
    expect(record).toMatchObject({ status: 'completed', effectivePreset: 'ptc' })
    expect(f.adapter.requests[0]!.tools?.map(schema => schema.name)).toEqual(['run_code'])
    expect(results).toEqual([{ id: 'ptc-write', isError: true }])
    await expect(access(join(record.worktreeAssignment!.worktreePath, 'ptc-forbidden.txt')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  }, {}, toolConfig, true)
})

it('prerequisite: the actual spawn provider keeps child-local structured capture under an inherited allow filter', async () => {
  // Roles has no outputSchema field; this pins its existing provider dependency without extending RoleConfig.
  await fixture([toolCallResponse('capture', 'structured_output', { answer: 42 })], async (f) => {
    const run = await f.ctx.get('subagents')!.start('spawn', {
      parent: f.handle.agent, signal: new AbortController().signal, cwd: f.repo,
      prompt: [{ type: 'text', text: 'Return the structured answer.' }],
      toolFilter: { allow: ['read'] },
      outputSchema: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false },
    })
    try {
      expect(await run.result).toMatchObject({ stopReason: 'completed', structured: { answer: 42 } })
      expect(f.adapter.requests).toHaveLength(1)
      const names = f.adapter.requests[0]!.tools?.map(schema => schema.name)
      expect(names).toEqual(expect.arrayContaining(['read', 'structured_output']))
      expect(names).not.toContain('write')
      expect(f.ctx.get('tools')!.schemas(f.handle.agent).map(schema => schema.name)).not.toContain('structured_output')
    } finally { await run.dispose() }
  })
})
