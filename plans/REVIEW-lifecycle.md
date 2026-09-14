# Lifecycle, State, & Reconciliation Review: DeepSeek Harness Micro-Gate Corpus (Reconciled)

## Verdict

**PASS (ALL BLOCKING ISSUES RECONCILED IN MICRO-GATE ARCHITECTURE)**

The DeepSeek Harness architecture establishes a well-stratified system with host-plane daemon isolation, comprehensive invariant modeling (`INV-01` through `INV-14`), and effective reuse of core Cordis concepts (`ctx.effect()`, `ScopedLayers`).

All findings are reviewed against the active tree and micro-gate architecture under `plans/pieces/` (Sets 00–06) and `packages/dev-loop/`:

| Review Finding | Original Risk | Resolving Specification / Path | Current Status |
|---|---|---|---|
| **1. Subagent & Subprocess Leaks on Disposal** | Detached orphan processes consuming tokens/RAM | `packages/dev-loop/roles/src/index.ts`, `packages/dev-loop/queue/src/index.ts`, `plans/pieces/01-agent-pool/01.12-request-router.md`, `plans/pieces/01-agent-pool/01.13-automatic-takeover.md` | **RESOLVED** in Set 00 / **OPEN** in Set 01 |
| **2. Bypassing SQLite `SCHEMA_VERSION` Rule** | Silent data corruption on schema changes | `packages/dev-loop/persistence/src/records.ts`, `plans/pieces/02-kanban/02.15-sqlite-relational-persistence.md`, `plans/pieces/06-verification/06.02-verification-storage-domain.md` | **RESOLVED** in Set 00 / **OPEN** in Sets 02 & 06 |
| **3. Circuit Breaker Transient State Loss** | Infinite crash-and-restart loops on reboot | `packages/dev-loop/persistence/src/index.ts`, `plans/pieces/01-agent-pool/01.09-quota-tracker.md`, `plans/pieces/02-kanban/02.15-sqlite-relational-persistence.md` | **RESOLVED** in Set 00 / **OPEN** in Sets 01 & 02 |
| **4. Orphaned Background Review Subagents** | Background review forks persisting past parent session | `plans/pieces/04-memory-soul/04.11-review-fork-dispatcher.md`, `plans/pieces/04-memory-soul/04.12-turn-preemption-controller.md` | **OPEN** (`04.11`, `04.12`) |
| **5. Missing `LocalWorktreeConfig` Schema** | Raw interface without runtime validation | `packages/dev-loop/worktree/src/index.ts`, `plans/pieces/05-worktree-guard/05.12-worktree-local-service.md` | **RESOLVED** in Set 00 / **OPEN** in Set 05 |
| **6. Stale File Lock Recovery** | Deadlock on crashed processes | `plans/pieces/04-memory-soul/04.05-posix-file-lock.md` | **OPEN** (`04.05`) |
| **7. Configurable Housekeeping Ticks** | Hardcoded timers in daemon | `plans/pieces/04-memory-soul/04.10-skill-lifecycle-engine.md` | **OPEN** (`04.10`) |

---

## Analysis of Reconciled Findings

### 1. Subagent and Subprocess Leak Prevention on Disposal
- **Current Owner**: Implemented in `packages/dev-loop/roles/src/index.ts` and `packages/dev-loop/queue/src/index.ts` (`plans/pieces/00-dev-loop/done/00.06c-delegation-dispatch.md`, `plans/pieces/00-dev-loop/done/00.06d-delegation-ledger.md`); specified for pool takeover in `plans/pieces/01-agent-pool/01.12-request-router.md` and `plans/pieces/01-agent-pool/01.13-automatic-takeover.md`.
- **Current Status**: `resolved` in `packages/dev-loop/roles/src/index.ts` and `packages/dev-loop/queue/src/index.ts`; `open` under micro-gates `01.12` and `01.13`.
- **Contract**: Every subagent dispatch registers an `AbortController` and tracks child execution handles in an active registry. On `ctx.effect` disposal, all active handles are aborted with SIGTERM and grace timeouts before unmounting.

---

### 2. Bypassing Harness SQLite `SCHEMA_VERSION` and `PRAGMA user_version` Rules
- **Current Owner**: Implemented in `packages/dev-loop/persistence/src/records.ts` (`plans/pieces/00-dev-loop/done/00.12b-sqlite-state-schema.md`); specified in `plans/pieces/02-kanban/02.15-sqlite-relational-persistence.md` and `plans/pieces/06-verification/06.02-verification-storage-domain.md`.
- **Current Status**: `resolved` in `packages/dev-loop/persistence/src/records.ts`; `open` under micro-gates `02.15` and `06.02`.
- **Contract**: Harness persistence layers (`packages/storage/storage-sqlite/src/schema.ts`, `packages/session-query/session-query-sqlite/src/schema.ts`) mandate export of compile-time `SCHEMA_VERSION`, validation of `PRAGMA user_version` on startup, rejection of version mismatches (`onDisk !== 0 && onDisk !== SCHEMA_VERSION`), and version stamping on fresh initialization. `plans/pieces/02-kanban/02.15-sqlite-relational-persistence.md` exports `KANBAN_SQLITE_SCHEMA_VERSION = 1`, and `plans/pieces/06-verification/06.02-verification-storage-domain.md` exports `VERIFICATION_DOMAIN_VERSION = 1`.

---

### 3. Circuit Breaker Retry State Loss on Daemon Restart Leading to Infinite Crash Loops
- **Current Owner**: Implemented in `packages/dev-loop/persistence/src/index.ts` (`plans/pieces/00-dev-loop/done/00.12a-write-ahead-intent.md` through `00.12d-anomaly-quarantine.md`); specified in `plans/pieces/01-agent-pool/01.09-quota-tracker.md`, `plans/pieces/01-agent-pool/01.10-exhaustion-classifier.md`, and `plans/pieces/02-kanban/02.15-sqlite-relational-persistence.md`.
- **Current Status**: `resolved` in `packages/dev-loop/persistence/src/index.ts`; `open` under micro-gates `01.09`, `01.10`, and `02.15`.
- **Contract**: Retry counters and failure states are persisted in durable SQLite/storage tables rather than in-memory maps. Tasks exceeding retry limits transition monotonically to blocked states with attributable defect logs, surviving process restarts and daemon cycling.

---

### 4. Orphaned Background Review Subagents on Parent Session Termination
- **Current Owner**: `plans/pieces/04-memory-soul/04.11-review-fork-dispatcher.md`, `plans/pieces/04-memory-soul/04.12-turn-preemption-controller.md`, and `plans/pieces/04-memory-soul/04.13-review-governance-gates.md`.
- **Current Status**: `open` under micro-gates `04.11`, `04.12`, and `04.13`.
- **Contract**: Background review child agents launched via `ctx.subagents.start('spawn', ...)` maintain explicit parent lifecycle linkage. `ReviewForkDispatcher.abortReviewForSession(parentSessionId)` aborts in-flight review runs when the parent session is disposed, preventing detached token consumption.

---

## Non-blocking findings

### 1. Missing AbortSignal Propagation in Kanban Model Tools
- **Current Owner**: `plans/pieces/02-kanban/02.01-kanban-service-definition.md` and `plans/pieces/02-kanban/02.14-model-kanban-tools.md`.
- **Current Status**: `open` under micro-gates `02.01` and `02.14`. (In Set 00, `AbortSignal` propagation is `resolved` in `packages/dev-loop/roles/src/tool.ts` and `packages/dev-loop/approval/src/index.ts`).
- **Contract**: Model-facing tool handlers receive `exec.signal` and forward it directly into storage operations and hook executions to guarantee cancellation responsiveness.

### 2. Hardcoded Relink Command in Integration Pipeline
- **Current Owner**: Mainline transfer in `plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md` and `packages/dev-loop/gates/src/runner.ts`.
- **Current Status**: `resolved` in `packages/dev-loop/gates/src/runner.ts`.
- **Contract**: Verification commands and workspace dependency checks are parameterized rather than hardcoded to a fixed package manager invocation.

### 3. Hardcoded Housekeeping Tick Interval in Memory Curator
- **Current Owner**: `plans/pieces/04-memory-soul/04.10-skill-lifecycle-engine.md`.
- **Current Status**: `open` under micro-gate `04.10`.
- **Contract**: `LifecycleConfig` declares `housekeepingTickIntervalMs: number` (default 60,000) allowing test suites and high-throughput environments to configure evaluation timer intervals.

### 4. Missing Schemastery Runtime Schema in Local Worktree Manager
- **Current Owner**: `packages/dev-loop/worktree/src/index.ts` and `plans/pieces/05-worktree-guard/05.12-worktree-local-service.md`.
- **Current Status**: `resolved` in `packages/dev-loop/worktree/src/index.ts`; `open` under micro-gate `05.12`.
- **Contract**: Worktree configuration exports a concrete Schemastery runtime schema `LocalWorktreeConfig` alongside static interfaces for Cordis config validation.

### 5. Missing Subagent Execution Timeouts in Supervisor Config
- **Current Owner**: `packages/dev-loop/roles/src/index.ts`, `packages/dev-loop/queue/src/index.ts`, `plans/pieces/00-dev-loop/done/00.06a-specialist-roles.md`, `plans/pieces/01-agent-pool/01.12-request-router.md`, and `plans/pieces/04-memory-soul/04.11-review-fork-dispatcher.md`.
- **Current Status**: `resolved` in `packages/dev-loop/roles/src/index.ts` and `packages/dev-loop/queue/src/index.ts`; `open` under micro-gates `01.12` and `04.11`.
- **Contract**: Delegated subagent executions specify explicit timeouts (`replanTimeoutMs`, `reviewTimeoutMs`, queue lease limits) to prevent indefinite awaits during API stalls.

### 6. Missing Stale File Lock Recovery in Memory Subsystem
- **Current Owner**: `plans/pieces/04-memory-soul/04.05-posix-file-lock.md`.
- **Current Status**: `open` under micro-gate `04.05`.
- **Contract**: `MemoryFileLock.acquireLock` checks lockfile mtime; if the lock exceeds `lockTimeoutMs * 2` and the recorded PID is dead (`process.kill(pid, 0)` throws `ESRCH`), the stale lock is unlinked safely.

### 7. Hardcoded Polarity Overlap Threshold in Axiom Consistency Checks
- **Current Owner**: `plans/pieces/03-axioms/03.07-hierarchy-consistency-analyzer.md`.
- **Current Status**: `open` under micro-gate `03.07`.
- **Contract**: `HierarchyConsistencyAnalyzer` performs scope consistency analysis across directory containment chains with explicit override annotations (`overrides: <id>`).

---

## Reconciliation of Superseded Architecture Debt

The active specification corpus under `plans/pieces/` (Sets 00–06) structures system architecture into decentralized micro-gates conforming to `plans/pieces/PIECE-FORMAT.md`. Centralized truth-registry and monolithic plan mappings are superseded by colocated rules:

1. **Colocated `AGENTS.md` Axioms**:
   Axiom definitions are colocated directly within Markdown instruction files and parsed via `plans/pieces/03-axioms/03.02-fenced-axiom-parser.md` and resolved via `plans/pieces/03-axioms/03.04-candidate-path-resolver.md`.
2. **Consolidated Scope Resolution**:
   Path-scoped constraint discovery is owned by `@deepseek-ai/dsh-axiom` reusing `@deepseek-ai/dsh-agent-instructions` directory walk primitives.
3. **Decentralized Package Hierarchy**:
   Subsystem capabilities are mapped directly to focused packages within `packages/` rather than monolithic multi-domain singletons.

---

## Confirmed-correct

1. **Host Plane vs. Agent Plane Stratification**:
   Shared multi-session singletons (`ctx.devLoopLifecycle`, `ctx.devLoopWorktree`, `ctx.devLoopPersistence`) are mounted on the Host Plane in bundle patches (`packages/bundle/base/cordis.patch.yml`). Model-facing tools are mounted on the Agent Plane in presets (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml`) without leaking services into global scope.
2. **Monotonic Tool Guarding Mechanics**:
   Loop-hygiene guards (`packages/guard/repeat-tool-reminder/src/index.ts`) and role execution limits leverage `ctx.tools.guard()` to monotonically reject unsafe tool calls before execution.
3. **Atomic Git Rollback and Cleanliness Guarantees**:
   `packages/dev-loop/worktree/src/git.ts` and `plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md` enforce clean worktree lifecycles, ensuring failed verifications or interruptions never leave dirty working trees.
4. **Colocated Instruction Seam Reuse**:
   `packages/dev-loop/references/src/sources.ts` and `packages/dev-loop/references/src/parser.ts` reuse `@deepseek-ai/dsh-agent-instructions` conventions for directory walks and repository root discovery.
5. **Fail-Closed Verification Seam**:
   `packages/dev-loop/gates/src/runner.ts` and `plans/pieces/06-verification/06.03-attributable-shell-parser.md` enforce attributable command execution (`INV-11`), rejecting masked exit codes and unmonitored commands.
