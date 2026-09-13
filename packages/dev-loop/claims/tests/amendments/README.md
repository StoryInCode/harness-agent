# Claims supplemental Writer amendment

## Authority and preserved baseline

The parent authorized exported-type and Config JSDoc, additive structured reported measurement metadata, supplemental acceptance tests, and correction of the concurrent-piece fixture. Production implementation remains owned by the Implementer. This Writer changed only `src/types.ts`, the authorized `tests/concurrency.spec.ts`, and new supplemental/evidence files. The original `SHA256SUMS`, `RED.md`, original logs, both original harness files, and the root-disposal test remain unchanged.

Original types SHA-256: `5c9679d10e3831348f0b8ca6c697d55f5ee5d03465e14b897084bf7e3b673ca5`. The documentation-only successor is preserved as `types-doc-only.txt`, SHA-256 `aecc1e79e7e5e9ef9eafb9006ebfcbac3004437885d54632d72a23a3216c491f`. The approved measurement DTO successor is `36c4741b6555679d0adebec2625971121d04d507f08ee60cb756bd9687bcfcb8`.

Original concurrency SHA-256: `43683bb57448813841ad6a389510043cca72b243ee2519990e8a0f7f92e4f643`, preserved in `concurrency-before-commit.txt`. The corrected test SHA-256 is `b6e622b2cc689f702baa73553e5dec78786cddc3a5b09a810533b0683119ba0a`. Comparing the initial test manifest confirmed that this is the only changed original test file.

## Approved JSON addition

`ClaimEvidence.measurement` is optional and contains exactly `command`, `environment`, `recordedAt`, `result`, and `reportedExecution`. Command and result are nonempty strings. Environment has at least one entry, with nonempty string keys and values. Recorded time is a nonnegative safe-integer Unix millisecond value. The closed execution enum is `executed | not-executed`. Unknown metadata fields reject. `supplemental-research-schema.ts` adds this strict object without editing the original schema fixture.

A supported measurement finding requires the structured metadata, an `executed` report, and an existing local log identified by its locator and exact SHA-256. These are reported observations, not proof that Research or Utility executed the command. The tests seed a log fixture; they do not run or claim a real benchmark. The positive decision is explicitly historical and environment-scoped, not a promise of current performance. The assignment must describe the new JSON fields. No command execution service, prose mining, universal truth claim, or pass setter is introduced.

Negative findings remain scoped reports. Recorded export entry points require explicit corresponding content-manifest digests; the owner must not invent hidden fingerprints. Byte-identity tests follow the parent's amended policy: fatal UTF-8 with a known backend size matching complete re-encoded text; BOM-induced mismatch and unknown size require explicit refusal. References' decoded-text observations are not relabeled universal raw-byte identities.

## Concurrent fixture correction

Committing the second piece alone did not repair the test. Claims and References read the new file successfully, but Queue admission failed with `no piece specification found for id "00.07"`. Direct inspection found that Lifecycle loads its synchronous status inventory in `[Service.init]`, whereas Directory's `getPiece` rescans files. The fixture created 00.07 after Lifecycle had mounted.

The corrected test commits both complete piece files in the private fixture repository, disposes the unused initial Host, then calls the existing real Loader remount helper. The new Lifecycle sees both pieces before any worker allocation. The same instance-local scripted adapter is registered on that Host, Claims is mounted normally, and `agents.create` supplies a real new initiator. The original simultaneous-model barriers, Queue capacity-two checks, same-piece exclusion, durable intent checks and joined cleanup assertions remain. No production dependency or frozen harness change substitutes for this setup repair. Git commits occur only in the private temporary test repository.

`concurrency-diagnostic.log` records the commit-only setup failure; it is not behavioral RED for Claims. `concurrency-corrected.log` proves the repaired real composition passes.

## Final executed evidence

Working directory: `/home/sic/harness-agent/.worktrees/claims-tests`.

- `pnpm exec tsc -p packages/dev-loop/claims/tests/tsconfig.json --pretty false`: exit 0, `typescript-final.log`.
- `pnpm exec oxlint packages/dev-loop/claims/src/types.ts packages/dev-loop/claims/tests/supplemental-*.ts packages/dev-loop/claims/tests/concurrency.spec.ts`: exit 0, `oxlint-final.log`.
- `pnpm exec vitest run packages/dev-loop/claims/tests/supplemental-*.spec.ts packages/dev-loop/claims/tests/concurrency.spec.ts --testTimeout=30000`: **9 behavioral failures, 22 passes, 31 tests in seven files**, exit 1, `vitest-final.log`.

`RUNTIME-FINAL.sha256` captured all seven production Claims source files immediately before the run. `runtime-final-unchanged.log` verifies every captured source hash remained unchanged afterward. The wrapper preserved Vitest's exit code only after that identity check passed. This is not a moving-code baseline. The final log has no collection/import errors, TypeErrors, unhandled failures, or timeouts. The earlier exploratory `vitest.log` contains the superseded fixture failure and an insufficiently explicit positive-measurement assertion; neither is presented as final RED.

| Supplemental evidence | Final observation |
|---|---|
| Supported bounded negative decision | RED: blanket downgrade prevents legitimate scoped support |
| Corpus-only and export-only freshness | RED at the initial supported-negative admission prerequisite; not independent proof of a freshness defect |
| Missing exact negative query and missing export digest mapping | PASS refusal controls |
| Reference-only local source drift | PASS through actual References |
| Attribution contradiction after successful admission | PASS with the explicitly typed References observation fixture |
| Supported historical reported measurement | RED: the new metadata is rejected rather than retained as a complete supported report |
| Structured not-executed / absent log digest / absent log file | RED: structurally valid metadata produces failed parsing instead of a retained unverified finding |
| Absent metadata and malformed metadata | PASS fail-closed controls; the positive case prevents treating blanket refusal as complete support |
| Real BOM piece and unknown piece size | RED: verification returns a report instead of refusing raw identity |
| Real malformed UTF-8 piece | PASS refusal before Research |
| Captured valid durable record with one changed nested hash, claim, id, or unknown field | Five PASS reopen/admission refusal cases; every other backend byte is preserved |
| Configured lifetime `2147483648` milliseconds | PASS actual async Research and quiescent cleanup; no global fake timers or days-long wait |
| Actual parent preset recomposition | PASS: Research records `actual`, not the parent's stale `original` creation label |
| Corrected different-piece concurrent fixture | PASS actual Queue capacity two with both models held concurrently |

## Limits and next action

Implement against the new tests without rewriting the initial 124 tests or this supplemental baseline. The unchanged root-disposal acceptance case remains under separate parent/provider investigation. The canonical recorded-session snapshot remains pending the GREEN implementation, as previously authorized. The long-timeout test covers overflow-safe initial scheduling, not waiting through a 24-day segment rollover. Unknown byte size is a valid optional-field observation injected at the instance-local filesystem provider interface; the local file bytes and all remaining provider behavior are real.

The debugging lesson is that a live file inventory and a mount-time status inventory can disagree without a file being missing. Reproduce the real initialization order before changing production behavior. The epistemic lesson is that identified bytes and attributed execution assertions support a scoped report, not independently observed execution.
