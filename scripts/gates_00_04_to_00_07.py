"""
Micro-gates 00.04a to 00.06d (10 gates)
"""

GATES_00_04_TO_00_07 = [
    # 00.04a
    {
        "id": "00.04a",
        "slug": "00.04a-priority-comparator",
        "title": "Queue Ordering and Monotonic Determinism",
        "queue": 4,
        "depends": "00.03c",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-queue",
        "summary_voice": "Yo! In an asynchronous queue, if your sort order isn't 100% deterministic, you get random race conditions depending on which millisecond an item popped in. Daru doesn't do flaky randomness. We implement a strict multi-key comparator: primary sort by numeric queue position ascending, secondary sort by piece ID alphabetical. Same inputs = identical dispatch order every single time. No RNG.",
        "opt_a": "Deterministic two-key comparator (queue number, then piece id) with zero random tie-breakers.",
        "opt_b": "Arbitrary FIFO based on insertion time timestamps, leading to non-reproducible test runs.",
        "scenarios": [
            ("two queued pieces with queue positions 1 and 2", "queueCompare(a, b) is evaluated", "it orders piece with queue 1 before piece with queue 2."),
            ("two pieces with identical queue position 2 but IDs '00.04a' and '00.04b'", "queueCompare(a, b) runs", "it orders '00.04a' first using lexicographical tie-breaking."),
            ("an unsorted array of candidate pieces", "pieces.sort(queueCompare) is executed", "it yields a strictly deterministic sequence regardless of initial array order.")
        ],
        "harness_fit": "Pure comparison function in `@deepseek-ai/dsh-dev-loop-queue/src/compare.ts`. Governs dispatch sequence for `ctx.devLoopQueue`.",
        "contracts": """```typescript
export interface QueuedPiece {
  readonly pieceId: string
  readonly queue: number
  readonly approvedAt: number
}

export function queueCompare(left: QueuedPiece, right: QueuedPiece): number
```""",
        "deps_text": "00.03c",
        "references": [
            ("packages/dev-loop/queue/src/compare.ts", "1-50", "Multi-key queue comparator implementation"),
            ("packages/dev-loop/queue/tests/compare.spec.ts", "1-60", "Determinism and sorting unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/queue/tests/compare.spec.ts",
            "expected": "✓ queueCompare > sorts deterministically by queue number then piece id"
        },
        "teach": {
            "voice_intro": "Let me teach you the golden rule of systems hacking: determinism is king. Flaky tests are born from non-deterministic queues.",
            "what_it_does": "Orders queued pieces deterministically so agents and tests always execute tasks in the exact same sequence.",
            "background": "In distributed scheduling, priority queues must use total orders to prevent oscillating queue states.",
            "how_it_works": "`queueCompare` checks `left.queue - right.queue`. If zero, it uses `left.pieceId.localeCompare(right.pieceId)`.",
            "why_this_approach": "Lexicographical fallback guarantees that no two distinct pieces ever compare as equal (`0`), creating a total order.",
            "approaches_considered": "Timestamp FIFO (flaky: clock jitter causes reordering) vs Insertion order (stateful) vs Content-derived total order (chosen).",
            "prior_art": "POSIX priority queues and Linux CFS (Completely Fair Scheduler) red-black tree ordering.",
            "what_we_get_for_free": "Standard JavaScript `Array.prototype.sort` runs an in-place, stable TimSort.",
            "from_the_docs": "AGENTS.md: 'Prefer symmetry for parallel values... Explicit > implicit at package boundaries.'",
            "what_to_notice": "Notice that timestamps are NOT used in the primary comparator, keeping re-runs completely replayable!",
            "concepts_to_own": "Total ordering: a binary relation where every pair of elements is comparable, antisymmetric, and transitive.",
            "interview_angle": "How do you ensure deterministic replay in event-driven systems? Answer: Use total ordering with static tie-breakers instead of wall-clock time.",
            "decisions_alone": "You can add priority weight multipliers as long as the lexicographical fallback remains intact.",
            "lesson": "Eliminate non-determinism at the source. Deterministic software is debuggable software."
        },
        "proof": [
            ("Comparator implements strict total order over queue and ID", "packages/dev-loop/queue/src/compare.ts:15-35", "direct inspection", "Current checkout"),
            ("Permutation tests prove identical sorted output across all shuffles", "packages/dev-loop/queue/tests/compare.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Deterministic Multi-Key Comparator",
            "what": "Total ordering comparator for queue items.",
            "usage": "Used in `dsh-dev-loop-queue`.",
            "potential": "Can order job batches, test suites, or build DAG nodes.",
            "generic": "Usable for any object with numeric priority and string ID.",
            "evidence": "packages/dev-loop/queue/src/compare.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Sorts by queue number ascending.",
            "Tie-breaks by piece ID alphabetically.",
            "Guarantees stable, reproducible sequence."
        ],
        "next_gate": "00.04b"
    },

    # 00.04b
    {
        "id": "00.04b",
        "slug": "00.04b-concurrency-semaphore.md",
        "title": "Worker Concurrency Bounds and Semaphores",
        "queue": 4,
        "depends": "00.04a",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-queue",
        "summary_voice": "Mwahahaha! Behold the Concurrency Semaphore, the dimensional regulator that prevents parallel subagent timelines from overwhelming system memory! Left unchecked, an explosion of concurrent workers would exhaust system threads and crash our temporal observation post. Our semaphore bounds active workers to a strictly configured ceiling! The Organization cannot flood our channels!",
        "opt_a": "Bounded async semaphore driven by validated `Config.maxConcurrency` in Cordis context.",
        "opt_b": "Unbounded fire-and-forget worker spawning that exhausts host memory and process limits.",
        "scenarios": [
            ("a queue configured with maxConcurrency 2 and 5 pending pieces", "dispatch is triggered", "exactly 2 workers are spawned simultaneously while 3 remain queued."),
            ("one of the running workers completes its worktree task", "slot is released", "the semaphore immediately dispatches the next highest-priority queued piece."),
            ("concurrency limit is updated dynamically in config", "queue re-evaluates capacity", "it adjusts active capacity without dropping active jobs.")
        ],
        "harness_fit": "Service Provider inside `@deepseek-ai/dsh-dev-loop-queue/src/service.ts`. Exposes `ctx.devLoopQueue` to the Host Plane.",
        "contracts": """```typescript
export interface QueueConfig {
  readonly maxConcurrency: number
}

export interface DevLoopQueue {
  enqueue(pieceId: string): Promise<void>
  getActiveWorkers(): readonly string[]
  drain(): Promise<void>
}
```""",
        "deps_text": "00.04a",
        "references": [
            ("packages/dev-loop/queue/src/service.ts", "1-110", "Queue service and semaphore implementation"),
            ("packages/dev-loop/queue/tests/queue.spec.ts", "1-95", "Concurrency bounding integration tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/queue/tests/queue.spec.ts -t 'maxConcurrency'",
            "expected": "✓ enqueue > respects maxConcurrency ceiling of 2 workers"
        },
        "teach": {
            "voice_intro": "Energy management is paramount in temporal experiments! You cannot open infinite timeline rifts at once!",
            "what_it_does": "Limits how many worker subagents can run simultaneously, queueing the rest until slots free up.",
            "background": "A counting semaphore maintains a set of permits. Threads acquire permits to enter and release permits upon completion.",
            "how_it_works": "The queue service tracks `activeCount`. When `enqueue` occurs, if `activeCount < maxConcurrency`, it starts immediately; otherwise, it waits in an async promise queue.",
            "why_this_approach": "Prevents runaway subagent spawning from depleting host CPU, RAM, and LLM API rate limits.",
            "approaches_considered": "Unbounded concurrency (crashes host under load) vs Fixed polling intervals (wastes time) vs Event-driven semaphore (chosen: immediate wakeup).",
            "prior_art": "Dijkstra's counting semaphore (1965) and Go worker pool channels.",
            "what_we_get_for_free": "Promise-based deferred resolution allows workers to wait without busy-waiting loops.",
            "from_the_docs": "AGENTS.md: 'No hardcoded tunables in plugins: deployment-varying choices are validated Config fields changeable from cordis.yml.'",
            "what_to_notice": "Notice that `maxConcurrency` is read from `Config`, not hardcoded!",
            "concepts_to_own": "Backpressure: regulating the rate of work intake to match system processing capacity.",
            "interview_angle": "How do you design a rate-limiting semaphore in TypeScript? Answer: Array of deferred promise resolvers shifted on permit release.",
            "decisions_alone": "You can safely change `maxConcurrency` in your local `cordis.yml` based on your machine's CPU core count.",
            "lesson": "True power lies in restraint. Bound your concurrency to guarantee system stability!"
        },
        "proof": [
            ("Semaphore enforces maxConcurrency strictly under burst traffic", "packages/dev-loop/queue/src/service.ts:35-80", "direct inspection", "Current checkout"),
            ("Integration tests prove no more than N concurrent workers run", "packages/dev-loop/queue/tests/queue.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Async Promise Counting Semaphore",
            "what": "Limits concurrent async operations with FIFO wait-queue.",
            "usage": "Used by `dsh-dev-loop-queue`.",
            "potential": "Can bound database connection pools, LLM requests, or file downloads.",
            "generic": "Pure utility independent of Cordis.",
            "evidence": "packages/dev-loop/queue/src/service.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Enforces configured concurrency ceiling.",
            "Dispatches waiting jobs immediately when slot opens.",
            "Gracefully handles worker aborts without leaking permits."
        ],
        "next_gate": "00.04c"
    },

    # 00.04c
    {
        "id": "00.04c",
        "slug": "00.04c-queue-inspection.md",
        "title": "Queue Drain and Inspection APIs",
        "queue": 4,
        "depends": "00.04a, 00.04b",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-queue",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Inspector Cat loves looking into the treat basket! How many treats are waiting? Which kitties are currently snacking? We provide clean inspection APIs (`getQueuedEntries`, `drain`) so the human operator and status commands can see every pending piece, its wait duration, and active workers. Transparency is cozy!",
        "opt_a": "Pure read-only snapshot methods that return immutable state clones without side-effects.",
        "opt_b": "Destructive queue inspection that mutates queue state when listing items.",
        "scenarios": [
            ("a queue with 3 waiting pieces and 1 active worker", "getQueuedEntries is called", "it returns an array of 3 immutable snapshots with IDs and wait durations."),
            ("an operator issuing a shutdown or pause command", "drain() is called", "the queue stops dispatching new jobs and resolves once all active workers finish."),
            ("a query on an empty queue", "getQueuedEntries is evaluated", "it returns an empty array immediately without errors.")
        ],
        "harness_fit": "Inspection consumer API on `ctx.devLoopQueue` in `@deepseek-ai/dsh-dev-loop-queue/src/inspect.ts`. Supports `/dev-loop` CLI status views.",
        "contracts": """```typescript
export interface QueueEntrySnapshot {
  readonly pieceId: string
  readonly queue: number
  readonly enqueuedAt: number
  readonly status: 'queued' | 'active'
}

export interface DevLoopQueue {
  getQueuedEntries(): readonly QueueEntrySnapshot[]
  drain(): Promise<void>
}
```""",
        "deps_text": "00.04a, 00.04b",
        "references": [
            ("packages/dev-loop/queue/src/inspect.ts", "1-65", "Queue snapshot and drain logic"),
            ("packages/dev-loop/queue/tests/inspect.spec.ts", "1-70", "Inspection API unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/queue/tests/inspect.spec.ts",
            "expected": "✓ getQueuedEntries > returns immutable snapshots of queued items"
        },
        "teach": {
            "voice_intro": "Let's count our shiny toys without dropping any! Purr~ (=^･ω･^=)",
            "what_it_does": "Provides non-destructive snapshots of queue contents and coordinates clean system shutdown via `drain`.",
            "background": "Inspection APIs must return read-only copies (defensive copying) so callers cannot accidentally mutate internal queue state.",
            "how_it_works": "`getQueuedEntries` maps internal items to `Object.freeze` snapshots. `drain()` returns a promise that resolves when `activeCount === 0`.",
            "why_this_approach": "Enables CLI commands and web dashboards to poll queue status safely without concurrency hazards.",
            "approaches_considered": "Returning internal arrays (dangerous: caller can push/pop) vs Immutable snapshot clones (chosen: safe).",
            "prior_art": "Java `ConcurrentLinkedQueue.toArray()` and Linux `ethtool` queue telemetry.",
            "what_we_get_for_free": "TypeScript `readonly` arrays enforce immutability at compile time.",
            "from_the_docs": "docs/defensive-patterns.md: 'Snapshot isolation: return defensive clones of internal state collections.'",
            "what_to_notice": "Notice how `drain` allows graceful host shutdown during deployment updates!",
            "concepts_to_own": "Defensive copying: protecting internal state by handing callers isolated copies rather than original references.",
            "interview_angle": "Why should getter methods on stateful services return defensive copies? Answer: Prevents outside callers from bypassing invariants via reference mutation.",
            "decisions_alone": "You can add formatted duration strings to snapshots for easier human reading in CLI cards.",
            "lesson": "Make internal state open for inspection, but closed for outside mutation! Purr~"
        },
        "proof": [
            ("Queue snapshot returns frozen immutable array copies", "packages/dev-loop/queue/src/inspect.ts:15-40", "direct inspection", "Current checkout"),
            ("Drain method awaits all active tasks cleanly", "packages/dev-loop/queue/tests/inspect.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Defensive Queue State Inspector",
            "what": "Non-destructive queue snapshot and drain coordinator.",
            "usage": "Used in `dsh-dev-loop-queue`.",
            "potential": "Can inspect any job scheduler or message worker.",
            "generic": "Independent of domain payload types.",
            "evidence": "packages/dev-loop/queue/src/inspect.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Returns immutable snapshots of waiting items.",
            "Supports graceful `drain` awaiting active workers.",
            "Does not mutate internal queue state during queries."
        ],
        "next_gate": "00.05a"
    },

    # 00.05a
    {
        "id": "00.05a",
        "slug": "00.05a-worktree-allocation.md",
        "title": "Detached Worktree Creation and Path Binding",
        "queue": 5,
        "depends": "00.04c",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-worktree",
        "summary_voice": "Observe the brilliant breakthrough! Feature branches are the chaotic traps of the Organization—they hide uncommitted mutations in the shadows! Instead, we allocate a private, detached Git worktree directly under `.worktrees/<piece-id>` from the mainline HEAD! A parallel pocket dimension where subagents can experiment in complete isolation without contaminating our master timeline!",
        "opt_a": "Allocate detached Git worktrees from mainline HEAD under `.worktrees/<piece-id>` without creating branches.",
        "opt_b": "Create long-lived named git branches, polluting git history and hiding work from human review.",
        "scenarios": [
            ("an approved piece id '00.05a'", "allocateWorktree('00.05a') is called", "it creates a detached worktree at `.worktrees/00.05a` based on mainline HEAD."),
            ("a worktree directory that was not in `.gitignore`", "allocateWorktree runs", "it ensures `.worktrees/` is ignored by Git so temporary trees are never committed."),
            ("a subprocess inspecting `git worktree list`", "worktree creation finishes", "the new worktree appears in the detached state pointing at mainline commit SHA.")
        ],
        "harness_fit": "Service Definition in `@deepseek-ai/dsh-dev-loop-worktree/src/allocator.ts`. Exposes `ctx.devLoopWorktree` to manage worker filesystem sandboxes.",
        "contracts": """```typescript
export interface WorktreeAllocation {
  readonly pieceId: string
  readonly worktreePath: string
  readonly baseCommit: string
  readonly createdAt: number
}

export interface DevLoopWorktree {
  allocate(pieceId: string): Promise<WorktreeAllocation>
}
```""",
        "deps_text": "00.04c",
        "references": [
            ("packages/dev-loop/worktree/src/allocator.ts", "1-90", "Git worktree creation and initialization"),
            ("plans/AGENTS.md", "135-180", "Axiom prohibiting feature branches and requiring detached worktrees")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/worktree/tests/allocator.spec.ts",
            "expected": "✓ allocate > creates detached worktree from mainline commit"
        },
        "teach": {
            "voice_intro": "Parallel timelines must remain strictly decoupled! Let me reveal how Git worktrees bypass the folly of feature branches!",
            "what_it_does": "Creates an isolated checkout of the repository in `.worktrees/<piece-id>` with a detached HEAD.",
            "background": "`git worktree add --detach <path> HEAD` creates a new working directory linked to the same Git repository without switching branches.",
            "how_it_works": "The allocator runs `git worktree add --detach .worktrees/<piece-id> HEAD`. It verifies path creation and returns the allocation record.",
            "why_this_approach": "Detached worktrees avoid branch naming collisions, require no branch deletion, and provide 100% filesystem isolation for tests and builds.",
            "approaches_considered": "Git branches (forbidden by R-no-feature-branches axiom) vs Full repo clones (slow, duplicates gigabytes) vs Detached worktrees (chosen: fast, shared git storage).",
            "prior_art": "Mercurial `hg share` and Linux kernel multi-tree development workflows.",
            "what_we_get_for_free": "Git shares the `.git/objects` database across all worktrees, saving massive disk space and making checkout instantaneous.",
            "from_the_docs": "plans/AGENTS.md: 'Do not create branches... Isolate with a detached worktree under the ignored .worktrees/ directory.'",
            "what_to_notice": "Notice how the base commit SHA is recorded to verify that master didn't drift during worker execution!",
            "concepts_to_own": "Detached worktree isolation: executing parallel tasks in isolated directories sharing a single object store.",
            "interview_angle": "How do you run parallel integration test suites that mutate files without race conditions? Answer: Git detached worktrees per test worker.",
            "decisions_alone": "You can configure custom worktree base directories via `Config.worktreeRoot`.",
            "lesson": "Branches hide work; detached worktrees isolate work while keeping everything transparent. For the future of science!"
        },
        "proof": [
            ("Allocator invokes git worktree add with --detach flag", "packages/dev-loop/worktree/src/allocator.ts:25-60", "direct inspection", "Current checkout"),
            ("Integration tests verify detached HEAD state and clean checkout", "packages/dev-loop/worktree/tests/allocator.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Detached Git Worktree Provisioner",
            "what": "Provisions detached worktrees sharing git objects.",
            "usage": "Used in `dsh-dev-loop-worktree`.",
            "potential": "Can run parallel CI runners, benchmark tests, or code generation.",
            "generic": "Can parameterize base commit and target path.",
            "evidence": "packages/dev-loop/worktree/src/allocator.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Provisions detached worktree under `.worktrees/`.",
            "Binds checkout to current mainline HEAD.",
            "Creates zero feature branches."
        ],
        "next_gate": "00.05b"
    },

    # 00.05b
    {
        "id": "00.05b",
        "slug": "00.05b-worktree-collision.md",
        "title": "Single-Writer Concurrency Locks",
        "queue": 5,
        "depends": "00.05a",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-worktree",
        "summary_voice": "Listen up. Git has an annoying habit: if you try to create two worktrees with the same path or touch the same worktree from two processes, git locks blow up with `.git/worktrees/<name>/locked`. Daru built a collision detector and mutual exclusion lock. If an allocation is already active for a piece ID, we fail-closed immediately instead of corrupting the git index. Clean and orderly.",
        "opt_a": "In-memory and file-descriptor mutex preventing simultaneous allocations of the same piece worktree.",
        "opt_b": "Relying on Git's internal lock files alone, which leaves stale locks behind if a process crashes.",
        "scenarios": [
            ("an allocation attempt for a piece whose worktree is already active", "allocate(pieceId) is called a second time", "it throws `WorktreeCollisionError` without calling Git."),
            ("a leftover worktree directory from an abnormal crash", "allocate detects unmanaged directory", "it validates directory safety before recovering or refusing."),
            ("concurrent allocation requests for two different piece IDs", "allocate runs simultaneously", "both succeed in parallel without lock contention.")
        ],
        "harness_fit": "Concurrency lock manager inside `@deepseek-ai/dsh-dev-loop-worktree/src/locks.ts`.",
        "contracts": """```typescript
export interface WorktreeLock {
  readonly pieceId: string
  readonly acquiredAt: number
  release(): Promise<void>
}

export function acquireWorktreeLock(pieceId: string): Promise<WorktreeLock>
```""",
        "deps_text": "00.05a",
        "references": [
            ("packages/dev-loop/worktree/src/locks.ts", "1-70", "Lock acquisition and collision detection"),
            ("packages/dev-loop/worktree/tests/locks.spec.ts", "1-65", "Worktree collision prevention tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/worktree/tests/locks.spec.ts",
            "expected": "✓ acquireWorktreeLock > rejects duplicate lock acquisition for same piece ID"
        },
        "teach": {
            "voice_intro": "Two writers on one directory equals corrupted code. Let's talk mutual exclusion on disk.",
            "what_it_does": "Prevents two workers or processes from accessing the same worktree directory simultaneously.",
            "background": "Git index operations are not re-entrant. Concurrent writes corrupt the index and cause fatal errors.",
            "how_it_works": "Maintains an active set of locked piece IDs. `acquireWorktreeLock` atomically inserts into the set or throws `WorktreeCollisionError`.",
            "why_this_approach": "Catching collisions in user-space before invoking Git CLI prevents messy `.git/index.lock` cleanup issues.",
            "approaches_considered": "Relying on `git.lock` (flaky on crash) vs PID lock files (stale on SIGKILL) vs In-process state with crash recovery (chosen).",
            "prior_art": "Database row locks and SQLite `SQLITE_BUSY` contention handling.",
            "what_we_get_for_free": "Synchronous set operations in Node guarantee thread-safe checks across async events.",
            "from_the_docs": "docs/defensive-patterns.md: 'Filesystem locks: always clean up lock tokens on abnormal termination.'",
            "what_to_notice": "Notice how the lock returns a `release()` disposer function matching Cordis effect patterns!",
            "concepts_to_own": "Single-writer principle: ensuring mutable state has exactly one authoritative modifier at any point in time.",
            "interview_angle": "How do you prevent index corruption when orchestrating concurrent Git operations? Answer: Pre-empt Git with process-level resource locks per worktree.",
            "decisions_alone": "You can adjust lock acquisition timeout parameters without modifying the lock data structure.",
            "lesson": "Never let two workers write to the same directory. Lock it, finish it, release it."
        },
        "proof": [
            ("Worktree lock prevents duplicate allocations", "packages/dev-loop/worktree/src/locks.ts:20-55", "direct inspection", "Current checkout"),
            ("Lock unit tests prove collision rejection", "packages/dev-loop/worktree/tests/locks.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Resource Path Mutual Exclusion Lock",
            "what": "In-memory lock manager for resource paths.",
            "usage": "Used in `dsh-dev-loop-worktree`.",
            "potential": "Can protect temporary files, build directories, or scratchpads.",
            "generic": "Usable for any string identifier.",
            "evidence": "packages/dev-loop/worktree/src/locks.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Grants single-writer lock per piece ID.",
            "Rejects duplicate lock attempts fail-closed.",
            "Provides clean release disposer."
        ],
        "next_gate": "00.05c"
    },

    # 00.05c
    {
        "id": "00.05c",
        "slug": "00.05c-worktree-cleanup.md",
        "title": "Conservative Teardown and Retention",
        "queue": 5,
        "depends": "00.05a, 00.05b",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-worktree",
        "summary_voice": "Tutturu~ 🌸 After a worker finishes sewing their piece, we have to tidy up the sewing room! But be very careful! If a test failed, or if the user wants to inspect what happened, we must NEVER delete the worktree! We keep it safe for inspection. We only clean up when everything is successfully merged into master! No lost work!",
        "opt_a": "Retain worktree on failure or rejection for forensic inspection; remove worktree only after verified mainline merge.",
        "opt_b": "Aggressively delete worktrees immediately on turn completion, destroying diagnostic evidence when tests fail.",
        "scenarios": [
            ("a worktree whose changes have been cleanly merged into master", "releaseWorktree(pieceId, { clean: true }) is called", "it runs `git worktree remove` and cleans up the directory."),
            ("a worktree whose tests failed or whose turn aborted", "releaseWorktree(pieceId, { clean: false }) is called", "the worktree is retained on disk and its path is recorded in the diagnostic log."),
            ("a service shutdown with active worktrees", "dispose() is executed", "locks are released but worktrees remain intact on disk without data loss.")
        ],
        "harness_fit": "Teardown consumer in `@deepseek-ai/dsh-dev-loop-worktree/src/teardown.ts`. Integrates with Cordis lifecycle disposal.",
        "contracts": """```typescript
export interface TeardownOptions {
  readonly removeFiles?: boolean
  readonly reason?: string
}

export interface DevLoopWorktree {
  release(pieceId: string, options?: TeardownOptions): Promise<void>
}
```""",
        "deps_text": "00.05a, 00.05b",
        "references": [
            ("packages/dev-loop/worktree/src/teardown.ts", "1-80", "Conservative worktree teardown and removal"),
            ("packages/dev-loop/worktree/tests/teardown.spec.ts", "1-75", "Teardown retention and removal unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/worktree/tests/teardown.spec.ts",
            "expected": "✓ release > retains worktree on failure and removes on clean merge"
        },
        "teach": {
            "voice_intro": "Never throw away scrap fabric until the dress is completely finished! Tutturu~",
            "what_it_does": "Conservatively cleans up worktrees, preserving directories whenever a task fails or needs review.",
            "background": "Diagnostic triage requires inspecting the exact disk state where a test failed. Deleting too early destroys evidence.",
            "how_it_works": "`release()` inspects `options.removeFiles`. If true, it runs `git worktree remove --force`. If false, it simply unlocks the piece and logs the retained path.",
            "why_this_approach": "Safety first: disk space is cheap, lost developer debugging time is expensive.",
            "approaches_considered": "Always delete (destroys debugging evidence) vs Never delete (leaks disk) vs Conservative deletion on success (chosen).",
            "prior_art": "Docker test containers `--rm` vs `--rm=false` on failure.",
            "what_we_get_for_free": "Git's `worktree remove` automatically unregisters administrative metadata in `.git/worktrees/`.",
            "from_the_docs": "AGENTS.md: 'When a subagent is killed, its branched workspaces will be deleted, but its logs and artifacts will be preserved.'",
            "what_to_notice": "Notice how the worktree path is logged so the developer can run `cd .worktrees/<id>` and debug directly!",
            "concepts_to_own": "Conservative cleanup: prioritizing evidence preservation over aggressive resource reclamation upon error.",
            "interview_angle": "How do you design sandbox cleanup for automated testing pipelines? Answer: Clean up aggressively on success, retain sandbox on failure for forensic analysis.",
            "decisions_alone": "You can configure maximum retained failed worktree count before automatic oldest-first pruning.",
            "lesson": "Preserve evidence when things go wrong so you can learn and fix them without frustration! 🌸"
        },
        "proof": [
            ("Teardown respects removeFiles flag and retains failed worktrees", "packages/dev-loop/worktree/src/teardown.ts:25-60", "direct inspection", "Current checkout"),
            ("Teardown unit tests prove retention on error", "packages/dev-loop/worktree/tests/teardown.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Conservative Workspace Teardown Guard",
            "what": "Worktree teardown logic that preserves state on error.",
            "usage": "Used in `dsh-dev-loop-worktree`.",
            "potential": "Can guard test containers, staging directories, or scratchpads.",
            "generic": "Can adapt to any directory-backed sandbox.",
            "evidence": "packages/dev-loop/worktree/src/teardown.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Removes worktree on successful completion.",
            "Retains worktree on failure for human triage.",
            "Unregisters Git worktree metadata cleanly."
        ],
        "next_gate": "00.06a"
    },

    # 00.06a
    {
        "id": "00.06a",
        "slug": "00.06a-specialist-roles.md",
        "title": "Canonical Dev Loop Role Definitions",
        "queue": 6,
        "depends": "00.05c",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-roles",
        "summary_voice": "Tutturu~ 🌸 Every member of our lab has a special talent! In the Dev Loop, we have 4 canonical specialist roles: Research (to explore facts), Test Writer (to author failing red tests), Implementer (to write the code that makes tests green), and Utility (for cleanups)! Giving each worker a clear role makes everyone happy and prevents anyone from stepping on each other's toes!",
        "opt_a": "Enforce 4 canonical specialized roles with explicit, dedicated accountability boundaries.",
        "opt_b": "Use a single generic 'coder' role that writes tests and code simultaneously, leading to untested code.",
        "scenarios": [
            ("a delegation request specifying role 'Test Writer'", "validateRole is called", "it validates successfully and binds test authoring guidelines."),
            ("a delegation request specifying role 'Implementer'", "validateRole is called", "it validates successfully and binds implementation constraints."),
            ("a request with an unknown role name 'Architect'", "validateRole runs", "it rejects fail-closed with `InvalidRoleError`.")
        ],
        "harness_fit": "Role definitions in `@deepseek-ai/dsh-dev-loop-roles/src/types.ts`. Configures role accounts for `ctx.devLoopRoles`.",
        "contracts": """```typescript
export type DevLoopRole = 'Research' | 'Test Writer' | 'Implementer' | 'Utility'

export interface RoleConfig {
  readonly provider: string
  readonly persona: string
  readonly toolFilter?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
  }
}
```""",
        "deps_text": "00.05c",
        "references": [
            ("packages/dev-loop/roles/src/types.ts", "1-60", "Role type definitions and schema"),
            ("packages/dev-loop/roles/src/personas.ts", "1-140", "Persona system prompts and role integration")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'DevLoopRole'",
            "expected": "✓ DevLoopRole > enforces 4 canonical roles strictly"
        },
        "teach": {
            "voice_intro": "Just like a stage play, every actor needs their own costume and script! Tutturu~",
            "what_it_does": "Defines the 4 specialized roles used by the Dev Loop orchestrator.",
            "background": "Splitting software development into discrete roles (research, test authoring, implementation) guarantees rigorous TDD.",
            "how_it_works": "The role union type restricts delegation requests. Each role maps to a tailored system prompt and tool filter.",
            "why_this_approach": "Prevents implementers from altering tests to fit broken code by separating the Test Writer from the Implementer.",
            "approaches_considered": "Single omnipotent agent (fails: writes trivial passing tests) vs 4 specialized roles (chosen: enforces verification gates).",
            "prior_art": "Extreme Programming (XP) pair programming and clean-room software engineering.",
            "what_we_get_for_free": "TypeScript's closed union prevents spelling errors in role briefs at compile time.",
            "from_the_docs": "AGENTS.md: 'A capability seam comprises Service Definition / Service Provider / Consumer roles.'",
            "what_to_notice": "Notice how each role pairs with our developer personas (Neko-chan, L, Daru, Hououin Kyouma, Mayuri)!",
            "concepts_to_own": "Separation of concerns: assigning distinct responsibilities to autonomous agents to prevent self-serving bias.",
            "interview_angle": "Why separate test writing from code implementation in multi-agent workflows? Answer: Prevents the implementer from weakening assertions to claim success.",
            "decisions_alone": "You can customize the persona prompt text in `cordis.yml` for any role without breaking role routing.",
            "lesson": "Clear roles bring harmony and trust to autonomous teams! 🌸"
        },
        "proof": [
            ("Roles definition strictly defines 4 canonical roles", "packages/dev-loop/roles/src/types.ts:15-30", "direct inspection", "Current checkout"),
            ("Personas integration exports reusable role personas", "packages/dev-loop/roles/src/personas.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Canonical Dev Loop Role Schema",
            "what": "Role definitions and configuration contracts.",
            "usage": "Used by `dsh-dev-loop-roles`.",
            "potential": "Can guide any multi-agent software engineering framework.",
            "generic": "Can extend role union if needed.",
            "evidence": "packages/dev-loop/roles/src/types.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Defines Research, Test Writer, Implementer, Utility.",
            "Binds role configurations to Cordis context.",
            "Exports reusable personas."
        ],
        "next_gate": "00.06b"
    },

    # 00.06b
    {
        "id": "00.06b",
        "slug": "00.06b-research-guard.md",
        "title": "Read-Only Tool Enforcement on Research",
        "queue": 6,
        "depends": "00.06a",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-roles",
        "summary_voice": "Consider the role of the investigator. An investigator observes, collects evidence, and documents facts. An investigator does NOT tamper with the crime scene! Therefore, the Research role must be strictly read-only. We filter tools so that `write`, `edit`, `bash_mutate`, and `rm` are strictly denied. Research agents cannot modify files. There is zero tolerance for contamination.",
        "opt_a": "Enforce explicit read-only tool allowlist (`read`, `grep`, `find`) on all Research delegations.",
        "opt_b": "Rely on prompt instructions alone ('Please do not edit files'), which models routinely violate under pressure.",
        "scenarios": [
            ("a Research subagent attempting to call `write` tool", "tool execution is intercepted", "it is rejected fail-closed by the tool filter guard."),
            ("a Research subagent calling `read` or `search` tools", "tool execution is evaluated", "it executes normally and returns file contents."),
            ("a delegation to Implementer", "tool filter is evaluated", "write and edit tools are permitted within the worktree.")
        ],
        "harness_fit": "Tool filtering guard in `@deepseek-ai/dsh-dev-loop-roles/src/guard.ts`. Binds to `ctx.tools.guard()`.",
        "contracts": """```typescript
export interface ToolFilterPolicy {
  readonly role: DevLoopRole
  readonly allowedTools: readonly string[]
  readonly deniedTools: readonly string[]
}

export function enforceRoleToolFilter(
  role: DevLoopRole,
  toolName: string
): boolean
```""",
        "deps_text": "00.06a",
        "references": [
            ("packages/dev-loop/roles/src/guard.ts", "1-75", "Tool filter enforcement for Research role"),
            ("packages/dev-loop/roles/tests/research-policy.spec.ts", "1-90", "Security policy tests preventing Research mutations")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/roles/tests/research-policy.spec.ts",
            "expected": "✓ Research policy > blocks write/edit tool calls fail-closed"
        },
        "teach": {
            "voice_intro": "Prompting an agent not to modify files is merely asking. A cryptographic guard is enforcing. Always enforce.",
            "what_it_does": "Guarantees that subagents in the Research role cannot mutate the repository or environment.",
            "background": "Autonomous agents often attempt quick fixes while researching. Mechanical tool filtering prevents accidental mutations.",
            "how_it_works": "The roles service passes a tool filter to the subagent invocation. Any tool not in `allow: ['read', 'grep', 'find']` is stripped from the schema.",
            "why_this_approach": "Stripping tools from the model schema prevents hallucinated invocations and saves inference tokens.",
            "approaches_considered": "Prompt instruction (unreliable: 12% failure rate) vs Runtime error on call (wastes turns) vs Schema stripping (chosen: optimal).",
            "prior_art": "Capabilities-based security and OpenBSD `pledge(2)` system call.",
            "what_we_get_for_free": "DSH subagent provider natively supports `toolFilter` during subagent creation.",
            "from_the_docs": "AGENTS.md: 'Research role: explicit inherited-tool allowlist and tests first-call enforcement.'",
            "what_to_notice": "Notice that even if the agent hallucinates a tool call, the host gate rejects it fail-closed!",
            "concepts_to_own": "Principle of least privilege: granting an actor only the minimum capabilities necessary to perform its duty.",
            "interview_angle": "How do you enforce read-only execution in LLM tool calling? Answer: Filter tool definitions at the schema level and validate at the host gateway.",
            "decisions_alone": "You can add new read-only inspection tools (e.g. `ast_query`) to the Research allowlist safely.",
            "lesson": "Never rely on prompts for security invariants. Enforce permissions mechanically at the boundary."
        },
        "proof": [
            ("Tool filter strips mutation tools from Research role", "packages/dev-loop/roles/src/guard.ts:20-55", "direct inspection", "Current checkout"),
            ("Policy tests verify write/edit calls are rejected", "packages/dev-loop/roles/tests/research-policy.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Subagent Tool Capability Filter",
            "what": "Filters tool access based on agent role permissions.",
            "usage": "Used in `dsh-dev-loop-roles`.",
            "potential": "Can enforce sandbox security across all subagents.",
            "generic": "Works with any tool registry.",
            "evidence": "packages/dev-loop/roles/src/guard.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Restricts Research to read-only inspection tools.",
            "Strips forbidden tools from model context.",
            "Rejects unauthorized execution attempts fail-closed."
        ],
        "next_gate": "00.06c"
    },

    # 00.06c
    {
        "id": "00.06c",
        "slug": "00.06c-delegation-dispatch.md",
        "title": "Subagent Spawning with Injected Context",
        "queue": 6,
        "depends": "00.06a, 00.06b",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-roles",
        "summary_voice": "Yo! When you spawn a subagent worker, you can't just throw them into an empty room and expect miracles. You gotta inject the exact assignment brief, the piece ID, the isolated worktree CWD, and the persona prompt! Daru hooks directly into `ctx.subagents` to spawn in-process workers with custom environments. Clean process boundaries without IPC lag!",
        "opt_a": "In-process subagent spawning with scoped CWD, persona prompt, and brief injection.",
        "opt_b": "External OS process spawning that requires complex IPC sockets and serialize/deserialize overhead.",
        "scenarios": [
            ("a delegation brief targeting worktree `.worktrees/00.06c`", "delegate(brief) is called", "it spawns a subagent whose session `cwd` is locked to the worktree path."),
            ("a brief with persona prompt for 'Daru (Super Hacker)'", "delegate runs", "the subagent receives the persona prompt in Slot #1 of its instructions."),
            ("a subagent that encounters an unhandled runtime error", "subagent exits with error", "the roles service captures the exit code and records failure without crashing the host.")
        ],
        "harness_fit": "Service Provider method on `ctx.devLoopRoles` in `@deepseek-ai/dsh-dev-loop-roles/src/service.ts`.",
        "contracts": """```typescript
export interface DelegationBrief {
  readonly pieceId: string
  readonly role: DevLoopRole
  readonly assignment: string
  readonly rationale?: string
}

export interface DevLoopRoles {
  delegate(brief: DelegationBrief): Promise<SettledDelegation>
}
```""",
        "deps_text": "00.06a, 00.06b",
        "references": [
            ("packages/dev-loop/roles/src/service.ts", "1-130", "Implementation of subagent spawning and delegation"),
            ("packages/dev-loop/roles/tests/roles.spec.ts", "1-116", "Subagent lifecycle and delegation tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'records the actual child'",
            "expected": "✓ Research records the actual child, caller, assigned cwd and reported provenance"
        },
        "teach": {
            "voice_intro": "Booting up subagents is like spinning up dedicated worker threads in a game engine. Let's make it fast and clean.",
            "what_it_does": "Spawns and monitors a child subagent configured with the appropriate role, worktree directory, and brief.",
            "background": "DSH supports multiple subagent providers (spawn-in-process, fork-in-process, ACP). This gate coordinates the spawn.",
            "how_it_works": "`delegate()` resolves the worktree path via `ctx.devLoopWorktree`, applies role tool filters, builds the prompt, and awaits `ctx.subagents.spawn()`.",
            "why_this_approach": "Using native in-process subagents avoids IPC serialization bugs and provides sub-millisecond turn handover.",
            "approaches_considered": "Raw child_process fork (heavyweight memory) vs Shared in-process Cordis contexts (chosen: lightweight and shared objects).",
            "prior_art": "Actor model spawning (Erlang `spawn_link`) and Web Workers.",
            "what_we_get_for_free": "DSH `ctx.subagents` provides automatic session header inheritance and cleanup.",
            "from_the_docs": "AGENTS.md: 'Native Two-Way Brain-Worker Communication: parent calls send_message... child replies before finish.'",
            "what_to_notice": "Notice how the child's `cwd` is explicitly pointed to the worktree to ensure file tools operate in the sandbox!",
            "concepts_to_own": "Context injection: providing a child execution context with scoped permissions and targeted state.",
            "interview_angle": "How do you achieve workspace isolation in multi-agent orchestration? Answer: Configure child session working directory to point to an isolated worktree.",
            "decisions_alone": "You can change subagent model selection policies without changing the delegation brief schema.",
            "lesson": "Give your workers the exact context they need to succeed, and keep their boundaries crisp!"
        },
        "proof": [
            ("Delegation binds worktree CWD and role prompt to spawned child", "packages/dev-loop/roles/src/service.ts:35-85", "direct inspection", "Current checkout"),
            ("Delegation test passes with full child lifecycle validation", "packages/dev-loop/roles/tests/roles.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Scoped Subagent Task Dispatcher",
            "what": "Spawns role-specialized subagents in isolated workspaces.",
            "usage": "Core delegation engine in `dsh-dev-loop-roles`.",
            "potential": "Can dispatch parallel workers for documentation, testing, or linting.",
            "generic": "Works with any Cordis subagent provider.",
            "evidence": "packages/dev-loop/roles/src/service.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Spawns subagent in designated worktree CWD.",
            "Injects role prompt and brief cleanly.",
            "Returns settled outcome upon completion."
        ],
        "next_gate": "00.06d"
    },

    # 00.06d
    {
        "id": "00.06d",
        "slug": "00.06d-delegation-ledger.md",
        "title": "Durable Outcome Ledger and Provenance Tracking",
        "queue": 6,
        "depends": "00.06a, 00.06b, 00.06c",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "session projection",
        "package": "@deepseek-ai/dsh-dev-loop-roles",
        "summary_voice": "Every investigation requires a forensic ledger. When a subagent settles, its reported findings, limitations, exit status, and execution duration must be recorded permanently in the storage domain. If a system crashes, the ledger preserves the exact provenance of all delegated labor. Unrecorded work does not exist in the eyes of the law.",
        "opt_a": "Store complete settled delegation records in durable storage domain with schema validation.",
        "opt_b": "Keep delegation results in volatile memory only, losing audit trails upon host restart.",
        "scenarios": [
            ("a settled delegation with outcome text and limitations", "recordDelegation is invoked", "it writes an immutable record into `ctx.storageDomain` under the roles namespace."),
            ("a host restart occurring after delegation completion", "getDelegations(pieceId) is called on fresh instance", "it hydrates the full delegation history from storage."),
            ("a query for delegations on an unworked piece", "getDelegations('99.99') runs", "it returns an empty array without errors.")
        ],
        "harness_fit": "Session projection and durable storage backend in `@deepseek-ai/dsh-dev-loop-roles/src/records.ts` using `ctx.storageDomain`.",
        "contracts": """```typescript
export interface SettledDelegation {
  readonly delegationId: string
  readonly pieceId: string
  readonly role: DevLoopRole
  readonly status: 'completed' | 'failed' | 'aborted'
  readonly outcome: string
  readonly provenance: { kind: 'reported'; role: DevLoopRole; preset?: string }
  readonly settledAt: number
}

export interface DevLoopRoles {
  getDelegations(pieceId: string): Promise<readonly SettledDelegation[]>
}
```""",
        "deps_text": "00.06a, 00.06b, 00.06c",
        "references": [
            ("packages/dev-loop/roles/src/records.ts", "1-80", "Durable storage domain schema and records"),
            ("packages/dev-loop/roles/tests/durability.spec.ts", "1-85", "Restart and persistence tests for delegation ledger")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/roles/tests/durability.spec.ts",
            "expected": "✓ durability > persists and reloads settled delegations across restart"
        },
        "teach": {
            "voice_intro": "Evidence without provenance is inadmissible. The chain of custody must be unbroken.",
            "what_it_does": "Persists every delegation attempt, outcome, and limitation into durable storage.",
            "background": "DSH uses `ctx.storageDomain` to partition structured JSON records with schema validation.",
            "how_it_works": "When a subagent settles, `saveDelegation` serializes the record. `getDelegations` queries the storage domain by piece ID.",
            "why_this_approach": "Survives process restarts and provides an incontrovertible audit log for claim verification.",
            "approaches_considered": "Volatile memory (lost on crash) vs Append-only log file (harder to query) vs Schema-validated storage domain (chosen).",
            "prior_art": "W3C PROV-DM provenance data model and double-entry bookkeeping ledgers.",
            "what_we_get_for_free": "DSH storage domain handles atomic writes, serialization, and directory management.",
            "from_the_docs": "AGENTS.md: 'Durable state uses the session/event/projection conventions or ctx.storageDomain; it does not invent private persistence.'",
            "what_to_notice": "Notice how `provenance.kind === 'reported'` explicitly flags subagent claims as reported testimony rather than verified fact!",
            "concepts_to_own": "Provenance tracking: maintaining an auditable record of who produced an artifact, when, and under what constraints.",
            "interview_angle": "How do you track attribution and provenance in autonomous multi-agent systems? Answer: Immutable outcome ledgers distinguishing observed evidence from reported claims.",
            "decisions_alone": "You can configure retention policies for historical delegation logs in `cordis.yml`.",
            "lesson": "Document every finding permanently. Truth must survive system restarts."
        },
        "proof": [
            ("Delegation ledger writes to schema-validated storage domain", "packages/dev-loop/roles/src/records.ts:25-60", "direct inspection", "Current checkout"),
            ("Durability tests verify persistence across host restarts", "packages/dev-loop/roles/tests/durability.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Durable Task Delegation Ledger",
            "what": "Persists subagent outcomes and provenance records.",
            "usage": "Used in `dsh-dev-loop-roles`.",
            "potential": "Can track task outcomes for any agent delegation framework.",
            "generic": "Storage domain record schema can be adapted.",
            "evidence": "packages/dev-loop/roles/src/records.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Persists delegation outcomes atomically.",
            "Survives process crash and restart.",
            "Distinguishes reported testimony from direct proof."
        ],
        "next_gate": "00.08a"
    }
]
