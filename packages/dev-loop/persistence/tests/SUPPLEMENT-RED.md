# 00.12 supplemental test freeze

## Scope and result

This freeze adds 98 supplemental tests across seven files without changing any production source, the frozen 71-test integrated suite, support files, or the owner-local `recovery-web.expected.e2e.ts`. The only authorized production edit remains the parent-approved JSDoc-only `src/types.ts` `Config` amendment sealed in [CONFIG-DOCS-SHA256SUMS](CONFIG-DOCS-SHA256SUMS) at SHA-256 `7e309426f270b24c75c50d8541889f7416ee8758d3691388fbfe6451a41d6eb1`.

`pnpm exec vitest run` over the seven supplemental files reports **98 tests, 98 GREEN, zero RED, zero skipped or todo**: records 58, lifecycle 9, API-operation 10, audit 2, reconcile 4, source-fence 2, recovery-command 13. Every case exercises real fixtures, real filesystem or Git effects, and real storage domains; no fabricated errors, evidence setters, or elapsed-time assertions.

## Coverage

Supplemental-only combined coverage over `packages/dev-loop/persistence/src` (`--coverage.reportOnFailure`, reports in `/tmp/persistence-supp-cov-final`) is **95.55% statements / 93.00% branches**. Full-suite coverage (frozen 71 plus these 98, excluding the owner-local web e2e; reports in `/tmp/persistence-full-cov`) is **98.17% statements / 96.89% branches**.

Remaining uncovered locations after the full suite, classified:

Unreachable-assertion candidates (must never be reached by faking errors or inputs):

- `src/index.ts:66-67` — `Service.init` safe-integer re-check of `maxRecordBytes`/`maxHistoryRecords`; the Loader rejects invalid values through the `Config` zod schema before initialization.
- `src/index.ts:151` — `files[0]` absence check immediately after a `files.length === 1` guard on the same array.
- `src/reconcile.ts:45` — non-`PieceParseError` rethrow from piece-document validation; only fabricated typed errors from a trusted Directory could reach it.

Reachable through production behavior, intentionally left uncovered rather than simulated:

- `src/index.ts:91` — `invalid-record: transition follows unresolved intent` re-read defense; the writer appends intents only at history end and quarantines unresolved intents, so only externally corrupted durable rows reach it.
- `src/index.ts:174` branches — anomaly-observation and journal-reference fallbacks for a piece whose local file is absent at hydration (journal-only `missing-source` restart).
- `src/records.ts:88` — parse of a durable failed terminal that carries a `source`; the runtime writes failed terminals without one, but the DTO accepts the legal record.
- `src/records.ts:96` — parse of a durable anomaly with a `transitionId` (`unresolved-intent`/`uncertain-effect`); requires a restart after a post-effect recording failure.

## Approved behavior verification

Both parent-approved behaviors are covered in [recovery-audit-supplement.spec.ts](recovery-audit-supplement.spec.ts): byte-identical inode replacement after restart mints a new ackable `source-changed` anomaly while the old row, its acknowledgment, history, and quarantine are preserved (`DEV_LOOP_ANOMALY_STALE` on the stale observation), and a byte-faithful malformed journaled document quarantines only its piece while the unaffected piece transitions and recovery inspection remain usable.

## Gates

`pnpm exec tsc -p packages/dev-loop/persistence/tsconfig.test.json --pretty false` and `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/persistence/src packages/dev-loop/persistence/tests` both exit 0 with zero warnings. `sha256sum -c` against [SUPPLEMENT-PRODUCTION-SHA256SUMS](SUPPLEMENT-PRODUCTION-SHA256SUMS) and [CONFIG-DOCS-SHA256SUMS](CONFIG-DOCS-SHA256SUMS) verifies all production, lifecycle, approval, command, and support files byte-unchanged at seal time. No branch, commit, or main-tree edit was made.
