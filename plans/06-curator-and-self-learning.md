# 06 — Autonomous Skill Curator Daemon & Background Memory Review Fork

## Features

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

## 1. Purpose

`@deepseek-ai/dsh-memory-curator` establishes the autonomous self-learning and procedural skill lifecycle engine for StoryInCode, implementing Spec §3.5 and §3.6. It transforms ephemeral multi-turn experiences into durable procedural knowledge while enforcing strict write governance and preservation guarantees.

- **What it owns**:
  - The `memoryCurator` capability seam (`CuratorRuntime` Service class in `@deepseek-ai/dsh-memory-curator` extending `@deepseek-ai/cordis.Service`).
  - Periodic host-level housekeeping and inactivity gating (`min_idle_hours: 2.0`, `interval_hours: 168.0`) managing procedural skill decay.
  - Deterministic skill lifecycle transitions (`active` -> `stale` at 30 days inactivity, `stale` -> `archived` at 90 days, `stale` -> `active` upon invocation) driven by `ctx.storageDomain` (`curator` domain, table `usage`).
  - The Skill Preservation Invariant: The curator **never deletes skills**. Retired skills are moved to `~/.hermes/skills/.archive/<name>-<YYYYMMDDHHMMSS>/`.
  - The curator audit ledger persisted via `ctx.storageDomain` (`curator` domain, table `ledger`) and pre-consolidation content-addressed backup archives under `~/.hermes/.curator_backups/blobs/<sha256>`.
  - The background review fork triggered on `agent/turn-stopping` every 10 turns (`nudgeInterval`), executing through the native `ctx.subagents` capability seam.
  - Review child agent sandboxing: Strict tool filtering allowlisting `skill`, `read_file`, `fs_search`, `skill_manage`, and `memory` (add-only), blocking execution tools (`bash`, `write_file`, `patch`).
  - Immediate human preemption cancelling running review forks within 2.0 seconds when a user input message arrives on the parent agent.
  - Read-before-write skill governance: Enforcing that `skill` must have been executed for a specific skill within the session prior to patching.
  - Unattended deletion protection: Intercepting `replace` or `remove` memory mutations in background review runs and routing them to the write approval store (`~/.hermes/approvals/pending/`).
  - Repeated lesson promotion rule (`M-013`): Identifying recurring constraints/defects across >= 2 independent sessions, staging proposals at `~/.hermes/candidate-axioms/<id>.json`, and emitting `'curator/candidate-axiom-promoted'`.

- **What it deliberately does NOT own**:
  - Curated semantic memory note persistence, delimiter parsing (`\n§\n`), POSIX file locks, and prompt prefix snapshot stability `INV-08` (owned by `@deepseek-ai/dsh-memory-local`, Plan 05).
  - Human `SOUL.md` identity persona injection and edit protection `INV-09` (owned by `@deepseek-ai/dsh-persona` and `@deepseek-ai/dsh-guard-resource`, Plans 05 and 08).
  - Model-facing tools `memory` and `session_search` (owned by `@deepseek-ai/dsh-tool-memory` and existing `@deepseek-ai/dsh-tool-session-query`, Plan 05).
  - Colocated `AGENTS.md` parser, task axiom document persistence, and diff impact analysis (owned by `@deepseek-ai/dsh-axiom`, Plan 03).
  - Predicate evaluation sweeper and No Unproven Done gate `INV-01` (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Subagent provider runtime implementations (`subagent-spawn-in-process`, `subagent-fork-in-process`) (owned by `@deepseek-ai/dsh-subagent`, Core).
  - Host memory headroom 3 GiB admission gate `INV-12` (owned by `@deepseek-ai/dsh-guard-resource`, Plan 08).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-memory-curator`: **Service Provider & Event-Hook Plugin**.
  1. Subclasses `Service` from `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:7-8`), registering `ctx.memoryCurator` as a singleton on the host plane.
  2. Subscribes to host and agent lifecycle events:
     - `agent/turn-stopping` (`packages/core/agent/src/runtime-types.ts:391`): Serial listener counting completed turns and dispatching review subagents.
     - `tools/post-execute` (`packages/core/tools/src/index.ts:167`): Waterfall listener tracking skill invocations into `usage` storage table and reactivating stale skills.
     - `agent/status` (`packages/core/agent/src/runtime-types.ts:303`): Tracks system idle state for §3.5 inactivity gating.
     - `agent/inbox/spliced` (`packages/core/agent/src/runtime-types.ts:316`): Preempts active review runs when human messages arrive.
  3. Acts as a **Subagent Consumer** by calling `ctx.subagents.start()` (`packages/subagent/subagent/src/index.ts:97, 188-217`) rather than spawning ad-hoc processes or detached threads.

### 2.2 Why a Host Service and Native Subagent Consumer
- **Why NOT custom daemon threads / OS processes**: Legacy Python Hermes ran background reviews on detached OS threads (`background_review.py:868-874`). In DeepSeek Harness, unmanaged threads or child processes bypass session projections, audit logging, token accounting, and preset security sandboxes. Harness provides `ctx.subagents`, which wraps child agents in proper Cordis contexts, isolates memory, and manages lifecycle disposal (`packages/subagent/subagent/src/index.ts:188-217`).
- **Why Service Provider on the Host Plane**: Skill usage metrics, lifecycle transitions, and the curator audit ledger represent durable, host-wide state shared across all agents and sessions. Per **PRESET-RULE 6** (`PRESET-RULES.md:12`), a component that injects host services (`storageDomain`, `fs`, `subagents`, `skills`) and resolves before sessions exist belongs in the host composition (`packages/bundle/base/cordis.patch.yml`).

### 2.3 Host Plane vs Agent Plane Separation
- **Host Plane (`base.cordis.yml` patch layer)**:
  `@deepseek-ai/dsh-memory-curator` mounts globally, publishing `ctx.memoryCurator`. It maintains the periodic housekeeping timer, records skill usage via `tools/post-execute`, and stages candidate axioms.
- **Agent Plane (`presets/hermes-worker/agent.cordis.yml`, `presets/hermes-brain/agent.cordis.yml`)**:
  The `agent/turn-stopping` listener observes turns across active agents. Review subagents spawned via `ctx.subagents` are marked with lineage metadata (`descriptor.role: 'curator-review'`), ensuring they never trigger nested review hooks (preventing infinite subagent recursion).

### 2.4 Evidence-Based Evaluation of Repository Storage Capability (Option (a) ctx.storageDomain vs Bespoke Store)
An explicit audit was performed evaluating whether curator ledger persistence and skill usage tracking require bespoke files or map directly to `ctx.storageDomain`:

**Decision: Option (a) — Consume `ctx.storageDomain` (`curator` domain, tables `ledger` and `usage`); drop plain `.curator_ledger.jsonl` and `.usage.json` files.**

1. *External Reader Audit*:
   The specification originally planned writing `.curator_ledger.jsonl` and `.usage.json` under `~/.hermes/skills/`. Stated explicitly: this plain file layout is **NOT** a system requirement because no external tool, reader, or maintenance script outside the DeepSeek Harness reads these files. It was an artifact of the ported Python Hermes codebase (`background_review.py`). Physical skill directories under `~/.hermes/skills/<name>/SKILL.md` remain on the filesystem for skill loading, but the audit ledger and usage records are host metadata.
2. *Access Pattern and Storage Shape*:
   - `ledger` table: Records `CuratorLedgerEntry` keyed by entry UUID `id`. Point writes append to the write chain on lifecycle transitions (`table('ledger').put(entry.id, entry)`).
   - `usage` table: Records `SkillUsageRecord` keyed by `skillName`. Point writes record invocations (`table('usage').put(name, record)` or `update(name, ...)`). Synchronous reads from in-memory cache evaluate inactivity during housekeeping sweeps.
3. *Absence of Bespoke Relational / Concurrency Requirements*:
   Contrasting with Kanban (Plan 01), which required bespoke SQLite due to cross-table transactions, foreign keys, and multi-process file locks, the curator ledger has:
   - Zero cross-table transactions (`packages/storage/storage-domain/README.md:152`).
   - Zero secondary index requirements.
   - Zero cross-process concurrency (singleton service on the Host Plane; write chain serializes in-process writes).
4. *Advantages of ctx.storageDomain Reuse*:
   - Eliminates invented persistence machinery: POSIX `.usage.json.lock` lock files, `.tmp` swap dances, and manual JSONL append/parse logic.
   - Synchronous reads from in-memory cache make housekeeping checks instantaneous.
   - Declarative schema validation via `defineDomain` and `CURATOR_DOMAIN_VERSION = 1` enforces integrity at module open.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Skill curator scheduling & inactivity gate (§3.5) | Yes (`CuratorRuntime.tickHousekeeping`) | None | Tick checking idle and interval |
| Deterministic lifecycle state transitions (§3.5) | Yes (`SkillLifecycleManager`) | None | `active` -> `stale` (30d), `stale` -> `archived` (90d) |
| Skill Preservation Invariant (Zero deletions) (§3.5) | Yes (`SkillLifecycleManager.archiveSkill`) | None | Moves to `.archive/<name>-<timestamp>/` |
| Audit ledger via ctx.storageDomain (§3.5) | Yes (`CuratorLedgerWriter`) | None | `curator` domain `ledger` table, blobs to `blobs/<sha256>` |
| Background review fork every 10 turns (§3.6) | Yes (`agent/turn-stopping` hook) | None | Turn counter triggering at `nudgeInterval: 10` |
| Native subagent review execution (§3.6) | Yes (`ReviewForkDispatcher`) | `@deepseek-ai/dsh-subagent` (Core) | Reuses `ctx.subagents.start('spawn')` |
| Review tool allowlist restriction (§3.6) | Yes (`toolFilter` in `SubagentStartRequest`) | `@deepseek-ai/dsh-tools` (Core) | Strict allowlist: `skill`, `read_file`, `fs_search`, `memory` |
| Read-before-write skill governance (§3.6) | Yes (`skill_manage` pre-execution check) | None | Fails closed if `skill` was not viewed in session |
| Human turn preemption (<2.0s interrupt) (§3.6) | Yes (`ReviewForkDispatcher.preempt`) | `@deepseek-ai/dsh-agent` (Core) | Hard abort via `AbortController` and `run.dispose()` |
| Repeated lesson promotion rule (`M-013`) (§3.6) | Yes (`CandidateAxiomPromoter`) | `@deepseek-ai/dsh-axiom` (Plan 03) | Stages candidate JSON and emits event; decouples from axiom plan |
| Unattended memory deletion protection (§3.7.1) | Yes (`UnattendedDeletionGuard`) | `@deepseek-ai/dsh-memory` (Plan 05) | Intercepts delete/replace in review into approval store |
| Negative tool rule & speculation ban (§3.7.2) | Yes (Review system prompts) | None | Explicit prompt rules prohibiting transient error memories |
| Review iteration (16) & token budget (§3.7.3) | Yes (`SubagentStartRequest.agentOptions`) | `@deepseek-ai/dsh-llm` (Core) | Max iterations and output token limits enforced on child |

## 4. Proposed Package / File Layout

```
packages/memory/memory-curator/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                     # Service Provider CuratorRuntime & plugin apply()
│   ├── spec.ts                      # defineDomain spec (curatorDomainSpec) & Zod schemas
│   ├── types.ts                     # SkillState, CuratorLedgerEntry, CandidateAxiomProposal, Config
│   ├── errors.ts                    # CuratorError, ReviewPreemptionError, ReadBeforeWriteError
│   ├── lifecycle.ts                 # Deterministic decay transitions & usage table manager
│   ├── ledger.ts                    # Storage domain ledger table writer & blob snapshots
│   ├── review-fork.ts               # Turn counter, review subagent launcher, & preemption controller
│   ├── prompts.ts                   # Built-in MEMORY_REVIEW_PROMPT & SKILL_REVIEW_PROMPT templates
│   ├── promotion.ts                 # Recurring lesson detector & candidate axiom proposal stager
│   └── approval-staging.ts          # Unattended memory deletion interceptor
└── tests/
    ├── lifecycle-decay.spec.ts      # 30d stale, 90d archive, instant reactivation, zero-deletion invariant
    ├── turn-hook-review.spec.ts     # Turn counting on agent/turn-stopping, trigger at 10 turns
    ├── review-preemption.spec.ts    # User message during review triggers preemption abort within 2.0s
    ├── tool-restriction.spec.ts     # Review child receives strict allowlist (no bash/write_file)
    ├── read-before-write.spec.ts    # Review modifying skill fails closed if skill view was not called
    ├── unattended-deletion.spec.ts  # Memory replace/remove in review staged for human approval
    ├── promotion-rule.spec.ts       # Repeated lesson (>=2 sessions) stages candidate axiom & emits event
    └── domain-ledger.spec.ts        # Storage domain persistence, schema validation, restart recovery
```

## 5. Public Contracts

### 5.1 Domain Types (`packages/memory/memory-curator/src/types.ts`)

```typescript
import type { SessionId } from '@deepseek-ai/dsh-session'

export type SkillLifecycleState = 'active' | 'stale' | 'archived'

export interface SkillUsageRecord {
  readonly name: string
  readonly state: SkillLifecycleState
  readonly useCount: number
  readonly lastUsedAt: string          // ISO 8601 UTC
  readonly lastSessionId: SessionId
  readonly updatedAt: string           // ISO 8601 UTC
}

export type CuratorLedgerAction =
  | 'state-transition'
  | 'skill-archived'
  | 'skill-reactivated'
  | 'consolidation-pass'
  | 'candidate-axiom-promoted'
  | 'memory-deletion-staged'

export interface CuratorLedgerEntry {
  readonly id: string                  // UUID v4
  readonly timestamp: string           // ISO 8601 UTC
  readonly action: CuratorLedgerAction
  readonly skillName?: string
  readonly fromState?: SkillLifecycleState
  readonly toState?: SkillLifecycleState
  readonly details: Readonly<Record<string, unknown>>
  readonly snapshotBlobSha256?: string
}

export interface CandidateAxiomProposal {
  readonly id: string                  // "cand_ax_" + 8 hex chars
  readonly statement: string           // Normative constraint statement
  readonly reason: string              // Why this repeated lesson warrants canonicalization
  readonly occurrences: readonly {
    readonly sessionId: SessionId
    readonly taskId?: string
    readonly timestamp: string
    readonly contextSnippet: string
  }[]
  readonly proposedTargetAgentsMd?: string
  readonly createdAt: string
}
```

### 5.2 Domain Specification (`packages/memory/memory-curator/src/spec.ts`)

```typescript
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CuratorLedgerEntry, SkillUsageRecord } from './types.ts'

export const skillUsageRecordSchema = z.object({
  name: z.string(),
  state: z.enum(['active', 'stale', 'archived']),
  useCount: z.number(),
  lastUsedAt: z.string(),
  lastSessionId: z.string(),
  updatedAt: z.string(),
})

export const curatorLedgerEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: z.enum([
    'state-transition', 'skill-archived', 'skill-reactivated',
    'consolidation-pass', 'candidate-axiom-promoted', 'memory-deletion-staged',
  ]),
  skillName: z.string().optional(),
  fromState: z.enum(['active', 'stale', 'archived']).optional(),
  toState: z.enum(['active', 'stale', 'archived']).optional(),
  details: z.record(z.unknown()),
  snapshotBlobSha256: z.string().optional(),
})

export const CURATOR_DOMAIN_VERSION = 1

export const curatorDomainSpec = defineDomain({
  name: 'curator',
  version: CURATOR_DOMAIN_VERSION,
  tables: {
    ledger: domainTable<string, CuratorLedgerEntry>(curatorLedgerEntrySchema as any),
    usage: domainTable<string, SkillUsageRecord>(skillUsageRecordSchema as any),
  },
})
```

### 5.3 Service Definition & Cordis Augmentation (`packages/memory/memory-curator/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import type {
  SkillLifecycleState,
  SkillUsageRecord,
  CuratorLedgerEntry,
  CandidateAxiomProposal,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryCurator: CuratorRuntime
  }
  interface Events {
    /** Emitted whenever a skill changes lifecycle state (active -> stale -> archived -> active). */
    'curator/transition': (entry: CuratorLedgerEntry) => void
    /** Emitted when a background review fork is spawned. */
    'curator/review-started': (info: { parentSessionId: SessionId; childSessionId: SessionId }) => void
    /** Emitted when a background review fork settles. */
    'curator/review-ended': (info: { parentSessionId: SessionId; childSessionId: SessionId; result: SubagentResult }) => void
    /** Emitted when a recurring lesson is promoted to a candidate axiom proposal. */
    'curator/candidate-axiom-promoted': (proposal: CandidateAxiomProposal) => void
  }
}

export abstract class CuratorRuntime extends Service {
  constructor(ctx: Context) {
    super(ctx, 'memoryCurator', true)
  }

  // Skill Lifecycle Operations (persisted via ctx.storageDomain curator domain)
  abstract recordSkillInvocation(skillName: string, sessionId: SessionId): Promise<void>
  abstract runSkillHousekeeping(options?: { force?: boolean }): Promise<readonly CuratorLedgerEntry[]>
  abstract getSkillState(skillName: string): Promise<SkillUsageRecord | undefined>
  abstract listSkillsByState(state: SkillLifecycleState): Promise<readonly SkillUsageRecord[]>

  // Review & Promotion Operations
  abstract triggerBackgroundReview(parentSessionId: SessionId, options?: { force?: boolean }): Promise<void>
  abstract stageCandidateAxiom(proposal: Omit<CandidateAxiomProposal, 'id' | 'createdAt'>): Promise<CandidateAxiomProposal>
  abstract getLedgerEntries(filter?: { since?: string; action?: CuratorLedgerAction }): Promise<readonly CuratorLedgerEntry[]>
}
```

### 5.4 Configuration Schema (`packages/memory/memory-curator/src/types.ts`)

```typescript
import z from '@deepseek-ai/schemastery'

export interface CuratorConfig {
  /** Inactivity days before an active skill becomes stale (Spec §3.5: 30 days). */
  staleAfterDays: number
  /** Inactivity days before a stale skill is moved to .archive/ (Spec §3.5: 90 days). */
  archiveAfterDays: number
  /** Minimum system idle hours before housekeeping runs (Spec §3.5: 2.0 hours). */
  minIdleHours: number
  /** Minimum hours between housekeeping sweeps (Spec §3.5: 168.0 hours / 7 days). */
  sweepIntervalHours: number
  /** Number of completed foreground turns between review forks (Spec §3.6: 10 turns). */
  nudgeInterval: number
  /** Provider on ctx.subagents used for review child agents (default: 'spawn'). */
  subagentProvider: string
  /** Maximum LLM iterations per review subagent run (Spec §3.6: 16). */
  reviewMaxIterations: number
  /** Input token ceiling for review child agents (Spec §3.6: 600,000). */
  reviewMaxInputTokens: number
  /** Hard preemption deadline in milliseconds when human turn interrupts (Spec §3.6: 2000 ms). */
  preemptionTimeoutMs: number
  /** Root directory for skills (default: '~/.hermes/skills'). */
  skillsDir: string
  /** Root directory for candidate axioms (default: '~/.hermes/candidate-axioms'). */
  candidateAxiomsDir: string
}

export const CuratorConfig: z<CuratorConfig> = z.object({
  staleAfterDays: z.number().default(30),
  archiveAfterDays: z.number().default(90),
  minIdleHours: z.number().default(2.0),
  sweepIntervalHours: z.number().default(168.0),
  nudgeInterval: z.number().default(10),
  subagentProvider: z.string().default('spawn'),
  reviewMaxIterations: z.number().default(16),
  reviewMaxInputTokens: z.number().default(600_000),
  preemptionTimeoutMs: z.number().default(2000),
  skillsDir: z.string().default('~/.hermes/skills'),
  candidateAxiomsDir: z.string().default('~/.hermes/candidate-axioms'),
})
```

## 6. Lifecycle and Scoping

### 6.1 Host Plane Mounting & Service Injection
- **Registration**: Mounted once on the root Context (`ctx.root`) in the host composition (`packages/bundle/base/cordis.patch.yml`).
- **Dependencies (`inject`)**: Declares `inject = ['storageDomain', 'fs', 'skills', 'subagents']` (with optional `'agents'` and `'memory'`).
  - `storageDomain`: Persists `curator` domain (`ledger` and `usage` tables) with in-memory synchronous reads and serialized write-chain durability.
  - `fs`: Handles directory migrations into `.archive/` and content-addressed backup snapshots.
  - `skills`: Resolves available skill metadata and invalidates caches via `skills/change` on state transitions.
  - `subagents`: Launches sandboxed background review agents via `ctx.subagents.start()`.
  - `agents`: Observes active sessions, tracks turn stopping, and handles user message preemption.
- **Domain Lifecycle (`[Service.init]()`)**:
  1. Opens typed domain via `ctx.storageDomain`:
     ```typescript
     const domain = await this.ctx.storageDomain.open(curatorDomainSpec)
     this.ctx.effect(() => () => domain.close(), 'curator.domainClose')
     this.ledgerTable = domain.table('ledger')
     this.usageTable = domain.table('usage')
     ```
  2. Housekeeping reads `this.usageTable.entries()` synchronously from memory without disk blocks.
  3. Writes queue sequentially on the domain write chain, guaranteeing durability before resolving.

### 6.2 Periodic Housekeeping Timer
- `CuratorRuntime` registers a 60-second periodic timer via Cordis effect:
  ```typescript
  ctx.effect(() => {
    const timer = setInterval(() => this.tickHousekeeping(), 60_000)
    return () => clearInterval(timer)
  }, 'memoryCurator.housekeepingTimer')
  ```
- On unload/HMR, the timer is cleared immediately with no leaked intervals or dangling promises.

### 6.3 Anti-Recursion Lineage Guard
To prevent recursive review explosions (a review child triggering another review child every 10 turns):
```typescript
function isReviewAgent(agent: Agent): boolean {
  // Check if agent is an in-process child spawned for curation review
  const parentSession = agent.session.header.parentSession
  if (parentSession !== undefined) return true
  const role = (agent.session.header as Record<string, unknown>).role
  return role === 'curator-review'
}
```
When `agent/turn-stopping` fires, if `isReviewAgent(agent)` evaluates to `true`, the turn counter hook immediately exits with zero side effects.

## 7. Agent Preset Integration

### 7.1 Host Composition (`packages/bundle/base/cordis.patch.yml`)
The host bundle declares storage routing and the curator service provider once globally:

```yaml
'@deepseek-ai/dsh-storage-domain':
  routes:
    curator: sqlite

- id: memory-curator
  name: '@deepseek-ai/dsh-memory-curator'
  config:
    staleAfterDays: 30
    archiveAfterDays: 90
    minIdleHours: 2.0
    sweepIntervalHours: 168.0
    nudgeInterval: 10
    subagentProvider: spawn
    reviewMaxIterations: 16
    reviewMaxInputTokens: 600000
    preemptionTimeoutMs: 2000
```

### 7.2 Preset Visibility & Isolation Rules
Per **PRESET-RULES.md**:
- **Host Ownership (Rule 6)**: `memoryCurator` injects host services (`storageDomain`, `fs`, `subagents`, `skills`) and manages multi-session durable records via `ctx.storageDomain`. It belongs strictly in the host composition.
- **No Realm Required for Event Consumers (Rule 4)**: The `agent/turn-stopping` listener hooks the global dispatch pipeline. It does not publish a new service inside presets; it consumes existing Cordis lifecycle events.
- **Child Preset Isolation**: When `ReviewForkDispatcher` calls `ctx.subagents.start('spawn', request)`, the spawned child agent uses the default in-process isolation provided by `@deepseek-ai/dsh-subagent-spawn-in-process`, receiving a private, fresh session context without parent context leakage.

## 8. Execution Flow

### 8.1 Turn-Stopping Review Trigger Walkthrough

```
[Foreground Agent Turn Completed]
           │
           ▼
[agent/turn-stopping Event Dispatched] (Serial listener)
           │
           ├──> Is child or review subagent? ───► YES ──► (Ignore & Return)
           │
           ▼ NO
[Increment Process-Local Turn Counter] (_turnsSinceReview++)
           │
           ├──> _turnsSinceReview < nudgeInterval (10)? ──► YES ──► (Return)
           │
           ▼ NO (Counter >= 10)
[Reset Turn Counter to 0]
           │
           ▼
[Assemble Review Context]
  - Collect recent conversation summary
  - Format MEMORY_REVIEW_PROMPT & SKILL_REVIEW_PROMPT
  - Configure toolFilter: { allow: ['skill', 'read_file', 'fs_search', 'skill_manage', 'memory'] }
           │
           ▼
[Spawn Detached Child Subagent via ctx.subagents.start('spawn')]
  - SubagentRun created; execution begins in background
  - Active run registered in process-local Map<SessionId, ActiveReviewRun>
           │
           ▼
[Turn Completes Normally in Parent]
```

### 8.2 Live Turn Preemption Walkthrough (<2.0s Deadline)

```
[Parent Agent Receives User Input] (agent/inbox/spliced or agent/pre-step)
           │
           ▼
[Check ActiveReviewRun for Parent Session]
           │
           ├──> None running ──► (Proceed with normal user step)
           │
           ▼ Active Review Found
[Issue Preemption Signal]
  - Trigger abortController.abort('PREEMPTED_BY_USER_TURN')
  - Invoke run.dispose()
  - Start 2,000 ms watchdog timer
           │
           ├──> Child settles cleanly within 2.0s ──► Log preemption & proceed
           │
           ▼ Deadline Exceeded
[Hard Teardown]
  - Force unmount child context
  - Append "review_preempted" event to curator ledger table
  - Release locks & proceed with user turn
```

### 8.3 Long-Term Skill Lifecycle Housekeeping Walkthrough

```
[Housekeeping Timer Ticks]
           │
           ▼
[Inactivity Gate Evaluation]
  - Is host idle for >= minIdleHours (2.0h)? (via agent/status tracking)
  - Has >= sweepIntervalHours (168h / 7d) elapsed since last sweep?
           │
           ├──> NO ──► (Skip sweep, wait for next tick)
           │
           ▼ YES
[Iterate In-Memory Snapshot of usageTable.entries()]
  - Read lastUsedAt from SkillUsageRecord synchronously
  - For each skill:
      │
      ├── Inactivity > 90 days (and state != 'archived'):
      │     Move skill directory to ~/.hermes/skills/.archive/<name>-<YYYYMMDDHHMMSS>/
      │     await usageTable.put(name, { ...record, state: 'archived', updatedAt: now() })
      │     await ledgerTable.put(entry.id, skillArchivedEntry)
      │     Emit 'curator/transition'
      │
      ├── Inactivity > 30 days (and state == 'active'):
      │     await usageTable.put(name, { ...record, state: 'stale', updatedAt: now() })
      │     await ledgerTable.put(entry.id, stateTransitionEntry)
      │     Emit 'curator/transition'
      │
      └── Inactivity <= 30 days:
            Remain 'active'
           │
           ▼
[Emit 'skills/change']
```

### 8.4 Skill Reactivation on Invocation
When any agent invokes a skill via the `skill` tool:
1. `tools/post-execute` captures the successful execution of tool `'skill'`.
2. Reads `this.usageTable.get(skillName)` synchronously from in-memory cache.
3. If the skill's state is `'stale'`:
   - Immediately transitions state back to `'active'`.
   - Increments `useCount`, updates `lastUsedAt = now()`.
   - Queues update on domain write chain: `await this.usageTable.put(skillName, updatedRecord)`.
   - Appends entry: `await this.ledgerTable.put(entry.id, reactivatedEntry)`.
   - Emits `'curator/transition'` and `'skills/change'`.

## 9. Error, Cancellation, and State Architecture

### 9.1 Durable vs Process-Local State Split

| State Item | Storage Medium | Durability | Recovery / Invalidation Behavior |
|---|---|---|---|
| **Curator Ledger** | `ctx.storageDomain` (`curator` domain, `ledger` table) | Durable (Permanent) | Single write-chain durability; loaded into memory on domain open; survives restarts |
| **Skill Usage Records** | `ctx.storageDomain` (`curator` domain, `usage` table) | Durable (Permanent) | Schema-validated KV records; synchronous memory reads; survives restarts |
| **Skill Archives** | `~/.hermes/skills/.archive/<name>-<ts>/` | Durable (Permanent) | Filesystem directory rename; never pruned automatically |
| **Pre-Consolidation Blobs** | `~/.hermes/.curator_backups/blobs/<sha256>` | Durable (Permanent) | Content-addressed tar.gz snapshots taken prior to skill mutations |
| **Candidate Axiom Proposals** | `~/.hermes/candidate-axioms/<id>.json` | Durable (Permanent) | Staged JSON proposals for Brain council and operator review |
| **Turn Counter** | `Map<SessionId, number>` | Process-Local (Ephemeral) | Reset to 0 on session start or review dispatch; lost on restart |
| **Active Review Runs** | `Map<SessionId, ActiveReviewRun>` | Process-Local (Ephemeral) | In-memory `SubagentRun` + `AbortController`; disposed on exit |
| **System Idle Tracker** | `lastActivityTimestamp: number` | Process-Local (Ephemeral) | Updated on every `agent/turn-stopping` and user prompt |
| **Housekeeping Interval** | `NodeJS.Timeout` | Process-Local (Ephemeral) | Managed by Cordis effect disposer; cleared on plugin unload |

### 9.2 Decoupled Candidate Axiom Handoff
Spec §3.6 and Invariant `M-013` require: *"A repeated lesson becomes a candidate axiom."* When a procedural constraint recurs across >= 2 independent sessions, it must be promoted out of soft prose memory into a candidate axiom.

To prevent architectural coupling with `@deepseek-ai/dsh-axiom` (Plan 03):
1. **Zero Direct Import**: `@deepseek-ai/dsh-memory-curator` does NOT import `@deepseek-ai/dsh-axiom` and executes no axiom methods directly.
2. **Staged Proposal Persistence**: The curator writes candidate axioms to disk at `~/.hermes/candidate-axioms/<id>.json` formatted according to `CandidateAxiomProposal`:
   ```json
   {
     "id": "cand_ax_7f3b1a2c",
     "statement": "Forbidden exit-code masking in shell verification (|| true, ; exit 0)",
     "reason": "Repeated verification bypass attempt detected across sessions s_102 and s_205",
     "occurrences": [
       { "sessionId": "s_102", "timestamp": "2026-09-10T14:22:00Z", "contextSnippet": "Attempted 'npm test || true'" },
       { "sessionId": "s_205", "timestamp": "2026-09-11T09:15:00Z", "contextSnippet": "Attempted 'pytest ; exit 0'" }
     ],
     "proposedTargetAgentsMd": "packages/core/agent-loop/AGENTS.md",
     "createdAt": "2026-09-11T09:16:00Z"
   }
   ```
3. **Event Notification**: Emits the public Cordis event `'curator/candidate-axiom-promoted'`.
4. **Handoff Resolution**:
   - The Brain orchestrator (`hermes-brain`) or operator inspects staged candidates using `resolve_candidate_axioms` (Plan 03).
   - If `@deepseek-ai/dsh-axiom` is mounted in the runtime, a lightweight bridge or supervisor can subscribe to `'curator/candidate-axiom-promoted'` and invoke `ctx.axioms.promoteToColocatedAxiom()` without the curator knowing anything about the axiom verifier.

### 9.3 Read-Before-Write Skill Governance
In background review sessions:
- The review subagent is granted `skill_manage` to propose updates to procedural skills.
- The curator enforces a strict **Read-Before-Write Gate**: Any call to mutate `skills/<name>/SKILL.md` verifies that the current review session previously called `skill` (or `skill_view`) for `<name>`.
- If an agent attempts to edit a skill without reading it first, the tool call immediately throws `ReadBeforeWriteError("Skill '<name>' must be inspected with skill({ name }) before modification")`. Blind patching fails closed.

### 9.4 Unattended Memory Deletion Protection
Spec §3.7.1 prohibits unattended memory deletions during autonomous background reviews:
- When a review agent invokes the `memory` tool with `action: 'remove'` or `action: 'replace'`:
- The mutation is **not committed** to `~/.hermes/memories/MEMORY.md` or `USER.md`.
- Instead, the operation is intercepted and staged in `~/.hermes/approvals/pending/<id>.json`.
- A message is logged to the curator ledger: action `'memory-deletion-staged'`.
- The tool returns: `"Action staged for human review. Autonomous deletion prohibited in review fork."`

## 10. Testing Strategy

### 10.1 Unit & Contract Tests (`tests/`)
- **Lifecycle Decay (`lifecycle-decay.spec.ts`)**:
  - Test `active` -> `stale` transition exactly at 30 days + 1 second of inactivity.
  - Test `stale` -> `archived` transition exactly at 90 days + 1 second of inactivity.
  - Test instant `stale` -> `active` reactivation upon simulated `tools/post-execute` invocation.
  - Test the **Skill Preservation Invariant**: Verify that archiving performs a directory move to `.archive/` and never unlinks or deletes the skill directory.
- **Turn Hook & Nudge Interval (`turn-hook-review.spec.ts`)**:
  - Verify that turns 1 through 9 increment `_turnsSinceReview` without triggering subagent launch.
  - Verify that turn 10 triggers `ctx.subagents.start()`, resets the counter to 0, and emits `'curator/review-started'`.
  - Verify that subagent and review sessions do not increment turn counters (anti-recursion test).
- **Review Preemption (`review-preemption.spec.ts`)**:
  - Launch a simulated long-running review subagent.
  - Dispatch a simulated user message into `agent/inbox/spliced`.
  - Assert that `run.dispose()` is called and child completes abortion within 2,000 ms.
- **Tool Allowlist & Sandboxing (`tool-restriction.spec.ts`)**:
  - Assert that `request.toolFilter.allow` strictly equals `['skill', 'read_file', 'fs_search', 'skill_manage', 'memory']`.
  - Verify that execution tools (`tool-bash`, `tool-fs` write operations) are completely masked from the child session.
- **Read-Before-Write Skill Gate (`read-before-write.spec.ts`)**:
  - Test that patching `skills/git-workflow/SKILL.md` fails if `skill({ name: 'git-workflow' })` was not called.
  - Test that patching succeeds if `skill` was previously executed.
- **Candidate Axiom Promotion Rule (`promotion-rule.spec.ts`)**:
  - Feed 1 occurrence of an environment failure: verify it remains in soft review ledger without promotion.
  - Feed a 2nd occurrence of the same pattern from an independent session: verify proposal file is written to `~/.hermes/candidate-axioms/cand_ax_*.json` and `'curator/candidate-axiom-promoted'` is emitted.
- **Storage Domain Persistence & Recovery (`domain-ledger.spec.ts`)**:
  - Test `curator` storage domain opening and table binding (`ledger` and `usage` tables).
  - Verify append operations to `ledger` table and record mutations in `usage` table via `ctx.storageDomain`.
  - Verify process restart restores usage tracking and ledger events without bespoke file locking.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Periodic inactivity housekeeping & scheduler | `/home/sic/Downloads/hermes-agent-main/agent/curator.py:28-70, 140-163` | Inactivity gating algorithm (`min_idle_hours: 2.0`, `interval_hours: 168.0`), state schema (`.curator_state` tracking `last_run_at`, duration, summary), and run scheduling logic. | Replace Python JSON file scheduler with Cordis timer and idle event listener (`agent/status`) on `CuratorRuntime`, persisting scheduler state to `ctx.storageDomain`. | port with adaptation |
| Skill lifecycle state machine & decay transitions | `/home/sic/Downloads/hermes-agent-main/agent/curator.py:191-238`<br>`/home/sic/Downloads/hermes-agent-main/tools/skill_usage.py:40-110` | Deterministic state transition rules: `active` -> `stale` (at 30 days inactivity), `stale` -> `archived` (at 90 days), immediate reactivation (`stale` -> `active` upon invocation), and pinned/protected skill exclusion. | Convert Python `skill_usage` module to TypeScript `SkillLifecycleManager` in `src/lifecycle.ts`, querying and updating `usage` table in `ctx.storageDomain` (`curator` domain). | direct port |
| Skill preservation invariant (zero deletions & archive rotation) | `/home/sic/Downloads/hermes-agent-main/agent/curator.py:176-189, 230-235`<br>`/home/sic/Downloads/hermes-agent-main/tools/skill_usage.py:210-260` | Archiving algorithm: move retired skills to `~/.hermes/skills/.archive/<name>-<YYYYMMDDHHMMSS>/`, never permanently delete. | Convert Python shutil file operations to `ctx.fs.rename` with timestamped archive directory formatting. | direct port |
| Curator audit ledger & pre-consolidation backups | `/home/sic/Downloads/hermes-agent-main/agent/curator_backup.py:40-110`<br>`/home/sic/Downloads/hermes-agent-main/agent/curator.py:35-65` | Pre-consolidation backup snapshot mechanism (`manifest.json` and tarball/blob archive), audit trail recording state transitions, and actor tags (`curator`). | Replace plain `.curator_ledger.jsonl` and `.curator_backups/` tarballs with `ctx.storageDomain` (`curator` domain, table `ledger`) and content-addressed blob storage under `~/.hermes/.curator_backups/blobs/<sha256>`. | port with adaptation |
| Background review fork triggering & turn nudging | `/home/sic/Downloads/hermes-agent-main/agent/background_review.py:70-98, 145-185` | Turn counter triggering background review after every N turns (e.g. `nudgeInterval: 10`), input token budgeting (`_REVIEW_MAX_INPUT_TOKENS_DEFAULT = 600,000`), and maximum iteration limits (`_REVIEW_MAX_ITERATIONS = 16`). | Replace detached OS threads (`threading.Thread`) with Cordis serial event hook on `agent/turn-stopping` dispatching an isolated subagent via `ctx.subagents.start()`. | port with adaptation |
| Immediate human preemption (<2.0s deadline) | `/home/sic/Downloads/hermes-agent-main/agent/background_review.py:23-61, 119-144` | Preemption handshake: `_BACKGROUND_REVIEW_CANCEL_TIMEOUT_SECONDS = 2.0`, interrupt signaling, and non-blocking cancellation handshake when user input arrives. | Convert Python threading Events to TypeScript `AbortController` and `run.dispose()` triggered by `agent/inbox/spliced` listener on parent agent. | direct port |
| Review child agent tool whitelist & sandboxing | `/home/sic/Downloads/hermes-agent-main/agent/background_review.py:957-1045` | Strict tool allowlisting for review fork: only allow `skill`, `read_file`, `fs_search`, `skill_manage`, and `memory` (add only); strip all execution tools (`bash`, `write_file`, `patch`). | Port Python thread-local tool whitelist (`set_thread_tool_whitelist`) to declarative `toolFilter` in `SubagentStartRequest` passed to `ctx.subagents.start()`. | port with adaptation |
| Read-before-write skill governance | `/home/sic/Downloads/hermes-agent-main/tools/skill_manager_guards.py:55-80` | Pre-condition enforcement: before patching or modifying a skill, verify that `skill_view` or `read_file` has inspected the existing skill content in the current session. | Port Python tool guard checks to `ReadBeforeWriteError` inside `skill_manage` pre-execution interceptor. | direct port |
| Unattended deletion protection | `/home/sic/Downloads/hermes-agent-main/tools/memory_tool.py:64-79` | Approval staging interceptor: `_gate_or_stage` staging `replace` or `remove` memory mutations for human review instead of executing immediately during background runs. | Convert Python gate evaluation to Cordis approval interceptor routing review memory deletions into `~/.hermes/approvals/pending/`. | direct port |
| Repeated lesson candidate axiom promotion (`M-013`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:5-15, 234-260` | Cross-session recurrence heuristic: detecting constraints/defects repeating across >= 2 independent sessions, staging candidate axiom proposals, and formatting candidate JSON. | Port Python script heuristics to `CandidateAxiomPromoter` staging proposal to `~/.hermes/candidate-axioms/<id>.json` and emitting `'curator/candidate-axiom-promoted'` event on Cordis. | port with adaptation |

The single most valuable capability to port is the deterministic skill lifecycle decay state machine and archive preservation algorithm (`agent/curator.py:191-238` & `tools/skill_usage.py:40-110, 210-260`). It prevents procedural skill explosion by automatically demoting unreferenced skills based on actual activity timestamps while strictly honoring the zero-deletion invariant by archiving retired skills safely.

## 11. Implementation Steps

### Step 1: Package Foundation, Domain Specification, & Core Contracts
1. Create `packages/memory/memory-curator/` directory tree, `package.json`, `tsconfig.json`, and `README.md`.
2. Define storage domain spec in `src/spec.ts`: `curatorDomainSpec` using `defineDomain` and Zod schemas for `CuratorLedgerEntry` (table `ledger`) and `SkillUsageRecord` (table `usage`).
3. Define domain interfaces in `src/types.ts` (`SkillState`, `SkillUsageRecord`, `CuratorLedgerEntry`, `CandidateAxiomProposal`, `CuratorConfig`).
4. Define abstract service class `CuratorRuntime` in `src/index.ts` and merge Cordis `Context` and `Events` interfaces with `inject = ['storageDomain', 'fs', 'skills', 'subagents']`.

### Step 2: Storage Domain, Lifecycle Decay, and Preservation Invariant
1. Implement `SkillLifecycleManager` in `src/lifecycle.ts`:
   - Interacting with `ctx.storageDomain.table(curatorDomainSpec, 'usage')` for tracking skill usage and last invoked timestamps.
   - Computing elapsed inactivity against `staleAfterDays` (30) and `archiveAfterDays` (90).
   - Moving retired skills into `~/.hermes/skills/.archive/<name>-<YYYYMMDDHHMMSS>/` (Zero-Deletion Invariant).
2. Implement `CuratorLedgerWriter` in `src/ledger.ts`:
   - Appending structured events to `ctx.storageDomain.table(curatorDomainSpec, 'ledger')`.
   - Generating SHA-256 content-addressed backup archives before consolidation sweeps.
   - Dropping bespoke POSIX lockfiles (`.usage.json.lock`) and manual JSONL append/rename logic in favor of `ctx.storageDomain`'s single write-chain serialization and synchronous snapshot reads.

### Step 3: Turn-Stopping Hook & Subagent Review Dispatcher
1. Implement `ReviewForkDispatcher` in `src/review-fork.ts`:
   - Tracking per-agent completed turns via serial event `'agent/turn-stopping'`.
   - Enforcing `nudgeInterval: 10` and anti-recursion lineage check (`isReviewAgent`).
   - Launching child review agent via `ctx.subagents.start('spawn', ...)` with strict `toolFilter`.
   - Registering prompt templates from `src/prompts.ts` (`MEMORY_REVIEW_PROMPT`, `SKILL_REVIEW_PROMPT`).
2. Implement preemption controller in `src/review-fork.ts`:
   - Subscribing to `agent/inbox/spliced` and `agent/pre-step` on the parent agent.
   - Aborting in-flight review subagent via `run.dispose()` within `preemptionTimeoutMs: 2000`.

### Step 4: Governance Gates (Read-Before-Write & Unattended Deletion)
1. Implement `UnattendedDeletionGuard` in `src/approval-staging.ts`:
   - Wrapping memory mutations to stage `remove`/`replace` actions in `~/.hermes/approvals/pending/`.
2. Implement read-before-write tracking for `skill_manage`:
   - Tracking loaded skills in review session state and failing uninspected writes closed.

### Step 5: Candidate Axiom Promotion Engine
1. Implement `CandidateAxiomPromoter` in `src/promotion.ts`:
   - Analyzing review fork outputs for recurring lessons.
   - Counting occurrences across distinct session IDs (threshold >= 2).
   - Staging candidate proposal JSON to `~/.hermes/candidate-axioms/<id>.json`.
   - Emitting `'curator/candidate-axiom-promoted'`.

### Step 6: Service Integration & Host Patch
1. Wire `CuratorRuntime` implementation in `src/index.ts` binding all components.
2. Add `@deepseek-ai/dsh-memory-curator` to `packages/bundle/base/cordis.patch.yml`.
3. Verify test suite across all 8 test files.

## 12. Acceptance Criteria

- [ ] Deterministic decay transitions `active` skills with >30 days inactivity to `stale`, and >90 days to `archived`.
- [ ] Archived skills are moved to `~/.hermes/skills/.archive/<name>-<YYYYMMDDHHMMSS>/`; no skill files are ever deleted.
- [ ] Invoking a `stale` skill immediately restores it to `active` in `ctx.storageDomain` (`curator` domain, `usage` table) and logs the transition to the `ledger` table.
- [ ] Every 10 completed foreground turns on a primary agent triggers a review subagent through `ctx.subagents.start()`.
- [ ] Review child agents execute with strict tool restriction allowlisting only `skill`, `read_file`, `fs_search`, `skill_manage`, and `memory` (add-only). Execution tools (`bash`, `write_file`) are completely blocked.
- [ ] An incoming human message on a parent agent preempts and disposes any running review child within 2.0 seconds.
- [ ] Modifying a skill in a review session without first viewing it fails closed with `ReadBeforeWriteError`.
- [ ] Memory deletion or replacement in review sessions is intercepted and staged for human approval; direct deletion is rejected.
- [ ] When a lesson/defect recurs across >= 2 independent sessions, a candidate axiom document is staged to `~/.hermes/candidate-axioms/<id>.json` and `'curator/candidate-axiom-promoted'` is emitted on Cordis without tight coupling to the axiom package.
- [ ] All lifecycle mutations append structured records to `ctx.storageDomain` (`curator` domain, `ledger` table).
- [ ] Review child agents never spawn nested review subagents (zero infinite recursion).
- [ ] Test suite achieves 100% pass rate across unit, lifecycle, hook, preemption, and persistence specs.

## Review fixes applied

- **REVIEW-seams Finding 2 (Duplicate Session Search Package)**: Updated reference from deprecated `@deepseek-ai/dsh-tool-session-search` to existing `@deepseek-ai/dsh-tool-session-query` (Plan 05).
- **REVIEW-storage finding (Curator Ledger and Usage Store Storage Domain Reuse)**:
  - Evaluated repository `ctx.storageDomain` capability vs bespoke JSON/JSONL store under `~/.hermes/skills/`.
  - Stated explicitly: the file paths `~/.hermes/skills/.curator_ledger.jsonl` and `~/.hermes/skills/.usage.json` were artifacts of the ported Python Hermes specification, with no genuine external readers outside the Harness runtime. All consumers access curator telemetry and skill usage through `CuratorRuntime`.
  - Selected **Option (a) — `ctx.storageDomain`** (`curator` domain, version 1, tables `ledger` and `usage`).
  - Reason: The curator ledger is append-only audit telemetry and skill usage is a keyed dictionary of usage timestamps. Neither requires relational joins, foreign keys, multi-process busy-retry policies, or cross-table transactions. `ctx.storageDomain`'s single write-chain serialization, synchronous in-memory read snapshots, and built-in Zod schema validation completely eliminate bespoke POSIX lockfile dances (`.usage.json.lock`), `.tmp` atomic renames, and corrupted JSONL recovery code.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`agent/curator.py`, `tools/skill_usage.py`, `agent/curator_backup.py`, `agent/background_review.py`, `tools/skill_manager_guards.py`, and `tools/memory_tool.py`) to accelerate curator implementation.
