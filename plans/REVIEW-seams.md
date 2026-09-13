# Architecture Seams, Planes, and Composition Review

## Verdict
FAIL — 2 blocking findings, 3 non-blocking findings.

The overall plane separation is largely well-conceived, correctly placing multi-session daemons and registries (`ctx.kanban`, `ctx.axioms`, `ctx.verification`, `ctx.worktrees`, `ctx.supervisor`, `ctx.integrator`) on the Host Plane in `cordis.patch.yml` and keeping session-scoped model tools on the Agent Plane. However, the plan set contains two critical composition failures:
1. Two Cordis `Service` providers (`@deepseek-ai/dsh-ledger` and `@deepseek-ai/dsh-axiom`) are mounted directly inside the agent preset `hermes-brain/agent.cordis.yml` outside an `isolate` realm. At runtime, `mountPreset` will catch leaked process-global services and abort agent mounting with a fatal error.
2. Plan 05 invents a redundant tool package `@deepseek-ai/dsh-tool-session-search` that duplicates the existing `@deepseek-ai/dsh-tool-session-query` already present in `packages/session-query/tool-session-query`.

---

## Blocking findings

### 1. Accidental Service Provider Leakage in Preset (`hermes-brain/agent.cordis.yml`)
- **Location**: `plans/14-presets-profiles-and-bundle.md:341-348`, `plans/13-outcome-ledger.md:464-475`, `plans/03-axiom-subsystem.md:386-395`
- **Violation**: PRESET-RULES Rule 3 (`PRESET-RULES.md:7`), Rule 4 (`PRESET-RULES.md:10`), and runtime invariant in `packages/preset/agent-presets/src/mount.ts:407-412`.
- **Details**:
  In `plans/14-presets-profiles-and-bundle.md` (lines 341–348), `hermes-brain/agent.cordis.yml` mounts:
  ```yaml
  - id: tool-ledger
    name: '@deepseek-ai/dsh-ledger'

  - id: tool-axiom-explore
    name: '@deepseek-ai/dsh-axiom'
  ```
  Both `@deepseek-ai/dsh-ledger` and `@deepseek-ai/dsh-axiom` are already registered as singleton services on the Host Plane in `packages/bundle/hermes-base/cordis.patch.yml` (lines 185 and 267). Both packages default-export a subclass of Cordis `Service` (`OutcomeLedger extends Service` and `AxiomRegistry extends Service`), publishing `'ledger'` and `'axioms'`.
  When `dsh-agent-presets` mounts `hermes-brain`, `mountPreset` runs `leakedServices(agentCtx, fiber)`. Because these two rows sit outside an `isolate` realm, `mountPreset` throws:
  ```
  row(s) published process-global service(s) [ledger, axioms]; a preset service must sit behind an `isolate` realm or move to the host composition
  ```
  Agent initialization fails immediately and tears down the fiber.
- **Exact Fix**:
  1. For axioms: Change line 347 in `plans/14-presets-profiles-and-bundle.md` to mount the dedicated tool entry `@deepseek-ai/dsh-axiom/tool` (specified in `plans/03-axiom-subsystem.md:393`) or `@deepseek-ai/dsh-tool-axiom`, which registers `resolve_candidate_axioms` into `ctx.tools` on session context without publishing a Cordis `Service`.
  2. For ledger: Update `plans/13-outcome-ledger.md` and `plans/14-presets-profiles-and-bundle.md` to split model tools (`ledger_show`, `ledger_update`) and the prompt section (`ledger:intake-policy`) into a tool plugin `@deepseek-ai/dsh-tool-ledger` (or subpath export `@deepseek-ai/dsh-ledger/tool`). The tool plugin injects `['tools', 'ledger', 'systemPrompt']` without extending `Service`. Update line 343 of `plans/14-presets-profiles-and-bundle.md` to:
     ```yaml
     - id: tool-ledger
       name: '@deepseek-ai/dsh-tool-ledger'
     ```

---

### 2. Custom Package Duplicating Existing `dsh-tool-session-query`
- **Location**: `plans/05-memory-and-soul.md:62, 90-120`, `plans/14-presets-profiles-and-bundle.md:395-400`
- **Violation**: Check 3 (Custom mechanisms duplicating an existing Harness capability) and Monorepo Reuse Mandate (`packages/AGENTS.md:11`).
- **Details**:
  Plan 05 specifies creating `@deepseek-ai/dsh-tool-session-search` in `packages/memory/tool-session-search/` to register the `session_search` model tool against `ctx.sessionQuery`.
  However, `@deepseek-ai/dsh-tool-session-query` already exists in `packages/session-query/tool-session-query/` (`packages/session-query/tool-session-query/src/index.ts:65-73`). It already exports the exact model tool `session_search` with identical parameters and config schema (`maxSearchResults`, `searchTimeoutMs`), delegating directly to `ctx.sessionQuery.searchSessions()`.
  Creating `@deepseek-ai/dsh-tool-session-search` introduces code duplication, maintenance overhead, and potential tool name collisions on `ctx.tools.register('session_search')`.
- **Exact Fix**:
  Delete `@deepseek-ai/dsh-tool-session-search` from Plan 05. In `plans/14-presets-profiles-and-bundle.md` line 396, replace `@deepseek-ai/dsh-tool-session-search` with the existing `@deepseek-ai/dsh-tool-session-query`:
  ```yaml
  - id: tool-session-search
    name: '@deepseek-ai/dsh-tool-session-query'
    config:
      maxSearchResults: 20
      searchTimeoutMs: 15000
  ```

---

## Non-blocking findings

### 1. Isolated `workflowEngine` Provided Without Consumer in `hermes-brain`
- **Location**: `plans/14-presets-profiles-and-bundle.md:350-390`
- **Details**:
  `hermes-brain/agent.cordis.yml` defines group `delegation` with `isolate: { workflowEngine: true }` and mounts `@deepseek-ai/dsh-workflow-worker-thread`. This starts an entry-local `WorkflowEngine` service. However, neither `@deepseek-ai/dsh-tool-workflow` nor `@deepseek-ai/dsh-tool-ralph` is mounted in the preset. The subagent tools inside the group (`tool-subagent`, `tool-subagent-fork`, `tool-subagent-agy`) consume host `ctx.subagents`, not `workflowEngine`. As a result, `workflowEngine` is an idle service instance with no consumer.
- **Fix**:
  If the Brain Orchestrator is intended to author multi-subagent orchestration scripts, mount `- id: tool-workflow, name: '@deepseek-ai/dsh-tool-workflow'` inside the `delegation` group. If orchestrator uses only direct subagent calls (`subagent`, `subagent_agy`), remove `workflow-worker-thread` and the `workflowEngine: true` isolate key from `delegation`.

### 2. Invalid Preset Syntax and Erroneous Preset-Wide Realm in Plan 07
- **Location**: `plans/07-worktree-management.md:381-391`
- **Details**:
  Plan 07 section 7 includes a code snippet purporting to configure `presets/hermes-worker/agent.cordis.yml`:
  ```yaml
  $isolate: { name: true }
  - $path: '@deepseek-ai/dsh-tool-fs'
  - $path: '@deepseek-ai/dsh-tool-bash'
  ```
  `$isolate` and `$path` are not valid Cordis plugin entries. Furthermore, putting the entire worker preset inside an isolate realm would break PRESET-RULE 5 by preventing worker tools from resolving host services (`ctx.kanban`, `ctx.axioms`, `ctx.verification`). Plan 14 correctly avoided this mistake, but Plan 07 remains misleading.
- **Fix**:
  Update `plans/07-worktree-management.md` lines 381–391 to remove `$isolate` and show standard Cordis entries inheriting `session.header.cwd`.

### 3. Worker Preset Lacks Session Search Tool
- **Location**: `plans/14-presets-profiles-and-bundle.md:449-550`
- **Details**:
  `hermes-worker` mounts `tool-memory` (`@deepseek-ai/dsh-tool-memory`) for reading notes, but lacks session search (`@deepseek-ai/dsh-tool-session-query`). While workers primarily operate on card contracts and worktree files, workers troubleshooting complex build/environment failures may benefit from searching past session executions.
- **Fix**:
  Explicitly note in Plan 14 whether omitting session search from workers is an intentional token-budget optimization (recommended) or add `tool-session-query` to `hermes-worker`.

---

## Realm audit table

| Realm (`isolate` map) | Preset | Provider rows inside realm | Consumer rows inside realm | Correct? | Explanation / Status |
|---|---|---|---|---|---|
| `{ planMode: true }` | `hermes-brain` (`planning`) | `plan-mode` (`@deepseek-ai/dsh-plan-mode`) | `plan-mode` (self-contained state) | **Yes** | Per PRESET-RULE 10, plan mode is per-agent state and belongs in an entry-local realm. |
| `{ workflowEngine: true }` | `hermes-brain` (`delegation`) | `workflow-worker-thread` (`@deepseek-ai/dsh-workflow-worker-thread`) | None (omits `tool-workflow`) | **Partial** | Subagent tools inside the group resolve host `ctx.subagents` correctly (not isolated), but `workflowEngine` has no consumer. Non-blocking. |
| `{ compaction: true, toolResultPruner: true }` | `hermes-brain` (`compaction`) | `compaction-basic` (`dsh-compaction-basic`), `tool-result-pruner` (`dsh-compaction-tool-result-pruner`) | `command-compact`, `tool-result-pruner` | **Yes** | Pruner state and compaction history stay entry-local per session, matching reference PTC preset. |
| `{ compaction: true, toolResultPruner: true }` | `hermes-worker` (`compaction`) | `compaction-basic` (`dsh-compaction-basic`), `tool-result-pruner` (`dsh-compaction-tool-result-pruner`) | `command-compact`, `tool-result-pruner` | **Yes** | Standard entry-local compaction isolation for worker sessions. |
| *(None / Root)* | `hermes-brain` (`tool-ledger`) | `@deepseek-ai/dsh-ledger` (provides `ctx.ledger`) | Brain orchestrator | **NO (Fatal)** | Service provider mounted in preset outside an isolate realm. Causes `leakedServices()` mount failure. |
| *(None / Root)* | `hermes-brain` (`tool-axiom-explore`) | `@deepseek-ai/dsh-axiom` (provides `ctx.axioms`) | Brain orchestrator | **NO (Fatal)** | Service provider mounted in preset outside an isolate realm. Causes `leakedServices()` mount failure. |

---

## Confirmed-correct

1. **Host-Plane Distribution Bundle (`packages/bundle/hermes-base/cordis.patch.yml`)**:
   Correctly places all 12 multi-session infrastructure services on the root container (`ctx.kanban`, `ctx.axioms`, `ctx.axiomVerifier`, `ctx.memory`, `ctx.memoryCurator`, `ctx.worktrees`, `ctx.resourceGuard`, `ctx.verification`, `ctx.integrator`, `subagent-agy`, `ctx.supervisor`, `ctx.ledger`). This honors PRESET-RULES Rule 2, 6, 7, and 8.

2. **External agy CLI Subagent Provider (Plan 11)**:
   Strictly adheres to Harness subagent provider architecture. `@deepseek-ai/dsh-subagent-agy` implements `SubagentProvider`, registers on host `ctx.subagents`, sets `capabilities.depthLimit = false`, and uses `ctx.subprocess.spawn` rather than shell execution. Preset consumes it via standard `@deepseek-ai/dsh-tool-subagent` with `provider: agy`, `backgroundMode: one-shot`, and `maxDepth: provider-managed`.

3. **Autonomous Supervisor Daemon (Plan 12)**:
   Correctly designed as a pure host daemon (`ctx.supervisor`) with zero model-visible tools. Consumes Cordis events (`agent/request-error`, `kanban/task-status`, `integrator/merged`) and executes state checks via injected host services.

4. **Resource Guard & Admission Control (Plan 08)**:
   Registered on host `ctx.tools.guard()`. Monotonically protects the entire process and all concurrent worker agents against cgroup memory starvation and unauthorized `SOUL.md` edits (`INV-09`).

5. **Verified Pipeline & Pinning Guards (Plan 09)**:
   Clean separation between host-plane evidence storage (`SqliteVerificationStore` in WAL mode) and agent-plane execution guards (`guard-test-pinning` via `ctx.tools.guard()` and `verification-stop` via `agent/turn-stopping`).

6. **Colocated Task & System Axioms (Plan 03)**:
   Faithfully implements the `AXIOM-COLOCATION.md` directive. Colocates axioms in `AGENTS.md` and `CLAUDE.md` files next to governed packages and integrates with `@deepseek-ai/dsh-agent-instructions`, avoiding obsolete central truth tree abstractions.
