# Fork divergence

This checkout is a fork of `deepseek-ai/deepseek-harness`. This file is the complete inventory of how it differs from upstream, so an upstream merge is a reviewable list rather than an archaeology exercise.

## The rule that keeps merges cheap

**Put fork behaviour in files upstream does not have.** A new file cannot conflict. Editing an upstream-owned file re-conflicts every time upstream touches those lines, so an edit there is a last resort, kept to the smallest possible footprint, and marked.

**Every fork-local edit to an upstream-owned file carries a `FORK-LOCAL:` comment.** That marker is the divergence index:

```sh
grep -rn "FORK-LOCAL" --include='*.ts' --include='*.json' --include='*.yml' --include='*.md' . | grep -v node_modules
```

Prefer, in this order:

1. A new fork-owned file, loaded by an existing extension point.
2. A new fork-owned file plus one call site in an upstream file, marked `FORK-LOCAL:`.
3. A data-only entry in an upstream manifest, when the manifest's stated contract genuinely covers the case. Do not stretch a manifest's contract to make a gate pass; that hides the divergence from this file.
4. Editing upstream logic. Record why nothing above worked.

Never delete an upstream gate script, test, or manifest to silence it. Deletion conflicts on every upstream change to that file and loses the ability to run the check deliberately. Disable it through fork-local policy instead.

## Fork-owned files

| Path | Purpose |
|---|---|
| `FORK.md` | This inventory. |
| `scripts/fork-gate-overrides.ts` | Validates disabled gates and explicit English-only subsystem owners; selects required language files without dropping English ownership or freshness checks. |
| `scripts/fork-gate-overrides.spec.ts` | Private-fixture policy validation, dependency-pruning, and selective language requirements. |
| `scripts/fork-gate-overrides.manifest.json` | Disabled gates and English-only subsystem basenames, each with a reason. |
| `docs/subsystems/development-loop.md` | Canonical English reference for development-loop shared types and generated Cordis API. |
| `scripts/dev-loop-tool-catalog.spec.ts` | Regression proving the opt-in approval tool is harvested despite its non-`tool-*` package name. |
| `scripts/fork-diff.ts` | Divergence inventory against `upstream/master`; `--strict` fails on an unmarked edit to an upstream-owned file. |
| `scripts/check-pieces.ts` | The `plans/AGENTS.md` axiom checkers, validating through the same parser the development loop uses at runtime, so an axiom and its runtime cannot drift. |
| `scripts/check-pieces.spec.ts` | Detection-boundary tests for those checkers, per the `scripts/AGENTS.md` rule that a source-ownership gate tests every form that moves its boundary. |
| `scripts/check-piece-primitive.sh`, `scripts/check-piece-sections.sh`, `scripts/check-claim-citations.sh`, `scripts/check-done-pieces.sh` | The shell wrappers the `axiom` blocks name; each delegates to `check-pieces.ts`. |
| `plans/` | Fork-local specification corpus (`plans/AGENTS.md` axioms, `plans/pieces/**` piece specifications). Outside every upstream gate's scan roots. |
| `packages/dev-loop/**` | Fork-local development-loop packages. |

## Fork-local edits to upstream files

| File | Edit | Why it could not be fork-owned |
|---|---|---|
| [Subagent request and providers](packages/subagent/README.md) | Optional explicit child cwd, resolved before creation by all current providers; owner regressions and matching documentation. | Providers own unpublished child metadata. Commands, presets, and post-creation observers cannot supply that input; the [decision register](.agents/notes/implemented/architecture/2026-09-13-subagent-child-workspace.md) explains the minimal existing-API amendment. |
| `scripts/gen-tool-catalog.ts` | Explicit approval-tool boot entry with actual local filesystem, lifecycle, and question providers. | The runtime schema catalog has a closed boot manifest and its discovery glob does not include `dev-loop/approval`; the regression pins inclusion without weakening the existing completeness checks. |
| `scripts/run-gates.ts` | Import `fork-gate-overrides.ts`, and wrap the aggregate construction: `gatesForMode()` now returns `applyForkGatePolicy(gatesForModeUpstream(selected), …)`. | `gatesForMode` is the only funnel every aggregate passes through, and upstream exposes no gate-filtering hook. Two lines plus a renamed inner function; a conflict here is a two-line reapply. |
| `scripts/gen-cordis-catalog.ts` | Development-loop service/event/type owners and the fork-local language selector. | Ownership maps and language expansion have no external registration point. All partition, English-page, marker, type-link and freshness checks remain active. |
| `docs/subsystems/README.md` | Development-loop navigation row. | The upstream subsystem index owns discovery of the new reference page. |
| `scripts/gen-doc-graphs.ts` | Development-loop service roles and direct filesystem, subprocess, Agent, tool, question, and lifecycle consumer edges. | The upstream role table is the generator's only classification point; its completeness guard remains enabled. |
| `scripts/project-doc-site.spec.ts` | Select subsystem navigation rows with the same explicit language policy. | The upstream assertion otherwise requires a Chinese row for an English-only page; English and unnamed Chinese rows remain mandatory. |
| `scripts/verify-package-readme-model-experience.ts` | Audited `SENTENCE_MODEL_EXPERIENCE` entries for the Directory, Lifecycle, Queue, and Worktree host services. | The allowlist is upstream-owned data with no fork-local override path. The entry is one line in a long literal, so conflicts are unlikely and trivially re-added. |
| `tsconfig.base.json` | Hand-written path alias for each `@deepseek-ai/dsh-dev-loop-*` package. | `gen-tsconfig-paths` only auto-maps a package whose directory equals its name, and `verify-tsconfig-paths` requires every package to be mapped. Additive lines near a generated region. |
| `tsconfig.host.json` | One project reference per fork-local host package. | Project references have no wildcard form in TypeScript. Additive. |

## Disabled gates

Declared in `scripts/fork-gate-overrides.manifest.json`, which requires a reason per entry.

- **`translation-pairing`** — this fork ships English-only documentation. Upstream requires every in-scope document to merge bilingually with a Chinese counterpart and an `.i18n.yaml` consistency record. `scripts/verify-translation-pairing.ts` is untouched and still runnable by name (`pnpm run verify-translation-pairing`) for anyone who wants the report.

## Explicit English-only subsystem pages

The same manifest's `englishOnlySubsystemPages` names `development-loop.md` with a reason. `gen-cordis-catalog` omits only that page's Chinese output. It still requires the English file and generated region, retains bilingual requirements for every unnamed owner, and rejects a stale or misspelled policy owner. Disabling the aggregate pairing check alone does not change catalog language requirements.

## Integration strategy

Upstream moves fast: measured at **4,023 commits in 30 days**, with `tsconfig.host.json` alone taking 571 commits in 90 days. Every choice below follows from that number.

**Merge upstream into this fork. Never cherry-pick forward.** A merge advances the merge base, so each conflict is resolved once and `git rerere` replays the resolution next time. Cherry-picking copies commits without ancestry, so the same conflicts recur on every sync forever and `git diff upstream/master...HEAD` stops describing the real divergence. `rerere.enabled` and `rerere.autoupdate` are set.

**Merge into the mainline, not into a feature branch.** `plans/AGENTS.md` `R-no-feature-branches` forbids creating branches at all: work lands where the owner can see every commit in one place, and isolation comes from detached worktrees under the ignored `.worktrees/` directory rather than from a branch. A sync therefore updates the mainline directly, and any worker holding a detached worktree re-creates it from the new mainline commit rather than merging separately.

**Fork-local packages stay inside `packages/`,** rather than in an isolated tree that upstream's 39 `packages/*/*` gates cannot see. This is a deliberate trade: it accepts conflicts in the high-churn wiring files in exchange for upstream's gates covering fork code, and it makes each sync a real signal about how upstream change affects this fork's implementations.

**Syncing is scheduled development work, not maintenance overhead.** Each sync is expected to produce findings: what upstream changed, which fork-local code it touches, whether an upstream solution now replaces something built here, whether a fork-local choice is deliberate enough to keep, and which parts upstream could enhance rather than replace. Those findings feed the same review-and-teaching loop the `plans/` axioms define for any other unit of work.

### Remotes

```text
origin    git@github.com:StoryInCode/harness-agent.git        (fetch + push)
upstream  git@github.com:deepseek-ai/deepseek-harness.git     (fetch only; push URL disabled)
```

### Per-sync procedure

```sh
git fetch upstream
npx tsx scripts/fork-diff.ts upstream/master             # inventory BEFORE merging
git merge upstream/master
npx tsx scripts/fork-diff.ts --strict upstream/master    # confirm markers survived
pnpm install && pnpm run typecheck && pnpm run doc-sync
```

`scripts/fork-diff.ts` reports fork-owned additions (which cannot conflict) separately from modified upstream files (the real conflict surface), and flags any modified upstream file lacking a `FORK-LOCAL` marker. It reports and exits zero by default, because in-progress feature work against upstream files legitimately appears there; `--strict` turns unmarked divergence into a failure and is the form to run after a merge.

If a conflict lands in an upstream-owned file listed above, reapply the marked edit rather than accepting either side wholesale. If upstream deletes an extension point a fork-owned file depends on, update the fork-owned file and record the new arrangement in the table above.

### Scheduling a sync

`@deepseek-ai/dsh-schedule` is **not** the mechanism for an unattended sync: it delivers durable reminders as follow-up messages inside a live session, and its own README states that "delivery requires a live root agent: closed sessions keep reminders overdue until resumed". Use an OS timer invoking a `dsh` profile, since only `dsh` profiles may launch Node apps. `dsh-schedule` remains useful for nudges inside an already-running session.

## Known divergence debt

- **`pnpm-lock.yaml` at `HEAD` disagrees with `pnpm-workspace.yaml`'s `overrides`**, so `pnpm install --frozen-lockfile` fails on a clean checkout of the committed tree with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. A working lockfile exists in the working tree. This predates the fork's own changes; fix it by committing a regenerated lockfile.
