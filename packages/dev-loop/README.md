---
description: "The development-loop package group: piece discovery, guarded lifecycle changes, retained worktrees, and durable role delegation, for contributors choosing a service and locating its reference."
kind: "package-group"
---

# dev-loop/ — Piece discovery and delegation

English | [中文](README.zh.md)

## Summary

Discover piece specifications, request human approval, and change status through guarded operations. Delegate specialist assignments with durable, attributed reports while retaining their worktrees for handoff. Queue bounds admitted work through cleanup; Roles composes delegation without owning assignment retirement. These packages do not provide a complete autonomous loop or durable lifecycle-transition records.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Choose the service by the operation it owns.

| Package | Role |
|---|---|
| [`approval`](approval/README.md) | Present current source for Accept, Question, or Change; reject stale acceptance. |
| [`directory`](directory/README.md) | Discover and validate piece specifications through the filesystem service. |
| [`lifecycle`](lifecycle/README.md) | Guard status changes and promote tracked piece files into `done/`. |
| [`queue`](queue/README.md) | Admit consumer-owned one-shot delegations and bound startup through complete cleanup. |
| [`roles`](roles/README.md) | Delegate specialist assignments and retain bounded, attributed history. |
| [`worktree`](worktree/README.md) | Retain detached piece checkouts across roles and conservatively retire clean owned trees. |

<a id="related-documentation"></a>
## Related documentation

- [Development-loop subsystem](../../docs/subsystems/development-loop.md) — canonical owner of this group's shared types, lifecycle semantics, and generated Cordis API.
- [Filesystem subsystem](../../docs/subsystems/filesystem.md) — file access and version-guarded edits.
- [Subprocess subsystem](../../docs/subsystems/subprocess.md) — command execution and cancellation.

<a id="dev-note"></a>
## Dev Note

None.
