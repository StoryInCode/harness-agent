# Roles behavioral RED baseline

## Result

Test Writer froze 21 failing behavioral tests in four spec files against inert production scaffolding. No final test failed during setup or import, and Vitest reported no unhandled errors. The service's two public methods reject with `NOT_IMPLEMENTED`; the named-export scoped tool plugin deliberately registers nothing. No role implementation, installation, branch, mainline commit, or independent review was performed.

The prepared worktree is `/home/sic/harness-agent/.worktrees/roles-tests`, detached at `d35ae26870`, with the parent's 14-file child-cwd prerequisite overlay. Those prerequisite files and root configurations were not edited by this task. The initial missing overlay and missing public tool-budget owner were reported to the parent; the parent repaired the overlay and amended `ToolConfig` ownership before this baseline.

## Reproduce

Run these commands from the prepared worktree root:

| Command | Observed result |
|---|---|
| `pnpm exec vitest run packages/dev-loop/roles/tests` | Exit 1; 4 failed files, 21 failed tests; behavioral RED. |
| `pnpm exec tsc -p packages/dev-loop/roles/tests/tsconfig.json --pretty false` | Exit 2; 0 Roles source/test diagnostics; 98 diagnostics in vendored sources compiled under the strict source-test program. Not a globally passing typecheck. |
| `pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/roles` | Exit 0; 0 warnings, 0 errors, 8 TypeScript files. Actual repository runner, not ESLint. |
| `git diff --check` | Exit 0. This checks tracked changes; the Roles package is new/untracked. |

The adjacent `RED-vitest.log`, `RED-typescript.log`, and `RED-oxlint.log` preserve final command output. `SHA256SUMS` identifies the frozen source, fixture, configuration, documentation, and diagnostic files; the manifest excludes itself.

## Behavioral axes

- Four canonical roles: actual child id, exact recorded parent, assigned child header/model cwd, reported provenance, absent preset, Queue cleanup, and retained source file.
- Actual optional preset inheritance after a live parent recomposition, without substituting the stale parent creation label.
- Real filesystem-tool Test Writer write and Implementer read in the same retained assignment; full durable ordered history after Host dispose/remount.
- Missing/stale initiator rejection, complete multibyte brief overflow, and bounded failed observation for oversized outcome.
- Real JSON requested-write-before-child observation; cancellation recorded after cleanup and reopened; initial write failure prevents startup; terminal write failure preserves requested-only crash residue; malformed authoritative data refuses restart.
- Real Loader-scoped schemas and parser rejection; AgentLoop tool calls and equality of logged results with the next Brain request; Research write rejected through real tool dispatch and absence of its filesystem effect.
- Host policy/provider validation, real ACP capability refusal, consumer-owned tiny output budget rejection, history count overflow without a partial array, and delegation output overflow naming the durable id.

The tests use actual Queue, Worktree, SubagentRuntime/spawn provider, AgentLoop, ToolRuntime/filesystem tools, Loader, storage-domain and JSON storage. Only LLM responses are scripted. Storage failure tests obstruct the real private JSON destination rather than mocking domain writes. Each test owns a private Git repository and joins context disposal before removing it.

These are acceptance expectations, not GREEN runtime claims. With the inert entry points, assertions following the first missing behavior are not yet executed. The baseline does not independently prove the existing Queue's late-start/unproven-cleanup races, every allocation/start cancellation interleaving, PTC nested dispatch, child-local structured capture, non-text outcomes, or exact-byte equality edges. Those remain supplemental coverage, alongside shipped recorded-session integration and prerequisite provider-suite evidence. Do not interpret the bounded baseline as exhaustive acceptance of the full piece.

## Teaching and handoff

A durable write is the point at which a record survives restart; a requested record proves intent, not an active child. Queue owns the returned run's result and disposal, while the orchestration owner retains authority to retire the assignment. The tests therefore inspect real files, child metadata, durable storage, and model/log projections rather than accepting a report's words as evidence.

The actual Loader fixture distinguishes a missing implementation from an unusable composition. During authoring, the optional preset fixture required an explicit root `ctx.baseUrl`; that setup defect was corrected before the final RED run. TypeScript caught an incorrect `agent/created` payload assumption; the listener now reads the actual `{ agent }` payload. The remaining compiler diagnostics are exclusively outside this package and were not suppressed.

The author inspected repository APIs and documentation directly; no external prior-art implementation or external model was inspected. The narrow alternatives are a real composed fixture or business-service mocks; the latter would not prove storage durability, executor denial, or assignment retention. Keep the public service/tool policy ownership and these tests fixed for implementation; necessary corrections return to Test Writer for a new baseline. Root registration, release packaging and generated documentation remain the parent's implementation phase.
