# Development-loop base review and continuation

## Consolidation

The work from `piece/dev-loop-base` is consolidated into the main `master` checkout at `/home/sic/harness-agent`. The two refs had no divergent commits. The transfer preserved the existing master changes, added the directory and lifecycle packages, merged their TypeScript references, and regenerated the lockfile. No commit was created. The old branch and linked worktree were removed.

## Baseline evidence on master (before repair regressions)

- `pnpm exec vitest run packages/dev-loop`: 131 tests passed (90 directory, 41 lifecycle).
- `pnpm exec vitest run scripts/check-pieces.spec.ts`: 22 tests passed.
- `pnpm exec tsc -b packages/dev-loop/lifecycle/tsconfig.json --pretty false`: passed.
- `pnpm run constraints`: passed.
- `pnpm run test:docs`: 14 passed, one failed. The failure is the pre-existing `packages/subagent/subagent-antigravity/README.zh.md` link to `docs/architecture.zh.md#profiles-and-bundles`.
- `git diff --check`: passed.

These baseline checks did not establish completion. The independent review below found behavior the pre-repair tests did not exercise.

## Lifecycle: blocking review findings

Reported by Reviewer agent `2d58a970-fc18-4c02-a82e-c181e7aa6d4d`, reviewing the frozen master tree without edits:

1. `packages/dev-loop/lifecycle/src/index.ts`, `transition`/`complete`: no `piece/pre-complete` dispatch or claim/gate enforcement. The full-loop verification requirement is unmet.
2. `moveIntoDone`: `readText` plus unconditional `writeText` can overwrite an intervening edit. Use the filesystem's literal/version-guarded edit operation and test concurrent edits.
3. `complete`: updates memory only. The ordering test observes subprocesses and events, not a durable record. Persistence integration remains required in 00.12.
4. After rewriting the header, a move failure leaves the file declaring `done` while memory remains `pending`. Restart can hydrate an absorbing `done` in the wrong location. Ordinary failure recovery and crash reconciliation need separate tests.
5. Disposing the lifecycle fiber does not abort or await its in-flight subprocesses. Teardown must reach quiescence, not merely unregister the service.
6. README listener-isolation claims are false: Cordis `emit` propagates synchronous listener exceptions. Tests currently discard the transition result in that case.

Additional gaps: the retry test fails at tracking before any rewrite; staging and directory-creation exits are ignored; preflight JSDoc contradicts the implemented `ls-files` check. Focused coverage was 100%, demonstrating that covered lines alone do not prove these requirements.

The lifecycle repair specification has been reconciled, including teaching and acceptance. Full-loop approval, gate, persistence, and crash recovery remain explicitly required integrations. Do not treat separating an integration requirement from local behavior as implementing that requirement.

## Repair RED evidence

Test Writer `d3aad87e-4865-4cdc-90d8-0f79fa9f4ad4` added 18 cases in `packages/dev-loop/lifecycle/tests/repair.spec.ts` and corrected the obsolete existing mkdir attribution assertion. The parent independently ran `pnpm exec vitest run packages/dev-loop/lifecycle/tests` on master: **59 tests, 15 failed / 44 passed**, exit 1, without import failures or timeouts. This is deliberate RED evidence against the baseline source.

The new cases cover the serial hook, guarded-edit race, exact staging/directory errors, post-edit recovery/conflict, real post-rewrite retry, the complete todo → pending → done chain, fifth-argument cancellation, and held operation/recovery quiescence. The chained transition exposed another bug: memory becomes pending but disk remains todo, so replacing the assumed pending header does nothing.

Frozen Test Writer hashes:

- `repair.spec.ts`: `dbbad39f56152b03de946d115200ac5535ad84b9845f1e33474a4f76873c19c4`
- `lifecycle.spec.ts`: `7b973b2efdc22487815f14a01697d53e174dd0cfc55bb28c26e63c052f312416`

Independent Reviewer `2d58a970-fc18-4c02-a82e-c181e7aa6d4d` found lint errors and assertion gaps. The Test Writer corrected them in a second detached tree, including an async-listener case proving emit does not await listeners, no pre/post-cancellation reads, exact cancellation reason, causal shared forward signal, a live recovery signal, and an actual second guarded recovery edit. The existing ordering test now names the in-memory status it observes, not a nonexistent durable record.

Final Test Writer hashes:

- `repair.spec.ts`: `10c35e902624dc073c6b30082574260354f51e7ef0271ee89f9e5694a4ea8c9e`
- `lifecycle.spec.ts`: `0fe181fd0960a1d8c9c447587e95b1209424b36410bc9e3fe5682dda859c01d6`

Both Test Writer trees were removed after their changes reached master. Implementer `b3f8ec8e-3118-4f42-889f-83814a33627d` supplied source-only repairs from detached `.worktrees/lifecycle-implementer`. The source and English README are on master. That worktree was kept frozen through production review, then removed after its source reached master and the Reviewer reported.

## Round 29 GREEN and remaining gates

Historical parent measurements on master after that round's test amendments:

- `pnpm exec vitest run packages/dev-loop/lifecycle/tests`: **60 passed** (41 existing + 19 repair cases).
- `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/lifecycle/src packages/dev-loop/lifecycle/tests`: zero warnings/errors.
- `pnpm exec tsc -b packages/dev-loop/lifecycle/tsconfig.json --pretty false`: passed.
- Full host compile, `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json --pretty false`: passed. A direct pnpm/tsc invocation first exhausted its default ~2 GiB heap; the retry used the repository build's declared heap budget.
- `pnpm exec vitest run scripts/check-pieces.spec.ts`: 22 passed after removing an unused fixture variable exposed by the host compile.
- Focused coverage: **60 passed but gate failed**, 98.5% statements / 92.85% branches / 100% functions and lines. Missing cases: source disappears before stat, file lacks an H2 section, missing/invalid on-disk status. At that snapshot the locations were 412–418 after metadata cleanup. No coverage exceptions were added.
- All four piece checks over `plans/pieces/00-dev-loop/[0-9]*.md`: 14 pieces conform. This proves format, not semantic completeness. Whole-corpus sections check still reports 233 violations in sets 01–06; a directory argument checked zero files and was not accepted as evidence.
- `pnpm run verify-agent-note-format`: 347 notes conform.
- `pnpm run doc-sync`: **25 passed, 8 failed**. Own failures include missing lifecycle type documentation/classifications and group README, invalid scoped-event annotations, stale generated catalogs, and the unused checker fixture variable. Unrelated failures include external-auth export JSDoc and the Antigravity Chinese anchor. The parent removed the four invalid `@dshScopeScan` tags from the unscoped piece events; `pnpm run verify-scoped-events` now passes. The unused variable is also fixed and the host compile passes; the complete documentation aggregate has not been rerun.

The current changes are not completion of piece 00.02 or the full goal. Production review, coverage, documentation ownership, and the remaining packages/composition are still required.

## Approval: research findings

Reported by Research agent `2c71989f-930e-4292-b974-9d67787c5ab3`, with no edits:

- Use `defineTool` from `@deepseek-ai/dsh-tools`; inject `tools`, `userQuestions`, `devLoopDirectory`, `devLoopLifecycle`, and `fs`.
- Require the calling agent explicitly. `UserQuestionService.ask` permits agent-less unscoped providers; live-root enforcement is conditional on an agent being supplied.
- The generic question composer always offers custom text. A two-question batch cannot disable it on the decision question. Reject ambiguous/skipped/custom-only decisions without approving; specify this before writing tests.
- `PieceRecord` lacks teaching and References bodies. Resolve its path with `fs.resolve`, then read through `fs.readText`, forwarding cancellation. A second read can differ from the validated scan; do not rely on the earlier line count as a bound on the second read.
- Preserve the distinction between missing pieces (`PIECE_NOT_FOUND`) and malformed pieces (`PieceParseError`).
- A pending question is not durable. Resume repair records an interrupted tool result; it does not automatically re-present the question.
- The binary plan-review card is a markdown-display precedent, not a three-way feedback implementation.
- Missing teaching-subsection warnings are new consumer behavior requiring explicit detection and tests.

## Next role cycle

Collect the lifecycle implementation, verify pinned tests, and obtain a fresh production review before calling the repairs complete. The approval specification is reconciled from Research. Direct inspection found `DevLoopDirectory.validate(path, content)` already exposes current-text validation with its configured options; no new parser API is needed. Do not edit a tree under active review. Keep all commits under the owner's control.

## agy execution evidence

`agy --dangerously-skip-permissions --print-timeout 180s --output-format text --print='<read-only approval audit>'` completed and returned the piece's already-marked unverified claims. A later five-minute specification-writing request timed out with no completed result; no successful write or verification is attributed to that request. A ten-minute-budget narrow approval correction exited zero with no output, and inspection showed the requested correction was not applied. The parent performed and verified the specification edits directly; exit zero alone was not accepted as evidence of an agy edit.

An explicit accept-edits-mode JSON smoke returned AGY_HEADLESS_OK with status SUCCESS. A subsequent `--mode accept-edits --output-format json` invocation read this file and appended the smoke-result paragraph; the parent read the file and verified that edit. This establishes a working agy read/write path, not success of the earlier unsuccessful requests.

## Round 30: source review, regressions, and documentation

Production Reviewer `2d58a970-fc18-4c02-a82e-c181e7aa6d4d` rejected the 60-green source: startup disposal could not cancel pending hydration, subprocess `done` did not establish managed-range quiescence, and post-move cancellation escaped recovery. The parent inspected Cordis disposal and the subprocess contract, amended 00.02, and obtained a further 25 Test Writer cases. The parent reproduced **20 failed / 65 passed** on master before the Implementer changed source. Frozen test hash: `40df7e62c9a9bf69ac43b6fd0c7c77ea13f68d5715467d1a2eae3eb33ef829f4`.

Implementer `b3f8ec8e-3118-4f42-889f-83814a33627d` repaired those issues and added validated process budgets. Source hash `2209696b838f10e1dd9bb2fa8bede753ad915a7380b4eec92bacf348a99d711a`, README hash `1d0ebc061b40dd4cdbbfa3f4cac54e222874b57f7043cffdcc7df575df255edc`. Parent verification on master passed **85 lifecycle tests and 100% statements/branches/functions/lines**, plus 70 fork-policy tests and 10 catalog-partition tests (**165 total**) and focused source/test/script lint. No coverage ignore was added. Independent review confirmed startup cancellation, managed-range joining, post-move recovery, and both synchronous/asynchronous announcement semantics.

That rereview traced two further defects rather than treating coverage as completion: directory root/set/done `fs.resolve` calls dropped the signal, and a nonzero command could override cancellation arriving during its cleanup wait. Test Writer added 7 cases in the same repair spec; parent reproduced **6 failed / 1 passed**, with 44 other repair cases filtered, without import errors or timeouts. Final follow-up test hash: `46e4c966a141689b4fc1adfd6e816290cf230eaad7b379fe06b7ea962ac46d61`. The baseline directory source is `decccd124563e16eb3db1ad9e1af34932501c324e59119676435994c7166ced2`. The Implementer repaired those remaining paths. Parent verification on master passed **182 tests** (90 directory, 92 lifecycle) with **100% statements/branches/functions/lines** across directory/index.ts, directory/parse.ts and lifecycle/index.ts. Final source hashes: directory `6b7818526bbb0f0797a3ed6c1b1a9fb2ed61205e248de4003cd7944ade4811b9`, lifecycle `8a5436b520e1a8ee5e9c196df940afceede269184ebb6758f17929e45411c470`. The independent Reviewer verified the frozen hashes and found **no remaining production blockers**. Its non-blocking note: the directory fixture rejects after abort, so a successful late provider result is not independently exercised, although explicit post-resolve checks exist in source. The final worker tree was removed after review and transfer; only master remains. The package description now correctly says Git-staged rather than git-committed.

Documentation agent `c324bead-60c8-4939-978e-cfc40cbfd567` supplied the group README, canonical `docs/subsystems/development-loop.md`, navigation row, and nine catalog owner mappings. Parent integrated only curated files, preserving unrelated changes. The subsystem ownership check passes (51 groups, 45 linked, six existing exemptions). The generator still demanded a nonexistent Chinese page, so the fork's explicit English-only policy needed its own integration rather than a fake translation or a broad skip.

The parent used **agy as Test Writer** in an isolated worktree: `--dangerously-skip-permissions --mode accept-edits --print-timeout 8m --output-format json`. It wrote the actual new `scripts/fork-gate-overrides.spec.ts`; source read-back and hash `f5c00cd9aa1b1cc01aad1c4ddf430e06d385cd73ab12e06cf771e66d0436ef7f` verified delivery. Parent independently reproduced **31 failed / 35 passed**, implemented optional reasoned English-only page choices, and passed all 66 cases. Four selector cases then proved retained English, unchanged unnamed bilingual owners, and stale-owner rejection; all **70 pass**. Only type scaffolding/imports and selector cases changed after agy's frozen delivery, not its original assertions.

`pnpm run gen-cordis-catalog && pnpm run verify-cordis-catalog` passes: **98 artifacts computed, one written, zero pair records refreshed; all 98 fresh**. The independent documentation Reviewer inspected the policy and performed process-local read-only probes: all 46 mapped owners retain English, only development-loop omits Chinese, missing development-loop English still rejects, and missing core Chinese still rejects. No policy blocker remains. The fork policy note and `FORK.md` record the additional marked integration point. Full documentation/build/hygiene gates and remaining loop packages/preset still remain; no piece or goal completion is claimed.

After the last source transfer, catalog generation succeeded again (98 artifacts, two written) and config-catalog generation succeeded. The chained verification then stopped in `gen-doc-graphs.ts`: **missing service role classification: devLoopDirectory, devLoopLifecycle**. Module-graph generation, host compile and doc-sync later in that chain did not run. Next work must register their actual roles in `SERVICE_ROLES`, preserving its completeness checks. A separate `verify-export-jsdoc` run reports 11 missing public-doc tags in the pre-existing `packages/llm/llm-pi-ai/src/external-auth.ts`; the file was inspected but not changed. The pre-existing Antigravity Chinese README anchor remains pending, not waived.

The owner added an English-only repository task. It is persisted in goal revision **4** and the task queue: inventory and remove Chinese content/localization, update affected consumers/generators/tests/links, and enforce an upstream-sync policy that does not reintroduce Chinese. Preserve functional and Unicode-test coverage and do not rewrite Git history. This is queued work, not a claim that removal has already happened.

## Historical checkpoint — rounds 31–33

**Implemented:** Directory and Lifecycle, the first two packages. Parent verified 182 tests and strict 100% source coverage; independent production review found no remaining blockers. No piece has been moved to done yet. Approval is researched/specification-ready, not implemented; the remaining packages and mountable preset are not built.

**Repository gates now passed on master:** `pnpm run build`; `pnpm run hygiene` (16/16); `pnpm run lint` (zero warnings/errors across 3,597 files); `pnpm run doc-sync` (33/33); full host TypeScript build with the declared 4-GiB heap. This supersedes the pending gate failures above.

The graph generator now classifies the two concrete services and their four direct consumer relations. Public JSDoc was completed in the existing external-auth source without behavior changes; the broken Antigravity README link targets the English architecture anchor. The website navigation assertion follows the reviewed language-selection policy. Parent passed 139 projection/fragment/policy tests and focused lint. Independent Reviewer `c324bead-60c8-4939-978e-cfc40cbfd567` approved both classification and navigation changes; its isolated negative probes confirmed that missing English or non-exempt Chinese navigation still fails. `FORK.md` inventories the marked integrations.

**Current work:** Test Writer `d3aad87e-4865-4cdc-90d8-0f79fa9f4ad4` owns a genuine built-export/real-provider smoke in detached `.worktrees/base-built-smoke`. Research verified the published exports and actual FS-local/subprocess-local mount recipe. The smoke must prove todo → pending → done, exact file/header/index results, unchanged HEAD after the private fixture's setup commit, and disposal before fixture removal. No successful smoke run has yet been reported. At round 33 the worker was resumed in its existing tree; no built e2e file was present when the parent checked.

**English-only task:** inventory completed, removal/enforcement not started. `plans/ENGLISH-ONLY-MIGRATION.md` records reported measurements, owners, sequencing, and historical-data constraints: 1,442 Chinese Markdown counterparts, 1,439 sidecars, 1,365 switcher-only English files, and 628 sealed archived counterparts. No bulk delete, seal bypass, or Git-history rewrite occurred.

**Next:** finish/review the built smoke, close the base pieces honestly, then execute Approval's Test Writer → RED → Implementer → Reviewer cycle. Validator generalization, remaining pieces, full preset mounting/demo, and English-only migration remain open. At that checkpoint all real repository work was uncommitted on master; only the active test worker had a detached scratch tree.

## Current milestone — rounds 34–36

00.01 and 00.02 are physically in `plans/pieces/00-dev-loop/done/`, both headers declare done, and the set index links their new locations. Parent post-transfer verification on master passed all **182 unit tests plus one built Loader e2e**. The e2e uses published package exports and actual local providers; it proves exact destination bytes, staged rename, no unstaged changes, unchanged HEAD/commit count, and service removal after awaited disposal. Frozen e2e hash: `55164ced8d8994990a011788929a20d0bb700f57e56d5827a5dccd4d831b2930`. The smoke worktree was retired.

The owner removed the separate Reviewer stage and requires tests passing on master after transfer. Goal revision 8 and the set's role/gate specifications reflect that workflow; earlier review records remain historical evidence, not new required work. Goal revision 9 additionally authorizes and requires a commit after each completed milestone, without pushing or including unrelated work.

The owner clarified that they staged the whole snapshot and wanted it committed. Commit **`da88f86714`** records that authorized snapshot, including the base milestone, authentication/UI/Antigravity work, and planning corpus. All normal pre-commit hooks passed after whitespace and documentation-record/link repairs; staged lint reported one non-blocking unused-directive warning. No hooks were disabled and nothing was pushed. The working tree was clean immediately afterward.

00.03 Approval's Test Writer froze 43 cases: **41 behavioral RED and 2 passing**, without import/setup failures or timeouts. Test hash: `b66ff781a36806d619b43c9aa63319705e62730923169c399aa1681ce2cc3af7`. Implementer `b3f8ec8e-3118-4f42-889f-83814a33627d` owns production source and README in detached `.worktrees/approval`; no test changes or Reviewer handoff are authorized. Queue research is resolving its missing dispatch/caller interface before test authoring.

## Approval milestone — rounds 37–38

Approval is implemented on master and moved into `00-dev-loop/done/`, with its index updated. The original 43-case baseline gained one explicitly GREEN coverage case for a file disappearing after lookup: 44 unit cases now pass with 100% source coverage. A separate real Loader/AgentLoop case records a four-row session transcript, checks result replay into the next model request, and observes pending status. Its frozen hash is `167d90ec576c4a915208e3b07a8923922c6c01d040926a127e022c2340e36a4e`. Parent post-transfer checks passed 226 combined unit cases plus two integration cases. The Approval scratch tree was retired.

Build, all 16 hygiene gates, all 33 documentation gates, and repository lint (0 warnings/errors across 3,603 files) passed. Package checks caught missing publication metadata; documentation checks caught a missing catalog entry and incompatible Dev Note heading depth. The catalog regression first failed because Approval was absent, then passed after an explicit real-provider boot entry. Dev Note is H3 beneath limitations, satisfying both existing validators without weakening them. Existing catalog counterparts received matching English technical additions; Chinese removal/enforcement remains queued.

Queue research exposed missing caller/dispatch context. Its amended specification uses per-request callbacks and the existing one-shot result/disposal handle rather than inventing assignments from approval events. Test Writer froze 38 cases (27 behavioral RED, 11 passing); Implementer reported all 38 GREEN in the isolated queue tree. Two narrowly scoped coverage additions are in progress. No separate Reviewer was dispatched. Worktree research additionally found a nonexistent allocator, forbidden branch assumptions, and no current subagent cwd override; 00.05 must be amended before its tests are written.

## Queue milestone — round 38

Approval committed as **`48bd64f336`**, with all normal hooks passing and no push. Queue then transferred from its detached tree, which was retired. Parent passed **40 cases at 100% source coverage** on master; the original 38 cases remain a byte-identical prefix, with two explicitly GREEN cancellation-coverage additions. Frozen test hash: `f8c2e74442fd549e2a8860d383f1e712d3b900dbb2ff364b1263a4db3a869a02`. The source received only public JSDoc completion after transfer. Build and all 16 hygiene gates passed. Documentation's 32 other checks passed; its sole Agent Note format failure was repaired and the exact validator passed. Changed-source lint reported zero warnings/errors. Queue moved into `done/` and the index was updated before its milestone commit.

The generated catalog required explicit Queue service and signature-type ownership. Graph classification includes the actual Queue and Approval consumers rather than assuming an approval event supplies dispatch context. The existing graph counterparts received the corresponding technical additions and their named pairs passed validation. Parent read p-queue's README cancellation and custom-queue documentation, not its implementation, and recorded the comparison without claiming code reuse or a pinned-version guarantee.

Worktree's amended 191-line specification is still todo. Test Writer `5d0533ab-d9dd-49b4-8643-98e039fde0b4` froze **28 behavioral RED cases**, with no import/setup failures, in `.worktrees/worktree-tests` at `48bd64f336`. Test hash: `304f85013bbe90c1f905aee2980396a29eeeb9dd2581dad433e04cab81440d68`. Implementer `382192f9-39fb-4445-83f2-1e303b3791ec` owns that isolated package. Allocation cannot set a child session's cwd through the existing subagent request; 00.06 must resolve that real integration gap rather than mutate parent metadata.
