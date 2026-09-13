# Set 00 — The Development Loop

The development loop is the execution engine that all future DeepSeek Harness work runs through. Specifications arrive sized for one-at-a-time ingestion as discrete lego pieces (at most 280 lines). For each piece, the orchestrator presents the feature summary, mechanism, Given/When/Then behaviour, teaching section, and references to the user. At every junction, the user can question, request changes, or accept the piece. After approval, a role consumer submits executable work to the prioritized queue. Its configurable `maxConcurrency` defaults to 4 and bounds queue-owned one-shot delegations; it is not a process-wide subagent count. Each subagent executes within its own isolated Git worktree, bounded by sandbox fencing. The loop delegates by role (Research, Test Writer, Implementer, Utility), restricts Research's inherited tools through an explicit allowlist, preserves the attribution and limitations of evidence, and requires four verification gates before declaring new work done. Tool filtering is not process-wide nonmutation or OS confinement.

## Set Index

*Completed pieces live in `00-dev-loop/done/`.*

| Piece ID | Title | Package | Depends on | Queue Order | Status |
|---|---|---|---|---|---|
| `00.01` | [Piece Directory and Specification Parser](done/00.01-piece-directory.md) | `@deepseek-ai/dsh-dev-loop-directory` | none | 1 | done |
| `00.02` | [Piece Lifecycle State Machine](done/00.02-piece-lifecycle.md) | `@deepseek-ai/dsh-dev-loop-lifecycle` | `00.01` | 2 | done |
| `00.03` | [Approval Junction and User Clarification](done/00.03-approval-junction.md) | `@deepseek-ai/dsh-dev-loop-approval` | `00.01`, `00.02` | 3 | done |
| `00.04` | [Dev Loop Dispatch Queue and Concurrency Guard](done/00.04-concurrency-queue.md) | `@deepseek-ai/dsh-dev-loop-queue` | `00.01`, `00.02`, `00.03` | 4 | done |
| `00.05` | [Per-Piece Detached Git Worktree Allocation](done/00.05-worktree-assignment.md) | `@deepseek-ai/dsh-dev-loop-worktree` | `00.04` | 5 | done |
| `00.06` | [Role Delegation Dispatcher and Record](done/00.06-role-delegation.md) | `@deepseek-ai/dsh-dev-loop-roles` | `00.04`, `00.05` | 6 | done |
| `00.07` | [Research Capability Policy and Acceptance](done/00.07-research-guard.md) | `@deepseek-ai/dsh-dev-loop-roles` (shared owner) | `00.06` | 7 | done |
| `00.08` | [References Provenance Store and Verification](done/00.08-references-provenance.md) | `@deepseek-ai/dsh-dev-loop-references` | `00.01`, `00.06` | 8 | done |
| `00.09` | BDD Scenario Extractor and Test Handoff | `@deepseek-ai/dsh-dev-loop-test-handoff` | `00.01`, `00.06`, `00.13` | 9 | todo |
| `00.10` | [Evidence-Bound Completion Gates](00.10-verification-gates.md) | `@deepseek-ai/dsh-dev-loop-gates` | `00.02`, `00.09` | 10 | todo |
| `00.11` | [Human Command Surface `/dev-loop`](done/00.11-command-surface.md) | `@deepseek-ai/dsh-dev-loop-command` | `00.01`, `00.02`, `00.04` | 11 | done |
| `00.12` | [Durable Lifecycle Integration and Reconciliation](done/00.12-loop-persistence.md) | `@deepseek-ai/dsh-dev-loop-persistence` | `00.02`, `00.04`, `00.06` | 12 | done |
| `00.13` | [Revision-Bound Claim Verification](done/00.13-claim-verification.md) | `@deepseek-ai/dsh-dev-loop-claims` | `00.01`, `00.06`, `00.07`, `00.08` | 13 | done |
| `00.14` | [Opt-In Host Assembly and Authored Brain Preset](00.14-composition-and-preset.md) | `@deepseek-ai/dsh-dev-loop-preset` | `00.01`-`00.13` | 14 | todo |

## Execution Protocol

The implementation sequence is Test Writer → RED → Implementer gets tests green → transfer to master → final post-transfer tests → move the completed piece into `done/` and update this index. There is no reviewer stage. Human approval is part of the product, exercised at `00.03`, and is separate from any code-review process.

1. **Intake & Validation**: Piece files under `plans/pieces/` are parsed and validated by `00.01` to enforce structure, the line ceiling (<=280), and primitive rules. A malformed piece is reported as a rejection alongside the valid ones, so one bad file never hides a set.
2. **Approval Junction**: `00.03` presents Summary, Mechanism, BDD scenarios, the teaching section, and the References table to the user, pausing for Accept, Question, or Change.
3. **Queue & Concurrency**: Approved pieces are queued by `00.04`, which bounds concurrent workers through a validated `Config` field rather than a hardcoded constant.
4. **Worktree Provisioning**: Dispatched pieces receive dedicated Git worktrees via `00.05` under `.worktrees/<piece-id>`. A child session's `cwd` becomes its sandbox workspace root, so `workspace-write` mutations are confined to the worktree — but this is a user-space check, and `/tmp` and the OS temp directory stay writable, so isolation is strong for repository files and not absolute.
5. **Role Delegation**: `00.06` assigns roles (Research, Test Writer, Implementer, Utility); `00.07` validates Research's explicit inherited-tool allowlist and tests first-call enforcement. Trusted plugins and child-local tools remain separate policy concerns.
6. **Provenance & Claim Verification**: `00.08` checks source locators and exact report attribution without claiming verified inspection. `00.13` inventories load-bearing claims, delegates one bounded Research report per attempt under `00.07`, and refuses handoff for unresolved or contradicted claims. Source amendments and renewed human approval are explicit, never automatic proof-table rewrites.
7. **BDD Extraction & Test Handoff**: `00.09` extracts Given/When/Then scenarios against verified claims, handing them off to the Test Writer to establish failing RED baselines before implementation.
8. **Behaviour Verification Gates**: `00.10` intercepts completion to enforce Format, RED, GREEN, and Post-merge test gates before `00.02` marks the piece `done`.
9. **Command & Persistence**: Human operators monitor and control via `00.11` (`/dev-loop`). `00.12` integrates durable Lifecycle commits and recovery observations; other owners retain their own storage domains. Restart does not reconstruct live Queue callbacks or children. Unjournaled historical done files remain explicit anomalies rather than new completion evidence.
10. **Mounting**: `00.14` composes the whole set into something an operator can run — the loop's services as host rows in the deployment's `cordis.patch.yml`, and its tools, persona and prompt sections as a selectable `dev-loop` agent preset. Services stay host-side because the queue and the completion record are shared across sessions; a preset-local copy would give every session its own private loop.
