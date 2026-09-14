# 14 — Presets, Profiles, and Bundle Configuration

## Features

- Turn-key `hermes-brain` agent preset composing Claude Opus 4.8 orchestration, Kanban management, and outcome tracking
- Turn-key `hermes-worker` agent preset composing sandboxed execution, BDD test-pinning, and verification stops
- Host-plane distribution bundle `@deepseek-ai/dsh-hermes-base` mounting all background engines and shared substrate services
- Production profile template `hermes` launching standard web, headless, and CLI environments under the Application Launch Rule
- Strict isolation realms preventing session cross-talk across plan mode, context compaction, and worker thread workflows
- Zero-leakage scoped tool catalogs isolating brain governance tools from worker engineering execution environments
- In-process subagent role synthesis realizing test-writer, implementer, and reviewer personas via dynamic tool filtering
- Standing mount reuse caching parsed preset configurations across multiple concurrent sessions per process
- Fail-loud mount assertions rejecting accidental service leaks into the root realm and unregistered dependencies
- Automated CI and boot validation verifying bundle manifests, plane separation, and Cordis schema rules

## 1. Purpose

This plan defines the composition flagship of the DeepSeek Harness adaptation for StoryInCode Hermes: the host bundle `@deepseek-ai/dsh-hermes-base`, the shipped agent presets `hermes-brain` and `hermes-worker`, the application profile `hermes`, and multi-session scoped registration and plane-separation contracts.

- **What it owns**:
  - The host distribution bundle `@deepseek-ai/dsh-hermes-base` (`packages/bundle/hermes-base/`) providing the host-plane `cordis.patch.yml` that mounts all shared substrate services (Plans 01, 03–13).
  - The authoritative agent-plane compositions for Hermes: `packages/preset/agent-presets/presets/hermes-brain/` (`agent.cordis.yml`, `preset.yml`) and `packages/preset/agent-presets/presets/hermes-worker/` (`agent.cordis.yml`, `preset.yml`).
  - The shipped application profile template `hermes` in `packages/boot/app-boot/src/profile.ts` (`PROFILE_TEMPLATES.hermes`), ensuring startup under the Application Launch Rule (`docs/architecture.md:41-48`).
  - Scoped catalog partitioning and isolation boundaries: ensuring per-session tool isolation via `ScopedLayers`, standing scope caching per file stamp, and entry-local service isolation (`isolate: { <name>: true }`).
  - Subagent role realization: configuring child worker delegation via the in-process subagent driver's `persona` and `toolFilter` hooks, realizing test-writer, implementer, and reviewer roles without duplicate preset directories.
  - Manifest and configuration verification: enforcing `scripts/verify-cordis-config.ts` rules for bare-plugin dependencies, plane separation, and `!!js` constraints.
- **What it deliberately does NOT own**:
  - Substrate service implementations: SQLite stores, git worktree operations, cgroup monitors, or ledger persistence (owned by Plans 01–13).
  - Model transport or LLM routing: owned by `@deepseek-ai/dsh-llm` and host model providers.
  - Web UI frontend presentation: owned by `@deepseek-ai/dsh-web-app`.
  - Command-line parsing: owned by `apps/cli`.

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `hermes-brain` & `hermes-worker`: **Agent Preset Compositions** (`packages/preset/agent-presets/presets/`). Evaluated by `@deepseek-ai/dsh-agent-presets`, mounted under an agent's scoped context (`[kScope]: standing.key`) (`packages/preset/agent-presets/src/preset.ts:34-55`).
- `@deepseek-ai/dsh-hermes-base`: **Installable Profile Bundle Patch Layer** (`packages/bundle/hermes-base/`). Declares `dsh.bundle.patch: "./cordis.patch.yml"` to mount host services over root `cordis.yml` (`packages/boot/app-boot/src/profile.ts:9-10`).
- `hermes`: **Profile Template** in `PROFILE_TEMPLATES` (`packages/boot/app-boot/src/profile.ts:105-126`) resolved by `dsh --profile hermes`.
- Child Workers: **Subagent Consumer Specialization** via `composeFrom()`, `persona`, and `toolFilter` on `SubagentStartInput` (`packages/subagent/subagent-in-process-driver/src/index.ts:134-160`).

### 2.2 Why These Primitives and Not the Neighbours
- **Why Presets and not Skills**: Skills (`@deepseek-ai/dsh-skill`) are on-demand markdown playbooks (`SKILL.md`) injected into prompt context during a turn. They cannot compose Cordis plugins, mount entry-local isolate realms, register execution guards (`ctx.tools.guard`), or provision tool catalogs. Presets define the execution environment itself (`packages/preset/agent-presets/README.md:32-35`).
- **Why an Installable Bundle and not Direct Cordis Config**: Under the Harness profile architecture (`docs/architecture.md:21-25`), root `cordis.yml` is `[]`. System infrastructure is composed via ordered bundle patch layers (`dsh.profile.bundles`). Packaging Hermes substrate rows into `@deepseek-ai/dsh-hermes-base` preserves patchability, versioned dependency resolution, and headless/web reuse without modifying `@deepseek-ai/dsh-base`.
- **Why Dynamic Subagent Driver Specialization and not Separate Presets**: An in-process child subagent inherits the parent's standing mount via `composeFrom(childCtx, parentCtx)` (`packages/preset/agent-presets/src/index.ts:477-486`). The subagent driver natively accepts `persona` and `toolFilter` (`packages/subagent/subagent-in-process-driver/src/index.ts:148-155`). Creating three additional preset directories (`test-writer`, `implementer`, `reviewer`) creates code duplication and defeats standing scope reuse (`plans/00-architecture-mapping.md:478-483`).

## 3. Spec Coverage

| Spec Section | Requirement | Handled In This Plan | Delegated Plan |
| :--- | :--- | :--- | :--- |
| **§1, §5.1–§5.3** | Brain Orchestrator persona, intake gate, outcome ledger | `hermes-brain/agent.cordis.yml` (persona, `tool-ledger`) | Plan 13 (`dsh-ledger`, `dsh-tool-ledger`) |
| **§1, §6.1** | Unattended worker persona, workspace execution | `hermes-worker/agent.cordis.yml` (persona, `tool-fs`, `tool-bash`) | Core (`dsh-tool-fs`, `dsh-tool-bash`) |
| **§4.1–§4.5** | Role-based Kanban tool catalogs | Preset tool configuration (`role: orchestrator` vs `role: worker`) | Plan 02 (`dsh-tool-kanban`) |
| **§5.9, INV-03** | Token preservation via `agy` delegation | `hermes-brain/agent.cordis.yml` (`tool-subagent-agy`) | Plan 11 (`dsh-subagent-agy`) |
| **§6.2, INV-13** | Cryptographic test-pinning guard | `hermes-worker/agent.cordis.yml` (`guard-test-pinning`) | Plan 09 (`dsh-guard-test-pinning`) |
| **§6.5, INV-14** | Verification stop enforcement on task completion | `hermes-worker/agent.cordis.yml` (`verification-stop`) | Plan 09 (`dsh-verification-stop`) |
| **§6.8** | Independent reviewer read-only inspection | Realized via `toolFilter: { deny: [...] }` on child subagent | Plan 00 §H.1, Core (`dsh-tools`) |
| **§5.8–§5.10** | Host supervision, watchdogs, circuit breaker | Mounted in host bundle (`packages/bundle/hermes-base/cordis.patch.yml`) | Plan 12 (`dsh-supervisor`) |
| **§7.1–§7.7** | Host databases (Kanban, Axioms, Memory, Worktree, Evidence) | All 12 host service providers mounted in `hermes-base` bundle | Plans 01, 03, 05, 07, 09, 10 |

## 4. Proposed Package/File Layout

```
packages/
├── bundle/
│   └── hermes-base/
│       ├── package.json                         # Declares dsh.bundle.patch, exports, and dependencies
│       ├── cordis.patch.yml                     # Host-plane bundle patch mounting Plans 01-13 services
│       ├── README.md                            # Bundle documentation and plane boundaries
│       ├── src/index.ts                         # Package entrypoint (re-exports bundle metadata)
│       └── tests/
│           ├── bundle-manifest.test.ts          # Validates package.json dependencies against patch rows
│           ├── plane-separation.test.ts         # verify-cordis-config preset plane separation test
│           └── scoped-composition.test.ts       # Standing mount reuse and tool catalog isolation test
└── preset/agent-presets/presets/
    ├── hermes-brain/
    │   ├── preset.yml                           # Display metadata: 调度大脑 (Brain Mode)
    │   └── agent.cordis.yml                     # Drop-in agent composition for Brain orchestrator
    └── hermes-worker/
        ├── preset.yml                           # Display metadata: 工程执行 (Worker Mode)
        └── agent.cordis.yml                     # Drop-in agent composition for engineering workers
```

## 5. Public Contracts

### 5.1 Bundle Package Manifest Contract (`packages/bundle/hermes-base/package.json`)
Adheres to bundle schema (`packages/boot/app-boot/src/profile.ts:787-791`) and `verify-cordis-config` rules (`scripts/verify-cordis-config.ts:255-265`):
```json
{
  "name": "@deepseek-ai/dsh-hermes-base",
  "description": "StoryInCode Hermes host substrate bundle: mounts kanban, axioms, memory, worktrees, verification, supervisor, and agy providers over dsh-base",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "cordis.patch.yml", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "dependencies": {
    "@deepseek-ai/dsh-axiom": "workspace:^",
    "@deepseek-ai/dsh-axiom-verifier": "workspace:^",
    "@deepseek-ai/dsh-guard-resource": "workspace:^",
    "@deepseek-ai/dsh-integrator": "workspace:^",
    "@deepseek-ai/dsh-kanban": "workspace:^",
    "@deepseek-ai/dsh-kanban-sqlite": "workspace:^",
    "@deepseek-ai/dsh-ledger": "workspace:^",
    "@deepseek-ai/dsh-memory": "workspace:^",
    "@deepseek-ai/dsh-memory-curator": "workspace:^",
    "@deepseek-ai/dsh-memory-local": "workspace:^",
    "@deepseek-ai/dsh-subagent-agy": "workspace:^",
    "@deepseek-ai/dsh-supervisor": "workspace:^",
    "@deepseek-ai/dsh-verification": "workspace:^",
    "@deepseek-ai/dsh-worktree": "workspace:^",
    "@deepseek-ai/dsh-worktree-local": "workspace:^"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "workspace:^", "@deepseek-ai/dsh-base": "workspace:^" }
}
```

### 5.2 Profile Template Contract (`packages/boot/app-boot/src/profile.ts:105-126`)
```typescript
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  // ... existing shipped templates (acp, web, headless, sdk, sdk-minimal) ...
  hermes: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-hermes-base', '@deepseek-ai/dsh-web-app'],
    patchReload: 'live',
  },
  'hermes-headless': {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-hermes-base', '@deepseek-ai/dsh-headless'],
    patchReload: 'startup',
  },
}
```

### 5.3 Preset Display Metadata (`preset.yml`)
- `hermes-brain/preset.yml`: `{ name: '调度大脑', description: 'StoryInCode 架构总控与调度 Agent，运行在 Claude Opus 4.8 模型上，负责意图拆解、Kanban 排期与 Milestone 跟踪。', order: 10 }`
- `hermes-worker/preset.yml`: `{ name: '工程执行', description: '专注代码实现与验证的工程 Agent，具备沙箱终端、测试锁闭保护（Test Pinning）与停止前验证（Verify on Stop）。', order: 11 }`

## 6. Lifecycle and Scoping

### 6.1 Standing Mount Mechanics
In DeepSeek Harness, presets are NOT mounted anew for every session (`.agents/notes/archived/architecture/2026-08-08-per-preset-standing-mounts.md:14`; `packages/preset/agent-presets/src/index.ts:769-817`):
1. **Single Standing Scope per Preset**: `AgentPresets.ensureStanding(preset)` creates an untraced root scope under `this.selfCtx` with key `{ agentPreset: preset.id }`.
2. **Generations Keyed on File Stamp**: `compositionStamp(path)` inspects file `mtimeMs` and `size`. When `agent.cordis.yml` is edited, future sessions mount a fresh generation; existing sessions remain parented to their original generation (`packages/preset/agent-presets/src/index.ts:778-789`).
3. **Session Parenting**: When a session initializes with preset `id`, `mount(agentCtx, id)` calls:
   `this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key))`
4. **Scope Chain Resolution**: When the agent requests visible tools or prompt sections, `ScopedLayers.merge(agentKey, ...)` evaluates `scopeChainOf(agentKey)` (`[agentKey, standing.key]`). It combines `global` entries, followed by `standing.key` entries, followed by `agentKey` entries (`packages/core/scope/src/store.ts:208-217`). Sibling presets possess disjoint standing keys and cannot observe each other's registrations.

### 6.2 Service Isolation Rule and Mount-Time Rejection Invariant (PRESET-RULES:3)
- **Mandatory Isolation**: Any service published by a preset row MUST sit in an entry-local `isolate` realm (`isolate: { <name>: true }`). Without an isolate realm, a Cordis service provider publishes directly into the process-global root realm, colliding across concurrent sessions.
- **Mount-Time Leak Detection & Rejection**:
  In `packages/preset/agent-presets/src/mount.ts:407-413`, `mountPreset()` verifies zero service leakage immediately after plugin awaiting:
  ```typescript
  const leaked = leakedServices(agentCtx, fiber)
  if (leaked.length > 0) {
    throw new Error(
      `row(s) published process-global service(s) [${leaked.join(', ')}]; `
      + 'a preset service must sit behind an `isolate` realm or move to the host composition',
    )
  }
  ```
  `leakedServices(ctx, mount)` (`packages/preset/agent-presets/src/mount.ts:210-224`) inspects the Cordis reflection store (`ctx.reflect.store`) across all own property symbols. For each implementation within the preset's fiber tree (`withinFiber(impl.fiber, mount)`), it tests whether `rootIsolate[impl.name] === key`. When a service is declared outside an `isolate` realm, its key matches `rootIsolate`, flagging it as leaked.
  Upon detecting any leaked service, `mountPreset()` catches the error, calls `await handle.dispose()` (`mount.ts:417`) to unwind the subtree, and throws a fatal `RemoteError('agent-preset/invalid', 'agent-presets: preset "${preset.id}" failed to mount: ...')`.
- **Static Plane Separation Check**: In addition to runtime mount validation, `scripts/verify-cordis-config.ts:120-161` (`validatePresetPlaneSeparation`) statically validates in CI that no preset config repeats any row active in the host composition (`packages/bundle/hermes-base/cordis.patch.yml`).
- **Why Tools, Guards, and Prompt Sections Do Not Need Isolate Realms**: Tools (`ctx.tools.register()`), guards (`ctx.tools.guard()`), and prompt sections (`ctx.systemPrompt.section()`) are effects filed into `ScopedLayers` against `scopeOf(ctx)` (`standing.key`). They do NOT publish Cordis services, provide no process-global symbols, and are already partitioned per preset.

### 6.3 Realm Audit Table

Every row across both `hermes-brain` and `hermes-worker` presets is categorized according to PRESET-RULES 1–10:

| Realm (`isolate` map) | Preset | Provider rows inside realm | Consumer rows inside realm | Why (Lifecycle & Scope) |
|---|---|---|---|---|
| `{ planMode: true }` | `hermes-brain` (`planning`) | `plan-mode` (`@deepseek-ai/dsh-plan-mode`) | `plan-mode` (self-contained state) | Per PRESET-RULE 10, plan mode maintains draft state per session; must be entry-local so concurrent orchestrators do not collide. |
| `{ workflowEngine: true }` | `hermes-brain` (`delegation`) | `workflow-worker-thread` (`@deepseek-ai/dsh-workflow-worker-thread`) | `tool-workflow` (`@deepseek-ai/dsh-tool-workflow`) | Per PRESET-RULE 9, `workflowEngine` is private orchestrator workflow state; provider and consumer are collocated inside realm (PRESET-RULE 5). Subagent tools inside group resolve host `ctx.subagents` (PRESET-RULE 8: `subagent`, `subagent_fork`, `subagent_agy`, plus `subagent_claude_code` and `subagent_codex` carried enabled and mounted when their provider bundles are installed). |
| `{ compaction: true, toolResultPruner: true }` | `hermes-brain` (`compaction`) | `compaction-basic` (`@deepseek-ai/dsh-compaction-basic`), `tool-result-pruner` (`@deepseek-ai/dsh-compaction-tool-result-pruner`) | `command-compact` (`@deepseek-ai/dsh-command-compact`), `tool-result-pruner` | Per PRESET-RULE 10, pruner thresholds and compaction history stay entry-local per session, preventing cross-session message pruner leaks. |
| `{ compaction: true, toolResultPruner: true }` | `hermes-worker` (`compaction`) | `compaction-basic` (`@deepseek-ai/dsh-compaction-basic`), `tool-result-pruner` (`@deepseek-ai/dsh-compaction-tool-result-pruner`) | `command-compact` (`@deepseek-ai/dsh-command-compact`), `tool-result-pruner` | Standard per-session compaction and tool result pruning isolation for worker sessions. |
| *(None / Root)* | `hermes-brain` (root) | None (all providers moved to host or isolated) | `persona`, `agent-instructions`, `tool-ask-user`, `tool-kanban`, `tool-ledger`, `tool-candidate-axioms`, `tool-memory`, `tool-session-query`, `skill-filesystem`, `tool-skill`, `present` | Per PRESET-RULE 4, rows registering into host registries (`ctx.tools`, `ctx.systemPrompt`) publish no services and belong at preset root without a realm. Host services (`ctx.ledger`, `ctx.axioms`, `ctx.kanban`, `ctx.sessionQuery`, `ctx.memory`) reside on host plane (`cordis.patch.yml`). |
| *(None / Root)* | `hermes-worker` (root) | None (all providers moved to host or isolated) | `persona`, `agent-instructions`, `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-fs-search`, `tool-jobs`, `tool-kanban`, `tool-axiom`, `tool-memory`, `guard-test-pinning`, `verification-stop`, `skill-filesystem`, `tool-skill`, `present` | Per PRESET-RULE 4, rows registering tools, execution guards (`ctx.tools.guard`), or turn hooks (`agent/turn-stopping`) publish no services and attach to session scope at root. |

## 7. Agent Preset Integration

### 7.1 Host Bundle Patch Layer (`packages/bundle/hermes-base/cordis.patch.yml`)

```yaml
# The dsh-hermes-base bundle patch: the host-plane substrate of the Hermes architecture.
# Applied as an insert over root composition after `@deepseek-ai/dsh-base`.
# Owns all HOST-PLANE services: shared databases, daemons, resource guards, worktree
# managers, and out-of-process subagent providers (PRESET-RULES 2, 6, 8).
# Rows here must NOT be repeated in agent presets (scripts/verify-cordis-config.ts).

- insert:
    # ── kanban substrate (Plan 01) ──────────────────────────────────────────
    - id: kanban-sqlite
      name: '@deepseek-ai/dsh-kanban-sqlite'
      config:
        dbPath: ~/.hermes/kanban.db
        journalMode: wal
        busyTimeoutMs: 120000
        maxInProgress: 4
        maxInProgressPerProfile: 2
        defaultClaimTtlSeconds: 900

    # ── axiom subsystem & sweeper (Plans 03 & 04) ───────────────────────────
    - id: axiom-registry
      name: '@deepseek-ai/dsh-axiom'
      config:
        taskAxiomsDir: ~/.hermes/task-axioms
        instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md']
        maxBytes: 65536

    - id: axiom-verifier
      name: '@deepseek-ai/dsh-axiom-verifier'
      config:
        defaultTimeoutMs: 30000
        autoTodosDir: ~/.hermes/auto-todos

    # ── memory, soul & background curation (Plans 05 & 06) ──────────────────
    - id: memory-local
      name: '@deepseek-ai/dsh-memory-local'
      config:
        memoriesDir: ~/.hermes/memories
        stateDbPath: ~/.hermes/state.db
        lockTimeoutMs: 5000

    - id: memory-curator
      name: '@deepseek-ai/dsh-memory-curator'
      config:
        housekeepingIntervalMs: 60000
        turnReviewInterval: 10
        skillsDir: ~/.hermes/skills
        candidateAxiomsDir: ~/.hermes/candidate-axioms

    # ── worktree management & isolation (Plan 07) ───────────────────────────
    - id: worktree-local
      name: '@deepseek-ai/dsh-worktree-local'
      config:
        worktreesDirName: .worktrees
        syncBase: true
        allocationTimeoutMs: 120000
        classificationTimeoutMs: 15000
        maxOrphanAgeHours: 72
        mergeCachePath: ~/.hermes/cache/worktree_merge_verdicts.json

    # ── host resource guard & admission control (Plan 08) ───────────────────
    - id: guard-resource
      name: '@deepseek-ai/dsh-guard-resource'
      config:
        minAvailableMemBytes: 1610612736
        headroomBytes: 3221225472
        sliceCeilingBytes: 6442450944
        enforceCgroupSlice: true

    # ── verified pipeline & integration engine (Plans 09 & 10) ─────────────
    - id: verification
      name: '@deepseek-ai/dsh-verification'
      config:
        maxEventsPerSessionRoot: 100
        maxEventAgeDays: 30
        maxOutputSummaryChars: 2000

    - id: integrator
      name: '@deepseek-ai/dsh-integrator'
      config:
        mainBranch: main
        verifyBeforeMerge: true
        autoPruneCleanWorktrees: true

    # ── external agy subagent provider (Plan 11) ────────────────────────────
    # Self-authenticates from ~/.hermes/auth.json; zero credential plumbing or key injection.
    # Model selection resolved by agy's active provider pool & router in auth.json; optional
    # validated `model` override accepted if configured, with no hardcoded default.
    - id: subagent-agy
      name: '@deepseek-ai/dsh-subagent-agy'
      config:
        binaryPath: /home/sic/.local/bin/agy
        disposeGraceMs: 3000

    # ── autonomous supervisor daemon & watchdog (Plan 12) ───────────────────
    - id: supervisor
      name: '@deepseek-ai/dsh-supervisor'
      config:
        pollIntervalMs: 15000
        heartbeatTimeoutMs: 1800000
        circuitBreakerFailureThreshold: 3

    # ── outcome ledger service provider (Plan 13) ───────────────────────────
    - id: ledger
      name: '@deepseek-ai/dsh-ledger'
      config:
        ledgerDir: ~/.hermes/task-requested
        maxDocumentBytes: 524288
        lockTimeoutMs: 5000
        enablePromptSection: true

# ── configure default preset in the presets registry ────────────────────────
- id: agent-presets
  config:
    default: hermes-brain
```

### 7.2 Drop-In Preset 1: `hermes-brain/agent.cordis.yml`

```yaml
# The `hermes-brain` agent preset: the central orchestrator composition.
#
# This file is an AGENT-PLANE composition mounted under the Brain's scope context.
# Every tool, prompt section, and isolate realm declared here belongs strictly
# to this session alone. The host composition (@deepseek-ai/dsh-hermes-base via
# cordis.patch.yml) owns shared databases, registries, and background daemons.
#
# Per PRESET-RULES:
# 1. A service row here MUST sit inside a cordis:group carrying an `isolate` realm.
#    Without one it publishes into the root realm, where it is process-global rather
#    than per-session; mountPreset detects this via leakedServices() and aborts
#    agent mounting immediately (packages/preset/agent-presets/src/mount.ts:407-413).
# 2. Rows that only register into a host registry (tools, prompt sections, skills)
#    and provide no Cordis service stay at preset root with no realm (PRESET-RULE 4).
# 3. A consumer that resolves a service with ctx.get must share the realm of the
#    row that provides it (PRESET-RULE 5).
# 4. Cross-session registries and providers (ctx.kanban, ctx.axioms, ctx.ledger,
#    ctx.memory, ctx.sessionQuery, ctx.subagents) stay on the host plane.

# ── identity & instructions ──────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers persona sections
# into ctx.systemPrompt (scoped layer) and provides no Cordis service.
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: >-
      You are the StoryInCode Brain Orchestrator powered by Claude Opus 4.8.
      You orchestrate software work through the Hermes Kanban work queue.
      Never claim tasks directly. Delegate large file reads and bulk edits to agy.
      Ensure all development is partitioned into BDD-verified task contracts.
    suffix: Your working directory is {{cwd}}.
    complete: false
    includeRuntimeContext: true

# Stays at preset root with no realm (PRESET-RULE 4): loads task and system instruction
# documents into ctx.systemPrompt and provides no Cordis service.
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

# ── planning mode ────────────────────────────────────────────────────────────
# Sits inside an entry-local isolate realm (PRESET-RULES 3, 10): @deepseek-ai/dsh-plan-mode
# provides the `planMode` service containing per-session draft plan state. Without an
# isolate realm, it would leak into the root realm and collide across concurrent sessions.
- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'

# ── human interaction & founder intake ───────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers model tool `ask_user`
# into ctx.tools and provides no Cordis service.
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

# ── kanban orchestration ────────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers orchestrator-facing tools
# (kanban_create, kanban_complete, kanban_list, etc.) into ctx.tools, resolving host-plane
# ctx.kanban (PRESET-RULE 7). Provides no Cordis service.
- id: tool-kanban
  name: '@deepseek-ai/dsh-tool-kanban'
  config:
    role: orchestrator
    maxListLimit: 50

# ── outcome ledger & milestone tracking (Spec §5.1, §5.3) ───────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers model tools `ledger_show`
# and `ledger_update` into ctx.tools and `ledger:intake-policy` into ctx.systemPrompt.
# Per PRESET-RULES 2, 6, 8, the OutcomeLedger service provider (@deepseek-ai/dsh-ledger)
# resides on the Host Plane (cordis.patch.yml) as cross-session state consumed by
# ctx.supervisor. This preset row mounts only the tool consumer (@deepseek-ai/dsh-tool-ledger),
# providing no Cordis service.
- id: tool-ledger
  name: '@deepseek-ai/dsh-tool-ledger'

# ── candidate axiom exploration (Spec §2.4, §2.7) ───────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers model tool
# `resolve_candidate_axioms` into ctx.tools, resolving host-plane ctx.axioms.
# Per PRESET-RULES 2, 6, the AxiomRegistry service provider resides on the Host Plane
# (cordis.patch.yml). This row mounts only the subpath tool plugin entrypoint
# (@deepseek-ai/dsh-axiom/tool), providing no Cordis service.
- id: tool-candidate-axioms
  name: '@deepseek-ai/dsh-axiom/tool'

# ── delegation and workflows ─────────────────────────────────────────────────
# Sits inside an entry-local isolate realm (PRESET-RULES 3, 5, 9): workflow-worker-thread
# provides `workflowEngine` which is private orchestrator workflow state. Collocated
# with consumer `tool-workflow` inside the realm (PRESET-RULE 5). Subagent delegation tools
# inside this group resolve host-plane ctx.subagents (which is not isolated, PRESET-RULE 8).
- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'

    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'

    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable

    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
        backgroundMode: continuable

    # External agy provider (Plan 11): resolves host ctx.subagents ('agy').
    # Authenticates from ~/.hermes/auth.json (OAuth pool/router); zero credential plumbing.
    # Model selection is owned by agy's active provider pool and router (no pinned model).
    - id: tool-subagent-agy
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: agy
        toolName: subagent_agy
        backgroundMode: one-shot
        maxDepth: provider-managed

    # External Claude Code provider: resolves host ctx.subagents ('claude-code').
    # Authenticates from ~/.claude/.credentials.json via file-based OAuth. Carried enabled
    # in hermes-brain; mounts when @deepseek-ai/dsh-subagent-claude-code is installed in Profile.
    - id: tool-subagent-claude-code
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: claude-code
        toolName: subagent_claude_code
        backgroundMode: one-shot
        maxDepth: provider-managed

    # External Codex provider: resolves host ctx.subagents ('codex').
    # Authenticates from ~/.codex/auth.json via file-based OAuth. Carried enabled
    # in hermes-brain; mounts when @deepseek-ai/dsh-subagent-codex is installed in Profile.
    - id: tool-subagent-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: codex
        toolName: subagent_codex
        backgroundMode: one-shot
        maxDepth: provider-managed

    - id: workflow-worker-thread
      name: '@deepseek-ai/dsh-workflow-worker-thread'
      config:
        provider: spawn

    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'

# ── memory & session search ──────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers `memory` tool into
# ctx.tools, resolving host-plane ctx.memory. Provides no Cordis service.
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'

# Stays at preset root with no realm (PRESET-RULE 4): reuses existing shipped tool package
# @deepseek-ai/dsh-tool-session-query, registering `session_search`, `session_event_search`,
# and trace tools into ctx.tools, resolving host-plane ctx.sessionQuery. Provides no service.
- id: tool-session-query
  name: '@deepseek-ai/dsh-tool-session-query'
  config:
    maxSearchResults: 20
    searchTimeoutMs: 15000

# ── skills ───────────────────────────────────────────────────────────────────
# Stay at preset root with no realm (PRESET-RULE 4): skill-filesystem registers a skill
# directory source and tool-skill registers `skill` tool into ctx.tools. Provide no service.
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

# ── compaction ───────────────────────────────────────────────────────────────
# Sits inside an entry-local isolate realm (PRESET-RULES 3, 5, 10): compaction-basic
# provides `compaction` and tool-result-pruner provides `toolResultPruner`. Command-compact
# and tool-result-pruner consume them. Isolation keeps pruner state and compaction history
# private per session.
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

# ── presentation ─────────────────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers presentation renderers
# into ctx.tools. Provides no Cordis service.
- id: present
  name: '@deepseek-ai/dsh-tool-present'
```

### 7.3 Drop-In Preset 2: `hermes-worker/agent.cordis.yml`

```yaml
# The `hermes-worker` agent preset: the unattended engineering worker composition.
#
# This file is an AGENT-PLANE composition mounted under the Worker's scope context.
# It equips engineering workers with workspace execution tools, strict BDD test-pinning
# guards, and pre-stop verification gates.
#
# Per PRESET-RULES:
# 1. A service row here MUST sit inside a cordis:group carrying an `isolate` realm (PRESET-RULE 3).
# 2. Rows registering tools into ctx.tools, execution guards on ctx.tools.guard(), or turn
#    hooks on agent/turn-stopping provide no Cordis services and stay at preset root
#    with no realm (PRESET-RULE 4).
# 3. Compaction sits in an entry-local isolate realm so pruner state stays private per session (PRESET-RULE 10).

# ── identity & instructions ──────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers worker persona prefix
# into ctx.systemPrompt (scoped layer). Provides no Cordis service.
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: >-
      You are an unattended engineering worker in the Hermes development pool.
      You execute contract-bounded tasks within isolated Git worktrees.
      Implement pinned tests, verify before stopping, and report through kanban.
      Never edit pinned test files in tests/ during implementer turns.
    suffix: Your working directory is {{cwd}}.
    complete: false
    includeRuntimeContext: true

# Stays at preset root with no realm (PRESET-RULE 4): loads broad-to-specific AGENTS.md
# instruction chain for current worktree cwd into ctx.systemPrompt. Provides no Cordis service.
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

# ── execution substrate (shell & filesystem) ─────────────────────────────────
# Stay at preset root with no realm (PRESET-RULE 4): register execution tools into
# ctx.tools. tool-jobs resolves host background task registry (PRESET-RULE 7).
# None publishes a Cordis service.
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

- id: tool-pwsh
  name: '@deepseek-ai/dsh-tool-pwsh'
  disabled: !!js process.platform !== 'win32'

- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-fs-search
  name: '@deepseek-ai/dsh-tool-fs-search'
  config:
    sampleOverCapGlobResults: false

- id: tool-jobs
  name: '@deepseek-ai/dsh-tool-jobs'

# ── kanban worker tools ─────────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers worker-facing tools
# (kanban_show, kanban_heartbeat, kanban_request_review, kanban_comment, kanban_attach)
# into ctx.tools, resolving host-plane ctx.kanban (PRESET-RULE 7). Provides no service.
- id: tool-kanban
  name: '@deepseek-ai/dsh-tool-kanban'
  config:
    role: worker

# ── axiom compliance & evidence attachment ──────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers `attach_proof` and
# `verify_task_axioms` tools into ctx.tools, resolving host-plane ctx.axioms and
# ctx.axiomVerifier. Provides no Cordis service.
- id: tool-axiom
  name: '@deepseek-ai/dsh-tool-axiom'
  config:
    autoVerifyOnProof: false

# ── memory notes ────────────────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers `memory` tool into
# ctx.tools, resolving host-plane ctx.memory. Provides no Cordis service.
# Note: session search (@deepseek-ai/dsh-tool-session-query) is intentionally omitted
# from worker presets as an operational token-budget optimization; workers operate
# strictly on bounded card contracts, worktree diffs, and test manifests.
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'

# ── verification & test pinning guards ──────────────────────────────────────
# Stay at preset root with no realm (PRESET-RULE 4):
# guard-test-pinning registers a tool execution guard on ctx.tools.guard() (INV-13).
# verification-stop registers an agent turn hook on agent/turn-stopping (INV-14).
# Neither publishes a Cordis service; their effects attach strictly to session scope.
- id: guard-test-pinning
  name: '@deepseek-ai/dsh-guard-test-pinning'
  config:
    enforceFilesystemChmod: true
    readOnlyMode: true

- id: verification-stop
  name: '@deepseek-ai/dsh-verification-stop'
  config:
    maxAttempts: 2
    defaultTimeoutMs: 30000

# ── skills ───────────────────────────────────────────────────────────────────
# Stay at preset root with no realm (PRESET-RULE 4): register skill source and tool into ctx.tools.
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'

# ── compaction ───────────────────────────────────────────────────────────────
# Sits inside an entry-local isolate realm (PRESET-RULES 3, 5, 10): compaction-basic
# provides `compaction` and tool-result-pruner provides `toolResultPruner`. Command-compact
# and tool-result-pruner consume them. Isolation keeps pruner state and compaction history
# private per session.
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'

    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'

    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024

# ── presentation ─────────────────────────────────────────────────────────────
# Stays at preset root with no realm (PRESET-RULE 4): registers presentation tool into ctx.tools.
- id: present
  name: '@deepseek-ai/dsh-tool-present'
```

### 7.4 Preset Comparison Matrix

| Dimension | `hermes-brain` Preset | `hermes-worker` Preset |
| :--- | :--- | :--- |
| **Purpose & Persona** | Strategic coordinator; Claude Opus 4.8; founder intake, Kanban board dispatch, milestone tracking. | Autonomous engineer; leaf implementation, public BDD test writing, verification execution. |
| **Scoped Services** | `planMode`, `workflowEngine`, `compaction`, `toolResultPruner`. | `compaction`, `toolResultPruner`. |
| **Exposed Tools** | `kanban_show`, `kanban_create`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_link`, `kanban_list`, `kanban_comment`, `kanban_attach`, `ledger_show`, `ledger_update`, `resolve_candidate_axioms`, `ask_user`, `subagent`, `subagent_fork`, `subagent_agy`, `subagent_claude_code` (conditional on profile bundle), `subagent_codex` (conditional on profile bundle), `subagent_control`, `workflow`, `session_search`, `session_event_search`, `session_trace`, `session_event_trace`, `session_event_read`, `memory`, `skill`, `present`. | `tool-bash`/`tool-pwsh`, `read_file`, `writeText`, `editText`, `patch`, `fs_search`, `job_output`, `job_kill`, `kanban_show`, `kanban_heartbeat`, `kanban_request_review`, `kanban_request_changes`, `kanban_comment`, `kanban_attach`, `attach_proof`, `verify_task_axioms`, `memory`, `skill`, `present`. |
| **Exposed Skills** | Read from `.hermes/skills` (`skill-filesystem`, `tool-skill`). | Read from `.hermes/skills` (`skill-filesystem`, `tool-skill`). |
| **Subagent Providers** | `spawn` (in-process), `fork` (in-process), `agy` (external CLI, self-authenticating via `~/.hermes/auth.json`), plus optional external CLIs `claude-code` (`~/.claude/.credentials.json`) and `codex` (`~/.codex/auth.json`) carried enabled when their matching provider bundle is installed in the Profile. | Inherits subagent capabilities from parent if delegating, but does not expose subagent tool directly. |
| **Workflow Engine** | Isolated `workflowEngine` for multi-step algorithmic coordination. | None (workers execute directly in worktree shells). |
| **System Prompt Additions** | Brain persona prefix, `SOUL.md` style, `ledger:intake-policy` prompt section. | Worker persona prefix, `SOUL.md` style, active task axiom constraints. |
| **Policy Implications** | Barred from direct file authoring (token preservation); delegates code reading/writing to `agy`. | Bounded by cryptographic test pinning (`guard-test-pinning`) and verification stops (`verification-stop`). |
| **Preset Selection** | Selected at session creation (`agentPreset: 'hermes-brain'`) or default. | Selected when spawning worker session (`agentPreset: 'hermes-worker'`). |
| **Why Preset not Skill** | Establishes isolate realms, tool registries, and subagent delegation infrastructure. | Enforces monotonic execution guards and intercepts turn stopping. |

### 7.5 Realizing Roles Without Extra Presets: Subagent Driver Seam

As mandated by `00-architecture-mapping.md:478-483`, separate presets for `test-writer`, `implementer`, and `reviewer` are eliminated. The native subagent driver (`packages/subagent/subagent-in-process-driver/src/index.ts:134-160`) implements:
```typescript
if (composition.persona !== undefined) {
  childCtx.systemPrompt.section({
    name: 'deployment:persona-prefix',
    order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: composition.persona,
  })
}
if (composition.toolFilter !== undefined) childCtx.tools.restrict(composition.toolFilter)
```

1. **Preset Inheritance**: When a worker spawns a child, `composeFrom(childCtx, parentCtx)` binds the child to `hermes-worker`'s standing mount.
2. **Role Synthesis via `toolFilter` and `persona`**:
   - **BDD Test Writer**: `persona`: "Write failing behavioral test suites in tests/ defining task contracts." `toolFilter`: `{ allow: ['tool-fs', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-skill', 'tool-memory'] }`.
   - **Implementer**: `persona`: "Write production code in src/ to pass tests. Never edit test files." `toolFilter`: Standard worker tool suite (`guard-test-pinning` blocks test edits at runtime).
   - **Independent Reviewer**: `persona`: "Inspect git diffs and test evidence. Read-only." `toolFilter`: `{ deny: ['tool-fs:writeText', 'tool-fs:editText', 'tool-fs:patch', 'tool-fs:deleteFile'] }`. Evaluates code read-only and posts comments via `kanban_comment`.

## 8. Execution Flow

```
1. Profile Boot: apps/cli/src/profile-boot.ts resolves 'hermes' template
   -> Stacks: @deepseek-ai/dsh-base -> @deepseek-ai/dsh-hermes-base -> @deepseek-ai/dsh-web-app
   -> Inserts host services: boots SQLite databases, daemons, and registers agy subagent provider
                                       |
                                       v
2. Standing Mount Resolution: AgentPresets.ensureStanding(preset)
   -> Resolves hermes-brain/agent.cordis.yml; checks compositionStamp (mtimeMs, size)
   -> Creates standing scope ctx[kScope] = standingKey; registers scoped tools and isolate realms
                                       |
                                       v
3. Session Minting: Agent factory triggers AgentPresets.mount(agentCtx, 'hermes-brain')
   -> Binds scope parentage: bindScopeParent(agentKey, standing.key)
   -> Merges catalog: ScopedLayers combines global -> standing -> agent tools
   -> Brain runs intake turn; creates cards via kanban_create; delegates AST to agy
                                       |
                                       v
4. Worker Dispatch: Dispatcher allocates worktree via ctx.worktrees; spawns worker session
   -> Worker session mounts hermes-worker preset standing scope
   -> Worker claims card (kanban_heartbeat); guard-test-pinning pins tests/ manifest SHA-256
                                       |
                                       v
5. In-Process Subagent Delegation: Worker delegates to Test Writer and Reviewer
   -> Calls ctx.subagents.start('spawn', { persona: REVIEWER_PROMPT, toolFilter: { deny: [...] } })
   -> Child inherits hermes-worker standing mount via composeFrom; runs under restricted catalog
                                       |
                                       v
6. Pre-Stop Verification & Integration: Worker completes implementation; invokes stop
   -> verification-stop intercepts agent/turn-stopping; asserts test evidence is fresh and green
   -> Worker requests review (kanban_request_review); reviewer passes; integrator merges PR
   -> Brain updates outcome ledger (ledger_update); clean worktree pruned
```

## 9. Error/Cancellation/Lifecycle Behavior

- **Accidental Service Leakage in Presets**: If any preset row declares a service without an `isolate` realm, `mountPreset` fails immediately during agent creation (`leakedServices()`), rolls back scope bindings, and cleans up the partial fiber (`packages/preset/agent-presets/src/mount.ts:407-413`).
- **Missing Bundle Dependencies**: If a plugin referenced in `cordis.patch.yml` is missing from `package.json`, `verify-cordis-config` fails CI immediately with `bundle package dependencies must include every plugin referenced in its patch` (`scripts/verify-cordis-config.ts:376`).
- **Disk File Stamp Invalidation**: If an administrator edits `hermes-brain/agent.cordis.yml` on disk, `ensureStanding()` detects `mtimeMs` or `size` drift, purges the standing scope promise from cache, and boots a new standing mount generation for future sessions (`packages/preset/agent-presets/src/index.ts:778-789`). Active sessions remain safely pinned to their established generation.
- **Session Cancellation and Child Cascade**: When a parent session is aborted or killed via `tool-jobs` or supervisor intervention, `ctx.subagents` cancels all descendant in-process fibers and external `agy` process groups via SIGINT -> SIGTERM escalation (`Plan 11 §9`).
- **Blank-Session Preset Switching**: Preset recomposition (`recompose()`) is permitted only while the session is blank (`turnBoundary.lastTurn === 0`). Once a turn has executed, preset switching is rejected with `agent-preset/locked` to preserve transcript replayability (`packages/preset/agent-presets/src/index.ts:736-744`).

## 10. Testing Strategy

### 10.1 Scoped Registration & Composition Test Suite (`packages/bundle/hermes-base/tests/scoped-composition.test.ts`)
Must prove conclusively that:
1. **Concurrent Preset Mounts Do Not Collide**:
   - Boot a test Cordis container with `@deepseek-ai/dsh-base` and `@deepseek-ai/dsh-hermes-base`.
   - Create Session A and Session B with `agentPreset: 'hermes-brain'`.
   - Assert both sessions share the exact same `standing.key` via `standingMountFor()`.
   - Assert that no Cordis duplicate service error throws.
2. **Entry-Local Service Isolation**:
   - In Session A, start a draft plan via `planMode.setDraft('Plan A')`.
   - In Session B, inspect `planMode.getDraft()`.
   - Assert that Session B receives `undefined`; the isolate realm completely isolates state between sessions.
3. **Sibling Preset Catalog Isolation**:
   - Create Session 1 (`hermes-brain`) and Session 2 (`hermes-worker`).
   - Query visible tools for Session 1: assert `kanban_list`, `ledger_show`, `ledger_update`, `resolve_candidate_axioms`, `subagent_agy`, `session_search` are present; assert `guard-test-pinning`, `verification-stop`, `tool-bash` are absent.
   - Query visible tools for Session 2: assert `tool-bash`, `attach_proof`, `guard-test-pinning` are present; assert `kanban_list`, `ledger_show`, `subagent_agy` are absent.
   - Verify that zero tools from Session 1 leak into Session 2.
4. **Subagent Role Restriction**:
   - From Session 2, launch a child subagent with `toolFilter: { deny: ['tool-fs:writeText'] }`.
   - Assert child's visible tools omit `writeText` while preserving read tools.

### 10.2 Plane Separation and Schema Verification (`packages/bundle/hermes-base/tests/plane-separation.test.ts`)
- Execute `validatePresetPlaneSeparation()` from `scripts/verify-cordis-config.ts:120-161`.
- Assert that no row declared in `packages/bundle/hermes-base/cordis.patch.yml` appears in `hermes-brain/agent.cordis.yml` or `hermes-worker/agent.cordis.yml`.
- Execute `validateBundleDependencies()`: assert every plugin in `cordis.patch.yml` is declared in `packages/bundle/hermes-base/package.json`.
- Execute `validateNoJsExprInMetadata()`: assert that `!!js` expressions exist only under `config` or `disabled`.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Application profile configuration & directory layout | `/home/sic/Downloads/hermes-agent-main/hermes_cli/profiles.py:27-65`<br>`/home/sic/Downloads/hermes-agent-main/hermes_constants.py:45-85` | Profile directory isolation structure (`memories`, `sessions`, `skills`, `plans`, `workspace`), profile-aware path anchoring (`get_hermes_home`), and clone exclusion lists preventing session bleed across profiles. | Replaced with Harness declarative profile template in `packages/boot/app-boot/src/profile.ts` (`PROFILE_TEMPLATES.hermes` stacking `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-hermes-base`, `@deepseek-ai/dsh-web-app`); configuration driven by `dsh --profile hermes` rather than Python CLI flags. | reference only |
| Orchestrator brain persona & operating policy | `/home/sic/Desktop/storyincode/AGENTS.md:1-85`<br>`/home/sic/.hermes/skills/sic-orchestrator/SKILL.md:1-60` | Action-first operating partner contract, 1-dev/1-server solo-founder optimization, token preservation mandate (delegating AST reads/bulk writes to workers/`agy`), and governance-only tool scoping. | Transcribe markdown policy into YAML `persona` and system prompt sections (`ledger:intake-policy`, `instruction-role`) in `packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml`. | port with adaptation |
| Sandboxed engineering worker persona & stop gates | `/home/sic/Downloads/hermes-agent-main/agent/turn_stop_gates.py:35-80`<br>`/home/sic/Desktop/storyincode/AGENTS.md:10-35` | Unattended worker posture: worktree isolation, BDD test-first discipline, never editing tests during implementation, strict stop gates on turn completion. | Configure in `packages/preset/agent-presets/presets/hermes-worker/agent.cordis.yml` with `guard-test-pinning` and `verification-stop`, omitting governance tools (`kanban_list`, `ledger_*`, `subagent_agy`). | port with adaptation |
| Subagent role synthesis (Test-Writer, Implementer, Reviewer personas & tool filtering) | `/home/sic/Downloads/hermes-agent-main/agent/subagent_lifecycle.py:48-65`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:650-710` | `SubagentLaunchRequest` role parameterization (`role: 'leaf' | 'orchestrator'`), allowed toolset filtering (`allowed_toolsets`, `blocked_tools`), and specialized reviewer read-only constraints. | Synthesized dynamically in-process via `composeFrom()`, `persona`, and `toolFilter: { allow/deny: [...] }` on `@deepseek-ai/dsh-subagent-in-process-driver` rather than spawning separate OS processes or authoring duplicate preset directories. | port with adaptation |
| Host-plane distribution bundle substrate wiring | no Hermes equivalent — new code | N/A (Cordis host-plane patch composition `cordis.patch.yml` and bundle packaging are specific to DeepSeek Harness microkernel architecture). | Native Harness bundle definition at `packages/bundle/hermes-base/cordis.patch.yml` mounting all 12 substrate services (Plans 01, 03-13) on the host plane with strict isolate realm auditing. | no Hermes equivalent (new code) |

The single most valuable pattern to port is Hermes's role-based execution boundaries and toolset filtering (`agent/subagent_lifecycle.py:48-65` and `storyincode/AGENTS.md:1-85`). Composing `hermes-brain` and `hermes-worker` as segregated presets—isolating orchestrator governance tools from worker execution tools, and dynamically specializing child workers via `persona` and `toolFilter`—directly mirrors Hermes's subagent contracts without duplicating preset scaffolding or leaking root services.

## 11. Implementation Steps

1. **Create Distribution Bundle Package** (`packages/bundle/hermes-base/`):
   - Author `package.json` declaring `dsh.bundle.patch: "./cordis.patch.yml"`, exports map, and workspace dependencies.
   - Author `cordis.patch.yml` with the exact 12 host-plane service rows and `agent-presets.default: hermes-brain`.
   - Author `src/index.ts` exporting bundle identifier and metadata constants.
   - Author `README.md` documenting host plane ownership and service catalog.
2. **Author `hermes-brain` Agent Preset** (`packages/preset/agent-presets/presets/hermes-brain/`):
   - Author `preset.yml` with display name `调度大脑` and description.
     - Author `agent.cordis.yml` with the exact drop-in YAML configuration: persona, plan mode isolate group, `tool-kanban` (role: orchestrator), `tool-ledger` (`@deepseek-ai/dsh-tool-ledger`), `tool-candidate-axioms` (`@deepseek-ai/dsh-axiom/tool`), delegation group with `workflowEngine` isolate realm and `tool-workflow`, `tool-subagent-agy`, `tool-subagent-claude-code`, `tool-subagent-codex`, memory, `tool-session-query` (`@deepseek-ai/dsh-tool-session-query`), and compaction isolate group.
3. **Author `hermes-worker` Agent Preset** (`packages/preset/agent-presets/presets/hermes-worker/`):
   - Author `preset.yml` with display name `工程执行` and description.
   - Author `agent.cordis.yml` with the exact drop-in YAML configuration: worker persona, shell, filesystem, `tool-kanban` (role: worker), `tool-axiom` (`@deepseek-ai/dsh-tool-axiom`), `guard-test-pinning`, `verification-stop`, memory (omitting session search for token preservation), and compaction isolate group.
4. **Register Shipped Profile Templates** (`packages/boot/app-boot/src/profile.ts`):
   - Add `hermes` and `hermes-headless` templates to `PROFILE_TEMPLATES`.
   - Add display localization keys in `packages/preset/agent-presets/src/display.ts` for `hermes-brain` and `hermes-worker`.
5. **Implement Test Suites** (`packages/bundle/hermes-base/tests/`):
   - Implement `bundle-manifest.test.ts`, `plane-separation.test.ts`, and `scoped-composition.test.ts`.
   - Run `pnpm run verify-cordis-config` to validate all Cordis configuration files across the repository.

## 12. Acceptance Criteria

- [ ] `@deepseek-ai/dsh-hermes-base` exists at `packages/bundle/hermes-base/` and passes `verify-cordis-config` bundle checks.
- [ ] `packages/bundle/hermes-base/cordis.patch.yml` mounts all 12 host-plane services on the root context without isolate leaks.
- [ ] `packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml` drops in cleanly, mounts without service leak errors (verified by `leakedServices` in `mount.ts:407-413`), and exposes orchestrator tools (`ledger_show`, `ledger_update`, `resolve_candidate_axioms`, `workflow`, `session_search`).
- [ ] `packages/preset/agent-presets/presets/hermes-worker/agent.cordis.yml` drops in cleanly, mounts without service leak errors, and exposes worker tools and guards.
- [ ] Profile `dsh --profile hermes` launches the Web application with `hermes-brain` as the default preset.
- [ ] Concurrency test proves multiple sessions mounting `hermes-brain` share the standing scope without collision.
- [ ] Sibling isolation test proves zero tool leakage between `hermes-brain` and `hermes-worker` sessions.
- [ ] Subagent driver tests prove `test-writer`, `implementer`, and `reviewer` roles are fully synthesized via `persona` and `toolFilter` under `hermes-worker` without extra preset directories.

## 13. Deviation from the Mapping

- **Package Collapsing from Plan 03**: As established in `plans/03-axiom-subsystem.md §13`, `dsh-axiom-context` was eliminated (context injection handled natively by `@deepseek-ai/dsh-agent-instructions`) and `dsh-axiom-local` was collapsed into `@deepseek-ai/dsh-axiom`. The host bundle and presets reflect this unified architecture rather than the legacy three-package axiom mapping.
- **Verification Storage Consolidation from Plan 09**: As established in `plans/09-verified-pipeline-and-gates.md §2.1`, `@deepseek-ai/dsh-verification-sqlite` was eliminated in favor of `ctx.storageDomain` within `@deepseek-ai/dsh-verification`. The host bundle patch layer mounts `@deepseek-ai/dsh-verification` directly.

## Review fixes applied

- **REVIEW-seams Finding 1 (Preset Service Provider Leakage)**:
  - Eliminated unisolated root service providers in `hermes-brain/agent.cordis.yml`.
  - Replaced `@deepseek-ai/dsh-ledger` with model-facing tool row `@deepseek-ai/dsh-tool-ledger` (id: `tool-ledger`), which registers `ledger_show`/`ledger_update` into `ctx.tools` and prompt section `ledger:intake-policy` into `ctx.systemPrompt` without extending Cordis `Service`.
  - Replaced `@deepseek-ai/dsh-axiom` with dedicated tool subpath `@deepseek-ai/dsh-axiom/tool` (id: `tool-candidate-axioms`), registering `resolve_candidate_axioms` into `ctx.tools` without publishing a Cordis `Service`.
  - Added consumer `- id: tool-workflow, name: '@deepseek-ai/dsh-tool-workflow'` inside `delegation` group under isolate realm `{ workflowEngine: true }`, ensuring `workflowEngine` has its consumer collocated inside the realm per PRESET-RULE 5.
  - Verified and cited mount-time rejection behavior in `packages/preset/agent-presets/src/mount.ts:210-224` (`leakedServices()`) and `mount.ts:407-413` (`mountPreset()`).
  - Added comprehensive Section 6.3 Realm Audit Table mapping every preset row to its isolate realm status and rationale.
  - Applied strict PtC comment discipline across both `hermes-brain` and `hermes-worker` preset YAML blocks, annotating why every row sits inside or outside an isolate realm.
- **REVIEW-seams Finding 2 (Duplicate Session Search Package)**:
  - Replaced invented `@deepseek-ai/dsh-tool-session-search` in `hermes-brain/agent.cordis.yml` with existing `@deepseek-ai/dsh-tool-session-query` (`packages/session-query/tool-session-query`).
  - Configured with `maxSearchResults: 20` and `searchTimeoutMs: 15000`.
- **External CLI Authentication & Subagent Composition**: Removed pinned model from agy row (delegates to active provider router in ~/.hermes/auth.json with optional validated override matching Plan 11), clarified that agy, Claude Code, and Codex authenticate from file-based OAuth stores under $HOME with zero credential plumbing, and enabled subagent_claude_code and subagent_codex rows in hermes-brain conditioned on the matching provider bundle being installed in the Profile.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`hermes_cli/profiles.py`, `hermes_constants.py`, `agent/subagent_lifecycle.py`, `turn_stop_gates.py`, and `AGENTS.md`) to accelerate preset, profile, and bundle composition.
