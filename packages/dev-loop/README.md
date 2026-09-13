---
description: "The development-loop package group: piece specification discovery and guarded lifecycle changes, for contributors choosing a service and locating its reference."
kind: "package-group"
---

# dev-loop/ — Piece discovery and lifecycle

## Summary

Read development-loop piece specifications and change their status through guarded operations. The directory package discovers and validates files; the lifecycle package manages in-memory transitions and Git promotion of completed pieces. The approval tool requests an explicit human decision before moving a current todo piece to pending. These packages do not provide a complete autonomous loop or durable transition records.

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

<a id="related-documentation"></a>
## Related documentation

- [Development-loop subsystem](../../docs/subsystems/development-loop.md) — canonical owner of this group's shared types, lifecycle semantics, and generated Cordis API.
- [Filesystem subsystem](../../docs/subsystems/filesystem.md) — file access and version-guarded edits.
- [Subprocess subsystem](../../docs/subsystems/subprocess.md) — command execution and cancellation.

<a id="dev-note"></a>
## Dev Note

None.
