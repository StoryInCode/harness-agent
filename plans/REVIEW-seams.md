# Architecture Seams, Planes, and Composition Review (Reconciled)

## Verdict

**PASS (ALL BLOCKING ISSUES RECONCILED IN MICRO-GATE ARCHITECTURE)**

The overall plane separation establishes clean boundaries, placing multi-session daemons and registries on the Host Plane in `packages/bundle/base/cordis.patch.yml` and keeping session-scoped model tools on the Agent Plane in `packages/preset/agent-presets/presets/ptc/agent.cordis.yml`.

All findings from earlier macro architectures are reconciled and verified against the current repository and micro-gate corpus (`plans/pieces/` Sets 00–06 and `packages/dev-loop/`):

---

## Blocking findings

### 1. Accidental Service Provider Leakage in Preset
- **Current Owner**: `plans/pieces/03-axioms/03.05-candidate-axioms-tool.md`, `plans/pieces/03-axioms/03.16-preset-composition-patch.md`, `plans/pieces/04-memory-soul/04.15-memory-preset-composition.md`, `plans/pieces/00-dev-loop/00.14b-brain-preset-tools.md`, and `packages/preset/agent-presets/presets/ptc/agent.cordis.yml`.
- **Current Status**: `resolved` in specification architecture and verified in shipped presets.
- **Details**:
  In the active architecture, service providers (`AxiomRegistry`, `DevLoopPersistence`, etc.) are mounted exclusively on the Host Plane in `packages/bundle/base/cordis.patch.yml`. Agent presets mount dedicated tool packages (`@deepseek-ai/dsh-tool-candidate-axioms`, `@deepseek-ai/dsh-tool-memory`) without extending Cordis `Service`. Shipped presets (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml`, `packages/preset/agent-presets/presets/standard/agent.cordis.yml`) isolate per-session services inside entry-local `isolate` realms (`planning`, `compaction`, `delegation`), satisfying PRESET-RULES and avoiding `leakedServices` fatal errors in `packages/preset/agent-presets/src/mount.ts`.

---

### 2. Custom Package Duplicating Existing `dsh-tool-session-query`
- **Current Owner**: `plans/pieces/04-memory-soul/04.08-session-query-consumer.md` and `packages/session-query/tool-session-query/src/index.ts`.
- **Current Status**: `resolved`.
- **Details**:
  `plans/pieces/04-memory-soul/04.08-session-query-consumer.md` directly consumes the existing `@deepseek-ai/dsh-tool-session-query` package from `packages/session-query/tool-session-query/src/index.ts` instead of creating a redundant package. It configures `maxSearchResults: 20` and `searchTimeoutMs: 15000` against host `ctx.sessionQuery`, preventing duplication and tool registration collisions.

---

## Non-blocking findings

### 1. Isolated `workflowEngine` Provided Without Consumer in Presets
- **Current Owner**: `packages/preset/agent-presets/presets/standard/agent.cordis.yml` and `packages/preset/agent-presets/presets/ptc/agent.cordis.yml`.
- **Current Status**: `resolved`.
- **Details**:
  In `packages/preset/agent-presets/presets/standard/agent.cordis.yml`, the `delegation` group mounts `workflow-worker-thread` inside `isolate: { workflowEngine: true }` alongside its direct consumers `tool-workflow` (`@deepseek-ai/dsh-tool-workflow`) and `tool-ralph` (`@deepseek-ai/dsh-tool-ralph`). In `packages/preset/agent-presets/presets/ptc/agent.cordis.yml`, `tool-ralph` consumes `workflowEngine` while `tool-workflow` is disabled to prefer model-authored TypeScript in PTC mode.

### 2. Invalid Preset Syntax and Erroneous Preset-Wide Realm
- **Current Owner**: `plans/pieces/05-worktree-guard/05.19-worktree-guard-presets.md` and `packages/dev-loop/worktree/src/index.ts`.
- **Current Status**: `resolved`.
- **Details**:
  `plans/pieces/05-worktree-guard/05.19-worktree-guard-presets.md` mounts `LocalWorktreeManager` on the Host Plane in `packages/bundle/base/cordis.patch.yml`. Worker presets contain zero host-service rows and use standard Cordis entries inheriting `SessionHeader.cwd` without invalid `$isolate` or `$path` syntax. In Set 00, `packages/dev-loop/worktree/src/index.ts` operates as a clean host-plane singleton.

### 3. Worker Preset Lacks Session Search Tool
- **Current Owner**: `plans/pieces/04-memory-soul/04.15-memory-preset-composition.md` and `plans/pieces/04-memory-soul/04.08-session-query-consumer.md`.
- **Current Status**: `resolved`.
- **Details**:
  `plans/pieces/04-memory-soul/04.15-memory-preset-composition.md` confirms that omitting session search from worker presets is an intentional token-budget optimization. Workers execute against card contracts and worktree files rather than searching historical transcripts.

---

## Realm audit table

| Realm (`isolate` map) | Preset | Provider rows inside realm | Consumer rows inside realm | Correct? | Explanation / Status |
|---|---|---|---|---|---|
| `{ planMode: true }` | `ptc` (`planning`) | `plan-mode` (`@deepseek-ai/dsh-plan-mode`) | `plan-mode` (self-contained state) | **Yes** | Per PRESET-RULES, plan mode is per-agent state and belongs in an entry-local realm. |
| `{ workflowEngine: true }` | `standard` (`delegation`) | `workflow-worker-thread` (`@deepseek-ai/dsh-workflow-worker-thread`) | `tool-workflow`, `tool-ralph` | **Yes** | `workflowEngine` is isolated and consumed by `tool-workflow` and `tool-ralph`. |
| `{ compaction: true, toolResultPruner: true }` | `ptc` (`compaction`) | `compaction-basic` (`@deepseek-ai/dsh-compaction-basic`), `tool-result-pruner` (`@deepseek-ai/dsh-compaction-tool-result-pruner`) | `command-compact`, `tool-result-pruner` | **Yes** | Pruner state and compaction history stay entry-local per session. |
| `{ compaction: true, toolResultPruner: true }` | `standard` (`compaction`) | `compaction-basic` (`@deepseek-ai/dsh-compaction-basic`), `tool-result-pruner` (`@deepseek-ai/dsh-compaction-tool-result-pruner`) | `command-compact`, `tool-result-pruner` | **Yes** | Standard entry-local compaction isolation. |
| *(None / Root Host)* | `base` bundle patch | Host services in `packages/bundle/base/cordis.patch.yml` | Shipped presets and host bus | **Yes** | Host singletons mount globally without leaking into preset scopes. |

---

## Confirmed-correct

1. **Host-Plane Distribution Bundle (`packages/bundle/base/cordis.patch.yml`)**:
   Places multi-session infrastructure services on the root container (`ctx.devLoopLifecycle`, `ctx.devLoopWorktree`, `ctx.devLoopPersistence`, `ctx.storageDomain`), complying with PRESET-RULES.
2. **External Subagent Provider Integration**:
   Subagent providers implement `SubagentProvider`, register on host `ctx.subagents` (`packages/subagent/subagent/src/index.ts`), and presets consume them via `@deepseek-ai/dsh-tool-subagent`.
3. **Autonomous Supervisor and Lifecycle Daemons**:
   Lifecycle managers are pure host services (`packages/dev-loop/lifecycle/src/index.ts`, `packages/dev-loop/persistence/src/index.ts`) with zero model-visible tools.
4. **Resource Guard & Admission Control**:
   Guards are registered on host `ctx.tools.guard()` (`packages/guard/repeat-tool-reminder/src/index.ts`, `plans/pieces/05-worktree-guard/05.18-resource-guard-service.md`), protecting processes from resource exhaustion.
5. **Verified Pipeline & Pinning Guards**:
   Clean separation between evidence storage (`packages/dev-loop/persistence/src/records.ts`, `plans/pieces/06-verification/06.02-verification-storage-domain.md`) and execution gates (`packages/dev-loop/gates/src/runner.ts`, `plans/pieces/06-verification/06.09-green-gate-evaluator.md`).
6. **Colocated Task & System Axioms**:
   Axioms are colocated in `AGENTS.md` and integrated with `@deepseek-ai/dsh-agent-instructions` (`plans/pieces/03-axioms/03.02-fenced-axiom-parser.md`, `plans/pieces/03-axioms/03.04-candidate-path-resolver.md`), avoiding central truth tree abstractions.
