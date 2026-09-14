# Set 00 — Development Loop Micro-Gates Index

The autonomous development loop decomposed into 46 verified micro-gates authored by the five persona leads: 🐾 Neko-chan, 🍰 L, 💻 Daru, 🔬 Hououin Kyouma, and 🌸 Mayuri.

| ID | Title | Lead | Package | Depends on | Queue | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `00.00a` | [DeepSeek Harness Dev Loop Orchestrator Setup](done/00.00a-orchestrator-setup.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-preset` | `none` | 1 | done |
| `00.01a` | [Heading Scanner and ATX Markdown Parsing](done/00.01a-heading-scanner.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-directory` | `none` | 1 | done |
| `00.01b` | [Dotted Header Metadata and Field Extraction](done/00.01b-metadata-parser.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-directory` | `00.01a` | 2 | done |
| `00.01c` | [Line Ceiling and Primitive Enforcement](done/00.01c-piece-validator.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-directory` | `00.01a, 00.01b` | 3 | done |
| `00.01d` | [Directory Discovery and Set Traversal](done/00.01d-set-scanner.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-directory` | `00.01a, 00.01b, 00.01c` | 4 | done |
| `00.01e` | [Dispatch Queue Candidate Filtering](done/00.01e-candidate-selector.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-directory` | `00.01a, 00.01b, 00.01c, 00.01d` | 5 | done |
| `00.02a` | [Monotonic State Transitions and Invariants](done/00.02a-lifecycle-states.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-lifecycle` | `00.01e` | 6 | done |
| `00.02b` | [Compare-And-Swap Single-Worker Claims](done/00.02b-cas-claim-writer.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-lifecycle` | `00.02a` | 7 | done |
| `00.02c` | [Pre-Complete Interception and Gate Vetoes](done/00.02c-pre-complete-hook.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-lifecycle` | `00.02a, 00.02b` | 8 | done |
| `00.02d` | [Completion Move to `done/` Subdirectory](done/00.02d-done-transition.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-lifecycle` | `00.02a, 00.02b, 00.02c` | 9 | done |
| `00.03a` | [Markdown Presentation Cards and Human Prompts](done/00.03a-presentation-card.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-approval` | `00.01e, 00.02d` | 10 | done |
| `00.03b` | [Human Clarification Roundtrip](done/00.03b-user-questions.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-approval` | `00.03a` | 11 | done |
| `00.03c` | [Content-Digest Gated Authorization](done/00.03c-digest-authorization.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-approval` | `00.03a, 00.03b` | 12 | done |
| `00.04a` | [Queue Ordering and Monotonic Determinism](done/00.04a-priority-comparator.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-queue` | `00.03c` | 13 | done |
| `00.04b` | [Worker Concurrency Bounds and Semaphores](done/00.04b-concurrency-semaphore.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-queue` | `00.04a` | 14 | done |
| `00.04c` | [Queue Drain and Inspection APIs](done/00.04c-queue-inspection.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-queue` | `00.04a, 00.04b` | 15 | done |
| `00.05a` | [Detached Worktree Creation and Path Binding](done/00.05a-worktree-allocation.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-worktree` | `00.04c` | 16 | done |
| `00.05b` | [Single-Writer Concurrency Locks](done/00.05b-worktree-collision.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-worktree` | `00.05a` | 17 | done |
| `00.05c` | [Conservative Teardown and Retention](done/00.05c-worktree-cleanup.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-worktree` | `00.05a, 00.05b` | 18 | done |
| `00.06a` | [Canonical Dev Loop Role Definitions](done/00.06a-specialist-roles.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-roles` | `00.05c` | 19 | done |
| `00.06b` | [Read-Only Tool Enforcement on Research](done/00.06b-research-guard.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-roles` | `00.06a` | 20 | done |
| `00.06c` | [Subagent Spawning with Injected Context](done/00.06c-delegation-dispatch.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-roles` | `00.06a, 00.06b` | 21 | done |
| `00.06d` | [Durable Outcome Ledger and Provenance Tracking](done/00.06d-delegation-ledger.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-roles` | `00.06a, 00.06b, 00.06c` | 22 | done |
| `00.08a` | [Reference Markdown Table Parsing](done/00.08a-reference-table-ast.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-references` | `00.06d` | 23 | done |
| `00.08b` | [Subpath Containment and Citation Verification](done/00.08b-locator-containment.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-references` | `00.08a` | 24 | done |
| `00.08c` | [Provenance Verification Engine](done/00.08c-provenance-store.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-references` | `00.08a, 00.08b` | 25 | done |
| `00.09a` | [BDD Scenario Heading and Bullet AST Parser](00.09a-bdd-extractor.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-test-handoff` | `00.01e, 00.08c` | 26 | todo |
| `00.09b` | [Behavioral RED Baseline Test Execution](00.09b-behavioral-red-runner.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-test-handoff` | `00.09a` | 27 | todo |
| `00.09c` | [Cryptographic SHA-256 Test Freezing](00.09c-test-file-freezer.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-test-handoff` | `00.09a, 00.09b` | 28 | todo |
| `00.10a` | [Gate 1: Markdown Syntax & Axiom Conformance](00.10a-format-axiom-gate.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-gates` | `00.09c` | 29 | todo |
| `00.10b` | [Gate 2: Mandatory Failing Baseline Verification](00.10b-red-baseline-gate.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-gates` | `00.10a` | 30 | todo |
| `00.10c` | [Gate 3: Worktree Implementation All-Green Gate](00.10c-worktree-green-gate.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-gates` | `00.10b` | 31 | todo |
| `00.10d` | [Gate 4: Clean Mainline Integration Gate](00.10d-mainline-transfer-gate.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-gates` | `00.10c` | 32 | todo |
| `00.11a` | [Slash Command Parsing & Argument Tokenization](done/00.11a-slash-command-parser.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-command` | `00.10d` | 33 | done |
| `00.11b` | [Optimistic Concurrency Approval Subcommand](done/00.11b-occ-approval-command.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-command` | `00.11a` | 34 | done |
| `00.11c` | [Rejection and Task Deferral Subcommand](done/00.11c-rejection-command.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-command` | `00.11a, 00.11b` | 35 | done |
| `00.12a` | [SQLite Write-Ahead Intent Logging](done/00.12a-write-ahead-intent.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-persistence` | `00.11c` | 36 | done |
| `00.12b` | [Relational Schema and Monotonic Migration](done/00.12b-sqlite-state-schema.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-dev-loop-persistence` | `00.12a` | 37 | done |
| `00.12c` | [Crash Recovery and State Hydration](done/00.12c-startup-hydration.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-persistence` | `00.12a, 00.12b` | 38 | done |
| `00.12d` | [Unreconciled Divergence Quarantine](done/00.12d-anomaly-quarantine.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-persistence` | `00.12a, 00.12b, 00.12c` | 39 | done |
| `00.13a` | [Proof Table Claim Extraction](done/00.13a-claim-inventory-parser.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-dev-loop-claims` | `00.12d` | 40 | done |
| `00.13b` | [Epistemic Research Brief Generation](done/00.13b-research-brief-compiler.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-claims` | `00.13a` | 41 | done |
| `00.13c` | [Evidence Cryptographic Integrity Checking](done/00.13c-forensic-hash-verifier.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-claims` | `00.13a, 00.13b` | 42 | done |
| `00.13d` | [Fail-Closed Admission Verification Hook](done/00.13d-fail-closed-gate.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-dev-loop-claims` | `00.13a, 00.13b, 00.13c` | 43 | done |
| `00.14a` | [Cordis Host Service Patch Composition](00.14a-host-service-assembly.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-preset` | `00.01e, 00.02d, 00.03c, 00.04c, 00.05c, 00.06d, 00.08c, 00.11c, 00.12d, 00.13d` | 44 | todo |
| `00.14b` | [Brain Agent Preset and Scoped Tool Injection](00.14b-brain-preset-tools.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-dev-loop-preset` | `00.14a` | 45 | todo |
| `00.14c` | [Multi-Agent End-to-End Steins Gate Verification](00.14c-loop-integration-test.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-dev-loop-preset` | `00.14a, 00.14b` | 46 | todo |

## Micro-Gate Architecture & Personas

- 🐾 **Neko-chan (Inspector Cat)**: Pure intake, ATX scanning, BDD parsing, and user cheer.
- 🍰 **L (Forensic Detective)**: Evidence checking, claim verification, proof tables, and epistemic bounds.
- 💻 **Daru (Super Hacker)**: Execution rig, test runners, git worktrees, and SQLite WAL persistence.
- 🔬 **Hououin Kyouma (Mad Scientist)**: Monotonic state transitions, worktree allocation, and Steins Gate verification.
- 🌸 **Mayuri (Gentle Seamstress)**: Human-in-the-loop decisions, presentation cards, and preset composition.

## Verification and Workflow Sequence

The implementation sequence is Test Writer → RED → Implementer gets tests green → transfer to master → final post-transfer tests → move the completed piece into `done/` and update this index. Human approval is exercised at `00.03a`–`00.03c`.
