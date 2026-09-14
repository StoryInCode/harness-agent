# Master Micro-Gate Queue & Progress Ledger

This ledger defines the sequential queue of micro-gates across all sets. Every gate is processed one-by-one by the Dev Loop Orchestrator in close collaboration with the human operator.

- **To Review & Verify (Autonomous Work)**: The code already exists in `packages/dev-loop/*`. The subagent extracts only the relevant files from `backup/master-autonomous`, runs the focused test suite, validates citations, and presents a PR and diff card for human inspection and sign-off.
- **To Implement (New Work)**: The subagent follows the 4 Gates (Format, Red Baseline, Green Worktree, Mainline Transfer) to specify and build the feature from scratch.

---

## Set 00 — Dev Loop Orchestrator & Lifecycle Engine

| ID | Title | Lead Persona | Package | Status | Verification / Run Command |
|---|---|---|---|---|---|
| `00.00a` | [DeepSeek Harness Dev Loop Orchestrator Setup](00-dev-loop/done/00.00a-orchestrator-setup.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-preset` | to review & verify | `pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'personas'` |
| `00.00b` | [StoryInCode (SIC) Orchestrator Protocol](00-dev-loop/done/00.00b-sic-orchestrator-setup.md) | 🍰 L | `@deepseek-ai/dsh-skill-sic-orchestrator` | to review & verify | `pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'L'` |
| `00.01a` | [Heading Scanner and ATX Markdown Parsing](00-dev-loop/done/00.01a-heading-scanner.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-directory` | to review & verify | `pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'treats a \`##\` line inside a fenced code block as content'` |
| `00.01b` | [Dotted Header Metadata and Field Extraction](00-dev-loop/done/00.01b-metadata-parser.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-directory` | to review & verify | `pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'header'` |
| `00.01c` | [Line Ceiling and Primitive Enforcement](00-dev-loop/done/00.01c-piece-validator.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-directory` | to review & verify | `pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'validation'` |
| `00.01d` | [Directory Discovery and Set Traversal](00-dev-loop/done/00.01d-set-scanner.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-directory` | to review & verify | `pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'scanSet'` |
| `00.01e` | [Dispatch Queue Candidate Filtering](00-dev-loop/done/00.01e-candidate-selector.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-directory` | to review & verify | `pnpm exec vitest run packages/dev-loop/directory/tests/directory.spec.ts -t 'candidates'` |
| `00.02a` | [Monotonic State Transitions and Invariants](00-dev-loop/done/00.02a-lifecycle-states.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-lifecycle` | to review & verify | `pnpm exec vitest run packages/dev-loop/lifecycle/tests/lifecycle.spec.ts -t 'transitions'` |
| `00.02b` | [Compare-And-Swap Single-Worker Claims](00-dev-loop/done/00.02b-cas-claim-writer.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-lifecycle` | to review & verify | `pnpm exec vitest run packages/dev-loop/lifecycle/tests/lifecycle.spec.ts -t 'compare-and-set'` |
| `00.02c` | [Pre-Complete Interception and Gate Vetoes](00-dev-loop/done/00.02c-pre-complete-hook.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-lifecycle` | to review & verify | `pnpm exec vitest run packages/dev-loop/lifecycle/tests/lifecycle.spec.ts -t 'veto'` |
| `00.02d` | [Completion Move to \`done/\` Subdirectory](00-dev-loop/done/00.02d-done-transition.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-lifecycle` | to review & verify | `pnpm exec vitest run packages/dev-loop/lifecycle/tests/lifecycle.spec.ts -t 'move'` |
| `00.03a` | [Markdown Presentation Cards and Human Prompts](00-dev-loop/done/00.03a-presentation-card.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-approval` | to review & verify | `pnpm exec vitest run packages/dev-loop/approval/tests/approval.spec.ts -t 'render'` |
| `00.03b` | [Human Clarification Roundtrip](00-dev-loop/done/00.03b-user-questions.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-approval` | to review & verify | `pnpm exec vitest run packages/dev-loop/approval/tests/approval.spec.ts -t 'question'` |
| `00.03c` | [Content-Digest Gated Authorization](00-dev-loop/done/00.03c-digest-authorization.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-approval` | to review & verify | `pnpm exec vitest run packages/dev-loop/approval/tests/approval.spec.ts -t 'digest'` |
| `00.04a` | [Queue Ordering and Monotonic Determinism](00-dev-loop/done/00.04a-priority-comparator.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-queue` | to review & verify | `pnpm exec vitest run packages/dev-loop/queue/tests/queue.spec.ts -t 'order'` |
| `00.04b` | [Worker Concurrency Bounds and Semaphores](00-dev-loop/done/00.04b-concurrency-semaphore.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-queue` | to review & verify | `pnpm exec vitest run packages/dev-loop/queue/tests/queue.spec.ts -t 'concurrency'` |
| `00.04c` | [Queue Drain and Inspection APIs](00-dev-loop/done/00.04c-queue-inspection.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-queue` | to review & verify | `pnpm exec vitest run packages/dev-loop/queue/tests/queue.spec.ts -t 'drain'` |
| `00.05a` | [Detached Worktree Creation and Path Binding](00-dev-loop/done/00.05a-worktree-allocation.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-worktree` | to review & verify | `pnpm exec vitest run packages/dev-loop/worktree/tests/worktree.spec.ts -t 'allocate'` |
| `00.05b` | [Single-Writer Concurrency Locks](00-dev-loop/done/00.05b-worktree-collision.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-worktree` | to review & verify | `pnpm exec vitest run packages/dev-loop/worktree/tests/worktree.spec.ts -t 'lock'` |
| `00.05c` | [Conservative Teardown and Retention](00-dev-loop/done/00.05c-worktree-cleanup.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-worktree` | to review & verify | `pnpm exec vitest run packages/dev-loop/worktree/tests/worktree.spec.ts -t 'teardown'` |
| `00.06a` | [Canonical Dev Loop Role Definitions](00-dev-loop/done/00.06a-specialist-roles.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-roles` | to review & verify | `pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'roles'` |
| `00.06b` | [Read-Only Tool Enforcement on Research](00-dev-loop/done/00.06b-research-guard.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-roles` | to review & verify | `pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'guard'` |
| `00.06c` | [Subagent Spawning with Injected Context](00-dev-loop/done/00.06c-delegation-dispatch.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-roles` | to review & verify | `pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'dispatch'` |
| `00.06d` | [Durable Outcome Ledger and Provenance Tracking](00-dev-loop/done/00.06d-delegation-ledger.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-roles` | to review & verify | `pnpm exec vitest run packages/dev-loop/roles/tests/roles.spec.ts -t 'ledger'` |
| `00.08a` | [Reference Markdown Table Parsing](00-dev-loop/done/00.08a-reference-table-ast.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-references` | to review & verify | `pnpm exec vitest run packages/dev-loop/references/tests/references.spec.ts -t 'table'` |
| `00.08b` | [Subpath Containment and Citation Verification](00-dev-loop/done/00.08b-locator-containment.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-references` | to review & verify | `pnpm exec vitest run packages/dev-loop/references/tests/references.spec.ts -t 'locator'` |
| `00.08c` | [Provenance Verification Engine](00-dev-loop/done/00.08c-provenance-store.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-references` | to review & verify | `pnpm exec vitest run packages/dev-loop/references/tests/references.spec.ts -t 'provenance'` |
| `00.09a` | [BDD Scenario Heading and Bullet AST Parser](00-dev-loop/00.09a-bdd-extractor.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-test-handoff` | to implement | 4-Gate Pipeline |
| `00.09b` | [Behavioral RED Baseline Test Execution](00-dev-loop/00.09b-behavioral-red-runner.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-test-handoff` | to implement | 4-Gate Pipeline |
| `00.09c` | [Cryptographic SHA-256 Test Freezing](00-dev-loop/00.09c-test-file-freezer.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-test-handoff` | to implement | 4-Gate Pipeline |
| `00.10a` | [Gate 1: Markdown Syntax & Axiom Conformance](00-dev-loop/00.10a-format-axiom-gate.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-gates` | to implement | 4-Gate Pipeline |
| `00.10b` | [Gate 2: Mandatory Failing Baseline Verification](00-dev-loop/00.10b-red-baseline-gate.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-gates` | to implement | 4-Gate Pipeline |
| `00.10c` | [Gate 3: Worktree Implementation All-Green Gate](00-dev-loop/00.10c-worktree-green-gate.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-gates` | to implement | 4-Gate Pipeline |
| `00.10d` | [Gate 4: Clean Mainline Integration Gate](00-dev-loop/00.10d-mainline-transfer-gate.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-gates` | to implement | 4-Gate Pipeline |
| `00.11a` | [Slash Command Parsing & Argument Tokenization](00-dev-loop/done/00.11a-slash-command-parser.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-command` | to review & verify | `pnpm exec vitest run packages/dev-loop/command/tests/command.spec.ts -t 'parse'` |
| `00.11b` | [Optimistic Concurrency Approval Subcommand](00-dev-loop/done/00.11b-occ-approval-command.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-command` | to review & verify | `pnpm exec vitest run packages/dev-loop/command/tests/command.spec.ts -t 'approve'` |
| `00.11c` | [Rejection and Task Deferral Subcommand](00-dev-loop/done/00.11c-rejection-command.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-command` | to review & verify | `pnpm exec vitest run packages/dev-loop/command/tests/command.spec.ts -t 'reject'` |
| `00.12a` | [SQLite Write-Ahead Intent Logging](00-dev-loop/done/00.12a-write-ahead-intent.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-persistence` | to review & verify | `pnpm exec vitest run packages/dev-loop/persistence/tests/persistence.spec.ts -t 'intent'` |
| `00.12b` | [Relational Schema and Monotonic Migration](00-dev-loop/done/00.12b-sqlite-state-schema.md) | 💻 Daru | `@deepseek-ai/dsh-dev-loop-persistence` | to review & verify | `pnpm exec vitest run packages/dev-loop/persistence/tests/persistence.spec.ts -t 'schema'` |
| `00.12c` | [Crash Recovery and State Hydration](00-dev-loop/done/00.12c-startup-hydration.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-persistence` | to review & verify | `pnpm exec vitest run packages/dev-loop/persistence/tests/persistence.spec.ts -t 'hydration'` |
| `00.12d` | [Unreconciled Divergence Quarantine](00-dev-loop/done/00.12d-anomaly-quarantine.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-persistence` | to review & verify | `pnpm exec vitest run packages/dev-loop/persistence/tests/persistence.spec.ts -t 'quarantine'` |
| `00.13a` | [Proof Table Claim Extraction](00-dev-loop/done/00.13a-claim-inventory-parser.md) | 🐾 Neko-chan | `@deepseek-ai/dsh-dev-loop-claims` | to review & verify | `pnpm exec vitest run packages/dev-loop/claims/tests/claims.spec.ts -t 'extract'` |
| `00.13b` | [Epistemic Research Brief Generation](00-dev-loop/done/00.13b-research-brief-compiler.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-claims` | to review & verify | `pnpm exec vitest run packages/dev-loop/claims/tests/claims.spec.ts -t 'brief'` |
| `00.13c` | [Evidence Cryptographic Integrity Checking](00-dev-loop/done/00.13c-forensic-hash-verifier.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-claims` | to review & verify | `pnpm exec vitest run packages/dev-loop/claims/tests/claims.spec.ts -t 'hash'` |
| `00.13d` | [Fail-Closed Admission Verification Hook](00-dev-loop/done/00.13d-fail-closed-gate.md) | 🍰 L | `@deepseek-ai/dsh-dev-loop-claims` | to review & verify | `pnpm exec vitest run packages/dev-loop/claims/tests/claims.spec.ts -t 'hook'` |
| `00.14a` | [Cordis Host Service Patch Composition](00-dev-loop/00.14a-host-service-assembly.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-preset` | to implement | 4-Gate Pipeline |
| `00.14b` | [Brain Agent Preset and Scoped Tool Injection](00-dev-loop/00.14b-brain-preset-tools.md) | 🌸 Mayuri | `@deepseek-ai/dsh-dev-loop-preset` | to implement | 4-Gate Pipeline |
| `00.14c` | [Multi-Agent End-to-End Steins Gate Verification](00-dev-loop/00.14c-loop-integration-test.md) | 🔬 Hououin Kyouma | `@deepseek-ai/dsh-dev-loop-preset` | to implement | 4-Gate Pipeline |

---

## Subsequent Sets

- **Set 01 — Agent Pool**: Role pools, model routing, heartbeat probes, quota tracking (`01.01`–`01.18`).
- **Set 02 — Kanban**: Card lifecycle, tasks.md sync, user accept path, discussion sessions (`02.01`–`02.16`).
- **Set 03 — Axioms**: Candidate path resolver, anti-cheat shell seam, diff impact analyzer (`03.01`–`03.16`).
- **Set 04 — Memory & Soul**: Soul persona guard, POSIX file locking, threat scanner (`04.01`–`04.15`).
- **Set 05 — Worktree Guard**: Subprocess isolation, cgroup memory limits, monotonic tool guards (`05.01`–`05.19`).
- **Set 06 — Verification Engine**: Anti-cheat test hashers, weakened assertion detection, sandboxing (`06.01`–`06.21`).
