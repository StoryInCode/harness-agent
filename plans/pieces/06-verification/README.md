# Set 06 — Verified-Work Pipeline, Cryptographic Test Pinning, and Anti-Cheat Gates

The Verified-Work Pipeline establishes the objective, mechanically enforced test-driven development and verification engine for DeepSeek Harness. Built on the foundational axiom that an autonomous agent cannot self-certify completion, the subsystem requires attributable evidence recorded in the authoritative ledger (`ctx.storageDomain`) before task progression. BDD test scenarios are authored first and submitted to an independent RED gate (`INV-14`) proving that tests fail strictly for expected missing behavior on the pristine base commit rather than environment defects. Validated test suites and test runner configurations are cryptographically frozen via canonical SHA-256 digests (`INV-13`) and locked with read-only filesystem permissions (`chmod 0o444`). During implementer turns, an agent-scoped monotonic tool guard (`ctx.tools.guard()`) synchronously vetoes write or patch operations targeting pinned paths before tool dispatch. An agent loop turn-stopping hook (`agent/turn-stopping`) intercepts premature completions, calling `agent.steer()` if code was modified without fresh passing tests. Finally, an independent GREEN gate validates cryptographic test hashes, zero exit codes, and a comprehensive 7-vector anti-cheat audit suite before permitting card completion.

## Set Index

*Completed pieces live in `06-verification/done/`.*

| ID | Title | Lead | Package | Depends on | Queue | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `06.01` | [Verification Service Definition and Domain Contracts](06.01-verification-service-definition.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-verification` | `none` | 1 | todo |
| `06.02` | [Verification Storage Domain and Retention Pruner](06.02-verification-storage-domain.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-verification-store` | `06.01` | 2 | todo |
| `06.03` | [Attributable Shell Command Lexer and Exit Parser (INV-11)](06.03-attributable-shell-parser.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-verification-shell-parser` | `06.01` | 3 | todo |
| `06.04` | [BDD Test Specification and Behavioral Scenarios Contract](06.04-bdd-test-specification.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-verification-bdd` | `06.01` | 4 | todo |
| `06.05` | [Cryptographic Test Suite Pinning and Manifest Generator (INV-13)](06.05-cryptographic-test-hasher.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-verification-hasher` | `06.01` | 5 | todo |
| `06.06` | [Pristine Base Commit RED Gate Evaluator (INV-14)](06.06-red-gate-evaluator.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-verification-red-gate` | `06.01, 06.02, 06.03, 06.04, 06.05, 05.04` | 6 | todo |
| `06.07` | [Monotonic Implementer Test Pinning Tool Guard (INV-13)](06.07-test-pinning-tool-guard.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-guard-test-pinning` | `06.01, 06.05` | 7 | todo |
| `06.08` | [Physical Filesystem Read-Only Permissions Synchronizer](06.08-filesystem-permissions-sync.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-verification-permissions` | `06.01, 06.05` | 8 | todo |
| `06.09` | [Independent Subprocess GREEN Gate Evaluator (INV-13)](06.09-green-gate-evaluator.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-verification-green-gate` | `06.01, 06.02, 06.03, 06.05` | 9 | todo |
| `06.10` | [Turn-Stopping Verification Interceptor (verify_on_stop)](06.10-turn-stopping-hook.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-verification-stop` | `06.01, 06.02` | 10 | todo |
| `06.11` | [Workspace Mutation Tracker and Freshness Observer](06.11-workspace-mutation-observer.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-verification-observer` | `06.01, 06.02, 06.03` | 11 | todo |
| `06.12` | [Anti-Cheat AC-1: Deleted Test File and Case Detector](06.12-anti-cheat-deleted-tests.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-anti-cheat-deletion` | `06.01, 06.05` | 12 | todo |
| `06.13` | [Anti-Cheat AC-2: AST Assertion Density and Weakening Detector](06.13-anti-cheat-weakened-assertions.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-anti-cheat-assertions` | `06.01, 06.05` | 13 | todo |
| `06.14` | [Anti-Cheat AC-3: Runner Configuration and Flag Tampering Guard](06.14-anti-cheat-runner-config.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-anti-cheat-config` | `06.01, 06.05` | 14 | todo |
| `06.15` | [Anti-Cheat AC-4: Masked Shell Operator and Suppressed Exit Checker](06.15-anti-cheat-masked-exit.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-anti-cheat-masked-exit` | `06.01, 06.03` | 15 | todo |
| `06.16` | [Anti-Cheat AC-5: Network Isolation and Sandbox Policy Enforcer](06.16-anti-cheat-network-sandbox.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-anti-cheat-network` | `06.01` | 16 | todo |
| `06.17` | [Anti-Cheat AC-6: Chat-Only Self-Grading Evasion Interceptor (INV-10)](06.17-anti-cheat-self-grading.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-anti-cheat-self-grading` | `06.01, 06.02` | 17 | todo |
| `06.18` | [Anti-Cheat AC-7: Production Test Mock Infiltration and Stub Detector](06.18-anti-cheat-mock-injection.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-anti-cheat-mock-injection` | `06.01` | 18 | todo |
| `06.19` | [Composite Anti-Cheat Audit Engine](06.19-anti-cheat-engine.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-anti-cheat-engine` | `06.12, 06.13, 06.14, 06.15, 06.16, 06.18` | 19 | todo |
| `06.20` | [Verification Host Service Provider](06.20-verification-host-service.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-verification-service` | `06.01, 06.02, 06.03, 06.04, 06.05, 06.06, 06.07, 06.08, 06.09, 06.10, 06.11, 06.12, 06.13, 06.14, 06.15, 06.16, 06.17, 06.18, 06.19` | 20 | todo |
| `06.21` | [Verification Host and Worker Preset Composition](06.21-verification-preset-composition.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-verification-presets` | `06.07, 06.10, 06.20` | 21 | todo |

## Core Architectural Principles

1. **Storage Domain Capability Reuse (`ctx.storageDomain`)**: Stores `events`, `state`, and `manifests` tables in `ctx.storageDomain` with schema version 1, providing zero-latency in-memory reads at turn boundaries (`06.02`, `06.20`).
2. **Canonical Anti-Cheat Shell Parser**: `@deepseek-ai/dsh-verification-shell-parser` is the shared authoritative parser enforcing `INV-11` for both verification and axiom sweeper pipelines (`06.03`, `06.15`).
3. **Monotonic Tool Guard over Waterfall Interceptors**: Agent-scoped `ctx.tools.guard()` in `stagePreExecuteAndGuards`. Returning a denial reason string guarantees immediate rejection without human override risk (`06.07`).
4. **Physical Filesystem Mode Clamping**: Kernel-level `chmod 0o444 / 0o555` mode bits block out-of-band shell redirections (`06.08`).
5. **Serial Turn-Stopping Steering Hook**: Mechanical listener on `agent/turn-stopping` invoking `agent.steer()` to push into `inbox.nextStep`, forcing the agent loop to continue execution when unverified edits exist (`06.10`).
6. **Decoupled 7-Vector Anti-Cheat Engine**: 7 specialized mechanical checkers covering test deletion, assertion weakening, config tampering, exit masking, network isolation, chat self-grading, and mock infiltration (`06.12` through `06.19`).

## Execution Protocol

1. **BDD Authoring**: Test writers structure requirements into Given/When/Then scenarios using `06.04`, producing test specifications and expected failure signatures.
2. **RED Gate Verification (`INV-14`)**: Prior to production edits, `06.06` executes tests against the pristine base commit (`05.04`). It confirms behavioral failure (`EXPECTED_ASSERTION_FAILURE` or `EXPECTED_MISSING_SYMBOL`) and rejects setup errors.
3. **Cryptographic Pinning (`INV-13`)**: Upon a valid RED gate, `06.05` computes canonical SHA-256 digests over test files and runner configs, saving `PinnedSuiteManifest` into the domain store (`06.02`). `06.08` locks files to `0o444`.
4. **Implementer Turn Guarding**: Implementers execute in dedicated worktrees. `06.07` intercepts tool calls via `ctx.tools.guard()`, synchronously vetoing write attempts targeting pinned paths before dispatch.
5. **Workspace Mutation & Turn Stop Interception**: File writes trigger `06.11`, dirtying workspace verification freshness. When turns stop, `06.10` hooks `agent/turn-stopping`, steering the agent back to run tests if edits are unverified.
6. **Attributable Intermediate Runs (`INV-11`)**: Intermediate test executions pass through `06.03` to verify attributable exits before recording into `events`.
7. **GREEN Gate Verification (`INV-13`)**: Implementers submit for completion. `06.09` re-hashes files against `pinnedManifest`, executes tests via independent runner requiring exit code 0, and runs the composite anti-cheat suite (`06.19`).
8. **Anti-Self-Grading Completion Gate (`INV-01`, `INV-10`)**: Calling card completion fires `'kanban/pre-complete'`. `06.17` validates the recorded green gate event, rejecting unproven claims and permitting verified transitions to `done`.
