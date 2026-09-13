---
description: "Check development-loop source locators and retain report attribution without claiming verified inspection."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-references

English | [中文](README.zh.md)

## Summary

Check a piece's References against local files and retain the exact report identity available from delegation history. Distinguish a missing source from missing evidence about who inspected it. Read the latest durable observation after restart, and recheck after editing the piece. A resolved source or linked report never proves inspection or claim truth.

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

The Host service publishes `ctx.devLoopReferences`. Compose its service row with Directory, Roles, filesystem and storage-domain providers in the same Host; this package is not an installable profile bundle or a model tool.

### Configuration

Deployment supplies every field. Numeric limits must be positive safe integers, and the observation budget must admit the minimum error envelope; there are no deployment defaults.

| Field | Default | Meaning |
|---|---|---|
| `repositoryRoot` | required | Explicit repository root used for local code locators and canonical containment. |
| `maxPieceBytes` | required | Maximum UTF-8 bytes of complete decoded piece text read by this owner. |
| `maxSourceBytes` | required | Maximum UTF-8 bytes of complete decoded source text. |
| `maxObservationBytes` | required | Maximum UTF-8 bytes of complete `JSON.stringify(observation)`, including errors and metadata. |
| `maxReferences` | required | Maximum accepted locator count, not merely table rows; overflow invalidates the observation without truncating entries. |

### Read and verify

Call `verifyReferences(pieceId, signal)` to read, check and durably store an observation before receiving a detached result. `getProvenance(pieceId)` returns the detached latest durable observation, or `undefined` when none exists; it does not recheck files. There is no API to admit caller-authored verification records.

The observation separates structural validity from inspection confidence. Source statuses are `resolved`, `missing`, `invalid` and `not-checked`; attribution statuses are `linked-report`, `unverified` and `contradicted`. Inspection remains `unverified` in every case. Errors and limitations explain unresolved checks without treating missing evidence as fabrication.

### Observe the result

From the repository root, run the owner-local suite without overwriting its recorded RED artifacts:

```sh
pnpm exec vitest run packages/dev-loop/references/tests --testTimeout=30000 --hookTimeout=30000
```

The expected result is seven passing files and 106 passing tests: the historical 84 cases, 21 supplemental cases and one separately frozen nested-definition regression. Assertions include durable reopen retaining detached observations and a real child report claiming source usage remaining unverified for inspection. The [baseline](tests/RED.md) records the Test Writer's RED execution separately from this expected outcome.

### References grammar

Use one supported table profile, with the columns in exactly this order. Inline Markdown and whitespace in column headings are normalized; absent explanatory fields remain absent rather than guessed.

- `Source | Role/preset that inspected it | Question it answered | Direct inspection or reported | How it was used`
- `Source | Role/preset and provenance | Decision informed`
- `Source | Question answered | Provenance`
- `Source | Provenance | Decision informed`
- `Source | Role/preset | Provenance | Decision informed`

A plain `None.` or `No references.` declaration records an explicit empty observation. Unsupported or reordered profiles, duplicate required columns and malformed rows are invalid, not empty. Directory may reject an absent References section with its own parse error before References receives a piece; that error propagates without a fabricated observation.

### Source and attribution policy

Inline-code local paths resolve from `repositoryRoot`; relative Markdown links resolve from the piece directory. Canonical containment includes intermediate symlinks. Absolute paths, directories, escaping targets and unsupported locator syntax reject. Optional `:N` and `:N-M` suffixes require positive ordered line numbers within the decoded file. Fragments are retained without semantic verification. HTTP(S) locators remain `not-checked`; References does not fetch them.

Each AST locator retains its row's source and attribution prose. A code span inside a link label is display text, not a second locator. A resolved source fingerprint covers the whole decoded file, not just the selected lines. SHA-256 hashes the UTF-8 encoding of complete filesystem-decoded text without newline normalization; it is not a fingerprint of original undecoded bytes.

Use `delegation:<UUID>` for exact attribution linkage. References queries only `devLoopRoles.getDelegations(pieceId)`: a record absent from that piece's history is unavailable, whether unknown or attached elsewhere. Linkage requires a settled record with an actual child session; it retains the recorded role, optional actual preset, terminal status and limitations. Requested-only records cannot establish an executed report, and failed or aborted reports stay qualified partial outcomes.

Explicit `role:<canonical role>` and `preset:<id>` tokens assert identity; an entire separate `Role/preset` cell in the four-column profile equal to `Research`, `Test Writer`, `Implementer` or `Utility` also asserts that role. Visible mismatches are `contradicted`. An asserted preset with no recorded preset remains `unverified`. Other prose is preserved without heuristic identity extraction. Neither linkage nor a direct-inspection assertion proves that the author used any source.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Directory supplies a piece path and metadata, not a Markdown AST. References reads through filesystem resolution and streaming operations, parses Markdown/GFM with `mdast-util-from-markdown`, `mdast-util-gfm` and `micromark-extension-gfm`, and owns locator and attribution policy. `unist-util-visit` collects document-global reference-link definitions recursively, including definitions nested in blockquotes; the first definition for an identifier wins. Runtime code does not import repository-only Markdown scripts.

References owns the `dev_loop_references` single-layout storage domain, validates authoritative records with Zod, and serializes verification through durable publication. Invalid stored records and failed writes reject rather than becoming trusted observations. Cancellation prevents new checks; an already-admitted write settles under the domain lifetime. Disposal joins admitted operations before closing storage. Consumers use this service instead of reopening or duplicating its domain.

No runtime invariant companion is published: retained observations have one authoritative domain, and a changed source is permitted rather than an independently maintained value required to equal a stored fingerprint. Reverification, not an invariant claiming files never change, establishes a new observation. The [public DTOs](src/types.ts) define the detached values.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Directory API](../directory/src/index.ts) — piece lookup and parse rejection.
- [Roles records](../roles/src/types.ts) — requested versus actual delegation facts.
- [Storage domains](../../storage/storage-domain/README.md) — authoritative validation and durability.
- [References decision](../../../.agents/notes/implemented/architecture/2026-09-13-references-observation-not-inspection.md) — rationale and required verification.

-----

<a id="model-experience"></a>
## Model Experience

None, as this Host service registers no model tool, prompt contribution or Session event. It adds no model-input tokens.

#### KV Cache effect

Nothing here enters model requests, so this package does not affect provider KV Cache reuse.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The observation describes a bounded check, not an inspection oracle.

- Directory performs whole-file reads during lookup; References limits bound only its own subsequent reads, not Directory buffering.
- Piece overflow rejects before publishing an observation or digest. Source overflow retains an invalid entry without a source digest. Complete observation overflow rejects persistence; evidence is never silently clipped.
- Piece fingerprints identify checked text, not freshness after edits. Recheck changed pieces; missing files today do not establish that they never existed.
- URLs are not fetched, fragments are not semantically checked, and linked authorship does not establish source usage or claim truth. Independent source-access evidence needs a separate owner.
- Claims and Gates are later consumers, not included here. Piece 00.08 introduces no new model consumer, Session events or promised recorded-session snapshot; a later model-visible consumer must log rendered results through the existing tool runtime and add its relevant keyless scenario.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The [Test Writer baseline](tests/RED.md) owns immutable RED commands and evidence limitations. The integration coordinator reports 106 passing tests across seven files and 100% statements, branches, functions and lines for each of the five production modules in the final coverage run. This documentation task did not execute that run. The coordinator also reports final dependency-closure and package TypeScript builds passing, whole-package lint with zero warnings/errors, and isolated tsdown JavaScript/declaration output passing. The final strict source-test check exits 2 with exactly 98 vendored diagnostics and no package diagnostics; it is not a globally passing typecheck. Main-checkout Roles-policy integration, shared generators and the root Typert build pipeline remain pending; the isolated build does not verify that pipeline. Keep reported GREEN results separate from the historical RED evidence.

</details>
