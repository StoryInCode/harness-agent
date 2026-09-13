# Hermes on DeepSeek Harness — Implementation Plans

The Hermes autonomous development system ports from a collection of external Python scripts and ad-hoc filesystem conventions into a fully integrated, modular subsystem of the DeepSeek Harness framework. Built directly upon Harness's Cordis micro-kernel architecture, Hermes cleanly bifurcates across two architectural planes: a singleton Host Plane providing multi-session coordination daemons, cross-session registries, and durable persistence backends; and an Agent Plane delivering scoped session loops, model-facing engineering tools, persona prompt injection, and monotonic execution guards. Monolithic scripts and ad-hoc file polling are replaced with strongly typed Cordis service contracts (`ctx.kanban`, `ctx.axioms`, `ctx.verification`, `ctx.worktrees`, `ctx.supervisor`, `ctx.ledger`), atomic SQLite databases with monotonic schema versioning, schema-validated storage domains (`ctx.storageDomain`), and non-bypassable tool execution guards (`ctx.tools.guard()`), establishing complete architectural congruence with Harness runtime invariants.

Execution orchestration is driven declaratively through agent presets rather than hardcoded control scripts. The orchestrator preset (`hermes-brain`), powered by Claude Opus 4.8, manages high-level founder milestone documents, resolves candidate axiom chains, curates the Kanban directed acyclic graph (DAG), and delegates contract-bounded subtasks. Execution work is offloaded to unattended engineering workers via the `hermes-worker` preset, operating inside isolated Git worktrees under filesystem sandboxing. Every worker turn is strictly bound by mechanical test pinning (`INV-13`), BDD red-green verification gates (`INV-14`), attributable shell anti-cheat filters (`INV-11`), and the foundational No Unproven Done invariant (`INV-01`), supervised continuously by an autonomous background daemon that monitors worker heartbeats, trips circuit breakers on repeated failures, manages rate-limit quota walls, and drives milestone convergence.

## Architecture at a glance

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                       HOST PLANE                                         │
│                      (Root Cordis Container · packages/bundle/hermes-base)               │
│                                                                                          │
│  [Shared Substrate Services & Daemons]                                                   │
│   ├─ ctx.kanban          : SqliteKanbanStore (~/.hermes/kanban.db, WAL, schema v1)       │
│   ├─ ctx.axioms          : AxiomRegistry (Colocated AGENTS.md + ctx.storageDomain)       │
│   ├─ ctx.axiomVerifier   : AxiomVerifier (9 declarative evaluators, pre-complete hook)   │
│   ├─ ctx.memory          : LocalMemoryStore (~/.hermes/memories/USER.md & MEMORY.md)     │
│   ├─ ctx.memoryCurator   : CuratorRuntime (Skill lifecycle decay + review forks)         │
│   ├─ ctx.worktrees       : LocalWorktreeManager (Dynamic pool in .worktrees/<id>/)       │
│   ├─ ctx.resourceGuard   : ResourceGuardService (3 GiB floor, cgroups, SOUL guard)       │
│   ├─ ctx.verification    : VerificationStore (Evidence ledger via ctx.storageDomain)     │
│   ├─ ctx.integrator      : IntegratorService (Auto merge, baseline tests, draft PRs)     │
│   ├─ ctx.subagents['agy']: AgySubagentProvider (Headless CLI delegation bridge)          │
│   ├─ ctx.supervisor      : SupervisorService (Heartbeats, circuit breaker, quota wall)   │
│   └─ ctx.ledger          : OutcomeLedger (~/.hermes/task-requested/<slug>.md + domain)   │
│                                                                                          │
│  [Cross-Cutting Invariants & Hooks]                                                      │
│   ├─ 'kanban/pre-complete' -> ctx.axiomVerifier (INV-01: No Unproven Done)              │
│   ├─ ctx.tools.guard()     -> ctx.resourceGuard (INV-12) & guard-test-pinning (INV-13)  │
│   └─ agent/turn-stopping   -> ctx.verificationStop (INV-14) & ctx.memoryCurator          │
└────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │ Scoped Session Mounts
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│               AGENT PLANE                │   │               AGENT PLANE                │
│     Preset: hermes-brain (Opus 4.8)      │   │          Preset: hermes-worker           │
│                                          │   │                                          │
│ [Identity & Instructions]                │   │ [Identity & Instructions]                │
│  ├─ persona (@dsh-persona, Slot #1)      │   │  ├─ persona (@dsh-persona, Slot #1)      │
│  └─ agent-instructions (@dsh-instruct)   │   │  └─ agent-instructions (scoped to cwd)   │
│                                          │   │                                          │
│ [Planning Mode - isolate: planMode]      │   │ [Execution Substrate]                    │
│  └─ plan-mode (@dsh-plan-mode)           │   │  ├─ tool-bash / tool-pwsh                │
│                                          │   │  ├─ tool-fs / tool-fs-search             │
│ [Human & Orchestration Tools]            │   │  └─ tool-jobs (background tasks)         │
│  ├─ tool-ask-user (ask_user)             │   │                                          │
│  ├─ tool-kanban (role: orchestrator)     │   │ [Kanban Worker Tools]                    │
│  ├─ tool-ledger (ledger_show/update)     │   │  └─ tool-kanban (role: worker)           │
│  ├─ tool-candidate-axioms (resolve_cand) │   │                                          │
│  ├─ tool-memory (memory note CRUD)       │   │ [Axiom & Evidence Tools]                 │
│  └─ tool-session-query (session_search)  │   │  └─ tool-axiom (attach_proof, verify)    │
│                                          │   │                                          │
│ [Delegation - isolate: workflowEngine]   │   │ [Memory & Skills]                        │
│  ├─ tool-subagent (spawn, fork)          │   │  ├─ tool-memory                          │
│  ├─ tool-subagent-agy (provider: agy)    │   │  └─ skill-filesystem / tool-skill        │
│  ├─ workflow-worker-thread               │   │                                          │
│  └─ tool-workflow                        │   │ [Execution & Verification Guards]        │
│                                          │   │  ├─ guard-test-pinning (INV-13)          │
│ [Skills & Presentation]                  │   │  └─ verification-stop (INV-14)           │
│  ├─ skill-filesystem / tool-skill        │   │                                          │
│  └─ present (@dsh-tool-present)          │   │ [Compaction - isolate: compaction]       │
│                                          │   │  ├─ compaction-basic                     │
│ [Compaction - isolate: compaction]       │   │  ├─ command-compact                      │
│  ├─ compaction-basic                     │   │  └─ tool-result-pruner                   │
│  ├─ command-compact                      │   └──────────────────────────────────────────┘
│  └─ tool-result-pruner                   │
└──────────────────────────────────────────┘
                     │
                     ▼ Subagent Roles (synthesized via composeFrom & toolFilter)
      ┌──────────────────────────────┬──────────────────────────────┐
      ▼                              ▼                              ▼
 [Test Writer]                 [Implementer]                   [Reviewer]
 · Writes tests/               · Implements code              · Read-only diff audit
 · Read-only to code           · Pinned test files guarded    · Deny: bash, write, edit
```

- **Host Plane Ownership**: Owns cross-session persistent state, shared coordination registries, background daemons, storage backends, and host-level execution guards.
- **Agent Plane Ownership**: Owns per-turn reasoning loops, scoped model-facing tool invocations, persona prompt injection, turn-stopping gates, and isolated session state.

### Native Two-Way Brain-Worker Communication

Prior architectural analyses assumed that parent-to-worker steering and worker-to-parent reporting required custom message queues or out-of-band IPC. **This assumption is false; two-way brain<->worker communication is an existing, native capability of DeepSeek Harness, not something this work builds.**

The native substrate operates across continuable child boundaries without new machinery:
1. **Parent-to-Child Steering**: The parent calls `send_message({ agent_id, message })` (`@deepseek-ai/dsh-tool-subagent-control`). The runtime routes this through `ctx.subagents.sendMessage` into `SubagentContinuationManager.sendMessage`, delivering the payload as `'steer'` into the child's `inbox.nextStep`. The child consumes it cleanly at its nearest step boundary without interrupting in-flight tool execution.
2. **Child-to-Parent In-Turn Reply**: Every continuable child is instructed via `withContinuableReturnGuidance` with its parent's session ID (`Your parent agent id is <id>. Before you finish, send your result to that agent with send_message...`). The child calls `send_message` targeting `parentId`, which `SubagentContinuationManager` detects as a parent reply and wakes the parent with `'steer'` or `'queue'`.
3. **Automatic Settlement Notices**: When a child activation terminates, `ContinuableActivationRegistry.notifySettlement` automatically constructs a settlement notice (`createSettlementMessage`) and wakes the parent.

Plan 15 explicitly documents and verifies this native substrate so implementers do not rebuild communication channels. Plan 15 instead focuses on closing the three genuine operational gaps: worker visibility (`ctx.subagentProgress`, enriched `list_agents`, and `subagent_tail`), model-facing hard teardown (`kill_agent` over `drainContinuableChildren`), and concurrency ceiling / operator pause gates (`maxConcurrentChildren`, `spawnPaused`).

## Adoption from Hermes

Every implementation plan (01–16) carries a dedicated `## Port sources` section mapping its capabilities to real Hermes source files. This encodes a standing architectural principle: **adopt and adapt battle-tested implementations from Hermes repositories rather than authoring each mechanism from scratch**. Hermes has already solved subtle multi-agent race conditions, state transitions, prompt boundaries, and file formats; porting proven logic preserves behavioral parity and eliminates entire classes of runtime defects.

### Where the Source Repositories Live

The port sources draw from three distinct local checkouts on this workstation:
- **`/home/sic/Downloads/hermes-agent-main`**: The upstream Hermes Agent repository. Contains the core Python agent runtime (`agent/`), client/dashboard web application (`web/`), TUI gateway (`tui_gateway/`), CLI commands (`hermes_cli/`), and foundational tool implementations (`tools/`).
- **`/home/sic/Desktop/storyincode/.hermes`**: The StoryInCode project Hermes installation. Houses autonomous orchestrator skills and assets under `skills/sic-orchestrator/assets/`, including the autonomous supervisor (`supervise.py`), verification runner (`truth_verify.py`), merge engine (`merge_card.py`), task axioms runtime (`task_axioms.py`), and board preflight diagnostics (`board_preflight.py`).
- **`/home/sic/.hermes`**: The active user-level Hermes environment. Houses runtime configuration, active plugins such as `plugins/task-requested/` (the founder outcome milestone document parser, bindings manager, schemas, and system prompt injector), and the multi-provider OAuth pool (`auth.json`).

### How to Read a Port Row

Each `## Port sources` table contains five standardized columns:
- **Capability in this plan**: The discrete feature or invariant delivered by the plan.
- **Hermes source file(s)**: Exact file paths and line number ranges in the source checkouts providing the reference logic.
- **What to take**: Specific algorithms, schemas, regexes, state transitions, or DDL to extract.
- **What must change in the port**: Architectural transformations required to bridge Python/CLI patterns into TypeScript, the Cordis micro-kernel (`ctx.<service>`), Schemastery configs, ScopedLayers, or CSS Modules.
- **Effort rating**:
  - `direct port`: Algorithmic or data structure translation with 1:1 mapping into TypeScript idioms.
  - `port with adaptation`: Core logic preserved, but execution model, lifecycle events, storage domains, or process boundaries adapted to native Harness contracts.
  - `reference only`: High-level layout or design pattern referenced, but code completely re-implemented to meet strict Harness constraints (e.g. CSS Modules and `ui-primitives` replacing Tailwind and external component libraries).

### The Honesty Rule for "No Hermes Equivalent" Rows

Rows marked `no Hermes equivalent — new code` are deliberate and mandatory. When DeepSeek Harness already provides a superior native primitive (such as native continuable parent-child messaging in Plan 15, or host `SettingsScope` and pre-hydration bootstrap injection in Plan 16), or where a capability is strictly novel to the Harness integration, the plan explicitly documents this fact rather than fabricating a synthetic Hermes lineage. This transparency guarantees implementers do not search for non-existent reference files or rebuild capabilities Harness already provides out of the box.

## Plan index

| Plan File | Title | Packages | Plane | Depends On |
|---|---|---|---|---|
| `plans/00-architecture-mapping.md` | DeepSeek Harness Architecture Mapping: Hermes Autonomous Development System | *(Architecture specification; maps 23 implementation packages & client UI)* | Host & Agent Planes | None (Foundational architecture specification) |
| `plans/01-kanban-substrate.md` | 01 — Kanban Store Capability Seam & SQLite Backend | `@deepseek-ai/dsh-kanban`, `@deepseek-ai/dsh-kanban-sqlite` | Host Plane | Core (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-subprocess`) |
| `plans/02-kanban-interaction-tools.md` | 02 — Kanban Model-Facing Tools & Slash Command Surface | `@deepseek-ai/dsh-tool-kanban`, `@deepseek-ai/dsh-command-kanban` | Agent Plane (`tool-kanban`), Host Plane (`command-kanban`) | `plans/01-kanban-substrate.md`, Core (`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-commands`) |
| `plans/03-axiom-subsystem.md` | 03 — Colocated Axiom Subsystem, Candidate Path Discovery, & Task Axiom Store | `@deepseek-ai/dsh-axiom` | Host Plane (`AxiomRegistry`), Agent Plane (`resolve_candidate_axioms`) | Core (`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-agent-instructions`, `@deepseek-ai/dsh-storage-domain`) |
| `plans/04-axiom-verification-sweeper.md` | 04 — Declarative Predicate Sweeper & Task Axiom Proof Tools | `@deepseek-ai/dsh-axiom-verifier`, `@deepseek-ai/dsh-tool-axiom` | Host Plane (`AxiomVerifier`), Agent Plane (`dsh-tool-axiom`) | `plans/01-kanban-substrate.md`, `plans/03-axiom-subsystem.md`, Core (`@deepseek-ai/dsh-shell`, `@deepseek-ai/dsh-verification`) |
| `plans/05-memory-and-soul.md` | 05 — SOUL Persona, Curated Memory Notes, & Transcript Search Tool | `@deepseek-ai/dsh-memory`, `@deepseek-ai/dsh-memory-local`, `@deepseek-ai/dsh-tool-memory` | Host Plane (`MemoryStore`), Agent Plane (`dsh-tool-memory`, persona) | Core (`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-persona`, `@deepseek-ai/dsh-tool-session-query`) |
| `plans/06-curator-and-self-learning.md` | 06 — Autonomous Skill Curator Daemon & Background Memory Review Fork | `@deepseek-ai/dsh-memory-curator` | Host Plane | `plans/05-memory-and-soul.md`, Core (`@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-skill`, `@deepseek-ai/dsh-storage-domain`) |
| `plans/07-worktree-management.md` | 07 — Worktree Management & Workspace Isolation | `@deepseek-ai/dsh-worktree`, `@deepseek-ai/dsh-worktree-local` | Host Plane | Core (`@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-fs`) |
| `plans/08-resource-guard-and-admission.md` | 08 — Resource Guard & Host Headroom Admission | `@deepseek-ai/dsh-guard-resource` | Host Plane | Core (`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-subprocess`) |
| `plans/09-verified-pipeline-and-gates.md` | 09 — Verification Evidence Ledger, Test Pinning, & Turn Stop Gates | `@deepseek-ai/dsh-verification`, `@deepseek-ai/dsh-guard-test-pinning`, `@deepseek-ai/dsh-verification-stop` | Host Plane (`dsh-verification`), Agent Plane (`guard-test-pinning`, `verification-stop`) | `plans/07-worktree-management.md`, Core (`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-shell`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-storage-domain`) |
| `plans/10-integration-and-pr-engine.md` | 10 — Worktree Integration Engine & GitHub PR Synchronization | `@deepseek-ai/dsh-integrator` | Host Plane | `plans/01-kanban-substrate.md`, `plans/07-worktree-management.md`, `plans/09-verified-pipeline-and-gates.md`, Core (`@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-shell`) |
| `plans/11-agy-subagent-provider.md` | 11 — agy External Subagent Provider & Token-Preserving Delegation | `@deepseek-ai/dsh-subagent-agy` | Host Plane | Core (`@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-tools`) |
| `plans/12-supervisor-and-watchdog.md` | 12 — Autonomous Supervisor Daemon, Watchdogs, & Quota Wall | `@deepseek-ai/dsh-supervisor` | Host Plane | `plans/01-kanban-substrate.md`, `plans/09-verified-pipeline-and-gates.md`, `plans/10-integration-and-pr-engine.md`, `plans/13-outcome-ledger.md` (prerequisite), `plans/15-orchestrator-vision-and-control.md` (telemetry), Core (`@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-storage-domain`) |
| `plans/13-outcome-ledger.md` | 13 — Outcome Ledger & Founder Milestone Tracking | `@deepseek-ai/dsh-ledger`, `@deepseek-ai/dsh-tool-ledger` | Host Plane (`OutcomeLedger`), Agent Plane (`tool-ledger`) | `plans/01-kanban-substrate.md`, `plans/03-axiom-subsystem.md`, Core (`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-storage-domain`) |
| `plans/14-presets-profiles-and-bundle.md` | 14 — Presets, Profiles, and Bundle Configuration | `@deepseek-ai/dsh-hermes-base`, presets `hermes-brain`, `hermes-worker` | Host Plane (bundle), Agent Plane (presets) | All plans (`plans/01`–`plans/13`, `plans/15`) |
| `plans/15-orchestrator-vision-and-control.md` | 15 — Orchestrator Vision and Control | `@deepseek-ai/dsh-subagent-progress`, `@deepseek-ai/dsh-tool-subagent-control`, `@deepseek-ai/dsh-tool-subagent` | Host Plane (`dsh-subagent-progress`), Agent Plane (`tool-subagent-control`, `tool-subagent`) | Core (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-session`), `plans/01-kanban-substrate.md`, `plans/07-worktree-management.md` |
| `plans/16-hermes-ui-theme-adoption.md` | 16 — Hermes UI and Theme Adoption | `@deepseek-ai/dsh-client-ui-theme`, `@deepseek-ai/dsh-client-ui-schedule`, `@deepseek-ai/dsh-client-ui-settings-models` | Client Plane (Host Plane settings schema) | Core (`@deepseek-ai/dsh-client-ui-theme`, `@deepseek-ai/dsh-client-ui-layout`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-settings`) |

## Features by plugin

### 01 — Kanban Store Capability Seam & SQLite Backend

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

### 02 — Kanban Model-Facing Tools & Slash Command Surface

- Model-facing tool suite exposing complete Kanban lifecycle operations to agent sessions
- Role-gated tool surface distinguishing orchestrator management from worker execution
- Parent-never-claims guard preventing orchestrator sessions from claiming tasks (INV-04)
- Anti-phantom card validation blocking completion of unverified child tasks (INV-15)
- Operator slash command `/kanban` routing management subcommands outside agent turns
- Pure Host UI presentation projections for pending and settled card views
- Replayable result metadata projections enabling stateless web card reconstruction
- Concurrency classification separating parallel read tools from serialized mutation barriers
- Heartbeat renewal tool protecting long-running tasks against watchdog stall timeouts
- Rich markdown collaboration comment trail and binary attachment handling

### 03 — Colocated Axiom Subsystem, Candidate Path Discovery, & Task Axiom Store

- Colocated axiom authoring in `AGENTS.md` files governing directory containment subtrees
- Machine-checkable axiom block specification embedded within markdown files via fenced YAML code blocks
- Clear demarcation separating machine-evaluated predicate blocks from model-binding prose instructions
- Planning-time candidate path discovery resolving governing axiom chains before files are touched
- Model-facing tool `resolve_candidate_axioms` providing on-demand axiom inspection for brainstorming and planning
- Direct reuse of `dsh-agent-instructions` discovery, directory chain ordering, budgeting, and sibling deduplication
- Host-plane task axiom store persisting card-level DoD contracts and proof records via `ctx.storageDomain` (`task_axioms` domain)
- Git diff impact analyzer mapping modified worktree files to applicable governing `AGENTS.md` chains
- Hierarchical consistency analyzer detecting polarity and constraint contradictions across parent and child scopes
- Declarative preset integration ensuring agents see governing constraints through composition without orchestration code

### 04 — Declarative Predicate Sweeper & Task Axiom Proof Tools

- Declarative predicate sweeper evaluating 9 deterministic AST, filesystem, and test conditions
- Attributable shell test evaluation seam rejecting exit-code masking operators (INV-11)
- AxiomVerifier host service executing automated sweeps across colocated AGENTS.md checks and task contracts
- Model tool attach_proof appending cryptographically typed proof records to task axiom contracts
- Model tool verify_task_axioms executing sweeps on demand and reporting granular check outcomes
- Strict anti-self-grading enforcement reverting unverified claims to active with attributable blockers (INV-10)
- Fail-closed No Unproven Done gate intercepting card completion transitions (INV-01)
- Clean card transition gating via published Cordis serial events and public service APIs without kanban coupling
- Colocated axiom integration evaluating machine-checkable blocks extracted from governing directory chains
- Automated escalation issue generation emitting structured auto-todo requests on sweep failures
- Ephemeral task continuation compiler extracting minimal blocker packets for worker resumption (M-010)

### 05 — SOUL Persona, Curated Memory Notes, & Transcript Search Tool

- Immutable human SOUL identity persona injected into system prompt Slot #1 (INV-09)
- Delimiter-separated semantic memory storage for persistent user and agent notes (USER.md, MEMORY.md)
- Cross-process mutual exclusion with POSIX file locking and atomic staging replacement
- Invariant prompt-snapshot prefix cache stability frozen across active turns (INV-08)
- Model-facing memory mutation tool supporting single actions and atomic batch operations
- Deferred batch character budget validation enforcing 2,200 char and 1,375 char ceilings
- Historical session transcript search reusing existing `@deepseek-ai/dsh-tool-session-query` package
- Unicode NFKC normalization and threat scanner blocking prompt injection vectors on write
- Load-time injection sanitization masking malicious entries with audit placeholders
- External drift detection and unreadable file protection with automated forensic backups
- Strict write-authority separation guaranteeing zero autonomous model authority over SOUL.md

### 06 — Autonomous Skill Curator Daemon & Background Memory Review Fork

- Periodic skill lifecycle decay engine transitioning unreferenced procedural skills from active to stale to archived
- Skill preservation invariant ensuring zero file deletion by moving retired skills into timestamped archive directories
- Curator ledger recording all skill state transitions, consolidations, and promotions via `ctx.storageDomain` (`curator` domain)
- Background review fork triggered on agent turn stopping every 10 turns without custom thread infrastructure
- Isolated child review agent execution via standard `ctx.subagents` seam with strict tool allowlisting
- Immediate human preemption cancelling background review forks upon incoming user turns with a 2.0-second deadline
- Read-before-write skill governance enforcing inspection prior to modifying procedural instructions
- Lesson-to-candidate-axiom promotion converting repeated constraints into candidate axioms across independent sessions
- Decoupled candidate axiom handoff staging proposals and emitting typed events without direct axiom package coupling
- Unattended deletion guard staging autonomous memory removal requests for human review approval
- Process-local turn budgeting and debounce preventing recursive or overlapping review executions
- Pre-consolidation filesystem snapshots preserving skill archives under content-addressed blob storage

### 07 — Worktree Management & Workspace Isolation

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

### 08 — Resource Guard & Host Headroom Admission

- Host memory headroom floor admission gate enforcing 3 GiB threshold before execution (INV-12)
- Monotonic tool guard synchronously vetoing heavy execution when host memory drops below limits
- Absolute memory floor protection refusing resource-intensive workloads below 1.5 GiB
- Synchronous file sovereignty guard preventing autonomous edits or deletion of SOUL.md (INV-09)
- Systemd cgroup v2 slice management and RAM/swap accounting under hermes-work.slice
- Dynamic worker admission concurrency governor based on host RAM pressure and slice reservations
- Sub-millisecond memoized memory sampling cache preventing I/O thrashing on /proc/meminfo
- Transparent cross-platform degradation falling back to native OS memory metrics on macOS and Windows
- Configurable tool pattern classifier distinguishing heavy workloads from diagnostic commands
- Live resource telemetry query API for supervisor daemons and administrative health checks

### 09 — Verification Evidence Ledger, Test Pinning, & Turn Stop Gates

- Verification evidence ledger backed by `ctx.storageDomain` tracking attributable test and typecheck executions
- Schema-validated verification domain (`verificationDomainSpec`) eliminating bespoke SQLite database boilerplate
- Synchronous in-memory status checks with durable background persistence via repository storage backends
- Attributable shell command parser rejecting masked exit codes and hidden errors (INV-11)
- Automated workspace mutation tracker invalidating verification freshness on code edits
- Independent RED gate evaluator proving behavioral failure before code modification (INV-14)
- Cryptographic SHA-256 test suite and runner configuration hash manifest generator
- Monotonic agent-scoped tool guard vetoing edits to pinned test files during implementer turns (INV-13)
- Physical filesystem write protection enforcing read-only permissions on pinned test suites
- Independent GREEN gate evaluator requiring zero exit code and matching cryptographic hash
- Serial turn-stopping lifecycle interceptor enforcing test execution after code edits
- Steering follow-up generator continuing turns when implementers stop without fresh proof
- Seven-tier anti-cheat engine mechanically blocking test deletion, weakening, or evasion
- Automatic evidence pruning enforcing size caps and 30-day retention policies

### 10 — Worktree Integration Engine & GitHub PR Synchronization

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

### 11 — agy External Subagent Provider & Token-Preserving Delegation

- Host-plane SubagentProvider registering external agy CLI delegation on ctx.subagents
- Token-preserving execution offloading large file reads and bulk edits from the Brain orchestrator (INV-03)
- Discrete subprocess execution via ctx.subprocess with sanitized environment and zero shell interpretation
- Headless execution targeting /home/sic/.local/bin/agy with automatic permission bypass flags
- Real-time NDJSON wire parsing decoding stdout in stream-json format
- Incremental progress tracking and text delta accumulation across CLI step_update events
- Safe result normalization extracting terminal response text and token metrics into SubagentResult
- Never-reject contract flattening process crashes, syntax faults, and non-zero exits into diagnostic results
- Process group termination escalating from SIGINT to SIGTERM and SIGKILL across a configurable grace period
- Strict workspace directory resolution anchoring child processes to parent session working trees
- Preflight validation verifying CLI executable presence, execute permissions, and workspace accessibility
- Seamless integration with standard dsh-tool-subagent preset configurations in one-shot mode

### 12 — Autonomous Supervisor Daemon, Watchdogs, & Quota Wall

- Host-plane supervisor daemon maintaining autonomous watchdog over all active kanban workers
- Continuous background heartbeat observer detecting hung, crashed, or silent worker processes
- Configurable intervention escalation ladder executing automated process termination and claim reclamation
- High-resolution process tree termination escalating from SIGTERM to SIGKILL across configurable grace periods
- Durable circuit breaker trip protection persisting consecutive failure counts and crash errors in ctx.storageDomain across daemon restarts
- Quota wall coordination freezing dispatch and requeuing cards with cooldown on HTTP 429 rate limits
- Automated post-completion result review verifying task axioms and worktree cleanliness
- Autonomous follow-up card creation carrying forward uncompleted checklist todos from completed cards
- Automated defect card extraction capturing uncovered bugs reported in completion comments
- Safe integration pipeline dispatch triggering automated merge verification upon clean card completion
- Milestone todo closure verification proving all governing founder axioms are witnessed by landed commits
- Real-time telemetry logging emitting structured board metrics and resource consumption samples

### 13 — Outcome Ledger & Founder Milestone Tracking

- Durable outcome milestone document persistence under `~/.hermes/task-requested/<slug>.md`
- Machine-readable milestone index and task binding catalog in `bindings.json`
- Human and model parseable markdown serialization preserving `# Task`, `## Pending`, `## Archived`, and `## Done` sections
- Objective Definition of Done (DoD) contract specification per milestone outcome
- Atomic file writes and cross-process lock protection preventing corrupted ledger updates
- Model-facing `ledger_show` inspection tool displaying outcome status and linked task states
- Model-facing `ledger_update` tool managing outcome creation, task bindings, and DoD amendments
- Objective §5.10 / §5.11 todo closure verification evaluating task states, dirty worktrees, and unresolved checklists
- Cryptographic governing axiom witness evaluation gating milestone completion behind landed commit SHAs (INV-01)
- Automated transition of pending outcomes to done with formatted witness reports and commit satisfiers
- Auto-todo issue document generation under `auto-todos/<task_id>.md` upon axiom sweep failures
- System-prompt intake policy injecting the mandatory 4-point statement contract into orchestrator turns (Spec §5.1)

### 14 — Presets, Profiles, and Bundle Configuration

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

### 15 — Orchestrator Vision and Control

- Verifiable documentation of native two-way parent-child messaging and settlement notices
- Host-plane progress tracking service recording active worker runtime, step counts, and tool calls
- Enriched `list_agents` projection exposing elapsed seconds, step count, last tool, model, and staleness
- Model-facing `subagent_tail` tool streaming recent transcript events from running worker sessions
- Model-facing `kill_agent` tool wrapping host `drainContinuableChildren` for authorized hard teardown
- Strict worktree preservation ensuring uncommitted worker code is never deleted upon kill
- Atomic Kanban card release preventing orphaned running state when workers are terminated
- Configurable concurrent children ceiling preventing runaway worker fan-out and quota exhaustion
- Operator spawn pause gate freezing worker delegations during maintenance or pressure
- Zombie and hung-worker detection calculating step inactivity thresholds across active activations
- Supervisory integration enabling host watchdog to consume vision metrics without duplication

### 16 — Hermes UI and Theme Adoption

- Built-in Hermes theme catalogue integrating 8 iconic palettes into the client theme registry
- Direct mathematical token mapping from Hermes 2-layer palettes onto `--dsw-alias-*` semantic variables
- Durable custom theme persistence across browser reboots via relaxed settings schema
- High-fidelity theme swatch selector rendering 3-stop preview bars in the Appearance settings row
- Independent typography and font-family customization complementing conversation font scaling
- Pre-plugin bootstrap script resilience preventing flash-of-unstyled-content on custom theme boot
- Visual cron and webhook schedule builder ported to the client schedule interface
- Model telemetry and capability card presentation ported to client models settings
- Complete Simplified Chinese and English localization compliant with the AST i18n verification gate
- Zero-regression preservation of existing default theme, system preference following, and contrast ratios

## Dependency order

The recommended implementation order follows the topological dependency graph, addressing prerequisites before dependent consumers while resolving cross-plan contract dependencies:

1. **Plan 01 (`plans/01-kanban-substrate.md`)**: Foundation of all task coordination, state transitions, and card locking; must precede all Kanban consumers and serial pre-complete hooks.
2. **Plan 03 (`plans/03-axiom-subsystem.md`)**: Core domain contract engine parsing colocated `AGENTS.md` and hosting task axioms via `ctx.storageDomain`; must precede sweeper and outcome contracts.
3. **Plan 05 (`plans/05-memory-and-soul.md`)**: Foundational identity persona (`SOUL.md`, Slot #1) and memory store; independent of Kanban and axioms.
4. **Plan 07 (`plans/07-worktree-management.md`)**: Isolated filesystem worktree pool required by verification pipelines and worker execution environments.
5. **Plan 08 (`plans/08-resource-guard-and-admission.md`)**: Host-level memory headroom governor and cgroup slice manager protecting the host prior to multi-worker execution.
6. **Plan 11 (`plans/11-agy-subagent-provider.md`)**: Out-of-process CLI subagent delegation provider registered into `ctx.subagents`; independent of Kanban.
7. **Plan 02 (`plans/02-kanban-interaction-tools.md`)**: Exposes model-facing Kanban tools and `/kanban` slash command; requires Plan 01 (`ctx.kanban`).
8. **Plan 04 (`plans/04-axiom-verification-sweeper.md`)**: Evaluates declarative predicates and enforces No Unproven Done (`INV-01`); requires Plan 01 (`kanban/pre-complete`) and Plan 03 (`ctx.axioms`).
9. **Plan 06 (`plans/06-curator-and-self-learning.md`)**: Background skill decay and memory review forks; requires Plan 05 (`ctx.memory`) and core subagents.
10. **Plan 09 (`plans/09-verified-pipeline-and-gates.md`)**: Authoritative verification evidence ledger, test pinning guard (`INV-13`), and turn-stopping gates (`INV-14`); requires Plan 07 (`ctx.worktrees`).
11. **Plan 13 (`plans/13-outcome-ledger.md`)**: Founder milestone documents and DoD criteria; requires Plan 01 (`ctx.kanban`) and Plan 03 (`ctx.axioms`). *(Crucial: must be implemented prior to Plan 12 to provide `ctx.ledger` for supervisor milestone validation).*
12. **Plan 10 (`plans/10-integration-and-pr-engine.md`)**: Worktree branch integration, baseline differential testing, and GitHub PR synchronization; requires Plans 01, 07, and 09.
13. **Plan 15 (`plans/15-orchestrator-vision-and-control.md`)**: Host-plane worker progress tracker (`ctx.subagentProgress`), live transcript tailing, and hard worker teardown (`drainContinuableChildren`); requires Plans 01 and 07, and must precede Plan 12 so the supervisor watchdog consumes its progress telemetry without duplicating tracking.
14. **Plan 12 (`plans/12-supervisor-and-watchdog.md`)**: Autonomous supervisor daemon, worker heartbeats, circuit breakers, and milestone closure verification; requires Plans 01, 09, 10, 13, and 15 (`ctx.subagentProgress`).
15. **Plan 16 (`plans/16-hermes-ui-theme-adoption.md`)**: Client-plane Hermes theme catalogue, swatch picker, and presentation components; independent of backend execution tracks, requiring only the client UI theme and layout substrate.
16. **Plan 14 (`plans/14-presets-profiles-and-bundle.md`)**: Final distribution bundle (`@deepseek-ai/dsh-hermes-base`), agent presets (`hermes-brain`, `hermes-worker`), and launch profiles; depends on all preceding backend plans (01–13, 15).

### Parallel Implementation Tracks

Multiple implementation tracks can proceed concurrently without cross-blocking dependencies:
- **Track A (Task Board & Control)**: Plan 01 → Plan 02.
- **Track B (Axioms & Verification)**: Plan 03 → Plan 04 (once Plan 01 lands).
- **Track C (Memory & Self-Governance)**: Plan 05 → Plan 06.
- **Track D (Host Execution & Environment)**: Plan 07, Plan 08, and Plan 11 can all proceed completely in parallel.
- **Track E (Client UI & Themes)**: Plan 16 proceeds completely independently on the client plane.
- **Convergence Phase 1**: Plan 09 builds on Plan 07. Plan 13 builds on Plans 01 and 03. Plan 15 builds on Plans 01 and 07.
- **Convergence Phase 2**: Plan 10 builds on Plans 01, 07, and 09.
- **Convergence Phase 3**: Plan 12 unifies Plans 01, 09, 10, 13, and 15.
- **Final Assembly**: Plan 14 composes all host services and presets into the bundle.

## Shared service definitions

The following shared services are published onto Cordis `Context` (`ctx.<name>`) across the host and agent planes:

| Service Property | Published Type / Class | Provider Package | Consumer Packages / Plugins | Plane | Lifecycle & Purpose |
|---|---|---|---|---|---|
| `ctx.kanban` | `KanbanStore` | `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) | `dsh-tool-kanban`, `dsh-command-kanban` (Plan 02), `dsh-axiom-verifier` (Plan 04), `dsh-supervisor` (Plan 12), `dsh-ledger` (Plan 13), `dsh-integrator` (Plan 10) | Host Plane | Multi-session task state machine, 38-column schema, atomic claim leasing, DAG dependency queries in WAL mode. |
| `ctx.axioms` | `AxiomRegistry` | `@deepseek-ai/dsh-axiom` (Plan 03) | `dsh-axiom/tool` (Plan 03), `dsh-axiom-verifier` (Plan 04), `dsh-ledger` (Plan 13), `dsh-supervisor` (Plan 12) | Host Plane | Colocated `AGENTS.md` parser, candidate path resolution, diff-to-axiom analyzer, and `task_axioms` storage domain. |
| `ctx.axiomVerifier` | `AxiomVerifier` | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | `dsh-tool-axiom` (Plan 04), `dsh-supervisor` (Plan 12), `dsh-ledger` (Plan 13), serial `'kanban/pre-complete'` hook | Host Plane | Evaluates 9 deterministic AST/shell predicates, enforces No Unproven Done (`INV-01`), manages continuation packets. |
| `ctx.memory` | `MemoryStore` | `@deepseek-ai/dsh-memory-local` (Plan 05) | `dsh-tool-memory` (Plan 05), `dsh-memory-curator` (Plan 06) | Host Plane | Delimiter-separated semantic memory notes (`USER.md`, `MEMORY.md`), character budgets, turn snapshot stability (`INV-08`). |
| `ctx.memoryCurator` | `CuratorRuntime` | `@deepseek-ai/dsh-memory-curator` (Plan 06) | Autonomous daemon, emits `curator/*` events, hooks `agent/turn-stopping` | Host Plane | Skill decay engine (`active` → `stale` → `archived`), background memory review subagent launcher, candidate axiom staging. |
| `ctx.worktrees` | `WorktreeManager` | `@deepseek-ai/dsh-worktree-local` (Plan 07) | `dsh-integrator` (Plan 10), `dsh-supervisor` (Plan 12), worker session spawner | Host Plane | Dynamic git worktree allocation (`.worktrees/<id>/`), base commit pinning, dirty tree preservation (`INV-07`), pruning. |
| `ctx.resourceGuard` | `ResourceGuardService` | `@deepseek-ai/dsh-guard-resource` (Plan 08) | Hooks `ctx.tools.guard()` globally across all agent sessions and presets | Host Plane | 3 GiB host RAM admission floor (`INV-12`), systemd `hermes-work.slice` cgroup limits, and `SOUL.md` sovereignty protection (`INV-09`). |
| `ctx.verification` | `VerificationStore` | `@deepseek-ai/dsh-verification` (Plan 09) | `dsh-guard-test-pinning` (Plan 09), `dsh-verification-stop` (Plan 09), `dsh-integrator` (Plan 10), `dsh-supervisor` (Plan 12) | Host Plane | Authoritative evidence ledger backed by `ctx.storageDomain`, attributable shell parser (`INV-11`), RED/GREEN gate evaluators. |
| `ctx.integrator` | `IntegratorService` | `@deepseek-ai/dsh-integrator` (Plan 10) | `dsh-supervisor` (Plan 12), maintenance CLI tools | Host Plane | Automated branch integration, baseline test diffing, git merge commit pinning, draft PR synchronization, atomic rollback. |
| `ctx.subagents` (`'agy'`) | `SubagentProvider` | `@deepseek-ai/dsh-subagent-agy` (Plan 11) | Preset tool `@deepseek-ai/dsh-tool-subagent` (`provider: agy`) in `hermes-brain` | Host Plane | Headless out-of-process CLI subagent bridge offloading bulk file reads and heavy edits to preserve orchestrator context. |
| `ctx.subagentProgress` | `SubagentProgressTracker` | `@deepseek-ai/dsh-subagent-progress` (Plan 15) | `dsh-tool-subagent-control` (`list_agents`, `subagent_tail`) (Plan 15), `dsh-supervisor` (Plan 12) | Host Plane | Real-time worker telemetry cache (runtime, step counts, tool calls), staleness tracking, and zombie worker detection (>600s). |
| `ctx.supervisor` | `SupervisorService` | `@deepseek-ai/dsh-supervisor` (Plan 12) | Autonomous background host daemon | Host Plane | Worker heartbeat observer, circuit breaker retry tracking (`ctx.storageDomain`), 429 quota wall, milestone closure checks. |
| `ctx.ledger` | `OutcomeLedger` | `@deepseek-ai/dsh-ledger` (Plan 13) | `dsh-tool-ledger` (Plan 13, 14), `dsh-supervisor` (Plan 12), `dsh-axiom-verifier` (Plan 04) | Host Plane | Human-readable milestone outcome documents (`<slug>.md`), DoD validation, cryptographic witness compilation, auto-todos. |
| `ctx.theme` | `ThemeRuntime` | `@deepseek-ai/dsh-client-ui-theme` (Plan 16) | Client UI layout, `AppearanceRow`, `ThemePresenter` | Client Plane | Client theme registry coordinating 8 Hermes palettes, active color schemes, font scaling, and durable settings persistence via relaxed `ThemeSettingsSchema`. |

## Composed through agent presets

The DeepSeek Harness architecture strictly separates code plugins from preset compositions. Major operational subsystems are realized entirely through declarative YAML preset configuration in `packages/preset/agent-presets/presets/`:

### 1. `hermes-brain` (The StoryInCode Brain Orchestrator)
Configured in `presets/hermes-brain/agent.cordis.yml` for high-order planning and coordination:
- **Identity Persona**: `@deepseek-ai/dsh-persona` mounted at Slot #1 with the Brain orchestrator prompt (Claude Opus 4.8 persona, never claim tasks directly, delegate large files to `agy`).
- **Instruction Assembly**: `@deepseek-ai/dsh-agent-instructions` loading root and project guidance up to 64KB.
- **Entry-Local Planning Isolation**: Isolated realm `isolate: { planMode: true }` containing `@deepseek-ai/dsh-plan-mode`, ensuring per-session draft plans never collide across concurrent sessions (PRESET-RULES 3, 10).
- **Kanban & Milestone Orchestration**: `@deepseek-ai/dsh-tool-kanban` configured with `role: orchestrator` and `maxListLimit: 50`, paired with `@deepseek-ai/dsh-tool-ledger` and `@deepseek-ai/dsh-axiom/tool`.
- **Entry-Local Delegation Group**: Isolated realm `isolate: { workflowEngine: true }` containing `@deepseek-ai/dsh-workflow-worker-thread`, `@deepseek-ai/dsh-tool-workflow`, and `@deepseek-ai/dsh-tool-subagent` with multiple providers:
  - `provider: spawn` (`toolName: subagent`) for fast in-process subagents.
  - `provider: fork` (`toolName: subagent_fork`) for session fork exploration.
  - `provider: agy` (`toolName: subagent_agy`, `backgroundMode: one-shot`) for token-preserving external CLI offloading.
  - Configured with `maxConcurrentChildren: 4` and `spawnPaused: false` to enforce concurrency ceilings and operator pause gates (Plan 15).
- **Subagent Companion Control Tools**: `@deepseek-ai/dsh-tool-subagent-control` providing `send_message`, `interrupt_agent`, enriched `list_agents` (with live runtime duration, step count, active tool, model, and zombie indicators), `subagent_tail` (streaming recent transcript events), and `kill_agent` (model-facing hard stop via `drainContinuableChildren` with worktree and Kanban CAS safety) (Plan 15).
- **Memory & Historical Query**: `@deepseek-ai/dsh-tool-memory` for note CRUD and `@deepseek-ai/dsh-tool-session-query` for historical transcript searches.
- **Entry-Local Compaction Isolation**: Isolated realm `isolate: { compaction: true, toolResultPruner: true }` containing `@deepseek-ai/dsh-compaction-basic`, `@deepseek-ai/dsh-command-compact`, and `@deepseek-ai/dsh-compaction-tool-result-pruner` (8KB threshold).

### 2. `hermes-worker` (The Unattended Engineering Worker)
Configured in `presets/hermes-worker/agent.cordis.yml` for bounded implementation in Git worktrees:
- **Identity Persona**: `@deepseek-ai/dsh-persona` mounted at Slot #1 with worker instructions (unattended engineering worker, contract-bounded, implement pinned tests, never edit pinned test files).
- **Worktree Instruction Scoping**: `@deepseek-ai/dsh-agent-instructions` scoped to the active worktree directory.
- **Continuable Worker Lifecycle**: Workers execute continuably under `SubagentContinuationManager`, receiving parent instructions via `inbox.nextStep` and sending discoveries or final results to `parentId` via native `send_message` without premature turn termination (Plan 15).
- **Execution Substrate**: Standard shell and filesystem tools (`@deepseek-ai/dsh-tool-bash`, `@deepseek-ai/dsh-tool-pwsh`, `@deepseek-ai/dsh-tool-fs`, `@deepseek-ai/dsh-tool-fs-search`, `@deepseek-ai/dsh-tool-jobs`).
- **Kanban Worker Surface**: `@deepseek-ai/dsh-tool-kanban` configured with `role: worker`, providing `kanban_show`, `kanban_heartbeat`, `kanban_request_review`, `kanban_comment`, and `kanban_attach` (omits `kanban_create`, `kanban_list`).
- **Axiom Compliance Surface**: `@deepseek-ai/dsh-tool-axiom` providing `attach_proof` and `verify_task_axioms`.
- **Enforced Execution Guards**: `@deepseek-ai/dsh-guard-test-pinning` attached to `ctx.tools.guard()` (INV-13) and `@deepseek-ai/dsh-verification-stop` attached to `agent/turn-stopping` (INV-14).
- **Session Search Omission**: Intentionally omits `@deepseek-ai/dsh-tool-session-query` to conserve token budget and enforce task-contract focus.
- **Entry-Local Compaction**: Replicates the isolated compaction group to maintain session-private pruner history.

### 3. In-Process Subagent Role Specialization
Rather than creating distinct presets or custom code packages for sub-roles, child subagent roles are synthesized entirely through runtime composition via `composeFrom` and `toolFilter`:
- **Test Writer**: Child derived from `hermes-worker` with write permissions to `tests/` and read-only access to implementation source.
- **Implementer**: Child derived from `hermes-worker` with `guard-test-pinning` actively blocking modifications to `tests/`.
- **Reviewer**: Child derived from `hermes-worker` with `toolFilter: { deny: ['bash', 'pwsh', 'fs_write', 'fs_edit', 'fs_patch'] }`, guaranteeing a strictly read-only inspection environment.

### 4. Client UI Plane Separation (Hermes Themes & Presentation)
Client UI packages (Plan 16: `@deepseek-ai/dsh-client-ui-theme`, `@deepseek-ai/dsh-client-ui-schedule`, `@deepseek-ai/dsh-client-ui-settings-models`) reside strictly on the **Client Plane** (`packages/bundle/web-app/cordis.patch.yml`). Per PRESET-RULES, client UI extensions do NOT appear in agent presets and do NOT participate in agent isolate realms.

## Cross-cutting configuration

Configuration parameters that span multiple plans and components are standardized across the system:

### 1. Storage & Filesystem Paths
| Resource | Standard Path | Owning Plan & Configuration Key | Consumers / Readers |
|---|---|---|---|
| Kanban SQLite DB | `~/.hermes/kanban.db` | Plan 01 (`SqliteKanbanConfig.dbPath`) | `SqliteKanbanStore`, external Python CLI tools (`supervise.py`, `merge_card.py`) |
| Outcome Milestones | `~/.hermes/task-requested/<slug>.md` | Plan 13 (`OutcomeLedgerConfig.storageDir`) | `OutcomeLedger`, founder (direct author/editor), `hermes-brain` |
| Auto-Todo Issues | `~/.hermes/task-requested/auto-todos/<task_id>.md` | Plan 13 (`OutcomeLedgerConfig.autoTodosDir`) | `OutcomeLedger`, `AxiomVerifier` (Plan 04 sweep failures), founder |
| Task Axioms Store | `task_axioms` domain (`ctx.storageDomain`) | Plan 03 (`taskAxiomsDomainSpec`) | `AxiomRegistry`, `AxiomVerifier`, `OutcomeLedger`, `Supervisor` |
| Verification Ledger | `verification` domain (`ctx.storageDomain`) | Plan 09 (`verificationDomainSpec`) | `VerificationService`, `AxiomVerifier`, `Integrator`, `Supervisor` |
| Supervisor State | `supervisor` domain (`ctx.storageDomain`) | Plan 12 (`supervisorDomainSpec`) | `SupervisorService` (circuit breaker retries across reboots) |
| Curator Audit Ledger | `curator` domain (`ctx.storageDomain`) | Plan 06 (`curatorDomainSpec`) | `CuratorRuntime` (decay transitions and usage tracking) |
| Git Worktree Pool | `.worktrees/<task-id>/` | Plan 07 (`LocalWorktreeConfig.worktreeRoot`) | `LocalWorktreeManager`, worker sessions, `Integrator` |
| Memory Notes | `~/.hermes/memories/USER.md`, `MEMORY.md` | Plan 05 (`LocalMemoryConfig.memoriesDir`) | `LocalMemoryStore`, `CuratorRuntime`, `dsh-tool-memory` |
| Skill Backups / Blobs | `~/.hermes/.curator_backups/blobs/<sha256>` | Plan 06 (`CuratorConfig.blobDir`) | `CuratorRuntime` (content-addressed pre-consolidation archives) |
| External agy Executable | `/home/sic/.local/bin/agy` | Plan 11 (`AgyConfig.executablePath`) | `AgySubagentProvider` |
| Systemd Cgroup Slice | `hermes-work.slice` | Plan 08 (`ResourceGuardConfig.sliceName`) | `ResourceGuardService`, systemd runtime |

### 2. Budgets & Capacity Ceilings
| Parameter | Ceiling / Limit | Declared Location | Purpose |
|---|---|---|---|
| User Memory Ceiling | 2,200 characters (~40 lines) | Plan 05 (`MemoryBudget.userCharsLimit`) | Prevents unbounded growth of `USER.md` in prompt context |
| Agent Memory Ceiling | 1,375 characters (~25 lines) | Plan 05 (`MemoryBudget.agentCharsLimit`) | Prevents unbounded growth of `MEMORY.md` in prompt context |
| Instruction Max Bytes | 65,536 bytes (64 KB) | Plan 14 (`agent-instructions.config.maxBytes`) | Bounds baseline `AGENTS.md` instruction injection |
| Kanban List Limit | 50 cards | Plan 02 & 14 (`ToolKanbanConfig.maxListLimit`) | Prevents model context flooding during board inspection |
| Review Subagent Tokens | 600,000 input tokens | Plan 06 (`CuratorConfig.reviewMaxInputTokens`) | Bounds background memory/skill review subagent consumption |
| Review Subagent Iterations | 16 iterations | Plan 06 (`CuratorConfig.reviewMaxIterations`) | Bounds reasoning rounds for background review subagents |
| Pruner Output Threshold | 8,192 characters | Plan 14 (`tool-result-pruner.config.thresholdChars`) | Truncates bloated tool execution results in context |
| Verification Retention | 30 days / 50 MB | Plan 09 (`VerificationConfig.retentionDays`) | Automatic evidence ledger pruning and size capping |

### 3. Operational Thresholds & Timeouts
| Threshold | Value | Declared Location | Invariant / Purpose |
|---|---|---|---|
| Memory Admission Floor | 3.0 GiB host RAM | Plan 08 (`ResourceGuardConfig.memoryFloorBytes`) | `INV-12`: Blocks new worker admission when RAM drops below 3 GiB |
| Absolute Memory Floor | 1.5 GiB host RAM | Plan 08 (`ResourceGuardConfig.absoluteFloorBytes`) | Vetoes active tool execution when host RAM drops below 1.5 GiB |
| Worker Heartbeat Timeout | 30 minutes (1,800,000 ms) | Plan 12 (`SupervisorConfig.workerHeartbeatTimeoutMs`) | Detects hung or silent workers and reclaims task claims |
| Circuit Breaker Limit | 2 consecutive failures | Plan 12 (`SupervisorConfig.maxRetries`) | Trips poisoned cards to `blocked` (`kind: 'capability'`) |
| Skill Decay (Stale) | 30 days inactivity | Plan 06 (`CuratorConfig.staleThresholdDays`) | Transitions uninvoked skills from `active` to `stale` |
| Skill Decay (Archive) | 90 days inactivity | Plan 06 (`CuratorConfig.archiveThresholdDays`) | Transitions stale skills to `archived` (no file deletion) |
| Background Review Cadence | Every 10 foreground turns | Plan 06 (`CuratorConfig.nudgeInterval`) | Triggers asynchronous background memory review fork |
| Human Preemption Deadline | 2.0 seconds | Plan 06 (`CuratorConfig.preemptionDeadlineMs`) | Aborts background review subagent upon incoming operator turn |
| Axiom Polarity Conflict | 0.6 (60% token overlap) | Plan 03 (`AxiomConfig.polarityConflictThreshold`) | Detects contradictory axioms between parent and child scopes |
| Subagent Replan Timeout | 300,000 ms (5 minutes) | Plan 12 (`SupervisorConfig.replanTimeoutMs`) | Bounds autonomous Brain re-planning subagent runs |
| SQLite Busy Timeout | 120,000 ms (2 minutes) | Plan 01 (`SqliteKanbanConfig.busyTimeoutMs`) | Kernel-level lock waiting across independent processes |

### 4. Model Routes
| Preset / Role | Target Model | Routing Rationale |
|---|---|---|
| `hermes-brain` | Claude Opus 4.8 | Complex architectural reasoning, Kanban decomposition, DoD contracts, and milestone validation. |
| `hermes-worker` | Fast Coding Model (Claude Sonnet 3.5 / DeepSeek V3) | Contract-bounded implementation within isolated Git worktrees against pinned tests. |
| `subagent_agy` | Provider-managed CLI model routing | Headless execution offloading bulk file inspection and repo-wide search to conserve main context. |

## What is deliberately NOT a skill

A central architectural directive of the DeepSeek Harness implementation is the strict rejection of monolithic or autonomous "skills" for tasks that require deterministic state, mechanical invariant enforcement, or lifecycle governance.

### 1. Rejected Skills and Owning Subsystems
| Rejected Skill | Why Rejected | Authoritative Owning Subsystem |
|---|---|---|
| `kanban-orchestrator-skill` | Monolithic skills cannot manage relational state machines, cross-table SQLite transactions, or multi-process file locking. | `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) & `@deepseek-ai/dsh-tool-kanban` (Plan 02) |
| `axiom-sweeper-skill` | "The worker reports, the sweeper decides". A skill cannot mechanically enforce invariants, parse ASTs, or securely evaluate shell commands. | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) |
| `worktree-manager-skill` | Worktree allocation, collision prevention, unpushed commit protection (`INV-07`), and sandboxing require deterministic Git plumbing. | `@deepseek-ai/dsh-worktree-local` (Plan 07) |
| `test-pinning-skill` | Prompt instructions cannot prevent an adversarial or hallucinating model from editing test files during implementation. | `@deepseek-ai/dsh-guard-test-pinning` (Plan 09) via `ctx.tools.guard()` |
| `self-learning-curator-skill` | Skill curation and memory consolidation require cron/turn hooks, schema-validated storage, and subagent process management. | `@deepseek-ai/dsh-memory-curator` (Plan 06) |
| `worker-supervisor-skill` | Monitoring hung workers, evaluating heartbeat intervals, and tripping circuit breakers cannot be left to an LLM prompt. | `@deepseek-ai/dsh-supervisor` (Plan 12) host daemon |
| `soul-skill` | `SOUL.md` identity cannot be loaded dynamically on-demand; it must sit in Identity Slot #1 (`order 0`) for KV cache stability (`INV-08`). | `@deepseek-ai/dsh-persona` (Plan 05) & `@deepseek-ai/dsh-guard-resource` (Plan 08) |

### 2. The Survived Procedural Skills
Only three procedural skills survived scrutiny, strictly conforming to the Harness definition of a skill (ephemeral, single-turn markdown reference playbooks loaded on demand via `tool-skill`):
- `bdd-scenario-guide`: Ephemeral formatting guidelines and edge-case checklists for authoring BDD test scenarios, referenced only during test-writer turns.
- `code-review-lens`: Qualitative three-lens evaluation heuristics and inspection questions, referenced only during independent reviewer turns.
- `stylex-coexistence-recipe`: Domain-specific manual refactoring patterns and anti-pattern catalogs for CSS/StyleX coexistence tasks (ADR-015).

## Review status

A comprehensive, three-pass architectural system review was conducted across all seventeen plans (00–16) and recorded in `REVIEW-contracts.md`, `REVIEW-seams.md`, and `REVIEW-lifecycle.md`, accompanied by explicit storage-domain reuse audits (`REVIEW-storage`).

### 1. Defect Classes Identified
1. **Missing Serial Hook Contracts**: Invariant `INV-01` (No Unproven Done) was unenforceable because Plan 01 omitted the `'kanban/pre-complete'` serial event hook.
2. **Preset Service Provider Leakage**: Root Cordis service providers (`@deepseek-ai/dsh-ledger` and `@deepseek-ai/dsh-axiom`) were mounted directly inside preset rows in `hermes-brain/agent.cordis.yml` outside an `isolate` realm, causing fatal `leakedServices` mount failures under PRESET-RULE 1.
3. **Responsibility Collisions & Redundant Packages**: Auto-todo generation was implemented redundantly with diverging paths in both Plan 04 and Plan 13; session search was duplicated in Plan 05 via `@deepseek-ai/dsh-tool-session-search` when `@deepseek-ai/dsh-tool-session-query` already existed; and anti-cheat shell parsing was duplicated between Plan 04 and Plan 09.
4. **Implementation-Order Inversions**: Plan 12's `MilestoneClosureValidator` depended directly on Plan 13's `OutcomeLedger`, creating an unresolvable build dependency in sequential execution.
5. **Unbounded Process & Subagent Leaks on Disposal**: Plan 11 lacked tracking and abortion for spawned out-of-process `agy` CLI processes on plugin unload; Plan 12 lacked abortion of active replanning subagents on teardown; and Plan 06 orphaned background review subagents upon parent session cancellation.
6. **SQLite Schema Versioning Violations**: Plan 01 and Plan 09 bypassed Harness SQLite conventions requiring public `SCHEMA_VERSION` constants, `PRAGMA user_version` checks, and atomic initialization stamping.
7. **Transient State Loss in Daemon Restarts**: Plan 12 maintained circuit breaker retry counters exclusively in memory, allowing poisoned tasks to enter infinite crash-and-restart loops across daemon reboots.
8. **Storage Capability Alignment**: Plans initially specified plain JSON/JSONL files or redundant SQLite stores where repository `ctx.storageDomain` was the architecturally required capability.

### 2. Review Fixes Applied and Verified in Files
- **REVIEW-contracts Fixes**:
  - Added `'kanban/pre-complete': (task: Task) => Promise<void> | void` serial hook to Plan 01, Plan 04, and Plan 12, guaranteeing `INV-01`.
  - Consolidated auto-todo generation into `@deepseek-ai/dsh-ledger` (`OutcomeLedger.generateAutoTodo`, Plan 13) and updated Plan 04 to delegate via `ctx.get('ledger')`.
  - Resolved preset audit failures by referencing `@deepseek-ai/dsh-axiom/tool` (`tool-candidate-axioms`) and `@deepseek-ai/dsh-tool-ledger` (`tool-ledger`) as unisolated agent-plane tool rows.
  - Inverted implementation order: established Plan 13 as a prerequisite implemented prior to Plan 12.
  - Normalized service class name to `OutcomeLedger` in Plan 12 and Plan 13.
  - Assigned anti-cheat shell parsing ownership strictly to `@deepseek-ai/dsh-verification` (Plan 09).
  - Aligned `ctx.kanban.releaseClaim(taskId, reason)` parameter arity in Plan 12.
  - Added `kanban_attachments` to Plan 14 tool summary.
- **REVIEW-seams Fixes**:
  - Eliminated `@deepseek-ai/dsh-tool-session-search` in Plan 05 and Plan 14, standardizing on `@deepseek-ai/dsh-tool-session-query`.
  - Verified entry-local isolation realms (`planMode`, `workflowEngine`, `compaction`) conforming to PRESET-RULES 1 through 13.
  - Removed invalid `$isolate` syntax in Plan 07 in favor of native Cordis cwd inheritance.
- **REVIEW-lifecycle Fixes**:
  - Added `activeRuns` registry and SIGTERM/SIGKILL escalation to `AgySubagentProvider` disposal in Plan 11.
  - Added `activeSubagents` tracking and teardown abortion in `SupervisorService` (Plan 12).
  - Added `activeReviews` tracking and parent session cancellation hooks in `CuratorRuntime` (Plan 06).
  - Added `KANBAN_SQLITE_SCHEMA_VERSION = 1` and `PRAGMA user_version` migrations to Plan 01.
  - Added durable circuit breaker persistence in `ctx.storageDomain` (`circuit_breakers` table) and `tasks.retry_count` in Plan 12.
- **REVIEW-storage Fixes**:
  - Plan 01: Retained bespoke SQLite (`~/.hermes/kanban.db`) due to relational DAG queries and cross-process `BEGIN IMMEDIATE` locks.
  - Plan 03: Adopted `ctx.storageDomain` (`task_axioms` domain), collapsed `dsh-axiom-local` into `dsh-axiom`, eliminated `dsh-axiom-context`.
  - Plan 06: Adopted `ctx.storageDomain` (`curator` domain, tables `ledger` and `usage`), dropped `.curator_ledger.jsonl`.
  - Plan 09: Adopted `ctx.storageDomain` (`verification` domain, tables `events`, `manifests`, `state`), eliminated `@deepseek-ai/dsh-verification-sqlite`.
  - Plan 12: Adopted `ctx.storageDomain` (`supervisor` domain, table `circuit_breakers`).
  - Plan 13: Stated explicit persistence justification for human-readable Markdown at `~/.hermes/task-requested/<slug>.md` (the founder reads and edits them directly as the human contract), while splitting machine-facing state (task bindings, milestone index, and derived status) into `ctx.storageDomain` (`ledger` domain).
- **External CLI OAuth Authentication & Subagent Composition**: Verified and established that external CLI agents (`agy`, Claude Code, Codex) authenticate directly from their own file-based OAuth credential stores under `$HOME` (`~/.hermes/auth.json`, `~/.claude/.credentials.json`, `~/.codex/auth.json`). Subagent providers perform zero credential acquisition, API-key injection, OAuth flow, or token refresh; `scrubbedParentEnv()` preserves `$HOME`, `$PATH`, `$USER`, and XDG directories for self-authentication. Model selection is owned by agy's provider router in `~/.hermes/auth.json` (with optional validated override, never pinned by Harness). Provider availability for `subagent-claude-code` and `subagent-codex` is a Profile composition fact rather than an auth barrier.
- **Plan 15 (Orchestrator Vision and Control)**: Established that two-way brain<->worker messaging already natively exists in Harness (`send_message`, `ctx.subagents.sendMessage`, `inbox.nextStep`, and `createSettlementMessage`). Closed the three genuine operational gaps: worker visibility via `@deepseek-ai/dsh-subagent-progress` (`ctx.subagentProgress`), enriched `list_agents`, and `subagent_tail`; model-facing hard teardown via `kill_agent` over `drainContinuableChildren` with `INV-07` worktree and Kanban CAS safety; and concurrency bounds via `maxConcurrentChildren` and `spawnPaused` in `tool-subagent`. Reconciled Plan 12 supervisor to consume `ctx.subagentProgress` and eliminate duplicate step tracking.
- **Plan 16 (Hermes UI and Theme Adoption)**: Adopted the 8 canonical Hermes theme palettes into `@deepseek-ai/dsh-client-ui-theme` with mathematical mapping onto `--dsw-alias-*` variables. Implemented a narrowly justified core schema relaxation in `ThemeSettingsSchema` to allow durable custom theme ID persistence across browser reboots. Prevented boot FOUC via `boot-theme.ts` pre-hydration scripts. Ported `ScheduleBuilder` and `CustomProviderCard` (`ModelInfoCard`) using CSS Modules and `ui-primitives`. Guaranteed zero visual regression on built-in themes and 100% AST i18n compliance.
- **Port Sources Adoption across All Plans (01–16)**: Conducted repository-wide provenance mapping, adding a `## Port sources` section to every plan. Standardized capability mapping across the three Hermes checkouts (`hermes-agent-main`, `storyincode/.hermes`, `~/.hermes`) with effort ratings and explicit disclosures for native Harness new code.

### 3. Open Items Summary
All blocking and non-blocking architectural and contractual defects have been resolved and committed into the respective plan files. Non-blocking design options requiring product ownership are cataloged in Section 11.

## Open questions

The following architectural choices represent genuine trade-offs that require explicit product owner determination:

1. **Worker Process Topology (In-Process Subagent vs Dedicated Out-of-Process Worker)**:
   - *Option A (In-Process)*: Run unattended engineering workers as in-process subagents via `ctx.subagents.start('spawn', ...)`.
     - *Advantages*: Sub-10ms startup, tiny memory footprint (~3MB baseline per worker), direct fiber-level Cordis event dispatch, shared model connection pooling.
     - *Risks*: A native addon crash, unhandled fatal segfault, or catastrophic memory leak in a worker process crashes the entire host process.
   - *Option B (Out-of-Process)*: Run workers as isolated OS child processes via a dedicated CLI runner or `dsh-subagent-dsh-sdk` bounded by systemd cgroups.
     - *Advantages*: Absolute OS process isolation, hard cgroup memory enforcement per worker, clean killability without host risk.
     - *Risks*: Higher baseline memory (~30MB per worker), process spawn latency (~1–2 seconds per task), requires inter-process communication serialization.
   - *Decision Needed From*: Engineering Product Owner (Reliability vs Density).

2. **GitHub Draft PR Synchronization Policy (Continuous Drafts vs Opt-In)**:
   - *Option A (Continuous Draft PRs)*: Every claimed card automatically opens or updates a GitHub Draft PR via `@deepseek-ai/dsh-integrator` as commits land.
     - *Advantages*: Total external visibility for human reviewers, automatic remote CI execution on intermediate work, zero manual PR synchronization steps.
     - *Risks*: Rapidly exhausts GitHub API rate limits on high-churn projects; creates noisy PR lists during rapid iteration.
   - *Option B (Pre-Merge Opt-In)*: Draft PRs are created only when a card requests review or when explicitly enabled via repository configuration.
     - *Advantages*: Conserves GitHub API quotas; keeps GitHub PR list clean until cards reach true candidate completion.
     - *Risks*: External CI does not test intermediate commits prior to review request.
   - *Decision Needed From*: Workflow Product Owner (Developer Experience vs API Limits).

3. **Historical Session Search Access in Worker Preset**:
   - *Option A (Omit `tool-session-query` from `hermes-worker` - Current Plan)*: Workers operate strictly against their task card, governing axioms, worktree diff, and test output.
     - *Advantages*: Conserves input tokens, prevents rambling across past transcripts, enforces strict adherence to localized card contracts.
     - *Risks*: Workers encountering cryptic environment or build errors cannot inspect how prior workers resolved identical build issues.
   - *Option B (Include `tool-session-query` in `hermes-worker`)*: Provide `session_search` to workers.
     - *Advantages*: Enables workers to retrieve historical debugging sessions and environment workarounds autonomously.
     - *Risks*: Increases worker tool schema overhead; risks worker context pollution.
   - *Decision Needed From*: Agent Capabilities Product Owner (Token Economy vs Autonomous Troubleshooting).
