# Agent Note: Piece worktrees outlive individual role runs

Status: implemented

English | [中文](2026-09-13-development-loop-worktree.zh.md)

## Problem

A Test Writer's files must remain available to the Implementer and to later transfer checks. Ending a child run or unloading its service does not establish that its checkout is disposable. A clean detached HEAD can contain commits absent from the mainline, while ignored files can contain evidence or secrets.

## Decision

The [worktree service](../../../../packages/dev-loop/worktree/README.md) retains one process-local assignment per piece. Git creates a detached checkout from a pinned commit; existing linked isolation is borrowed rather than nested. Canonical filesystem identity and Git inventory must agree before an assignment is published. Concurrent compatible requests share the owner's attempt, while a waiting caller's cancellation does not cancel another caller's command.

Assignment ownership belongs to the piece, not an individual role. Service disposal aborts and joins active commands but leaves physical trees intact. Explicit retirement removes only created, clean, unchanged trees, without force. Borrowed trees, changed HEADs, and tracked, untracked, or ignored work remain. Failed commands report preserved or uncertain residue rather than attempting broad cleanup.

Command deadlines initiate cancellation. The owner requests termination and awaits managed-range quiescence without replacing it with a timer. Successful process exit after cancellation cannot publish an assignment.

## Alternatives considered

A branch per worker would violate the project's mainline-only workflow; detached checkouts provide independent files and indexes without new branch references. Automatic removal at role completion would destroy the handoff. Treating clean status as transfer evidence would lose detached commits or ignored files. Automatic adoption after restart lacks the retained base and ownership evidence needed for safe retirement.

Delegated Research inspected the [Git worktree manual](https://git-scm.com/docs/git-worktree), including detached creation, removal, directory identity, and NUL-delimited porcelain output. Git owns checkout creation and registration; no external code is copied. This allocation service does not replace the existing [worktree-local hook installer decision](../process/2026-07-27-worktree-local-lefthook.md), which owns a separate installation concern.

## Consequences

Assignments survive role changes but their mapping is not durable. Occupied unrecorded paths require explicit recovery. Transfer proof and deletion of dirty transferred trees need a separate protocol; allocation does not infer them from test success. Child-session workspace selection belongs to the subagent creation request, not a mutation of parent metadata. Directory allocation is not a filesystem security boundary.

## Verification

The [frozen behavior suite](../../../../packages/dev-loop/worktree/tests/worktree.spec.ts) uses private Git repositories and real local services to verify separate indexes, pinned bases, retained handoff files, borrowing, conservative retirement, and Loader disposal. The [supplemental cases](../../../../packages/dev-loop/worktree/tests/coverage.spec.ts) cover malformed external observations, provider failures, cancellation, and changed ownership evidence without replacing business services with mocks.
