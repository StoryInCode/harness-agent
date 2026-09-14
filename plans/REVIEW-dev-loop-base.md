# Development-Loop Base Subsystem: Current State

## Overview

The development-loop subsystem provides autonomous micro-gate discovery, epistemic claim verification, role-based delegation, isolated worktree execution, and guarded lifecycle transitions. It is implemented across 11 packages in `packages/dev-loop/`, specified by micro-gates in `plans/pieces/00-dev-loop/`.

---

## Implemented Packages in `packages/dev-loop/`

| Package | Purpose & Capabilities |
|---|---|
| `packages/dev-loop/approval` | Presents human decision points via structured presentation cards and records user question decisions. |
| `packages/dev-loop/claims` | Extracts claim inventories from piece specifications and verifies cited symbols, lines, and cryptographic file digests. |
| `packages/dev-loop/command` | Parses reviewer slash commands (`/accept`, `/reject`) and validates optimistic concurrency preconditions. |
| `packages/dev-loop/directory` | Discovers micro-gate specifications, parses ATX headings and frontmatter, and selects ready candidate pieces. |
| `packages/dev-loop/gates` | Executes the 4 verification gates (format, RED baseline, worktree green, mainline transfer) and records handoff snapshots. |
| `packages/dev-loop/lifecycle` | Guards transitions across `todo`, `pending`, and `done`, enforces CAS claim leases, and executes `piece/pre-complete` serial hooks. |
| `packages/dev-loop/persistence` | Persists write-ahead transition records, hydrations, and anomalous divergence quarantines via `ctx.storageDomain`. |
| `packages/dev-loop/queue` | Manages bounded concurrency admission, FIFO reservation, and execution cleanup leases across delegated worker slots. |
| `packages/dev-loop/references` | Parses Markdown reference tables, resolves AST links, and enforces bounded local source attribution. |
| `packages/dev-loop/roles` | Coordinates specialist persona dispatch (Neko-chan, L, Daru, Hououin Kyouma, Mayuri), research guards, and delegation ledgers. |
| `packages/dev-loop/worktree` | Allocates isolated detached worktrees under `.worktrees/<piece-id>`, detects collisions, and manages safe cleanup. |

---

## Specification Corpus Location

Micro-gate specifications governing the development-loop base reside in `plans/pieces/00-dev-loop/`:

1. **Set Index**:
   `plans/pieces/00-dev-loop/README.md` tracks all 46 micro-gates, their dependencies, execution queue order, and lead personas.

2. **Completed Micro-Gates (`plans/pieces/00-dev-loop/done/`)**:
   - `plans/pieces/00-dev-loop/done/00.01a-heading-scanner.md` through `00.01e-candidate-selector.md`: Heading scanning, metadata parsing, piece validation, set scanning, and candidate selection.
   - `plans/pieces/00-dev-loop/done/00.02a-lifecycle-states.md` through `00.02d-done-transition.md`: Three-state lifecycle transitions, CAS claim leases, pre-complete serial hooks, and promotion to `done/`.
   - `plans/pieces/00-dev-loop/done/00.03a-presentation-card.md` through `00.03c-digest-authorization.md`: Decision presentation cards, user question handling, and digest-authorized approvals.
   - `plans/pieces/00-dev-loop/done/00.04a-priority-comparator.md` through `00.04c-queue-inspection.md`: Priority comparators, concurrency semaphores, and queue state inspection.
   - `plans/pieces/00-dev-loop/done/00.05a-worktree-allocation.md` through `00.05c-worktree-cleanup.md`: Detached worktree allocation, collision avoidance, and retirement cleanup.
   - `plans/pieces/00-dev-loop/done/00.06a-specialist-roles.md` through `00.06d-delegation-ledger.md`: Specialist persona configurations, research guards, delegation dispatch, and delegation ledgers.
   - `plans/pieces/00-dev-loop/done/00.08a-reference-table-ast.md` through `00.08c-provenance-store.md`: Reference table AST parsing, locator containment, and provenance verification.
   - `plans/pieces/00-dev-loop/done/00.11a-slash-command-parser.md` through `00.11c-rejection-command.md`: Slash command parsing, OCC approval execution, and rejection commands.
   - `plans/pieces/00-dev-loop/done/00.12a-write-ahead-intent.md` through `00.12d-anomaly-quarantine.md`: Write-ahead intent logging, storage domain schemas, startup hydration, and anomaly quarantine.
   - `plans/pieces/00-dev-loop/done/00.13a-claim-inventory-parser.md` through `00.13d-fail-closed-gate.md`: Claim inventory parsing, research brief compilation, forensic hash verification, and fail-closed gate evaluation.

---

## Unimplemented Specifications in Set 00

Ten micro-gates in `plans/pieces/00-dev-loop/` remain pending implementation:

1. **BDD Extraction & Test Freezing**:
   - `plans/pieces/00-dev-loop/00.09a-bdd-extractor.md`: Extracts Given/When/Then scenarios from specifications into test scaffolds.
   - `plans/pieces/00-dev-loop/00.09b-behavioral-red-runner.md`: Executes behavioral tests against baseline trees to prove initial failure.
   - `plans/pieces/00-dev-loop/00.09c-test-file-freezer.md`: Freezes verified test files via SHA-256 digests before implementation starts.

2. **Autonomous Verification Gates**:
   - `plans/pieces/00-dev-loop/00.10a-format-axiom-gate.md`: Gate 1 format, line ceiling, and section axiom validator.
   - `plans/pieces/00-dev-loop/00.10b-red-baseline-gate.md`: Gate 2 pre-implementation failure runner.
   - `plans/pieces/00-dev-loop/00.10c-worktree-green-gate.md`: Gate 3 worktree test suite evaluation.
   - `plans/pieces/00-dev-loop/00.10d-mainline-transfer-gate.md`: Gate 4 clean patch transfer and post-transfer verification.

3. **Subsystem Assembly & Integration**:
   - `plans/pieces/00-dev-loop/00.14a-host-service-assembly.md`: Mounts development-loop host services in bundle patch layers.
   - `plans/pieces/00-dev-loop/00.14b-brain-preset-tools.md`: Mounts model-facing dev-loop tools in orchestrator presets.
   - `plans/pieces/00-dev-loop/00.14c-loop-integration-test.md`: End-to-end multi-agent integration test driving the complete autonomous loop.
