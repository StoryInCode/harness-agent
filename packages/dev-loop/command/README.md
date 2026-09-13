---
description: "Inspect development-loop pieces and explicitly approve the reviewed source digest through human commands."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-command

English | [中文](README.zh.md)

## Summary

Inspect pieces and queue observations without starting a model turn. Review full source with its SHA-256 digest, then explicitly accept that revision or block pending work with a reason. Mutations require the exact live root Agent. Lifecycle owns status changes and configured durability; these commands do not dispatch workers or repair recovery anomalies.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this named-export function plugin with `commands`, `agents`, `devLoopDirectory`, `devLoopLifecycle`, `devLoopQueue`, and `fs`. It registers `dev-loop`, not a model tool. Registration is removed on disposal.

### Configuration

Both byte budgets are required safe integers; there are no deployment defaults.

| Field | Default | Meaning |
|---|---|---|
| `maxInputBytes` | Required | Positive UTF-8 raw-input limit |
| `maxOutputBytes` | Required | UTF-8 limit for the complete serialized CommandResult; must fit the overflow refusal |

### Inspection and decisions

The grammar accepts `help`, `status`, `list`, `queue`, `show <id>`, `approve <id> <sha256>`, and `reject <id> <reason...>`. `show` includes the complete validated source and its raw SHA-256 digest. Approval requires the matching current digest and todo status; rejection requires pending status and a nonempty reason. Approval requests `todo → pending`; rejection requests `pending → blocked`. Neither creates a Queue callback.

The mutation caller must be the exact live root Agent registered in the host, not a copied identity or delegated child. Approval forwards the actual command ID, receiving Session ID, and reviewed source/version to Lifecycle in both memory and required modes. Required-mode history is owned by [persistence](../persistence/README.md), not by this consumer. A stale digest requires another source review.

Input and output limits reject oversized values instead of truncating source, reasons, or result metadata. Cancellation and unexpected defects reject the command operation; expected domain failures produce an error result. [Command parsing](src/input.ts) owns exact grammar and refusal text.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[The consumer](src/index.ts) validates command input and root ownership, then delegates status mutation to the sole Lifecycle writer. [Source review](src/review.ts) binds complete validated UTF-8 source to filesystem observations; missing or mismatched byte counts cannot establish a reviewed revision. [Inspection](src/observations.ts) reads corpus and queue observations without restoring execution.

The shared command runtime records `command/run` and `command/done` with the actual invocation identity. No invariant companion is published: this consumer retains no independent status projection; source freshness and root ownership are checked during the operation, while Lifecycle owns compare-and-set admission.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Human command results

#### What the model sees

The `dev-loop` human command registers no model tool or prompt and does not inject its result into model context.

#### Token effect

Command results add no model-input tokens through this package.

#### KV Cache effect

Command execution does not alter the model request prefix or start a model turn.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

These commands inspect and request decisions; they do not implement the autonomous loop.

- **Durability depends on Lifecycle:** memory mode remains nondurable; required mode needs the persistence provider and activation ordering.
- **No recovery mutation:** inspect and acknowledge recovery anomalies through the separate [recovery consumer](../persistence/README.md#use-this-package); neither consumer offers repair or reopening.
- **No worker restoration:** status and queue output do not recreate callbacks, Agents, or work after restart.
- **No atomic review transaction:** source observations and lifecycle admission are separate operations; configured Lifecycle durability supplies its own stale-source check.

<a id="dev-note"></a>
### Dev Note

Full operation and recorded-session validation belongs to the integration owner. No passing-suite claim is made here.
