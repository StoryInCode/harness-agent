# Scoped Loader and initiator diagnostic amendment

The parent authorized two fixture-only corrections without weakening their behavioral assertions or changing runtime source.

- `harness.ts` now mounts the existing `Include` plugin directly through `agentCtx.plugin(Include, { path })`. `EntryTree.create` resolves its stored root group when no parent id is supplied (`vendor/loader/src/config/tree.ts:89–103`); calling the shared Host Loader through an Agent context does not reparent that stored group. A directly plugged Include constructs its EntryGroup from the actual Agent context (`tree.ts:15–18`, `vendor/include/src/index.ts:194–204`). The production preset mounter uses a directly plugged Include subclass for scoped composition (`packages/preset/agent-presets/src/mount.ts`). The fixture still reads the same YAML through the real Loader and keeps all scoped visibility, parser and disposal assertions.
- The missing-initiator assertion in `roles.spec.ts` now expects the existing exact diagnostic `no initiating agent is active`. That text is owned by `AgentRegistry.requireInitiator` (`packages/core/agent/src/index.ts:207,305–308`). The stale-Agent rejection, empty-history and no-model assertions are unchanged. No production catch/rethrow was introduced to satisfy a test regex.

## Focused evidence

Under a parent-confirmed runtime-source hold, the following command passed:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/model-tools.spec.ts packages/dev-loop/roles/tests/roles.spec.ts -t 'exposes both scoped schemas|rejects a service call without the exact live initiator' --testTimeout=90000 --hookTimeout=90000
```

Exit 0; 2 selected tests passed, 9 unrelated tests filtered/skipped, 2 files, 1.16s wall time. Scope/parser/disposal case: 59ms. Initiator/stale-Agent case: 54ms. `fixture-amendment-vitest.log` preserves the output. This is focused evidence, not an execution of all baseline or supplemental cases.

`pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/roles/tests/harness.ts packages/dev-loop/roles/tests/roles.spec.ts` passed with 0 warnings/errors on 2 files; output is in `fixture-amendment-oxlint.log`.

The parent released the source hold after these measurements. Original RED and supplemental logs remain historical and untouched; the supplemental eight-test GREEN run predates this shared-fixture amendment. Parent/Implementer owns the final assembled rerun. `FIXTURE-AMENDMENT-SHA256SUMS` supersedes only the original manifest's fixture and role-spec digests and identifies this focused evidence.
