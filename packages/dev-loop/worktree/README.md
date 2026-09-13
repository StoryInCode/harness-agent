---
description: "Retain detached Git worktree assignments across development-loop roles and explicitly retire only clean, unchanged owned trees."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-worktree

English | [中文](README.zh.md)

## Summary

Give each development-loop piece a separate checkout and keep its files across Test Writer and Implementer runs. Repeated requests retain the same directory and base commit. Existing linked isolation is borrowed rather than nested. Cancellation and unloading preserve physical trees; explicit retirement refuses work that may still need transfer.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount the service in a host composition with `fs` and `subprocess` providers sharing an execution world. The mainline must identify a non-bare main checkout with a valid commit. Configure these fields before requesting assignments:

| Field | Default | Meaning |
|---|---|---|
| `mainlinePath` | Required | Main checkout directory |
| `worktreeRoot` | `.worktrees` | Ignored directory beneath the canonical mainline |
| `commandTimeoutMs` | Required | Positive integer command deadline, at most 2147483647 ms |
| `outputMaxBytes` | Required | Positive safe integer collected bytes per stream |
| `terminationGraceMs` | Required | Positive integer termination/drain grace, at most 2147483647 ms |

`assignWorktree` accepts a dotted piece ID, cwd, and cancellation signal. Its immutable result identifies the directory, pinned commit, and created or borrowed ownership. Compatible overlapping callers share the owner's attempt; cancelling a waiter does not cancel that owner. An owner cancellation rejects coalesced waiters after subprocess settlement. Role completion does not retire an assignment.

Only call `retireWorktree` after stopping every user of the assignment. Borrowed trees, changed HEADs, and staged, unstaged, untracked, or ignored files prevent removal. Git removal never uses force. Failures retain the mapping and disclose the attempted path with preserved or uncertain residue; inspect that path before recovery. The service never repairs ignore files or automatically deletes failed allocations.

To observe behavior from the repository root:

```bash
pnpm exec vitest run packages/dev-loop/worktree/tests/worktree.spec.ts
```

The frozen cases exercise real detached checkout/index isolation, retained role files, borrowing, refusal, explicit retirement, Loader publication, and cancellation that waits for managed-range quiescence.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The service](src/index.ts) serializes mutations and publishes one retained assignment only after Git inventory confirms its path and commit. Detached HEAD means the checkout points directly to a commit instead of creating a branch. Git supplies checkout creation and registration; the filesystem supplies canonical identity and containment; [the command helper](src/git.ts) supplies bounded Git observations and command lifetime ownership.

A command deadline starts cancellation, not successful cleanup. The helper requests termination and awaits `waitForExit()` without a deadline, including after provider failures. A zero exit after cancellation cannot publish success. NUL-delimited inventory preserves paths that ordinary line parsing could corrupt.

No invariant companion is published: publication checks Git observations directly, while retained assignments intentionally remain valid historical bases when callers modify files or HEAD. A periodic equality assertion would reject that supported work rather than diagnose an owned inconsistency.

</details>

## Model Experience

None, as this host service registers no model tool, prompt, or session event.

#### KV Cache effect

Nothing enters model requests, so token use and provider cache reuse are unaffected.

## Known Limitations and Deferred Work

Allocation and deletion authority do not establish transfer correctness.

- Assignments are process-local; restart recovery and durable associations belong to 00.12. Occupied unrecorded paths require explicit recovery rather than adoption.
- Child-session cwd integration belongs to 00.06. This package does not change parent headers or invent subagent request fields.
- Submodules and bare repositories are unsupported. Ignored assets, including dependencies and secrets, are not copied into new checkouts and block retirement if present.
- There is no cross-process lock or transactional protection against external writers racing retirement checks. Callers must stop assignment users before retirement.
- A provider unable to establish managed-range quiescence can hold teardown or reject its observation. Elapsed time cannot certify cleanup.
- Directory allocation is not filesystem confinement, transfer verification, or permission to delete dirty work. No branches, commits, pushes, transfers, or automatic cleanup occur.

### Dev Note

The [decision record](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-worktree.md) explains retained ownership and why neither role completion nor clean status certifies transfer.
