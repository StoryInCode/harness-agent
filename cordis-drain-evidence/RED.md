# Cordis terminal dependency drain: frozen RED

## Scope and acceptance

Detached worktree `/home/sic/harness-agent/.worktrees/cordis-drain-tests` starts at `4eac349918`. Only the new owner-local test and this evidence directory are added. No vendor production, Host production, main-checkout, branch, or commit edits were made.

The frozen [public framework spec](../packages/extensions/tool-cordis/tests/cordis-drain.spec.ts) tests root disposal, simultaneous consumer disposal and provider withdrawal, provider→middle→consumer teardown, nested plugin ownership, and `RegistryService.delete`. Each blocks consumer cleanup with a local promise and requires public `reflect.notify` to return that terminal affected consumer. The existing provide disposer joins only the returned fibers' `await()` promises; a consumer still using the resource during cleanup therefore remains affected. This expectation does not prescribe a private index. Independent root cleanup is explicitly observed before releasing consumer cleanup. Final terminal→drained→close and empty-registry assertions remain frozen, although the early affected-consumer failure prevents those final assertions from executing on the baseline. The parent's four frozen real Loader/JSON/reopen storage cases remain independent integration acceptance; this worktree neither copies nor changes them.

Two additional passing controls require no terminal consumer reactivation on service republish and preservation of a replacement runtime after a deleted runtime drains. The unchanged [11-test lifecycle suite](../packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts) covers PENDING/LOADING effect admission, cleanup-time admission rejection, reentrant setup/disposal, rollback, and observer-failure containment.

## Source register and minimal implementation candidate

Pinned Cordis remains `4.0.0-rc.7`, upstream `56b3d4f725681cf4556c1a8695a709cc3b6eed74`; there is no upstream sync or version change.

- `reflect.ts:297–302`: service withdrawal deletes the publication, calls notify, awaits affected `fiber.await()` with `allSettled`, then removes owner-local service access.
- `fiber.ts:265–295`: public disposal nulls uid and removes runtime membership before awaiting existing inertia. Hidden terminal consumers cannot be joined by withdrawal.
- `fiber.ts:675–686`: root effects unwind concurrently. Independent cleanup concurrency is required, not a candidate for global serialization.
- `reflect.ts:314–328`: notify traverses registered runtimes/fibers, calls `_checkImpl` and `_refresh`, and returns affected fibers. Terminal consumers must remain joinable without refresh/reactivation.
- `fiber.ts:611–622` and `689–693`: `_refresh` lacks a terminal uid guard; changing its epoch while teardown runs can cause `_unload` to reload. Retaining membership alone is unsafe.
- `registry.ts:258–266`: `delete(plugin: Plugin)` synchronously returns `Plugin.Runtime | undefined`, immediately removes the lookup entry, then calls fiber disposal without returning a completion promise. Tests preserve immediate `get`/`has` absence, a second delete returning undefined, immediate re-registration, and the replacement runtime surviving old cleanup.

The minimal ordinary-disposal candidate retains exact fiber membership through existing inertia settlement, rejects admission immediately with null uid, removes exact membership in finally, and includes terminal affected consumers in notification results without mutating their dependency epoch. Registry.delete needs additional design: its immediate lookup absence and replacement semantics forbid simply delaying deletion of the lookup entry. Any implementation claiming that path must pass its frozen tests. No new public API, test hook, host drain registry, or lease is proposed. Claims/Persistence abort-and-join cannot repair framework-hidden consumers, and no awaited pre-root hook supplies the missing ordering.

A separate implementation must extend local-modifications entry 6 in vendor/README, update the lifecycle documentation and Agent Note, and run the parent-authorized broad tests/build after vendor changes.

## Executed checks

- `pnpm exec vitest run packages/extensions/tool-cordis/tests/cordis-drain.spec.ts packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts`: exit 1; five assertion failures, thirteen passes, no import errors or timeouts. See [red.log](red.log).
- `pnpm exec oxlint packages/extensions/tool-cordis/tests/cordis-drain.spec.ts`: exit 0; see [lint.log](lint.log).
- `pnpm exec tsc -p cordis-drain-evidence/tsconfig.json`: exit 0; see [types.log](types.log). This strict fixture program explicitly resolves the existing main-checkout built Cordis/Cosmokit declarations; it does not rebuild or typecheck vendor implementation source. The declared `@standard-schema/spec` dependency exists in the main Cordis owner's node_modules, so no installation was required.
- An earlier strict source-wide experiment exited 2 on unchanged vendor implementation diagnostics and a missing dependency link in the new worktree. [source-types-failed.log](source-types-failed.log) preserves that unsuccessful experiment; it is not reported as green or suppressed.
- `git diff --check`: exit 0.

[SHA256SUMS](SHA256SUMS) freezes the test, existing controls, source register, logs, and strict compile configuration. The new spec hash is `f45eb7191e9233e2f18bb1a1251bdbe0c97cd9a6ed3a92593a0bf005c7cc29ce`. Existing `/tmp` logs were copied without alteration; later implementation runs must use separate log filenames.

## Amendment 1 (supersedes the frozen root-provider test; hash chain preserved)

The frozen spec (`f45eb7191e9233e2f18bb1a1251bdbe0c97cd9a6ed3a92593a0bf005c7cc29ce`) wrapped the withdrawal inside an `async function` returned as the second element of the root-provider effect's disposer array. That wrapper did not take ownership of the withdrawal: the `ctx.provide()` effect's own disposer remained a concurrent sibling in the fiber's owner disposal list and could unload first, making the wrapper's public `unprovide()` a repeated single-shot call that returns `undefined`, and letting the resource-close effect run before the consumer drained.

An intermediate amendment (`43935ced94feaac28ee7cc02cda9b3dd860f82914bcd994f118406bf68b7e9aa`) returned `[cleanupEffect, provideDisposer]` directly. Collecting the bare provide disposer transfers ownership (the effect's `runner.collect` removes the provide wrapper from the fiber's `_disposables`), but it deleted the only resolution of the `withdrawn` barrier, so all five terminal-notify modes hung to the 5-second timeout instead of reaching the notify assertion. Resolving `withdrawn` from the terminal consumer after `drained` was also evaluated and rejected: provide-disposer withdrawal joins the terminal consumer's cleanup before `release`, so a drain-side resolution deadlocks the same way (verified: 5 timeouts).

The amended spec (`d419970a1474acf322c02811daa9dfcedfeadd9dcfc5b7fae719e3cd38c96853`) returns the three-element array `[cleanupEffectDisposer, provideDisposer, () => withdrawn.resolve(undefined)]` from the same effect. Reverse disposal opens the withdrawal barrier, then runs the owned provide disposer (withdrawal joins the terminal consumer), then closes the resource — `drained` precedes `close` deterministically. Every assertion, control, and barrier outside that one line is byte-identical to the frozen spec, as are the other six tests. Against pre-patch Cordis (all five modes) the suite still fails with the genuine `AssertionError: expected [] to include Fiber` at the frozen `reflect.notify` assertion — no timeouts; the two reactivation controls pass.

Executed checks on the amended spec:

- `pnpm exec vitest run packages/extensions/tool-cordis/tests/cordis-drain.spec.ts packages/extensions/tool-cordis/tests/cordis-lifecycle.spec.ts` with the drain patch applied in the worktree vendor source: exit 0; 18 passed (7 drain + 11 lifecycle), no timeouts. See [red2.log](red2.log).
- Same drain spec with the three patched vendor files temporarily stashed (restored immediately after the run; `git diff` re-verified): exit 1; 5 `AssertionError` failures at the frozen notify assertion, 2 controls passed. This confirms the RED state matches the frozen baseline's failure mode.
- `pnpm exec oxlint packages/extensions/tool-cordis/tests/cordis-drain.spec.ts`: exit 0; 0 warnings, 0 errors. See [lint2.log](lint2.log).
- `pnpm exec tsc -p cordis-drain-evidence/tsconfig.json`: exit 0. See [types2.log](types2.log).
- `git diff --check`: exit 0. No production, vendor (beyond the pre-existing worktree patch state), branch, or commit edits were made.
