---
description: "Present full specification source for explicit human approval before queuing development-loop work."
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-approval

## Summary

Ask a human to Accept, Question, or Change one specification piece. The tool displays the complete current markdown, warns about missing teaching subsections, and queues only an unchanged todo piece explicitly accepted by the human. Questions and feedback never authorize work. This fork-owned consumer uses the existing user-question interface; it does not provide a new browser panel or durable approval storage.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Mount this function plugin with `tools`, `userQuestions`, `devLoopDirectory`, `devLoopLifecycle`, and `fs` available, plus a user-question answerer. It has no configuration fields and publishes no service. Shared providers belong in the host composition; the consumer may be scoped to a session preset. A live delegated child cannot request human approval; it must report the unresolved decision to its parent.

### Review a piece

Call `present_piece_for_approval` with `{"pieceId":"00.03"}` from a live root agent. The generic interface presents two questions: `decision` contains the complete source and the single-select labels `Accept`, `Question`, and `Change`; `feedback` accepts optional independent text. It does not use the binary plan-review interface.

Only one exact decision selection with no custom decision text is accepted. Skipped, duplicate, unrecognized, or multiple choices fail with `APPROVAL_DECISION_REQUIRED`. Duplicate feedback answers also fail. Feedback is trimmed and omitted when blank. The result is a strict object such as `{"pieceId":"00.03","decision":"change","feedback":"Explain the alternatives."}`.

Accept invokes the lifecycle compare-and-set from `todo` to `pending`, returning only after that operation succeeds. Question and Change leave lifecycle state untouched. This tool never rewrites the piece file or starts implementation work itself.

### Review warnings and failures

The source is read in full and revalidated with the directory's configured parser options. Teaching checks recognize markdown subheadings and bold list labels inside `## Teach me while you build`, outside fenced code. Each missing label appends `Review warning: missing teaching subsection: <name>.`, where `<name>` is `Approaches considered` or `Prior art inspected`; original source remains intact.

Missing pieces report `PIECE_NOT_FOUND`; malformed pieces retain their parser diagnosis. Non-todo lifecycle status reports `PIECE_NOT_APPROVABLE`. Changed source versions or a mismatched parsed id report `PIECE_REVIEW_STALE` and require a fresh presentation. A competing lifecycle transition fails the acceptance rather than producing a successful result.

A missing caller reports `CALLER_NOT_LIVE`. The question service checks that a supplied caller is the exact live root and rejects owned children with `DELEGATED_CALLER`; it reports `NO_PROVIDER` when no answerer claims the request. Provider failures and cancellation return tool errors without approval.

### Cancellation and disposal

The operation combines the tool-call signal with its plugin lifetime, forwarding it to directory lookup, filesystem calls, the human wait, and the fifth lifecycle transition argument. Cancellation is checked after awaited reads and answers and immediately before transition. Plugin disposal removes the tool, aborts pending operations, and waits for their providers to settle; a late Accept cannot authorize work from an unloaded plugin. Providers must honor cancellation and settle owned work rather than abandon it.

## Understand the implementation

[Source](src/index.ts) owns source freshness checks, teaching-detail assembly, exact decision parsing, tool registration, and pending-operation ownership. [Result types](src/types.ts) define the model-visible decision fields. Filesystem versions bracket the displayed read and are checked again before acceptance; the parsed source id must equal the requested id. These checks do not make filesystem observation and lifecycle mutation atomic.

Cordis owns registration cleanup, the question service owns live-root validation and answerer dispatch, and the lifecycle owns status comparison. The pure tool renderer serializes only the canonical result, never live runtime objects. No invariant companion is published: this consumer has no independent status projection to reconcile; it checks the reviewed version within the operation and delegates status races to the lifecycle writer.

## Model Experience

### Tool schema

#### What the model sees

The model sees `present_piece_for_approval` with one required `pieceId` string. The generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-dev-loop-approval) owns the complete schema. Visibility follows the mounting scope; no additional system prompt is registered.

#### Token effect

A fixed schema cost applies to each request where this tool is visible.

#### KV Cache effect

The schema is prefix-stable while its definition and visibility remain unchanged. Changing the plugin or tool restrictions can change that request prefix; provider cache retention is outside this package's control.

### Tool-call history and result

#### What the model sees

The model retains its piece-id argument and receives compact JSON with `pieceId`, lowercase `decision`, and optional trimmed `feedback`, or a tool error. Full source and review warnings are user-question detail, not added to model context by this tool. The model must decide how to address Question or Change before requesting another review.

#### Token effect

Arguments, feedback, and result or error text add data-dependent history tokens. Waiting adds no model request; the full piece is not copied into the result.

#### KV Cache effect

The tool result appends to the conversation rather than replacing earlier messages. It preserves the prior reusable prefix; feedback size affects only newly appended content.

## Known Limitations and Deferred Work

- **Approval is not durable:** acceptance updates lifecycle memory and emits its announcement. Revision-bound evidence and restart reconciliation belong to 00.12; this tool does not automatically re-present interrupted reviews.
- **Freshness is not a cross-service transaction:** a final file-version check narrows the review race but cannot prevent an external edit between that check and lifecycle commit.
- **Generic UI constraints:** the decision question can offer custom text, but this tool rejects it as authorization. Missing teaching subsections warn rather than veto; broader verification belongs to its policy consumers.
- **Composition and demo are separate:** this fork-owned package does not install the 00.14 dev-loop preset. A mounted Web demonstration and complete-loop approval evidence are not established by package tests.
- **Human waits depend on providers:** missing answerers fail, and an answerer that does not settle after cancellation can delay disposal. No independent deadline or detached wait is supplied here.

### Dev Note

The [decision record](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-approval.md) explains why this task-planning choice uses questions without becoming a permission grant.
