# DeepSeek Harness Architecture Mapping: Hermes Autonomous Development System

This document establishes the authoritative, binding architectural mapping from the Hermes Agent Specification (`HERMES-AGENT-SPEC.md`) into DeepSeek Harness (`dsh`) extension primitives. Every requirement, schema entity, and operational constraint is mapped onto an exact Harness primitive, plane, owning package, and lifecycle boundary.

---

### A. Executive Summary

1. **Architectural Thesis**: The Hermes autonomous development system ports onto DeepSeek Harness without patching core code, using standard Cordis capability seams, agent-plane presets, host-plane service providers, and durable session event-sourcing.
2. **Planes Separation**: Cross-session coordination (Kanban work queue, system axiom store, Git worktree pool, verification ledger, host admission guard, memory curator, autonomous worker supervisor, outcome ledger, and worktree integrator) resides exclusively on the **Host Plane** (`base.cordis.yml` patch layer). Session-scoped tool presentation, path-scoped axiom prompt injection, private plan state, and subagent delegation tools reside on the **Agent Plane** within agent presets (`agent.cordis.yml`).
3. **Preset Inventory**: Exactly **two** agent presets exist in the final architecture: `hermes-brain` (orchestrator session: board creation, task decomposition, ledger management, planning mode, MoA council fan-out, and token-preserving `agy` delegation) and `hermes-worker` (unattended engineering worker: filesystem, persistent bash, test execution, axiom proof attachment, and kanban completion/blocking).
4. **Role Gating**: Specialized engineering sub-roles (`test-writer`, `implementer`, `reviewer`) do not require separate preset files. They run under `hermes-worker` via the subagent driver's native per-child composition (`childCtx.tools.restrict()` and shadowing persona sections), avoiding preset multiplication.
5. **New Packages**: 23 focused implementation packages (plus 1 host bundle and 3 client UI presentation modules) organized under `packages/<group>/<pkg>/` across 11 functional domains (kanban, axiom, memory, worktree, guard, verification, integration, subagent, supervision, ledger, bundle).
6. **Reused Substrate**: 36 existing Harness packages are reused (`agent-loop`, `session`, `tools`, `subagent`, `subagent-spawn-in-process`, `subagent-fork-in-process`, `subagent-in-process-driver`, `tool-subagent`, `tool-subagent-control`, `workflow`, `workflow-worker-thread`, `plan-mode`, `todo`, `user-questions`, `tool-ask-user`, `user-approval`, `permission-presets`, `fs`, `fs-local`, `fs-sandbox`, `tool-fs`, `shell`, `bash-local`, `tool-bash`, `subprocess`, `subprocess-local`, `llm`, `llm-retry`, `session-persistence-jsonl`, `session-query-sqlite`, `tool-session-query`, `timeout-policy`, `agent-presets`, `persona`, `agent-instructions`, `storage-domain`).
7. **Core Modifications**: Exactly **one** narrowly justified core schema relaxation in `packages/client/ui-theme/src/theme-settings.ts` (`ThemeSettingsSchema`) allowing arbitrary registered custom theme IDs to persist across browser reboots. Zero core backend agent runtime changes. All Hermes invariants are enforced via public Cordis extension points (`ctx.tools.register`, `ctx.tools.guard`, `agent/turn-stopping`, `agent/pre-step`, `tools/pre-execute`, and `isolate` realms).

#### Amendments (Architecture Re-alignment)

1. **Correction 1 (`agy` as Subagent Provider & External CLI OAuth Authentication)**: Replaced the ad-hoc `@deepseek-ai/dsh-tool-agy` tool design with `@deepseek-ai/dsh-subagent-agy`. In DeepSeek Harness, delegating to an external CLI agent is the exact domain of a subagent Service Provider (`packages/subagent/subagent-codex` and `packages/subagent/subagent-claude-code`). All three external agent CLIs on this host (`agy`, Claude Code, Codex) are already linked and authenticated via OAuth from their own file-based credential stores under `$HOME` (`~/.hermes/auth.json`, `~/.claude/.credentials.json`, `~/.codex/auth.json`), performing zero credential acquisition, API-key injection, OAuth flow, or token refresh; `scrubbedParentEnv()` safely strips sensitive keys while preserving `$HOME`, `$PATH`, `$USER`, and XDG directories for self-authentication. Model selection for `agy` is resolved by its own active provider pool and router in `~/.hermes/auth.json` (with optional validated override, never pinned by Harness). Shipped providers `subagent-claude-code` and `subagent-codex` being disabled in stock `ptc` is a Profile composition fact, not an authentication barrier. `@deepseek-ai/dsh-subagent-agy` is a host-plane Service Provider registering provider name `agy` on the host `subagents` registry (`ctx.subagents`), consumed in `hermes-brain` by a standard `@deepseek-ai/dsh-tool-subagent` row (`provider: agy`, `toolName: subagent_agy`, `backgroundMode: one-shot`, `maxDepth: 'provider-managed'`) inside the existing delegation isolate group, alongside enabled `subagent_claude_code` and `subagent_codex` rows that mount when their provider bundles are installed in the Profile. `@deepseek-ai/dsh-tool-agy` is ELIMINATED.
2. **Correction 2 (Explicit Supervision Owner)**: Established `@deepseek-ai/dsh-supervisor` (`packages/supervision/supervisor`) as the dedicated host-plane owner for Spec §5.8–§5.10 (worker watching, heartbeat/stall timers, runtime limits, circuit breaker, quota wall cooldown, Result Review gates, and Brain re-planning escalation). Documented why guards, goal, workflows, subagent consumers, and session projections are unsuitable, and verified real Cordis/Agent/Kanban lifecycle events. Assigned to dedicated Plan 12.
3. **Correction 3 (Manifest Split & Cohesion)**: Split overloaded Plan 11 into cohesive units:
   - The outcome ledger / todo-closure capability stands alone in Plan 13 (`@deepseek-ai/dsh-ledger` and `@deepseek-ai/dsh-tool-ledger`); verified that existing `todo` and `goal` packages cannot be reused due to lifetime, schema, and binding constraints.
   - MoA council dropped as an `LlmAdapter` package (`@deepseek-ai/dsh-llm-moa` is ELIMINATED) after scrutiny revealed multi-model brainstorming is natively and transparently solved via Harness subagent fan-out or workflow scripts.
   - `@deepseek-ai/dsh-subagent-agy` moved to Plan 11 (Subagent Delegation).
   - Manifest renumbered to sequential plans matching implementation order, with every package in Section D appearing in exactly one plan file.
4. **Correction 4 (Verification Storage Consolidation)**: `@deepseek-ai/dsh-verification-sqlite` is ELIMINATED in Plan 09. Verification evidence persistence is managed directly via `ctx.storageDomain` (`verification` domain, tables `events`, `manifests`, `state`) within `@deepseek-ai/dsh-verification`, eliminating the redundant bespoke SQLite database package.
5. **Correction 5 (Colocated Axiom Subsystem & Package Collapsing)**: In Plan 03, `@deepseek-ai/dsh-axiom-local` was collapsed into `@deepseek-ai/dsh-axiom` (which houses the service contract and its `ctx.storageDomain` implementation for `task_axioms`), and `@deepseek-ai/dsh-axiom-context` is ELIMINATED because instruction prompt injection is natively handled broad-to-specific by `@deepseek-ai/dsh-agent-instructions`.
6. **Correction 6 (Session Search Reuse)**: In Plan 05 and Plan 14, proposed `@deepseek-ai/dsh-tool-session-search` is ELIMINATED in favor of the existing shipped `@deepseek-ai/dsh-tool-session-query` package.
7. **Correction 7 (Storage Domain Adoption & Relational SQLite Rationale)**: Plans 03 (`task_axioms` domain), 06 (`curator` domain, tables `ledger`, `usage`), 09 (`verification` domain, tables `events`, `manifests`, `state`), and 12 (`supervision` domain, table `circuit_breakers`) adopted `ctx.storageDomain` (`packages/storage/storage-domain`), replacing ad-hoc JSON/SQLite files. Plan 01 retained a bespoke relational SQLite store (`~/.hermes/kanban.db`) due to complex 38-column schemas, multi-table `writeTxn` transactions, DAG cycle traversals, and external Python CLI interoperability. Plan 13 adopted a dual approach: human-readable Markdown for founder documents (`~/.hermes/task-requested/<slug>.md`) and `ctx.storageDomain` (`ledger` domain, tables `bindings`, `milestones`) for machine-facing bindings.
8. **Correction 8 (Plan Order Inversion: Plan 13 Prerequisite for Plan 12)**: Plan 12's `MilestoneClosureValidator` depends on `OutcomeLedger` from Plan 13 to verify founder milestones upon `integrator/merged`. Plan 13 is now an explicit implementation prerequisite of Plan 12.
9. **Correction 9 (INV-01 Serial Hook Interception)**: Invariant `INV-01` (No Unproven Done) is carried by the `'kanban/pre-complete'` serial hook declared in `KanbanStore` and intercepted by `AxiomVerifier` before SQLite status commits.
10. **Correction 10 (Agent-Plane Tool Row Separation for Ledger & Axioms)**: Prevented root Cordis service leakage in presets by introducing `@deepseek-ai/dsh-tool-ledger` and `@deepseek-ai/dsh-axiom/tool` (`tool-candidate-axioms`) as pure tool plugins without extending `Service`.
11. **Correction 11 (Plan Manifest & README Index)**: The plan manifest comprises exactly 16 sequential plan files (`plans/01`–`plans/16`) coordinated through the master index at `plans/README.md`.
12. **Correction 12 (Native Two-Way Messaging Finding)**: Established that bidirectional parent<->worker communication is an existing, native capability of DeepSeek Harness (`send_message` via `ctx.subagents.sendMessage` into child's `inbox.nextStep`, children messaging `parentId` via `withContinuableReturnGuidance`, and automatic settlement notices via `createSettlementMessage`). Implementers MUST NOT build custom messaging channels. Plan 15 documents and establishes this finding.
13. **Correction 13 (Adoption from Hermes & Port-Sources Principle)**: Established the standing architectural principle across all plans (01–16) to adopt and adapt proven implementations from the three local Hermes checkouts (`/home/sic/Downloads/hermes-agent-main`, `/home/sic/Desktop/storyincode/.hermes`, `/home/sic/.hermes`) rather than authoring mechanisms from scratch. Every plan carries an authoritative `## Port sources` table with what to take, required adaptations, and effort ratings (`direct port`, `port with adaptation`, `reference only`), maintaining strict honesty where "no Hermes equivalent (new code)" is warranted.
14. **Correction 14 (Addition of Plan 15: Orchestrator Vision and Control)**: Added `plans/15-orchestrator-vision-and-control.md` to resolve the three genuine operational gaps in subagent delegation: worker runtime telemetry and staleness tracking via host service `@deepseek-ai/dsh-subagent-progress` (`ctx.subagentProgress`), live transcript tailing via `subagent_tail`, model-facing hard teardown via `kill_agent` over `drainContinuableChildren` (guarded by `INV-07` worktree preservation and atomic Kanban CAS release), concurrency limits (`maxConcurrentChildren`), operator pause gate (`spawnPaused`), and zombie detection (>600s). Reconciles Plan 12 supervisor to consume `ctx.subagentProgress` and eliminate duplicate step tracking.
15. **Correction 15 (Addition of Plan 16: Hermes UI and Theme Adoption)**: Added `plans/16-hermes-ui-theme-adoption.md` to adopt the 8 canonical Hermes theme palettes into `@deepseek-ai/dsh-client-ui-theme` (`hermes-teal`, `hermes-nous-blue`, etc.), translate tokens onto `--dsw-alias-*` variables, relax `ThemeSettingsSchema` to durably persist arbitrary registered theme IDs across browser reloads, prevent boot FOUC via `boot-theme.ts` pre-hydration injection, render 3-stop swatch previews in Appearance settings, rewrite `ScheduleBuilder` and `CustomProviderCard` (`ModelInfoCard`) using CSS Modules and `ui-primitives`, and enforce complete zh/en AST i18n compliance.

---

### B. Plane Assignment Rules Applied

Every mapping decision strictly obeys the non-negotiable rules in `PRESET-RULES.md` and repository architectural invariants:

#### 1. Decision Procedure

```
                     ┌────────────────────────────────────────────────────────┐
                     │            Decision Procedure: Plane & Realm           │
                     └───────────────────────────┬────────────────────────────┘
                                                 │
                           Is capability cross-session, queried by
                           external daemons/RPCs, or lifecycle-durable?
                                                 │
                                 ┌───────────────┴───────────────┐
                                 │ YES                           │ NO
                                 ▼                               ▼
                      ┌──────────────────────┐        Does the plugin publish a
                      │      HOST PLANE      │        Cordis Service on Context?
                      │  (base bundle patch) │                   │
                      └──────────────────────┘       ┌───────────┴───────────┐
                                                     │ YES                   │ NO
                                                     ▼                       ▼
                                          ┌─────────────────────┐ ┌─────────────────────┐
                                          │     AGENT PLANE     │ │     AGENT PLANE     │
                                          │  with isolate realm │ │  no isolate realm   │
                                          │ (cordis:group true) │ │(tools/prompt/skills)│
                                          └─────────────────────┘ └─────────────────────┘
```

#### 2. Systematic Evaluation of PRESET-RULES 1 through 13

- **PRESET-RULE 1 (Agent-Plane Composition)**: A preset file is an agent-plane composition mounted under one agent's scope context (`packages/preset/agent-presets/README.md:32`). Every tool and prompt section it registers belongs to that session alone via `ScopedLayers` (`packages/core/tools/src/index.ts:1047-1051`; `packages/core/scope/src/store.ts:159-267`).
  - *Hermes Application*: `hermes-brain` and `hermes-worker` preset files contain only model-facing tools, scoped prompt contributors, and session-isolated services. Sibling presets have disjoint standing keys and cannot see each other's tools.
- **PRESET-RULE 2 (Host Composition Ownership)**: The host composition (`packages/bundle/base/cordis.patch.yml`) keeps everything a preset must not own: the registries themselves, the sandbox and approval stack, persistence, and the model route.
  - *Hermes Application*: `ctx.kanban`, `ctx.axioms`, `ctx.worktrees`, `ctx.verification`, `ctx.memory`, `ctx.supervisor`, and `ctx.subagents` registries are hosted in `dsh-hermes-base` on the host plane.
- **PRESET-RULE 3 (Service Row Isolate Realm Requirement)**: A service row in a preset MUST sit inside a `cordis:group` carrying an `isolate` realm (`packages/preset/agent-presets/presets/ptc/agent.cordis.yml:19-26`). Without one, it publishes into the root realm, where it is process-global rather than per-session, and `dsh-agent-presets` rejects it at mount (`packages/preset/agent-presets/src/mount.ts:407-412`).
  - *Hermes Application*: Session-private services like `planMode` and `workflowEngine` sit in groups with `isolate: { planMode: true }` and `isolate: { workflowEngine: true }`.
- **PRESET-RULE 4 (Registry Contributors Need No Realm)**: Rows that only register into a host registry (`ctx.tools`, `ctx.commands`, `ctx.skills`) and provide no service need no realm (`packages/core/tools/src/index.ts:1047`).
  - *Hermes Application*: `@deepseek-ai/dsh-tool-kanban`, `@deepseek-ai/dsh-tool-axiom`, and `@deepseek-ai/dsh-tool-memory` reside directly at preset root without isolate realms.
- **PRESET-RULE 5 (Consumers Share Realm with Providers)**: A consumer that resolves a service with `ctx.get` must share the realm of the row that provides it (`PRESET-RULES.md:11`). A consumer left outside an isolate realm resolves the host instance instead.
  - *Hermes Application*: Any tool consuming an isolated service (e.g. `exit_plan_mode` consuming `planMode`) is grouped inside the same isolate realm.
- **PRESET-RULE 6 (Criterion for Host-Plane Ownership)**: A row that *injects* a service resolves before any session exists, so there is no agent to key by — it belongs in the host composition (`PRESET-RULES.md:12`).
  - *Hermes Application*: Daemons like `dsh-kanban-sqlite`, `dsh-memory-curator`, `dsh-supervisor`, and `dsh-integrator` inject core infrastructure (`subprocess`, `shell`, `sessionPersistence`) at boot time and belong in the host plane.
- **PRESET-RULE 7 (Producers Outside Preset Realm)**: A registry whose producers sit outside any realm the preset could create must stay host-plane (`PRESET-RULES.md:13`).
  - *Hermes Application*: The verification evidence store (`ctx.verification`) records results from independent test runners and terminal executions across sessions; it cannot be scoped inside a single preset.
- **PRESET-RULE 8 (Cross-Session Registries Stay Host-Plane)**: A registry read across sessions (e.g. `subagents`, whose cross-session queries the API proxy serves to the browser; a provider name may be registered only once) stays host-plane (`PRESET-RULES.md:14`). The preset contributes the delegation tools that resolve it.
  - *Hermes Application*: `ctx.kanban` and `ctx.subagents` coordinate cards and child provider runs across independent agent sessions; they reside host-plane, while `@deepseek-ai/dsh-tool-kanban` and `@deepseek-ai/dsh-tool-subagent` contribute scoped tools.
- **PRESET-RULE 9 (Agent-Private Registries Inside Preset)**: A registry nothing outside an agent reads belongs in an entry-local realm inside the preset, together with every row that reaches it (`PRESET-RULES.md:15`).
  - *Hermes Application*: In-session multi-agent workflows executed by the Brain belong in `isolate: { workflowEngine: true }`.
- **PRESET-RULE 10 (Per-Agent State Lifetime)**: Per-agent-by-nature state uses an entry-local realm because that is the correct lifetime, not as a workaround (`PRESET-RULES.md:16`).
  - *Hermes Application*: Plan mode deliberation state (`planMode: true`) lives and dies with the agent session.
- **PRESET-RULE 11 (Fail Loud at Mount)**: A row may declare dependence on a host service so the preset fails at mount naming that ID, rather than at the first request (`PRESET-RULES.md:17`).
  - *Hermes Application*: Tool rows declare explicit `inject: ['kanban', 'axioms']` so misconfigured presets fail activation immediately during `agentPresets.mount()`.
- **PRESET-RULE 12 (Preset Must Carry Tool Row)**: Host availability of an optional provider grants no tool: the preset must still carry the row (`PRESET-RULES.md:18`).
  - *Hermes Application*: Even though `ctx.kanban` is host-active and `ctx.subagents` carries `agy`, an agent session receives zero kanban or agy tools unless its preset explicitly carries `dsh-tool-kanban` and `tool-subagent` (`provider: agy`).
- **PRESET-RULE 13 (Strict `!!js` Usage)**: `!!js` (never `!js`) is permitted under plugin `config` and entry `disabled` only (`scripts/verify-cordis-config.ts:4-8, 509`).
  - *Hermes Application*: OS gating in presets uses `disabled: !!js process.platform === 'win32'` strictly on `disabled`.

---

### C. Requirement Mapping Table

| Spec § | Required Behavior | Harness Primitive | Owning Package | Services Provided | Injected Deps | Tools Exposed | Events Consumed / Emitted | Plane & Scope | In a Preset? | Skill Needed? | Subagent / Workflow? | Persistence | Config / Composition | Depends On |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **§5.1** | Founder intake & ambiguity clarification | Consumer / Tool | `@deepseek-ai/dsh-tool-ask-user` | None | `tools`, `userQuestions` | `ask_user_question` | Consumes `user-questions/request` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Logged in session transcript | Max batch 3 questions | `dsh-user-questions` |
| **§5.1** | Operating assumptions & 4-point statement | Event-hook plugin | `@deepseek-ai/dsh-tool-ledger` | None | `systemPrompt`, `ledger` | None | Consumes `agent/pre-step` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Logged in session transcript | Prompt section `ledger:intake-policy` | `dsh-ledger`, `dsh-system-prompt` |
| **§5.2** | Superpowers MoA brainstorming council | Subagent Fan-out / Workflow | `@deepseek-ai/dsh-subagent` (reused) | None | `subagents` | None | Emits `subagent/start`, `subagent/end` | Agent (Scoped) | Yes (`hermes-brain`) | No | Subagent fan-out across models | Session transcript events | Advisors + Aggregator route | `dsh-subagent` |
| **§5.3** | Outcome ledger persistent storage | Service Definition & Provider | `@deepseek-ai/dsh-ledger` | `ledger` (`OutcomeLedger`) | `fs`, `storageDomain` | None | Emits `ledger/outcome-changed` | Host (Global) | No (Host bundle) | No | No | `~/.hermes/task-requested/*.md` & `ctx.storageDomain` (`ledger`) | Markdown documents & domain tables | `dsh-storage-domain` |
| **§5.3** | Outcome ledger tools: `ledger_show`, `ledger_update` | Consumer / Tool | `@deepseek-ai/dsh-tool-ledger` | None | `tools`, `ledger` | `ledger_show`, `ledger_update` | None | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Updated in outcome storage | Parameter schemas | `dsh-ledger` |
| **§5.3** | Outcome todo milestone binding | Service Provider | `@deepseek-ai/dsh-ledger` | (implements `ledger`) | `ledger`, `kanban`, `storageDomain` | None | Consumes `kanban/task-status` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (`ledger` domain) | Task-to-milestone index | `dsh-kanban`, `dsh-storage-domain` |
| **§5.4** | Path ownership & single mutable owner rule | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | None | Host (Global) | No (Host bundle) | No | No | `tasks.workspace_path` | Disjoint paths check | `dsh-kanban` |
| **§5.4** | Plan mode collaborative deliberation | Consumer | `@deepseek-ai/dsh-plan-mode` | `planMode` (`PlanModeService`) | `tools`, `userQuestions`, `sessionProjections` | `exit_plan_mode` | Emits `plan/mode` | Agent (Scoped, Isolate) | Yes (`hermes-brain`) | No | No | Session projection `plan` | Section order 500 | `dsh-session-projection` |
| **§5.4** | Plan exit structured review tool | Consumer | `@deepseek-ai/dsh-plan-mode` | (implements `planMode`) | `planMode`, `userQuestions` | `exit_plan_mode` | Consumes `user-questions/request` | Agent (Scoped, Isolate) | Yes (`hermes-brain`) | No | No | Appends `plan/mode: { active: false }` | Plan approval schema | `dsh-plan-mode` |
| **§5.5** | Card creation with DoD & checklist | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_create` | Emits `kanban/task-created` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | `tasks` table row | Checklist validation | `dsh-kanban` |
| **§5.5** | Model routing & catalog selection | Configuration | `@deepseek-ai/dsh-llm` | None | `llm` | None | Consumes `agent/request` | Host (Global) | No (Host bundle) | No | No | Session call config | Router tier mappings | `dsh-llm` |
| **§5.6** | Task DAG edge linking | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_link` | Emits `kanban/dependency-linked` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | `task_links` table | Parent-child pairs | `dsh-kanban` |
| **§5.6** | Graph cycle detection & self-link prevention | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | None | Host (Global) | No (Host bundle) | No | No | `task_links` table | Kahn's algorithm DFS | `dsh-kanban` |
| **§5.6** | Board preflight integrity audit | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban`, `worktrees`, `llm` | None | None | Host (Global) | No (Host bundle) | No | No | None | Preflight check suite | `dsh-kanban` |
| **§5.7** | Unattended worker process spawning | Consumer | `@deepseek-ai/dsh-subagent` | (consumes `subagents`) | `subagents`, `agents`, `kanban` | None | Emits `subagent/start`, `subagent/end` | Host (Global) | No (Host bundle) | No | Subagent (`spawn` provider) | Subagent session log | Headless invocation | `dsh-subagent` |
| **§5.7** | Parent-never-claims invariant (`INV-04`) | Guard | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `agents` | None | Evaluates `ctx.tools.guard()` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | None | Refuses claim from root | `dsh-kanban` |
| **§5.8** | Worker telemetry & heartbeat observer | Service Provider & Daemon | `@deepseek-ai/dsh-supervisor` | `supervisor` (`SupervisorService`) | `kanban`, `subprocess`, `sessionPersistence` | None | Consumes `kanban/heartbeat-tick`, emits `supervisor/audit-warning` | Host (Global) | No (Host bundle) | No | No | `~/.hermes/board-metrics/samples.jsonl` | Watchdog interval 30s | `dsh-kanban` |
| **§5.9** | Silent worker & stuck process detection | Service Provider & Daemon | `@deepseek-ai/dsh-supervisor` | (implements `supervisor`) | `kanban`, `subprocess` | None | Consumes `kanban/heartbeat-tick`, emits `kanban/claim-stale`, `supervisor/intervened` | Host (Global) | No (Host bundle) | No | No | `tasks.claim_lock` | Stale 600s, Silent 480s | `dsh-kanban` |
| **§5.9** | Circuit breaker & retry exhaustion handling | Service Provider & Hook | `@deepseek-ai/dsh-supervisor` | (implements `supervisor`) | `kanban`, `agents`, `subagents`, `storageDomain` | None | Consumes `subagent/end`, emits `kanban/task-blocked`, `supervisor/replan-requested` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (`supervisor` domain) | `maxRetries: 2`, Brain re-plan | `dsh-kanban`, `dsh-storage-domain` |
| **§5.9** | Quota wall HTTP 429 cooldown & requeue | Event-hook plugin | `@deepseek-ai/dsh-supervisor` | (implements `supervisor`) | `kanban`, `llm` | None | Consumes `agent/request-error` | Host (Global) | No (Host bundle) | No | No | `tasks.claim_lock` | Cooldown 300s, card requeue | `dsh-kanban` |
| **§5.9** | Token preservation / `agy` CLI delegation | Service Provider | `@deepseek-ai/dsh-subagent-agy` | `subagents` (registers `agy` provider) | `subagents`, `subprocess` | Surfaced via `subagent_agy` (`tool-subagent`) | Emits `subagent/start`, `subagent/end` | Host (Provider) / Agent (Tool) | Yes (`hermes-brain`) | No | Subagent (`agy` one-shot) | Subagent session log | Headless CLI `agy -p` | `dsh-subagent`, `dsh-subprocess` |
| **§5.10** | Result review & post-completion gates | Service Provider & Hook | `@deepseek-ai/dsh-supervisor` | (implements `supervisor`) | `kanban`, `axioms`, `axiomVerifier`, `worktrees` | None | Consumes `kanban/task-status` | Host (Global) | No (Host bundle) | No | No | SQLite `tasks` table | Reopen dirty, follow-up cards | `dsh-kanban`, `dsh-axiom-verifier` |
| **§5.11** | Todo closure & founder outcome signoff | Service Provider & Hook | `@deepseek-ai/dsh-supervisor` | (implements `supervisor`) | `ledger`, `kanban`, `axioms` | None | Consumes `integrator/merged`, `kanban/task-status` | Host (Global) | No (Host bundle) | No | No | `~/.hermes/task-requested/*.md` & `ctx.storageDomain` | Governing axioms witness check | `dsh-ledger`, `dsh-kanban` |
| **§4.1** | Complete 38-column task schema | Service Definition | `@deepseek-ai/dsh-kanban` | `kanban` (`KanbanStore`) | None | None | Emits `kanban/task-created` | Host (Global) | No (Host bundle) | No | No | Abstract interface | Cordis context merge | None |
| **§4.1** | SQLite storage engine for Kanban store | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `subprocess`, `sessionPersistence` | None | Emits `kanban/task-updated` | Host (Global) | No (Host bundle) | No | No | SQLite `~/.hermes/kanban.db` WAL | `busyTimeout: 120000` | `dsh-kanban` |
| **§4.2** | 9-column status transitions & CAS claim locks | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | Emits `kanban/claim-acquired`, `kanban/claim-released` | Host (Global) | No (Host bundle) | No | No | `tasks` table row versioning | Busy timeout 120s | `dsh-kanban` |
| **§4.3** | Priority-ordered ready dispatch query | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | Emits `kanban/dispatch-tick` | Host (Global) | No (Host bundle) | No | No | `tasks.priority` index | Priority DESC, Created ASC | `dsh-kanban` |
| **§4.3** | Global WIP limits & profile lane limits | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | None | Host (Global) | No (Host bundle) | No | No | In-memory active counters | `maxInProgress: 4` | `dsh-kanban` |
| **§4.3** | Dynamic cgroup memory concurrency cap | Service Provider | `@deepseek-ai/dsh-guard-resource` | None | `subprocess`, `kanban` | None | None | Host (Global) | No (Host bundle) | No | No | Systemd cgroup metrics | 768M per worker footprint | `dsh-kanban` |
| **§4.4** | Acceptance contract verification (local vs PR) | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban`, `shell` | None | None | Host (Global) | No (Host bundle) | No | No | `tasks.completion_contract` | PR timeout ms | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_show` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_show` | None | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | Session tool result | JSON output schema | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_list` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_list` | None | Agent (Scoped) | Yes (`hermes-brain` only) | No | No | Session tool result | Max limit 200 | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_complete` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_complete` | Emits `kanban/task-status` | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | Session tool result | Mandatory summary/metadata | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_block` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_block` | Emits `kanban/task-blocked` | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | Session tool result | Block reason & kind | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_unblock` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_unblock` | Emits `kanban/task-unblocked` | Agent (Scoped) | Yes (`hermes-brain` only) | No | No | Session tool result | Resets failure counter | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_request_review` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_request_review` | Emits `kanban/review-requested` | Agent (Scoped) | Yes (`hermes-worker`) | No | No | Session tool result | Reviewer assignment | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_request_changes` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_request_changes` | Emits `kanban/changes-requested` | Agent (Scoped) | Yes (`hermes-worker`) | No | No | Session tool result | Actionable findings | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_heartbeat` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_heartbeat` | None | Agent (Scoped) | Yes (`hermes-worker`) | No | No | `tasks.last_heartbeat_at` | Heartbeat note string | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_comment` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_comment` | Emits `kanban/comment-posted` | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | `task_comments` table | Markdown body | `dsh-kanban` |
| **§4.5** | Model tools: `kanban_attach` & `kanban_attachments` | Model-facing tool | `@deepseek-ai/dsh-tool-kanban` | None | `tools`, `kanban` | `kanban_attach`, `kanban_attachments` | None | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | `task_attachments` table | Max 25MB base64 | `dsh-kanban` |
| **§4.5** | Slash command `/kanban` & CLI router | Command | `@deepseek-ai/dsh-command-kanban` | None | `commands`, `kanban` | None | Emits `command/run`, `command/done` | Host (Global) | No (Host bundle) | No | No | Direct log appends | Subcommand argument routing| `dsh-kanban` |
| **§4.6** | Serialized transactions (`BEGIN IMMEDIATE`) | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | None | Host (Global) | No (Host bundle) | No | No | SQLite transaction locks | `writeTxn` helper | `dsh-kanban` |
| **§4.6** | Task audit events & run history tables | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | Emits `kanban/event` | Host (Global) | No (Host bundle) | No | No | `task_events`, `task_runs` | Run record insertion | `dsh-kanban` |
| **§4.7** | Board health diagnostic distress signals | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | Emits `kanban/diagnostic-warning` | Host (Global) | No (Host bundle) | No | No | `samples.jsonl` rolling metrics | Stranded age thresholds | `dsh-kanban` |
| **§4.4** | No phantom cards validation (`INV-15`) | Service Provider | `@deepseek-ai/dsh-kanban-sqlite` | (implements `kanban`) | `kanban` | None | None | Host (Global) | No (Host bundle) | No | No | Validates `tasks.created_by` | Throws `HallucinatedCardsError`| `dsh-kanban` |
| **§2.2** | Colocated repository axioms & schema | Service Definition & Provider | `@deepseek-ai/dsh-axiom` | `axioms` (`AxiomRegistry`) | `fs`, `storageDomain` | None | Emits `axioms/recompiled` | Host (Global) | No (Host bundle) | No | No | `AGENTS.md` & storageDomain | Markdown & domain schema | None |
| **§2.2** | Candidate path axiom resolution & tool | Consumer / Tool | `@deepseek-ai/dsh-axiom` | None | `tools`, `axioms`, `fs` | `resolve_candidate_axioms` | None | Agent (Scoped) | Yes (`hermes-brain`) | No | No | In-memory path cache | Surfaced via `@deepseek-ai/dsh-axiom/tool` | `dsh-axiom` |
| **§2.4** | Colocated instruction prompt injection | Event-hook plugin | `@deepseek-ai/dsh-agent-instructions` (reused) | None | `systemPrompt` | None | Consumes `agent/pre-step` | Agent (Scoped) | Yes (`hermes-worker`) | No | No | Scoped prompt section | Broad-to-specific ordering | None |
| **§2.2** | Task axiom storage via storageDomain | Service Provider | `@deepseek-ai/dsh-axiom` | (implements `axioms`) | `axioms`, `storageDomain` | None | Emits `axioms/task-updated` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (`task_axioms`) | Schema version 1 | `dsh-axiom`, `dsh-storage-domain` |
| **§2.5** | Declarative predicate sweeper (9 checks) | Service Provider | `@deepseek-ai/dsh-axiom-verifier` | `axiomVerifier` (`AxiomVerifier`) | `fs`, `shell`, `axioms` | None | Emits `axioms/verified` | Host (Global) | No (Host bundle) | No | No | Evaluator results cache | Execution timeout ms | `dsh-axiom` |
| **§2.5** | Model tool: `attach_proof` | Model-facing tool | `@deepseek-ai/dsh-tool-axiom` | None | `tools`, `axioms` | `attach_proof` | None | Agent (Scoped) | Yes (`hermes-worker`) | No | No | Appends to task axiom JSON | Output schema | `dsh-axiom` |
| **§2.5** | Model tool: `verify_task_axioms` | Model-facing tool | `@deepseek-ai/dsh-tool-axiom` | None | `tools`, `axiomVerifier` | `verify_task_axioms` | None | Agent (Scoped) | Yes (`hermes-worker`) | No | No | Sweeper evaluation result | Timeout bounds | `dsh-axiom-verifier` |
| **§2.5** | No Unproven Done merge gate (`INV-01`) | Event-hook plugin | `@deepseek-ai/dsh-axiom-verifier` | None | `kanban`, `axioms`, `axiomVerifier` | None | Consumes `kanban/pre-complete` | Host (Global) | No (Host bundle) | No | No | Gate rejection log | Serial hook `kanban/pre-complete` (`INV-01`) | `dsh-kanban`, `dsh-axiom-verifier` |
| **§2.5** | No Self-Grading sweeper override (`INV-10`) | Service Provider | `@deepseek-ai/dsh-axiom-verifier` | (implements `axiomVerifier`) | `axiomVerifier` | None | None | Host (Global) | No (Host bundle) | No | No | Task axiom JSON `status` | Reverts to `ACTIVE` on fail | `dsh-axiom-verifier` |
| **§2.7** | Axiom consistency & polarity conflict check | Service Provider | `@deepseek-ai/dsh-axiom` | (implements `axioms`) | `axioms` | None | None | Host (Global) | No (Host bundle) | No | No | In-memory token overlap index | Vocabulary overlap 60% | `dsh-axiom` |
| **§2.7** | Diff-to-axiom impact analyzer | Service Provider | `@deepseek-ai/dsh-axiom` | (implements `axioms`) | `axioms`, `subprocess` | None | None | Host (Global) | No (Host bundle) | No | No | None | Git diff inspection | `dsh-axiom` |
| **§2.5** | Auto-todo generation on sweep failure | Event-hook plugin | `@deepseek-ai/dsh-axiom-verifier` | None | `ledger`, `axioms` | None | Consumes `axioms/verified` | Host (Global) | No (Host bundle) | No | No | `auto-todos/<task_id>.md` | Calls `ctx.ledger.generateAutoTodo` | `dsh-ledger`, `dsh-axiom-verifier` |
| **§2.7** | Task axiom promotion to colocated AGENTS.md | Service Provider | `@deepseek-ai/dsh-axiom` | (implements `axioms`) | `axioms`, `fs` | None | Emits `axioms/promoted` | Host (Global) | No (Host bundle) | No | No | Colocated `AGENTS.md` files | Promotion schema | `dsh-axiom` |
| **§3.1** | SOUL.md identity persona (Slot #1) | Agent-preset composition | `@deepseek-ai/dsh-persona` (reused) | None | `systemPrompt` | None | None | Agent (Scoped) | Yes (`hermes-brain`, `hermes-worker`) | No | No | Static `SOUL.md` file | `complete: false` | None |
| **§3.1** | Zero autonomous SOUL edit authority (`INV-09`)| Guard | `@deepseek-ai/dsh-guard-resource` | None | `tools` | None | Evaluates `ctx.tools.guard()` | Host (Global) | No (Host bundle) | No | No | None | Denies `SOUL.md` mutation | `dsh-tools` |
| **§3.2** | Curated memory notes (`USER.md`, `MEMORY.md`)| Service Definition | `@deepseek-ai/dsh-memory` | `memory` (`MemoryStore`) | None | None | Emits `memory/changed` | Host (Global) | No (Host bundle) | No | No | Abstract interface | Cordis context merge | None |
| **§3.2** | Curated memory disk storage & file locking | Service Provider | `@deepseek-ai/dsh-memory-local` | (implements `memory`) | `memory`, `fs` | None | Emits `memory/changed` | Host (Global) | No (Host bundle) | No | No | Plaintext `\n§\n` delimited files | Char caps 2200 / 1375 | `dsh-memory` |
| **§3.3** | Model tool: `memory` (add/replace/remove) | Model-facing tool | `@deepseek-ai/dsh-tool-memory` | None | `tools`, `memory` | `memory` | None | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | Deferred batch validation | Parameter schemas | `dsh-memory` |
| **§3.4** | Memory prompt prefix cache stability (`INV-08`)| Event-hook plugin | `@deepseek-ai/dsh-memory-local` | None | `systemPrompt`, `memory` | None | Consumes `agent/request` | Agent (Scoped) | Yes (`hermes-worker`, `hermes-brain`) | No | No | Frozen turn snapshot | Section order 10 | `dsh-memory` |
| **§3.4** | Historical session search (BM25 + trigram) | Model-facing tool | `@deepseek-ai/dsh-tool-session-query` (reused) | None | `tools`, `sessionQuery` | `session_search` | None | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Reuses SQLite FTS5 index | Max query results 20 | `dsh-session-query-sqlite` |
| **§3.5** | Skill curator daemon (lifecycle transitions) | Service Provider | `@deepseek-ai/dsh-memory-curator` | `memoryCurator` (`CuratorRuntime`) | `fs`, `skills`, `storageDomain` | None | Emits `curator/transition` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (`curator` domain) | Stale 30d, Archive 90d | `dsh-skill`, `dsh-storage-domain` |
| **§3.6** | Background review fork (every 10 turns) | Event-hook plugin | `@deepseek-ai/dsh-memory-curator` | None | `agents`, `subagents`, `memory` | None | Consumes `agent/turn-stopping` | Agent (Scoped) | Yes (`hermes-worker`) | No | Subagent (`spawn` provider) | Subagent session log | Turn threshold = 10 | `dsh-subagent` |
| **§3.7** | Memory threat scanning & NFKC normalization | Service Provider | `@deepseek-ai/dsh-memory-local` | (implements `memory`) | `memory` | None | None | Host (Global) | No (Host bundle) | No | No | None | NFKC strict scan | `dsh-memory` |
| **§3.7** | External drift detection & unreadable guard | Service Provider | `@deepseek-ai/dsh-memory-local` | (implements `memory`) | `memory` | None | None | Host (Global) | No (Host bundle) | No | No | `.bak.<timestamp>` snapshots | Delimiter integrity check | `dsh-memory` |
| **§6.2** | Git worktree allocation (`.worktrees/<id>/`) | Service Definition | `@deepseek-ai/dsh-worktree` | `worktrees` (`WorktreeManager`) | None | None | Emits `worktree/allocated` | Host (Global) | No (Host bundle) | No | No | Abstract interface | Cordis context merge | None |
| **§6.2** | Git worktree local driver & commit pinning | Service Provider | `@deepseek-ai/dsh-worktree-local` | (implements `worktrees`) | `worktrees`, `subprocess`, `fs` | None | Emits `worktree/allocated` | Host (Global) | No (Host bundle) | No | No | Git worktree filesystem | Root `.worktrees/` | `dsh-worktree` |
| **§6.2** | Base commit pinning at allocation | Service Provider | `@deepseek-ai/dsh-worktree-local` | (implements `worktrees`) | `worktrees`, `subprocess` | None | None | Host (Global) | No (Host bundle) | No | No | `tasks.workspace_path` | `git rev-parse HEAD` | `dsh-worktree` |
| **§6.2** | Unpushed / dirty work preservation (`INV-07`) | Service Provider | `@deepseek-ai/dsh-worktree-local` | (implements `worktrees`) | `worktrees`, `subprocess` | None | None | Host (Global) | No (Host bundle) | No | No | None | Abort on dirty or unpushed | `dsh-worktree` |
| **§1, §8.4** | Systemd cgroup slice (`hermes-work.slice`) | Service Provider | `@deepseek-ai/dsh-guard-resource` | None | `subprocess` | None | None | Host (Global) | No (Host bundle) | No | No | Systemd cgroup accounting | 6G RAM, 512M swap | `dsh-subprocess` |
| **§1, §9** | Host memory headroom floor 3 GiB (`INV-12`) | Guard | `@deepseek-ai/dsh-guard-resource` | None | `tools` | None | Evaluates `ctx.tools.guard()` | Host (Global) | No (Host bundle) | No | No | None | `MemAvailable >= 3072M` | `dsh-tools` |
| **§6.1** | Role-based worker specialization & prompt bias | Agent-preset composition | `@deepseek-ai/dsh-persona` (reused) | None | `systemPrompt` | None | None | Agent (Scoped) | Yes (Dynamic child persona) | Yes (`role-*` playbooks) | Subagent composition | None | Shadowing persona | `dsh-subagent` |
| **§6.3** | BDD scenario authoring guidelines | Skill | Procedural skill bundle | None | None | None | None | Agent (Scoped) | Yes (Catalog entry) | Yes (`bdd-scenario-guide`) | No | Disk `SKILL.md` | Frontmatter metadata | `dsh-tool-skill` |
| **§6.4** | Independent RED Gate verification runner | Service Definition & Provider | `@deepseek-ai/dsh-verification` | `verification` (`VerificationStore`) | `storageDomain`, `shell`, `subprocess`, `fs` | None | Emits `verification/red-gate` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (`verification` domain) | Exit code != 0 check | `dsh-storage-domain` |
| **§6.4** | Verification evidence store via storageDomain | Service Provider | `@deepseek-ai/dsh-verification` | (implements `verification`) | `verification`, `storageDomain` | None | Emits `verification/red-gate` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (tables `events`, `manifests`, `state`) | Schema version 1 | `dsh-verification`, `dsh-storage-domain` |
| **§6.5** | Cryptographic test hashing & pinning (`INV-13`) | Guard | `@deepseek-ai/dsh-guard-test-pinning` | None | `tools`, `fs`, `verification` | None | Evaluates `ctx.tools.guard()` | Agent (Scoped) | Yes (`hermes-worker`) | No | No | SHA-256 in `verification_events` | Read-only test glob | `dsh-tools` |
| **§6.6** | Implementer bounded execution (turns, runtime) | Configuration | `@deepseek-ai/dsh-agent-loop` (reused) | None | `agentLoop` | None | Consumes `agent/pre-step` | Agent (Scoped) | Yes (`hermes-worker`) | No | Subagent execution | Recorded in session header | `maxTurns: 25`, timeout 40m | `dsh-agent-loop` |
| **§6.7** | Independent GREEN Gate verification runner | Service Provider | `@deepseek-ai/dsh-verification` | (implements `verification`) | `shell`, `fs`, `verification`, `storageDomain` | None | Emits `verification/green-gate` | Host (Global) | No (Host bundle) | No | No | `ctx.storageDomain` (`verification` domain) | Exit code == 0 & hash match | `dsh-verification`, `dsh-storage-domain` |
| **§6.7** | `verify_on_stop` post-edit test check | Event-hook plugin | `@deepseek-ai/dsh-verification-stop` | None | `verification`, `shell` | None | Consumes `agent/turn-stopping` | Agent (Scoped) | Yes (`hermes-worker`) | No | No | None | Enforces test run if edited | `dsh-verification` |
| **§6.8** | Three-lens code review checklist & repair loop | Skill | Procedural skill bundle | None | None | None | None | Agent (Scoped) | Yes (Catalog entry) | Yes (`code-review-lens`) | No | Disk `SKILL.md` | Max 2 repair rounds | `dsh-tool-skill` |
| **§6.9** | Worktree integration pipeline (`merge_card`) | Service Definition & Provider | `@deepseek-ai/dsh-integrator` | `integrator` (`IntegratorService`) | `shell`, `subprocess`, `worktrees`, `kanban` | None | Emits `integrator/merged` | Host (Global) | No (Host bundle) | No | No | Git merge commit | `--no-ff`, frozen lockfile | `dsh-worktree` |
| **§6.9** | GitHub PR creation & check synchronization | Service Provider | `@deepseek-ai/dsh-integrator` | (implements `integrator`) | `subprocess`, `worktrees`, `kanban`, `verification` | None | Emits `integrator/pr-synced` | Host (Global) | No (Host bundle) | No | No | GitHub PR metadata | Draft PR lifecycle | `dsh-integrator` |
| **§6.10** | Anti-cheat: reject masked shell exit codes | Service Provider | `@deepseek-ai/dsh-verification` | (implements `verification`) | `shell` | None | None | Host (Global) | No (Host bundle) | No | No | None | Regex rejects `\|\| true`, `; exit 0` | `dsh-verification` |
| **§5.7** | Native bidirectional messaging & settlement | Runtime Substrate | `@deepseek-ai/dsh-subagent` (reused) | None | `subagents` | `send_message` | Emits `subagent/start`, `subagent/end`, wakes parent with settlement | Host & Agent Planes | Yes (`hermes-brain`, `hermes-worker`) | No | Continuable subagents | Session event log | `inbox.nextStep` steer | Core |
| **§5.7** | Worker runtime telemetry & progress tracking | Service Definition & Provider | `@deepseek-ai/dsh-subagent-progress` | `subagentProgress` (`SubagentProgressTracker`) | `subagents`, `agents` | None | Consumes `subagent/start`, `subagent/end`, `agent/pre-step`, `agent/assistant-stream` | Host (Global) | No (Host bundle) | No | No | In-memory telemetry cache | Subagent event listeners | `dsh-subagent`, `dsh-agent` |
| **§5.7** | Enriched worker status projection (`list_agents`) | Model-facing tool | `@deepseek-ai/dsh-tool-subagent-control` | None | `tools`, `subagents`, `subagentProgress` | `list_agents` (enriched) | None | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Session tool result | Telemetry projection schema | `dsh-subagent-progress` |
| **§5.7** | Live worker transcript tailing (`subagent_tail`) | Model-facing tool | `@deepseek-ai/dsh-tool-subagent-control` | None | `tools`, `subagents`, `session` | `subagent_tail` | None | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Session tool result | Max event window 50 | `dsh-subagent`, `dsh-session` |
| **§5.8** | Runaway worker hard teardown (`kill_agent`) | Model-facing tool | `@deepseek-ai/dsh-tool-subagent-control` | None | `tools`, `subagents`, `kanban`, `worktrees` | `kill_agent` | Calls `ctx.subagents.drainContinuableChildren()` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Session tool result | Lineage check, `INV-07` & CAS release | `dsh-subagent`, `dsh-kanban`, `dsh-worktree` |
| **§5.9** | Concurrency ceiling & operator spawn pause gate | Configuration & Preflight Gate | `@deepseek-ai/dsh-tool-subagent` | None | `tools`, `subagents` | Surfaced via `subagent` tools | Validates before `startContinuable` | Agent (Scoped) | Yes (`hermes-brain`) | No | No | Preset YAML config | `maxConcurrentChildren: 4`, `spawnPaused` | `dsh-subagent` |
| **§5.9** | Zombie & hung worker inactivity evaluation | Service Provider | `@deepseek-ai/dsh-subagent-progress` | (implements `subagentProgress`) | `subagentProgress` | None | Exposed via `isZombie(id)` | Host (Global) | No (Host bundle) | No | No | In-memory step timestamps | Inactivity threshold 600s | `dsh-subagent-progress` |
| **UI Themes** | 8 canonical Hermes theme palettes & token mapping | Static Theme Definition Pack | `@deepseek-ai/dsh-client-ui-theme` | None | None | None | Registered in `ctx.theme` | Client (Browser) | No (Client bundle) | No | No | Client theme registry | `--dsw-alias-*` token translation | `dsh-client-ui-theme` |
| **UI Settings** | Durable custom theme preference persistence | Host Settings Schema (Core) | `@deepseek-ai/dsh-client-ui-theme` | None | `settings` | None | Emits `theme/change` | Host & Client | No (Client bundle) | No | No | Host user-settings document | Relaxed `ThemeSettingsSchema` | `dsh-settings` |
| **UI Bootstrap** | Pre-hydration theme injection & FOUC prevention | Webserver HTML Hook | `@deepseek-ai/dsh-client-ui-theme` | None | `webserver` | None | Early script evaluation | Host (Global) | No (Client bundle) | No | No | Inline HTML script | Sets `data-ds-dark-theme` | `dsh-client-ui-theme` |
| **UI Appearance** | Theme swatch picker & font selection UX | Client UI Component (Slot) | `@deepseek-ai/dsh-client-ui-theme` | None | `theme`, `settings` | None | Consumes `settings.general.item` | Client (Browser) | No (Client bundle) | No | No | Settings preference | 3-stop swatch previews & font row | `dsh-client-ui-primitives` |
| **UI Schedules** | Interactive visual cron & webhook schedule builder | Client UI Component (Slot) | `@deepseek-ai/dsh-client-ui-schedule` | None | `schedule` | None | None | Client (Browser) | No (Client bundle) | No | No | Schedule definitions | CSS Modules + `ui-primitives` | `dsh-client-ui-schedule` |
| **UI Models** | Model capability telemetry & context metrics card | Client UI Component (Slot) | `@deepseek-ai/dsh-client-ui-settings-models` | None | `models` | None | None | Client (Browser) | No (Client bundle) | No | No | Provider metadata | CSS Modules + `ui-primitives` | `dsh-client-ui-settings-models` |

---

### D. Derived Package Boundaries

Every package adheres strictly to the repository convention: `@deepseek-ai/dsh-<name>` located in `packages/<group>/<pkg>/` (`docs/cookbook/adding-a-package.md:10-48`). Service Definitions, Providers, and Consumers are split into distinct packages so that execution engines, storage backends, and presentation surfaces evolve independently without type or dependency collisions.

```
packages/
├── kanban/
│   ├── kanban/              # @deepseek-ai/dsh-kanban (Service Definition)
│   ├── kanban-sqlite/       # @deepseek-ai/dsh-kanban-sqlite (Service Provider)
│   ├── tool-kanban/         # @deepseek-ai/dsh-tool-kanban (Consumer Tools)
│   └── command-kanban/      # @deepseek-ai/dsh-command-kanban (Slash Command)
├── axiom/
│   ├── axiom/               # @deepseek-ai/dsh-axiom (Service Definition & Provider)
│   ├── axiom-verifier/      # @deepseek-ai/dsh-axiom-verifier (Service Provider)
│   └── tool-axiom/          # @deepseek-ai/dsh-tool-axiom (Consumer Tools)
├── memory/
│   ├── memory/              # @deepseek-ai/dsh-memory (Service Definition)
│   ├── memory-local/        # @deepseek-ai/dsh-memory-local (Service Provider)
│   ├── tool-memory/         # @deepseek-ai/dsh-tool-memory (Consumer Tool)
│   └── memory-curator/      # @deepseek-ai/dsh-memory-curator (Daemon & Hook)
├── worktree/
│   ├── worktree/            # @deepseek-ai/dsh-worktree (Service Definition)
│   └── worktree-local/      # @deepseek-ai/dsh-worktree-local (Service Provider)
├── guard/
│   ├── guard-resource/      # @deepseek-ai/dsh-guard-resource (Host Guard)
│   └── guard-test-pinning/  # @deepseek-ai/dsh-guard-test-pinning (Agent Guard)
├── verification/
│   ├── verification/        # @deepseek-ai/dsh-verification (Service Definition & Provider)
│   └── verification-stop/   # @deepseek-ai/dsh-verification-stop (Turn Hook)
├── integration/
│   └── integrator/          # @deepseek-ai/dsh-integrator (Service Provider)
├── subagent/
│   ├── subagent-agy/        # @deepseek-ai/dsh-subagent-agy (Subagent Provider)
│   └── subagent-progress/   # @deepseek-ai/dsh-subagent-progress (Host Progress Tracker)
├── supervision/
│   └── supervisor/          # @deepseek-ai/dsh-supervisor (Host Daemon & Event Hooks)
├── ledger/
│   ├── ledger/              # @deepseek-ai/dsh-ledger (Service Definition & Provider)
│   └── tool-ledger/         # @deepseek-ai/dsh-tool-ledger (Consumer Tools & Prompt Contributor)
├── client/                  # (Extended client UI modules for Hermes adoption)
│   ├── ui-theme/            # @deepseek-ai/dsh-client-ui-theme (Themes, Swatches, Settings)
│   ├── ui-schedule/         # @deepseek-ai/dsh-client-ui-schedule (Visual Schedule Builder)
│   └── ui-settings-models/  # @deepseek-ai/dsh-client-ui-settings-models (Capability Cards)
└── bundle/
    └── hermes-base/         # @deepseek-ai/dsh-hermes-base (Host Bundle)
```

#### Detailed Package Specifications

1. **`@deepseek-ai/dsh-kanban`** (`packages/kanban/kanban`):
   - *Role*: Service Definition. Declares abstract `KanbanStore` class extending `Service`, merges `interface Context { kanban: KanbanStore }`, and exports all TypeScript types (`Task`, `TaskStatus`, `TaskRun`, `TaskEvent`, `TaskComment`).
   - *Plane*: Host.
   - *Justification*: Decouples the storage interface from SQLite implementation details, enabling lightweight in-memory test doubles without native SQLite compilation.
   - *Plan*: Covered in Plan 01.

2. **`@deepseek-ai/dsh-kanban-sqlite`** (`packages/kanban/kanban-sqlite`):
   - *Role*: Service Provider. Subclasses `KanbanStore`, manages SQLite `~/.hermes/kanban.db` connection with WAL mode and `PRAGMA busy_timeout = 120000`, implements 38-column queries, serialized `write_txn` (`BEGIN IMMEDIATE`), DAG cycle detection, and CAS claim locks.
   - *Plane*: Host.
   - *Justification*: Encapsulates database transactions, table migrations, and SQL statement preparation behind the public `KanbanStore` contract.
   - *Plan*: Covered in Plan 01.

3. **`@deepseek-ai/dsh-tool-kanban`** (`packages/kanban/tool-kanban`):
   - *Role*: Consumer. Registers model-facing tools (`kanban_show`, `kanban_create`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_link`, `kanban_list`, `kanban_heartbeat`, `kanban_comment`, `kanban_attach`) via `ctx.tools.register()`.
   - *Plane*: Agent (Scoped).
   - *Justification*: Exposes tool parameters and render functions strictly on the agent plane, allowing tools to be selectively configured per preset without loading database drivers.
   - *Plan*: Covered in Plan 02.

4. **`@deepseek-ai/dsh-command-kanban`** (`packages/kanban/command-kanban`):
   - *Role*: Consumer. Registers `/kanban` slash command on `ctx.commands`, parsing subcommands (`create`, `list`, `show`, `claim`, `complete`, `block`) and routing them directly to `ctx.kanban` outside agent turns.
   - *Plane*: Host.
   - *Justification*: Separates human/operator CLI interactions from model-facing JSON schema tools.
   - *Plan*: Covered in Plan 02.

5. **`@deepseek-ai/dsh-axiom`** (`packages/axiom/axiom`):
   - *Role*: Service Definition & Provider. Declares abstract `AxiomRegistry` class extending `Service`, merges `interface Context { axioms: AxiomRegistry }`, and exports axiom schemas (`Axiom`, `TaskAxiom`, `ProofRecord`, `PredicateCheck`). Manages colocated `AGENTS.md` scanning, candidate path resolution, `ctx.storageDomain` (`task_axioms` domain), token-overlap conflict analysis, and diff-to-axiom impact analysis. Also exports agent-plane tool plugin `@deepseek-ai/dsh-axiom/tool` (`tool-candidate-axioms`) exposing `resolve_candidate_axioms`.
   - *Plane*: Host (Service Provider) / Agent (Tool plugin).
   - *Justification*: Unifies axiom schema, colocated discovery, candidate path resolution, and storage domain persistence under a single coherent package, eliminating artificial interface/provider package fragmentation. Prompt context injection is delegated natively to existing `@deepseek-ai/dsh-agent-instructions`.
   - *Plan*: Covered in Plan 03.

6. **`@deepseek-ai/dsh-axiom-verifier`** (`packages/axiom/axiom-verifier`):
   - *Role*: Service Provider & Event Hook. Declares and implements `AxiomVerifier` (`ctx.axiomVerifier`), evaluating 9 declarative predicates against `ctx.fs` and `ctx.shell`, and intercepting serial `'kanban/pre-complete'` to enforce `INV-01` (No Unproven Done). Triggers auto-todo generation via `ctx.ledger.generateAutoTodo`.
   - *Plane*: Host.
   - *Justification*: Implements objective verification algorithms (AST, grep, tests) and completion gate enforcement independent of axiom discovery.
   - *Plan*: Covered in Plan 04.

7. **`@deepseek-ai/dsh-tool-axiom`** (`packages/axiom/tool-axiom`):
   - *Role*: Consumer. Registers model-facing tools `attach_proof` and `verify_task_axioms` via `ctx.tools.register()`.
   - *Plane*: Agent (Scoped).
   - *Justification*: Model-facing presentation layer for workers to interact with task axioms.
   - *Plan*: Covered in Plan 04.

8. **`@deepseek-ai/dsh-memory`** (`packages/memory/memory`):
   - *Role*: Service Definition. Declares abstract `MemoryStore` extending `Service`, merges `interface Context { memory: MemoryStore }`, and defines entry schemas.
   - *Plane*: Host.
   - *Justification*: Decouples memory note representation from disk files and lock strategies.
   - *Plan*: Covered in Plan 05.

9. **`@deepseek-ai/dsh-memory-local`** (`packages/memory/memory-local`):
   - *Role*: Service Provider. Subclasses `MemoryStore`, manages `USER.md` and `MEMORY.md` with `\n§\n` delimiters, cross-process POSIX file locks, NFKC threat scanning, and turn-stable prompt snapshots.
   - *Plane*: Host.
   - *Justification*: Manages file locks, atomic rename replacements, and security sanitization.
   - *Plan*: Covered in Plan 05.

10. **`@deepseek-ai/dsh-tool-memory`** (`packages/memory/tool-memory`):
    - *Role*: Consumer. Registers `memory` tool with deferred batch character limit validation. (Historical session search is surfaced separately by reusing core `@deepseek-ai/dsh-tool-session-query`).
    - *Plane*: Agent (Scoped).
    - *Justification*: Model-facing tool mapping agent intent to store operations.
    - *Plan*: Covered in Plan 05.

11. **`@deepseek-ai/dsh-memory-curator`** (`packages/memory/memory-curator`):
    - *Role*: Service Provider & Hook. Manages skill lifecycle state transitions in `ctx.storageDomain` (`curator` domain, tables `ledger`, `usage`) and hooks `agent/turn-stopping` to launch background review subagents every 10 turns.
    - *Plane*: Host.
    - *Justification*: Background daemon and subagent dispatcher; distinct lifecycle from active sessions.
    - *Plan*: Covered in Plan 06.

12. **`@deepseek-ai/dsh-worktree`** (`packages/worktree/worktree`):
    - *Role*: Service Definition. Declares abstract `WorktreeManager` extending `Service`, merges `interface Context { worktrees: WorktreeManager }`.
    - *Plane*: Host.
    - *Justification*: Decouples workspace reservation interface from Git CLI subprocess mechanics.
    - *Plan*: Covered in Plan 07.

13. **`@deepseek-ai/dsh-worktree-local`** (`packages/worktree/worktree-local`):
    - *Role*: Service Provider. Subclasses `WorktreeManager`, manages `.worktrees/<id>/` creation, base commit recording, collision avoidance, and `INV-07` unpushed commit protection.
    - *Plane*: Host.
    - *Justification*: Executes Git worktree commands via `ctx.subprocess` and validates repository state.
    - *Plan*: Covered in Plan 07.

14. **`@deepseek-ai/dsh-guard-resource`** (`packages/guard/guard-resource`):
    - *Role*: Guard. Manages `hermes-work.slice` cgroup limits and registers synchronous `ctx.tools.guard()` enforcing 3 GiB host memory headroom floor (`INV-12`) and `SOUL.md` edit denial (`INV-09`).
    - *Plane*: Host.
    - *Justification*: Synchronous tool guard (`ctx.tools.guard()`) evaluating host memory pressure.
    - *Plan*: Covered in Plan 08.

15. **`@deepseek-ai/dsh-guard-test-pinning`** (`packages/guard/guard-test-pinning`):
    - *Role*: Guard. Registers agent-scoped `ctx.tools.guard()` denying modifications to test files during implementer turns (`INV-13`).
    - *Plane*: Agent (Scoped).
    - *Justification*: Agent-scoped tool guard active during implementer turns to protect test suites.
    - *Plan*: Covered in Plan 09.

16. **`@deepseek-ai/dsh-verification`** (`packages/verification/verification`):
    - *Role*: Service Definition & Provider. Declares abstract `VerificationStore` extending `Service`, merges `interface Context { verification: VerificationStore }`, and implements verification evidence persistence backed directly by `ctx.storageDomain` (`verification` domain, tables `events`, `manifests`, `state`). Executes RED and GREEN gate verification checks, and parses commands to reject masked exit codes (`INV-11`).
    - *Plane*: Host.
    - *Justification*: Consolidates verification service definition, storage domain persistence, and gate evaluators into a single host-plane footprint, eliminating redundant bespoke SQLite packages.
    - *Plan*: Covered in Plan 09.

17. **`@deepseek-ai/dsh-verification-stop`** (`packages/verification/verification-stop`):
    - *Role*: Event Hook. Listens to serial `agent/turn-stopping`, verifying that code edits are backed by fresh passing test executions before turn completion.
    - *Plane*: Agent (Scoped).
    - *Justification*: Turn lifecycle interceptor; enforces test-execution before turn completion.
    - *Plan*: Covered in Plan 09.

18. **`@deepseek-ai/dsh-integrator`** (`packages/integration/integrator`):
    - *Role*: Service Provider. Implements `IntegratorService` (`ctx.integrator`), executing `merge_card` pipeline (pre-merge PR, baseline verification, local merge, re-verification, atomic rollback).
    - *Plane*: Host.
    - *Justification*: Automated orchestration engine; consumes shell, git, kanban, and worktrees.
    - *Plan*: Covered in Plan 10.

19. **`@deepseek-ai/dsh-subagent-agy`** (`packages/subagent/subagent-agy`):
    - *Role*: Service Provider. Implements `SubagentProvider` from `@deepseek-ai/dsh-subagent`, registering provider `agy` on `ctx.subagents`. Delegates unattended work to the headless `/home/sic/.local/bin/agy` CLI for token-preserving code extraction and AST editing (`INV-03`). Declares `capabilities: NO_START_CAPABILITIES` and `inheritsParentContext: false`. Self-authenticates via multi-provider OAuth pool in `/home/sic/.hermes/auth.json` under `$HOME` with zero credential plumbing; model selection resolved dynamically by agy's active provider router (never pinned by Harness; optional validated `model` override accepted). Spawns under `scrubbedParentEnv()`, safely preserving `HOME`, `PATH`, `USER`, and XDG directories.
    - *Plane*: Host.
    - *Justification*: External CLI agent delegation is fundamentally a host-plane subagent provider matching `subagent-codex` and `subagent-claude-code` (which likewise authenticate from `$HOME` stores), surfaced cleanly to agent presets via `@deepseek-ai/dsh-tool-subagent`.
    - *Plan*: Covered in Plan 11.

20. **`@deepseek-ai/dsh-supervisor`** (`packages/supervision/supervisor`):
    - *Role*: Host Daemon & Event Hook Provider. Subclasses Cordis `Service`, mounted globally on host plane (`ctx.supervisor`). Manages background watchdog timers for silent worker detection (30m stall), circuit breaker failure resets with `ctx.storageDomain` (`supervisor` domain, table `circuit_breakers`), quota walls, automated PR result review dispatch, and milestone todo closure verification (consuming `ctx.ledger` from Plan 13).
    - *Plane*: Host.
    - *Justification*: Ambient, cross-session supervisor that must survive inactive tool turns and execute recovery actions via OS process signals and kanban transactions.
    - *Plan*: Covered in Plan 12 (with Plan 13 as prerequisite).

21. **`@deepseek-ai/dsh-ledger`** (`packages/ledger/ledger`):
    - *Role*: Service Definition & Provider. Subclasses Cordis `Service` as `OutcomeLedger extends Service`, merges `interface Context { ledger: OutcomeLedger }`. Manages founder milestone outcome documents at `~/.hermes/task-requested/<slug>.md`, machine-facing milestone index and bindings via `ctx.storageDomain` (`ledger` domain, tables `bindings`, `milestones`), auto-todo generation on sweep failure, and milestone acceptance proof checks (`INV-01`).
    - *Plane*: Host.
    - *Justification*: Dedicated host service for founder milestone outcomes, decoupling long-term project objectives from operational kanban cards and ephemeral session checklists.
    - *Plan*: Covered in Plan 13 (prerequisite for Plan 12).

22. **`@deepseek-ai/dsh-tool-ledger`** (`packages/ledger/tool-ledger`):
    - *Role*: Consumer & Prompt Contributor. Registers model-facing tools `ledger_show` and `ledger_update` on `ctx.tools`, and injects `ledger:intake-policy` system prompt section on the Agent Plane in `hermes-brain`.
    - *Plane*: Agent (Scoped).
    - *Justification*: Model-facing presentation layer for orchestrators; strictly separated from the host-plane `OutcomeLedger` service provider to honor PRESET-RULE 4 and eliminate unisolated service leakage in agent presets.
    - *Plan*: Covered in Plan 13.

23. **`@deepseek-ai/dsh-hermes-base`** (`packages/bundle/hermes-base`):
    - *Role*: Bundle. Packages `cordis.patch.yml` declaring all host-plane Hermes services, configuring dependencies, and participating in profile boot.
    - *Plane*: Host.
    - *Justification*: Top-level distribution bundle composing all Hermes host-plane services.
    - *Plan*: Covered in Plan 14.

24. **`@deepseek-ai/dsh-subagent-progress`** (`packages/subagent/subagent-progress`):
    - *Role*: Host Service Provider. Implements `SubagentProgressTracker` extending `Service`, merges `interface Context { subagentProgress: SubagentProgressTracker }`. Tracks active continuable worker runtime, step counts, tool calls, and evaluates zombie/inactivity status (>600s). Consumed by `dsh-tool-subagent-control` (`list_agents`, `subagent_tail`) and `dsh-supervisor` (Plan 12).
    - *Plane*: Host.
    - *Justification*: Ambient telemetry cache outside ephemeral sessions, aggregating Cordis lifecycle events from all active child activations to eliminate duplicate tracking between supervisor and agent loops.
    - *Plan*: Covered in Plan 15.

#### In-Depth Architectural Analyses

##### 1. `agy` Subagent Provider Contract & Harness Seam Alignment
The original architecture draft proposed `@deepseek-ai/dsh-tool-agy` registering ad-hoc `agy_extract` and `agy_edit` tools that executed `/home/sic/.local/bin/agy` directly. That reproduced an out-of-band Hermes pattern instead of leveraging the native Harness seam.

In DeepSeek Harness, delegating execution to an external autonomous CLI agent is the exact domain of the `SubagentProvider` contract—the precise pattern implemented by `packages/subagent/subagent-codex` and `packages/subagent/subagent-claude-code`.

- **Ground Truth: External CLI Authentication & Credential Architecture**:
  The three external agent CLIs on this host are ALREADY LINKED AND AUTHENTICATED VIA OAUTH from file-based credential stores under `$HOME`:
  - `agy` -> `/home/sic/.hermes/auth.json` (multi-provider OAuth credential pool with an active provider and a router)
  - `Claude Code` -> `/home/sic/.claude/.credentials.json`
  - `Codex` -> `/home/sic/.codex/auth.json`

  Consequences for `@deepseek-ai/dsh-subagent-agy` and the subagent providers:
  1. **Zero Credential Plumbing**: The provider performs NO credential acquisition, NO API-key injection, NO OAuth flow, and NO token refresh. It simply spawns the CLI; the CLI authenticates itself directly from its `$HOME` credential store.
  2. **Safe Environment Scrubbing**: Processes spawn under `scrubbedParentEnv()`. Stripping sensitive harness keys (`*API_KEY*`, `*TOKEN*`, `*SECRET*`) from the child environment does not break authentication because credentials reside in files under `$HOME`—provided `$HOME`, `$PATH`, `$USER`, locale, proxies, and XDG base-directory variables are preserved, which `scrubbedParentEnv()` explicitly guarantees (`packages/subprocess/subprocess/src/index.ts:49-78`).
  3. **Model Selection Ownership**: Model selection for `agy` is resolved dynamically by its OWN active provider pool and router in `/home/sic/.hermes/auth.json` and its deployment configuration, not by anything the Harness passes. The provider does not pin a specific model (e.g. `gemini-3.8-flash-high` is never hardcoded); it delegates model choice to `agy`'s active provider by default, optionally allowing an override via a validated `Config.model` field (`--model` flag).
  4. **Composition vs. Authentication Fact**: Shipped providers `packages/subagent/subagent-claude-code` and `packages/subagent/subagent-codex` are likewise fully linked and authenticated on this host. The shipped `ptc` preset carries those rows `disabled: true` because their optional provider Bundle is not installed in the default Profile. That is a COMPOSITION fact, not an authentication fact. `hermes-brain` carries `subagent_claude_code` and `subagent_codex` enabled in its delegation group, mounting whenever their provider bundles are installed in the Profile.

- **Live Provider Contract (`packages/subagent/subagent/src/types.ts`)**:
  - `SubagentProvider` requires implementing `start(input: SubagentStartInput): Promise<SubagentRun>` and `capabilities: SubagentStartCapabilities`.
  - External CLI providers declare `capabilities: NO_START_CAPABILITIES` (because CLI processes manage their own internal recursion, tools, and execution tree) and `inheritsParentContext: false` (they run in isolated external process sessions).
  - The provider subclasses `Service`, mounts into Cordis host context, and calls `ctx.subagents.registerProvider('agy', this)`.
  - Execution delegates to `/home/sic/.local/bin/agy` with flags `--print`, `--output-format stream-json`, `--dangerously-skip-permissions`, passing `--model` only when explicitly configured via validated `Config.model` override. Cancellation cascades via `ctx.subprocess` process tree termination (SIGINT / SIGTERM).
- **Surface Presentation Layer (`packages/subagent/tool-subagent/src/index.ts`)**:
  - Surfaced to agent presets (`hermes-brain`) via `@deepseek-ai/dsh-tool-subagent`.
  - Because `capabilities.depthLimit` is false for external CLIs, specifying a numeric `maxDepth` throws a mount validation error (`maxDepth must be 'provider-managed' when provider depthLimit capability is false`). Therefore, the configuration strictly specifies:
    ```yaml
    - id: tool-subagent-agy
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: agy
        toolName: subagent_agy
        backgroundMode: one-shot
        maxDepth: provider-managed
    ```
  - This preserves complete runtime type-safety, lifecycle cancellation, and transcript tracking under standard Harness subagent telemetry.

##### 2. Supervision Ownership Architecture Evaluation
Spec §5.8–§5.10 specifies continuous supervisory enforcement: silent worker detection (30m heartbeat timeout), circuit breaker (aborting after repetitive task failures), quota wall protection (pausing dispatch upon API 429 errors), result review dispatch (§5.10), and founder todo closure verification (§5.11).

Six candidate seams within Harness were evaluated to determine ownership:
1. **`packages/guard/*` (`timeout-policy`, `repeat-tool-reminder`) -> REJECTED**:
   Guards operate strictly within active tool execution or turn loops (intercepting `tools/execute`, `tools/post-execute`, or `agent/pre-step`). When a worker process hangs in an infinite bash loop, pauses on a blocked network socket, or fails to start, zero tool calls occur and `agent/pre-step` never fires. Tool guards are completely deaf and blind to background time elapsed without tool calls.
2. **`packages/goal/*` (`GoalService`) -> REJECTED**:
   `GoalService` is an in-session projection unit (`SessionProjectionStateMap['goal']`) focused on single-agent conversational convergence. It tracks a single active objective within a turn session. It has zero visibility across worker processes, worktrees, or kanban boards, and possesses no cross-session scheduling capabilities.
3. **`packages/workflow/*` (`WorkflowEngine`) -> REJECTED**:
   Workflow scripts are transient execution pipelines that run to completion for a single task and then terminate. Supervision must be ambient, persistent, and active continuously across days of unattended pool operation.
4. **Dedicated Subagent Consumer (LLM Supervisor) -> REJECTED**:
   Spinning up continuous LLM subagents to poll timestamps and board tables wastes tens of thousands of tokens per hour on trivial arithmetic (`now - last_heartbeat > 1800`), introduces nondeterministic jitter, and risks catastrophic hallucination during OS process termination or CAS lock contention.
5. **Session Projections (`sessionProjections`) -> REJECTED**:
   Session projections are strictly pure, side-effect-free fold functions over immutable session events. They are architecturally forbidden from performing filesystem I/O, spawning processes, killing PIDs, or acquiring SQLite transactional write locks.
6. **Host-Plane Daemon & Event Hook Provider (`@deepseek-ai/dsh-supervisor`) -> SELECTED**:
   Extending Cordis `Service`, mounted globally on the host plane as `ctx.supervisor`. It manages a high-resolution Node.js `setInterval` watchdog for heartbeat expiry, and subscribes reactively to host-plane events:
   - `kanban/task-status` & `kanban/heartbeat-tick`: Updates watchdog timestamps and tracks failure streaks.
   - `subagent/end`: Evaluates completed worker output, triggers PR baseline verification, and launches review subagents.
   - `agent/request-error`: Detects quota exhaustion (429) to trigger the quota wall.
   When anomalies occur, the daemon acts deterministically via `ctx.subprocess` (sending signals to terminate hung workers) and `ctx.kanban` (CAS state rollback to `BLOCKED` or `TODO`).

##### 3. Outcome Ledger vs `tool-todo` and `goal` Separation
Spec §5.3 / §5.11 defines the Outcome Ledger as the persistent ground truth of founder requirements. We evaluated whether existing Harness modules (`packages/todo/tool-todo` or `packages/goal/goal`) could be reused:
- **`packages/todo/tool-todo`**: Exposes `todo` model tools (`todo/write`, `todo/clear`) operating on an in-memory `TodoItem[]` array stored purely in session state. Every update overwrites the entire checklist; items have no UUIDs, no links to disk files, no Git commit bindings, and no cross-session durability.
- **`packages/goal/goal`**: Models single-session turn convergence for interactive user goals.
- **Spec §5.3 / §5.11 Requirements**:
  - Founder outcome markdown files persisted at `~/.hermes/task-requested/<slug>.md`.
  - Machine-readable bindings (`bindings.json`) mapping founder acceptance criteria to kanban card IDs and verification predicates.
  - Axiom-governed closure verification (`supervise.py [todo-closed]`), which prevents closing a milestone until all linked kanban tasks are verified `DONE` with cryptographic proof artifacts (`INV-01`).
Because the Outcome Ledger governs long-term milestone lifecycles across multiple sessions, worktrees, and weeks of development, it requires a dedicated host service and tool package: `@deepseek-ai/dsh-ledger`.

##### 4. MoA Council Scrutiny & Native Subagent Fan-Out
Spec §5.2 outlines a "Mixture of Agents" (MoA) council where diverse model perspectives debate architecture and strategy before execution.
- The original mapping proposed `@deepseek-ai/dsh-llm-moa` as an `LlmAdapter` under `ctx.llm`. However, `ctx.llm` in DeepSeek Harness is strictly a protocol adapter interface for single LLM providers (Anthropic, OpenAI, DeepSeek). Hiding multi-agent orchestration, iterative advisor turns, and consensus aggregation behind a pseudo-model provider violates architectural boundaries, obscures intermediate tokens, breaks streaming UI observability, and prevents per-advisor tool use.
- In DeepSeek Harness, multi-model consensus is natively realized through subagent fan-out via `ctx.subagents` (`@deepseek-ai/dsh-tool-subagent` or `@deepseek-ai/dsh-workflow-worker-thread`). The orchestrator agent dispatches parallel child subagents with distinct personas (e.g., security auditor, performance architect, domain specialist), and then aggregates their structured outputs in the parent session.
- Consequently, `@deepseek-ai/dsh-llm-moa` is dropped entirely in favor of native subagent fan-out.

---

### E. Preset Inventory

#### Architectural Evaluation: Do Sub-Roles Warrant Separate Presets?
In the live codebase, `packages/subagent/subagent-in-process-driver/src/index.ts:134-160` and `packages/subagent/subagent/src/child-agent.ts:199-218` establish the exact per-child composition contract:
```typescript
export function applyChildComposition(
  childCtx: Context,
  parent: Agent,
  composition: ChildComposition,
): void {
  childCtx.get('agentPresets')?.composeFrom(childCtx, parent.ctx)
  childCtx.systemPrompt.context({
    name: 'subagent:delegation',
    order: childCtx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: SUBAGENT_DELEGATION_CONTEXT,
  })
  if (composition.persona !== undefined) {
    childCtx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: composition.persona,
    })
  }
  if (composition.toolFilter !== undefined) childCtx.tools.restrict(composition.toolFilter)
}
```
This proves conclusively that:
1. An in-process child subagent **inherits its parent's preset** via `composeFrom(childCtx, parent.ctx)` (`packages/preset/agent-presets/src/index.ts:477-486`).
2. The subagent seam provides first-class `persona` shadowing (`deployment:persona-prefix`) and `toolFilter` restriction (`childCtx.tools.restrict()`).
3. Creating separate preset directories for `test-writer`, `implementer`, and `reviewer` is completely redundant and fights the subagent driver's design. The worker preset (`hermes-worker`) carries the complete engineering tool suite; when the worker delegates to a child test-writer or reviewer, it passes `persona` and `toolFilter` (e.g. `{ deny: ['write_file', 'patch'] }` for reviewer).
4. The Integrator is a non-agent automated script (`merge_card.py`), running on the host plane via `@deepseek-ai/dsh-integrator`, and requires no agent preset.

#### Final Presets Roster:

```
packages/preset/agent-presets/presets/
├── hermes-brain/
│   ├── preset.yml
│   └── agent.cordis.yml
└── hermes-worker/
    ├── preset.yml
    └── agent.cordis.yml
```

#### Preset 1: `hermes-brain` (`packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml`)
- **Display Name**: 调度大脑 (Brain Mode)
- **Order**: 10
- **Role**: Brain Orchestrator, Founder Intake, Milestone Decomposition, Board Dispatcher.
- **Composition Outline**:
```yaml
# ── persona ─────────────────────────────────────────────────────────────────
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: >-
      You are the StoryInCode Brain Orchestrator powered by Claude Opus 4.8.
      You orchestrate software work through the Hermes Kanban work queue.
      Never claim tasks directly. Delegate large file reads and edits to agy.
    complete: false
    includeRuntimeContext: true

# ── planning mode ───────────────────────────────────────────────────────────
- id: planning
  name: cordis:group
  group: true
  isolate:
    planMode: true
  config:
    - id: plan-mode
      name: '@deepseek-ai/dsh-plan-mode'

# ── human interaction ───────────────────────────────────────────────────────
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'

# ── kanban orchestration ───────────────────────────────────────────────────
- id: tool-kanban
  name: '@deepseek-ai/dsh-tool-kanban'
  config:
    role: orchestrator

# ── outcome ledger ──────────────────────────────────────────────────────────
- id: tool-ledger
  name: '@deepseek-ai/dsh-tool-ledger'

# ── candidate axioms exploration ───────────────────────────────────────────
- id: tool-candidate-axioms
  name: '@deepseek-ai/dsh-axiom/tool'

# ── subagent and workflow delegation ────────────────────────────────────────
- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflowEngine: true
  config:
    - id: tool-subagent
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: spawn
        toolName: subagent
    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
    - id: tool-subagent-agy
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: agy
        toolName: subagent_agy
        backgroundMode: one-shot
        maxDepth: provider-managed
    - id: tool-subagent-claude-code
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: claude-code
        toolName: subagent_claude_code
        backgroundMode: one-shot
        maxDepth: provider-managed
    - id: tool-subagent-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: codex
        toolName: subagent_codex
        backgroundMode: one-shot
        maxDepth: provider-managed
    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'
    - id: workflow-worker-thread
      name: '@deepseek-ai/dsh-workflow-worker-thread'
    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'

# ── memory & session search ──────────────────────────────────────────────────
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'

- id: tool-session-search
  name: '@deepseek-ai/dsh-tool-session-query'
  config:
    maxSearchResults: 20
    searchTimeoutMs: 15000

# ── skills ───────────────────────────────────────────────────────────────────
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

#### Preset 2: `hermes-worker` (`packages/preset/agent-presets/presets/hermes-worker/agent.cordis.yml`)
- **Display Name**: 工程执行 (Worker Mode)
- **Order**: 11
- **Role**: Implementer, BDD Test Writer, Independent Reviewer, Leaf Worker.
- **Composition Outline**:
```yaml
# ── persona ─────────────────────────────────────────────────────────────────
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: >-
      You are an unattended engineering worker in the Hermes development pool.
      You execute contract-bounded tasks within isolated Git worktrees.
      Implement pinned tests, verify before stopping, and report through kanban.
    complete: false
    includeRuntimeContext: true

# ── agent instructions (colocated AGENTS.md) ────────────────────────────────
- id: agent-instructions
  name: '@deepseek-ai/dsh-agent-instructions'
  config:
    maxBytes: 65536

# ── execution substrate ─────────────────────────────────────────────────────
- id: tool-fs
  name: '@deepseek-ai/dsh-tool-fs'

- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: !!js process.platform === 'win32'

# ── axiom tools ─────────────────────────────────────────────────────────────
- id: tool-axiom
  name: '@deepseek-ai/dsh-tool-axiom'

# ── kanban worker tools ─────────────────────────────────────────────────────
- id: tool-kanban
  name: '@deepseek-ai/dsh-tool-kanban'
  config:
    role: worker

# ── memory notes ────────────────────────────────────────────────────────────
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'

# ── verification & test pinning guards ──────────────────────────────────────
- id: guard-test-pinning
  name: '@deepseek-ai/dsh-guard-test-pinning'

- id: verification-stop
  name: '@deepseek-ai/dsh-verification-stop'

# ── skills ──────────────────────────────────────────────────────────────────
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'

- id: tool-skill
  name: '@deepseek-ai/dsh-tool-skill'
```

#### Note on Supervision in Presets
Supervision (`@deepseek-ai/dsh-supervisor`) is a host-plane daemon service mounted into the Cordis root container (`ctx.supervisor`). It runs ambiently in the background, listening directly to system bus events (`kanban/task-status`, `kanban/heartbeat-tick`, `subagent/end`, `agent/request-error`) and managing independent Node.js watchdog timers. Because it does not provide agent-scoped tools, modify prompt contexts, or restrict agent turns, it requires **zero rows** in agent presets (`hermes-brain` or `hermes-worker`).

---

### F. Skill Justification Table

| Skill Name | Why a Skill and not System Prompt / Preset? | Why a Skill and not a Tool / Service? | Why a Skill and not a Workflow? | Loading Mechanism & Format |
|---|---|---|---|---|
| `bdd-scenario-guide` | Ephemeral reference needed only during test authoring; putting it in system prompt wastes KV cache on implementer and brain turns | Contains formatting playbooks and edge-case checklists, not deterministic executable code or state | Guides an individual agent's single-turn reasoning rather than orchestrating multi-agent trees | `SKILL.md` bundle in `.dsh/skills/bdd-scenario-guide/`; loaded on-demand via `tool-skill` |
| `code-review-lens` | Active only during review turns; keeping it out of the base worker prompt preserves token budget during implementation | Qualitative evaluation heuristics and inspection questions, not automated AST queries | Governs intra-turn evaluation behavior of a single reviewer agent | `SKILL.md` bundle in `.dsh/skills/code-review-lens/`; loaded on-demand via `tool-skill` |
| `stylex-coexistence-recipe` | Highly specific domain playbook needed only during CSS/StyleX coexistence refactoring tasks (ADR-015) | Pure code recipes and anti-pattern catalogs; no host I/O or state modification | Provides instructions for manual refactoring rather than automated subagent dispatch | `SKILL.md` bundle in `.dsh/skills/stylex-coexistence-recipe/`; loaded on-demand via `tool-skill` |

#### Rejected Skills:
1. *Rejected*: `kanban-orchestrator-skill` -> **REJECTED**. Violates hard constraint against monolithic skills acting as runtime orchestrators. State must be tracked in SQLite transactions via `@deepseek-ai/dsh-kanban-sqlite` and operated through `@deepseek-ai/dsh-tool-kanban`.
2. *Rejected*: `axiom-sweeper-skill` -> **REJECTED**. "The worker reports, the sweeper decides". A skill cannot mechanically enforce invariants or evaluate shell tests; owned by `@deepseek-ai/dsh-axiom-verifier`.
3. *Rejected*: `worktree-manager-skill` -> **REJECTED**. Worktree allocation, collision prevention, and unpushed commit guards require deterministic transactional code; owned by `@deepseek-ai/dsh-worktree-local`.
4. *Rejected*: `test-pinning-skill` -> **REJECTED**. Prompt instructions cannot prevent an adversarial or hallucinating model from editing test files; owned by `@deepseek-ai/dsh-guard-test-pinning`.
5. *Rejected*: `self-learning-curator-skill` -> **REJECTED**. Skill curation and background memory review require timer/turn hooks and subprocess scheduling; owned by `@deepseek-ai/dsh-memory-curator`.
6. *Rejected*: `worker-supervisor-skill` -> **REJECTED**. Watching for hung workers, calculating heartbeat timeouts, and executing circuit breaker logic cannot be done via LLM prompts or on-demand skills. Owned by host daemon `@deepseek-ai/dsh-supervisor`.

---

### G. Reuse Ledger

| Package Name | Repository Location | Status | Citation (file:line) | Role in Hermes Architecture |
|---|---|---|---|---|
| `@deepseek-ai/dsh-agent-loop` | `packages/core/agent-loop` | Reused Unchanged | `packages/core/agent-loop/src/index.ts:1-120` | Primary turn/step lifecycle driver and waterfall dispatcher |
| `@deepseek-ai/dsh-session` | `packages/core/session` | Reused Unchanged | `packages/core/session/src/types.ts:269-401` | Immutable session event log and surface projection engine |
| `@deepseek-ai/dsh-tools` | `packages/core/tools` | Reused Unchanged | `packages/core/tools/src/index.ts:1027-1052` | Tool registration, parameter validation, and `ScopedLayers` scoping |
| `@deepseek-ai/dsh-subagent` | `packages/subagent/subagent` | Reused Unchanged | `packages/subagent/subagent/src/index.ts:133-136` | Subagent runtime service definition and lifecycle coordinator |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | `packages/subagent/subagent-spawn-in-process` | Reused Unchanged | `packages/subagent/subagent-spawn-in-process/src/index.ts:41-66` | Unattended fresh subagent provider for review forks & workers |
| `@deepseek-ai/dsh-subagent-fork-in-process` | `packages/subagent/subagent-fork-in-process` | Reused Unchanged | `packages/subagent/subagent-fork-in-process/src/index.ts:48-92` | Seeded parent-history subagent provider for continuations |
| `@deepseek-ai/dsh-subagent-in-process-driver`| `packages/subagent/subagent-in-process-driver`| Reused Unchanged | `packages/subagent/subagent-in-process-driver/src/index.ts:134-160` | Preset inheritance (`composeFrom`), persona, and toolFilter scoping |
| `@deepseek-ai/dsh-tool-subagent` | `packages/subagent/tool-subagent` | Extended | `packages/subagent/tool-subagent/src/index.ts:48-103` | Extended with `maxConcurrentChildren` and `spawnPaused` preflight validation (Plan 15) |
| `@deepseek-ai/dsh-subagent-claude-code` | `packages/subagent/subagent-claude-code` | Reused Unchanged | `packages/subagent/subagent-claude-code/src/index.ts:30-58` | Claude Code CLI subagent provider; self-authenticates via `~/.claude/.credentials.json` |
| `@deepseek-ai/dsh-subagent-codex` | `packages/subagent/subagent-codex` | Reused Unchanged | `packages/subagent/subagent-codex/src/index.ts:30-59` | Codex CLI subagent provider; self-authenticates via `~/.codex/auth.json` |
| `@deepseek-ai/dsh-tool-subagent-control` | `packages/subagent/tool-subagent-control` | Extended | `packages/subagent/tool-subagent-control/src/index.ts:140-192` | Extended with enriched `list_agents`, `subagent_tail`, and `kill_agent` (Plan 15) |
| `@deepseek-ai/dsh-workflow` | `packages/workflow/workflow` | Reused Unchanged | `packages/workflow/workflow/src/index.ts:31-35` | Workflow capability seam (`ctx.workflowEngine`) |
| `@deepseek-ai/dsh-workflow-worker-thread` | `packages/workflow/workflow-worker-thread` | Reused Unchanged | `packages/workflow/workflow-worker-thread/src/index.ts:112-195`| VM-sandboxed Worker thread execution engine for multi-agent scripts |
| `@deepseek-ai/dsh-plan-mode` | `packages/plan/plan-mode` | Reused Unchanged | `packages/plan/plan-mode/src/index.ts:40-49` | Plan mode state tracking, exit review, and `/plan` command |
| `@deepseek-ai/dsh-tool-todo` | `packages/todo/tool-todo` | Reused Unchanged | `packages/todo/tool-todo/src/types.ts:28-33` | In-session checklist replacement tool |
| `@deepseek-ai/dsh-user-questions` | `packages/interaction/user-questions` | Reused Unchanged | `packages/interaction/user-questions/src/index.ts:86` | Human interaction capability seam for request clarification |
| `@deepseek-ai/dsh-tool-ask-user` | `packages/interaction/tool-ask-user` | Reused Unchanged | `packages/interaction/tool-ask-user/src/index.ts:1-102` | `ask_user_question` model tool for founder intake |
| `@deepseek-ai/dsh-user-approval` | `packages/interaction/user-approval` | Reused Unchanged | `packages/interaction/user-approval/src/index.ts:104-125` | Permission approval gate for risky tool operations |
| `@deepseek-ai/dsh-permission-presets` | `packages/interaction/permission-presets` | Reused Unchanged | `packages/interaction/permission-presets/src/index.ts:1-60` | Bundled sandbox and approval policy presets |
| `@deepseek-ai/dsh-fs` | `packages/fs/fs` | Reused Unchanged | `packages/fs/fs/src/index.ts:44-47` | FileSystem capability seam (`ctx.fs`) |
| `@deepseek-ai/dsh-fs-local` | `packages/fs/fs-local` | Reused Unchanged | `packages/fs/fs-local/src/index.ts:65-278` | Host filesystem operations and atomic write staging |
| `@deepseek-ai/dsh-fs-sandbox` | `packages/fs/fs-sandbox` | Reused Unchanged | `packages/fs/fs-sandbox/src/index.ts:55-145` | Fences filesystem mutations to worktree `workspaceRoot` |
| `@deepseek-ai/dsh-tool-fs` | `packages/fs/tool-fs` | Reused Unchanged | `packages/fs/tool-fs/src/session-cwd.ts:22-26` | Model filesystem tools (`read_file`, `write_file`, `edit_file`) |
| `@deepseek-ai/dsh-shell` | `packages/shell/shell` | Reused Unchanged | `packages/shell/shell/src/types.ts:38-110` | Shell capability seam (`ctx.shell`) and `resolve()` pattern |
| `@deepseek-ai/dsh-bash-local` | `packages/shell/bash-local` | Reused Unchanged | `packages/shell/bash-local/src/index.ts:102-127` | Local bash execution with strict mutual exclusion for timeout/abort |
| `@deepseek-ai/dsh-tool-bash` | `packages/shell/tool-bash` | Reused Unchanged | `packages/shell/tool-bash/src/index.ts:29-31` | Model bash tool for executing builds and test suites |
| `@deepseek-ai/dsh-subprocess` | `packages/subprocess/subprocess` | Reused Unchanged | `packages/subprocess/subprocess/src/types.ts:1-60` | Low-level subprocess execution seam (`ctx.subprocess`) |
| `@deepseek-ai/dsh-subprocess-local` | `packages/subprocess/subprocess-local` | Reused Unchanged | `packages/subprocess/subprocess-local/src/spawn.ts:556` | Process-tree cleanup, systemd transient scopes, and cgroups |
| `@deepseek-ai/dsh-llm` | `packages/llm/llm` | Reused Unchanged | `packages/llm/llm/src/index.ts:333-350` | `LlmRuntime` and model provider adapter registry |
| `@deepseek-ai/dsh-llm-retry` | `packages/llm/llm-retry` | Reused Unchanged | `packages/llm/llm-retry/src/index.ts:194-255` | Exponential backoff retry interceptor on `agent/request-error` |
| `@deepseek-ai/dsh-session-persistence-jsonl`| `packages/session/session-persistence-jsonl` | Reused Unchanged | `packages/session/session-persistence-jsonl/src/index.ts:1-80`| Primary append-only session transcript storage |
| `@deepseek-ai/dsh-session-query-sqlite` | `packages/session-query/session-query-sqlite` | Reused Unchanged | `packages/session-query/session-query-sqlite/src/schema.ts:8` | Derived FTS5 index for fast full-text transcript searches |
| `@deepseek-ai/dsh-timeout-policy` | `packages/guard/timeout-policy` | Reused Unchanged | `packages/guard/timeout-policy/src/index.ts:1-82` | Cooperative deadline wrapper on `tools/execute` |
| `@deepseek-ai/dsh-agent-presets` | `packages/preset/agent-presets` | Reused Unchanged | `packages/preset/agent-presets/src/index.ts:769-817` | Standing mounts, preset discovery, and scope hierarchy |
| `@deepseek-ai/dsh-persona` | `packages/preset/persona` | Reused Unchanged | `packages/preset/persona/README.md:12-28` | Standard `deployment:persona-prefix` system prompt section |
| `@deepseek-ai/dsh-tool-session-query` | `packages/session-query/tool-session-query` | Reused Unchanged | `packages/session-query/tool-session-query/src/index.ts:1-70` | Model-facing session search tools (`session_search`, `session_event_search`) in `hermes-brain` preset |
| `@deepseek-ai/dsh-agent-instructions` | `packages/instruction/agent-instructions` | Reused Unchanged | `packages/instruction/agent-instructions/src/index.ts:1-85` | Injects colocated `AGENTS.md` instruction chain broad-to-specific into `ctx.systemPrompt` |
| `@deepseek-ai/dsh-storage-domain` | `packages/storage/storage-domain` | Reused Unchanged | `packages/storage/storage-domain/src/index.ts:1-60` | Schema-versioned domain KV/table storage capability (`ctx.storageDomain`) used across host subsystems |

---

### H. Core-Modification Register

**One Narrowly Justified Client Core Schema Adjustment (Plan 16); Zero Core Agent Runtime Changes.**
No modifications to `@deepseek-ai/dsh-agent-loop`, `@deepseek-ai/dsh-session`, `@deepseek-ai/cordis`, or any core backend agent execution packages are required.

The single core modification occurs in the client theme settings schema:
- **`packages/client/ui-theme/src/theme-settings.ts`**: Relax `ThemeSettingsSchema[THEME_PREFERENCE_FIELD]` from enum `'light' | 'dark' | 'system'` to `z.string().default(DEFAULT_PREFERENCE)`. This allows arbitrary registered custom theme IDs (`hermes-teal`, `hermes-nous-blue`, etc.) to persist durably through the host `SettingsScope` across browser reboots while maintaining 100% backward compatibility for built-in defaults.

All runtime invariants across the host and agent execution planes are enforced via standard public Cordis extension points:

Every capability required by the Hermes specification maps completely onto existing, documented extension points:
1. *Custom Model Tools*: Registered via `ctx.tools.register()` in `@deepseek-ai/dsh-tools` (`packages/core/tools/src/index.ts:1027`).
2. *Unbypassable Security & Anti-Cheat Guards*: Enforced via `ctx.tools.guard()` in `@deepseek-ai/dsh-tools` (`packages/core/tools/src/index.ts:1100-1106`).
3. *System Prompt Additions*: Injected via `ctx.systemPrompt.section()` and `ctx.systemPrompt.context()` in `@deepseek-ai/dsh-system-prompt` (`packages/core/system-prompt/src/index.ts:474-508`).
4. *Turn Finalization Gates (`verify_on_stop`)*: Hooked via `agent/turn-stopping` serial event in `@deepseek-ai/dsh-agent` (`packages/core/agent/src/runtime-types.ts:501-505`).
5. *Pre-Step Context & Narration Injection*: Hooked via `agent/pre-step` waterfall in `@deepseek-ai/dsh-agent` (`packages/core/agent/src/runtime-types.ts:469-474`).
6. *Pre-Execution Approvals & Sandbox Checks*: Hooked via `tools/pre-execute` waterfall in `@deepseek-ai/dsh-tools` (`packages/core/tools/src/index.ts:144-149`).
7. *Derived Read State & Projections*: Registered via `ctx.sessionProjections.register()` in `@deepseek-ai/dsh-session-projection` (`packages/session/session-projection/src/index.ts:48-93`).

---

### I. Spec Adaptations

Where the Hermes specification is adapted to native DeepSeek Harness primitives:

| # | Spec Design | Harness Adaptation | Architectural Rationale |
|---|---|---|---|
| 1 | Spawning worker via raw OS process `hermes -p default --cli` with `DEVNULL` stdin (`§1`, `§5.7`) | Launch workers via `ctx.subagents.start('spawn', { agentOptions, persona, toolFilter })` | Integrates with native Harness child lifecycle, parent-child event routing, and graceful cancellation cascade without ad-hoc PID monitoring (`packages/subagent/subagent/src/index.ts:556`). |
| 2 | Dedicated SQLite `state.db` with custom `messages_fts` and `messages_fts_trigram` triggers (`§3.2.2`) | Reuse existing `@deepseek-ai/dsh-tool-session-query` over `ctx.sessionQuery` (`dsh-session-query-sqlite`) | Harness already indexes all session events in a schema-versioned FTS5 database with automatic rebuilds on change (`packages/session-query/session-query-sqlite/src/schema.ts:8`), eliminating the need for a duplicate session search package. |
| 3 | Standalone CLI script `hook.py` intercepting tools out-of-band (`§1`, `§8.4`) | Native Cordis tool guard (`ctx.tools.guard()`) and `tools/pre-execute` waterfall | Synchronously guards every tool execution within the Node.js event loop with zero process fork latency (`packages/core/tools/src/index.ts:1100`). |
| 4 | Interactive Python `clarify` tool (`§5.1`, `§8.4`) | Reused `@deepseek-ai/dsh-tool-ask-user` over `ctx.userQuestions` | Native interaction seam seamlessly supports terminal prompt, Web UI modal, and headless ACP protocol (`packages/interaction/tool-ask-user/src/index.ts:1-102`). |
| 5 | Dynamic Python string concatenation prompt builder (`agent/prompt_builder.py`, `§3.1`) | Scoped `ctx.systemPrompt.section()` with explicit numerical order slots | Guarantees byte-identical prompt prefix stability across turns for LLM KV cache reuse (`packages/core/system-prompt/src/index.ts:474-500`). |
| 6 | Separate custom child agent infrastructure (`delegate_task`, `§8.4`) | Native `ctx.subagents` seam with `spawn` and `fork` providers | Reuses standard subagent contracts, depth limits (`maxDepth`), and structured output validation (`packages/subagent/subagent/src/types.ts:344-390`). |
| 7 | Ad-hoc text-based plan mode instructions (`§5.4`) | Native `@deepseek-ai/dsh-plan-mode` with `exit_plan_mode` and `/plan` command | Models plan transitions as durable session events (`plan/mode`) with structured approval review (`packages/plan/plan-mode/src/index.ts:40-49`). |
| 8 | Polling-based background review fork daemon (`§3.6`) | Turn-boundary listener on `agent/turn-stopping` dispatching `subagents.start()` | Eliminates background sleep polling; triggers review forks reactively when turn count reaches threshold. |
| 9 | Standalone Python `guard.py` memory exit 125 check (`§1`, `§9`) | Cordis monotonic tool guard `ctx.tools.guard()` in `guard-resource` | Synchronously checks `/proc/meminfo` before any execution tool runs, denying calls instantly without invoking external scripts. |
| 10 | Post-run Python verification stop check (`verify_on_stop`, `§6.7`) | Serial `agent/turn-stopping` listener in `verification-stop` | Seamlessly hooks into agent loop turn finalization, requiring passing test evidence before allowing turn completion. |
| 11 | Headless CLI delegation via custom tools (`agy_extract`/`agy_edit`, `§5.9`) | Native `SubagentProvider` (`@deepseek-ai/dsh-subagent-agy`) surfaced via `dsh-tool-subagent` | External autonomous CLIs are host-plane subagent providers (matching `subagent-codex`), preserving subagent lifecycle, cancellation, and provider-managed depth limits. |
| 12 | Background Python supervision daemon `supervise.py` polling SQLite (`§5.8`, `§5.9`, `§5.10`) | Host-plane Cordis daemon service (`@deepseek-ai/dsh-supervisor`) hooking lifecycle events | Eliminates external script dependencies; reacts directly to `kanban/*` and `subagent/*` events with deterministic Node.js watchdog timers. |
| 13 | Multi-model MoA council via ad-hoc LLM provider wrapper (`§5.2`) | Native subagent fan-out via `ctx.subagents` (`tool-subagent` / `workflow-worker-thread`) | Multi-agent deliberation is handled natively by parallel child subagents with distinct personas, avoiding an unobservable pseudo-LLM adapter. |
| 14 | Central truth-tree registry (`.hermes/truth/`) and compiled indexes (`§2.2`) | Colocated `AGENTS.md` files with broad-to-specific prompt injection (`@deepseek-ai/dsh-agent-instructions`) | Replaces central truth trees with directory-contained `AGENTS.md` instructions, storing task axioms in `ctx.storageDomain` (`task_axioms`). |
| 15 | Bespoke verification SQLite DB (`verification_evidence.db`, `§6.4`) | Unified storage domain (`ctx.storageDomain`) in `@deepseek-ai/dsh-verification` | Consolidates verification events, manifests, and state into the repository storage domain without a redundant SQLite store package. |
| 16 | Bespoke file-locked `bindings.json` for outcome ledger (`§5.3`) | Dual storage split: human-readable Markdown (`task-requested/*.md`) and `ctx.storageDomain` (`ledger`) | Keeps founder documents auditable while giving machine-facing task bindings atomic schema-backed persistence without manual file locks. |

---

### J. Plan File Manifest

The implementation plans to be authored next, forming a strict contract for downstream implementation agents:

1. **`plans/01-kanban-substrate.md`**
   - *Title*: Kanban Store Capability Seam & SQLite Backend
   - *Packages Covered*: `@deepseek-ai/dsh-kanban`, `@deepseek-ai/dsh-kanban-sqlite`
   - *Scope*: Service Definition `KanbanStore`, 38-column schema, `write_txn` locking, DAG cycle detection, claim management, priority dispatch ordering, metrics logging. Includes HMR disposal test and SQLite WAL integrity tests.
   - *Dependencies*: Core (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-subprocess`).

2. **`plans/02-kanban-interaction-tools.md`**
   - *Title*: Kanban Model-Facing Tools & Slash Command Surface
   - *Packages Covered*: `@deepseek-ai/dsh-tool-kanban`, `@deepseek-ai/dsh-command-kanban`
   - *Scope*: Model tools (`kanban_show`, `kanban_create`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_link`, `kanban_list`), command `/kanban`, parent-never-claims guard (`INV-04`), no-phantom-cards check (`INV-15`).
   - *Dependencies*: `plans/01-kanban-substrate.md`, Core (`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-commands`).

3. **`plans/03-axiom-subsystem.md`**
   - *Title*: Canonical Axiom Registry, Path Indexer, & Scoped Context Injection
   - *Packages Covered*: `@deepseek-ai/dsh-axiom` (with `dsh-axiom-local` collapsed in and `dsh-axiom-context` eliminated; colocated context injection is served by the existing `@deepseek-ai/dsh-agent-instructions`)
   - *Scope*: Service Definition `AxiomRegistry`, YAML parser, `.compiled/path_index.json` compiler, consistency analyzer, scoped system prompt section injection based on touched files (`INV-02`).
   - *Dependencies*: Core (`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-system-prompt`).

4. **`plans/04-axiom-verification-sweeper.md`**
   - *Title*: Declarative Predicate Sweeper & Task Axiom Proof Tools
   - *Packages Covered*: `@deepseek-ai/dsh-axiom-verifier`, `@deepseek-ai/dsh-tool-axiom`
   - *Scope*: 9 declarative predicate evaluators, task axiom store (`task-axioms/<id>.json`), model tool `attach_proof`, `verify_task_axioms`, No Unproven Done gate (`M-009`, `INV-01`), auto-todo request generation.
   - *Dependencies*: `plans/01-kanban-substrate.md`, `plans/03-axiom-subsystem.md`, Core (`@deepseek-ai/dsh-shell`).

5. **`plans/05-memory-and-soul.md`**
   - *Title*: SOUL Persona, Curated Memory Notes, & Transcript Search Tool
   - *Packages Covered*: `@deepseek-ai/dsh-memory`, `@deepseek-ai/dsh-memory-local`, `@deepseek-ai/dsh-tool-memory` (reusing `@deepseek-ai/dsh-tool-session-query`)
   - *Scope*: Service Definition `MemoryStore`, `SOUL.md` read integration, `USER.md`/`MEMORY.md` delimiter parsing, NFKC threat scanner, turn-stable prompt snapshot (`INV-08`), tool `memory`, tool `session_search` wrapping `ctx.sessionQuery`.
   - *Dependencies*: Core (`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-session-query-sqlite`).

6. **`plans/06-curator-and-self-learning.md`**
   - *Title*: Autonomous Skill Curator Daemon & Background Memory Review Fork
   - *Packages Covered*: `@deepseek-ai/dsh-memory-curator`
   - *Scope*: Curator background scheduling, skill lifecycle state transitions (active -> stale -> archived), turn-counter hook on `agent/turn-stopping`, review fork subagent invocation via `ctx.subagents`.
   - *Dependencies*: `plans/05-memory-and-soul.md`, Core (`@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-skill`).

7. **`plans/07-worktree-management.md`**
   - *Title*: Git Worktree Pool & Workspace Isolation Manager
   - *Packages Covered*: `@deepseek-ai/dsh-worktree`, `@deepseek-ai/dsh-worktree-local`
   - *Scope*: Service Definition `WorktreeManager`, dynamic worktree allocation (`.worktrees/<id>/`), base commit SHA recording, dirty/unpushed commit preservation guard (`INV-07`), collision avoidance.
   - *Dependencies*: Core (`@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-fs`).

8. **`plans/08-resource-guard-and-admission.md`**
   - *Title*: Systemd Cgroups & Host Memory Admission Guard
   - *Packages Covered*: `@deepseek-ai/dsh-guard-resource`
   - *Scope*: Systemd slice management (`hermes-work.slice`), host memory headroom floor 3 GiB admission gate (`INV-12`), pre-tool execution veto hook via `ctx.tools.guard()`.
   - *Dependencies*: Core (`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-subprocess`).

9. **`plans/09-verified-pipeline-and-gates.md`**
   - *Title*: Verification Evidence Ledger, Test Pinning, & Turn Stop Gates
   - *Packages Covered*: `@deepseek-ai/dsh-verification` (evidence persisted through `ctx.storageDomain`; `dsh-verification-sqlite` eliminated), `@deepseek-ai/dsh-guard-test-pinning`, `@deepseek-ai/dsh-verification-stop`
   - *Scope*: Evidence ledger (`verification_events`), RED gate evaluator (`INV-14`), cryptographic SHA-256 test hash pinning (`INV-13`), anti-cheat shell parser (`INV-11`), `verify_on_stop` turn finalization interceptor.
   - *Dependencies*: `plans/07-worktree-management.md`, Core (`@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-shell`, `@deepseek-ai/dsh-agent`).

10. **`plans/10-integration-and-pr-engine.md`**
    - *Title*: Worktree Integration Engine & GitHub PR Synchronization
    - *Packages Covered*: `@deepseek-ai/dsh-integrator`
    - *Scope*: Automated `merge_card` engine, pre-merge draft PR creation, target baseline test execution, local merge (`--no-ff`), full re-verification, atomic rollback on failure.
    - *Dependencies*: `plans/01-kanban-substrate.md`, `plans/07-worktree-management.md`, `plans/09-verified-pipeline-and-gates.md`, Core (`@deepseek-ai/dsh-shell`).

11. **`plans/11-agy-subagent-provider.md`**
    - *Title*: Headless `agy` Subagent Provider & Delegation Bridge
    - *Packages Covered*: `@deepseek-ai/dsh-subagent-agy`
    - *Scope*: Implementation of `SubagentProvider` for headless `/home/sic/.local/bin/agy`, process tree lifecycle via `ctx.subprocess`, self-authentication via file-based OAuth stores under `$HOME` (`~/.hermes/auth.json`), active provider router model resolution (no hardcoded model), stream-json parsing, cancellation cascade (SIGINT/SIGTERM), and `@deepseek-ai/dsh-tool-subagent` surfacing (`provider: agy`, `toolName: subagent_agy`, `backgroundMode: one-shot`, `maxDepth: 'provider-managed'`).
    - *Dependencies*: Core (`@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-tools`).

12. **`plans/12-supervisor-and-watchdog.md`**
    - *Title*: Autonomous Supervisor Daemon, Watchdogs, & Quota Wall
    - *Packages Covered*: `@deepseek-ai/dsh-supervisor`
    - *Scope*: Host-plane daemon service `ctx.supervisor`, silent worker 30m watchdog timers, circuit breaker failure counters and auto-reset, quota wall protection on 429 API errors, automated PR result review subagent dispatch (§5.10), and milestone todo closure verification (§5.11).
    - *Dependencies*: `plans/01-kanban-substrate.md`, `plans/09-verified-pipeline-and-gates.md`, `plans/10-integration-and-pr-engine.md`, Core (`@deepseek-ai/dsh-subprocess`, `@deepseek-ai/dsh-subagent`).

13. **`plans/13-outcome-ledger.md`**
    - *Title*: Outcome Ledger & Founder Milestone Tracking
    - *Packages Covered*: `@deepseek-ai/dsh-ledger`
    - *Scope*: Outcome document persistence at `~/.hermes/task-requested/<slug>.md`, milestone binding (`bindings.json`), model tools `ledger_show` and `ledger_update`, and milestone acceptance proof checks.
    - *Dependencies*: `plans/01-kanban-substrate.md`, `plans/03-axiom-subsystem.md`, Core (`@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-tools`).

14. **`plans/14-presets-profiles-and-bundle.md`**
    - *Title*: Agent Presets (`hermes-brain`, `hermes-worker`), Profile, & Bundle Configuration
    - *Packages Covered*: `@deepseek-ai/dsh-hermes-base`, Preset definitions (`hermes-brain`, `hermes-worker`)
    - *Scope*: YAML composition of `hermes-brain/agent.cordis.yml` (including `tool-subagent-agy`) and `hermes-worker/agent.cordis.yml`, host bundle `cordis.patch.yml`, profile setup, verification with `verify-cordis-config`.
    - *Dependencies*: All plans (`plans/01` through `plans/13`).

15. **`plans/15-orchestrator-vision-and-control.md`**
    - *Title*: Orchestrator Vision and Control over Workers
    - *Packages Covered*: `@deepseek-ai/dsh-subagent-progress`, extensions to `@deepseek-ai/dsh-tool-subagent-control`
    - *Scope*: Documents that two-way brain<->worker messaging is ALREADY native (`send_message` -> `ctx.subagents.sendMessage` into a running child's step inbox; children message the parent; automatic settlement notices), then closes the three real gaps: enriched worker status and live transcript tailing (`subagent_tail`), a model-facing hard stop over `drainContinuableChildren` (`kill_agent`), and a concurrency ceiling plus operator pause gate. Adds heartbeat/zombie detection consumed by Plan 12.
    - *Dependencies*: `plans/12-supervisor-and-watchdog.md`, `plans/14-presets-profiles-and-bundle.md`; builds on the shipped `packages/subagent/**` seam.

16. **`plans/16-hermes-ui-theme-adoption.md`**
    - *Title*: Hermes UI and Theme Adoption into the Harness Client
    - *Packages Covered*: `packages/client/ui-theme` (expanded), a theme settings section, selected ported components
    - *Scope*: Maps the Hermes theme catalogue onto the `--dsw-*` semantic aliases, registers Hermes themes through `ctx.theme.register()`, and makes them selectable and persistable — including the one narrowly justified core change relaxing the theme preference schema beyond `light | dark | system`. Covers component adoption with regression risk per item, the locale-owned copy obligation (`verify-client-ui-i18n`), and the no-regression test set.
    - *Dependencies*: None on the Hermes orchestration plans; independent of `plans/01`-`plans/15` and implementable in parallel.

---

### K. Open Architectural Questions

1. **Worker Process Topology (In-Process Subagent vs Dedicated Out-of-Process Worker)**:
   - *Option A*: Run unattended workers as in-process subagents via `ctx.subagents.start('spawn', ...)`. Tradeoff: Low memory overhead, instant startup (~3ms), shared process fibers, but a fatal memory corruption or native addon crash affects the host.
   - *Option B*: Run workers as isolated subprocesses via `dsh-subagent-dsh-sdk` or dedicated CLI runner. Tradeoff: Absolute OS process isolation, systemd cgroup per process, crash containment, but slightly higher memory footprint per worker (~30MB base).
2. **MoA Council Realization (LLM Adapter vs Native Subagent Fan-Out)** -> **RESOLVED**:
   - *Resolution*: Resolved in favor of native subagent fan-out via `ctx.subagents` (`tool-subagent` or `workflow-worker-thread`), dropping the proposed `@deepseek-ai/dsh-llm-moa` package. Hiding multi-agent orchestration behind an `LlmAdapter` obscures transcript observability, violates LLM runtime abstraction boundaries, and prevents per-advisor tool usage. Subagent fan-out natively supports streaming, per-advisor persona prompts, and structured aggregation.
3. **Kanban Storage Coexistence (Shared Domain KV vs Dedicated SQLite DB)**:
   - *Option A*: Implement `dsh-kanban-sqlite` directly opening dedicated SQLite database `~/.hermes/kanban.db`. Tradeoff: Retains 100% byte-for-byte schema and operational compatibility with external Python scripts (`supervise.py`, `merge_card.py`, `hermes-cli`).
   - *Option B*: Migrate Kanban storage to `ctx.storageDomain` (`packages/storage/storage-sqlite`) using `defineDomain`. Tradeoff: Centralized schema management inside Harness storage subsystem, but breaks legacy external Python script access.
4. **Task Axioms Storage Format (File JSON vs Custom Session Event Map)**:
   - *Option A*: Keep task axioms as JSON files at `~/.hermes/task-axioms/<id>.json`. Tradeoff: Readable by external tools and inspectable on disk, but lives outside the session event stream.
   - *Option B*: Declaration-merge `'task-axiom/update'` and `'task-axiom/proof'` into `SessionEventMap` (`@deepseek-ai/dsh-session/types`) with a projection unit folding current axiom state. Tradeoff: Strict adherence to the "Model-Visible <=> Logged" invariant, exact replayability, but requires session context to read.

## Review fixes applied

- **REVIEW-seams Finding 1 (Preset Service Provider Leakage)**:
  - Updated `hermes-brain` preset outline to mount `@deepseek-ai/dsh-tool-ledger` and `@deepseek-ai/dsh-axiom/tool` as agent-plane tool rows rather than root service providers, and collocated `tool-workflow` inside `{ workflowEngine: true }` isolate realm.
- **REVIEW-seams Finding 2 (Duplicate Session Search Package)**:
  - Eliminated `@deepseek-ai/dsh-tool-session-search` from package topology, spec mapping, and preset outlines.
  - Reused existing shipped `@deepseek-ai/dsh-tool-session-query` package across Plan 00 and Plan 05.
- **External CLI Authentication & Subagent Composition**: Corrected Correction 1, package descriptions, architecture analyses, and reuse ledgers to reflect that agy, Claude Code, and Codex authenticate via file-based OAuth under $HOME with zero credential plumbing; model selection is owned by agy's provider router with optional validated override (never pinned); and subagent-claude-code/codex availability is a Profile composition fact rather than an auth restriction.
