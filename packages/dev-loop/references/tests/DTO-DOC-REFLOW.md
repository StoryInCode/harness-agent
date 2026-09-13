# Config DTO documentation reflow

The parent authorized reflow of the `Config.maxObservationBytes` JSDoc because its single line exceeded the 140-character lint limit. The exact prose is split across two JSDoc content lines; no words, field types, optionality, behavior or tests changed.

This reflow supersedes only the DTO entry in `DTO-DOC-AMENDMENT-SHA256SUMS`. Predecessor SHA-256: `24300759a873434b23accda4e0aa4fa270ddf92a87ac5fc3442032e233441452`. Reflowed SHA-256: `ef27dcc75119178522c87f9176f0c1aa1e199451547ab4a7baaf3b918bd73de2`. The previous amendment record, all earlier manifests, tests and execution logs remain unchanged.

`pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/references/src/types.ts` exits 0; its output is retained in `DTO-DOC-REFLOW-oxlint.log`. No behavioral suite was rerun for this formatting-only amendment. `DTO-DOC-REFLOW-SHA256SUMS` pins the reflowed DTO and this new evidence.
