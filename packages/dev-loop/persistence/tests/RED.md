# 00.12 behavioral RED checkpoint

## Result

Detached worktree: `/home/sic/harness-agent/.worktrees/persistence-tests`, base `a35ad037e248f3ba1c5293dbf03244bd7cddbaaf`. This is a pinned candidate checkpoint, not authorization to start production implementation or a claim that the complete independent freeze has been accepted. Outstanding cross-owner fixtures are listed in [CONTRACT.md](CONTRACT.md).

`pnpm exec vitest run packages/dev-loop/persistence/tests --reporter=json --outputFile=/tmp/dsh-persistence-red-handoff.json` exited 1: **57 tests, 51 failed, 6 passed, zero skipped, zero todo**. All failures exercise actual behavior, not imports, missing packages or TypeScript failures. The duplicate-source assertion specifically expects hydration to resolve with a quarantined piece; current Directory-driven initialization instead rejects with `DUPLICATE_PIECE_ID`. That is the intended missing anomaly/hydration behavior.

| File | RED | GREEN | Observable missing behavior |
|---|---:|---:|---|
| approval.spec.ts | 1 | 4 | Actual approval Consumer forwards no sixth authorization argument; existing non-accept safeguards remain green. |
| backend.spec.ts | 10 | 0 | Real JSON domain/write checkpoints are bypassed; malformed authoritative data is never opened; persistence bounds/identity are absent. |
| harness.spec.ts | 0 | 2 | Real Loader/local Git/JSON assembly works; actual activation audit refuses missing entry injection. |
| lifecycle.spec.ts | 24 | 0 | Direct legal edges have no durable history; restart loses pending/blocked; uncertainties are not quarantined; cancellation effects have no records. |
| recovery-command.spec.ts | 16 | 0 | Real CommandRuntime finds no recovery registration; inspection/acknowledgment and actual command log pair are absent. |

## Compiling and compatibility evidence

The following commands executed successfully:

- `pnpm install --offline --ignore-scripts` installed the isolated worktree dependencies; no production install scripts ran.
- `pnpm exec tsc -b packages/dev-loop/persistence packages/dev-loop/lifecycle --pretty false` compiled provider/API prerequisites and adjacent Lifecycle.
- `pnpm exec tsc -p packages/dev-loop/persistence/tsconfig.test.json --pretty false` compiled the strict owned tests and scaffolds.
- `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/persistence/src packages/dev-loop/persistence/tests` reported zero warnings and zero errors.
- `pnpm exec vitest run packages/dev-loop/lifecycle/tests/lifecycle.spec.ts packages/dev-loop/approval/tests/approval.spec.ts` passed **85 existing tests** (41 Lifecycle, 44 Approval), showing that inert API/config declarations preserve standalone memory behavior.
- `git diff --check` found no whitespace errors.

Initial fixture work found two setup defects before accepting RED: missing isolated `node-pty` dependencies were resolved with offline install; an unsupported `{required,optional}` Cordis injection descriptor was removed. A naive standalone typecheck initially compiled vendor source under owned-package strictness; referencing and building the actual vendor compiler faces resolved that configuration error without vendor edits. None of those failed setup attempts is counted as behavioral RED.

## Hashes and transfer boundary

[SHA256SUMS](SHA256SUMS) pins every candidate test/helper, the three inert source files, the exact adjacent Lifecycle prerequisite and unchanged Approval source. Verify from the worktree root with `sha256sum -c packages/dev-loop/persistence/tests/SHA256SUMS`. Implementer production changes necessarily replace scaffold hashes after implementation begins; tests remain writer-owned. Before implementation, any correction requires an updated recorded baseline and hash list.

Production behavior has not been implemented. `src/index.ts` publishes empty/no-op methods and opens no domain; `src/command.ts` registers nothing. Lifecycle still uses its original transition body. Its only source changes are the type-only authorization import, optional durability Config declaration/default and inert optional sixth parameter/JSDoc. Build prerequisite changes include package manifests, TypeScript references/path aliases and lockfile importers. No Agent-loop, Approval behavior, MAIN files, branches or commits were changed.

## What to observe

Run the focused persistence suite and look for the concrete failures `expected []` for history, `expected 'todo' to be 'pending'` on reopen, `expected 'committed' to be 'write'` at actual backend barriers, and missing actual Consumer authorization/registration. These independently show why storage CRUD tests would be insufficient: the shipping Lifecycle can still move a real tracked file into done while no durable authorization record exists. The separate implementation must make these observations agree before success can be reported.
