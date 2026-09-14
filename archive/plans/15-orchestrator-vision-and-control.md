# 15 — Orchestrator Vision and Control

## Features

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

## 1. Purpose

This plan establishes full orchestrator vision and control over background workers in DeepSeek Harness, enabling the Brain orchestrator (`hermes-brain`) to monitor, steer, and terminate workers deterministically while enforcing concurrency bounds.

### 1.1 The Primary Architectural Correction: Two-Way Communication Already Exists
Prior analyses assumed that parent-to-worker steering and worker-to-parent reporting required custom message queues or out-of-band IPC. **This assumption is false.** DeepSeek Harness implements native, bidirectional, in-session communication across continuable child boundaries without new machinery:

1. **Parent $\to$ Running Child Steering**: The parent calls `send_message({ agent_id, message })` (`packages/subagent/tool-subagent-control/src/index.ts:28-74`). The runtime routes this through `ctx.subagents.sendMessage` (`packages/subagent/subagent/src/index.ts:246-253`) into `SubagentContinuationManager.sendMessage` (`packages/subagent/subagent/src/continuation.ts:202-232`). The message is delivered as `'steer'` into the child's `inbox.nextStep` (`packages/subagent/subagent/src/continuation-activation.ts:308-320`), where the child loop consumes it at its **nearest step boundary** without cutting in-flight tool execution.
2. **Child $\to$ Parent In-Turn Reply**: In `withContinuableReturnGuidance` (`packages/subagent/subagent/src/continuation-messages.ts:81-97`), every continuable child receives explicit instruction carrying its parent session ID:
   ```typescript
   // packages/subagent/subagent/src/continuation-messages.ts:88-95
   `Your parent agent id is ${encodedParentId}. Before you finish, send your result to that agent with `
     + `send_message({ agent_id: ${encodedParentId}, message: "<self-contained result>" }). The parent shares `
     + 'your workspace but does not automatically receive your transcript, tool output, or reasoning. Send '
     + 'earlier messages as well when a finding changes what the parent should do next; sending a message '
     + 'does not end your turn.'
   ```
   The child invokes `send_message` targeting `parentId`. `SubagentContinuationManager.sendMessage` detects `senderActivation.parentSession === targetId` (`continuation.ts:216-220`), routes to `sendToParent`, and wakes the parent with `'steer'` or `'queue'` via `this.activations.sendWaking(parent, message, 'steer')`.
3. **Settlement Notice on Completion**: When a child activation reaches a terminal state, `ContinuableActivationRegistry.notifySettlement` (`continuation-activation.ts:823-834`) automatically constructs `createSettlementMessage(activation.childId, terminal)` (`continuation-messages.ts:135-154`) and wakes the parent.

Implementers MUST NOT rebuild this communication substrate.

### 1.2 What This Plan Delivers (Closing the Three Hermes Gaps)
While two-way messaging is native, Harness lacks three critical operational capabilities that Hermes provides:
1. **Visibility**: `list_agents` returns only coarse status (`running | idle | ready`), omitting elapsed duration, step counts, active tools, and models. Furthermore, no tool exists to tail in-flight child output. This plan introduces host-plane progress tracking and the `subagent_tail` tool.
2. **Termination**: `interrupt_agent` only halts the *current turn* (`keepInbox: true`). No model-facing tool exists to hard-kill runaway or corrupted workers. This plan exposes `kill_agent`, backed by `ctx.subagents.drainContinuableChildren`, guarded by worktree and Kanban safety invariants.
3. **Concurrency and Safety**: Subagent delegation is unbounded up to `maxDepth`. This plan adds a concurrent child ceiling (`maxConcurrentChildren`) and an operator spawn pause gate (`spawnPaused`).

- **What it owns**:
  - Host Service Provider `@deepseek-ai/dsh-subagent-progress` (`packages/subagent/subagent-progress`).
  - Model-facing tools `subagent_tail`, `kill_agent`, and enriched `list_agents` in `@deepseek-ai/dsh-tool-subagent-control`.
  - Concurrency ceiling and spawn pause validation in `@deepseek-ai/dsh-tool-subagent`.
  - Zombie and hung-worker detection consumed by `@deepseek-ai/dsh-supervisor` (Plan 12).
- **What it deliberately does NOT own**:
  - Core continuation lifecycle or `AgentHandle` management (owned by `@deepseek-ai/dsh-subagent`).
  - Kanban card mutations, leases, and CAS transactions (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Git worktree allocation, branch creation, or commit pinning (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Host watchdog daemon scheduling and circuit breaker storage (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).

## 2. Harness Architecture Fit

### 2.1 Primitive Classification

| Component | Harness Primitive | Plane | Scope / Realm | Justification |
| :--- | :--- | :--- | :--- | :--- |
| `@deepseek-ai/dsh-subagent-progress` | Service Definition & Provider (`SubagentProgressTracker`) | Host Plane | Global (`ctx.subagentProgress`) | Ingests cross-session Cordis events from all active children; maintains live telemetry cache outside ephemeral sessions. |
| `list_agents` (enriched) | Model-facing Tool | Agent Plane | Agent-scoped (No isolate realm) | Extends existing discovery tool; reads host `subagents` and `subagentProgress` to render rich status. |
| `subagent_tail` | Model-facing Tool | Agent Plane | Agent-scoped (No isolate realm) | Reads session events of active child; returns formatted transcript window without modifying session state. |
| `kill_agent` | Model-facing Tool | Agent Plane | Agent-scoped (No isolate realm) | Authorizes caller against child lineage; delegates hard stop to host `ctx.subagents.drainContinuableChildren`. |
| Concurrency Guard | Configuration & Execution Gate | Agent Plane | Agent-scoped (Inside `tool-subagent`) | Intercepts `startContinuable` before child allocation to enforce concurrency ceilings and pause flags. |

Per PRESET-RULE 4, tool rows only register into `ctx.tools` (which uses `ScopedLayers`) and provide no Cordis services, so they need no `isolate` realm.

### 2.2 Core Modification Register (`packages/subagent`)
Per repository policy, modifying in-tree packages within `packages/subagent` requires a strict register:

1. **Desired Behavior**:
   - (a) Enrich `list_agents` output schema with runtime telemetry (`running_seconds`, `step_count`, `last_tool`, `model`, `last_step_seconds_ago`).
   - (b) Expose `kill_agent` calling `ctx.subagents.drainContinuableChildren`.
   - (c) Expose `subagent_tail` reading recent session events.
   - (d) Enforce `maxConcurrentChildren` and `spawnPaused` before `startContinuable`.
2. **Every Extension Point Considered**:
   - *Standalone external plugin outside `packages/subagent`*: Would force defining duplicate tools (`my_list_agents`, `my_kill_agent`) under different names, creating tool collision and confusing the LLM with duplicate tool schemas.
   - *Tool Guards (`ctx.tools.guard()`)*: Can intercept tool calls, but cannot alter `tool-subagent`'s Schemastery Config schema or inject new parameters into `list_agents` output schema.
   - *Session Projections*: Pure fold functions over immutable past events; cannot query live resident agent status or invoke `drainContinuableChildren`.
3. **Why Each is Insufficient**: Companion control tools for subagents belong squarely in `@deepseek-ai/dsh-tool-subagent-control`. Splitting subagent control tools across arbitrary packages violates package cohesion and breaks existing preset compositions.
4. **Smallest Possible Change**:
   - Add new host tracker `@deepseek-ai/dsh-subagent-progress` as an independent sibling package.
   - In `@deepseek-ai/dsh-tool-subagent-control`: add `src/tail.ts`, add `kill_agent` to `src/index.ts`, and enrich `src/list-agents.ts`.
   - In `@deepseek-ai/dsh-tool-subagent`: add `maxConcurrentChildren` and `spawnPaused` to `Config` in `src/index.ts` (15 lines).

## 3. Spec Coverage & Source Provenance

### 3.1 Hermes Port Provenance

| Capability | Hermes Source File | DeepSeek Harness Port | What Changes in Port |
| :--- | :--- | :--- | :--- |
| **Telemetry Projection** | `tools/delegate_tool_registry.py:237-262` (`_list_payload`) | `packages/subagent/subagent-progress/src/index.ts` & `tool-subagent-control/src/list-agents.ts` | Replaces thread dictionary polling with typed Cordis lifecycle event listeners (`agent/pre-step`, `agent/assistant-stream`). |
| **Transcript Tailing** | `tui_gateway/methods_subagents.py:66-90` (`subagent.tail`) | `packages/subagent/tool-subagent-control/src/tail.ts` (`subagent_tail`) | Replaces raw log file byte seeks with structured Harness `Session` event folds; filters system prompts to save tokens. |
| **Hard Worker Kill** | `skills/sic-orchestrator/assets/supervise.py:739-761` (`os.kill(pid, 9)`) | `packages/subagent/tool-subagent-control/src/index.ts` (`kill_agent`) | Replaces OS PID termination with `ctx.subagents.drainContinuableChildren`, preserving worktrees and updating Kanban CAS locks. |
| **Concurrency Ceiling** | `tools/delegate_tool.py:34-48` (`max_concurrent_children`) | `packages/subagent/tool-subagent/src/index.ts` (`maxConcurrentChildren`) | Enforced asynchronously at `startContinuable` preflight rather than in thread pool submission. |
| **Operator Pause Gate** | `tools/delegate_tool_registry.py:39-48` (`set_spawn_paused`) | `packages/subagent/tool-subagent/src/index.ts` (`spawnPaused`) | Integrated into Schemastery config and callable via host service method `ctx.subagents.setSpawnPaused()`. |
| **Zombie Detection** | `supervise.py:739-761` (`STALE_HEARTBEAT_SECONDS = 600`) | `packages/subagent/subagent-progress/src/index.ts` (`isZombie`) | Replaces `os.kill(pid, 0)` with step timestamp recency; consumed directly by `@deepseek-ai/dsh-supervisor`. |

### 3.2 Spec Coverage Matrix

| Spec Requirement | Handled Here | Delegated Elsewhere | Rationale |
| :--- | :--- | :--- | :--- |
| **§5.7 Worker Visibility** | Yes (`SubagentProgressTracker`, `list_agents`) | None | Live metrics projection for active workers. |
| **§5.7 Live Tailing** | Yes (`subagent_tail`) | Core (`session`) | Reads child session events into parent context. |
| **§5.8 Worker Termination** | Yes (`kill_agent`) | `@deepseek-ai/dsh-subagent` | Exposes `drainContinuableChildren` to model. |
| **§5.8 Worktree Preservation** | Yes (`INV-07` guard check in `kill_agent`) | `@deepseek-ai/dsh-worktree-local` | Worktrees are preserved, not deleted on kill. |
| **§5.8 Kanban CAS Clean** | Yes (CAS release in `kill_agent`) | `@deepseek-ai/dsh-kanban-sqlite` | Reclaims running card to blocked/ready. |
| **§5.9 Concurrency Cap** | Yes (`maxConcurrentChildren`) | None | Pre-spawn enforcement in `tool-subagent`. |
| **§5.9 Operator Pause Gate**| Yes (`spawnPaused`) | None | Pre-spawn check in `tool-subagent`. |
| **§5.9 Zombie Reclamation** | Yes (Telemetry flag `zombie: true`) | `@deepseek-ai/dsh-supervisor` (Plan 12) | Plan 12 supervisor watchdog executes recovery. |

## 4. Proposed Package and File Layout

```
packages/subagent/
├── subagent-progress/                         # NEW: @deepseek-ai/dsh-subagent-progress (Host Service)
│   ├── package.json
│   ├── tsconfig.json
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                           # SubagentProgressTracker service definition & provider
│   │   └── types.ts                           # SubagentProgressRecord, TelemetrySnapshot
│   └── tests/
│       ├── progress-tracker.spec.ts           # Event listening & progress metrics unit tests
│       └── zombie-detector.spec.ts            # Inactivity calculation & zombie detection tests
├── tool-subagent-control/                     # EXTENDED: companion control tools
│   ├── package.json
│   ├── src/
│   │   ├── index.ts                           # Registers send_message, interrupt_agent, kill_agent
│   │   ├── list-agents.ts                     # Enriched list_agents with progress projection
│   │   ├── tail.ts                            # subagent_tail tool implementation
│   │   └── kill.ts                            # kill_agent implementation & Kanban/worktree safety
│   └── tests/
│       ├── tail.spec.ts                       # subagent_tail event slicing & rendering tests
│       ├── kill.spec.ts                       # kill_agent authorization & drain validation
│       └── enriched-list.spec.ts              # list_agents schema & progress field tests
└── tool-subagent/                             # EXTENDED: delegation tools
    ├── src/
    │   └── index.ts                           # Config schema update (maxConcurrentChildren, spawnPaused)
    └── tests/
        └── concurrency-limit.spec.ts          # Delegation rejection when limit exceeded or paused
```

## 5. Public Contracts

### 5.1 Host Progress Tracker Service (`@deepseek-ai/dsh-subagent-progress`)

```typescript
// packages/subagent/subagent-progress/src/types.ts
import type { SessionId } from '@deepseek-ai/dsh-session'

export interface SubagentProgressRecord {
  readonly childId: SessionId
  readonly parentId: SessionId
  readonly startedAt: number
  lastStepAt: number
  stepCount: number
  lastTool?: string
  model: string
  label: string
}

export interface SubagentTelemetrySnapshot {
  readonly childId: SessionId
  readonly runningSeconds: number
  readonly stepCount: number
  readonly lastTool?: string
  readonly model: string
  readonly lastStepSecondsAgo: number
  readonly isZombie: boolean
}
```

```typescript
// packages/subagent/subagent-progress/src/index.ts
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProgressRecord, SubagentTelemetrySnapshot } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    subagentProgress: SubagentProgressTracker
  }
}

export class SubagentProgressTracker extends Service {
  static readonly inject = ['subagents', 'agents']
  private records = new Map<SessionId, SubagentProgressRecord>()

  constructor(ctx: Context) {
    super(ctx, 'subagentProgress', true)

    // Track child start from subagent service
    ctx.on('subagent/start', function (info) {
      // Scoped carrier provides parent scope
      const childAgent = ctx.agents.get(info.id)
      const record: SubagentProgressRecord = {
        childId: info.id,
        parentId: childAgent?.parentSessionId ?? ('' as SessionId),
        startedAt: Date.now(),
        lastStepAt: Date.now(),
        stepCount: 0,
        model: childAgent?.model ?? 'unknown',
        label: info.label ?? 'subagent',
      }
      ctx.subagentProgress.records.set(info.id, record)
    })

    // Update step cadence from core agent step events
    ctx.on('agent/pre-step', (turn) => {
      const record = this.records.get(turn.agent.id)
      if (record) {
        record.stepCount += 1
        record.lastStepAt = Date.now()
      }
    })

    // Intercept active tool execution
    ctx.on('agent/assistant-stream', (event) => {
      const record = this.records.get(event.agent.id)
      if (record && event.block.type === 'tool_use') {
        record.lastTool = event.block.name
        record.lastStepAt = Date.now()
      }
    })

    // Clean up settled children
    ctx.on('subagent/end', (info) => {
      this.records.delete(info.id)
    })
  }

  getProgress(childId: SessionId): SubagentTelemetrySnapshot | undefined {
    const r = this.records.get(childId)
    if (!r) return undefined
    const now = Date.now()
    const lastStepSecondsAgo = Math.max(0, Math.floor((now - r.lastStepAt) / 1000))
    return {
      childId: r.childId,
      runningSeconds: Math.max(0, Math.floor((now - r.startedAt) / 1000)),
      stepCount: r.stepCount,
      lastTool: r.lastTool,
      model: r.model,
      lastStepSecondsAgo,
      isZombie: lastStepSecondsAgo > 600, // Stale if no step for 10 minutes
    }
  }

  getActiveCount(parentId: SessionId): number {
    let count = 0
    for (const r of this.records.values()) {
      if (r.parentId === parentId) count++
    }
    return count
  }
}
```

### 5.2 Model-Facing Tool Contracts (`@deepseek-ai/dsh-tool-subagent-control`)

#### 1. Enriched `list_agents` Output Schema
Extends `packages/subagent/tool-subagent-control/src/list-agents.ts:120-130`:
```typescript
{
  kind: { type: 'string', required: true, enum: ['child'] },
  id: { type: 'string', required: true },
  label: { type: 'string', required: true },
  status: { type: 'string', required: true, enum: ['running', 'idle', 'ready'] },
  running_seconds: { type: 'number', description: 'Elapsed wall-clock runtime in seconds' },
  step_count: { type: 'number', description: 'Number of execution steps completed' },
  last_tool: { type: 'string', description: 'Name of the most recently invoked tool' },
  model: { type: 'string', description: 'Model executing this worker' },
  last_step_seconds_ago: { type: 'number', description: 'Seconds elapsed since last step activity' },
  zombie: { type: 'boolean', description: 'True if running worker has shown no step activity for > 600s' },
  parent: { type: 'string' },
  depth: { type: 'number' }
}
```

#### 2. `subagent_tail` Tool Contract
```typescript
// packages/subagent/tool-subagent-control/src/tail.ts
export const subagentTailTool = defineTool({
  name: 'subagent_tail',
  description:
    'Tail the recent activity and transcript events of a running or completed subagent. '
    + 'Allows the orchestrator to inspect intermediate progress, tool calls, and outputs '
    + 'without interrupting the subagent turn.',
  parameters: {
    agent_id: {
      type: 'string',
      required: true,
      description: 'The agent id of the subagent to inspect.',
    },
    tail_events: {
      type: 'number',
      description: 'Number of recent transcript events to retrieve (default: 10, max: 50).',
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', required: true },
        status: { type: 'string', required: true },
        event_count: { type: 'number', required: true },
        transcript_snippet: { type: 'string', required: true },
      },
    },
    render: (args, val) => [{
      type: 'text',
      text: `[tail for ${args.agent_id} (${val.status}) — ${val.event_count} events]\n${val.transcript_snippet}`,
    }],
  },
  async execute(args, exec) {
    const caller = exec.agent
    if (!caller) throw new Error('subagent_tail requires a calling agent')
    const childId = brandString<SessionId>(args.agent_id)

    // Authorize caller against child lineage
    const session = await ctx.sessions.get(childId)
    if (!session || (session.parentSessionId !== caller.id && !session.ancestors?.includes(caller.id))) {
      throw new Error(`Unauthorized: agent ${args.agent_id} is not an active child or descendant`)
    }

    const limit = Math.min(Math.max(args.tail_events ?? 10, 1), 50)
    const events = await session.readTail(limit)

    // Format events compactly, omitting raw system prompts
    const snippet = events
      .filter(e => e.type !== 'system/prompt')
      .map(e => formatSessionEventForModel(e))
      .join('\n---\n')

    const progress = ctx.subagentProgress?.getProgress(childId)
    return {
      agent_id: args.agent_id,
      status: progress ? (progress.isZombie ? 'zombie' : 'running') : 'idle',
      event_count: events.length,
      transcript_snippet: snippet || '(no activity recorded yet)',
    }
  },
})
```

#### 3. `kill_agent` Tool Contract
```typescript
// packages/subagent/tool-subagent-control/src/kill.ts
export const killAgentTool = defineTool({
  name: 'kill_agent',
  description:
    'Hard-stop and tear down a runaway, deadlocked, or corrupted subagent by its agent id. '
    + 'Unlike interrupt_agent (which merely pauses the active turn), kill_agent drains the '
    + 'activation, halts all descendant tasks, cancels pending inboxes, and releases memory handles. '
    + 'SAFETY: Worktrees holding uncommitted work are NEVER deleted; linked Kanban tasks are '
    + 'safely released from running to blocked. Use ONLY when steering and interruption fail.',
  parameters: {
    agent_id: {
      type: 'string',
      required: true,
      description: 'The agent id of the subagent to terminate.',
    },
    reason: {
      type: 'string',
      required: true,
      description: 'Explicit justification for terminating the subagent (e.g. infinite loop, OOM risk).',
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        killed: { type: 'boolean', required: true },
        agent_id: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
    render: (args, val) => [{
      type: 'text',
      text: `kill_agent: ${val.message}`,
    }],
  },
  async execute(args, exec) {
    const caller = exec.agent
    if (!caller) throw new Error('kill_agent requires a calling agent')
    const childId = brandString<SessionId>(args.agent_id)

    // 1. Authorize: Target must be a descendant of caller
    const targetSession = await ctx.sessions.get(childId)
    if (!targetSession || (targetSession.parentSessionId !== caller.id && !targetSession.ancestors?.includes(caller.id))) {
      throw new Error(`Unauthorized: agent ${args.agent_id} is not in your descendant tree`)
    }

    // 2. Execute Hard Stop wrapping existing host API
    await ctx.subagents.drainContinuableChildren(caller, [childId])

    // 3. Safety Check: Assert worktree preservation (INV-07)
    // If child was bound to a worktree, ensure git directory remains intact on disk
    if (ctx.worktrees) {
      const worktreePath = await ctx.worktrees.lookupPath(childId)
      if (worktreePath && !(await ctx.fs.exists(worktreePath))) {
        throw new Error(`CRITICAL INVARIANT VIOLATION: worktree ${worktreePath} was wiped during kill`)
      }
    }

    // 4. Safety Check: Clean up linked Kanban task if running
    if (ctx.kanban) {
      const task = await ctx.kanban.findTaskBySession(childId)
      if (task && task.status === 'running') {
        await ctx.kanban.releaseClaim(task.id, {
          reason: `worker terminated by orchestrator via kill_agent: ${args.reason}`,
          statusOverride: 'blocked',
        })
      }
    }

    return {
      killed: true,
      agent_id: args.agent_id,
      message: `Agent ${args.agent_id} drained and disposed. Worktrees preserved; Kanban claims updated.`,
    }
  },
})
```

### 5.3 Concurrency & Safety Configuration (`@deepseek-ai/dsh-tool-subagent`)
Extends `packages/subagent/tool-subagent/src/index.ts:105-130`:
```typescript
export const Config: z<Config> = z.object({
  // ... existing fields ...
  maxConcurrentChildren: z.number().int().min(1).max(32).default(4),
  spawnPaused: z.boolean().default(false),
})
```
Preflight check inside `execute()` (`tool-subagent/src/index.ts:526`):
```typescript
if (config.spawnPaused) {
  throw new Error('Subagent delegation is currently paused by operator configuration')
}
if (continuable && ctx.subagentProgress) {
  const activeCount = ctx.subagentProgress.getActiveCount(parent.id)
  if (activeCount >= config.maxConcurrentChildren) {
    throw new Error(
      `Cannot delegate: concurrent subagent ceiling reached (${activeCount}/${config.maxConcurrentChildren} running). `
      + 'Wait for existing workers to settle or terminate hung workers with kill_agent before spawning new ones.'
    )
  }
}
```

## 6. Lifecycle and Scoping

### 6.1 Host-Plane Progress Tracker Lifecycle
1. **Instantiation**: Mounted as a global singleton service in the root Cordis host context via bundle `@deepseek-ai/dsh-hermes-base`.
2. **Subscription**: Subscribes to root events `agent/pre-step`, `agent/assistant-stream`, `subagent/start`, and `subagent/end`.
3. **Disposal**: When the host container stops or reloads, Cordis unbinds event listeners and clears the in-memory telemetry map.

### 6.2 Agent-Plane Tool Scoping & Isolate Realms
- `tool-subagent-control` registers `send_message`, `interrupt_agent`, and `kill_agent`.
- `tool-subagent-control/list-agents` registers enriched `list_agents`.
- `tool-subagent-control/tail` registers `subagent_tail`.
- All tools mount on the **Agent Plane** within preset `hermes-brain`. Because tools register strictly into `ctx.tools` (which scopes definitions per-session via `ScopedLayers`), they require **no isolate realm** (PRESET-RULE 4).

### 6.3 Safety Rules for Worker Hard Termination (`kill_agent`)
The orchestrator must follow strict rules when calling `kill_agent`:
1. **Intervention Hierarchy**:
   - Level 1: `send_message` with steer guidance.
   - Level 2: `interrupt_agent` to abort current turn and adjust instructions.
   - Level 3: `kill_agent` used ONLY when worker is completely unresponsive (> 600s zombie), deadlocked in bash/network calls, or burning catastrophic token loops.
2. **Worktree Preservation (`INV-07`)**:
   `kill_agent` disposes the in-memory `AgentHandle` and execution fibers. It NEVER executes `git worktree remove --force`. Any uncommitted changes on the worker branch remain on disk under `.worktrees/<task-id>` for inspection or reassignment.
3. **Kanban Card CAS Release**:
   If the worker was executing a Kanban task (`tasks.status == 'running'`), `kill_agent` transitions the task to `blocked` (or `ready` if retry budget allows) via atomic CAS, recording the kill reason in `task_comments`.

## 7. Agent Preset Integration & Plan Reconciliation

### 7.1 Agent Preset Composition (`hermes-brain/agent.cordis.yml`)
In `packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml`, the `delegation` isolate group is configured as follows:

```yaml
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
        backgroundMode: continuable
        maxConcurrentChildren: 4
        spawnPaused: false

    - id: tool-subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
        backgroundMode: continuable
        maxConcurrentChildren: 4

    - id: tool-subagent-control
      name: '@deepseek-ai/dsh-tool-subagent-control'

    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'

    - id: tool-subagent-tail
      name: '@deepseek-ai/dsh-tool-subagent-control/tail'
```

### 7.2 Reconciliation with Plan 12 (Supervisor and Watchdog)
- **What Changes in Plan 12**:
  Plan 12 (`plans/12-supervisor-and-watchdog.md:24-28, 59-71`) previously specified that the supervisor watchdog maintains an internal `Map<TaskId, ActiveWorkerWatchdog>` and evaluates process heartbeats via OS PIDs (`process.kill(pid, 0)`).
  - *Reconciliation*: For in-process continuable subagents (the standard Harness worker model), Plan 12 is updated to consume `ctx.subagentProgress` from Plan 15.
  - The supervisor's 30-second watchdog queries `ctx.subagentProgress.getProgress(childSessionId)` to read `lastStepSecondsAgo` and `isZombie`.
  - When reclaiming dead or hung continuable workers, the supervisor invokes `ctx.subagents.drainContinuableChildren()` instead of raw OS signals.
  - This eliminates duplicate in-memory step tracking between the supervisor daemon and the subagent runtime.

### 7.3 Reconciliation with Plan 14 (Presets, Profiles, and Bundle)
- **What Changes in Plan 14**:
  - In `packages/bundle/hermes-base/cordis.patch.yml`, mount `@deepseek-ai/dsh-subagent-progress` on the Host Plane:
    ```yaml
    - id: subagent-progress
      name: '@deepseek-ai/dsh-subagent-progress'
    ```
  - In `packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml`, add row `tool-subagent-tail` and configure `maxConcurrentChildren: 4` on `tool-subagent`.
  - `packages/bundle/hermes-base/package.json` adds `@deepseek-ai/dsh-subagent-progress: "workspace:^"`.

## 8. Execution Flow

### 8.1 Scenario A: Normal Inspection & Steering
```
Brain (Model)                 tool-subagent-control          SubagentRuntime           Worker (Child)
     │                                 │                            │                        │
     ├────── list_agents() ───────────►│                            │                        │
     │◄───── [running, 42s, step 3] ───┤                            │                        │
     │                                 │                            │                        │
     ├────── subagent_tail(id) ───────►│                            │                        │
     │◄───── [recent tool calls] ──────┤                            │                        │
     │                                 │                            │                        │
     ├────── send_message(id, msg) ───►├────── sendMessage() ──────►├──── inbox.nextStep ───►│
     │◄───── message delivered ────────┤                            │                        │ (steers step)
     │                                 │                            │                        │
     │◄─────────────────────── settlement notice ───────────────────┴────────────────────────┤ (finishes turn)
```

### 8.2 Scenario B: Runaway Worker Hard Termination (`kill_agent`)
```
Brain (Model)                 kill_agent Tool                SubagentRuntime          Kanban / Worktree
     │                                 │                            │                        │
     ├────── list_agents() ───────────►│                            │                        │
     │◄───── [running, zombie: true] ──┤                            │                        │
     │                                 │                            │                        │
     ├────── kill_agent(id, reason) ──►│                            │                        │
     │                                 ├─ drainContinuableChildren ─►│ (abort turn, dispose) │
     │                                 │                            │                        │
     │                                 ├─ assert worktree exists ───┼───────────────────────►│ (git tree intact)
     │                                 │                            │                        │
     │                                 ├─ releaseClaim(blocked) ────┼───────────────────────►│ (CAS release)
     │◄───── "agent killed & drained" ─┤                            │                        │
```

## 9. Error, Cancellation, and Lifecycle Behavior

1. **Unauthorized Tool Execution**:
   If an agent attempts to invoke `kill_agent`, `subagent_tail`, or `send_message` on a session that is NOT in its descendant tree, the tool throws an immediate authorization error: `Unauthorized: agent <id> is not an active child or descendant`.
2. **Concurrency Limit Exceeded**:
   When `activeCount >= maxConcurrentChildren`, `startContinuable` throws a descriptive validation error before creating session descriptors or allocating workspace resources.
3. **Operator Pause Active**:
   When `spawnPaused: true`, any delegation attempt rejects immediately with `Subagent delegation is currently paused by operator configuration`.
4. **Target Absent or Already Settled**:
   If `kill_agent` is called on an agent that already settled or was evicted, `drainContinuableChildren` completes cleanly as an accepted idempotent no-op.
5. **Partial Failure During Teardown**:
   If disposing an agent handle encounters an error, `drainContinuableChildren` traps the error, flushes the remaining persistent session state, releases Kanban claim locks, and reports the error in the tool output.

## 10. Testing Strategy

### 10.1 Unit Tests
- **`progress-tracker.spec.ts`**: Verify `SubagentProgressTracker` correctly captures `agent/pre-step` and `agent/assistant-stream` events, computes elapsed runtime, and flags `isZombie: true` when inactivity exceeds 600s.
- **`tail.spec.ts`**: Verify `subagent_tail` reads session events, enforces maximum event bounds (50), strips bulky system prompt events, and formats text blocks correctly.
- **`kill.spec.ts`**: Verify `kill_agent` enforces ancestor authorization, calls `drainContinuableChildren`, validates worktree survival (`INV-07`), and executes Kanban claim release.
- **`concurrency-limit.spec.ts`**: Verify `tool-subagent` rejects delegations when `activeCount >= maxConcurrentChildren` or `spawnPaused === true`.

### 10.2 Integration & Composition Tests
- **`vision-composition.spec.ts`**: Boot a real Cordis container mounting `SubagentRuntime`, `SubagentProgressTracker`, `tool-subagent`, and `tool-subagent-control`. Spawn a continuable child, emit simulated steps, tail the live log, and terminate via `kill_agent`.
- **`worktree-preservation.spec.ts`**: Verify that uncommitted git changes in `.worktrees/<id>` remain 100% byte-intact after `kill_agent` execution.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Worker runtime telemetry & progress tracking (`list_agents` enrichment) | `/home/sic/Downloads/hermes-agent-main/tools/delegate_tool_registry.py:237-262` | Telemetry payload shape (`running_seconds`, `model`, `status`, `live_transcript`), active subagent registry tracking, and parent-lineage ownership filter (`_owns_subagent_record`). | Python in-memory thread dictionary converted to Cordis host service `@deepseek-ai/dsh-subagent-progress` listening to typed lifecycle events (`agent/pre-step`, `agent/assistant-stream`, `subagent/start`, `subagent/end`); enrich `list_agents` schema in `packages/subagent/tool-subagent-control/src/list-agents.ts`. | port with adaptation |
| Live transcript tailing (`subagent_tail`) | `/home/sic/Downloads/hermes-agent-main/tui_gateway/methods_subagents.py:66-90` | Reverse byte seeker reading last N bytes of active subagent transcript (`_SUBAGENT_TAIL_BYTES`), UTF-8 truncation handling, and availability flags. | Port from gateway JSON-RPC method into Harness model-facing tool `subagent_tail` in `packages/subagent/tool-subagent-control/src/tail.ts`; read structured Harness `Session` events instead of raw log files, and strip bulky system prompt events to preserve context tokens. | port with adaptation |
| Runaway worker hard termination (`kill_agent`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:739-761`<br>`/home/sic/Downloads/hermes-agent-main/agent/interrupt_compat.py:20-45` | Stale worker reclamation logic, process teardown signaling, and safe cleanup sequence. | Replace raw OS PID signals (`os.kill(pid, 9)`) with Harness `ctx.subagents.drainContinuableChildren()`; add ancestor lineage check, worktree survival verification (`INV-07`), and atomic Kanban CAS claim release to `blocked`/`ready`. | port with adaptation |
| Concurrency ceiling & operator spawn pause gate | `/home/sic/Downloads/hermes-agent-main/tools/delegate_tool_config.py:17-23`<br>`/home/sic/Downloads/hermes-agent-main/tools/delegate_tool_registry.py:39-48` | Concurrency limiter (`_DEFAULT_MAX_CONCURRENT_CHILDREN = 10`) and operator pause flag (`_spawn_paused`, `set_spawn_paused`, `is_spawn_paused`). | Port Python module globals to Schemastery config fields (`maxConcurrentChildren`, `spawnPaused`) in `@deepseek-ai/dsh-tool-subagent/src/index.ts`, enforced asynchronously during `startContinuable` preflight. | direct port |
| Zombie worker detection & stale heartbeat evaluation | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:741-760` | Inactivity threshold algorithm (`age > STALE_HEARTBEAT_SECONDS`), distinguishing running state from silent stall, and automated reclamation triggering. | Port from periodic SQLite polling script to timestamp comparison in `SubagentProgressTracker.isZombie(sessionId)`, checking step recency (>600s) without invoking `os.kill(pid, 0)`; exposed for consumption by Plan 12 supervisor. | port with adaptation |
| Bidirectional in-session messaging & settlement notices | no Hermes equivalent — new code | N/A (Harness already provides native two-way continuable child communication via `send_message`, `inbox.nextStep`, and `createSettlementMessage`). | Documented and verified native Harness substrate; no port needed. | no Hermes equivalent (new code) |

The single most valuable capability to port is the live telemetry projection and transcript tailing logic (`tools/delegate_tool_registry.py:237-262` and `tui_gateway/methods_subagents.py:66-90`). While Harness already possesses native two-way messaging primitives, the orchestrator model operates blind without step-level duration, active tool visibility, and transcript streaming. Adapting Hermes's telemetry payload and bounded transcript tail into `list_agents` and `subagent_tail` gives the brain agent the exact sensory feedback required to detect hung workers and issue targeted steering prompts before timeouts occur.

## 11. Implementation Steps

1. **Phase 1: Host Progress Tracker (`@deepseek-ai/dsh-subagent-progress`)**:
   - Create package directory `packages/subagent/subagent-progress/`.
   - Implement `SubagentProgressTracker` subclassing Cordis `Service` in `src/index.ts`.
   - Wire event listeners for `subagent/start`, `subagent/end`, `agent/pre-step`, and `agent/assistant-stream`.
   - Export package types in `src/types.ts`.
2. **Phase 2: Companion Control Tools (`@deepseek-ai/dsh-tool-subagent-control`)**:
   - Create `src/tail.ts` implementing `subagent_tail`.
   - Create `src/kill.ts` implementing `kill_agent` with worktree and Kanban safety hooks.
   - Update `src/list-agents.ts` to query `ctx.subagentProgress` and append telemetry fields to schema and render output.
   - Update `src/index.ts` to register `kill_agent` alongside `send_message` and `interrupt_agent`.
3. **Phase 3: Concurrency & Pause Enforcement (`@deepseek-ai/dsh-tool-subagent`)**:
   - Extend `Config` in `packages/subagent/tool-subagent/src/index.ts` with `maxConcurrentChildren` and `spawnPaused`.
   - Add preflight validation before calling `ctx.subagents.startContinuable`.
4. **Phase 4: Preset & Plan Reconciliation**:
   - Update `packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml` with `tool-subagent-tail` and `maxConcurrentChildren: 4`.
   - Update `packages/bundle/hermes-base/cordis.patch.yml` to mount `@deepseek-ai/dsh-subagent-progress`.
   - Reconcile Plan 12 and Plan 14 documentation.
5. **Phase 5: Test Execution**:
   - Execute test suite via `scripts/run_tests.sh packages/subagent/`.

## 12. Acceptance Criteria

1. **Native Messaging Grounding**: Plan explicitly documents existing native two-way communication (`send_message`, `ctx.subagents.sendMessage`, `withContinuableReturnGuidance`, and `createSettlementMessage`) with file:line citations, preventing implementers from rebuilding message channels.
2. **Enriched Visibility**: `list_agents` returns `running_seconds`, `step_count`, `last_tool`, `model`, and `last_step_seconds_ago` derived from real Cordis events.
3. **Live Transcript Tailing**: `subagent_tail` returns recent session events from active worker sessions without turn interruption.
4. **Model-Facing Hard Kill**: `kill_agent` exposes `drainContinuableChildren` with ancestor authorization, preserving worktrees (`INV-07`) and releasing Kanban CAS claims.
5. **Concurrency & Pause Enforcement**: `tool-subagent` rejects delegations exceeding `maxConcurrentChildren` or when `spawnPaused: true`.
6. **Supervisor Plan Reconciled**: Plan 12 is updated to consume `ctx.subagentProgress` and `drainContinuableChildren` for in-process continuable workers.
7. **Preset Compatibility**: Preset outline for `hermes-brain` and bundle patch for `hermes-base` carry the exact required rows without plane or isolate violations.

## Review fixes applied

- Added `## Port sources` section detailing source mappings from Hermes repositories (`tools/delegate_tool_registry.py`, `tui_gateway/methods_subagents.py`, `tools/delegate_tool_config.py`, `agent/interrupt_compat.py`, and `supervise.py`) to accelerate orchestrator vision and control implementation.
