# 00.10 Gates — Frozen behavioral RED baseline

## Execution context

Suite executed on the main checkout from a byte-identical copy of this package
(spec hashes verified identical to this worktree before and after the run);
the worktree itself lacks built runtime `lib/` trees that vitest workspace
resolution requires. Evidence log: `/tmp/dsh-gates-main.log`.

Result: **83 tests, 83 failed, 0 passed, 0 skipped** across 8 spec files.
No timeouts; no import or setup failures.

## RED classification

- 80 failures are `AssertionError`: the inert scaffold returns
  `{ kind: 'rejected', error: 'Missing Gates behavior: …' }` where the tests
  require `{ kind: 'settled', … }` outcomes (checks, runner classification
  including `timeout`/`killed`/`truncated`, tool reports, persistence rows,
  veto handoff).
- 3 failures are `ENOENT` on `tests/behavior.spec.js` under the fixture
  piece-worktree: these are consequence-REDs — they flip once the runner
  produces the baseline evidence the assertions consume. They are counted as
  RED and must end as GREEN assertions, not silently-passing controls.
- No test was skipped or weakened; the scaffold's fixed rejections are the
  only production behavior in this tree.

## Expected controls

The suite intentionally contains no green controls: every Gates behavior is
unimplemented at freeze time. Real mainline Lifecycle/Queue/Worktree semantics
are exercised inside the veto and check scenarios and must keep their existing
guarantees during implementation.

## Authority

- Specification: `plans/pieces/00-dev-loop/00.10-verification-gates.md`
- Handoff types: copied snapshot `tests/handoff-snapshot.ts` reconciled from
  the frozen 00.09 DTO (`handoff-tests` worktree, `tests/SHA256SUMS` there).

## Verification commands

```
pnpm exec vitest run packages/dev-loop/gates/tests --testTimeout=30000 --hookTimeout=30000
pnpm exec tsc -p packages/dev-loop/gates/tests/tsconfig.json
pnpm exec oxlint packages/dev-loop/gates
```
