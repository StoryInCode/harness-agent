---
description: "Delegate bounded specialist assignments in retained worktrees and retrieve durable, attributed reports."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-roles

English | [中文](README.zh.md)

## Summary

Delegate Research, Test Writer, Implementer, or Utility work without losing the files needed by the next specialist. Each request is saved before admission, and each terminal receipt records the actual child, retained assignment, optional preset, and reported evidence after cleanup. History survives Host restart. A report is attributed evidence, not proof that its claims were independently verified.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the default service once in the Host after the configured subagent providers are registered, alongside Agents, Subagents, Queue, Worktree, and a durable storage-domain backend. Mount the named-export `./tool` consumer in the Brain's scoped composition, not through the shared Host Loader's root entry group. The [fixture](tests/harness.ts) supplies private Git repositories, JSON storage, actual providers, and scripted model responses; no shipped profile mounts this package.

| Owner | Required configuration | Meaning |
|---|---|---|
| Host | `roles` | All four roles, each with a nonempty provider, persona, and explicit inherited-tool filter. |
| Host | `maxBriefBytes` | Positive safe-integer UTF-8 limit for complete brief JSON. |
| Host | `maxOutcomeBytes` | Positive safe-integer limit for a complete terminal record, including assignment and provenance. |
| Scoped consumer | `maxToolOutputBytes` | Positive safe-integer limit for the complete rendered content array; must fit fixed overflow errors. |
| Scoped consumer | `maxHistoryRecords` | Positive safe-integer maximum count per model history receipt. |

A role may also set `agentOptions` and `maxDepth` when its provider supports them. Provider names select the subagent registry, not an LLM route. Missing providers and unsupported persona/filter/options capabilities fail mount; the runtime checks capabilities again at start. The Host deployment must choose capabilities appropriate to each role; a persona is not enforcement.

The scoped Brain uses `dev_loop_delegate` for an assignment and `dev_loop_delegations` for piece history. Successful native receipts contain serialized JSON text. Delegation returns one settled record; history returns the complete chronological array, including unresolved requested rows. Neither tool accepts provider, cwd, preset, parent, persona, or filter authority from the model.

Oversized briefs reject before persistence or startup. Non-text or oversized reports become failed observations with explicit limitations rather than clipped completions. Model-output overflow names the durable delegation id; history overflow returns no partial array. If required metadata itself cannot fit the terminal budget, terminal recording rejects explicitly and the prior requested row stays unresolved. A persistence failure is never reported as successful delegation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Ownership, ordering, and observed evidence</summary>

The [service](src/index.ts) captures the exact live initiator before awaiting, persists intent in the single `dev_loop_roles` domain, and restores that same initiator around Queue admission. Admitted dispatch obtains a retained assignment and passes its directory, persona, and filter through the public subagent request. It captures only the returned id and actual optional header preset before returning the actual lease to Queue. Queue owns result observation and disposal; Roles owns terminal persistence and joins its operations before closing the domain. Roles never retires an assignment.

The [record parser](src/records.ts) validates authoritative storage with a Zod discriminated union. History reads detached records from the domain rather than maintaining a second cache. A requested row records intent, not evidence of an active child; a crash between storage and startup requires reconciliation outside this package. No runtime invariant companion is published because Roles has no independently maintained observation to compare with its authoritative records.

A rejected `SubagentRuntime.start` without a returned lease leaves cleanup `unproven`: Queue has no child lease to join. After a lease is returned, successful awaited ticket cancellation proves cleanup even if the result rejected. A cancellation rejection leaves cleanup `unproven`, and uncertain cleanup always records `failed`, never `aborted` or `completed`. Roles preserves only the failure observable through the public runtime and Queue; it does not infer hidden startup-disposal failures.

The [delegation decision](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-roles.md) owns attribution and persistence rationale. Queue and Worktree retain their independent lifecycle responsibilities.

</details>

<a id="model-experience"></a>
## Model Experience

### Scoped Brain tool schemas and receipts

#### What the model sees

The [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-dev-loop-roles) owns the schemas, which expose only the brief and piece-history inputs. Receipts contain actual ids, assignment metadata, complete retained outcome, limitations, and `reported` provenance. An omitted preset means no preset was recorded, not a guessed parent composition. Requested history remains unresolved. Stable history overflow text is `Delegation history overflow: complete history exceeds the record or byte limit; no partial history returned.`

#### Token effect

Schemas add fixed tokens while the scoped consumer is mounted. Each result appends data-dependent tokens to Brain history, bounded by the consumer's complete rendered-byte and record-count limits. Byte budgets are not token-count guarantees; durable storage is not automatically pruned.

#### KV Cache effect

Tool receipts grow history append-only. Stable schemas can preserve an already-reusable prefix; mounting, removing, or changing tool descriptions changes schema input. This package does not promise provider cache availability or eviction behavior.

### Child assignment and configured persona

#### What the model sees

The child receives role, piece, assignment, rationale, optional verification details, and the Host-configured persona. The assigned directory reaches the immutable child header and existing model cwd variable. The assignment ends with the following package-owned instruction.

##### Report attribution instruction

```markdown
Report the evidence you inspected, cite sources, and state limitations. Your report is attributed to your role, not direct inspection by the parent.
```

#### Token effect

Each child makes an independent model request. Assignment and persona tokens depend on the request and Host policy. The complete model brief input is byte-bounded, but this does not bound inherited context, configured persona, provider buffering, or the child's token usage.

#### KV Cache effect

Each child's assignment is independent of the Brain's request history. Role policy, assigned cwd, actual inherited composition, and assignment text can change the child request prefix. Roles does not rewrite earlier Brain messages.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Research requires a nonempty explicit `toolFilter.allow` list; optional `deny` entries subtract from it. Other roles require explicit `allow` and/or `deny`. This configuration check does not certify that allowed tools are read-only. The provider applies the configured filter to inherited schemas and executor dispatch. This does not constrain trusted plugins, direct service calls, or filesystem effects of an allowed shell; a persona and worktree allocation are not confinement.
- No arbitrary preset selector, provider degradation, cross-repository routing, automatic history deletion, crash reconciliation, transfer, or assignment retirement is provided.
- Startup, durable storage, and worktree allocation are separate operations. Requested crash residue and explicit terminal-persistence failures require inspection rather than automatic retry. Cleanup errors remain unproven when Queue cannot establish quiescence.
- Outcome limits include mandatory metadata. A configuration too small for those facts cannot retain a bounded terminal record and fails explicitly instead of discarding identity or inventing completion.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — non-authoritative</summary>

The [inert RED baseline](tests/RED.md), [domain amendment](tests/domain-amendment.md), and [coverage-additions report](tests/COVERAGE-ADDITIONS.md) preserve historical evidence, not current-source acceptance. The coverage report records 47 passing cases and a failed strict per-file coverage gate; its source hashes delimit that observation. Actual-provider cleanup-failure integration remains a named gap in that report. This documentation update claims no new runtime, snapshot, or coverage result.

</details>
