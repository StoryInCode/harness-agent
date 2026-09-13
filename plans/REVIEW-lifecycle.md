# Lifecycle, State, & Reconciliation Review: DeepSeek Harness Plan Set (00–14)

## Verdict

**FAIL (BLOCKING ISSUES FOUND)**

The DeepSeek Harness plan set establishes a high-performance, well-stratified architecture with robust host-plane daemon isolation, comprehensive invariant modeling (`INV-01` through `INV-13`), and effective reuse of core Cordis concepts (`ctx.effect()`, `ScopedLayers`). However, the plan set contains **4 blocking lifecycle and state integrity flaws** (unbounded process and subagent leaks on shutdown/disposal, violation of the Harness SQLite `SCHEMA_VERSION` rule, durable circuit-breaker retry state planned as process-local memory, and orphaned background review subagents on parent cancellation) along with **7 non-blocking lifecycle and configuration gaps**. Furthermore, **Plan 00 (`00-architecture-mapping.md`) carries substantial reconciliation debt** stemming from the rewrite of Plans 03 and 04 for colocated `AGENTS.md` axioms, leaving stale package definitions, deleted event hooks, and obsolete central truth-tree references across multiple tables and sections.

---

## Blocking findings

### 1. Unbounded Out-of-Process CLI and Subagent Process Leaks on Disposal
- **Reference**: `plans/11-agy-subagent-provider.md:305-307` and `plans/12-supervisor-and-watchdog.md:339-349, 524`
- **Issue**:
  1. In Plan 11 (§6.1), when `@deepseek-ai/dsh-subagent-agy` unloads or reloads via Cordis HMR, its effect disposer only unregisters the provider from `ctx.subagents` (`ctx.subagents.registerProvider(...)`). Any running out-of-process `agy` CLI processes spawned via `ctx.subprocess.spawn()` are not tracked in a registry or terminated. They continue running detached in the background, consuming CPU, memory, and LLM tokens.
  2. In Plan 12 (§6.2), when `@deepseek-ai/dsh-supervisor` unloads, its teardown hook clears interval timers and executes `this.activeWatchdogs.clear()`. While Plan 12 line 603 claims *"Clear interval timers, abort subagents, clear in-memory maps"*, the implementation in lines 341–346 does **not** abort subagents. Autonomous Brain re-planning subagents spawned via `ctx.subagents.start(...)` (§8.2, line 524) and independent review subagents are left running indefinitely without a supervisor to collect their verdicts.
- **Fix**:
  1. In `plans/11-agy-subagent-provider.md` §5.2 and §6.1, require `AgySubagentProvider` to maintain an internal set of active child runs (`activeRuns: Set<SubagentRun>`). In the plugin disposer, iterate over all active runs and trigger their abort signals (`run.abort()`), invoking SIGTERM followed by the configured `disposeGraceMs` before SIGKILL.
  2. In `plans/12-supervisor-and-watchdog.md` §6.2, track all active subagent run handles spawned for Brain re-planning or result reviews (`activeSubagents: Map<TaskId, SubagentRun>`). On `ctx.effect` disposal, iterate over all active runs and call `await run.abort()`.

---

### 2. Bypassing Harness SQLite `SCHEMA_VERSION` and `PRAGMA user_version` Rules
- **Reference**: `plans/01-kanban-substrate.md:96, 321-336, 517` and `plans/09-verified-pipeline-and-gates.md:387-400, 460-475, 770`
- **Issue**:
  Harness storage conventions (`packages/storage/storage-sqlite/src/schema.ts:20, 81-105` and `packages/session-query/session-query-sqlite/src/schema.ts:8, 66, 138`) mandate that all SQLite-backed persistence layers:
  1. Export a public compile-time schema version constant: `<NAME>_SCHEMA_VERSION = 1`.
  2. Query `PRAGMA user_version` immediately upon opening the database.
  3. Reject startup if the on-disk schema version is incompatible (`onDisk !== 0 && onDisk !== SCHEMA_VERSION`).
  4. Explicitly stamp `PRAGMA user_version = ${SCHEMA_VERSION}` after materializing tables on a fresh database (`onDisk === 0`).

  Both Plan 01 (`kanban.db`) and Plan 09 (`verification_evidence.db`) introduce independent SQLite databases, but neither plan specifies a `SCHEMA_VERSION` constant, neither plan validates `PRAGMA user_version`, and neither plan stamps the version upon initialization. If a subsequent build changes table DDL, the system will experience silent data corruption or unhandled SQL syntax errors rather than failing fast with an attributable version mismatch.
- **Fix**:
  1. In `plans/01-kanban-substrate.md` §5.1 and §6.1, export `export const KANBAN_SQLITE_SCHEMA_VERSION = 1`. In `SqliteKanbanStore` initialization (`schema.ts`), read `PRAGMA user_version`. If `onDisk !== 0 && onDisk !== KANBAN_SQLITE_SCHEMA_VERSION`, throw a typed `KanbanError('version-mismatch')`. On fresh initialization, execute `PRAGMA user_version = ${KANBAN_SQLITE_SCHEMA_VERSION}` within the table creation transaction.
  2. In `plans/09-verified-pipeline-and-gates.md` §5.1 and §6.1, export `export const VERIFICATION_SQLITE_SCHEMA_VERSION = 1`. In `SqliteVerificationStore` database open logic, apply identical `PRAGMA user_version` validation and stamping.

---

### 3. Circuit Breaker Retry State Loss on Daemon Restart Leading to Infinite Crash Loops
- **Reference**: `plans/12-supervisor-and-watchdog.md:153, 343, 448-456, 524` vs `plans/01-kanban-substrate.md:129`
- **Issue**:
  Plan 12 specifies a circuit breaker (§8.2): when a worker fails or exits abnormally, the supervisor retries the card up to `maxRetries` (default 2); upon exceeding `maxRetries`, it trips the card to `blocked`.
  However, Plan 12 maintains `retryCount` exclusively in-memory inside `activeWatchdogs: Map<TaskId, ActiveWorkerWatchdog>`. When the supervisor process restarts (host daemon restart, systemd unit cycling, or Cordis HMR reload), `activeWatchdogs` is wiped clean.
  Although Plan 01 provides a durable column `tasks.retry_count INTEGER NOT NULL DEFAULT 0` in SQLite (`plans/01-kanban-substrate.md:129`), Plan 12's watchdog assessment ladder (§8.2) does not read or update `tasks.retry_count`. Consequently, a poisoned task that repeatedly crashes the worker or host process will have its retry counter reset to 0 upon every daemon boot, causing an infinite crash-and-restart loop that bypasses the circuit breaker.
- **Fix**:
  In `plans/12-supervisor-and-watchdog.md` §8.1 and §8.2:
  1. Remove transient in-memory retry tracking. When re-dispatching a failed or crashed task, call `await this.kanban.updateTask(task.id, { retryCount: task.retryCount + 1 })`.
  2. In the assessment loop, check `task.retryCount >= this.config.maxRetries` using the durable SQLite task record directly. If exceeded, immediately transition the task to `blocked` with reason `capability` and trigger Brain re-planning.

---

### 4. Orphaned Background Review Subagents on Parent Session Termination
- **Reference**: `plans/06-curator-and-self-learning.md:225-234, 276-288`
- **Issue**:
  Plan 06 (§6.3) spawns an autonomous background review subagent every 10 foreground turns (`nudgeInterval: 10`) via `ctx.subagents.start(this.config.subagentProvider, { ... })`. These review child agents are configured with up to 16 iterations (`reviewMaxIterations: 16`) and 600,000 input tokens (`reviewMaxInputTokens: 600_000`).
  However, Plan 06 establishes **no lifecycle linkage** between the parent agent session and the spawned review subagent. If the parent session is aborted, closed by the user, or encounters a fatal crash while the review agent is reasoning, the review child continues executing detached. It will consume hundreds of thousands of LLM tokens and eventually attempt to commit memory mutations (`USER.md` / `MEMORY.md`) for an agent session that no longer exists.
- **Fix**:
  In `plans/06-curator-and-self-learning.md` §6:
  1. Store the active review subagent run handle keyed by parent session ID (`activeReviews: Map<string, SubagentRun>`).
  2. Subscribe to `session/dispose` or `agent/dispose` in `CuratorRuntime`. When a parent session is disposed or aborted, look up its entry in `activeReviews` and call `await reviewRun.abort()`, cleanly freeing resources and terminating child execution.

---

## Non-blocking findings

### 1. Missing AbortSignal Propagation in Kanban Model Tools
- **Reference**: `plans/02-kanban-interaction-tools.md:120-220`
- **Issue**: Model-facing tools (`kanban_create`, `kanban_claim`, `kanban_complete`, `kanban_block`) receive an execution context containing `exec.signal: AbortSignal`. The tool handlers call `ctx.kanban` methods, but do not pass `signal` down to the storage operations. While SQLite queries are fast, operations acquiring transaction locks or awaiting serial hooks cannot be cleanly aborted when a turn is cancelled by the operator.
- **Fix**: In `plans/01-kanban-substrate.md`, accept optional `signal?: AbortSignal` across all `KanbanStore` public methods. In `plans/02-kanban-interaction-tools.md`, pass `exec.signal` from tool execution calls into `ctx.kanban`.

### 2. Hardcoded Relink Command in Integration Pipeline
- **Reference**: `plans/10-integration-and-pr-engine.md:222-242, 448`
- **Issue**: Plan 10 hardcodes `['pnpm', 'install', '--frozen-lockfile']` during workspace dependency relinking (`src/verify.ts`). While `relinkDependencies: boolean` is configurable in `IntegratorConfig`, the command itself cannot be modified via `cordis.yml`. Heterogeneous repositories (e.g., Python projects using `uv` or `poetry`, or npm/bun workspaces) cannot use the integrator without code modifications.
- **Fix**: In `plans/10-integration-and-pr-engine.md` §5.4, add `relinkCommand: z.array(z.string()).default(['pnpm', 'install', '--frozen-lockfile'])` to `IntegratorConfig`.

### 3. Hardcoded Housekeeping Tick Interval in Memory Curator
- **Reference**: `plans/06-curator-and-self-learning.md:267-273`
- **Issue**: Plan 06 registers a 60-second periodic timer via `setInterval(() => this.tickHousekeeping(), 60_000)`. While `sweepIntervalHours` and `minIdleHours` are configurable, the base evaluation timer interval (60,000 ms) is a hardcoded magic constant. In test environments or high-throughput benchmarks, this prevents fast simulation of curator sweeps.
- **Fix**: In `plans/06-curator-and-self-learning.md` §5.3, add `housekeepingTickIntervalMs: z.number().default(60_000)` to `CuratorConfig`.

### 4. Missing Schemastery Runtime Schema in Local Worktree Manager
- **Reference**: `plans/07-worktree-management.md:333-351`
- **Issue**: Plan 07 defines TypeScript `interface LocalWorktreeConfig` with field definitions and comments, but omits the runtime Schemastery declaration (`export const LocalWorktreeConfig: z<LocalWorktreeConfig> = z.object(...)`). Without the runtime Schemastery object, Cordis configuration validation fails when loading `@deepseek-ai/dsh-worktree-local` from `cordis.yml`.
- **Fix**: In `plans/07-worktree-management.md` §5.3, export the concrete `LocalWorktreeConfig` Schemastery schema alongside the interface.

### 5. Missing Subagent Execution Timeouts in Supervisor Config
- **Reference**: `plans/12-supervisor-and-watchdog.md:142-170, 524`
- **Issue**: Plan 12 defines `replanSubagentProvider` and `reviewSubagentProvider`, but provides no timeout configuration for their execution (`replanTimeoutMs`, `reviewTimeoutMs`). If the delegated subagent stalls due to API quota hangs or infinite tool loops, the supervisor assessment loop will await indefinitely or leave orphaned tasks.
- **Fix**: In `plans/12-supervisor-and-watchdog.md` §5.2, add `replanTimeoutMs: z.number().default(300_000)` and `reviewTimeoutMs: z.number().default(300_000)` to `SupervisorConfig`.

### 6. Missing Stale File Lock Recovery in Memory Subsystem
- **Reference**: `plans/05-memory-and-soul.md:272, 344`
- **Issue**: Plan 05 protects `USER.md` and `MEMORY.md` with file locks using `lockTimeoutMs: 5000`. If a node process is killed ungracefully (`SIGKILL` or power cut) while holding the lock, the `.lock` file remains on disk. If subsequent writers only inspect lockfile existence without checking owning PID liveness or lockfile age, writes will be permanently blocked.
- **Fix**: In `plans/05-memory-and-soul.md` §5.3, specify that `acquireLock` checks lockfile mtime; if the lock is older than `lockTimeoutMs * 2` and the recorded PID is dead (`process.kill(pid, 0)` throws `ESRCH`), the stale lock is safely unlinked.

### 7. Hardcoded Polarity Overlap Threshold in Axiom Consistency Checks
- **Reference**: `plans/03-axiom-subsystem.md:344-364` vs `plans/00-architecture-mapping.md:148`
- **Issue**: Spec §2.7 and Plan 00 specify a 60% token vocabulary overlap threshold for detecting contradictory axioms between scopes. In Plan 03, `AxiomConfig` omits this field, hardcoding `0.6` in `src/consistency.ts`.
- **Fix**: In `plans/03-axiom-subsystem.md` §5.5, add `polarityConflictThreshold: z.number().min(0).max(1).default(0.6)` to `AxiomConfig`.

---

## Stale mapping sections (Plan 00 Reconciliation Debt)

Plans 03 and 04 were rewritten to mandate **colocated `AGENTS.md` axioms** (`AXIOM-COLOCATION.md`), superseding the central compiled truth-registry design (`.hermes/truth/`). Plan 00 (`00-architecture-mapping.md`) was never updated to reflect this shift and contains obsolete packages, invalid event hooks, and stale architectural statements.

The following precise updates must be made to `00-architecture-mapping.md`:

### 1. High-Level Summary (§1, Lines 10 & 13)
- **Line 10**:
  - *Current*: Mention of *"path-scoped axiom prompt injection"*.
  - *Correction*: Change to *"on-demand candidate axiom path discovery"*. Note that runtime prompt injection is natively performed by `@deepseek-ai/dsh-agent-instructions`, while planning-time discovery is provided by `resolve_candidate_axioms`.
- **Line 13**:
  - *Current*: *"26 focused packages organized under packages/<group>/<pkg>/ across 12 functional domains"*.
  - *Correction*: Update count to **24 packages**. Package `@deepseek-ai/dsh-axiom-context` is deleted, and `@deepseek-ai/dsh-axiom-local` is collapsed into `@deepseek-ai/dsh-axiom`.

### 2. Master Mapping Table (§3, Rows 138–151)
- **Row §2.2 (Line 138 - Canonical system axioms)**:
  - *Current*: Service Definition `@deepseek-ai/dsh-axiom`, emits `axioms/recompiled`, references abstract interface.
  - *Correction*: Role is **Service Provider**. Name is `@deepseek-ai/dsh-axiom`. Removes `axioms/recompiled`. Implements `AxiomRegistry`, parses colocated `AGENTS.md` fenced ```` ```axiom ```` blocks, resolves candidate path chains, and manages task axioms in `~/.hermes/task-axioms/`.
- **Row §2.2 (Line 139 - Truth compiler)**:
  - *Current*: Service Provider `@deepseek-ai/dsh-axiom-local`, compiles `.hermes/truth/**/*.yaml` into `.compiled/registry.json`.
  - *Correction*: **DELETE THIS ROW ENTIRELY**. The central truth tree and compilation step are obsolete.
- **Row §2.4 (Line 140 - Path-scoped axiom resolution)**:
  - *Current*: Service Provider `@deepseek-ai/dsh-axiom-local`, reading `.compiled/path_index.json`.
  - *Correction*: Service Provider `@deepseek-ai/dsh-axiom`. Resolves candidate directory containment chains by reusing `dsh-agent-instructions` directory walk primitives (`findProjectRoot`, `ancestorChain`).
- **Row §2.4 (Line 141 - Scoped prompt section injection)**:
  - *Current*: Event-hook plugin `@deepseek-ai/dsh-axiom-context`, consuming `agent/pre-step` to inject section order 200.
  - *Correction*: **DELETE THIS ROW / REPLACE WITH CANDIDATE TOOL**. Package `@deepseek-ai/dsh-axiom-context` is deleted. Replace with Model-facing tool `resolve_candidate_axioms` (`@deepseek-ai/dsh-axiom/tool`), registered on the Agent plane in `hermes-brain` for deliberation during planning. Runtime prompt injection of touched files is delegated to `@deepseek-ai/dsh-agent-instructions`.
- **Row §2.2 (Line 142 - Task axiom storage)**:
  - *Current*: Package assigned is `@deepseek-ai/dsh-axiom-local`.
  - *Correction*: Change package name to `@deepseek-ai/dsh-axiom`.
- **Row §2.7 (Line 148 - Consistency & polarity check)**:
  - *Current*: Package assigned is `@deepseek-ai/dsh-axiom-local`.
  - *Correction*: Change package name to `@deepseek-ai/dsh-axiom`. Checks hierarchical contradictions across parent/child `AGENTS.md` files.
- **Row §2.7 (Line 149 - Diff-to-axiom impact analyzer)**:
  - *Current*: Package assigned is `@deepseek-ai/dsh-axiom-local`.
  - *Correction*: Change package name to `@deepseek-ai/dsh-axiom`. Maps git diff modifications to governing `AGENTS.md` chains.
- **Row §2.7 (Line 151 - Task axiom promotion)**:
  - *Current*: Service Provider `@deepseek-ai/dsh-axiom-local`, promoting to `.hermes/truth/` YAML files.
  - *Correction*: Service Provider `@deepseek-ai/dsh-axiom`. Promotes verified task axioms by appending approved assertions directly into the target artifact's colocated `AGENTS.md`.

### 3. Monorepo Package Directory Tree (§4, Lines 195–200)
- *Current*:
  ```
  ├── axiom/
  │   ├── axiom/               # @deepseek-ai/dsh-axiom (Service Definition)
  │   ├── axiom-local/         # @deepseek-ai/dsh-axiom-local (Service Provider)
  │   ├── axiom-context/       # @deepseek-ai/dsh-axiom-context (Event Hook)
  │   ├── axiom-verifier/      # @deepseek-ai/dsh-axiom-verifier (Service Provider)
  │   └── tool-axiom/          # @deepseek-ai/dsh-tool-axiom (Consumer Tools)
  ```
- *Correction*:
  ```
  ├── axiom/
  │   ├── axiom/               # @deepseek-ai/dsh-axiom (Service Provider: contract, task store, colocated parser, candidate resolver)
  │   ├── axiom-verifier/      # @deepseek-ai/dsh-axiom-verifier (Service Provider: 9 predicate sweeps, INV-01, INV-10)
  │   └── tool-axiom/          # @deepseek-ai/dsh-tool-axiom (Consumer Tools: attach_proof, verify_task_axioms)
  ```

### 4. Package Descriptions (§5, Lines 256–273)
- **Item 5 (`@deepseek-ai/dsh-axiom`)**: Update role to **Service Provider & Contract**. State that it implements `AxiomRegistry`, task axiom store (`~/.hermes/task-axioms/`), colocated markdown block parsing, and candidate path resolution reusing `dsh-agent-instructions`.
- **Item 6 (`@deepseek-ai/dsh-axiom-local`)**: **DELETE**. Note that it is collapsed into `@deepseek-ai/dsh-axiom`.
- **Item 7 (`@deepseek-ai/dsh-axiom-context`)**: **DELETE**. Note that runtime prompt injection is natively performed by `@deepseek-ai/dsh-agent-instructions`.

### 5. Preset Compositions (§7.2, Lines 594–598)
- In `hermes-worker/agent.cordis.yml`, remove:
  ```yaml
  # ── axiom context ───────────────────────────────────────────────────────────
  - id: axiom-context
    name: '@deepseek-ai/dsh-axiom-context'
  ```
- In `hermes-brain/agent.cordis.yml`, declare the planning-time axiom discovery tool:
  ```yaml
  - id: tool-candidate-axioms
    name: '@deepseek-ai/dsh-axiom/tool'
    inject: ['tools', 'axioms']
  ```

### 6. Plan 03 Summary in §9 (Lines 751–755)
- *Current*: Mentions packages `@deepseek-ai/dsh-axiom`, `@deepseek-ai/dsh-axiom-local`, `@deepseek-ai/dsh-axiom-context`.
- *Correction*: Summarize Plan 03 as covering colocated axiom authoring in `AGENTS.md`, `resolve_candidate_axioms` tool, candidate path resolver, and task axiom storage within a single consolidated package `@deepseek-ai/dsh-axiom`.

---

## Confirmed-correct

1. **Host Plane vs. Agent Plane Architectural Stratification**:
   Shared multi-session singletons (`ctx.kanban`, `ctx.worktrees`, `ctx.verification`, `ctx.supervisor`, `ctx.integrator`, `ctx.axioms`, `ctx.memoryCurator`) are strictly placed on the Host Plane in `cordis.patch.yml`. Model-facing tool presentation plugins are strictly mounted on the Agent Plane in presets without leaking services into the global context.
2. **Monotonic Tool Guarding Mechanics**:
   `@deepseek-ai/dsh-guard-resource` (host memory floor 3 GiB and cgroup ceiling) and `@deepseek-ai/dsh-guard-test-pinning` (read-only enforcement on test files) correctly leverage `ctx.tools.guard()` to monotonically reject unsafe tool calls before execution.
3. **Atomic Git Rollback and Cleanliness Guarantees**:
   Plan 10 (`@deepseek-ai/dsh-integrator`) specifies rigorous transactional rollback mechanics (`git reset --keep` and `git merge --abort`) ensuring that failed verification sweeps or interrupted merges never leave the repository in a dirty or detached state.
4. **Colocated Instruction Seam Reuse**:
   Plan 03 correctly identifies and builds upon `@deepseek-ai/dsh-agent-instructions` primitives (`findProjectRoot`, `ancestorChain`, `dedupInstructionFilesByDirectory`, `renderWorkspaceInstructionSet`) rather than re-implementing custom directory walks or duplicate markdown rendering.
5. **Fail-Closed Verification Seam**:
   Plan 04 (`assertAttributableShellCommand`) strictly enforces Invariant `INV-11` by rejecting masked shell exit codes (`|| true`, `; exit 0`, unmonitored backgrounding), guaranteeing that test passes are verifiable and non-hallucinatory.
