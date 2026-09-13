# English-only repository migration

## Status and authority

Queued after the development-loop work; inventory complete, migration not started. The owner requested: “remove all Chinese from the repo. Even upstream updates we will not ingest chinese only english.” Goal revision 4 records this additional objective. Work stays on master, with no commits, new branches, or Git-history rewriting.

This is an inventory and sequencing record, not one implementation-sized specification. Split the stages below into independently reviewed units before implementation. Existing bilingual and archive instructions must be explicitly migrated, not silently ignored or used to defeat the owner's request.

## Measured inventory

Research agent `bff0cfdb-777d-44e0-b7d1-74920655814d` reported the following read-only working-tree measurements during goal round 31. The parent has not independently rescanned the corpus. The candidate set includes tracked and untracked source; it excludes symlinks, ignored outputs, dependencies, Git internals, scratch worktrees, and three environment-like files. Counts describe this dirty working tree, not pristine HEAD.

| Surface | Count | Meaning |
| --- | ---: | --- |
| Git candidate paths | 10,530 | Deduplicated tracked plus unignored untracked paths |
| Chinese Markdown counterparts | 1,442 | 628 archived, 814 elsewhere |
| Translation sidecars | 1,439 | Existing `.i18n.yaml` records |
| Otherwise-English Markdown with switcher-only Han | 1,365 | Remove switchers and repair links without rewriting substantive prose |
| Other Markdown with substantive Han | 76 | Requires individual language/content classification |
| Tests, fixtures, and expected files with Han | 297 | Not all are Chinese UI copy |
| Other source/config files with Han | 72 | Includes locale code and mixed comments/metadata |
| Conventional locale-copy paths | 42 | Plus inline directory-picker dictionaries |
| Source files deriving keys from `zh` | 38 | Change type owners before removing dictionaries |

Han-character detection discovers candidates; it does not distinguish Chinese from Japanese or classify runtime data. The research did not inspect dependency-internal corpora or classify every binary and escaped literal.

## Stage 1: policy and enforceable acceptance

Owners: `FORK.md`, `scripts/fork-gate-overrides.ts`, its manifest/spec, `scripts/run-gates.ts`, `scripts/fork-diff.ts`, root and documentation instructions, and the documentation/archive skills.

The present policy is intentionally narrower than the new task: it disables aggregate translation pairing and exempts only `development-loop.md` from Chinese catalog output. It is not a globally English-only repository policy. `fork-diff` strict mode also does not reject deleted paths merely because they lack an inline marker; deletions need a reviewed inventory, not pretend markers inside absent files.

Add a fork-owned English-only acceptance check and wire it into documentation/CI and the documented upstream-sync procedure. Reject new Chinese counterparts, translation sidecars, shipped Chinese dictionaries, and mixed-source Chinese copy. Scan untracked source and newly added packages too. Guard against an empty or narrowed corpus and stale exceptions. Do not weaken missing-English, type, link, ownership, or freshness checks.

Revise instructions that would recreate Chinese content. The active translation-prompt gate and its fixtures need an explicit disposition before deleting `docs/i18n/`. Audit `.gitattributes` and `scripts/install-lefthook.mjs` translation merge-driver wiring; no install or Git-config changes occurred during inventory.

## Stage 2: generators and website

Owners: `scripts/gen-module-graph.ts`, `scripts/package-graph.spec.ts`, `scripts/gen-cordis-catalog.ts`, `scripts/paired-markdown-derivatives.ts` and its consumers, `scripts/rescope-vendor.ts`, `website/docs.ts`, `website/.vitepress/config.ts`, and `scripts/project-doc-site.ts` plus its tests.

Make language selection explicitly English-only before deleting outputs. Generators must fail when required English is missing, not silently skip missing files. Run each changed generator twice and prove no Chinese output or sidecar returns.

The website currently uses Chinese at the root and English under `/en/`. Propose English at the canonical root with deliberate compatibility aliases/redirects for existing English links. Verify routes, anchors, assets, search, raw Markdown twins, `llms.txt`, and missing-source errors. Keep canonical prose out of `website/`.

## Stage 3: runtime copy and types

Primary owners: `packages/client/locale/src/locale-settings.ts`, `src/locales/`, `src/client/index.ts`, settings/UI consumers, `apps/desktop/src/locale.ts`, and the 42 dictionary owners found by Research. Additional inline copy lives in `packages/client/ui-directory-picker-browse/src/client/index.ts`.

Prefer retaining typed dictionary ownership and `t` while shipping only English built-ins. Removing the entire locale service would touch about 40 package manifests and needlessly remove key/placeholder validation. Move key unions from `typeof zh` to English before deleting Chinese dictionaries; retain missing-key and disposal tests.

English chrome must work with English, `zh-CN`, and `zh-TW` browser/desktop preferences and previously stored Chinese preferences. Preserve user/model Unicode content, input methods, and rendering; this task is not a runtime ban on users entering Unicode. Confirm fallback semantics before modifying persisted settings.

Shipped preset metadata contains Chinese. The deployment-owned preset install must not be edited; the source migration needs its proper owner and must not alter arbitrary user preset metadata. Plans also seed Chinese names/descriptions, notably `plans/14-presets-profiles-and-bundle.md`; update those requirements so future agents do not recreate them.

## Stage 4: content, automation, and behavior-preserving fixtures

Remove Chinese counterparts/sidecars after their consumers change. Remove English switchers and repair links; translate substantive mixed prose rather than deleting useful meaning. Update issue/PR templates and `.github/issue-management/policy.mjs` with its tests. Classify behavior such as `QuestionComposer.tsx` recommendation-suffix recognition separately from comments.

Research's specialist `b230996f` inspected the following Unicode-sensitive examples; these are reported findings, not parent source inspection:

- `fs/fs-local/tests/filesystem.spec.ts`: nine UTF-8 bytes against an eight-byte budget.
- `session-persistence-jsonl/tests/jsonl.spec.ts` and `llm-mock-server/tests/server.spec.ts`: split multibyte data and buffer reuse.
- `directory-picker-native/tests/win32-dialog-bindings.spec.ts`: zero-low-byte BMP values, NUL termination, and surrogate pairs.
- `core/tools/tests/py-types.spec.ts` and `python/sdk/tests/test_runtime_resolution.py`: Unicode identifiers and real child-process I/O.
- `ui-primitives/src/markdown/cjkFriendlyStrong.ts` and `src/ansi.ts`: shared CJK attention and display-width behavior.

Choose non-Chinese replacements preserving the actual encoded-width or character property each test exercises. ASCII replacement is not equivalent. Japanese extension-pack fixtures were actually found; shared Han characters alone cannot classify them as Chinese. Keep general Unicode/CJK processing functional.

## Stage 5: audited historical-data migration

The 628 archived Chinese counterparts belong to frozen triplets. `scripts/archived-agent-notes.ts` owns a version-1 manifest, switcher/header validation, triplet validation, and append-only hash/deletion checks. The manifest is `.agents/notes/archived/manifest.json`; related owners are `scripts/verify-archived-agent-notes.ts`, its specs, and archive instructions. Removing English switchers changes sealed English hashes as well.

Design a one-time versioned migration mapping reviewed old triplet hashes to English-only artifact hashes. Preserve substantive English historical records and their provenance in old Git history. Enforce append-only records and reject tampering, deletion, or unapproved hash changes after migration. Ordinary `--write` must not become permission to bless arbitrary changes; do not disable archive validation.

Released Session fixtures require a separate provenance decision. Han occurs in `snapshots/web/{goal-multi-turn-actions,present,present-svg}/session.v{2,3}.jsonl`; current rules preserve committed generations byte-for-byte. The ALL-removal request requires an explicit audited replacement strategy retaining original evidence in Git history and recording the provenance of replacement replay fixtures. Do not silently change old bytes and describe that as harmless translation.

## Stage 6: upstream-sync acceptance

Keep the existing upstream merge workflow unless independently changed by the owner. Review newly merged source, reapply the minimal marked fork integrations, account for deleted artifacts, and accept the sync only after English-only, behavior, ownership, and freshness checks pass. Blind stripping could corrupt mixed code or meaningful tests. A failed acceptance check means the sync remains unfinished.

Test valid English, a Chinese document, a newly copied dictionary, escaped Chinese copy, a new package, untracked source, stale exceptions, missing English targets, and a narrowed scan. Test generator idempotence, English key/placeholder coverage, archive migration rejection paths, browser/desktop English fallback, and the identified Unicode regressions. Broader checks include typecheck, `verify-client-ui-i18n`, GUI/Web replay, documentation/site builds, and legal bundle checks.

## Legal and runtime-data limits

No Chinese legal notice was found in the reviewed vendor licenses or `THIRD_PARTY_NOTICES`. The observed vendor Han match was `vendor/hmr/package.json` metadata. This is not proof about every dependency or binary. Preserve required license bytes and use the documented vendor sync/reapply procedure.

PDF CMaps, fonts, and wasm are runtime data, not ordinary locale copy. Their license preservation and assets are owned by `ui-sidebar-documentpreview/tsdown.config.ts` and `tests/pdf-license-bundle.client.spec.ts`. No dependency asset purge is authorized by this inventory.

## Teaching: what this inventory changes

**Dependency ordering:** update a producer and its consumers before deleting their shared data. Here, a dictionary also owns TypeScript keys, and a Chinese page also participates in generators, routes, and seals.

**Invariant-preserving migration:** change a stored representation while preserving the property its checks protect. Archive migration should change language representation without giving later writers permission to alter historical English records arbitrarily.

**Property-based fixture design:** preserve the property under test, not a familiar sample string. Nine UTF-8 bytes, a split code point, and a wide terminal glyph are different properties.

**Decision authority:** routine English copy and broken-link fixes can proceed within their owners. Archive/released-fixture policies and website route changes need explicit migration designs and independent review. Do not infer legal permission to delete notices from a text-search result.

No migration tests have run and no Chinese removal is claimed. The immediate next implementation step is a small policy/gate specification with Test Writer → RED → Implementer → Reviewer, not a bulk delete.
