# Agent Note: References observations do not prove inspection

Status: implemented

English | [中文](2026-09-13-references-observation-not-inspection.zh.md)

## Problem

A source that resolves today does not prove that a report author inspected it. A delegation record can identify a report producer without recording source usage. Combining these independent facts into a verified-inspection flag would let plausible prose acquire authority it has not earned; treating absent evidence as fabrication would make the opposite unsupported claim.

## Decision

The [References service](../../../../packages/dev-loop/references/README.md) checks local locators and retains report attribution as separate observations. Inspection stays unverified. Exact delegation UUIDs link only through Roles' actual piece-scoped `getDelegations(pieceId)` history; unknown and other-piece ids are equally unavailable. Settled records require an actual child identity. Recorded role, optional actual preset, terminal status and limitations remain distinct from requested labels and report prose.

Explicit role/preset assertions can contradict visible identities, but missing actual presets remain unverified. Failed and aborted reports retain their qualifications. Neither a linked report nor a direct assertion establishes source usage. Claims and Gates will decide how unresolved evidence affects further work; References does not decide claim truth.

References owns the `dev_loop_references` single-layout storage domain, Zod validation and serialized verification/write lifetime. Later persistence and consumers use this owner, not a second provenance store. Publication follows durable success; admitted writes settle before domain closure even when their caller cancels. Reopened observations identify checked piece text, not freshness after later edits.

Maintained `mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm` dependencies own Markdown/GFM parsing. `unist-util-visit` collects reference-link definitions throughout the document, including blockquotes, with first-definition-wins semantics; a root-only scan misses valid global definitions. The coordinator reports inspecting the installed MIT-licensed `unist-util-visit` 5.1.0 manifest and `lib/index.js` preorder traversal documentation and implementation, and reports a separately frozen nested-blockquote RED regression passing after recursive collection. This documentation task directly inspected the package dependency declaration and parser use, not the external implementation or regression execution.

References owns accepted table profiles, locator rules and attribution semantics, without importing repository-only scripts. Its own streaming reads enforce explicit byte budgets; Directory's existing whole-file lookup remains outside those bounds. Complete decoded-text fingerprints and complete JSON budgets prevent partial evidence from looking complete.

## Scoped supersession

No prior References owner is superseded. The [Directory decision](../../implemented/architecture/2026-09-12-development-loop-piece-directory.md) remains active: it still owns piece discovery, section validation, parse failures and the minimal PieceRecord. Its rejection of mdast for simple heading detection does not reject maintained GFM parsing for References tables. No Directory decision or parser is replaced here.

The [maintained-dependencies decision](../../implemented/process/2026-07-26-dependencies-over-hand-rolling.md) remains active and applies without supersession. The [fork-local gate policy](../../implemented/process/2026-09-12-fork-local-gate-policy-and-upstream-sync.md) also remains active: these explicitly requested bilingual documents do not re-enable aggregate pairing or change the decisions of other fork-local pages. Scoped searches of active proposed, implemented and rejected notes found no existing References provenance owner to consolidate or archive. Directory and fork-policy notes retain their English prose with added language switchers and Chinese counterparts; their decisions remain unchanged. Frozen archives are unchanged.

## Alternatives considered

**Trust report prose or equate file existence with inspection.** Adequate for informal human notes, but insufficient for automated evidence decisions: both can be present without actual source usage. Retain the assertion rather than promote it.

**General provenance graph.** The MAIN piece reports Research's inspection of the dated W3C PROV-DM overview and selected introductory sections, with no recorded preset and no code reuse. Its distinction between attribution, delegation and usage informs this decision; this documentation task did not independently inspect that external source. A general graph would become useful for cross-system provenance, but the current consumer needs exact report linkage and explicit uncertainty, not a graph framework.

**Trusted source-access instrumentation.** This would provide stronger evidence when independently observed source usage becomes a product requirement. It needs a separately owned observation/event path and tests; reading a file during verification cannot retroactively supply that evidence.

**Split raw table text on pipes.** This avoids parser dependencies but misinterprets Markdown code and link nesting. Maintained AST parsing leaves this package responsible for its real application rules rather than another Markdown grammar.

**Replace the text renderer with `mdast-util-to-string`.** The coordinator reports inspecting version 4.0.0 and finding that it drops `break` nodes, whereas References renders them as spaces. That substitution would change normalized heading acceptance rather than merely remove owned code, so the dependency is not added. Reconsider only with an explicit grammar decision and corresponding tests.

## Verification

The [frozen Test Writer baseline](../../../../packages/dev-loop/references/tests/RED.md) and [DTOs](../../../../packages/dev-loop/references/src/types.ts) define the required behavior. The baseline reports 84 behavioral failures across five files, not missing-import failures; that is Test Writer evidence. The integration coordinator reports a final passing coverage run of 106 tests across seven files: the unchanged historical 84, 21 supplemental cases and one separately frozen nested-definition regression. Each of the five production modules has 100% statements, branches, functions and lines. The reported command is `pnpm exec vitest run packages/dev-loop/references/tests --testTimeout=30000 --hookTimeout=30000 --coverage --coverage.include='packages/dev-loop/references/src/**/*.ts' --coverage.reportsDirectory=/tmp/references-final-coverage --reporter=verbose --reporter=json --outputFile.json=/tmp/references-final-GREEN-vitest.json`, exit 0, with execution log `/tmp/references-final-GREEN.log`; these are local evidence paths, not committed artifacts.

The coordinator reports that the parser removes only impossible image-alt and reference-definition fallbacks established by the maintained parser and recursive definition collection, replacing them with local assertions while preserving break-as-space rendering. The coordinator reports final `tsc -b` dependency-closure and `tsc -p` package builds passing, whole-package lint with zero warnings/errors, and isolated tsdown JavaScript/declaration output passing at `/tmp/references-final-build`. The final strict test program exits 2 with exactly 98 vendored diagnostics and no package diagnostics across the 106 tests, recorded in `/tmp/references-final-strict-typescript.log`; this is not a globally passing typecheck. These paths are local evidence, not committed artifacts. This documentation task did not execute these behavior/type/build commands. Main-checkout integration of the new Roles policy, shared generators and the root Typert pipeline remains parent-owned and pending; isolated tsdown output does not establish success of that pipeline.

The reported passing suite covers supported and malformed tables, explicit empty declarations, canonical containment, valid ranges, multibyte limits, exact actual linkage, contradictory identities, missing evidence, a real lying child report, detached durable reopen, invalid authoritative records, write failure and disposal ordering. Piece overflow publishes no digest; source overflow has no source fingerprint; complete observation overflow rejects without clipping. Verification uses the baseline's reproducible command and its 30-second test/hook budgets without overwriting RED artifacts.

Piece 00.08 adds no model consumer, prompt injection, Session event or promised recorded-session snapshot. A subsequent model-visible consumer must log rendered results through the existing tool runtime and add the relevant keyless scenario.

## Consequences

Canonical containment checks do not establish historical existence or actual source usage. URLs remain un-fetched and fragments semantically unchecked. Directory buffering remains unbounded by this owner's policy; checked fingerprints become stale on edits. A consumer that ignores these limitations can still misrepresent evidence even when References reports it accurately.

Reuse candidate: separate structural observations from epistemic confidence. Current usage is the References DTO and frozen behavioral baseline; Claims is a potential consumer. Generalization needs another implemented consumer and an independent source-use owner. Package verification supports this separation; generalization remains unverified without those additional consumers and observations. The transferable lesson is to name precisely which relationship evidence establishes, not to expose a universal success flag.
