# 09 — Verification Evidence Ledger, Test Pinning, & Turn Stop Gates

## Features

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

## 1. Purpose

The verified-work pipeline (`Spec §6`) provides the objective, mechanically enforced test-driven development (TDD) and verification engine for autonomous software engineering in StoryInCode. It enforces the foundational invariant: *an agent cannot claim work is complete; only independent, attributable verification evidence recorded in the ledger permits progression*.

- **What it owns**:
  - The `verification` capability seam (`VerificationStore` abstract Service class in `@deepseek-ai/dsh-verification` extending `@deepseek-ai/cordis.Service`).
  - The authoritative verification evidence store (`VerificationService` in `@deepseek-ai/dsh-verification`) backed by `ctx.storageDomain` managing the typed `verification` domain (`events`, `state`, and `manifests` tables) over the configured repository storage backend (`Spec §7.4`).
  - Shell exit code attributability parser (`assertAttributableCommand`) enforcing Invariant `INV-11` by rejecting masked operators (`|| true`, `|| :`, `; exit 0`, unmonitored pipes `|`, backgrounding `&`, `--passWithNoTests`).
  - The independent RED gate execution runner (`evaluateRedGate`): running tests against the pristine base commit before implementation edits, verifying that failure is caused by the **expected missing behavior** (assertion failure or missing symbol) rather than setup/environment defects (`INV-14`, `Spec §6.4`).
  - Cryptographic test suite freezing (`pinTestSuite`): calculating canonical SHA-256 digests across all test files and test runner configurations (`vitest.config.ts`, `pytest.ini`, `tsconfig.json`, `package.json` scripts) (`Spec §6.5`).
  - Monotonic implementer tool guard (`TestPinningGuard` in `@deepseek-ai/dsh-guard-test-pinning`): registering an agent-scoped `ctx.tools.guard()` that synchronously vetoes write, patch, and edit operations targeting pinned test files during implementer turns (`INV-13`).
  - Physical filesystem permission sync (`chmod 0o444` / `chmod 0o555`) applied to pinned test files in the worker worktree.
  - The independent GREEN gate execution runner (`evaluateGreenGate`): executing tests against the worktree, confirming `exitCode === 0`, attributable shell exit, and that test file hashes match the card's `pinned_test_hash` (`INV-13`, `Spec §6.7`).
  - The turn-stopping verification guard (`VerificationStopHook` in `@deepseek-ai/dsh-verification-stop`): listening to the serial `agent/turn-stopping` event, checking if code was edited without fresh passing test execution, and invoking `agent.steer()` to prevent turn completion (`Spec §6.7`).
  - The complete 7-vector anti-cheat evaluation suite (`Spec §6.10`): mechanically checking for deleted tests, weakened assertions, altered test configurations, skipped checks, unmonitored exit masks, network-dependent passes, and mock injections.
  - Automatic evidence ledger pruning: capping records per `(session_id, root)` at 100, deleting records older than 30 days, capping unreferenced events at 10,000, and clamping output summaries to 2,000 characters.

- **What it deliberately does NOT own**:
  - Declarative predicate sweeper, AST import analysis, and task axiom contracts (`task-axioms/<id>.json`) (owned by `@deepseek-ai/dsh-axiom` and `@deepseek-ai/dsh-axiom-verifier`, Plans 03 and 04).
  - Git worktree allocation, base commit recording, and unpushed commit protection (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Host memory headroom floor admission control (`INV-12`) and systemd cgroups (owned by `@deepseek-ai/dsh-guard-resource`, Plan 08).
  - Kanban card state machine transitions, SQLite table schema, and CAS claim locks (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Model-facing Kanban tools (`kanban_create`, `kanban_complete`, `kanban_block`) (owned by `@deepseek-ai/dsh-tool-kanban`, Plan 02).
  - Git merge commit landing, draft GitHub PR creation, and target branch re-verification (owned by `@deepseek-ai/dsh-integrator`, Plan 10).
  - Autonomous worker loop turn budgets and watchdog timers (owned by `@deepseek-ai/dsh-agent-loop` and `@deepseek-ai/dsh-supervisor`, Plan 12).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives

| Package | Exact Harness Primitive | Plane / Scope | Registration Point | Justification |
|---|---|---|---|---|
| `@deepseek-ai/dsh-verification` | **Service Provider** (`VerificationService extends Service`) | Host Plane (Global) | Merges `interface Context { verification: VerificationStore }` | Implements verification evidence ledger and gate runners backed by `ctx.storageDomain`. Injects `['storageDomain', 'shell', 'subprocess', 'fs']`. |
| `@deepseek-ai/dsh-guard-test-pinning` | **Guard** (Agent-Scoped Tool Guard) | Agent Plane (Scoped) | Registered via `agent.ctx.tools.guard()` in `hermes-worker` preset | Must execute inside implementer agent scope to intercept file writes and patches to pinned test files while allowing test writer roles to author tests. |
| `@deepseek-ai/dsh-verification-stop` | **Event Hook** (Turn Interceptor) | Agent Plane (Scoped) | Subscribes to serial `agent/turn-stopping` event in `hermes-worker` preset | Intercepts agent turn boundary; steers the agent back into another step if code was edited without fresh passing verification evidence. |

### 2.2 Why These Primitives and Not the Neighbours

1. **Evidence-Based Evaluation of Repository Storage Capability (Option (a) Per-Store Analysis vs Option (b))**:
   An explicit audit was performed evaluating whether verification evidence persistence genuinely requires a bespoke SQLite database or maps directly onto the repository's storage capability (`ctx.storageDomain` in `packages/storage/storage-domain`, backed by `packages/storage/storage-sqlite` or `packages/storage/storage-json`).

   **Decision: Option (a) for all stores — Consume `ctx.storageDomain`; drop bespoke SQLite database and eliminate redundant `@deepseek-ai/dsh-verification-sqlite`.**

   To maintain architectural consistency with Plan 01's decision criteria (which retained bespoke SQLite for Kanban due to cross-table `BEGIN IMMEDIATE` transactions, foreign keys, recursive DAG queries, multi-process `busy_timeout = 120000`, and multi-column sort/limit queries), each store owned by the verification subsystem was audited individually:

   - **Store 1: Verification Evidence Ledger (`events` table)**:
     - *Access Pattern*: Append-only audit events keyed by stringified event ID (`String(eventId)`), mapping to `VerificationEvent`. Point writes queue on the domain write chain (`table('events').put(id, event)`). Read queries consist of point lookups by ID and in-memory snapshot filtering (`table('events').entries()`). Retention pruning (`pruneEvents`) iterates in-memory entries and deletes obsolete keys durably.
     - *Contrast with Plan 01*: Plan 01 required cross-table atomic transactions across `tasks`, `task_runs`, and `task_events` (`packages/storage/storage-domain/README.md:152` confirms *"No cross-table transactions, secondary indexes, or multi-segment keys — each write touches one record"*). The verification evidence ledger has zero cross-table transactions and zero secondary index requirements; each write is self-contained.
     - *Decision*: **Option (a) — `ctx.storageDomain` (`table('events')`)**.

   - **Store 2: Pinned Test Suite Manifests (`manifests` table)**:
     - *Access Pattern*: Keyed strictly by `cardId` (string), mapping to `PinnedSuiteManifest` (baseCommit, aggregateHash, files, configs). Written once upon successful RED gate evaluation (`table('manifests').put(cardId, manifest)`); read during GREEN gate evaluation (`table('manifests').get(cardId)`).
     - *Contrast with Plan 01*: Plan 01 required normalized relational schemas and recursive graph queries for DAG cycle detection and parent gating (`INV-05`, `packages/storage/storage/README.md:131` confirms *"`kv` is the only data shape"*). Pinned manifests have zero graph relationships or foreign keys; they represent a pure 1:1 key-value mapping by `cardId`.
     - *Decision*: **Option (a) — `ctx.storageDomain` (`table('manifests')`)**.

   - **Store 3: Workspace Verification State (`state` table)**:
     - *Access Pattern*: Keyed by composite key `${sessionId}:${root}`, mapping to `VerificationState` (lastEventId, lastEditAt, changedPaths). Read synchronously on every agent turn boundary during `getStatus()`; updated when tool execution modifies files in the worktree (`markWorkspaceEdited()`).
     - *Contrast with Plan 01*: Plan 01 required multi-process concurrency handling across separate worker processes with `PRAGMA busy_timeout = 120000` (`packages/storage/storage-sqlite/README.md:130` confirms *"No busy-wait or retry policy — a competing connection holding a write lock rejects the operation immediately instead of waiting; the domain layer's write chain serializes writes within one process, and cross-process coordination is out of scope"*). In contrast, `VerificationService` is a singleton service running on the Host Plane in the host process. Status checks occur synchronously in-process at `agent/turn-stopping`. Synchronous reads from in-memory state (`table('state').get(...)`) provide zero-latency checks at turn boundaries without disk I/O, and single-domain write serialization eliminates lock contention entirely.
     - *Decision*: **Option (a) — `ctx.storageDomain` (`table('state')`)**.

   - *Architectural Advantages of Capability Reuse across All Three Stores*:
     - **Zero Disk Latency on Turn Interception**: Synchronous in-memory reads (`table.get(...)`) make turn-stop verification checks (`getStatus()`) instantaneous, avoiding event loop blocks or disk contention.
     - **Built-in Schema Versioning**: Declarative schema definition via `defineDomain` and `VERIFICATION_DOMAIN_VERSION = 1` enforces validation at module load and fails fast with `DomainError('version-mismatch')` on incompatible media (`packages/storage/storage-domain/README.md:73, 153`), fully addressing `REVIEW-lifecycle #2` without bespoke SQLite pragma code.
     - **Single Package Footprint**: Dropping `@deepseek-ai/dsh-verification-sqlite` consolidates the service definition, domain spec, shell parser, and gate evaluators into `@deepseek-ai/dsh-verification`, eliminating package fragmentation.
     - **Declarative Backend Routing**: Storage backend routing is controlled in `packages/bundle/base/cordis.patch.yml` via `@deepseek-ai/dsh-storage-domain` configuration (routing `verification: sqlite` for unified persistence in production or in-memory for testing).

2. **Why `@deepseek-ai/dsh-verification` is a Host-Plane Service Definition and Provider**:
   Verification evidence is an authoritative, append-only record shared across independent session lifecycles: the test writer records RED gate evidence; the implementer references the pinned hash; the supervisor monitors progress; the reviewer inspects recorded evidence; and the integrator verifies the GREEN gate before merging (`Spec §6`). It must exist on the Host Plane before any agent session starts (**PRESET-RULE 6**).
3. **Why `@deepseek-ai/dsh-guard-test-pinning` is a Scoped Monotonic Tool Guard (`ctx.tools.guard`) rather than a `tools/pre-execute` waterfall listener**:
   In DeepSeek Harness, `tools/pre-execute` is an extensible waterfall where listeners return `{ kind: 'allow' }`, `{ kind: 'deny', reason }`, or `{ kind: 'ask', reason }` (`packages/core/tools/src/index.ts:1465-1475`). If `tools/pre-execute` were used, an `ask` result could divert into user approval, where a human might accidentally approve an edit to a pinned test file, or a downstream listener could reshape the decision. In contrast, `ctx.tools.guard()` runs *after* `tools/pre-execute` and user approval resolution as a monotonic owner check (`packages/core/tools/src/index.ts:1476-1489`). Returning a denial string guarantees immediate rejection with `isError: true`; no downstream listener can turn that denial back into permission (`packages/core/tools/src/index.ts:697-705`).
4. **Why `@deepseek-ai/dsh-guard-test-pinning` is Agent-Scoped, Not Host-Global**:
   StoryInCode employs role-based specialization (`Spec §6.1`): BDD Test Writers *must* author tests in `tests/**`, while Implementers *must never* modify pinned tests. A host-global guard would block test writers from creating tests. Registering the guard on `agent.ctx.tools.guard()` inside the `hermes-worker` preset ensures the guard is active *only* for implementer sessions.
5. **Why `@deepseek-ai/dsh-verification-stop` is a Serial Event Hook on `agent/turn-stopping` rather than a Tool or System Prompt instruction**:
   Relying on prompt instructions ("please run tests before finishing") fails under model laziness or complex debugging loops. In DeepSeek Harness, `agent/turn-stopping` is the authoritative serial event dispatched when a turn has exhausted tool calls and would otherwise terminate (`packages/core/agent-loop/src/agent.ts:316`). Calling `agent.steer()` from an `agent/turn-stopping` listener pushes a steering message into `inbox.nextStep`, forcing the agent loop to continue for another step (`packages/core/agent-loop/src/agent.ts:319-320`, `packages/core/agent-loop/tests/contract-regressions.spec.ts:323-345`).

### 2.3 Exact Interception Point in Real Tool / Permission Stack

The execution pipeline in `ToolRuntime.stagePreExecuteAndGuards` (`packages/core/tools/src/index.ts:1460-1497`) establishes the exact interception seam:

```
Tool Execution Request ──► tools/pre-execute waterfall (allow / deny / ask)
                                   │
                                   ▼
                         serviceAsk() (if ask)
                                   │
                                   ▼
                         guardReason(exec) ◄── ctx.tools.guard() runs HERE
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │ denialReason !== undefined                          │ denialReason === undefined
        ▼                                                     ▼
stagePreExecuteAndGuards short-circuits:              tools/execute around-dispatch wrapper
isError: true, content: "Error: ${denialReason}"              │
(tool body NEVER invoked)                                     ▼
                                                      tool.execute() runs
```

The live Harness code in `packages/core/tools/src/index.ts:1476-1488` states:

```typescript
// Quoted verbatim from packages/core/tools/src/index.ts:1476-1488
const denialReason = decision.kind === 'allow'
  ? this.guardReason(exec)
  : decision.reason
if (denialReason !== undefined) {
  return await next({
    kind: 'post-result',
    exec,
    result: this.materializeFinalResult({
      content: [{ type: 'text', text: `Error: ${denialReason}` }],
      isError: true,
      error: { message: denialReason },
    }),
  })
}
```

Where `this.guardReason(exec)` (`packages/core/tools/src/index.ts:1108-1118`) queries first the global layer, then each scoped layer in the agent's chain (`packages/core/tools/src/index.ts:1113-1116`):
`for (const layer of this.layers.chainLayers(exec.agent)) { const reason = layer.guardReason(exec); if (reason !== undefined) return reason; }`.

When `@deepseek-ai/dsh-guard-test-pinning` returns a denial reason string, the tool execution is aborted immediately before dispatch; no tool code executes, no filesystem mutation occurs, and a structured error block is returned to the model.

### 2.4 Recording Attributable Evidence Through the Shell / Terminal Seam

Evidence recording operates across two distinct paths:
1. **Passive Observation of Agent Tool Calls**:
   When an agent executes shell commands (`bash`, `terminal`) or filesystem tools (`writeText`, `editText`), `ToolRuntime` emits the frozen `tools/result` event (`packages/core/tools/src/index.ts:189, 1656`).
   - For filesystem mutations: `VerificationStore.markWorkspaceEdited(sessionId, root, paths)` records the edit timestamp in the domain `state` table, rendering all prior verification events stale.
   - For shell commands: `VerificationStore.recordTerminalResult(sessionId, cwd, command, result)` analyzes the command with `assertAttributableCommand(command)`. If the command is a recognized test/lint/build invocation and the exit status is attributable (`INV-11`), it inserts an immutable event into the domain `events` table.
2. **Authoritative Independent Gate Runners**:
   The RED and GREEN gate runners execute commands directly through `ctx.shell.run()` (`packages/shell/shell/src/index.ts:92`) or `ctx.subprocess.run()` (`packages/subprocess/subprocess/src/index.ts:80-95`), completely bypassing agent tool layers and model hallucination.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Complete verification pipeline (§6) | Yes (`VerificationStore`, `VerificationService`) | None | Core verification lifecycle orchestration |
| Verification evidence domain (§6.4, §7.4) | Yes (`events`, `state`, `manifests` tables) | None | Authoritative persistence via `ctx.storageDomain` over configured repository storage backend |
| Attributable shell status (`INV-11`) (§6.10, §9) | Yes (`assertAttributableCommand`) | None | Authoritative AST/lexical shell parser rejecting masked exit codes, exported for Plan 04 reuse |
| Independent RED Gate runner (`INV-14`) (§6.4) | Yes (`evaluateRedGate`) | None | Verifies test failure on base commit for expected missing behavior |
| Cryptographic test hashing (`INV-13`) (§6.5) | Yes (`pinTestSuite`, `verifyTestHashMatch`) | None | SHA-256 manifest of test files and test runner configurations |
| Implementer test pinning guard (`INV-13`) (§6.5) | Yes (`@deepseek-ai/dsh-guard-test-pinning`) | None | Agent-scoped `ctx.tools.guard()` vetoing mutations to pinned test paths |
| Physical filesystem permissions (§6.5) | Yes (`syncFilePermissions`) | None | Clamps pinned test files to `chmod 0o444` in worktree |
| Implementer turn/time budgets (§6.6) | No | `@deepseek-ai/dsh-agent-loop` (reused) | Configured via `maxTurns: 25` and timeout policies |
| Independent GREEN Gate runner (`INV-13`) (§6.7) | Yes (`evaluateGreenGate`) | None | Confirms `exitCode === 0`, attributable exit, and hash match |
| `verify_on_stop` turn boundary hook (§6.7) | Yes (`@deepseek-ai/dsh-verification-stop`) | None | Serial `agent/turn-stopping` listener invoking `agent.steer()` |
| Anti-cheat test deletion / weakening (§6.10) | Yes (`evaluateAntiCheat`) | None | AST test counting, diff inspection, config comparison |
| Anti-cheat network isolation (§6.10) | Yes (`sandboxPolicy`) | `@deepseek-ai/dsh-sandbox` (reused) | Executed under `network: 'none'` sandbox policy |
| Worktree merge pipeline (`merge_card`) (§6.9) | No | `@deepseek-ai/dsh-integrator` (Plan 10) | PR creation, merge commit landing, and target branch sync |
| No unproven done gate (`INV-01`, `M-009`) | Consumed by gate | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | Plan 04 queries verification ledger evidence during completion check |

## 4. Proposed Package / File Layout

```
packages/
├── verification/
│   ├── verification/                          # @deepseek-ai/dsh-verification (Service Provider via ctx.storageDomain)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── index.ts                      # VerificationService implementation & Context augmentation
│   │   │   ├── spec.ts                       # defineDomain spec (verificationDomainSpec) & Zod schemas
│   │   │   ├── brand.ts                      # VerificationEventId branded type
│   │   │   ├── types.ts                      # VerificationEvent, VerificationState, Gate types
│   │   │   ├── errors.ts                     # VerificationError, MaskedExitCodeError, GateError
│   │   │   ├── events.ts                     # Cordis event declarations with @mode tags
│   │   │   ├── shell-parser.ts               # AST/shlex command parser & attributable check (INV-11)
│   │   │   ├── red-gate.ts                   # RED gate runner & failure classification (INV-14)
│   │   │   ├── green-gate.ts                 # GREEN gate runner & test hash verification (INV-13)
│   │   │   ├── hasher.ts                     # SHA-256 test file & config manifest generator
│   │   │   ├── anti-cheat.ts                 # Test count, assertion density, runner config audit
│   │   │   ├── observer.ts                   # tools/result observer tracking passive executions
│   │   │   └── pruner.ts                     # Ledger retention and output summary clamp
│   │   └── tests/
│   │       ├── domain-store.spec.ts          # Domain storage, Zod schemas, version mismatch tests
│   │       ├── attributable-parser.spec.ts   # Masked exit code rejection tests (INV-11)
│   │       ├── red-gate.spec.ts              # Expected missing behavior vs setup error tests (INV-14)
│   │       ├── green-gate.spec.ts            # Pinned hash verification and zero exit tests (INV-13)
│   │       ├── anti-cheat.spec.ts            # Test deletion, assertion weakening, config change tests
│   │       ├── ledger-pruning.spec.ts        # Event caps, 30-day age cleanup, summary truncation
│   │       └── lifecycle.spec.ts             # Service disposal and domain handle release
│   └── verification-stop/                     # @deepseek-ai/dsh-verification-stop (Turn Hook)
│       ├── package.json
│       ├── tsconfig.json
│       ├── README.md
│       ├── src/
│       │   ├── index.ts                      # Function plugin hooking agent/turn-stopping
│       │   ├── nudge.ts                      # build_verify_on_stop_nudge prompt formatter
│       │   └── classifier.ts                 # Prose/documentation extension filter
│       └── tests/
│           ├── turn-stopping-hook.spec.ts    # agent.steer invocation on unverified code edit
│           ├── prose-suppression.spec.ts     # Suppression on markdown/README/license edits
│           └── max-attempts.spec.ts          # Bounded continuation attempts (default 2)
└── guard/
    └── guard-test-pinning/                    # @deepseek-ai/dsh-guard-test-pinning (Agent Guard)
        ├── package.json
        ├── tsconfig.json
        ├── README.md
        ├── src/
        │   ├── index.ts                      # Function plugin registering agent-scoped ctx.tools.guard
        │   ├── path-matcher.ts               # Worktree path canonicalization & glob matching
        │   └── permissions.ts                # chmod 0o444 / 0o555 filesystem sync
        └── tests/
            ├── test-pinning-guard.spec.ts    # Tool denial on writeText/editText targeting tests
            ├── config-protection.spec.ts     # Denial on vitest.config.ts / tsconfig.json mutations
            ├── permissions-sync.spec.ts      # Read-only filesystem mode sync
            └── scoped-isolation.spec.ts      # Verifies test writer sessions are unhindered
```

## 5. Public Contracts

### 5.1 Branded Types and Domain Interfaces (`packages/verification/verification/src/types.ts`)

```typescript
import type { IsoTimestamp } from '@deepseek-ai/dsh-types'

export type VerificationEventId = number & { readonly __brand: unique symbol }
export type VerificationKind = 'test' | 'typecheck' | 'lint' | 'build' | 'format' | 'red_gate' | 'green_gate'
export type VerificationScope = 'workspace' | 'package' | 'file' | 'ad_hoc'
export type VerificationStatus = 'passed' | 'failed' | 'error'

export interface VerificationEvent {
  readonly id: VerificationEventId
  readonly createdAt: IsoTimestamp
  readonly sessionId: string
  readonly cwd: string
  readonly root: string
  readonly command: string
  readonly canonicalCommand: string
  readonly kind: VerificationKind
  readonly scope: VerificationScope
  readonly status: VerificationStatus
  readonly exitCode: number
  readonly outputSummary: string
  readonly metadata?: {
    readonly testHash?: string
    readonly baseCommit?: string
    readonly testCount?: number
    readonly assertionCount?: number
    readonly failureClassification?: RedGateFailureClassification
    readonly durationMs?: number
  }
}

export interface VerificationState {
  readonly sessionId: string
  readonly root: string
  readonly lastEventId?: VerificationEventId
  readonly lastEditAt?: IsoTimestamp
  readonly changedPaths: readonly string[]
}

export interface WorkspaceVerificationStatus {
  readonly status: 'passed' | 'failed' | 'stale' | 'unverified'
  readonly latestEvent?: VerificationEvent
  readonly unverifiedChanges: readonly string[]
}

export interface PinnedSuiteManifest {
  readonly cardId: string
  readonly baseCommit: string
  readonly pinnedAt: IsoTimestamp
  readonly aggregateHash: string
  readonly files: Readonly<Record<string, string>> // relativePath -> sha256
  readonly testRunnerConfigs: Readonly<Record<string, string>>
}

export type RedGateFailureClassification =
  | 'EXPECTED_ASSERTION_FAILURE'
  | 'EXPECTED_MISSING_SYMBOL'
  | 'EXPECTED_NOT_IMPLEMENTED'
  | 'SETUP_SYNTAX_ERROR'
  | 'SETUP_IMPORT_ERROR'
  | 'SETUP_HARNESS_ERROR'
  | 'SETUP_ZERO_TESTS'
  | 'UNEXPECTED_PASS'

export interface RedGateVerificationRequest {
  readonly cardId: string
  readonly worktreeRoot: string
  readonly baseCommit: string
  readonly testCommand: string
  readonly testGlobs: readonly string[]
  readonly configGlobs?: readonly string[]
}

export interface RedGateVerificationResult {
  readonly passed: boolean
  readonly classification: RedGateFailureClassification
  readonly exitCode: number
  readonly outputSummary: string
  readonly manifest: PinnedSuiteManifest
  readonly eventId?: VerificationEventId
  readonly failureReason?: string
}

export interface GreenGateVerificationRequest {
  readonly cardId: string
  readonly worktreeRoot: string
  readonly testCommand: string
  readonly pinnedManifest: PinnedSuiteManifest
}

export interface GreenGateVerificationResult {
  readonly passed: boolean
  readonly exitCode: number
  readonly hashMatch: boolean
  readonly outputSummary: string
  readonly eventId?: VerificationEventId
  readonly antiCheatViolations: readonly string[]
}
```

### 5.2 Domain Specification & Service Implementation (`packages/verification/verification/src/spec.ts`, `index.ts`)

```typescript
// packages/verification/verification/src/spec.ts
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { VerificationEvent, VerificationState, PinnedSuiteManifest } from './types.ts'

export const verificationEventSchema = z.object({
  id: z.number(),
  createdAt: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  root: z.string(),
  command: z.string(),
  canonicalCommand: z.string(),
  kind: z.enum(['test', 'typecheck', 'lint', 'build', 'format', 'red_gate', 'green_gate']),
  scope: z.enum(['workspace', 'package', 'file', 'ad_hoc']),
  status: z.enum(['passed', 'failed', 'error']),
  exitCode: z.number(),
  outputSummary: z.string(),
  metadata: z.record(z.unknown()).optional(),
})

export const verificationStateSchema = z.object({
  sessionId: z.string(),
  root: z.string(),
  lastEventId: z.number().optional(),
  lastEditAt: z.string().optional(),
  changedPaths: z.array(z.string()),
})

export const pinnedSuiteManifestSchema = z.object({
  cardId: z.string(),
  baseCommit: z.string(),
  pinnedAt: z.string(),
  aggregateHash: z.string(),
  files: z.record(z.string()),
  testRunnerConfigs: z.record(z.string()),
})

export const VERIFICATION_DOMAIN_VERSION = 1

export const verificationDomainSpec = defineDomain({
  name: 'verification',
  version: VERIFICATION_DOMAIN_VERSION,
  tables: {
    events: domainTable<string, VerificationEvent>(verificationEventSchema as any),
    state: domainTable<string, VerificationState>(verificationStateSchema as any),
    manifests: domainTable<string, PinnedSuiteManifest>(pinnedSuiteManifestSchema as any),
  },
})

// packages/verification/verification/src/index.ts
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  VerificationEvent,
  WorkspaceVerificationStatus,
  PinnedSuiteManifest,
  RedGateVerificationRequest,
  RedGateVerificationResult,
  GreenGateVerificationRequest,
  GreenGateVerificationResult,
} from './types.ts'
import { verificationDomainSpec } from './spec.ts'

export const VERIFICATION_SETTINGS_NAMESPACE = 'verification'

declare module '@deepseek-ai/cordis' {
  interface Context {
    verification: VerificationStore
  }
}

export abstract class VerificationStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'verification')
  }

  /** Record a verified command execution in the evidence ledger. */
  abstract recordEvent(event: Omit<VerificationEvent, 'id' | 'createdAt'>): Promise<VerificationEvent>
  /** Query the current verification status of a workspace for an agent session. */
  abstract getStatus(sessionId: string, cwd: string): Promise<WorkspaceVerificationStatus>
  /** Record filesystem modifications, invalidating freshness of prior verification. */
  abstract markWorkspaceEdited(sessionId: string, root: string, paths: readonly string[]): Promise<void>
  /** Verify whether a shell command's exit code is attributable (INV-11). */
  abstract isExitStatusAttributable(command: string): boolean
  /** Authorize and freeze a test suite under RED phase, producing cryptographic hash (INV-14). */
  abstract evaluateRedGate(request: RedGateVerificationRequest): Promise<RedGateVerificationResult>
  /** Evaluate final GREEN phase test execution against the pinned hash (INV-13). */
  abstract evaluateGreenGate(request: GreenGateVerificationRequest): Promise<GreenGateVerificationResult>
  /** Retrieve the active pinned test manifest for a card. */
  abstract getPinnedManifest(cardId: string): Promise<PinnedSuiteManifest | undefined>
}

export class VerificationService extends VerificationStore {
  static inject = ['storageDomain', 'shell', 'subprocess', 'fs'] as const

  private eventsTable!: import('@deepseek-ai/dsh-storage-domain').KvTable<string, VerificationEvent>
  private stateTable!: import('@deepseek-ai/dsh-storage-domain').KvTable<string, VerificationState>
  private manifestsTable!: import('@deepseek-ai/dsh-storage-domain').KvTable<string, PinnedSuiteManifest>
  private nextEventId = 1

  constructor(ctx: Context, private config: VerificationConfig) {
    super(ctx)
  }

  protected async [Service.init]() {
    const domain = await this.ctx.storageDomain.open(verificationDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'verification.domainClose')
    this.eventsTable = domain.table('events')
    this.stateTable = domain.table('state')
    this.manifestsTable = domain.table('manifests')

    // Recover monotonic event id sequence from in-memory table keys
    for (const [idStr] of this.eventsTable.entries()) {
      const num = Number(idStr)
      if (!Number.isNaN(num) && num >= this.nextEventId) {
        this.nextEventId = num + 1
      }
    }
  }

  async recordEvent(event: Omit<VerificationEvent, 'id' | 'createdAt'>): Promise<VerificationEvent> {
    const id = this.nextEventId++ as any
    const createdAt = new Date().toISOString() as any
    const record: VerificationEvent = { ...event, id, createdAt }
    await this.eventsTable.put(String(id), record)
    await this.stateTable.update(`${event.sessionId}:${event.root}`, (prev) => ({
      sessionId: event.sessionId,
      root: event.root,
      lastEventId: id,
      lastEditAt: prev?.lastEditAt,
      changedPaths: prev?.changedPaths ?? [],
    }))
    this.ctx.emit('verification/event-recorded', record)
    return record
  }

  async getStatus(sessionId: string, cwd: string): Promise<WorkspaceVerificationStatus> {
    const state = this.stateTable.get(`${sessionId}:${cwd}`)
    if (!state || !state.lastEventId) {
      return { status: 'unverified', unverifiedChanges: state?.changedPaths ?? [] }
    }
    const lastEvent = this.eventsTable.get(String(state.lastEventId))
    if (!lastEvent) {
      return { status: 'unverified', unverifiedChanges: state.changedPaths }
    }
    if (state.lastEditAt && state.lastEditAt > lastEvent.createdAt) {
      return { status: 'stale', latestEvent: lastEvent, unverifiedChanges: state.changedPaths }
    }
    return {
      status: lastEvent.status === 'passed' ? 'passed' : 'failed',
      latestEvent: lastEvent,
      unverifiedChanges: state.changedPaths,
    }
  }

  async markWorkspaceEdited(sessionId: string, root: string, paths: readonly string[]): Promise<void> {
    const key = `${sessionId}:${root}`
    const now = new Date().toISOString() as any
    await this.stateTable.put(key, {
      sessionId,
      root,
      lastEditAt: now,
      changedPaths: paths,
      lastEventId: this.stateTable.get(key)?.lastEventId,
    })
    this.ctx.emit('verification/state-dirtied', this.stateTable.get(key)!)
  }

  isExitStatusAttributable(command: string): boolean {
    return assertAttributableCommand(command)
  }

  async evaluateRedGate(request: RedGateVerificationRequest): Promise<RedGateVerificationResult> {
    // Executes test via ctx.subprocess on pristine baseCommit, validates behavioral failure, freezes hashes
    const result = await runRedGate(this.ctx, request)
    if (result.passed && result.manifest) {
      await this.manifestsTable.put(request.cardId, result.manifest)
    }
    return result
  }

  async evaluateGreenGate(request: GreenGateVerificationRequest): Promise<GreenGateVerificationResult> {
    // Evaluates test execution, verifies hash against manifestsTable.get(request.cardId)
    return await runGreenGate(this.ctx, request, this.manifestsTable.get(request.cardId))
  }

  async getPinnedManifest(cardId: string): Promise<PinnedSuiteManifest | undefined> {
    return this.manifestsTable.get(cardId)
  }
}

export default VerificationService
```

### 5.3 Typed Cordis Events (`packages/verification/verification/src/events.ts`)

```typescript
import type {
  VerificationEvent,
  RedGateVerificationResult,
  GreenGateVerificationResult,
  VerificationState,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Emitted when a new verification event is inserted into the ledger. @mode emit */
    'verification/event-recorded'(event: VerificationEvent): void
    /** Emitted when an independent RED gate run completes. @mode emit */
    'verification/red-gate'(result: RedGateVerificationResult): void
    /** Emitted when an independent GREEN gate run completes. @mode emit */
    'verification/green-gate'(result: GreenGateVerificationResult): void
    /** Emitted when workspace code modifications are detected, dirtying verification state. @mode emit */
    'verification/state-dirtied'(state: VerificationState): void
  }
}
```

### 5.4 Configuration Schemas

```typescript
import z from '@deepseek-ai/schemastery'

// packages/verification/verification/src/index.ts
export interface VerificationConfig {
  /** Maximum verification events preserved per session root before pruning. Default: 100. */
  maxEventsPerSessionRoot?: number
  /** Maximum age in days for historical verification events. Default: 30. */
  maxEventAgeDays?: number
  /** Maximum character length for stored output summaries. Default: 2000. */
  maxOutputSummaryChars?: number
}
export const VerificationConfig: z<VerificationConfig> = z.object({
  maxEventsPerSessionRoot: z.number().default(100),
  maxEventAgeDays: z.number().default(30),
  maxOutputSummaryChars: z.number().default(2000),
})

// packages/guard/guard-test-pinning/src/index.ts
export interface TestPinningConfig {
  protectedPathPatterns?: string[]
  mutationToolPatterns?: string[]
  enforceFilesystemChmod?: boolean
}
export const TestPinningConfig: z<TestPinningConfig> = z.object({
  protectedPathPatterns: z.array(z.string()).default([
    'tests/**', 'test/**', 'spec/**', '__tests__/**',
    '**/*.test.ts', '**/*.spec.ts', '**/*.test.py', '**/test_*.py',
    'vitest.config.*', 'jest.config.*', 'tsconfig.json', 'pytest.ini',
  ]),
  mutationToolPatterns: z.array(z.string()).default([
    'writeText', 'editText', 'write_file', 'edit_file',
    'apply_diff', 'patch', 'str_replace_editor', 'fs_write',
  ]),
  enforceFilesystemChmod: z.boolean().default(true),
})

// packages/verification/verification-stop/src/index.ts
export interface VerificationStopConfig {
  enabled?: boolean | 'auto'
  maxAttempts?: number
  ignoredExtensions?: string[]
  ignoredFilenames?: string[]
}
export const VerificationStopConfig: z<VerificationStopConfig> = z.object({
  enabled: z.union([z.boolean(), z.literal('auto')]).default(true),
  maxAttempts: z.number().default(2),
  ignoredExtensions: z.array(z.string()).default([
    '.md', '.markdown', '.mdx', '.rst', '.txt', '.text',
    '.adoc', '.log', '.csv', '.tsv', '.json',
  ]),
  ignoredFilenames: z.array(z.string()).default([
    'license', 'licence', 'notice', 'authors', 'contributors',
    'changelog', 'codeowners', 'agents.md', 'skill.md',
  ]),
})
```

## 6. Lifecycle and Scoping

### 6.1 Host-Plane Storage Provider (`@deepseek-ai/dsh-verification`)
- Implements `VerificationStore`, mounted on the Host Plane in `base.cordis.yml`.
- `inject = ['storageDomain', 'shell', 'subprocess', 'fs']`.
- Lifecycle & Domain Initialization (`[Service.init]()`):
  1. Opens the typed domain via `ctx.storageDomain`:
     ```typescript
     const domain = await this.ctx.storageDomain.open(verificationDomainSpec)
     this.ctx.effect(() => () => domain.close(), 'verification.domainClose')
     this.eventsTable = domain.table('events')
     this.stateTable = domain.table('state')
     this.manifestsTable = domain.table('manifests')
     ```
  2. Resolves domain table handles for `events`, `state`, and `manifests`. Reads return synchronously from validated in-memory state; writes queue sequentially on the domain's write chain and become durable before resolving.
  3. Registers passive tool observer on `ctx.on('tools/result', ...)` to capture terminal executions and workspace edits.
- Teardown:
  - Disposing the service automatically closes the open domain handle via `domain.close()`, draining any queued writes to the medium and releasing the backend unit.
  - Eliminates bespoke `DatabaseSync` handles, file creation permissions, and manual WAL checkpoints.

### 6.2 Agent-Scoped Implementer Guard (`@deepseek-ai/dsh-guard-test-pinning`)
- Function plugin exporting `name = 'guard-test-pinning'`, `inject = ['tools', 'fs', 'verification']`, `Config`, `apply`.
- Mounted in the agent preset (`presets/hermes-worker/agent.cordis.yml`).
- In `apply(ctx)`:
  - Obtains the agent's scoped context (`ctx`).
  - Registers an agent-scoped monotonic guard:
    ```typescript
    const liftGuard = ctx.tools.guard((exec: Readonly<ToolExecution>): string | undefined => {
      return evaluatePinningGuard(ctx, exec)
    })
    ctx.effect(() => liftGuard)
    ```
  - Inspects file mutation tools (`writeText`, `editText`, `patch`, etc.).
  - Resolves target path. If the target file matches any pinned test path or runner configuration for the current card:
    Returns structured rejection reason:
    `Test suite pinning violation (INV-13): Path "${targetPath}" is cryptographically pinned (SHA-256: ${pinnedHash}) and read-only during implementer turns. Implementers must change production code in src/ to satisfy tests, never mutate pinned test files or configs.`
  - When `enforceFilesystemChmod: true`, traverses pinned files in the worktree and applies `fs.chmod(path, 0o444)`.
  - Effect teardown removes the guard from the agent's scope layer and restores file permissions if necessary.

### 6.3 Agent-Scoped Turn Interceptor (`@deepseek-ai/dsh-verification-stop`)
- Function plugin exporting `name = 'verification-stop'`, `inject = ['verification', 'tools']`, `Config`, `apply`.
- Mounted in the agent preset (`presets/hermes-worker/agent.cordis.yml`).
- In `apply(ctx)`:
  - Subscribes to serial `agent/turn-stopping` event:
    ```typescript
    ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
      await handleTurnStopping(ctx, agent, turn, signal)
    })
    ```
  - Evaluates `verification.getStatus(agent.session.id, agent.session.header.cwd)`.
  - If code was modified during this turn and `status !== 'passed'`:
    - Checks `turnAttemptCount < maxAttempts` (default 2).
    - If below cap:
      Constructs actionable nudge prompt (`build_verify_on_stop_nudge`).
      Calls `agent.steer(createUserMessage({ content: [{ type: 'text', text: nudgePrompt }], source: { kind: 'user' } }))`.
      Pushes synthetic message into `inbox.nextStep`.
      Per `packages/core/agent-loop/src/agent.ts:319-320`, `this.inbox.nextStep.length > 0`, so the agent loop does NOT terminate; it loops to `target = 'next-step'` and executes the required test run!

## 7. Agent Preset Integration

### 7.1 Host Plane Composition (`base.cordis.yml` Patch Layer)
Per **PRESET-RULE 2, 6, and 8** (`PRESET-RULES.md:6-14`), service providers injecting host capabilities (`shell`, `subprocess', 'fs') and persisting shared evidence across sessions belong strictly to the Host Plane:

```yaml
# packages/bundle/base/cordis.patch.yml
'@deepseek-ai/dsh-storage-domain':
  backend: sqlite
  routes:
    verification: sqlite

'@deepseek-ai/dsh-verification':
  maxEventsPerSessionRoot: 100
  maxEventAgeDays: 30
  maxOutputSummaryChars: 2000
```

### 7.2 Agent Plane Preset (`presets/hermes-worker/agent.cordis.yml`)
Per **PRESET-RULE 1 and 4** (`PRESET-RULES.md:5, 10`), rows that only register into host registries (`ctx.tools.guard`) or listen to Cordis events (`agent/turn-stopping`) and publish no services need no `isolate` realm:

```yaml
# presets/hermes-worker/agent.cordis.yml

# ── verification & test pinning guards ────────────────────────────────────────

- id: guard-test-pinning
  name: '@deepseek-ai/dsh-guard-test-pinning'
  config:
    protectedPathPatterns:
      - 'tests/**'
      - 'test/**'
      - 'spec/**'
      - '**/*.test.ts'
      - '**/*.spec.ts'
      - 'vitest.config.*'
      - 'tsconfig.json'
    enforceFilesystemChmod: true

- id: verification-stop
  name: '@deepseek-ai/dsh-verification-stop'
  config:
    enabled: true
    maxAttempts: 2
```

## 8. Execution Flow

### 8.1 Phase 1: RED Gate & Cryptographic Freezing (`INV-14`, `INV-13`)

```
Test Writer Finishes Tests ──► Host Runner Calls evaluateRedGate()
                                          │
                                          ▼
                         Execute Tests on Untouched Base Commit
                                          │
                   ┌──────────────────────┴──────────────────────┐
                   │ Exit Code != 0                              │ Exit Code == 0
                   ▼                                             ▼
       Parse Failure Output                             Fails: UNEXPECTED_PASS
                   │
  ┌────────────────┴────────────────────────────────┐
  │ Matches Expected Missing Behavior?              │ Matches Setup Error?
  │ (AssertionError / Missing Symbol / NotImplemented)│ (SyntaxError / ModuleNotFound / ConfigCrash)
  ▼                                                 ▼
VALID RED GATE                                      REJECTED: SETUP ERROR
  │
  ▼
Compute SHA-256 Hashes of:
  - All Test Files (tests/**) & Runner Configs (vitest.config.ts, etc.)
  │
  ▼
Insert into verification_events (kind: 'red_gate', status: 'passed')
Card marked 'ready' for Implementer (INV-14 Satisfied)
```

#### Exact Mechanically Checkable Condition for RED Gate:
1. **Compilation / Syntax Check**: Target test file must be syntactically valid TypeScript/JavaScript/Python. If AST parsing yields syntax errors: rejected with `SETUP_SYNTAX_ERROR`.
2. **Environment & Import Check**: Stdout/stderr must NOT contain `MODULE_NOT_FOUND`, `ERR_MODULE_NOT_FOUND`, `ImportError`, `Cannot find module`, or exit codes 126/127. If present: rejected with `SETUP_IMPORT_ERROR`.
3. **Runner Configuration Check**: Runner must NOT fail due to misconfiguration, missing plugins, or zero discovered tests (`ERR_NO_TESTS_FOUND`, `No test suite found`). If present: rejected with `SETUP_ZERO_TESTS` or `SETUP_HARNESS_ERROR`.
4. **Behavioral Failure Signature**: Stderr/stdout MUST contain at least one recognized assertion error or missing symbol pattern:
   - `AssertionError`, `assert`, `expect(...).to*`, `[ERR_ASSERTION]`
   - `ReferenceError: <Symbol> is not defined` (where `<Symbol>` matches the unit under test)
   - `TypeError: <Symbol> is not a function`
   - `NotImplementedError`, `Error: Method not implemented`, `TODO`
5. **Counts**: Reported `failedCount >= 1`, `errorCount == 0` (in runners separating runtime crashes from assertion failures).

### 8.2 Phase 2: Implementer Turn & Test Pinning Interception (`INV-13`)

```
Implementer Model Proposes Tool Call: writeText(path: "tests/auth.spec.ts", ...)
                                │
                                ▼
         ToolRuntime.stagePreExecuteAndGuards() ──► ctx.tools.guard()
                                │
                  ┌─────────────┴─────────────┐
                  │ Target Path in Pinned Set?│
                  ▼                           ▼
                 YES                          NO
                  │                           │
     Return Denial Reason String         Return undefined
                  │                           │
                  ▼                           ▼
   Short-Circuit Tool Execution:         Proceed to Dispatch:
   isError: true, content: Error...      tool.execute() runs
   (Tests Unchanged on Disk)
```

### 8.3 Phase 3: Turn Stop Gate (`verify_on_stop`)

```
Implementer Model Completes Tool Calls ──► agent/turn-stopping Dispatched
                                                      │
                                                      ▼
                                       VerificationStopHook Evaluates:
                                       Has Code Been Edited This Turn?
                                                      │
                      ┌───────────────────────────────┴───────────────────────────────┐
                      │ YES                                                           │ NO (Prose only or no edits)
                      ▼                                                               ▼
      Query ctx.verification.getStatus(sessionId, cwd):                       Turn Ends Normally
      Is status === 'passed' (fresh passing verification)?
                      │
      ┌───────────────┴───────────────┐
      │ YES                           │ NO (Unverified code edits!)
      ▼                               ▼
Turn Ends Normally             Check turnAttemptCount < 2
                                      │
                      ┌───────────────┴───────────────┐
                      │ YES                           │ NO (Exhausted attempts)
                      ▼                               ▼
      Construct Nudge Prompt & agent.steer()      Log Warning & Conclude Turn
      Turn Continues to Next Step!
```

### 8.4 Phase 4: GREEN Gate Evaluation (`INV-13`)

```
Worker Finishes Implementation ──► Host Runner Calls evaluateGreenGate()
                                              │
                                              ▼
                         Re-hash Current Tests & Runner Configs
                                              │
                                ┌─────────────┴─────────────┐
                                │ Hash == pinned_test_hash? │
                                ▼                           ▼
                               YES                          NO ──► Fail: ANTI_CHEAT_HASH_MISMATCH
                                │
                  Run Attributable Test Suite
                                │
                  ┌─────────────┴─────────────┐
                  │ Exit Code == 0?           │
                  ▼                           ▼
                 YES                          NO ──► Fail: GREEN_GATE_TEST_FAILURE
                  │
      Run Full Anti-Cheat Suite:
      - Test Count >= Original?
      - Assertions Not Weakened?
                  │
                  ▼
     Record in verification events table (kind: 'green_gate', status: 'passed')
     Card Permitted to Transition to 'review' or 'done'
```

### 8.5 Anti-Cheat Specification & Mechanical Verification Matrix

To prevent models from gaming verification to achieve artificial "green" states, all 7 anti-cheat vectors are evaluated mechanically:

| Vector | Attack Description | Exact Mechanical Check | Enforcement Seam | Action on Violation |
|---|---|---|---|---|
| **AC-1: Deleted Tests** | Model deletes test files or test cases to eliminate failures. | Compares test count: `testCount(worktree) >= testCount(pinnedManifest)`. Compares Git status: `git diff --diff-filter=D` on pinned paths must be empty. | `evaluateGreenGate` | Immediate failure with `ANTI_CHEAT_DELETED_TESTS`. |
| **AC-2: Weakened Assertions** | Model replaces strict equality (`toBe`, `assertEqual`) with loose checks (`toBeTruthy`, `assert True`), or removes assertions. | AST parser compares assertion density: total `expect(...)` / `assert` calls across test files before vs after. | `evaluateGreenGate` & `guard-test-pinning` | Blocked at edit time by `guard-test-pinning`; rejected at green gate with `ANTI_CHEAT_WEAKENED_ASSERTIONS`. |
| **AC-3: Modified Runner Config** | Model disables bail, suppresses errors, or adds flags in `vitest.config.ts`, `tsconfig.json`, `package.json`. | SHA-256 hash comparison of all config files against `pinnedManifest.testRunnerConfigs`. | `evaluateGreenGate` & `guard-test-pinning` | Blocked at edit time; green gate rejects with `ANTI_CHEAT_CONFIG_MUTATED`. |
| **AC-4: Masked Exit Codes (`INV-11`)** | Model uses compound shell tricks: `npm test \|\| true`, `pytest ; exit 0`, `pytest &`. | Lexical parser `assertAttributableCommand(cmd)` parses command AST. Rejects operators `\|\|`, `;`, `\|` (without pipefail), `&`, and flag `--passWithNoTests`. | `isExitStatusAttributable` | Command rejected from recording in ledger; `verify_on_stop` treats workspace as unverified. |
| **AC-5: Network-Dependent Passes** | Tests rely on external live network calls or public APIs that might flap or mask offline failure. | Test runs execute with sandbox policy `network: 'none'` (Linux network namespace isolation). | `ShellExecutor` / `Subprocess` | Network calls immediately fail with `ECONNREFUSED`. |
| **AC-6: Self-Grading via Chat** | Model claims in response text "I ran tests and they passed!" without executing tools. | Kanban completion gate checks verification ledger: verifies a recorded event exists in verification domain `events` with matching `cardId`, `kind = 'green_gate'`, and `status = 'passed'`. | `kanban/pre-complete` event hook (Plan 04) | Transition to `done` rejected with `INV-01 / No Unproven Done`. |
| **AC-7: Test Mock Infiltration** | Model injects global mock overrides in test files to fake production code behavior. | Pinned test suites are read-only; model cannot edit test files. Production files are analyzed for unauthorized `vi.mock` or test harness stubs. | `evaluateGreenGate` | Green gate fails with `ANTI_CHEAT_UNAUTHORIZED_MOCK`. |

## 9. Error, Cancellation, and Lifecycle Behavior

### 9.1 Cancellation and Abort Cascades
- Gate executions take an explicit `AbortSignal` (`request.signal`).
- If an agent turn is cancelled or aborted by user interaction:
  `ShellExecutor.run` or `Subprocess.run` terminates child processes immediately via `SIGTERM`, falling back to `SIGKILL` after 2000 ms grace period (`packages/subprocess/subprocess/src/index.ts:160-178`).
- If an execution is aborted before completion, no evidence record is committed to the verification domain's write chain.

### 9.2 Storage Concurrency and Write Serialization
- Verification persistence relies on the single per-domain write chain in `@deepseek-ai/dsh-storage-domain` (`packages/storage/storage-domain/src/domain.ts:88-90`).
- Writes to `events`, `state`, and `manifests` tables queue sequentially on the domain's write chain: backend durability on the medium is achieved first before memory is mutated, eliminating lock contention and busy-wait timeouts within the host process.
- Synchronous reads (`get`, `entries`, `keys`) query authoritative in-memory state without acquiring database locks, providing zero-latency reads during turn-stop interception (`getStatus()`).
- When routed to the SQLite backend (`packages/storage/storage-sqlite`), physical durability is managed by the shared backend unit without requiring bespoke `PRAGMA` configuration or transaction boilerplate in `@deepseek-ai/dsh-verification`.

### 9.3 Partial Failures and Circuit Breakers
- If a test execution crashes the runtime (e.g. out of memory, segfault, exit 137/139), the result is recorded with `status: 'error'`, `outputSummary` containing the stack/dmesg trace.
- A failed verification run never corrupts or deletes prior verification records; historical attempts are preserved for reviewer auditing.

### 9.4 Ephemeral vs Durable State
- **Durable State (`verification` domain via `ctx.storageDomain`)**:
  Managed across three typed tables routed to the repository storage backend:
  1. `events`: Immutable verification audit trail (`VerificationEvent`).
  2. `state`: Per-session workspace verification freshness and edit timestamps (`VerificationState`).
  3. `manifests`: Cryptographically frozen test suite manifests (`PinnedSuiteManifest`).
  Schema integrity and versioning are enforced declaratively by `defineDomain` (`VERIFICATION_DOMAIN_VERSION = 1`).
- **Process-Local State (Ephemeral)**:
  Active `agent/turn-stopping` attempt counters (reset upon each user prompt), memoized pinned manifests cache (cleared on worktree disposal).

## 10. Testing Strategy

### 10.1 Unit Tests
- `domain-store.spec.ts`:
  - Validates `verificationDomainSpec` declaration with `defineDomain` and schema validation on `events`, `state`, and `manifests` tables.
  - Verifies startup failure on version mismatch (`DomainError('version-mismatch')`) when opened against an incompatible backend version.
  - Validates synchronous in-memory reads and durable writes through `ctx.storageDomain`.
- `attributable-parser.spec.ts`:
  - Validates `assertAttributableCommand` against full matrix of safe commands (`npm test`, `vitest run`, `pytest -v`, `pnpm run test:unit`).
  - Proves rejection of all masking variations: `cmd || true`, `cmd || :`, `cmd ; exit 0`, `cmd ; true`, `cmd | tee out.log`, `cmd &`, `cmd --passWithNoTests`.
- `red-gate.spec.ts`:
  - Simulates genuine assertion failure: confirms classification is `EXPECTED_ASSERTION_FAILURE` and gate succeeds.
  - Simulates syntax error in test file: confirms classification is `SETUP_SYNTAX_ERROR` and gate fails closed.
  - Simulates missing dependency (`MODULE_NOT_FOUND`): confirms classification is `SETUP_IMPORT_ERROR` and gate fails closed.
  - Simulates zero tests discovered: confirms classification is `SETUP_ZERO_TESTS` and gate fails closed.
- `hasher.spec.ts`:
  - Proves deterministic SHA-256 calculation across mixed line endings (`\r\n` vs `\n`).
  - Proves manifest detects single-character edits to test files or configs.

### 10.2 Scoped Tool Guard Tests (`guard-test-pinning`)
- `test-pinning-guard.spec.ts`:
  - Invokes `writeText`, `editText`, and `apply_diff` targeting a pinned path: proves guard returns non-empty string and tool aborts with `isError: true`.
  - Invokes `writeText` targeting `src/feature.ts`: proves guard returns `undefined` and tool executes cleanly.
  - Tests config protection: verifies edits to `vitest.config.ts` and `tsconfig.json` are denied.
- `scoped-isolation.spec.ts`:
  - Verifies that guard registered in `hermes-worker` preset does NOT leak into test-writer or orchestrator presets.

### 10.3 Event Hook Tests (`verification-stop`)
- `turn-stopping-hook.spec.ts`:
  - Mounts hook into test agent loop.
  - Simulates code edit followed by turn completion without test run: verifies `agent.steer()` is called with formatted nudge prompt, and turn continues.
  - Simulates code edit followed by passing `recordEvent()`: verifies turn completes without steering.
  - Simulates edit touching ONLY `README.md` and `SKILL.md`: verifies steering is suppressed.
- `max-attempts.spec.ts`:
  - Simulates repeated unverified turn-stopping events: verifies hook steers on attempts 1 and 2, and allows turn to end on attempt 3.

### 10.4 Integration & Ledger Pruning Tests
- `ledger-pruning.spec.ts`:
  - Inserts 120 events for one `(session_id, root)`: verifies count is pruned to 100 oldest-first using domain table handles.
  - Inserts events with timestamps 35 days in the past: verifies automatic deletion from domain table.
  - Inserts 5,000 character output: verifies summary is clamped to 2,000 characters.
- `lifecycle.spec.ts`:
  - Verifies service disposal cleanly closes the storage domain handle via `domain.close()` without descriptor leaks.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Verification evidence ledger schema & state tracking | `/home/sic/Downloads/hermes-agent-main/agent/verification_evidence.py:23-81, 90-104` | DDL and models for `verification_events` (`command`, `canonical_command`, `kind`, `scope`, `status`, `exit_code`, `output_summary`) and `verification_state` (`last_event_id`, `last_edit_at`, `changed_paths_json`), with event limits (`_MAX_EVENTS_PER_SESSION_ROOT = 100`, `_MAX_OUTPUT_SUMMARY_CHARS = 2000`, `_MAX_EVIDENCE_AGE_DAYS = 30`). | Translate SQLite DDL and Python dataclasses into `verificationDomainSpec` using Zod schemas on `ctx.storageDomain` (tables `events`, `state`, `manifests`), replacing raw SQL queries with typed domain table operations. | port with adaptation |
| Attributable shell command parser (`INV-11`) | `/home/sic/Downloads/hermes-agent-main/agent/verification_evidence.py:169-249`<br>`/home/sic/Downloads/hermes-agent-main/tools/terminal_hints.py:90-147` | Shell segmentation lexer (`_split_shell_segments`), attribution predicate (`_exit_status_is_attributable`), and masked success/pipeline detection patterns (`_MASKING_SHAPES`, `_PASSTHROUGH_CONSUMERS`) rejecting `|| true`, `|| :`, `; exit 0`, and unmonitored pipes. | Implement `assertAttributableCommand` and `isExitStatusAttributable` in `packages/verification/verification/src/shell-parser.ts`, throwing typed `UnattributableCommandError` when masked operators are detected. | direct port |
| Turn-stopping verification guard & nudge generator | `/home/sic/Downloads/hermes-agent-main/agent/verification_stop.py:13-37, 79-115`<br>`/home/sic/Downloads/hermes-agent-main/agent/turn_stop_gates.py:35-50` | Verification-on-stop algorithm: checking for edited code paths, filtering out prose/documentation files (`_NON_CODE_VERIFY_EXTENSIONS`, `_NON_CODE_VERIFY_FILENAMES`), comparing last edit timestamp against last test event, and generating structured continuation prompt. | Port Python turn-stop logic to Cordis serial event hook on `agent/turn-stopping` in `@deepseek-ai/dsh-verification-stop`, invoking `agent.steer()` to continue the turn when unverified edits exist. | direct port |
| Command classification & test runner identification | `/home/sic/Downloads/hermes-agent-main/agent/verification_evidence.py:30-43, 259-335` | Command classification keywords (`_KIND_KEYWORDS` for test, typecheck, lint, build), prefix stripping (`_strip_command_prefix`), runner spellings (`_PYTEST_SPELLINGS`, `npm test`, `vitest`), and canonical command normalization. | Port to TypeScript `classifier.ts`, add support for `pnpm --filter <pkg> test/typecheck`, and record classified `kind` on evidence events. | direct port |
| Ledger retention & age pruning | `/home/sic/Downloads/hermes-agent-main/agent/verification_evidence.py:480-530` | Retention pruning queries: capping records per `(session_id, root)` at 100, deleting records older than 30 days, clamping summary output to 2,000 characters. | Implement `pruneEvents()` in `pruner.ts` using `ctx.storageDomain.table('events')` iteration and deletion rather than SQLite `DELETE FROM`. | direct port |
| Independent RED gate behavioral verification (`INV-14`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_verify.py:224-288`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:131-149` | Test execution against base commit, behavioral failure confirmation (`AssertionError` or missing symbol), environment sanity check (`env_can_run_checks`) to ensure dependencies exist before failing. | Wrap in `evaluateRedGate`, reject syntax/import errors, generate and persist `PinnedSuiteManifest` in `manifests` table. | port with adaptation |
| Cryptographic test suite pinning & filesystem permissions (`INV-13`) | no Hermes equivalent — new code | N/A (Hermes lacks cryptographic test hash pinning and read-only test suite locking during implementer turns). | Implement `pinTestSuite` in `hasher.ts` calculating SHA-256 digests over test specs and runner configs, apply `chmod 0o444`, and register `TestPinningGuard` via `ctx.tools.guard()`. | no Hermes equivalent (new code) |
| Independent GREEN gate evaluator | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:640-657` | Exit code 0 verification, test output capture, and differential failure checking. | Wrap in `evaluateGreenGate`, re-verify test hashes against `pinned_test_hash`, execute anti-cheat checks, and record `green_gate` event in ledger. | port with adaptation |

The single most valuable capability to port is the attributable shell command parsing state machine and turn-stopping verification guard (`agent/verification_evidence.py:169-249` and `agent/verification_stop.py:13-115`). Autonomous models persistently attempt to mask test failures with command chaining (`|| true`, `|| echo "OK"`, piping to `tail`) or declare completion immediately after editing code without running tests. Hermes's shell AST segment evaluator and non-code path filter provide the exact mechanical enforcement required to guarantee that no completion occurs without attributable proof.

## 11. Implementation Steps

1. **Package Scaffolding**:
   - Create directories `packages/verification/verification`, `packages/verification/verification-stop`, and `packages/guard/guard-test-pinning`.
   - Setup `package.json`, `tsconfig.json`, and `README.md` in each package adhering to monorepo conventions.
2. **Implement `@deepseek-ai/dsh-verification` (Domain Specification & Service)**:
   - Define branded type `VerificationEventId` in `brand.ts`.
   - Define all domain interfaces (`VerificationEvent`, `VerificationState`, `PinnedSuiteManifest`) in `types.ts`.
   - Define `verificationDomainSpec` with Zod schemas for `events`, `state`, and `manifests` tables and `VERIFICATION_DOMAIN_VERSION = 1` in `spec.ts`.
   - Merge `interface Context { verification: VerificationStore }`, implement abstract `VerificationStore`, and implement concrete `VerificationService` backed by `ctx.storageDomain` in `index.ts`.
   - Declare typed Cordis events with `@mode` tags in `events.ts`.
3. **Implement Shell Parser (`INV-11`)**:
   - Implement `assertAttributableCommand` and `isExitStatusAttributable` in `packages/verification/verification/src/shell-parser.ts`.
   - Tokenize command via shell lexer; split by operators `;`, `&&`, `||`, `|`, `&`.
   - Reject any sequence where exit code is masked or detached.
   - Export for shared consumption by Plan 04 (`@deepseek-ai/dsh-axiom-verifier`).
4. **Implement Cryptographic Hasher**:
   - Implement `pinTestSuite` and `computeSuiteDigest` in `hasher.ts` using `node:crypto`.
   - Normalize line endings and compute SHA-256 for all test files and config files.
5. **Implement RED and GREEN Gate Evaluators (`INV-14`, `INV-13`)**:
   - Implement `evaluateRedGate` in `red-gate.ts`: execute test on pristine base commit; classify failure signature (assertion vs syntax/import error); generate pinned manifest; persist manifest in `manifests` table.
   - Implement `evaluateGreenGate` in `green-gate.ts`: recompute hashes; execute test command; verify exit code 0; execute anti-cheat checks.
6. **Implement Verification Evidence Ledger & Lifecycle (`@deepseek-ai/dsh-verification`)**:
   - In `VerificationService`: open domain via `ctx.storageDomain.open(verificationDomainSpec)` in `[Service.init]()`.
   - Register domain handle release on `ctx.effect`.
   - Implement `recordEvent`, `getStatus`, `markWorkspaceEdited`, and `getPinnedManifest` using domain table handles.
   - Implement ledger retention pruning in `pruner.ts` (100 events per session root, 30-day age cap, 2000 char output clamp).
7. **Implement `@deepseek-ai/dsh-guard-test-pinning` (Agent Guard)**:
   - Implement `evaluatePinningGuard` in `index.ts`.
   - Register agent-scoped guard via `ctx.tools.guard()` in `apply(ctx)`.
   - Implement filesystem permission clamping (`chmod 0o444`) in `permissions.ts`.
8. **Implement `@deepseek-ai/dsh-verification-stop` (Turn Hook)**:
   - Implement `VerificationStopHook` listening to `agent/turn-stopping`.
   - Implement `build_verify_on_stop_nudge` and prose extension filters.
   - Implement steering continuation via `agent.steer()`.
9. **Preset & Patch Layer Integration**:
   - Register `@deepseek-ai/dsh-storage-domain` route `verification: sqlite` and `@deepseek-ai/dsh-verification` provider in `packages/bundle/base/cordis.patch.yml`.
   - Add `@deepseek-ai/dsh-guard-test-pinning` and `@deepseek-ai/dsh-verification-stop` to `presets/hermes-worker/agent.cordis.yml`.
10. **Comprehensive Test Suite**:
    - Implement unit tests, domain storage tests with in-memory double, anti-cheat tests, and HMR lifecycle tests.

## 12. Acceptance Criteria

- [ ] `VerificationService` registers as `ctx.verification` on the Host Plane and initializes the verification domain (`events`, `state`, `manifests`) via `ctx.storageDomain` with schema version validation.
- [ ] `assertAttributableCommand` mechanically rejects all masked commands (`|| true`, `|| :`, `; exit 0`, `| tee`, `&`, `--passWithNoTests`) (`INV-11`) and is exported as the authoritative shell parser.
- [ ] `evaluateRedGate` executes on the untouched base commit, confirms behavioral failure (`AssertionError` / missing symbol), rejects syntax or import errors, persists the pinned manifest, and records a `kind = 'red_gate'` event (`INV-14`).
- [ ] `pinTestSuite` generates a deterministic SHA-256 manifest covering test files and test runner configs.
- [ ] `ctx.tools.guard()` in `@deepseek-ai/dsh-guard-test-pinning` vetoes write/patch calls targeting pinned test files with a structured error, aborting execution before dispatch (`INV-13`).
- [ ] Pinned test files in the worktree are set to read-only (`chmod 0o444`).
- [ ] `evaluateGreenGate` verifies that test files match `pinned_test_hash`, test execution returns exit code 0, and attributable evidence is recorded (`INV-13`).
- [ ] `agent/turn-stopping` listener in `@deepseek-ai/dsh-verification-stop` calls `agent.steer()` when code was modified without fresh passing tests, forcing the agent loop to continue.
- [ ] Prose/documentation edits (`.md`, `.txt`, `LICENSE`, `SKILL.md`) do not trigger the turn-stop verification nudge.
- [ ] Anti-cheat evaluator detects and rejects deleted tests, weakened assertions, and modified runner configs.
- [ ] Evidence ledger automatically prunes records older than 30 days and caps records per `(session_id, root)` at 100 via storage domain table handles.
- [ ] Service disposal cleanly closes the storage domain handle via `domain.close()`, flushing queued writes without resource leaks.

## Review fixes applied

- **REVIEW-storage finding (ctx.storageDomain Capability Evaluation & Decision Per Store)**:
  - Evaluated repository `ctx.storageDomain` capability (`packages/storage/storage-domain`) backed by `packages/storage/storage-sqlite` vs dedicated bespoke SQLite store (`@deepseek-ai/dsh-verification-sqlite`).
  - Contrasted with Plan 01: In Plan 01, Kanban selected Option (b) (bespoke SQLite store) because Kanban genuinely required cross-table transactions (`BEGIN IMMEDIATE`), foreign keys and recursive graph queries for DAG cycle detection, multi-process busy-wait retry policies (`PRAGMA busy_timeout = 120000`), and multi-column sort/limit queries — none of which `ctx.storageDomain` supports (`packages/storage/storage-domain/README.md:152`, `packages/storage/storage/README.md:131`, `packages/storage/storage-sqlite/README.md:130`).
  - Made explicit architectural decisions **per store** owned by the verification subsystem:
    1. **Verification Evidence Ledger (`events` table)**:
       - Access pattern: Append-only audit records keyed by event ID (`String(eventId)`); queried via point lookup or in-memory snapshot filtering; pruned by age and per-root count.
       - Decision: **Option (a) — `ctx.storageDomain` (`table('events')`)**. Requires no cross-table transactions, no foreign keys, and no multi-process row locking. Single-domain write chain guarantees sequential persistence.
    2. **Pinned Test Suite Manifests (`manifests` table)**:
       - Access pattern: Keyed by `cardId`, storing `PinnedSuiteManifest`. Point write during RED gate; point lookup during GREEN gate.
       - Decision: **Option (a) — `ctx.storageDomain` (`table('manifests')`)**. Strictly a 1:1 key-value mapping with no relational dependencies or transaction coupling.
    3. **Workspace Verification State (`state` table)**:
       - Access pattern: Keyed by `${sessionId}:${root}`, storing `lastEventId`, `lastEditAt`, `changedPaths`. Point lookup on turn stops; point update on workspace edit.
       - Decision: **Option (a) — `ctx.storageDomain` (`table('state')`)**. Synchronous in-memory `get()` allows `getStatus()` to evaluate instantly at `agent/turn-stopping` with zero disk latency.
  - Dropped proposed bespoke SQLite database (`~/.hermes/verification_evidence.db`) and eliminated redundant package `@deepseek-ai/dsh-verification-sqlite`, consolidating into `@deepseek-ai/dsh-verification` as a host service provider backed by `ctx.storageDomain`.
- **REVIEW-lifecycle #2 (Schema Versioning & Failure-Fast on Incompatible Medium)**:
  - Enforced declarative schema versioning via `export const VERIFICATION_DOMAIN_VERSION = 1` in `defineDomain`.
  - Storage domain facility automatically verifies stored version against spec version upon open, failing fast with `DomainError('version-mismatch')` (`packages/storage/storage-domain/README.md:73, 153`), satisfying version integrity without manual SQLite pragma management.
- **REVIEW-contracts #7 (Canonical Anti-Cheat Shell Parser for INV-11)**:
  - Designated `@deepseek-ai/dsh-verification` as the authoritative owner of shell command attributability parsing (`packages/verification/verification/src/shell-parser.ts`).
  - Consolidated `assertAttributableCommand` and `isExitStatusAttributable` for shared consumption by `@deepseek-ai/dsh-axiom-verifier` (Plan 04), eliminating duplicate shell AST/regex parsers.
- **REVIEW-seams #5 (Clean Plane Separation)**:
  - Retained strict plane separation: host service provider `@deepseek-ai/dsh-verification` mounts on the Host Plane in `base.cordis.yml`, while `@deepseek-ai/dsh-guard-test-pinning` (`ctx.tools.guard`) and `@deepseek-ai/dsh-verification-stop` (`agent/turn-stopping`) mount on the Agent Plane in `presets/hermes-worker/agent.cordis.yml`.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`agent/verification_evidence.py`, `agent/verification_stop.py`, `agent/turn_stop_gates.py`, `tools/terminal_hints.py`, and orchestrator assets `truth_verify.py` and `merge_card.py`) to accelerate verified pipeline implementation.
