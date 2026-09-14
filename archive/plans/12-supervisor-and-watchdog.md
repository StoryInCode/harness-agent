# 12 — Autonomous Supervisor Daemon, Watchdogs, & Quota Wall

## Features

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

## 1. Purpose

`@deepseek-ai/dsh-supervisor` provides the authoritative, host-plane supervision daemon and event-hook engine for autonomous engineering execution in StoryInCode (`Spec §5.8`, `§5.9`, `§5.10`, `§5.11`). It guarantees autonomous operational hygiene across long-running unattended agent pools without human micromanagement.

- **What it owns**:
  - The `supervisor` capability seam (`SupervisorService` class in `@deepseek-ai/dsh-supervisor` extending `@deepseek-ai/cordis.Service`).
  - Active worker monitoring (`Spec §5.8`): tracking process heartbeats, runtime duration, and comment progression for all in-flight worker tasks (`tasks.status == 'running'`).
  - Automated worker intervention ladder (`Spec §5.9`): detecting hung, dead, or silent workers and executing deterministic recovery actions (audit warnings, stale claim releases, and OS process tree kills via `process.kill()` and subagent handle disposal via `run.dispose()`).
  - Circuit breaker enforcement (`Spec §5.9`, Review finding 3): tracking durable consecutive task failures and errors in `ctx.storageDomain` (`supervisor` domain, `circuit_breakers` table) and tripping cards into `blocked` (`kind: 'capability'`) when retry limits are reached, preventing infinite crash loops across daemon reboots and infinite burn of LLM tokens and API budgets.
  - Automated Brain re-planning dispatch (`Spec §5.9`): delegating re-planning requests to `ctx.subagents` (`hermes-brain` preset or `agy` CLI provider) to generate revised checklists targeting unsatisfied axioms.
  - Quota wall coordination (`Spec §5.9`): intercepting HTTP 429 and rate-limit errors on the `agent/request-error` waterfall, enforcing provider cooldown periods, and requeuing cards to `ready` without penalizing task retry budgets.
    - Post-completion result review gates (`Spec §5.10`): evaluating completed cards (`status == 'done'`) against task axiom proofs via `ctx.axiomVerifier` (defense-in-depth after pre-completion interception via `'kanban/pre-complete': (task: Task) => Promise<void> | void`, `plans/01-kanban-substrate.md`), asserting worktree cleanliness via `ctx.worktrees`, creating child follow-up cards for unticked checklist items, and opening defect cards for unaddressed bug reports.
  - Automated integration dispatch (`Spec §5.10`): calling `ctx.integrator.integrateCard()` for verified clean cards.
  - Milestone todo closure verification (`Spec §5.11`): verifying against `ctx.ledger` that all governing axioms of founder milestone outcomes are witnessed by landed merge commit SHAs.
  - Real-time telemetry logging (`Spec §5.8`): writing structured JSONL metrics to `~/.hermes/board-metrics/samples.jsonl`.

- **What it deliberately does NOT own**:
  - Kanban database schema, disk storage, or atomic claim leasing (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01). Supervisor operates strictly as a consumer of `ctx.kanban`.
  - Model-facing tool presentation: LLMs do NOT call `ctx.supervisor` as a tool. The supervisor is an internal host-plane daemon with zero model-visible tool registrations.
  - Worktree directory allocation, base commit pinning, or git cherry patch-equivalence (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Test execution inside worker turns, implementer test pinning guards, or turn stop gates (owned by `@deepseek-ai/dsh-verification`, Plan 09).
  - Git non-fast-forward merge execution or GitHub PR synchronization (owned by `@deepseek-ai/dsh-integrator`, Plan 10).
  - Outcome document markdown storage, bindings persistence, or founder outcome tools (owned by `@deepseek-ai/dsh-ledger`, prerequisite Plan 13 implemented prior to Plan 12).
  - Host RAM headroom admission or cgroup accounting (owned by `@deepseek-ai/dsh-guard-resource`, Plan 08).
  - Worker process execution engines: actual child execution is handled by `@deepseek-ai/dsh-subprocess` and `@deepseek-ai/dsh-subagent` (Plan 11).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-supervisor`: **Service Definition, Service Provider, and Host-Plane Event-Hook Consumer**.
  - Subclasses `Service` from `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:7-8`), registering `ctx.supervisor` as a singleton in the root Cordis host context.
  - Default export of the `SupervisorService` class per the Harness service convention (`packages/AGENTS.md:5`).
  - Injects required core and sibling host infrastructure: `['storageDomain', 'kanban', 'subprocess', 'subagents']`.
  - Dynamically resolves optional host capabilities via `ctx.get()` per `packages/AGENTS.md:6`: `['worktrees', 'integrator', 'axioms', 'axiomVerifier', 'ledger']`.
  - *Prerequisite Plan Order*: Plan 13 (`plans/13-outcome-ledger.md`) is implemented *prior* to Plan 12 to provide `OutcomeLedger` (`ctx.ledger`), resolving the implementation-order inversion for milestone closure validation.

### 2.2 Proof of Event-Hook / Host-Plane Consumer vs Monolithic Orchestrator
A common architectural antipattern in multi-agent systems is the monolithic orchestrator: an all-powerful god service that directly executes shell commands, writes raw SQL to databases, invokes model APIs out-of-band, and tightly couples worker scheduling to process supervision.

`@deepseek-ai/dsh-supervisor` is **strictly an event-hook consumer and host-plane daemon**, proved by five architectural invariants:
1. *Zero Backdoor Database Access*: The supervisor maintains no direct SQLite file handle or raw SQL statements. Every board query and state transition passes through the strongly typed `KanbanStore` capability contract (`ctx.kanban`, `plans/01-kanban-substrate.md:254-296`).
2. *Reactive Event Ingestion*: Rather than polling the entire world in heavy blocking loops, the supervisor subscribes to published Cordis domain events:
   - `kanban/task-status` (`plans/01-kanban-substrate.md:241`): arms and disarms per-worker watchdog timers and triggers post-completion review.
   - `kanban/heartbeat-tick` (`plans/01-kanban-substrate.md:248`): updates in-memory watchdog timestamps.
   - `agent/request-error` (`packages/core/agent/src/runtime-types.ts:363`): detects HTTP 429 quota exhaustion in the open step waterfall.
   - `subagent/end` (`packages/subagent/subagent/src/types.ts:100`): evaluates worker outcome and records failure streaks.
   - `integrator/merged` (`plans/10-integration-and-pr-engine.md:291`): triggers milestone todo closure checks upon landed commit SHAs.
3. *Action strictly through Published Sibling Services*:
   - Process termination: `process.kill(pid, signal)` for OS worker processes and `SubprocessHandle.terminate()` / `SubagentRun.dispose()` for managed child handles (`packages/subprocess/subprocess/src/types.ts:183-192`, `packages/subagent/subagent/src/types.ts:333`).
   - Worktree state inspection: `ctx.worktrees.classify(path)` (`plans/07-worktree-management.md:281`).
   - Axiom proof verification: `ctx.axiomVerifier.verifyTask(taskId)` (`plans/04-axiom-verification-sweeper.md:252`).
   - Automated merge integration: `ctx.integrator.integrateCard({ taskId })` (`plans/10-integration-and-pr-engine.md:263`).
   - Brain re-planning: `ctx.subagents.start('spawn', ...)` or `ctx.subagents.start('agy', ...)` (`packages/subagent/subagent/src/index.ts:509-525`).
   - Milestone closure: `ctx.ledger.checkMilestoneAxioms(taskId)` (`plans/13-outcome-ledger.md`, prerequisite Plan 13 implemented prior to Plan 12).
 4. *Zero Model Tool Pollution*: Exposes zero model-facing tools (`ctx.tools.register` is never invoked). LLMs cannot tamper with supervisory logic, manipulate watchdog timers, or bypass the circuit breaker.
 5. *Pure Host-Plane Scoping*: Mounted in the root container (`base.cordis.yml` patch layer). Preserves total isolation from ephemeral agent preset sessions (`PRESET-RULES.md:5, 12`).

### 2.3 Why this Primitive and not the Neighbours
- **Why NOT a Guard (`packages/guard/*`)**:
  Guards (`timeout-policy`, `repeat-tool-reminder`) intercept tool executions (`tools/execute`, `tools/post-execute`) or turn boundaries (`agent/pre-step`). When a worker process hangs in an infinite bash loop, pauses on a blocked socket, or deadlocks on a native binary, zero tool calls occur and `agent/pre-step` never fires. Guards are completely deaf and blind to background time elapsed without tool calls (`plans/00-architecture-mapping.md:417-418`).
- **Why NOT a Goal Service (`packages/goal/*`)**:
  `GoalService` is an in-session projection unit (`SessionProjectionStateMap['goal']`) focused on single-agent conversational convergence. It has zero cross-worker visibility, cannot manage OS PIDs, and terminates with its session (`plans/00-architecture-mapping.md:419-420`).
- **Why NOT a Workflow Capability (`packages/workflow/*`)**:
  Workflows run transient execution graphs inside worker threads for single tasks. Supervision must remain ambient and continuously active across days of pool execution (`plans/00-architecture-mapping.md:421-422`).
- **Why NOT an LLM Subagent Consumer (LLM Supervisor)**:
  Spinning up continuous LLM subagents to poll timestamps burns tens of thousands of tokens per hour on trivial subtraction (`now - last_heartbeat > 600`), introduces nondeterministic latency jitter, and risks hallucinations during OS process signal delivery (`plans/00-architecture-mapping.md:423-424`).
- **Why NOT a Session Projection (`sessionProjections`)**:
  Session projections are strictly pure, side-effect-free fold functions over immutable session events. They are architecturally forbidden from performing filesystem I/O, spawning processes, killing PIDs, or acquiring SQLite transactional write locks (`plans/00-architecture-mapping.md:425-426`).

### 2.4 Storage-Reuse Evaluation & Circuit-Breaker Durability (Review Finding 3)

Review finding 3 identified that maintaining task retry counters and failure histories exclusively in-memory (`activeWatchdogs: Map<TaskId, ActiveWorkerWatchdog>`) caused state loss whenever the supervisor daemon restarted (host crash, systemd unit cycling, or Cordis HMR reload). Consequently, a poisoned task that repeatedly crashed the worker or host process reset its failure count to 0 on reboot, causing an infinite crash-and-restart loop that bypassed the circuit breaker.

We evaluated three architectural options for durable circuit-breaker state:
1. **Option (a) — `ctx.storageDomain` (`packages/storage`)**:
   - Declare domain `supervisor` (version 1) with table `circuit_breakers` storing `CircuitBreakerRecord` (`taskId`, `consecutiveFailures`, `lastFailureAt`, `lastError`, `trippedAt`).
   - Fit analysis: Circuit-breaker records are small, schema-validated documents keyed 1:1 by `taskId`. The supervisor is a host singleton, so writes require only single-process durability without cross-process locking. Reads are synchronous in-memory snapshots (`get(taskId)`), which is essential because the 30-second watchdog sweep assesses dozens of tasks without incurring asynchronous disk I/O overhead. Single-domain write chains provide atomic persistence across crashes.
   - Capability limits analysis: Does circuit-breaker state require cross-table transactions (`packages/storage/storage-domain/README.md:152`)? No, updates affect only a single task's circuit-breaker record. Does it require multi-facet access or relational joins (`packages/storage/storage/README.md:131`)? No, simple KV point lookups by `taskId` suffice. Does it require cross-process lock contention retry (`packages/storage/storage-sqlite/README.md:130`)? No, the supervisor host service is a singleton daemon.
2. **Option (b) — Bespoke SQLite database (`~/.hermes/supervisor.db`)**:
   - Would introduce redundant SQLite connection management, bespoke migration scripts, and schema version pragmas for a single table with trivial key-value semantics. Rejected per repository guidance against bespoke storage when `ctx.storageDomain` satisfies all functional requirements.
3. **Option (c) — Piggybacking exclusively on `tasks.retry_count` in Kanban SQLite substrate**:
   - While `tasks.retry_count` tracks raw retry attempts on the Kanban card, the supervisor requires richer circuit-breaker telemetry: timestamp of the last failure, error message / crash reason, and tripped timestamp for cooldown evaluation. Furthermore, coupling supervisory circuit-breaker policy to Kanban card schema limits autonomous supervisor evolution.

**Decision: Option (a) — `ctx.storageDomain` (`supervisor` domain, `circuit_breakers` table)**.
This makes retry and failure tracking durable across daemon restarts and HMR reloads while leveraging the repository's standard storage domain abstraction.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Worker monitoring & telemetry (§5.8) | Yes (`WatchdogManager`) | None | Background timer and JSONL metrics recorder |
| Stale claim detection (§5.9) | Yes (`EscalationLadder`) | `@deepseek-ai/dsh-kanban` (Plan 01) | Evaluates heartbeat age; calls `ctx.kanban.releaseClaim` |
| Silent worker warning (§5.9) | Yes (`EscalationLadder`) | `@deepseek-ai/dsh-kanban` (Plan 01) | Evaluates running duration and comment count; posts audit warning |
| Worker runtime limit kill (§5.9) | Yes (`EscalationLadder`) | `@deepseek-ai/dsh-subprocess` (Core) | Evaluates wall-clock time; executes SIGTERM -> SIGKILL cascade |
| Circuit breaker trip (§5.9) | Yes (`EscalationLadder`) | `@deepseek-ai/dsh-kanban` (Plan 01), `@deepseek-ai/dsh-storage-domain` | Persists failure count and error in `ctx.storageDomain`; transitions card to `blocked` |
| Brain re-planning dispatch (§5.9) | Yes (`EscalationLadder`) | `@deepseek-ai/dsh-subagent` (Plan 11) | Dispatches re-planning subagent via `ctx.subagents` |
| Quota wall cooldown & requeue (§5.9) | Yes (`QuotaWallCoordinator`) | `@deepseek-ai/dsh-kanban` (Plan 01) | Intercepts HTTP 429 on `agent/request-error`; pauses dispatch |
| Axiom proof review gate (§5.10) | Yes (`ResultReviewGate`) | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | Defense-in-depth review; pre-completion gate is enforced via `'kanban/pre-complete': (task: Task) => Promise<void> \| void` (Plan 01/04) |
| Dirty worktree review gate (§5.10) | Yes (`ResultReviewGate`) | `@deepseek-ai/dsh-worktree` (Plan 07) | Checks `ctx.worktrees.classify`; blocks cards on dirty git tree |
| Unticked checklist follow-up (§5.10) | Yes (`ResultReviewGate`) | `@deepseek-ai/dsh-kanban` (Plan 01) | Auto-extracts unticked items; creates child card via `ctx.kanban` |
| Uncovered reported defect card (§5.10) | Yes (`ResultReviewGate`) | `@deepseek-ai/dsh-kanban` (Plan 01) | Auto-extracts defect comments; creates child defect card |
| Automated merge integration (§5.10) | Yes (`ResultReviewGate`) | `@deepseek-ai/dsh-integrator` (Plan 10) | Invokes `ctx.integrator.integrateCard` for clean passing cards |
| Milestone todo closure check (§5.11) | Yes (`MilestoneClosureValidator`) | `@deepseek-ai/dsh-ledger` (Plan 13, prerequisite) | Evaluates axiom witnesses upon `integrator/merged` event; Plan 13 implemented prior to Plan 12 |

## 4. Proposed Package / File Layout

```
packages/supervision/
└── supervisor/                               # @deepseek-ai/dsh-supervisor (Service Provider & Host Daemon)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts                          # SupervisorService class, Cordis export, event hooks
    │   ├── spec.ts                           # Storage domain specification (supervisorDomainSpec, CircuitBreakerRecord)
    │   ├── types.ts                          # Configuration, watchdog state, audit warnings, review types
    │   ├── config.ts                         # Schemastery schema for SupervisorConfig
    │   ├── watchdog.ts                       # WatchdogManager: in-memory heartbeat & stall tracker
    │   ├── escalation.ts                     # EscalationLadder: explicit conditional intervention state machine
    │   ├── quota-wall.ts                     # QuotaWallCoordinator: HTTP 429 detection & cooldown timer
    │   ├── review-gate.ts                    # ResultReviewGate: post-completion gates & card generation
    │   ├── milestone-closure.ts              # MilestoneClosureValidator: §5.11 founder outcome verification
    │   └── telemetry.ts                      # TelemetryWriter: ~/.hermes/board-metrics/samples.jsonl recorder
    └── tests/
        ├── memory-double.ts                  # In-memory test doubles for Kanban, Subprocess, Subagents, Storage
        ├── watchdog.spec.ts                  # Unit: heartbeat expiry, silent worker warnings, runtime kill cascade
        ├── escalation.spec.ts                # Unit: intervention ladder conditionals and threshold tests
        ├── circuit-breaker.spec.ts           # Unit: domain persistence, consecutive failure counts, Brain re-planning dispatch
        ├── quota-wall.spec.ts                # Unit: HTTP 429 intercept, cooldown timer, card requeue without retry burn
        ├── review-gate.spec.ts               # Unit: axiom proof gate, dirty worktree check, unticked checklist extraction
        ├── defect-extraction.spec.ts         # Unit: defect regex matching, idempotency, child card creation
        ├── milestone-closure.spec.ts         # Unit: §5.11 axiom witness verification and ledger promotion
        └── composition.spec.ts               # Integration: real Cordis container boot, lifecycle, and HMR disposal
```

## 5. Public Contracts

### 5.1 Configuration Schema with Explicit Tunables (`packages/supervision/supervisor/src/config.ts`)
In strict adherence to the repo convention ("no hardcoded tunables, misconfiguration fails loud", `packages/AGENTS.md:12, 16`), every timeout, interval, and threshold is a validated Schemastery field:

```typescript
import z from '@deepseek-ai/schemastery'

export interface SupervisorConfig {
  /** Periodic background watchdog sweep interval in milliseconds. Default: 30,000 (30s). */
  sweepIntervalMs?: number
  /** Stale heartbeat duration in seconds before worker claim is reclaimed. Default: 600 (10m). */
  staleHeartbeatSeconds?: number
  /** Silent running duration in seconds with zero comments before warning. Default: 480 (8m). */
  silentWorkerSeconds?: number
  /** Maximum wall-clock runtime in seconds before worker process is terminated. Default: 2,400 (40m). */
  maxRuntimeSeconds?: number
  /** Grace period in milliseconds between SIGTERM and SIGKILL during process kill. Default: 30,000 (30s). */
  sigkillGraceMs?: number
  /** Maximum consecutive failures before circuit breaker trips card to blocked. Default: 2. */
  maxRetries?: number
  /** Quota wall rate limit cooldown in seconds following an HTTP 429 error. Default: 300 (5m). */
  rateLimitCooldownSeconds?: number
  /** Quiet period in seconds before uncommitted skill findings in repo checkout are committed. Default: 300 (5m). */
  workerFindingQuietSeconds?: number
  /** Maximum code review repair cycles before card escalates to human triage. Default: 2. */
  maxRepairCycles?: number
  /** Whether completing a card in result review automatically invokes ctx.integrator. Default: true. */
  autoMergeOnDone?: boolean
  /** Subagent provider for Brain re-planning. Default: 'spawn'. Fallback: 'agy'. */
  replanSubagentProvider?: string
  /** Subagent provider for independent code review. Default: 'spawn'. */
  reviewSubagentProvider?: string
  /** Maximum execution duration in ms for Brain re-planning subagent. Default: 300,000 (5m). */
  replanTimeoutMs?: number
  /** Maximum execution duration in ms for code review subagent. Default: 300,000 (5m). */
  reviewTimeoutMs?: number
  /** Absolute path to board telemetry samples file. Default: ~/.hermes/board-metrics/samples.jsonl. */
  metricsFilePath?: string
}

export const SupervisorConfig: z<SupervisorConfig> = z.object({
  sweepIntervalMs: z.number().default(30_000),
  staleHeartbeatSeconds: z.number().default(600),
  silentWorkerSeconds: z.number().default(480),
  maxRuntimeSeconds: z.number().default(2_400),
  sigkillGraceMs: z.number().default(30_000),
  maxRetries: z.number().default(2),
  rateLimitCooldownSeconds: z.number().default(300),
  workerFindingQuietSeconds: z.number().default(300),
  maxRepairCycles: z.number().default(2),
  autoMergeOnDone: z.boolean().default(true),
  replanSubagentProvider: z.string().default('spawn'),
  reviewSubagentProvider: z.string().default('spawn'),
  replanTimeoutMs: z.number().default(300_000),
  reviewTimeoutMs: z.number().default(300_000),
  metricsFilePath: z.string().default('~/.hermes/board-metrics/samples.jsonl'),
})
```

### 5.2 Storage Domain Specification (`packages/supervision/supervisor/src/spec.ts`)

Per Review finding 3 and the storage-reuse evaluation (§2.4), durable circuit-breaker retry state is declared as a `storageDomain` specification:

```typescript
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

export const SUPERVISOR_DOMAIN_VERSION = 1

export const CircuitBreakerRecordSchema = z.object({
  taskId: z.string(),
  consecutiveFailures: z.number().int().nonnegative(),
  lastFailureAt: z.number().int().positive(),
  lastError: z.string().optional(),
  trippedAt: z.number().int().positive().optional(),
})
export type CircuitBreakerRecord = z.infer<typeof CircuitBreakerRecordSchema>

export const supervisorDomainSpec = defineDomain({
  name: 'supervisor',
  version: SUPERVISOR_DOMAIN_VERSION,
  tables: {
    circuit_breakers: domainTable(CircuitBreakerRecordSchema),
  },
})
```

### 5.3 Public Types & Intervention Ladder Data Shapes (`packages/supervision/supervisor/src/types.ts`)

```typescript
import type { TaskId, TaskRunId, Task } from '@deepseek-ai/dsh-kanban'
import type { CircuitBreakerRecord } from './spec.ts'

export type { CircuitBreakerRecord }

export type InterventionKind =
  | 'stale_heartbeat_reclaim'
  | 'silent_worker_warning'
  | 'runtime_limit_killed'
  | 'circuit_breaker_tripped'
  | 'quota_wall_requeue'
  | 'unproven_done_blocked'
  | 'dirty_worktree_blocked'
  | 'followup_todos_opened'
  | 'defect_card_opened'
  | 'integration_dispatched'

export interface ActiveWorkerWatchdog {
  readonly taskId: TaskId
  readonly runId: TaskRunId | null
  readonly workerPid: number | null
  readonly startedAtMs: number
  lastHeartbeatAtMs: number
  commentCount: number
  warnedSilent: boolean
}

export interface InterventionRecord {
  readonly taskId: TaskId
  readonly kind: InterventionKind
  readonly timestamp: number
  readonly detail: string
  readonly applied: boolean
}

export interface AuditWarning {
  readonly taskId: TaskId
  readonly code: string
  readonly message: string
  readonly timestamp: number
}

export interface ReviewVerdict {
  readonly taskId: TaskId
  readonly approved: boolean
  readonly unprovenAxioms: readonly string[]
  readonly isWorktreeDirty: boolean
  readonly untickedChecklistCount: number
  readonly followUpTaskId?: TaskId
  readonly defectTaskId?: TaskId
  readonly integrated: boolean
  readonly reason?: string
}

export interface QuotaWallState {
  readonly active: boolean
  readonly provider: string
  readonly cooldownUntilMs: number
  readonly affectedTaskIds: readonly TaskId[]
}

export interface TelemetrySample {
  readonly timestamp: number
  readonly activeRunningWorkers: number
  readonly totalTasksByStatus: Record<string, number>
  readonly quotaWallActive: boolean
  readonly memoryHeadroomMb?: number
}
```

### 5.4 Service Definition & Cordis Events (`packages/supervision/supervisor/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type { TaskId, Task } from '@deepseek-ai/dsh-kanban'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import { SupervisorConfig } from './config.ts'
import { supervisorDomainSpec, type CircuitBreakerRecord } from './spec.ts'
import type {
  ActiveWorkerWatchdog,
  AuditWarning,
  InterventionRecord,
  QuotaWallState,
  ReviewVerdict,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    supervisor: SupervisorService
  }
  interface Events {
    'supervisor/intervened': (record: InterventionRecord) => void
    'supervisor/audit-warning': (warning: AuditWarning) => void
    'supervisor/replan-requested': (taskId: TaskId, reason: string, prompt: string) => void
    'supervisor/quota-cooldown-started': (provider: string, cooldownSeconds: number) => void
    'supervisor/quota-cooldown-ended': (provider: string) => void
    'supervisor/review-completed': (verdict: ReviewVerdict) => void
    'kanban/claim-stale': (taskId: TaskId, ageSeconds: number, pid: number | null) => void
  }
}

export abstract class SupervisorService extends Service {
  static readonly inject = ['storageDomain', 'kanban', 'subprocess', 'subagents']
  static readonly Config = SupervisorConfig

  constructor(ctx: Context, public readonly config: SupervisorConfig) {
    super(ctx, 'supervisor', true)
  }

  /** Force an immediate supervisory assessment pass over all active tasks. */
  abstract assess(options?: { apply?: boolean }): Promise<{
    actions: readonly InterventionRecord[]
    warnings: readonly AuditWarning[]
  }>

  /** Check if the quota wall is currently active for any model provider. */
  abstract getQuotaWallState(provider?: string): QuotaWallState

  /** Inspect live in-memory watchdog tracking status for an active worker task. */
  abstract getWatchdog(taskId: TaskId): ActiveWorkerWatchdog | undefined

  /** Retrieve durable circuit-breaker failure record for a task. */
  abstract getCircuitBreaker(taskId: TaskId): CircuitBreakerRecord | undefined

  /** Reset or clear durable circuit-breaker record for a task. */
  abstract resetCircuitBreaker(taskId: TaskId): Promise<void>

  /** Trigger an on-demand result review pass for a task marked done. */
  abstract reviewCompletedTask(taskId: TaskId): Promise<ReviewVerdict>

  /** Verify milestone outcome todo closure (§5.11) following a landed merge commit. */
  abstract verifyMilestoneClosure(taskId: TaskId): Promise<boolean>
}

export default SupervisorService
```

## 6. Lifecycle and Scoping

### 6.1 Subservice Injection & Root Registration
`@deepseek-ai/dsh-supervisor` declares:
```typescript
static readonly inject = ['storageDomain', 'kanban', 'subprocess', 'subagents']
```
When mounted in the root Cordis container via `cordis.patch.yml`:
1. `ctx.storageDomain` (`StorageDomainService`, `packages/storage/storage-domain`): provides domain lifecycle, schema enforcement, synchronous in-memory read snapshots, and atomic write serialization for `circuit_breakers` records across daemon crashes and reboots.
2. `ctx.kanban` (`KanbanStore`, `plans/01-kanban-substrate.md:254`): provides transactional task querying, claims management, state transitions, and audit comments.
3. `ctx.subprocess` (`SubprocessRuntime`, `packages/subprocess/subprocess/src/index.ts:115`): provides discrete process inspection and signal termination (`ctx.subprocess.kill()`).
4. `ctx.subagents` (`SubagentRuntime`, `packages/subagent/subagent/src/index.ts:509`): provides autonomous subagent dispatch for Brain re-planning and independent review.
5. Optional sibling services are resolved strictly via `ctx.get()` per `packages/AGENTS.md:6`:
   - `ctx.get('worktrees')`: `WorktreeManager` (`plans/07-worktree-management.md:264`) for worktree status classification.
   - `ctx.get('integrator')`: `IntegratorService` (`plans/10-integration-and-pr-engine.md:250`) for automated card merging.
   - `ctx.get('axiomVerifier')`: `AxiomVerifier` (`plans/04-axiom-verification-sweeper.md:250`) for `M-009` axiom proof validation (enforced on `'kanban/pre-complete': (task: Task) => Promise<void> | void`, `plans/01-kanban-substrate.md` §5.2).
   - `ctx.get('ledger')`: `OutcomeLedger` (`plans/13-outcome-ledger.md`, prerequisite implemented prior to Plan 12) for §5.11 milestone outcome verification.

### 6.2 Service Lifecycle & Resource Disposal
In accordance with Harness lifecycle rules (`packages/AGENTS.md:17`, `docs/cordis-primer.md:45`):
- The supervisor registers its background timer and event listeners inside a Cordis `ctx.effect()`:
  ```typescript
  ctx.effect(() => {
    const timer = setInterval(() => this.runSweep(), this.config.sweepIntervalMs)
    return () => {
      clearInterval(timer)
      this.activeWatchdogs.clear()
      this.clearQuotaCooldowns()
    }
  })
  ```
- All event listeners on `kanban/task-status`, `kanban/heartbeat-tick`, `agent/request-error`, `subagent/end`, and `integrator/merged` register within the effect scope.
- When Cordis unloads the plugin or performs Hot Module Replacement (HMR), the interval timer is synchronously cleared, active watchdog timers are disarmed, and quota cooldown timers are purged. No leaked intervals or unquiesced background loops remain.

### 6.3 Host Plane Scope vs Agent Visibility
- **Global Host Singleton**: Mounted strictly in the root Cordis host plane. There is exactly one `ctx.supervisor` instance per Harness host daemon.
- **Agent Preset Isolation**: The supervisor adds **zero rows** to agent presets (`hermes-brain` or `hermes-worker`). It registers no model tools, modifies no prompt contexts, and intercepts no agent turns.

## 7. Agent Preset Integration

Per **PRESET-RULES.md** Rules 1, 2, 4, 6, and 8 (`PRESET-RULES.md:5-14`), agent presets are agent-plane compositions scoped to individual agent sessions.
- `@deepseek-ai/dsh-supervisor` is a **pure host-plane daemon**:
  - It runs ambiently across all worker tasks and sessions.
  - It injects host infrastructure (`subprocess`, `kanban`, `subagents`) before any session exists.
  - It maintains zero session state.
- **Exact Preset Rows**: **ZERO (0)** rows in `hermes-brain/agent.cordis.yml` and `hermes-worker/agent.cordis.yml`.
- Mounted exclusively in the host composition patch layer:
  ```yaml
  # packages/bundle/hermes-base/cordis.patch.yml
  - id: supervisor
    name: '@deepseek-ai/dsh-supervisor'
    config:
      sweepIntervalMs: 30000
      staleHeartbeatSeconds: 600
      silentWorkerSeconds: 480
      maxRuntimeSeconds: 2400
      maxRetries: 2
      rateLimitCooldownSeconds: 300
      autoMergeOnDone: true
  ```

## 8. Execution Flow

The runtime execution flow spans three major lifecycle phases: active worker surveillance, intervention escalation, and post-completion result review.

```text
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           1. ACTIVE WORKER SURVEILLANCE                          │
│                                                                                 │
│  kanban/task-status (running) ──► Arm Watchdog Entry (PID, startedAt, hbAt)     │
│  kanban/heartbeat-tick        ──► Update lastHeartbeatAtMs                      │
│  kanban/comment-posted        ──► Increment commentCount                        │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Periodic Sweep (every 30s)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      2. EXPLICIT INTERVENTION LADDER                            │
│                                                                                 │
│  [Level 1: Silent Worker]      runningFor > 480s && comments == 0               │
│                                └──► ctx.kanban.addComment() + audit-warning     │
│                                                                                 │
│  [Level 2: Stale Heartbeat]    now - lastHeartbeatAt > 600s                     │
│                                └──► ctx.subprocess.kill(0) liveness check      │
│                                └──► ctx.kanban.releaseClaim() + claim-stale     │
│                                                                                 │
│  [Level 3: Runtime Exceeded]   now - startedAt > 2400s (40m)                    │
│                                └──► SIGTERM ──(30s grace)──► SIGKILL            │
│                                └──► ctx.kanban.transitionTask('blocked')        │
│                                                                                 │
│  [Level 4: Quota Wall 429]     agent/request-error (HTTP 429)                   │
│                                └──► Cooldown 300s, requeue card (0 retry burn)  │
│                                                                                 │
│  [Level 5: Circuit Breaker]    consecutiveFailures >= maxRetries (2)            │
│                                └──► Trip to blocked ('capability')              │
│                                └──► ctx.subagents.start() Brain re-plan         │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Card reaches 'done'
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         3. RESULT REVIEW & COMPLETION                           │
│                                                                                 │
│  [Gate 1: Axiom Proofs]        ctx.axiomVerifier.verifyTask()                   │
│                                └──► Unproven? Reopen & block card (M-009)       │
│                                                                                 │
│  [Gate 2: Dirty Worktree]      ctx.worktrees.classify()                         │
│                                └──► Dirty? Reopen & block card                  │
│                                                                                 │
│  [Gate 3: Unticked Todos]      parseUntickedCheckboxes(body)                    │
│                                └──► Branch not merged? Open Follow-up Child     │
│                                                                                 │
│  [Gate 4: Reported Defects]    scanCommentsForDefects()                         │
│                                └──► Uncovered? Open Defect Child Card           │
│                                                                                 │
│  [Gate 5: Auto-Integration]    All gates passed && autoMergeOnDone              │
│                                └──► ctx.integrator.integrateCard()              │
│                                                                                 │
│  [Gate 6: Milestone Closure]   integrator/merged ──► §5.11 axiom witnesses check│
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 8.1 Active Surveillance & Watchdog Timers
1. When a worker claims a task and moves it to `running`, `kanban/task-status` fires.
2. Supervisor catches the event, extracts `task.id`, `task.currentRunId`, `task.workerPid`, and records an `ActiveWorkerWatchdog` in memory.
3. Every periodic heartbeat emitted by the worker fires `kanban/heartbeat-tick`, updating `lastHeartbeatAtMs = Date.now()`.
4. Every comment posted to the card fires `kanban/comment-posted`, incrementing `commentCount`.
5. When the task leaves `running` (transitions to `done`, `blocked`, or claim released), the watchdog entry is disarmed and removed.

### 8.2 Explicit Intervention Ladder Walkthrough
On every `sweepIntervalMs` (default 30s), the supervisor runs `assess()` evaluating active tasks against strict conditional gates:

```typescript
for (const task of runningTasks) {
  const wd = this.activeWatchdogs.get(task.id)
  const now = Date.now()
  const startedAt = wd?.startedAtMs ?? (task.startedAt ? task.startedAt * 1000 : now)
  const lastHeartbeat = wd?.lastHeartbeatAtMs ?? (task.lastHeartbeatAt ? task.lastHeartbeatAt * 1000 : startedAt)
  const runningForSec = Math.floor((now - startedAt) / 1000)
  const heartbeatAgeSec = Math.floor((now - lastHeartbeat) / 1000)
  const maxRuntimeSec = task.maxRuntimeSeconds ?? this.config.maxRuntimeSeconds

  // 1. Silent Worker Warning
  if (runningForSec > this.config.silentWorkerSeconds && (wd?.commentCount ?? 0) === 0 && !wd?.warnedSilent) {
    if (wd) wd.warnedSilent = true
    await this.kanban.addComment(
      task.id,
      'supervisor',
      `[silent-worker] Worker has been running for ${Math.floor(runningForSec / 60)}m without posting progress comments. Ensure progress is logged per todo item.`,
    )
    this.ctx.emit('supervisor/audit-warning', {
      taskId: task.id,
      code: 'silent_worker',
      message: `Running ${runningForSec}s without comments`,
      timestamp: now,
    })
  }

  // 2. Stale Heartbeat Detection & Reclaim
  if (heartbeatAgeSec > this.config.staleHeartbeatSeconds) {
    const pid = task.workerPid
    let isProcessAlive = false
    if (pid) {
      try {
        process.kill(pid, 0) // Signal 0 checks PID existence without killing
        isProcessAlive = true
      } catch {
        isProcessAlive = false
      }
    }
    await this.kanban.releaseClaim(task.id, `Stale heartbeat (${heartbeatAgeSec}s ago, PID ${pid} ${isProcessAlive ? 'alive but silent' : 'terminated'})`)
    this.ctx.emit('kanban/claim-stale', task.id, heartbeatAgeSec, pid)
    this.ctx.emit('supervisor/intervened', {
      taskId: task.id,
      kind: 'stale_heartbeat_reclaim',
      timestamp: now,
      detail: `Reclaimed stale worker claim: heartbeat age ${heartbeatAgeSec}s`,
      applied: true,
    })
    continue
  }

  // 3. Wall-Clock Runtime Limit Exceeded
  if (runningForSec > maxRuntimeSec) {
    if (task.workerPid) {
      // Escalating Process Tree Kill: SIGTERM then SIGKILL after graceMs
      await this.terminateProcessTree(task.workerPid, this.config.sigkillGraceMs)
    }
    await this.kanban.transitionTask(task.id, 'blocked', {
      blockKind: 'transient',
      reason: `Exceeded maximum runtime of ${maxRuntimeSec}s (${Math.floor(runningForSec / 60)}m elapsed)`,
    })
    this.ctx.emit('supervisor/intervened', {
      taskId: task.id,
      kind: 'runtime_limit_killed',
      timestamp: now,
      detail: `Terminated worker PID ${task.workerPid} exceeding runtime limit ${maxRuntimeSec}s`,
      applied: true,
    })
  }
}
```

### 8.3 Circuit Breaker & Brain Re-Planning Dispatch
1. When a worker terminates abnormally (`subagent/end` with non-zero exit or error) or transitions to `blocked`, the supervisor checks `task.consecutiveFailures`.
2. If `task.consecutiveFailures >= (task.maxRetries ?? this.config.maxRetries)`:
   - The circuit breaker trips: the card is transitioned to `blocked` (`blockKind = 'capability'`).
   - The supervisor formulates a structured Brain re-planning prompt quoting the card's title, body, recent error output, and governing task axioms (`ctx.axioms.getTaskAxioms(taskId)`).
   - The prompt requests three explicit sections: `### Why it kept failing`, `### Axioms not yet true`, and `### Revised approach` (checklist of verifiable steps).
   - The supervisor dispatches the re-planning request to `ctx.subagents.start(this.config.replanSubagentProvider, { prompt })`.
   - Upon receiving the revised plan, the supervisor appends it to the card comments via `ctx.kanban.addComment(taskId, 'supervisor', 'Brain re-plan: ...')`.
   - If the task owns a Git branch with unmerged commits (`branch_merged_into == false`), the supervisor carries the branch forward to preserve prior progress.

### 8.4 Quota Wall HTTP 429 Coordination
1. The supervisor hooks `agent/request-error` (`packages/core/agent/src/runtime-types.ts:363`):
   ```typescript
   ctx.on('agent/request-error', async (payload, next) => {
     const { failure, provider } = payload
     if (failure.status === 429 || failure.code === 'RATE_LIMIT') {
       await this.activateQuotaWall(provider, failure.providerRetryAfterMs)
     }
     return next()
   })
   ```
2. When triggered:
   - `QuotaWallCoordinator` activates a freeze for `cooldownUntil = now + (retryAfterMs ?? config.rateLimitCooldownSeconds * 1000)`.
   - Finds all running tasks assigned to the throttled provider.
   - Releases worker claims via `ctx.kanban.releaseClaim(taskId, 'Rate limit HTTP 429 quota cooldown')`.
   - Resets task status back to `ready` WITHOUT incrementing `consecutiveFailures` (preserving the worker's retry budget).
   - Emits `supervisor/quota-cooldown-started`.
   - Suspends automated dispatch from launching new cards on that provider until cooldown expires.
   - When cooldown elapses, emits `supervisor/quota-cooldown-ended`.

### 8.5 Post-Completion Result Review Gates (§5.10)
When a card transitions to `done` (`kanban/task-status`), `ResultReviewGate` executes five sequential verification checks:
1. **Gate 1: Axiom Proof Gate (`M-009` / `INV-01`)**:
   - Invariant `INV-01` (No Unproven Done) is strictly enforced synchronously at the substrate level prior to completion via Cordis serial hook `'kanban/pre-complete': (task: Task) => Promise<void> | void` (`plans/01-kanban-substrate.md` §5.2, `plans/04-axiom-verification-sweeper.md`).
   - As a defense-in-depth post-completion verification gate:
     - Calls `ctx.axiomVerifier.verifyTask(taskId)`.
     - If unproven or violated axioms exist, the card is rejected:
       - Calls `ctx.kanban.transitionTask(taskId, 'blocked', { blockKind: 'capability', reason: 'Unproven task axioms' })`.
       - Calls `ctx.kanban.addComment(taskId, 'supervisor', `[unproven-done] Cannot complete card: axioms unproven: ${unproven.join(', ')}`)`.
       - Review halts.
2. **Gate 2: Dirty Worktree Check**:
   - Checks `task.workspacePath` via `ctx.worktrees.classify(task.workspacePath)`.
   - If `!classification.isClean`:
     - Calls `ctx.kanban.transitionTask(taskId, 'blocked', { blockKind: 'capability', reason: 'Uncommitted changes in worktree' })`.
     - Posts git status porcelain diff to card comments.
     - Review halts.
3. **Gate 3: Unticked Checklist Items Check**:
   - Parses `task.body` for unticked items (`^\s*[-*]\s*\[ \]\s+.*$`).
   - If unticked items exist AND the branch is NOT already merged to `main`:
     - Checks idempotency: confirms no child card exists with title `Follow-up for <taskId>: unresolved todos`.
     - Calls `ctx.kanban.createTask({ title: `Follow-up for ${taskId}: unresolved todos`, body: extractUntickedItems(task.body), assignee: task.assignee, workspaceKind: 'worktree', priority: task.priority })`.
     - Calls `ctx.kanban.linkDependency(taskId, followupCard.id)`.
     - Posts comment on original card linking the new follow-up card.
4. **Gate 4: Unaddressed Reported Defects Check**:
   - Scans card comments for defect markers (`DEFECT_MARKER`, e.g. "reported, not fixed", "out of scope", "recommend a follow-up card").
   - Checks whether another card already references the defect file path.
   - If uncovered:
     - Calls `ctx.kanban.createTask({ title: `Fix defect reported in ${taskId}: ${paths[0]}`, body: quotedReport, workspaceKind: 'worktree', priority: task.priority })`.
     - Links dependency: `ctx.kanban.linkDependency(taskId, defectCard.id)`.
5. **Gate 5: Automated Integration Trigger**:
   - If all gates pass and `config.autoMergeOnDone` is true:
     - Calls `ctx.integrator.integrateCard({ taskId })`.

### 8.6 Milestone Todo Closure Verification (§5.11)
1. Listens for `integrator/merged(taskId, mergeCommit)` emitted by `@deepseek-ai/dsh-integrator`.
2. Resolves linked milestone outcome document via `ctx.ledger.getLinkedMilestone(taskId)`.
3. Evaluates governing axioms:
   - For every governing axiom of the milestone outcome, verifies that at least one landed card in `status == 'done'` with a valid Git merge commit SHA witnesses the axiom proof.
   - If any governing axiom lacks a landed witness commit SHA:
     - Milestone remains in `Pending`.
     - Posts escalation warning: `[todo-unproved] Milestone outcome axiom unproved by landed commits`.
4. If all governing axioms are witnessed by landed commits:
   - Calls `ctx.ledger.closeMilestone(slug, compileWitnessReport())` moving outcome to `Done`.

## 9. Error, Cancellation, and Lifecycle Behavior

| Failure Mode | Detection Seam | Immediate Action | Final Settled State |
|---|---|---|---|
| Worker process hang / infinite loop | `runningFor > maxRuntimeSeconds` (2400s) | SIGTERM to PID, wait `sigkillGraceMs` (30s), SIGKILL | Card moved to `blocked` (`transient`), run logged |
| Worker silent without comments | `runningFor > silentWorkerSeconds` (480s) | Post diagnostic warning comment via `ctx.kanban.addComment` | Card stays `running`, `warnedSilent` flagged |
| Worker process crash / death | `heartbeatAge > staleHeartbeatSeconds` (600s) + PID dead | Release claim via `ctx.kanban.releaseClaim(taskId)` | Card returned to `ready`, claim lock cleared |
| HTTP 429 rate limit quota wall | Caught in `agent/request-error` waterfall | Activate cooldown (300s), release claim, requeue to `ready` | Card returned to `ready` (0 retry penalty), cooldown active |
| Consecutive failure exhaustion | `task.consecutiveFailures >= maxRetries` (2) | Trip circuit breaker to `blocked`, dispatch Brain re-plan | Card moved to `blocked` (`capability`), re-plan attached |
| Card marked done with unproven axioms | `ResultReviewGate` calls `ctx.axiomVerifier.verifyTask` | Reject completion, transition card to `blocked` | Card moved to `blocked`, audit comment posted |
| Card marked done with dirty worktree | `ResultReviewGate` calls `ctx.worktrees.classify` | Reject completion, transition card to `blocked` | Card moved to `blocked`, git diff porcelain posted |
| Card done with unticked checklist items | `ResultReviewGate` regex scan of `task.body` | Create follow-up child card via `ctx.kanban.createTask` | Child card in `todo` linked as child dependency |
| Card done with reported uncovered defects | `ResultReviewGate` comment scan with `DEFECT_MARKER` | Create defect child card via `ctx.kanban.createTask` | Child card in `todo` linked as child dependency |
| Cordis HMR reload / process shutdown | Cordis context disposal hook | Clear interval timers, abort subagents, clear in-memory maps | Clean disposal, zero leaked background processes |

## 10. Testing Strategy

The test suite enforces the package-specific rules (`packages/AGENTS.md:7, 17, 18`) using real Cordis container compositions and focused test doubles:

### 10.1 Unit Tests (`packages/supervision/supervisor/tests/*.spec.ts`)
- `watchdog.spec.ts`:
  - Verify `lastHeartbeatAt` updates correctly reset stall timers.
  - Verify `silentWorkerSeconds` (480s) triggers warning comments only when `commentCount === 0`.
  - Verify process termination escalates from SIGTERM to SIGKILL after `sigkillGraceMs` expires.
- `escalation.spec.ts`:
  - Verify evaluation of each ladder level with synthetic task records and mock clocks.
  - Verify that every threshold respects custom `SupervisorConfig` overrides without hardcoded fallbacks.
- `circuit-breaker.spec.ts`:
  - Verify circuit breaker trips immediately when `consecutiveFailures === maxRetries`.
  - Verify that Brain re-planning subagent is called with quoted axioms and card body.
  - Verify unmerged Git branch is carried forward on rebuilt card.
- `quota-wall.spec.ts`:
  - Verify interception of `agent/request-error` with status 429.
  - Verify cooldown timer blocks dispatch until duration elapses.
  - Verify card requeue does not increment `consecutiveFailures`.
- `review-gate.spec.ts`:
  - Verify `M-009` axiom proof failure reopens done card to `blocked`.
  - Verify dirty worktree reopens done card to `blocked` with porcelain status.
  - Verify unticked checklist extraction produces child card with correct title and linked dependency.
- `defect-extraction.spec.ts`:
  - Verify regex extraction across 8 defect phrases (`DEFECT_MARKER`) and source file paths (`DEFECT_PATH`).
  - Verify idempotency: existing child cards or mention in other cards suppress duplicate creation.

### 10.2 Integration & Composition Tests (`tests/composition.spec.ts`)
- **Real Cordis Composition Test**: Boots a real Cordis container using the Loader, mounting `@deepseek-ai/dsh-supervisor` alongside `@deepseek-ai/dsh-kanban-sqlite`.
- **HMR Disposal Test**: Disposes the supervisor plugin fiber and asserts:
  - Background `setInterval` timer is cleared.
  - All active watchdog entries are released.
  - Event listeners on `kanban/*` and `agent/*` are cleanly unregistered.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Ambient watchdog sweep & active worker stall observation | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:372-393, 2030-2094` | Supervisory watch loop, continuous timer intervals, `assess()` execution cadence, and `has_live_run` stall predicate evaluating `last_heartbeat_at` recency. *(Cross-reference Plan 15: Plan 15 covers brain-facing progress tracker `SubagentProgressTracker` and interactive inspect tools `list_agents`/`subagent_tail`; Plan 12 runs the ambient host daemon sweep across all board tasks).* | Python `threading.Event` and CLI loop replaced with Cordis host service `SupervisorService` extending `Service`, managing periodic timer `setInterval` in `ctx.effect()`, and querying active cards via `ctx.kanban`. | port with adaptation |
| Stale claim detection & PID liveness probing | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:739-761`<br>`/home/sic/Downloads/hermes-agent-main/gateway/status.py:216-237` | Stale claim threshold algorithm (`age > STALE_HEARTBEAT_SECONDS`), POSIX PID zero-signal probe (`os.kill(pid, 0)`) verifying liveness vs zombie/dead process, and distinguishing "alive but silent" from gone. | Port Python CLI `hermes kanban reclaim` to Cordis method `ctx.kanban.releaseClaim(taskId)` emitting `kanban/claim-stale`; for continuable workers, dispose via `ctx.subagents.drainContinuableChildren()` before claim release; validate threshold via Schemastery `staleHeartbeatSeconds` (600s). | port with adaptation |
| Silent worker diagnostic audit warnings | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:762-781` | Silent worker detection evaluating elapsed running time against comment counts (`running_for > SILENT_WORKER_SECONDS` and zero comments), diagnostic escalation warning format alerting that uncommitted/uncommented partial work is unrecoverable. | Port from SQLite count query to Cordis `ctx.kanban.addComment(taskId, ...)` and emit `supervisor/audit-warning`; track `warnedSilent` boolean in memory to suppress duplicate warnings; validate threshold via Schemastery `silentWorkerSeconds` (480s). | direct port |
| High-resolution process tree termination (SIGTERM-to-SIGKILL cascade) | `/home/sic/Downloads/hermes-agent-main/gateway/status.py:216-245, 1400-1425`<br>`/home/sic/Downloads/hermes-agent-main/gateway/run.py:4925-4940` | Bounded two-phase termination cascade (`terminate_pid` and `_wait_for_scoped_lock_owner_exit`): send graceful `SIGTERM`, poll process exit across bounded grace period (`sigkillGraceMs`), escalate to uncatchable `SIGKILL`, and verify exit before releasing locks. | Port Python `os.kill` / `os.killpg` and Windows `taskkill` to Node.js `process.kill(pid, signal)` and `ctx.subprocess.kill(pid, signal)`; target process tree group (`-pid`) to terminate child test/build processes; transition task to `blocked` (`kind: 'transient'`). | port with adaptation |
| Durable circuit breaker trip protection & failure streak tracking | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:917-936` | Consecutive failure threshold comparison (`consecutive_failures >= max_retries`), circuit trip predicate, capturing last failure error string, and suppressing raw unrevised retries when at retry ceiling. | In Hermes, failure counts lived in SQLite `tasks` columns and transient script memory. Port to durable `ctx.storageDomain` (`supervisor` domain, `circuit_breakers` table storing `CircuitBreakerRecord`) to survive daemon reboots and HMR reloads (`Review Finding 3`); transition task to `blocked` (`kind: 'capability'`). | port with adaptation |
| Autonomous Brain re-planning dispatch & branch carry-forward | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:599-679, 937-1005` | 3-section structured re-planning prompt format ("Why it kept failing", "Axioms not yet true", "Revised approach" checklist), axiom injection via `card_axioms`, unmerged branch carry-forward (`branch_merged_into` check preserving commits from failed run), and scratch-to-worktree isolation promotion. | Replace Python CLI `ask_brain` and `hermes kanban rebuild` with Cordis subagent delegation via `ctx.subagents.start('spawn', { preset: 'hermes-brain', prompt })` or `ctx.subagents.start('agy', ...)`, appending re-plan as structured comment or child card via `ctx.kanban`. | port with adaptation |
| Quota wall coordination & HTTP 429 cooldown requeuing | `/home/sic/Downloads/hermes-agent-main/agent/fallback_cooldown.py:10-30`<br>`/home/sic/Downloads/hermes-agent-main/agent/error_classifier.py:115-140, 448-455, 720-740`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:872-893` | HTTP 429 status code and rate-limit regex classifier, exponential cooldown calculation (`_arm_rate_limit_cooldown`, `min(60 * 2^backoff, 14400)`), dead model detection, and requeue without failure penalty. | Port agent turn-level failover into `QuotaWallCoordinator` listening to Cordis `agent/request-error` waterfall; arm provider cooldown timestamp, pause dispatcher, and release task claim to `ready` via `ctx.kanban.releaseClaim(taskId)` without incrementing `consecutiveFailures`. | port with adaptation |
| Post-completion result review: dirty worktree gate | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1006-1065` | Worktree cleanliness gate (`uncommitted-done`): inspect git porcelain status of card worktree upon completion; skip check if branch is already merged into main (`_branch_landed`); format porcelain diff comment; revert card status to `blocked` (`kind: 'capability'`). | Replace raw subprocess git commands and direct SQL update with Cordis `ctx.worktrees.classify(workspacePath)` (Plan 07) and `ctx.kanban.updateTask(taskId, { status: 'blocked', blockKind: 'capability' })`. | direct port |
| Post-completion result review: axiom proof gate (`M-009` / `INV-01`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:573-598, 1158-1169` | Axiom gap evaluator (`task_axiom_gap`, `M-009`: "done is computed, not declared. A card whose task axioms are recorded does not integrate while one of them is unproven, blocked or violated: the worker's own evidence is the gate, and 'I finished' is not evidence"). | In Harness, primary enforcement occurs at pre-completion boundary via serial hook `'kanban/pre-complete': (task: Task) => Promise<void> \| void` (Plans 01 and 04). In Plan 12, `ResultReviewGate` provides secondary defense-in-depth: calls `ctx.axiomVerifier.verifyTask(taskId)` and reverts card to `blocked` if unproven. | port with adaptation |
| Unticked checklist follow-up card extraction | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1192-1256` | Markdown checklist extractor regex (`r"^\s*[-*]\s*\[ \]\s+(.*)$"`), branch-merged bypass check (skipping completed work already in main), duplicate suppression / idempotency check via parent/child links and title matching, and structured follow-up card body template. | Translate Python regex and CLI execution to TypeScript in `review-gate.ts`; invoke `ctx.kanban.createTask({ title, body, parentId: taskId, workspace: 'worktree' })` and `ctx.kanban.addComment(taskId, ...)`. | direct port |
| Reported defect card auto-extraction | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:110-121, 1257-1334` | 8 regex defect marker phrases (`DEFECT_PHRASES`), source code path regex (`DEFECT_PATH`), cross-card duplicate mention checker, and structured child defect card template (`## Todo: 1. Reproduce... 2. Implement fix... 3. Run tests... 4. Commit...`). | Translate Python regexes to JavaScript `RegExp` in `review-gate.ts`; replace raw SQL comment queries and CLI commands with `ctx.kanban.listComments(taskId)` and `ctx.kanban.createTask(...)`. | direct port |
| Automated merge integration dispatch | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:209-228, 1125-1191` | Automated integration trigger (`unmerged-done`): verifying branch exists and is not merged into main, confirming task axioms are satisfied, suppressing duplicate refusal comments, and invoking integration engine. | In Hermes this called `merge_card.py --apply`. In Harness, invoke Cordis sibling service `ctx.integrator.integrateCard({ taskId })` (Plan 10) when `autoMergeOnDone: true` and all review gates pass. | port with adaptation |
| Milestone todo closure verification & axiom witnessing (`HS-INV-004`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:353-370, 708-723, 1747-1826` | Milestone todo closure algorithm: parsing card references from todo text, resolving governing axioms (`todo_axioms`), distinguishing specific vs broad axioms, verifying every axiom is witnessed by landed commit SHA (`witnesses = (f"{id} ({commit[:8]})")`), compiling cited satisfier report, and escalating unproved axioms (`[todo-unproved]`). | Replace Python file imports of `ledger.py` and `job_board_cards.py` with Cordis service call `ctx.ledger.checkMilestoneAxioms(taskId)` (`OutcomeLedger`, Plan 13 prerequisite) triggered by `integrator/merged` domain event from Plan 10. | port with adaptation |
| Real-time board telemetry & JSONL time-series writer | `/home/sic/Desktop/storyincode/.hermes/tools/board-metrics.py:13-65`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:2068-2081` | Telemetry metrics schema: timestamp, status distribution, dispatcher latency, per-worker runtime/elapsed seconds, tool call counts, error rates (429, 404, exceptions), completed card duration, and intervention logs appended to `~/.hermes/board-metrics/samples.jsonl`. | Translate Python file writer to Node.js `node:fs/promises.appendFile` in `telemetry.ts`; ingest structured Cordis events (`kanban/task-status`, `agent/request-error`, `supervisor/audit-warning`) instead of polling raw log files on disk. | port with adaptation |
| Cordis container lifecycle & HMR disposal | no Hermes equivalent — new code | N/A (Hermes uses POSIX signal handlers `signal.SIGINT`/`SIGTERM` and `threading.Event` in CLI script `supervise.py:2050-2093`; Harness uses Cordis `ctx.effect()` and plugin context disposal hooks). | Implement native Cordis `Service` lifecycle in `src/index.ts`: clear interval timers, abort active subagents, unregister event hooks, and flush telemetry samples upon plugin unload. | no Hermes equivalent (new code) |

The single most valuable capability to port is the battle-tested intervention escalation ladder and circuit-breaker re-planning state machine (`supervise.py:739-1005, 1192-1334` and `gateway/status.py:216-245, 1400-1425`). While naive watchdog implementations merely kill stuck processes, Hermes's supervisor solves the complete multi-agent operational lifecycle: distinguishing silent stalls from active work, escalating cleanly from SIGTERM to SIGKILL, persisting failure streaks across host restarts via durable storage, generating structured Brain re-plans that preserve unmerged branch commits, and automatically extracting unticked checklist items and reported defect comments into child cards so zero work or bug reports are lost.

## 11. Implementation Steps

Ordered checklist for downstream implementation:

1. [ ] **Package Scaffold**:
   - Create `packages/supervision/supervisor/package.json` extending root pnpm workspaces.
   - Create `packages/supervision/supervisor/tsconfig.json` extending `tsconfig.base.json`.
   - Create `packages/supervision/supervisor/README.md` following canonical Model Experience format.
2. [ ] **Types & Config**:
   - Create `src/types.ts` containing all public interfaces (`ActiveWorkerWatchdog`, `InterventionRecord`, `ReviewVerdict`).
   - Create `src/config.ts` defining `SupervisorConfig` with Schemastery validation and documented defaults.
3. [ ] **Watchdog Manager**:
   - Implement `src/watchdog.ts` (`WatchdogManager`): in-memory map of active workers, timestamp tracking, and comment counters.
4. [ ] **Intervention Ladder & Process Termination**:
   - Implement `src/escalation.ts` (`EscalationLadder`): explicit conditional evaluator for silent workers, stale claims, and runtime limits.
   - Implement escalating process termination using `ctx.subprocess.kill(pid, 'SIGTERM')` followed by `setTimeout` and `SIGKILL`.
5. [ ] **Quota Wall Coordinator**:
   - Implement `src/quota-wall.ts` (`QuotaWallCoordinator`): intercepting `agent/request-error` for HTTP 429, executing 300s cooldown, releasing worker claims, and requeuing cards to `ready`.
6. [ ] **Result Review Gate**:
   - Implement `src/review-gate.ts` (`ResultReviewGate`): checking `ctx.axiomVerifier.verifyTask`, inspecting `ctx.worktrees.classify`, extracting unticked todos (`extractUntickedItems`), and scanning comments for defect markers (`DEFECT_MARKER`).
7. [ ] **Milestone Closure Validator**:
   - Implement `src/milestone-closure.ts` (`MilestoneClosureValidator`): evaluating `integrator/merged` events and validating landed commit SHAs against milestone governing axioms using `ctx.ledger` (`OutcomeLedger` provided by prerequisite Plan 13).
8. [ ] **Telemetry Logger**:
   - Implement `src/telemetry.ts` (`TelemetryWriter`): appending structured JSONL records to `~/.hermes/board-metrics/samples.jsonl`.
9. [ ] **Cordis Service Integration & Export**:
   - Implement `src/index.ts` default-exporting `SupervisorService`, registering event hooks in `ctx.effect()`, and performing declaration merging on `Context` and `Events`.
10. [ ] **Comprehensive Test Suite**:
    - Implement unit tests covering watchdog, escalation, circuit breaker, quota wall, review gate, and defect extraction.
    - Implement real Cordis container composition and HMR disposal tests.

## 12. Acceptance Criteria

- [ ] **Primitive Seam**: `@deepseek-ai/dsh-supervisor` default-exports a Cordis `Service` registered as `ctx.supervisor` on the host plane, with zero model tools registered.
- [ ] **Configurable Tunables**: Every interval, threshold, and timeout is a Schemastery-validated field in `SupervisorConfig`; no magic numbers or unvalidated constants exist in runtime code.
- [ ] **Heartbeat & Stall Detection**: A worker with no heartbeat updates for > 600s has its claim released via `ctx.kanban.releaseClaim()`, and `kanban/claim-stale` is emitted.
- [ ] **Silent Worker Warnings**: A worker running for > 480s with 0 comments receives a diagnostic warning comment posted to Kanban, emitting `supervisor/audit-warning`.
- [ ] **Process Kill Escalation**: A worker exceeding `maxRuntimeSeconds` (2400s) receives SIGTERM, followed by SIGKILL if still alive after `sigkillGraceMs` (30s).
- [ ] **Circuit Breaker & Re-Planning**: Reaching `maxRetries` (2) transitions the card to `blocked` (`capability`) and triggers a structured Brain re-planning subagent via `ctx.subagents.start()`.
- [ ] **Quota Wall Protection**: HTTP 429 on `agent/request-error` initiates a 300s cooldown, requeues affected cards to `ready` without incrementing `consecutiveFailures`, and pauses automated dispatch.
- [ ] **Axiom Proof Gate (`M-009` / `INV-01`)**: Recognizes pre-completion interception via `'kanban/pre-complete': (task: Task) => Promise<void> | void`, and reverts any card marked `done` with unproven axioms to `blocked` during `ResultReviewGate`.
- [ ] **Dirty Worktree Gate**: A card marked `done` whose worktree contains uncommitted modifications is reverted to `blocked` with git porcelain details posted in comments.
- [ ] **Unticked Todo Follow-Up**: A card marked `done` whose branch is not in `main` and has unticked checkboxes automatically generates a child follow-up card in `todo`.
- [ ] **Defect Extraction**: An unaddressed defect reported in comments automatically generates a child defect card in `todo`.
- [ ] **Automated Integration**: Clean cards passing all review gates automatically invoke `ctx.integrator.integrateCard()` when `autoMergeOnDone` is true.
- [ ] **Milestone Outcome Verification**: Validates landed commit SHAs against milestone governing axioms using `ctx.ledger` (`OutcomeLedger` from prerequisite Plan 13).
- [ ] **HMR Safety**: Disposing the supervisor plugin unregisters all event listeners, clears intervals, and leaves zero background loops running.

## Review fixes applied

- REVIEW-contracts #1: Cited `'kanban/pre-complete': (task: Task) => Promise<void> | void` serial hook contract identically with plans 01 and 04 for enforcing `INV-01` (No Unproven Done).
- REVIEW-contracts #4: Resolved implementation-order inversion by establishing Plan 13 (`plans/13-outcome-ledger.md`) as a prerequisite implemented prior to Plan 12, updating all dependency statements and service references (`OutcomeLedger`).
- Added `## Port sources` section detailing source mappings from Hermes repositories (`supervise.py`, `gateway/status.py`, `gateway/run.py`, `fallback_cooldown.py`, `error_classifier.py`, and `board-metrics.py`) to accelerate autonomous supervisor daemon and watchdog implementation.
