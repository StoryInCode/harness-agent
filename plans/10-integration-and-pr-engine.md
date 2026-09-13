# 10 — Worktree Integration Engine & GitHub PR Synchronization

## Features

- Automated worktree branch integration pipeline for completed kanban cards
- Pre-merge GitHub draft PR creation and check synchronization
- Target baseline test execution recording pre-existing failures before merge
- Differential test failure attribution distinguishing new breaks from baseline flaws
- Non-fast-forward merge commit creation preserving atomic integration history
- Workspace dependency relinking via frozen lockfile installation
- Atomic rollback via non-destructive git reset keeping target repository intact
- Failure remediation workflow automatically posting reproduction steps and blocking cards
- Clean worktree pruning trigger following verified merge landing
- Typed Cordis domain event publication for merge lifecycle and PR synchronization
- Direct subprocess execution seam for all Git, GitHub CLI, and test runner invocations

## 1. Purpose

`@deepseek-ai/dsh-integrator` provides the authoritative, host-plane worktree integration and GitHub pull request synchronization engine for autonomous engineering tasks in StoryInCode (`Spec §6.9`).

- **What it owns**:
  - The `integrator` capability seam (`IntegratorService` class in `@deepseek-ai/dsh-integrator` extending `@deepseek-ai/cordis.Service`).
  - Automated execution of the card integration pipeline (`merge_card`), transitioning cards from `review`/`done` into verified merge commits on target branches (e.g. `main`).
  - Git precondition verification: confirming task completion state, worktree cleanliness, target repository cleanliness (excluding `.worktrees/*` gitlinks), and merge base reachability.
  - Branch manifest and test check discovery: reading package manifests (`package.json`, `pyproject.toml`), orphan test specs (`.test.ts`), standalone shell suites (`test_*.sh`), governance document consistency (`truth_check.py`, board parsing), and tooling syntax (`node --check`) directly from the branch refs before merging. Refusing uncheckable branches.
  - Pre-merge GitHub draft PR lifecycle (`gh pr create --draft`): publishing work-in-progress to GitHub before merge checks run so reviewers observe in-flight progress and failure traces attach directly to the diff.
  - Target baseline test execution: running planned test suites against the target branch before merging, recording exit codes to prevent penalizing cards for pre-existing repository defects.
  - Non-fast-forward local merge execution (`git merge --no-ff`): creating distinct, revertable merge commits with complete card provenance metadata.
  - Workspace dependency relinking (`pnpm install --frozen-lockfile`): ensuring newly merged package workspace members and updated lockfiles are linked before running post-merge checks.
  - Differential post-merge re-verification: executing typechecks and tests across all affected packages, attributing failures strictly when a test passed on the target before the merge and failed after it.
  - Atomic failure rollback: reverting cleanly via `git reset --keep <pre_merge_commit>` or `git merge --abort` without destroying uncommitted local modifications, posting failure traces and reproduction steps to the PR and card comments, and blocking the card in Kanban for remediation.
  - Success publication: pushing verified merge commits to the remote target branch, promoting draft PRs to ready/merged, updating card comments, and triggering clean worktree pruning via `ctx.worktrees.prune()`.
  - Emitting typed Cordis domain events (`integrator/started`, `integrator/pr-synced`, `integrator/baseline-recorded`, `integrator/merged`, `integrator/reverted`, `integrator/failed`).

- **What it deliberately does NOT own**:
  - Worktree directory allocation, base commit pinning, or git cherry patch-equivalence (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Test suite execution inside worker turns, implementer test pinning guards, or turn stop gates (owned by `@deepseek-ai/dsh-verification`, Plan 09).
  - Kanban card state machine schema, DAG dependency resolution, or worker claim leasing (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Model-facing tool registration: LLMs do NOT call `merge_card` or `ctx.integrator` as a tool (privileged host infrastructure).
  - Watchdog stall timers, worker heartbeat monitoring, or autonomous merge scheduling (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).
  - Host RAM headroom admission or cgroup accounting (owned by `@deepseek-ai/dsh-guard-resource`, Plan 08).
  - Axiom satisfaction proof checks (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-integrator`: **Service Definition & Service Provider**.
  - Subclasses `Service` from `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:7-8`), registering `ctx.integrator` as a singleton on the host plane container.
  - Default export of the `IntegratorService` class per the Harness service convention (`packages/AGENTS.md:5`).
  - Injects host infrastructure: `['subprocess', 'worktrees', 'kanban', 'verification']`.

### 2.2 Why this Primitive and not the Neighbours
- **Why NOT a model-facing Tool (`ctx.tools.register`)**:
  Merging branches into `main`, pushing to remote Git origins, and promoting pull requests are privileged host operations. Exposing integration as a model-visible tool invites hallucinated premature merges, race conditions between concurrent worker agents, and model circumvention of review gates. Per Architecture Mapping §11.1 (`plans/00-architecture-mapping.md:482`), the integrator is an automated, host-plane engine driven by the supervisor daemon (`ctx.supervisor`, Plan 12) or administrative operator CLI, not an LLM agent tool.
- **Why NOT an Agent Preset plugin**:
  Per **PRESET-RULES.md** Rules 1, 2, and 6 (`PRESET-RULES.md:5, 6, 12`), agent presets are agent-plane compositions scoped to individual agent sessions. A service that mutates the primary repository's `main` branch, pushes to GitHub remotes, and injects host-level singletons resolves before any session exists and spans across all worker tasks; mounting it inside an agent preset would violate host/agent plane separation.
- **Why NOT an external Python script alone (`merge_card.py`)**:
  While the legacy prototype lived at `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py`, migrating it into `@deepseek-ai/dsh-integrator` as a first-class Cordis service integrates it directly with Harness typed events (`ctx.emit`), transactional kanban state (`ctx.kanban`), worktree lifecycle (`ctx.worktrees`), and verification evidence tracking (`ctx.verification`), while remaining invokable via administrative CLI (`dsh --profile headless`).
- **Why NOT a Workflow Capability (`packages/workflow/workflow`)**:
  Harness workflows execute long-running generator/worker-thread subtasks for models. The integrator is a deterministic, atomic state machine executing infrastructure mutations; wrapping it in a workflow adds thread marshalling overhead with zero benefit.

### 2.3 Process Execution Seam: Direct Subprocess vs Shell
All Git operations (`git push`, `git merge`, `git reset`, `git diff`), GitHub CLI operations (`gh pr create`, `gh auth status`), and verification runners execute strictly through `ctx.subprocess` (`packages/subprocess/subprocess/src/index.ts:86-154`) and **never** through `ctx.shell`:
1. *Discrete Argv Safety*: `ctx.subprocess.spawn` accepts discrete `argv: readonly string[]` (`packages/subprocess/subprocess/src/types.ts:75-81`). Commands never pass through a shell interpreter (`/bin/bash`), eliminating shell-injection vulnerabilities, shell string escaping hazards, and parameter expansion exploits.
2. *Zero Defaulting*: `ctx.subprocess` enforces zero defaulting (`packages/subprocess/subprocess/src/types.ts:70-74`). Every spawn explicitly specifies `cwd`, `argv`, bounded `stdio` modes, explicit timeout grace periods (`graceMs`), and abort signals (`signal`).
3. *Sanitized Environment*: Git commands execute against `scrubbedParentEnv()` (`packages/subprocess/subprocess/src/index.ts:64-78`), ensuring harness secret keys (e.g. `DEEPSEEK_API_KEY`) are stripped case-insensitively while preserving proxy settings, `PATH`, `HOME`, and non-interactive Git flags (`GIT_TERMINAL_PROMPT=0`).
4. *Process Containment & Clean Signal Propagation*: When executed under Linux, `ctx.subprocess` allocates children inside user systemd transient scopes (`systemd-run --user --scope`, `packages/subprocess/subprocess-local/src/linux-scope.ts:404-450`). Aborting an integration terminates the entire process tree cleanly without orphaned git-index locks (`.git/index.lock`).

### 2.4 Consumption of Sibling Services
Rather than reimplementing git worktree inspection, kanban storage, or verification tracking, `@deepseek-ai/dsh-integrator` strictly consumes sibling host services:
- `ctx.worktrees` (`WorktreeManager`, Plan 07): calls `classify(worktreePath)` to verify working tree cleanliness before merge, and `prune(worktreePath)` to reclaim disk after successful integration (`plans/07-worktree-management.md:277-285`).
- `ctx.kanban` (`KanbanStore`, Plan 01): calls `getTask(taskId)` for card metadata, `transitionTask(taskId, 'blocked')` on failure, `completeTask(taskId, evidence)` on success, and `addComment(taskId, author, body)` for audit logs (`plans/01-kanban-substrate.md:260-292`).
- `ctx.verification` (`VerificationStore`, Plan 09): logs baseline and post-merge check results into the immutable evidence ledger via `recordEvent()`, ensuring verified integration evidence is persisted across runs (`plans/09-verified-pipeline-and-gates.md:338-340`).

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Worktree integration pipeline (`merge_card`) (§6.9) | Yes (`integrateCard`) | None | Complete end-to-end integration orchestration |
| Pre-merge GitHub draft PR creation (§6.9) | Yes (`createDraftPr`) | None | Opens reviewable PR before checks run (`merge_card.py:540-548`) |
| Target baseline test check (§6.9) | Yes (`recordBaseline`) | None | Discovers packages and runs tests against target branch (`merge_card.py:559-584`) |
| Differential test attribution (§6.9) | Yes (`evaluateAttribution`) | None | Attributes failure only if passed before and failed after (`merge_card.py:640-657`) |
| Local non-fast-forward merge commit (§6.9) | Yes (`mergeBranch`) | None | Executes `git merge --no-ff` (`merge_card.py:612`) |
| Workspace dependency relinking (§6.9) | Yes (`relinkDependencies`) | None | Runs `pnpm install --frozen-lockfile` (`merge_card.py:626`) |
| Atomic failure rollback (§6.9) | Yes (`rollbackMerge`) | None | Executes `git reset --keep <pre_commit>` (`merge_card.py:595-610`) |
| Failure remediation workflow (§6.9) | Yes (`remediateFailure`) | `@deepseek-ai/dsh-kanban` (Plan 01) | Posts reproduction checklist and blocks card (`merge_card.py:704-724`) |
| Success publication & PR merge (§6.9) | Yes (`publishSuccess`) | `@deepseek-ai/dsh-worktree` (Plan 07) | Pushes target, promotes PR, and triggers `worktrees.prune()` (`merge_card.py:674-701`) |
| Worktree allocation & base pinning (§6.2) | No | `@deepseek-ai/dsh-worktree` (Plan 07) | Resource owner allocating worktrees under `.worktrees/<id>/` |
| Test suite execution inside worker turns (§6.7) | No | `@deepseek-ai/dsh-verification` (Plan 09) | Turn lifecycle gates and cryptographic test pinning |
| Automated integration dispatch (§5.10) | No | `@deepseek-ai/dsh-supervisor` (Plan 12) | Supervisor watchdog daemon triggering integration on card completion |

## 4. Proposed Package / File Layout

```
packages/integration/
└── integrator/                               # @deepseek-ai/dsh-integrator (Service Definition & Provider)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── index.ts                          # IntegratorService class, Context augmentation & Cordis apply()
        ├── types.ts                          # Domain types: IntegrationOptions, IntegrationResult, BaselineRecord, PackageCheck
        ├── errors.ts                         # IntegratorError, DirtyCheckoutError, BaselineFailureError, MergeConflictError
        ├── events.ts                         # Typed Cordis domain events on Context
        ├── discovery.ts                      # Changed paths diffing, manifest discovery, affected package mapping, test check resolution
        ├── baseline.ts                       # Target branch baseline test execution & pre-existing failure recording
        ├── github.ts                         # gh binary resolution, auth validation, draft PR creation, PR commenting & promotion
        ├── merge.ts                          # git merge --no-ff execution, pre-merge commit pinning, atomic git reset --keep rollback
        ├── verify.ts                         # Dependency relinking (pnpm install --frozen-lockfile), post-merge check runner & attribution
        └── remediation.ts                   # Structured remediation comment builder & kanban card blocking
    └── tests/
        ├── memory-double.ts                  # In-memory test doubles for Subprocess, Worktree, Kanban, and Verification services
        ├── discovery.spec.ts                 # Manifest detection from branch (pnpm, pyproject, orphan test.ts, shell, docs, tools)
        ├── baseline.spec.ts                  # Baseline execution on target branch, absent package detection, pre-existing failure attribution
        ├── merge-rollback.spec.ts            # Local merge --no-ff, conflict abort, and atomic git reset --keep on post-merge failure
        ├── github-pr.spec.ts                 # Draft PR creation before checks, failure commenting, success promotion and push
        ├── attribution.spec.ts               # Differential failure classification: new break vs pre-existing failure vs missing modules
        └── hmr-disposal.spec.ts              # Service lifecycle, in-flight integration abort on context dispose, event cleanup
```

## 5. Public Contracts

### 5.1 Branded Types and Domain Interfaces (`packages/integration/integrator/src/types.ts`)

```typescript
import type { TaskId } from '@deepseek-ai/dsh-kanban'
import type { CommitSha, BranchName } from '@deepseek-ai/dsh-worktree'

export type CheckType =
  | 'pnpm_package'
  | 'python_package'
  | 'vitest_orphan'
  | 'shell_suite'
  | 'governance_document'
  | 'tool_syntax'

export interface PackageCheck {
  readonly type: CheckType
  readonly packageName?: string | undefined
  readonly command: readonly string[]
  readonly cwd: string
  readonly description: string
}

export interface BaselineEntry {
  readonly checkKey: string
  readonly check: PackageCheck
  readonly exitCode: number | null // null = not on target yet, no baseline
  readonly output: string
  readonly alreadyFailing: boolean
}

export type FailureClassification =
  | 'new_failure'      // Passed before merge, failed after merge (card defect)
  | 'pre_existing'    // Already failed on target before merge (carried through)
  | 'environment_gap' // Absent on target, failed due to missing host dependencies

export interface CheckFailure {
  readonly check: PackageCheck
  readonly exitCode: number
  readonly output: string
  readonly classification: FailureClassification
}

export interface IntegrationOptions {
  readonly taskId: TaskId
  readonly targetBranch?: string | undefined // Defaults to current repo branch or 'main'
  readonly allowUnfinished?: boolean | undefined // For review flows; defaults to false
  readonly pr?: boolean | undefined // Publish draft PR to GitHub; defaults to true
  readonly remote?: string | undefined // Git remote; defaults to 'origin'
  readonly dryRun?: boolean | undefined // Report planned checks without mutating Git
  readonly timeoutMs?: number | undefined // Pipeline timeout; defaults to 1,800,000 (30m)
  readonly signal?: AbortSignal | undefined // Pipeline cancellation signal
}

export type IntegrationStatus =
  | 'merged'
  | 'reverted'
  | 'conflict'
  | 'refused'
  | 'dry_run'

export interface IntegrationResult {
  readonly status: IntegrationStatus
  readonly taskId: TaskId
  readonly targetBranch: string
  readonly sourceBranch: BranchName
  readonly mergeCommitSha?: CommitSha | undefined
  readonly preMergeCommitSha: CommitSha
  readonly prUrl?: string | undefined
  readonly checksRun: readonly PackageCheck[]
  readonly newFailures: readonly CheckFailure[]
  readonly carriedFailures: readonly BaselineEntry[]
  readonly failureReason?: string | undefined
  readonly remediationCommentPosted?: boolean | undefined
}

export interface IntegrationPlan {
  readonly taskId: TaskId
  readonly sourceBranch: BranchName
  readonly targetBranch: string
  readonly baseCommit: CommitSha
  readonly changedPaths: readonly string[]
  readonly affectedPackages: readonly string[]
  readonly plannedChecks: readonly PackageCheck[]
  readonly willOpenPr: boolean
}
```

### 5.2 Service Definition & Cordis Context (`packages/integration/integrator/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { TaskId } from '@deepseek-ai/dsh-kanban'
import type {
  IntegrationOptions,
  IntegrationResult,
  IntegrationPlan,
} from './types.ts'

export interface IntegratorConfig {
  defaultTargetBranch?: string
  defaultRemote?: string
  enablePr?: boolean
  ghPath?: string
  gitTimeoutMs?: number
  checkTimeoutMs?: number
  relinkDependencies?: boolean
  autoPruneCleanWorktree?: boolean
}

export const IntegratorConfig: z<IntegratorConfig> = z.object({
  defaultTargetBranch: z.string().default('main'),
  defaultRemote: z.string().default('origin'),
  enablePr: z.boolean().default(true),
  ghPath: z.string().optional(),
  gitTimeoutMs: z.number().default(120_000),
  checkTimeoutMs: z.number().default(1_800_000),
  relinkDependencies: z.boolean().default(true),
  autoPruneCleanWorktree: z.boolean().default(true),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    integrator: IntegratorService
  }
}

export abstract class IntegratorService extends Service {
  static readonly inject = ['subprocess', 'worktrees', 'kanban', 'verification']
  static readonly Config = IntegratorConfig

  constructor(ctx: Context, config: IntegratorConfig) {
    super(ctx, 'integrator', true)
  }

  /**
   * Execute the full integration pipeline for a completed kanban card:
   * pre-flight checks, draft PR, target baseline, local merge, relinking,
   * post-merge re-verification, atomic rollback on failure, or push on green.
   */
  abstract integrateCard(options: IntegrationOptions): Promise<IntegrationResult>

  /**
   * Compute planned diffs, affected packages, and checks without executing mutations.
   */
  abstract planIntegration(taskId: TaskId, targetBranch?: string): Promise<IntegrationPlan>

  /**
   * Verify if the GitHub CLI is available and authenticated for PR operations.
   */
  abstract checkPrReady(): Promise<{ ready: boolean; path?: string; reason?: string }>
}

export default IntegratorService
```

### 5.3 Typed Cordis Domain Events (`packages/integration/integrator/src/events.ts`)

```typescript
import type { TaskId } from '@deepseek-ai/dsh-kanban'
import type { CommitSha } from '@deepseek-ai/dsh-worktree'
import type { BaselineEntry, CheckFailure, PackageCheck } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'integrator/started': (taskId: TaskId, branch: string, target: string) => void
    'integrator/pr-synced': (taskId: TaskId, prUrl: string, state: 'draft' | 'ready' | 'failed') => void
    'integrator/baseline-recorded': (taskId: TaskId, baseline: readonly BaselineEntry[]) => void
    'integrator/merged': (taskId: TaskId, mergeCommit: CommitSha, prUrl?: string) => void
    'integrator/reverted': (taskId: TaskId, reason: string, failures: readonly CheckFailure[]) => void
    'integrator/failed': (taskId: TaskId, error: string, phase: string) => void
  }
}
```

## 6. Lifecycle and Scoping

### 6.1 Subservice Injection & Root Registration
`@deepseek-ai/dsh-integrator` declares `static inject = ['subprocess', 'worktrees', 'kanban', 'verification']`. When loaded into the root Cordis container (`base.cordis.yml` patch layer), the loader guarantees that:
1. `ctx.subprocess` (`SubprocessRuntime`, `packages/subprocess/subprocess/src/index.ts:115`) is active and ready to spawn child processes.
2. `ctx.worktrees` (`WorktreeManager`, `plans/07-worktree-management.md:264`) is active for worktree status classification and safe pruning.
3. `ctx.kanban` (`KanbanStore`, `plans/01-kanban-substrate.md:254`) is active for task lookup, status transitions, and audit comments.
4. `ctx.verification` (`VerificationStore`, `plans/09-verified-pipeline-and-gates.md:333`) is active for immutable verification evidence persistence.

### 6.2 Service Disposal and In-Flight Cancellation
In accordance with Harness lifecycle rules (`packages/AGENTS.md:17`, `docs/cordis-primer.md:45`):
- The service registers a cancellation effect using `ctx.effect()`.
- Active integration operations track their abort controllers in an in-memory set.
- When the context unloads or Cordis performs HMR, all active abort signals are triggered immediately.
- If an integration was mid-merge when disposal occurred, the disposal hook ensures the Git repository is left clean: if a merge is in progress, it triggers `git merge --abort`; if an unverified merge commit was placed on `HEAD`, it triggers `git reset --keep <pre_merge_commit>`.
- The repository is never left in a dirty, locked, or detached HEAD state during service unload.

### 6.3 Host Plane Scope vs Agent Visibility
- **Global Host Singleton**: Mounted in the root Cordis container. There is exactly one `ctx.integrator` instance per daemon process.
- **Model Isolation**: The service registers NO model tools (`ctx.tools.register` is not called). LLM agent presets cannot see or invoke integration methods.
- **Supervisor Driver**: The service is invoked programmatically by `@deepseek-ai/dsh-supervisor` (Plan 12) during automated sweep cycles or by human operators via administrative CLI.

## 7. Agent Preset Integration

### 7.1 Compliance with Preset Rules
Per **PRESET-RULES.md** (`PRESET-RULES.md:5-19`):
1. **Rule 1 & 2**: Agent presets (`presets/hermes-brain/agent.cordis.yml`, `presets/hermes-worker/agent.cordis.yml`) are agent-plane compositions scoped to individual agent sessions. The host composition owns infrastructure, sandboxes, and persistence.
2. **Rule 6**: A row that *injects* host infrastructure services (`subprocess`, `worktrees`, `kanban`, `verification`) resolves before any session exists; it must reside on the **Host Plane**.
3. **No Preset Entries**: Presets carry **ZERO** rows for `@deepseek-ai/dsh-integrator`. Worker and brain agents never mount the integrator.

### 7.2 Host Plane Composition (`cordis.patch.yml`)
`@deepseek-ai/dsh-integrator` is mounted strictly on the host plane via the host bundle patch layer:

```yaml
# packages/bundle/base/cordis.patch.yml
- name: '@deepseek-ai/dsh-integrator'
  config:
    defaultTargetBranch: main
    defaultRemote: origin
    enablePr: true
    gitTimeoutMs: 120000
    checkTimeoutMs: 1800000
    relinkDependencies: true
    autoPruneCleanWorktree: true
```

## 8. Execution Flow

The integration pipeline executes in 8 discrete phases through the `ctx.subprocess` seam:

```
                  ┌─────────────────────────────────────────────────────────┐
                  │ 1. Pre-Flight Validation (clean worktree & target repo) │
                  └────────────────────────────┬────────────────────────────┘
                                               │ pass
                  ┌────────────────────────────▼────────────────────────────┐
                  │ 2. Dynamic Check Discovery (read manifests from branch) │
                  └────────────────────────────┬────────────────────────────┘
                                               │ checks resolved
                  ┌────────────────────────────▼────────────────────────────┐
                  │ 3. Pre-Merge Draft PR (push branch, gh pr create --draft)│
                  └────────────────────────────┬────────────────────────────┘
                                               │
                  ┌────────────────────────────▼────────────────────────────┐
                  │ 4. Target Baseline Check (run checks against target HEAD)│
                  └────────────────────────────┬────────────────────────────┘
                                               │ baseline recorded
                  ┌────────────────────────────▼────────────────────────────┐
                  │ 5. Local Merge Execution (git merge --no-ff <branch>)   │
                  └──────┬──────────────────────────────────────────────────┘
            conflict     │ success
    ┌────────────────────┴───────────────┐
    │                                    ▼
    │          ┌──────────────────────────────────────────────────┐
    │          │ 6. Workspace Relinking (pnpm install --frozen)   │
    │          └─────────┬────────────────────────────────────────┘
    │              fail  │ success
    │    ┌───────────────┴────────────────┐
    │    │                                ▼
    │    │     ┌──────────────────────────────────────────────────┐
    │    │     │ 7. Post-Merge Re-Verification (run checks)       │
    │    │     └─────────┬────────────────────────────────────────┘
    │    │     new fails │ all green or pre-existing
    ▼    ▼               ▼                                        ▼
┌─────────────────────────────────────────┐   ┌─────────────────────────────────────────┐
│ 8a. Atomic Rollback & Board Remediation │   │ 8b. Success Publication & Pruning       │
│ - git reset --keep <pre_merge_sha>      │   │ - git push origin <target>              │
│ - gh pr comment (record failure trace)  │   │ - gh pr ready <pr_url>                  │
│ - kanban comment & block card           │   │ - kanban comment & completeTask()       │
│ - emit integrator/reverted              │   │ - ctx.worktrees.prune()                 │
└─────────────────────────────────────────┘   │ - emit integrator/merged                │
                                              └─────────────────────────────────────────┘
```

### Phase 1: Pre-Flight Validation
1. Query card from SQLite: `t = await ctx.kanban.getTask(taskId)`.
   - Refuse if task not found or `workspace_kind !== 'worktree'` or `branch_name` missing (`merge_card.py:387-393`).
   - Refuse if `status !== 'done'` unless `options.allowUnfinished` is set (`merge_card.py:394-398`).
2. Verify worktree cleanliness via `ctx.worktrees.classify(worktreePath)` (`plans/07-worktree-management.md:281`):
   - Refuse if tracked changes exist in worktree (`git status --porcelain`). Note untracked scratch files (`merge_card.py:410-426`).
3. Verify target repository cleanliness:
   - Run `git status --porcelain` in `repoRoot`. Refuse if any tracked file is dirty, ignoring `.worktrees/*` gitlinks (`merge_card.py:438-448`).
4. Resolve merge base:
   - Run `git merge-base <target> <branch>`. Refuse if no common ancestor exists (`merge_card.py:449-452`).
5. Diff changed files:
   - Run `git diff --name-only <base>..<branch>`. Refuse if branch changes nothing (`merge_card.py:453-458`).

### Phase 2: Dynamic Check Discovery from Branch Manifests
To avoid false passes or running the entire monorepo, manifests are resolved **from the branch ref**, not current disk (`merge_card.py:160-243`):
1. For each changed file, inspect parent directories in the branch via `git show <branch>:<candidate>/package.json` and `pyproject.toml`.
2. Monorepo root filtering: skip the root package manifest (`sic-repo/package.json`) so a lockfile edit does not run the entire monorepo (`merge_card.py:213-222`).
3. Discovered checks:
   - TypeScript packages: `['pnpm', '--filter', pkg, 'typecheck']`, `['pnpm', '--filter', pkg, 'test']`.
   - Python packages: detect `tests/test_*.py`; resolve `pytest` or fallback to `unittest discover` (`merge_card.py:326-350`).
   - Orphan test files: `.test.ts` outside known packages are routed through a host package supplying `vitest` via `pnpm --filter <host> exec vitest run --root <ws> <path>` (`merge_card.py:475-488`).
   - Shell test suites: `test-*.sh` or `test_*.sh` -> `['bash', path]`.
   - Governance document-only changes: run `truth_check.py` and board validation checks (`merge_card.py:287-323`).
   - Tooling-only changes: run `['node', '--check', script]` (`merge_card.py:252-285`).
4. Refuse if no checks are discovered: *"A merge whose result is unchecked is not an integration"* (`merge_card.py:501-504`).

### Phase 3: Pre-Merge GitHub Draft PR
If `options.pr` is enabled (`merge_card.py:525-558`):
1. Verify `gh` readiness via `gh auth status` through `ctx.subprocess`.
2. Push card branch to remote: `git push -u <remote> <branch>`.
3. Generate comprehensive PR body from card metadata: worker profile, model override, original task body, todo checklist state, worker reported result, changed path inventory, and planned checks (`merge_card.py:85-108`).
4. Open Draft PR: `gh pr create --draft --base <target> --head <branch> --title "<taskId>: <title>" --body <body>`.
5. If already open, resolve URL via `gh pr view <branch> --json url`.
6. Emit `integrator/pr-synced(taskId, prUrl, 'draft')`.

### Phase 4: Target Baseline Verification & Test Attribution
Before touching the target branch, record existing failures so pre-existing repository breakages are not attributed to this card (`merge_card.py:559-584`):
1. For each check, test if script/package exists on target:
   - If script path does not exist on target branch: record baseline as `null` ("not on target yet, no baseline").
   - If `pnpm` outputs `No projects matched the filters`: record baseline as `null`.
   - Otherwise, execute check via `ctx.subprocess` in target checkout and record exit code.
2. Verify target checkout environment health:
   - If an untouched baseline package fails with missing `node_modules`, refuse integration immediately: *"Install dependencies in the target checkout first"* (`merge_card.py:585-592`).
3. Emit `integrator/baseline-recorded(taskId, baselineEntries)`.

### Phase 5: Local Merge Execution
1. Pin pre-merge commit SHA: `preMergeSha = git rev-parse HEAD` (`merge_card.py:593`).
2. Execute local merge: `git merge --no-ff <branch> -m "Integrate <taskId>: <title>"` (`merge_card.py:612`).
3. Conflict handling:
   - If merge fails with conflicts: run `git merge --abort`.
   - Call `remediateFailure(taskId, 'merge conflict', conflictStdout)`.
   - Emit `integrator/failed(taskId, 'merge conflict', 'merge')`.
   - Return `{ status: 'conflict', ... }`.

### Phase 6: Workspace Dependency Relinking
If `config.relinkDependencies` is enabled (`merge_card.py:623-636`):
1. Run `pnpm install --frozen-lockfile` in workspace root via `ctx.subprocess`.
2. If install fails:
   - Execute atomic rollback: `git reset --keep <preMergeSha>`.
   - Call `remediateFailure(taskId, 'workspace install failed after merge', installOutput)`.
   - Return `{ status: 'reverted', ... }`.

### Phase 7: Post-Merge Full Re-Verification
Run all planned checks against the merged repository (`merge_card.py:638-657`):
1. For each check:
   - Execute check command via `ctx.subprocess`.
   - Record exit code and log event into `ctx.verification.recordEvent()` (`plans/09-verified-pipeline-and-gates.md:338`).
   - If exit code is 0: mark OK.
   - If exit code is nonzero, evaluate against baseline:
     - Baseline was `null` and stdout has `node_modules missing`: classify as `environment_gap`.
     - Baseline was nonzero (already failed before merge): classify as `pre_existing` (carried through, not card defect).
     - Baseline was 0 and now fails: classify as `new_failure`!
     - Baseline was `null` (new code) and now fails: classify as `new_failure`!

### Phase 8: Atomic Rollback or Success Settlement

#### Path 8a: Failure Rollback & Board Remediation
If any `new_failure` exists (`merge_card.py:658-671`):
1. **Atomic Rollback**: Run `git reset --keep <preMergeSha>`. Target branch is restored exactly to pre-merge state without touching untracked files (`merge_card.py:595-610`).
2. **PR Record**: If PR exists, comment with failure trace via `gh pr comment` (PR remains open and red attached to the diff).
3. **Board Remediation**:
   - Format structured markdown remediation comment with reproduction checklist (`merge_card.py:704-724`).
   - Post comment via `ctx.kanban.addComment(taskId, 'integrator', remediationBody)`.
   - Block card via `ctx.kanban.transitionTask(taskId, 'blocked', { reason: 'Integration failed', detail })`.
4. Emit `integrator/reverted(taskId, failureReason, newFailures)`.
5. Return `{ status: 'reverted', ... }`.

#### Path 8b: Success Publication & Pruning
If all checks passed or matched carried baseline (`merge_card.py:672-701`):
1. **Push Target**: Run `git push <remote> <target>`.
2. **Promote PR**: If PR exists:
   - Mark ready: `gh pr ready <prUrl>`.
   - Post comment with merge commit SHA, checks run, and carried baseline failures list (`merge_card.py:685-691`).
3. **Update Kanban**:
   - Post success comment: `Integrated into <target> as <sha>...`.
   - Transition task to `done` via `ctx.kanban.completeTask()`.
4. **Prune Worktree**:
   - If `config.autoPruneCleanWorktree` is true, invoke `ctx.worktrees.prune(worktreePath)` (`plans/07-worktree-management.md:284`).
5. Emit `integrator/merged(taskId, mergeCommitSha, prUrl)`.
6. Emit `integrator/pr-synced(taskId, prUrl, 'ready')`.
7. Return `{ status: 'merged', ... }`.

## 9. Error, Cancellation, and Lifecycle Behavior

### 9.1 Atomic Rollback via `git reset --keep`
A critical safety requirement is that an integration failure must never destroy unrelated in-progress developer edits.
- `git reset --hard` is strictly forbidden because it unconditionally overwrites unstaged modifications in the repository.
- `@deepseek-ai/dsh-integrator` uses `git reset --keep <pre_merge_commit>` (`merge_card.py:598-602`). If an unexpected modified tracked file appears, `--keep` safely aborts instead of discarding it, logging an administrative alert.

### 9.2 Cancellation via AbortSignal
When an integration request is aborted (e.g. timeout, operator cancellation, supervisor watchdog reset):
1. The active subprocess is terminated immediately via `SubprocessHandle.terminate()` (`packages/subprocess/subprocess/src/types.ts:183`).
2. The pipeline's finally block checks whether `HEAD` differs from `preMergeSha`:
   - If a merge was underway: runs `git merge --abort`.
   - If the merge commit was already created but post-merge checks were cancelled: runs `git reset --keep <preMergeSha>`.
3. The card is unblocked and left in its original status.

### 9.3 Partial Failures and Network Partitions
- **Remote Push Failure**: If `git push origin <target>` fails due to network outage, the local merge commit is preserved. The PR is left open, a warning comment is posted to Kanban, and the error is returned with clear manual resolution instructions (`merge_card.py:681-684`).
- **GitHub CLI Missing / Logged Out**: If `--pr` was requested but `gh` is missing or unauthenticated, the pipeline refuses to start with status `'refused'` rather than silently degrading to an invisible local merge (`merge_card.py:528-532`).

### 9.4 Ephemeral vs Durable State
- **Ephemeral State**: In-flight subprocess handles, buffer readers, and check timers exist solely in daemon memory.
- **Durable State**: Git commits (authoritative code history), GitHub PR metadata, SQLite Kanban records (`tasks`, `task_comments`, `task_events`), and Verification evidence records (`verification_events.db`).

## 10. Testing Strategy

### 10.1 Unit Tests (`packages/integration/integrator/tests/`)
- `discovery.spec.ts`:
  - Verify changed paths detection across single and multi-commit branches.
  - Verify manifest discovery from branch refs for pnpm packages, Python packages, orphan `.test.ts` files, shell test suites, governance documents, and tooling scripts.
  - Verify root workspace manifest exclusion so monorepo root is not executed.
  - Verify refusal when no checks can be discovered.
- `attribution.spec.ts`:
  - Verify differential failure classification:
    - Pre-existing target failure (exit 1 -> exit 1) -> classified as `pre_existing`, merge permitted.
    - New failure (exit 0 -> exit 1) -> classified as `new_failure`, triggers rollback.
    - New package not on target (null -> exit 1) -> classified as `new_failure`, triggers rollback.
    - Missing host modules (null -> exit 1 with missing `node_modules`) -> classified as `environment_gap`.

### 10.2 Integration & Subprocess Seam Tests
- `merge-rollback.spec.ts`:
  - Run against real Git repository fixtures created in temporary directories.
  - Verify `git merge --no-ff` creates a distinct merge commit with two parents.
  - Test merge conflict handling: verify `git merge --abort` leaves working directory clean and posts structured Kanban comment.
  - Test post-merge check failure: simulate failing check, verify `git reset --keep` restores target commit SHA exactly.
- `github-pr.spec.ts`:
  - Mock `gh` CLI responses via subprocess test doubles.
  - Verify `gh pr create --draft` is called before post-merge checks execute.
  - Verify failure comments are posted to draft PR on check failure.
  - Verify `gh pr ready` is called only after all post-merge checks pass.

### 10.3 Service Composition & HMR Tests
- `hmr-disposal.spec.ts`:
  - Mount `@deepseek-ai/dsh-integrator` into Cordis root context with mock sibling services (`subprocess`, `worktrees`, `kanban`, `verification`).
  - Trigger `ctx.integrator.integrateCard()` and dispose the context mid-flight.
  - Verify that active subprocesses are terminated, disposers run, and cleanup logic executes (`packages/AGENTS.md:17`).

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Target baseline test execution & environment check | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:131-149, 559-584` | `env_can_run_checks` (verifying target checkout can run package checks before blaming the card) and baseline recording loop (`recordBaseline`), capturing pre-existing test exit codes per package. | Convert Python subprocess to `ctx.subprocess.spawn`, wrap in `recordBaseline()` in `baseline.ts`, and record baseline exit codes in typed `BaselineEntry` map. | direct port |
| Manifest discovery from branch Git refs | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:160-244` | `affected_packages` logic: extracting changed paths via git diff, querying branch refs (`git show <branch>:<path>/package.json`, `pyproject.toml`) rather than disk, identifying orphan Vitest tests (`.test.ts`), standalone shell suites (`test_*.sh`), and skipping workspace root to avoid monorepo check explosion. | Translate to TypeScript `discovery.ts`, normalize package names, and produce typed `PackageCheck[]` array. | direct port |
| GitHub draft PR lifecycle & verbatim card body generation | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:49-108, 533-558, 674-691`<br>`/home/sic/Downloads/hermes-agent-main/hermes_cli/web_git.py:490-498` | `gh_ready` (checking GitHub CLI binary candidates and auth status), `pr_body` (formatting card title, body, worker profile, checklist todos, changed paths, and planned checks into verbatim PR markdown), draft PR creation (`gh pr create --draft`) before merge checks, and promotion to ready (`gh pr ready`). | Adapt into `github.ts` using `ctx.subprocess.spawn`, handle absent/unauthenticated `gh` by continuing with local integration only if `--pr` is false, and emit Cordis PR sync events. | direct port |
| Atomic merge commit creation & rollback engine | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:593-622` | Pre-merge commit pinning (`git rev-parse HEAD`), non-fast-forward merge (`git merge --no-ff`), abort on conflict (`git merge --abort`), and atomic rollback (`git reset --keep <pre_merge_sha>`) protecting uncommitted local changes. | Implement `mergeBranch()` and `rollbackMerge()` in `merge.ts`, emit typed Cordis events (`integrator/merged`, `integrator/reverted`), and throw typed `MergeConflictError` / `RollbackError`. | direct port |
| Dependency relinking & frozen lockfile installation | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:626-636` | Post-merge workspace dependency installation (`pnpm install --frozen-lockfile`) ensuring newly added workspace members and lockfile changes are linked before running post-merge checks, with automatic rollback if install fails. | Port to `verify.ts` executing via `ctx.subprocess.spawn` with timeout and sanitized environment. | direct port |
| Differential failure attribution & remediation workflow | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:640-671, 704-724` | Attribution comparison: check fails only if it passed before the merge (or is a new package/check) and fails after; pre-existing target failures are carried through without penalizing the card. Remediation comment generation and blocking the task in Kanban. | Port to `remediation.ts`, update Kanban task status to `blocked` (`kind: 'capability'`) via `ctx.kanban.transitionTask()`, and post remediation markdown to task comments and GitHub PR. | direct port |
| Post-merge worktree retirement & disk reclamation | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1335-1432` | Pruning candidate identification: verifying merged branch status, checking working tree cleanliness, rescuing untracked evidence files before removal, and invoking clean worktree removal. | Delegate disk cleanup directly to `ctx.worktrees.prune(worktreePath)` (Plan 07) after verified target branch push. | direct port |
| Exclusion of `.worktrees/*` gitlinks from dirty checkout checks | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:38-42` | `WORKTREE_GITLINK` regex (`^.{2} \.worktrees/[^/]+/?$`) filtering out active sibling worktree pointers from `git status --porcelain` so concurrent worker trees do not block integration of a completed card. | Integrate into `discovery.ts` inside `assertTargetClean()`. | direct port |

The single most valuable capability to port is the differential failure attribution algorithm and pre-merge draft PR lifecycle (`merge_card.py:131-244, 533-584, 640-724`). Integrating concurrent branches into `main` often encounters unrelated broken tests on the trunk; Hermes's baseline recording before `--no-ff` merge and differential comparison ensures that cards are never wrongly blamed for pre-existing flaws, while draft PR publication before test execution guarantees that failure traces are publicly recorded for immediate developer inspection.

## 11. Implementation Steps

1. **Package Setup**:
   - Create `packages/integration/integrator/` with `package.json`, `tsconfig.json`, `README.md`.
   - Configure dependencies: `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, `@deepseek-ai/dsh-kanban`, `@deepseek-ai/dsh-worktree`, `@deepseek-ai/dsh-verification`, `@deepseek-ai/dsh-subprocess`.
2. **Domain Types & Error Hierarchy**:
   - Implement `src/types.ts`: `PackageCheck`, `BaselineEntry`, `CheckFailure`, `IntegrationOptions`, `IntegrationResult`, `IntegrationPlan`.
   - Implement `src/errors.ts`: `IntegratorError`, `DirtyCheckoutError`, `BaselineFailureError`, `MergeConflictError`, `RollbackError`.
   - Implement `src/events.ts`: typed Cordis event declarations for Context.
3. **Subprocess Git & GitHub Seam**:
   - Implement `src/github.ts`: `ghReady()`, `createDraftPr()`, `commentPr()`, `markPrReady()`, and `prBody()` generator.
   - Implement `src/discovery.ts`: Git diff extraction, manifest parsing from Git branch refs, package check resolution, and refusal validations.
4. **Baseline & Verification Logic**:
   - Implement `src/baseline.ts`: pre-merge test execution against target branch, package presence probing, and baseline table construction.
   - Implement `src/verify.ts`: dependency relinking (`pnpm install --frozen-lockfile`), post-merge check execution, exit code comparison, and differential attribution.
5. **Merge & Rollback Engine**:
   - Implement `src/merge.ts`: `git merge --no-ff`, pre-merge commit pinning, `git merge --abort`, and atomic `git reset --keep` rollback.
   - Implement `src/remediation.ts`: structured markdown remediation comment builder and kanban task blocking.
6. **Service Provider Implementation**:
   - Implement `src/index.ts`: `IntegratorService` subclassing Cordis `Service`, registering `ctx.integrator`, implementing `integrateCard()`, `planIntegration()`, and `checkPrReady()`.
   - Add disposal hook in `ctx.effect()` for in-flight process termination and repository safety.
7. **Host Configuration Bundle**:
   - Add `@deepseek-ai/dsh-integrator` row to `packages/bundle/base/cordis.patch.yml`.
8. **Test Suite Verification**:
   - Implement test doubles in `tests/memory-double.ts`.
   - Write comprehensive unit and integration test specs in `tests/`.
   - Run `pnpm run test` and `pnpm run typecheck` to verify 100% compliance.

## 12. Acceptance Criteria

- [ ] `IntegratorService` registers as `ctx.integrator` on the host plane, default-exported per Harness convention (`packages/AGENTS.md:5`).
- [ ] Injects `['subprocess', 'worktrees', 'kanban', 'verification']` without circular dependencies.
- [ ] No model-facing tools are registered (`ctx.tools.register` is NOT called); service is driven strictly by supervisor or administrative CLI.
- [ ] Agent presets (`presets/hermes-brain`, `presets/hermes-worker`) contain zero rows for `@deepseek-ai/dsh-integrator` per `PRESET-RULES.md`.
- [ ] All Git and GitHub operations route through `ctx.subprocess.spawn` with discrete `argv` arrays and scrubbed environment, never through `/bin/bash` string interpolation.
- [ ] Refuses integration if card is not done (unless `allowUnfinished`), if worktree is dirty, if target checkout is dirty, or if merge base is missing.
- [ ] Manifest and test check discovery reads package configurations directly from branch Git refs (`git show <branch>:...`) rather than target disk.
- [ ] Pre-merge draft PR is created on GitHub before checks run when `pr: true`, and populated with verbatim card metadata.
- [ ] Target baseline records pre-existing failures on target branch; checks that failed before and fail after are NOT attributed to the card.
- [ ] Merge is executed as a non-fast-forward commit (`git merge --no-ff`).
- [ ] Dependencies are relinked post-merge via `pnpm install --frozen-lockfile`.
- [ ] Check failure triggers atomic rollback via `git reset --keep <pre_merge_sha>`, posts failure comment to PR, blocks card in Kanban, and posts remediation instructions.
- [ ] Success pushes target branch to remote, marks draft PR ready, posts Kanban comment, marks card done, and invokes `ctx.worktrees.prune()`.
- [ ] Cordis domain events (`integrator/started`, `integrator/pr-synced`, `integrator/baseline-recorded`, `integrator/merged`, `integrator/reverted`) are emitted at appropriate lifecycle transitions.
- [ ] Service disposal aborts active integrations and ensures repository is restored to a clean state.

## Review fixes applied

- Added `## Port sources` section detailing source mappings from Hermes repositories (`merge_card.py`, `hermes_cli/web_git.py`, and `supervise.py`) to accelerate worktree integration and PR engine implementation.
