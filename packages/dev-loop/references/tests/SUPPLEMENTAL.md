# Supplemental References behavior evidence

## Frozen additions

`supplemental-observations.spec.ts` adds 21 reachable cases through the unchanged real Loader fixture. These tests were authored against implemented production behavior and observed GREEN, not historical RED. They cover ambiguous delegation ids, global reference-definition spelling and first duplicate ownership, unresolved reference prose, image/image-reference/HTML rejection, nested display content without hidden locators, empty fields, entity-decoded CR/LF and empty/fragment-only locators, piece/source stream failure without replacing durable evidence, and fresh-read changes after Directory returned valid metadata.

Fresh-read cases perform a real Directory lookup and then write changed piece bytes before References opens its own stream. They exercise missing and duplicate References headings, a section at end of document, and a legitimate Setext heading containing a hard-break node. A separate authored hard-break inside a table demonstrates malformed table rows; it does not imply that all parser hard-break nodes are unreachable. No fabricated typed AST or source-observation values are used.

## Executed checks

From `/home/sic/harness-agent/.worktrees/references-tests`, `pnpm exec vitest run packages/dev-loop/references/tests/supplemental-observations.spec.ts --testTimeout=30000 --hookTimeout=30000 --reporter=verbose --reporter=json --outputFile.json=packages/dev-loop/references/tests/SUPPLEMENTAL-FINAL-vitest.json` exits 0: 21 tests passed, no skipped cases. `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/references/tests/supplemental-observations.spec.ts` exits 0 with zero warnings and errors.

The initial 20-case run is preserved in `SUPPLEMENTAL-vitest.log` and JSON; the final 21-case run adds the Setext-heading case. `SUPPLEMENTAL-typescript.log` records the initial source-program check: exit 2, zero package diagnostics and the same 98 vendored-code diagnostics as the historical baseline, with no suppression. It is not a globally passing typecheck or a compiler run of the later Setext addition. Production hashes in `SUPPLEMENTAL-SOURCE-BEFORE-SHA256SUMS` were checked unchanged across both passing runs and the separately recorded nested-definition RED. The Implementer owns subsequent production changes and the combined suite/coverage rerun.

`SUPPLEMENTAL-FROZEN-SHA256SUMS` pins the new test and evidence independently. It does not replace or rewrite the original 84-test manifest. The documentation-only DTO amendment has its own superseding manifest, and the actual nested-definition defect has separate `NESTED-DEFINITIONS-RED.md` and frozen RED evidence. No coverage percentage increase is claimed from these focused behavior runs.

## What the evidence teaches

An AST node's reachability depends on the complete Markdown document, not only a table cell. The Setext-heading case reaches a hard-break node legitimately. A nested global definition also exposes a real resolver bug that a root-only definition map misses; the separate nested-definition test records RED before its fix. Stream failures must leave the earlier durable observation intact rather than publishing partial text with a complete-file fingerprint. These tests observe persisted results and real authored bytes instead of manufacturing internal values for a coverage counter.
