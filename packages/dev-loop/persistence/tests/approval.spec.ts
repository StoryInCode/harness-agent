/** The shipping approval Consumer supplies invocation and validated human-answer facts. */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as approval from '@deepseek-ai/dsh-dev-loop-approval'
import { createFixture } from './harness.ts'

async function fixture() {
  const f = await createFixture()
  const ctx = await f.mount({ beforePersistence: async (context) => {
    await mountAgentLoopTestDependencies(context, { tools: { mode: 'native' } })
    await mountAgentLoopTestHarness(context)
  } })
  ctx.loader.builtins['persistence-questions'] = UserQuestionService
  ctx.loader.builtins['persistence-approval'] = approval
  await ctx.loader.create({ name: 'cordis:persistence-questions' })
  await ctx.loader.create({ name: 'cordis:persistence-approval' })
  await ctx.loader.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('persistence-approval-root'), meta: { cwd: f.repository } })
  const callId = ToolCallId('persistence-actual-call-1')
  const call = () => ctx.tools.execute({ name: 'present_piece_for_approval', callId,
    arguments: { pieceId: '00.12' }, agent: handle.agent, signal: new AbortController().signal })
  return { ...f, ctx, handle, callId, call }
}

it('forwards actual tool callId, receiving Session, displayed revision and validated Accept answer', async () => {
  const f = await fixture()
  const original = await readFile(f.sourcePath, 'utf8')
  const transition = vi.spyOn(f.ctx.devLoopLifecycle, 'transition')
  const piece = await f.ctx.devLoopDirectory.getPiece('00.12')
  const target = await f.ctx.fs.resolve(piece.path)
  const observed = await f.ctx.fs.stat(target)
  f.ctx.on('user-questions/request', async (request) => {
    expect(request.agent).toBe(f.handle.agent)
    expect(request.questions[0]?.detail).toContain(original)
    return { answers: [{ id: 'decision', selected: ['Accept'] }] }
  })
  const result = await f.call()
  expect(result.isError, result.error?.message).toBe(false)
  expect(transition.mock.calls[0]?.[5]).toEqual({
    kind: 'tool', callId: f.callId, sessionId: f.handle.agent.session.id, decision: 'accept',
    answer: { id: 'decision', selected: ['Accept'] },
    source: { path: piece.path, version: observed?.version,
      rawDigest: createHash('sha256').update(original).digest('hex'),
      contentDigest: createHash('sha256').update(original).digest('hex') },
  })
  expect((await f.ctx.devLoopPersistence.getHistory('00.12'))[0]?.authorization).toEqual(transition.mock.calls[0]?.[5])
})

it.each(['Question', 'Change'])('%s remains a tool decision and creates no acceptance record', async (label) => {
  const f = await fixture()
  const transition = vi.spyOn(f.ctx.devLoopLifecycle, 'transition')
  f.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'decision', selected: [label] }] }))
  expect((await f.call()).isError).toBe(false)
  expect(transition).not.toHaveBeenCalled()
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
  expect(f.ctx.devLoopLifecycle.getStatus('00.12')).toBe('todo')
})

it('malformed human answer cannot manufacture approval from an Accept string beside another decision', async () => {
  const f = await fixture()
  const transition = vi.spyOn(f.ctx.devLoopLifecycle, 'transition')
  f.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'decision', selected: ['Accept', 'Change'] }] }))
  expect((await f.call()).isError).toBe(true)
  expect(transition).not.toHaveBeenCalled()
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('source changed during the human interaction produces no accepted transition', async () => {
  const f = await fixture()
  const transition = vi.spyOn(f.ctx.devLoopLifecycle, 'transition')
  f.ctx.on('user-questions/request', async () => {
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, 'utf8')) + '\nChanged while displayed.\n')
    return { answers: [{ id: 'decision', selected: ['Accept'] }] }
  })
  const result = await f.call()
  expect(result).toMatchObject({ isError: true, error: { info: { code: 'PIECE_REVIEW_STALE' } } })
  expect(transition).not.toHaveBeenCalled()
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('the approval Consumer refuses BOM-stripped source instead of asserting a byte-unfaithful acceptance', async () => {
  const f = await fixture()
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(f.sourcePath)])
  await writeFile(f.sourcePath, bytes)
  const transition = vi.spyOn(f.ctx.devLoopLifecycle, 'transition')
  f.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'decision', selected: ['Accept'] }] }))
  const result = await f.call()
  expect(await readFile(f.sourcePath)).toEqual(bytes)
  expect(result.isError).toBe(true)
  expect(transition).not.toHaveBeenCalled()
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})

it('the approval Consumer refuses a text observation with unknown byte size', async () => {
  const f = await fixture()
  const stat = f.ctx.fs.stat.bind(f.ctx.fs)
  vi.spyOn(f.ctx.fs, 'stat').mockImplementation(async (...args) => {
    const info = await stat(...args)
    return info === undefined ? undefined : { type: info.type, version: info.version }
  })
  const transition = vi.spyOn(f.ctx.devLoopLifecycle, 'transition')
  f.ctx.on('user-questions/request', async () => ({ answers: [{ id: 'decision', selected: ['Accept'] }] }))
  const result = await f.call()
  expect(result.isError).toBe(true)
  expect(transition).not.toHaveBeenCalled()
  expect(await f.ctx.devLoopPersistence.getHistory('00.12')).toEqual([])
})
