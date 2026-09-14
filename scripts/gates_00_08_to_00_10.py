"""
Micro-gates 00.08a to 00.10d (10 gates)
"""

GATES_00_08_TO_00_10 = [
    # 00.08a
    {
        "id": "00.08a",
        "slug": "00.08a-reference-table-ast.md",
        "title": "Reference Markdown Table Parsing",
        "queue": 8,
        "depends": "00.06d",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "done",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-references",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Inspector Cat is checking the citation footnotes! Every piece has a `## References` section with a neat markdown table listing files, line ranges, and summaries. We parse the pipes and headers into clean ReferenceRow objects so our detective friends can verify them. No messy scratched-up tables allowed!",
        "opt_a": "Parse markdown table rows with pipe delimiters, stripping outer pipes and trimming whitespace cleanly.",
        "opt_b": "Parse table rows with regex that breaks whenever a code span contains an escaped pipe `\\|`.",
        "scenarios": [
            ("a `## References` markdown table with 3 rows", "parseReferences is invoked", "it returns 3 structured ReferenceRow objects with file, lines, and summary."),
            ("a table row containing an escaped pipe inside backticks", "parseReferences parses the row", "it preserves the escaped pipe as content and does not split into extra columns."),
            ("a piece section with no table rows", "parseReferences is called", "it returns an empty array.")
        ],
        "harness_fit": "Pure parser in `@deepseek-ai/dsh-dev-loop-references/src/parse.ts`. Feeds parsed citation rows into `ctx.devLoopReferences`.",
        "contracts": """```typescript
export interface ReferenceRow {
  readonly file: string
  readonly lines?: string
  readonly summary: string
}

export function parseReferenceTable(content: string): readonly ReferenceRow[]
```""",
        "deps_text": "00.06d",
        "references": [
            ("packages/dev-loop/references/src/parse.ts", "1-70", "Implementation of reference table parser"),
            ("packages/dev-loop/references/tests/parse.spec.ts", "1-65", "Table parsing unit tests with escaped pipes")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/references/tests/parse.spec.ts",
            "expected": "✓ parseReferenceTable > extracts table rows cleanly and preserves escaped pipes"
        },
        "teach": {
            "voice_intro": "Time to organize our cat-alog! Let's see how markdown tables turn into neat data rows! Purr~",
            "what_it_does": "Extracts file paths, line ranges, and descriptions from markdown tables in the References section.",
            "background": "Markdown tables use `|` delimiters. Parsing them naively with `line.split('|')` breaks on escaped pipes (`\\|`).",
            "how_it_works": "The parser uses negative lookbehind `/(?<!\\\\)\\|/` to split only on unescaped pipe characters, trimming each cell.",
            "why_this_approach": "Ensures code citations containing TypeScript union types (`string \\| undefined`) parse into exactly 3 columns.",
            "approaches_considered": "Naive string split (breaks on escaped pipe) vs Full CommonMark AST (heavy) vs Regex negative lookbehind (chosen: lean and robust).",
            "prior_art": "GitHub Flavored Markdown (GFM) table specification §4.10.",
            "what_we_get_for_free": "Regular expressions with negative lookbehind are natively supported and fast in V8.",
            "from_the_docs": "scripts/check-pieces.ts: 'Only an unescaped pipe delimits a cell... interior empty cells are preserved.'",
            "what_to_notice": "Notice how column headers (`File | Lines | Summary`) and delimiter dashes are skipped automatically!",
            "concepts_to_own": "Escaped delimiter tokenization: distinguishing structural syntax delimiters from escaped payload text.",
            "interview_angle": "How do you parse pipe-delimited tables when column values can contain pipes? Answer: Split on regex negative lookbehind for backslash escapes.",
            "decisions_alone": "You can add optional extra columns (e.g. `Author`) by updating the row interface and column index mapping.",
            "lesson": "Always respect escape characters when parsing delimited text! Purr~ (=^･ω･^=)"
        },
        "proof": [
            ("Table parser handles escaped pipes and column trimming", "packages/dev-loop/references/src/parse.ts:20-55", "direct inspection", "Current checkout"),
            ("Parser test suite passes with diverse table inputs", "packages/dev-loop/references/tests/parse.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Escaped Pipe Markdown Table Parser",
            "what": "Extracts structured rows from markdown tables with pipe escapes.",
            "usage": "Used in `dsh-dev-loop-references` and `scripts/check-pieces.ts`.",
            "potential": "Can parse any GFM table in documentation.",
            "generic": "Usable for any markdown table with arbitrary columns.",
            "evidence": "packages/dev-loop/references/src/parse.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Parses 3-column reference tables accurately.",
            "Handles escaped pipe characters safely.",
            "Skips header rows and separator lines."
        ],
        "next_gate": "00.08b"
    },

    # 00.08b
    {
        "id": "00.08b",
        "slug": "00.08b-locator-containment.md",
        "title": "Subpath Containment and Citation Verification",
        "queue": 8,
        "depends": "00.08a",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-references",
        "summary_voice": "Let us scrutinize the citations. When a piece cites a file and line range (`packages/foo.ts:1-50`), does that file actually exist? Does it lie within the workspace bounds, or is it an path traversal attack (`../../etc/passwd`)? We enforce strict subpath containment and verify physical existence. Fabricated references will not be admitted.",
        "opt_a": "Canonicalize paths and verify strict subpath containment within repository root.",
        "opt_b": "Accept unvalidated paths, exposing the system to directory traversal vulnerabilities.",
        "scenarios": [
            ("a cited file path within the repository root that exists on disk", "verifyLocator is called", "it resolves the canonical path and confirms containment."),
            ("a path citation containing traversal tokens like `../../outside.txt`", "verifyLocator runs", "it rejects fail-closed with `PathTraversalError`."),
            ("a valid path citation pointing to a nonexistent file", "verifyLocator executes", "it reports a missing reference finding.")
        ],
        "harness_fit": "Service Provider method on `ctx.devLoopReferences` in `@deepseek-ai/dsh-dev-loop-references/src/locator.ts`.",
        "contracts": """```typescript
export interface LocatorCheckResult {
  readonly path: string
  readonly exists: boolean
  readonly contained: boolean
  readonly canonicalPath?: string
}

export function verifyLocator(baseDir: string, relativePath: string): Promise<LocatorCheckResult>
```""",
        "deps_text": "00.08a",
        "references": [
            ("packages/dev-loop/references/src/locator.ts", "1-80", "Path normalization and containment verification"),
            ("packages/dev-loop/references/tests/locator.spec.ts", "1-70", "Subpath containment and traversal security tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/references/tests/locator.spec.ts",
            "expected": "✓ verifyLocator > enforces subpath containment and rejects traversal"
        },
        "teach": {
            "voice_intro": "The suspect claims to have been at a specific address. We must check the map and verify the location exists.",
            "what_it_does": "Ensures cited file paths exist and do not escape the repository boundary via `..` traversal.",
            "background": "Path traversal (CWE-22) occurs when untrusted path strings access files outside the intended root directory.",
            "how_it_works": "`verifyLocator` resolves `path.resolve(baseDir, relativePath)`. It verifies the resolved path starts with `baseDir + path.sep`.",
            "why_this_approach": "Canonical prefix checking is the industry standard defense against directory traversal.",
            "approaches_considered": "Naive substring check (vulnerable to `/root-secret` prefix collisions) vs Canonical prefix with path.sep (chosen: secure).",
            "prior_art": "Node.js path resolution security guidelines and chroot containment.",
            "what_we_get_for_free": "Node's `path.resolve` normalizes `.` and `..` segments reliably across platforms.",
            "from_the_docs": "AGENTS.md: 'Misconfiguration fails loud at load when self-contained... validate at parser/config boundaries.'",
            "what_to_notice": "Notice the trailing separator check: `/workspace` must not match `/workspace-sibling`!",
            "concepts_to_own": "Path containment verification: proving that a computed filesystem path remains strictly within a designated root.",
            "interview_angle": "How do you prevent path traversal attacks in file-serving APIs? Answer: Canonicalize path, verify it begins with root directory followed by a path separator.",
            "decisions_alone": "You can allow symlinks to be resolved or rejected based on a configurable `followSymlinks` option.",
            "lesson": "Never trust an uncanonicalized path. Bounds checking is the first duty of security."
        },
        "proof": [
            ("Locator checks containment using trailing path separator", "packages/dev-loop/references/src/locator.ts:25-50", "direct inspection", "Current checkout"),
            ("Security tests verify rejection of parent traversal attacks", "packages/dev-loop/references/tests/locator.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Subpath Containment Verifier",
            "what": "Validates that a path stays inside a base root directory.",
            "usage": "Used in `dsh-dev-loop-references` and filesystem tools.",
            "potential": "Can secure file upload handlers, artifact exporters, and template loaders.",
            "generic": "Pure path utility function.",
            "evidence": "packages/dev-loop/references/src/locator.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Normalizes file locators safely.",
            "Rejects path traversal attempts fail-closed.",
            "Confirms physical file existence."
        ],
        "next_gate": "00.08c"
    },

    # 00.08c
    {
        "id": "00.08c",
        "slug": "00.08c-provenance-store.md",
        "title": "Provenance Verification Engine",
        "queue": 8,
        "depends": "00.08a, 00.08b",
        "lead": "🍰 L (Forensic Detective)",
        "status": "done",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-references",
        "summary_voice": "Let us complete the provenance circuit. A reference is not merely a path; it is an evidentiary claim. The Provenance Engine verifies all citations in a piece, cross-referencing file hashes and line ranges against repository HEAD. It returns an audited verification report. If a citation points to phantom lines or a drifted file, the report flags it as unproven.",
        "opt_a": "Verify all piece references against live disk, recording verified line count and file hashes.",
        "opt_b": "Assume all references are valid without reading disk, allowing citation rot to accumulate.",
        "scenarios": [
            ("a piece with 5 valid references to repository files", "verifyReferences(pieceId) is called", "it confirms all 5 references and returns an all-valid report."),
            ("a reference citing lines 100-120 in a file that only has 50 lines", "verifyReferences runs", "it flags the reference with `LineRangeOutOfBounds`."),
            ("a reference citing an external URL", "verifyReferences evaluates external link", "it validates URL format and marks it as external citation.")
        ],
        "harness_fit": "Consumer engine on `ctx.devLoopReferences` in `@deepseek-ai/dsh-dev-loop-references/src/engine.ts`.",
        "contracts": """```typescript
export interface ReferenceReport {
  readonly pieceId: string
  readonly totalReferences: number
  readonly validCount: number
  readonly missing: readonly string[]
  readonly isAdmissible: boolean
}

export interface DevLoopReferences {
  verifyReferences(pieceId: string): Promise<ReferenceReport>
}
```""",
        "deps_text": "00.08a, 00.08b",
        "references": [
            ("packages/dev-loop/references/src/engine.ts", "1-100", "Reference audit and provenance verification"),
            ("packages/dev-loop/references/tests/engine.spec.ts", "1-90", "Integration tests verifying references on disk")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/references/tests/engine.spec.ts",
            "expected": "✓ verifyReferences > reports complete admissible verification report"
        },
        "teach": {
            "voice_intro": "In court, every exhibit must be verified against original source evidence. Let us inspect the verification engine.",
            "what_it_does": "Checks all references in a piece against the repository filesystem and produces an evidentiary audit report.",
            "background": "Documentation and plan drift occur when code changes but references remain pointing to stale line numbers.",
            "how_it_works": "Parses the table, runs `verifyLocator` for each row, reads file line counts, and verifies that cited ranges exist.",
            "why_this_approach": "Automated verification eliminates stale citations before human review, keeping the plan set fresh.",
            "approaches_considered": "Manual link checking (tedious, error-prone) vs Automated verification engine (chosen: continuous proof).",
            "prior_art": "LaTeX BibTeX citation verification and Markdown dead-link checkers.",
            "what_we_get_for_free": "`ctx.fs` allows the engine to run against the mainline or an isolated worktree.",
            "from_the_docs": "AGENTS.md: 'No document may claim an agent was invoked, a source was inspected... unless it actually happened.'",
            "what_to_notice": "Notice how `isAdmissible` is true ONLY if missing count is 0!",
            "concepts_to_own": "Evidentiary admissibility: requiring all supporting citations to be corroborated before accepting an argument.",
            "interview_angle": "How do you prevent documentation and reference drift in fast-moving codebases? Answer: Continuous citation verification gates that fail build on broken locators.",
            "decisions_alone": "You can configure whether line-number drift triggers a warning or a blocking rejection.",
            "lesson": "Trust only what can be verified against physical evidence."
        },
        "proof": [
            ("Provenance engine verifies cited ranges against real line counts", "packages/dev-loop/references/src/engine.ts:35-80", "direct inspection", "Current checkout"),
            ("Engine test suite validates report admissibility calculation", "packages/dev-loop/references/tests/engine.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Evidentiary Reference Audit Engine",
            "what": "Verifies markdown file and line references against disk.",
            "usage": "Used in `dsh-dev-loop-references`.",
            "potential": "Can audit citations across all markdown docs and PR descriptions.",
            "generic": "Works with any directory of markdown files.",
            "evidence": "packages/dev-loop/references/src/engine.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Audits all table citations.",
            "Flags missing files or line range overflows.",
            "Calculates admissibility fail-closed."
        ],
        "next_gate": "00.09a"
    },

    # 00.09a
    {
        "id": "00.09a",
        "slug": "00.09a-bdd-extractor.md",
        "title": "BDD Scenario Heading and Bullet AST Parser",
        "queue": 9,
        "depends": "00.01e, 00.08c",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "todo",
        "primitive": "Service Definition",
        "package": "@deepseek-ai/dsh-dev-loop-test-handoff",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Let's find the game rules! Every piece has a `## Behaviour` section with shiny Given/When/Then bullet points! Inspector Cat parses those bullets into structured test scenarios so our Test Writer can author failing tests before anyone touches code. TDD is the happiest way to build software!",
        "opt_a": "Extract Given/When/Then scenario triplets using explicit bullet marker parsing.",
        "opt_b": "Allow freeform prose without Given/When/Then markers, making behavioral testing ambiguous.",
        "scenarios": [
            ("a `## Behaviour` section with 3 valid Given/When/Then bullets", "extractScenarios is called", "it returns 3 PieceScenario objects with given, when, and then fields."),
            ("a bullet that omits the **Then** clause", "extractScenarios parses the section", "it reports a malformed scenario warning."),
            ("a piece with zero behavioral scenarios", "extractScenarios runs", "it reports a blocker finding requiring at least one BDD scenario.")
        ],
        "harness_fit": "Pure parser in `@deepseek-ai/dsh-dev-loop-test-handoff/src/extract.ts`. Feeds test scenarios to `ctx.devLoopTestHandoff`.",
        "contracts": """```typescript
export interface PieceScenario {
  readonly given: string
  readonly when: string
  readonly then: string
}

export function extractScenarios(content: string): readonly PieceScenario[]
```""",
        "deps_text": "00.01e, 00.08c",
        "references": [
            ("packages/dev-loop/test-handoff/src/extract.ts", "1-75", "BDD scenario parser implementation"),
            ("packages/dev-loop/test-handoff/tests/extract.spec.ts", "1-60", "Unit tests for scenario extraction")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/test-handoff/tests/extract.spec.ts",
            "expected": "✓ extractScenarios > extracts Given/When/Then triplets cleanly"
        },
        "teach": {
            "voice_intro": "How do we know what a program should do? We write the rules in plain English first! Nya~",
            "what_it_does": "Parses BDD scenarios from markdown so automated test runners can generate test stubs.",
            "background": "Behavior-Driven Development (BDD) uses Given (precondition), When (action), and Then (expected result) to define acceptance criteria.",
            "how_it_works": "Scans lines in `## Behaviour`. Looks for `- **Given** `, locates ` **When** ` and ` **Then** `, and extracts the text between them.",
            "why_this_approach": "Enforces clear behavioral thinking without requiring complex Cucumber Gherkin parsers.",
            "approaches_considered": "Full Gherkin parser (heavy, outside dependency) vs Freeform text (unstructured) vs Markdown BDD triplets (chosen: clean and native).",
            "prior_art": "Cucumber, Dan North's BDD specification, and Vitest test scenario runners.",
            "what_we_get_for_free": "Standard markdown list formatting renders beautifully on GitHub and in terminals.",
            "from_the_docs": "plans/AGENTS.md: 'Every piece carries: Summary, Behaviour (Given/When/Then), Harness fit...'",
            "what_to_notice": "Notice how each clause is trimmed so whitespace around bold markers is cleaned up!",
            "concepts_to_own": "Specification by example: using concrete scenarios to communicate requirements unambiguously.",
            "interview_angle": "How do you bridge the gap between product requirements and automated unit tests? Answer: BDD Given/When/Then scenarios parsed into test suites.",
            "decisions_alone": "You can add support for `And` continuation clauses in scenarios.",
            "lesson": "Define the behavior before writing the code, and bugs will have nowhere to hide! Purr~"
        },
        "proof": [
            ("Scenario extractor validates presence of Given, When, and Then clauses", "packages/dev-loop/test-handoff/src/extract.ts:20-55", "direct inspection", "Current checkout"),
            ("Extraction tests verify triplet extraction across edge cases", "packages/dev-loop/test-handoff/tests/extract.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Markdown BDD Triplet Extractor",
            "what": "Parses Given/When/Then scenarios from markdown lists.",
            "usage": "Used in `dsh-dev-loop-test-handoff`.",
            "potential": "Can generate automated test scaffolding from user stories.",
            "generic": "Pure string parsing function.",
            "evidence": "packages/dev-loop/test-handoff/src/extract.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Extracts Given, When, Then clauses.",
            "Enforces at least one scenario per piece.",
            "Returns structured scenario array."
        ],
        "next_gate": "00.09b"
    },

    # 00.09b
    {
        "id": "00.09b",
        "slug": "00.09b-behavioral-red-runner.md",
        "title": "Behavioral RED Baseline Test Execution",
        "queue": 9,
        "depends": "00.09a",
        "lead": "💻 Daru (Super Hacker)",
        "status": "todo",
        "primitive": "Service Provider",
        "package": "@deepseek-ai/dsh-dev-loop-test-handoff",
        "summary_voice": "Listen up, noobs! Anyone can write a test that passes because it tests nothing (`expect(true).toBe(true)` LOL). True hackers require a real RED baseline. The Test Writer writes test files targeting the unwritten code, and we RUN them. They MUST fail on assertion errors, NOT on syntax crashes or missing imports. That proves the test actually exercises the target behavior!",
        "opt_a": "Execute test suite in isolated worktree and verify failure is caused by behavioral assertion errors.",
        "opt_b": "Accept test files without executing them, letting syntax errors or trivial passes slip into master.",
        "scenarios": [
            ("a freshly authored test suite that fails with `AssertionError: expected false to be true`", "runBaseline(worktree) is executed", "it confirms a valid behavioral RED baseline."),
            ("a test suite that fails because of a TypeScript syntax error or missing module import", "runBaseline runs", "it rejects the baseline with `SetupFailureError`."),
            ("a test suite where all tests unexpectedly pass before implementation", "runBaseline runs", "it rejects with `VacuousPassError`.")
        ],
        "harness_fit": "Service Provider method on `ctx.devLoopTestHandoff` in `@deepseek-ai/dsh-dev-loop-test-handoff/src/runner.ts`.",
        "contracts": """```typescript
export interface RedBaselineResult {
  readonly totalTests: number
  readonly failedCount: number
  readonly isBehavioralRed: boolean
  readonly failureOutput: string
}

export interface DevLoopTestHandoff {
  runBaseline(worktreePath: string, testFiles: readonly string[]): Promise<RedBaselineResult>
}
```""",
        "deps_text": "00.09a",
        "references": [
            ("packages/dev-loop/test-handoff/src/runner.ts", "1-110", "Test runner execution and output analysis"),
            ("packages/dev-loop/test-handoff/tests/runner.spec.ts", "1-80", "Behavioral RED classification tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/test-handoff/tests/runner.spec.ts",
            "expected": "✓ runBaseline > distinguishes assertion failures from syntax errors"
        },
        "teach": {
            "voice_intro": "Exit code 1 doesn't automatically mean RED. If node crashed, your test isn't red; it's broken. Learn the difference.",
            "what_it_does": "Executes the newly authored test files to confirm they fail exclusively on genuine assertions.",
            "background": "A vacuous test is one that passes even when the feature is completely absent. A broken test fails to compile.",
            "how_it_works": "Spawns Vitest with the new test files. Inspects stdout/stderr and JSON reporter. Requires exit code non-zero with `AssertionError`.",
            "why_this_approach": "Guarantees that when the Implementer later gets the tests green, real functionality was actually created.",
            "approaches_considered": "Static AST analysis of tests (cannot prove runtime failure) vs Real execution under Vitest (chosen: empirical proof).",
            "prior_art": "Mutation testing (Stryker) and TDD red-phase enforcement.",
            "what_we_get_for_free": "Vitest JSON reporter provides machine-readable test failure reasons and call stacks.",
            "from_the_docs": "docs/testing.md: 'Tests describe behavior, not correctness... match evidence to the surface.'",
            "what_to_notice": "Notice how syntax errors and import errors are rejected immediately so the Test Writer must fix setup!",
            "concepts_to_own": "Behavioral failure vs Setup failure: proving a test asserts intended semantics rather than accidental breakage.",
            "interview_angle": "How do you automate verification that a test suite is not vacuous in an autonomous coding agent? Answer: Execute test before implementation, verify assertion failures.",
            "decisions_alone": "You can configure test timeout limits during baseline execution.",
            "lesson": "A green test is only as trustworthy as the red baseline that preceded it. Hack with proof!"
        },
        "proof": [
            ("Runner parses test failures and classifies assertion errors", "packages/dev-loop/test-handoff/src/runner.ts:35-75", "direct inspection", "Current checkout"),
            ("Runner tests prove rejection of syntax errors and vacuous passes", "packages/dev-loop/test-handoff/tests/runner.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Behavioral RED Baseline Validator",
            "what": "Verifies that tests fail on assertions before coding starts.",
            "usage": "Used in `dsh-dev-loop-test-handoff`.",
            "potential": "Can gate pull requests or verify student assignments.",
            "generic": "Can adapt to any test runner that outputs JSON.",
            "evidence": "packages/dev-loop/test-handoff/src/runner.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Runs tests in isolated worktree.",
            "Confirms behavioral assertion failures.",
            "Rejects compile errors and vacuous passes."
        ],
        "next_gate": "00.09c"
    },

    # 00.09c
    {
        "id": "00.09c",
        "slug": "00.09c-test-file-freezer.md",
        "title": "Cryptographic SHA-256 Test Freezing",
        "queue": 9,
        "depends": "00.09a, 00.09b",
        "lead": "💻 Daru (Super Hacker)",
        "status": "todo",
        "primitive": "Consumer",
        "package": "@deepseek-ai/dsh-dev-loop-test-handoff",
        "summary_voice": "Yo! Here's the dirtiest trick in programming: an implementer can't get a hard test to pass, so they just delete the test or weaken the assertion! Not happening here. Once the Test Writer establishes the RED baseline, Daru calculates a SHA-256 hash of every single test file and freezes it in `SHA256SUMS` and `RED.md`. If the Implementer touches the test files, the gate explodes! Pure anti-cheat protection!",
        "opt_a": "Freeze test files with cryptographic SHA-256 hashes recorded in worktree metadata before implementer handoff.",
        "opt_b": "Allow implementers to edit test files during implementation, permitting tests to be weakened to pass.",
        "scenarios": [
            ("a verified RED test suite", "freezeTests(worktree, testFiles) is called", "it writes SHA256SUMS and RED.md into the test directory."),
            ("an implementer attempting to complete work after modifying a frozen test file", "verifyFrozenTests runs", "it detects hash mismatch and rejects completion."),
            ("an implementer who modified only production code without touching test files", "verifyFrozenTests runs", "it verifies matching hashes and permits completion.")
        ],
        "harness_fit": "Consumer in `@deepseek-ai/dsh-dev-loop-test-handoff/src/freeze.ts`. Feeds frozen hashes to `ctx.devLoopGates`.",
        "contracts": """```typescript
export interface TestFreezeRecord {
  readonly testFiles: readonly string[]
  readonly hashes: Record<string, string>
  readonly frozenAt: number
  readonly redEvidenceHash: string
}

export function freezeTests(worktreePath: string, files: readonly string[]): Promise<TestFreezeRecord>
export function verifyFrozenTests(worktreePath: string, record: TestFreezeRecord): Promise<boolean>
```""",
        "deps_text": "00.09a, 00.09b",
        "references": [
            ("packages/dev-loop/test-handoff/src/freeze.ts", "1-85", "SHA-256 hash computation and freeze file writer"),
            ("packages/dev-loop/test-handoff/tests/freeze.spec.ts", "1-70", "Test file tamper-detection unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/test-handoff/tests/freeze.spec.ts",
            "expected": "✓ verifyFrozenTests > detects unauthorized test file modifications"
        },
        "teach": {
            "voice_intro": "Anti-cheat 101: Never let the student grade their own test paper. Freeze the exam before giving them the pencil.",
            "what_it_does": "Hashes test files using SHA-256 and locks them so implementers cannot tamper with test expectations.",
            "background": "The No Unproven Done invariant requires tests to be independent of the implementation.",
            "how_it_works": "Reads test files, hashes each with `crypto.createHash('sha256')`, and commits the manifest to `SHA256SUMS`.",
            "why_this_approach": "Cryptographic guarantees prevent subagent self-dealing or prompt-drift shortcuts.",
            "approaches_considered": "Git file permissions (unreliable in user space) vs Read-only filesystem mount (complex) vs SHA-256 manifest verification (chosen: simple and foolproof).",
            "prior_art": "Debian package checksums (`md5sums`) and Git commit tree integrity.",
            "what_we_get_for_free": "Node's crypto module calculates hashes in microseconds.",
            "from_the_docs": "AGENTS.md: 'Tests describe behavior, not correctness... Production review, coverage, documentation ownership... still required.'",
            "what_to_notice": "Notice that `RED.md` also logs the failing test output as human-readable evidence!",
            "concepts_to_own": "Integrity manifest: a signed list of cryptographic fingerprints protecting files from unauthorized alteration.",
            "interview_angle": "How do you enforce TDD invariants in multi-agent systems? Answer: Cryptographically freeze test files after red baseline before dispatching implementer.",
            "decisions_alone": "You can add extra metadata fields (e.g. author agent ID) to `RED.md` without invalidating the checksums.",
            "lesson": "Lock your tests before writing code. A test you can edit to make green is not a test."
        },
        "proof": [
            ("Freezer computes SHA-256 manifest and writes SHA256SUMS", "packages/dev-loop/test-handoff/src/freeze.ts:25-60", "direct inspection", "Current checkout"),
            ("Tamper tests prove hash mismatch on single-byte test mutation", "packages/dev-loop/test-handoff/tests/freeze.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "SHA-256 Test File Integrity Freezer",
            "what": "Freezes test files and detects modifications via cryptographic hashes.",
            "usage": "Used in `dsh-dev-loop-test-handoff`.",
            "potential": "Can protect grading suites, compliance checks, or benchmark scripts.",
            "generic": "Usable for any set of files.",
            "evidence": "packages/dev-loop/test-handoff/src/freeze.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Computes SHA-256 hashes for all test files.",
            "Writes `SHA256SUMS` and `RED.md`.",
            "Detects and rejects test file tampering."
        ],
        "next_gate": "00.10a"
    },

    # 00.10a
    {
        "id": "00.10a",
        "slug": "00.10a-format-axiom-gate.md",
        "title": "Gate 1: Markdown Syntax & Axiom Conformance",
        "queue": 10,
        "depends": "00.09c",
        "lead": "🐾 Neko-chan (Inspector Cat)",
        "status": "todo",
        "primitive": "event/hook plugin",
        "package": "@deepseek-ai/dsh-dev-loop-gates",
        "summary_voice": "Nya~ (=^･ω･^=)🐾 Welcome to Gate 1 of our Four Gates obstacle course! Inspector Cat stands at the entrance with her checklist! Before any piece can complete, we verify that its markdown formatting is spotless: all 11 canonical sections are in order, the line ceiling is honored, and the primitive is approved! Clean documents make happy developers!",
        "opt_a": "Execute automated Gate 1 axiom validation verifying all 11 sections and line ceiling.",
        "opt_b": "Bypass format checking at completion, allowing malformed pieces to corrupt set indexes.",
        "scenarios": [
            ("a piece that conforms to all 11 sections and line ceiling", "evaluateGate1(piece) is called", "it returns pass status with zero violations."),
            ("a piece missing the `## How to see it` section", "evaluateGate1 runs", "it casts a veto with blocker code `MISSING_REQUIRED_SECTION`."),
            ("a piece exceeding the 280-line ceiling", "evaluateGate1 executes", "it casts a veto with blocker code `PIECE_SIZE_EXCEEDED`.")
        ],
        "harness_fit": "First verification gate plugin in `@deepseek-ai/dsh-dev-loop-gates/src/format.ts`. Registers listener on `piece/pre-complete`.",
        "contracts": """```typescript
export interface GateResult {
  readonly gateId: string
  readonly passed: boolean
  readonly reason?: string
  readonly evaluatedAt: number
}

export function evaluateGate1Format(piecePath: string, content: string): Promise<GateResult>
```""",
        "deps_text": "00.09c",
        "references": [
            ("packages/dev-loop/gates/src/format.ts", "1-80", "Gate 1 format and axiom verification"),
            ("packages/dev-loop/gates/tests/format.spec.ts", "1-75", "Gate 1 rejection and pass unit tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/gates/tests/format.spec.ts",
            "expected": "✓ evaluateGate1Format > verifies 11 canonical sections and line ceiling"
        },
        "teach": {
            "voice_intro": "Step one of our obstacle course! Let's make sure our backpack is zipped and our shoes are tied! Nya~",
            "what_it_does": "Validates that the piece specification complies with all repository format axioms before completion.",
            "background": "The Four Gates enforce defense-in-depth: Gate 1 (Format), Gate 2 (RED), Gate 3 (GREEN), Gate 4 (Transfer).",
            "how_it_works": "Listens on `piece/pre-complete`. Invokes `inspectPiece` from `@deepseek-ai/dsh-dev-loop-directory`. If any blocker finding exists, it vetoes.",
            "why_this_approach": "Hooks directly into the lifecycle pre-complete event bus, preventing any unformatted piece from ever becoming `done`.",
            "approaches_considered": "Pre-commit git hooks (bypassable with --no-verify) vs Runtime lifecycle gate (chosen: un-bypassable).",
            "prior_art": "Quality gates in SonarQube and CI build stage gating.",
            "what_we_get_for_free": "Reuses the exact parser from `@deepseek-ai/dsh-dev-loop-directory`, ensuring runtime and CI checks are identical.",
            "from_the_docs": "plans/AGENTS.md: 'Sharing the parser is the point: an axiom and the runtime that enforces it cannot drift apart.'",
            "what_to_notice": "Notice how Gate 1 executes before any test runners, catching syntax defects in milliseconds!",
            "concepts_to_own": "Fast-fail ordering: running the cheapest, most deterministic checks first to save compute.",
            "interview_angle": "How do you order verification stages in automated delivery pipelines? Answer: Cheapest syntax/lint checks first, progressing to expensive integration and merge gates.",
            "decisions_alone": "You can add custom lint warnings without failing Gate 1.",
            "lesson": "Always check document hygiene first. Clean format reflects clear thought! Purr~"
        },
        "proof": [
            ("Gate 1 hooks into pre-complete and checks parser findings", "packages/dev-loop/gates/src/format.ts:25-60", "direct inspection", "Current checkout"),
            ("Gate 1 test suite verifies blocking of missing sections", "packages/dev-loop/gates/tests/format.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Gate 1: Format Axiom Verification Gate",
            "what": "Lifecycle hook enforcing document structure and line limits.",
            "usage": "First verification stage in `dsh-dev-loop-gates`.",
            "potential": "Can gate document merges, RFC approvals, or schema updates.",
            "generic": "Pluggable into any Cordis pre-action event.",
            "evidence": "packages/dev-loop/gates/src/format.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Intercepts completion attempts.",
            "Verifies 11 canonical sections in order.",
            "Casts veto on any blocker finding."
        ],
        "next_gate": "00.10b"
    },

    # 00.10b
    {
        "id": "00.10b",
        "slug": "00.10b-red-baseline-gate.md",
        "title": "Gate 2: Mandatory Failing Baseline Verification",
        "queue": 10,
        "depends": "00.10a",
        "lead": "🍰 L (Forensic Detective)",
        "status": "todo",
        "primitive": "event/hook plugin",
        "package": "@deepseek-ai/dsh-dev-loop-gates",
        "summary_voice": "Welcome to Gate 2. Here we examine the crime scene before the intervention occurred. Was there genuine evidence of a failing test baseline? We inspect `RED.md` and verify the cryptographic signature in `SHA256SUMS`. If no documented failing baseline exists, there is a 99.8% probability the code was not tested under TDD. Gate 2 casts an immediate veto.",
        "opt_a": "Verify recorded RED evidence and matching frozen hashes before permitting completion.",
        "opt_b": "Allow pieces to complete without proving a prior failing baseline existed.",
        "scenarios": [
            ("a worktree containing valid `RED.md` and matching `SHA256SUMS`", "evaluateGate2(worktree) runs", "it confirms valid RED baseline and passes Gate 2."),
            ("a worktree missing `RED.md`", "evaluateGate2 runs", "it casts a veto with reason 'Missing RED baseline evidence'."),
            ("a worktree where `SHA256SUMS` does not match current test file bytes", "evaluateGate2 runs", "it casts a veto with reason 'Test files modified after freeze'.")
        ],
        "harness_fit": "Second verification gate plugin in `@deepseek-ai/dsh-dev-loop-gates/src/red.ts`. Hooks into `piece/pre-complete`.",
        "contracts": """```typescript
export function evaluateGate2Red(
  worktreePath: string,
  pieceId: string
): Promise<GateResult>
```""",
        "deps_text": "00.10a",
        "references": [
            ("packages/dev-loop/gates/src/red.ts", "1-80", "Gate 2 RED evidence verification"),
            ("packages/dev-loop/gates/tests/red.spec.ts", "1-75", "Gate 2 unit tests verifying RED checks")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/gates/tests/red.spec.ts",
            "expected": "✓ evaluateGate2Red > requires valid RED baseline evidence"
        },
        "teach": {
            "voice_intro": "The forensic timeline requires establishing state prior to the act. The RED baseline is that proof.",
            "what_it_does": "Ensures that tests were proven to fail before the implementation code was written.",
            "background": "TDD requires Red -> Green -> Refactor. Gate 2 prevents skipping the Red step.",
            "how_it_works": "Inspects `.worktrees/<id>/RED.md` and recomputes hashes against `SHA256SUMS`. Vetoes if absent or modified.",
            "why_this_approach": "Cryptographic tamper-evidence makes skipping TDD physically impossible for subagents.",
            "approaches_considered": "Trust agent claims in transcript (unreliable) vs Cryptographic file evidence (chosen: empirical proof).",
            "prior_art": "Chain of custody evidence logging in forensic investigations.",
            "what_we_get_for_free": "SHA-256 verification takes under 2 milliseconds.",
            "from_the_docs": "plans/AGENTS.md: 'Tests are taught as evidence of behaviour: say what an important test PROVES... what behaviour was missing at RED.'",
            "what_to_notice": "Notice how Gate 2 catches implementers who accidentally edited test files to make them pass!",
            "concepts_to_own": "Non-repudiable baseline: an immutable record proving an initial state existed prior to transformation.",
            "interview_angle": "How do you enforce test-first development in automated coding pipelines? Answer: Cryptographic baseline gates that require verified failing logs.",
            "decisions_alone": "You can customize the required format of `RED.md` failure summary tables.",
            "lesson": "Never accept a green test without proof that it once failed."
        },
        "proof": [
            ("Gate 2 verifies existence of RED.md and validates SHA256SUMS", "packages/dev-loop/gates/src/red.ts:25-65", "direct inspection", "Current checkout"),
            ("Gate 2 test suite proves rejection of missing or altered baselines", "packages/dev-loop/gates/tests/red.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Gate 2: RED Baseline Verification Gate",
            "what": "Enforces presence of immutable test failure baseline.",
            "usage": "Second verification stage in `dsh-dev-loop-gates`.",
            "potential": "Can enforce TDD compliance in developer tooling.",
            "generic": "Can verify any cryptographic checksum manifest.",
            "evidence": "packages/dev-loop/gates/src/red.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Validates presence of `RED.md`.",
            "Verifies test file hashes against `SHA256SUMS`.",
            "Vetoes if baseline evidence is absent or tampered."
        ],
        "next_gate": "00.10c"
    },

    # 00.10c
    {
        "id": "00.10c",
        "slug": "00.10c-worktree-green-gate.md",
        "title": "Gate 3: Worktree Implementation All-Green Gate",
        "queue": 10,
        "depends": "00.10b",
        "lead": "💻 Daru (Super Hacker)",
        "status": "todo",
        "primitive": "event/hook plugin",
        "package": "@deepseek-ai/dsh-dev-loop-gates",
        "summary_voice": "Yo! Daru runs Gate 3. This is the big one: we execute the entire test suite inside the worker's isolated worktree. Every single test must pass with exit code 0! Not 99%, not 'just one minor timeout'—ONE HUNDRED PERCENT GREEN. If a single test fails, the gate slams shut and the implementer is sent back to fix their code. No broken builds allowed!",
        "opt_a": "Execute complete test suite in isolated worktree and require exit code 0 and 0 failures.",
        "opt_b": "Rely on subagent self-reported claims of tests passing without executing an independent verification run.",
        "scenarios": [
            ("a worktree where all unit and integration tests pass with exit code 0", "evaluateGate3(worktree) is called", "it passes Gate 3 with green evidence."),
            ("a worktree where one test times out or asserts false", "evaluateGate3 runs", "it casts a veto with the exact failing test name and failure output."),
            ("a worktree that fails typecheck or linting", "evaluateGate3 executes", "it casts a veto with typecheck error details.")
        ],
        "harness_fit": "Third verification gate plugin in `@deepseek-ai/dsh-dev-loop-gates/src/green.ts`. Hooks into `piece/pre-complete`.",
        "contracts": """```typescript
export function evaluateGate3Green(
  worktreePath: string,
  testCommand?: string
): Promise<GateResult>
```""",
        "deps_text": "00.10b",
        "references": [
            ("packages/dev-loop/gates/src/green.ts", "1-90", "Gate 3 test execution and green verification"),
            ("packages/dev-loop/gates/tests/green.spec.ts", "1-80", "Gate 3 pass/fail execution tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/gates/tests/green.spec.ts",
            "expected": "✓ evaluateGate3Green > enforces 100% test pass in isolated worktree"
        },
        "teach": {
            "voice_intro": "Metal doesn't lie. Exit code 0 or GTFO. Let's run the real test rig.",
            "what_it_does": "Runs all tests inside the worktree to guarantee the implementation made the tests green.",
            "background": "Subagents often hallucinate that tests passed. Gate 3 executes an independent, host-mediated run.",
            "how_it_works": "Spawns `pnpm exec vitest run` inside the worktree directory. Captures process exit code and JSON results.",
            "why_this_approach": "Independent host execution eliminates all possibility of model deception or false reporting.",
            "approaches_considered": "Agent self-report (unreliable: agents lie to exit) vs Host-executed test runner (chosen: absolute truth).",
            "prior_art": "Continuous integration test runners (GitHub Actions, Jenkins).",
            "what_we_get_for_free": "Vitest runs fast in-process with multi-threading.",
            "from_the_docs": "AGENTS.md: 'A task is not done when the code works. It is done when the owner can SEE it working.'",
            "what_to_notice": "Notice how the worktree CWD ensures test artifacts and database files stay isolated!",
            "concepts_to_own": "Independent host verification: executing verification checks outside the agent's control boundary.",
            "interview_angle": "How do you prevent AI coding agents from falsely reporting that tests passed? Answer: Mediate all test execution through an un-bypassable host runner.",
            "decisions_alone": "You can customize the test runner command (e.g. adding coverage flags) via `Config.testCommand`.",
            "lesson": "Never trust an agent's word on test results. Run the test yourself and demand exit code 0!"
        },
        "proof": [
            ("Gate 3 executes tests via host subprocess and checks exit code 0", "packages/dev-loop/gates/src/green.ts:30-70", "direct inspection", "Current checkout"),
            ("Gate 3 test suite proves veto on any non-zero exit code", "packages/dev-loop/gates/tests/green.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Gate 3: Worktree All-Green Verification Gate",
            "what": "Host-mediated test runner that requires 100% green tests.",
            "usage": "Third verification stage in `dsh-dev-loop-gates`.",
            "potential": "Can gate automated code merges in any git repository.",
            "generic": "Can execute any CLI test command.",
            "evidence": "packages/dev-loop/gates/src/green.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Executes tests in worktree independently.",
            "Requires 100% tests passing.",
            "Vetoes with detailed diagnostic output on failure."
        ],
        "next_gate": "00.10d"
    },

    # 00.10d
    {
        "id": "00.10d",
        "slug": "00.10d-mainline-transfer-gate.md",
        "title": "Gate 4: Clean Mainline Integration Gate",
        "queue": 10,
        "depends": "00.10c",
        "lead": "🔬 Hououin Kyouma (Mad Scientist)",
        "status": "todo",
        "primitive": "event/hook plugin",
        "package": "@deepseek-ai/dsh-dev-loop-gates",
        "summary_voice": "Mwahahaha! We stand before the final Steins Gate! Gate 4: The Mainline Transfer Gate! A parallel worldline may be green in its own pocket dimension, but what happens when it merges into the master timeline? We perform a clean cherry-pick merge onto mainline and re-execute the entire test suite on master! Corrupted temporal branches shall not pass!",
        "opt_a": "Perform clean git merge onto mainline and execute post-transfer verification before marking done.",
        "opt_b": "Mark pieces done in worktrees without transferring to master, leaving mainline broken.",
        "scenarios": [
            ("a worktree whose changes cherry-pick cleanly onto mainline and pass all master tests", "evaluateGate4(worktree) runs", "it commits changes to master and passes Gate 4."),
            ("a transfer that produces git merge conflicts with mainline", "evaluateGate4 runs", "it casts a veto with conflict details and aborts merge."),
            ("a transfer where code merges cleanly but breaks an existing regression test on master", "evaluateGate4 executes", "it rolls back master commit, casts a veto, and halts.")
        ],
        "harness_fit": "Fourth verification gate in `@deepseek-ai/dsh-dev-loop-gates/src/transfer.ts`. Hooks into `piece/pre-complete` as final check.",
        "contracts": """```typescript
export interface TransferResult extends GateResult {
  readonly mainlineCommit?: string
  readonly mergedFiles: readonly string[]
}

export function evaluateGate4Transfer(
  worktreePath: string,
  mainlinePath: string
): Promise<TransferResult>
```""",
        "deps_text": "00.10c",
        "references": [
            ("packages/dev-loop/gates/src/transfer.ts", "1-110", "Mainline transfer and post-transfer test execution"),
            ("packages/dev-loop/gates/tests/transfer.spec.ts", "1-90", "Mainline integration and rollback tests")
        ],
        "how_to_see": {
            "command": "pnpm exec vitest run packages/dev-loop/gates/tests/transfer.spec.ts",
            "expected": "✓ evaluateGate4Transfer > merges cleanly to mainline and passes post-transfer tests"
        },
        "teach": {
            "voice_intro": "Reaching the Steins Gate requires converging parallel timelines into one unbroken reality! Behold Gate 4!",
            "what_it_does": "Transfers verified worktree changes to mainline and proves that the master branch remains 100% green.",
            "background": "Integration defects happen when two changes work in isolation but conflict when combined.",
            "how_it_works": "Applies diff to mainline via Git merge. Runs post-transfer test suite. If tests fail, rolls back master via `git reset --hard`.",
            "why_this_approach": "Guarantees that master NEVER enters a broken state. The mainline commit happens only after proof.",
            "approaches_considered": "Merge without re-testing (risks broken master) vs Full re-testing post-merge with rollback (chosen: invariant preservation).",
            "prior_art": "Bors merge queue and GitHub merge queues.",
            "what_we_get_for_free": "Git's atomic commit machinery ensures all-or-nothing changes.",
            "from_the_docs": "plans/AGENTS.md: 'The implementation sequence is Test Writer → RED → Implementer gets tests green → transfer to master → final post-transfer tests...'",
            "what_to_notice": "Notice how the automated rollback protects master if integration tests fail!",
            "concepts_to_own": "Merge queue validation: testing the combined result on the target branch before declaring success.",
            "interview_angle": "How do you guarantee that a master branch never breaks in high-velocity multi-agent development? Answer: Gated merge queues with automatic rollback on post-merge failure.",
            "decisions_alone": "You can configure fast-forward only vs merge commit preferences in `Config.mergeStrategy`.",
            "lesson": "True victory is achieving harmony on the mainline. Only when master is green are we done! El Psy Kongroo."
        },
        "proof": [
            ("Gate 4 performs transfer to master and runs post-merge tests", "packages/dev-loop/gates/src/transfer.ts:35-85", "direct inspection", "Current checkout"),
            ("Rollback tests verify master restoration upon post-merge test failure", "packages/dev-loop/gates/tests/transfer.spec.ts", "direct inspection", "Current checkout")
        ],
        "reuse": {
            "name": "Gate 4: Mainline Transfer and Rollback Gate",
            "what": "Merges worktree changes to master with post-merge verification.",
            "usage": "Final verification stage in `dsh-dev-loop-gates`.",
            "potential": "Can automate merge queues for Git repositories.",
            "generic": "Works with any standard Git repository.",
            "evidence": "packages/dev-loop/gates/src/transfer.ts",
            "confidence": "high"
        },
        "acceptance": [
            "Merges worktree changes onto mainline.",
            "Verifies post-transfer tests pass on master.",
            "Rolls back master automatically on failure."
        ],
        "next_gate": "00.11a"
    }
]
