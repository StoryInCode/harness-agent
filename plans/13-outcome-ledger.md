# 13 — Outcome Ledger & Founder Milestone Tracking

## Features

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

## 1. Purpose

`@deepseek-ai/dsh-ledger` establishes the durable founder milestone and outcome tracking substrate for autonomous software engineering in StoryInCode (Spec §5.1, §5.3, §5.10, §5.11). It serves as the single source of truth for high-level project objectives, decoupling founder requirements from transient Kanban task queues and ephemeral agent turn sessions.

- **What it owns**:
  - The `ledger` capability seam (`OutcomeLedger` Service class in `@deepseek-ai/dsh-ledger` extending `@deepseek-ai/cordis.Service`).
  - Durable milestone outcome documents stored as human-readable Markdown at `~/.hermes/task-requested/<slug>.md`.
  - The machine-readable milestone registry and task binding catalog at `~/.hermes/task-requested/bindings.json`.
  - Bidirectional mapping between founder outcomes and operational Kanban cards (`tasks.id` in `~/.hermes/kanban.db`).
  - Strict Markdown document structure: `# Task: <Title>`, `## Pending`, `## Archived`, and `## Done` sections.
  - Model-facing tools `ledger_show` and `ledger_update` surfaced to the orchestrator agent (`hermes-brain`).
  - Objective verification logic for Spec §5.10 ("Are the todos done?") and Spec §5.11 milestone closure.
  - Cryptographic witness verification: proving all governing axioms of a milestone outcome are witnessed by landed Git merge commit SHAs (`INV-01`).
  - Formatting and appending immutable satisfier blocks upon milestone completion (`Satisfier: <taskId> (done); <Commit SHA>; <Proof>`).
  - Auto-todo issue generation at `~/.hermes/task-requested/auto-todos/<task_id>.md` upon background sweeper failures (Spec §2.5).
  - System-prompt intake contract injection: enforcing the mandatory 4-point statement (Spec §5.1) on orchestrator agents.

- **What it deliberately does NOT own**:
  - Operational Kanban card state, claiming, CAS transitions, or DAG link storage (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Model-facing card creation and inspection tools (`kanban_create`, `kanban_list`) (owned by `@deepseek-ai/dsh-tool-kanban`, Plan 02).
  - Colocated repository axioms, candidate chains, or task axiom JSON schema (owned by `@deepseek-ai/dsh-axiom`, Plan 03).
  - Low-level predicate evaluation, attributable shell execution, or AST inspection (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Background watchdog timers, worker stall monitoring, circuit breaker tripping, or 429 quota walls (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).
  - Git worktree allocation, branch isolation, or dirty diff inspection (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Git merge commit landing, draft PR authoring, or GitHub API interactions (owned by `@deepseek-ai/dsh-integrator`, Plan 10).
  - Ephemeral turn-scoped interactive checklists (owned by `@deepseek-ai/dsh-tool-todo`, existing Harness module).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-ledger`: **Service Definition & Provider**.
  - Subclasses Cordis `Service` as `OutcomeLedger extends Service`.
  - Merges `interface Context { ledger: OutcomeLedger }` into `@deepseek-ai/cordis`.
  - Injects host infrastructure: `['fs', 'storageDomain']`.
  - Registered on the Host Plane (`packages/bundle/base/cordis.patch.yml`).
- Consumer & Model-Facing Tools: **Model-facing Tools & Prompt Contributor**.
  - Registers model-facing tools `ledger_show` and `ledger_update` on `ctx.tools` via `defineTool`.
  - Contributes `ledger:intake-policy` prompt section to `ctx.systemPrompt`.
  - Surfaced to `hermes-brain` preset via standard preset rows.

### 2.2 Host Plane vs Agent Plane Separation
- **Host Plane (`base.cordis.yml` patch layer)**:
  `OutcomeLedger` must reside strictly on the Host Plane (`PRESET-RULES.md:6, 8`). Milestone outcomes coordinate work across multiple agent sessions, independent worktrees, background supervisor daemons, and multi-week project trajectories. Storing the ledger on the host plane enables:
  1. The autonomous supervisor daemon (`ctx.supervisor`, Plan 12) to inspect linked milestone status upon `integrator/merged` events without an active user session.
  2. The axiom verification sweeper (`ctx.axiomVerifier`, Plan 04) to generate auto-todos upon verification failure during background sweeps.
  3. External interoperability with legacy CLI and maintenance tools (`supervise.py`, `merge_card.py`).
- **Agent Plane (`presets/hermes-brain/agent.cordis.yml`)**:
  The orchestrator preset carries the tool definitions (`ledger_show`, `ledger_update`) and system prompt section (`ledger:intake-policy`) via `@deepseek-ai/dsh-tool-ledger`. Per **PRESET-RULE 4** (`PRESET-RULES.md:10`), rows that only register into host registries (`ctx.tools`, `ctx.systemPrompt`) and provide no Cordis service require no `isolate` realm. Workers (`hermes-worker`) omit these tools entirely, enforcing role boundary separation.
- **Implementation Order Prerequisite**:
  Plan 13 is implemented *prior* to Plan 12 (`plans/12-supervisor-and-watchdog.md`). This resolves the implementation-order inversion, ensuring `OutcomeLedger` is available on `ctx.ledger` when Plan 12 builds and tests its `MilestoneClosureValidator`.

### 2.3 Deep Architectural Evaluation: Reusability of Existing `todo` and `goal` Packages

Before specifying `@deepseek-ai/dsh-ledger`, the existing Harness modules in `packages/todo/**` and `packages/goal/**` were evaluated against the Spec §5.3, §5.10, and §5.11 requirements.

#### 1. Evaluation of `packages/todo/tool-todo`
- **Live Implementation Analysis**:
  - `packages/todo/tool-todo/src/types.ts:21-47`: Exposes `TodoItem` containing strictly `{ content: string, status: 'pending' | 'in_progress' | 'completed' }`. It has no item ID, no slug, no Definition of Done (DoD), no link to Kanban cards, no link to governing axioms, and no Git commit references.
  - `packages/todo/tool-todo/src/index.ts:134-145`: Registers `ctx.sessionProjections.register<'todos', TodoItem[] | null>`. It is explicitly designed as a *standing-plan fold*:
    ```typescript
    apply: (state, event) => {
      if (event.type === 'todo/write') return event.data.todos
      if (event.type === 'turn/start') return null
      return state
    }
    ```
    Every new turn (`turn/start`) wipes the state to `null`. State is entirely ephemeral and process-local.
  - `packages/todo/tool-todo/src/index.ts:205-209`: The execution handler explicitly enforces:
    ```typescript
    if (!exec.agent) {
      throw new Error('todo_write requires an owning agent session')
    }
    ```
    Non-agent callers (such as the autonomous supervisor daemon, integrator, or CLI) are rejected.
  - Whole-value overwrite: every call replaces the entire list (`packages/todo/tool-todo/src/index.ts:46-48`). There is no concept of incremental milestone tracking, partial status updates, or durable file persistence.
- **Verdict**: `packages/todo/tool-todo` is architecturally incapable of acting as the Outcome Ledger. Reusing it would corrupt its intended purpose (in-memory turn-level scratchpad) and violate the Harness session projection model.

#### 2. Evaluation of `packages/goal/goal` and `packages/goal/tool-goal`
- **Live Implementation Analysis**:
  - `packages/goal/goal/src/types.ts:59-140`: Tracks a single active conversational objective per session (`SessionProjectionStateMap['goal']`) with round caps (`roundsStarted`, `maxGoalRounds`) and continuation flags (`GoalActivation: 'armed' | 'disarmed'`).
  - `packages/goal/tool-goal/src/authority.ts:32`: Enforces `requireDirectHuman(exec)` — explicitly rejecting non-human callers and subagents.
  - Single-session convergence: `packages/goal/goal-round-driver` feeds synthetic prompts into the session loop until the single active goal completes. It cannot model a multi-milestone ledger containing dozens of discrete outcomes across weeks of development.
  - Zero disk durability: Goals live exclusively in `session.jsonl` event streams. There is no mapping to `~/.hermes/task-requested/<slug>.md`, no `bindings.json` index, and no cross-session visibility across separate worker worktrees.
- **Verdict**: `packages/goal` is built strictly for autonomous single-session turn-loop convergence. Adapting it for founder milestone tracking would break the goal driver, violate projection schemas, and contradict the human authority gate.

#### 3. Architectural Conclusion
The Outcome Ledger possesses a fundamentally distinct lifecycle: multi-session, cross-process, disk-backed, human-auditable, and cryptographically verified by landed Git commits. Neither `packages/todo` nor `packages/goal` can be reused or extended for this capability without violating core invariants. Therefore, `@deepseek-ai/dsh-ledger` stands as a dedicated package.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **§5.1**: Intake Gate & 4-Point Statement Contract | **Yes** (`PromptSection` `ledger:intake-policy`) | None | Injects mandatory 4-point statement rules into orchestrator turns |
| **§5.3**: Outcome Ledger Persistence (`task-requested/<slug>.md`) | **Yes** (`OutcomeLedger.saveMilestone`, `parseMilestoneMarkdown`) | None | Authoritative parser and serializer for outcome markdown documents |
| **§5.3**: Machine-Readable Task Bindings (`bindings.json`) | **Yes** (`OutcomeLedger.bindTask`, `getLinkedMilestone`) | None | Maintains bidirectional index between card IDs and outcome slugs |
| **§5.3**: Model Tools `ledger_show` and `ledger_update` | **Yes** (`tool-ledger` exports) | None | Allows orchestrator to inspect and update founder milestone outcomes |
| **§5.10**: Result Review: "Are the todos done?" | **Yes** (`OutcomeLedger.verifyMilestoneDone`) | None | Evaluates whether all linked tasks are `done`, checklists ticked, worktrees clean |
| **§5.10**: Dirty Worktree & Unaddressed Defect Checks | Consumes APIs | `@deepseek-ai/dsh-worktree-local` (Plan 07), `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) | Ledger queries worktree classification and card comments |
| **§5.11**: Milestone Closure & Satisfier Compilation | **Yes** (`OutcomeLedger.closeMilestone`) | `@deepseek-ai/dsh-supervisor` (Plan 12) | Supervisor triggers closure; Ledger validates and updates markdown |
| **§5.11**: Governing Axiom Witness Verification (`INV-01`) | **Yes** (`OutcomeLedger.checkMilestoneAxioms`) | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | Verifies every governing axiom is proved by landed commit SHAs |
| **§2.5**: Auto-Todo Generation on Sweep Failure | **Yes** (`OutcomeLedger.generateAutoTodo`) | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | Sweeper detects failure; Ledger formats and persists `auto-todos/<id>.md` |
| Operational Kanban Card Lifecycle & Claiming | No | `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) | Operational state machine decoupled from outcome ledger |
| Watchdog Timers & Silent Worker Detection | No | `@deepseek-ai/dsh-supervisor` (Plan 12) | Host daemon handles periodic timers and circuit breakers |

## 4. Proposed Package / File Layout

```
packages/ledger/
└── ledger/                               # @deepseek-ai/dsh-ledger (Service Definition & Provider)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── index.ts                      # OutcomeLedger Service class, plugin apply(), Cordis context augment
        ├── types.ts                      # Pure domain types (MilestoneDocument, OutcomeItem, BindingsCatalog, etc.)
        ├── errors.ts                     # LedgerError, MilestoneNotFoundError, InvalidDocumentFormatError, AxiomUnprovedError
        ├── document.ts                   # Markdown parser, serializer, and section manipulator
        ├── bindings.ts                   # bindings.json atomic reader, writer, and index manager
        ├── verifier.ts                   # Milestone closure validator, witness compiler, and §5.10 evaluation logic
        ├── auto-todo.ts                  # Auto-todo template builder and failure markdown generator
        ├── prompt.ts                     # SystemPrompt section for §5.1 4-point statement intake policy
        └── tools/
            ├── index.ts                  # Tool export aggregation
            ├── ledger-show.ts            # ledger_show tool definition (defineTool)
            └── ledger-update.ts          # ledger_update tool definition (defineTool)
    └── tests/
        ├── document-parser.spec.ts       # Markdown parsing, serialization, and section preservation tests
        ├── bindings.spec.ts              # bindings.json atomic reads, mutations, and concurrency tests
        ├── milestone-verifier.spec.ts    # §5.10 & §5.11 witness verification and closure logic tests
        ├── auto-todo.spec.ts             # Auto-todo markdown file generation on sweep failure tests
        ├── ledger-tools.spec.ts          # ledger_show and ledger_update tool invocation tests
        ├── prompt-intake.spec.ts         # System prompt 4-point statement injection tests
        └── service-lifecycle.spec.ts     # Cordis lifecycle, HMR reload, and disposal tests
```

## 5. Public Contracts

### 5.1 Domain Models (`packages/ledger/ledger/src/types.ts`)
*Per `packages/AGENTS.md:24`, this file contains only pure types — no runtime code.*

```typescript
import type { TaskId, TaskStatus } from '@deepseek-ai/dsh-kanban'

/** Branded milestone outcome slug (e.g. 'hermes-orchestration-overhaul'). */
export type MilestoneSlug = string & { readonly __brand: unique symbol }

/** Unique outcome item identifier within a milestone document. */
export type OutcomeId = string & { readonly __brand: unique symbol }

/** Three-state lifecycle for milestone documents and outcomes. */
export type MilestoneStatus = 'pending' | 'archived' | 'done'

/** Objective outcome item extracted from markdown. */
export interface OutcomeItem {
  readonly id: OutcomeId
  readonly description: string
  readonly definitionOfDone: string
  readonly linkedTaskIds: readonly TaskId[]
  readonly governingAxiomIds: readonly string[]
  readonly status: MilestoneStatus
  readonly satisfier?: OutcomeSatisfier
}

/** Satisfier block recorded in markdown upon outcome completion. */
export interface OutcomeSatisfier {
  readonly primaryTaskId: TaskId
  readonly mergeCommitSha: string
  readonly summary: string
  readonly completedAt: string
  readonly witnessReport: MilestoneWitnessReport
}

/** Full parsed milestone markdown document. */
export interface MilestoneDocument {
  readonly slug: MilestoneSlug
  readonly title: string
  readonly filePath: string
  readonly pendingOutcomes: readonly OutcomeItem[]
  readonly archivedOutcomes: readonly OutcomeItem[]
  readonly doneOutcomes: readonly OutcomeItem[]
  readonly rawMarkdown: string
  readonly updatedAt: string
}

/** Cryptographic witness proof linking an axiom to a landed commit. */
export interface AxiomWitnessProof {
  readonly axiomId: string
  readonly taskId: TaskId
  readonly commitSha: string
  readonly proofId: string
  readonly timestamp: string
}

/** Complete witness report verifying all milestone axioms. */
export interface MilestoneWitnessReport {
  readonly slug: MilestoneSlug
  readonly evaluatedAt: string
  readonly totalGoverningAxioms: number
  readonly witnessedAxioms: readonly AxiomWitnessProof[]
  readonly unprovedAxioms: readonly string[]
  readonly passed: boolean
}

/** Result of checking milestone completion readiness (§5.10). */
export interface MilestoneCompletionStatus {
  readonly slug: MilestoneSlug
  readonly readyToClose: boolean
  readonly totalOutcomes: number
  readonly completedOutcomes: number
  readonly linkedTasks: readonly {
    readonly taskId: TaskId
    readonly status: TaskStatus
    readonly hasUnresolvedChecklist: boolean
    readonly isWorktreeClean: boolean
  }[]
  readonly blockers: readonly string[]
}

/** Serialized bindings.json schema. */
export interface BindingsCatalog {
  readonly version: 1
  readonly sessions: Record<string, MilestoneSlug[]>
  readonly tasks: Record<TaskId, MilestoneSlug>
  readonly metadata: Record<MilestoneSlug, {
    readonly title: string
    readonly status: MilestoneStatus
    readonly createdAt: string
    readonly updatedAt: string
  }>
}
```

### 5.2 Service Definition & Cordis Events (`packages/ledger/ledger/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  BindingsCatalog,
  MilestoneCompletionStatus,
  MilestoneDocument,
  MilestoneSlug,
  MilestoneWitnessReport,
  OutcomeItem,
  OutcomeSatisfier,
} from './types.ts'

export abstract class OutcomeLedger extends Service {
  static readonly name = 'ledger'

  abstract getMilestone(slug: MilestoneSlug): Promise<MilestoneDocument | null>
  abstract listMilestones(filter?: { status?: MilestoneDocument['pendingOutcomes'][number]['status'] }): Promise<readonly MilestoneDocument[]>
  abstract saveMilestone(doc: MilestoneDocument): Promise<void>
  abstract getLinkedMilestone(taskId: string): Promise<{ slug: MilestoneSlug; document: MilestoneDocument } | null>
  abstract bindTask(taskId: string, slug: MilestoneSlug, outcomeId?: string): Promise<void>
  abstract checkMilestoneAxioms(taskId: string): Promise<MilestoneWitnessReport>
  abstract verifyMilestoneDone(slug: MilestoneSlug): Promise<MilestoneCompletionStatus>
  abstract closeMilestone(slug: MilestoneSlug, satisfier: OutcomeSatisfier): Promise<MilestoneDocument>
  abstract generateAutoTodo(failure: {
    taskId: string
    failingAxiomId: string
    predicate: string
    diagnostic: string
  }): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ledger: OutcomeLedger
  }

  interface Events {
    /** Emitted when an outcome document is created or modified. */
    'ledger/outcome-changed'(payload: {
      slug: MilestoneSlug
      action: 'created' | 'updated' | 'closed' | 'archived'
      timestamp: string
    }): void

    /** Emitted when a milestone outcome is successfully verified and moved to Done. */
    'ledger/milestone-closed'(payload: {
      slug: MilestoneSlug
      satisfier: OutcomeSatisfier
      witnessReport: MilestoneWitnessReport
    }): void
  }
}
```

### 5.3 Model Tools Contract (`packages/ledger/ledger/src/tools/index.ts`)

#### 1. `ledger_show` Tool
```typescript
import { defineTool } from '@deepseek-ai/dsh-tools'

export const ledgerShowTool = defineTool({
  name: 'ledger_show',
  description: 'Display an outcome milestone document from ~/.hermes/task-requested/<slug>.md including pending outcomes, DoD contracts, linked Kanban card statuses, and completed satisfiers. When slug is omitted, lists all active milestone documents.',
  parameters: {
    slug: {
      type: 'string',
      required: false,
      description: 'The milestone slug (e.g. "hermes-orchestration-overhaul"). If omitted, active milestones are listed.',
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        milestones: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              title: { type: 'string' },
              pendingCount: { type: 'integer' },
              doneCount: { type: 'integer' },
              rawMarkdown: { type: 'string' },
            },
          },
        },
      },
      required: ['milestones'],
    },
    render: (_args, value) => [{
      type: 'text',
      text: value.milestones.map(m => `### ${m.title} (${m.slug})\n${m.rawMarkdown}`).join('\n\n---\n\n'),
    }],
  },
  async execute(args, exec) { /* ... */ },
  presentCall: args => ({ card: 'generic', title: 'Show Outcome Ledger', kind: 'other', rawInput: args }),
})
```

#### 2. `ledger_update` Tool
```typescript
import { defineTool } from '@deepseek-ai/dsh-tools'

export const ledgerUpdateTool = defineTool({
  name: 'ledger_update',
  description: 'Create or update a founder milestone outcome document at ~/.hermes/task-requested/<slug>.md and update task bindings in bindings.json. Use this to record high-level objectives, amend Definition of Done (DoD), or link Kanban cards.',
  parameters: {
    slug: {
      type: 'string',
      required: true,
      description: 'Milestone slug identifier (lowercase kebab-case, e.g. "finish-migration").',
    },
    title: {
      type: 'string',
      required: false,
      description: 'Human-readable title for the milestone document (used on creation).',
    },
    action: {
      type: 'string',
      required: true,
      enum: ['create', 'add_outcome', 'link_tasks', 'archive_outcome'],
      description: 'The ledger update action to perform.',
    },
    outcome: {
      type: 'object',
      required: false,
      description: 'Outcome specification required for "add_outcome".',
      properties: {
        description: { type: 'string', required: true },
        definitionOfDone: { type: 'string', required: true },
        governingAxioms: { type: 'array', items: { type: 'string' }, required: false },
        linkedTaskIds: { type: 'array', items: { type: 'string' }, required: false },
      },
    },
    taskLinks: {
      type: 'object',
      required: false,
      description: 'Mapping of outcome index or text to task IDs for "link_tasks".',
      properties: {
        outcomeDescription: { type: 'string', required: true },
        taskIds: { type: 'array', items: { type: 'string' }, required: true },
      },
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        updatedMarkdown: { type: 'string' },
        pendingCount: { type: 'integer' },
        doneCount: { type: 'integer' },
      },
      required: ['slug', 'updatedMarkdown'],
    },
    render: (_args, value) => [{
      type: 'text',
      text: `Successfully updated milestone "${value.slug}".\n\n${value.updatedMarkdown}`,
    }],
  },
  async execute(args, exec) { /* ... */ },
  presentCall: args => ({ card: 'generic', title: `Update Outcome Ledger (${args.slug})`, kind: 'other', rawInput: args }),
})
```

### 5.4 Service Provider Config Schema (`packages/ledger/ledger/src/index.ts`)

```typescript
import z from '@deepseek-ai/schemastery'

export interface LedgerConfig {
  /** Directory storing outcome markdown documents. Default: ~/.hermes/task-requested */
  ledgerDir: string
  /** Maximum file size in bytes for an outcome document. Default: 524288 (512 KiB) */
  maxDocumentBytes: number
  /** File lock timeout in milliseconds for concurrent writes. Default: 5000 */
  lockTimeoutMs: number
  /** Whether to register the §5.1 intake policy prompt section. Default: true */
  enablePromptSection: boolean
}

export const LedgerConfig: z<LedgerConfig> = z.object({
  ledgerDir: z.string().default('~/.hermes/task-requested'),
  maxDocumentBytes: z.number().default(524288),
  lockTimeoutMs: z.number().default(5000),
  enablePromptSection: z.boolean().default(true),
})
```

## 6. Lifecycle and Scoping

- **Host-Plane Singleton (`OutcomeLedger`)**:
  - Mounted globally in the root Cordis container via `packages/bundle/base/cordis.patch.yml`.
  - Injects `['fs', 'storageDomain']`. Dynamically resolves optional host capabilities via `ctx.get()`: `['kanban', 'axioms', 'axiomVerifier', 'worktrees', 'integrator']`.
  - On startup:
    1. Resolves `~/.hermes/task-requested` directory path.
    2. Ensures directory exists via `ctx.fs` or `node:fs/promises`.
    3. Opens `ledger` domain via `ctx.storageDomain` (tables `bindings` and `milestones`).
    4. Scans `~/.hermes/task-requested/*.md` to re-sync or populate the storage domain index if uninitialized.
    5. Subscribes to host event `kanban/task-status` to update task binding states when tasks transition.
  - On disposal / HMR:
    - Closes storage domain handle.
    - Disposes event listeners via registered effect disposers.

- **Agent-Plane Preset Integration (`hermes-brain`)**:
  - Preset rows mount tools `ledger_show` and `ledger_update`.
  - Injects `['tools', 'ledger', 'systemPrompt']`.
  - Registers the `ledger:intake-policy` system prompt section on `ctx.systemPrompt`.
  - Per **PRESET-RULE 4**, tool and prompt registrations do not define a Cordis Service and do not require an `isolate` realm.
  - Worker presets (`hermes-worker`) explicitly omit the ledger tools. Workers execute tasks; they do not author or close founder milestone outcomes.

### 6.1 Persistence Architecture: Human-Facing Markdown vs Machine-Facing Storage Domain

Unlike plans 03, 06, 09, and 12, which persist their internal domain data entirely through `ctx.storageDomain`, the Outcome Ledger uses a deliberate persistence split between plain Markdown files and `ctx.storageDomain`:

1. **Why the Markdown File Layout (`~/.hermes/task-requested/<slug>.md`) is a Strict Requirement**:
   - **External Human Reader**: The founder reads, authors, and edits these milestone documents directly. They are the explicit human-facing contract between the founder and the autonomous agent system.
   - The founder interacts with these files directly outside the Harness process using standard text editors, Git, or terminal pagers—authoring high-level milestone requirements, reviewing pending vs. archived tasks, amending Definition of Done (DoD) bullet points, and inspecting landed Git satisfier commit blocks. Storing milestone documents inside an opaque SQLite database or binary KV store would destroy this human-in-the-loop contract.
   - Background sweep failure diagnostics (`auto-todos/<task_id>.md`) similarly remain human-readable Markdown to allow immediate founder triage and issue reproduction.

2. **What the Plan Does NOT Keep in Files (Storage Domain Split)**:
   - On reflection against `packages/storage/**` (`@deepseek-ai/dsh-storage-domain`), purely machine-facing state does **not** belong in bespoke JSON files (`bindings.json`) with ad-hoc POSIX file locks (`bindings.json.lock`).
   - Consequently, the plan splits state along reader boundaries:
     - **Human-Facing Contract (Filesystem)**: Raw milestone documents (`~/.hermes/task-requested/<slug>.md`) and auto-todos (`auto-todos/<task_id>.md`) remain clean, human-readable Markdown files on disk.
     - **Machine-Facing State (`ctx.storageDomain`)**: The milestone index, task-to-milestone bindings (`taskId <-> slug`), milestone status/closure metadata, and derived query fields queried by the model (`ledger_show`) and supervisor daemon (`ctx.supervisor`) are maintained in `ctx.storageDomain` (`ledger` domain, tables `bindings` and `milestones`).
   - This split eliminates bespoke `.lock` file dances, manual `.tmp` atomic write renames, and corrupted JSON recovery routines, while delivering synchronous in-memory read snapshots and serialized write-chain durability for all model and supervisor queries.

## 7. Agent Preset Integration

The exact preset configuration added to `presets/hermes-brain/agent.cordis.yml`:

```yaml
# ── outcome ledger & milestone tracking (Spec §5.1, §5.3) ───────────────────
# Per PRESET-RULES 2, 6, 8: The OutcomeLedger service provider (@deepseek-ai/dsh-ledger)
# resides on the Host Plane (cordis.patch.yml) as cross-session state consumed by ctx.supervisor.
# Per PRESET-RULE 4: The preset carries only the tool row (@deepseek-ai/dsh-tool-ledger), which
# registers ledger_show/ledger_update into ctx.tools and ledger:intake-policy into ctx.systemPrompt.
# Publishing no Cordis service, it requires no isolate realm.
- id: tool-ledger
  name: '@deepseek-ai/dsh-tool-ledger'
```

Inside `hermes-brain`, this row makes visible:
1. Model tool `ledger_show`: for reading milestone documents and DoD criteria.
2. Model tool `ledger_update`: for creating milestones and binding cards.
3. System prompt section `ledger:intake-policy`: enforcing the 4-point statement during intake turns.

In `presets/hermes-worker/agent.cordis.yml`, the row is omitted.

## 8. Execution Flow

### 8.1 Step 5.1: Intake Gate & 4-Point Statement Assembly
```
Founder Request in Session Chat
       │
       ▼
SystemPrompt Assembly (`ctx.systemPrompt.assemble`)
  └── `ledger:intake-policy` injects mandatory 4-point contract:
        1. Outcome in one hedging-free sentence.
        2. Acceptance test stated objectively.
        3. Operating assumptions for ambiguous brief points.
        4. Blocking questions (batch limit <= 3).
       │
       ▼
Orchestrator emits 4-point statement in session context.
Operator confirms assumptions or answers blocking questions.
```

### 8.2 Step 5.3: Todo Writing (The Outcome Ledger Layer)
```
Brain Orchestrator (`hermes-brain`)
       │
       ▼ Calls `ledger_update(action='create', slug='...', title='...', outcome={...})`
`OutcomeLedger.saveMilestone()`
  ├── Acquires POSIX lock on `~/.hermes/task-requested/<slug>.md.lock`
  ├── Serializes Markdown:
  │     # Task: <Title>
  │     ## Pending
  │     - <Outcome description>
  │       - DoD: <Objective observable postcondition>
  │     ## Archived
  │     ## Done
  ├── Atomically writes markdown via temporary staging file (`.tmp.<uuid>`)
  ├── Updates `~/.hermes/task-requested/bindings.json` with active session ID and slug
  ├── Emits Cordis event: `ledger/outcome-changed`
  └── Releases lock
```

### 8.3 Step 5.5 & 5.6: Card Decomposition and Binding
```
Brain Orchestrator creates Kanban cards via `kanban_create` (Plan 02)
       │
       ▼ Calls `ledger_update(action='link_tasks', slug='...', taskLinks={...})`
`OutcomeLedger.bindTask(taskId, slug, outcomeId)`
  ├── Formats markdown: appends `[<taskId>]` to the pending outcome line
  ├── Writes updated markdown atomically
  ├── Records `tasks[taskId] = slug` in `bindings.json`
  └── Emits Cordis event: `ledger/outcome-changed`
```

### 8.4 Step 5.10 & 5.11: Result Review and Milestone Closure
```
Integrator lands PR / merge commit on main branch
       │
       ▼ Emits `integrator/merged(taskId, mergeCommitSha)` (Plan 10)
Autonomous Supervisor Daemon (`ctx.supervisor`, Plan 12)
       │
       ▼ Queries `ctx.ledger.getLinkedMilestone(taskId)`
Resolves slug and linked document
       │
       ▼ Queries `ctx.ledger.verifyMilestoneDone(slug)` (Spec §5.10)
  ├── 1. Card Status Check: All linked cards must have `status == 'done'` in `kanban.db`
  ├── 2. Checklist Gate: Scans `task.body` for unticked `- [ ]` checkboxes
  ├── 3. Clean Worktree Gate: Verifies zero uncommitted files via `ctx.worktrees.classify`
  └── 4. Defect Gate: Scans card comments for unaddressed defect markers
       │
       ▼ Queries `ctx.ledger.checkMilestoneAxioms(taskId)` (Spec §5.11)
  └── Axiom Proof Gate (INV-01): For every governing axiom of the outcome:
        Verifies at least one landed card with `status == 'done'` witnesses
        a passing proof artifact and commit SHA in `ctx.axiomVerifier`
       │
       ├── [Failure]: Milestone remains in `Pending`. Escalation posted.
       │
       └── [Success]: All governing axioms proved by landed commits!
             │
             ▼ Calls `ctx.ledger.closeMilestone(slug, satisfier)`
               ├── Moves item from `## Pending` to `## Done` in `<slug>.md`
               ├── Appends:
               │     - DoD: <Objective postcondition>
               │     - Satisfier: <taskId> (done); <Commit SHA>; <Witness summary>
               ├── Atomically replaces markdown document
               ├── Updates `bindings.json` status to `done`
               └── Emits `ledger/milestone-closed`
```

### 8.5 Step 2.5: Auto-Todo Generation on Sweep Failure
```
Axiom Sweeper executes scheduled verification (`ctx.axiomVerifier`, Plan 04)
       │
       ▼ Detects predicate failure (e.g. `INV-11` or forbidden import)
Sweeper calls `ctx.ledger.generateAutoTodo({ taskId, failingAxiomId, ... })`
       │
       ▼ `OutcomeLedger` creates auto-todo document:
         Path: `~/.hermes/task-requested/auto-todos/<task_id>.md`
         Content: Formatted remediation brief linking failed check and error output
       │
       ▼ Posts diagnostic comment with file path to Kanban card via `ctx.kanban`
```

## 9. Error, Cancellation, and Lifecycle Behavior

| Failure Mode | Detection Seam | Immediate Action | Final Settled State |
| :--- | :--- | :--- | :--- |
| **Concurrent write collision** | Lock contention on `<slug>.md.lock` > `lockTimeoutMs` | Throw `LedgerError('E_LOCK_TIMEOUT')`, log warning | Operation aborted; disk file unmodified |
| **Malformed markdown on disk** | `parseMilestoneMarkdown` regex fails to find required `# Task` or `## Pending` | Preserve corrupt file as `<slug>.md.bak.<epoch>`, raise `InvalidDocumentFormatError` | Clean failure; original file safeguarded |
| **Missing `bindings.json`** | File not found during startup or write | Automatically regenerate minimal `{ version: 1, ... }` catalog | Self-healed registry |
| **Corrupted `bindings.json`** | `JSON.parse` syntax error | Backup corrupted file to `bindings.json.bak.<epoch>`, rebuild catalog from markdown directory scan | Catalog recovered from filesystem source |
| **Axiom unproven at closure (§5.11)** | `checkMilestoneAxioms` finds missing witness commit | Abort closure, return `passed: false` with `unprovedAxioms` list | Milestone remains in `Pending`, escalation logged |
| **Unticked checklist on done card (§5.10)** | `verifyMilestoneDone` detects `- [ ]` in card body | Flag `readyToClose: false`, list `unresolvedChecklist` blocker | Milestone remains in `Pending`, follow-up card created |
| **Dirty worktree on done card (§5.10)** | `verifyMilestoneDone` calls `ctx.worktrees.classify` returning dirty | Flag `readyToClose: false`, block closure | Card reopened or blocked; milestone stays in `Pending` |
| **Disk space exhaustion** | `ctx.fs.writeFileAtomic` fails with `ENOSPC` | Roll back temporary file write, throw `LedgerError` | Target document uncorrupted; no partial write |
| **Cordis HMR reload / unload** | Cordis context disposal trigger | Flush in-memory indexes, release file locks, clear disposers | Clean shutdown; zero leaked file descriptors |

## 10. Testing Strategy

### 10.1 Unit Tests (`packages/ledger/ledger/tests/`)
- **`document-parser.spec.ts`**:
  - Parse real-world StoryInCode milestone documents (`hermes-installation-optimization-and-migration.md`, `hermes-orchestration-overhaul-opus-4-8-primary-worker-self-sufficiency-axiom-loop.md`).
  - Verify exact extraction of `# Task`, `## Pending`, `## Archived`, `## Done`.
  - Validate DoD and satisfier block extraction.
  - Round-trip test: parse -> serialize -> parse produces identical AST.
  - Section manipulation: moving an outcome from Pending to Done with appended satisfier.
- **`bindings.spec.ts`**:
  - Read/write `bindings.json` conforming to schema.
  - Bidirectional queries: get slug by task ID, get task IDs by slug.
  - Concurrency test: simulate simultaneous task bindings with lock contention handling.
  - Recovery test: rebuild `bindings.json` from scratch by scanning a directory of `.md` files.
- **`auto-todo.spec.ts`**:
  - Generate auto-todo markdown upon sweep failure.
  - Validate path `auto-todos/<task_id>.md` and content formatting.

### 10.2 Integration & Verification Tests
- **`milestone-verifier.spec.ts`**:
  - Test Spec §5.10 evaluation:
    - All tasks done, checklists ticked, clean worktree -> `readyToClose: true`.
    - Unticked checklist item in card body -> `readyToClose: false` with blocker message.
    - Dirty worktree files present -> `readyToClose: false`.
  - Test Spec §5.11 axiom witness checks:
    - Every governing axiom witnessed by landed commit SHA -> passes closure check.
    - Missing axiom witness commit -> fails with `AxiomUnprovedError` listing missing axiom IDs.
    - Move to done appends cryptographic witness report and commit SHA to document.
- **`ledger-tools.spec.ts`**:
  - Execute `ledger_show` with specific slug and without slug (listing all).
  - Execute `ledger_update` with `action='create'`, `action='add_outcome'`, and `action='link_tasks'`.
- **`prompt-intake.spec.ts`**:
  - Verify that `ledger:intake-policy` registers into `ctx.systemPrompt`.
  - Verify that prompt assembly contains the mandatory 4-point statement instructions.
- **`service-lifecycle.spec.ts`**:
  - Mount `OutcomeLedger` into test Cordis container.
  - Verify typed events emitted on creation, update, and closure.
  - Test HMR reload: unmount, verify lock release, re-mount cleanly.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Markdown milestone document parsing & atomic serialization | `/home/sic/.hermes/plugins/task-requested/ledger.py:10-120` | Section regexes (`_HEADER`, `_TODO`, `_DETAIL`, `_TITLE`), slugification (`slugify`), parser reconstructing sections (`parse`), renderer emitting normalized Markdown with DoD and Satisfier (`render`), and atomic file write pattern via temporary files (`write`). | Port Python regexes and string manipulation to TypeScript in `src/document.ts`; replace raw POSIX `open`/`tempfile` with `ctx.fs.writeFileAtomic`; wrap parsing in domain error taxonomy (`InvalidDocumentFormatError`); align with storage split storing machine indices in `ctx.storageDomain`. | direct port |
| Machine-readable milestone bindings & session tracking | `/home/sic/.hermes/plugins/task-requested/bindings.py:12-74` | Bidirectional task/session binding model (`_load`, `_save`, `slugs_for`, `bind`, `unbind`), version schema (`VERSION = 1`), and atomic JSON persistence. | Port Python dictionary and file logic to TypeScript `src/bindings.ts` using `ctx.storageDomain` (`bindingsDomainSpec` or typed storage table) as justified in review fixes, removing raw `bindings.json.lock` while retaining API compatibility. | port with adaptation |
| Model-facing inspection and update tools (`ledger_show`, `ledger_update`) | `/home/sic/.hermes/plugins/task-requested/tools.py:22-131`<br>`/home/sic/.hermes/plugins/task-requested/schemas.py:6-81` | Action dispatching semantics (`_create`, `_update`, `_read`, `_bind`), item state machine (moving items between Pending, Archived, and Done), and JSON schema parameter definitions (`title`, `pending`, `add_pending`, `archive`, `complete`). | Port Python functions to Harness Cordis tool definitions via `defineTool` in `src/tools/ledger-show.ts` and `src/tools/ledger-update.ts`; replace JSON return dicts with structured Zod schemas and presentation cards (`presentCall`). | port with adaptation |
| Result review, DoD verification & satisfier citation assembly | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1747-1825`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/job_board_cards.py:155-202` | Milestone closure algorithm: regex match for row IDs (`r"^(.*?)\s*\[([^\]]+)\]\s*$"`), checking board card statuses (`status == 'done'`), resolving governing axioms, compiling satisfier citation proofs (`proved by <taskId> (<commit>)`), detecting unproved governing axioms (`[todo-unproved]`), and moving to Done. | Port from Python procedural script into `src/verifier.ts` (`verifyMilestoneDone` and `checkMilestoneAxioms`); replace `job_board_cards.py` with calls to `ctx.kanban` (Plan 01), `ctx.worktrees.classify` (Plan 07), and `ctx.axiomVerifier` (Plan 04); emit Cordis events (`ledger/milestone-closed`). | port with adaptation |
| System-prompt intake contract injection (Spec §5.1 4-point statement) | `/home/sic/.hermes/plugins/task-requested/injection.py:17-57`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/SKILL.md:735-770` | Context injection logic formatting pending milestone items into `<task-requested>` tags, and the four-point contract rules (outcome, acceptance test, operating assumptions, blocking questions). | Translate Python `pre_llm_call` hook into Cordis `ctx.systemPrompt.contribute('ledger:intake-policy', ...)` in `src/prompt.ts`, dynamically querying active bound slugs and injecting the 4-point intake contract. | port with adaptation |
| Automated auto-todo generation on sweeper failure (Spec §2.5) | no Hermes equivalent — new code | N/A (Hermes logs sweeper escalations to text logs or console, but lacks automated auto-todo document generation under `~/.hermes/task-requested/auto-todos/<task_id>.md`). | New TypeScript implementation in `src/auto-todo.ts` receiving failure diagnostics from Plan 04 sweeper and generating formatted markdown briefs linked to Kanban cards. | no Hermes equivalent (new code) |

The single most valuable capability to port is the markdown milestone document parser and atomic serializer (`/home/sic/.hermes/plugins/task-requested/ledger.py:10-120`) together with the satisfier citation compilation algorithm (`supervise.py:1747-1825`). By retaining the exact markdown AST structure (`# Task`, `## Pending`, `## Archived`, `## Done`) and assembling satisfiers strictly by citing card evidence and commit SHAs rather than re-authoring reports, the ledger preserves human auditability for the founder while eliminating redundant multi-agent reporting.

## 11. Implementation Steps

1. **Package Initialization**:
   - Create `packages/ledger/ledger/` with `package.json`, `tsconfig.json`, `README.md`.
   - Configure `@deepseek-ai/dsh-ledger` with ESM, strict typechecking, and export maps.
2. **Domain Models & Error Types**:
   - Author `src/types.ts` with branded types (`MilestoneSlug`, `OutcomeId`), document AST interfaces, binding schemas, and witness report types.
   - Author `src/errors.ts` implementing domain error taxonomy.
3. **Markdown Document Parser & Serializer**:
   - Author `src/document.ts` implementing `parseMilestoneMarkdown` and `serializeMilestoneMarkdown`.
   - Implement regex parsers matching `# Task:`, `## Pending`, `## Archived`, `## Done`, `- DoD:`, and `- Satisfier:`.
   - Implement atomic update helpers (`moveOutcomeToDone`, `appendPendingOutcome`, `appendTaskBinding`).
4. **Bindings Catalog Subsystem**:
   - Author `src/bindings.ts` implementing atomic JSON reads and writes with POSIX file locking (`bindings.json.lock`).
   - Implement slug-to-task and task-to-slug lookup indexes.
5. **Verification & Milestone Closure Engine**:
   - Author `src/verifier.ts` implementing `verifyMilestoneDone` (§5.10 checklist/worktree checks) and `checkMilestoneAxioms` (§5.11 witness compilation).
   - Integrate with `ctx.kanban`, `ctx.axioms`, and `ctx.axiomVerifier` via safe dynamic resolution.
6. **Auto-Todo Issue Generator**:
   - Author `src/auto-todo.ts` formatting sweep failure diagnostics into standard auto-todo markdown briefs.
7. **System Prompt Intake Contributor**:
   - Author `src/prompt.ts` contributing `ledger:intake-policy` (Spec §5.1) to `ctx.systemPrompt`.
8. **Service Implementation & Cordis Plugin**:
   - Author `src/index.ts` declaring `OutcomeLedger` class, lifecycle hooks, and typed event declarations.
   - Implement `saveMilestone`, `getMilestone`, `closeMilestone`, and `generateAutoTodo`.
9. **Model-Facing Tools**:
   - Author `src/tools/ledger-show.ts` and `src/tools/ledger-update.ts` using `defineTool`.
   - Author presenters in `src/tools/index.ts` with soft validation on replay.
10. **Test Suite Authoring**:
    - Implement comprehensive unit and integration suites under `tests/`.
    - Run `vitest` to verify all tests pass.
11. **Preset & Bundle Configuration**:
    - Add host service row to `packages/bundle/base/cordis.patch.yml`.
    - Add tool row to `presets/hermes-brain/agent.cordis.yml`.
    - Validate with `verify-cordis-config`.

## 12. Acceptance Criteria

- [ ] `packages/ledger/ledger/` exists, exports `@deepseek-ai/dsh-ledger`, and compiles cleanly with zero TypeScript errors.
- [ ] `OutcomeLedger` extends Cordis `Service`, mounts on the Host Plane (`ctx.ledger`), and injects `['fs']`.
- [ ] Real StoryInCode milestone markdown files in `~/.hermes/task-requested/` parse without data loss and serialize round-trip identically.
- [ ] `bindings.json` correctly tracks bidirectional mappings between task IDs and milestone slugs.
- [ ] Model tools `ledger_show` and `ledger_update` register on `ctx.tools` inside `hermes-brain` and are omitted from `hermes-worker`.
- [ ] `ledger:intake-policy` registers into `ctx.systemPrompt` when `enablePromptSection: true`, providing the mandatory 4-point statement rules.
- [ ] Spec §5.10 verification detects unticked checkboxes in card bodies and dirty worktree states, refusing premature closure.
- [ ] Spec §5.11 verification refuses milestone closure when any governing axiom lacks a landed merge commit SHA witness.
- [ ] Milestone closure atomically moves the outcome from `## Pending` to `## Done` with an appended, immutable `Satisfier:` block.
- [ ] Sweep failures in `ctx.axiomVerifier` trigger auto-todo generation under `~/.hermes/task-requested/auto-todos/<task_id>.md`.
- [ ] All unit, integration, and lifecycle tests pass with 100% assertion success under `vitest`.
- [ ] Sibling contracts with Plan 01 (`ctx.kanban`), Plan 03 (`ctx.axioms`), Plan 04 (`ctx.axiomVerifier`), and Plan 12 (`ctx.supervisor`) match exactly without redefinitions or cyclic imports.
- [ ] Tool row `@deepseek-ai/dsh-tool-ledger` mounts on the Agent Plane in `hermes-brain` without extending `Service` or publishing a process-global service, honoring PRESET-RULE 4.
- [ ] Implementation order respects dependency topology: Plan 13 is implemented prior to Plan 12, exposing `OutcomeLedger` on `ctx.ledger` for supervisor milestone validation.

## Review fixes applied

- REVIEW-seams #1: Separated `@deepseek-ai/dsh-ledger` host service provider from `@deepseek-ai/dsh-tool-ledger` agent-plane tool row to eliminate unisolated service leakage in `hermes-brain/agent.cordis.yml`.
- REVIEW-contracts #4: Resolved implementation-order inversion by establishing Plan 13 as a prerequisite implemented prior to Plan 12.
- REVIEW-storage finding (Markdown File Persistence Justification & Storage Domain Split): Stated explicitly why the file layout at `~/.hermes/task-requested/<slug>.md` is a requirement — the founder reads and edits these documents directly as the human-facing contract. Split machine-facing state (milestone index, task bindings, and derived status queried by the model) into `ctx.storageDomain` (`ledger` domain) rather than bespoke files, eliminating `bindings.json.lock` while preserving human-editable Markdown for the founder contract.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`plugins/task-requested/ledger.py`, `bindings.py`, `tools.py`, `injection.py`, and orchestrator assets `supervise.py` and `job_board_cards.py`) to accelerate outcome ledger implementation.
