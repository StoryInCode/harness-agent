# Agent Note: development-loop completion recovery

Status: proposed

## Problem

A development-loop completion changes a specification header, Git index, file location, and lifecycle status. Those systems cannot commit atomically. An in-memory claim prevents competing calls to one service instance, but cannot prevent an editor from changing the file or recover state after process death. Line coverage does not establish these guarantees: the baseline tests do not assert the header after a failed move or hold a subprocess open during lifecycle disposal.

The [directory decision](../../implemented/architecture/2026-09-12-development-loop-piece-directory.md) continues to own discovery, parsing, and per-file rejection. This proposal is complementary; it supersedes no active decision record. The scoped active-note search found no existing owner for completion recovery.

## Proposal

Give each transition one operation lifetime combining the caller's signal and the lifecycle fiber. Take the compare-and-set claim before awaiting a serial pre-completion hook. Rejecting verification must precede any file or Git mutation. Plugin teardown must abort and await active operations, including compensation, rather than relying on eventual subprocess-provider disposal.

Rewrite the actual on-disk status header with the filesystem's version-guarded literal edit. The in-memory expected status is not necessarily that header: approval changes memory to pending while the file can still declare todo. Retain the prior header and the edit's returned version so an ordinary failure can restore only a change this operation still owns.

Inspect ordinary subprocess outcomes and preserve cancellation precedence explicitly rather than claiming the API reports both simultaneously. Stop forward work on failure and attempt guarded compensation for every pre-publication failure, including cancellation after the move has completed. A recovery conflict or absent source must return an error retaining both the initiating failure and the recovery error. Do not use Git reset or clean to restore the index, because they could discard unrelated owner work.

Initialization needs cancellation before Cordis joins `Service.init`, not solely in the eventual unload disposer. An effect-owned `internal/plugin` listener can observe the exact disposed fiber before that wait and abort its listing or scan; the kernel still joins initialization. This uses the inspected vendor event, not a patch to `Fiber.dispose`.

A subprocess leader's `done` does not establish that its managed range is empty. Terminate and await `waitForExit()` even after the leader exits, without an already-aborted wait signal. Surface observation failure instead of declaring quiescence. Expose termination grace and output retention as validated configuration; keep the timer's external maximum fixed.

Retain Cordis emit semantics for committed announcements and document their consequences: a synchronous listener can reject the call after state publication. Pre-completion rejection, failed file promotion, and failed post-commit notification are different outcomes. Durable records require an awaited integration, not an unawaited completion listener.

The proposed behavior is specified in [piece 00.02](../../../../plans/pieces/00-dev-loop/done/00.02-piece-lifecycle.md). Full-loop approval, gate enforcement, durable revision binding, and crash reconciliation remain required through their owning packages; adding an empty hook does not implement them.

## Alternatives considered

**Unconditional read/replace/write.** Rejected because the final write can discard a change made after the read. Literal editing alone still needs an observed version when acceptance rests on the observed text.

**Blind compensating rewrite or Git reset.** Rejected because another actor can edit the file or index between the initiating failure and recovery. Detect a conflict and report incomplete recovery instead of undoing unrelated work.

**Treat an abort request as completed teardown.** Rejected because a process can remain alive after receiving the signal. The owner must await the operation's actual settlement.

**Store status only in a database.** This would simplify transactional persistence but would not satisfy the owner's requirement that completed pieces occupy a visible `done/` directory. A persistence layer must instead reconcile the multiple observations explicitly.

## Acceptance criteria

Regression tests must demonstrate RED against the baseline without import failures or timeouts, then pass after a source-only implementation. Observe hook rejection before mutation, guarded edits under concurrent changes, exact failing argv, ordinary compensation and recovery conflicts, a todo-to-pending-to-done chain, and held subprocess/recovery work during caller cancellation and fiber teardown. The Implementer must pass the frozen tests, then the parent transfers the implementation and reruns tests on master before completion and a milestone commit.

## Risks

Git can leave staged changes after compensation restores the working file. A killed move has an uncertain outcome until its source/destination are inspected. A process crash can prevent compensation entirely; this proposal is not crash recovery or cross-process serialization. Missing gate listeners and missing persistence must remain visible release gaps, not silent success claims. The explicit emit behavior also means callers cannot interpret every rejected transition promise as proof that no state changed.
