# Architecture & Contract Review: DeepSeek Harness Plan Set (00–14)

## Verdict

**FAIL (BLOCKING ISSUES FOUND)**

The architecture plan set establishes a coherent, production-grade Cordis substrate with excellent host/agent plane separation, strict isolation of mutable agent state, and thoughtful reuse of existing Harness primitives (`dsh-session-query-sqlite`, `dsh-tools`, `dsh-shell`). However, there are **4 blocking architectural and contractual flaws** (a missing serial hook contract breaking `INV-01`, a severe responsibility collision and path divergence in auto-todo generation, a preset row pointing to a service provider that will fail Cordis preset audits, and an implementation-order inversion) along with **6 non-blocking contract drifts** that must be resolved prior to implementation.

---

## Blocking findings

### 1. Missing Serial Hook in Kanban Substrate Breaking Invariant `INV-01` (No Unproven Done)
- **Reference**: `plans/04-axiom-verification-sweeper.md:61-62, 246` vs `plans/01-kanban-substrate.md:238-251, 272`
- **Issue**: Plan 04 enforces invariant `INV-01` / `M-009` (No Unproven Done) by intercepting task completion transitions via a Cordis serial event:
  > "1. `KanbanStore` declares `'kanban/pre-complete': (task: Task) => Promise<void> | void` in Cordis `Events` (`plans/01-kanban-substrate.md:217`)."
  > "2. Before committing a status transition to `done`, `KanbanStore.transitionTask` awaits `ctx.serial('kanban/pre-complete', task)`."

  However, examining `plans/01-kanban-substrate.md` reveals that `kanban/pre-complete` is **nowhere to be found**. In `01-kanban-substrate.md:238-251`, `interface Events` only declares `task-created`, `task-updated`, `task-status`, `claim-acquired`, `claim-released`, `task-blocked`, `task-unblocked`, `dependency-linked`, `dependency-unlinked`, `heartbeat-tick`, `comment-posted`, and `diagnostic-warning`. Furthermore, `KanbanStore.transitionTask()` in Plan 01 contains no `ctx.serial` interception. Any card can be marked `done` directly, completely bypassing the axiom verifier.
- **Fix**:
  1. In `plans/01-kanban-substrate.md` §5.2 (`interface Events`), add:
     ```typescript
     'kanban/pre-complete': (task: Task) => Promise<void> | void
     ```
  2. In `plans/01-kanban-substrate.md` §5.2 and §6.1, specify that `transitionTask(id, to, metadata)` must execute:
     ```typescript
     if (to === 'done') {
       await this.ctx.serial('kanban/pre-complete', task)
     }
     ```
     before committing status mutations to SQLite.

---

### 2. Overlapping Responsibility and Storage Divergence: Auto-Todo Generation
- **Reference**: `plans/04-axiom-verification-sweeper.md:29, 104, 438, 543, 578` vs `plans/13-outcome-ledger.md:116, 135, 273-278, 685`
- **Issue**: Both Plan 04 and Plan 13 claim full implementation of auto-todo file generation on sweep failure, with diverging paths, classes, and configurations:
  - Plan 04 builds `AutoTodoGenerator` (`packages/axiom/axiom-verifier/src/auto-todo.ts`), creates files at `~/.hermes/auto-todos/<task_id>-unsatisfied-todo.md`, and exposes config `autoTodosDir: '~/.hermes/auto-todos'`.
  - Plan 13 claims auto-todos are part of the founder outcome ledger subsystem: `OutcomeLedger.generateAutoTodo` (`packages/ledger/ledger/src/auto-todo.ts`), persisting to `~/.hermes/task-requested/auto-todos/<task_id>.md`. Plan 13 §3 explicitly asserts: *"Sweeper detects failure; Ledger formats and persists auto-todos/<id>.md"*.

  This creates two duplicate implementations of the same capability writing markdown files into two different directories on disk.
- **Fix**: Consolidate auto-todo creation into `@deepseek-ai/dsh-ledger` (Plan 13). Remove `AutoTodoGenerator` and `autoTodosDir` from Plan 04. In Plan 04, when `AxiomVerifier` detects unproven or failing axioms during a background sweep, it should dynamically call `this.ctx.get('ledger')?.generateAutoTodo({ taskId, ... })` and log a kanban comment.

---

### 3. Preset Audit Failure: Candidate Axioms Tool Row Points to Root Service Provider
- **Reference**: `plans/14-presets-profiles-and-bundle.md:346-347` vs `plans/03-axiom-subsystem.md:392-394`
- **Issue**: Plan 03 properly separates the host-plane service (`@deepseek-ai/dsh-axiom`, providing `ctx.axioms` via `AxiomRegistry`) from the agent-plane tool row (`@deepseek-ai/dsh-axiom/tool`, providing `resolve_candidate_axioms`). Plan 03 §7 specifies:
  ```yaml
  - id: tool-candidate-axioms
    name: '@deepseek-ai/dsh-axiom/tool'
    inject: ['tools', 'axioms']
  ```
  However, Plan 14 §7.2 (`hermes-brain/agent.cordis.yml`) drifts and declares:
  ```yaml
  - id: tool-axiom-explore
    name: '@deepseek-ai/dsh-axiom'
  ```
  Because `@deepseek-ai/dsh-axiom`'s root export is `AxiomRegistry extends Service`, loading `@deepseek-ai/dsh-axiom` in `agent.cordis.yml` attempts to publish a Cordis service inside a preset without an `isolate` realm. Under Harness PRESET-RULE 1 (`packages/preset/agent-presets/src/mount.ts:407-412`), `mountPreset` triggers an immediate fatal audit failure. Furthermore, it violates `plane-separation.test.ts` by mounting the host plugin row on the agent plane.
- **Fix**: In `plans/14-presets-profiles-and-bundle.md` §7.2, align with Plan 03:
  ```yaml
  - id: tool-candidate-axioms
    name: '@deepseek-ai/dsh-axiom/tool'
    inject: ['tools', 'axioms']
  ```

---

### 4. Implementation-Order Inversion: Plan 12 Depends on Plan 13
- **Reference**: `plans/12-supervisor-and-watchdog.md:70, 102, 234, 333` vs `plans/13-outcome-ledger.md`
- **Issue**: Plan 12 (§2.2, §3, §6.1, §7.3) explicitly depends on the outcome ledger service (`ctx.ledger.checkMilestoneAxioms(taskId)` and `OutcomeLedger`) defined in Plan 13 to perform §5.11 milestone outcome verification upon `integrator/merged` events. In a sequential plan execution (01 through 14), Plan 12 cannot compile its type definitions, satisfy its unit tests, or run integration tests without the contracts introduced in Plan 13.
- **Fix**: Invert the dependency numbering or order of execution: implement Plan 13 (`13-outcome-ledger.md`) *before* Plan 12 (`12-supervisor-and-watchdog.md`), and update `plans/00-architecture-mapping.md` §15 dependency table to reflect that Supervisor depends on Outcome Ledger. Alternatively, make Plan 12's `MilestoneClosureValidator` a dynamically loaded extension that is only bound when `ctx.ledger` is present.

---

## Non-blocking findings

### 5. Contract Drift: Class Name `OutcomeLedger` vs `OutcomeLedgerService`
- **Reference**: `plans/12-supervisor-and-watchdog.md:333` vs `plans/13-outcome-ledger.md:262`
- **Issue**: Plan 12 cites the service class as `OutcomeLedgerService`:
  ```typescript
  ctx.get('ledger'): OutcomeLedgerService (plans/13-outcome-ledger.md)
  ```
  However, Plan 13 defines the class as:
  ```typescript
  export abstract class OutcomeLedger extends Service
  ```
- **Fix**: Update Plan 12:333 to reference `OutcomeLedger`.

---

### 6. Host Plane vs Agent Plane Service Separation for Outcome Ledger
- **Reference**: `plans/13-outcome-ledger.md:468-475` and `plans/14-presets-profiles-and-bundle.md:266-267, 342-343`
- **Issue**: In Plan 14, `cordis.patch.yml` mounts:
  ```yaml
  - id: ledger
    name: '@deepseek-ai/dsh-ledger'
  ```
  And `hermes-brain/agent.cordis.yml` mounts:
  ```yaml
  - id: tool-ledger
    name: '@deepseek-ai/dsh-ledger'
  ```
  Like Finding 3, `@deepseek-ai/dsh-ledger` cannot serve simultaneously as a root host-plane `Service` and an unisolated agent-plane tool contributor under the same import specifier without violating PRESET-RULE 1 and `scripts/verify-cordis-config.ts` plane separation checks.
- **Fix**: Export the agent-facing tools (`ledger_show`, `ledger_update`) and intake prompt section from a dedicated subpath (e.g. `@deepseek-ai/dsh-ledger/tool`) or separate package `@deepseek-ai/dsh-tool-ledger`, matching the pattern established for `dsh-tool-kanban`, `dsh-tool-memory`, and `dsh-tool-axiom`.

---

### 7. Duplicated Anti-Cheat Shell Parser Logic (`INV-11`)
- **Reference**: `plans/04-axiom-verification-sweeper.md:261-282` vs `plans/09-verified-pipeline-and-gates.md:25, 129, 164, 344`
- **Issue**: Both Plan 04 and Plan 09 implement standalone parsers to enforce Invariant `INV-11` (anti-cheat detection of masked exit codes `|| true`, `; exit 0`, unmonitored pipes, and backgrounding `&`):
  - Plan 04: `assertAttributableShellCommand` in `packages/axiom/axiom-verifier/src/anti-cheat.ts`.
  - Plan 09: `assertAttributableCommand` and `VerificationStore.isExitStatusAttributable` in `packages/verification/verification-sqlite/src/shell-parser.ts`.
- **Fix**: Designate `@deepseek-ai/dsh-verification` as the authoritative owner of shell attributability parsing. Have Plan 04 import `assertAttributableCommand` from `@deepseek-ai/dsh-verification` rather than maintaining a duplicate regular expression parser.

---

### 8. Contract Drift: `ctx.kanban.releaseClaim` Parameter Arity
- **Reference**: `plans/12-supervisor-and-watchdog.md:596` vs `plans/01-kanban-substrate.md:277`
- **Issue**: Plan 12 recovery table states:
  > `Release claim via ctx.kanban.releaseClaim(taskId)`
  However, Plan 01 declares:
  ```typescript
  abstract releaseClaim(id: TaskId, reason: string): Promise<Task>
  ```
  The `reason` parameter is mandatory for audit trail logging.
- **Fix**: Change the invocation in Plan 12:596 to:
  ```typescript
  ctx.kanban.releaseClaim(taskId, 'Worker process crash or heartbeat expired')
  ```

---

### 9. Contract Drift: Plan 04 Claims Integrator Directly Invokes `assertTaskProven`
- **Reference**: `plans/04-axiom-verification-sweeper.md:66, 89` vs `plans/10-integration-and-pr-engine.md:42` vs `plans/12-supervisor-and-watchdog.md:67, 101`
- **Issue**: Plan 04 states:
  > "6. Downstream components (e.g. `@deepseek-ai/dsh-integrator`, Plan 10) invoke `ctx.axiomVerifier.assertTaskProven(taskId)` as a public service method prior to git merge commit generation."
  However, Plan 10 does not inject or call `ctx.axiomVerifier`. Plan 10:42 explicitly excludes axiom proof verification, delegating it to the supervisor daemon (`ctx.supervisor`, Plan 12), which calls `ctx.axiomVerifier.verifyTask(taskId)` before invoking `ctx.integrator.integrateCard`.
- **Fix**: Update Plan 04 §2.2 and §3 to state that `ctx.supervisor` (Plan 12) invokes the verifier at the post-completion review gate prior to merge integration.

---

### 10. Omission of `kanban_attachments` in Plan 14 Tool Catalog
- **Reference**: `plans/14-presets-profiles-and-bundle.md:562` vs `plans/02-kanban-interaction-tools.md:33, 194, 351, 362`
- **Issue**: Plan 02 registers both `kanban_attach` and `kanban_attachments` for inspecting file attachments on cards. Plan 14 §9.1 includes `kanban_attach` in its tool summary table but omits `kanban_attachments`.
- **Fix**: Add `kanban_attachments` to the Exposed Tools list in Plan 14 §9.1.

---

## Contract drift table

| Symbol / Concept | Defined In | Cited In | Mismatch | Correct Form |
| :--- | :--- | :--- | :--- | :--- |
| `'kanban/pre-complete'` (Cordis serial event) | `plans/04-axiom-verification-sweeper.md:61, 246` (claims defined in Plan 01) | `plans/04-axiom-verification-sweeper.md:61-62`, `plans/09-verified-pipeline-and-gates.md:666` | Declared missing from `plans/01-kanban-substrate.md:238-251`; `transitionTask` does not await `ctx.serial` | Add `'kanban/pre-complete': (task: Task) => Promise<void> \| void` to Plan 01 `Events`, and await in `transitionTask(id, 'done')` |
| `AutoTodoGenerator` vs `OutcomeLedger.generateAutoTodo` | `plans/04-axiom-verification-sweeper.md:104, 438` and `plans/13-outcome-ledger.md:116, 273` | `plans/13-outcome-ledger.md:116` cites Plan 04 sweeper invoking Ledger; Plan 04 implements own generator | Duplicate implementations with divergent paths (`~/.hermes/auto-todos/` vs `~/.hermes/task-requested/auto-todos/`) | Plan 13 owns `generateAutoTodo`; Plan 04 calls `ctx.get('ledger')?.generateAutoTodo()` |
| Candidate Axiom Preset Entry | `plans/03-axiom-subsystem.md:392-394` (`@deepseek-ai/dsh-axiom/tool`, id: `tool-candidate-axioms`) | `plans/14-presets-profiles-and-bundle.md:346-347` (`@deepseek-ai/dsh-axiom`, id: `tool-axiom-explore`) | Plan 14 points preset row to root service provider package without isolate realm, violating PRESET-RULE 1 | Id: `tool-candidate-axioms`, Name: `'@deepseek-ai/dsh-axiom/tool'` |
| Outcome Ledger Preset Entry | `plans/13-outcome-ledger.md:468-470` (`@deepseek-ai/dsh-ledger`, id: `tool-ledger`) | `plans/14-presets-profiles-and-bundle.md:342-344` (`@deepseek-ai/dsh-ledger`, id: `tool-ledger`) | Same package name mounted in host bundle (`cordis.patch.yml`) and agent preset (`agent.cordis.yml`), violating PRESET-RULE 1 | Use subpath `@deepseek-ai/dsh-ledger/tool` or package `@deepseek-ai/dsh-tool-ledger` |
| Outcome Ledger Service Class Name | `plans/13-outcome-ledger.md:262` (`class OutcomeLedger`) | `plans/12-supervisor-and-watchdog.md:333` | Cited as `OutcomeLedgerService` in Plan 12 | `OutcomeLedger` |
| Anti-cheat exit code parser (`INV-11`) | `plans/04-axiom-verification-sweeper.md:267` (`assertAttributableShellCommand`) | `plans/09-verified-pipeline-and-gates.md:25, 344` (`assertAttributableCommand`, `isExitStatusAttributable`) | Duplicate regular expression / AST shell parsers enforcing `INV-11` in two separate packages | Canonicalize in `@deepseek-ai/dsh-verification` and reuse in Plan 04 |
| `KanbanStore.releaseClaim` | `plans/01-kanban-substrate.md:277` (`releaseClaim(id, reason)`) | `plans/12-supervisor-and-watchdog.md:596` | Plan 12 table omits required `reason` parameter | `ctx.kanban.releaseClaim(taskId, reason)` |
| Pre-merge axiom verification caller | `plans/04-axiom-verification-sweeper.md:66` (claims Plan 10 Integrator calls `assertTaskProven`) | `plans/10-integration-and-pr-engine.md:42`, `plans/12-supervisor-and-watchdog.md:67` | Plan 10 does not call `axiomVerifier`; Plan 12 Supervisor calls `ctx.axiomVerifier.verifyTask` | Update Plan 04 to designate `ctx.supervisor` as caller |
| `kanban_attachments` tool exposure | `plans/02-kanban-interaction-tools.md:33, 194` | `plans/14-presets-profiles-and-bundle.md:562` | Omitted from Plan 14 Exposed Tools catalog | Include `kanban_attachments` in Plan 14 §9.1 |

---

## Confirmed-correct

1. **Plane Separation & Cordis Scoping**:
   - Host plane singletons (`ctx.kanban`, `ctx.worktrees`, `ctx.resourceGuard`, `ctx.verification`, `ctx.integrator`, `ctx.supervisor`) are correctly mounted globally on the root container without per-session re-instantiation.
   - Per-session tools and guards (`tool-kanban`, `tool-axiom`, `guard-test-pinning`, `verification-stop`) are mounted inside agent presets without publishing root services, strictly complying with `PRESET-RULES.md`.
2. **Session Isolation & Isolate Realms**:
   - Session-mutable services (`dsh-plan-mode` under `isolate: { planMode: true }`, `workflow-worker-thread` under `isolate: { workflowEngine: true }`) are correctly isolated into entry-local groups per PRESET-RULE 2 and 3, preventing state pollution across concurrent sessions.
3. **No Package-Level Dependency Cycles**:
   - The planned package dependency graph is strictly acyclic. Substrate packages (`dsh-kanban`, `dsh-axiom`, `dsh-worktree`, `dsh-verification`) have zero circular imports. Downstream coordination packages (`dsh-supervisor`, `dsh-integrator`, `dsh-ledger`) dynamically discover optional capabilities via `ctx.get()`, avoiding cyclic package.json links.
4. **Harness Monorepo Reuse**:
   - Historical session search (`session_search`) delegates cleanly to the existing `@deepseek-ai/dsh-session-query-sqlite` FTS5 index without creating a duplicate SQLite database.
   - Persona customization properly reuses `@deepseek-ai/dsh-persona`.
   - Tool execution guards strictly reuse `ctx.tools.guard()` and monotonic rejection layers.
5. **Privilege Decoupling for Git Operations**:
   - Git operations that mutate repository branches, land merge commits, or interact with remotes are strictly encapsulated inside the host-plane `IntegratorService` (Plan 10) driven by the supervisor or CLI, completely shielding model tools from direct merge authority.
