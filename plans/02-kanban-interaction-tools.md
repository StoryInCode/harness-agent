# 02 — Kanban Model-Facing Tools & Slash Command Surface

## Features

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

## 1. Purpose

`@deepseek-ai/dsh-tool-kanban` and `@deepseek-ai/dsh-command-kanban` provide the model-facing and operator-facing interaction surfaces for the Kanban subsystem established in Plan 01 (`plans/01-kanban-substrate.md`).

- **What it owns**:
  - `@deepseek-ai/dsh-tool-kanban` (Agent Plane Consumer):
    - Model-facing tool registrations constructed via `defineTool` (`packages/core/tools/src/schema.ts:545-547`) on `ctx.tools`:
      - `kanban_show`: Query full card state, comments, runs, and parent context.
      - `kanban_list`: Query board cards filtered by status/assignee/tenant (capped at 200).
      - `kanban_create`: Create task cards with title, body/DoD, assignee, priority, and parent links.
      - `kanban_complete`: Complete active cards with summary, result, metadata, and child IDs.
      - `kanban_block`: Transition active cards to `blocked` with reason and block kind.
      - `kanban_unblock`: Return blocked cards to `ready` or `todo`.
      - `kanban_request_review`: Transition running cards to `review` with change summary.
      - `kanban_request_changes`: Reviewer tool returning cards to implementer with findings.
      - `kanban_heartbeat`: Worker progress heartbeat updating `last_heartbeat_at`.
      - `kanban_comment`: Post markdown collaboration comments to card discussion trails.
      - `kanban_attach` & `kanban_attachments`: Upload and inspect card file attachments.
      - `kanban_link`: Add dependency DAG edges with cycle detection.
    - Role configuration gating (`role: 'orchestrator' | 'worker'`): restricts tool registration so orchestrator sessions (`hermes-brain`) receive board management tools (`kanban_list`, `kanban_unblock`) while workers (`hermes-worker`) receive execution tools (`kanban_heartbeat`, `kanban_request_review`, `kanban_request_changes`).
    - Invariant enforcement:
      - `INV-04` (Parent Never Claims): Registers a monotonic `ToolGuard` via `ctx.tools.guard()` (`packages/core/tools/src/index.ts:1100-1106`) that denies any claim attempt originating from an orchestrator root session.
      - `INV-15` (No Phantom Cards): Validates `created_cards` in `kanban_complete` against `ctx.kanban.verifyCreatedCards()`, throwing `HallucinatedCardsError` if unowned or non-existent IDs are submitted.
    - Pure Host presentation projections (`presentCall`, `presentResult`) and `presentationMeta` derivation (`packages/core/tools/src/presentation.ts:46, 140`; `docs/cookbook/adding-a-tool.md:68-98`).
    - Concurrency classification via `isConcurrencySafe` (`packages/core/tools/src/index.ts:270`).
  - `@deepseek-ai/dsh-command-kanban` (Host Plane Consumer):
    - Slash command `/kanban` registered on `ctx.commands` (`packages/interaction/commands/src/index.ts:285-292`).
    - Direct host execution outside agent turns for operator commands (`list`, `show`, `create`, `claim`, `complete`, `block`, `unblock`, `link`, `comment`, `stats`).
    - Enforces `INV-04` on `/kanban claim` when invoked from an orchestrator session context.

- **What it deliberately does NOT own**:
  - The `KanbanStore` service definition, SQLite connection, table schemas, or SQL transactions (owned by `@deepseek-ai/dsh-kanban` and `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Web Client UI React DOM components (rendered in browser via `tool.call.toolview` keyed slot, Plan 14).
  - Background watchdog timers, worker monitoring loops, or circuit breakers (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).
  - Git worktree allocation, branch creation, or repository checkouts (owned by `@deepseek-ai/dsh-worktree`, Plan 07).
  - Axiom proof verification or merge gate checks (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Git merge commit landing, draft PR creation, or GitHub check synchronization (owned by `@deepseek-ai/dsh-integrator`, Plan 10).

## 2. Harness Architecture Fit

- **Exact Primitives**:
  - `@deepseek-ai/dsh-tool-kanban`: **Consumer / model-facing tool** plugin (`ctx.tools.register`, `packages/core/tools/src/index.ts:1027`). Holds zero local state; operates as a pure functional projection and validation boundary over `ctx.kanban`.
  - `@deepseek-ai/dsh-command-kanban`: **Consumer / command** plugin (`ctx.commands.register`, `packages/interaction/commands/src/index.ts:285`). Directly executes slash command lines outside the LLM turn loop.

- **Architectural Placement (Agent Plane vs Host Plane)**:
  - `dsh-tool-kanban` resides on the **Agent Plane** within agent presets (`hermes-brain`, `hermes-worker`). It registers scoped model-facing tools via `ScopedLayers` (`packages/core/scope/src/store.ts:159-267`).
  - `dsh-command-kanban` resides on the **Host Plane** within the base bundle (`packages/bundle/base/cordis.patch.yml`), providing `/kanban` across all interactive chat interfaces and CLI profiles.

- **Why Consumer / Tools and not a Service or Event Hook?**:
  - The capability seam (`ctx.kanban`) is already published by the Service Provider in Plan 01.
  - Model-facing tools must be registered into the existing `ctx.tools` registry (`ToolRuntime`, `packages/core/tools/src/index.ts:1027`) so that `ctx.systemPrompt.tools(...)` automatically discovers them and formats schemas for the LLM.
  - The slash command must be registered into `ctx.commands` (`CommandRuntime`, `packages/interaction/commands/src/index.ts:285`) so that UI input lines beginning with `/kanban` are routed directly to host handlers without waking the model.
  - An Event Hook is reactive, whereas tools and commands are explicitly invoked by the model or operator.

- **Why No Isolate Realm in Presets? (PRESET-RULE 4)**:
  - PRESET-RULE 3 applies strictly to *Service Providers* publishing a service on `Context` (`mount.ts:407-412`).
  - PRESET-RULE 4 states: *"Rows that only register into a host registry (tools, commands, skill sources) and provide no service need no realm (`packages/core/tools/src/index.ts:1047`)"*.
  - `dsh-tool-kanban` publishes zero services on `Context`. Calling `ctx.tools.register()` from an agent-scoped context automatically uses `ScopedLayers.effect(ctx, layer => layer.tools.insert(...))` (`packages/core/tools/src/index.ts:1047-1051`), isolating tools to the preset's standing scope (`standing.key`).
  - Placing `dsh-tool-kanban` inside an `isolate` realm is unnecessary and would break its ability to resolve the host's `ctx.kanban` service unless explicitly re-mapped (PRESET-RULE 5).

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Model tool `kanban_show` (§4.5) | Yes (`dsh-tool-kanban`) | None | Model card query tool |
| Model tool `kanban_list` (§4.5) | Yes (`dsh-tool-kanban`, orch only) | None | Capped board list query |
| Model tool `kanban_create` (§4.5) | Yes (`dsh-tool-kanban`) | None | Card authoring tool |
| Model tool `kanban_complete` (§4.5) | Yes (`dsh-tool-kanban`) | None | Card completion tool |
| Model tool `kanban_block` (§4.5) | Yes (`dsh-tool-kanban`) | None | Card blocking tool |
| Model tool `kanban_unblock` (§4.5) | Yes (`dsh-tool-kanban`, orch only) | None | Card unblocking tool |
| Model tool `kanban_request_review` (§4.5) | Yes (`dsh-tool-kanban`, worker only) | None | Review transition tool |
| Model tool `kanban_request_changes` (§4.5) | Yes (`dsh-tool-kanban`) | None | Review rejection tool |
| Model tool `kanban_heartbeat` (§4.5) | Yes (`dsh-tool-kanban`, worker only) | None | Watchdog lease keep-alive |
| Model tool `kanban_comment` (§4.5) | Yes (`dsh-tool-kanban`) | None | Card collaboration comments |
| Model tool `kanban_attach` / `attachments` (§4.5) | Yes (`dsh-tool-kanban`) | None | Binary attachment handling |
| Model tool `kanban_link` (§4.5) | Yes (`dsh-tool-kanban`) | None | DAG dependency edge creation |
| Slash command `/kanban` (§4.5) | Yes (`dsh-command-kanban`) | None | Interactive operator CLI |
| Parent Never Claims (`INV-04`) | Yes (`ctx.tools.guard` & `/kanban claim`) | Plan 01 (CAS storage check) | Monotonic tool guard on orchestrator |
| No Phantom Cards (`INV-15`) | Yes (`kanban_complete` validation) | Plan 01 (`verifyCreatedCards`) | Validated prior to completion commit |
| Role-based tool gating (§4.5, §6.1) | Yes (`Config.role` filtering) | None | Preset configuration determines catalog |
| Web card UI rendering (§4.5) | Host presenters here; Web cards in Client | Plan 14 (`dsh-hermes-base`) | Transport split per cookbook |

## 4. Proposed Package / File Layout

```
packages/kanban/
├── tool-kanban/                                # @deepseek-ai/dsh-tool-kanban (Consumer Tools)
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   └── src/
│       ├── index.ts                            # Entrypoint: inject, apply, Config schema, role gating
│       ├── config.ts                           # Schemastery schema for ToolKanbanConfig (role, limits)
│       ├── guard.ts                            # INV-04 monotonic ToolGuard implementation
│       ├── presentation.ts                     # Host presenters (presentCall, presentResult)
│       └── tools/
│           ├── show.ts                         # kanban_show tool definition
│           ├── list.ts                         # kanban_list tool definition (orchestrator only)
│           ├── create.ts                       # kanban_create tool definition
│           ├── complete.ts                     # kanban_complete tool definition (INV-15 check)
│           ├── block.ts                        # kanban_block and kanban_unblock tool definitions
│           ├── review.ts                       # kanban_request_review & kanban_request_changes
│           ├── heartbeat.ts                    # kanban_heartbeat tool definition (worker only)
│           ├── comment.ts                      # kanban_comment tool definition
│           ├── attachment.ts                   # kanban_attach & kanban_attachments tool definitions
│           └── link.ts                         # kanban_link tool definition
│   └── tests/
│       ├── role-gating.spec.ts                 # Tests tool catalog under orchestrator vs worker roles
│       ├── inv04-parent-claims.spec.ts         # Tests INV-04 tool guard & claim rejection
│       ├── inv15-phantom-cards.spec.ts         # Tests INV-15 HallucinatedCardsError handling
│       ├── presentation.spec.ts                # Tests pure host presenters and soft validation
│       ├── tools-execution.spec.ts             # End-to-end execution against MemoryKanbanStore
│       └── scoped-registration.spec.ts         # Tests ScopedLayers preset isolation
└── command-kanban/                             # @deepseek-ai/dsh-command-kanban (Slash Command)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    └── src/
        ├── index.ts                            # Entrypoint: inject, apply, /kanban command registration
        ├── parser.ts                           # Subcommand and option parser
        └── handlers.ts                         # Command handlers routing to ctx.kanban
    └── tests/
        ├── command-parser.spec.ts              # Subcommand syntax and flag parsing tests
        ├── command-handlers.spec.ts            # Command execution and CommandResult mapping
        └── command-inv04.spec.ts               # Rejection of /kanban claim by root orchestrator
```

## 5. Public Contracts

### 5.1 Configuration Schemas (`packages/kanban/tool-kanban/src/config.ts`)

```typescript
import z from '@deepseek-ai/schemastery'

export type KanbanRole = 'orchestrator' | 'worker'

export interface ToolKanbanConfig {
  /** Session role governing which tools register into the agent catalog. */
  role: KanbanRole
  /** Maximum number of cards kanban_list returns in one call. Default: 50. */
  maxListLimit?: number
}

export const ToolKanbanConfig: z<ToolKanbanConfig> = z.object({
  role: z.union([
    z.literal('orchestrator'),
    z.literal('worker'),
  ]).default('worker').description('Role governing registered tool surface'),
  maxListLimit: z.number().min(1).max(200).default(50)
    .description('Maximum items returned by kanban_list'),
})
```

### 5.2 Model-Facing Tool Catalog Specification

Every tool is constructed via `defineTool` (`packages/core/tools/src/schema.ts:545-547`) adhering to `ParameterSchemaSpec` and `ValueSchemaSpec`:

```typescript
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { taskId, type TaskId, type TaskStatus } from '@deepseek-ai/dsh-kanban'
```

#### Tool Inventory Matrix

| Tool Name | Allowed Roles | Concurrency Safe | Key Parameters | Canonical Output Schema | UI Card Kind |
|---|---|---|---|---|---|
| `kanban_show` | orchestrator, worker | Yes | `task_id` (req), `include_comments`, `include_runs` | `{ task: Task, parents: Task[], children: Task[], comments?: TaskComment[], runs?: TaskRun[] }` | `generic` |
| `kanban_list` | orchestrator only | Yes | `status`, `assignee`, `tenant`, `limit` (max 200) | `{ tasks: TaskSummary[], total: number }` | `generic` |
| `kanban_create` | orchestrator, worker | No (Barrier) | `title` (req), `body`, `assignee`, `priority`, `workspace_kind`, `parents`, `goal_mode`, `skills`, `completion_contract` | `{ ok: true, taskId: TaskId, status: TaskStatus }` | `generic` |
| `kanban_complete` | orchestrator, worker | No (Barrier) | `task_id` (req), `summary` (req), `result`, `metadata`, `created_cards` | `{ ok: true, taskId: TaskId, status: 'done', promotedChildren: TaskId[] }` | `generic` |
| `kanban_block` | orchestrator, worker | No (Barrier) | `task_id` (req), `reason` (req), `kind` (req: `dependency\|needs_input\|capability\|transient`) | `{ ok: true, taskId: TaskId, status: 'blocked', blockKind: string }` | `generic` |
| `kanban_unblock` | orchestrator only | No (Barrier) | `task_id` (req) | `{ ok: true, taskId: TaskId, status: TaskStatus }` | `generic` |
| `kanban_request_review` | worker only | No (Barrier) | `task_id` (req), `summary` (req), `reviewer`, `metadata` | `{ ok: true, taskId: TaskId, status: 'review' }` | `generic` |
| `kanban_request_changes` | orchestrator, worker | No (Barrier) | `task_id` (req), `reason` (req) | `{ ok: true, taskId: TaskId, status: 'running' }` | `generic` |
| `kanban_heartbeat` | worker only | No | `task_id` (req), `note` | `{ ok: true, taskId: TaskId, timestamp: number }` | `generic` |
| `kanban_comment` | orchestrator, worker | No | `task_id` (req), `body` (req) | `{ ok: true, commentId: number, taskId: TaskId }` | `generic` |
| `kanban_attach` | orchestrator, worker | No | `task_id` (req), `filename` (req), `stored_path` (req), `content_type`, `size` | `{ ok: true, attachmentId: number, taskId: TaskId }` | `generic` |
| `kanban_attachments` | orchestrator, worker | Yes | `task_id` (req) | `{ attachments: TaskAttachment[] }` | `generic` |
| `kanban_link` | orchestrator, worker | No (Barrier) | `parent_id` (req), `child_id` (req) | `{ ok: true, parentId: TaskId, childId: TaskId }` | `generic` |

### 5.3 Invariant Implementations (`guard.ts`, `complete.ts`)

#### Invariant INV-04 (Parent Never Claims)
```typescript
// packages/kanban/tool-kanban/src/guard.ts
import type { ToolExecution, ToolGuard } from '@deepseek-ai/dsh-tools'

/**
 * INV-04: The parent orchestrator shall never claim a Kanban card.
 * Registered as a monotonic ToolGuard on orchestrator session scopes.
 */
export function createParentNeverClaimsGuard(): ToolGuard {
  return (exec: Readonly<ToolExecution>): string | undefined => {
    if (exec.name === 'kanban_claim') {
      return 'INV-04 Violation: Parent orchestrator sessions are strictly forbidden from claiming Kanban cards; work must be executed by dispatched workers.'
    }
    return undefined
  }
}
```

#### Invariant INV-15 (No Phantom Cards)
```typescript
// packages/kanban/tool-kanban/src/tools/complete.ts
import { taskId, type TaskId } from '@deepseek-ai/dsh-kanban'
import type { Context } from '@deepseek-ai/cordis'

export async function validateCreatedCards(
  ctx: Context,
  workerProfile: string,
  rawCardIds: readonly string[],
): Promise<readonly TaskId[]> {
  const brandedIds = rawCardIds.map(id => taskId(id))
  // Calls verifyCreatedCards on KanbanStore (Plan 01 contract)
  // Throws HallucinatedCardsError if any card does not exist or was not created by workerProfile
  await ctx.kanban.verifyCreatedCards(workerProfile, brandedIds)
  return brandedIds
}
```

### 5.4 Host UI Presentation & Metadata Projection (`presentation.ts`)

Conforms strictly to `docs/cookbook/adding-a-tool.md:68-98` and `packages/core/tools/src/presentation.ts:46, 140`:

```typescript
// packages/kanban/tool-kanban/src/presentation.ts
import type { ToolCallView, ToolResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/schemastery'

/** Pure host presenter for pending tool calls. Never throws; soft-validates. */
export function presentKanbanCall(name: string, args: unknown): ToolCallView | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>

  switch (name) {
    case 'kanban_show':
      return typeof record.task_id === 'string'
        ? { card: 'generic', title: `Show card ${record.task_id}`, kind: 'read', rawInput: args }
        : undefined
    case 'kanban_create':
      return typeof record.title === 'string'
        ? { card: 'generic', title: `Create card: "${record.title}"`, kind: 'other', rawInput: args }
        : undefined
    case 'kanban_complete':
      return typeof record.task_id === 'string'
        ? { card: 'generic', title: `Complete card ${record.task_id}`, kind: 'other', rawInput: args }
        : undefined
    case 'kanban_block':
      return typeof record.task_id === 'string'
        ? { card: 'generic', title: `Block card ${record.task_id}: ${record.reason ?? ''}`, kind: 'other', rawInput: args }
        : undefined
    default:
      return { card: 'generic', title: `Kanban: ${name}`, kind: 'other', rawInput: args }
  }
}

/** Pure host presenter for completed results. Never throws; soft-validates. */
export function presentKanbanResult(name: string, args: unknown, result: ToolResult): ToolResultView | undefined {
  if (result.isError) {
    return { card: 'generic', title: `Failed: ${name}`, content: result.content }
  }
  return { card: 'generic', title: `Succeeded: ${name}`, content: result.content }
}

/** Derives replayable JSON for session persistence on tool/result. */
export function projectKanbanMeta(name: string, args: unknown, value: unknown): JsonValue {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  return {
    tool: name,
    taskId: v.taskId ?? (args as Record<string, unknown>)?.task_id ?? null,
    status: v.status ?? null,
  } as JsonValue
}
```

### 5.5 Slash Command Contract (`packages/kanban/command-kanban/src/index.ts`)

```typescript
// packages/kanban/command-kanban/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { handleKanbanSubcommand } from './handlers.ts'

export const name = 'command-kanban'
export const inject = ['commands', 'kanban']

export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'kanban',
    description: 'Manage and inspect the autonomous Kanban work queue.',
    input: { hint: '<subcommand> [args...]' },
    recordInput: true,
    async handler(invocation: CommandInvocation): Promise<CommandResult> {
      return handleKanbanSubcommand(ctx, invocation)
    },
  })
}
```

## 6. Lifecycle and Scoping

- **`@deepseek-ai/dsh-tool-kanban` Scoping**:
  - Mounted within agent presets (`hermes-brain`, `hermes-worker`) on the **Agent Plane**.
  - `ctx.tools.register()` executes within `ScopedLayers.effect(ctx, ...)` (`packages/core/tools/src/index.ts:1047-1051`).
  - Tools are registered into the agent preset's standing scope (`standing.key`).
  - Sibling presets maintain disjoint standing scopes, ensuring that `hermes-worker` never sees `kanban_list` or `kanban_unblock`, and `hermes-brain` never sees `kanban_heartbeat`.
  - Disposing the agent session fiber unregisters the tools and lifts the `INV-04` guard cleanly without touching other sessions.

- **`@deepseek-ai/dsh-command-kanban` Scoping**:
  - Mounted on the **Host Plane** in the base bundle patch (`packages/bundle/base/cordis.patch.yml`).
  - Registered into global `ctx.commands`. Accessible from any interactive UI adapter (Web chat, CLI prompt, ACP client).

- **Dependency Injections**:
  - `dsh-tool-kanban`: `inject = ['tools', 'kanban']`. Fails fast at preset mount if `ctx.kanban` is missing (PRESET-RULE 11).
  - `dsh-command-kanban`: `inject = ['commands', 'kanban']`. Fails fast at host boot if `ctx.kanban` is missing.

- **Approval Pipeline Integration**:
  - Concurrency Safety: Read tools (`kanban_show`, `kanban_list`, `kanban_attachments`) declare `isConcurrencySafe: () => true`, allowing parallel dispatch with sibling read calls. Mutation tools (`kanban_create`, `kanban_complete`, `kanban_block`, `kanban_link`) declare `isConcurrencySafe: () => false`, imposing execution barriers.
  - Permission Gates: Tools pass through the `tools/pre-execute` waterfall (`packages/core/tools/src/index.ts:144`). Under `workspace-write` permission preset, internal database mutations execute without interactive prompting. Under strict approval policies, calls fall through to `ctx.approval.request()`.

## 7. Agent Preset Integration

In compliance with **PRESET-RULES 1, 2, and 4** (`PRESET-RULES.md:5-10`):

### 7.1 Orchestrator Preset (`hermes-brain/agent.cordis.yml`)
```yaml
# hermes-brain: Orchestrator session composition
- id: tool-kanban
  name: '@deepseek-ai/dsh-tool-kanban'
  config:
    role: orchestrator
    maxListLimit: 200
```
- Visible inside preset: `kanban_show`, `kanban_list`, `kanban_create`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_link`, `kanban_comment`, `kanban_attach`, `kanban_attachments`.
- Active guard: `INV-04` (Parent Never Claims) denies any claim calls.

### 7.2 Worker Preset (`hermes-worker/agent.cordis.yml`)
```yaml
# hermes-worker: Unattended autonomous worker composition
- id: tool-kanban
  name: '@deepseek-ai/dsh-tool-kanban'
  config:
    role: worker
```
- Visible inside preset: `kanban_show`, `kanban_create`, `kanban_complete`, `kanban_block`, `kanban_request_review`, `kanban_request_changes`, `kanban_heartbeat`, `kanban_comment`, `kanban_attach`, `kanban_attachments`, `kanban_link`.
- Suppressed: `kanban_list`, `kanban_unblock`.

### 7.3 Host Bundle Patch (`packages/bundle/base/cordis.patch.yml`)
```yaml
# Host Plane CLI & slash command registration
- insert:
    - id: command-kanban
      name: '@deepseek-ai/dsh-command-kanban'
```

## 8. Execution Flow

### 8.1 Model Creates Card with Parent Link (`hermes-brain`)

```
Model (hermes-brain)
  │
  ├──> tool/call: kanban_create({ title: "Write tests", parents: ["t_1001"] })
  │      │
  │      ├──> tools/pre-execute waterfall (allow)
  │      ├──> evaluate ToolGuards (passes)
  │      │
  │      ├──> kanban_create.execute(args, exec)
  │      │      │
  │      │      └──> ctx.kanban.createTask({
  │      │             title: args.title,
  │      │             parents: args.parents.map(taskId),
  │      │             createdBy: exec.agent.id,
  │      │             status: 'todo' // gated by parent t_1001 (INV-05)
  │      │           })
  │      │
  │      ├──> output.schema validation & JSON snapshot
  │      ├──> output.presentationMeta -> result.meta { taskId: "t_1002", status: "todo" }
  │      └──> output.render -> [{ type: 'text', text: 'Created card t_1002 (status: todo, waiting on t_1001)' }]
  │
  └──> tool/result: { ok: true, taskId: "t_1002", status: "todo" }
```

### 8.2 Worker Completes Card with Phantom Card Check (`INV-15`)

```
Model (hermes-worker)
  │
  ├──> tool/call: kanban_complete({
  │      task_id: "t_1002",
  │      summary: "Implemented unit tests",
  │      created_cards: ["t_9999"] // hallucinated ID
  │    })
  │      │
  │      ├──> tools/pre-execute waterfall (allow)
  │      │
  │      ├──> kanban_complete.execute(args, exec)
  │      │      │
  │      │      ├──> validateCreatedCards(ctx, exec.agent.id, args.created_cards)
  │      │      │      │
  │      │      │      └──> ctx.kanban.verifyCreatedCards(workerId, ["t_9999"])
  │      │      │             └──> SQLite query: t_9999 NOT FOUND!
  │      │      │             └──> THROWS HallucinatedCardsError("t_9999")
  │      │      │
  │      │      └──> Caught: returns structured ToolExecutionFailure:
  │      │             isError: true
  │      │             error: { message: "INV-15 Violation: Card t_9999 was not created by this worker" }
  │      │
  │      └──> output.render explains failure; card status remains 'running'
  │
  └──> tool/result: Error: INV-15 Violation (completion aborted)
```

### 8.3 Operator Executes `/kanban claim` via Slash Command (`INV-04`)

```
Operator (Chat UI)
  │
  ├──> Input: "/kanban claim t_1002"
  │      │
  │      ├──> ctx.commands.execute("kanban", "claim t_1002", invocation)
  │      │      │
  │      │      ├──> parseSubcommand -> { sub: "claim", taskId: "t_1002" }
  │      │      │
  │      │      ├──> Check INV-04:
  │      │      │      Is invocation.agent an orchestrator root session?
  │      │      │      If YES:
  │      │      │        return { kind: 'error', text: 'INV-04: Orchestrator cannot claim cards.' }
  │      │      │      If NO:
  │      │      │        ctx.kanban.claimTask(taskId("t_1002"), workerId, 900)
  │      │      │        return { kind: 'success', text: 'Claimed card t_1002' }
  │      │
  │      └──> Render command/done in chat UI
```

## 9. Error, Cancellation, and Lifecycle Behavior

- **Cancellation (`exec.signal` and `invocation.signal`)**:
  - Tools forward `exec.signal` to underlying asynchronous calls. If the agent turn is aborted or cancelled by the user, in-flight queries abort immediately without committing partial operations.
  - Slash command handlers pass `invocation.signal` to `ctx.kanban` operations.
- **Invariant Violations**:
  - `INV-04` (Parent Never Claims): Monotonic tool guard rejects call synchronously before execution, returning a clear error text explaining the invariant.
  - `INV-15` (No Phantom Cards): `completeTask` aborts before the `writeTxn` transaction commits. The card remains in `running` or `review` status, preventing unearned credit.
- **DAG Errors & Gating Failures**:
  - Cycle detection failures throw `CyclicDependencyError`, which `kanban_link` catches and renders as an actionable model instruction: `"Failed to link dependency: cycle detected between parent and child."`
  - Gating conflicts return clear explanations of unsatisfied prerequisites.
- **Soft Presenter Fallbacks**:
  - In compliance with the Harness cookbook (`docs/cookbook/adding-a-tool.md:89-90`), `presentCall` and `presentResult` validate arguments softly using optional chaining and type guards. If arguments are malformed or from an older schema version during session log replay, presenters return `undefined` rather than throwing, allowing the UI to fall back to generic card views safely.
- **Unload & HMR Disposal**:
  - Disposing the plugin unregisters all tools and slash commands via their effect disposers (`() => void`).
  - Monotonic guards are removed from `ScopedLayers`, restoring default permissions immediately.

## 10. Testing Strategy

Collocated tests under `packages/kanban/tool-kanban/tests/` and `packages/kanban/command-kanban/tests/`:

1. **Role-Gating Unit Tests (`role-gating.spec.ts`)**:
   - Mounts `dsh-tool-kanban` under mock context with `role: 'orchestrator'`.
   - Asserts `kanban_list` and `kanban_unblock` are registered; asserts `kanban_heartbeat` and `kanban_request_review` are absent.
   - Re-mounts under `role: 'worker'`.
   - Asserts `kanban_heartbeat`, `kanban_request_review`, and `kanban_request_changes` are registered; asserts `kanban_list` and `kanban_unblock` are absent.
2. **Invariant INV-04 Guard Tests (`inv04-parent-claims.spec.ts`)**:
   - Registers orchestrator guard. Attempts to execute `kanban_claim` through `ctx.tools.execute()`.
   - Asserts guard synchronously returns denial string citing `INV-04`.
   - Simulates `/kanban claim` from root agent session; asserts command returns error.
3. **Invariant INV-15 Phantom Card Tests (`inv15-phantom-cards.spec.ts`)**:
   - Calls `kanban_complete` with non-existent card ID in `created_cards`.
   - Asserts execution fails, returning structured error with `INV-15` diagnostic.
   - Asserts card status in `MemoryKanbanStore` remains `running`.
4. **Presentation Purity & Soft Validation Tests (`presentation.spec.ts`)**:
   - Verifies `presentCall` and `presentResult` are pure functions (no I/O, no async).
   - Passes malformed args (`null`, numbers, mismatched keys); asserts return is `undefined` (never throws).
   - Asserts `projectKanbanMeta` generates replayable JSON for session events.
5. **Tool Execution Contract Tests (`tools-execution.spec.ts`)**:
   - Executes full suite of 13 tools against `MemoryKanbanStore`.
   - Tests parameter schema validation: verifies missing required fields throw `ToolArgsError` before `execute`.
   - Verifies canonical JSON return matches declared `output.schema`.
6. **ScopedLayers Preset Isolation Tests (`scoped-registration.spec.ts`)**:
   - Creates two distinct agent scope contexts (`scopeA`, `scopeB`) parenting to separate standing keys.
   - Mounts orchestrator tools in scope A, worker tools in scope B.
   - Asserts `ctx.tools.schemas(scopeA)` contains `kanban_list` and lacks `kanban_heartbeat`.
   - Asserts `ctx.tools.schemas(scopeB)` contains `kanban_heartbeat` and lacks `kanban_list`.
7. **Slash Command Parsing & Execution Tests (`command-parser.spec.ts`, `command-handlers.spec.ts`)**:
   - Tests parsing of subcommands, arguments, and optional flags (`--reason`, `--priority`, `--parents`).
   - Asserts handlers invoke correct `ctx.kanban` methods and format `CommandResult` output text.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Model-facing tool schemas & parameter validation | `/home/sic/Downloads/hermes-agent-main/tools/kanban_tools_schemas.py:43-516` | Complete JSON schemas, parameter properties, required field lists, and byte-frozen LLM-facing prompt descriptions for all 13 model tools (`kanban_show`, `kanban_list`, `kanban_create`, `kanban_complete`, `kanban_block`, `kanban_unblock`, `kanban_request_review`, `kanban_request_changes`, `kanban_heartbeat`, `kanban_comment`, `kanban_attach`, `kanban_attach_url`, `kanban_link`). | Convert Python schema dictionaries into Schemastery / Zod schemas (`defineTool` with `ParameterSchemaSpec` in `packages/core/tools/src/schema.ts`) and define TypeScript parameter interfaces. | direct port |
| Model-facing tool handlers & execution logic | `/home/sic/Downloads/hermes-agent-main/tools/kanban_tools.py:217-967` | Input argument parsing, card state querying, creation with DoD/parent links, completion payload parsing (`summary`, `result`, `metadata`), transition triggers, comment trail updates, and heartbeat lease renewal. | Map Python tool handler functions to standalone tool files in `src/tools/*.ts` delegating directly to `ctx.kanban` service methods instead of direct SQLite connections, and wrap errors in typed `ToolExecutionError`. | port with adaptation |
| Role-based tool gating (`orchestrator` vs `worker`) | `/home/sic/Downloads/hermes-agent-main/tools/kanban_tools.py:37-83, 971-993` | Tool catalog partitioning logic: orchestrator sessions receive board management tools (`kanban_list`, `kanban_unblock`) and are denied execution tools; worker sessions receive execution tools (`kanban_heartbeat`, `kanban_request_review`, `kanban_request_changes`) and are denied `kanban_list`. | Replace Python `check_fn` closures and env checks (`HERMES_KANBAN_TASK`) with declarative Cordis preset configuration (`ToolKanbanConfig.role: 'orchestrator' | 'worker'`), registering tools selectively on standing scopes via `ScopedLayers`. | port with adaptation |
| Monotonic tool guard — parent never claims (`INV-04`) | `/home/sic/Downloads/hermes-agent-main/tools/kanban_tools.py:164-197`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:370-385` | Invariant guard rejecting task claim requests originating from orchestrator sessions, enforcing that the coordinating orchestrator never executes worker assignments. | Port runtime check to Cordis monotonic `ToolGuard` (`ctx.tools.guard()`) registered on orchestrator preset contexts to intercept and reject any card claim attempt or `/kanban claim` invocation. | port with adaptation |
| Anti-phantom card validation on completion (`INV-15`) | `/home/sic/Downloads/hermes-agent-main/tools/kanban_tools.py:550-600` | `created_cards` list verification algorithm: inspect child task IDs declared at completion and ensure they exist and were created by the active run before allowing completion commit. | Convert Python `_Reject` to TypeScript `HallucinatedCardsError` thrown within `kanban_complete` handler validating against `ctx.kanban.verifyCreatedCards()`. | direct port |
| Interactive operator slash command (`/kanban`) | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban.py:1282-1345`<br>`/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_parser.py:22-120` | Slash command token parsing, subcommand tree dispatch (`list`, `show`, `create`, `claim`, `complete`, `block`, `unblock`, `link`, `comment`, `stats`), help text formatting, and usage rendering. | Replace Python argparse / shlex parser with `@deepseek-ai/dsh-commands` runtime handler registered on `ctx.commands`, returning strongly typed `CommandResult` objects. | port with adaptation |
| Host UI presentation projections (`presentCall` / `presentResult`) | `/home/sic/Downloads/hermes-agent-main/hermes_cli/kanban_output.py:40-150` | Card status formatting, metadata extraction, summary truncation, status badges, and comment trail presentation rules. | Convert terminal CLI print formatters into pure TypeScript presenter functions (`presentCall`, `presentResult` returning `presentationMeta`) conforming to `packages/core/tools/src/presentation.ts`. | port with adaptation |

The single most valuable capability to port is the byte-frozen tool schemas, parameter descriptions, and anti-phantom card validation logic (`tools/kanban_tools_schemas.py:43-516` & `tools/kanban_tools.py:550-600`). In autonomous agent systems, prompt-cached tool descriptions must be precisely phrased to prevent hallucinations, while `INV-15` provides the critical mechanical boundary preventing models from claiming completion on hallucinated task dependencies.

## 11. Implementation Steps

1. **Implement `@deepseek-ai/dsh-tool-kanban`** (`packages/kanban/tool-kanban/`):
   - Setup `package.json`, `tsconfig.json`, `README.md` referencing `@deepseek-ai/dsh-kanban` and `@deepseek-ai/dsh-tools`.
   - Implement `src/config.ts`: Schemastery `ToolKanbanConfig` schema (`role`, `maxListLimit`).
   - Implement `src/guard.ts`: `createParentNeverClaimsGuard` for `INV-04`.
   - Implement `src/presentation.ts`: `presentKanbanCall`, `presentKanbanResult`, `projectKanbanMeta`.
   - Implement tool modules in `src/tools/`:
     - `show.ts`, `list.ts`, `create.ts`, `complete.ts`, `block.ts`, `review.ts`, `heartbeat.ts`, `comment.ts`, `attachment.ts`, `link.ts`.
   - Implement `src/index.ts`: Export `apply`, `inject = ['tools', 'kanban']`, role-conditional tool registration, and guard attachment.
2. **Implement `@deepseek-ai/dsh-command-kanban`** (`packages/kanban/command-kanban/`):
   - Setup `package.json`, `tsconfig.json`, `README.md` referencing `@deepseek-ai/dsh-kanban` and `@deepseek-ai/dsh-commands`.
   - Implement `src/parser.ts`: Parse CLI subcommands (`list`, `show`, `create`, `claim`, `complete`, `block`, `unblock`, `link`, `comment`, `stats`) and flag options.
   - Implement `src/handlers.ts`: Subcommand dispatch logic calling `ctx.kanban` methods; enforce `INV-04` on `claim`.
   - Implement `src/index.ts`: Export `apply`, `inject = ['commands', 'kanban']`, register `/kanban` on `ctx.commands`.
3. **Verify Tests & Preset Validation**:
   - Run test suite across both packages using Vitest.
   - Verify preset compositions mount cleanly using `verify-cordis-config`.

## 12. Acceptance Criteria

- [ ] All 13 model-facing tools construct with `defineTool` and pass strict `ParameterSchemaSpec` validation.
- [ ] `ToolKanbanConfig.role === 'orchestrator'` registers `kanban_list` and `kanban_unblock`, and suppresses worker-only tools.
- [ ] `ToolKanbanConfig.role === 'worker'` registers `kanban_heartbeat`, `kanban_request_review`, and `kanban_request_changes`, and suppresses `kanban_list`.
- [ ] Invariant `INV-04` is enforced: Monotonic tool guard denies any card claim by an orchestrator session.
- [ ] Invariant `INV-15` is enforced: `kanban_complete` rejects completion with `HallucinatedCardsError` if unverified card IDs are passed in `created_cards`.
- [ ] Concurrency safety: Read tools declare `isConcurrencySafe: true`; mutation tools declare `isConcurrencySafe: false`.
- [ ] Presenters `presentCall` and `presentResult` are pure functions and softly validate without throwing on replay.
- [ ] Presets declare `@deepseek-ai/dsh-tool-kanban` at top level without isolate realms, conforming to PRESET-RULE 4.
- [ ] `/kanban` slash command parses subcommands and executes host operations, returning typed `CommandResult`.
- [ ] 100% test pass rate across all collocated unit, role-gating, presentation, invariant, and integration tests.

## Review fixes applied

- Added `## Port sources` section detailing source mappings from Hermes repositories (`tools/kanban_tools_schemas.py`, `tools/kanban_tools.py`, `hermes_cli/kanban.py`, `kanban_parser.py`, `kanban_output.py`, and orchestrator assets) to accelerate interaction tools implementation.
