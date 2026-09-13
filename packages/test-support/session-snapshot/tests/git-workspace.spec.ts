/** Real Git preparation and retained-file oracle, isolated across independent private roots. */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { captureDevLoopSnapshotWorkspace, prepareDevLoopSnapshotWorkspace } from '../src/git-workspace.ts'

it('pins equal Git inputs and captures retained worktree files without Git administration', async () => {
  const roots = await Promise.all([1, 2].map(() => mkdtemp(join(tmpdir(), 'dsh-roles-oracle-'))))
  try {
    const commits = await Promise.all(roots.map(async (root) => {
      await writeFile(join(root, 'tracked.txt'), 'retained input\n')
      await prepareDevLoopSnapshotWorkspace(root)
      const { stdout } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: root })
      return stdout.trim()
    }))
    expect(commits[0]).toMatch(/^[a-f0-9]{40}$/)
    expect(commits[1]).toBe(commits[0])
    const root = roots[0]!
    await mkdir(join(root, '.worktrees'), { recursive: true })
    await promisify(execFile)('git', ['worktree', 'add', '--detach', '.worktrees/00.06', commits[0]!], { cwd: root })
    expect(await readFile(join(root, '.worktrees/00.06/tracked.txt'), 'utf8')).toBe('retained input\n')
    const before = await captureDevLoopSnapshotWorkspace(root)
    expect(before.map(entry => entry.path)).toEqual([
      '.gitignore', '.worktrees/00.06/.gitignore', '.worktrees/00.06/tracked.txt', 'tracked.txt',
    ])
    await writeFile(join(root, '.worktrees/00.06/forbidden.txt'), 'unexpected mutation\n')
    const after = await captureDevLoopSnapshotWorkspace(root)
    expect(after).not.toEqual(before)
    expect(after).toContainEqual({ path: '.worktrees/00.06/forbidden.txt', kind: 'text', content: 'unexpected mutation\n' })
  } finally {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
  }
})
