---
description: "Retain development-loop transition history and inspect quarantined pieces without authorizing recovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-persistence

English | [中文](README.zh.md)

## Summary

Recover committed development-loop status after restart and inspect discrepancies before admitting more work. Required lifecycle durability records intent before effects and terminal outcome before publishing success. Human acceptance remains tied to the reviewed source. Recovery acknowledgment records awareness, not permission to repair or resume a quarantined piece.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the default service in the host composition with `storageDomain`, `devLoopDirectory`, and `fs`. Configure Lifecycle with `durability: required` and add `inject: ['devLoopPersistence']` to its composition entry so Loader waits for the provider. Missing required persistence rejects initialization; omitted lifecycle durability selects nondurable memory mode, not automatic fallback after a storage failure.

### Configuration

All provider fields are explicit; byte and record budgets are positive safe integers.

| Field | Default | Meaning |
|---|---|---|
| `repositoryRoot` | Required | Repository process path, canonicalized before deriving repository identity |
| `maxRecordBytes` | Required | UTF-8 JSON limit for each complete retained transition or anomaly row, including terminal and acknowledgment metadata |
| `maxHistoryRecords` | Required | Intent rows per piece, including failed attempts; overflow rejects without truncation |

### Durable status and quarantine

Lifecycle holds its compare-and-set claim before awaiting admission. An intent is durable before policy or filesystem effects; its terminal updates that same row before memory publication and announcements. Failed attempts retain their sequence. Illegal edges and stale claims create no intent. Intent I/O failure reports `DEV_LOOP_INTENT_WRITE_FAILED` without effects; terminal I/O failure reports `DEV_LOOP_TERMINAL_WRITE_FAILED` with separate header, index, move, and cleanup observations.

Hydration compares committed history with current source and location. Consistent pending or blocked state can retain a `todo` disk header. Missing or duplicate sources, substantive edits, status/path conflicts, unjournaled done files, unresolved intents, and uncertain effects remain anomalies. Quarantined status reads and transitions reject with `PIECE_QUARANTINED`; a done directory is not independent authorization to satisfy dependencies.

Source identity retains the canonical Directory path, actual filesystem version, and raw and normalized SHA-256 digests. Normalization changes only the initial lifecycle Status value to `todo`; body examples, whitespace, line endings, and other content remain significant. Live acceptance checks the reviewed version. Restart compares recorded bytes rather than requiring an old provider version token to survive copying. Consumers require complete validated UTF-8 with a known matching byte count; BOM-prefixed input is unsupported.

### Recovery inspection

The separate named-export plugin `@deepseek-ai/dsh-dev-loop-persistence/command` mounts with `commands`, `agents`, and `devLoopPersistence`. It registers `dev-loop-recovery`; user input accepts only `inspect <pieceId>` or `acknowledge <anomalyId> <reason...>`. Its required `maxInputBytes` and `maxOutputBytes` bound UTF-8 input and the complete serialized CommandResult. The output limit must fit the complete overflow error result.

Inspection returns text equal to `JSON.stringify({pieceId,history,anomalies})`, with sequence-ordered history and deterministic anomalies filtered to that piece. Acknowledgment requires the exact live root Agent, rereads the recorded local observations, and rejects changes with `DEV_LOOP_ANOMALY_STALE`. Its JSON result records the actual command and Session identity, full reason apart from surrounding whitespace, observations, and timestamp. Acknowledgment survives restart but never clears quarantine or changes status. There is no repair, promote, or done verb.

An oversized result returns `Recovery output exceeds maxOutputBytes; increase the configured limit.` rather than clipped history. The command runtime owns the actual `command/run` and `command/done` Session records. Disposal removes the registration.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `dev_loop` version-1 single-layout storage domain retains transitions and anomalies. A transition row contains intent plus an optional terminal; there is no separately published piece table. Repository identity binds records to the canonical absolute repository process path. Parsing rejects malformed durable values and inconsistent identity or transition history rather than skipping them.

[The service](src/index.ts) owns serialized writes and detached inspection results; [source observations](src/source.ts) supply pure hashing without fetching or authorizing; [the recovery consumer](src/command.ts) owns command grammar and human identity checks. Lifecycle supplies the ordering around actual policy, filesystem, and Git effects. Lifecycle tracks and joins admitted work; shutdown also requires dependency disposal ordering to keep storage available. Cancellation does not cancel an admitted terminal-recording obligation.

No invariant companion is published: hydration and transition admission enforce the history/source relationship at its owning operations, rather than maintaining a second status projection solely for a checker.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Lifecycle](../lifecycle/README.md): legal transitions and compensating header recovery.
- [Human commands](../command/README.md): source review and revision-bound acceptance.
- [Persistence decision](../../../.agents/notes/implemented/architecture/2026-09-14-development-loop-persistence.md): ordering, rejected alternatives, and recovery limits.

-----

<a id="model-experience"></a>
## Model Experience

### Recovery command results

#### What the model sees

The host service and `dev-loop-recovery` human command register no model tool or prompt and do not inject command output into model context.

#### Token effect

Durable history and recovery results add no model-input tokens through this package.

#### KV Cache effect

These operations do not modify the model request prefix. Session command records remain command-runtime output, not model-history injection by this package.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Recovery preserves uncertainty instead of silently authorizing work.

- **Root-disposal ordering is unresolved:** an external storage-provider shutdown prerequisite can close a storage unit before admitted work settles. Lifecycle's join does not independently guarantee end-to-end storage availability during root disposal.
- **No atomic filesystem/Git/storage transaction:** header restoration does not roll back the Git index or prove that movement did not occur.
- **No automatic repair or execution restoration:** acknowledgment does not clear quarantine, reopen done pieces, recreate Queue callbacks, restore Agents, or resume work.
- **No repository relocation:** records from another canonical repository root are refused; import and root migration are unsupported.
- **Trusted Consumer authorization:** recorded tool/command facts are trusted observations, not cryptographic proof against a malicious trusted plugin. This package does not replace completion policy.
- **No lossy source or output acceptance:** unknown byte counts, BOM-stripped source, and oversized complete records or results are refused rather than normalized away or truncated.

<a id="dev-note"></a>
### Dev Note

Behavioral and recorded-session validation belongs to the integration owner; this document does not assert that the frozen behavior suite or recovery replay has passed.
