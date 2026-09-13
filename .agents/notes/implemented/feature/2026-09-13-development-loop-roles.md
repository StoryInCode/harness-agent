# Agent Note: Durable role delegation records observed evidence

Status: implemented

English | [中文](2026-09-13-development-loop-roles.zh.md)

## Problem

Specialist work needs retained files and attributable reports across successive runs. A child result alone does not establish cleanup, durable history, or independent verification of its claims. Model-supplied execution policy would also let a task select authority that belongs to the Host.

## Decision

[Roles](../../../../packages/dev-loop/roles/README.md) combines a Host service with a scoped Brain tool consumer. Host configuration selects the provider, persona, and inherited-tool filter for Research, Test Writer, Implementer, and Utility. The model supplies only a bounded brief. Provider compatibility checks reject unsupported capabilities. Research requires a nonempty explicit allowlist, with optional deny subtraction; other roles require explicit allow and/or deny. This requirement makes selection explicit without certifying that permitted tools are read-only.

Roles captures the exact live initiator and saves intent before Queue admission. Admitted dispatch obtains a retained worktree and supplies its directory through the public subagent request. The actual returned lease goes directly to Queue, which owns result observation and disposal. Roles records actual child identity and optional header preset, never a guessed composition, and persists a terminal observation before returning it. Reports remain `reported` evidence rather than the parent's direct inspection.

Cleanup classification follows observable ownership. A rejected `SubagentRuntime.start` without a returned lease leaves cleanup `unproven`, even if internal cleanup may have succeeded. For a returned lease, successful awaited `QueueTicket.cancel` proves cleanup despite result rejection. Cancellation rejection leaves cleanup `unproven`. Uncertain cleanup always yields `failed`; Roles preserves only failures observable through the public runtime and Queue, not hidden startup-disposal details.

Complete-value byte limits apply separately to the brief, durable terminal record, and rendered tool content. Overflow never silently clips a successful report or returns partial history. When required terminal metadata cannot fit or persistence fails, the requested record remains unresolved and the operation rejects. Durable intent does not assert that a child is running, and restart does not automatically retry it.

## Alternatives considered

**Let Queue spawn specialists.** Queue's callback already lets its consumer choose provider and assignment without duplicating admission or cleanup. Moving those choices into Queue would combine independently owned policy and scheduling.

**Retire worktrees after each role.** A finished child does not establish transfer or make another role's inputs disposable. The piece retains its assignment independently of each run.

**Treat a persona or directory as confinement.** Instructions do not enforce permissions, and a working directory does not restrict filesystem access. Providers apply inherited-tool filtering, while deployment owns the safety of permitted capabilities.

**Infer cleanup from the error class.** A startup rejection can conceal cleanup information, and a rejected result can coexist with successful disposal. Only the returned lease and Queue's awaited cancellation support that distinction.

## Consequences

The service preserves attribution and unresolved intent without maintaining a second history cache or another child-lifecycle controller. It provides neither crash reconciliation nor transfer, automatic retirement, independent evidence verification, or Research-policy acceptance. Storage failures and uncertain cleanup require inspection rather than automatic retry. No runtime invariant companion is needed because the service has no independently maintained observation to compare with its authoritative records.

## Verification

The [historical coverage-additions report](../../../../packages/dev-loop/roles/tests/COVERAGE-ADDITIONS.md) records 47 passing cases against its named source hashes and a failed strict per-file coverage gate. It explicitly leaves actual-provider cleanup-failure integration unverified. Those frozen measurements are not acceptance of current source. This note claims no new test, snapshot, or coverage result.

## Related decisions and supersession

The scoped supersession review retains the [Queue decision](2026-09-13-development-loop-queue.md) and [Worktree decision](2026-09-13-development-loop-worktree.md) as independent active records. Queue still owns capacity through cleanup; Worktree still owns allocation and conservative retirement. Roles consumes both decisions without replacing their rationale, alternatives, or verification. Neither note is superseded, consolidated, moved, or archived.
