# Agent Note: development-loop piece directory

Status: implemented

English | [中文](2026-09-12-development-loop-piece-directory.zh.md)

## Problem

The `plans/` specification corpus is 118 markdown files governed by machine-checkable `axiom` blocks in `plans/AGENTS.md`. Those axioms named four shell checkers — `check-piece-primitive.sh`, `check-piece-sections.sh`, `check-claim-citations.sh`, `check-done-pieces.sh` — none of which existed, so no axiom enforced anything. A document citing a script that is absent enforces nothing, and the corpus had drifted accordingly: one piece declared `Package:` without its bold markers, 233 section violations and 105 proof-table violations sat unnoticed, and the format authority `PIECE-FORMAT.md` disagreed with `plans/AGENTS.md` about the status vocabulary.

The development loop also needs the corpus as data, not as prose: an approval junction must render a piece's scenarios, a dispatch queue must know which pieces remain, and verification gates must validate a piece's structure. Every consumer needed the same parse, so the parse belonged in one owned place.

## Decision

`@deepseek-ai/dsh-dev-loop-directory` publishes `ctx.devLoopDirectory`, a host-plane Service Provider that discovers piece files under a configured root and returns validated `PieceRecord` values. `root`, `maxLines`, and `primitives` are schemastery-validated `Config` fields, all optional, so a `cordis.yml` row sets one and inherits the rest.

**The grammar is a pure function, separate from I/O.** `src/parse.ts` holds no filesystem access; `src/index.ts` owns discovery through the `ctx.fs` seam. Two callers need the parse: the service after `readText`, and the verification gate that already holds the text. Purity also removes temp directories from the test suite, which is what made 100% per-file coverage affordable — the shipped package has 100% statements, branches, functions, and lines on both source files with no `v8 ignore` comments.

**A scan returns partial results, never all-or-nothing.** `scanSet` returns `SetScan { pieces, rejected }`: a file that fails validation becomes a `PieceRejection` and the rest of the set still comes back. `getQueueCandidates` selects from the valid pieces of every set it scans, and `getPiece` raises a parse error only when the requested id's own file is the rejected one, never naming a file the caller did not ask about. `SET_NOT_FOUND` and `DUPLICATE_PIECE_ID` still throw, because they are facts about the request rather than about one file's contents.

This policy replaced an all-or-nothing scan that let one malformed piece reject its whole set. A Reviewer role found it by driving the service against all seven sets rather than the one the tests used: six of seven failed to scan, `getQueueCandidates()` threw instead of returning candidates, and `getPiece('01.03')` reported a parse error naming `01.01`. The suite was green because every real-corpus test was scoped to the single conformant set — "the real corpus passes" meant "the 11% of it we look at passes". A malformed sibling is data about the corpus, not an exception belonging to an unrelated caller, which is the same reason a linter reports per file instead of aborting.

**Findings carry the severity of the axiom they enforce.** A `blocker` rejects the file by throwing `PieceParseError`, which exposes `code`, `path`, and every finding; `Reuse capture` is the sole warning, because `R-piece-reuse-capture` declares `severity: warning` while the other five piece-content axioms are blockers. One finding type carrying a `severity` field beats parallel per-severity arrays, which force every consumer to know all of them.

**The section walk is one forward pass with a monotone cursor**, so a missing section and a transposed section fall out of the same loop. A transposition reports the canonically-later section that appeared too early, then rewinds the cursor, so one swap yields exactly one finding rather than a cascade.

**The scan is fence-aware.** A `##` line inside a fenced code block is content, for both backtick and tilde fences, with an unclosed fence running to end of file and a closer permitted to be longer than its opener. This is not hypothetical: pieces embed markdown and TypeScript templates inside `## Contracts`, and the gate that validates a piece's text directly hits the same input.

**The axiom checkers consume this package rather than re-implementing the grammar**, so an axiom and the runtime that enforces it cannot drift apart. `scripts/check-pieces.ts` converts `PieceParseError` back into data through its `findings` field, which is why no API change was needed to serve four differently-scoped checkers. Only the proof-table column rule lives in the script, because that is an axiom rule rather than a piece-format rule.

### `Directory`, not `Registry`

`docs/cookbook/adding-a-package.md` reserves `Registry` for "a dynamic set of named registrations, including lookup, duplicate or precedence rules, lifetime, and disposal", and defines `Directory` as a service that "exposes entries and metadata for discovery or selection". Nothing registers a piece; files are discovered. The package, the `ctx` key, and the class were renamed before any code existed.

## Alternatives considered

**`mdast-util-from-markdown` for heading detection.** Already a root devDependency and a runtime dependency of `packages/client/ui-primitives`, and the repository's own gate scripts parse markdown through `scripts/markdown.ts` on top of it. Rejected: `scripts/markdown.ts` is script-plane and cannot be imported from `packages/` under the source-plane/artifact-plane rule, so nothing would actually be reused; and the extra correctness mdast buys — setext headings, HTML blocks, indented code — covers zero occurrences measured across the corpus. The fence-tracking scan is about twenty lines. This flips the moment the piece format admits a setext or HTML heading.

**`remark` with `unified-lint-rule` and `vfile-message`,** the stack remark-lint, MDX, and Gatsby use. A real plugin architecture, correct if third parties must contribute rules. Rejected as roughly six packages and an inversion of control nothing here needs; `vfile-message`'s severity field did inform the finding model.

**A shell script per axiom,** which is what `plans/AGENTS.md` named. Wins when a check is a one-line `grep`. Rejected because it cannot return structured findings, cannot carry severity, and cannot be reused in-process by a tool or a gate.

**YAML frontmatter validated by schemastery.** Wins if the header grammar grows. Rejected because `PIECE-FORMAT.md` fixes a `**Bold:** value ·` prose header.

## Consequences

The axioms now enforce. Running the checkers over the corpus immediately found a real defect invisible to reading — `02.13` had `Package:` rather than `**Package:**` — and quantified the rest of the drift. Set 00's thirteen pieces conform on all four checks; sets 01 through 06 do not, and those are genuine axiom violations in the pieces rather than parser defects.

The cost is a package the loop's other twelve pieces now depend on for their input, and a grammar that is this fork's own: a piece format change is a coordinated change across `plans/AGENTS.md`, `PIECE-FORMAT.md`, the canonical section list, and the corpus.

Three behaviours briefly reached the package ahead of their tests — indented code fences, reporting a missing header label once instead of dumping the vocabulary, and the `dependsOn` grammar. The Implementer role reported that gap rather than letting the implementations look covered, and cases now pin all three. The measurable consequence: per-file coverage previously reached the `dependsOn` branch only through `06-verification/06.20` being malformed in the live corpus, so the gate depended on a corpus defect; with the cases added, coverage is 100% without the corpus. The rule did change one outcome — `06.20`'s rejection code moved from `MISSING_REQUIRED_SECTION` to `MALFORMED_PIECE_HEADER`, which took `check-pieces primitive` from zero corpus violations to one, naming a real defect.

Two process facts are worth keeping. The first implementation of this parser was written before any test existed and scanned headings with a fence-blind regex; the Research role found the defect by comparing against `markdownlint`'s `MD043`. And the Test Writer role, given only the specification, produced a suite the implementation satisfied without a single assertion being weakened — the two things that ever needed changing in that suite were both hardcoded enumerations of a growing corpus, a pinned case count and a pinned id list, found by the role that wrote them.

## Deferred

**The corpus is not conformant, and the directory reports that rather than failing on it.** Sets 01 through 06 carry 233 section violations and 105 proof-table violations, so a scan of them returns no pieces and a rejection per file. Those are genuine axiom violations in the specifications, amended set by set as the loop reaches them; the directory's job is to report them, not to wait for them.

**`DUPLICATE_PIECE_ID` now considers valid pieces only.** A rejected file has no trustworthy id in its content, so a collision between a malformed file and a valid one goes unreported. That is a deliberate narrowing of a corpus-defect check, taken because guessing an id from unparsed content is worse than missing a rare collision.
