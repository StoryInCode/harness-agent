# Normalized error-envelope minimum: frozen RED

## Behavior and ownership

The new `supplemental-error-minimum.spec.ts` measures the complete UTF-8 content array of a real delegation overflow receipt through public ToolRuntime execution with a 1024-byte consumer budget. It then executes another actual delegation with exactly that measured budget and verifies `isError`, the actual durable delegation id, and complete content byte equality. Finally, a consumer configured one byte below the measured minimum must refuse mounting.

The test does not inspect private service configuration, import private renderer constants, or hardcode the expected byte count. It uses real Roles, Queue, Worktree, SubagentRuntime, AgentLoop, storage and scoped tool mounting through the shared fixture. Only model responses are scripted. No existing frozen supplemental spec or runtime source was edited.

The owning runtime prefixes thrown tool messages with `Error: ` (`packages/core/tools/src/index.ts:1860–1866`), which contributes seven UTF-8 bytes before the final content wrapper is counted. The held Roles consumer's minimum calculation counted the unprefixed message. A mount accepted below the actual normalized envelope minimum can therefore reach generic finalizer text that loses the durable id; mount validation must count the complete emitted value.

## Executed evidence

The parent held the defective runtime source while these commands ran from the prepared worktree root:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/supplemental-error-minimum.spec.ts --testTimeout=90000 --hookTimeout=90000
pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/roles/tests/supplemental-error-minimum.spec.ts
```

- Vitest: exit 1; 1 test failed behaviorally, 5961ms case time, 7.07s wall time. The generous-budget probe and exact-measured-budget receipt checks completed. The final one-byte-below mount unexpectedly resolved instead of rejecting. There was no setup/import error, timeout, or reported unhandled error. Output is in `error-minimum-RED-vitest.log`.
- Actual repository Oxlint runner: exit 0; 1 file, 0 warnings/errors. Output is in `error-minimum-oxlint.log`.
- The source hold was released to the Implementer for correction after the RED result and immutable test hash were sent to the parent. No GREEN result is claimed here.

Test SHA-256: `6c12a8405988f54efc6b6ca55b2e55c3df5eb5d046df8ea8cc1dc5a724b30c70`. `ERROR-MINIMUM-SHA256SUMS` includes this test, report, and both logs. Verify from the package directory with `sha256sum -c tests/ERROR-MINIMUM-SHA256SUMS`.
