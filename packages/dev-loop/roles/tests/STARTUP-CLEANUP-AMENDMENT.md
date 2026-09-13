# Startup cleanup evidence amendment

The current main 00.06 specification distinguishes attempted startup with no returned lease from Queue cleanup of an acquired lease. A rejected start exposes no typed cleanup observation. Roles must record `cleanup: unproven`, even when its own tests observe an empty registry. Successful awaited cancellation can establish cleanup only for an acquired lease.

## Explicit superseding baseline

The parent authorized exactly two historical assertion amendments after Utility reported the implementation correction: `coverage-public.spec.ts:76` expects `unproven` after provider depth refusal; `supplemental-lifecycle.spec.ts:54` expects `failed/unproven` when cancellation occurs during actual child publication before the start operation returns a lease. No other historical assertion changed. Existing historical SHA256 manifests remain unchanged as records of their respective baselines; `STARTUP-CLEANUP-AMENDMENT-SHA256SUMS` owns these two replacements and the new `startup-cleanup.spec.ts`.

## Executed evidence

From `/home/sic/harness-agent/.worktrees/research-policy`:

```sh
pnpm exec vitest run packages/dev-loop/roles/tests/startup-cleanup.spec.ts --testTimeout=90000 --hookTimeout=90000
pnpm exec vitest run packages/dev-loop/roles/tests/startup-cleanup.spec.ts packages/dev-loop/roles/tests/coverage-public.spec.ts packages/dev-loop/roles/tests/supplemental-lifecycle.spec.ts --testTimeout=90000 --hookTimeout=90000
```

Against the copied, unmodified production baseline, the first command fails one cleanup assertion. The second fails the three amended startup assertions and passes ten adjacent controls. `startup-cleanup-RED.log` and `startup-cleanup-amendment-RED.log` retain exact output. These are behavioral RED results, not missing-module or timeout failures. Tests use the explicit repository lane budget because real Git subprocess startup takes more than Vitest's default five seconds on this host. Utility's implementation and GREEN verification occur in the separately owned roles-tests worktree; this writer has not imported that production correction.

## What the evidence teaches

Quiescence means owned work has actually stopped, not merely that a promise rejected. The Queue knows whether an acquired run's disposal succeeded. Roles cannot infer disposal of a run it never received. Tests must preserve that distinction even when a particular provider rejection happens before allocating any child.
