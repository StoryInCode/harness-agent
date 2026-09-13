# Set 05 — Worktree Management, Filesystem Isolation, and Host Resource Admission

The Worktree Management and Host Resource Admission subsystem establishes isolated physical execution environments and host machine protection for DeepSeek Harness. Worker subagents execute inside dedicated Git worktrees under `.worktrees/<task-id>/` branched from an immutable base commit SHA recorded at allocation time. Concurrent subagents avoid collisions through deterministic path and branch disambiguation. Child worker sessions are scoped to their worktree through Harness native contracts—locking `SessionHeader.cwd` and engaging kernel-level `SandboxedFileSystem` fencing (`INV-06`) to reject out-of-boundary writes without bespoke virtual-fs machinery. A multi-tier work preservation guard (`INV-07`) strictly refuses worktree deletion if uncommitted tracked changes, untracked evidence files, or unpushed commits exist, verifying squash-merges via disk-memoized `git cherry` patch equivalence and rebase-merges via GitHub PR state. Concurrently, a monotonic host tool guard (`ctx.tools.guard()`) synchronously inspects tool calls inside `stagePreExecuteAndGuards`: vetoing heavy execution when host memory is below the 1536 MiB absolute floor or when effective headroom after active worker reservations is below 3072 MiB (`INV-12`), and vetoing any autonomous mutation targeting `SOUL.md` (`INV-09`). All thresholds are validated Schemastery Config fields, and systemd cgroup v2 metrics gracefully degrade to OS freemem on macOS and Windows.

## Set Index

*Completed pieces live in `05-worktree-guard/done/`.*

| Piece ID | Title | Package | Depends on | Queue Order | Status |
|---|---|---|---|---|---|
| `05.01` | Worktree Service Definition and Domain Contracts | `@deepseek-ai/dsh-worktree` | none | 1 | todo |
| `05.02` | Typed Git Subprocess Runner and Environment Scrubber | `@deepseek-ai/dsh-worktree-git` | `05.01` | 2 | todo |
| `05.03` | Worktree Collision Detection and Path Fallback Resolver | `@deepseek-ai/dsh-worktree-collision` | `05.01`, `05.02` | 3 | todo |
| `05.04` | Base Commit Pinning and Atomic Worktree Allocator | `@deepseek-ai/dsh-worktree-allocator` | `05.01`, `05.02`, `05.03` | 4 | todo |
| `05.05` | Worktree Include Synchronizer and Path Traversal Guard | `@deepseek-ai/dsh-worktree-includes` | `05.01` | 5 | todo |
| `05.06` | Administrative Worktree Lock and PID Liveness Manager | `@deepseek-ai/dsh-worktree-lock` | `05.01`, `05.02` | 6 | todo |
| `05.07` | Upstream Patch Equivalence Cache | `@deepseek-ai/dsh-worktree-cherry-cache` | `05.01` | 7 | todo |
| `05.08` | Multi-Tier Work Preservation Guard (INV-07) | `@deepseek-ai/dsh-worktree-preservation` | `05.01`, `05.02`, `05.07` | 8 | todo |
| `05.09` | Safe Worktree Pruner and Branch Teardown | `@deepseek-ai/dsh-worktree-pruner` | `05.01`, `05.02`, `05.06`, `05.08` | 9 | todo |
| `05.10` | Git Object Pack Sprawl Maintenance | `@deepseek-ai/dsh-worktree-maintenance` | `05.01`, `05.02` | 10 | todo |
| `05.11` | Subagent Worktree Scoping and Sandbox Fencing (INV-06) | `@deepseek-ai/dsh-worktree-scoping` | `05.01`, `05.04` | 11 | todo |
| `05.12` | Local Worktree Manager Host Service | `@deepseek-ai/dsh-worktree-local` | `05.01` through `05.10` | 12 | todo |
| `05.13` | Memory Metrics Provider and Memoized TTL Cache | `@deepseek-ai/dsh-guard-memory-provider` | none | 13 | todo |
| `05.14` | Systemd Cgroup v2 Slice Inspector | `@deepseek-ai/dsh-guard-cgroup-provider` | none | 14 | todo |
| `05.15` | Tool Execution and Sovereign Path Classifier | `@deepseek-ai/dsh-guard-tool-classifier` | none | 15 | todo |
| `05.16` | Dynamic Worker Admission Governor | `@deepseek-ai/dsh-guard-admission` | `05.13`, `05.14` | 16 | todo |
| `05.17` | Monotonic Tool Execution Guard (INV-12 & INV-09) | `@deepseek-ai/dsh-guard-tool-guard` | `05.13`, `05.15`, `05.16` | 17 | todo |
| `05.18` | Resource Guard Host Service and Schemastery Config | `@deepseek-ai/dsh-guard-resource` | `05.13` through `05.17` | 18 | todo |
| `05.19` | Worktree and Resource Guard Host Patch Layer Composition | `@deepseek-ai/dsh-worktree-guard-presets` | `05.12`, `05.18` | 19 | todo |

## Earlier Plan Overrides

This piece set overrides specific legacy designs from `plans/07-worktree-management.md` and `plans/08-resource-guard-and-admission.md`:

1. **Concrete Schemastery Schema for `LocalWorktreeConfig`**: Overrides Plan 07 (§5.3) raw TypeScript interface with runtime Schemastery validation (`export const LocalWorktreeConfig: z<LocalWorktreeConfig> = z.object(...)`), resolving the Review Lifecycle gap (`05.12`, `REVIEW-lifecycle.md:83-85`).
2. **Elimination of Erroneous Worker Preset `$isolate` Realm**: Overrides Plan 07 (§7) invalid `$isolate: { name: true }` and `$path` syntax. Worker presets mount standard tools without isolate realms so they resolve host services (`ctx.kanban`, `ctx.axioms`) while inheriting `SessionHeader.cwd` (`05.11`, `05.19`, `REVIEW-seams.md:70-81`).
3. **Monotonic Tool Guard over Waterfall Interceptors**: Overrides `tools/pre-execute` waterfall listeners with owner-level monotonic `ctx.tools.guard()` in `stagePreExecuteAndGuards`. Returning a denial string prevents downstream listeners or approval prompts from bypassing memory limits (`INV-12`) or SOUL file sovereignty (`INV-09`) (`05.17`).
4. **Native Session Header & Sandbox Contracts over Custom Virtual FS**: Overrides bespoke path-rewriting and virtual filesystems with native `SessionHeader.cwd` and `SandboxedFileSystem.checkedTarget()` kernel fencing (`INV-06`) (`05.11`).
5. **Discrete Subprocess Seam over Shell Strings**: Overrides shell execution with typed `ctx.subprocess.spawn` discrete `argv` arrays, non-interactive flags (`GIT_TERMINAL_PROMPT=0`), and case-insensitive API key scrubbing (`05.02`).
6. **Disk-Memoized Cherry Cache**: Overrides unmemoized patch equivalence checks with atomic JSON persistence at `~/.hermes/cache/worktree_merge_verdicts.json` (`05.07`).

## Platform Specifics and Graceful Degradation

| Platform / Environment | Memory Source | Cgroup Accounting | Headroom Guard (`INV-12`) | SOUL Sovereignty (`INV-09`) | Worktree Process Isolation |
|---|---|---|---|---|---|
| **Linux with systemd cgroups v2** | `/proc/meminfo` (`MemAvailable`) | Full (`hermes-work.slice` read via sysfs) | Authoritative (`available - reserved >= headroom`) | Full (Path & shell token analysis) | systemd transient scopes (`systemd-run --user --scope`) |
| **Linux without cgroups / Container** | `/proc/meminfo` (`MemAvailable`) | Degraded (`cgroupAvailable = false`, reservations = 0) | Active (`available >= headroom`) | Full (Path & shell token analysis) | Process group signal propagation |
| **macOS (Darwin)** | `node:os.freemem()` | Degraded (`cgroupAvailable = false`) | Active (`freemem >= headroom`) | Full (POSIX path normalization) | Process group signal propagation |
| **Windows (win32)** | `node:os.freemem()` | Degraded (`cgroupAvailable = false`) | Active (`freemem >= headroom`) | Full (Windows `\` and `/` path normalization) | Windows Job Objects |

## Execution Protocol

1. **Host Initialization**: On host container startup, `05.19` loads `cordis.patch.yml`. `05.12` mounts `ctx.worktrees` and `05.18` mounts `ctx.resourceGuard`. `05.17` installs the monotonic tool guard on `ctx.tools.guard()`.
2. **Task Allocation**: When a task is dispatched, the orchestrator calls `ctx.worktrees.allocate()` (`05.12`). `05.03` evaluates porcelain listings to resolve a collision-free path (`.worktrees/<taskId>`) and branch (`kanban/<taskId>`). `05.04` pins the immutable base commit SHA from `git rev-parse HEAD^{commit}`. `05.05` syncs `.worktreeinclude` files with traversal protection. `05.06` applies an administrative lock.
3. **Worker Scoping**: The subagent spawns via `ctx.agents.create({ meta: { cwd: worktree.path } })` (`05.11`). `SessionHeader.cwd` locks the worktree path. `SandboxedFileSystem.checkedTarget()` fences all writes to the worktree root (`INV-06`).
4. **Tool Execution & Admission**: During subagent turns, every tool call enters `stagePreExecuteAndGuards`. `05.17` evaluates `05.15` (checking for SOUL.md mutations and heavy commands). If heavy, `05.16` evaluates host memory from `05.13` and cgroup metrics from `05.14`. If headroom < 3072 MiB or available < 1536 MiB, the guard vetoes execution immediately (`INV-12`).
5. **Dynamic Worker Admission**: Before dispatching new cards, Kanban queries `ctx.resourceGuard.canAdmitWorker(activeCount)` (`05.16`). If headroom or cgroup pressure is exceeded, dispatching pauses with `resource/headroom-warning`.
6. **Task Completion & Verification**: The worker commits changes and reports completion. Integrator tests diff against pinned `baseCommit`.
7. **Safe Pruning**: After successful integration landing, the supervisor calls `ctx.worktrees.prune(path)` (`05.09`). `05.08` verifies the 5-tier preservation ladder. If clean and merged (verified via `05.07` cherry cache or GitHub PR state), `05.06` unlocks the tree and `05.09` removes directory and task branch without `--force`. If dirty or unpushed, pruning aborts and `worktree/preserved` emits (`INV-07`).
8. **Hygiene**: Background pack maintenance (`05.10`) runs at nice priority when `.pack` count >= 15.
