# Architecture & Contract Review: DeepSeek Harness Micro-Gate Corpus (Reconciled)

## Verdict

**PASS (ALL BLOCKING ISSUES RECONCILED IN MICRO-GATE ARCHITECTURE)**

The DeepSeek Harness architecture establishes a coherent Cordis substrate with strict host/agent plane separation, complete isolation of mutable agent state, and reuse of existing Harness primitives (`packages/session-query/session-query-sqlite`, `packages/core/tools`, `packages/shell/shell`).

The active specification corpus is organized into micro-gate sets under `plans/pieces/` (Sets 00–06), supported by the implemented development-loop base in `packages/dev-loop/`. All 10 architectural findings are reviewed against this active tree:

| Review Finding | Original Risk | Resolving Specification / Path | Current Status |
|---|---|---|---|
| **1. Missing `kanban/pre-complete` Hook** | Invariant `INV-01` bypassed on `done` | `packages/dev-loop/lifecycle/src/index.ts`, `plans/pieces/02-kanban/02.16-pre-complete-verification-gates.md`, `plans/pieces/03-axioms/03.12-no-unproven-done-gate.md` | **RESOLVED** in Set 00 / **OPEN** in Sets 02 & 03 |
| **2. Overlapping Auto-Todo Generation** | Divergent paths and duplicate implementations | `plans/pieces/03-axioms/03.14-auto-todo-generator.md` & `plans/pieces/03-axioms/03.15-continuation-packet-compiler.md` | **OPEN** (`03.14`, `03.15`) |
| **3. Preset Audit Failure (Axiom Service Leak)** | Leaked root service provider in preset | `plans/pieces/03-axioms/03.05-candidate-axioms-tool.md` & `plans/pieces/03-axioms/03.16-preset-composition-patch.md` | **RESOLVED** (spec) / **OPEN** (`03.05`, `03.16`) |
| **4. Implementation Order Inversion** | Circular / inverted macro plan dependencies | `plans/pieces/PIECE-FORMAT.md`, `packages/dev-loop/lifecycle/package.json` | **RESOLVED** |
| **5. Class Name `OutcomeLedger`** | Name mismatch across callers | `packages/dev-loop/roles/src/records.ts`, `packages/dev-loop/persistence/src/index.ts`, `plans/pieces/02-kanban/02.05-verification-rollup.md` | **OBSOLETE** |
| **6. Plane Separation for Tools** | Service vs tool row mixing | `packages/dev-loop/roles/src/tool.ts`, `packages/dev-loop/claims/src/tool.ts`, `plans/pieces/02-kanban/02.14-model-kanban-tools.md`, `plans/pieces/03-axioms/03.05-candidate-axioms-tool.md`, `plans/pieces/04-memory-soul/04.07-model-tool-memory.md` | **RESOLVED** |
| **7. Duplicate Anti-Cheat Shell Parser** | Regex/AST fragmentation for `INV-11` | `plans/pieces/06-verification/06.03-attributable-shell-parser.md`, `plans/pieces/03-axioms/03.10-anti-cheat-shell-seam.md`, `plans/pieces/06-verification/06.15-anti-cheat-masked-exit.md` | **OPEN** (`06.03`) |
| **8. `releaseClaim` Parameter Arity** | Missing audit reason parameter | `packages/dev-loop/lifecycle/src/index.ts`, `plans/pieces/00-dev-loop/done/00.02b-cas-claim-writer.md`, `plans/pieces/02-kanban/02.04-three-state-lifecycle.md` | **RESOLVED** in Set 00 / **OPEN** (`02.04`) |
| **9. Pre-Merge Verification Caller** | Ambiguous caller for `assertTaskProven` | `plans/pieces/03-axioms/03.12-no-unproven-done-gate.md`, `plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md`, `packages/dev-loop/gates/src/runner.ts` | **RESOLVED** (spec) / **OPEN** (`00.10d`, `03.12`) |
| **10. `kanban_attachments` Exposure** | Omitted from tool catalog | `plans/pieces/02-kanban/02.14-model-kanban-tools.md` | **OBSOLETE** |

---

## Analysis of Reconciled Findings

### 1. Serial Hook in Kanban Substrate Enforcing Invariant `INV-01` (No Unproven Done)
- **Current Owner**: In the development loop, `packages/dev-loop/lifecycle/src/index.ts` awaits `this.ctx.serial('piece/pre-complete', record)` before moving a piece to `done/` (`plans/pieces/00-dev-loop/done/00.02c-pre-complete-hook.md`). In the kanban specification, `plans/pieces/02-kanban/02.16-pre-complete-verification-gates.md` and `plans/pieces/03-axioms/03.12-no-unproven-done-gate.md` define `'kanban/pre-complete'` interception.
- **Current Status**: `resolved` in `packages/dev-loop/lifecycle/src/index.ts`; `open` under micro-gates `02.16` (`plans/pieces/02-kanban/02.16-pre-complete-verification-gates.md`) and `03.12` (`plans/pieces/03-axioms/03.12-no-unproven-done-gate.md`).
- **Contract**:
  `KanbanStore` declares `'kanban/pre-complete': (task: Task) => Promise<void> | void` in Cordis events. Before committing a status transition to `done`, `KanbanStore.transitionTask` awaits `ctx.serial('kanban/pre-complete', task)`. Any rejection halts the transition and marks the card with an unproven blocker.

---

### 2. Overlapping Responsibility and Storage Divergence: Auto-Todo Generation
- **Current Owner**: `plans/pieces/03-axioms/03.14-auto-todo-generator.md` and `plans/pieces/03-axioms/03.15-continuation-packet-compiler.md`.
- **Current Status**: `open` under micro-gates `03.14` (`plans/pieces/03-axioms/03.14-auto-todo-generator.md`) and `03.15` (`plans/pieces/03-axioms/03.15-continuation-packet-compiler.md`).
- **Contract**:
  Auto-todo file generation is consolidated into a single host service `AutoTodoGenerator` (`@deepseek-ai/dsh-axiom-auto-todo`), writing failure briefs via `ctx.fs` and optional card commentary via `ctx.kanban`. No competing generator exists in other subsystems.

---

### 3. Preset Audit Failure: Candidate Axioms Tool Row Points to Root Service Provider
- **Current Owner**: `plans/pieces/03-axioms/03.05-candidate-axioms-tool.md` and `plans/pieces/03-axioms/03.16-preset-composition-patch.md`.
- **Current Status**: `resolved` in specification; `open` under micro-gates `03.05` (`plans/pieces/03-axioms/03.05-candidate-axioms-tool.md`) and `03.16` (`plans/pieces/03-axioms/03.16-preset-composition-patch.md`).
- **Contract**:
  Host service providers mount on the host plane in `packages/bundle/base/cordis.patch.yml`. Agent-plane presets mount the dedicated tool package `@deepseek-ai/dsh-tool-candidate-axioms` (providing `resolve_candidate_axioms`) without extending Cordis `Service`, satisfying `packages/preset/agent-presets/src/mount.ts` audit invariants.

---

### 4. Implementation-Order Inversion: Plan 12 Depends on Plan 13
- **Current Owner**: `plans/pieces/PIECE-FORMAT.md` and dependency headers across Sets 00–06.
- **Current Status**: `resolved` in `plans/pieces/00-dev-loop/` through `plans/pieces/06-verification/` and `packages/dev-loop/lifecycle/package.json`.
- **Contract**:
  All micro-gate specifications declare an acyclic DAG via explicit `Depends on:` metadata. Substrate packages compile without circular references, and coordination layers discover optional services dynamically via `ctx.get()`.

---

## Non-blocking findings

### 5. Contract Drift: Class Name `OutcomeLedger` vs `OutcomeLedgerService`
- **Current Owner**: `packages/dev-loop/roles/src/records.ts`, `packages/dev-loop/persistence/src/index.ts`, and `plans/pieces/02-kanban/02.05-verification-rollup.md`.
- **Current Status**: `obsolete`.
- **Contract**:
  The separate monolithic `OutcomeLedger` class does not exist in the active architecture. Delegation outcomes are recorded by `DelegationLedger` in `packages/dev-loop/roles/src/records.ts` (`plans/pieces/00-dev-loop/done/00.06d-delegation-ledger.md`), lifecycle state is persisted by `DevLoopPersistence` in `packages/dev-loop/persistence/src/index.ts` (`plans/pieces/00-dev-loop/done/00.12b-sqlite-state-schema.md`), and kanban task rollups are managed by `plans/pieces/02-kanban/02.05-verification-rollup.md`.

---

### 6. Host Plane vs Agent Plane Service Separation for Tools
- **Current Owner**: `packages/dev-loop/roles/src/tool.ts`, `packages/dev-loop/claims/src/tool.ts`, `plans/pieces/02-kanban/02.14-model-kanban-tools.md`, `plans/pieces/03-axioms/03.05-candidate-axioms-tool.md`, and `plans/pieces/04-memory-soul/04.07-model-tool-memory.md`.
- **Current Status**: `resolved` in code (`packages/dev-loop/roles/src/tool.ts`, `packages/dev-loop/claims/src/tool.ts`) and specification architecture.
- **Contract**:
  Agent-facing tools are isolated into dedicated tool plugins (e.g. `@deepseek-ai/dsh-tool-kanban`, `@deepseek-ai/dsh-tool-candidate-axioms`, `@deepseek-ai/dsh-tool-memory`) mounted in agent presets (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml`), while host services mount exclusively on the host plane (`packages/bundle/base/cordis.patch.yml`).

---

### 7. Duplicated Anti-Cheat Shell Parser Logic (`INV-11`)
- **Current Owner**: `plans/pieces/06-verification/06.03-attributable-shell-parser.md`, `plans/pieces/03-axioms/03.10-anti-cheat-shell-seam.md`, and `plans/pieces/06-verification/06.15-anti-cheat-masked-exit.md`.
- **Current Status**: `open` under micro-gate `06.03` (`plans/pieces/06-verification/06.03-attributable-shell-parser.md`).
- **Contract**:
  `@deepseek-ai/dsh-verification-shell-parser` is the sole authoritative lexer and AST parser for shell command attributability under `INV-11`. The axiom verification seam (`plans/pieces/03-axioms/03.10-anti-cheat-shell-seam.md`) imports from this shared parser rather than duplicating regex heuristics.

---

### 8. Contract Drift: `ctx.kanban.releaseClaim` Parameter Arity
- **Current Owner**: `packages/dev-loop/lifecycle/src/index.ts` (`plans/pieces/00-dev-loop/done/00.02b-cas-claim-writer.md`) and `plans/pieces/02-kanban/02.04-three-state-lifecycle.md`.
- **Current Status**: `resolved` in `packages/dev-loop/lifecycle/src/index.ts`; `open` under micro-gate `02.04` (`plans/pieces/02-kanban/02.04-three-state-lifecycle.md`).
- **Contract**:
  `packages/dev-loop/lifecycle/src/index.ts` verifies claim CAS transitions using explicit reason, session, and hash parameters. In the kanban specification, `plans/pieces/02-kanban/02.04-three-state-lifecycle.md` governs card status transitions (`todo`, `pending`, `done`) with `transitionCard(id, to, reason?)`, eliminating the legacy 9-state arity mismatch.

---

### 9. Pre-Merge Verification Caller: Ambiguous Caller for `assertTaskProven`
- **Current Owner**: `plans/pieces/03-axioms/03.12-no-unproven-done-gate.md`, `plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md`, and `packages/dev-loop/gates/src/runner.ts`.
- **Current Status**: `resolved` in specification; `open` under micro-gates `00.10d` (`plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md`) and `03.12` (`plans/pieces/03-axioms/03.12-no-unproven-done-gate.md`).
- **Contract**:
  `assertTaskProven` is awaited by the `'kanban/pre-complete'` serial hook (`plans/pieces/03-axioms/03.12-no-unproven-done-gate.md`) during card completion. In Set 00, Gate 4 mainline transfer verification is executed by `packages/dev-loop/gates/src/runner.ts` before worktree changes land on the mainline.

---

### 10. Omission of `kanban_attachments` in Tool Catalog
- **Current Owner**: `plans/pieces/02-kanban/02.14-model-kanban-tools.md`.
- **Current Status**: `obsolete`.
- **Contract**:
  The micro-gate architecture intentionally replaces low-level CRUD attachment tools with 5 focused domain-level tools in `plans/pieces/02-kanban/02.14-model-kanban-tools.md` (`kanban_stage_subtasks`, `kanban_get_card`, `kanban_update_tasks_md`, `kanban_complete_subtask`, `kanban_override_task`). Attachment inspection is unified under `kanban_get_card`.

---

## Contract drift table

| Symbol / Concept | Defined In | Cited In | Mismatch | Current Resolution | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `'kanban/pre-complete'` (Cordis serial event) | `plans/pieces/02-kanban/02.01-kanban-service-definition.md` | `plans/pieces/02-kanban/02.16-pre-complete-verification-gates.md`, `plans/pieces/03-axioms/03.12-no-unproven-done-gate.md` | Missing serial hook in legacy macro plans | Implemented as `piece/pre-complete` in `packages/dev-loop/lifecycle/src/index.ts`; specified for kanban in `02.16` and `03.12` | **RESOLVED** (Set 00) / **OPEN** (`02.16`, `03.12`) |
| `AutoTodoGenerator` | `plans/pieces/03-axioms/03.14-auto-todo-generator.md` | `plans/pieces/03-axioms/03.15-continuation-packet-compiler.md` | Duplicate generators across sweeper and ledger | Unified in `@deepseek-ai/dsh-axiom-auto-todo` under `03.14` | **OPEN** (`03.14`) |
| Candidate Axiom Preset Entry | `plans/pieces/03-axioms/03.05-candidate-axioms-tool.md` | `plans/pieces/03-axioms/03.16-preset-composition-patch.md` | Leaked root service provider in agent presets | Uses dedicated tool plugin `@deepseek-ai/dsh-tool-candidate-axioms` | **RESOLVED** (spec) / **OPEN** (`03.05`) |
| Outcome Ledger Preset Entry | `packages/dev-loop/persistence/src/index.ts` | `plans/pieces/00-dev-loop/00.14b-brain-preset-tools.md` | Host service mounted in agent preset | Replaced by `DevLoopPersistence` host service and scoped tool rows | **RESOLVED** |
| Outcome Ledger Service Class Name | `packages/dev-loop/roles/src/records.ts` | `packages/dev-loop/persistence/src/index.ts` | Class name collision (`OutcomeLedger` vs `OutcomeLedgerService`) | Replaced by `DelegationLedger` and `DevLoopPersistence` | **OBSOLETE** |
| Anti-cheat exit code parser (`INV-11`) | `plans/pieces/06-verification/06.03-attributable-shell-parser.md` | `plans/pieces/03-axioms/03.10-anti-cheat-shell-seam.md`, `plans/pieces/06-verification/06.15-anti-cheat-masked-exit.md` | Duplicate shell regex parsers | Canonicalized in `@deepseek-ai/dsh-verification-shell-parser` | **OPEN** (`06.03`) |
| `KanbanStore.releaseClaim` | `packages/dev-loop/lifecycle/src/index.ts` | `plans/pieces/02-kanban/02.04-three-state-lifecycle.md` | Missing reason parameter in recovery table | CAS claim transitions enforce explicit reasons; kanban uses 3-state lifecycle | **RESOLVED** (Set 00) / **OPEN** (`02.04`) |
| Pre-merge axiom verification caller | `plans/pieces/03-axioms/03.12-no-unproven-done-gate.md` | `plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md`, `packages/dev-loop/gates/src/runner.ts` | Ambiguous caller for `assertTaskProven` | Bound to `'kanban/pre-complete'` serial event; Gate 4 runs transfer checks | **RESOLVED** (spec) / **OPEN** (`00.10d`, `03.12`) |
| `kanban_attachments` tool exposure | `plans/pieces/02-kanban/02.14-model-kanban-tools.md` | `plans/pieces/02-kanban/02.14-model-kanban-tools.md` | Omitted from tool catalog | Replaced by domain tool `kanban_get_card` | **OBSOLETE** |

---

## Confirmed-correct

1. **Plane Separation & Cordis Scoping**:
   Host plane singletons (`ctx.devLoopLifecycle`, `ctx.devLoopWorktree`, `ctx.devLoopPersistence`, `ctx.storageDomain`) are mounted globally on the root container in bundle patches (`packages/bundle/base/cordis.patch.yml`). Per-session tools (`tool-fs`, `tool-subagent`, `tool-todo`) are mounted inside agent presets (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml`) without publishing unisolated root services, complying with `packages/preset/agent-presets/src/mount.ts`.
2. **Session Isolation & Isolate Realms**:
   Session-mutable services (`@deepseek-ai/dsh-plan-mode` under `isolate: { planMode: true }`, `@deepseek-ai/dsh-workflow-worker-thread` under `isolate: { workflowEngine: true }`) are isolated into entry-local groups in `packages/preset/agent-presets/presets/ptc/agent.cordis.yml` and `packages/preset/agent-presets/presets/standard/agent.cordis.yml`, preventing state leakage across concurrent sessions.
3. **No Package-Level Dependency Cycles**:
   The package dependency graph across `packages/dev-loop/` is strictly acyclic (`packages/dev-loop/references` -> `packages/dev-loop/claims` -> `packages/dev-loop/gates` -> `packages/dev-loop/lifecycle`). Downstream coordination packages discover optional capabilities dynamically via `ctx.get()`.
4. **Harness Monorepo Reuse**:
   Historical session search delegates directly to `@deepseek-ai/dsh-tool-session-query` (`packages/session-query/tool-session-query/src/index.ts`) and `@deepseek-ai/dsh-session-query-sqlite`. Persona customization reuses `@deepseek-ai/dsh-persona` (`packages/preset/persona`).
5. **Privilege Decoupling for Git Operations**:
   Git operations that inspect, add, or clean worktrees are encapsulated in host services (`packages/dev-loop/worktree/src/git.ts`, `plans/pieces/05-worktree-guard/05.02-git-subprocess-runner.md`), shielding model tools from direct merge authority or destructive branch mutations.
