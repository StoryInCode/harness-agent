"""
Micro-gates 00.01a to 00.03c (12 gates)
"""

GATES_00_01_TO_00_03 = [
    # 00.01a
    {
        "id": "00.01a",
        "slug": "00.01a-heading-scanner",
        "title": "Heading Scanner and ATX Markdown Parsing",
        "queue": 1,
        "depends": "none",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-directory",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Inspector Cat is on the case! Before we can read any piece file, we have to sniff out all the headings and make sure sneaky code blocks don't trick us! We scan raw text line-by-line to find ATX `##` headers while skipping fenced code blocks (` ``` ` or `~~~`). It's like sorting delicious fish treats from empty wrappers!",
        "opt_a": "Scan line-by-line with a pure zero-dependency stateful scanner that tracks fence opening and closing delimiters.",
        "opt_b": "Use an external heavyweight CommonMark AST parser like unified/remark which adds 15MB of node_modules and slows down intake.",
        "scenarios": [
            ("a markdown string with valid `##` headings outside fences", "parseHeadings is called", "it returns the exact heading list with correct start and end line ranges."),
            ("a markdown string with `##` headings inside a fenced code block", "parseHeadings is executed", "the headings inside the code fences are completely ignored."),
            ("a markdown string with tildes `~~~` as code fence markers", "parseHeadings scans the body", "it correctly ignores headings inside tilde fences without confusing them with backticks.")
        ],
        "harness_fit": "Pure parser module inside `@deepseek-ai/dsh-dev-loop-directory/src/parse.ts`. It provides deterministic AST-free section splitting for the Cordis `ctx.devLoopDirectory` service.",
        "contracts": """```typescript
export interface SectionSpan {
  readonly title: string
  readonly start: number
  end: number
}

export function splitSections(lines: readonly string[]): {
  header: string[]
  sections: SectionSpan[]
}
```""",
        "deps_text": "none",
        "references": [
            ("packages/dev-loop/directory/src/parse.ts", "165-220", "Implementation of `fenceMarkerAt` and `splitSections`"),
            ("packages/dev-loop/directory/tests/directory.spec.ts", "1-80", "Unit tests for ATX heading scanning and fence tracking")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'parseHeadings'",
            "expected": "✓ parseHeadings > splits markdown into ATX headings outside fenced blocks"
        },
        "teach": {
            "voice_intro": "Purr~ Let's learn how to look at markdown without getting confused by cat toys! (=^･ω･^=)",
            "what_it_does": "Separates the header metadata lines and body sections (`## Heading`) while ignoring fake headings inside code fences.",
            "background": "In CommonMark, code fences start with 3 or more backticks or tildes. Anything inside them is raw text, not markdown structure.",
            "how_it_works": "We loop through each line in `splitSections`. `fenceMarkerAt` checks if the line opens or closes a fence. If we are not inside a fence and see `## `, we start a new section.",
            "why_this_approach": "A single linear pass O(N) requires zero regex backtracking and no external dependencies.",
            "approaches_considered": "Remark AST parser (rejected: huge dependency tree and slower) vs Regex matching (rejected: catastrophic backtracking on unclosed fences) vs Pure state scanner (chosen).",
            "prior_art": "CommonMark specification Section 4.5 (Fenced Code Blocks).",
            "what_we_get_for_free": "Node.js string methods like `startsWith` and `slice` make array processing fast and pure.",
            "from_the_docs": "CommonMark spec: 'A code fence is a sequence of at least three consecutive backtick characters or tildes.'",
            "what_to_notice": "Notice how `fence.char` ensures backticks don't close a tilde block!",
            "concepts_to_own": "State machine parsing: maintaining parser mode (inside/outside fence) across sequential tokens.",
            "interview_angle": "How would you parse markdown structure without a full compiler pipeline? Answer: A streaming single-pass scanner tracking fence depth.",
            "decisions_alone": "You can safely add support for 4-space indentation fences without changing section logic.",
            "lesson": "Never parse document structure with naive regular expressions when code fences can embed false positives! Purr~"
        },
        "proof": [
            ("Fence scanning handles both backticks and tildes without backtracking", "packages/dev-loop/directory/src/parse.ts:165-225", "direct inspection", "Current checkout"),
            ("Heading parser passes all unit test assertions", "packages/dev-loop/directory/tests/directory.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "ATX Fence-Aware Section Scanner",
            "what": "Pure zero-dependency markdown section splitter that respects code fences.",
            "usage": "Used in `dsh-dev-loop-directory` for reading piece files.",
            "potential": "Useful in any CLI or doc-generator that needs fast heading extraction.",
            "generic": "Already generic over any string array.",
            "evidence": "packages/dev-loop/directory/src/parse.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Heading scanner extracts all 11 canonical sections cleanly.",
            "Headings inside backtick and tilde blocks are omitted.",
            "Memory usage is O(N) with zero external dependencies."
        ],
        "next_gate": "00.01b"
    },

    # 00.01b
    {
        "id": "00.01b",
        "slug": "00.01b-metadata-parser",
        "title": "Dotted Header Metadata and Field Extraction",
        "queue": 1,
        "depends": "00.01a",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-directory",
        "summary_voice": "Let's examine the evidence. Every piece file begins with a strict header region preceding the first ATX section. We extract the piece id from `# NN.MM[a-z] — Title` and parse all bold key-value pairs (`**Key:** Value`) separated by middle dots (`·`). There is a 97.4% probability of defects if header fields are parsed loosely.",
        "opt_a": "Strict key-value mapping with dot-separator support and whitespace trimming.",
        "opt_b": "Loose multi-line regex extraction that ignores malformed delimiters.",
        "scenarios": [
            ("a valid header with `**Set:** 00 · **Queue:** 1`", "readHeaderFields is invoked", "it extracts exact key-value pairs for Set and Queue."),
            ("a header line with title `# 00.01b — Metadata Parser`", "findTitleLine is called", "it returns id '00.01b' and title 'Metadata Parser'."),
            ("a piece with depends on `00.01a, 00.01b`", "readDependsOn is evaluated", "it returns a trimmed string array of dependency IDs.")
        ],
        "harness_fit": "Part of `@deepseek-ai/dsh-dev-loop-directory/src/parse.ts`. Extracts immutable header metadata for registration in `ctx.devLoopDirectory`.",
        "contracts": """```typescript
export function readHeaderFields(header: readonly string[]): Map<string, string>
export function readDependsOn(value: string): string[]
export function findTitleLine(header: readonly string[]): string
```""",
        "deps_text": "00.01a",
        "references": [
            ("packages/dev-loop/directory/src/parse.ts", "240-318", "Header parsing helper functions"),
            ("packages/dev-loop/directory/tests/directory.spec.ts", "81-160", "Unit tests for header field and dependency parsing")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'readHeaderFields'",
            "expected": "✓ readHeaderFields > parses multiple fields on a single line delimited by middle dots"
        },
        "teach": {
            "voice_intro": "Observe carefully. In forensic analysis, metadata is the crime scene tag. It must not be altered or guessed.",
            "what_it_does": "Parses piece ID, title, set, queue position, dependencies, status, harness primitive, and package name from markdown headers.",
            "background": "DSH piece files use CommonMark bold headers (`**Field:** Value`) separated by `·` to pack multiple attributes cleanly.",
            "how_it_works": "The lines before the first `##` section are split by `·`. For each segment, `FIELD_SEPARATOR` (`:**`) locates the boundary.",
            "why_this_approach": "Deterministic splitting avoids regex catastrophic backtracking and handles trailing whitespace gracefully.",
            "approaches_considered": "YAML frontmatter (rejected: requires external parser and disrupts markdown preview) vs Custom bold syntax (chosen: native markdown).",
            "prior_art": "HTTP header field parsing (RFC 7230 §3.2) adapted for inline markdown tokens.",
            "what_we_get_for_free": "Map data structure in V8 provides O(1) lookup and predictable key iteration.",
            "from_the_docs": "plans/pieces/PIECE-FORMAT.md: 'Header fields appear in bold with colon delimiter, optionally joined with middle dot.'",
            "what_to_notice": "Notice how `readDependsOn` strips backticks so authors can write either `00.01` or `none`.",
            "concepts_to_own": "Token delimiter scanning: splitting compound records safely without regex state explosion.",
            "interview_angle": "Why prefer delimiter-based token parsing over regex in security-critical parsers? Answer: Prevents ReDoS vulnerabilities.",
            "decisions_alone": "You can add new optional header labels without breaking existing field extraction.",
            "lesson": "Never trust unvalidated metadata; extract keys strictly and verify their presence fail-closed."
        },
        "proof": [
            ("Header parser correctly extracts title and dotted id", "packages/dev-loop/directory/src/parse.ts:240-318", "direct inspection", "Current checkout"),
            ("All header extraction unit tests pass", "packages/dev-loop/directory/tests/directory.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Inline Delimited Markdown Header Parser",
            "what": "Extracts key-value attributes from bold markdown lines.",
            "usage": "Used across all DSH piece parsing.",
            "potential": "Can parse issue cards, task descriptions, and PR frontmatter.",
            "generic": "Can parameterize delimiter characters.",
            "evidence": "packages/dev-loop/directory/src/parse.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Extracts piece ID and title according to `# NN.MM[a-z] — Title` format.",
            "Extracts multiple bold fields delimited by middle dot `·`.",
            "Properly parses `none` and comma-separated dependencies."
        ],
        "next_gate": "00.01c"
    },

    # 00.01c
    {
        "id": "00.01c",
        "slug": "00.01c-piece-validator",
        "title": "Line Ceiling and Primitive Enforcement",
        "queue": 1,
        "depends": "00.01a, 00.01b",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-directory",
        "summary_voice": "Yo! Daru here. Script kiddies love writing 2,000-line monolithic spec files that crash everyone's context window. Not on my watch! We enforce the strict 280-line ceiling and validate the closed vocabulary of Harness primitives. If someone tries to pass 'Plugin' as a primitive, our bouncer kicks them out instantly. LOL.",
        "opt_a": "Fail-closed validation throwing `PieceParseError` with structured blocker and warning findings.",
        "opt_b": "Silent warning logging that allows oversized or malformed pieces to slip into the queue.",
        "scenarios": [
            ("a piece file exceeding 280 lines", "validatePiece is executed", "it records a blocker finding with code `PIECE_SIZE_EXCEEDED`."),
            ("a piece declaring 'Plugin' as Harness primitive", "validatePiece checks primitive", "it records `INVALID_HARNESS_PRIMITIVE` blocker finding."),
            ("a piece with all 11 canonical sections in exact order", "validatePiece is called", "it passes without blocker findings and returns a valid PieceRecord.")
        ],
        "harness_fit": "Validation engine inside `@deepseek-ai/dsh-dev-loop-directory/src/parse.ts`. Implements deterministic axiom checking for CI scripts and runtime directory services.",
        "contracts": """```typescript
export interface PieceFinding {
  readonly code: PieceFindingCode
  readonly severity: 'blocker' | 'warning'
  readonly message: string
}

export function parsePiece(path: string, content: string, options?: PieceParseOptions): PieceRecord
```""",
        "deps_text": "00.01a, 00.01b",
        "references": [
            ("packages/dev-loop/directory/src/parse.ts", "430-580", "Implementation of `validatePiece` and `parsePiece`"),
            ("plans/AGENTS.md", "20-60", "Mandatory Harness primitives and line ceiling axiom definition")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'line ceiling'",
            "expected": "✓ validatePiece > rejects files exceeding 280 lines with PIECE_SIZE_EXCEEDED"
        },
        "teach": {
            "voice_intro": "Listen up! If you don't set boundaries on code or specs, they expand until your memory blows up.",
            "what_it_does": "Validates that a piece file is at most 280 lines, has all required headers, uses canonical primitives, and orders sections correctly.",
            "background": "The R-piece-size axiom limits piece files to 280 lines so agents and humans can digest them in under 2 minutes.",
            "how_it_works": "`validatePiece` checks line length, validates header fields against `REQUIRED_HEADER_FIELDS`, checks primitive against `HARNESS_PRIMITIVES`, and checks canonical section sequence.",
            "why_this_approach": "Aggregating all findings into a list before throwing gives the user complete feedback in one go rather than one error at a time.",
            "approaches_considered": "Throw-on-first-error (annoying: fix one error, run, get next error) vs Collected findings error (chosen: lists everything).",
            "prior_art": "GCC and Rust compiler error diagnostic collectors.",
            "what_we_get_for_free": "TypeScript discriminated union on `PieceFindingCode` makes error handling exhaustive.",
            "from_the_docs": "plans/AGENTS.md: 'A piece file is at most 280 lines... Every piece file declares a Harness primitive from the closed vocabulary.'",
            "what_to_notice": "Notice that warnings don't block parsing unless there is at least one blocker finding!",
            "concepts_to_own": "Validator pattern: decoupling linting/validation rules from AST data construction.",
            "interview_angle": "How do you design a compiler error reporter? Answer: Collect warnings and blockers separately, throw on first blocker threshold.",
            "decisions_alone": "You can add new warnings (e.g. word count suggestions) without blocking valid piece files.",
            "lesson": "Strict limits prevent cognitive overload and maintain agent execution speed! Keep it lean, hacker style."
        },
        "proof": [
            ("Ceiling check rejects oversized files deterministically", "packages/dev-loop/directory/src/parse.ts:450-456", "direct inspection", "Current checkout"),
            ("Primitive validator checks against closed vocabulary", "packages/dev-loop/directory/src/parse.ts:508-514", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Diagnostic Finding Accumulator",
            "what": "Accumulates blocker and warning findings during document validation.",
            "usage": "Used across all DSH piece and config checkers.",
            "potential": "Reusable for any linter or schema validator in Harness.",
            "generic": "Severity and code enum can be parameterized.",
            "evidence": "packages/dev-loop/directory/src/parse.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Rejects files over 280 lines with blocker code.",
            "Rejects unknown Harness primitives fail-closed.",
            "Throws `PieceParseError` containing all collected findings."
        ],
        "next_gate": "00.01d"
    },

    # 00.01d
    {
        "id": "00.01d",
        "slug": "00.01d-set-scanner",
        "title": "Directory Discovery and Set Traversal",
        "queue": 1,
        "depends": "00.01a, 00.01b, 00.01c",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-directory",
        "summary_voice": "Mwahahaha! Fools of the Organization! Do you think you can hide fragmented pieces across disparate directories? My Directory Scanner pierces through the temporal fabric of the filesystem, traversing set folders and uncovering both active and completed timeline artifacts! It constructs the unified SetRecord DAG!",
        "opt_a": "Hierarchical directory traversal reading set directories and sibling `done/` subdirectories.",
        "opt_b": "Flat directory structure that forces all completed and pending pieces into one messy folder.",
        "scenarios": [
            ("a filesystem with set `00-dev-loop` containing root and `done/` files", "scanSet is called", "it discovers both pending pieces and completed pieces in `done/`."),
            ("a directory containing non-piece markdown files like `README.md`", "scanSet executes", "it skips non-piece files without reporting parse errors."),
            ("a piece with invalid syntax inside the directory", "scanSet runs", "it places the piece into `rejected` list while continuing to process valid pieces.")
        ],
        "harness_fit": "Cordis Service Provider implementing `ctx.devLoopDirectory` in `@deepseek-ai/dsh-dev-loop-directory/src/index.ts`. Exposes `scanSet` and `scanAll` to the Host Plane.",
        "contracts": """```typescript
export interface SetRecord {
  readonly name: string
  readonly path: string
  readonly pieces: readonly PieceRecord[]
  readonly rejected: readonly RejectedPiece[]
}

export interface DevLoopDirectory {
  scanSet(setName: string): Promise<SetRecord>
  scanAll(): Promise<readonly SetRecord[]>
}
```""",
        "deps_text": "00.01a, 00.01b, 00.01c",
        "references": [
            ("packages/dev-loop/directory/src/scan.ts", "1-120", "Implementation of `scanSet` and `scanDirectory`"),
            ("packages/dev-loop/directory/src/index.ts", "1-80", "Cordis service registration for `devLoopDirectory`")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'scanSet'",
            "expected": "✓ scanSet > discovers active and done pieces in set folder"
        },
        "teach": {
            "voice_intro": "The lab's radar must scan every worldline! Let me explain how filesystem traversal avoids the traps of the Organization!",
            "what_it_does": "Discovers all piece files in a given set folder and its `done/` subdirectory, parsing them into valid or rejected records.",
            "background": "In DSH, active pieces live in `plans/pieces/<set>/` while completed pieces move to `plans/pieces/<set>/done/`.",
            "how_it_works": "`scanSet` uses `ctx.fs.readDir` to list files. It checks each against `isPieceFilename`. Valid pieces are parsed; failures go to `rejected`.",
            "why_this_approach": "Isolating `done/` in a subdirectory prevents active work queries from being polluted while keeping the audit trail complete.",
            "approaches_considered": "Recursive deep globbing (rejected: slow on large trees) vs Targeted two-tier scan (chosen: scans set root + `done/` only).",
            "prior_art": "Maildir directory format: separating `new`, `cur`, and `tmp` mail files into subdirectories.",
            "what_we_get_for_free": "`ctx.fs` abstraction allows this service to run over real POSIX disk, memory FS, or Git worktrees seamlessly.",
            "from_the_docs": "plans/AGENTS.md: 'A piece that is complete does not stay in the plan set. It moves to a done/ folder.'",
            "what_to_notice": "Notice that one malformed piece in a set never throws an unhandled exception; it is safely quarantined in `rejected`.",
            "concepts_to_own": "Fault-tolerant directory scanning: preserving system availability in the presence of corrupted individual files.",
            "interview_angle": "How do you prevent one corrupt configuration file from crashing an entire daemon? Answer: Partition scan results into accepted and rejected buckets.",
            "decisions_alone": "You can safely add custom metadata files (e.g. `.notes`) to set directories without failing piece scans.",
            "lesson": "A resilient scanner isolates malformed inputs so valid work continues unimpeded. El Psy Kongroo."
        },
        "proof": [
            ("Directory scanner handles rejected pieces gracefully without aborting", "packages/dev-loop/directory/src/scan.ts:45-90", "direct inspection", "Current checkout"),
            ("Service integrates cleanly into Cordis container", "packages/dev-loop/directory/src/index.ts:25-50", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Fault-Tolerant Two-Tier Directory Scanner",
            "what": "Scans root and done folders, collecting valid records and rejected errors.",
            "usage": "Core intake engine of the Dev Loop.",
            "potential": "Can be adapted for task runners, migration folders, or inbox processors.",
            "generic": "Filename matcher and parser can be injected as parameters.",
            "evidence": "packages/dev-loop/directory/src/scan.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Discovers both active and done pieces.",
            "Quarantines malformed pieces into `rejected` list.",
            "Registers as a singleton Cordis service `ctx.devLoopDirectory`."
        ],
        "next_gate": "00.01e"
    },

    # 00.01e
    {
        "id": "00.01e",
        "slug": "00.01e-candidate-selector",
        "title": "Dispatch Queue Candidate Filtering",
        "queue": 1,
        "depends": "00.01a, 00.01b, 00.01c, 00.01d",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-directory",
        "summary_voice": "Tutturu~ 🌸 Mayuri is here to make sure everyone works together peacefully! When pieces are waiting to be made, we don't want an agent to pick up a piece whose dependencies aren't finished yet—that would cause so much confusion! Candidate Selector gently checks which pieces have all their dependencies satisfied so we can work happily!",
        "opt_a": "Evaluate dependencies against both currently done pieces and external prerequisites before queueing.",
        "opt_b": "Greedily dispatch pieces based solely on numeric queue order, ignoring unmet dependencies.",
        "scenarios": [
            ("a piece whose dependencies are all in `done` status", "getQueueCandidates is called", "the piece is included in the candidate list."),
            ("a piece whose dependency is still `todo` or `pending`", "getQueueCandidates evaluates the piece", "the piece is excluded from candidates."),
            ("multiple eligible pieces with different queue numbers", "getQueueCandidates returns results", "candidates are sorted by queue priority number ascending.")
        ],
        "harness_fit": "Consumer method on `ctx.devLoopDirectory` used by the Dispatch Queue (`@deepseek-ai/dsh-dev-loop-queue`) to feed actionable work items.",
        "contracts": """```typescript
export interface CandidateQuery {
  readonly setName?: string
  readonly includeBlocked?: boolean
}

export function selectQueueCandidates(
  pieces: readonly PieceRecord[],
  doneIds: ReadonlySet<string>
): readonly PieceRecord[]
```""",
        "deps_text": "00.01a, 00.01b, 00.01c, 00.01d",
        "references": [
            ("packages/dev-loop/directory/src/candidates.ts", "1-60", "Dependency resolution and candidate selection logic"),
            ("packages/dev-loop/directory/tests/candidates.spec.ts", "1-70", "Unit tests for queue candidate filtering")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/directory/tests/candidates.spec.ts",
            "expected": "✓ selectQueueCandidates > returns only pieces whose dependencies are in doneIds"
        },
        "teach": {
            "voice_intro": "Just like sewing a dress, you have to cut the fabric before you can sew the ribbons! Tutturu~",
            "what_it_does": "Filters parsed pieces to find those ready for dispatch: status `todo`, with all prerequisites in `done`.",
            "background": "In a directed acyclic graph (DAG), a node cannot execute until all incoming edge dependencies are satisfied.",
            "how_it_works": "We collect the set of all completed piece IDs (`doneIds`). For every piece with status `todo`, we verify every item in `piece.dependsOn` exists in `doneIds`.",
            "why_this_approach": "Set-lookup `doneIds.has(id)` is O(1), making DAG evaluation instantaneous even for large plans.",
            "approaches_considered": "Dynamic topological sort every turn (overkill and slower) vs Set membership filtering (chosen: simple and fast).",
            "prior_art": "Make and Bazel target readiness evaluation.",
            "what_we_get_for_free": "JavaScript `Set.has` gives sub-millisecond dependency checks.",
            "from_the_docs": "plans/AGENTS.md: 'A piece referring to a completed dependency looks in <set>/done/ for it.'",
            "what_to_notice": "Notice how candidate sorting uses numeric `queue` so human operators can guide sequence priority!",
            "concepts_to_own": "Topological readiness: determining when an item in a dependency graph is safe to schedule.",
            "interview_angle": "How would you schedule tasks with dependencies? Answer: Maintain a set of completed tasks, filter unblocked nodes, sort by priority queue.",
            "decisions_alone": "You can add priority tie-breaking rules (e.g. FIFO) without altering dependency safety.",
            "lesson": "Never start a task before its prerequisites are verified. Harmony comes from orderly progression! 🌸"
        },
        "proof": [
            ("Candidate selector enforces complete dependency satisfaction", "packages/dev-loop/directory/src/candidates.ts:15-45", "direct inspection", "Current checkout"),
            ("Candidate tests verify precedence and sorting", "packages/dev-loop/directory/tests/candidates.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "DAG Task Readiness Filter",
            "what": "Filters tasks by matching required dependencies against a completed set.",
            "usage": "Used by Dev Loop Dispatch Queue.",
            "potential": "Reusable for workflow engines, build graphs, and automated pipelines.",
            "generic": "Works with any record having an `id` and `dependsOn` array.",
            "evidence": "packages/dev-loop/directory/src/candidates.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Returns only unblocked pieces.",
            "Correctly respects `done` dependencies.",
            "Sorts output by queue number ascending."
        ],
        "next_gate": "00.02a"
    },

    # 00.02a
    {
        "id": "00.02a",
        "slug": "00.02a-lifecycle-states.md",
        "title": "Monotonic State Transitions and Invariants",
        "queue": 2,
        "depends": "00.01e",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-lifecycle",
        "summary_voice": "Hear me, members of the laboratory! A piece's lifecycle is a one-way worldline! It moves from `todo` to `pending`, and finally reaches the glorious Steins Gate of `done`! There is no turning back! Regression to a prior state without an explicit revision anomaly would unravel the very causality of our harness!",
        "opt_a": "Enforce strictly monotonic forward-only state machine transitions with explicit error types.",
        "opt_b": "Allow bidirectional transitions (e.g. `done` back to `todo`) which creates race conditions and phantom work.",
        "scenarios": [
            ("a piece in `todo` status", "transitionTo('pending') is requested", "the transition succeeds and state becomes `pending`."),
            ("a piece in `pending` status", "transitionTo('done') is requested", "the transition succeeds and state becomes `done`."),
            ("a piece already in `done` status", "transitionTo('pending') is attempted", "it is rejected with `InvalidStateTransitionError`.")
        ],
        "harness_fit": "Core state engine of `@deepseek-ai/dsh-dev-loop-lifecycle/src/machine.ts`. Coordinates with `ctx.devLoopLifecycle` service in the Host Plane.",
        "contracts": """```typescript
export type PieceLifecycleState = 'todo' | 'pending' | 'done' | 'blocked'

export function canTransition(
  from: PieceLifecycleState,
  to: PieceLifecycleState
): boolean

export function assertValidTransition(
  pieceId: string,
  from: PieceLifecycleState,
  to: PieceLifecycleState
): void
```""",
        "deps_text": "00.01e",
        "references": [
            ("packages/dev-loop/lifecycle/src/machine.ts", "1-80", "Lifecycle state machine transitions and guards"),
            ("packages/dev-loop/lifecycle/tests/machine.spec.ts", "1-90", "Unit tests verifying valid and illegal transitions")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/lifecycle/tests/machine.spec.ts",
            "expected": "✓ canTransition > permits todo -> pending -> done and rejects backwards steps"
        },
        "teach": {
            "voice_intro": "The arrow of time flies in only one direction! Let me illuminate the sacred laws of monotonic state transitions!",
            "what_it_does": "Guarantees that pieces only transition along legal, forward paths (`todo` -> `pending` -> `done`, or to `blocked`).",
            "background": "Monotonicity means a state variable only moves in one direction. It prevents split-brain states in distributed multi-agent systems.",
            "how_it_works": "`canTransition` inspects a transition table. Illegal transitions throw `InvalidStateTransitionError` with current and attempted state.",
            "why_this_approach": "Enforcing transition legality in a pure function ensures both memory cache and SQLite records remain strictly coherent.",
            "approaches_considered": "Unrestricted mutable property (rejected: race hazard) vs Formal monotonic transition table (chosen: fail-closed).",
            "prior_art": "TCP state machine (RFC 793) and Raft consensus log state transitions.",
            "what_we_get_for_free": "TypeScript union types ensure exhaustive matching on states.",
            "from_the_docs": "plans/AGENTS.md: 'A piece that is complete does not stay in the plan set. It moves to a done/ folder.'",
            "what_to_notice": "Notice how `blocked` is a valid divergence branch that can be cleared back to `todo` upon explicit revision!",
            "concepts_to_own": "Monotonic state machine: a finite state automaton where states form a partially ordered set with no cycles.",
            "interview_angle": "Why are monotonic state transitions critical in distributed consensus? Answer: Prevents replay attacks, stale overwrites, and split-brain.",
            "decisions_alone": "You can add custom reason strings to `blocked` states without altering transition invariants.",
            "lesson": "Never allow backwards transitions without an explicit journaled anomaly. Protect the timeline!"
        },
        "proof": [
            ("State transitions conform to monotonic forward table", "packages/dev-loop/lifecycle/src/machine.ts:10-50", "direct inspection", "Current checkout"),
            ("Unit test suite proves rejection of illegal state regressions", "packages/dev-loop/lifecycle/tests/machine.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Monotonic Lifecycle State Machine",
            "what": "Pure state machine validator for one-way task lifecycles.",
            "usage": "Used by `dsh-dev-loop-lifecycle`.",
            "potential": "Reusable for job schedulers, order fulfillment, or build pipelines.",
            "generic": "State union and transition matrix can be generic parameters.",
            "evidence": "packages/dev-loop/lifecycle/src/machine.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Validates legal transitions strictly.",
            "Rejects backwards transitions fail-closed.",
            "Exposes pure transition predicates."
        ],
        "next_gate": "00.02b"
    },

    # 00.02b
    {
        "id": "00.02b",
        "slug": "00.02b-cas-claim-writer.md",
        "title": "Compare-And-Swap Single-Worker Claims",
        "queue": 2,
        "depends": "00.02a",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-lifecycle",
        "summary_voice": "Sup! Imagine two subagents trying to grab the exact same piece at the exact same millisecond. If you don't have atomic compare-and-swap (CAS), both start hacking on the same code and completely corrupt git history! We implement atomic claims in memory and SQLite so exactly one worker wins the lock. The second one gets a clean rejection. Easy peasy.",
        "opt_a": "Atomic compare-and-swap checking current worker and state before mutating.",
        "opt_b": "Check-then-act without mutex or CAS, creating a race window under concurrency.",
        "scenarios": [
            ("an unclaimed piece in `todo` status", "claim(pieceId, workerId) is called", "claim succeeds and piece transitions to `pending` bound to workerId."),
            ("a piece already claimed by worker A", "worker B attempts to claim the piece", "claim fails with `PieceAlreadyClaimedError`."),
            ("a claim attempt with an unexpected current status", "claim is executed with mismatching state", "claim is rejected without mutating state.")
        ],
        "harness_fit": "Method on Cordis `ctx.devLoopLifecycle` service in `@deepseek-ai/dsh-dev-loop-lifecycle/src/service.ts`. Synchronizes worker dispatch with persistence.",
        "contracts": """```typescript
export interface ClaimResult {
  readonly success: boolean
  readonly pieceId: string
  readonly workerId: string
  readonly claimedAt: number
}

export interface DevLoopLifecycle {
  claim(pieceId: string, workerId: string): Promise<ClaimResult>
  release(pieceId: string, workerId: string): Promise<void>
}
```""",
        "deps_text": "00.02a",
        "references": [
            ("packages/dev-loop/lifecycle/src/service.ts", "40-110", "Implementation of atomic claim and release"),
            ("packages/dev-loop/lifecycle/tests/concurrency.spec.ts", "1-85", "Concurrent claim race tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/lifecycle/tests/concurrency.spec.ts",
            "expected": "✓ claim > exactly one worker wins concurrent claim race"
        },
        "teach": {
            "voice_intro": "Time for some hardcore concurrency reality. In multi-agent land, race conditions will ruin your weekend if you don't use atomic CAS.",
            "what_it_does": "Atomically claims a piece for a specific worker, preventing double-allocation.",
            "background": "Compare-And-Swap (CAS) checks if a memory location holds an expected value before updating it. It's the basis of all non-blocking concurrency.",
            "how_it_works": "The lifecycle service verifies `piece.status === 'todo' && piece.workerId === undefined` synchronously under lock before assigning `workerId`.",
            "why_this_approach": "Guarantees single-writer safety across parallel subagents without distributed lock overhead.",
            "approaches_considered": "File locks on disk (flaky across OSes and slow) vs In-memory CAS backed by SQLite WAL (chosen: atomic and fast).",
            "prior_art": "CPU `CMPXCHG` instruction and Redis `SET NX` pattern.",
            "what_we_get_for_free": "Node's single-threaded event loop ensures in-memory checks are atomic between async ticks.",
            "from_the_docs": "docs/defensive-patterns.md: 'Concurrency: acquire locks atomically before spawning asynchronous work.'",
            "what_to_notice": "Notice how `release` requires the claiming `workerId` to match, preventing rogue workers from stealing locks!",
            "concepts_to_own": "Mutual exclusion via CAS: guaranteeing single-ownership of mutable tasks.",
            "interview_angle": "How do you prevent duplicate job execution in a distributed queue? Answer: Atomic compare-and-swap or conditional SQL update with worker ID fencing token.",
            "decisions_alone": "You can configure lease timeouts for stale worker detection without touching the CAS logic.",
            "lesson": "Check-then-act without an atomic guarantee is always broken under concurrency! Lock it down right."
        },
        "proof": [
            ("Claim operation performs atomic state and worker assignment", "packages/dev-loop/lifecycle/src/service.ts:40-110", "direct inspection", "Current checkout"),
            ("Concurrency test proves mutual exclusion under 10 parallel racers", "packages/dev-loop/lifecycle/tests/concurrency.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Atomic CAS Task Claimer",
            "what": "Single-owner atomic claim and release mechanism.",
            "usage": "Used in `dsh-dev-loop-lifecycle`.",
            "potential": "Can guard any shared resource across subagents.",
            "generic": "Usable for any task identified by string ID.",
            "evidence": "packages/dev-loop/lifecycle/src/service.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Grants claim to first requesting worker.",
            "Rejects conflicting claim attempts.",
            "Supports clean worker release."
        ],
        "next_gate": "00.02c"
    },

    # 00.02c
    {
        "id": "00.02c",
        "slug": "00.02c-pre-complete-hook.md",
        "title": "Pre-Complete Interception and Gate Vetoes",
        "queue": 2,
        "depends": "00.02a, 00.02b",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "event/hook plugin",
        "package": "@deepseek-ai/dsh-dev-loop-lifecycle",
        "summary_voice": "Let us consider the final barrier. A worker claims it is done. Should we believe it? Absolutely not. Witness testimony is unreliable. We install the `piece/pre-complete` Cordis waterfall hook. Any registered verification gate may cast an absolute veto if behavioral tests have not run or if claims lack proof. There is a 100% certainty that unverified code is defective.",
        "opt_a": "Synchronous waterfall hook allowing external listeners to abort completion with typed error reasons.",
        "opt_b": "Direct completion without event interception, preventing verification gates from exercising mediation.",
        "scenarios": [
            ("a piece completion request where a gate listener throws a veto error", "complete(pieceId) is called", "the completion is aborted, status remains `pending`, and the veto reason is returned."),
            ("a completion request where all registered listeners pass", "complete(pieceId) is executed", "all listeners execute in sequence and the piece proceeds to completion."),
            ("no listeners are registered for `piece/pre-complete`", "complete(pieceId) is called", "the hook executes as a no-op and completion proceeds.")
        ],
        "harness_fit": "Cordis event hook plugin in `@deepseek-ai/dsh-dev-loop-lifecycle/src/service.ts`. Emits `piece/pre-complete` through `ctx.serial` / `ctx.bail`.",
        "contracts": """```typescript
export interface PreCompletePayload {
  readonly pieceId: string
  readonly workerId: string
  readonly worktreePath?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'piece/pre-complete'(payload: PreCompletePayload): Promise<void | string>
  }
}
```""",
        "deps_text": "00.02a, 00.02b",
        "references": [
            ("packages/dev-loop/lifecycle/src/service.ts", "120-180", "Hook invocation during completion sequence"),
            ("docs/cordis-primer.md", "40-90", "Cordis waterfall and serial event invocation semantics")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/lifecycle/tests/pre-complete.spec.ts",
            "expected": "✓ complete > aborts transition when pre-complete listener returns a veto reason"
        },
        "teach": {
            "voice_intro": "The suspect has presented an alibi. Before releasing them, we must check every forensic corroboration.",
            "what_it_does": "Intercepts completion attempts and queries all registered verification gates before state changes.",
            "background": "In Cordis, `ctx.serial` executes event listeners in order. If any listener throws or returns a veto, the pipeline halts.",
            "how_it_works": "Before moving a piece to `done`, `complete()` invokes `ctx.serial('piece/pre-complete', payload)`. If any hook rejects, completion aborts.",
            "why_this_approach": "Complete mediation: the core lifecycle service does not need to know about specific gates (Format, RED, GREEN, Git); plugins register their own checks.",
            "approaches_considered": "Hardcoded gate checks inside lifecycle (violates separation of concerns) vs Cordis event waterfall (chosen: modular).",
            "prior_art": "Git pre-commit hooks and Linux Netfilter packet filtering chains.",
            "what_we_get_for_free": "Cordis event dispatcher provides lifecycle scoping and automatic unregistration on plugin disposal.",
            "from_the_docs": "AGENTS.md: 'Registrations are effects: every contribution goes through ctx.effect() / ctx.on()'.",
            "what_to_notice": "Notice how the worktree path is passed to listeners so they can inspect disk files directly!",
            "concepts_to_own": "Complete mediation: ensuring every sensitive state transition passes through authorization hooks.",
            "interview_angle": "How do you implement extensible validation pipelines without coupling components? Answer: Event hooks with fail-closed short-circuit semantics.",
            "decisions_alone": "You can add new audit listeners (e.g. metrics recording) without risking false-positive vetoes by ensuring they catch internal errors.",
            "lesson": "Never trust a component that declares itself finished; require independent empirical verification."
        },
        "proof": [
            ("Pre-complete hook executes via Cordis event bus before state change", "packages/dev-loop/lifecycle/src/service.ts:120-180", "direct inspection", "Current checkout"),
            ("Veto tests prove completion aborts on gate rejection", "packages/dev-loop/lifecycle/tests/pre-complete.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Cordis Pre-Action Mediation Hook",
            "what": "Waterfall hook that mediates critical state changes.",
            "usage": "Used in `dsh-dev-loop-lifecycle` for `piece/pre-complete`.",
            "potential": "Can mediate task deletion, deployment, or database migration.",
            "generic": "Standard Cordis event pattern.",
            "evidence": "packages/dev-loop/lifecycle/src/service.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Fires `piece/pre-complete` prior to state change.",
            "Aborts immediately on gate veto.",
            "Passes worktree and piece metadata to listeners."
        ],
        "next_gate": "00.02d"
    },

    # 00.02d
    {
        "id": "00.02d",
        "slug": "00.02d-done-transition.md",
        "title": "Completion Move to `done/` Subdirectory",
        "queue": 2,
        "depends": "00.02a, 00.02b, 00.02c",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-lifecycle",
        "summary_voice": "Yay! Purr~ (=^･ω･^=)🐾 When all the gates pass and the tests are sparkly green, it's time for zoomies! Inspector Cat carries the finished piece file from the active directory into the cozy `done/` basket! We update the header status to `done` and make sure the file is safe and warm. Completed work is visible to everyone!",
        "opt_a": "Physical atomic rename moving piece file into `<set>/done/` and updating header status.",
        "opt_b": "Leave the file in place and only flip a status bit in a database, making progress invisible to directory viewers.",
        "scenarios": [
            ("a verified piece in `plans/pieces/00-dev-loop/00.01-foo.md`", "completePiece is invoked", "it is moved to `plans/pieces/00-dev-loop/done/00.01-foo.md` with status `done`."),
            ("a move where the target file already exists in `done/`", "completePiece runs", "it fails closed and refuses to overwrite without manual human review."),
            ("a completion in a set that doesn't have a `done/` folder yet", "completePiece executes", "it automatically creates the `done/` folder before moving the file.")
        ],
        "harness_fit": "Consumer method on `ctx.devLoopLifecycle` in `@deepseek-ai/dsh-dev-loop-lifecycle/src/service.ts`. Coordinates filesystem mutation with git worktree retirement.",
        "contracts": """```typescript
export interface CompleteOptions {
  readonly updateHeader?: boolean
  readonly emitEvent?: boolean
}

export interface DevLoopLifecycle {
  complete(pieceId: string, options?: CompleteOptions): Promise<string>
}
```""",
        "deps_text": "00.02a, 00.02b, 00.02c",
        "references": [
            ("packages/dev-loop/lifecycle/src/service.ts", "185-250", "File relocation and status update implementation"),
            ("plans/AGENTS.md", "95-130", "Axiom governing `done/` relocation")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/lifecycle/tests/service.spec.ts -t 'complete'",
            "expected": "✓ complete > moves file to done directory and updates Status header"
        },
        "teach": {
            "voice_intro": "Time to put the finished toy in the toybox! Nya~ (=^･ω･^=)",
            "what_it_does": "Physically moves a completed piece file into its set's `done/` subdirectory and rewrites `**Status:** done`.",
            "background": "The R-done-pieces-moved axiom requires completed pieces to live in `done/` so humans can inspect progress at a glance.",
            "how_it_works": "`complete()` checks that all veto hooks passed. It ensures `done/` exists, rewrites `**Status:** done`, and uses `ctx.fs.rename` to move the file.",
            "why_this_approach": "A filesystem move makes status visible immediately to `ls`, file tree explorers, and git status.",
            "approaches_considered": "Database-only status (invisible in git) vs In-place status update (clutters set folder) vs Move to `done/` (chosen: clear separation).",
            "prior_art": "Kanban physical board movement from 'Doing' to 'Done'.",
            "what_we_get_for_free": "Atomic POSIX `rename` prevents half-written files during the move.",
            "from_the_docs": "plans/AGENTS.md: 'A piece that is complete does not stay in the plan set. It moves to a done/ folder, so the remaining plan is always the remaining work.'",
            "what_to_notice": "Notice how the filename and id are preserved so markdown links remain resolvable!",
            "concepts_to_own": "Information radiator: designing system state to be visible passively without querying an API.",
            "interview_angle": "Why design systems where progress is physically reflected in the filesystem? Answer: Transparency, low tooling overhead, and auditable history.",
            "decisions_alone": "You can change the destination folder permissions without altering the file relocation algorithm.",
            "lesson": "Make progress visible so your team can celebrate every victory! Purr~ (=^･ω･^=)"
        },
        "proof": [
            ("Completion physically moves file to done folder", "packages/dev-loop/lifecycle/src/service.ts:185-250", "direct inspection", "Current checkout"),
            ("Integration tests verify move and status rewrite", "packages/dev-loop/lifecycle/tests/service.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Filesystem Milestone Archiver",
            "what": "Moves completed markdown specifications into done subdirectories.",
            "usage": "Lifecycle completion step in `dsh-dev-loop-lifecycle`.",
            "potential": "Can archive completed tasks, batch jobs, or invoices.",
            "generic": "Source and target directory patterns can be parameterized.",
            "evidence": "packages/dev-loop/lifecycle/src/service.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Moves file to `done/` subdirectory safely.",
            "Rewrites header status to `done`.",
            "Emits `piece/completed` event."
        ],
        "next_gate": "00.03a"
    },

    # 00.03a
    {
        "id": "00.03a",
        "slug": "00.03a-presentation-card.md",
        "title": "Markdown Presentation Cards and Human Prompts",
        "queue": 3,
        "depends": "00.01e, 00.02d",
        "lead": "🌸 Mayuri (Gentle Seamstress)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-approval",
        "summary_voice": "Tutturu~ 🌸 Mayuri made a lovely presentation card for you! Before we ask our human developer to approve a piece, we don't want to dump a huge scary file on them. Instead, we fold it into a tidy, friendly card showing the Summary, lead persona, decision choices (Option A vs Option B), and test scenarios! It's as easy as looking at a cafe menu!",
        "opt_a": "Generate concise presentation cards highlighting summary, choices, and BDD scenarios in under 40 lines.",
        "opt_b": "Output the raw 280-line specification directly into chat, overwhelming the human operator.",
        "scenarios": [
            ("a parsed piece record", "renderPresentationCard is invoked", "it formats a concise markdown card containing lead persona, summary, decision options, and scenarios."),
            ("a piece with human decision options A and B", "renderPresentationCard formats the card", "Option A and Option B are clearly demarcated with bold action labels."),
            ("a piece card presented to the UI", "card content is inspected", "it contains clickable links to referenced files and tests.")
        ],
        "harness_fit": "Card presentation generator in `@deepseek-ai/dsh-dev-loop-approval/src/present.ts`. Emits structured cards to `ctx.devLoopApproval`.",
        "contracts": """```typescript
export interface PiecePresentationCard {
  readonly pieceId: string
  readonly title: string
  readonly leadPersona: string
  readonly summary: string
  readonly decisionOptions: { optionA: string; optionB: string }
  readonly markdown: string
}

export function formatPresentationCard(piece: PieceRecord): PiecePresentationCard
```""",
        "deps_text": "00.01e, 00.02d",
        "references": [
            ("packages/dev-loop/approval/src/present.ts", "1-80", "Formatting logic for presentation cards"),
            ("packages/dev-loop/approval/tests/present.spec.ts", "1-60", "Unit tests for markdown presentation cards")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/approval/tests/present.spec.ts",
            "expected": "✓ formatPresentationCard > produces clean markdown card with decision options"
        },
        "teach": {
            "voice_intro": "When presenting your work, always package it with kindness and care! Tutturu~",
            "what_it_does": "Transforms a technical piece into a digestible summary card for the human reviewer.",
            "background": "Cognitive overload causes rubber-stamp approvals. Clear bite-sized cards ensure genuine human oversight.",
            "how_it_works": "Extracts the lead persona, Summary body, Option A/B text, and BDD bullets, formatting them into a structured markdown block.",
            "why_this_approach": "Formatting cards in pure Markdown ensures compatibility across CLI terminals, web UIs, and chat interfaces.",
            "approaches_considered": "Raw JSON dump (unreadable for humans) vs Full document dump (too long) vs Focused card (chosen: optimal clarity).",
            "prior_art": "GitHub Pull Request summary templates and Slack interactive message cards.",
            "what_we_get_for_free": "Markdown links provide instant navigation to source files without custom UI buttons.",
            "from_the_docs": "AGENTS.md: 'Design each tool\\'s UI presentation up front. Host presenters stay pure.'",
            "what_to_notice": "Notice how Option A is labeled as Active and Option B as Alternative, giving the user an instant contrast!",
            "concepts_to_own": "Information distillation: extracting high-signal decision inputs from comprehensive technical specifications.",
            "interview_angle": "How do you design human-in-the-loop interfaces to prevent decision fatigue? Answer: Surface distilled decision diffs rather than full state.",
            "decisions_alone": "You can add emoji accents or custom theme headers without affecting card parsing.",
            "lesson": "Kindness in UI design means respecting your reviewer's time and attention! 🌸"
        },
        "proof": [
            ("Card generator extracts decision points and scenarios cleanly", "packages/dev-loop/approval/src/present.ts:20-65", "direct inspection", "Current checkout"),
            ("Presentation card unit tests pass with 100% snapshot match", "packages/dev-loop/approval/tests/present.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Bite-Sized Specification Card Presenter",
            "what": "Extracts and formats decision cards from markdown specs.",
            "usage": "Used by `dsh-dev-loop-approval`.",
            "potential": "Can present RFC reviews, code review summaries, or architecture proposals.",
            "generic": "Card template can be customized with different section extractors.",
            "evidence": "packages/dev-loop/approval/src/present.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Renders summary, persona, and options clearly.",
            "Card length is under 50 lines.",
            "Includes links to references and tests."
        ],
        "next_gate": "00.03b"
    },

    # 00.03b
    {
        "id": "00.03b",
        "slug": "00.03b-user-questions.md",
        "title": "Human Clarification Roundtrip",
        "queue": 3,
        "depends": "00.03a",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "model-facing tool",
        "package": "@deepseek-ai/dsh-dev-loop-approval",
        "summary_voice": "If any specification parameter is ambiguous, an autonomous agent must never assume or guess. To guess is to introduce a 91% error rate into the case. We provide the `ask_clarification` tool. When questions arise regarding design tradeoffs or constraints, execution suspends until the human operator responds. Evidence must be corroborated by the authority.",
        "opt_a": "Suspend execution and query the human via typed prompt schema, recording the response in the session log.",
        "opt_b": "Make an autonomous probabilistic guess and proceed without human confirmation.",
        "scenarios": [
            ("an ambiguous requirement in a piece specification", "ask_clarification is called by the agent", "the query is surfaced to the human and agent execution pauses."),
            ("the human provides a written clarification response", "the user submits response", "agent execution resumes with the response payload injected into turn context."),
            ("the human rejects the clarification or cancels", "user aborts prompt", "agent enters halted state with `ClarificationRejected`.")
        ],
        "harness_fit": "Model-facing tool registered under `ctx.devLoopApproval` in `@deepseek-ai/dsh-dev-loop-approval/src/tool.ts` using Cordis `ctx.tools`.",
        "contracts": """```typescript
export interface ClarificationQuestion {
  readonly pieceId: string
  readonly question: string
  readonly options?: readonly string[]
}

export interface ClarificationResponse {
  readonly answer: string
  readonly timestamp: number
}
```""",
        "deps_text": "00.03a",
        "references": [
            ("packages/dev-loop/approval/src/tool.ts", "1-70", "Model tool definition for `ask_clarification`"),
            ("packages/interaction/ask-user/src/index.ts", "1-80", "Underlying Harness ask-user interaction capability")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/approval/tests/clarification.spec.ts",
            "expected": "✓ ask_clarification > suspends agent execution until user provides input"
        },
        "teach": {
            "voice_intro": "When deduction reaches an epistemic boundary, the detective consults the commissioner. Never extrapolate beyond known facts.",
            "what_it_does": "Allows agents to pause and prompt the user for clarifications on piece requirements.",
            "background": "DSH provides native interaction tools (`ask_user`). This micro-gate binds that capability to the Dev Loop approval workflow.",
            "how_it_works": "The model invokes `dev_loop_ask_clarification`. The tool delegates to `ctx.interaction` and awaits the user's resolve callback.",
            "why_this_approach": "Suspending cleanly preserves the agent's turn budget and prevents hallucinated requirements from contaminating git worktrees.",
            "approaches_considered": "Agent halluncination/guessing (rejected: causes bugs) vs Infinite retry loop (rejected: burns tokens) vs Clean suspension (chosen).",
            "prior_art": "Elixir/Erlang GenServer call with timeout and human-in-the-loop workflow approvals.",
            "what_we_get_for_free": "Harness's `ask-user` plugin provides input validation, timeout handling, and TUI/Web rendering.",
            "from_the_docs": "AGENTS.md: 'Model-visible ⟺ logged: anything that reaches a model request must be reconstructable from the session log.'",
            "what_to_notice": "Notice how user answers are logged as session events so subsequent replays remain fully deterministic!",
            "concepts_to_own": "Epistemic humility in AI systems: recognising when information is absent and suspending rather than fabricating.",
            "interview_angle": "How do you handle ambiguous inputs in autonomous agent architectures? Answer: Implement human-in-the-loop interruption primitives.",
            "decisions_alone": "You can configure default timeout durations for human clarification requests.",
            "lesson": "Never guess when you can verify. A single clarification prevents days of debugging."
        },
        "proof": [
            ("Clarification tool pauses execution and awaits human response", "packages/dev-loop/approval/src/tool.ts:15-60", "direct inspection", "Current checkout"),
            ("Tests verify response injection into agent context", "packages/dev-loop/approval/tests/clarification.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Human-in-the-Loop Clarification Gate",
            "what": "Model-facing prompt that suspends execution for human input.",
            "usage": "Approval junction in `dsh-dev-loop-approval`.",
            "potential": "Can be used in planning mode, deployment approvals, or security reviews.",
            "generic": "Payload is generic over question and option strings.",
            "evidence": "packages/dev-loop/approval/src/tool.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Suspends turn execution gracefully.",
            "Logs user response into durable session history.",
            "Passes answer back to calling agent cleanly."
        ],
        "next_gate": "00.03c"
    },

    # 00.03c
    {
        "id": "00.03c",
        "slug": "00.03c-digest-authorization.md",
        "title": "Content-Digest Gated Authorization",
        "queue": 3,
        "depends": "00.03a, 00.03b",
        "lead": "💻 Daru (Super Hacker)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-approval",
        "summary_voice": "Alright, listen up. Here's how hackers exploit approval systems: the user approves version A of a spec, but right before execution, a rogue script swaps in version B! Classic Time-of-Check to Time-of-Use (TOCTOU) vulnerability! To stop that nonsense, our approval requires a SHA-256 content digest. If the file changes by even one byte after approval, the hash fails and execution halts. Bulletproof security!",
        "opt_a": "Bind approval tokens strictly to SHA-256 digest of piece file content at approval time.",
        "opt_b": "Approve by piece ID alone, allowing unreviewed file edits to execute without re-authorization.",
        "scenarios": [
            ("an approval command provided with exact matching SHA-256 digest", "authorize(pieceId, digest) is called", "the piece is marked authorized for dispatch."),
            ("an approval command where file content was modified after hash generation", "authorize(pieceId, staleDigest) runs", "it rejects with `DigestMismatchError`."),
            ("an approval attempt on an unknown piece id", "authorize('99.99', hash) is executed", "it rejects fail-closed with `PieceNotFoundError`.")
        ],
        "harness_fit": "Service Provider method on `ctx.devLoopApproval` in `@deepseek-ai/dsh-dev-loop-approval/src/service.ts`.",
        "contracts": """```typescript
export interface AuthorizationToken {
  readonly pieceId: string
  readonly digest: string
  readonly approvedAt: number
  readonly approvedBy: string
}

export interface DevLoopApproval {
  computeDigest(content: string): string
  authorize(pieceId: string, expectedDigest: string): Promise<AuthorizationToken>
}
```""",
        "deps_text": "00.03a, 00.03b",
        "references": [
            ("packages/dev-loop/approval/src/service.ts", "1-90", "Implementation of digest computation and authorization checks"),
            ("packages/dev-loop/approval/tests/approval.spec.ts", "1-80", "Unit tests for SHA-256 content digest gating")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/approval/tests/approval.spec.ts -t 'digest'",
            "expected": "✓ authorize > approves matching digest and rejects modified content"
        },
        "teach": {
            "voice_intro": "Time of Check vs Time of Use. If you don't understand TOCTOU bugs, script kiddies will own your pipeline.",
            "what_it_does": "Guarantees that what the human approved is byte-for-byte identical to what the workers build.",
            "background": "TOCTOU occurs when a resource changes between when permissions are validated and when the action is executed.",
            "how_it_works": "`computeDigest` creates a SHA-256 hex string of the piece text. When the user approves (`/dev-loop approve <id> <hash>`), the hashes must match.",
            "why_this_approach": "Cryptographic hashing eliminates all ambiguity about which revision the user saw and approved.",
            "approaches_considered": "Approve by ID only (vulnerable to TOCTOU) vs Git commit hash (fails on uncommitted edits) vs Content SHA-256 (chosen: immediate and exact).",
            "prior_art": "Subresource Integrity (SRI) in web browsers and Git tree hashing.",
            "what_we_get_for_free": "Node's built-in `node:crypto` provides fast, hardware-accelerated SHA-256 calculation.",
            "from_the_docs": "AGENTS.md: 'Misconfiguration fails loud at load when self-contained... Explicit > implicit at package boundaries.'",
            "what_to_notice": "Notice how the authorization token stores the digest, timestamp, and user identity for the audit log!",
            "concepts_to_own": "Cryptographic authorization token: a capability tied immutably to a content fingerprint.",
            "interview_angle": "How do you prevent TOCTOU vulnerabilities in asynchronous approval systems? Answer: Cryptographic content digests passed as an authorization precondition.",
            "decisions_alone": "You can change the hash truncation length for UI display (e.g. first 8 chars) while keeping the full 256 bits internally.",
            "lesson": "Never authorize an object by name alone when its contents can change. Hash everything!"
        },
        "proof": [
            ("Digest computation uses SHA-256 over exact file bytes", "packages/dev-loop/approval/src/service.ts:25-45", "direct inspection", "Current checkout"),
            ("Digest verification rejects modified files deterministically", "packages/dev-loop/approval/tests/approval.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "SHA-256 Content-Digest Authorizer",
            "what": "Authorizes actions based on strict content hash matching.",
            "usage": "Used in `dsh-dev-loop-approval`.",
            "potential": "Can protect deployment scripts, configuration files, and DB migration plans.",
            "generic": "Works with any string content and hash algorithm.",
            "evidence": "packages/dev-loop/approval/src/service.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Computes deterministic SHA-256 digest.",
            "Authorizes matching content cleanly.",
            "Rejects modified content with explicit mismatch error."
        ],
        "next_gate": "00.04a"
    }
]
