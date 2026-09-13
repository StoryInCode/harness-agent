# 07 — Worktree Management & Workspace Isolation

## Features

- Per-task git worktree dynamic allocation under `.worktrees/<task-id>/`
- Immutable base commit pinning recorded at allocation time
- Branch naming derived deterministically from owning task identifiers
- Collision-safe allocation fallback when branches or paths are occupied
- Kernel-level filesystem sandbox fencing bounding worker agents to worktree roots
- Zero-cost child agent scoping through native session header and fs contracts
- Direct subprocess execution seam for all Git plumbing operations
- Multi-tier work preservation guard refusing deletion of dirty or unpushed trees (INV-07)
- Upstream patch-equivalence detection via disk-memoized git cherry analysis
- GitHub PR merged-state verification for rebased and squashed contributions
- Automated synchronization of gitignored environment assets via `.worktreeinclude`
- Automatic `.gitignore` maintenance ensuring worktrees are never committed
- Fail-soft background object pack maintenance preventing pack sprawl slowdowns
- Post-completion and post-merge pruning of provably clean worktrees
- Worktree inventory reporting for supervisor daemons and review pipelines

## 1. Purpose

`@deepseek-ai/dsh-worktree` and `@deepseek-ai/dsh-worktree-local` provide the authoritative workspace isolation and Git worktree management substrate for autonomous engineering tasks in StoryInCode.

- **What it owns**:
  - The `worktrees` capability seam (`WorktreeManager` abstract Service class in `@deepseek-ai/dsh-worktree` extending `@deepseek-ai/cordis.Service`).
  - The local filesystem and Git driver implementation (`LocalWorktreeManager` in `@deepseek-ai/dsh-worktree-local`).
  - Dynamic provisioning of isolated Git worktrees under `<repo_root>/.worktrees/<task_id>/` with dedicated branches (`kanban/<task_id>` or `wt/<task_id>`).
  - Immutable base commit resolution (`git rev-parse HEAD^{commit}`) and pinning at allocation time (`Spec §6.2`).
  - Strict filesystem isolation enforcement (`INV-06`): ensuring worker tasks execute exclusively within their allocated worktree without polluting the root repository.
  - Integration with Harness native session and sandbox contracts: scoping child agent `cwd` and `workspaceRoot` via `SessionHeader.cwd` and `SandboxedFileSystem` fencing rather than bespoke path-rewriting machinery.
  - Multi-tier work preservation guard (`INV-07`): refusing worktree deletion if uncommitted tracked changes, untracked evidence files, or unpushed/unmerged commits exist.
  - Sophisticated upstream merge detection: verifying commit reachability via remote-tracking refs, `git cherry` patch-equivalence analysis with on-disk memoization, and GitHub PR merge verification (`gh pr list`).
  - Concurrency and collision safety: detecting occupied paths or checked-out branches across concurrent worker subagents and resolving to isolated non-conflicting fallback paths.
  - Git repository hygiene: copying gitignored configuration files via `.worktreeinclude` with path traversal escape guards, ensuring `.worktrees/` is gitignored, and background object pack sprawl maintenance.
  - Administrative worktree locking (`git worktree lock --reason ...`) and live PID ownership verification.
  - Typed Cordis domain events emitted on the host bus (`worktree/allocated`, `worktree/cleaned`, `worktree/preserved`, `worktree/locked`, `worktree/unlocked`).

- **What it deliberately does NOT own**:
  - Kanban card state transitions, SQLite schema, or claim leases (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Model-facing Kanban interaction tools (owned by `@deepseek-ai/dsh-tool-kanban`, Plan 02).
  - Worker process spawning, cgroup isolation, or subagent loop scheduling (owned by `@deepseek-ai/dsh-subagent`, Plan 11).
  - Test runner execution, RED/GREEN gate verification, or test hash pinning (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Merging completed worktree branches onto `main`, squash-merging, or GitHub PR synchronization (owned by `@deepseek-ai/dsh-integrator`, Plan 10).
  - Host admission guards and memory quota limits (owned by `@deepseek-ai/dsh-guard-resource`, Plan 08).
  - Watchdog stall detection and heartbeat timeouts (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-worktree`: **Service Definition**. Declares the abstract `WorktreeManager` extending `Service`, merges `interface Context { worktrees: WorktreeManager }` into `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:44-47`), and exports branded types and lifecycle events.
- `@deepseek-ai/dsh-worktree-local`: **Service Provider**. Concrete implementation extending `WorktreeManager`. Mounted as a singleton service on the host plane container, injecting `['subprocess', 'fs']`.

### 2.2 Host Plane vs Agent Plane Separation
`@deepseek-ai/dsh-worktree-local` resides strictly on the **Host Plane** (`base.cordis.yml` patch layer).
- *Cross-Session Resource*: Git worktrees represent physical directory checkouts and Git ref registrations shared across the orchestrator (`hermes-brain`), autonomous worker subagents (`hermes-worker`), independent reviewers (`hermes-reviewer`), supervisor daemons, and integrator merge pipelines (`merge_card.py`).
- *PRESET-RULES Compliance*: Per **PRESET-RULE 6**, a row that *injects* host services (`subprocess`, `fs`) and coordinates resources across sessions resolves before any session exists; it must never be mounted in an agent-plane preset.
- *Deterministic Transactional Substrate*: Per Architecture Mapping §11.1 (`00-architecture-mapping.md:651`), worktree allocation, collision avoidance, and unpushed commit protection require deterministic transactional TypeScript code; proposing a model-facing "worktree skill" was explicitly rejected.

### 2.3 Process Execution Seam: Direct Subprocess vs Shell
All Git operations inside `@deepseek-ai/dsh-worktree-local` route strictly through `ctx.subprocess` (`SubprocessRuntime`, `packages/subprocess/subprocess/src/index.ts:86-154`) and **never** through `ctx.shell` (`ShellExecutor`):
1. *Argument Safety*: `ctx.subprocess.spawn` accepts discrete `argv: readonly string[]`. Git commands never pass through a shell interpreter (`/bin/bash`), eliminating shell-injection vulnerabilities, shell string quoting issues, and parameter expansion hazards.
2. *Zero Defaulting*: `ctx.subprocess` enforces zero defaulting (`packages/subprocess/subprocess/src/types.ts:70-74`). Every spawn explicitly specifies `cwd`, `argv`, bounded `stdio` modes, explicit timeout grace periods (`graceMs`), and abort signals (`signal`).
3. *Process Containment & Clean Signal Propagation*: When executed under Linux, `ctx.subprocess` allocates children inside user systemd transient scopes (`systemd-run --user --scope --unit=dsh-<id>`, `packages/subprocess/subprocess-local/src/linux-scope.ts:404-450`) or Windows Job Objects (`packages/subprocess/subprocess-local/src/windows-job.ts`). Aborting a Git operation terminates the entire process group cleanly without orphaned git-index locks (`.git/index.lock`).
4. *Sanitized Environment*: Git commands execute against `scrubbedParentEnv()` (`packages/subprocess/subprocess/src/index.ts:64-78`), ensuring harness secret keys (e.g. `DEEPSEEK_API_KEY`) are stripped Case-Insensitively while preserving proxy settings, `PATH`, `HOME`, and non-interactive Git flags (`GIT_TERMINAL_PROMPT=0`).

### 2.4 Child Agent Worktree Scoping: Native Harness Seams vs Custom Machinery
A critical architectural design in DeepSeek Harness is that child worker agents are scoped to worktrees **entirely through existing native contracts**, requiring zero bespoke virtual-fs interception:
1. *Lineage & Header Initialization*: When the dispatcher or parent agent creates a worker agent via `ctx.agents.create()` (`packages/core/agent/src/index.ts:62-119`), it passes:
   ```typescript
   await ctx.agents.create({
     sessionId,
     meta: {
       cwd: worktree.path,       // Absolute path to .worktrees/<task_id>
       origin: 'subagent',
       parentSession: parentId,
       delegationDepth: depth + 1,
     },
     setup: async (agentCtx) => { /* preset composition */ }
   })
   ```
2. *Authoritative Immutable Header*: In `dsh-session`, `meta.cwd` is validated and stored as `SessionHeader.cwd` (`packages/sandbox/sandbox-policy/README.md:76-80`). This value is immutable for the session's lifetime.
3. *Sandbox Fencing*: When the worker invokes file tools (`tool-fs`, `writeText`, `editText`), `SandboxedFileSystem.checkedTarget()` (`packages/fs/fs-sandbox/src/index.ts:122-144`) resolves the active policy via `ctx.sandboxPolicy.resolve()`. In `packages/sandbox/sandbox-policy/src/index.ts:167`, `workspaceRoot` resolves directly to `session?.header.cwd`. `checkedTarget()` enforces `isPathUnder(fresh.targetKey, workspaceRoot)`. Any write escaping the worktree directory throws `FsError('FS_SANDBOX_DENIED')`, mechanically enforcing `INV-06` at the lowest kernel boundary.
4. *Tool Working Directory*: Model-facing execution tools (`tool-bash`, `tool-fs-search`, `tool-lsp`) automatically read `exec.agent?.session.header.cwd` as their default execution directory (`packages/shell/tool-bash/src/index.ts:148`; `packages/fs/tool-fs-search/src/search-core.ts:231`).
5. *Prompt Environment Variable*: The system prompt automatically evaluates `ctx.systemPrompt.variable('cwd', ctx => ctx.agent?.session.header.cwd)` (`packages/core/agent-loop/src/index.ts:423`), informing the LLM of its exact isolated workspace path.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Worktree directory structure `.worktrees/<id>/` (§6.2) | Yes (`LocalWorktreeManager.allocate`) | None | Physical layout creation |
| Dedicated branch naming `kanban/<id>` (§6.2) | Yes (`LocalWorktreeManager.allocate`) | None | Branch allocation |
| Base commit pinning at creation (§6.2) | Yes (`baseCommit` in `WorktreeRecord`) | None | Recorded via `git rev-parse HEAD^{commit}` |
| Collision prevention & path fallback (§6.2) | Yes (`resolveCollisionFreePath`) | None | Avoids multi-agent checkout collision |
| Worktree Isolation invariant (`INV-06`) | Yes (`allocate`, `SandboxedFileSystem`) | `@deepseek-ai/dsh-fs-sandbox` (Core) | Sandbox fences all writes to worktree root |
| Work preservation on cleanup (`INV-07`) | Yes (`LocalWorktreeManager.prune`) | None | Multi-tier dirty and unpushed verification |
| Dirty working tree detection (§6.2) | Yes (`isWorktreeDirty`) | None | Checks staged, unstaged, untracked changes |
| Unpushed commits detection (§6.2) | Yes (`hasUnpushedCommits`) | None | `git log HEAD --not --remotes` |
| Squash-merge patch equivalence (§6.2) | Yes (`isPatchEquivalentUpstream`) | None | `git cherry` with disk-backed cache |
| Rebase-merge GitHub PR check (§6.2) | Yes (`isBranchPrMerged`) | None | Subprocess query `gh pr list --state merged` |
| Exact remote head pushed tier (§6.2) | Yes (`isBranchPushedExact`) | None | `git ls-remote --heads origin` |
| `.worktreeinclude` file copying (§6.2) | Yes (`copyWorktreeIncludes`) | None | Syncs gitignored `.env`/config with escape check |
| `.worktrees/` in `.gitignore` (§6.2) | Yes (`ensureWorktreesGitignored`) | None | Repo hygiene guard |
| Object pack maintenance (§6.2) | Yes (`maintainPackHealth`) | None | Background repack when pack files >= 15 |
| Post-merge pruning of clean trees (§6.2) | Yes (`prune`) | `@deepseek-ai/dsh-integrator` (Plan 10) | Pruned after successful `--no-ff` landing |
| Merge commit landing & PR sync (§6.9) | No | `@deepseek-ai/dsh-integrator` (Plan 10) | Git merge orchestration |
| Watchdog timers & orphan sweep (§5.10) | No | `@deepseek-ai/dsh-supervisor` (Plan 12) | Periodic daemon invoking `worktrees.prune()` |

## 4. Proposed Package / File Layout

```
packages/worktree/
├── worktree/                                 # @deepseek-ai/dsh-worktree (Service Definition)
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       ├── index.ts                          # Abstract WorktreeManager class & Context declaration
│       ├── brand.ts                          # Branded types: WorktreeId, CommitSha, BranchName
│       ├── types.ts                          # WorktreeRecord, AllocateOptions, PruneOptions, Status
│       ├── errors.ts                         # WorktreeError, WorktreeDirtyError, WorktreeCollisionError
│       └── events.ts                         # Typed Cordis domain events on Context
└── worktree-local/                           # @deepseek-ai/dsh-worktree-local (Service Provider)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts                          # LocalWorktreeManager implementation & apply() lifecycle
    │   ├── git.ts                            # Typed Git subprocess runner wrapping ctx.subprocess
    │   ├── allocate.ts                       # Directory allocation, branch creation, base commit resolution
    │   ├── collision.ts                      # Worktree list inspection and collision-safe path fallback
    │   ├── includes.ts                       # .worktreeinclude copy/symlink with isPathUnder escape guard
    │   ├── preservation.ts                   # INV-07 gates: dirty, unpushed, cherry-merge, PR merged
    │   ├── cache.ts                          # Disk-backed memoization for git cherry verdicts
    │   ├── maintenance.ts                    # Object pack sprawl detection & background git repack
    │   └── prune.ts                          # Safe worktree removal (unforced) & branch cleanup
    └── tests/
        ├── allocate.spec.ts                  # Worktree provisioning, branch naming, base commit recording
        ├── collision.spec.ts                 # Sibling collision fallback when branch/path is occupied
        ├── preservation.spec.ts              # INV-07 dirty/unpushed refusal, cherry equivalence, PR check
        ├── includes.spec.ts                  # .worktreeinclude copy, symlinks, and path traversal rejection
        ├── subagent-scoping.spec.ts          # Session header cwd and fs sandbox bounding verification
        └── lifecycle-prune.spec.ts           # Clean tree pruning, custom branch survival, failure rollback
```

## 5. Public Contracts

### 5.1 Branded Types & Domain Models (`@deepseek-ai/dsh-worktree`)

```typescript
// packages/worktree/worktree/src/brand.ts
export type WorktreeId = string & { readonly __brand: unique symbol }
export type CommitSha = string & { readonly __brand: unique symbol }
export type BranchName = string & { readonly __brand: unique symbol }

export function asWorktreeId(id: string): WorktreeId {
  if (!id || /[\/\\]/.test(id)) throw new TypeError(`Invalid WorktreeId: "${id}"`)
  return id as WorktreeId
}

export function asCommitSha(sha: string): CommitSha {
  if (!/^[0-9a-f]{40}$/i.test(sha.trim())) throw new TypeError(`Invalid CommitSha: "${sha}"`)
  return sha.trim().toLowerCase() as CommitSha
}

export function asBranchName(branch: string): BranchName {
  if (!branch || branch.startsWith('/') || branch.endsWith('/')) {
    throw new TypeError(`Invalid BranchName: "${branch}"`)
  }
  return branch as BranchName
}
```

```typescript
// packages/worktree/worktree/src/types.ts
import type { BranchName, CommitSha, WorktreeId } from './brand.ts'

export type WorktreeStatus = 'active' | 'clean' | 'dirty' | 'unpushed' | 'locked' | 'preserved'

export interface WorktreeRecord {
  /** Logical worktree identifier (typically task ID or task run ID). */
  readonly id: WorktreeId
  /** Absolute path on the host filesystem to the worktree checkout root. */
  readonly path: string
  /** Absolute path to the main repository root. */
  readonly repoRoot: string
  /** The dedicated Git branch checked out in this worktree. */
  readonly branch: BranchName
  /** Immutable 40-character base commit SHA pinned at allocation time. */
  readonly baseCommit: CommitSha
  /** Human-readable banner describing base provenance (e.g. "origin/main (fetched)"). */
  readonly baseLabel: string
  /** Timestamp in epoch milliseconds when the worktree was allocated. */
  readonly createdAt: number
  /** Process ID that allocated or currently holds the administrative lock. */
  readonly lockedByPid?: number | undefined
  /** Administrative lock reason string if currently locked. */
  readonly lockReason?: string | undefined
}

export interface WorktreeAllocateOptions {
  /** Unique task or card identifier owning this worktree. */
  readonly taskId: string
  /** Repository root path. If omitted, resolved from current working directory. */
  readonly repoRoot?: string | undefined
  /** Optional explicit branch name. Defaults to `kanban/<taskId>` or `wt/<taskId>`. */
  readonly branchName?: string | undefined
  /** Explicit base commit or ref. If omitted, resolves freshest remote upstream or HEAD. */
  readonly baseRef?: string | undefined
  /** Whether to sync/fetch remote tracking refs before branching. Defaults to true. */
  readonly syncBase?: boolean | undefined
  /** Timeout in milliseconds for git operations during allocation. Defaults to 120,000. */
  readonly timeoutMs?: number | undefined
  /** Cancellation signal for the allocation request. */
  readonly signal?: AbortSignal | undefined
}

export type WorktreePreserveReason =
  | 'dirty_working_tree'
  | 'unpushed_commits'
  | 'active_live_lock'
  | 'non_git_directory'
  | 'is_main_checkout'

export interface WorktreePruneOptions {
  /** Whether to force removal regardless of clean state (STRICTLY FORBIDDEN by default). */
  readonly force?: boolean | undefined
  /** Optional timeout for prune operations in milliseconds. Defaults to 30,000. */
  readonly timeoutMs?: number | undefined
  /** Cancellation signal. */
  readonly signal?: AbortSignal | undefined
}

export interface WorktreeClassification {
  readonly path: string
  readonly status: WorktreeStatus
  readonly isClean: boolean
  readonly isPushed: boolean
  readonly isMergedUpstream: boolean
  readonly lockState: 'live' | 'dead' | 'unlocked'
  readonly preserveReason?: WorktreePreserveReason | undefined
}

export interface WorktreeInventoryEntry {
  readonly record: WorktreeRecord
  readonly classification: WorktreeClassification
  readonly diskSizeBytes?: number | undefined
}
```

### 5.2 Service Definition & Cordis Events (`@deepseek-ai/dsh-worktree`)

```typescript
// packages/worktree/worktree/src/index.ts
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  WorktreeAllocateOptions,
  WorktreeClassification,
  WorktreeInventoryEntry,
  WorktreePruneOptions,
  WorktreeRecord,
} from './types.ts'

export abstract class WorktreeManager extends Service {
  constructor(ctx: Context) {
    super(ctx, 'worktrees')
  }

  /**
   * Allocate a fresh, isolated Git worktree for a task.
   * Resolves base commit, creates branch, materializes checkout, copies includes,
   * acquires administrative lock, and verifies collision freedom.
   */
  abstract allocate(options: WorktreeAllocateOptions): Promise<WorktreeRecord>

  /**
   * Classify an existing worktree's preservation state without mutating disk.
   * Evaluates INV-07 gates: working tree cleanliness, unpushed commits,
   * patch-equivalence via git cherry, and GitHub PR merge state.
   */
  abstract classify(worktreePath: string, signal?: AbortSignal): Promise<WorktreeClassification>

  /**
   * Safely prune a completed or archived task's worktree.
   * MUST abort and refuse deletion if worktree is dirty or holds unpushed work (INV-07).
   * Unlinks worktree, deletes auto-generated branch, and removes admin directory.
   */
  abstract prune(worktreePath: string, options?: WorktreePruneOptions): Promise<boolean>

  /**
   * Acquire an administrative lock on a worktree with the caller's PID and purpose.
   */
  abstract lock(worktreePath: string, reason: string): Promise<void>

  /**
   * Release an administrative lock on a worktree.
   */
  abstract unlock(worktreePath: string): Promise<void>

  /**
   * Query all managed worktrees under repository root with live classification.
   */
  abstract listWorktrees(repoRoot?: string, signal?: AbortSignal): Promise<readonly WorktreeInventoryEntry[]>

  /**
   * Resolve an existing worktree record by task ID or path.
   */
  abstract getWorktree(taskIdOrPath: string): Promise<WorktreeRecord | undefined>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktrees: WorktreeManager
  }

  interface Events {
    /** Emitted immediately after a new worktree is successfully allocated and pinned. */
    'worktree/allocated'(record: WorktreeRecord): void
    /** Emitted when a clean worktree is successfully pruned and unlinked. */
    'worktree/cleaned'(worktreePath: string, branchName: string): void
    /** Emitted when worktree deletion is aborted due to dirty or unpushed work (INV-07). */
    'worktree/preserved'(worktreePath: string, reason: string): void
    /** Emitted when a worktree is administratively locked. */
    'worktree/locked'(worktreePath: string, pid: number, reason: string): void
    /** Emitted when a worktree is administratively unlocked. */
    'worktree/unlocked'(worktreePath: string): void
  }
}
```

### 5.3 Configuration Schema (`@deepseek-ai/dsh-worktree-local`)

```typescript
// packages/worktree/worktree-local/src/index.ts
export interface LocalWorktreeConfig {
  /** Relative directory name under repo root for worktrees. Defaults to '.worktrees'. */
  worktreesDirName?: string | undefined
  /** Whether to sync base refs with origin remote before branching. Defaults to true. */
  syncBase?: boolean | undefined
  /** Maximum time in ms to wait for git worktree add. Defaults to 120,000 (120s). */
  allocationTimeoutMs?: number | undefined
  /** Maximum time in ms for git classification commands. Defaults to 15,000 (15s). */
  classificationTimeoutMs?: number | undefined
  /** Maximum age in hours for orphaned worktrees before soft sweep. Defaults to 72. */
  maxOrphanAgeHours?: number | undefined
  /** Threshold of .git/objects/pack files triggering background repack. Defaults to 15. */
  packSprawlThreshold?: number | undefined
  /** Path to persistent cherry-verdict cache. Defaults to '~/.hermes/cache/worktree_merge_verdicts.json'. */
  mergeCachePath?: string | undefined
}
```

## 6. Lifecycle and Scoping

### 6.1 Subservice Injection & Root Registration
`LocalWorktreeManager` declares explicit Cordis dependencies:
```typescript
export class LocalWorktreeManager extends WorktreeManager {
  static inject = ['subprocess', 'fs']
  // Optional dependency on kanban store to update tasks.workspace_path and base_commit
}
```
Upon registration in root container:
1. `apply()` initializes the memory/disk merge verdict cache (`cache.ts`).
2. Registers a process exit and container disposal hook: on shutdown, verifies that any held administrative locks are cleanly released without tearing down active or dirty worktrees.
3. Schedules periodic background pack maintenance (`maintainPackHealth`) with low process priority (`nice -n 19` on Linux).

### 6.2 Host Plane Scope vs Agent Visibility
- **Root Container Placement**: Registered on the root container in `base.cordis.patch.yml`.
- **Agent Preset Isolation**: Agents mounted in isolated presets do **not** receive direct administrative access to `WorktreeManager` methods (`allocate`, `prune`, `lock`).
- **Interaction Contract**:
  - The **Host Dispatcher** / **Supervisor** resolves `ctx.worktrees` on the Host Plane to allocate a worktree before worker session startup.
  - The worker session receives the worktree path strictly as its execution working directory (`CreateAgentOptions.meta.cwd`).
  - Worker file mutations are automatically fenced inside that worktree by `@deepseek-ai/dsh-fs-sandbox`.
  - Upon task completion, the **Integrator Engine** (Plan 10) or **Supervisor Daemon** (Plan 12) calls `ctx.worktrees.prune(path)` to tear down the worktree only after successful integration.

## 7. Agent Preset Integration

Worktree management is an infrastructure substrate service operating on the Host Plane. Agent presets (`agent.cordis.yml`) do not mount `@deepseek-ai/dsh-worktree-local` directly. Instead, the preset interacts with the worktree through standard Harness primitives:

```yaml
# presets/hermes-worker/agent.cordis.yml
# Worker preset mounts into an entry-local isolate realm per PRESET-RULES.md:8
$isolate: { name: true }

# Standard core tools automatically inherit session.header.cwd (the worktree path)
- $path: '@deepseek-ai/dsh-tool-fs'
- $path: '@deepseek-ai/dsh-tool-bash'
- $path: '@deepseek-ai/dsh-tool-fs-search'
- $path: '@deepseek-ai/dsh-tool-lsp'
```

When `presets/hermes-worker` runs:
1. `ctx.get('worktrees')` on the root context remains accessible only to host orchestrators.
2. The agent's `ctx.fs` delegates to `SandboxedFileSystem`, which evaluates `ctx.sandboxPolicy.resolve()`.
3. `resolveWorkspaceRoot` reads `session.header.cwd` (the allocated worktree path), confining `writeText` and `editText` to `.worktrees/<task_id>/`.
4. The worker agent cannot escape its worktree or touch other tasks' worktrees.

## 8. Execution Flow

The full end-to-end runtime lifecycle of a task worktree across Harness components:

```
[Host Dispatcher / Supervisor]
       │
       │ 1. allocate({ taskId: 'task-101', repoRoot: '/repo' })
       ▼
[LocalWorktreeManager]
       │
       │ 2. Check collisions via `git worktree list --porcelain`
       │    Resolve collision-safe path: `/repo/.worktrees/task-101`
       │    Resolve collision-safe branch: `kanban/task-101`
       │
       │ 3. Resolve & Pin Base Commit:
       │    Query upstream / remote tip: `git rev-parse HEAD^{commit}` -> "8f9a2b..."
       │
       │ 4. Execute `git worktree add -b kanban/task-101 /repo/.worktrees/task-101 8f9a2b...`
       │    via ctx.subprocess.spawn (with checkout.workers=8)
       │
       │ 5. Ensure `/repo/.gitignore` contains `.worktrees/`
       │ 6. Copy / symlink files from `/repo/.worktreeinclude` (with traversal guard)
       │ 7. Acquire git worktree lock: `git worktree lock --reason "hermes pid=1234"`
       │ 8. Update card in SQLite: workspace_path, branch_name, base_commit
       │ 9. Emit event: `ctx.emit('worktree/allocated', record)`
       │
       ▼
[Worker Agent Spawn]
       │
       │ 10. ctx.agents.create({ meta: { cwd: '/repo/.worktrees/task-101' } })
       │ 11. SessionHeader.cwd = '/repo/.worktrees/task-101'
       │ 12. SandboxedFileSystem fences all writes to `/repo/.worktrees/task-101` (INV-06)
       │ 13. Tool-bash runs commands in `/repo/.worktrees/task-101`
       │ 14. Worker implements changes, runs tests against pinned baseCommit
       │
       ▼
[Task Completion / Integration]
       │
       │ 15. Reviewer validates diff: `git diff 8f9a2b... HEAD`
       │ 16. Integrator merges branch onto `main` via `merge_card` (Plan 10)
       │
       ▼
[Teardown / Prune Phase]
       │
       │ 17. ctx.worktrees.prune('/repo/.worktrees/task-101')
       │
       ├──> Gate 1: Check dirty (`git status --porcelain`)
       │    └─> If dirty: ABORT prune -> Emit `worktree/preserved` (INV-07)
       │
       ├──> Gate 2: Check unpushed (`git log HEAD --not --remotes`)
       │    └─> If commits exist:
       │        ├──> Check git cherry patch equivalence with upstream
       │        ├──> Check GitHub PR merged status (`gh pr list`)
       │        └──> If unmerged: ABORT prune -> Emit `worktree/preserved` (INV-07)
       │
       ├──> Gate 3: Safety verification: path != repoRoot
       │
       └──> All clean & merged:
            ├──> Release admin lock: `git worktree unlock`
            ├──> Run `git worktree remove /repo/.worktrees/task-101` (NO --force!)
            ├──> Run `git branch -d kanban/task-101` (delete generated branch)
            ├──> Run `git worktree prune`
            └──> Emit `ctx.emit('worktree/cleaned', path, branch)`
```

## 9. Error, Cancellation, and Lifecycle Behavior

### 9.1 Atomic Allocation Rollback
Worktree creation is not natively atomic in Git. If `git worktree add` times out, fails disk allocation, or is aborted mid-checkout:
- `_cleanup_failed_worktree_add` executes immediately:
  1. `git worktree unlock <path>` (swallowing errors).
  2. `git worktree remove --force <path>` (swallowing errors).
  3. Deletes partial directory from disk via `fs.rm(path, { recursive: true, force: true })`.
  4. `git worktree prune` to purge orphaned Git admin records in `.git/worktrees/`.
  5. `git branch -D <branch>` to delete the half-initialized branch ref.
- Throws structured `WorktreeAllocationError` with exact Git stderr, preventing poisoned retries.

### 9.2 Invariant INV-07 Enforcement (Refusal to Delete)
The pruner strictly enforces `INV-07` through a 5-tier verification ladder:
1. **Never Remove Main**: If `worktreePath === repoRoot`, throws `WorktreeSafetyError('Refusing to delete repository root')`.
2. **Dirty Tree Guard**: Executes `git status --porcelain`. If any untracked, modified, or staged files exist, deletion is **immediately aborted**. Returns `false`, logs preservation notice, and emits `worktree/preserved`.
3. **Unpushed Commits Guard**: Executes `git log --oneline HEAD --not --remotes`. If local-only commits exist:
   - **Squash-Merge Escape**: Evaluates `git cherry <upstream> HEAD`. If all local commits are marked `-` (patch-equivalent), commits were merged into `main`. Result is cached in `merge_cache`.
   - **Rebase-Merge Escape**: If cherry fails due to rebase conflicts, runs `gh pr list --head <branch> --state merged`. If PR is merged on GitHub, commits are preserved upstream.
   - **Exact Pushed Head**: If branch matches origin head (`git ls-remote --heads origin`), commits are safe on remote.
   - If none of these prove upstream preservation, deletion is **aborted**. Returns `false` and emits `worktree/preserved`.
4. **TOCTOU Guard**: When deleting, `git worktree remove` is executed **without** `--force`. If a file was dirtied between the pre-check and removal, Git's native dirty guard rejects removal, preventing race conditions.
5. **Custom Branch Preservation**: Only auto-generated task branches (`kanban/<id>` or `wt/<id>`) are deleted upon worktree removal. User-specified or custom feature branches (`feature/*`) are preserved in Git ref storage.

### 9.3 Collision Disambiguation
If multiple workers allocate simultaneously or a stale directory exists:
1. `collision.ts` runs `git worktree list --porcelain`.
2. If path `.worktrees/<task_id>` is already registered or directory exists on disk:
   - Evaluates whether the worktree is active or locked.
   - Computes unique suffix: `.worktrees/<task_id>-<uuid4_hex_4>`.
3. If branch `kanban/<task_id>` exists in `git branch --list`:
   - If checked out elsewhere, falls back to `kanban/<task_id>-<uuid4_hex_4>`.
4. Guarantees parallel worker subagents never overwrite each other's workspaces.

### 9.4 Shallow Repository Recovery
Shallow clones (`git clone --depth=1`) corrupt commit reachability: an older worktree commit appears permanently unpushed because the merge base commit is missing from shallow history.
- When `hasUnpushedCommits` runs against a shallow repo (`git rev-parse --is-shallow-repository === 'true'`), the driver triggers `_deepen_shallow_repo` in the background:
- Executes `git fetch origin --unshallow --filter=blob:none` (or plain `--unshallow` if blobless filters are unsupported) before issuing a final reachability verdict.

## 10. Testing Strategy

All test suites are collocated under `packages/worktree/worktree-local/tests/*.spec.ts`:

```
packages/worktree/worktree-local/tests/
├── allocate.spec.ts                  # Worktree provisioning, branch naming, base commit recording
├── collision.spec.ts                 # Sibling collision fallback when branch/path is occupied
├── preservation.spec.ts              # INV-07 dirty/unpushed refusal, cherry equivalence, PR check
├── includes.spec.ts                  # .worktreeinclude copy, symlinks, and path traversal rejection
├── subagent-scoping.spec.ts          # Session header cwd and fs sandbox bounding verification
└── lifecycle-prune.spec.ts           # Clean tree pruning, custom branch survival, failure rollback
```

### 10.1 Unit & Contract Tests (`allocate.spec.ts`)
- Creates real bare Git repo and local clone in temp directory.
- Verifies `allocate()` provisions `.worktrees/<task_id>/`.
- Verifies branch `kanban/<task_id>` is created and checked out.
- Verifies `baseCommit` matches `git rev-parse HEAD^{commit}` byte-for-byte.
- Verifies `.gitignore` in repo root is updated with `.worktrees/`.
- Verifies administrative lock is applied with correct PID and reason.

### 10.2 Collision & Concurrency Tests (`collision.spec.ts`)
- Pre-creates `.worktrees/task-1` on branch `wt/task-1`.
- Calls `allocate()` for `task-1` again (simulating concurrent worker or sibling decompose task).
- Asserts manager does NOT overwrite existing worktree.
- Asserts manager falls back to `.worktrees/task-1-<suffix>` and branch `kanban/task-1-<suffix>`.
- Asserts original worktree and branch remain untouched.

### 10.3 Invariant INV-07 Preservation Tests (`preservation.spec.ts`)
- **Dirty Tree Test**: Adds untracked file `wip.txt` to worktree. Calls `prune()`. Asserts `prune()` returns `false`, directory remains on disk, and `worktree/preserved` event is emitted.
- **Unpushed Commits Test**: Commits file to worktree without pushing to remote. Calls `prune()`. Asserts removal is refused and directory preserved.
- **Squash-Merge Equivalence Test**: Commits change in worktree, squash-merges equivalent patch into `main` branch of remote, verifies `git cherry` marks commit as `-`. Calls `prune()`. Asserts worktree is successfully pruned.
- **Root Protection Test**: Attempts to call `prune(repoRoot)`. Asserts call throws `WorktreeSafetyError` and root directory is untouched.
- **TOCTOU Race Test**: Mocks dirty check to return clean, while file is written before git command. Asserts unforced `git worktree remove` rejects deletion.

### 10.4 Include Sync & Path Traversal Tests (`includes.spec.ts`)
- Writes `.worktreeinclude` containing `.env` and `config/dev.json`.
- Allocates worktree; asserts files are copied with identical contents.
- Adds malicious entry `../../etc/passwd` or `/etc/shadow` to `.worktreeinclude`.
- Asserts path containment guard (`isPathUnder`) rejects malicious entry and logs warning without escaping worktree.

### 10.5 Subagent Scoping & Sandbox Fencing Tests (`subagent-scoping.spec.ts`)
- Allocates worktree `/repo/.worktrees/task-200`.
- Spawns agent with `meta: { cwd: '/repo/.worktrees/task-200' }`.
- Asserts `agent.session.header.cwd === '/repo/.worktrees/task-200'`.
- Invokes `ctx.fs.writeText('/repo/.worktrees/task-200/src/index.ts', 'export const a = 1')` -> succeeds.
- Invokes `ctx.fs.writeText('/repo/src/index.ts', 'malicious root write')` -> throws `FsError` (`FS_SANDBOX_DENIED`).
- Verifies mechanical enforcement of `INV-06 (Worktree Isolation)`.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Directory allocation & base commit resolution | `/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_ops.py:127-213, 280-367`<br>`/home/sic/Downloads/hermes-agent-main/tools/subagent_worktree.py:75-98` | `_resolve_worktree_base` (branch freshness check, remote fetch, unborn branch fallback), base commit SHA pinning (`git rev-parse HEAD^{commit}`), `_worktree_add` invocation flags (`git worktree add -b <branch> <path> <base_ref>`), and initial `.gitignore` injection (`.worktrees/`). | Convert Python subprocess to `ctx.subprocess.spawn` with typed `argv`, enforce branded `WorktreeId` and `CommitSha`, eliminate module-level globals, and integrate with Cordis host context. | direct port |
| Sibling collision detection & path fallback | `/home/sic/Downloads/hermes-agent-main/hermes_cli/web_git.py:503-519, 565-568, 610-638` | Porcelain parsing `worktree_list` (`git worktree list --porcelain`), candidate slug sanitization (`_slugify`), collision-free unique path generation (`_unique_dir`), and fallback checkout handling when branch already exists. | Port Python regex and path logic to TypeScript `collision.ts`, wrap in `resolveCollisionFreePath()`, and emit Cordis diagnostic warning event on collision. | direct port |
| Inclusion synchronization & escape prevention (`.worktreeinclude`) | `/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_ops.py:70-76, 230-278` | `.worktreeinclude` parser reading line-delimited paths, symlink creation with copy fallback for directories/Windows, and strict path traversal validation (`_path_is_within_root`) preventing `..` escapes. | Translate to TypeScript using Node `node:fs/promises` and `node:path`, replace `_path_is_within_root` with Harness `isPathUnder()`, and log skipped paths. | direct port |
| Multi-tier work preservation guard (`INV-07`) | `/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_ops.py:369-394, 570-604`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1355-1425` | Verification ladder: `_worktree_is_dirty` (`git status --porcelain`), `_worktree_has_unpushed_commits` (`git log HEAD --not --remotes`), `_worktree_branch_pushed_exact` (`git ls-remote --heads`), untracked evidence preservation, and unforced worktree removal (`git worktree remove` without `--force`). | Combine Python CLI checks into TypeScript `preservation.ts`, emit `'worktree/preserved'` Cordis event when dirty/unpushed, and return structured refusal reasons. | port with adaptation |
| Upstream patch-equivalence & GitHub PR merge detection | `/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_ops.py:444-526, 534-568`<br>`/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_gc.py:258-278` | `git cherry` patch-equivalence evaluation (`_worktree_commits_all_merged_upstream`) catching squash-merges, disk-backed verdict memoization (`_load_worktree_merge_cache`, `_save_worktree_merge_cache`), and `gh pr list --state merged` verification (`_worktree_branch_pr_merged`) catching rebase-merges with rewritten SHAs. | Adapt disk cache to `~/.hermes/cache/worktree_merge_verdicts.json`, replace direct `subprocess.run` with `ctx.subprocess.spawn`, and handle `gh` CLI absence gracefully. | port with adaptation |
| Object pack sprawl maintenance | `/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_ops.py:99-125` | Pack health detection threshold (`_PACK_SPRAWL_THRESHOLD = 15`), directory glob of `.git/objects/pack/*.pack`, and background fail-soft `git repack -a -d --quiet` invocation with process nice priority on POSIX. | Port to TypeScript `maintenance.ts` running as unawaited background task via `ctx.subprocess.spawn`, bound to host configuration thresholds. | direct port |
| Administrative worktree lock management | `/home/sic/Downloads/hermes-agent-main/hermes_cli/worktree_ops.py:79-97, 606-644` | Administrative lock acquisition (`git worktree lock --reason`), stale lock detection (`_worktree_lock_is_live` checking `kill(pid, 0)` for dead processes), and unlock cleanup during failed allocations. | Port Python `os.kill` to Node `process.kill(pid, 0)` and wrap in `LocalWorktreeManager.lock()` / `unlock()`. | direct port |
| Child agent session sandbox scoping (`INV-06`) | no Hermes equivalent — new code | N/A (Hermes CLI uses global environment or child processes; Harness uses native `SessionHeader.cwd` and `SandboxedFileSystem.checkedTarget()` kernel fencing). | Implement `subagent-scoping.spec.ts` proving `SessionHeader.cwd = worktree.path` and `SandboxedFileSystem` vetoes writes outside the worktree with `FS_SANDBOX_DENIED`. | no Hermes equivalent (new code) |

The single most valuable capability to port is the 5-tier work preservation guard and disk-memoized `git cherry` patch-equivalence engine (`hermes_cli/worktree_ops.py:369-526, 534-568` and `supervise.py:1355-1425`). Autonomous agent loops routinely produce squashed, rebased, or partially synced commits; without Hermes's multi-tier verification (dirty status, unpushed commits, `git cherry` patch IDs, and `gh pr list`), pruning routines either catastrophically destroy uncommitted work or permanently leak abandoned worktree directories.

## 11. Implementation Steps

1. **Create Service Definition Package `@deepseek-ai/dsh-worktree`** (`packages/worktree/worktree/`):
   - Setup `package.json` with `@deepseek-ai/cordis` peer dependency.
   - Implement `brand.ts` exporting `WorktreeId`, `CommitSha`, `BranchName` branded types.
   - Implement `types.ts` with `WorktreeRecord`, `WorktreeStatus`, `WorktreeAllocateOptions`, `WorktreePruneOptions`, etc.
   - Implement `errors.ts` declaring `WorktreeError`, `WorktreeDirtyError`, `WorktreeCollisionError`, `WorktreeSafetyError`.
   - Implement `events.ts` declaring typed Cordis event map (`worktree/allocated`, `worktree/cleaned`, etc.).
   - Implement `index.ts` declaring abstract `WorktreeManager` class and `declare module '@deepseek-ai/cordis'` context merge.

2. **Create Service Provider Package `@deepseek-ai/dsh-worktree-local`** (`packages/worktree/worktree-local/`):
   - Setup `package.json` depending on `@deepseek-ai/dsh-worktree`, `@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-fs`.
   - Implement `git.ts`: typed Git subprocess runner invoking `ctx.subprocess.spawn` with `argv`, `scrubbedParentEnv()`, timeout, and UTF-8 stream decoding.
   - Implement `collision.ts`: parse `git worktree list --porcelain` to detect registered paths, checked-out branches, and compute non-colliding fallback names.
   - Implement `includes.ts`: parse `.worktreeinclude`, validate containment via `isPathUnder`, copy files, and create symlinks with Windows fallback.
   - Implement `cache.ts`: load and atomically persist `~/.hermes/cache/worktree_merge_verdicts.json` for `git cherry` results.
   - Implement `preservation.ts`: execute the 5-tier verification ladder (`isWorktreeDirty`, `hasUnpushedCommits`, `git cherry`, `gh pr list`, `git ls-remote`).
   - Implement `maintenance.ts`: count `.pack` files in `.git/objects/pack`; run background `git repack` when >= 15.
   - Implement `allocate.ts`: create directory, resolve freshest base ref, execute `git worktree add`, copy includes, acquire lock, ensure gitignore.
   - Implement `prune.ts`: verify cleanliness/push state, release lock, execute `git worktree remove` without `--force`, delete task branch.
   - Implement `index.ts`: subclass `WorktreeManager`, implement Cordis `apply()` lifecycle, register host event listeners.

3. **Verify Host Plane Composition**:
   - Register `@deepseek-ai/dsh-worktree-local` in `packages/bundle/base/cordis.patch.yml`.
   - Ensure `ctx.worktrees` is bound and initialized before task dispatcher starts.

4. **Run Full Test Suite**:
   - Execute all specs in `packages/worktree/worktree-local/tests/`.
   - Assert 100% statement and branch coverage across allocation, collision, preservation, and scoping.

## 12. Acceptance Criteria

- [ ] `WorktreeManager` extends `@deepseek-ai/cordis.Service` and registers under `ctx.worktrees` on the Host Plane.
- [ ] `allocate()` creates an isolated worktree under `.worktrees/<task-id>/` on branch `kanban/<task-id>`.
- [ ] Immutable base commit SHA (`git rev-parse HEAD^{commit}`) is pinned at allocation and recorded in `WorktreeRecord`.
- [ ] All Git plumbing commands execute via `ctx.subprocess.spawn` with discrete `argv` and `scrubbedParentEnv()`.
- [ ] Invariant `INV-06` is enforced: child worker sessions set `header.cwd = worktree.path`, and `SandboxedFileSystem` rejects any write outside the worktree with `FS_SANDBOX_DENIED`.
- [ ] Invariant `INV-07` is enforced: `prune()` refuses to delete any worktree containing uncommitted changes or unpushed commits, emitting `worktree/preserved`.
- [ ] Squash-merged and cherry-picked branches with patch-equivalence in upstream are recognized via `git cherry` and disk verdict cache.
- [ ] Rebase-merged PRs with altered commit SHAs are recognized via `gh pr list --state merged`.
- [ ] Collision detection resolves occupied paths or checked-out branches to isolated fallback paths without cross-task corruption.
- [ ] Administrative locks are recorded via `git worktree lock` and dead locks from crashed PIDs are cleanly detected.
- [ ] `.worktreeinclude` files are synchronized into the worktree while directory traversal attacks (`../`) are strictly blocked.
- [ ] `.worktrees/` is automatically appended to `.gitignore` when missing.
- [ ] Pruning clean worktrees deletes the worktree and auto-generated task branch while preserving custom user branches.
- [ ] Main repository root is protected: any attempt to prune `repoRoot` throws `WorktreeSafetyError`.

## Review fixes applied

- Added `## Port sources` section detailing source mappings from Hermes repositories (`hermes_cli/worktree_ops.py`, `worktree_gc.py`, `tools/subagent_worktree.py`, `hermes_cli/web_git.py`, and orchestrator `supervise.py`) to accelerate worktree management implementation.
