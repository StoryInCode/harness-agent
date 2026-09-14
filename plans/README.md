# Autonomous Development System on DeepSeek Harness — Implementation Plans

The autonomous development system is an integrated, modular subsystem of the DeepSeek Harness framework. Built directly upon Harness's Cordis micro-kernel architecture, it cleanly bifurcates across two architectural planes: a singleton Host Plane providing multi-session coordination daemons, cross-session registries, and durable persistence backends; and an Agent Plane delivering scoped session loops, model-facing engineering tools, persona prompt injection, and monotonic execution guards. Monolithic scripts and ad-hoc file polling are replaced with strongly typed Cordis service contracts (`ctx.kanban`, `ctx.axioms`, `ctx.verification`, `ctx.worktrees`, `ctx.supervisor`, `ctx.ledger`), atomic SQLite databases with monotonic schema versioning, schema-validated storage domains (`ctx.storageDomain`), and non-bypassable tool execution guards (`ctx.tools.guard()`), establishing complete architectural congruence with Harness runtime invariants.

Execution orchestration is driven declaratively through the generalized **Autonomous Dev Loop** preset (`dev-loop`). The orchestrator Brain is completely model-agnostic and provider-agnostic: it can be driven by any user-selected model (DeepSeek V41, Claude Opus, OpenAI GPT-5, GLM-5, Astra, Antigravity, etc.). Subtasks are delegated to bounded concurrent worker slots (2–3 workers) operating in detached Git worktrees (`.worktrees/<piece-id>/`). The Brain dynamically routes tasks across **Capability Tiers** based on an explicit **Intelligence Index Floor**, strictly preventing underpowered models from touching complex architecture or formal gates while keeping tasks micro enough for **Index 2 (Core Engineering)** models to implement and test them deterministically without frontier model reliance.

## Architecture at a glance

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                       HOST PLANE                                         │
│                      (Root Cordis Container · packages/bundle/base)                      │
│                                                                                          │
│  [Shared Substrate Services & Daemons]                                                   │
│   ├─ ctx.kanban          : SqliteKanbanStore (SQLite WAL, schema v1, workspace-scoped)   │
│   ├─ ctx.axioms          : AxiomRegistry (Colocated AGENTS.md + ctx.storageDomain)       │
│   ├─ ctx.axiomVerifier   : AxiomVerifier (9 declarative evaluators, pre-complete hook)   │
│   ├─ ctx.memory          : LocalMemoryStore (USER.md & MEMORY.md, POSIX file locks)      │
│   ├─ ctx.memoryCurator   : CuratorRuntime (Skill lifecycle decay + review forks)         │
│   ├─ ctx.worktrees       : LocalWorktreeManager (Dynamic pool in .worktrees/<id>/)       │
│   ├─ ctx.resourceGuard   : ResourceGuardService (3 GiB floor, cgroups, SOUL guard)       │
│   ├─ ctx.verification    : VerificationStore (Evidence ledger via ctx.storageDomain)     │
│   ├─ ctx.integrator      : IntegratorService (Auto merge, baseline tests, draft PRs)     │
│   ├─ ctx.subagents       : SubagentRegistry (Host singleton: spawn, fork, providers)     │
│   ├─ ctx.supervisor      : SupervisorService (Heartbeats, circuit breaker, quota wall)   │
│   └─ ctx.ledger          : OutcomeLedger (ctx.storageDomain & task milestone contracts)  │
│                                                                                          │
│  [Cross-Cutting Invariants & Hooks]                                                      │
│   ├─ 'kanban/pre-complete' -> ctx.axiomVerifier (INV-01: No Unproven Done)               │
│   ├─ ctx.tools.guard()     -> ctx.resourceGuard (INV-12) & guard-test-pinning (INV-13)   │
│   └─ agent/turn-stopping   -> ctx.verificationStop (INV-14) & ctx.memoryCurator          │
└────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │ Scoped Session Mounts
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
┌──────────────────────────────────────────┐   ┌──────────────────────────────────────────┐
│               AGENT PLANE                │   │               AGENT PLANE                │
│       Preset: dev-loop (Any Model)       │   │        Worker Subagent (Dynamic)         │
│                                          │   │                                          │
│ [Identity & Instructions]                │   │ [Identity & Instructions]                │
│  ├─ persona (@deepseek-ai/dsh-persona)   │   │  ├─ persona (@deepseek-ai/dsh-persona)   │
│  └─ agent-instructions (@dsh-instruct)   │   │  └─ agent-instructions (scoped to cwd)   │
│                                          │   │                                          │
│ [Planning & Goal State]                  │   │ [Execution Substrate]                    │
│  ├─ plan-mode (isolate: planMode)        │   │  ├─ tool-bash / tool-pwsh                │
│  ├─ tool-goal / command-goal (Ledger)    │   │  ├─ tool-fs / tool-fs-search             │
│  └─ tool-todo (Micro-Gate Task Queue)    │   │  └─ tool-jobs (background tasks)         │
│                                          │   │                                          │
│ [Orchestrator Coordination Tools]        │   │ [Isolated Worktree Context]              │
│  ├─ tool-ask-user (ask_user)             │   │  └─ cwd: .worktrees/<piece-id>           │
│  ├─ tool-session-query (session_search)  │   │                                          │
│  └─ tool-candidate-axioms (resolve_cand) │   │ [Execution & Verification Guards]        │
│                                          │   │  ├─ guard-test-pinning (INV-13)          │
│ [Delegation - Dynamic Pool Routing]      │   │  └─ verification-stop (INV-14)           │
│  ├─ tool-subagent (modelSelection: true) │   │                                          │
│  ├─ tool-subagent-control (list_agents)  │   │ [Compaction - isolate: compaction]       │
│  └─ workflow-worker-thread               │   │  ├─ compaction-basic                     │
│                                          │   │  ├─ command-compact                      │
│ [Compaction & Skills]                    │   │  └─ tool-result-pruner                   │
│  ├─ compaction-basic / tool-result-pruner│   └──────────────────────────────────────────┘
│  ├─ skill-filesystem / tool-skill        │
│  └─ present (@dsh-tool-present)          │
└──────────────────────────────────────────┘
                     │
                     ▼ Subagent Roles Routed by Intelligence Index Floor
      ┌──────────────────────────────┬──────────────────────────────┐
      ▼                              ▼                              ▼
 [Index 3: Frontier]           [Index 2: Core]               [Index 1: Routine]
 · Architecture / Gates        · BDD Test Writing            · File moves to done/
 · Complex AST Parsers         · Feature Implementation      · README index updates
 · Deep Debugging & State Sync · Contracts & Validators      · Formatting & Linting
```

- **Host Plane Ownership**: Owns cross-session persistent state, shared coordination registries, background daemons, storage backends, and host-level execution guards.
- **Agent Plane Ownership**: Owns per-turn reasoning loops, scoped model-facing tool invocations, persona prompt injection, turn-stopping gates, and isolated session state.

### Native Two-Way Brain-Worker Communication

Two-way communication between orchestrator and worker subagents is a native capability of DeepSeek Harness:
1. **Parent-to-Child Steering**: The parent calls `send_message({ agent_id, message })` (`@deepseek-ai/dsh-tool-subagent-control`). The runtime routes this through `ctx.subagents.sendMessage` into `SubagentContinuationManager.sendMessage`, delivering the payload as `'steer'` into the child's `inbox.nextStep` at step boundaries without interrupting in-flight tool execution.
2. **Child-to-Parent In-Turn Reply**: Every continuable child is instructed with its parent's session ID (`Your parent agent id is <id>. Before you finish, send your result to that agent with send_message...`). The child calls `send_message` targeting `parentId`, which `SubagentContinuationManager` detects as a parent reply and wakes the parent.
3. **Automatic Settlement Notices**: When a child activation terminates, `ContinuableActivationRegistry.notifySettlement` automatically constructs a settlement notice and wakes the parent session.

## Sections

- [Active Specification Queue: Micro-Gates](#active-specification-queue-micro-gates)
- [Core Principles of Micro-Gates](#core-principles-of-micro-gates)
- [Active Sets in plans/pieces/](#active-sets-in-planspieces)
- [Execution and Verification Protocol](#execution-and-verification-protocol)
- [Preset and Bundle Composition](#preset-and-bundle-composition)
- [Review Status](#review-status)

## Active Specification Queue: Micro-Gates

The active, executable specification queue lives exclusively in bite-sized micro-gates under [`plans/pieces/`](pieces/).

Units of work are decomposed into atomic components that an **Index 2 (Core Engineering)** model can implement and test deterministically in a single pass without cognitive collapse.

### Core Principles of Micro-Gates

1. **Atomic Cognitive Ceiling**:
   - Exactly ONE pure function, isolated service method, or state transition ($\le 50$ lines of production code).
   - 2 to 4 crisp, unambiguous `Given/When/Then` scenarios ($\le 35$ lines of test code).
   - Pre-decided design points (`### Human Decision Point: Option A vs Option B`) in `## Summary`.
   - Complete, compilable TypeScript interface definitions in `## Contracts`.
   - Strict 280-line ceiling per piece file (`R-piece-size`).
2. **The Five Specialist Developer Personas**:
   - 🐾 **Neko-chan (Inspector Cat / Pure Intake)**: Heading scanning, metadata parsing, BDD extraction, formatting axioms (`R-piece-size`, `R-piece-required-sections`), sensory mental models (*Nya~*).
   - 🍰 **L (Forensic Detective / Epistemic Auditor)**: Proof tables (`R-claims-verified`), cryptographic token verification, fail-closed policy gates, deductive evidence rigor (*with cake 🍰*).
   - 💻 **Daru (Super Hacker / Subprocesses & Plumbing)**: Hands-on implementation, CLI scripts, test harnesses, SQLite schemas, WAL persistence, git worktree rigs (`bouncer.exe` 💻).
   - 🔬 **Hououin Kyouma (Mad Scientist / Divergence Controller)**: Monotonic state transitions, lifecycle state machines, async workflows, Steins Gate verification checkpoints (*El Psy Kongroo! 🔬*).
   - 🌸 **Mayuri (Gentle Seamstress / UX & Roster Harmony)**: Human-in-the-loop decisions (`Option A vs Option B`), presentation cards, slash commands (`/approve`, `/reject`), gentle summaries (*Tutturu~ 🌸*).
3. **Intelligence Index Floor & The Strict Non-Downgrade Invariant**:
   - **Index 3 Floor**: Architectural refactoring, AST compilers, formal verification gates.
   - **Index 2 Floor**: BDD test writing, feature implementation in `packages/`, schema validation.
   - **Index 1 Floor**: Mechanical file moves (`done/`), markdown index updates, linting passes.
   - Under no circumstances may an Index 2 or 3 task be downgraded to an Index 1 model to save tokens or bypass slot wait times.

## Active Sets in plans/pieces/

| Set | Path | Description | Status |
|---|---|---|---|
| `00-dev-loop` | [`plans/pieces/00-dev-loop/`](pieces/00-dev-loop/) | Interactive development loop, BDD scenario extractor, test freezer, and four deterministic verification gates. | Implemented in `packages/dev-loop/` |
| `01-agent-pool` | [`plans/pieces/01-agent-pool/`](pieces/01-agent-pool/) | Multi-provider model discovery, access boundary policies, quota tracking, and intelligence index routing. | Planned micro-gate set |
| `02-kanban` | [`plans/pieces/02-kanban/`](pieces/02-kanban/) | SQLite Kanban store, DAG dependency resolution, workspace scoping, and worker concurrency semaphores. | Planned micro-gate set |
| `03-axioms` | [`plans/pieces/03-axioms/`](pieces/03-axioms/) | Colocated machine-checkable axioms, candidate path discovery, and task axiom proof verification. | Planned micro-gate set |
| `04-memory-soul` | [`plans/pieces/04-memory-soul/`](pieces/04-memory-soul/) | Persona identity injection, curated memory notes, skill decay daemon, and background review forks. | Planned micro-gate set |
| `05-worktree-guard` | [`plans/pieces/05-worktree-guard/`](pieces/05-worktree-guard/) | Detached worktree pool manager, collision-safe allocation, and host resource headroom admission guards. | Planned micro-gate set |
| `06-verification` | [`plans/pieces/06-verification/`](pieces/06-verification/) | Authoritative verification evidence ledger, cryptographic test pinning guards, and anti-cheat checks. | Planned micro-gate set |

## Execution and Verification Protocol

Micro-gates represent atomic units of specification and implementation, bounded by strict verification invariants:
- **Atomic Scope & Line Ceiling**: Exactly one pure function, isolated service method, or state transition per component, strictly enforcing at most 280 lines per piece file.
- **Detached Worktree Isolation**: Subagents execute exclusively inside isolated detached worktrees under `.worktrees/<piece-id>/` branched from an immutable base commit; creating git branches is strictly prohibited.
- **Deterministic Verification Gates**: Every piece must pass the four deterministic gates before landing:
  1. `scripts/check-piece-primitive.sh`: Format validation ensuring pure function and single-primitive discipline.
  2. `scripts/check-piece-sections.sh`: Structural validation ensuring every mandatory section in canonical order (`## Summary`, `## Behaviour`, `## Harness fit`, `## Contracts`, `## Dependencies`, `## References`, `## How to see it`, `## Teach me while you build`, `## Resources and proof`, `## Reuse capture`, `## Acceptance`).
  3. `scripts/check-claim-citations.sh`: Citation verification proving cited files, symbols, and line numbers exist.
  4. `awk 'END{exit (NR>280)}'`: Line count validation enforcing the strict 280-line ceiling per specification file.
- **Done Transition & Mainline Transfer**: Completed piece specifications move to the set's done/ subdirectory, the owning set README (e.g. `plans/pieces/00-dev-loop/README.md`) updates status to done, and changes are cleanly transferred to mainline with post-transfer test and typecheck verification.

## Preset and Bundle Composition

Agent presets and deployment distribution bundles are structured across `packages/preset/` and `packages/bundle/`:
- **Agent Presets (`packages/preset/agent-presets`)**: Provides declarative Cordis YAML composition profiles in `packages/preset/agent-presets/presets/` (`standard`, `ptc`, `minimal`, `cordis`). Session identity is configured via `@deepseek-ai/dsh-persona` (`packages/preset/persona`), instructions via `@deepseek-ai/dsh-agent-instructions` (`packages/context/agent-instructions`), and planning state via `@deepseek-ai/dsh-plan-mode` (`packages/plan/plan-mode`).
- **Distribution Bundles (`packages/bundle/`)**: Packages full runtime patch layers for application profiles, including `packages/bundle/base` (root Cordis container and shared host services), `packages/bundle/headless` (CLI and background headless execution), and `packages/bundle/web-app` (interactive web application runtime).

## Review status

Architectural reviews for contracts, boundaries, lifecycle invariants, and base implementation are recorded in:
- [`plans/REVIEW-contracts.md`](REVIEW-contracts.md): Validates host/agent plane separation, serial 'kanban/pre-complete' hooks for invariant `INV-01`, and acyclic dependency DAGs across sets.
- [`plans/REVIEW-seams.md`](REVIEW-seams.md): Ensures root Cordis service providers remain on the host plane while model tools are isolated inside agent session presets.
- [`plans/REVIEW-lifecycle.md`](REVIEW-lifecycle.md): Enforces child subagent process termination escalation, monotonic SQLite schema versioning, and circuit breaker persistence.
- [`plans/REVIEW-dev-loop-base.md`](REVIEW-dev-loop-base.md): Documents the consolidation and baseline verification of the initial development loop packages in `packages/dev-loop/`.
