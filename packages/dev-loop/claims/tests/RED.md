# Claims behavioral RED handoff

## Authority and ownership

The authoritative specification is `/home/sic/harness-agent/plans/pieces/00-dev-loop/00.13-claim-verification.md`, transferred by the parent at `a35ad037e2`. Initial review used the amended specification in the subsequently removed `loop-spec-amendments` worktree, not the obsolete main specification. This detached worktree remains at `0e90e9b593609557bee04a48623873ee286ac159`.

Transfer only this Claims package's authored sources, manifest, configs and tests, plus the three additive source aliases in `tsconfig.base.json`. The index and tool contain inert missing-behavior stubs, not production verification. Copied Roles and References packages are dependency inputs: do not transfer their copies over another writer's work. Local `node_modules` symlinks and emitted `lib` directories are execution support, not deliverables.

`DEPENDENCIES-SHA256SUMS` identifies the exact specification and dependency runtime inputs. References runtime and package manifest were adopted from the parent's finalized `references-tests` implementation; its tests were not overwritten. Roles runtime and tests were copied from `roles-tests` without implementing dependency behavior. Later upstream test amendments are not local edits to the retained dependency tests.

## Frozen API and JSON

`src/types.ts` freezes the exported report DTOs. The public owner operations are `verifyPieceClaims(pieceId, signal)`, `getReport(pieceId)` and `requireAdmissible(pieceId, pieceDigest, signal)`. There is no model or caller truth setter. `tests/research-schema.ts` freezes the complete strict JSON object independently of the production parser. The complete outcome must parse as one JSON object; fences, prose prefixes, trailing objects, unknown fields, missing explicit ids, duplicate ids and rewritten explicit claims cannot be repaired into success.

Claim kinds are `repository`, `dependency`, `external`, `negative`, and `measurement`; statuses are `supported`, `contradicted`, and `unverified`. The parent approved these enums. Negative evidence uses a structured `corpus` with `contentManifest`, `versions`, `exportEntryPoints`, `includedDirectories`, `exclusions`, and `resultCount`, beside the exact `query` and `resultSummary`. Completeness of these fields does not prove universal absence or honest source usage.

The proof profile is `Claim | Citation | How established | Checked against`. Exact decoded cell text is retained; rows are one-based. Each id is `claim:` plus SHA-256 of `JSON.stringify([pieceId, row, claim, citation, howEstablished, checkedAgainst])`. Inventory digest is SHA-256 of the JSON inventory array. References has no invented observation id: Claims retains its actual observation and SHA-256 of that observation's complete JSON. Report ids are UUIDs. An explicit empty proof declaration is `No load-bearing claims.` and still requires a complete, explained full-source Research assessment.

The evidence byte limit covers `JSON.stringify(findings.flatMap(finding => finding.evidence))`; the report byte limit covers the entire retained report including References, inventory, metadata and limitations. Numeric configuration values are positive safe integers. Claims owns `dev_loop_claims`, version 1, with `attempts` and `reports` tables. Report table values are the public report DTO. Tests capture and replay actual durable attempt bytes rather than inventing private attempt fields.

## Executed checks

All commands run from `/home/sic/harness-agent/.worktrees/claims-tests`, with Node `v26.8.1` and pnpm `9.15.0`. `SHA256SUMS` records authored code/config inputs; `DEPENDENCIES-SHA256SUMS` records adopted dependency runtimes and the authoritative specification. The authoritative specification SHA-256 is `0d71f5c49fe7928bd3f35ebc74d501ae3cb7be2330607daf8e78af6e70a562ce`.

- `pnpm exec tsc -b packages/dev-loop/claims --pretty false`: exit 0; compiling inert source/DTO baseline, with project-reference builds.
- `pnpm exec tsc -b vendor/cordis vendor/cosmokit vendor/schemastery vendor/loader vendor/include --pretty false`: exit 0; explicit compiler dependency preparation.
- `pnpm exec tsc -p packages/dev-loop/claims/tests/tsconfig.json --pretty false`: exit 0; `RED-typescript-final.log`.
- `pnpm exec oxlint packages/dev-loop/claims/src packages/dev-loop/claims/tests`: exit 0 after final formatting; `RED-oxlint.log`.
- `pnpm exec vitest run packages/dev-loop/claims/tests --testTimeout=30000`: 119 behavioral failures and five passing controls, 124 tests across nine files, exit 1; `RED-vitest-final.log`. No collection/import failures, unhandled errors, or timeouts occur in this baseline.
- `git diff --check`: exit 0 for tracked changes.

The five passing tests are the independent strict-schema fixture, the actual dependency control, and three already-fail-closed negative paths (claim-count rejection, initial write refusal, and disposed tool caller). They do not establish a successful Claims implementation. `RED-vitest-before-bounds.log` preserves the actual 119-test intermediate run; the earlier observed 118-test run was overwritten before the parent's preservation request and is not reconstructed.

The earlier source-flattening test compiler invocation failed on vendored strict-program diagnostics; explicit vendor project references resolve that compiler-program mismatch without suppressing errors or changing vendor code. Missing package links and four authored type issues were corrected before the strict final check. The earlier default 5-second Vitest run timed out the actual dependency control; its isolated run completed in 7.23 seconds. The final command supplies the real Git/Loader/model lane a 30-second budget. Neither import failures, compiler failures, nor that timeout count as behavioral RED.

## Source inventory and observations

| Specification obligation | Test owner | Observable behavior |
|---|---|---|
| Actual source inventory and attribution | `claims.spec.ts` | Deterministic duplicate/escaped-pipe rows; one full-source assignment; actual child/delegation identity; no source amendment; legacy inspection remains unverified |
| Whole JSON validation and omissions | `research-json.spec.ts` | Failed durable observations for malformed output; missing/extra/duplicate ids; complete:false, omitted load-bearing premises and undermining limitations block |
| Evidence scope and revision freshness | `evidence.spec.ts`, `claims.spec.ts` | Exact source/manifests/lock/export bytes invalidate admission; unpinned external and unexecuted measurements stay unresolved; narrow negative corpus cannot authorize the broader decision |
| Durable lifecycle | `durability.spec.ts` | Intent before model; report before return; real backend reopen; detached values; invalid authoritative records; initial/terminal write failure; incomplete restart has no automatic retry |
| Cancellation and concurrency | `lifecycle.spec.ts`, `durability.spec.ts`, `concurrency.spec.ts` | Deferred actual-model barriers; cancellation, timeout and disposal join cleanup; startup cleanup uncertainty remains unresolved; actual Queue capacity two runs different pieces simultaneously; overlapping same-piece requests create no second intent/delegation |
| Complete bounds | `bounds.spec.ts`, `exact-bounds.spec.ts` | Invalid config refusal; multibyte piece/evidence/report overflow; exact complete piece/evidence/report equality and one-byte-below rejection controls; explicit and omitted claim counts |
| Model-facing entry | `model-tools.spec.ts` | Actual Loader-scoped consumer; authority fields rejected; exact live caller disposal; cancellation forwarded; report receipt equals next model-visible tool result |

Most cases use real Loader, fs, JSON storage, Directory, Roles, Queue, spawn provider and AgentLoop. `roles-harness.ts` is a Claims-owned copy of the actual Roles fixture with an explicit Queue-capacity parameter; it does not change frozen dependency tests or dependency behavior. The default fixture verification lifetime is 60 seconds so the timeout under test does not accidentally cut off ordinary multi-piece setup; the dedicated timeout case explicitly selects 10 seconds and a 30-second outer budget. Exact report-bound tests measure a successful complete report, then use identical-width UUID/time metadata and the same full DTO in fresh fixtures at that byte limit and one byte below it. No global clock or fake Agent is used. The expensive model output is scripted. The References observation is the only explicitly simulated application dependency in isolated Claims cases; the separate actual-dependency control and actual-References Claims-chain test mount the real References implementation. The control independently proves that the dependency path is usable even though Claims remains inert.

## Remaining acceptance work

This is a behavioral test handoff, not completion of 00.13. The canonical top-level recorded-session snapshot has not been authored or run; the keyless Loader/model result-projection case is not mislabeled as that snapshot. The parent explicitly reserves that canonical actual-tool snapshot for the GREEN implementation. Broader positive measurement-environment semantics and actual recorded preset substitution are not separately exercised here. Production README, Agent Note, package aggregate registration, built publication smoke and post-transfer checks remain implementation/acceptance work.

No mechanically inspected local file is claimed to establish honest Research source usage. The tests accept a properly attributed reported finding while preserving unverified legacy attribution, and block actual Test Writer delegation when `requireAdmissible` rejects. They do not implement 00.09's complete handoff coordinator.

## What to learn

A behavioral RED runs the real entry path far enough to observe missing behavior; an import error does not. Content addressing binds a report to bytes, not truth. A settled delegation establishes the report's author, not inspection of every cited file. Deferred cleanup barriers distinguish cancellation requested from cleanup completed. The reusable pattern is an actual dependency control beside fail-closed owner tests; use it when a missing new service could otherwise hide a broken fixture. No external prior-art source was inspected or reused during this Test Writer task.
