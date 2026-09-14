# 04 — Declarative Predicate Sweeper & Task Axiom Proof Tools

## Features

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

## 1. Purpose

`@deepseek-ai/dsh-axiom-verifier` and `@deepseek-ai/dsh-tool-axiom` provide the objective verification and proof enforcement engine for autonomous software engineering in StoryInCode. They enforce the core operating principle: *"The worker reports, the sweeper decides"*.

- **What it owns**:
  - The `axiomVerifier` capability seam (`AxiomVerifier` abstract Service class in `@deepseek-ai/dsh-axiom-verifier` extending `@deepseek-ai/cordis.Service`).
  - The deterministic evaluation engine for all 9 predicate check types defined in Spec §2.5: `path_exists`, `path_absent`, `forbidden_file_pattern`, `grep_absent`, `required_symbol`, `required_reference`, `forbidden_import`, `max_lines`, and `test`.
  - Attributable shell execution (`assertAttributableShellCommand`) enforcing Invariant `INV-11` by rejecting masked commands (`|| true`, `|| :`, `; exit 0`, unmonitored pipes without `set -o pipefail`, backgrounding `&`).
  - Evaluation of machine-checkable axiom blocks (`CheckableAxiom`) declared in colocated `AGENTS.md` files (Plan 03), resolved through the directory containment chain exposed by `ctx.axioms.getCheckableAxiomsForPaths` and `ctx.axioms.analyzeDiffImpact`.
  - Active enforcement of Invariant `INV-10` (No Self-Grading), intercepting worker status claims and reverting unproven or failed axioms to `ACTIVE` with attributable blockers.
  - Active enforcement of Invariant `INV-01` / `M-009` (No Unproven Done), intercepting card completion via the public Cordis serial event `'kanban/pre-complete'` and rejecting transitions if task axioms or governing colocated checks are not `SATISFIED`.
  - Model-facing engineering tools `attach_proof` and `verify_task_axioms` in `@deepseek-ai/dsh-tool-axiom`, registered into `ctx.tools` on the agent plane via `defineTool`.
  - Automated auto-todo request generation at `~/.hermes/auto-todos/<task_id>-unsatisfied-todo.md` upon sweep failure, notifying the board via comments and events.
  - Task continuation packet compilation (`M-010`) summarizing unsatisfied axioms, blockers, and next actions for seamless worker restarts.

- **What it deliberately does NOT own**:
  - Colocated `AGENTS.md` instruction discovery, candidate path gathering, and `task-axioms/<id>.json` document persistence (owned by `@deepseek-ai/dsh-axiom`, Plan 03).
  - Model-facing candidate path discovery tool `resolve_candidate_axioms` (owned by `@deepseek-ai/dsh-axiom`, Plan 03).
  - Runtime prompt baseline injection of touched files (owned by `@deepseek-ai/dsh-agent-instructions`, reused).
  - Kanban card state machine storage, SQLite schema, `writeTxn`, and claim locks (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Model kanban tools (`kanban_create`, `kanban_complete`, `kanban_show`) (owned by `@deepseek-ai/dsh-tool-kanban`, Plan 02).
  - Git worktree provisioning, branch checkouts, and commit pinning (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Cryptographic test hashing and file modification guards (owned by `@deepseek-ai/dsh-guard-test-pinning`, Plan 09).
  - Worktree merge pipeline and GitHub PR synchronization (owned by `@deepseek-ai/dsh-integrator`, Plan 10).
  - Outcome ledger persistence and founder milestone tracking (owned by `@deepseek-ai/dsh-ledger`, Plan 13).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-axiom-verifier`: **Service Provider & Event Hook**. Subclasses `Service` from `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:7-8`), registers `ctx.axiomVerifier`, and subscribes to host-plane serial event `'kanban/pre-complete'`.
  - *Justification*: Verification must be callable programmatically across host subsystems (Kanban completion gate, worker tools, supervisor watchdog, PR merge engine). Modeling it as a Cordis Service guarantees unified caching, lifecycle management, and clean dependency injection (`fs`, `shell`, `axioms`).
- `@deepseek-ai/dsh-tool-axiom`: **Consumer**. Function plugin named-exporting `name`, `inject`, `Config`, and `apply` (`packages/AGENTS.md:5`). Consumes `tools`, `axioms`, and `axiomVerifier` to register `attach_proof` and `verify_task_axioms` via `ctx.tools.register()`.
  - *Justification*: Model-facing tools must register into the agent's scoped tool registry (`ctx.tools`). A consumer plugin decouples model schema presentation from host verification and storage engines.

### 2.2 Host Plane vs Agent Plane Separation
- **Host Plane (`base.cordis.yml` patch layer)**:
  - `@deepseek-ai/dsh-axiom-verifier` resides exclusively on the Host Plane (`PRESET-RULES.md:6`).
  - *Justification*: Predicate sweeps require host capabilities (`ctx.shell`, `ctx.fs`) and operate on shared task axiom records (`~/.hermes/task-axioms/*.json`). The completion gate must intercept transitions triggered by any actor before committing state.
- **Agent Plane (`presets/hermes-worker/agent.cordis.yml`)**:
  - `@deepseek-ai/dsh-tool-axiom` resides on the Agent Plane inside the worker preset (`PRESET-RULES.md:5`).
  - *Justification*: Model tools are scoped to the active agent session. Per **PRESET-RULE 4** (`PRESET-RULES.md:10`), rows that only register into host registries (`ctx.tools.register`) and provide no Cordis service need no `isolate` realm.

### 2.3 Decoupling Gating from Kanban Substrate
The No Unproven Done invariant (`INV-01`) is enforced strictly through published Cordis events and public service APIs. `@deepseek-ai/dsh-axiom-verifier` **never** imports `@deepseek-ai/dsh-kanban-sqlite`, executes no SQL, and never touches database tables directly:
1. `KanbanStore` declares `'kanban/pre-complete': (task: Task) => Promise<void> | void` in Cordis `Events` (`plans/01-kanban-substrate.md` §5.2).
2. Before committing a status transition to `done`, `KanbanStore.transitionTask` awaits `ctx.serial('kanban/pre-complete', task)`.
3. In Cordis, `ctx.serial` runs registered listeners sequentially; if any listener throws, the promise rejects immediately, aborting the transition.
4. `@deepseek-ai/dsh-axiom-verifier` listens to `'kanban/pre-complete'` and invokes `ctx.axiomVerifier.assertTaskProven(task.id, task.workspace_path)`.
5. If any task axiom is unproven, unmet, or violated, or if any governing colocated `AGENTS.md` check fails, the listener throws `UnprovenDoneError`, automatically aborting the transaction before SQLite changes occur.
6. Downstream components (e.g. `@deepseek-ai/dsh-integrator`, Plan 10) invoke `ctx.axiomVerifier.assertTaskProven(taskId)` as a public service method prior to git merge commit generation.

### 2.4 Integration with Colocated Axioms
Per `AXIOM-COLOCATION.md` and Plan 03 (`plans/03-axiom-subsystem.md`), machine-checkable axioms are declared in `AGENTS.md` files next to the code they govern. The sweeper evaluates both tiers:
1. **Card-Level Task Axioms**: Ephemeral contracts defined for the card in `~/.hermes/task-axioms/<row_id>.json`, requiring attached evidence proofs.
2. **Repository-Level Colocated Axioms**: Permanent machine-checkable `CheckableAxiom` blocks resolved from ancestor `AGENTS.md` files for touched paths via `ctx.axioms.getCheckableAxiomsForPaths(paths)` or `ctx.axioms.analyzeDiffImpact(workdir)`.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| 9 declarative predicate evaluators (§2.5) | Yes (`PredicateEvaluator`) | None | Deterministic evaluation engine |
| Attributable shell exit code check (INV-11, §6.10) | Yes (`assertAttributableShellCommand`) | `@deepseek-ai/dsh-shell` (reused) | Rejects masked shell syntax before run |
| Sweeper rule: worker reports, sweeper decides (INV-10, §2.5) | Yes (`AxiomVerifier.verifyTask`) | None | Reverts falsified claims to ACTIVE |
| Model tool `attach_proof` (§2.5) | Yes (`@deepseek-ai/dsh-tool-axiom`) | None | Structured proof attachment |
| Model tool `verify_task_axioms` (§2.5) | Yes (`@deepseek-ai/dsh-tool-axiom`) | None | On-demand verification tool |
| No Unproven Done gate (INV-01, M-009, §2.5, §9.1) | Yes (`kanban/pre-complete` listener) | None | Fail-closed completion gate |
| Colocated `AGENTS.md` checkable evaluation (§2.5) | Yes (`verifyCheckableAxioms`) | `@deepseek-ai/dsh-axiom` (Plan 03) | Plan 03 parses/resolves; Plan 04 evaluates |
| Auto-todo generation on sweep failure (§2.5) | Yes (`AutoTodoGenerator`) | `@deepseek-ai/dsh-ledger` (Plan 13) | Markdown request written; ledger tracks |
| Task continuation packet generation (M-010, §2.4) | Yes (`compileContinuation`) | None | Worker resumption state summary |
| Task axiom JSON schema & storage (§2.2.1) | Consumes `ctx.axioms` | `@deepseek-ai/dsh-axiom` (Plan 03) | Storage handled by AxiomRegistry |
| Kanban card lifecycle & claim locks (§4.1-§4.3) | Consumes events & API | `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) | SQLite transactional state machine |
| Worktree isolation & commit pinning (§6.2) | No | `@deepseek-ai/dsh-worktree-local` (Plan 07) | Git worktree management |
| Pre-merge draft PR verification (§6.9) | Consumes `ctx.axiomVerifier` | `@deepseek-ai/dsh-integrator` (Plan 10) | Integrator invokes sweeper at merge |

## 4. Proposed Package / File Layout

```
packages/axiom/
├── axiom-verifier/                       # @deepseek-ai/dsh-axiom-verifier (Service Provider)
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       ├── index.ts                      # AxiomVerifier Service class, config, apply, Cordis exports
│       ├── types.ts                      # Pure type declarations (CheckResult, TaskVerificationSummary, etc.)
│       ├── errors.ts                     # UnprovenDoneError, UnattributableCommandError
│       ├── anti-cheat.ts                 # INV-11 attributable shell parser (rejects || true, ; exit 0, &)
│       ├── auto-todo.ts                  # Auto-todo markdown file generator and kanban comment poster
│       ├── continuation.ts               # M-010 minimal continuation packet compiler
│       ├── evaluators/
│       │   ├── index.ts                  # Predicate evaluator dispatcher
│       │   ├── fs-predicates.ts          # path_exists, path_absent, forbidden_directory, forbidden_file_pattern
│       │   ├── content-predicates.ts     # grep_absent, required_symbol, required_reference, max_lines
│       │   ├── import-predicates.ts      # forbidden_import AST and module import syntax inspector
│       │   └── test-predicate.ts         # test shell runner via ctx.shell with INV-11 verification
│       └── gates/
│           └── no-unproven-done.ts       # INV-01 gate listener intercepting kanban/pre-complete
│   └── tests/
│       ├── evaluators-fs.spec.ts         # Tests path_exists, path_absent, forbidden_directory, forbidden_pattern
│       ├── evaluators-content.spec.ts    # Tests grep_absent, required_symbol, required_reference, max_lines
│       ├── evaluators-import.spec.ts     # Tests forbidden_import AST inspection and edge cases
│       ├── evaluators-test.spec.ts       # Tests shell command execution, timeout, cwd, and abort signal
│       ├── anti-cheat.spec.ts            # INV-11 rejection of masked exit codes (|| true, ; exit 0, unpiped tee)
│       ├── no-self-grading.spec.ts       # INV-10 sweeper override reverting falsified claims to ACTIVE
│       ├── no-unproven-done.spec.ts      # INV-01 kanban/pre-complete rejection and transaction abort
│       ├── colocated-checks.spec.ts      # Evaluates CheckableAxiom blocks resolved from AGENTS.md chains
│       ├── auto-todo.spec.ts             # Auto-todo markdown generation on sweep failure
│       └── continuation.spec.ts          # M-010 continuation JSON compilation
└── tool-axiom/                           # @deepseek-ai/dsh-tool-axiom (Consumer Tools)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── index.ts                      # Function plugin: name, inject, Config, apply
        ├── config.ts                     # ToolAxiomConfig Schemastery schema
        ├── presentation.ts               # Pure UI presenters for attach_proof and verify_task_axioms
        └── tools/
            ├── attach-proof.ts           # attach_proof tool definition (defineTool)
            └── verify-axioms.ts          # verify_task_axioms tool definition (defineTool)
    └── tests/
        ├── attach-proof.spec.ts          # attach_proof validation, ProofId generation, document persistence
        ├── verify-axioms.spec.ts         # verify_task_axioms invocation and structured summary reporting
        ├── presentation.spec.ts          # Pure presenters soft validation on replay
        └── scoped-registration.spec.ts   # ScopedLayers preset mounting and isolation tests
```

## 5. Public Contracts

### 5.1 Verification Engine Domain Models (`packages/axiom/axiom-verifier/src/types.ts`)
*Per `packages/AGENTS.md:24`, this file contains only types — no runtime code.*

```typescript
import type { CheckableAxiom, PredicateCheck, TaskAxiomId, TaskAxiomStatus } from '@deepseek-ai/dsh-axiom'

export interface CheckResult {
  readonly check: PredicateCheck
  readonly passed: boolean
  readonly exitCode?: number | null
  readonly stdout?: string
  readonly stderr?: string
  readonly message?: string
  readonly executionTimeMs: number
}

export interface TaskAxiomVerificationResult {
  readonly axiomId: TaskAxiomId
  readonly previousStatus: TaskAxiomStatus
  readonly newStatus: TaskAxiomStatus
  readonly passed: boolean
  readonly blocker?: string
  readonly checkResults: readonly CheckResult[]
  readonly selfGradingReverted: boolean
}

export interface ColocatedAxiomVerificationResult {
  readonly axiom: CheckableAxiom
  readonly passed: boolean
  readonly checkResults: readonly CheckResult[]
}

export interface TaskVerificationSummary {
  readonly taskId: string
  readonly totalAxioms: number
  readonly satisfiedCount: number
  readonly violatedCount: number
  readonly activeCount: number
  readonly allSatisfied: boolean
  readonly results: readonly TaskAxiomVerificationResult[]
  readonly colocatedResults: readonly ColocatedAxiomVerificationResult[]
  readonly evaluatedAt: string
}

export interface VerifyOptions {
  workdir?: string
  signal?: AbortSignal
  generateAutoTodos?: boolean
  touchedPaths?: readonly string[]
}

export interface ContinuationPacket {
  readonly taskId: string
  readonly compiledAt: string
  readonly unsatisfiedAxioms: readonly {
    readonly id: TaskAxiomId
    readonly statement: string
    readonly status: TaskAxiomStatus
    readonly blocker: string
  }[]
  readonly nextAction: string
}
```

### 5.2 Error Classes (`packages/axiom/axiom-verifier/src/errors.ts`)

```typescript
import type { TaskAxiomId } from '@deepseek-ai/dsh-axiom'

export class UnprovenDoneError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly unprovenAxioms: readonly TaskAxiomId[],
    public readonly reason: string,
  ) {
    super(`INV-01 Violation: Task "${taskId}" cannot transition to done: ${reason} (unproven: ${unprovenAxioms.join(', ') || 'none'})`)
    this.name = 'UnprovenDoneError'
  }
}

export class UnattributableCommandError extends Error {
  constructor(public readonly command: string, public readonly reason: string) {
    super(`INV-11 Violation: Command "${command}" masks exit status: ${reason}`)
    this.name = 'UnattributableCommandError'
  }
}
```

### 5.3 Service Definition & Cordis Events (`packages/axiom/axiom-verifier/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type { CheckableAxiom, PredicateCheck, TaskAxiomId } from '@deepseek-ai/dsh-axiom'
import type { Task } from '@deepseek-ai/dsh-kanban'
import type { CheckResult, ContinuationPacket, TaskVerificationSummary, VerifyOptions } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { axiomVerifier: AxiomVerifier }
  interface Events {
    'axioms/verified': (summary: TaskVerificationSummary) => void
    'axioms/unproven-done-blocked': (event: { taskId: string; unprovenAxioms: readonly TaskAxiomId[]; reason: string }) => void
    'kanban/pre-complete': (task: Task) => Promise<void> | void
  }
}

export abstract class AxiomVerifier extends Service {
  constructor(ctx: Context) { super(ctx, 'axiomVerifier', true) }
  abstract verifyTask(taskId: string, opts?: VerifyOptions): Promise<TaskVerificationSummary>
  abstract verifyCheckableAxioms(axioms: readonly CheckableAxiom[], workdir: string, signal?: AbortSignal): Promise<readonly CheckResult[]>
  abstract evaluatePredicate(check: PredicateCheck, targetDir: string, signal?: AbortSignal): Promise<CheckResult>
  abstract assertTaskProven(taskId: string, workdir?: string): Promise<void>
  abstract compileContinuation(taskId: string): Promise<ContinuationPacket>
}
export default AxiomVerifier
```

### 5.4 Anti-Cheat Shell Attributability (`packages/axiom/axiom-verifier/src/anti-cheat.ts`)
Enforces Spec §6.10 and `INV-11` on shell commands before execution:

```typescript
import { UnattributableCommandError } from './errors.ts'

export function assertAttributableShellCommand(command: string): void {
  const trimmed = command.trim()
  if (/\|\|\s*(?:true|:|exit\s+0)\b/.test(trimmed)) {
    throw new UnattributableCommandError(trimmed, 'Contains "|| true", "|| :", or "|| exit 0"')
  }
  if (/;\s*exit\s+0\b/.test(trimmed)) {
    throw new UnattributableCommandError(trimmed, 'Contains "; exit 0"')
  }
  if (/(?:^|[^&])&(?:[^&]|$)/.test(trimmed)) {
    throw new UnattributableCommandError(trimmed, 'Contains backgrounding operator "&"')
  }
  if (/\|(?!\s*\|)/.test(trimmed) && !/\bsets+-[eE]*os+pipefail\b/.test(trimmed)) {
    throw new UnattributableCommandError(trimmed, 'Piped commands must declare "set -o pipefail"')
  }
}
```

### 5.5 Test Predicate Shell Seam (`packages/axiom/axiom-verifier/src/evaluators/test-predicate.ts`)
Interacts directly with `ctx.shell` (`packages/shell/shell/src/index.ts:84-92`, `types.ts:38-138`):

```typescript
import type { Context } from '@deepseek-ai/cordis'
import type { PredicateCheck } from '@deepseek-ai/dsh-axiom'
import { assertAttributableShellCommand } from '../anti-cheat.ts'
import type { CheckResult } from '../types.ts'

export async function evaluateTestPredicate(
  ctx: Context, check: PredicateCheck, workdir: string, signal?: AbortSignal,
): Promise<CheckResult> {
  const startTime = Date.now()
  const command = check.command ?? ''
  try {
    assertAttributableShellCommand(command)
  } catch (err: unknown) {
    return {
      check, passed: false, exitCode: 126,
      message: err instanceof Error ? err.message : String(err),
      executionTimeMs: Date.now() - startTime,
    }
  }
  const spec = ctx.shell.resolve({ command, workdir, timeoutMs: check.timeoutMs ?? 30000, signal })
  const result = await ctx.shell.run(spec)
  const passed = result.exitCode === 0 && !result.timedOut && !result.aborted
  return {
    check, passed, exitCode: result.exitCode,
    stdout: result.stdout.text, stderr: result.stderr.text,
    message: result.timedOut ? 'Command timed out' : result.aborted ? 'Command aborted' : undefined,
    executionTimeMs: Date.now() - startTime,
  }
}
```

### 5.6 Model-Facing Tool Catalog (`packages/axiom/tool-axiom/src/tools/`)
Constructed via `defineTool` (`packages/core/tools/src/schema.ts:545-617`):

#### Tool 1: `attach_proof` (`packages/axiom/tool-axiom/src/tools/attach-proof.ts`)

```typescript
import type { Context } from '@deepseek-ai/cordis'
import { proofId, taskAxiomId, type ProofResult, type ProofType } from '@deepseek-ai/dsh-axiom'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const attachProofTool = (ctx: Context) => defineTool({
  name: 'attach_proof',
  description: 'Attach structured, attributable verification evidence to an active task axiom contract.',
  parameters: {
    task_id: { type: 'string', description: 'Unique identifier of the target kanban task' },
    axiom_id: { type: 'string', description: 'Identifier of the task axiom being proven (e.g. t_1001-A1)' },
    type: {
      type: 'string',
      enum: ['test', 'runtime-observation', 'static-analysis', 'diff', 'inspection'],
      description: 'Methodology used to generate the evidence proof',
    },
    artifact: { type: 'string', description: 'File path, git commit SHA, or execution log containing the evidence' },
    result: {
      type: 'string',
      enum: ['passed', 'failed', 'inconclusive'],
      description: 'Outcome of the evidence execution',
    },
    detail: { type: 'string', description: 'Human-readable justification, command executed, or output snippet' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' }, proofId: { type: 'string' },
        axiomId: { type: 'string' }, totalProofs: { type: 'integer' },
      },
      required: ['ok', 'proofId', 'axiomId', 'totalProofs'],
      additionalProperties: false,
    },
    render: (args, val) => [{ type: 'text', text: `Proof ${val.proofId} attached to axiom ${args.axiom_id} (result: ${args.result}). Total: ${val.totalProofs}.` }],
  },
  async execute(args) {
    const tAxiomId = taskAxiomId(args.axiom_id)
    const doc = await ctx.axioms.getTaskAxioms(args.task_id)
    if (!doc) throw new Error(`Task axiom document not found for task "${args.task_id}"`)
    const targetAxiom = doc.axioms.find(a => a.id === tAxiomId)
    if (!targetAxiom) throw new Error(`Axiom "${args.axiom_id}" not found on task "${args.task_id}"`)

    const newProofId = proofId(`${args.task_id}-P${doc.proofs.length + 1}`)
    const record = {
      id: newProofId, axiom: tAxiomId, type: args.type as ProofType,
      artifact: args.artifact, result: args.result as ProofResult,
      detail: args.detail, when: new Date().toISOString(),
    }
    const updatedDoc = {
      ...doc, proofs: [...doc.proofs, record],
      axioms: doc.axioms.map(a => a.id === tAxiomId ? { ...a, proofs: [...a.proofs, newProofId] } : a),
    }
    await ctx.axioms.saveTaskAxioms(updatedDoc)
    return { ok: true, proofId: newProofId, axiomId: tAxiomId, totalProofs: updatedDoc.proofs.length }
  },
})
```

#### Tool 2: `verify_task_axioms` (`packages/axiom/tool-axiom/src/tools/verify-axioms.ts`)

```typescript
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const verifyTaskAxiomsTool = (ctx: Context) => defineTool({
  name: 'verify_task_axioms',
  description: 'Trigger a deterministic verification sweep across all declarative predicates and colocated AGENTS.md checks for a task.',
  parameters: {
    task_id: { type: 'string', description: 'Unique identifier of the target kanban task' },
    workdir: { type: 'string', description: 'Optional workspace root directory override' },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' }, allSatisfied: { type: 'boolean' },
        totalAxioms: { type: 'integer' }, satisfiedCount: { type: 'integer' },
        violatedCount: { type: 'integer' }, activeCount: { type: 'integer' },
        summaryMessage: { type: 'string' },
      },
      required: ['taskId', 'allSatisfied', 'totalAxioms', 'satisfiedCount', 'violatedCount', 'activeCount', 'summaryMessage'],
      additionalProperties: false,
    },
    render: (args, val) => [{
      type: 'text',
      text: `Verification sweep for ${val.taskId}: ${val.allSatisfied ? 'ALL SATISFIED' : 'UNMET AXIOMS'} (${val.satisfiedCount}/${val.totalAxioms} satisfied). ${val.summaryMessage}`,
    }],
  },
  async execute(args, exec) {
    const summary = await ctx.axiomVerifier.verifyTask(args.task_id, { workdir: args.workdir, signal: exec.signal })
    const summaryMessage = summary.allSatisfied
      ? 'All declarative predicate checks passed. Card is eligible for completion.'
      : `Failed checks: ${summary.results.filter(r => !r.passed).map(r => `${r.axiomId}: ${r.blocker ?? 'failed'}`).join('; ')}`
    return {
      taskId: summary.taskId, allSatisfied: summary.allSatisfied, totalAxioms: summary.totalAxioms,
      satisfiedCount: summary.satisfiedCount, violatedCount: summary.violatedCount,
      activeCount: summary.activeCount, summaryMessage,
    }
  },
})
```

### 5.7 Config Schemas

```typescript
import z from '@deepseek-ai/schemastery'

export interface AxiomVerifierConfig {
  defaultTimeoutMs?: number
  autoTodosDir?: string
}
export const AxiomVerifierConfig: z<AxiomVerifierConfig> = z.object({
  defaultTimeoutMs: z.number().default(30000),
  autoTodosDir: z.string().default('~/.hermes/auto-todos'),
})

export interface ToolAxiomConfig {
  autoVerifyOnProof?: boolean
}
export const ToolAxiomConfig: z<ToolAxiomConfig> = z.object({
  autoVerifyOnProof: z.boolean().default(false),
})
```

## 6. Lifecycle and Scoping

### 6.1 Service Provider Lifecycle (`@deepseek-ai/dsh-axiom-verifier`)
- **Plugin Registration**: Service class exported as default export.
- **Injected Services**: `static inject = ['fs', 'shell', 'axioms']`. Optional: `'kanban'` resolved via `ctx.get('kanban')` for collaboration comment posting.
- **Event Hook Registration**: In `apply()`, registers the `kanban/pre-complete` serial listener on `ctx`.
- **HMR / Disposal**: Disposing the plugin removes the service from `ctx.axiomVerifier`, unregisters the `'kanban/pre-complete'` hook via returned effect disposer, and cancels running shell processes.

### 6.2 Consumer Tool Lifecycle (`@deepseek-ai/dsh-tool-axiom`)
- **Plugin Registration**: Function plugin named-exporting `name = 'tool-axiom'`, `inject = ['tools', 'axioms', 'axiomVerifier']`, `Config`, and `apply` with no default export.
- **Scoping**: When mounted in an agent preset (`hermes-worker`), `ctx.tools.register()` inserts `attach_proof` and `verify_task_axioms` into the session's `ScopedLayers`.
- **Preset Isolation**: Sibling agent sessions without `dsh-tool-axiom` (e.g. `hermes-brain`) cannot see or call these tools. When the session terminates, the registration effect disposer removes the tools automatically.

## 7. Agent Preset Integration

In accordance with `PRESET-RULES.md`:
- `@deepseek-ai/dsh-axiom-verifier` is mounted on the **Host Plane** in `base.cordis.yml`.
- `@deepseek-ai/dsh-tool-axiom` is mounted on the **Agent Plane** in `presets/hermes-worker/agent.cordis.yml`.

```yaml
# packages/bundle/base/cordis.patch.yml (Host Plane)
- id: axiom-verifier
  name: '@deepseek-ai/dsh-axiom-verifier'
  inject: ['fs', 'shell', 'axioms']
  config:
    defaultTimeoutMs: 30000
    autoTodosDir: '~/.hermes/auto-todos'

# packages/preset/agent-presets/presets/hermes-worker/agent.cordis.yml (Agent Plane)
# Per PRESET-RULE 4: Registers into ctx.tools, no isolate realm needed.
- id: tool-axiom
  name: '@deepseek-ai/dsh-tool-axiom'
  inject: ['tools', 'axioms', 'axiomVerifier']
  config:
    autoVerifyOnProof: false
```

- **Tool Visibility**: Surfaced strictly to `hermes-worker`. Omitted from `hermes-brain` because the brain orchestrates tasks and does not write implementation code or attach test evidence.

## 8. Execution Flow

### 8.1 Proof Attachment and Verification Sweep (`INV-10`)

```
Model (hermes-worker)
  │
  ├──> tool/call: attach_proof({ task_id: "t_101", axiom_id: "t_101-A1", type: "test", ... })
  │      └──> ctx.axioms.saveTaskAxioms(updatedDoc) -> { ok: true, proofId: "t_101-P1" }
  │
  ├──> tool/call: verify_task_axioms({ task_id: "t_101" })
  │      │
  │      └──> ctx.axiomVerifier.verifyTask("t_101")
  │             ├──> Read task axioms document via ctx.axioms.getTaskAxioms("t_101")
  │             ├──> Resolve colocated AGENTS.md checks via ctx.axioms.getCheckableAxiomsForPaths(...)
  │             ├──> Evaluate PredicateChecks (fs, grep, AST, test) via ctx.shell
  │             ├──> Check Invariant INV-10 (No Self-Grading):
  │             │      If worker marked SATISFIED but check failed -> REVERT to ACTIVE
  │             │      If all checks pass & proof exists -> FLIP to SATISFIED
  │             ├──> ctx.axioms.saveTaskAxioms(evaluatedDoc)
  │             └──> ctx.emit('axioms/verified', summary)
```

### 8.2 Card Completion Interception (`INV-01` No Unproven Done)

```
Model (hermes-worker)
  │
  ├──> tool/call: kanban_complete({ task_id: "t_101", summary: "Implementation done" })
  │      │
  │      └──> delegates to ctx.kanban.transitionTask("t_101", "done")
  │             │
  │             ├──> KanbanStore awaits ctx.serial('kanban/pre-complete', task)
  │             │      │
  │             │      └──> dsh-axiom-verifier listener:
  │             │             ctx.axiomVerifier.assertTaskProven("t_101", task.workspace_path)
  │             │               ├──> Query doc = ctx.axioms.getTaskAxioms("t_101")
  │             │               ├──> Find axiom t_101-A2 status === 'ACTIVE' (unmet!)
  │             │               ├──> ctx.emit('axioms/unproven-done-blocked', { ... })
  │             │               └──> THROWS UnprovenDoneError("t_101", ["t_101-A2"])
  │             │
  │             └──> ABORTED! Status remains 'running'; error returned to caller
```

## 9. Error, Cancellation, and Lifecycle Behavior

- **Unattributable Shell Commands (`INV-11`)**:
  If a shell check contains `; exit 0`, `|| true`, `&`, or unpiped streams without `set -o pipefail`, `assertAttributableShellCommand` throws `UnattributableCommandError`. The check immediately registers as failed with exitCode 126, preventing cheat passes.
- **Timeout and Abort Propagation**:
  Every shell evaluation passes `timeoutMs` and `signal` to `ctx.shell.resolve()`. If the turn aborts or timeout triggers, `ctx.shell.run` terminates the process group cleanly.
- **Self-Grading Correction (`INV-10`)**:
  If a task axiom is manually flagged `SATISFIED` in JSON but its declarative checks evaluate to false or have no accepted proof, the sweeper resets it to `ACTIVE` with `blocker: "its predicate could not be evaluated"`, preventing agents from self-approving.
- **Fail-Closed Completion Gate (`INV-01`)**:
  If a card has no `TaskAxiomDocument`, or if any axiom is unmet or lacking proof, `assertTaskProven` throws `UnprovenDoneError`. The error propagates through `ctx.serial('kanban/pre-complete')`, halting `transitionTask` before SQLite updates occur.
- **Auto-Todo Generation on Sweep Failure**:
  When a sweep identifies violated or blocked axioms, `AutoTodoGenerator` writes an actionable markdown brief to `~/.hermes/auto-todos/<task_id>-unsatisfied-todo.md` and appends an `[AXIOM_SWEEPER_AUTO_TODO]` comment to the kanban card via `ctx.get('kanban')?.addComment()`.
- **Durable vs Ephemeral State**:
  Task axioms and proofs are persisted to disk at `~/.hermes/task-axioms/<id>.json`. Evaluator execution times and process handles are ephemeral.

## 10. Testing Strategy

All tests are implemented using Vitest in standard repository test suites:

- **Unit Tests (`packages/axiom/axiom-verifier/tests/`)**:
  - `evaluators-fs.spec.ts`: Tests `path_exists`, `path_absent`, `forbidden_directory`, and `forbidden_file_pattern` against mock `ctx.fs`.
  - `evaluators-content.spec.ts`: Tests `grep_absent`, `required_symbol`, `required_reference`, and `max_lines` against memory files.
  - `evaluators-import.spec.ts`: Tests `forbidden_import` parsing ES import statements, `require()`, and dynamic imports.
  - `evaluators-test.spec.ts`: Tests shell command execution via mock `ctx.shell`, verifying exit code extraction, stdout/stderr capture, and timeout enforcement.
  - `anti-cheat.spec.ts`: Tests `assertAttributableShellCommand` rejecting `|| true`, `; exit 0`, unmonitored pipes, and `&`.
  - `continuation.spec.ts`: Tests `compileContinuation` generating minimal JSON packets containing only unmet axioms.
- **Integration Tests (`packages/axiom/axiom-verifier/tests/`)**:
  - `no-self-grading.spec.ts`: Simulates a worker claiming `SATISFIED` without passing tests; verifies status reverts to `ACTIVE` (`INV-10`).
  - `no-unproven-done.spec.ts`: Mounts Cordis context with `KanbanStore` and `AxiomVerifier`; attempts `transitionTask(id, 'done')` with unsatisfied axioms; verifies transaction aborts and `UnprovenDoneError` is raised (`INV-01`).
  - `colocated-checks.spec.ts`: Loads a mock project with `AGENTS.md` containing ```` ```axiom ```` blocks; runs `verifyCheckableAxioms` and verifies enforcement across directories.
  - `auto-todo.spec.ts`: Verifies markdown file generation in `~/.hermes/auto-todos/` and comment posting on sweep failure.
- **Tool Tests (`packages/axiom/tool-axiom/tests/`)**:
  - `attach-proof.spec.ts`: Verifies `attach_proof` validates schemas, generates branded `ProofId`, and persists records to `ctx.axioms`.
  - `verify-axioms.spec.ts`: Verifies `verify_task_axioms` runs the sweeper and returns structured output blocks.
  - `presentation.spec.ts`: Verifies `presentCall` and `presentResult` render cleanly on replay without throwing.
  - `scoped-registration.spec.ts`: Verifies preset isolation: tools register under `hermes-worker` and are absent under `hermes-brain`.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| 9 deterministic predicate evaluators | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_verify.py:104-250` | Verification algorithms across 9 check types: `path_exists`, `path_absent`, `forbidden_file_pattern`, `forbidden_directory`, `grep_absent`, `required_symbol`, `required_reference`, `forbidden_import`, `max_lines`, and `test` (`check_command`), returning status codes and granular failure evidence. | Convert Python os.walk/fnmatch/regex calls to Node.js / TypeScript filesystem operations (`ctx.fs`), use `@typescript-eslint/parser` or TypeScript compiler API for `forbidden_import` AST inspection, and return typed `CheckResult` objects. | direct port |
| Attributable shell execution & masking rejection (`INV-11`) | `/home/sic/Downloads/hermes-agent-main/tools/terminal_hints.py:83-130` | Regex patterns and heuristics identifying masked shell exit codes: unmonitored pipes to passthrough consumers (`tail|head|cat|tee`), explicit status-swallowing fallbacks (`|| true`, `|| :`, `|| echo`), and missing pipefail. | Upgrade from advisory terminal warnings to strict pre-execution validator (`assertAttributableShellCommand`) throwing `UnattributableCommandError` when test commands attempt to mask non-zero exit codes. | port with adaptation |
| Anti-self-grading enforcement (`INV-10`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:173-202` | Verification override algorithm: re-run all checkable predicates on task axioms; if the worker claimed `SATISFIED` but predicates fail or cannot reproduce, revert status to `ACTIVE` and record the attributable blocker. | Port Python dictionary mutation to TypeScript `AxiomVerifier.verifyTask()` updating records in `ctx.storageDomain` (`task_axioms` domain) and emitting Cordis verification events. | direct port |
| Fail-closed "No Unproven Done" gate (`INV-01`, `M-009`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:205-232`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:80-140` | Deterministic gating check ensuring all required task axioms have valid passing proofs, no axiom is `BLOCKED` or `VIOLATED`, and all governing colocated checks pass. | Bind to Cordis serial event hook `'kanban/pre-complete'` throwing `UnprovenDoneError` to abort SQLite transactions before a task status commits to `done`. | port with adaptation |
| Model tools: `attach_proof` and `verify_task_axioms` | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:130-170, 360-440` | Proof attachment semantics (binding proof type, artifact path, test command, and result to an axiom ID) and on-demand sweep execution and reporting. | Port CLI flags and argument parsers to `defineTool` schemas on `ctx.tools` on the agent plane, returning structured JSON/markdown verification summaries. | port with adaptation |
| Colocated `AGENTS.md` checkable axiom sweep | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_verify.py:1-40, 270-350` | Batch verification runner: resolving target files, executing all declared checks in sequence, and compiling pass/fail results with structured failure evidence. | Replace compiled central index reads with machine-checkable blocks extracted from colocated `AGENTS.md` chains via `ctx.axioms.getCheckableAxiomsForPaths()`. | port with adaptation |
| Automated escalation / auto-todo generation on sweep failure | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1210-1255, 1800-1830` | Auto-todo markdown formatting: generating structured briefs detailing failing axioms, check outputs, and logging `[AXIOM_SWEEPER_AUTO_TODO]` comments to the Kanban card. | Port Python CLI scripts to `AutoTodoGenerator` writing markdown files under `~/.hermes/auto-todos/` and calling `ctx.kanban.addComment()`. | port with adaptation |
| Task continuation packet compiler (`M-010`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:13-16, 205-232`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:770-785` | Extraction of unsatisfied axioms, recorded blockers, and prior run summaries into a minimal resumption packet for subsequent worker sessions. | Convert Python script output to `compileContinuation` pure function producing typed JSON continuation packets for worker restart injection. | direct port |

The single most valuable capability to port is the 9 deterministic predicate evaluation functions (`truth_verify.py:104-250`). They replace subjective agent self-assessments with rigorous AST, file, and test verifications, providing the reproducible ground truth necessary to enforce `INV-10` (No Self-Grading) and `INV-01` (No Unproven Done).

## 11. Implementation Steps

1. **Create Package `@deepseek-ai/dsh-axiom-verifier`** at `packages/axiom/axiom-verifier/`:
   - `package.json`: ESM package depending on `@deepseek-ai/cordis`, `@deepseek-ai/dsh-axiom`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-shell`, `@deepseek-ai/dsh-kanban`.
   - `src/types.ts`: Define `CheckResult`, `TaskAxiomVerificationResult`, `ColocatedAxiomVerificationResult`, `TaskVerificationSummary`, `VerifyOptions`, `ContinuationPacket`.
   - `src/errors.ts`: Implement `UnprovenDoneError` and `UnattributableCommandError`.
   - `src/anti-cheat.ts`: Implement `assertAttributableShellCommand` (`INV-11`).
   - `src/evaluators/`: Implement 9 predicate evaluators across `fs-predicates.ts`, `content-predicates.ts`, `import-predicates.ts`, and `test-predicate.ts`.
   - `src/gates/no-unproven-done.ts`: Implement `kanban/pre-complete` serial listener and `assertTaskProven` (`INV-01`).
   - `src/auto-todo.ts`: Implement `AutoTodoGenerator` for auto-todo markdown creation and kanban comment emission.
   - `src/continuation.ts`: Implement `compileContinuation` packet compiler (`M-010`).
   - `src/index.ts`: Export `AxiomVerifier` Service class, register service on `ctx.axiomVerifier`, and wire event listeners.

2. **Create Package `@deepseek-ai/dsh-tool-axiom`** at `packages/axiom/tool-axiom/`:
   - `package.json`: ESM package depending on `@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-axiom`, `@deepseek-ai/dsh-axiom-verifier`.
   - `src/config.ts`: Define `ToolAxiomConfig` schema using Schemastery.
   - `src/presentation.ts`: Implement `presentCall` and `presentResult` renderers for tools.
   - `src/tools/attach-proof.ts`: Define `attach_proof` tool using `defineTool`.
   - `src/tools/verify-axioms.ts`: Define `verify_task_axioms` tool using `defineTool`.
   - `src/index.ts`: Implement function plugin exporting `name`, `inject`, `Config`, and `apply`.

3. **Preset and Bundle Configuration**:
   - Add `@deepseek-ai/dsh-axiom-verifier` to host bundle patch (`packages/bundle/base/cordis.patch.yml`).
   - Add `@deepseek-ai/dsh-tool-axiom` row to `presets/hermes-worker/agent.cordis.yml`.

4. **Testing and Verification**:
   - Run Vitest across `packages/axiom/axiom-verifier/tests/` and `packages/axiom/tool-axiom/tests/`.
   - Verify 100% pass rate on `INV-01`, `INV-10`, and `INV-11` invariant suites.

## 12. Acceptance Criteria

- [ ] All 9 declarative predicate checks (`path_exists`, `path_absent`, `forbidden_file_pattern`, `grep_absent`, `required_symbol`, `required_reference`, `forbidden_import`, `max_lines`, `test`) execute deterministically via `ctx.fs` and `ctx.shell`.
- [ ] Invariant `INV-11` is enforced: `assertAttributableShellCommand` rejects any command containing `|| true`, `|| :`, `; exit 0`, `&`, or unpiped streams without `set -o pipefail`.
- [ ] Invariant `INV-10` is enforced: If a worker claims an axiom is `SATISFIED` but its predicate check fails on disk, `verifyTask` resets status to `ACTIVE` with blocker: `"its predicate could not be evaluated"`.
- [ ] Invariant `INV-01` / `M-009` is enforced: Any attempt to transition a task to `done` while any task axiom is unproven, unmet, or violated triggers an immediate `UnprovenDoneError` during `kanban/pre-complete`, aborting the completion sequence.
- [ ] Card gating decouples cleanly from storage: `@deepseek-ai/dsh-axiom-verifier` interacts with Kanban strictly through `kanban/pre-complete` and public `KanbanStore` methods, with zero SQLite dependencies.
- [ ] Machine-checkable `CheckableAxiom` blocks resolved from colocated `AGENTS.md` files (Plan 03) are evaluated during sweeps alongside card task axioms.
- [ ] Model tool `attach_proof` validates arguments, attaches `ProofRecord` with branded `ProofId`, and persists updates to `ctx.axioms`.
- [ ] Model tool `verify_task_axioms` executes on-demand sweeps and returns structured pass/fail summaries.
- [ ] Sweep failures write auto-todo markdown briefs to `~/.hermes/auto-todos/<task_id>-unsatisfied-todo.md` and log `[AXIOM_SWEEPER_AUTO_TODO]` comments on the card.
- [ ] Worker restart helper `compileContinuation` compiles minimal JSON continuation packets matching Spec `M-010`.
- [ ] Preset scoping honors `PRESET-RULES.md`: `dsh-tool-axiom` is visible in `hermes-worker` sessions and completely inaccessible in `hermes-brain`.

## 13. Deviation from the Mapping

- **Colocated `AGENTS.md` Integration**: Conforming to `AXIOM-COLOCATION.md` and Plan 03, the sweeper evaluates machine-checkable `CheckableAxiom` blocks declared in colocated `AGENTS.md` files resolved via `ctx.axioms.getCheckableAxiomsForPaths` and `ctx.axioms.analyzeDiffImpact`, superseding references to a central truth tree (`.hermes/truth/`).
- **Package Sibling Contracts**: The verifier depends directly on `@deepseek-ai/dsh-axiom` (Plan 03), which consolidated `dsh-axiom-local` and eliminated `dsh-axiom-context`.

## Review fixes applied

- REVIEW-contracts #1: Cited `'kanban/pre-complete': (task: Task) => Promise<void> | void` serial hook contract identically with plans 01 and 12 for enforcing `INV-01` (No Unproven Done).
- Added `## Port sources` section detailing source mappings from Hermes repositories (`truth_verify.py`, `terminal_hints.py`, `task_axioms.py`, `supervise.py`, and `merge_card.py`) to accelerate axiom verifier implementation.
