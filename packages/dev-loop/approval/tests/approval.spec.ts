/** Behavioral specification; the adjacent registration scaffold intentionally leaves these cases RED. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import UserQuestionService, { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import DevLoopDirectory, { PieceParseError } from '@deepseek-ai/dsh-dev-loop-directory'
import type { PieceStatus } from '@deepseek-ai/dsh-dev-loop-directory'
import DevLoopLifecycle, { StalePieceStatusError } from '@deepseek-ai/dsh-dev-loop-lifecycle'
import * as approval from '../src/index.ts'

const TOOL = 'present_piece_for_approval'
const ID = '00.03'
const PATH = 'plans/pieces/00-approval/00.03-approval.md'
const TEACHING = '### Approaches considered\nCompare a question batch with a custom panel.\n\n### Prior art inspected\nNo external implementation is claimed by this fixture.'
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

function piece(teaching = TEACHING, status: PieceStatus = 'todo'): string {
  const header = [
    '# 00.03 — Approval fixture', '',
    '**Set:** 00-approval · **Queue:** 3 · **Depends on:** none',
    `**Status:** ${status}`,
    '**Harness primitive:** model-facing tool · **Package:** `@deepseek-ai/dsh-dev-loop-approval`',
  ]
  const sections = ['Summary', 'Behaviour', 'Harness fit', 'Contracts', 'Dependencies', 'References',
    'How to see it', 'Teach me while you build', 'Resources and proof', 'Reuse capture', 'Acceptance']
  return [...header, ...sections.flatMap(section => ['', `## ${section}`, '',
    section === 'Teach me while you build' ? teaching : `Unabridged ${section} material — π.`]), ''].join('\n')
}

function answer(label: string, feedback?: string): AskUserQuestionAnswer {
  return { answers: [
    { id: 'decision', selected: [label] },
    ...feedback === undefined ? [] : [{ id: 'feedback', selected: [], custom: feedback }],
  ] }
}

async function fixture(options: { source?: string; status?: PieceStatus; composition?: boolean; maxLines?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-approval-'))
  const ctx = new Context()
  const releases: Array<() => void> = []
  const active: Promise<unknown>[] = []
  const restores: Array<() => void> = []
  cleanups.push(async () => {
    for (const release of releases) release()
    await Promise.allSettled(active)
    for (const restore of restores) restore()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const source = options.source ?? piece(TEACHING, options.status)
  const filename = join(root, PATH)
  await mkdir(dirname(filename), { recursive: true })
  await writeFile(filename, source)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await mountAgentLoopTestHarness(ctx)
  let plugin: Fiber
  if (options.composition) {
    await ctx.plugin(Loader, { baseUrl: pathToFileURL(root + '/').href })
    // Source-plane composition uses the Loader's official builtin registry, not a mocked loader or services.
    Object.assign(ctx.loader.builtins, {
      include: Include, 'approval-fs': LocalFileSystem, 'approval-subprocess': LocalSubprocessRuntime,
      'approval-directory': DevLoopDirectory, 'approval-lifecycle': DevLoopLifecycle,
      'approval-questions': UserQuestionService, 'approval-tool': approval,
    })
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- name: cordis:approval-fs', '  config:', `    cwd: ${JSON.stringify(root)}`,
      '- name: cordis:approval-subprocess', '- name: cordis:approval-directory', '  config:',
      '    root: plans/pieces', '- name: cordis:approval-lifecycle', '- name: cordis:approval-questions',
      '- name: cordis:approval-tool', '',
    ].join('\n'))
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    plugin = ctx.fiber
  } else {
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(LocalSubprocessRuntime)
    await ctx.plugin(DevLoopDirectory, { root: 'plans/pieces',
      ...options.maxLines === undefined ? {} : { maxLines: options.maxLines } })
    await ctx.plugin(DevLoopLifecycle)
    await ctx.plugin(UserQuestionService)
    plugin = await ctx.plugin(approval)
  }
  const handle = await ctx.agents.create({ sessionId: SessionId('approval-root'), meta: { cwd: root } })
  const agent = handle.agent
  const lifecycle = ctx.get('devLoopLifecycle')!
  const directory = ctx.get('devLoopDirectory')!
  const fs = ctx.get('fs')!
  const tools = ctx.get('tools')!
  const transition = vi.spyOn(lifecycle, 'transition')
  restores.push(() => { transition.mockRestore() })
  const seen: AskUserQuestionRequest[] = []
  let callId = 0
  const call = (caller: Agent | undefined = agent, signal = new AbortController().signal, pieceId = ID) => {
    const pending = tools.execute({ name: TOOL, callId: ToolCallId(`approval-${++callId}`),
      arguments: { pieceId }, signal, ...caller === undefined ? {} : { agent: caller } })
    active.push(pending)
    return pending
  }
  const respond = (provider: (request: AskUserQuestionRequest) => Promise<AskUserQuestionAnswer>) => {
    ctx.on('user-questions/request', (request) => {
      seen.push(request)
      return provider(request)
    })
  }
  return { ctx, root, source, filename, plugin, handle, agent, lifecycle, directory, fs, tools,
    transition, seen, call, respond, releases, restores }
}

async function reached(marker: Promise<unknown>, call: Promise<ToolExecutionResult>): Promise<void> {
  await Promise.race([marker, call.then((result) => {
    throw new Error(`Tool settled before reaching the required wait: ${result.error?.message ?? 'success'}`)
  })])
}

function expectCode(result: ToolExecutionResult, code: string): void {
  expect(result).toMatchObject({ isError: true, error: { info: { code } } })
}

describe('present_piece_for_approval', () => {
  it('presents the complete markdown in a generic decision-and-feedback batch', async () => {
    const f = await fixture()
    f.respond(async () => answer('Question'))
    const result = await f.call()
    expect(result.isError, result.error?.message).toBe(false)
    expect(f.seen).toHaveLength(1)
    const request = f.seen[0]!
    expect(request.agent).toBe(f.agent)
    expect(request.signal).toBeInstanceOf(AbortSignal)
    expect(request.questions.map(question => question.id)).toEqual(['decision', 'feedback'])
    expect(request.questions[0]).toMatchObject({ detail: f.source,
      options: [{ label: 'Accept' }, { label: 'Question' }, { label: 'Change' }] })
    expect(request.questions[0]?.multiSelect ?? false).toBe(false)
    expect(request.questions.every(question => question.intent === undefined)).toBe(true)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each([
    ['markdown headings', TEACHING, []],
    ['bold list labels', '- **Approaches considered:** a batch.\n- **Prior art inspected:** none.', []],
    ['one missing subsection', '### Approaches considered\nA batch.', ['Prior art inspected']],
    ['labels outside teaching and inside fences', [
      '```markdown', '### Approaches considered', '```', '~~~markdown',
      '- **Prior art inspected:** not evidence.', '~~~',
    ].join('\n'), ['Approaches considered', 'Prior art inspected']],
  ] as const)('detects teaching warnings with %s', async (_name, teaching, missing) => {
    const source = piece(teaching).replace('Unabridged References material — π.',
      '**Approaches considered:** outside teaching.\n**Prior art inspected:** outside teaching.')
    const f = await fixture({ source })
    f.respond(async () => answer('Question'))
    await f.call()
    expect(f.seen).toHaveLength(1)
    const detail = f.seen[0]!.questions[0]!.detail!
    expect(detail.startsWith(source)).toBe(true)
    const expected = missing.map(label => `Review warning: missing teaching subsection: ${label}.`)
    expect(detail.match(/Review warning: missing teaching subsection: [^.]+\./g) ?? []).toEqual(expected)
  })

  it.each([['Accept', 'accept'], ['Question', 'question'], ['Change', 'change']] as const)(
    'returns exact %s with trimmed independent feedback', async (label, decision) => {
      const f = await fixture()
      f.respond(async () => answer(label, '  Explain the tradeoff.\n'))
      const result = await f.call()
      expect(result).toMatchObject({ isError: false,
        value: { pieceId: ID, decision, feedback: 'Explain the tradeoff.' } })
      expect(f.lifecycle.getStatus(ID)).toBe(decision === 'accept' ? 'pending' : 'todo')
      expect(f.transition).toHaveBeenCalledTimes(decision === 'accept' ? 1 : 0)
      if (decision === 'accept') {
        const [pieceId, from, to, , signal] = f.transition.mock.calls[0]!
        expect([pieceId, from, to]).toEqual([ID, 'todo', 'pending'])
        expect(signal).toBe(f.seen[0]!.signal)
        expect(signal).toBeInstanceOf(AbortSignal)
      }
    })

  it.each([undefined, '', ' \n '])('omits absent or blank optional feedback (%j)', async (feedback) => {
    const f = await fixture()
    f.respond(async () => answer('Question', feedback))
    const result = await f.call()
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ pieceId: ID, decision: 'question' })
    expect(await readFile(f.filename, 'utf8')).toBe(f.source)
    expect(f.transition).not.toHaveBeenCalled()
  })

  const invalid: Array<[string, AskUserQuestionAnswer['answers']]> = [
    ['skipped', []],
    ['feedback only', [{ id: 'feedback', selected: [], custom: 'Accept' }]],
    ['empty selection', [{ id: 'decision', selected: [] }]],
    ['unknown label', [{ id: 'decision', selected: ['Approve'] }]],
    ['multiple labels', [{ id: 'decision', selected: ['Accept', 'Question'] }]],
    ['duplicate label', [{ id: 'decision', selected: ['Accept', 'Accept'] }]],
    ['custom only', [{ id: 'decision', selected: [], custom: 'Accept' }]],
    ['selected plus custom', [{ id: 'decision', selected: ['Accept'], custom: 'probably' }]],
    ['duplicate decision', [{ id: 'decision', selected: ['Accept'] }, { id: 'decision', selected: ['Accept'] }]],
    ['duplicate feedback', [{ id: 'decision', selected: ['Accept'] },
      { id: 'feedback', selected: [], custom: 'one' }, { id: 'feedback', selected: [], custom: 'two' }]],
  ]
  it.each(invalid)('rejects %s without authorizing work', async (_label, answers) => {
    const f = await fixture()
    f.respond(async () => ({ answers }))
    expectCode(await f.call(), 'APPROVAL_DECISION_REQUIRED')
    expect(f.lifecycle.getStatus(ID)).toBe('todo')
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('reports an absent piece before asking', async () => {
    const f = await fixture()
    f.respond(async () => answer('Accept'))
    expectCode(await f.call(f.agent, undefined, '00.99'), 'PIECE_NOT_FOUND')
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('rejects source removed after lookup but before the initial version observation', async () => {
    const f = await fixture()
    const lookup = f.directory.getPiece.bind(f.directory)
    const hook = vi.spyOn(f.directory, 'getPiece').mockImplementationOnce(async (id) => {
      const record = await lookup(id)
      await rm(join(f.root, record.path))
      return record
    })
    const ask = vi.spyOn(f.ctx.get('userQuestions')!, 'ask')
    f.restores.push(() => { hook.mockRestore() }, () => { ask.mockRestore() })
    f.respond(async () => answer('Accept'))
    expectCode(await f.call(), 'PIECE_REVIEW_STALE')
    expect(ask).not.toHaveBeenCalled()
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('retains the real malformed-piece diagnosis rather than reporting absence', async () => {
    const f = await fixture()
    await writeFile(f.filename, f.source.replace('model-facing tool', 'Plugin'))
    const parseFailure: unknown = await f.directory.getPiece(ID).catch((error: unknown) => error)
    expect(parseFailure).toBeInstanceOf(PieceParseError)
    if (!(parseFailure instanceof PieceParseError)) throw new Error('fixture did not produce a parser failure')
    f.respond(async () => answer('Accept'))
    expect(await f.call()).toMatchObject({ isError: true, error: { message: parseFailure.message } })
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['pending', 'blocked', 'done'] as const)('rejects initial %s status before asking', async (status) => {
    const f = await fixture({ status })
    f.respond(async () => answer('Accept'))
    expectCode(await f.call(), 'PIECE_NOT_APPROVABLE')
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['absent', 'delegated', 'stale'] as const)('rejects a %s caller using real Agent ownership', async (kind) => {
    const f = await fixture()
    let caller: Agent | undefined = f.agent
    if (kind === 'absent') caller = undefined
    if (kind === 'delegated') {
      caller = (await f.ctx.agents.create({ sessionId: SessionId('approval-child'), parentAgent: f.agent })).agent
    }
    if (kind === 'stale') await f.handle.dispose()
    f.respond(async () => answer('Accept'))
    // Passing undefined explicitly must exercise the absence, not the fixture's default root.
    const result = kind === 'absent'
      ? await f.tools.execute({ callId: ToolCallId('absent'), name: TOOL,
        arguments: { pieceId: ID }, signal: new AbortController().signal })
      : await f.call(caller)
    expectCode(result, kind === 'delegated' ? 'DELEGATED_CALLER' : 'CALLER_NOT_LIVE')
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('propagates an unclaimed question without a lifecycle write', async () => {
    const f = await fixture()
    expectCode(await f.call(), 'NO_PROVIDER')
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('propagates provider failure without authorizing the piece', async () => {
    const f = await fixture()
    f.respond(async () => { throw new UserQuestionError('answer transport failed', 'FIXTURE_PROVIDER_FAILED') })
    expectCode(await f.call(), 'FIXTURE_PROVIDER_FAILED')
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('rejects source changed while the human reviews it', async () => {
    const f = await fixture()
    f.respond(async () => {
      await writeFile(f.filename, f.source + '\nUnreviewed additional obligation.\n')
      return answer('Accept')
    })
    expectCode(await f.call(), 'PIECE_REVIEW_STALE')
    expect(f.seen).toHaveLength(1)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['malformed', 'identity', 'configured line limit'] as const)('revalidates actual text after a cached lookup (%s)', async (change) => {
    const f = await fixture({ maxLines: 100 })
    const lookup = f.directory.getPiece.bind(f.directory)
    const changed = change === 'malformed' ? f.source.replace('model-facing tool', 'Plugin')
      : change === 'identity' ? f.source.replace('# 00.03', '# 00.04')
        : f.source + '\nMore current text.'.repeat(101)
    const hook = vi.spyOn(f.directory, 'getPiece').mockImplementationOnce(async (id) => {
      const cached = await lookup(id)
      await writeFile(f.filename, changed)
      return cached
    })
    f.restores.push(() => { hook.mockRestore() })
    f.respond(async () => answer('Accept'))
    const result = await f.call()
    if (change === 'identity') expectCode(result, 'PIECE_REVIEW_STALE')
    else {
      expect(result.isError).toBe(true)
      expect(result.error?.message).toContain(change === 'malformed'
        ? 'Harness primitive "Plugin" is not one of' : '100-line ceiling')
    }
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('rejects a changing source read before presenting mixed-version text', async () => {
    const f = await fixture()
    const lookup = f.directory.getPiece.bind(f.directory)
    const read = f.fs.readText.bind(f.fs)
    let armed = false
    const lookupHook = vi.spyOn(f.directory, 'getPiece').mockImplementationOnce(async (id) => {
      const record = await lookup(id)
      armed = true
      return record
    })
    const readHook = vi.spyOn(f.fs, 'readText').mockImplementation(async (target, signal) => {
      const text = await read(target, signal)
      if (armed) {
        armed = false
        await writeFile(f.filename, f.source + '\nConcurrent edit during read.\n')
      }
      return text
    })
    f.restores.push(() => { lookupHook.mockRestore() }, () => { readHook.mockRestore() })
    f.respond(async () => answer('Accept'))
    expectCode(await f.call(), 'PIECE_REVIEW_STALE')
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('waits for the lifecycle transition before returning acceptance', async () => {
    const f = await fixture()
    const entered = deferred<undefined>()
    const release = deferred<undefined>()
    f.releases.push(() => { release.resolve(undefined) })
    f.transition.mockRestore()
    const commit = f.lifecycle.transition.bind(f.lifecycle)
    const hook = vi.spyOn(f.lifecycle, 'transition').mockImplementation(async (...args) => {
      entered.resolve(undefined)
      await release.promise
      return commit(...args)
    })
    f.restores.push(() => { hook.mockRestore() })
    f.respond(async () => answer('Accept'))
    const pending = f.call()
    let settled = false
    void pending.then(() => { settled = true })
    await reached(entered.promise, pending)
    expect(f.lifecycle.getStatus(ID)).toBe('todo')
    expect(settled).toBe(false)
    release.resolve(undefined)
    expect(await pending).toMatchObject({ isError: false, value: { pieceId: ID, decision: 'accept' } })
  })

  it('surfaces a real compare-and-set conflict rather than returning acceptance', async () => {
    const f = await fixture()
    f.respond(async () => {
      await f.lifecycle.transition(ID, 'todo', 'pending', 'another reviewer won')
      return answer('Accept')
    })
    const expected = new StalePieceStatusError(ID, 'todo', 'pending')
    expect(await f.call()).toMatchObject({ isError: true, error: { message: expected.message } })
    expect(f.transition).toHaveBeenCalledTimes(2)
    expect(f.lifecycle.getStatus(ID)).toBe('pending')
  })

  it.each(['caller cancellation', 'plugin disposal'] as const)('awaits answerer quiescence after %s and rejects late Accept', async (action) => {
    const f = await fixture()
    const entered = deferred<undefined>()
    const aborted = deferred<undefined>()
    const release = deferred<undefined>()
    f.releases.push(() => { release.resolve(undefined) })
    f.respond(async (request) => {
      const onAbort = () => { aborted.resolve(undefined) }
      request.signal!.addEventListener('abort', onAbort, { once: true })
      entered.resolve(undefined)
      try {
        await release.promise
        return answer('Accept')
      } finally {
        request.signal!.removeEventListener('abort', onAbort)
      }
    })
    const controller = new AbortController()
    const pending = f.call(f.agent, controller.signal)
    let settled = false
    void pending.then(() => { settled = true })
    await reached(entered.promise, pending)
    let disposed = false
    const disposal = action === 'plugin disposal'
      ? f.plugin.dispose().then(() => { disposed = true })
      : Promise.resolve()
    if (action === 'caller cancellation') controller.abort()
    await reached(aborted.promise, pending)
    expect(settled).toBe(false)
    if (action === 'plugin disposal') expect(disposed).toBe(false)
    expect(f.transition).not.toHaveBeenCalled()
    release.resolve(undefined)
    expect((await pending).isError).toBe(true)
    await disposal
    expect(f.lifecycle.getStatus(ID)).toBe('todo')
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('removes the tool on disposal so new calls cannot prompt', async () => {
    const f = await fixture()
    f.respond(async () => answer('Accept'))
    expect(f.tools.get(TOOL)).toBeDefined()
    await f.plugin.dispose()
    expect(f.tools.get(TOOL)).toBeUndefined()
    expectCode(await f.call(), 'UNKNOWN_TOOL')
    expect(f.seen).toHaveLength(0)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('renders the canonical result without reading or mutating runtime state', async () => {
    const f = await fixture()
    const output = f.tools.get(TOOL)!.output
    const render = output.render.bind(output)
    const value = Object.freeze({ pieceId: ID, decision: 'question', feedback: 'Why this approach?' })
    expect(render({ pieceId: ID }, value)).toMatchInlineSnapshot(`
      [
        {
          "text": "{"pieceId":"00.03","decision":"question","feedback":"Why this approach?"}",
          "type": "text",
        },
      ]
    `)
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.seen).toHaveLength(0)
  })

  it('loads a YAML composition and returns the simulated human decision through ToolRuntime', async () => {
    const f = await fixture({ composition: true })
    f.respond(async () => answer('Accept', 'Ship this specification.'))
    const result = await f.call()
    expect(result).toMatchObject({ isError: false,
      value: { pieceId: ID, decision: 'accept', feedback: 'Ship this specification.' },
      content: [{ type: 'text', text: '{"pieceId":"00.03","decision":"accept","feedback":"Ship this specification."}' }] })
    expect(f.seen[0]?.questions[0]?.detail).toBe(f.source)
    expect(f.lifecycle.getStatus(ID)).toBe('pending')
  })
})
