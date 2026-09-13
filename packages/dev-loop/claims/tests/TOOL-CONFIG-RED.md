# TOOL-CONFIG-RED frozen baseline

Provenance: the three spec files below are Writer-authored under parent authorization; the Writer died before sealing its freeze. The Implementer re-verified the intended behavioral RED on worktree `/home/sic/harness-agent/.worktrees/claims-tests` (HEAD `d95aa66e7c`, cherry-pick of main `5dc811e13d`) before implementation. This file and `TOOL-CONFIG-SHA256SUMS` seal that baseline. The spec files are frozen: Implementer-owned production code must drive them GREEN without editing them.

Command: `pnpm exec vitest run packages/dev-loop/claims/tests/amendment-tool-config.spec.ts packages/dev-loop/claims/tests/amendment-tool-bounds.spec.ts --testTimeout=30000` — exit 1, `TOOL-CONFIG-RED.log`: 6 tests, 3 failed, 3 passed.

Intended RED (all three observed, none other):

1. `accepts the exact complete rendered envelope and refuses one byte less without partial report text` — the one-byte-under-budget refusal returns `isError: false` because no finalizer clips or refuses; expected `true`.
2. `bounds a pre-execution policy error through the real native error prefix path` — oversized native `Error: ` content passes at 6049 > 4096 bytes.
3. `bounds parsed-input validation errors carrying a large unknown field name` — oversized validation-error content passes at 5009 > 4096 bytes.

The config-mount tests in `amendment-tool-config.spec.ts` already pass: `src/tool.ts` owns the `Config` zod schema with `maxToolOutputBytes` required, positive safe integer, validated at mount.
