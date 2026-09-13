# Roles policy and lifecycle coverage supplement

## Baseline and ownership

The parent explicitly authorized importing only the current Utility `packages/dev-loop/roles/src` snapshot from roles-tests into research-policy for this supplement. `COVERAGE-POLICY-LIFECYCLE-SOURCE-SHA256SUMS` records that source. This replaces the earlier writer worktree's pre-implementation source for this phase only; previous RED source manifests remain historical records, not checks against the current source. No source was authored or fixed by Test Writer. Only a new test, logs, and manifests were authored; historical frozen tests were not edited.

`coverage-policy-lifecycle.spec.ts` is observed GREEN coverage, not a claimed new RED regression. The first exploratory run had four passing cases and one fixture-only failure: it incorrectly expected whole-Context disposal to reject after the Queue's effect reported an error. All intended terminal-record assertions already passed. That new-fixture expectation was removed before this freeze, without changing production or weakening a product assertion.

## Executed checks

From `/home/sic/harness-agent/.worktrees/research-policy`:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/coverage-policy-lifecycle.spec.ts --testTimeout=90000 --hookTimeout=90000
pnpm exec oxlint packages/dev-loop/roles/tests/coverage-policy-lifecycle.spec.ts
pnpm exec tsc -p packages/dev-loop/roles/tests/tsconfig.json --pretty false
```

Vitest: exit 0, five passed. The exact output is `coverage-policy-lifecycle-GREEN.log`; `COVERAGE-POLICY-LIFECYCLE-SHA256SUMS` freezes it and the test. Oxlint: zero warnings/errors. TypeScript: exit 2, vendored strict-mode diagnostics, no Roles source/test diagnostic; this is not a passing typecheck. Test Writer did not run the complete coverage gate for this supplement; Utility owns the combined implementation-side coverage measurement.

## Evidence and limits

The generic missing allow/deny policy belongs to Utility so it reaches the generic configuration refusal independently of Research's earlier, stricter allowlist requirement.

A test-only registered external provider simulates an endpoint diagnostic and a disposal fault. The real public SubagentRuntime validates the provider request and publishes the remote run catalog; the real Queue owns result observation, disposal, cancellation and its recorded cleanup failure; the real Roles service persists the observation through its durable domain. The provider mints a remote id and returns `localAgent: undefined`, rather than manufacturing a local Agent or replacing a Queue ticket. Counters observe one actual provider start and disposal. The successful-cleanup case retains the provider diagnostic separately from assistant output. The disposal-fault case observes the real cancellation failure branch through the persisted aggregate limitation and `cleanup: unproven`. This tests mapping of a simulated external outcome, not a claim that a real external transport or OS process failed.

The exact-caller check is reachable and must not be removed as redundant. A real Loader-mounted root consumer remains registered when the original Agent's own scoped contribution is disposed. `ToolRuntime.execute` with the actual disposed Agent then returns `Error: Role tools require an exact live initiator`; omission of the optional Agent reaches the same explicit guard. No Agent-shaped object or registry method mock is used. `ToolRuntime.resolveExecution` (`packages/core/tools/src/index.ts:1211`) resolves tool visibility/presentation, and `dispatchToolBody` (`:1536–1539`) invokes the resolved definition; neither establishes the consumer's live Agent equality. In the original scoped-only deployment, disposal removes the definition earlier, but that narrower topology does not make the public consumer check unreachable.

The distinction to retain is between externally reported lifecycle failure and independently verified local ownership. These tests deliberately report the synthetic provider as synthetic while exercising the real owners that must record its outcomes truthfully.
