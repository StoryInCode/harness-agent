# 00.12 superseding command-authorization test freeze

## Decision and exact amendment

The parent approved unconditional forwarding of actual human approval facts as Lifecycle's sixth argument in both memory and required-durability modes. Memory mode still changes only Lifecycle memory; forwarding authorization does not itself establish persistence. No public durability accessor or duplicated Consumer mode configuration is needed for this decision.

Only the existing approval case named `accepts uppercase digest for the same bytes and changes only memory, never enqueues work` in [command.spec.ts](tests/command.spec.ts) was amended:

1. Before dispatch, independently resolve its actual Directory-relative source path and observe its filesystem version.
2. Replace the historical five-argument-length assertion with an exact sixth-argument authorization assertion and a six-argument-length assertion.

The expected authorization contains `kind: 'command'`, the actual returned CommandRuntime `commandId`, the receiving Agent's actual Session id, `decision: 'accept'`, and `source: {path, version, rawDigest, contentDigest}`. Both digest expectations use the complete fixture UTF-8 source. This fixture's initial Status is already `todo`, so its header-normalized content digest equals its raw digest. Distinct normalized/raw digests and required-mode durable history remain with the Persistence Test Writer's separate integration suite.

The existing legal edge, signal identity, one-transition count, success output, memory status, unchanged source bytes and empty Queue assertions remain unchanged. The reject case still requires exactly five arguments for pending-to-blocked; rejection is not approval authorization. Every other case and the shared fixture remain byte-identical to their previous freeze. No production file, DTO, Lifecycle implementation, shared infrastructure or persistence-owned test was edited.

## Actual behavioral RED

Working directory: `/home/sic/harness-agent/.worktrees/command-tests`.

```sh
pnpm exec vitest run packages/dev-loop/command/tests
```

Observed exit 1: **90 tests, 89 passed, 1 failed, 0 skipped**. The only failure is the amended approval case at the sixth-argument assertion:

```text
AssertionError: expected undefined to deeply equal { kind: 'command', …(4) }
```

The current command requests its existing five-argument Lifecycle transition, so the sixth observed argument is genuinely absent. Imports, fixture setup, source parsing and the transition itself succeed. This is missing authorization-forwarding behavior, not a type failure or a missing dependency. No production fix was applied by the Test Writer.

## Compiling tests and lint

```sh
pnpm exec tsc -p packages/dev-loop/command/tsconfig.tests.json --pretty false
pnpm exec tsx scripts/run-oxlint.ts packages/dev-loop/command/tests/command.spec.ts
```

Both exit 0. Focused lint reports 0 warnings and 0 errors. The test inspects the sixth value with the ordinary array `.at(5)` API; it needs no hostile cast or prospective DTO import while the current Lifecycle signature still declares five arguments.

## Superseding hashes

The [original RED record](RED.md) remains unchanged as historical 00.11 evidence. This manifest supersedes only its `tests/command.spec.ts` hash for the parent-approved 00.12 authorization extension.

| File | SHA-256 |
|---|---|
| `tests/command.spec.ts`, historical 00.11 | `45d30f184b6cbf136cad7c76c8312a8368e8337e3ee677e3939795359d660d10` |
| `tests/command.spec.ts`, amended 00.12 | `c1c4a7111eebd4554402a80001b945fa403d3de0fc88a9f453d26780bda6589f` |
| `tests/harness.ts`, unchanged | `8ef9d379b3a05cfd517870ea2674993da7aa297ac6a6e151dc1edd0899227492` |
| `tests/limits-cancellation.spec.ts`, unchanged | `3f9c5d74ece79de4362965b99f77d27b5448e5104dd4621551a1d3ddce0e5fdf` |
| `tests/observations.spec.ts`, unchanged | `a82ccc316cbe259860e0dd1bc8a5833e4ef38cbb8b8da503c0637fc21880a9a3` |
| `tests/observations-supplement.spec.ts`, unchanged | `e12bfd6184cae62f6ebb596c8659865764d82b0f7fe950616fd4e0f2dc85cede` |
| `tsconfig.tests.json`, unchanged | `5f0eca3175d130b974c6ebda7a2a159aed06a3e51069550f0a567da4bc8ac191` |
| `RED.md`, unchanged | `ace01dca2d5a28c55787f27dcad84b69f1910b77c3687610080489ed78717176` |

## Ownership and lesson

The Persistence Test Writer owns the separate required-composition command-authorization tests, shared source-observation DTO/helper scaffold and durable-history assertions. The Implementer owns authorization construction and any narrow integration of declared Lifecycle domain errors. Neither owner should change this frozen case without a new Test Writer baseline.

An authorization record identifies who accepted which observed source; it is distinct from whether the writer stores that record durably. The same human facts must reach the sole writer in both modes. This amendment preserves the memory-only behavior while making missing identity and source forwarding visible as an ordinary failing assertion.
