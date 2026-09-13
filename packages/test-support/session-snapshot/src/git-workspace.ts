/** Deterministic private Git inputs and retained checkout oracles for development-loop snapshots. */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { captureWorkspaceSnapshot, type WorkspaceSnapshotEntry } from './workspace.ts'

/**
 * Initialize the scenario's already-seeded private repository with a reproducible base commit.
 * @param cwd - Private workspace owned and removed by the snapshot launcher.
 * @returns After all seed files and the runtime-ignore policy are committed.
 */
export async function prepareDevLoopSnapshotWorkspace(cwd: string): Promise<void> {
  await writeFile(join(cwd, '.gitignore'), '.agents/\n.dsh/\n.snapshot-patches/\n.worktrees/\n')
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(cwd, '.dsh', 'absent-git-config'),
    GIT_CONFIG_COUNT: undefined, GIT_CONFIG_PARAMETERS: undefined,
    GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined,
    GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
    GIT_AUTHOR_NAME: 'Roles snapshot', GIT_AUTHOR_EMAIL: 'roles@example.invalid',
    GIT_COMMITTER_NAME: 'Roles snapshot', GIT_COMMITTER_EMAIL: 'roles@example.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  }
  const git = async (...args: string[]) => {
    await promisify(execFile)('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgSign=false',
      '-c', `core.hooksPath=${join(cwd, '.dsh', 'absent-hooks')}`, ...args],
    { cwd, env, timeout: 20_000, maxBuffer: 128_000 })
  }
  await git('init', '--initial-branch=main', '-q')
  await git('add', '.')
  await git('commit', '-qm', 'Recorded development-loop input')
}

/**
 * Capture all retained checkout files, excluding only runtime roots and Git administration.
 * The root Git database and immediate retained worktrees' `.git` pointer files are not file-effect oracles.
 * @param cwd - Scenario workspace including any retained `.worktrees/<piece>` checkouts.
 * @returns Complete user-file state, including every retained checkout and unexpected write.
 */
export async function captureDevLoopSnapshotWorkspace(cwd: string): Promise<WorkspaceSnapshotEntry[]> {
  const entries = await captureWorkspaceSnapshot(cwd, {
    ignoredRootEntries: ['.agents', '.dsh', '.snapshot-patches', '.git'],
  })
  return entries.filter(entry => !/^\.worktrees\/[^/]+\/\.git$/.test(entry.path))
}
