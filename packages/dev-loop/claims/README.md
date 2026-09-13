---
description: "Verify approved-piece premises with revision-bound, attributed Research evidence and fail-closed admission."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-claims

English | [中文](README.zh.md)

## Summary

Verify an approved piece’s explicit claims and retain the Research findings with their source identities. Recheck those identities before accepting the report for authoring. A completed report records an observation, not approval or independent proof that its claims are true.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The host service exposes `ctx.devLoopClaims`; the separate `./tool` plugin exposes `dev_loop_verify_claims` in an agent scope. Both mount as Cordis plugins, not installable profile bundles. The host requires agents, directory, roles, references, filesystem, and storage-domain services; the tool additionally requires the tools registry. See [architecture](../../../docs/architecture.md) for composition ownership.

All [configuration fields](src/types.ts) are required; there are no defaults.

| Field | Default | Meaning |
|---|---|---|
| `repositoryRoot` | required | Repository containing the piece and local evidence. |
| `maxPieceBytes` | required | Complete decoded UTF-8 source limit. |
| `maxClaims` | required | Inventory row limit and combined Research finding/candidate limit. |
| `maxEvidenceBytes` | required | Serialized flattened evidence-array limit only; local file digests stream independently of this byte budget. |
| `maxReportBytes` | required | Complete retained report limit, including provenance. |
| `verificationTimeoutMs` | required | Verification deadline in milliseconds. |

Numeric fields must be positive safe integers. Limits reject complete values rather than truncate them. No runnable deployment recipe is asserted here; composition verification remains a test-owner responsibility.

### Observe the behavior

From the repository root, run `pnpm exec vitest run packages/dev-loop/claims/tests --testTimeout=30000`. The intended observable outcome is supported findings with actual Research delegation/session provenance, plus explicit admission blockers for unresolved or stale evidence. This command is the behavioral verification path, not a claim that the full suite is GREEN; the root-teardown blocker below remains unresolved.

### Source and report semantics

The piece must contain exactly one `Resources and proof` section: one populated GFM table with `Claim`, `Citation`, `How established`, and `Checked against` columns in that order, or the plain sentence `No load-bearing claims.`. Every row has four nonempty cells. Stable claim IDs include the piece ID, row ordinal, and decoded cell text. Piece and local-evidence digests require byte-faithful UTF-8: the filesystem must report a known size equal to the complete decoded text’s re-encoded byte length. The filesystem owns fatal decoding; unknown sizes and stripped initial BOMs refuse raw identity rather than hash normalized input. Whitespace is not normalized.

`verifyPieceClaims` requires the exact live initiator, reads the piece through the directory and filesystem services, checks references, and delegates full-source assessment to Research. Research must return one strict JSON object with exactly one unchanged finding per inventory row and an assessment of omitted premises. The owner adds actual delegation/session/preset attribution; Research cannot supply that provenance. Evidence qualifications downgrade reported `supported` findings to `unverified`.

`getReport` returns a detached latest matching terminal observation, including failures, without checking whether source has changed. `requireAdmissible` separately requires current source and evidence identities, valid references without contradicted attribution, complete inventory coverage, no additional load-bearing claims, no contradicted findings, and supported load-bearing findings without limitations. A nonempty inventory requires no coverage limitations; an empty inventory requires a recorded coverage explanation. The report and its sole settled, completed, quiescent Research delegation must have no top-level limitations. Admission reparses that delegation’s actual outcome and compares coverage, additional claims, and finding fields with the retained report, allowing only owner-added evidence downgrades and limitations.

Missing, incomplete, superseded, or unresolved evidence rejects with `CLAIM_VERIFICATION_OUTSTANDING`; changed source or checked evidence identity rejects with `CLAIM_REPORT_STALE`. Callers must resolve the reported limitations and verify the current piece again, rather than treat a retained report as authorization. Neither method rewrites the approved source or grants an exception.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [service](src/index.ts) binds the [Markdown inventory](src/inventory.ts), [strict Research parser](src/research.ts), and [evidence identity checks](src/evidence.ts). The [durable domain](src/records.ts) holds the latest attempt and terminal report keyed by piece ID. Intent is committed before delegation; a missing matching terminal report remains unresolved and cannot expose an older report as current. An oversized terminal report leaves intent unresolved. Failures before intent is committed do not replace the previous attempt.

One verification per piece runs at a time in this service instance. Cancellation combines caller, deadline, and service lifetimes; the service disposer waits for admitted work before its own domain-close call. Root teardown has an unresolved dependency-API ordering blocker: the storage-domain provider can close the Claims domain while admitted model cleanup is still held. Reads return detached records. Admission rechecks the latest report identity after its asynchronous checks.

There is no `./invariant` companion: the durable domain is authoritative, not mirrored in a claims-owned cache. Admission compares independently changing files, references, and role records at the point of use. File drift between verification and admission is expected and rejected there; unchanged source is not an always-held runtime invariant. The [decision note](../../../.agents/notes/implemented/architecture/2026-09-13-revision-bound-claims-admission.md) owns the rationale.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Scoped verification tool and result

#### What the model sees

The [tool](src/tool.ts) accepts only `pieceId` and describes its evidence as: “Findings are reported by Research, not your direct inspection; a report is not admission approval.” Its JSON text result contains the full report and `Resources and proof` rows with claim text, evidence locators, checked digests/versions, and `Reported by Research delegation` attribution including the actual session and optional preset. The package does not add a system-prompt section.

#### Token effect

The scoped schema contributes fixed request tokens. Each verification result contributes data-dependent report and proof-row tokens to tool history. `maxReportBytes` bounds the retained report, not the complete tool-result wrapper, which repeats finding data.

#### KV Cache effect

Tool results append to conversation history; they do not replace earlier messages. Mounting or removing the scoped tool changes the tool-schema prefix. Provider cache availability and eviction are outside this package’s guarantees.

### Delegated Research assessment

#### What the model sees

Research receives the full source, inventory, report ID, strict JSON requirements, and the decision that rests on the claims. The assignment requires unchanged claim IDs/text, omitted-premise assessment, and no source rewriting. It also states bounded negative scope, explicit export digests, and measurement log/metadata requirements with historical environment/time scope. [Assignment construction](src/index.ts) owns the complete wording; the roles service owns child execution and delivery.

#### Token effect

Delegation adds independent Research request and response tokens. Source bytes and claim count are bounded; this package does not impose a model token budget. The terminal Research response is validated as a whole JSON value, not extracted from surrounding prose or fences.

#### KV Cache effect

Research runs through a separate delegation, not a replacement of the caller’s history. Source, inventory, and report-ID changes alter that assignment; child-prefix reuse depends on the roles provider and model provider.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Admission is deliberately narrower than semantic truth verification.

- **Measurement support is historical and reported.** Optional strict measurement metadata records `command`, a nonempty `environment`, nonnegative safe-integer `recordedAt`, `result`, and `reportedExecution`. Supported measurement evidence requires `executed` plus a local log locator and matching digest; absent metadata or `not-executed` remains unverified. Claims never executes the command or proves reported execution truthful. Support covers only the recorded environment/time, not current performance; seeded test logs are not actual benchmark runs.
- **Negative support is bounded.** A reported zero-result search can support only its recorded corpus and query. Every explicit export entry point must have its own content-manifest digest; verification and admission reread the locator and all manifest files. These checks neither rerun the search nor prove universal absence or a machine-checkable relation to the decision’s full scope. Broader required absence must remain unverified in Research’s assessment.
- **Raw identity requires backend byte-size evidence.** Unknown size, stripped BOMs, and decoding failures prevent piece or local-evidence identity checks. Size equality is not a filesystem snapshot or a lock against concurrent writers.
- **Research is attributed evidence, not independent inspection.** Local checks compare content digests; dependency checks require version/symbol fields and manifest, lockfile, and entry-point identities, not an independent export/version interpretation. External evidence is checked for URL/version/digest fields and obvious mutable URL segments, not fetched or independently certified immutable.
- **Inventory completeness relies on Research assessment.** The parser inventories the explicit proof table, not every premise in arbitrary prose. Research classifies load-bearing findings and reports omissions; strict JSON validation does not prove those judgments.
- **Reports are latest observations, not an audit history or filesystem transaction.** The domain retains the latest attempt/report per piece. Admission samples current files and role records; it does not lock external writers. Per-piece exclusion is process-local.
- **Verification evidence is not a GREEN claim.** Focused implementation tests are still being evaluated; this reference does not assert passing behavioral or real-composition coverage.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Non-authoritative: source coverage remains pending, and root-disposal ordering depends on a separate dependency prerequisite. No full GREEN result is asserted.

</details>
