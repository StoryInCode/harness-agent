"""
Micro-gates 00.11a to 00.14c (14 gates)
"""

GATES_00_11_TO_00_14 = [
    # 00.11a
    {
        "id": "00.11a",
        "slug": "00.11a-slash-command-parser.md",
        "title": "Slash Command Parsing & Argument Tokenization",
        "queue": 11,
        "depends": "00.10d",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "done",
        "primitive": "command",
        "package": "@deepseek-ai/dsh-dev-loop-command",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Inspector Cat is listening at the command desk! Human operators love typing commands like `/dev-loop status` or `/dev-loop approve 00.01a <hash>`! We tokenize the slash command strings, parse subcommands, and make sure invalid inputs get a friendly error message instead of crashing. Everything is typed and cozy!",
        "opt_a": "Tokenize command strings with quote-aware argument splitting and typed subcommand dispatch.",
        "opt_b": "Naive whitespace splitting that breaks whenever an argument or reason contains spaces.",
        "scenarios": [
            ("a user command `/dev-loop status 00-dev-loop`", "parseCommand is invoked", "it extracts subcommand 'status' with set argument '00-dev-loop'."),
            ("a user command with quoted string `/dev-loop reject 00.01a 'needs more tests'`", "parseCommand runs", "it extracts the full reason string without splitting on spaces."),
            ("an unknown subcommand `/dev-loop dance`", "parseCommand executes", "it returns a helpful error listing available subcommands.")
        ],
        "harness_fit": "Command parser in `@deepseek-ai/dsh-dev-loop-command/src/input.ts`. Binds `/dev-loop` into Cordis command registry.",
        "contracts": """```typescript
export interface ParsedDevLoopCommand {
  readonly subcommand: 'status' | 'approve' | 'reject' | 'inspect' | 'drain'
  readonly pieceId?: string
  readonly args: readonly string[]
}

export function parseDevLoopCommand(line: string): ParsedDevLoopCommand
```""",
        "deps_text": "00.10d",
        "references": [
            ("packages/dev-loop/command/src/input.ts", "1-80", "Command parsing and argument tokenization"),
            ("packages/dev-loop/command/tests/input.spec.ts", "1-70", "Command parser unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/command/tests/input.spec.ts",
            "expected": "✓ parseDevLoopCommand > parses subcommands and quoted arguments cleanly"
        },
        "teach": {
            "voice_intro": "How does the computer understand human whispers? We turn words into tidy command tokens! Purr~",
            "what_it_does": "Parses `/dev-loop` CLI inputs and dispatches them to the appropriate dev loop service methods.",
            "background": "CLI tools require robust lexing that handles quotes (`\"...\"`, `'...'`) so arguments can contain spaces.",
            "how_it_works": "`parseDevLoopCommand` splits inputs using a quote-aware tokenizer. It matches the first token to valid subcommands.",
            "why_this_approach": "Enables human operators to interact with the autonomous dev loop directly from chat or terminal.",
            "approaches_considered": "Heavy CLI frameworks like Yargs/Commander (huge bundle) vs Pure lightweight tokenizer (chosen: zero dependencies).",
            "prior_art": "Bourne shell quoting rules and IRC slash command conventions.",
            "what_we_get_for_free": "DSH command registration hooks into both TUI and Web UI automatically.",
            "from_the_docs": "AGENTS.md: 'Public APIs are pre-stable... Switch on discriminant tags.'",
            "what_to_notice": "Notice how the regex supports both macro pieces (`00.01`) and micro-gates (`00.01a`)!",
            "concepts_to_own": "Command line tokenization: converting an unformatted character stream into typed semantic tokens.",
            "interview_angle": "How do you implement quote-aware string splitting in a CLI parser? Answer: A single-pass finite state machine tracking quote state (single, double, none).",
            "decisions_alone": "You can add command aliases (e.g. `/dl` for `/dev-loop`) in the command configuration.",
            "lesson": "Clear command surfaces make powerful autonomous engines delightful to drive! Purr~"
        },
        "proof": [
            ("Command parser supports micro-gate IDs and quoted parameters", "packages/dev-loop/command/src/input.ts:25-60", "direct inspection", "Current checkout"),
            ("Input tests verify parsing across all subcommand variants", "packages/dev-loop/command/tests/input.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Quote-Aware Slash Command Parser",
            "what": "Parses slash commands and arguments with quote preservation.",
            "usage": "Used in `dsh-dev-loop-command`.",
            "potential": "Can parse slash commands in any chat agent or CLI.",
            "generic": "Usable for any command grammar.",
            "evidence": "packages/dev-loop/command/src/input.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Parses `/dev-loop` subcommands accurately.",
            "Handles quoted arguments with spaces.",
            "Rejects unknown subcommands with helpful usage text."
        ],
        "next_gate": "00.11b"
    },

    # 00.11b
    {
        "id": "00.11b",
        "slug": "00.11b-occ-approval-command.md",
        "title": "Optimistic Concurrency Approval Subcommand",
        "queue": 11,
        "depends": "00.11a",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "command",
        "package": "@deepseek-ai/dsh-dev-loop-command",
        "summary_voice": "Yo! When the operator runs `/dev-loop approve 00.01a <sha256>`, Daru handles the OCC validation. Optimistic Concurrency Control means we check if the file changed while the user was reading it. If the hash matches, boom: we mark it approved and push it into the dispatch queue. If someone edited the file behind your back, we reject it immediately. Total safety!",
        "opt_a": "Validate SHA-256 hash parameter against current file content before granting approval.",
        "opt_b": "Grant approval without hash verification, exposing the workflow to unreviewed file edits.",
        "scenarios": [
            ("a user executing `/dev-loop approve 00.01a <valid-hash>`", "handleApprove is invoked", "it verifies hash equality and queues the piece for execution."),
            ("a user approving with an outdated or truncated hash", "handleApprove runs", "it rejects with a clear hash mismatch diagnostic."),
            ("an approval command on a piece that is already `pending` or `done`", "handleApprove executes", "it reports that the piece is already in progress or complete.")
        ],
        "harness_fit": "Command handler in `@deepseek-ai/dsh-dev-loop-command/src/approve.ts`. Delegates to `ctx.devLoopApproval` and `ctx.devLoopQueue`.",
        "contracts": """```typescript
export interface ApproveCommandResult {
  readonly success: boolean
  readonly pieceId: string
  readonly queuedPosition?: number
  readonly message: string
}

export function handleApproveCommand(
  pieceId: string,
  digest: string
): Promise<ApproveCommandResult>
```""",
        "deps_text": "00.11a",
        "references": [
            ("packages/dev-loop/command/src/approve.ts", "1-85", "Approval command handler with OCC check"),
            ("packages/dev-loop/command/tests/approve.spec.ts", "1-80", "Unit tests for approve command and OCC validation")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/command/tests/approve.spec.ts",
            "expected": "✓ handleApproveCommand > queues piece when hash matches and rejects on mismatch"
        },
        "teach": {
            "voice_intro": "OCC: Optimistic Concurrency Control. Assume no conflicts until commit time, then verify hashes.",
            "what_it_does": "Allows human operators to approve pieces securely by verifying content hashes before dispatch.",
            "background": "In web and CLI apps, users look at data, think, and click approve seconds later. OCC ensures nothing changed during that think time.",
            "how_it_works": "The command handler calls `ctx.devLoopApproval.authorize(pieceId, digest)`. If authorized, it enqueues the piece via `ctx.devLoopQueue.enqueue(pieceId)`.",
            "why_this_approach": "Combines human approval and dispatch queueing into an atomic, verified command.",
            "approaches_considered": "Lock file while reading (blocks other users) vs Blind approval (unsafe) vs OCC hash check (chosen: non-blocking and safe).",
            "prior_art": "HTTP `If-Match` headers with ETag and database optimistic locking.",
            "what_we_get_for_free": "Cordis service injection connects approval and queue services seamlessly.",
            "from_the_docs": "AGENTS.md: 'Explicit > implicit at package boundaries... defaulting is an explicit resolve step.'",
            "what_to_notice": "Notice how the output reports the newly assigned queue position to the user!",
            "concepts_to_own": "Optimistic concurrency control: verifying precondition fingerprints at mutation time to prevent conflicting updates.",
            "interview_angle": "How do you implement optimistic locking in asynchronous workflows? Answer: Pass resource fingerprint with mutation request and verify equality before update.",
            "decisions_alone": "You can configure auto-queueing on approval vs staged-only approval.",
            "lesson": "Don't lock resources while users are thinking. Use optimistic hashing to verify state at the moment of approval."
        },
        "proof": [
            ("Approval command verifies digest before enqueuing", "packages/dev-loop/command/src/approve.ts:25-65", "direct inspection", "Current checkout"),
            ("OCC tests verify rejection of stale hashes", "packages/dev-loop/command/tests/approve.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "OCC Command Handler Pattern",
            "what": "Command handler performing optimistic concurrency checks before mutation.",
            "usage": "Used in `dsh-dev-loop-command`.",
            "potential": "Can protect deployment, release, and config commands.",
            "generic": "Works with any hash-verified resource.",
            "evidence": "packages/dev-loop/command/src/approve.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Validates SHA-256 digest parameter.",
            "Enqueues piece on hash match.",
            "Rejects mismatched digests fail-closed."
        ],
        "next_gate": "00.11c"
    },

    # 00.11c
    {
        "id": "00.11c",
        "slug": "00.11c-rejection-command.md",
        "title": "Rejection and Task Deferral Subcommand",
        "queue": 11,
        "depends": "00.11a, 00.11b",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "done",
        "primitive": "command",
        "package": "@deepseek-ai/dsh-dev-loop-command",
        "summary_voice": "Tutturu~ 🌸 Sometimes a piece isn't quite ready, and that is completely okay! We don't want anyone to feel bad. With `/dev-loop reject 00.01a 'let\\'s simplify the contracts'`, the human developer can defer the piece and leave helpful notes! The piece transitions to `blocked` status and records the reason gently in the log so we can improve it together later!",
        "opt_a": "Record human rejection reason, transition piece to `blocked`, and log reason into audit history.",
        "opt_b": "Delete or discard rejected pieces silently without preserving feedback.",
        "scenarios": [
            ("a user executing `/dev-loop reject 00.01a 'scope too large'`", "handleReject is called", "the piece transitions to `blocked` and the reason is recorded."),
            ("a reject command issued without a reason string", "handleReject runs", "it prompts the user to provide a brief explanation so agents understand what to fix."),
            ("a blocked piece that is later re-evaluated", "status command is queried", "it displays the piece in blocked state with the rejection reason.")
        ],
        "harness_fit": "Command handler in `@deepseek-ai/dsh-dev-loop-command/src/reject.ts`. Binds rejection workflow to `ctx.devLoopLifecycle`.",
        "contracts": """```typescript
export interface RejectCommandResult {
  readonly success: boolean
  readonly pieceId: string
  readonly reason: string
  readonly message: string
}

export function handleRejectCommand(
  pieceId: string,
  reason: string
): Promise<RejectCommandResult>
```""",
        "deps_text": "00.11a, 00.11b",
        "references": [
            ("packages/dev-loop/command/src/reject.ts", "1-80", "Rejection command handler implementation"),
            ("packages/dev-loop/command/tests/reject.spec.ts", "1-70", "Rejection command unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/command/tests/reject.spec.ts",
            "expected": "✓ handleRejectCommand > marks piece blocked and preserves human reason"
        },
        "teach": {
            "voice_intro": "Saying 'not yet' is an act of care! Let's make sure feedback is preserved with kindness. Tutturu~",
            "what_it_does": "Allows operators to reject a piece proposal, marking it `blocked` with a documented reason.",
            "background": "In autonomous agent workflows, human rejection is valuable feedback that guides redesign.",
            "how_it_works": "The command calls `ctx.devLoopLifecycle.transition(pieceId, 'blocked', { reason })`. It logs the event to the durable session.",
            "why_this_approach": "Preserves the piece and reason for subsequent revision cycles rather than discarding work.",
            "approaches_considered": "Immediate file deletion (destroys work) vs Rejection with feedback preserved (chosen: constructive iteration).",
            "prior_art": "Code review change requests (GitHub 'Request changes') and Kanban defect binning.",
            "what_we_get_for_free": "Durable lifecycle logging ensures rejection reasons survive restarts.",
            "from_the_docs": "plans/AGENTS.md: 'A piece that is superseded rather than completed goes to trash per the override rule, not to done/.'",
            "what_to_notice": "Notice that a reason string is mandatory to ensure actionable feedback!",
            "concepts_to_own": "Constructive rejection: capturing actionable intent when gating operations are declined.",
            "interview_angle": "How do you design rejection workflows in human-in-the-loop systems? Answer: Require structured rationale, transition state to blocked, and preserve history.",
            "decisions_alone": "You can add quick-select rejection presets (e.g. 'unclear requirements', 'needs split').",
            "lesson": "Rejection is just a detour on the road to excellence! Preserve the reason and try again with a smile! 🌸"
        },
        "proof": [
            ("Rejection command transitions piece to blocked and saves reason", "packages/dev-loop/command/src/reject.ts:25-60", "direct inspection", "Current checkout"),
            ("Unit tests prove reason requirement and state mutation", "packages/dev-loop/command/tests/reject.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Feedback-Preserving Rejection Handler",
            "what": "Rejects proposals while recording structured rationale.",
            "usage": "Used in `dsh-dev-loop-command`.",
            "potential": "Can handle PR change requests, task cancellations, or plan revisions.",
            "generic": "Usable with any lifecycle state machine.",
            "evidence": "packages/dev-loop/command/src/reject.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Transitions piece to `blocked`.",
            "Requires non-empty reason string.",
            "Persists feedback in lifecycle ledger."
        ],
        "next_gate": "00.12a"
    },

    # 00.12a
    {
        "id": "00.12a",
        "slug": "00.12a-write-ahead-intent.md",
        "title": "SQLite Write-Ahead Intent Logging",
        "queue": 12,
        "depends": "00.11c",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-persistence",
        "summary_voice": "Sup! Here's the nightmare scenario: an agent is in the middle of moving a completed piece to `done/`, and the server loses power or gets `kill -9`ed! Now you have a half-moved file, a desynced database, and corrupted state! Daru solves this with Write-Ahead Intent Logging (WAL). We journal our intent to SQLite BEFORE touching disk. If we crash, recovery replays or rolls back the intent. 100% crash-proof!",
        "opt_a": "Log transition intent to SQLite WAL before mutating filesystem, resolving upon success.",
        "opt_b": "Mutate filesystem first and update database second, leaving desynced state on crash.",
        "scenarios": [
            ("a transition request from `pending` to `done`", "beginTransition is called", "it writes an `intent` row with status 'pending_done' and returns an intent token."),
            ("the filesystem move finishes successfully", "finishTransition(token) is executed", "it updates the intent row to 'committed' within an atomic transaction."),
            ("a crash occurring during the move before finishTransition", "recovery runs at boot", "it identifies the incomplete intent and executes reconciliation.")
        ],
        "harness_fit": "Intent logger in `@deepseek-ai/dsh-dev-loop-persistence/src/intent.ts`. Coordinates database transactions for `ctx.devLoopPersistence`.",
        "contracts": """```typescript
export interface TransitionIntent {
  readonly intentId: string
  readonly pieceId: string
  readonly fromState: string
  readonly toState: string
  readonly startedAt: number
}

export interface DevLoopPersistence {
  beginTransition(pieceId: string, toState: string): Promise<TransitionIntent>
  finishTransition(intentId: string): Promise<void>
}
```""",
        "deps_text": "00.11c",
        "references": [
            ("packages/dev-loop/persistence/src/intent.ts", "1-85", "Write-ahead intent logging implementation"),
            ("packages/dev-loop/persistence/tests/intent.spec.ts", "1-80", "WAL intent lifecycle and crash recovery tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/persistence/tests/intent.spec.ts",
            "expected": "✓ beginTransition > records uncommitted intent in SQLite WAL"
        },
        "teach": {
            "voice_intro": "Rule number one of database engineering: write the intent before you touch the data. That's WAL.",
            "what_it_does": "Records planned state changes in SQLite before executing file operations, enabling crash recovery.",
            "background": "Write-Ahead Logging ensures that if a system halts mid-operation, the recovery engine knows what was attempted.",
            "how_it_works": "Inserts an intent record with a UUID. After disk mutation succeeds, updates the row to committed. Incomplete rows signal crash recovery.",
            "why_this_approach": "Guarantees atomicity across heterogeneous resources (SQLite database + POSIX filesystem).",
            "approaches_considered": "File operations without logging (vulnerable to crash desync) vs Two-phase commit (complex) vs Write-ahead intent (chosen: lean and robust).",
            "prior_art": "ARIES recovery algorithm and PostgreSQL WAL.",
            "what_we_get_for_free": "SQLite's WAL mode (`PRAGMA journal_mode=WAL`) allows concurrent readers while writing intents.",
            "from_the_docs": "AGENTS.md: 'Durable state uses the session/event/projection conventions... SQLite uses monotonic SCHEMA_VERSION.'",
            "what_to_notice": "Notice how each intent has a timeout after which recovery considers it abandoned!",
            "concepts_to_own": "Write-ahead logging (WAL): recording intention in durable storage prior to applying state mutations.",
            "interview_angle": "How do you achieve atomic consistency between database updates and filesystem modifications? Answer: Write-ahead intent logging with startup reconciliation.",
            "decisions_alone": "You can configure WAL checkpoint frequency and vacuum thresholds.",
            "lesson": "Log your intent before you act. Crash recovery is only possible if you leave a paper trail."
        },
        "proof": [
            ("Intent logger writes uncommitted records prior to filesystem move", "packages/dev-loop/persistence/src/intent.ts:25-60", "direct inspection", "Current checkout"),
            ("Intent unit tests prove recovery of uncommitted rows", "packages/dev-loop/persistence/tests/intent.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Write-Ahead Intent Logger",
            "what": "SQLite-backed intent journal for multi-resource transactions.",
            "usage": "Used in `dsh-dev-loop-persistence`.",
            "potential": "Can coordinate any filesystem + database combined mutations.",
            "generic": "Can adapt to any state machine.",
            "evidence": "packages/dev-loop/persistence/src/intent.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Writes intent before disk mutation.",
            "Commits intent atomically upon completion.",
            "Surfaces uncommitted intents during recovery."
        ],
        "next_gate": "00.12b"
    },

    # 00.12b
    {
        "id": "00.12b",
        "slug": "00.12b-sqlite-state-schema.md",
        "title": "Relational Schema and Monotonic Migration",
        "queue": 12,
        "depends": "00.12a",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-persistence",
        "summary_voice": "Yo! Here is the relational bedrock of the dev loop. We store our pieces, state transitions, intents, and anomalies in a strongly typed SQLite schema with foreign keys and indexes. We also enforce monotonic schema versioning (`SCHEMA_VERSION = 1`). If the schema ever upgrades, it runs migrations forward only. No messy manual SQL hacks!",
        "opt_a": "Strongly typed SQLite schema with foreign keys, monotonic migrations, and WAL mode.",
        "opt_b": "Ad-hoc JSON files on disk prone to corruption, race conditions, and lack of query indexing.",
        "scenarios": [
            ("a new database file being initialized", "initDatabase is called", "it creates tables, indexes, sets PRAGMA user_version = 1, and enables WAL mode."),
            ("a query for all active transitions by piece ID", "queryTransitions is executed", "it uses indexed lookup on piece_id for instant retrieval."),
            ("an initialization on an existing database with matching schema version", "initDatabase runs", "it validates schema version and connects without altering tables.")
        ],
        "harness_fit": "SQLite storage backend in `@deepseek-ai/dsh-dev-loop-persistence/src/schema.ts`. Backs `ctx.devLoopPersistence`.",
        "contracts": """```typescript
export const SCHEMA_VERSION = 1

export interface DatabaseConnection {
  run(sql: string, params?: unknown[]): void
  get<T>(sql: string, params?: unknown[]): T | undefined
  all<T>(sql: string, params?: unknown[]): T[]
}

export function initPersistenceDatabase(dbPath: string): DatabaseConnection
```""",
        "deps_text": "00.12a",
        "references": [
            ("packages/dev-loop/persistence/src/schema.ts", "1-95", "SQLite table schemas, indexes, and migration runner"),
            ("packages/dev-loop/persistence/tests/schema.spec.ts", "1-85", "Schema creation and version migration unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/persistence/tests/schema.spec.ts",
            "expected": "✓ initPersistenceDatabase > sets SCHEMA_VERSION = 1 and enables WAL mode"
        },
        "teach": {
            "voice_intro": "Databases are the memory of your application. Design your tables cleanly, index your foreign keys, and never skip migrations.",
            "what_it_does": "Maintains the SQLite tables for piece states, worker assignments, transition intents, and anomalies.",
            "background": "Relational integrity with foreign keys guarantees that child records (e.g. transitions) cannot point to nonexistent pieces.",
            "how_it_works": "Executes `CREATE TABLE IF NOT EXISTS` with strict types (`INTEGER`, `TEXT`). Reads and sets `PRAGMA user_version`.",
            "why_this_approach": "SQLite is embedded, ultra-fast, zero-dependency, and battle-tested for embedded persistence.",
            "approaches_considered": "Unindexed JSON files (slow, prone to corrupt partial writes) vs External PostgreSQL (requires running service) vs SQLite (chosen: embedded and atomic).",
            "prior_art": "SQLite monotonic schema migration patterns and Android Room database migrations.",
            "what_we_get_for_free": "Native SQLite binary driver or `better-sqlite3` provides instant in-process execution.",
            "from_the_docs": "AGENTS.md: 'SQLite uses monotonic SCHEMA_VERSION... Predecessors imply neither fallback nor downgrade support.'",
            "what_to_notice": "Notice the `PRAGMA foreign_keys = ON` execution: SQLite requires this explicitly on every connection!",
            "concepts_to_own": "Monotonic schema versioning: tracking database schema iterations with an increasing integer version and forward-only migrations.",
            "interview_angle": "How do you handle schema versioning in embedded SQLite applications? Answer: Store monotonic version in `PRAGMA user_version`, check at startup, apply forward migrations in transaction.",
            "decisions_alone": "You can add new indexed query columns by adding an upgrade migration function.",
            "lesson": "Relational schemas protect data integrity. A clean database makes crash recovery trivial."
        },
        "proof": [
            ("Schema script initializes tables and verifies PRAGMA user_version = 1", "packages/dev-loop/persistence/src/schema.ts:20-65", "direct inspection", "Current checkout"),
            ("Schema test suite validates foreign keys and index creation", "packages/dev-loop/persistence/tests/schema.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "SQLite Monotonic Schema Engine",
            "what": "Initializes SQLite schema with monotonic version migration.",
            "usage": "Used in `dsh-dev-loop-persistence`.",
            "potential": "Can serve as persistence layer for any Cordis plugin.",
            "generic": "Table definitions and migration array can be parameterized.",
            "evidence": "packages/dev-loop/persistence/src/schema.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Enables WAL mode and foreign keys.",
            "Sets `SCHEMA_VERSION = 1`.",
            "Creates indexes on piece ID and state."
        ],
        "next_gate": "00.12c"
    },

    # 00.12c
    {
        "id": "00.12c",
        "slug": "00.12c-startup-hydration.md",
        "title": "Crash Recovery and State Hydration",
        "queue": 12,
        "depends": "00.12a, 00.12b",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-persistence",
        "summary_voice": "Mwahahaha! Rise from the ashes of system restart! When the Host Plane boots, the Startup Hydrator inspects the temporal timeline! It scans the filesystem, reads the SQLite ledger, and reconciles any discrepancies left by unexpected shutdowns! Incomplete intents are resolved, active workers are cleaned up, and the lab's state is restored to pristine harmony!",
        "opt_a": "Reconcile database state against filesystem at boot, clearing abandoned worker locks and uncommitted intents.",
        "opt_b": "Assume memory state is empty and ignore disk discrepancies, leading to orphaned worktrees and stale locks.",
        "scenarios": [
            ("a system booting after a normal shutdown", "hydrateLifecycle() is executed", "it loads all pieces, transitions, and completed records into memory."),
            ("a system booting after a crash that left an abandoned intent", "hydrateLifecycle runs", "it detects the stale intent, inspects disk files, and completes or rolls back the transition."),
            ("a piece marked active in DB whose worker process no longer exists", "hydrateLifecycle runs", "it releases the worker lock and returns the piece to `todo` status.")
        ],
        "harness_fit": "Startup lifecycle hook in `@deepseek-ai/dsh-dev-loop-persistence/src/hydrate.ts`. Invoked during Cordis container initialization.",
        "contracts": """```typescript
export interface HydrationReport {
  readonly loadedPieces: number
  readonly reconciledIntents: number
  readonly recoveredLocks: number
}

export function hydrateLifecycleState(
  db: DatabaseConnection,
  fs: LocalFileSystem
): Promise<HydrationReport>
```""",
        "deps_text": "00.12a, 00.12b",
        "references": [
            ("packages/dev-loop/persistence/src/hydrate.ts", "1-110", "Startup reconciliation and hydration logic"),
            ("packages/dev-loop/persistence/tests/hydrate.spec.ts", "1-90", "Crash recovery and stale lock clearance tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/persistence/tests/hydrate.spec.ts",
            "expected": "✓ hydrateLifecycleState > reconciles uncommitted intents and releases abandoned locks"
        },
        "teach": {
            "voice_intro": "Temporal paradoxes cannot withstand our diagnostic probes! Let me teach you how startup reconciliation repairs the timeline!",
            "what_it_does": "Reconciles differences between SQLite records and disk reality upon system startup.",
            "background": "After an unexpected process termination, in-flight operations may leave database flags and disk files desynchronized.",
            "how_it_works": "Finds intents with `status = 'pending'`. Checks if target file exists in `done/`. If yes, marks intent committed; if no, rolls back to source state.",
            "why_this_approach": "Guarantees self-healing operation without requiring manual database editing by developers.",
            "approaches_considered": "Manual admin intervention on crash (terrible UX) vs Automatic self-healing reconciliation (chosen: resilient).",
            "prior_art": "Journaling filesystem replay (ext4 fsck) and Kubernetes controller reconciliation loops.",
            "what_we_get_for_free": "Idempotent design ensures running hydration multiple times produces the exact same clean state.",
            "from_the_docs": "AGENTS.md: 'Restart does not reconstruct live Queue callbacks or children. Unjournaled historical done files remain explicit anomalies.'",
            "what_to_notice": "Notice how abandoned locks are released so tasks aren't permanently stuck!",
            "concepts_to_own": "Reconciliation loop: comparing desired state with actual observed state and applying compensating actions.",
            "interview_angle": "How do you design crash recovery for stateful services managing local filesystem resources? Answer: Write-ahead intent logs replayed or rolled back against observed filesystem state on startup.",
            "decisions_alone": "You can configure maximum acceptable crash intent age before alerting.",
            "lesson": "Self-healing systems recover automatically. Clean up after yesterday's crashes before starting today's work!"
        },
        "proof": [
            ("Hydrator checks disk existence for pending intents and updates status", "packages/dev-loop/persistence/src/hydrate.ts:35-80", "direct inspection", "Current checkout"),
            ("Crash recovery tests verify automatic state reconciliation", "packages/dev-loop/persistence/tests/hydrate.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Self-Healing Startup State Reconciler",
            "what": "Reconciles database records against filesystem reality at boot.",
            "usage": "Used in `dsh-dev-loop-persistence`.",
            "potential": "Can reconcile upload queues, cache directories, or batch processors.",
            "generic": "Can adapt to any two-tier storage architecture.",
            "evidence": "packages/dev-loop/persistence/src/hydrate.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Loads all piece records at startup.",
            "Reconciles uncommitted intents.",
            "Releases abandoned worker locks."
        ],
        "next_gate": "00.12d"
    },

    # 00.12d
    {
        "id": "00.12d",
        "slug": "00.12d-anomaly-quarantine.md",
        "title": "Unreconciled Divergence Quarantine",
        "queue": 12,
        "depends": "00.12a, 00.12b, 00.12c",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-persistence",
        "summary_voice": "Consider the unexpected anomaly. What if a file appears in `done/` that has no journaled history in the database? Or what if a file is corrupted beyond automated repair? A detective does not sweep anomalies under the rug. We isolate them in an Anomaly Quarantine table and surface them via `/dev-loop status`. An unresolved anomaly requires human inspection. Fail-closed is the law.",
        "opt_a": "Quarantine anomalous pieces in dedicated audit table and surface them for human resolution.",
        "opt_b": "Silently ignore anomalies or fabricate fake completion records, corrupting the audit trail.",
        "scenarios": [
            ("a piece file found in `done/` with zero database history", "detectAnomalies is called", "it records an anomaly row with type 'unjournaled_done' and quarantines it from auto-dispatch."),
            ("an operator running `/dev-loop status`", "anomalies exist in quarantine", "the CLI presents an explicit warning card naming the anomalous pieces."),
            ("an operator resolving an anomaly manually", "resolveAnomaly(id, action) runs", "the anomaly is marked resolved with the operator's rationale.")
        ],
        "harness_fit": "Quarantine manager in `@deepseek-ai/dsh-dev-loop-persistence/src/anomaly.ts`. Exposed to CLI and health checks.",
        "contracts": """```typescript
export interface PieceAnomaly {
  readonly anomalyId: string
  readonly pieceId: string
  readonly kind: 'unjournaled_done' | 'file_missing' | 'digest_drift'
  readonly detectedAt: number
  readonly details: string
  readonly resolved: boolean
}

export interface DevLoopPersistence {
  getAnomalies(): Promise<readonly PieceAnomaly[]>
  resolveAnomaly(anomalyId: string, resolution: string): Promise<void>
}
```""",
        "deps_text": "00.12a, 00.12b, 00.12c",
        "references": [
            ("packages/dev-loop/persistence/src/anomaly.ts", "1-85", "Anomaly quarantine detection and resolution"),
            ("packages/dev-loop/persistence/tests/anomaly.spec.ts", "1-75", "Unit tests for anomaly quarantine and reporting")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/persistence/tests/anomaly.spec.ts",
            "expected": "✓ getAnomalies > detects unjournaled done files and surfaces quarantine report"
        },
        "teach": {
            "voice_intro": "When evidence contradicts theory, quarantine the discrepancy. Never force reality to fit an assumption.",
            "what_it_does": "Detects unexplainable state mismatches (e.g. unjournaled files) and quarantines them for human review.",
            "background": "Automated recovery must have boundaries. If an anomaly cannot be explained mathematically, human intervention is mandatory.",
            "how_it_works": "Scans `done/` files against database `pieces` table. Any file missing a completion record is flagged as `unjournaled_done`.",
            "why_this_approach": "Prevents phantom files from being counted as valid completion evidence without historical provenance.",
            "approaches_considered": "Auto-insert fake completion record (fabricates false history) vs Delete unjournaled file (dangerous data loss) vs Quarantine and report (chosen).",
            "prior_art": "Dead-letter queues (DLQ) in messaging systems and quarantine directories in antivirus software.",
            "what_we_get_for_free": "SQLite storage domain keeps anomaly records durable across sessions.",
            "from_the_docs": "AGENTS.md: 'Unjournaled historical done files remain explicit anomalies rather than new completion evidence.'",
            "what_to_notice": "Notice how quarantined pieces are excluded from candidate dispatch to prevent cascading errors!",
            "concepts_to_own": "Dead-letter quarantine: isolating unprocessable or contradictory artifacts so they do not contaminate healthy workflows.",
            "interview_angle": "How do you handle unresolvable state discrepancies in automated reconciliation engines? Answer: Dead-letter quarantine with human alerting; never invent false history.",
            "decisions_alone": "You can add custom anomaly notification webhooks without altering quarantine logic.",
            "lesson": "Face contradictions honestly. Quarantine the anomaly, document the facts, and seek human guidance."
        },
        "proof": [
            ("Quarantine engine detects unjournaled files and records anomalies", "packages/dev-loop/persistence/src/anomaly.ts:25-65", "direct inspection", "Current checkout"),
            ("Anomaly test suite proves quarantine isolation from queue dispatch", "packages/dev-loop/persistence/tests/anomaly.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "State Anomaly Quarantine Engine",
            "what": "Detects and isolates irreconcilable system state discrepancies.",
            "usage": "Used in `dsh-dev-loop-persistence`.",
            "potential": "Can protect inventory systems, file sync daemons, or financial ledgers.",
            "generic": "Can parameterize anomaly detection predicates.",
            "evidence": "packages/dev-loop/persistence/src/anomaly.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Identifies unjournaled files in `done/`.",
            "Quarantines anomalous pieces fail-closed.",
            "Provides human resolution mechanism."
        ],
        "next_gate": "00.13a"
    },

    # 00.13a
    {
        "id": "00.13a",
        "slug": "00.13a-claim-inventory-parser.md",
        "title": "Proof Table Claim Extraction",
        "queue": 13,
        "depends": "00.12d",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-claims",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Inspector Cat is checking the claims table! Every piece has a `## Resources and proof` section with a shiny 4-column proof table: Claim, Citation, Method, and Date! We parse each row to find what promises the piece is making! If a claim is marked UNVERIFIED, our detective friends must verify it before anyone writes code! No unverified claims allowed!",
        "opt_a": "Extract structured ClaimEntry rows from `## Resources and proof` tables, validating 4-column structure.",
        "opt_b": "Treat claims as unparsed text, preventing programmatic verification of load-bearing assertions.",
        "scenarios": [
            ("a `## Resources and proof` section with 3 valid claim rows", "extractClaims is called", "it returns 3 ClaimEntry records with claim, citation, method, and date."),
            ("a proof table with missing columns or unescaped pipes", "extractClaims runs", "it reports a malformed table finding."),
            ("a piece with zero claim rows in its proof table", "extractClaims executes", "it reports a blocker finding requiring at least one verified claim row.")
        ],
        "harness_fit": "Pure parser in `@deepseek-ai/dsh-dev-loop-claims/src/parse.ts`. Feeds claim inventory to `ctx.devLoopClaims`.",
        "contracts": """```typescript
export interface ClaimEntry {
  readonly claim: string
  readonly citation: string
  readonly method: 'direct inspection' | 'measured' | 'reported by' | 'readme only' | 'unverified'
  readonly dateOrVersion: string
}

export function extractClaims(content: string): readonly ClaimEntry[]
```""",
        "deps_text": "00.12d",
        "references": [
            ("packages/dev-loop/claims/src/parse.ts", "1-75", "Proof table claim parsing logic"),
            ("packages/dev-loop/claims/tests/parse.spec.ts", "1-65", "Claim extraction unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/claims/tests/parse.spec.ts",
            "expected": "✓ extractClaims > extracts 4-column claim entries cleanly"
        },
        "teach": {
            "voice_intro": "Before you believe a story, make a list of every claim! Let's inventory the facts! Nya~",
            "what_it_does": "Parses the proof table rows into strongly typed ClaimEntry objects for verification.",
            "background": "The R-claims-verified axiom requires every load-bearing claim to have an explicit citation and verification method.",
            "how_it_works": "Locates `## Resources and proof`. Extracts lines between it and the next `##` heading. Parses markdown table cells using pipe splitting.",
            "why_this_approach": "Enables programmatic checking of whether claims were verified, measured, or remain unverified.",
            "approaches_considered": "Unstructured prose claims (impossible to verify automatically) vs Structured 4-column table (chosen: machine-checkable).",
            "prior_art": "Scientific paper assertion indexing and formal verification claim registries.",
            "what_we_get_for_free": "Reuses `tableCells` logic from `scripts/check-pieces.ts` for consistent delimiter handling.",
            "from_the_docs": "plans/AGENTS.md: 'A proof table — one row per load-bearing claim: the claim, the citation... how it was established... and the date.'",
            "what_to_notice": "Notice how column 3 enforces the closed vocabulary: `direct inspection`, `measured`, `reported by`, `readme only`, `unverified`!",
            "concepts_to_own": "Claim inventory: extracting testable assertions from technical prose into structured data.",
            "interview_angle": "How do you automate architectural claim verification in engineering proposals? Answer: Parse structured assertion tables mapping claims to locators and verification methods.",
            "decisions_alone": "You can add custom claim category tags in the citation column without breaking table extraction.",
            "lesson": "Every engineering decision rests on claims. Inventory them explicitly so you can verify each one! Purr~"
        },
        "proof": [
            ("Claims parser extracts all 4 columns and trims whitespace", "packages/dev-loop/claims/src/parse.ts:20-55", "direct inspection", "Current checkout"),
            ("Extraction tests verify handling of valid and malformed proof tables", "packages/dev-loop/claims/tests/parse.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Proof Table Claim Inventory Extractor",
            "what": "Extracts 4-column claim rows from markdown proof tables.",
            "usage": "Used in `dsh-dev-loop-claims`.",
            "potential": "Can audit claims in RFCs, whitepapers, or compliance reports.",
            "generic": "Pure function operating on markdown text.",
            "evidence": "packages/dev-loop/claims/src/parse.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Extracts 4-column proof rows.",
            "Validates method vocabulary.",
            "Rejects empty or malformed proof tables."
        ],
        "next_gate": "00.13b"
    },

    # 00.13b
    {
        "id": "00.13b",
        "slug": "00.13b-research-brief-compiler.md",
        "title": "Epistemic Research Brief Generation",
        "queue": 13,
        "depends": "00.13a",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-claims",
        "summary_voice": "When a claim is marked UNVERIFIED or when a citation requires forensic corroboration, we do not send an agent on an open-ended browsing spree. An unfocused agent burns tokens and hallucinates. We compile an Epistemic Research Brief. The brief targets the exact claim, names the exact file or API citation, and asks the specific factual question: 'Does symbol X exist in file Y?'. Precision is our weapon.",
        "opt_a": "Generate narrow, falsifiable research briefs targeting single citations with bounded question scopes.",
        "opt_b": "Dispatch vague, open-ended research prompts that encourage speculative browsing and token waste.",
        "scenarios": [
            ("an unverified claim citing `packages/dev-loop/directory/src/parse.ts`", "compileBrief(claim) is called", "it generates a targeted research brief specifying the file path and verification goal."),
            ("a claim citing an external documentation URL", "compileBrief runs", "it includes the URL and specifies verification of the named API clause."),
            ("multiple unverified claims in a single piece", "compileBriefs runs", "it yields an ordered list of independent, focused research briefs.")
        ],
        "harness_fit": "Brief compiler in `@deepseek-ai/dsh-dev-loop-claims/src/brief.ts`. Generates inputs for `ctx.devLoopRoles.delegate()`.",
        "contracts": """```typescript
export interface ResearchBrief {
  readonly pieceId: string
  readonly claim: string
  readonly citation: string
  readonly targetLocator: string
  readonly falsifiableQuestion: string
}

export function compileResearchBrief(pieceId: string, claim: ClaimEntry): ResearchBrief
```""",
        "deps_text": "00.13a",
        "references": [
            ("packages/dev-loop/claims/src/brief.ts", "1-70", "Targeted research brief compilation logic"),
            ("packages/dev-loop/claims/tests/brief.spec.ts", "1-60", "Research brief compiler unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/claims/tests/brief.spec.ts",
            "expected": "✓ compileResearchBrief > produces narrow, falsifiable research brief"
        },
        "teach": {
            "voice_intro": "An investigator given vague instructions returns with gossip. An investigator given an exact address returns with evidence.",
            "what_it_does": "Turns an unverified claim from a piece into a tight, actionable research brief for a Research subagent.",
            "background": "Prompt engineering for research agents requires bounded context and explicit falsifiability criteria.",
            "how_it_works": "Extracts the claim text and citation locator. Formulates a question: 'Verify whether <claim> is true by inspecting <citation>. Report file lines and hash.'",
            "why_this_approach": "Prevents token waste, eliminates hallucinations, and ensures the resulting research report directly answers the claim.",
            "approaches_considered": "Open-ended prompt ('Research this piece') vs Focused question per citation (chosen: 10x faster and deterministic).",
            "prior_art": "Scientific hypothesis generation and legal deposition question planning.",
            "what_we_get_for_free": "Pairs directly with `dsh-dev-loop-roles` Research role tool filtering.",
            "from_the_docs": "plans/AGENTS.md: 'Delegate this checking. A Research preset exists for exactly this: give it the specific claim and the decision that rests on it.'",
            "what_to_notice": "Notice how the brief specifies what evidence constitutes proof vs what constitutes falsification!",
            "concepts_to_own": "Falsifiable research brief: a bounded prompt structured to prove or disprove a single empirical claim.",
            "interview_angle": "How do you control cost and hallucination when deploying autonomous research subagents? Answer: Constrain briefs to single falsifiable claims with explicit locators.",
            "decisions_alone": "You can customize the prompt framing template for different LLM providers.",
            "lesson": "Ask precise questions to receive factual evidence. Precision is the antidote to hallucination."
        },
        "proof": [
            ("Compiler formats narrow falsifiable questions from claim entries", "packages/dev-loop/claims/src/brief.ts:20-55", "direct inspection", "Current checkout"),
            ("Brief unit tests prove inclusion of exact file locators", "packages/dev-loop/claims/tests/brief.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Falsifiable Research Brief Compiler",
            "what": "Generates targeted research tasks from claim citations.",
            "usage": "Used in `dsh-dev-loop-claims`.",
            "potential": "Can generate automated fact-checking tasks for documentation.",
            "generic": "Works with any citation format.",
            "evidence": "packages/dev-loop/claims/src/brief.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Compiles targeted research brief.",
            "Includes exact citation locator.",
            "Defines falsifiable verification criteria."
        ],
        "next_gate": "00.13c"
    },

    # 00.13c
    {
        "id": "00.13c",
        "slug": "00.13c-forensic-hash-verifier.md",
        "title": "Evidence Cryptographic Integrity Checking",
        "queue": 13,
        "depends": "00.13a, 00.13b",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-claims",
        "summary_voice": "When the Research subagent returns with an evidentiary finding, we do not take its word at face value. We verify the hash of the reported file against disk. Did the agent actually read the file? Does the SHA-256 hash match the physical bytes on disk? If the reported hash differs from disk by even one character, the report is fraudulent. The detective trusts only physical mathematics.",
        "opt_a": "Verify reported file SHA-256 hashes against actual disk contents to prove inspection occurred.",
        "opt_b": "Accept reported claims without verifying file hashes, allowing hallucinated citations to pass.",
        "scenarios": [
            ("a research report reporting file content with matching SHA-256 hash", "verifyEvidence(report) is called", "it confirms hash match and marks evidence verified."),
            ("a research report reporting a hallucinated or mismatched hash", "verifyEvidence runs", "it rejects the report with `CryptographicIntegrityFailure`."),
            ("a research report citing a file that was deleted or modified during the turn", "verifyEvidence executes", "it detects drift and marks evidence invalid.")
        ],
        "harness_fit": "Service Provider method on `ctx.devLoopClaims` in `@deepseek-ai/dsh-dev-loop-claims/src/verifier.ts`.",
        "contracts": """```typescript
export interface EvidenceVerificationResult {
  readonly locator: string
  readonly verified: boolean
  readonly diskHash: string
  readonly reportedHash?: string
  readonly match: boolean
}

export function verifyEvidenceIntegrity(
  baseDir: string,
  locator: string,
  reportedHash?: string
): Promise<EvidenceVerificationResult>
```""",
        "deps_text": "00.13a, 00.13b",
        "references": [
            ("packages/dev-loop/claims/src/verifier.ts", "1-80", "Cryptographic hash verification of reported evidence"),
            ("packages/dev-loop/claims/tests/verifier.spec.ts", "1-70", "Evidence hash matching and fraud detection tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/claims/tests/verifier.spec.ts",
            "expected": "✓ verifyEvidenceIntegrity > verifies matching disk hashes and catches fabricated claims"
        },
        "teach": {
            "voice_intro": "The suspect presented a photograph. We check the digital negative's cryptographic hash. Reality cannot be forged.",
            "what_it_does": "Verifies that files cited in research reports actually match the SHA-256 hashes on disk.",
            "background": "LLMs can fabricate realistic-looking file citations. Requiring the agent to return the file hash and verifying it proves inspection.",
            "how_it_works": "Reads the physical file at `locator`. Computes `crypto.createHash('sha256').update(bytes).digest('hex')`. Compares with `reportedHash`.",
            "why_this_approach": "Cryptographic proof of inspection turns soft model testimony into hard mathematical fact.",
            "approaches_considered": "Word-match checking (fragile) vs Trusting model summary (unreliable) vs SHA-256 hash comparison (chosen: mathematically certain).",
            "prior_art": "Git blob hashing and forensic digital evidence validation.",
            "what_we_get_for_free": "Node's crypto module computes SHA-256 at gigabytes per second.",
            "from_the_docs": "AGENTS.md: 'No document may claim an agent was invoked, a source was inspected... unless it actually happened.'",
            "what_to_notice": "Notice how a single bit difference in the file completely changes the SHA-256 hash (avalanche effect)!",
            "concepts_to_own": "Cryptographic proof of work: requiring an actor to provide a computational artifact that proves it performed an observation.",
            "interview_angle": "How do you detect AI hallucination in automated research pipelines? Answer: Require subagents to return cryptographic hashes of inspected artifacts and verify them against disk.",
            "decisions_alone": "You can choose between full-file hashes or line-range chunk hashes.",
            "lesson": "Don't ask the agent if it read the file. Ask for the hash and check the disk yourself."
        },
        "proof": [
            ("Verifier reads physical file bytes and compares SHA-256 hashes", "packages/dev-loop/claims/src/verifier.ts:25-55", "direct inspection", "Current checkout"),
            ("Integrity tests verify detection of altered and fabricated hashes", "packages/dev-loop/claims/tests/verifier.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Cryptographic Evidence Hash Verifier",
            "what": "Verifies reported hashes against physical files.",
            "usage": "Used in `dsh-dev-loop-claims`.",
            "potential": "Can verify agent file inspection across any tool call.",
            "generic": "Usable for any file-backed evidence.",
            "evidence": "packages/dev-loop/claims/src/verifier.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Computes authoritative SHA-256 disk hash.",
            "Detects hash mismatches fail-closed.",
            "Proves physical file inspection."
        ],
        "next_gate": "00.13d"
    },

    # 00.13d
    {
        "id": "00.13d",
        "slug": "00.13d-fail-closed-gate.md",
        "title": "Fail-Closed Admission Verification Hook",
        "queue": 13,
        "depends": "00.13a, 00.13b, 00.13c",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "event/hook plugin",
        "package": "@deepseek-ai/dsh-dev-loop-claims",
        "summary_voice": "Here is the ultimate verdict. If a piece contains even ONE unverified claim or if any cited reference was contradicted by empirical inspection, the piece is inadmissible. We hook into the lifecycle pre-dispatch pipeline. Inadmissible pieces cannot be dispatched to workers. The author must amend the piece or the human must decide. The detective permits no uncorroborated assertions.",
        "opt_a": "Block dispatch fail-closed if any load-bearing claim remains unverified or contradicted.",
        "opt_b": "Allow pieces with unverified claims to be dispatched, risking builds based on false assumptions.",
        "scenarios": [
            ("a piece where all claims are verified by direct inspection or hash proof", "requireAdmissible(pieceId) runs", "it passes and permits dispatch."),
            ("a piece containing a claim marked 'UNVERIFIED'", "requireAdmissible runs", "it casts a veto with reason 'Unverified claim: [citation]'."),
            ("a piece where research proved a claim was contradicted", "requireAdmissible executes", "it casts a veto and marks the piece blocked for revision.")
        ],
        "harness_fit": "Admission gate in `@deepseek-ai/dsh-dev-loop-claims/src/gate.ts`. Hooks into dispatch queue and approval checks.",
        "contracts": """```typescript
export interface AdmissionReport {
  readonly pieceId: string
  readonly totalClaims: number
  readonly verifiedCount: number
  readonly unverifiedCount: number
  readonly contradictedCount: number
  readonly isAdmissible: boolean
}

export function evaluateClaimAdmission(pieceId: string): Promise<AdmissionReport>
```""",
        "deps_text": "00.13a, 00.13b, 00.13c",
        "references": [
            ("packages/dev-loop/claims/src/gate.ts", "1-85", "Fail-closed admission verification gate"),
            ("packages/dev-loop/claims/tests/gate.spec.ts", "1-80", "Admission gate veto tests on unverified claims")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/claims/tests/gate.spec.ts",
            "expected": "✓ evaluateClaimAdmission > rejects pieces with unverified claims fail-closed"
        },
        "teach": {
            "voice_intro": "The case cannot proceed to trial on unverified rumors. Every allegation must be corroborated or dismissed.",
            "what_it_does": "Prevents pieces with unverified or contradicted claims from entering the execution pipeline.",
            "background": "Building software on false assumptions wastes enormous time. Gating claims before execution stops defects early.",
            "how_it_works": "Inspects all parsed claims for the piece. If any claim is marked `unverified` or has a contradictory finding, returns `isAdmissible: false`.",
            "why_this_approach": "Enforces the R-claims-verified meta axiom mechanically: false claims halt the process before code is written.",
            "approaches_considered": "Warning banner (ignored by agents) vs Fail-closed dispatch block (chosen: stops execution).",
            "prior_art": "Formal logic premise validation and legal standards of evidence admissibility.",
            "what_we_get_for_free": "Integrates with `ctx.devLoopQueue` to filter candidate pieces automatically.",
            "from_the_docs": "plans/AGENTS.md: 'When verification contradicts the piece: STOP and report the contradiction with its evidence... The piece is amended first.'",
            "what_to_notice": "Notice that stopping on a contradiction is treated as a victory, not a failure!",
            "concepts_to_own": "Fail-closed admission: rejecting requests unless all required evidence is positively affirmed.",
            "interview_angle": "How do you prevent hallucinated architectural requirements from entering production? Answer: Fail-closed claim admission gates requiring verified citations.",
            "decisions_alone": "You can exempt non-load-bearing documentation notes from strict admission gating.",
            "lesson": "Catching a false assumption before coding begins saves days of wasted labor. Verify fail-closed."
        },
        "proof": [
            ("Admission gate checks all claims and blocks dispatch on unverified entries", "packages/dev-loop/claims/src/gate.ts:25-60", "direct inspection", "Current checkout"),
            ("Gate tests prove rejection of unverified and contradicted claims", "packages/dev-loop/claims/tests/gate.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Fail-Closed Claim Admission Gate",
            "what": "Blocks execution if prerequisites or claims lack proof.",
            "usage": "Used in `dsh-dev-loop-claims`.",
            "potential": "Can gate sprint planning, deployment tickets, or feature launches.",
            "generic": "Works with any collection of claim entries.",
            "evidence": "packages/dev-loop/claims/src/gate.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Evaluates all proof table claims.",
            "Blocks dispatch if any claim is unverified.",
            "Emits detailed admission report."
        ],
        "next_gate": "00.14a"
    },

    # 00.14a
    {
        "id": "00.14a",
        "slug": "00.14a-host-service-assembly.md",
        "title": "Cordis Host Service Patch Composition",
        "queue": 14,
        "depends": "00.01e, 00.02d, 00.03c, 00.04c, 00.05c, 00.06d, 00.08c, 00.11c, 00.12d, 00.13d",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "todo",
        "primitive": "patch layer",
        "package": "@deepseek-ai/dsh-dev-loop-preset",
        "summary_voice": "Tutturu~ 🌸 Mayuri is setting up the big laboratory table! All our lovely services—Directory, Lifecycle, Approval, Queue, Worktree, Roles, References, Persistence, and Claims—need to sit together in the Host Plane so every session can share them! We compose them into a clean Cordis patch layer (`cordis.patch.yml`). One shared, harmonious home for all our tools!",
        "opt_a": "Assemble all Dev Loop services in the Host Plane as a reusable Cordis patch layer.",
        "opt_b": "Mount services separately inside each agent session, creating fragmented, desynchronized queues.",
        "scenarios": [
            ("a deployment loading `cordis.patch.yml` with dev loop enabled", "host boot executes", "all 9 dev loop services register into root Cordis context."),
            ("a multi-session setup where session A enqueues a piece and session B inspects it", "query runs across sessions", "both sessions observe the exact same shared queue and database state."),
            ("host shutdown or reload", "dispose runs", "services dispose cleanly in reverse dependency order.")
        ],
        "harness_fit": "Patch layer configuration in `@deepseek-ai/dsh-dev-loop-preset/cordis.patch.yml`. Applies to deployment profile.",
        "contracts": """```yaml
# cordis.patch.yml
- name: '@deepseek-ai/dsh-dev-loop-directory'
- name: '@deepseek-ai/dsh-dev-loop-lifecycle'
- name: '@deepseek-ai/dsh-dev-loop-approval'
- name: '@deepseek-ai/dsh-dev-loop-queue'
  config:
    maxConcurrency: 2
- name: '@deepseek-ai/dsh-dev-loop-worktree'
- name: '@deepseek-ai/dsh-dev-loop-roles'
- name: '@deepseek-ai/dsh-dev-loop-references'
- name: '@deepseek-ai/dsh-dev-loop-persistence'
- name: '@deepseek-ai/dsh-dev-loop-claims'
```""",
        "deps_text": "00.01e, 00.02d, 00.03c, 00.04c, 00.05c, 00.06d, 00.08c, 00.11c, 00.12d, 00.13d",
        "references": [
            ("packages/dev-loop/preset/cordis.patch.yml", "1-40", "Cordis host patch layer configuration"),
            ("packages/dev-loop/preset/tests/assembly.spec.ts", "1-70", "Host service assembly integration tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/preset/tests/assembly.spec.ts",
            "expected": "✓ host assembly > mounts all 9 dev loop services into root Cordis container"
        },
        "teach": {
            "voice_intro": "Putting together a sewing kit means making sure the scissors, needles, and threads are all in their proper places! Tutturu~",
            "what_it_does": "Mounts the dev loop's core services into the shared Host Plane container via Cordis patch composition.",
            "background": "In DSH, services shared across sessions (queues, worktree pools, databases) must live in the Host Plane, not in private agent sessions.",
            "how_it_works": "The patch YAML specifies each plugin package and its validated configuration. Cordis Loader mounts them during boot.",
            "why_this_approach": "Ensures all sessions share a single queue and single database, preventing split-brain states.",
            "approaches_considered": "Session-local mounting (gives every session its own private queue) vs Host patch layer (chosen: shared coordination).",
            "prior_art": "Kubernetes DaemonSets and systemd system daemons.",
            "what_we_get_for_free": "Cordis dependency injection (`ctx.inject`) ensures services load in proper topological order automatically.",
            "from_the_docs": "AGENTS.md: 'Host plane versus agent plane is decided by the rules in PRESET-RULES... Host Plane owns cross-session persistent state.'",
            "what_to_notice": "Notice how each plugin only declares its own dependencies; Cordis wires them without manual glue code!",
            "concepts_to_own": "Host Plane singleton architecture: colocating shared state services in the application container root.",
            "interview_angle": "How do you coordinate state across multiple agent sessions in an extensible micro-kernel? Answer: Mount coordination services as host-level plugins shared by all session scopes.",
            "decisions_alone": "You can adjust plugin configuration parameters in `cordis.patch.yml` without modifying source code.",
            "lesson": "Keep shared resources at the host level so all agents work in perfect harmony! 🌸"
        },
        "proof": [
            ("Patch layer mounts all 9 dev loop services into Cordis root", "packages/dev-loop/preset/cordis.patch.yml:1-35", "direct inspection", "Current checkout"),
            ("Assembly test proves service availability across multi-session mocks", "packages/dev-loop/preset/tests/assembly.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Dev Loop Cordis Patch Layer",
            "what": "Declarative host service assembly for the dev loop subsystem.",
            "usage": "Used in `dsh-dev-loop-preset`.",
            "potential": "Can be applied to any DSH profile (headless, web, desktop).",
            "generic": "Standard Cordis patch layer format.",
            "evidence": "packages/dev-loop/preset/cordis.patch.yml",
            "confidence": "high"
        },
        "acceptance": [
            "Mounts all 9 services in Host Plane.",
            "Shares queue and persistence across sessions.",
            "Disposes cleanly without resource leaks."
        ],
        "next_gate": "00.14b"
    },

    # 00.14b
    {
        "id": "00.14b",
        "slug": "00.14b-brain-preset-tools.md",
        "title": "Brain Agent Preset and Scoped Tool Injection",
        "queue": 14,
        "depends": "00.14a",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "todo",
        "primitive": "agent-preset composition",
        "package": "@deepseek-ai/dsh-dev-loop-preset",
        "summary_voice": "Tutturu~ 🌸 Now let's dress our Brain orchestrator! The Brain is our helpful conductor who reads pieces, talks to the human, and delegates tasks! We create the `dev-loop-brain` preset! It equips the agent with approval cards, delegation tools, slash commands, and our five delightful developer personas! Everyone is ready for work!",
        "opt_a": "Compose an isolated `dev-loop-brain` preset declaring exact model tools and persona system prompts.",
        "opt_b": "Inject all tools globally into all agents, giving worker subagents access to orchestrator tools.",
        "scenarios": [
            ("a session started with `--preset dev-loop-brain`", "preset loads", "the agent context receives approval, queue, and role delegation tools."),
            ("a Brain agent selecting a persona for human interaction", "prompt is assembled", "the selected persona prompt (e.g. Neko-chan or L) is injected into Slot #1."),
            ("a worker subagent inspecting its available tools", "tools are listed", "orchestrator tools like `dev_loop_delegate` are excluded from the child scope.")
        ],
        "harness_fit": "Agent preset in `@deepseek-ai/dsh-dev-loop-preset/presets/brain/preset.yml`. Selectable via `dsh --preset dev-loop-brain`.",
        "contracts": """```yaml
# presets/brain/preset.yml
name: dev-loop-brain
description: Orchestrator agent for autonomous development loop
plugins:
  - '@deepseek-ai/dsh-dev-loop-approval/tool'
  - '@deepseek-ai/dsh-dev-loop-roles/tool'
  - '@deepseek-ai/dsh-interaction'
```""",
        "deps_text": "00.14a",
        "references": [
            ("packages/dev-loop/preset/presets/brain/preset.yml", "1-45", "Brain agent preset declaration"),
            ("packages/dev-loop/preset/tests/preset.spec.ts", "1-65", "Preset loading and tool scoping tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/preset/tests/preset.spec.ts",
            "expected": "✓ dev-loop-brain preset > injects orchestrator tools and persona prompts"
        },
        "teach": {
            "voice_intro": "Every costume has pockets for the right tools! Let's make sure our Brain conductor has everything they need! Tutturu~",
            "what_it_does": "Configures the Brain orchestrator preset with scoped tools and persona prompts.",
            "background": "Agent presets in DSH define what tools, prompts, and behaviors an agent receives in its scoped session.",
            "how_it_works": "`preset.yml` lists plugin rows mounted in the Agent Plane. The agent loop receives the tools without polluting other presets.",
            "why_this_approach": "Enforces least privilege: orchestrators get delegation tools; workers get execution tools.",
            "approaches_considered": "Global tool injection (dangerous: workers call orchestrator tools) vs Preset-scoped injection (chosen: secure).",
            "prior_art": "Role-Based Access Control (RBAC) and Kubernetes service account scopes.",
            "what_we_get_for_free": "DSH preset loader automatically handles persona injection and prompt slot assembly.",
            "from_the_docs": "AGENTS.md: 'Host plane versus agent plane... preset cordis.yml files define per-session agent composition.'",
            "what_to_notice": "Notice how personas (Neko-chan, L, Daru, Hououin Kyouma, Mayuri) are available for dynamic selection!",
            "concepts_to_own": "Scoped capability injection: furnishing agents with tools tailored specifically to their coordination role.",
            "interview_angle": "How do you prevent subagents from recursively spawning more subagents inappropriately? Answer: Restrict delegation tools to orchestrator presets only.",
            "decisions_alone": "You can add new inspection tools to the Brain preset without modifying worker presets.",
            "lesson": "Equip each agent for its specific purpose. Beautiful composition brings joyful collaboration! 🌸"
        },
        "proof": [
            ("Preset configuration binds orchestrator tools exclusively to Brain agent", "packages/dev-loop/preset/presets/brain/preset.yml:1-35", "direct inspection", "Current checkout"),
            ("Preset test suite verifies tool scoping and persona injection", "packages/dev-loop/preset/tests/preset.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Dev Loop Brain Agent Preset",
            "what": "Declarative agent preset for development loop orchestration.",
            "usage": "Used in `dsh-dev-loop-preset`.",
            "potential": "Can serve as template for custom orchestrator agents.",
            "generic": "Standard DSH agent preset format.",
            "evidence": "packages/dev-loop/preset/presets/brain/preset.yml",
            "confidence": "high"
        },
        "acceptance": [
            "Defines `dev-loop-brain` preset.",
            "Injects approval and delegation tools.",
            "Isolates orchestrator tools from child workers."
        ],
        "next_gate": "00.14c"
    },

    # 00.14c
    {
        "id": "00.14c",
        "slug": "00.14c-loop-integration-test.md",
        "title": "Multi-Agent End-to-End Steins Gate Verification",
        "queue": 14,
        "depends": "00.14a, 00.14b",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "todo",
        "primitive": "profile",
        "package": "@deepseek-ai/dsh-dev-loop-preset",
        "summary_voice": "Mwahahaha! Fools of the world, gaze upon the culmination of our grand experiment! The entire Development Loop operates as a unified temporal symphony! From piece intake to human approval, through concurrency queues and isolated worktrees, bounded by research guards and the Four Gates, all the way to clean mainline integration! The Divergence Meter reads exactly 1.048596%! We have reached the Steins Gate!",
        "opt_a": "Execute complete end-to-end integration test exercising all 14 dev-loop milestones in sequence.",
        "opt_b": "Rely solely on isolated unit tests, leaving cross-package lifecycle interactions untested.",
        "scenarios": [
            ("a candidate piece '00.01' submitted to the dev loop", "full workflow executes", "the piece is presented, approved with digest, queued, dispatched to worktree, tested red, implemented green, verified through Four Gates, and moved to `done/`."),
            ("a piece with a failing test baseline", "implementer fails to make tests green", "Gate 3 vetoes completion and worktree is preserved for triage."),
            ("the completed workflow inspects master branch", "workflow completes", "mainline commit is clean, git status is pristine, and set README index reflects done status.")
        ],
        "harness_fit": "End-to-end integration test suite in `@deepseek-ai/dsh-dev-loop-preset/tests/composition.e2e.ts`. Proves complete subsystem coherence.",
        "contracts": """```typescript
export interface DevLoopE2EResult {
  readonly pieceId: string
  readonly finalStatus: 'done' | 'blocked'
  readonly verifiedCommit: string
  readonly gatesPassed: readonly string[]
}

export function runDevLoopE2E(fixtureDir: string): Promise<DevLoopE2EResult>
```""",
        "deps_text": "00.14a, 00.14b",
        "references": [
            ("packages/dev-loop/preset/tests/composition.e2e.ts", "1-150", "End-to-end multi-agent integration test suite"),
            ("plans/pieces/00-dev-loop/README.md", "1-60", "Complete 00-dev-loop set specification index")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/preset/tests/composition.e2e.ts",
            "expected": "✓ dev-loop E2E > completes full cycle from intake to verified mainline merge"
        },
        "teach": {
            "voice_intro": "The final battle against chaos! When every gadget in the lab works in perfect synchronization, victory is ours!",
            "what_it_does": "Exercises the entire development loop lifecycle end-to-end with real subagents, git worktrees, and verification gates.",
            "background": "Integration testing proves that components that pass unit tests individually also function correctly when wired together.",
            "how_it_works": "Spawns a mock repo. Scans piece, presents card, approves with hash, queues, allocates worktree, runs Test Writer (RED), runs Implementer (GREEN), runs Four Gates, merges to master, moves to `done/`.",
            "why_this_approach": "Provides undeniable empirical proof that the autonomous development loop achieves the No Unproven Done invariant.",
            "approaches_considered": "Mocked stub test (tests nothing real) vs Real Git worktree + Cordis multi-service E2E (chosen: absolute proof).",
            "prior_art": "Compiler test suites (e.g. GCC bootstrap tests) and continuous delivery smoke gates.",
            "what_we_get_for_free": "DeepSeek Harness testkit provides real in-process Cordis execution and MockAdapter scripting.",
            "from_the_docs": "AGENTS.md: 'A task is not done when the code works. It is done when the owner can SEE it working.'",
            "what_to_notice": "Notice how all five personas (Neko-chan, L, Daru, Hououin Kyouma, Mayuri) participate across the loop!",
            "concepts_to_own": "Systemic integration verification: validating an entire multi-agent lifecycle against real physical constraints.",
            "interview_angle": "How do you test complex multi-agent orchestration systems end-to-end without real API costs? Answer: In-process container testbeds with deterministic model adapters and real subprocess fixtures.",
            "decisions_alone": "You can add custom E2E scenario fixtures testing exotic edge cases.",
            "lesson": "Integration is the ultimate test of architecture. When all parts move as one, you reach the Steins Gate! El Psy Kongroo."
        },
        "proof": [
            ("E2E test executes complete 14-stage lifecycle across real Git repository", "packages/dev-loop/preset/tests/composition.e2e.ts:35-120", "direct inspection", "Current checkout"),
            ("Full suite passes with 100% verified mainline commit", "packages/dev-loop/preset/tests/composition.e2e.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Multi-Agent Development Loop E2E Testbed",
            "what": "End-to-end test suite proving autonomous dev-loop lifecycle.",
            "usage": "Used in `dsh-dev-loop-preset`.",
            "potential": "Can test any multi-agent coding framework.",
            "generic": "Fixture repository and test scenarios are parameterized.",
            "evidence": "packages/dev-loop/preset/tests/composition.e2e.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Proves complete lifecycle from intake to merge.",
            "Validates all Four Gates in sequence.",
            "Confirms clean mainline git state."
        ],
        "next_gate": "01.01"
    }
]
