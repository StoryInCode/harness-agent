---
description: "Development-loop piece directory (ctx.devLoopDirectory) for maintainers discovering, parsing, and validating plans/pieces specification markdown against the plans axioms."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-directory

## Summary

Use this package to read the development-loop piece corpus. It discovers piece specification files under a configured root, parses each one's header and sections, and validates them against the `axiom` blocks in `plans/AGENTS.md`, returning a `PieceRecord` per file. Reads go through the `fs` seam, never `node:fs`, so a sandboxed or remote backend governs every file access. The markdown grammar is a pure function, so the verification gates can validate text they already hold without touching disk. This is host-side state only: it registers no tool, prompt, or session event, so the model never sees it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it as a host service row and read the corpus through `ctx.devLoopDirectory`.

### Configuration

Every field is optional; a `cordis.yml` row may set one and inherit the rest.

| Field | Default | Meaning |
|---|---|---|
| `root` | `plans/pieces` | Directory holding the set directories, relative to the filesystem backend's base. |
| `maxLines` | `280` | Inclusive line ceiling, tracking the `R-piece-size` axiom. |
| `primitives` | the 18 values of the `plans/AGENTS.md` META AXIOM | Closed Harness-primitive vocabulary; a piece declaring anything else is rejected. |

### Service API

```text
ctx.devLoopDirectory.validate(filePath, content)        // pure; throws PieceParseError on a blocker
ctx.devLoopDirectory.scanSet('00-dev-loop', signal)     // SetScan { pieces, rejected }
ctx.devLoopDirectory.getQueueCandidates(setName, signal) // pieces declaring todo or pending
ctx.devLoopDirectory.getPiece('00.01', signal)          // rejects PieceNotFoundError when absent
ctx.devLoopDirectory.listSets(signal)                   // set directory names under the root, sorted
```

The optional caller signal reaches root, set, and `done/` path resolution as well as listings and reads. After each resolution settles, the service checks cancellation before starting the next filesystem request.

`scanSet` merges a set directory with its `done/` subdirectory, because the `R-done-pieces-moved` axiom moves a completed piece there. A completed piece therefore stays resolvable as another piece's dependency while `getQueueCandidates` excludes it from dispatch.

`listSets` returns only direct subdirectories of the root: a file beside them is not a set, and a set's own `done/` lives one level deeper and belongs to its set. An **empty** root returns `[]`, which is the honest answer for an empty corpus; a **missing** root rejects with `FsError` carrying `FS_NOT_FOUND` and the absolute path, because reading misconfiguration as "no work" would idle every consumer silently. `getQueueCandidates` and `getPiece` enumerate through this same method, so set discovery has one owner and cannot drift.

### Partial results, not all-or-nothing

`scanSet` returns `SetScan { pieces, rejected }`. A file that fails validation becomes a `PieceRejection { path, code, findings }` and the rest of the set is still returned. One malformed sibling never denies a caller the pieces it asked for: a bad file is data about the corpus, not an exception belonging to an unrelated reader, which is the same reason a linter reports per file instead of aborting.

`getQueueCandidates` selects from the valid pieces of every set it scans, and `getPiece` raises a parse error only when the requested id's own file is the rejected one — never naming a file the caller did not ask about. Two conditions still throw, because they are facts about the request rather than about one file's contents: `SetNotFoundError` for a set name no directory matches, and `DuplicatePieceError` when one id is declared by two files.

A rejection's id is derived from its filename, since a file that failed to parse has no trustworthy id in its content.

### Validation severity

Findings carry the severity of the axiom they enforce. A `blocker` rejects the file by throwing `PieceParseError`, which exposes `code`, `path`, and every `finding`. A `warning` is recorded on the returned record's `warnings` array and does not reject.

| Finding code | Severity | Condition |
|---|---|---|
| `MALFORMED_PIECE_HEADER` | blocker | No `# NN.MM — Title` line, a missing `**Label:**`, a non-positive-integer queue, or a `Depends on` entry that is not a `NN.MM` id. |
| `PIECE_SIZE_EXCEEDED` | blocker | More physical lines than `maxLines`. |
| `MISSING_REQUIRED_SECTION` | blocker | A blocker-required section is absent, or a canonically-later section appears before one that must precede it. |
| `INVALID_HARNESS_PRIMITIVE` | blocker | The declared primitive is outside `primitives`. |
| `INVALID_PIECE_STATUS` | blocker | The declared status is not `todo`, `pending`, `done`, or `blocked`. |
| `MISSING_RECOMMENDED_SECTION` | warning | `## Reuse capture` is absent, whose axiom declares `severity: warning`. |

Eleven sections are recognised in one canonical order. Ten are blocker-required; `## Reuse capture` is the only warning. A `##` heading outside that list is ignored, because a piece may carry extra sections. A `##`-prefixed line inside a fenced code block is content, not a heading.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/parse.ts` owns the grammar and holds no I/O: it splits lines, reads the labelled header region before the first heading, then walks `##` headings once with a monotone cursor while tracking fenced-code regions, so a missing section and a transposed section fall out of the same pass. `src/index.ts` owns discovery: it resolves and lists directories through `ctx.fs`, keeps basenames matching `NN.MM-<kebab-slug>.md`, reads each file, and delegates to the parser.

`Directory` is the role word `docs/cookbook/adding-a-package.md` defines for a service that exposes entries and metadata for discovery or selection. Nothing registers pieces with this service, so `Registry` would misname it.

**Runtime invariant:** No companion is published. This package owns no relationship that two independent observations could report differently — every fact it returns is derived from one file's text in one pass, so a divergence would be a parser defect its own specification already covers.

## Model Experience

None, as this host-side directory registers no tool, prompt, or session event.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

- **Only ATX `##` headings are recognised** — a setext-underlined heading is not a section. This is safe only while the corpus contains none; a piece that introduces one would be validated as though the section were missing.
- **Reference-table line ranges are not checked against the cited file** — the parser confirms a `## References` section exists but does not open the paths it cites or verify the line ranges resolve. Provenance verification is a separate consumer's responsibility.
- **Parsed reference rows are not exposed** — a consumer needing the table's columns must re-parse the section body, because no current caller needs them and the `PieceRecord` stays minimal until one does.
- **`validate` reports blockers by throwing and warnings by returning** — two channels for one concept. A uniform `{ record, findings }` return would let a caller report every file's problems in one pass; the split is kept because the specification's error codes are written as failures.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The canonical section list and its severity map are module constants in `src/parse.ts`, mirroring the `axiom` blocks in `plans/AGENTS.md`: five blocker axioms and one `severity: warning` axiom. When an axiom is added, changed, or re-severity-ed there, change the constant and add the paired rejected/accepted test case; nothing else in the parser needs to move.

The heading walk is deliberately not built on the repository's shared `scripts/markdown.ts` mdast helpers. Script-plane modules cannot be imported from `packages/` under the source-plane/artifact-plane rule, so the fence-tracking scan here is a knowing duplication of about twenty lines rather than an oversight. Taking `mdast-util-from-markdown` as a package dependency is the alternative, and it becomes the right call the moment the piece format admits setext or HTML headings — measured at zero occurrences across the corpus when this was written.

</details>
