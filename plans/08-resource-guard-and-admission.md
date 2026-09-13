# 08 — Resource Guard & Host Headroom Admission

## Features

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

## 1. Purpose

`@deepseek-ai/dsh-guard-resource` provides host-level resource observation, admission control, and file sovereignty enforcement for autonomous engineering agents in StoryInCode.

- **What it owns**:
  - The `resourceGuard` capability seam (`ResourceGuardService` class in `@deepseek-ai/dsh-guard-resource` extending `@deepseek-ai/cordis.Service`).
  - Host memory headroom floor admission control (`INV-12`): ensuring host `MemAvailable` is at or above 1536 MiB and remaining headroom after active reservations is at or above 3072 MiB before admitting resource-heavy tool executions or worker dispatches.
  - Monotonic owner-level tool execution guard via `ctx.tools.guard()` (`packages/core/tools/src/index.ts:1091-1106`): synchronously evaluating tool calls before execution and vetoing with a structured denial string.
  - Human `SOUL.md` sovereignty protection (`INV-09`): synchronously inspecting filesystem mutation tools (`writeText`, `editText`, `fs_write`, `str_replace_editor`, etc.) and command-line execution tools (`bash`, `terminal`) to veto any mutation, truncation, or deletion targeting `SOUL.md`.
  - Systemd cgroup v2 accounting and slice management for `hermes-work.slice`: reading `memory.current`, `memory.max`, `memory.swap.current`, `memory.swap.max`, `memory.oom.group`, and enforcing the aggregate 6 GiB RAM and 512 MiB swap limits (`Spec §1, §8.4`).
  - Dynamic worker admission governor: providing `canAdmitWorker(activeWorkers)` and `checkAdmission()` to `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) and `@deepseek-ai/dsh-supervisor` (Plan 12) to dynamically throttle concurrent worker dispatches during memory spikes (`Spec §4.3`).
  - Platform-adaptive metric extraction: high-precision `/proc/meminfo` and cgroup v2 hierarchy parsing on Linux, with transparent fallback to `node:os.freemem()` on macOS and Windows.
  - Sub-millisecond memoized memory sampling cache: preventing filesystem and procfs hammering during tight parallel tool call batches.
  - Complete configuration schema where every threshold, ceiling, path, and tool pattern is an externally configurable, validated field in `cordis.yml`.

- **What it deliberately does NOT own**:
  - Loop hygiene and duplicate tool call detection (owned by `@deepseek-ai/dsh-repeat-tool-reminder` in `packages/guard/repeat-tool-reminder`, `packages/guard/repeat-tool-reminder/src/index.ts:1-234`).
  - Cooperative per-tool-call timeouts (owned by `@deepseek-ai/dsh-tool-call-timeout-policy` in `packages/guard/timeout-policy`, `packages/guard/timeout-policy/src/index.ts:1-82`).
  - Cryptographic test file hashing and read-only test suite pinning during implementer turns (`INV-13`) (owned by `@deepseek-ai/dsh-guard-test-pinning`, Plan 09).
  - Anti-cheat shell syntax analysis for masked exit codes (`INV-11`) (owned by `@deepseek-ai/dsh-verification`, Plan 09).
  - Dirty or unpushed worktree preservation (`INV-07`) (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).
  - Kanban card claim locking, task state transitions, and SQLite schema (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Worker process watchdog timers, heartbeat timeouts, and circuit breakers (owned by `@deepseek-ai/dsh-supervisor`, Plan 12).
  - Identity prompt contribution for `SOUL.md` (owned by `@deepseek-ai/dsh-persona`, Plan 05).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-guard-resource`: **Service Provider & Host Guard**.
  1. **Service Provider**: Subclasses `Service` from `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:7-8`), registering `ctx.resourceGuard` as a singleton on the host plane, injecting `['tools']` and optionally `['subprocess']`.
  2. **Host Monotonic Guard**: Registers a synchronous owner-level execution guard on `ctx.tools.guard()` (`packages/core/tools/src/index.ts:1100-1106`).
  3. Default export of the `ResourceGuardService` class per the Harness service convention (`packages/AGENTS.md:5`).

### 2.2 Why this Primitive and not the Neighbours
- **Why NOT a simple event-hook plugin (`tools/pre-execute` waterfall listener)**:
  `tools/pre-execute` is an extensible waterfall where listeners return `{ kind: 'allow' }`, `{ kind: 'deny', reason }`, or `{ kind: 'ask', reason }` (`packages/core/tools/src/index.ts:144-148, 1465-1468`). In a waterfall, subsequent listeners can reshape decisions, and an `ask` result diverts into the human approval subsystem (`packages/core/tools/src/index.ts:1469-1475`). In contrast, `ctx.tools.guard()` runs *after* `tools/pre-execute` and approval resolution as a monotonic owner-level check (`packages/core/tools/src/index.ts:1476-1489`). Returning a non-empty string guarantees immediate denial; no downstream listener can turn that denial back into permission (`packages/core/tools/src/index.ts:697-705`). Invariants like `INV-12` (host OOM protection) and `INV-09` (human SOUL sovereignty) are non-negotiable physical and safety boundaries that must never be bypassed by approval waterfalls.
- **Why NOT a model-facing Tool or Skill**:
  Resource admission and memory headroom are host operational constraints, not actions a model chooses to take. Exposing admission or SOUL protection as a tool or skill would rely on model compliance; autonomous agents could forget to check memory or intentionally invoke bypass arguments.
- **Why NOT an Agent-Scoped Guard**:
  Host RAM and cgroup slices are shared host-plane resources across the orchestrator (`hermes-brain`), workers (`hermes-worker`), background review forks, and external tasks. Per **PRESET-RULE 2** and **PRESET-RULE 6** (`PRESET-RULES.md:6, 12`), a capability that monitors host resources and protects machine stability must reside on the **Host Plane** (`base.cordis.yml`), active before any session begins.
- **How it extends `packages/guard/*` without duplication**:
  `packages/guard/repeat-tool-reminder` is an advisory post-execute plugin (`tools/post-execute`) that observes repetition and enriches conversation history without vetoing (`packages/guard/repeat-tool-reminder/src/index.ts:213-224`). `packages/guard/timeout-policy` is an around-dispatch wrapper on `tools/execute` enforcing deadlines declared on tool definitions (`packages/guard/timeout-policy/src/index.ts:56-80`). Neither inspects host resources, neither manages cgroups, neither enforces pre-execute admission, and neither guards sovereign files. `@deepseek-ai/dsh-guard-resource` extends the `guard/` package family into host-level resource governance without duplicating loop-hygiene or timeout mechanics.

### 2.3 The Real Tool-Interception Point
In DeepSeek Harness, tool execution follows a strict pipeline inside `ToolRuntime.stagePreExecuteAndGuards` (`packages/core/tools/src/index.ts:1460-1497`):

```
                                  Tool Execution Request
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │    tools/pre-execute      │  (extensible waterfall:
                              │       waterfall           │   allow / deny / ask)
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │     serviceAsk()          │  (if kind === 'ask')
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │     guardReason(exec)     │  ◄── ctx.tools.guard()
                              │    Monotonic Owner Gate   │      runs HERE
                              └─────────────┬─────────────┘
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     │ denialReason !== undefined                  │ denialReason === undefined
                     ▼                                             ▼
       ┌───────────────────────────┐                 ┌───────────────────────────┐
       │   stagePreExecuteAndGuards│                 │       tools/execute       │
       │   returns post-result:    │                 │   around-dispatch wrapper │
       │   isError: true           │                 │   (timeout-policy, etc.)  │
       │   content: Error: reason  │                 └─────────────┬─────────────┘
       └───────────────────────────┘                               │
                                                                   ▼
                                                     ┌───────────────────────────┐
                                                     │     tool.execute()        │
                                                     └───────────────────────────┘
```

1. **Registration**: Calling `ctx.tools.guard(guard: ToolGuard)` (`packages/core/tools/src/index.ts:1100`) appends the guard to `this.layers.global.guards`. It returns an exact disposer function `() => void`.
2. **Evaluation**: In `stagePreExecuteAndGuards`, `this.guardReason(exec)` evaluates all guards (`packages/core/tools/src/index.ts:1477`).
3. **Short-Circuit**: If `guardReason` returns a string, `ToolRuntime` materializes a final result with `isError: true` and skips `tools/execute` and the tool body entirely (`packages/core/tools/src/index.ts:1479-1488`).
4. **Monotonicity**: `ToolGuard` returns `string | undefined` (`packages/core/tools/src/index.ts:704`). It has no `allow` variant; returning `undefined` abstains, leaving any denial intact.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Host memory headroom floor 3 GiB (`INV-12`, §1, §9) | Yes (`checkAdmission`, `ctx.tools.guard`) | None | Synchronous check on `/proc/meminfo` before heavy execution |
| Absolute available memory floor 1536 MiB (§1, §9) | Yes (`minAvailableMemBytes`) | None | Immediate refusal if `MemAvailable < 1536 MiB` |
| Systemd cgroup slice management `hermes-work.slice` (§1, §8.4) | Yes (`readSliceMetrics`, cgroup v2 hierarchy) | None | Tracks RAM and swap accounting in persistent user slice |
| Slice RAM ceiling 6 GiB and swap ceiling 512 MiB (§1, §8.4) | Yes (`sliceCeilingBytes`, `swapCeilingBytes`) | None | Validates slice boundaries and live reservation totals |
| Dynamic cgroup memory concurrency cap (§4.3) | Yes (`canAdmitWorker`, `assessAdmission`) | `@deepseek-ai/dsh-kanban-sqlite` (Plan 01) | Guard evaluates memory; Kanban manages task queueing |
| Zero autonomous SOUL edit authority (`INV-09`, §3.1) | Yes (`ctx.tools.guard` on `protectedPaths`) | `@deepseek-ai/dsh-persona` (Plan 05) | Persona renders prompt; guard blocks mutation tools |
| Heavy command classification (§8.4) | Yes (`classifyCommand`, `heavyToolPatterns`) | None | Tokenizes shell commands to detect heavy build/test tools |
| Standalone Python `guard.py` exit 125 parity (§1, §9) | Yes (`RESOURCE_ADMISSION_DENIED` code) | None | Replaced by native in-process TypeScript guard |
| Offline network sandboxing for tests (§10 P3) | Interface hook (`networkSandboxEnabled`) | `@deepseek-ai/dsh-verification` (Plan 09) | Subprocess runtime handles namespace unsharing |
| Loop duplicate call reminders (§5.9) | No | `@deepseek-ai/dsh-repeat-tool-reminder` (Core) | Loop hygiene advisory guard in `packages/guard/` |
| Per-tool-call timeouts (§5.9) | No | `@deepseek-ai/dsh-tool-call-timeout-policy` (Core) | Cooperative deadline guard in `packages/guard/` |
| Test modification pinning (`INV-13`, §6.5) | No | `@deepseek-ai/dsh-guard-test-pinning` (Plan 09) | Test file cryptographic protection during implementer turns |
| Anti-cheat shell status integrity (`INV-11`, §6.10) | No | `@deepseek-ai/dsh-verification` (Plan 09) | Verifies attributable exit codes in test runs |
| Worker watchdog & quota wall cooldown (§5.9) | No | `@deepseek-ai/dsh-supervisor` (Plan 12) | Heartbeat timers and 429 backoff daemon |

## 4. Proposed Package / File Layout

```
packages/guard/guard-resource/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts                 # Service Provider (ResourceGuardService, apply, default export)
│   ├── types.ts                 # MemorySnapshot, AdmissionResult, CgroupSliceMetrics, ResourceGuard
│   ├── config.ts                # Schemastery Config schema, field defaults, fail-loud validation
│   ├── memory-provider.ts       # Linux /proc/meminfo parser with node:os fallback & TTL cache
│   ├── cgroup-provider.ts       # cgroup v2 hierarchy inspector (hermes-work.slice)
│   ├── tool-classifier.ts       # Heavy tool/command tokenizer & SOUL.md mutation inspector
│   └── errors.ts                # ResourceGuardError, ResourceAdmissionError, SoulSovereigntyError
└── tests/
    ├── memory-provider.spec.ts  # Parsing /proc/meminfo, OS fallback, TTL caching
    ├── cgroup-provider.spec.ts  # Reading memory.current, memory.max, missing slice handling
    ├── tool-classifier.spec.ts  # Heavy commands, compounds, SOUL.md mutations across tools
    ├── resource-guard.spec.ts   # Tool guard veto, monotonic denial, service methods, HMR disposal
    └── platform-fallback.spec.ts # Degradation on non-Linux platforms (darwin, win32)
```

## 5. Public Contracts

### 5.1 Service Interface & Context Declaration Merging
Per Cordis declaration merging conventions (`packages/core/tools/src/index.ts:44-47`):

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

declare module '@deepseek-ai/cordis' {
  interface Context {
    resourceGuard: ResourceGuardService
  }
  interface Events {
    'resource/admission-denied': (event: ResourceAdmissionDeniedEvent) => void
    'resource/headroom-warning': (event: ResourceHeadroomWarningEvent) => void
    'resource/soul-violation': (event: SoulViolationEvent) => void
  }
}

export interface MemorySnapshot {
  readonly availableBytes: number
  readonly totalBytes: number
  readonly headroomBytes: number
  readonly reservedUnusedBytes: number
  readonly effectiveFreeBytes: number
  readonly platform: NodeJS.Platform
  readonly isDegraded: boolean
  readonly cgroupAvailable: boolean
  readonly cgroup?: CgroupSliceMetrics
  readonly timestamp: number
}

export interface AdmissionResult {
  readonly admitted: boolean
  readonly reason?: string
  readonly availableBytes: number
  readonly headroomBytes: number
  readonly reservedUnusedBytes: number
  readonly effectiveFreeBytes: number
  readonly code?: 'RESOURCE_ADMISSION_DENIED' | 'ABSOLUTE_FLOOR_BREACH' | 'SLICE_CEILING_BREACH'
}

export interface CgroupSliceMetrics {
  readonly sliceName: string
  readonly memoryCurrentBytes: number
  readonly memoryMaxBytes: number
  readonly swapCurrentBytes: number
  readonly swapMaxBytes: number
  readonly liveJobs: number
  readonly oomGroupEnabled: boolean
}

export interface ResourceAdmissionDeniedEvent {
  readonly toolName: string
  readonly command?: string
  readonly availableBytes: number
  readonly requiredHeadroomBytes: number
  readonly effectiveFreeBytes: number
  readonly agentId?: string
}

export interface ResourceHeadroomWarningEvent {
  readonly availableBytes: number
  readonly headroomBytes: number
  readonly activeWorkers: number
}

export interface SoulViolationEvent {
  readonly toolName: string
  readonly attemptedPath: string
  readonly agentId?: string
  readonly command?: string
}
```

### 5.2 Config Schema with Schemastery
Every threshold, ceiling, path, and tool pattern is an externally configurable, validated field in `cordis.yml`. Zero hardcoded magic constants:

```typescript
import z from '@deepseek-ai/schemastery'

export interface Config {
  /** Absolute minimum host MemAvailable floor below which ANY heavy workload is vetoed (default 1536 MiB). */
  minAvailableMemBytes?: number
  /** Host memory headroom floor that must remain free after active reservations (default 3072 MiB). */
  headroomBytes?: number
  /** Aggregate RAM ceiling for the systemd slice hermes-work.slice (default 6144 MiB). */
  sliceCeilingBytes?: number
  /** Aggregate swap ceiling for the systemd slice hermes-work.slice (default 512 MiB). */
  swapCeilingBytes?: number
  /** Assumed memory footprint per concurrent worker for dynamic admission calculation (default 768 MiB). */
  perWorkerReservationBytes?: number
  /** Percentage of cgroup memory.max at which worker concurrency is throttled (default 80%). */
  cgroupPressureThrottlePercent?: number
  /** Path to Linux meminfo pseudo-file (default '/proc/meminfo'). */
  meminfoPath?: string
  /** Path to cgroup v2 slice directory (default '/sys/fs/cgroup/hermes-work.slice'). */
  cgroupSlicePath?: string
  /** Cache TTL in milliseconds for procfs/cgroup reads to prevent filesystem thrashing (default 500 ms). */
  cacheTtlMs?: number
  /** Tool name wildcard patterns subject to resource headroom checks. */
  heavyToolPatterns?: string[]
  /** Command binary names classified as resource-heavy when invoked via shell/bash. */
  heavyCommandNames?: string[]
  /** Path wildcard patterns strictly forbidden from autonomous modification (INV-09). */
  protectedPaths?: string[]
  /** Tool name wildcard patterns inspected for file mutation arguments. */
  mutationToolPatterns?: string[]
}

export const Config: z<Config> = z.object({
  minAvailableMemBytes: z.number().default(1536 * 1024 * 1024),
  headroomBytes: z.number().default(3072 * 1024 * 1024),
  sliceCeilingBytes: z.number().default(6144 * 1024 * 1024),
  swapCeilingBytes: z.number().default(512 * 1024 * 1024),
  perWorkerReservationBytes: z.number().default(768 * 1024 * 1024),
  cgroupPressureThrottlePercent: z.number().default(80),
  meminfoPath: z.string().default('/proc/meminfo'),
  cgroupSlicePath: z.string().default('/sys/fs/cgroup/hermes-work.slice'),
  cacheTtlMs: z.number().default(500),
  heavyToolPatterns: z.array(z.string()).default([
    'bash', 'terminal', 'execute_code', 'browser_exec', 'subagent_*',
  ]),
  heavyCommandNames: z.array(z.string()).default([
    'vitest', 'jest', 'webpack', 'tsc', 'make', 'ninja', 'cargo',
    'go', 'vite', 'next', 'npm', 'pnpm', 'yarn', 'bun', 'pytest',
  ]),
  protectedPaths: z.array(z.string()).default([
    '**/SOUL.md', '**/.hermes/SOUL.md', 'SOUL.md',
  ]),
  mutationToolPatterns: z.array(z.string()).default([
    'writeText', 'editText', 'write_file', 'edit_file',
    'str_replace_editor', 'bash', 'terminal',
  ]),
})
```

### 5.3 Service Class Definition
```typescript
export class ResourceGuardService extends Service {
  static readonly name = 'resourceGuard'
  static readonly inject = ['tools']
  static readonly Config = Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'resourceGuard')
    // Fail-loud configuration validation
    validateConfig(config)
    // Register the monotonic tool guard
    this.installToolGuard(config)
  }

  /** Retrieve live memory snapshot (memoized within cacheTtlMs). */
  getMemorySnapshot(): MemorySnapshot

  /** Check if a requested workload or tool call can be admitted. */
  checkAdmission(requestedBytes?: number): AdmissionResult

  /** Evaluate whether another worker can be dispatched given active worker count and memory pressure. */
  canAdmitWorker(activeWorkerCount: number): boolean

  /** Check whether a given path targets a protected file (INV-09). */
  isPathProtected(filePath: string): boolean

  /** Inspect shell command tokens for heavy binaries or SOUL.md mutations. */
  classifyCommand(command: string): {
    isHeavy: boolean
    isSoulMutation: boolean
    reason?: string
  }

  /** Read current cgroup v2 slice metrics, or undefined if unavailable. */
  getSliceMetrics(): CgroupSliceMetrics | undefined
}

export default ResourceGuardService
```

## 6. Lifecycle and Scoping

### 6.1 Registration and Disposal
- `@deepseek-ai/dsh-guard-resource` is mounted on the **Host Plane** (`base.cordis.yml`).
- In its constructor, `ResourceGuardService` invokes:
  ```typescript
  const liftGuard = this.ctx.tools.guard((exec: Readonly<ToolExecution>) => {
    return this.evaluateGuard(exec)
  })
  this.ctx.effect(() => liftGuard)
  ```
- Because it is registered on host `ctx.tools`, the guard is added to `layers.global.guards` (`packages/core/tools/src/index.ts:1110`). It intercepts all tools across every session in the process.
- `this.ctx.effect(() => liftGuard)` ensures that when the plugin context is disposed (during shutdown or HMR reload), the guard is cleanly removed from the tool registry without orphan callbacks.

### 6.2 Fail-Loud Configuration Validation
Misconfiguration fails loudly at plugin initialization (`validateConfig(config)`):
- If `minAvailableMemBytes < 0` or `headroomBytes < minAvailableMemBytes`: throws `ConfigurationError('headroomBytes must be greater than or equal to minAvailableMemBytes')`.
- If `sliceCeilingBytes < 32 * 1024 * 1024`: throws `ConfigurationError('sliceCeilingBytes must be at least 32 MiB')`.
- If `cacheTtlMs < 0`: throws `ConfigurationError('cacheTtlMs must be non-negative')`.
- If `cgroupPressureThrottlePercent < 1 || cgroupPressureThrottlePercent > 100`: throws `ConfigurationError('cgroupPressureThrottlePercent must be between 1 and 100')`.

### 6.3 Platform Specifics & Graceful Degradation
The service automatically detects its host environment and degrades gracefully without throwing or breaking agent execution:

| Platform / Environment | Memory Source | Cgroup Accounting | Tool Headroom Guard (`INV-12`) | SOUL Sovereignty (`INV-09`) |
|---|---|---|---|---|
| **Linux with systemd cgroups v2** | `/proc/meminfo` (`MemAvailable`) | Full (`hermes-work.slice` read via sysfs) | Authoritative (`available - unused >= headroom`) | Full (Path & shell token analysis) |
| **Linux without cgroups / Container** | `/proc/meminfo` (`MemAvailable`) | Degraded (`cgroupAvailable = false`, active reservations = 0) | Active (`available >= headroom`) | Full (Path & shell token analysis) |
| **macOS (Darwin)** | `node:os.freemem()` | Degraded (`cgroupAvailable = false`) | Active (`freemem >= headroom`) | Full (POSIX path normalization) |
| **Windows (win32)** | `node:os.freemem()` | Degraded (`cgroupAvailable = false`) | Active (`freemem >= headroom`) | Full (Windows `\` and `/` path normalization) |

On non-Linux platforms, the service logs an informational notice at load time:
`[resourceGuard] Operating in platform fallback mode on ${process.platform}: cgroups unavailable, using os.freemem().`

## 7. Agent Preset Integration

### 7.1 Presets Add Zero Rows
Per **PRESET-RULES 2, 4, and 6** (`PRESET-RULES.md:6, 10, 12`):
- The resource guard is a host-plane service and host-plane monotonic tool guard.
- It injects host service `tools` and resolves before any session exists.
- Therefore, preset compositions (`presets/hermes-brain/agent.cordis.yml` and `presets/hermes-worker/agent.cordis.yml`) **add ZERO rows** for `@deepseek-ai/dsh-guard-resource`.
- Because the guard is registered on `ctx.tools` on the host plane, every tool call executed by any agent—orchestrator or worker—is protected automatically by the global tool layer (`packages/core/tools/src/index.ts:1110`).

### 7.2 Host Plane Composition (`base.cordis.yml` Patch Layer)
`@deepseek-ai/dsh-guard-resource` is mounted in the host composition patch layer (`packages/bundle/base/cordis.patch.yml`):

```yaml
# packages/bundle/base/cordis.patch.yml
'@deepseek-ai/dsh-guard-resource':
  minAvailableMemBytes: 1610612736    # 1536 MiB absolute floor
  headroomBytes: 3221225472           # 3072 MiB required headroom
  sliceCeilingBytes: 6442450944       # 6144 MiB slice ceiling
  swapCeilingBytes: 536870912         # 512 MiB swap ceiling
  perWorkerReservationBytes: 805306368 # 768 MiB assumed footprint
  cgroupPressureThrottlePercent: 80
  cacheTtlMs: 500
  heavyToolPatterns:
    - 'bash'
    - 'terminal'
    - 'execute_code'
    - 'browser_exec'
    - 'subagent_*'
  protectedPaths:
    - '**/SOUL.md'
    - '**/.hermes/SOUL.md'
    - 'SOUL.md'
```

## 8. Execution Flow

### 8.1 Tool Call Interception Walkthrough
When an agent (e.g. `hermes-worker`) executes a tool call:

```
1. LLM emits tool call (e.g. bash { command: "npm test" } or writeText { path: "/repo/SOUL.md" })
2. AgentLoop dispatches call to ToolRuntime.execute(input) (packages/core/tools/src/index.ts:1400)
3. ToolRuntime creates ToolExecution and enters stagePreExecuteAndGuards (line 1463)
4. tools/pre-execute waterfall evaluates extensible policies (permissions, logging)
5. serviceAsk() executes if pre-execute returned { kind: 'ask' }
6. guardReason(exec) executes monotonic owner guards:
   a. Evaluates global guard: ResourceGuardService.evaluateGuard(exec)
   b. SOUL Protection Check (INV-09):
      - Checks if exec.name matches mutationToolPatterns
      - If tool is filesystem write/edit: extracts target path from arguments
      - If tool is bash/terminal: inspects command for rm, sed, cp, cat >, echo > targeting SOUL.md
      - If match found: returns "INV-09 Violation: Autonomous mutation of SOUL.md is strictly prohibited"
   c. Heavy Workload Classification:
      - Checks if exec.name matches heavyToolPatterns
      - If tool is bash/terminal: tokenizes command and checks against heavyCommandNames
      - If not heavy: returns undefined (allow diagnostic commands like ls, git status, cat)
   d. Headroom Admission Check (INV-12):
      - Fetches MemorySnapshot (memoized within cacheTtlMs)
      - If snapshot.availableBytes < minAvailableMemBytes (1536 MiB):
        returns "Resource Guard (INV-12): Host available memory (${availMiB} MiB) is below absolute floor (${minMiB} MiB). Workload refused."
      - If snapshot.effectiveFreeBytes < headroomBytes (3072 MiB):
        returns "Resource Guard (INV-12): Host memory headroom after reservations (${freeMiB} MiB) is below required 3072 MiB floor. Finish running jobs before starting heavy workloads."
7. Guard Outcome:
   - If denial string returned:
     ToolRuntime short-circuits immediately to post-result with isError: true and skips tool.execute()!
     Emits 'resource/admission-denied' or 'resource/soul-violation' on host bus.
   - If undefined returned:
     ToolRuntime proceeds to tools/execute wrappers and runs the tool body.
```

### 8.2 Dynamic Worker Admission Walkthrough (Kanban Integration)
When `@deepseek-ai/dsh-kanban-sqlite` or `@deepseek-ai/dsh-supervisor` prepares to dispatch a ready task:
1. Dispatcher queries `ctx.resourceGuard.canAdmitWorker(activeWorkers)`.
2. `ResourceGuardService` calculates:
   - `snapshot = this.getMemorySnapshot()`
   - If `snapshot.cgroupAvailable && snapshot.cgroup`:
     - `cgroupPressure = (snapshot.cgroup.memoryCurrentBytes / snapshot.cgroup.memoryMaxBytes) * 100`
     - If `cgroupPressure >= config.cgroupPressureThrottlePercent`: return `false` (cgroup throttle).
   - `activeReservations = activeWorkers * config.perWorkerReservationBytes`
   - `effectiveHeadroom = snapshot.availableBytes - activeReservations`
   - If `effectiveHeadroom < config.headroomBytes`: return `false` (headroom throttle).
3. If `canAdmitWorker` returns `false`, dispatcher suspends dispatching, logs a diagnostic notice, and emits `'resource/headroom-warning'`. The card remains `ready` until host memory recovers.

## 9. Error, Cancellation, and Lifecycle Behavior

### 9.1 Cancellation and Abort Handling
- `ToolGuard` evaluation is strictly synchronous and finishes in < 0.1 ms.
- If `exec.signal.aborted` is true prior to guard execution, `ToolRuntime.stagePreExecuteAndGuards` detects it and short-circuits with `toolAbortedBeforeDispatchResult()` (`packages/core/tools/src/index.ts:1460, 1473`).
- The resource guard does not spawn asynchronous promises or long-running handles during tool interception.

### 9.2 Procfs and Sysfs Failure Handling
- **Missing `/proc/meminfo`**: Falls back immediately to `node:os.freemem()` and `node:os.totalmem()`.
- **Malformed `/proc/meminfo`**: If line format is missing `kB` or unparseable, catches `Error`, logs a warning once, and falls back to `node:os.freemem()`.
- **Missing `/sys/fs/cgroup/hermes-work.slice`**: If directory does not exist or user lacks read permission, marks `cgroupAvailable = false` and omits cgroup metrics from `MemorySnapshot`.
- **Temporary I/O Error**: If both `/proc/meminfo` and `os.freemem()` throw (extreme OS degradation), fails closed by assuming 0 bytes available, safely preventing host freeze.

### 9.3 Command Parsing Edge Cases
In `tool-classifier.ts`:
- **Compound Shell Commands**: Shell commands containing operators (`;`, `&&`, `||`, `|`, `&`) are tokenized via POSIX-compliant whitespace and operator splitting (`shlex`).
- If any segment in a compound command contains a binary from `heavyCommandNames`, the entire execution is classified as heavy.
- If any segment attempts to redirect or write into `SOUL.md` (e.g. `> SOUL.md`, `>> SOUL.md`, `tee SOUL.md`), the entire execution is vetoed under `INV-09`.
- Quoted strings containing `SOUL.md` in non-mutation contexts (e.g. `git log --grep="SOUL.md"`, `grep -rn "SOUL" .`) are parsed safely without false-positive vetoes.

## 10. Testing Strategy

### 10.1 Unit Tests
- `tests/memory-provider.spec.ts`:
  - Verify parsing of standard Linux `/proc/meminfo` strings with various whitespace and field orders.
  - Verify calculation of `availableBytes`, `headroomBytes`, and `effectiveFreeBytes`.
  - Verify TTL cache behavior: repeated calls within `cacheTtlMs` do not re-read disk.
  - Verify graceful fallback to `os.freemem()` when `/proc/meminfo` path is invalid.
- `tests/cgroup-provider.spec.ts`:
  - Mock cgroup v2 directory with `memory.current`, `memory.max`, `memory.swap.current`, `memory.swap.max`, `memory.oom.group`.
  - Verify correct parsing and conversion of bytes.
  - Verify behavior when cgroup slice directory is missing or unreadable.
- `tests/tool-classifier.spec.ts`:
  - Verify command tokenization for simple commands, pipeline commands, and chained commands (`&&`, `;`).
  - Verify classification of `heavyCommandNames` (`npm test`, `pytest -n 4`, `cargo test`, `vite build`).
  - Verify classification of harmless commands (`git status`, `ls -la`, `cat README.md`, `pwd`).
  - Verify detection of `SOUL.md` mutation in filesystem tools (`writeText`, `editText`, `fs_write`).
  - Verify detection of `SOUL.md` mutation in shell tools (`rm SOUL.md`, `echo "x" > SOUL.md`, `sed -i 's/a/b/' SOUL.md`).
  - Verify that read-only inspection of `SOUL.md` (e.g. `cat SOUL.md`, `view_file SOUL.md`) is NOT blocked.

### 10.2 Integration Tests
- `tests/resource-guard.spec.ts`:
  - Mount `ResourceGuardService` on a Cordis test container alongside `ToolRuntime`.
  - Register dummy test tools (`heavy_runner`, `diagnostic_tool`).
  - Simulate low memory (< 1536 MiB): prove `heavy_runner` is vetoed with `isError: true` and `RESOURCE_ADMISSION_DENIED`.
  - Prove `diagnostic_tool` is permitted under low memory.
  - Simulate intermediate memory (< 3072 MiB headroom): prove heavy workloads are vetoed while reads are allowed.
  - Simulate tool call targeting `SOUL.md`: prove immediate veto with `INV-09` violation message.
  - Verify monotonicity: register a `tools/pre-execute` listener that returns `{ kind: 'allow' }`; verify the monotonic guard STILL denies the heavy execution when memory is insufficient.
  - Test HMR lifecycle: dispose the plugin context and verify the guard is removed and no longer denies tool calls.

### 10.3 Platform Fallback Tests
- `tests/platform-fallback.spec.ts`:
  - Mock `process.platform` as `'darwin'` and `'win32'`.
  - Verify that `getMemorySnapshot()` returns `isDegraded: true` and reads `os.freemem()`.
  - Verify that `SOUL.md` protection normalizes Windows path separators (`\` vs `/`).

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Linux `/proc/meminfo` parsing & headroom extraction (`INV-12`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:527-545` | `memory_headroom` algorithm extracting `MemAvailable`, `SwapTotal`, and `SwapFree` from `/proc/meminfo`, calculating swap used, and converting kB to MiB. | Translate Python to TypeScript in `memory-provider.ts`, add sub-millisecond TTL memoization cache (`cacheTtlMs: 250`), add `node:os.freemem()` fallback for Darwin/Windows, and validate thresholds via Schemastery. | direct port |
| Systemd cgroup v2 slice metrics & limit extraction | `/home/sic/Downloads/hermes-agent-main/gateway/agent_cache_pressure.py:57-95`<br>`/home/sic/Downloads/hermes-agent-main/gateway/cgroup_cleanup.py:21-35` | Cgroup hierarchy discovery from `/proc/self/cgroup` and `/sys/fs/cgroup/`, reading `memory.current`, `memory.max`, `memory.high`, `memory.swap.current`, and PID enumeration from `cgroup.procs`. | Implement `cgroup-provider.ts` inspecting `/sys/fs/cgroup/hermes-work.slice`, convert Python path reads to Node `node:fs/promises`, and gracefully degrade on non-cgroup systems. | port with adaptation |
| Sovereign file write protection (`SOUL.md` / `INV-09`) | `/home/sic/Downloads/hermes-agent-main/tools/file_tools_write_guards.py:109-205` | Sensitive path checking (`_check_sensitive_path`), protected instruction file basenames (`_PROTECTED_INSTRUCTION_BASENAMES = {"agents.md", "claude.md", "soul.md", ".cursorrules"}`), path normalization (`_resolved_or_raw`), case-insensitive comparison, and traversal rejection. | Adapt into synchronous monotonic guard function for `ctx.tools.guard()`, inspecting tool parameters (`filepath`, `path`, `target`, `content`) and returning immediate denial string without human approval escalation. | direct port |
| Tool and shell command classification (Heavy vs Diagnostic) | `/home/sic/Downloads/hermes-agent-main/agent/tool_guardrails.py:19-58` | Tool classification sets (`IDEMPOTENT_TOOL_NAMES`, `MUTATING_TOOL_NAMES`, `FAILURE_TOLERANT_TOOL_NAMES`), identifying diagnostic commands exempt from memory vetoes. | Port to `tool-classifier.ts`, add POSIX shell tokenizer recognizing heavy build/test commands (`vitest`, `tsc`, `cargo`, `pnpm install`) from Config, and classify tool execution descriptors. | port with adaptation |
| Dynamic worker admission governor (`canAdmitWorker`) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:1580-1600, 1858-1865` | Admission decision predicate: comparing `MemAvailable` against `minAvailableMemBytes` (1536 MiB) and remaining headroom after active worker reservations against `headroomBytes` (3072 MiB). | Encapsulate into `ResourceGuardService.canAdmitWorker(activeWorkers: number)` exported on `ctx.resourceGuard` for Cordis Kanban dispatcher. | direct port |
| Monotonic tool guard execution gate (`ctx.tools.guard`) | no Hermes equivalent — new code | N/A (Hermes Python uses tool wrapper interceptors; Harness uses native owner-level monotonic `ctx.tools.guard()` in `ToolRuntime.stagePreExecuteAndGuards`). | Implement `installToolGuard()` registering on `ctx.tools.guard()` and returning structured `isError: true` denial string. | no Hermes equivalent (new code) |

The single most valuable capability to port is the `/proc/meminfo` kernel headroom evaluator and protected instruction file sovereignty logic (`supervise.py:527-545` and `tools/file_tools_write_guards.py:109-205`). Reading raw `MemAvailable` from `/proc/meminfo` gives the kernel's true non-swapping allocation limit (avoiding misleading `MemFree` false positives), while the battle-tested path normalization and protected instruction matcher guarantees that autonomous agents can neither crash the host through OOM nor overwrite `SOUL.md`.

## 11. Implementation Steps

```
[ ] 1. Package Scaffolding
    [ ] Create packages/guard/guard-resource/
    [ ] package.json with dependencies: @deepseek-ai/cordis, @deepseek-ai/schemastery, @deepseek-ai/dsh-tools
    [ ] tsconfig.json extending root configuration
    [ ] README.md documenting package purpose and invariants (INV-09, INV-12)

[ ] 2. Types & Schemas
    [ ] Implement src/types.ts with MemorySnapshot, AdmissionResult, CgroupSliceMetrics
    [ ] Implement src/config.ts with Schemastery Config schema and fail-loud validateConfig()
    [ ] Implement src/errors.ts with ResourceGuardError, ResourceAdmissionError, SoulSovereigntyError

[ ] 3. Memory & Cgroup Providers
    [ ] Implement src/memory-provider.ts:
        - Linux /proc/meminfo parsing
        - Node.js os.freemem fallback
        - Memoized TTL sampling cache
    [ ] Implement src/cgroup-provider.ts:
        - cgroup v2 hierarchy sysfs parsing
        - Graceful handling of missing slice or non-systemd setups

[ ] 4. Tool & Command Classifier
    [ ] Implement src/tool-classifier.ts:
        - POSIX shell command tokenizer
        - Heavy binary matcher against Config.heavyCommandNames
        - SOUL.md mutation pattern matcher against Config.protectedPaths

[ ] 5. Service & Guard Implementation
    [ ] Implement src/index.ts:
        - ResourceGuardService extending Cordis Service
        - installToolGuard() registering ctx.tools.guard()
        - evaluateGuard() enforcing INV-09 and INV-12
        - canAdmitWorker() for Kanban dispatcher integration
        - Declaration merging for Context and Events
        - Default export ResourceGuardService

[ ] 6. Host Composition Integration
    [ ] Add @deepseek-ai/dsh-guard-resource row to packages/bundle/base/cordis.patch.yml
    [ ] Verify no rows added to presets (PRESET-RULES 2, 4, 6)

[ ] 7. Comprehensive Testing
    [ ] Implement tests/memory-provider.spec.ts
    [ ] Implement tests/cgroup-provider.spec.ts
    [ ] Implement tests/tool-classifier.spec.ts
    [ ] Implement tests/resource-guard.spec.ts
    [ ] Implement tests/platform-fallback.spec.ts
    [ ] Run pnpm test across the package
```

## 12. Acceptance Criteria

1. **Host Headroom Admission Floor (`INV-12`)**: Any heavy tool call (`bash`, `terminal`, `browser_exec`, `subagent_*`) executed when host available memory is below `minAvailableMemBytes` (1536 MiB) or effective headroom is below `headroomBytes` (3072 MiB) is synchronously vetoed before dispatch with a structured `ToolExecutionFailure` containing `isError: true` and an explicit `INV-12` error message.
2. **Human SOUL Sovereignty (`INV-09`)**: Any tool call attempting to mutate, truncate, overwrite, or delete `SOUL.md` (via filesystem tools or shell mutation commands) is synchronously vetoed before dispatch with a structured `ToolExecutionFailure` containing `isError: true` and an explicit `INV-09` violation message.
3. **Diagnostic Exemption**: Lightweight diagnostic and inspection tools (`read_file`, `kanban_show`, `kanban_list`, `ask_user_question`, `git status`) execute successfully without interruption even when memory headroom is constrained.
4. **Monotonicity**: No `tools/pre-execute` listener, approval provider, or downstream wrapper can override, bypass, or convert a resource guard denial into an allow.
5. **Zero Hardcoded Constants**: Every threshold (`minAvailableMemBytes`, `headroomBytes`, `sliceCeilingBytes`, `swapCeilingBytes`, `perWorkerReservationBytes`, `cacheTtlMs`, `heavyToolPatterns`, `protectedPaths`) is validated via Schemastery and configurable via `cordis.yml`.
6. **Graceful Cross-Platform Degradation**: The package loads and operates correctly on Linux, macOS, and Windows. On non-Linux or systems without cgroups v2, it degrades transparently to `os.freemem()` without throwing unhandled exceptions.
7. **Clean Teardown and HMR**: Disposing the plugin context unregisters the tool guard cleanly via `ctx.effect()`, leaving no dangling listeners or memory leaks in the tool pipeline.
8. **Zero Core Modifications**: The entire resource guard capability is implemented using public Cordis and `@deepseek-ai/dsh-tools` extension points (`ctx.tools.guard`).

## Review fixes applied

- Added `## Port sources` section detailing source mappings from Hermes repositories (`tools/file_tools_write_guards.py`, `agent/tool_guardrails.py`, `gateway/agent_cache_pressure.py`, `gateway/cgroup_cleanup.py`, and orchestrator `supervise.py`) to accelerate resource guard and admission implementation.
