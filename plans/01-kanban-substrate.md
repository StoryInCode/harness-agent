# 01 — Kanban Store Capability Seam & SQLite Backend

## Features

- Complete 38-column task state machine supporting 9 distinct lifecycle stages
- Abstract KanbanStore service definition decoupling state operations from storage backends
- Dedicated SQLite storage engine with WAL mode, 120-second busy timeout, and monotonic KANBAN_SQLITE_SCHEMA_VERSION
- Strict PRAGMA user_version validation with automated ordered migrations and fast refusal on newer-than-known schemas
- Justified bespoke relational engine based on cross-table BEGIN IMMEDIATE transactions and DAG queries absent in storageDomain
- Directed acyclic graph dependency tracking with Kahn's algorithm and DFS cycle prevention
- Mechanical parent gating ensuring no task enters ready or running before all parents finish (INV-05)
- Atomic compare-and-set claim acquisition with worker heartbeat tracking and lease expiration
- Priority-ordered dispatch query ranking tasks by explicit priority and creation epoch
- Work-in-progress concurrency ceilings with global and per-profile lane throttling
- Complete historical execution logging across task runs, transition events, and threaded comments
- Content-addressed attachment metadata storage with size and MIME validation
- Real-time board health statistics and stranded task diagnostic distress signals

## 1. Purpose

`@deepseek-ai/dsh-kanban` and `@deepseek-ai/dsh-kanban-sqlite` provide the foundational, multi-session, multi-process work queue substrate for autonomous software engineering in StoryInCode.

- **What it owns**:
  - The `kanban` capability seam (`KanbanStore` abstract Service class in `@deepseek-ai/dsh-kanban` extending `@deepseek-ai/cordis.Service`).
  - The authoritative SQLite storage provider (`SqliteKanbanStore` in `@deepseek-ai/dsh-kanban-sqlite`) managing `~/.hermes/kanban.db` and per-board databases under `~/.hermes/kanban/boards/<slug>/kanban.db`.
  - The complete 38-column task schema (`tasks`), DAG edge mapping (`task_links`), historical runs (`task_runs`), transition audit trail (`task_events`), collaboration commentary (`task_comments`), and card attachments (`task_attachments`).
  - Strict 9-column lifecycle state machine transitions (`triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`, `review`, `done`, `archived`).
  - Atomic compare-and-set (CAS) task claiming, worker heartbeat leasing, and stale claim detection.
  - Directed acyclic graph (DAG) cycle prevention (DFS traversal and Kahn's algorithm) and parent gating integrity (`INV-05`).
  - Priority dispatch query generation (`ORDER BY priority DESC, created_at ASC`) and work-in-progress (WIP) concurrency ceiling enforcement.
  - Typed Cordis domain events emitted on the host bus (`kanban/task-created`, `kanban/task-status`, `kanban/claim-acquired`, etc.).

- **What it deliberately does NOT own**:
  - Model-facing tool presentation, schema compilation, or prompt rendering (owned by `@deepseek-ai/dsh-tool-kanban`, Plan 02).
  - Operator slash commands and CLI argument routing (owned by `@deepseek-ai/dsh-command-kanban`, Plan 02).
  - Worker process spawning, child process supervision, or systemd transient scope isolation (owned by `@deepseek-ai/dsh-subagent`, Plan 11).
  - Watchdog timers, heartbeat monitoring loops, circuit breaker tripping, or auto-reclaim daemon passes (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).
  - Git worktree allocation, branch creation, base commit recording, or uncommitted work checks (owned by `@deepseek-ai/dsh-worktree`, Plan 07).
  - Axiom proof verification, declarative predicate evaluation, or merge gate checks (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Git merge commit landing, draft PR creation, or GitHub check synchronization (owned by `@deepseek-ai/dsh-integrator`, Plan 10).

## 2. Harness Architecture Fit

- **Exact Primitives**:
  - `@deepseek-ai/dsh-kanban`: **Service Definition** (`KanbanStore extends Service`). Merges `interface Context { kanban: KanbanStore }` (`packages/core/tools/src/index.ts:44-47`).
  - `@deepseek-ai/dsh-kanban-sqlite`: **Service Provider** (`SqliteKanbanStore extends KanbanStore`). Mounted into root container.

- **Architectural Placement (Host Plane vs Agent Plane)**:
  `@deepseek-ai/dsh-kanban-sqlite` resides strictly on the **Host Plane** in `packages/bundle/base/cordis.patch.yml`.

- **Evidence-Based Evaluation of Repository Storage Capability (Option B vs ctx.storageDomain)**:
  An explicit audit was performed evaluating whether the repository's existing storage capability (`ctx.storageDomain` in `packages/storage/storage-domain`, backed by `packages/storage/storage-sqlite` or `packages/storage/storage-json`) could host the Kanban substrate instead of a bespoke SQLite database.

  **Decision: Option (b) — Retain bespoke SQLite store with repository-compliant versioning convention.**
  The Kanban substrate genuinely requires relational schema, multi-row transactional queries, and cross-process concurrency semantics that `ctx.storageDomain` cannot serve:
  1. *No Cross-Table Transactions or Atomic Multi-Row Operations*: `packages/storage/storage-domain/README.md:152` explicitly documents this constraint: *"No cross-table transactions, secondary indexes, or multi-segment keys — each write touches one record; these extensions are deferred in the Agent Note's out-of-scope list."* Kanban task claims (`claimTask`), state transitions (`transitionTask`), and completions (`completeTask`) require multi-statement atomic transactions (`BEGIN IMMEDIATE`) updating `tasks`, inserting audit logs into `task_runs` and `task_events`, and demoting/promoting dependent cards atomically.
  2. *Single-Facet Key-Value Model Lacks Relational Queries*: `packages/storage/storage/README.md:131` confirms: *"`kv` is the only data shape — a backend implements one facet"*. The Kanban board requires a normalized relational schema across 6 tables (`tasks`, `task_links`, `task_runs`, `task_events`, `task_comments`, `task_attachments`), recursive graph queries for DAG cycle detection and parent gating (`INV-05`), priority-ordered dispatch queries (`ORDER BY priority DESC, created_at ASC`), and aggregate statistics (`GROUP BY status`).
  3. *No Cross-Process Concurrency or Busy-Wait Handling*: `packages/storage/storage-sqlite/README.md:130` confirms: *"No busy-wait or retry policy — a competing connection holding a write lock rejects the operation immediately instead of waiting; the domain layer's write chain serializes writes within one process, and cross-process coordination is out of scope."* In contrast, Kanban workers, orchestrators, and CLI utilities run across independent OS processes and require kernel-level file locking with `PRAGMA busy_timeout = 120000`.

  **Repository Versioning Convention Enforcement**:
  Because Option (b) is retained, `SqliteKanbanStore` strictly adopts the versioning and schema integrity conventions established by `packages/storage/storage-sqlite/src/schema.ts`:
  - Export public compile-time monotonic version constant: `export const KANBAN_SQLITE_SCHEMA_VERSION = 1`.
  - Validate `PRAGMA user_version` immediately upon opening the database.
  - Refusal on newer databases: if `onDisk > KANBAN_SQLITE_SCHEMA_VERSION`, throw typed `KanbanError('version-mismatch')` to fail fast and prevent silent database corruption.
  - Execute ordered, sequential migrations when `0 < onDisk < KANBAN_SQLITE_SCHEMA_VERSION`.
  - Stamp `PRAGMA user_version = ${KANBAN_SQLITE_SCHEMA_VERSION}` **last** on fresh databases (`onDisk === 0`) after all DDL statements succeed.

- **Justification for Dedicated SQLite Store vs Session Events / Projections**:
  1. *Cross-Session Coordination Boundary*: DeepSeek Harness session persistence (`@deepseek-ai/dsh-session`, `packages/core/session/src/events.ts:11-20`) is designed exclusively for *within-session* event logs (`session.jsonl`). A single Kanban card coordinates distinct agents across independent sessions: the Brain orchestrator session (`hermes-brain`) creates the card; the host dispatcher schedules it; an autonomous worker session (`hermes-worker`) claims and executes it; an independent reviewer session audits the diff; and an integrator script merges it. Storing card state in session projections would require sharing a single session log across multiple independent agent lifecycles, violating session boundary isolation (`packages/preset/agent-presets/README.md:32`).
  2. *Cross-Process Atomic CAS*: Claiming tasks requires atomic compare-and-set locks (`UPDATE tasks SET status = 'running', claim_lock = ? WHERE id = ? AND status = 'ready' AND claim_lock IS NULL`) across separate OS processes. Append-only JSONL session streams cannot execute atomic CAS or lock acquisition across concurrent processes.
  3. *PRESET-RULES Compliance*: PRESET-RULE 2, 6, and 8 mandate that cross-session registries and components injecting host services must reside on the Host Plane (`PRESET-RULES.md:6-14`).
  4. *External Interoperability*: Non-agent tooling (`merge_card.py`, `supervise.py`, and CLI scripts) requires direct, ACID-compliant transactional access via standard SQLite WAL primitives without instantiating an agent runtime.

- **Justification for Service Definition / Service Provider Split**:
  Follows the standard Harness seam pattern (`packages/fs/fs` vs `packages/fs/fs-local`; `packages/attachment/attachment` vs `packages/attachment/attachment-local`). Decoupling the interface allows consumers (`tool-kanban`, `command-kanban`, `supervisor`) to depend on pure TypeScript contracts without pulling in `node:sqlite`, enabling fast in-memory test doubles (`MemoryKanbanStore`) for hermetic unit testing.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Complete 38-column schema (§4.1) | Yes (`KanbanStore`, `SqliteKanbanStore`) | None | Core storage model |
| 9-state transition matrix (§4.2) | Yes (`transitionTask`) | None | State machine validation |
| DAG cycle detection & links (§4.3) | Yes (`linkDependency`, `unlinkDependency`) | None | Graph consistency on disk |
| Parent gating integrity (`INV-05`) | Yes (`recomputeReady`, `linkDependency`) | None | Mechanically enforced state rule |
| Priority dispatch ordering (§4.3) | Yes (`listDispatchableTasks`) | None | Query ordering (`ORDER BY priority DESC, created_at ASC`) |
| Global & lane WIP limits (§4.3) | Yes (`activeCount`, `checkWipCeiling`) | `@deepseek-ai/dsh-guard-resource` (Plan 08) | SQLite tracks counters; systemd cgroups monitor host RAM |
| Local vs PR contracts (§4.4) | Yes (`completion_contract` storage & schema) | `@deepseek-ai/dsh-integrator` (Plan 10) | GitHub API validation performed during PR merge |
| Transactional engine (`BEGIN IMMEDIATE`) (§4.6) | Yes (`writeTxn`, `PRAGMA busy_timeout = 120000`) | None | SQLite WAL concurrency |
| Task audit & run history (§4.6) | Yes (`task_events`, `task_runs` tables) | None | Full audit persistence |
| Board health distress signals (§4.7) | Yes (`getBoardStats`, `checkDiagnostics`) | `@deepseek-ai/dsh-supervisor` (Plan 12) | Metrics generation here; timer polling in supervisor |
| Model tools & CLI commands (§4.5) | No | `@deepseek-ai/dsh-tool-kanban`, `@deepseek-ai/dsh-command-kanban` (Plan 02) | Model presentation separated from storage |
| No phantom cards (`INV-15`) | Interface hook (`verifyCreatedCards`) | `@deepseek-ai/dsh-tool-kanban` (Plan 02) | Verified during worker completion tool call |
| Parent never claims (`INV-04`) | Gating check (rejects root claim) | `@deepseek-ai/dsh-tool-kanban` (Plan 02) | Enforced via tool omission & tool guard |

## 4. Proposed Package / File Layout

```
packages/kanban/
├── kanban/                               # @deepseek-ai/dsh-kanban (Service Definition)
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       ├── index.ts                      # Abstract KanbanStore class & Context augment
│       ├── brand.ts                      # TaskId, TaskRunId, TaskEventId branded types
│       ├── types.ts                      # Task, TaskStatus, TaskRun, TaskEvent, TaskComment
│       ├── errors.ts                     # KanbanError, ParentGatingError, CycleError
│       └── events.ts                     # Typed Cordis events on Context
└── kanban-sqlite/                        # @deepseek-ai/dsh-kanban-sqlite (Service Provider)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts                      # SqliteKanbanStore service implementation
    │   ├── schema.ts                     # Table DDL, migrations, KANBAN_SQLITE_SCHEMA_VERSION, user_version check/stamp, DatabaseSync
    │   ├── graph.ts                      # Kahn's algorithm, DFS cycle detection, parent gating
    │   ├── transaction.ts                # writeTxn helper (BEGIN IMMEDIATE & savepoints)
    │   ├── query.ts                      # 38-column mapper, dispatch priority query
    │   └── stats.ts                      # Board statistics & diagnostic distress checks
    └── tests/
        ├── memory-double.ts              # In-memory test double for contract tests
        ├── store-contract.spec.ts        # Contract test suite run against SQLite & double
        ├── schema-migration.spec.ts      # Schema creation, migrations, user_version stamping, WAL pragmas & newer-version refusal
        ├── dag-cycle.spec.ts             # Cycle prevention & DFS depth traversal tests
        ├── parent-gating.spec.ts         # INV-05 parent gating & demotion/promotion tests
        ├── cas-claim.spec.ts             # Atomic CAS claim lock contention tests
        └── hmr-disposal.spec.ts          # Service disposal, WAL checkpointing & handle cleanup
```

## 5. Public Contracts

### 5.1 Branded Identifiers & Core Types (`packages/kanban/kanban/src/brand.ts`, `types.ts`)

```typescript
// packages/kanban/kanban/src/brand.ts
export type TaskId = string & { readonly __brand: unique symbol }
export type TaskRunId = number & { readonly __brand: unique symbol }
export type TaskEventId = number & { readonly __brand: unique symbol }

export function taskId(raw: string): TaskId {
  if (!/^t_[a-f0-9]{4,16}$/.test(raw)) {
    throw new TypeError(`invalid TaskId format: "${raw}", expected t_<hex>`)
  }
  return raw as TaskId
}

// packages/kanban/kanban/src/types.ts
export const VALID_STATUSES = [
  'triage', 'todo', 'scheduled', 'ready', 'running',
  'blocked', 'review', 'done', 'archived',
] as const

export type TaskStatus = typeof VALID_STATUSES[number]

export interface Task {
  readonly id: TaskId
  readonly title: string
  readonly body: string | null
  readonly assignee: string | null
  readonly status: TaskStatus
  readonly priority: number
  readonly createdBy: string | null
  readonly createdAt: number
  readonly startedAt: number | null
  readonly completedAt: number | null
  readonly workspaceKind: 'scratch' | 'worktree' | 'dir'
  readonly workspacePath: string | null
  readonly branchName: string | null
  readonly projectId: string | null
  readonly claimLock: string | null
  readonly claimExpires: number | null
  readonly tenant: string | null
  readonly result: string | null
  readonly idempotencyKey: string | null
  readonly consecutiveFailures: number
  readonly workerPid: number | null
  readonly lastFailureError: string | null
  readonly maxRuntimeSeconds: number | null
  readonly lastHeartbeatAt: number | null
  readonly currentRunId: TaskRunId | null
  readonly workflowTemplateId: string | null
  readonly currentStepKey: string | null
  readonly skills: readonly string[] | null
  readonly modelOverride: string | null
  readonly providerOverride: string | null
  readonly reasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'max' | null
  readonly maxRetries: number | null
  readonly goalMode: boolean
  readonly goalMaxTurns: number | null
  readonly sessionId: string | null
  readonly blockKind: 'dependency' | 'needs_input' | 'capability' | 'transient' | null
  readonly blockRecurrences: number
  readonly completionContract: string | null
}

export interface TaskLink {
  readonly parentId: TaskId
  readonly childId: TaskId
}

export interface TaskRun {
  readonly id: TaskRunId
  readonly taskId: TaskId
  readonly profile: string | null
  readonly status: string
  readonly claimLock: string | null
  readonly claimExpires: number | null
  readonly workerPid: number | null
  readonly startedAt: number
  readonly endedAt: number | null
  readonly outcome: string | null
  readonly summary: string | null
  readonly metadata: string | null
  readonly error: string | null
}

export interface TaskComment {
  readonly id: number
  readonly taskId: TaskId
  readonly author: string
  readonly body: string
  readonly createdAt: number
}

export interface TaskAttachment {
  readonly id: number
  readonly taskId: TaskId
  readonly filename: string
  readonly storedPath: string
  readonly contentType: string | null
  readonly size: number
  readonly uploadedBy: string | null
  readonly createdAt: number
}

export interface BoardStats {
  readonly byStatus: Record<TaskStatus, number>
  readonly byAssignee: Record<string, Record<TaskStatus, number>>
  readonly oldestReadyAgeSeconds: number | null
  readonly activeRunningCount: number
}
```

### 5.2 Service Definition & Cordis Events (`packages/kanban/kanban/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  TaskId, TaskRunId, Task, TaskStatus, TaskRun,
  TaskComment, TaskAttachment, BoardStats,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    kanban: KanbanStore
  }
  interface Events {
    'kanban/task-created': (task: Task) => void
    'kanban/task-updated': (task: Task, previous: Task) => void
    'kanban/task-status': (task: Task, from: TaskStatus, to: TaskStatus) => void
    /**
     * Serial hook invoked before committing a task status transition to 'done'.
     * Interceptors (such as AxiomVerifier) may throw an error (UnprovenDoneError)
     * to abort the transition and enforce INV-01 (No Unproven Done).
     * @mode serial
     */
    'kanban/pre-complete': (task: Task) => Promise<void> | void
    'kanban/claim-acquired': (task: Task, claimer: string) => void
    'kanban/claim-released': (task: Task, reason: string) => void
    'kanban/task-blocked': (task: Task, reason: string, kind: string) => void
    'kanban/task-unblocked': (task: Task) => void
    'kanban/dependency-linked': (parentId: TaskId, childId: TaskId) => void
    'kanban/dependency-unlinked': (parentId: TaskId, childId: TaskId) => void
    'kanban/heartbeat-tick': (task: Task, note?: string) => void
    'kanban/comment-posted': (comment: TaskComment) => void
    'kanban/diagnostic-warning': (warning: { code: string; message: string; taskId?: TaskId }) => void
  }
}

export abstract class KanbanStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'kanban', true) // true = immediate service availability
  }

  // Task Query & Lookup
  abstract getTask(id: TaskId): Promise<Task | undefined>
  abstract listTasks(filter: {
    status?: TaskStatus
    assignee?: string
    tenant?: string
    limit?: number
  }): Promise<readonly Task[]>
  abstract listDispatchableTasks(limit?: number): Promise<readonly Task[]>

  // Task Mutation
  abstract createTask(input: CreateTaskInput): Promise<Task>
  abstract updateTask(id: TaskId, patch: UpdateTaskPatch): Promise<Task>
  /**
   * Transition task status. When transitioning to 'done', transitionTask MUST await
   * `await this.ctx.serial('kanban/pre-complete', task)` prior to committing status
   * mutations to SQLite. If any listener rejects (e.g. unproven axioms under INV-01),
   * the database mutation is aborted.
   */
  abstract transitionTask(id: TaskId, to: TaskStatus, metadata?: Record<string, unknown>): Promise<Task>

  // Claim & Execution Locks
  abstract claimTask(id: TaskId, claimerId: string, ttlSeconds: number, workerPid?: number): Promise<Task>
  abstract heartbeatTask(id: TaskId, note?: string): Promise<void>
  abstract releaseClaim(id: TaskId, reason: string): Promise<Task>

  // DAG Dependencies
  abstract linkDependency(parentId: TaskId, childId: TaskId): Promise<void>
  abstract unlinkDependency(parentId: TaskId, childId: TaskId): Promise<void>
  abstract getParents(id: TaskId): Promise<readonly Task[]>
  abstract getChildren(id: TaskId): Promise<readonly Task[]>
  abstract recomputeReady(triggerTaskId?: TaskId): Promise<readonly TaskId[]>

  // Completion & Invariant Checks
  abstract completeTask(id: TaskId, evidence: CompleteTaskEvidence): Promise<Task>
  abstract verifyCreatedCards(workerProfile: string, cardIds: readonly TaskId[]): Promise<void>

  // Comments, Attachments & Metrics
  abstract addComment(id: TaskId, author: string, body: string): Promise<TaskComment>
  abstract listComments(id: TaskId): Promise<readonly TaskComment[]>
  abstract addAttachment(id: TaskId, attachment: CreateAttachmentInput): Promise<TaskAttachment>
  abstract listAttachments(id: TaskId): Promise<readonly TaskAttachment[]>
  abstract getBoardStats(): Promise<BoardStats>
}

export default KanbanStore
```

### 5.3 Service Provider Config Schema (`packages/kanban/kanban-sqlite/src/index.ts`)

```typescript
import z from '@deepseek-ai/schemastery'

export interface SqliteKanbanConfig {
  /** Path to kanban SQLite database file. Default: ~/.hermes/kanban.db */
  dbPath?: string
  /** Journal mode for SQLite. Default: wal */
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  /** Busy timeout in milliseconds for database locks. Default: 120000 (120s). */
  busyTimeoutMs?: number
  /** Global maximum tasks permitted in 'running' state across the host. Default: 4. */
  maxInProgress?: number
  /** Maximum concurrent running tasks permitted per assignee lane. Default: 2. */
  maxInProgressPerProfile?: number
  /** Default claim lease duration in seconds. Default: 900 (15m). */
  defaultClaimTtlSeconds?: number
}

export const SqliteKanbanConfig: z<SqliteKanbanConfig> = z.object({
  dbPath: z.string().description('Path to SQLite database file'),
  journalMode: z.union([
    z.literal('wal'), z.literal('delete'),
    z.literal('truncate'), z.literal('persist'),
  ]).default('wal').description('SQLite journal mode'),
  busyTimeoutMs: z.number().min(1000).max(300000).default(120000)
    .description('SQLite busy timeout in ms'),
  maxInProgress: z.number().min(1).max(32).default(4)
    .description('Global WIP limit'),
  maxInProgressPerProfile: z.number().min(1).max(8).default(2)
    .description('Per-profile WIP limit'),
  defaultClaimTtlSeconds: z.number().min(60).max(7200).default(900)
    .description('Claim lock lease TTL'),
})

// packages/kanban/kanban-sqlite/src/schema.ts
/**
 * Monotonic physical database schema version stored in PRAGMA user_version.
 * Must be bumped on any DDL migration. Any onDisk version newer than this
 * rejects with a typed 'version-mismatch' KanbanError (refusal behavior).
 */
export const KANBAN_SQLITE_SCHEMA_VERSION = 1
```

## 6. Lifecycle and Scoping

- **Mount Level**: Host Plane (`packages/bundle/base/cordis.patch.yml`).
- **Scoping Behavior**: The service is published into Cordis root context (`ctx.kanban`). It is shared process-wide across all agent sessions and external RPCs.
- **Dependency Injection**:
  ```typescript
  // packages/kanban/kanban-sqlite/src/index.ts
  export class SqliteKanbanStore extends KanbanStore {
    static inject = ['fs'] // optional fs access for attachments
    static Config = SqliteKanbanConfig
    ...
  }
  ```
- **Database Initialization, Schema Versioning, and Newer-Version Refusal**:
  `SqliteKanbanStore` initialization logic (`packages/kanban/kanban-sqlite/src/schema.ts`) adheres to the repository's SQLite versioning convention (`packages/storage/storage-sqlite/src/schema.ts`):
  1. *Filesystem Exclusivity*: Missing parent directories are created with `0o700`; the database file is exclusively created with `0o600` via `open(path, 'wx', 0o600)`. Existing file modes are preserved.
  2. *Pragmas*: Executes `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = ${journalMode.toUpperCase()}`, and `PRAGMA busy_timeout = ${busyTimeoutMs}`.
  3. *Version Validation & Refusal*:
     - Executes `PRAGMA user_version` (returning `{ user_version: number }`).
     - **Newer-Version Refusal**: If `onDisk > KANBAN_SQLITE_SCHEMA_VERSION`: throws `new KanbanError('version-mismatch', `kanban database at "${actual}" has schema version ${onDisk}, which is newer than supported version (${KANBAN_SQLITE_SCHEMA_VERSION})`)`. This prevents downgrade hazards and silent database corruption.
     - **Ordered Migrations**: If `0 < onDisk < KANBAN_SQLITE_SCHEMA_VERSION`: executes sequential, ordered migration scripts inside a transaction to upgrade tables to the current version.
     - **Fresh Database**: If `onDisk === 0`: creates tables (`tasks` 38 columns, `task_links`, `task_runs`, `task_events`, `task_comments`, `task_attachments` with `STRICT` mode). Crucially, executes `PRAGMA user_version = ${KANBAN_SQLITE_SCHEMA_VERSION}` **last**. If DDL fails partway through, the medium remains at version 0, ensuring that subsequent startup attempts retry materialization from a clean state.
- **State Machine Interception (`kanban/pre-complete`)**:
  Before committing any task status transition to `'done'`, `transitionTask(id, to, metadata)` (and `completeTask`) must execute:
  ```typescript
  if (to === 'done') {
    await this.ctx.serial('kanban/pre-complete', task)
  }
  ```
  prior to acquiring the SQLite transaction or committing mutations. If any serial listener (such as `@deepseek-ai/dsh-axiom-verifier`, Plan 04) rejects or throws `UnprovenDoneError` (enforcing invariant `INV-01`), the transition sequence aborts immediately and the card remains in its current status.
- **Disposal & Teardown**:
  When Cordis unloads `@deepseek-ai/dsh-kanban-sqlite` (during process exit or hot-module replacement):
  1. Closes prepared statement cache to avoid resource leaks.
  2. Executes `PRAGMA wal_checkpoint(PASSIVE)` to flush committed transactions back to the main database file without blocking writers.
  3. Closes the `DatabaseSync` instance.
  4. Releases all in-process mutexes and timer references.

## 7. Agent Preset Integration

In compliance with **PRESET-RULE 2, 6, and 8** (`PRESET-RULES.md:6, 12, 14`):
- `KanbanStore` and `SqliteKanbanStore` are **NEVER** declared in agent presets (`hermes-brain/agent.cordis.yml` or `hermes-worker/agent.cordis.yml`).
- Agent presets contribute only the consumer tools (`@deepseek-ai/dsh-tool-kanban`, Plan 02) which resolve `ctx.kanban` from the root context via `ctx.get('kanban')` (PRESET-RULE 5).
- Number of rows added to presets by this substrate plan: **0**.

## 8. Execution Flow

### 8.1 Task Creation & DAG Insertion Flow

```
Caller (tool-kanban / command-kanban)
  │
  ├──> ctx.kanban.createTask(input)
  │      │
  │      ├──> Validate title (non-whitespace), workspaceKind, priority
  │      ├──> Generate TaskId (`t_${tokenHex(4)}`)
  │      │
  │      └──> BEGIN IMMEDIATE (writeTxn)
  │             │
  │             ├──> Check idempotency_key (prevent duplicate creation)
  │             ├──> Insert task row with initial status ('triage', 'todo', or 'ready')
  │             │
  │             ├──> If parents specified:
  │             │      ├──> DFS Cycle Check: verify child -> parent does not cycle
  │             │      ├──> Insert task_links(parent_id, child_id)
  │             │      └──> Check parent status: if any parent != 'done' && != 'archived':
  │             │             └──> Force status = 'todo' (INV-05 Parent Gating)
  │             │
  │             └──> Insert task_events('created')
  │      │
  │      └──> COMMIT
  │             │
  │             └──> ctx.emit('kanban/task-created', task)
```

### 8.2 Task Claim & Execution Lock Flow

```
Dispatcher / Worker
  │
  ├──> ctx.kanban.claimTask(taskId, claimerId, ttlSeconds, workerPid)
  │      │
  │      └──> BEGIN IMMEDIATE (writeTxn)
  │             │
  │             ├──> Check Global WIP limit (running < maxInProgress)
  │             ├──> Check Profile WIP limit (running_for_profile < maxInProgressPerProfile)
  │             │
  │             ├──> Verify Parent Gating (INV-05):
  │             │      SELECT count(*) FROM task_links l JOIN tasks p ON l.parent_id = p.id
  │             │      WHERE l.child_id = ? AND p.status NOT IN ('done', 'archived')
  │             │      If count > 0: reject with ParentGatingError
  │             │
  │             ├──> Atomic CAS Claim:
  │             │      UPDATE tasks SET
  │             │        status = 'running',
  │             │        claim_lock = :claimer,
  │             │        claim_expires = :now + :ttl,
  │             │        worker_pid = :pid,
  │             │        started_at = COALESCE(started_at, :now),
  │             │        last_heartbeat_at = :now
  │             │      WHERE id = :id AND status = 'ready' AND claim_lock IS NULL
  │             │
  │             ├──> If rows_affected == 0: throw ClaimConflictError
  │             │
  │             ├──> Insert task_runs (open new run record)
  │             └──> Insert task_events('claim_acquired')
  │      │
  │      └──> COMMIT
  │             │
  │             └──> ctx.emit('kanban/claim-acquired', task, claimerId)
```

### 8.3 Task Completion & Children Promotion Flow

```
Worker / Reviewer
  │
  ├──> ctx.kanban.completeTask(taskId, evidence) / transitionTask(taskId, 'done')
  │      │
  │      ├──> Verify INV-15: verifyCreatedCards(evidence.createdCards)
  │      │
  │      ├──> Await Cordis serial hook: ctx.serial('kanban/pre-complete', task)
  │      │      (If AxiomVerifier detects unproven axioms, throws UnprovenDoneError, aborting completion)
  │      │
  │      └──> BEGIN IMMEDIATE (writeTxn)
  │             │
  │             ├──> Verify current status in ('running', 'review')
  │             ├──> UPDATE tasks SET status = 'done', completed_at = :now, claim_lock = NULL
  │             ├──> Close active task_runs row (status = 'success', summary, metadata)
  │             ├──> Insert task_events('completed')
  │             │
  │             ├──> recomputeReady(taskId) (DAG Promotion):
  │             │      Query children where status = 'todo'
  │             │      For each child:
  │             │        Check if all parents now in ('done', 'archived')
  │             │        If all satisfied:
  │             │          UPDATE tasks SET status = 'ready' WHERE id = child.id
  │             │          Insert task_events('promoted_auto')
  │             │
  │             └──> COMMIT
  │      │
  │      └──> ctx.emit('kanban/task-status', task, 'running', 'done')
  │           For each promoted child: ctx.emit('kanban/task-status', child, 'todo', 'ready')
```

## 9. Error, Cancellation, and Lifecycle Behavior

- **SQLite Busy Lock Contention**:
  Operations invoke `writeTxn` using `BEGIN IMMEDIATE`. When concurrent writers contend, SQLite respects `PRAGMA busy_timeout = 120000`. If timeout expires, throws `KanbanError('DATABASE_LOCKED', ...)`.
- **Claim Conflicts**:
  If two workers attempt to claim the same card simultaneously, exactly one succeeds via CAS. The second receives `ClaimConflictError` and falls through to the next dispatch candidate.
- **DAG Cycle Detection Failure**:
  Calling `linkDependency(parent, child)` runs a depth-first search. If `parent` is already a reachable descendant of `child`, throws `CyclicDependencyError('Refusing to link: cycle detected')` without touching disk.
- **Parent Gating Demotion**:
  If an operator or Brain adds a parent link to an already-`ready` task, `linkDependency` transactionally demotes the child to `todo`, preserving the `INV-05` invariant.
- **Stale Claims & Reclaim**:
  A claim is stale when `now > claim_expires` or `worker_pid` is confirmed dead by the supervisor. `releaseClaim(taskId, reason)` reverts status to `ready`, increments `consecutive_failures`, and logs the event.
- **Crash Consistency**:
  SQLite WAL mode guarantees that uncommitted writes do not corrupt the database on host power failure or process kill.
- **Schema Version Mismatch & Newer-Version Refusal**:
  When opening a database file with `PRAGMA user_version` higher than `KANBAN_SQLITE_SCHEMA_VERSION`, `openDatabase` refuses to start and throws `KanbanError('version-mismatch')`. It does not attempt silent execution or unverified fallback, protecting existing databases from downgrade corruption. If `user_version` is an older known schema, sequential migrations run inside a transaction; if migration fails, the transaction rolls back.

## 10. Testing Strategy

### 10.1 Testing Tiers & Collocation

All tests are collocated under `packages/kanban/kanban-sqlite/tests/*.spec.ts`:

1. **In-Memory Store Contract Tests (`store-contract.spec.ts`)**:
   - Implements `MemoryKanbanStore` implementing `KanbanStore`.
   - Runs identical behavioral contract test suite against both `MemoryKanbanStore` and `SqliteKanbanStore` (`:memory:` and disk).
   - Verifies 100% contract compliance across storage engines.
2. **Schema & Pragmas Test (`schema-migration.spec.ts`)**:
   - Verifies all 38 columns, foreign keys (`task_links`, `task_runs`), WAL journal mode, and `busy_timeout`.
   - Validates that `PRAGMA foreign_keys = ON` and `STRICT` table constraints reject invalid types.
   - **Migration & Version Stamping Test**: Verifies fresh database initializes with `user_version = 0` during table DDL and stamps `PRAGMA user_version = 1` last upon successful completion. Verifies ordered migrations update older version databases sequentially.
   - **Newer-Version Refusal Test**: Sets `PRAGMA user_version = 999` on an existing database; asserts opening throws typed `KanbanError` with code `'version-mismatch'`, mirroring `storage-sqlite` refusal behavior.
3. **DAG Cycle & Kahn's Algorithm Test (`dag-cycle.spec.ts`)**:
   - Tests self-links (`linkDependency(A, A)` fails).
   - Tests direct cycles (`A -> B -> A` fails).
   - Tests indirect cycles (`A -> B -> C -> D -> A` fails).
   - Tests tree and diamond DAG structures (A -> B, A -> C, B -> D, C -> D succeeds).
4. **Parent Gating Integrity Test (`parent-gating.spec.ts`)**:
   - Tests `INV-05`: Task with uncompleted parent cannot be created in `ready`.
   - Tests demotion: Adding an unfinished parent to a `ready` task demotes it to `todo`.
   - Tests promotion: Marking parent `done` automatically promotes child from `todo` to `ready`.
5. **CAS Claim & Concurrency Test (`cas-claim.spec.ts`)**:
   - Dispatches 10 parallel asynchronous claim attempts on a single `ready` card.
   - Asserts exactly one claim succeeds, and 9 fail with `ClaimConflictError`.
   - Asserts `claim_lock` is held with correct PID and TTL.
6. **HMR & Disposal Test (`hmr-disposal.spec.ts`)**:
   - Loads plugin via Cordis root container, issues operations, and disposes the context.
   - Asserts WAL checkpoint passes, statement handles close, and database file is unlockable.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Schema & SQLite storage engine | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db.py:851-1030`<br>`/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db_connect.py:57-82` | 38-column DDL for `tasks`, tables `task_links`, `task_runs`, `task_events`, `task_comments`, `task_attachments`, `kanban_notify_subs`, index definitions, and WAL configuration pragmas (`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL`). | Translate Python `sqlite3` to Node.js `node:sqlite` (`DatabaseSync`), integrate `PRAGMA user_version` validation against monotonic `KANBAN_SQLITE_SCHEMA_VERSION`, implement sequential migrations ladder in `schema.ts`, and resolve database paths to `~/.hermes/kanban.db` and per-board paths. | port with adaptation |
| Transactional concurrency boundary (`write_txn`) | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db_connect.py:1148-1200` | `BEGIN IMMEDIATE` boundary wrapper with busy-retry loop on `SQLITE_BUSY`, nested savepoint transaction handling (`SAVEPOINT` / `RELEASE` / `ROLLBACK TO`), and post-commit verification checks. | Convert Python context manager to TypeScript callback (`writeTxn<T>(fn: () => T): T`), bind to `node:sqlite` connection handle, and set 120,000ms busy timeout. | direct port |
| Lifecycle state machine & transition rules | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db.py:2007-2065, 2070-2200, 2400-2470` | 9-column lifecycle state machine transitions (`triage`, `todo`, `scheduled`, `ready`, `running`, `blocked`, `review`, `done`, `archived`), transition validity matrix, sticky block handling, and transition event logging (`task_events`). | Replace Python dict checks with TypeScript discriminated union states, emit typed Cordis domain events (`kanban/task-status`, `kanban/task-created`), and integrate with Cordis serial pre-transition hooks. | port with adaptation |
| DAG cycle detection & parent gating (`INV-05`) | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db_graph.py:54-88`<br>`/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db.py:1575-1612, 2007-2065` | Graph traversal algorithms: DFS `_would_cycle` for dynamic link insertion, Kahn's in-degree topological cycle detection for bulk child decomposition, `recompute_ready` parent completion evaluation, and automatic demotion (`ready -> todo`) on unsatisfied dependencies. | Port Python graph traversal logic to `graph.ts`, throw typed `CycleError` and `ParentGatingError`, and trigger Cordis events on promotion/demotion. | direct port |
| Atomic CAS task claiming & worker heartbeat leasing | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db.py:2130-2200, 2250-2285` | Compare-and-set claim query (`UPDATE tasks SET status = 'running', claim_lock = ?, claim_expires = ? WHERE id = ? AND status = 'ready' AND claim_lock IS NULL`), pre-claim parent satisfaction re-validation, `task_runs` record initialization, and heartbeat lease TTL extension. | Convert to TypeScript synchronous `DatabaseSync` statements, use branded `TaskId` and `TaskRunId` types, and emit `kanban/claim-acquired` / `kanban/claim-heartbeat` Cordis events. | port with adaptation |
| Priority dispatch query & concurrency limits | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db_dispatch.py:1710-1760`<br>`/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db.py:1480-1510` | Priority dispatch query generation (`ORDER BY priority DESC, created_at ASC`), filtering by assignee and status, and active task count aggregation for WIP lane throttling. | Encapsulate in `KanbanStore.listDispatchableTasks()`, replace global CLI configs with typed `KanbanConfig` injected via Cordis context, and return strongly typed task entities. | port with adaptation |
| Board health diagnostics & distress signals | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_diagnostics.py:48-120, 210-380`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/board_preflight.py:1-60, 110-230` | Diagnostic distress rules: stale leases, stranded running cards with absent worker processes, deadlock detection on unmet dependencies, unassigned ready cards, and severity ordering (`warning`, `error`, `critical`). | Convert Python dataclasses to TypeScript interfaces (`Diagnostic`, `DiagnosticAction`) and expose via `KanbanStore.checkDiagnostics()` for consumption by Plan 12 supervisor. | port with adaptation |
| Content-addressed attachment metadata storage | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_db.py:1005-1020, 2750-2820` | `task_attachments` schema (`id`, `task_id`, `name`, `content_hash`, `size_bytes`, `mime_type`, `created_at`), metadata insertion, and SHA-256 deduplication logic. | Adapt Python hashlib and filesystem operations to Node.js `node:crypto` and integrate with Harness attachment subsystem (`packages/attachment/attachment`). | port with adaptation |

The single most valuable capability to port is the atomic compare-and-set claim state machine with parent-gating invariant enforcement and transaction-retry boundary (`hermes_cli/kanban_db.py:2130-2200` & `hermes_cli/kanban_db_connect.py:1148-1200`). Multi-agent dispatch systems fail catastrophically under race conditions; adopting Hermes's battle-tested `BEGIN IMMEDIATE` retry protocol and atomic CAS query guarantees that no two workers ever claim the same task and no child task ever executes before all its parents are verified done.

## 11. Implementation Steps

1. **Create `@deepseek-ai/dsh-kanban`** at `packages/kanban/kanban/`:
   - Setup `package.json`, `tsconfig.json`.
   - Implement `brand.ts` with branded string types (`TaskId`, `TaskRunId`, `TaskEventId`).
   - Implement `types.ts` with 38-column `Task` model, `TaskStatus`, `TaskLink`, etc.
   - Implement `errors.ts` (`KanbanError`, `ParentGatingError`, `CyclicDependencyError`, `ClaimConflictError`).
   - Implement `index.ts` declaring abstract `KanbanStore` class and Context augmentation.
2. **Create `@deepseek-ai/dsh-kanban-sqlite`** at `packages/kanban/kanban-sqlite/`:
   - Setup `package.json` with dependencies on `@deepseek-ai/dsh-kanban` and `node:sqlite`.
   - Implement `schema.ts`: DDL for `tasks` (38 columns), `task_links`, `task_runs`, `task_events`, `task_comments`, `task_attachments`, `kanban_notify_subs`; export `KANBAN_SQLITE_SCHEMA_VERSION = 1`, implement `PRAGMA user_version` validation, newer-version refusal (`version-mismatch`), fresh database last-stamping, and ordered migration runner.
   - Implement `transaction.ts`: `writeTxn` wrapping `BEGIN IMMEDIATE` and savepoints.
   - Implement `graph.ts`: DFS cycle detection and parent gating logic.
   - Implement `query.ts`: 38-column row-to-model mapper and priority dispatch ordering query.
   - Implement `stats.ts`: Aggregate metrics and diagnostic warnings.
   - Implement `index.ts`: Subclass `KanbanStore`, export `SqliteKanbanConfig`, and implement Cordis lifecycle.
3. **Verify Build & Collocated Test Suite**:
   - Run Vitest across `packages/kanban/kanban-sqlite/tests/`.
   - Enforce 100% line, branch, and statement coverage.

## 12. Acceptance Criteria

- [ ] `KanbanStore` extends `@deepseek-ai/cordis.Service` and registers under `ctx.kanban`.
- [ ] SQLite database initializes at configured path with WAL mode and `PRAGMA busy_timeout = 120000`.
- [ ] `KANBAN_SQLITE_SCHEMA_VERSION = 1` exported from `kanban-sqlite`; database initialization validates `PRAGMA user_version` and throws `version-mismatch` on newer-than-known databases (`user_version > KANBAN_SQLITE_SCHEMA_VERSION`).
- [ ] Fresh database initialization stamps `PRAGMA user_version = 1` last after successful table creation.
- [ ] All 38 columns of the `tasks` schema are persisted, read, and mapped without data loss.
- [ ] `linkDependency` detects cycles (both direct and indirect) and throws `CyclicDependencyError`.
- [ ] Invariant `INV-05` is enforced: No task enters `ready` or `running` while any parent is incomplete.
- [ ] Atomic CAS claim locking prevents multiple concurrent workers from claiming the same task.
- [ ] Dispatch query strictly orders by `priority DESC, created_at ASC`.
- [ ] WIP limits (global `maxInProgress` and per-profile lane cap) reject excessive concurrent claims.
- [ ] Task completion automatically evaluates child dependencies and promotes eligible `todo` cards to `ready`.
- [ ] Serial hook `'kanban/pre-complete': (task: Task) => Promise<void> | void` is awaited in `transitionTask(id, 'done')` before committing status mutations, allowing interceptors to abort unproven completions (`INV-01`).
- [ ] Service cleanup executes `PRAGMA wal_checkpoint(PASSIVE)` and closes database handles cleanly.

## Review fixes applied

- REVIEW-contracts #1: Added `'kanban/pre-complete': (task: Task) => Promise<void> | void` serial hook contract to `interface Events`, `transitionTask`, and completion flow to enforce `INV-01` (No Unproven Done).
- REVIEW-storage finding (Dedicated SQLite Store vs ctx.storageDomain reuse):
  - Evaluated repository `ctx.storageDomain` capability (`packages/storage`) for Kanban persistence.
  - Selected **Option (b)**: Retained bespoke SQLite store (`SqliteKanbanStore` managing `~/.hermes/kanban.db`) because Kanban coordination genuinely requires relational schema and transactional concurrency capabilities that `ctx.storageDomain` lacks:
    1. Cross-table transactions (`BEGIN IMMEDIATE`) atomically coordinating `tasks`, `task_runs`, and `task_events` during task claiming and completion (`packages/storage/storage-domain/README.md:152` confirms "No cross-table transactions, secondary indexes, or multi-segment keys — each write touches one record; these extensions are deferred in the Agent Note's out-of-scope list").
    2. Relational schema with foreign keys and recursive graph queries for DAG cycle detection and parent gating (`INV-05`). `packages/storage/storage/README.md:131` notes that "`kv` is the only data shape — a backend implements one facet".
    3. Multi-process concurrency and lock retry policy (`PRAGMA busy_timeout = 120000`) across separate worker processes (`packages/storage/storage-sqlite/README.md:130` confirms "No busy-wait or retry policy — a competing connection holding a write lock rejects the operation immediately instead of waiting; the domain layer's write chain serializes writes within one process, and cross-process coordination is out of scope").
    4. Multi-column sort and limit for dispatch query (`ORDER BY priority DESC, created_at ASC`) and status metrics aggregation (`GROUP BY status`).
  - Brought bespoke store into strict compliance with the repository's SQLite versioning convention (`packages/storage/storage-sqlite/src/schema.ts`):
    - Exported module-level monotonic constant `export const KANBAN_SQLITE_SCHEMA_VERSION = 1`.
    - Implemented `PRAGMA user_version` validation on database open.
    - Implemented newer-version refusal: if `onDisk > KANBAN_SQLITE_SCHEMA_VERSION`, startup aborts fast with `KanbanError('version-mismatch')`.
    - Implemented ordered migration ladder for older schemas (`0 < onDisk < KANBAN_SQLITE_SCHEMA_VERSION`).
    - Stamped `PRAGMA user_version = ${KANBAN_SQLITE_SCHEMA_VERSION}` last on fresh databases (`onDisk === 0`).
    - Added dedicated migration test and newer-version refusal test (`PRAGMA user_version = 999`) to `packages/kanban/kanban-sqlite/tests/schema-migration.spec.ts`.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`hermes_cli/kanban_db.py`, `kanban_db_connect.py`, `kanban_db_graph.py`, `kanban_db_dispatch.py`, `kanban_diagnostics.py`, and orchestrator assets) to accelerate substrate implementation.
