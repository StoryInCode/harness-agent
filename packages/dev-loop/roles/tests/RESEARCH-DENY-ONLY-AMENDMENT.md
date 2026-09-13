# Generic deny-only fixture amendment

The parent explicitly authorized this new baseline after Utility reported 00.07's 18 policy tests GREEN and one stale generic fixture. Research requires a nonempty explicit allowlist; the runtime still supports deny-only filters for other configured roles.

Only two expressions in `coverage-config-tools.spec.ts` change: the generic deny-only policy is configured on `Utility`, and its existing delegation requests `role: Utility`. The same read-present/write-absent/edit-absent model-schema assertions and successful actual provider execution remain. The Research default stays unchanged. No production source or other historical assertion changes.

`RESEARCH-DENY-ONLY-PREDECESSOR-SHA256SUMS` preserves the prior file fingerprint. `RESEARCH-DENY-ONLY-AMENDMENT-SHA256SUMS` freezes the replacement and its executed evidence. Earlier historical manifests are not rewritten.

From `/home/sic/harness-agent/.worktrees/research-policy`:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/coverage-config-tools.spec.ts --testTimeout=90000 --hookTimeout=90000
```

Exit 0: six tests passed against the unchanged copied production baseline; `research-deny-only-amendment.log` records the run. The parent-reported post-implementation stale failure is not claimed as a run by this Test Writer. Utility must rerun this superseding test on its implementation before transfer acceptance.

The distinction matters: Research's deployment policy is stricter than the generic runtime filter operation. Preserve generic deny-only coverage without using Research as the positive example.
