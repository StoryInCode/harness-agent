/** Human-command grammar, revision checking and authority through actual CommandRuntime dispatch. */
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import * as command from '../src/index.ts'
import { digest, fixture } from './harness.ts'

function text(execution: CommandExecution | undefined, kind: 'success' | 'error'): string {
  expect(execution?.result.kind, execution?.result.text).toBe(kind)
  expect(execution?.result.text?.trim()).toBeTruthy()
  return execution!.result.text!
}

function usage(output: string): void {
  for (const word of ['help', 'status', 'list', 'queue', 'show', 'approve', 'reject', 'sha256', 'reason']) {
    expect(output.toLowerCase()).toContain(word)
  }
}

describe('dev-loop raw-input command', () => {
  it('loads named exports and advertises exactly one attachment-free reversible registration', async () => {
    const f = await fixture()
    expect('default' in command).toBe(false)
    expect(f.commands.list(f.agent).filter(row => row.name === 'dev-loop')).toHaveLength(1)
    expect(f.commands.find(f.agent, '/dev-loop')).toBeUndefined()
    const definition = f.commands.find(f.agent, 'dev-loop')!
    expect(definition.input?.hint).toBeTruthy()
    expect(definition.input?.attachments).not.toBe(true)
    // Dispose only the contributing Consumer, not the registry being observed.
    const entry = [...f.ctx.loader.entries()].find(row => row.options.id === 'consumer')
    expect(entry?.fiber).toBeDefined()
    await entry!.fiber!.dispose()
    expect(f.commands.find(f.agent, 'dev-loop')).toBeUndefined()
    expect(await f.call('help')).toBeUndefined()
  })

  it.each(['', 'help', ' \t\n ', '\thelp\r\n'])('returns complete usage for %j', async (raw) => {
    const f = await fixture()
    usage(text(await f.call(raw), 'success'))
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each([
    ['frobnicate', /unknown|unsupported/i],
    ['help extra', /argument|usage|unexpected/i],
    ['status extra', /argument|usage|unexpected/i],
    ['list --all', /argument|usage|unexpected/i],
    ['queue --page 2', /argument|usage|unexpected/i],
    ['show', /missing|required|usage/i],
    ['show 00.03 extra', /argument|usage|unexpected/i],
    ['show 0.03', /id|NN\.MM/i],
    ['show ../00.03', /id|NN\.MM/i],
    ['show "00.03"', /id|NN\.MM/i],
    ['approve', /missing|required|usage/i],
    ['approve 00.03', /sha256|digest/i],
    ['approve 00.03 xyz', /sha256|digest/i],
    [`approve 00.03 ${'a'.repeat(63)}`, /sha256|digest/i],
    [`approve 00.03 ${'g'.repeat(64)}`, /sha256|digest/i],
    [`approve 00.03 ${'a'.repeat(64)} extra`, /argument|usage|unexpected/i],
    [`approve 00.003 ${'a'.repeat(64)}`, /id|NN\.MM/i],
    ['reject', /missing|required|usage/i],
    ['reject 00.03', /reason/i],
    ['reject 00.03 \t\n', /reason/i],
    ['reject ../00.03 reason', /id|NN\.MM/i],
  ] as const)('rejects the entire malformed input %j', async (raw, diagnosis) => {
    const f = await fixture()
    const output = text(await f.call(raw), 'error')
    expect(output).toMatch(diagnosis)
    usage(output)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('runtime refuses attachments before entering the handler and logs the refusal', async () => {
    const f = await fixture()
    const output = text(await f.call('show 00.03', f.agent, undefined,
      [{ type: 'file', receiptId: 'unowned-fixture-receipt' }]), 'error')
    expect(output).toBe('/dev-loop does not accept attachments')
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.agent.session.snapshotEvents().filter(event => event.type.startsWith('command/')))
      .toHaveLength(2)
  })

  it('shows the entire exact UTF-8 source, digest, metadata and logical status', async () => {
    const f = await fixture()
    await f.lifecycle.transition('00.03', 'todo', 'pending', 'fixture')
    f.transition.mockClear()
    const source = f.sources.get('00.03')!
    const output = text(await f.call('\tshow\t00.03 \r\n'), 'success')
    for (const value of [source, digest(source), 'pending', '00-command', f.paths.get('00.03')!, 'Review 00.03']) {
      expect(output).toContain(value)
    }
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('accepts uppercase digest for the same bytes and changes only memory, never enqueues work', async () => {
    const f = await fixture()
    const source = f.sources.get('00.03')!
    const path = f.paths.get('00.03')!
    const observed = await f.fs.stat(await f.fs.resolve(path))
    expect(observed).toBeDefined()
    const controller = new AbortController()
    const result = await f.call(`approve 00.03 ${digest(source).toUpperCase()}`, f.agent, controller.signal)
    expect(text(result, 'success')).toMatch(/00\.03.*pending|pending.*00\.03/s)
    expect(f.lifecycle.getStatus('00.03')).toBe('pending')
    expect(f.transition).toHaveBeenCalledTimes(1)
    expect(f.transition.mock.calls[0]?.slice(0, 3)).toEqual(['00.03', 'todo', 'pending'])
    expect(f.transition.mock.calls[0]?.[4]).toBe(controller.signal)
    expect(f.transition.mock.calls[0]?.at(5)).toEqual({
      kind: 'command', commandId: result!.commandId, sessionId: f.agent.session.id, decision: 'accept',
      source: { path, version: observed!.version, rawDigest: digest(source), contentDigest: digest(source) },
    })
    expect(f.transition.mock.calls[0]).toHaveLength(6)
    expect(await readFile(join(f.root, f.paths.get('00.03')!), 'utf8')).toBe(source)
    expect(f.queue.getQueuedEntries()).toEqual([])
    expect(f.queue.getActiveWorkers()).toEqual([])
  })

  it('reject consumes a multiword remainder literally and requests only pending-to-blocked', async () => {
    const f = await fixture({ seeds: [{ id: '00.03', status: 'pending' }] })
    const reason = 'Needs  two spaces\nand "quotes"; $(not-a-shell)'
    const controller = new AbortController()
    expect(text(await f.call(`reject\t00.03  ${reason}  \n`, f.agent, controller.signal), 'success')).toContain('blocked')
    expect(f.transition).toHaveBeenCalledExactlyOnceWith('00.03', 'pending', 'blocked', reason, controller.signal)
    expect(f.lifecycle.getStatus('00.03')).toBe('blocked')
    expect(await readFile(join(f.root, f.paths.get('00.03')!), 'utf8')).toBe(f.sources.get('00.03'))
  })

  it('refuses a digest from an earlier show after same-length source edits', async () => {
    const f = await fixture()
    const source = f.sources.get('00.03')!
    expect(text(await f.call('show 00.03'), 'success')).toContain(digest(source))
    await f.write('00.03', source.replace('Last reviewed', 'Past reviewed'))
    expect(text(await f.call(`approve 00.03 ${digest(source)}`), 'error')).toMatch(/stale|changed|digest|revision/i)
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.lifecycle.getStatus('00.03')).toBe('todo')
  })

  it.each(['show 00.99', `approve 00.99 ${'a'.repeat(64)}`, 'reject 00.99 missing'])('reports unknown piece for %s', async (raw) => {
    const f = await fixture()
    expect(text(await f.call(raw), 'error')).toMatch(/00\.99/)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['show', 'approve'] as const)('%s retains a malformed-source diagnosis without transition', async (verb) => {
    const f = await fixture()
    const malformed = f.sources.get('00.03')!.replace('**Harness primitive:** command', '**Harness primitive:** invented')
    await f.write('00.03', malformed)
    const output = text(await f.call(`${verb} 00.03${verb === 'approve' ? ` ${digest(malformed)}` : ''}`), 'error')
    expect(output).toMatch(/primitive|INVALID_HARNESS_PRIMITIVE/i)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['pending', 'blocked', 'done'] as const)('approve refuses initial %s instead of attempting a different edge', async (status) => {
    const f = await fixture({ seeds: [{ id: '00.03', status }] })
    expect(text(await f.call(`approve 00.03 ${digest(f.sources.get('00.03')!)}`), 'error')).toContain(status)
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.lifecycle.getStatus('00.03')).toBe(status)
  })

  it.each(['todo', 'blocked', 'done'] as const)('reject refuses initial %s rather than illegal todo-to-blocked', async (status) => {
    const f = await fixture({ seeds: [{ id: '00.03', status }] })
    expect(text(await f.call('reject 00.03 needs changes'), 'error')).toContain(status)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it.each(['child', 'lookalike', 'disposed'] as const)('rejects %s authority for both mutations', async (kind) => {
    const f = await fixture()
    let caller: Agent
    if (kind === 'child') {
      caller = (await f.ctx.agents.create({ sessionId: SessionId('command-child'),
        parentAgent: f.agent, meta: { cwd: f.root } })).agent
    } else if (kind === 'lookalike') {
      // Same typed Agent fields and root Session identity do not confer registry membership.
      caller = new Proxy(f.agent, {})
    } else {
      const handle = await f.ctx.agents.create({ sessionId: SessionId('command-disposed'), meta: { cwd: f.root } })
      caller = handle.agent
      await handle.dispose()
    }
    expect(f.ctx.agents.get(caller.id) === caller && f.ctx.agents.roots().includes(caller)).toBe(false)
    expect(text(await f.call(`approve 00.03 ${digest(f.sources.get('00.03')!)}`, caller), 'error')).toMatch(/root|live|human|authority/i)
    await f.lifecycle.transition('00.03', 'todo', 'pending', 'fixture')
    f.transition.mockClear()
    expect(text(await f.call('reject 00.03 reason', caller), 'error')).toMatch(/root|live|human|authority/i)
    expect(f.transition).not.toHaveBeenCalled()
    expect(f.lifecycle.getStatus('00.03')).toBe('pending')
  })

  it('reports compare-and-set refusal from the real Lifecycle writer', async () => {
    const f = await fixture()
    // The competing transition completes immediately before the command's sole writer request.
    f.transition.mockImplementationOnce(async (...args) => {
      await f.transitionMethod('00.03', 'todo', 'pending', 'competing owner')
      await f.transitionMethod(...args)
    })
    expect(text(await f.call(`approve 00.03 ${digest(f.sources.get('00.03')!)}`), 'error')).toMatch(/expected|stale|pending/i)
    expect(f.lifecycle.getStatus('00.03')).toBe('pending')
    expect(f.transition).toHaveBeenCalledTimes(1)
  })

  it.each(['show', 'approve'] as const)('%s refuses disappearance after lookup', async (verb) => {
    const f = await fixture()
    const original = f.directory.getPiece.bind(f.directory)
    const lookup = vi.spyOn(f.directory, 'getPiece').mockImplementationOnce(async (...args) => {
      const record = await original(...args)
      await rm(join(f.root, record.path))
      return record
    })
    f.restores.push(() => { lookup.mockRestore() })
    expect(text(await f.call(`${verb} 00.03${verb === 'approve' ? ` ${digest(f.sources.get('00.03')!)}` : ''}`), 'error'))
      .toMatch(/changed|stale|missing|found|exist|source/i)
    expect(f.transition).not.toHaveBeenCalled()
  })

  it('does not swallow runtime defects into an ordinary command result', async () => {
    const f = await fixture()
    const defect = new TypeError('fixture invariant defect')
    const spy = vi.spyOn(f.directory, 'listSets').mockRejectedValueOnce(defect)
    f.restores.push(() => { spy.mockRestore() })
    await expect(f.call('list')).rejects.toBe(defect)
    const events = f.agent.session.snapshotEvents().filter(event => event.type === 'command/done')
    expect(events.at(-1)?.data).toMatchObject({ kind: 'error', text: defect.message })
  })

  it('logs exact raw input and returned text paired by real command id without opening a model turn', async () => {
    const f = await fixture()
    const before = f.agent.session.snapshotEvents().length
    const execution = await f.call('\tqueue \n')
    expect(text(execution, 'success')).toBe('Queue: empty')
    const events = f.agent.session.snapshotEvents().slice(before)
    expect(events.map(event => event.type)).toEqual(['command/run', 'command/done'])
    expect(events[0]?.data).toEqual({ commandId: execution!.commandId, name: 'dev-loop', args: ' \tqueue \n', source: { kind: 'user' } })
    expect(events[1]?.data).toEqual({ commandId: execution!.commandId, kind: 'success', text: 'Queue: empty' })
  })
})
