# 00.12 integrated behavioral RED freeze

## Result and transfer authority

This detached worktree remains based on `a35ad037e248f3ba1c5293dbf03244bd7cddbaaf`. This integrated freeze supersedes the incomplete [57-test checkpoint](RED.md). The parent released real Command and Roles support and approved the shared pure source-observation scaffold and byte-faithfulness refusal rule. No production durability, callback restoration, Agent-loop change, branch, commit or MAIN edit was made.

`pnpm exec vitest run packages/dev-loop/persistence/tests --reporter=json --outputFile=/tmp/dsh-persistence-frozen-red.json` exited 1: **71 tests, 61 RED, 10 GREEN, zero skipped or todo**. All failures reach behavior after real fixture activation. No missing import, compiler failure, unbuilt artifact or elapsed-time assertion is counted as RED.

| File | RED | GREEN | First missing behavior |
|---|---:|---:|---|
| approval.spec.ts | 3 | 4 | Sixth authorization argument; BOM and unknown-size source refusal. |
| backend.spec.ts | 10 | 0 | Domain readiness, actual writes, durable parsing, bounds and repository identity. |
| command-authorization.spec.ts | 4 | 2 | Independently missing sixth argument and history; BOM and unknown-size refusal. |
| harness.spec.ts | 0 | 2 | Real Git/memory and required-entry missing-provider controls pass. |
| lifecycle.spec.ts | 24 | 0 | Durable legal edges, restart hydration, effect ordering, cancellation and quarantine. |
| recovery-command.spec.ts | 16 | 0 | Actual recovery registration, projection, authorization, logs, bounds and disposal. |
| roles-restart.spec.ts | 1 | 1 | Required pending hydration returns todo; actual memory-mode owner isolation passes. |
| source-observation.spec.ts | 3 | 1 | Shared raw/header-only hashing and hydration byte-faithfulness refusal; actual invalid UTF8 refusal passes. |

The existing five Approval cases remain unchanged; two byte-faithfulness cases are additive. Existing backend, harness, lifecycle and recovery-command tests are unchanged. The pure `observeSource` export returns empty digest placeholders and has no hashing, normalization, fetch or persistence implementation. Lifecycle retains its original transition body and optional inert sixth argument.

## Actual cross-owner evidence

Command tests execute real show→approve, compare the approve commandId rather than the show commandId, observe the actual filesystem version, and assert the actual command/run and command/done pair before testing authorization or history. A fenced body Status example stays digest-significant. Stale edits and a real child Agent remain denied without transitions or history.

Roles tests open the actual `dev_loop_roles` domain once per mount, execute actual Queue/Worktree/spawn delegation, make its actual terminal JSON write fail, and retain its real requested-only record. Remount restores history but no live Agent, queued callback, active worker or automatic model request. Old or missing initiators are denied. The memory control proves a fresh actual initiator can explicitly request new work; required-mode acceptance reaches the missing pending hydration assertion. The 30-second case budget covers observed real Git work, not a sleep or scheduling assumption.

Local filesystem decoding uses fatal UTF8 validation but removes an initial BOM. Current Consumers and required hydration must refuse missing `stat.size` or a byte-count mismatch instead of assigning the SHA of decoded text to different file bytes. A separate bounded raw-byte reader is not implemented or implied. The shared pure helper requires already-validated byte-faithful content and an actual version; see [CONTRACT.md](CONTRACT.md).

## Public Web RED and snapshot test plan

After required Web artifacts were built, `pnpm exec vitest run -c vitest.expected.config.ts packages/dev-loop/persistence/tests/recovery-web.expected.e2e.ts` exited 1 with **one genuine RED**: authenticated public `commands/execute` returned `undefined`, while the test expected `{result:{kind:'success',text:'{"pieceId":"00.12","history":[],"anomalies":[]}'}}`. The shipped CLI Web profile started, launch-token cookie exchange and actual Session creation succeeded, and the process closed gracefully. Its port and home are private. The shared process helper is copied unchanged from the snapshot owner.

This expectation stays owner-local. No success Session JSONL is fabricated or presented as recorded. After implementation, the snapshot owner must record and keylessly replay actual inspect/acknowledge and restart interactions, preserve real command identity relationships without redacting arbitrary result text, and compare independent final workspace observations. Canonical successful recovery recording remains an implementation acceptance requirement, not a blocker to starting implementation after this freeze.

Initial Web runs failed because client bundles and generated Remote metadata were absent. The required `pnpm run build:lib:host && pnpm run build:lib:client` eventually exited 0 after declaring the shared helper in the Host compiler include. Those setup failures were investigated and are not behavioral evidence. Only source-mode public Web behavior was exercised; no lib-mode recovery success is claimed.

## Compilation, lint and adjacent support

The final owned test command first ran `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/persistence/src packages/dev-loop/persistence/tests` and `pnpm exec tsc -p packages/dev-loop/persistence/tsconfig.test.json --pretty false`; both exited 0, with zero lint warnings or errors. The full required Host and Client artifact builds also exited 0. Earlier adjacent Lifecycle and Approval validation passed 85 cases; this freeze changes no adjacent production body after that run.

The Command writer's approved authorization amendment was copied unchanged with its harness and `AUTHORIZATION-12.md`. `pnpm exec vitest run packages/dev-loop/command/tests/command.spec.ts` reports **49 GREEN and one intended RED**, missing the sixth authorization argument in standalone memory mode; its existing actual signal-identity assertion passes. The other 40 command cases were not copied or rerun here; their writer reports 89 GREEN and one RED in the complete source suite.

## Hashes and freeze discipline

[INTEGRATED-SHA256SUMS](INTEGRATED-SHA256SUMS) pins the current scaffold, tests, support helper, configuration and handoff prose. The original [SHA256SUMS](SHA256SUMS) remains historical checkpoint evidence; its index export and Approval test hashes are intentionally superseded, not a current verification command. Current imported support has separate `ROLES-SUPPORT-SHA256SUMS`, `COMMAND-SUPPORT-SHA256SUMS` and `COMMAND-AUTHORIZATION12-SHA256SUMS` manifests. The Command writer's historical RED manifest is not rewritten.

Implementation may change production files to satisfy this freeze. It must not change the frozen tests or invent dependencies, evidence setters, repair paths or automatic resumed execution. A required test correction returns to its Test Writer and establishes a new baseline. Successful durability and successful recorded recovery are not claimed by this handoff.
