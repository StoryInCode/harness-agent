# 11 — agy External Subagent Provider & Token-Preserving Delegation

## Features

- Host-plane SubagentProvider registering external agy CLI delegation on ctx.subagents
- Token-preserving execution offloading large file reads and bulk edits from the Brain orchestrator to external CLI (INV-03)
- Discrete subprocess execution via ctx.subprocess with sanitized environment (stripping sensitive API keys/tokens while safely preserving HOME, PATH, USER, and XDG directories)
- Self-authenticating headless CLI execution targeting /home/sic/.local/bin/agy with file-based OAuth credentials (~/.hermes/auth.json) and automatic permission bypass flags
- Native model resolution delegating to agy's active provider pool and router, with optional validated Config override
- Zero credential management: performs no credential acquisition, API-key injection, OAuth flow, or token refresh
- Real-time NDJSON wire parsing decoding stdout in stream-json format
- Incremental progress tracking and text delta accumulation across CLI step_update events
- Safe result normalization extracting terminal response text and token metrics into SubagentResult
- Never-reject contract flattening process crashes, syntax faults, and non-zero exits into diagnostic results
- Process group termination escalating from SIGINT to SIGTERM and SIGKILL across a configurable grace period
- Strict workspace directory resolution anchoring child processes to parent session working trees
- Preflight validation verifying CLI executable presence, execute permissions, and workspace accessibility
- Seamless integration with standard dsh-tool-subagent preset configurations in one-shot mode

## 1. Purpose

@deepseek-ai/dsh-subagent-agy provides the authoritative host-plane subagent Service Provider wrapping the external /home/sic/.local/bin/agy CLI for autonomous, token-preserving code extraction and AST refactoring in StoryInCode (Spec §5.9, INV-03).

- **What it owns**:
  - The SubagentProvider implementation (AgySubagentProvider) implementing the native provider contract (packages/subagent/subagent/src/types.ts:344-390).
  - Dynamic registration and lifecycle publication of provider name agy on the host context registry (ctx.subagents.registerProvider(), packages/subagent/subagent/src/index.ts:509-525).
  - Token-preservation delegation (INV-03): offloading AST-heavy code queries, directory analysis, and bulk edits to the external agy CLI agent, preventing token exhaustion on the central claude-opus-4-8 orchestrator (Spec §5.9, HERMES-AGENT-SPEC.md:1234-1237).
  - Discrete subprocess invocation via ctx.subprocess.spawn() (packages/subprocess/subprocess/src/types.ts:75-105), bypassing shell interpreters (/bin/bash) to eliminate command injection hazards and parameter escaping defects.
  - Headless CLI flag assembly: ensuring --print, --output-format stream-json, and --dangerously-skip-permissions are strictly configured so the child process never blocks on interactive human confirmation, passing --model only when explicitly overridden in configuration and otherwise letting agy resolve its own active provider and router.
  - Streaming NDJSON wire protocol decoding: consuming stdout line-by-line, parsing init, step_update, and terminal result events, extracting assistant text deltas, and collecting execution metrics (input, output, and thinking tokens).
  - Out-of-process failure flattening and result settlement: consuming settleRunResult() and subprocessRunHandle() (packages/subagent/subagent/src/out-of-process.ts:192-260) to enforce the harness seam invariant that SubagentRun.result never rejects post-publication.
  - Diagnostic protection: capping failure diagnostics to 4,096 UTF-8 bytes (MAX_SUBAGENT_DIAGNOSTIC_BYTES) without mutilating multi-byte characters (packages/subagent/subagent/src/out-of-process.ts:20-42).
  - Lifecycle cancellation and process cleanup: managing termination cascades (SIGINT, SIGTERM, SIGKILL) bounded by configurable grace periods (disposeGraceMs).

- **What it deliberately does NOT own**:
  - Credential acquisition, API-key injection, OAuth flow, and token refresh: agy is already linked and authenticated via its multi-provider OAuth credential pool at /home/sic/.hermes/auth.json. The provider performs NO credential management; the CLI authenticates itself directly from file-based stores under $HOME.
  - Model pinning: the provider does not pin or hardcode a model route (such as gemini-3.8-flash-high); model selection is owned by agy's active provider pool and router in /home/sic/.hermes/auth.json, optionally overridable through a validated Config field.
  - Model-facing tool registration: LLM agents do NOT invoke this provider directly; tool presentation is owned by @deepseek-ai/dsh-tool-subagent (packages/subagent/tool-subagent/src/index.ts:400-410), which registers subagent_agy inside agent presets.
  - Continuable multi-turn conversations: prepareContinuable is deliberately omitted; agy in Harness operates strictly in one-shot mode. Multi-turn session persistence belongs to native in-process providers (packages/subagent/subagent-spawn-in-process).
  - Parent conversation context or prompt injection: child runs declare inheritsParentContext: false (packages/subagent/subagent/src/types.ts:351) and execute in isolated external process sessions.
  - Worktree allocation or branch checkout: working trees are provisioned by @deepseek-ai/dsh-worktree-local (Plan 07); subagent-agy merely enters the allocated workspace via resolveChildCwd().
  - Background job scheduling: background execution is delegated to the host job substrate (ctx.jobs, packages/jobs/jobs) via tool-subagent (backgroundMode: one-shot).
  - Kanban state machine, worker claims, or supervisory watchdog timers: owned by @deepseek-ai/dsh-kanban-sqlite (Plan 01) and @deepseek-ai/dsh-supervisor (Plan 12).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- @deepseek-ai/dsh-subagent-agy: **Service Provider**.
  - Implements the SubagentProvider interface from @deepseek-ai/dsh-subagent (packages/subagent/subagent/src/types.ts:344-390).
  - Registered dynamically on ctx.subagents via ctx.subagents.registerProvider(this) inside plugin apply() (packages/subagent/subagent/src/index.ts:509-525).
  - Injects host infrastructure: [subagents, subprocess].
- Presentation Layer: **Subagent Consumer / Model-facing Tool**.
  - Consumed in agent presets (hermes-brain) via @deepseek-ai/dsh-tool-subagent (packages/subagent/tool-subagent/src/index.ts:48-103), configured with provider: agy, toolName: subagent_agy, backgroundMode: one-shot, and maxDepth: provider-managed.

### 2.2 Why this Primitive and not the Neighbours
- **Why NOT custom model-facing tools (agy_extract and agy_edit)**:
  The legacy Hermes setup utilized ad-hoc tools that invoked shell commands directly. In DeepSeek Harness, delegating execution to an external autonomous CLI agent is the exact domain of the SubagentProvider contract, identical to packages/subagent/subagent-codex and packages/subagent/subagent-claude-code (plans/00-architecture-mapping.md:390-412). Implementing SubagentProvider integrates agy seamlessly into:
  1. Typed Cordis domain events (subagent/start, subagent/end, subagent/provider-added, subagent/provider-removed).
  2. Durable session catalog projections (subagentCatalogProjectionDefinition, subagentTimingProjectionDefinition).
  3. Universal background execution via ctx.jobs and tool-jobs (job_output, job_kill).
  4. Standardized model-facing tool presentation through @deepseek-ai/dsh-tool-subagent.

- **Ground Truth: External CLI Authentication & Credential Architecture**:
  The three external agent CLIs on this host are ALREADY LINKED AND AUTHENTICATED VIA OAUTH from file-based credential stores under $HOME:
  - `agy` -> `/home/sic/.hermes/auth.json` (17 KB multi-provider OAuth credential pool with an active provider and a router)
  - `Claude Code` -> `/home/sic/.claude/.credentials.json`
  - `Codex` -> `/home/sic/.codex/auth.json`

  Consequences for `@deepseek-ai/dsh-subagent-agy`:
  1. **Zero Credential Plumbing**: The provider performs NO credential acquisition, NO API-key injection, NO OAuth flow, and NO token refresh. It simply spawns the CLI; the CLI authenticates itself directly from its `$HOME` credential store.
  2. **Safe Environment Scrubbing**: Processes spawn under `scrubbedParentEnv()`. Stripping sensitive harness keys (`*API_KEY*`, `*TOKEN*`, `*SECRET*`) from the child environment does not break authentication because credentials reside in files under `$HOME`—provided `$HOME`, `$PATH`, `$USER`, locale, proxies, and XDG base-directory variables are preserved, which `scrubbedParentEnv()` explicitly guarantees (`packages/subprocess/subprocess/src/index.ts:49-78`).
  3. **Model Selection Ownership**: Model selection for `agy` is resolved by its OWN active provider pool and router in `/home/sic/.hermes/auth.json` and its deployment configuration, not by anything the Harness passes. The provider does not pin a specific model (e.g. `gemini-3.8-flash-high` is never hardcoded); it delegates model choice to `agy`'s active provider by default, optionally allowing an override via a validated `Config.model` field (`agy --help` shows `--model`).
  4. **Composition vs. Authentication Fact**: Shipped providers `packages/subagent/subagent-claude-code` and `packages/subagent/subagent-codex` are likewise fully linked and authenticated on this host. The shipped `ptc` preset carries those rows `disabled: true` because their optional provider Bundle is not installed in the default Profile. That is a COMPOSITION fact, not an authentication fact.

- **Why on the Host Plane**:
  Per PRESET-RULES.md Rule 8 (PRESET-RULES.md:14): "A registry read across sessions (e.g. subagents, whose cross-session queries the api-proxy serves to the browser; a provider name may be registered only once) stays host-plane. The preset contributes the delegation tools that resolve it." Furthermore, per Rule 6 (PRESET-RULES.md:12), rows injecting host singletons (subprocess, subagents) resolve before any session exists and must reside in the host composition (cordis.patch.yml). Mounting the provider inside a session preset would trigger fatal collisions (SubagentError(DUPLICATE_PROVIDER), packages/subagent/subagent/src/index.ts:521).
- **Why NOT a Workflow Capability (WorkflowEngine)**:
  WorkflowEngine (packages/workflow/workflow/src/index.ts:157-184) executes JavaScript orchestrations inside Worker threads using a sandboxed vm.Context (packages/workflow/workflow-worker-thread/src/runtime.ts:99). agy is an external autonomous CLI binary with its own tools, reasoning loops, and process tree; wrapping it in a workflow adds unnecessary VM marshalling overhead.
- **Why NOT direct execution via tool-bash**:
  Calling /home/sic/.local/bin/agy from bash tools forces the model to escape prompts, parse unbuffered terminal streams, handle background PID tracking, and recover from abnormal signal terminations. AgySubagentProvider wraps CLI execution behind typed lifecycle handles, structured NDJSON parsing, and automated process quiescence.

### 2.3 One-Shot vs Continuable (Persistent) Delegation

In DeepSeek Harness, the distinction between one-shot and continuable delegation is architectural, governing session durability and steering mechanics (ref-subagent-workflow.md:308-325, packages/subagent/subagent/src/descriptor.ts:17-48):

| Seam Dimension | Harness One-Shot Subagent | Harness Continuable Subagent | External agy CLI Provider Reality |
| :--- | :--- | :--- | :--- |
| **API Entrypoint** | ctx.subagents.start(name, request) | ctx.subagents.startContinuable(spec) | Supported via start() (one-shot) |
| **Provider Capability** | start(): Promise<SubagentRun> | prepareContinuable?(request): Promise<...> | prepareContinuable is **omitted** (undefined) |
| **Turn Lifecycle** | Exactly one turn, one terminal result | Multi-turn resident Activation epochs | Single non-interactive turn (--print) |
| **Handle Ownership** | Caller owns disposable SubagentRun | SubagentContinuationManager owns AgentHandle | Out-of-process SubprocessRunHandle |
| **Mid-Flight Steering** | Not supported (run is disposable) | Supported via ctx.subagents.sendMessage() | Not supported over standard stdio CLI |
| **Turn Interruption** | Request abort signal aborts process | ctx.subagents.interrupt() aborts turn; agent stays alive | Abort terminates process tree |
| **Cold Resumption** | Not resumable; terminal when finished | Cold resume from session log via ctx.agents.resume() | Session logs managed outside Harness |
| **Preset Config** | backgroundMode: one-shot | backgroundMode: continuable | **Strictly backgroundMode: one-shot** |

agy CLI supports resume flags (--continue, --conversation <id>), but it cannot participate in the Cordis SubagentContinuationManager because it does not run a Harness in-process agent or emit Cordis session events. Attempting to configure backgroundMode: continuable on tool-subagent when prepareContinuable is undefined throws a synchronous mount error (packages/subagent/tool-subagent/src/index.ts:346-348):
```typescript
if (continuable && subagentProvider.prepareContinuable === undefined) {
  throw new Error(`tool-subagent: provider "${subagentProvider.name}" does not support \`backgroundMode: continuable\``)
}
```
Therefore, AgySubagentProvider explicitly and truthfully advertises only one-shot capability. Background delegation is fully supported via the standard host job system (run_in_background: true -> ctx.jobs.start()).

### 2.4 Capabilities and Depth Limits
Out-of-process CLI providers cannot honor parent-enforced in-process filters or prompts. Per packages/subagent/subagent/src/out-of-process.ts:57-63:
```typescript
export const NO_START_CAPABILITIES: SubagentCapabilities = Object.freeze({
  agentOptions: false,
  outputSchema: false,
  depthLimit: false,
  toolFilter: false,
  persona: false,
})
```
Because capabilities.depthLimit is false, configuring a numeric maxDepth on tool-subagent triggers a mount failure (packages/subagent/tool-subagent/src/index.ts:329-333). The agent preset configuration must strictly declare maxDepth: provider-managed, leaving recursion control to the deployment environment.

## 3. Spec Coverage

| Spec / Invariant Requirement | Handled Here | Delegated Elsewhere | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| **INV-03**: Token preservation & delegation (Spec §5.9, HERMES-AGENT-SPEC.md:1234-1237) | **Yes** (AgySubagentProvider) | None | Offloads large file reads and AST editing to external agy CLI (model resolved by active provider router in ~/.hermes/auth.json) |
| **§5.7**: Delegation to a worker (Spec §5.7, HERMES-AGENT-SPEC.md:835-847) | **Partial** (External CLI subagent execution) | @deepseek-ai/dsh-kanban-sqlite (Plan 01), @deepseek-ai/dsh-worktree-local (Plan 07) | subagent-agy executes delegated tasks; card dispatch and worktree provisioning belong to kanban/worktree engines |
| Discrete subprocess spawning & env hygiene (Spec §5.9) | **Yes** (ctx.subprocess.spawn) | None | Spawns /home/sic/.local/bin/agy with scrubbedParentEnv(), preserving HOME/PATH/USER/XDG for self-authentication |
| CLI OAuth self-authentication & zero credential leakage | **Yes** (AgySubagentProvider) | agy CLI (~/.hermes/auth.json) | Provider performs zero credential acquisition, key injection, or OAuth refresh; agy self-authenticates from $HOME |
| Model resolution via deployment router | **Yes** (AgySubagentProvider) | agy CLI (~/.hermes/auth.json) | agy resolves active provider/router; optional Config.model overrides only when explicitly supplied |
| Headless non-interactive execution (Spec §5.9) | **Yes** (argv builder) | None | Enforces --print and --dangerously-skip-permissions |
| Real-time NDJSON wire streaming (Spec §5.9) | **Yes** (AgyWireStream) | None | Parses init, step_update, result stdout lines |
| Never-reject result settlement contract | **Yes** (settleRunResult) | None | Flattens crashes to stopReason: error with safe diagnostics |
| Process group quiescence & staged termination | **Yes** (disposeAgyChild) | @deepseek-ai/dsh-subprocess | Cascades SIGINT -> SIGTERM -> SIGKILL across disposeGraceMs |
| Working directory scoping (Spec §6.2) | **Yes** (resolveChildCwd) | None | Enforces parent session cwd; fails loud if inaccessible |
| Model-facing tool presentation (subagent_agy) | **No** | @deepseek-ai/dsh-tool-subagent (Plan 14) | Decoupled consumer tool mounted inside agent presets |
| Background job collection (job_output) | **No** | @deepseek-ai/dsh-jobs, @deepseek-ai/dsh-tool-jobs | Native background job tracking infrastructure |
| Watchdog stall detection (30m heartbeat) (Spec §5.8) | **No** | @deepseek-ai/dsh-supervisor (Plan 12) | Ambient supervisor daemon monitoring worker heartbeats |
| Host RAM admission guard (< 3 GiB) (Spec §5.7) | **No** | @deepseek-ai/dsh-guard-resource (Plan 08) | Process admission gate intercepting dispatch under memory pressure |

## 4. Proposed Package / File Layout

```
packages/subagent/
└── subagent-agy/                             # @deepseek-ai/dsh-subagent-agy (Host Service Provider)
    ├── package.json                          # ESM package definition, dependencies, exports
    ├── tsconfig.json                         # TypeScript project configuration
    ├── cordis.patch.yml                      # Host-plane patch layer registering subagent-agy
    ├── README.md                             # Architecture, configuration, and wire reference
    ├── src/
    │   ├── index.ts                          # Cordis plugin entrypoint: apply(), Config schema, AgySubagentProvider
    │   ├── process.ts                        # Subprocess spawn specification, argv assembly, execution limits
    │   ├── wire.ts                           # NDJSON streaming parser, event deserialization, usage accumulation
    │   └── run.ts                            # One-shot lifecycle driver, error classification, settlement wiring
    └── tests/
        ├── subagent-agy.spec.ts              # Unit tests: registration, capabilities, cwd resolution, error handling
        ├── wire.spec.ts                      # Wire tests: NDJSON chunking, delta buffering, diagnostic limits
        └── preset-integration.spec.ts        # Integration tests: tool-subagent mount, maxDepth validation, jobs flow
```

## 5. Public Contracts

### 5.1 Configuration Schema (packages/subagent/subagent-agy/src/index.ts)

Validated via @deepseek-ai/schemastery (z):

```typescript
import z from '@deepseek-ai/schemastery'

export const DEFAULT_PROVIDER_NAME = 'agy'
export const DEFAULT_BINARY_PATH = '/home/sic/.local/bin/agy'
export const DEFAULT_DISPOSE_GRACE_MS = 3_000
export const DEFAULT_PRINT_TIMEOUT_MS = 300_000 // 5 minutes

export interface Config {
  /** Provider name on ctx.subagents (default: agy). */
  providerName?: string
  /** Absolute filesystem path to the agy CLI executable. */
  binaryPath?: string
  /**
   * Optional model override passed via `--model` flag.
   * When omitted, agy resolves model selection dynamically from its own active provider
   * and router pool in `/home/sic/.hermes/auth.json`.
   */
  model?: string
  /** Auto-approve all tool permission requests without prompting (default: true). */
  dangerouslySkipPermissions?: boolean
  /** Grace in milliseconds between SIGINT and SIGKILL process escalation. */
  disposeGraceMs?: number
  /** Maximum execution duration before print mode timeout in milliseconds. */
  printTimeoutMs?: number
  /** Explicit environment variables layered over scrubbedParentEnv. */
  env?: Record<string, string>
}

export const Config: z<Config> = z.object({
  providerName: z.string().min(1).default(DEFAULT_PROVIDER_NAME),
  binaryPath: z.string().min(1).default(DEFAULT_BINARY_PATH),
  model: z.string().min(1),
  dangerouslySkipPermissions: z.boolean().default(true),
  disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
  printTimeoutMs: z.number().default(DEFAULT_PRINT_TIMEOUT_MS),
  env: z.dict(z.string()).default({}),
})

type ResolvedConfig = Omit<Required<Config>, 'model'> & Pick<Config, 'model'>
```

### 5.2 Provider Implementation Contract (packages/subagent/subagent-agy/src/index.ts)

Implements SubagentProvider from @deepseek-ai/dsh-subagent (packages/subagent/subagent/src/types.ts:344-390):

```typescript
import type { Context } from '@deepseek-ai/cordis'
import {
  NO_START_CAPABILITIES,
  resolveChildCwd,
  type ResolvedSubagentStartRequest,
  type SubagentCapabilities,
  type SubagentProvider,
  type SubagentRun,
} from '@deepseek-ai/dsh-subagent'

export interface AgyRunSpec {
  cwd: string
  binaryPath: string
  model?: string
  dangerouslySkipPermissions: boolean
  disposeGraceMs: number
  printTimeoutMs: number
  env: Record<string, string>
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  onError: (error: Error, stopReason: SubagentStopReason) => void
}

export class AgySubagentProvider implements SubagentProvider {
  /** Advertises NO_START_CAPABILITIES: CLI processes manage their own tools and depth. */
  readonly capabilities: SubagentCapabilities = NO_START_CAPABILITIES
  /** Descriptive flag: child does not inherit parent conversation turns. */
  readonly inheritsParentContext = false

  /** Internal registry of active child runs for whole-range quiescence upon disposal. */
  private readonly activeRuns = new Set<SubagentRun>()

  constructor(
    readonly name: string,
    private readonly ctx: Context,
    private readonly config: ResolvedConfig,
  ) {}

  /**
   * Start an out-of-process one-shot agy CLI execution.
   * Resolves the child working directory, spawns the CLI, tracks the active run,
   * and returns the SubagentRun handle.
   */
  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    const parentCwd = request.parent.session.header.cwd
    if (parentCwd === undefined) {
      throw new Error(
        `subagent-agy "${this.name}": delegating parent session has no working directory`,
      )
    }

    const cwd = resolveChildCwd('subagent-agy', undefined, parentCwd)

    const spec: AgyRunSpec = {
      cwd,
      binaryPath: this.config.binaryPath,
      ...this.config.model === undefined ? {} : { model: this.config.model },
      dangerouslySkipPermissions: this.config.dangerouslySkipPermissions,
      disposeGraceMs: this.config.disposeGraceMs,
      printTimeoutMs: this.config.printTimeoutMs,
      env: this.config.env,
      spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
      onError: (error, stopReason) => {
        this.ctx.logger.warn(
          `subagent-agy "${this.name}": run failed (${stopReason}): %s`,
          error.message,
        )
      },
    }

    const run = await startAgyRun(request, spec)
    this.activeRuns.add(run)
    void run.result.finally(() => {
      this.activeRuns.delete(run)
    })
    return run
  }

  /**
   * Terminate all currently active CLI runs to reach whole-range quiescence on disposal.
   * Per docs/defensive-patterns.md:19-21:
   * "Dispose must reach quiescence, not just request it. A teardown that issues
   * kills/aborts but returns before the work stops leaves orphans. Make cleanup
   * async and await the children's exit (kill -> await done), and close listener/
   * notification registries BEFORE killing so late completions stay silent."
   */
  async dispose(): Promise<void> {
    const runs = Array.from(this.activeRuns)
    this.activeRuns.clear()
    await Promise.allSettled(runs.map(run => run.dispose()))
  }
}
```

### 5.3 Wire Protocol Shapes (packages/subagent/subagent-agy/src/wire.ts)

Models the exact NDJSON streaming output of /home/sic/.local/bin/agy --output-format stream-json:

```typescript
export interface AgyUsage {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly thinking_tokens: number
  readonly cache_read_tokens: number
  readonly total_tokens: number
}

export interface AgyInitPayload {
  readonly model: string
  readonly cwd: string
  readonly tools: readonly string[]
  readonly permission_mode: string
}

export interface AgyStepUpdatePayload {
  readonly conversation_id: string
  readonly step_index: number
  readonly state: 'ACTIVE' | 'DONE' | 'ERROR'
  readonly step_type: 'user_input' | 'agent_response' | 'tool'
  readonly text_delta?: string
  readonly duration_seconds?: number
  readonly usage?: AgyUsage
}

export interface AgyResultPayload {
  readonly conversation_id: string
  readonly status: 'SUCCESS' | 'ERROR'
  readonly response?: string
  readonly error?: string
  readonly duration_seconds: number
  readonly num_turns: number
  readonly usage: AgyUsage
}

export type AgyWireEvent =
  | { readonly event: 'init'; readonly conversation_id: string; readonly init: AgyInitPayload }
  | { readonly event: 'step_update'; readonly step_update: AgyStepUpdatePayload }
  | { readonly event: 'result'; readonly result: AgyResultPayload }
```

### 5.4 Quoted Existing Harness Types Built Upon
- SubagentProvider, SubagentRun, SubagentResult, SubagentStopReason (packages/subagent/subagent/src/types.ts:252-390).
- NO_START_CAPABILITIES, resolveChildCwd, settleRunResult, subprocessRunHandle (packages/subagent/subagent/src/out-of-process.ts:57-260).
- SubprocessHandle, SubprocessSpawnSpec, SubprocessOutcome, scrubbedParentEnv (packages/subprocess/subprocess/src/types.ts:75-165).
- SessionId, brandString (packages/session/session/src/types.ts:18, packages/brand/brand/src/index.ts:12).
- ContentBlock (packages/llm/llm/src/types.ts:45-55).

## 6. Lifecycle and Scoping

### 6.1 Plugin Registration & Teardown
- **Module Identity**: `export const name = 'subagent-agy'`, `export const inject = ['subagents', 'subprocess']`.
- **Preflight Verification**: In `apply(ctx, config)`, verify:
  1. `assertPositiveFinite('subagent-agy', 'disposeGraceMs', config.disposeGraceMs)`.
  2. `assertPositiveFinite('subagent-agy', 'printTimeoutMs', config.printTimeoutMs)`.
  3. Binary executable probe: verifies `config.binaryPath` is an absolute path, exists on disk (`statSync`), and carries execute bits (`accessSync(path, constants.X_OK)`). Fails load immediately if binary is missing.
- **Provider Registration & Effect Disposer**:
  In accordance with `docs/defensive-patterns.md:19-21` (*"Dispose must reach quiescence, not just request it. A teardown that issues kills/aborts but returns before the work stops leaves orphans. Make cleanup async and await the children's exit (kill → await done), and close listener/notification registries BEFORE killing so late completions stay silent"*), registration must establish an async Cordis effect disposer:
  ```typescript
  export function apply(ctx: Context, config: Config): void {
    // Preflight checks...
    const provider = new AgySubagentProvider(config.providerName, ctx, resolvedConfig)

    ctx.effect(() => {
      // 1. Register provider on ctx.subagents (packages/subagent/subagent/src/index.ts:509-522)
      const unregister = ctx.subagents.registerProvider(provider)

      // 2. Return async disposer honoring Cordis effect and defensive patterns
      return async () => {
        // Step A: Close registry first so late completions stay silent
        unregister()
        // Step B: Terminate all active CLI processes and await quiescence
        await provider.dispose()
      }
    })
  }
  ```
- **Process Tree Teardown Semantics**:
  When `provider.dispose()` executes, it iterates over all tracked `activeRuns` and calls `await run.dispose()`. Under `subprocessRunHandle` (`packages/subagent/subagent/src/out-of-process.ts:245-258`), `run.dispose()` triggers `teardown()`, which executes `child.terminate()` followed by `await child.waitForExit()` on `SubprocessHandle` (`packages/subprocess/subprocess/src/types.ts:183-192`).
  - `child.terminate()` starts provider termination cascading SIGINT -> SIGTERM -> SIGKILL across `disposeGraceMs`.
  - `child.waitForExit()` awaits until the entire managed process group is empty.
  - No out-of-process CLI processes remain detached or leaking CPU/memory/tokens upon plugin unload or Cordis HMR reload.

### 6.2 Scoping & Workspace Isolation
- **Host vs Agent Plane**: Mounted globally on the Host Plane (base.cordis.yml patch layer).
- **Workspace Scoping**: At execution start, resolveChildCwd('subagent-agy', undefined, parentCwd) validates that the parent session workspace path exists and has search permissions (X_OK). The child process executes with its OS working directory anchored to that directory. It **never** falls back to the Harness server launch directory.
- **Environment Scrubbing**: Process environment merges config.env over scrubbedParentEnv(), stripping sensitive harness credentials (*API_KEY*, *TOKEN*, *SECRET*) while preserving system paths (PATH, HOME, USER).

## 7. Agent Preset Integration

The agy subagent provider is consumed in agent presets via @deepseek-ai/dsh-tool-subagent.

### 7.1 Presets Composition (hermes-brain/agent.cordis.yml)

Added to the hermes-brain preset composition inside the delegation tools block:

```yaml
# Inside hermes-brain/agent.cordis.yml
- id: tool-subagent-agy
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: agy
    toolName: subagent_agy
    backgroundMode: one-shot
    maxDepth: provider-managed
```

### 7.2 Preset Rule Verification (PRESET-RULES.md)
1. **Rule 4 Compliance**: tool-subagent-agy only registers a model-visible tool (subagent_agy) into ctx.tools on the session context. It provides no service definition; therefore, it requires no isolate realm (PRESET-RULES.md:10).
2. **Rule 8 Compliance**: The subagents registry is read across sessions and stays host-plane. The preset only contributes the delegation tool that resolves the host provider (PRESET-RULES.md:14).
3. **Mount Validation Compliance**:
   - maxDepth: provider-managed: Because capabilities.depthLimit is false, setting any numeric value would cause assertSubagentProviderConfiguration() to throw cannot enforce maxDepth (no depthLimit capability) (packages/subagent/tool-subagent/src/index.ts:329-333).
   - backgroundMode: one-shot: Because prepareContinuable is undefined, setting continuable would throw does not support backgroundMode: continuable (packages/subagent/tool-subagent/src/index.ts:345-349).
   - agentOptions: Omitted, because capabilities.agentOptions is false.

## 8. Execution Flow

The end-to-end execution flow traverses the following synchronous and asynchronous steps:

```
+----------------+      +-------------------+      +-----------------------+      +-----------------------+
|  hermes-brain  | ---> |   tool-subagent   | ---> |  AgySubagentProvider  | ---> |     ctx.subprocess    |
| (Claude Opus)  |      |   (subagent_agy)  |      |    (ctx.subagents)    |      | (/bin/agy subprocess) |
+----------------+      +-------------------+      +-----------------------+      +-----------------------+
        |                         |                            |                              |
        | 1. subagent_agy(prompt) |                            |                              |
        |------------------------>|                            |                              |
        |                         | 2. ctx.subagents.start()   |                              |
        |                         |--------------------------->|                              |
        |                         |                            | 3. validate cwd, text task   |
        |                         |                            | 4. spawn agy --print ...     |
        |                         |                            |----------------------------->|
        |                         |                            |                              |
        |                         |                            | 5. emit subagent/start       |
        |                         |                            |<=============================|
        |                         |                            |    (stream NDJSON lines)     |
        |                         |                            |                              |
        |                         | 6. return SubagentRun      | 6. AgyWireStream decodes:    |
        |                         |<---------------------------|    init -> step -> result    |
        |                         |                            |                              |
        |                         | 7. await settleRunResult() | 7. settleRunResult()         |
        |                         |                            |    emit subagent/end         |
        | 8. return tool result   |<---------------------------|                              |
        |<------------------------|                            |                              |
```

1. **Model Invocation**:
   The hermes-brain agent (claude-opus-4-8), recognizing a request requiring large file reading (>500 lines) or bulk editing (INV-03), invokes tool subagent_agy:
   ```json
   {
     "description": "Extract API endpoints and database schemas",
     "prompt": "Inspect /home/sic/Desktop/storyincode/packages/server/src/routes.ts and extract all endpoints with structured JSON schemas."
   }
   ```
2. **Consumer Tool Handling (tool-subagent)**:
   - tool-subagent extracts the parent Agent instance from exec.agent.
   - Validates that requested parameters conform to schema.
   - Forwards execution to ctx.subagents.start('agy', startRequest).
3. **Runtime Preflight & Validation**:
   - SubagentRuntime.start() validates that requested capabilities match provider capabilities (assertCapabilities(), packages/subagent/subagent/src/index.ts:641-657). Since no unsupported capabilities are passed, it proceeds.
   - Resolves startRequest.descriptor and calls AgySubagentProvider.start().
4. **Provider Start Preparation**:
   - Validates parent session working directory via resolveChildCwd().
   - Validates that request.prompt contains only non-empty text blocks (textTask(request.prompt)).
   - Generates unique parent-scoped SessionId (brandString<SessionId>(randomUUID())).
5. **Subprocess Spawning**:
   - Constructs discrete argv:
     ```typescript
     [
       spec.binaryPath,
       '--print',
       promptText,
       '--model', spec.model,
       '--output-format', 'stream-json',
       '--dangerously-skip-permissions',
       '--print-timeout', `${Math.ceil(spec.printTimeoutMs / 1000)}s`,
     ]
     ```
   - Calls ctx.subprocess.spawn() with stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: spec.disposeGraceMs, and sanitized env.
   - Registers process failure and abortion hooks.
   - Emits subagent/start event on Cordis context (packages/subagent/subagent/src/index.ts:566).
6. **Streaming Wire Processing**:
   - AgyWireStream wraps child.stdout, splitting incoming chunks on newline delimiters (\n).
   - Line 1 (init): parses model name, session tools, and initial state.
   - Lines 2..N (step_update): accumulates assistant text_delta chunks; updates cumulative token usage (input_tokens, output_tokens, thinking_tokens).
   - Terminal Line (result): receives final outcome (status: SUCCESS or ERROR).
7. **Result Settlement & Normalization**:
   - settleRunResult() receives terminal data:
     - On SUCCESS: returns SubagentResult with stopReason: completed and output: [{ type: 'text', text: response }].
     - On ERROR: extracts error description, caps diagnostic at 4,096 bytes, and returns stopReason: error.
   - Emits subagent/end event on Cordis context (packages/subagent/subagent/src/index.ts:577).
8. **Tool Settlement & Parent Turn Continuation**:
   - tool-subagent maps the completed SubagentResult into an assistant tool execution response.
   - The Brain agent receives the compact, structured extraction without polluting its context window with thousands of raw source lines.

## 9. Error, Cancellation, and Lifecycle Behavior

### 9.1 Cancellation Escalation Ladder
When the delegating parent session cancels or the tool execution aborts:
1. request.signal fires its abort event.
2. The provider abort listener triggers requestCancel().
3. settleRunResult() immediately records that cancellation won settlement, ensuring the run will resolve with stopReason: aborted.
4. dispose() initiates process group termination:
   - Level 1 (SIGINT): Sends SIGINT to the child process tree via child.terminate().
   - Level 2 (Grace Wait): Waits up to disposeGraceMs (default 3,000ms) for the child to exit cleanly (child.waitForExit()).
   - Level 3 (SIGKILL): If the process remains uncooperative after disposeGraceMs, ctx.subprocess sends SIGKILL to the entire process group.
5. dispose() completes cleanly, and child.done settles.

### 9.2 Process Crash and Failure Normalization
- **Non-Zero Exit Codes**: If agy crashes (e.g. out-of-memory, segmentation fault, or exit code 1 due to syntax error), child.done resolves with exit code and signal facts.
- **Wire Stderr Forwarding**: Stderr output from agy is captured into diagnostic buffers.
- **Never-Reject Invariant**: Post-publication infrastructure failures are flattened via settleRunResult():
  ```typescript
  catch (error: unknown) {
    return {
      output: parts.collectOutput(),
      diagnostic: limitSubagentDiagnostic(diagnosticText),
      stopReason: 'error',
    }
  }
  ```
  SubagentRun.result **never** rejects with an unhandled exception. The consumer maps stopReason !== completed to an isError: true tool result, allowing the calling LLM to inspect the diagnostic failure reason.

### 9.3 Diagnostic Byte Capping
Per packages/subagent/subagent/src/out-of-process.ts:20-42, diagnostic strings attached to failed runs are strictly bounded by MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4_096. Multi-byte UTF-8 boundaries are verified before truncation to prevent emitting malformed sequences. Truncated diagnostics append \n[diagnostic truncated].

### 9.4 Fast Startup Rollback
If startup fails before run publication (e.g., cwd resolution fails, spawn throws ENOENT, or request.signal is already aborted):
1. Clean up any allocated partial streams or processes.
2. Throw immediately with a sanitized startup error (AgyStartupFailure).
3. No dangling subagent/start event is emitted.

## 10. Testing Strategy

### 10.1 Unit Tests (packages/subagent/subagent-agy/tests/subagent-agy.spec.ts)
- **Registration**: Verify apply() registers agy on ctx.subagents; unregistration removes it and emits subagent/provider-removed.
- **Capability Assertions**: Confirm provider.capabilities strictly equals NO_START_CAPABILITIES and inheritsParentContext is false.
- **Working Directory**: Assert resolveChildCwd enforces parent session cwd and rejects inaccessible paths.
- **Task Validation**: Verify textTask enforces non-empty text blocks and rejects image/binary content blocks.
- **Argv Construction**: Verify discrete arguments include --print, --model, --output-format stream-json, and --dangerously-skip-permissions.

### 10.2 Wire Protocol Tests (packages/subagent/subagent-agy/tests/wire.spec.ts)
- **NDJSON Chunking**: Test parsing when chunks arrive across multi-byte buffer splits, single-byte fragments, or multiple lines per chunk.
- **Event Extraction**: Verify deserialization of init, step_update, and result frames.
- **Metric Tracking**: Assert token counts (input_tokens, output_tokens, thinking_tokens) are correctly accumulated.
- **Diagnostic Truncation**: Verify diagnostics exceeding 4,096 bytes are cleanly truncated without split UTF-8 characters.

### 10.3 Cancellation & Failure Tests (packages/subagent/subagent-agy/tests/lifecycle.spec.ts)
- **Abort Signal**: Verify aborting request.signal terminates subprocess and resolves stopReason: aborted.
- **Process Escalation**: Mock an uncooperative child; verify SIGINT escalation to SIGKILL after disposeGraceMs.
- **Exit Code 1**: Simulate CLI model failure; assert run resolves with stopReason: error and stderr captured in diagnostic.
- **Idempotent Disposal**: Verify calling run.dispose() multiple times executes process cleanup exactly once.

### 10.4 Preset Integration Tests (packages/subagent/subagent-agy/tests/preset-integration.spec.ts)
- **Tool Mounting**: Mount @deepseek-ai/dsh-tool-subagent with provider: agy, toolName: subagent_agy, backgroundMode: one-shot, maxDepth: provider-managed.
- **Mount Verification**:
  - Assert that changing maxDepth to a number throws mount error.
  - Assert that changing backgroundMode to continuable throws mount error.
- **Background Execution**: Verify run_in_background: true routes through ctx.jobs and returns a valid jobId.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| External headless CLI invocation & permission bypass | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:553, 663-664` | `AGY_BIN` resolution (`~/.local/bin/agy`), non-interactive CLI flags (`--dangerously-skip-permissions`, `--print`, prompt passing via `-p`), and process execution conventions. | Assemble discrete `argv` array in TypeScript `process.ts` via `ctx.subprocess.spawn` with `--output-format stream-json`, avoiding shell execution and unquoted prompt strings. | direct port |
| Model routing & fallback provider configuration | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/catalog_pick.py:35-45`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/supervise.py:261-265, 395-405` | `CLI_PROVIDERS` definition (`agy-cli`, `claude-cli`), model resolution delegation, and active provider routing (allowing `agy` to resolve its active provider/router in `~/.hermes/auth.json` unless overridden by config). | Encapsulate in `Config.model` schema via Schemastery, defaulting to undefined so `agy` routes to its active provider in `~/.hermes/auth.json`. | direct port |
| Subagent lifecycle state & result normalization | `/home/sic/Downloads/hermes-agent-main/agent/subagent_lifecycle.py:36-105` | Subagent lifecycle state machine contracts (`SubagentState`, `SubagentStatus`, `SubagentTerminalState`), tracking goal, working directory, and timeout, mapping terminal outcomes cleanly. | Implement `SubagentProvider` interface (`packages/subagent/subagent/src/types.ts`), map terminal CLI states into `SubagentResult` with `settleRunResult()`, and enforce the never-reject contract. | port with adaptation |
| Working directory scoping & worktree anchoring | `/home/sic/Downloads/hermes-agent-main/tools/subagent_worktree.py:49-60, 75-97` | Repository root and working directory resolution, ensuring child runs are anchored to parent session working trees. | Implement `resolveChildCwd()` validating directory existence and permissions against `request.workingDirectory` or parent `session.header.cwd`. | direct port |
| Streaming NDJSON wire protocol parser | no Hermes equivalent — new code | N/A (Hermes Python scripts ran `agy` with buffered text output; Harness consumes streaming NDJSON frames `step_update`, `init`, `result` in real-time). | Implement `AgyWireStream` in `wire.ts` parsing streaming newline-delimited JSON chunks from stdout and accumulating text deltas. | no Hermes equivalent (new code) |
| Diagnostic truncation & safe UTF-8 byte boundary clamping | no Hermes equivalent — new code | N/A (Harness specific `MAX_SUBAGENT_DIAGNOSTIC_BYTES = 4096` UTF-8 safe slice in `packages/subagent/subagent/src/out-of-process.ts:20-42`). | Implement `truncateUtf8Bytes` in `wire.ts` ensuring multi-byte characters are not split when capturing error diagnostics. | no Hermes equivalent (new code) |
| Process group termination & staged signal escalation | `/home/sic/Downloads/hermes-agent-main/gateway/cgroup_cleanup.py:43-58` | Process group signal delivery and termination logic. | Implement `disposeAgyChild()` cascading from `SIGINT` to `SIGTERM` and `SIGKILL` across `disposeGraceMs` and tracking `activeRuns` for HMR cleanup. | port with adaptation |

The single most valuable capability to port is the headless non-interactive flag assembly and self-authenticating credential delegation pattern (`supervise.py:553, 663-664` and `catalog_pick.py:35-45`). By invoking `/home/sic/.local/bin/agy` with `--dangerously-skip-permissions` and `--print` and letting it authenticate directly against its pre-linked OAuth credential pool (`~/.hermes/auth.json`), the provider completely avoids complex credential management and interactive prompt stalls while offloading large AST queries and token-heavy reads away from the Opus orchestrator (`INV-03`).

## 11. Implementation Steps

1. **Package Setup**:
   - Create packages/subagent/subagent-agy/package.json with workspace dependencies (@deepseek-ai/cordis, @deepseek-ai/dsh-subagent, @deepseek-ai/dsh-subprocess, @deepseek-ai/schemastery).
   - Create tsconfig.json extending root monorepo settings.
   - Create cordis.patch.yml defining host-plane plugin entry.
2. **Subprocess & Argv Specification (src/process.ts)**:
   - Implement agySpawnSpec() assembling discrete argv (-p, --model, --output-format stream-json, --dangerously-skip-permissions).
   - Implement assertExecutableBinary() probing binary presence and execute permissions.
3. **NDJSON Wire Parser (src/wire.ts)**:
   - Implement AgyWireStream decoding newline-delimited JSON chunks from stdout.
   - Implement event handlers for init, step_update, and result.
   - Accumulate text deltas and aggregate token usage metrics.
4. **Lifecycle & Run Driver (src/run.ts)**:
   - Implement startAgyRun() coordinating spawn, abort signals, wire parsing, and disposal.
   - Wire settleRunResult() and subprocessRunHandle() from @deepseek-ai/dsh-subagent/out-of-process.
   - Implement disposeAgyChild() managing staged process group termination.
5. **Cordis Plugin & Provider Class (src/index.ts)**:
   - Implement AgySubagentProvider satisfying SubagentProvider.
   - Define Config schema with @deepseek-ai/schemastery.
   - Implement apply(ctx, config) with parameter bounds assertions and ctx.subagents.registerProvider().
6. **Test Suites**:
   - Implement unit tests in tests/subagent-agy.spec.ts.
   - Implement wire parser tests in tests/wire.spec.ts.
   - Implement preset integration tests in tests/preset-integration.spec.ts.
7. **Preset Composition Updates**:
   - Add tool-subagent-agy configuration row to hermes-brain/agent.cordis.yml.
   - Verify configuration passes verify-cordis-config.

## 12. Acceptance Criteria

- [ ] @deepseek-ai/dsh-subagent-agy exports name = 'subagent-agy' and inject = ['subagents', 'subprocess'].
- [ ] Provider registers successfully on ctx.subagents under provider name agy (or configured providerName).
- [ ] Provider explicitly advertises capabilities: NO_START_CAPABILITIES (agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false).
- [ ] Provider advertises inheritsParentContext: false and omits prepareContinuable (undefined).
- [ ] Working directory resolution enforces delegating session cwd via resolveChildCwd(); never falls back to server root.
- [ ] Subprocess spawns /home/sic/.local/bin/agy with --print, --dangerously-skip-permissions, and --output-format stream-json, passing --model ONLY when a validated Config.model override is set; with no override the model is whatever agy's active provider resolves.
- [ ] Streaming NDJSON parser correctly reconstructs complete assistant response across multiple step_update chunks.
- [ ] Successful CLI execution settles with stopReason: completed and full response text in output.
- [ ] CLI crashes or non-zero exits settle with stopReason: error and diagnostic detail <= 4,096 bytes without unhandled rejections.
- [ ] Request abortion triggers process group termination (SIGINT -> SIGTERM/SIGKILL) and settles with stopReason: aborted.
- [ ] Plugin teardown or HMR reload invokes `provider.dispose()`, terminating all tracked `activeRuns` via `run.dispose()` and awaiting child process-tree exit to achieve full quiescence without orphaned CLI processes (`docs/defensive-patterns.md:19-21`).
- [ ] @deepseek-ai/dsh-tool-subagent mounts cleanly in hermes-brain preset with provider: agy, backgroundMode: one-shot, and maxDepth: provider-managed.
- [ ] All unit, wire, and preset integration tests pass cleanly.

## Review fixes applied

- **REVIEW-lifecycle Finding 1 (Unbounded Out-of-Process CLI Process Leaks on Disposal)**:
  - Required `AgySubagentProvider` to track all running child executions in `activeRuns: Set<SubagentRun>`.
  - Updated Cordis plugin effect disposer in `apply()` to unregister the provider from `ctx.subagents` first (silencing late completions) and `await provider.dispose()` to terminate all active child process trees via `run.dispose()` (`child.terminate()` cascading to SIGKILL across `disposeGraceMs` and `await child.waitForExit()`), reaching complete quiescence per `docs/defensive-patterns.md:19-21` and `packages/subprocess/subprocess/src/types.ts:183-192`.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`supervise.py`, `catalog_pick.py`, `agent/subagent_lifecycle.py`, and `tools/subagent_worktree.py`) to accelerate agy subagent provider implementation.
