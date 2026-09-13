# Storage domain identifier amendment

The parent authorized five identifier-only replacements in `durability.spec.ts`: four JSON destinations and one unit header now use `dev_loop_roles`. Package and tool names are unchanged. The actual storage `UNIT_NAME_RE` is `/^[a-z][a-z0-9_]*$/` (`packages/storage/storage/src/backend.ts:10`); the previously specified hyphenated domain could not import through `defineDomain`.

The original `RED.md`, `RED-*.log` and `SHA256SUMS` remain historical evidence of the inert 21-test baseline. This amendment supersedes only that manifest's `tests/durability.spec.ts` digest. Implementation source is concurrently owned by the Implementer and is not part of this amended test freeze.

- `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/roles/tests/durability.spec.ts`: exit 0; 0 warnings/errors.
- `pnpm exec vitest run packages/dev-loop/roles/tests/durability.spec.ts`: exit 1; 1 passed, 3 timed out after 5000ms. The initial JSON write-failure test passed. Cancellation/reopen, terminal-write/reopen and malformed-record/reopen tests timed out. The prior domain import error is absent. These timeouts are not claimed as clean behavioral RED or GREEN.
- `domain-amendment-vitest.log` preserves the executed output. The parent received the exact outcome for implementation diagnosis; no timeout increase or test weakening was applied.

Amended `durability.spec.ts` SHA-256: `50f0542fbe070df5300280afc71ffe32ee33c217b74e3950919bdaf991f6beb5`.
