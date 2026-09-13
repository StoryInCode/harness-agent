# Agent Note: fork-local gate policy and upstream sync

Status: implemented

English | [中文](2026-09-12-fork-local-gate-policy-and-upstream-sync.zh.md)

## Problem

This checkout is a fork of `deepseek-ai/deepseek-harness`, and upstream moves fast: 4,023 commits in the 30 days before this note, with `tsconfig.host.json` alone taking 571 commits in 90 days, `tsconfig.base.json` 391, `verify-package-readme-model-experience.ts` 316, and `scripts/run-gates.ts` 251. Any fork change that edits one of those files conflicts on nearly every sync.

Two concrete needs forced the issue. The fork ships English-only documentation, so `verify-translation-pairing` fails on every fork-local package README; upstream requires a Chinese counterpart plus an `.i18n.yaml` consistency record for each. And fork-local packages under `packages/dev-loop/` need path aliases and project references, which `gen-tsconfig-paths` cannot generate for a package whose directory name differs from its npm name.

The naive responses both fail. Deleting the offending gate script conflicts on every upstream change to it and destroys the ability to run the check deliberately. Hand-maintaining the wiring edits means re-resolving the same conflicts several times a day, indefinitely, with no record of what the fork actually changed or why.

## Decision

Fork behaviour lives in files upstream does not have, because a file upstream lacks cannot conflict. Editing an upstream-owned file is a last resort, kept to the smallest possible footprint, and marked.

`scripts/fork-gate-overrides.ts` and `scripts/fork-gate-overrides.manifest.json` own gate policy. The manifest lists gates this fork does not run and **requires a non-empty reason per entry**, so an unexplained exclusion cannot be mistaken for a mistake. Malformed policy throws rather than degrading to "run everything", because a typo must not silently restore a gate the fork removed or remove one it wants. `applyForkGatePolicy` is generic over the caller's gate type and also prunes removed ids from every surviving gate's `needs` and `after`, since a dependency naming an absent gate would strand its dependent as permanently unsatisfied.

Aggregate filtering has one upstream-owned touchpoint: the wrapped return in `gatesForMode` in `scripts/run-gates.ts`. `translation-pairing` is the only disabled gate; `pnpm run verify-translation-pairing` still runs by name.

The catalog generator independently expands each owning page into language files. The manifest's optional `englishOnlySubsystemPages` records English basenames and non-empty reasons, and `resolveForkSubsystemPages` supplies the required files to `gen-cordis-catalog.ts`. English always remains required. Every unnamed page retains both languages; a policy entry naming no mapped owner fails. This second upstream call site is necessary because aggregate filtering cannot change an individual generator's language requirements. `development-loop.md` is the declared English-only owner. Parser, ownership, marker, type-link, and freshness checks are not disabled. The subsystem navigation assertion in `scripts/project-doc-site.spec.ts` uses the same selected targets: English rows remain mandatory and only declared Chinese counterparts are omitted. Independent negative probes confirmed that deleting the English-only page's English row, an ordinary English row, or an ordinary Chinese row still fails.

Every fork-local edit inside an upstream-owned file carries a `FORK-LOCAL:` comment, and `FORK.md` is the complete inventory: fork-owned files, each marked edit with why it could not be avoided, the disabled gates, and the sync procedure. `scripts/fork-diff.ts` computes the divergence against `upstream/master`, separating fork-owned additions (which cannot conflict) from modified upstream files (the real conflict surface), and flags any modified upstream file lacking a marker. It reaches the working tree rather than only `HEAD`, because divergence is a property of the files on disk.

Integration is by merging upstream into the fork, never cherry-picking forward: a merge advances the merge base so `git rerere` replays each resolution, while cherry-picks carry no ancestry and so recur forever and destroy `git diff upstream/master...HEAD` as a divergence measure. `rerere.enabled` and `rerere.autoupdate` are set. `origin` points at the fork and `upstream` is fetch-only, its push URL deliberately disabled.

Fork-local packages stay inside `packages/` rather than in an isolated tree. This deliberately accepts conflicts in the high-churn wiring files in exchange for upstream's 39 `packages/*/*` gates covering fork code, and makes each sync a signal about how upstream change affects fork-local implementations.

### Why `fork-diff` reports instead of failing

`--strict` exits non-zero on unmarked divergence and is the form to run after a merge. The default reports and exits zero, because ordinary in-progress feature work against upstream files legitimately appears as unmarked divergence. Its first run found 16 diverging upstream files, 14 of them unrelated in-progress work. A signal that is red continuously stops being read.

## Alternatives considered

**Delete `verify-translation-pairing.ts`.** Rejected: conflicts on every upstream change to that file, and loses the ability to run the check deliberately.

**Add the fork's READMEs to `scripts/translation-pairing.manifest.json`.** Rejected: that manifest's stated contract covers documents that are "generated, instructional, or bilingual by construction", and all nine existing entries genuinely are. A package README is none of those, so the entry would be an abuse of an exemption, and it would hide the divergence from `FORK.md`.

**Move fork-local packages out of `packages/` into an isolated tree.** Measured as cheaper on conflicts — it would cut upstream-file edits from four to one, since 39 gate scripts and `gen-tsconfig-paths` hardcode `packages/*/*` and would stop seeing the fork's code, and it would make the `translation-pairing` override unnecessary. Rejected by the owner in favour of upstream's gates covering fork code and of treating each merge as deliberate development work that reveals how upstream change affects fork implementations.

**Silently skip every missing Chinese catalog page.** Rejected: an accidental deletion of an existing pair becomes indistinguishable from an intentional English-only owner. Explicit page choices preserve that distinction and remain checked against the generator's live ownership maps.

**A separate repository consumed as a dependency.** Zero edits to this checkout, but needs its own CI, versioning, and a publish or link step on every local change.

**A fork-owned generator that idempotently re-inserts the wiring edits.** Still under consideration for the tsconfig entries; it converts a hand-patch into re-running one command. Not built yet, because with one fork-local package the edits are two lines.

## Consequences

Gate and page-language choices are data with mandatory justifications. [FORK.md](../../../../FORK.md) inventories the additive, marked integration points. Private-fixture tests validate policy parsing and dependency pruning, while language-selection tests retain English and unnamed bilingual owners and reject stale policy entries. The divergence question is answerable on demand rather than reconstructed.

The cost is that the fork no longer runs `translation-pairing` at all, not merely for fork-local files: the mechanism is aggregate-wide, so an upstream document losing its Chinese counterpart would go unnoticed here. Re-enabling is a one-line manifest deletion. The fork accepts recurring conflicts in wiring, catalog integration, and navigation files as the price of upstream gate coverage. The marked policy call sites and documentation-owner registrations must survive upstream merges.

`FORK.md` and the `FORK-LOCAL` markers are only as good as the discipline maintaining them; `fork-diff --strict` is the mechanical check that they stay complete, and it is advisory unless someone runs it.

## Deferred

The committed `pnpm-lock.yaml` disagrees with the committed `pnpm-workspace.yaml` overrides, so `pnpm install --frozen-lockfile` fails on a clean checkout with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. This predates the fork's changes and is recorded in `FORK.md`.

## Related

This note partially supersedes two upstream decisions, which stay active because they remain authoritative upstream and for every gate this fork still runs:

- [the bilingual docs and pairing gate](2026-07-02-bilingual-docs-and-pairing-gate.md) — establishes the pairing requirement this fork stops enforcing. Its rationale is unchanged; only this fork's participation in it is.
- [automatic translation-pairing merges](2026-08-08-automatic-translation-pairing-merges.md) — the pairing automation, now unreachable in this fork's aggregates.
- [quality gates](2026-06-11-quality-gates.md) — the gate architecture this policy filters, and the reason `gatesForMode` is the correct single funnel to wrap.

The cross-links run one way by design. Adding a back-link would edit an upstream-owned file for a fork-local concern, which is exactly the conflict surface this note exists to avoid; `FORK.md` and this note are the fork's index instead.
