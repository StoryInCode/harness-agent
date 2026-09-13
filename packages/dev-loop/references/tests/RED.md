# References behavioral RED baseline

## Result and reproduction

The Test Writer baseline contains 84 failing behavioral tests in five files. All failures name missing References verification, persistence, cancellation or validation behavior; none fail on imports, Loader activation, TypeScript syntax, timeout or unhandled rejection. Production contains only exported DTOs and an inert mounted service: `verifyReferences` rejects with `Missing References behavior: parse, check, and durably observe sources`; `getProvenance` returns undefined. The service opens no domain, reads no source, parses no Markdown and performs no delegation lookup.

Run from `/home/sic/harness-agent/.worktrees/references-tests`:

| Command | Observed result |
|---|---|
| `pnpm exec vitest run packages/dev-loop/references/tests --testTimeout=30000 --hookTimeout=30000 --reporter=verbose --reporter=json --outputFile.json=packages/dev-loop/references/tests/RED-vitest.json` | Exit 1; five failed files, 84 failed tests, no skipped tests on Linux. |
| `pnpm exec tsc -p packages/dev-loop/references/tests/tsconfig.json --pretty false` | Exit 2; zero package source/test diagnostics and 98 diagnostics in vendored code under the strict source-test program. This is not a globally passing typecheck; no diagnostics were suppressed. |
| `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/references` | Exit 0; zero warnings/errors across eight TypeScript files. |
| `git diff --check` | Exit 0 for tracked changes; the new package is untracked. |

The adjacent logs retain execution output. `RED-vitest.json` retains every exact accepted test name and failure. `FROZEN-SHA256SUMS` pins the tests, fixture, DTOs and evidence; `SCAFFOLD-SHA256SUMS` records production/configuration scaffolding that the Implementer may change. Verify either manifest with `sha256sum -c packages/dev-loop/references/tests/<manifest>` from the worktree root. Do not refresh the frozen manifest or edit frozen tests during implementation; corrections return to Test Writer.

The real-child case performs Git worktree allocation, child execution and cleanup and took approximately 5.3 seconds on this host. The default five-second Vitest budget timed out before References was called. The recorded command grants the process-owning fixture a 30-second test/hook budget; no fixed sleeps, timeout suppression or per-case lower CI budget was added.

## Frozen public observations

The exported DTOs live in [types.ts](../src/types.ts). `DevLoopReferences` exposes `verifyReferences(pieceId, signal)` and `getProvenance(pieceId)` through `ctx.devLoopReferences`. There is no caller-supplied verification-record admission method. The retained identity is SHA-256 of the complete UTF-8 encoding of filesystem-decoded text, without newline normalization; source fingerprints describe the complete source, not only its selected range. Complete observation limits measure UTF-8 encoded `JSON.stringify(observation)`.

A `ProvenanceObservation` separates `structuralStatus: valid | invalid` from `inspectionStatus: unverified`. Each locator gets one `ReferenceEntry` in document order, retaining one-based row number, original AST URL/code value, rendered source cell text and rendered attribution text. Canonical five-column fields remain optional for authored profiles that lack them. Three-column explanatory cells stay in `explanatoryColumns` under their exact normalized headings; the four-column role cell stays in `rolePreset` rather than being fabricated into attribution prose. A code span inside a link label is display text, not another locator.

Source status and report-attribution status remain independent. A resolved file with direct-inspection prose remains unverified; a real child deliberately claiming it inspected every source establishes only linked-report identity. Exact UUID linkage preserves actual child, role, optional preset, terminal status and limitations. Requested-only residue and missing actual child identities do not establish executed reports. Failed/aborted reports stay partial. A missing source now does not establish historical fabrication.

## Verified APIs and amendments

Direct inspection verified Directory `PieceRecord` and `getPiece`, filesystem `resolve`, `contains`, `stat`, `readText`, `streamText` and `readBytes`, Roles `getDelegations` and durable record fields, and storage-domain `open`, schema validation, owner closure and JSON backend APIs. The installed `mdast-util-gfm` 3.1.0 implementation `lib/index.js` composes table parsing through `gfmTableFromMarkdown`; `scripts/markdown.ts` demonstrates the maintained from-Markdown/GFM extension APIs. No runtime import from repository scripts is introduced. No external model, W3C document or complete external parser implementation was inspected by this Test Writer.

The parent amended MAIN after these findings:

- Roles only exposes piece-scoped history. Unknown ids and ids belonging to other pieces remain unavailable/unverified; References must not enumerate pieces or invent a cross-piece lookup.
- Supported profiles are the canonical five columns plus `Source | Role/preset and provenance | Decision informed`, `Source | Question answered | Provenance`, `Source | Provenance | Decision informed`, and `Source | Role/preset | Provenance | Decision informed`. Reordered or unsupported profiles reject.
- Identity assertions use explicit `role:<canonical role>` and `preset:<id>` tokens, or an entire canonical role cell. Prose is not heuristically interpreted. A claimed preset with no actual recorded preset stays unverified; a recorded different preset is contradicted.
- A missing References section already makes Directory reject with `MISSING_REQUIRED_SECTION`; the real service propagates that rejection and does not fabricate a missing-section observation.
- Directory lookup has existing whole-file reads. References bounds its own subsequent reads and must not claim to have bounded the dependency's scan.
- An oversized piece rejects the operation rather than fabricating a complete fingerprint. An oversized source is an invalid entry with no source digest. Oversized complete observation JSON rejects rather than clipping or publishing it.

The inspected MAIN specification SHA-256 is `5d943c6f1cfe585d1dda96df1b2eaade0b5461f9ed0009a0e7a244fccd5736d0`; MAIN, not the obsolete worktree plan, is the specification authority.

## Composition, isolation and handoff

Every fixture uses private `mkdtemp` storage/repository roots and real Loader inclusion of the Host References row. The unchanged copied Roles fixture supplies actual filesystem, Directory, Queue, Worktree, AgentLoop, spawn provider, Roles, storage-domain and JSON backend services. Only LLM responses are scripted. Attribution edge cases seed valid durable Roles history through its existing domain; the lying-report test executes a real child and proves the fixture's report before calling References. Failure/race tests wrap only the selected real JSON unit or instance-local filesystem/Directory calls and delegate unblocked operations. Barriers race operation rejection to prevent the inert stub from hanging setup; cleanup releases barriers and joins all admitted operations.

The root is detached at `0e90e9b593609557bee04a48623873ee286ac159`. No branch, commit or MAIN edit was made. Supporting Roles was copied from `/home/sic/harness-agent/.worktrees/roles-tests/packages/dev-loop/roles` excluding `lib` and `node_modules` and was not modified here. That source worktree changed concurrently after the copy; `SUPPORT-SHA256SUMS` identifies the exact copied source/fixture baseline. Do not transfer copied Roles back over its owner's work. The only tracked root edit adds precise source aliases for Roles and References. Dependency `node_modules` symlinks are session-only setup and must not be transferred or staged.

Implementation owns the References package README, Agent Note, project registration, generated documentation and lockfile integration. No model-facing References consumer is introduced here, so this baseline adds no recorded-session transcript and claims no model-context injection. Any future model-visible consumer must log its rendered result and add the relevant keyless scenario. The symlink-escape case explicitly skips Windows because it requires POSIX symlink privileges; the HTTP non-fetch case allocates loopback port zero and joins server closure.

## Teaching and coverage limits

Structural validation answers whether a locator currently resolves; epistemic confidence answers what the evidence establishes about inspection. These are different observations, so a successful file read cannot promote report prose into trusted source usage. Content addressing names exact checked text, and detached values prevent a caller from rewriting retained evidence. The durability tests observe real reopened JSON rather than trusting a service's success response. The serialization test pins `piece-read-1, write-durable-1, piece-read-2, write-durable-2`; the disposal test pins admitted-write durability before domain close.

The chosen test approach composes real owners instead of replacing business services with mocks. Maintained mdast/GFM parsing avoids a hand-written pipe splitter, which would misread escaped pipes and code/link nesting. Stronger trusted source-access instrumentation is a different capability and is not inferred from these tests. The baseline proves executable RED, not GREEN: assertions after the first missing behavior await implementation and may reveal a fixture correction, which must return to Test Writer. Full coverage, released-artifact tests and cross-platform execution remain implementation/integration work.

Reuse candidate: orthogonal structural and epistemic observations. Current usage: frozen References tests and DTOs. Potential reuse: Claims deciding whether unresolved attribution permits further work. Generalization needs another implemented consumer and a trusted source-use owner. Evidence: executable behavioral RED only; confidence is low. Transferable lesson: an attributed statement and an independently observed fact must not share a success flag.
