/** Keyless Loader/AgentLoop acceptance transcript with only model and human responses scripted. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import DevLoopDirectory from '@deepseek-ai/dsh-dev-loop-directory'
import DevLoopLifecycle from '@deepseek-ai/dsh-dev-loop-lifecycle'
import * as approval from '../src/index.ts'

const TOOL = 'present_piece_for_approval'
const CALL_ID = ToolCallId('approval-call')
const TASK = 'Present piece 00.03 for approval.'
const FINAL = 'Piece 00.03 is approved and pending.'
const RESULT = '{"pieceId":"00.03","decision":"accept","feedback":"Approved as written."}'
const SOURCE = [
  '# 00.03 — Recorded approval', '',
  '**Set:** 00-approval · **Queue:** 3 · **Depends on:** none',
  '**Status:** todo',
  '**Harness primitive:** model-facing tool · **Package:** `@deepseek-ai/dsh-dev-loop-approval`',
  ...['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References', 'How to see it',
    'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
    .flatMap(section => ['', `## ${section}`, '', section === 'Teach me while you build'
      ? '### Approaches considered\nA question batch or a dedicated UI.\n\n### Prior art inspected\nNo external source is claimed by this fixture.'
      : `Recorded fixture material for ${section}.`]),
  '',
].join('\n')

/** Two scripted model responses; every request and result projection still comes from the real loop. */
class ApprovalModel extends LlmAdapter {
  readonly requests: Array<{ toolOffered: boolean; results: Array<{ callId: string; text: string; isError: boolean }> }> = []

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Approval fixture model' })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push({
      toolOffered: options.tools?.some(tool => tool.name === TOOL) ?? false,
      results: options.messages.flatMap(message => message.content.flatMap(block => block.type === 'tool-result'
        ? [{ callId: block.toolCallId, isError: block.isError ?? false,
          text: block.content.filter(member => member.type === 'text').map(member => member.text).join('') }]
        : [])),
    })
    const responses: StreamChunk[][] = [
      [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: CALL_ID, name: TOOL, argumentsDelta: '{"pieceId":"00.03"}' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: CALL_ID, name: TOOL, arguments: '{"pieceId":"00.03"}' } },
        { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ],
      [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: FINAL },
        { type: 'block-end', index: 0, block: { type: 'text', text: FINAL } },
        { type: 'usage', usage: { inputTokens: 20, outputTokens: 8 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ],
    ]
    const response = responses[this.requests.length - 1]
    if (response === undefined) throw new Error('Approval fixture model script exhausted')
    yield* response
  }
}

it('records Loader-composed approval in the Session and feeds its exact result into the next model request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-approval-loop-'))
  const ctx = new Context()
  try {
    const filename = join(root, 'plans/pieces/00-approval/00.03-approval.md')
    await mkdir(dirname(filename), { recursive: true })
    await writeFile(filename, SOURCE)
    await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href })
    // These official builtin rows resolve to the actual source-plane plugins, including the production loop.
    Object.assign(ctx.loader.builtins, {
      include: Include, 'fixture-fs': LocalFileSystem, 'fixture-subprocess': LocalSubprocessRuntime,
      'fixture-directory': DevLoopDirectory, 'fixture-lifecycle': DevLoopLifecycle,
      'fixture-questions': UserQuestionService, 'fixture-approval': approval, 'fixture-loop': AgentLoop,
    })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: cordis:fixture-fs', '  config:', `    cwd: ${JSON.stringify(root)}`,
      '- name: cordis:fixture-subprocess', '- name: cordis:fixture-directory', '  config:',
      '    root: plans/pieces', '- name: cordis:fixture-lifecycle', '- name: cordis:fixture-questions',
      '- name: cordis:fixture-approval', '- name: cordis:fixture-loop', '  config:', '    agents: []', '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const model = new ApprovalModel()
    await ctx.plugin({ inject: ['llm'], apply(inner) { inner.llm.registerAdapter(['fixture'], model) } })
    const handle = await ctx.get('agents')!.create({
      sessionId: SessionId('approval-session'), meta: { cwd: root },
      agentOptions: { provider: 'fixture', model: 'approval' },
    })
    const lifecycle = ctx.get('devLoopLifecycle')!
    expect(lifecycle.getStatus('00.03')).toBe('todo')
    let questions = 0
    ctx.on('user-questions/request', async (request) => {
      questions += 1
      expect(request.agent).toBe(handle.agent)
      expect(request.questions.map(question => question.id)).toEqual(['decision', 'feedback'])
      expect(request.questions[0]?.detail).toBe(SOURCE)
      expect(request.questions[0]?.options?.map(option => option.label)).toEqual(['Accept', 'Question', 'Change'])
      return { answers: [
        { id: 'decision', selected: ['Accept'] },
        { id: 'feedback', selected: [], custom: '  Approved as written.  ' },
      ] }
    })
    const transcript: Array<Record<string, string | number | boolean>> = []
    const turn = await runFixtureTurn(ctx, {
      task: TASK,
      onEvent(_sessionId, event) {
        if (event.type === 'user/message') {
          transcript.push({ type: event.type,
            text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('') })
        } else if (event.type === 'tool/call') {
          transcript.push({ type: event.type, turn: event.data.turn, step: event.data.step,
            callId: event.data.callId, name: event.data.name, arguments: event.data.arguments })
        } else if (event.type === 'tool/result') {
          const block = event.data.message.content[0]
          transcript.push({ type: event.type, turn: event.data.turn, step: event.data.step,
            callId: block.toolCallId, isError: block.isError ?? false,
            text: block.content.filter(member => member.type === 'text').map(member => member.text).join('') })
          expect(event.data.error).toBeUndefined()
        } else if (event.type === 'assistant/message') {
          const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
          if (text) transcript.push({ type: event.type, text })
        }
      },
    })
    expect(turn.output).toBe(FINAL)
    expect(questions).toBe(1)
    expect(lifecycle.getStatus('00.03')).toBe('pending')
    expect(model.requests).toEqual([
      { toolOffered: true, results: [] },
      { toolOffered: true, results: [{ callId: CALL_ID, isError: false, text: RESULT }] },
    ])
    expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(transcript).toMatchInlineSnapshot(`
      [
        {
          "text": "Present piece 00.03 for approval.",
          "type": "user/message",
        },
        {
          "arguments": "{"pieceId":"00.03"}",
          "callId": "approval-call",
          "name": "present_piece_for_approval",
          "step": 1,
          "turn": 1,
          "type": "tool/call",
        },
        {
          "callId": "approval-call",
          "isError": false,
          "step": 1,
          "text": "{"pieceId":"00.03","decision":"accept","feedback":"Approved as written."}",
          "turn": 1,
          "type": "tool/result",
        },
        {
          "text": "Piece 00.03 is approved and pending.",
          "type": "assistant/message",
        },
      ]
    `)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
