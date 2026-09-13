/** Research-specific policy and actual Loader/provider/executor acceptance, independent of 00.06. */
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { brief, fixture, policy } from './harness.ts'
import { excluded, imageBytes, researchConfig, researchFixture, type Mode, type Provider } from './research-harness.ts'

it.each([{ deny: ['write'] }, { allow: [] }, { allow: [], deny: ['write'] }])(
  'rejects Research policy without a nonempty explicit allowlist at Host mount: %j', async (toolFilter) => {
    const config = policy()
    config.roles.Research.toolFilter = toolFilter
    let entered = false
    await expect(fixture([], async () => { entered = true }, config)).rejects.toThrow(/Research.*allow|allow.*Research/i)
    expect(entered).toBe(false)
  },
)

it.each(['unknown_capability', 'raed', 'run_code'])('rejects configured referent %s before the first child model request', async (name) => {
  const config = researchConfig()
  config.roles.Research.toolFilter = { allow: ['read', name] }
  await researchFixture([], async (f) => {
    const before = f.ctx.get('agents')!.list().map(agent => agent.id)
    const record = await f.delegate()
    expect(record.status).toBe('failed')
    expect(record.limitations.join(' ')).toMatch(/unknown|reserved/i)
    expect(record.subagentSessionId).toBeUndefined()
    expect(f.adapter.requests).toEqual([])
    expect(f.ctx.get('agents')!.list().map(agent => agent.id)).toEqual(before)
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
  }, 'native', 'spawn', config)
})

it.each(['missing-provider', 'acp'])('rejects unavailable or unsupported provider %s at Host mount', async (provider) => {
  const config = policy()
  config.roles.Research.provider = provider
  let entered = false
  await expect(fixture([], async () => { entered = true }, config)).rejects.toThrow(/provider|capability/i)
  expect(entered).toBe(false)
})

const paths: Array<[Provider, Mode]> = [['spawn', 'native'], ['spawn', 'ptc'], ['fork', 'native'], ['fork', 'ptc']]
const call = (mode: Mode, id: string, name: string, args: Record<string, unknown>) => mode === 'native'
  ? toolCallResponse(id, name, args)
  : toolCallResponse(id, 'run_code', { code: `return await tools.${name}(${JSON.stringify(args)})`, description: `Call ${name}` })

it.each(paths)('%s/%s Loader Research first-call denial, actual reads, repeated child scope and parent/sibling isolation', async (provider, mode) => {
  const input = { ...brief, assignment: 'Read source and image; do not mutate inherited capabilities.' }
  await researchFixture([
    call(mode, 'delegate', 'dev_loop_delegate', input),
    call(mode, 'first-denied', 'host_execute', {}),
    call(mode, 'preset-denied', 'preset_delegate', {}),
    call(mode, 'future-denied', 'future_capability', {}),
    call(mode, 'write-denied', 'write', { file_path: 'forbidden.txt', content: 'forbidden' }),
    call(mode, 'bash-denied', 'bash', { command: 'printf forbidden > shell-forbidden.txt', description: 'Attempt shell mutation' }),
    call(mode, 'delegation-denied', 'subagent', { prompt: 'Attempt further delegation', description: 'Attempt further delegation' }),
    call(mode, 'read-text', 'read', { file_path: 'tracked.txt' }),
    call(mode, 'read-image', 'read_image', { file_path: 'sample.png' }),
    textResponse('Research reports actual text/image reads; inherited calls refused.'),
    textResponse('Brain received reported evidence, not direct inspection.'),
    call(mode, 'sibling-write', 'write', { file_path: 'sibling.txt', content: 'Implementer retains write' }),
    textResponse('Implementer wrote its file.'),
    call(mode, 'repeat-denied', 'future_capability', {}),
    textResponse('Second Research remains restricted.'),
  ], async (f) => {
    const tools = f.ctx.get('tools')!
    const parent = f.handle.agent
    const originalHeader = structuredClone(parent.session.header)
    const before = f.ctx.get('agents')!.list().map(agent => agent.id)
    const assignment = await f.ctx.get('agents')!.withInitiator(parent, () =>
      f.ctx.get('devLoopWorktree')!.assignWorktree({ pieceId: brief.pieceId, cwd: f.repo, signal: new AbortController().signal }))
    await writeFile(join(assignment.worktreePath, 'sample.png'), imageBytes)
    // A newly loaded inherited name remains denied without changing a deny-name inventory.
    await f.ctx.loader.create({ name: 'cordis:research-future-probe' })
    await f.ctx.loader.await()
    const childResults: Array<{ id: string; error: boolean; content: readonly ContentBlock[] }> = []
    f.ctx.on('session/event', (session, event) => {
      if (session.header.parentSession !== parent.id || event.type !== 'tool/result') return
      const block = event.data.message.content[0]
      childResults.push({ id: block.toolCallId, error: block.isError ?? false, content: block.content })
    })
    await runFixtureTurn(f.ctx, { task: 'Delegate the Research assignment.' })
    expect(f.adapter.requests).toHaveLength(11)
    expect(tools.schemas(parent).map(tool => tool.name)).toEqual(expect.arrayContaining(mode === 'native' ? ['bash', 'subagent', 'write'] : ['run_code']))
    const first = f.adapter.requests[1]!
    if (mode === 'native') expect(first.tools?.map(tool => tool.name).sort()).toEqual(['read', 'read_image'])
    else {
      expect(first.tools?.map(tool => tool.name)).toEqual(['run_code'])
      const prompt = JSON.stringify(first.messages.filter(message => message.role === 'system'))
      expect(prompt).toContain('read_image')
      for (const name of excluded) expect(prompt).not.toContain(`function ${name}`)
    }
    expect(childResults.slice(0, 6).map(row => [row.id, row.error])).toEqual([
      ['first-denied', true], ['preset-denied', true], ['future-denied', true], ['write-denied', true],
      ['bash-denied', true], ['delegation-denied', true],
    ])
    expect(childResults[6]).toMatchObject({ id: 'read-text', error: false })
    expect(JSON.stringify(childResults[6]!.content)).toContain('retained evidence')
    expect(childResults[7]).toMatchObject({ id: 'read-image', error: false })
    // PTC carries image context beside the outer tool result; native keeps it inside that result.
    const modelBlocks = f.adapter.requests[9]!.messages.flatMap(message => message.content)
    const image = [...childResults[7]!.content, ...modelBlocks].find(block => block.type === 'image')
    expect(image).toMatchObject({ type: 'image', attachment: { mediaType: 'image/png', width: 1, height: 1 } })
    if (image?.type !== 'image') throw new Error('Actual read_image must return a durable image block')
    const stored = await f.ctx.get('attachments')!.readImage(image.attachment)
    expect(Buffer.from(stored.data)).toEqual(imageBytes)
    const imageResult = f.adapter.requests[9]!.messages.flatMap(message => message.content)
      .filter(block => block.type === 'tool-result').find(block => block.toolCallId === 'read-image')
    expect(JSON.stringify(imageResult)).toContain('image')
    expect(f.calls).toEqual({ host_execute: 0, preset_delegate: 0, future_capability: 0 })
    await expect(access(join(assignment.worktreePath, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(assignment.worktreePath, 'shell-forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(assignment.worktreePath, 'tracked.txt'), 'utf8')).toBe('retained evidence\n')
    const sibling = await f.delegate({ ...brief, role: 'Implementer' })
    expect(sibling.status).toBe('completed')
    expect(await readFile(join(assignment.worktreePath, 'sibling.txt'), 'utf8')).toBe('Implementer retains write')
    const repeat = await f.delegate()
    expect(repeat.status).toBe('completed')
    expect(childResults.at(-1)).toMatchObject({ id: 'repeat-denied', error: true })
    const writeArgs = { file_path: 'parent.txt', content: 'Parent retains write' }
    const parentWrite = await tools.execute({ callId: ToolCallId('parent-write'), name: mode === 'native' ? 'write' : 'run_code',
      arguments: mode === 'native' ? writeArgs : { code: `return await tools.write(${JSON.stringify(writeArgs)})`, description: 'Parent write' },
      agent: parent, signal: new AbortController().signal })
    expect(parentWrite.isError).not.toBe(true)
    expect(await readFile(join(f.repo, 'parent.txt'), 'utf8')).toBe('Parent retains write')
    expect(parent.session.header).toEqual(originalHeader)
    expect(f.ctx.get('agents')!.list().map(agent => agent.id)).toEqual(before)
    expect(f.ctx.get('devLoopQueue')!.getActiveWorkers()).toEqual([])
    expect(f.calls).toEqual({ host_execute: 0, preset_delegate: 0, future_capability: 0 })
  }, mode, provider)
})

it.each(paths)('%s/%s provider-local structured capture is not an inherited-tool restriction', async (provider, mode) => {
  await researchFixture([call(mode, 'capture', 'structured_output', { answer: 42 })], async (f) => {
    const run = await f.ctx.get('subagents')!.start(provider, { parent: f.handle.agent, signal: new AbortController().signal,
      cwd: f.repo, prompt: [{ type: 'text', text: 'Capture the answer.' }], toolFilter: { allow: ['read', 'read_image'] },
      outputSchema: { type: 'object', properties: { answer: { type: 'integer' } }, required: ['answer'], additionalProperties: false },
    })
    try {
      expect(await run.result).toMatchObject({ stopReason: 'completed', structured: { answer: 42 } })
      expect(f.adapter.requests).toHaveLength(1)
      if (mode === 'native') expect(f.adapter.requests[0]!.tools?.map(tool => tool.name)).toContain('structured_output')
      expect(f.ctx.get('tools')!.schemas(f.handle.agent).map(tool => tool.name)).not.toContain('structured_output')
    } finally { await run.dispose() }
    expect(f.ctx.get('agents')!.get(run.id)).toBeUndefined()
  }, mode, provider)
})

it('an optional deny list subtracts from the explicit Research allowlist without granting writing', async () => {
  const config = researchConfig()
  config.roles.Research.toolFilter = { allow: ['read', 'read_image'], deny: ['read_image'] }
  await researchFixture([
    toolCallResponse('deny-image', 'read_image', { file_path: 'sample.png' }), textResponse('Image excluded by Host subtraction.'),
  ], async (f) => {
    expect((await f.delegate()).status).toBe('completed')
    expect(f.adapter.requests[0]!.tools?.map(tool => tool.name)).toEqual(['read'])
    const result = f.adapter.requests[1]!.messages.flatMap(message => message.content).find(block => block.type === 'tool-result')
    expect(result).toMatchObject({ toolCallId: 'deny-image', isError: true })
  }, 'native', 'spawn', config)
})

it('rejects model-supplied policy authority instead of overriding Host selection', async () => {
  await researchFixture([
    toolCallResponse('override', 'dev_loop_delegate', { ...brief, toolFilter: { allow: ['write'] } }),
    textResponse('The model cannot change Host capability policy.'),
  ], async (f) => {
    await runFixtureTurn(f.ctx, { task: 'Attempt policy override.' })
    expect(f.adapter.requests).toHaveLength(2)
    const result = f.adapter.requests[1]!.messages.flatMap(message => message.content).find(block => block.type === 'tool-result')
    expect(result).toMatchObject({ isError: true })
    expect(await f.ctx.get('devLoopRoles')!.getDelegations(brief.pieceId)).toEqual([])
  })
})
