# Agent Note: explicit development-loop decisions over current source

Status: implemented

English | [中文](2026-09-13-development-loop-approval.zh.md)

## Problem

A specification summary can omit the details a person needs to authorize work. Free-text feedback is not an unambiguous decision, and the file can change while the person considers it. Marking a piece pending must distinguish explicit acceptance from questions, revisions, and stale observations.

## Decision

The [approval tool](../../../../packages/dev-loop/approval/README.md) uses the existing user-question service to present the complete current specification, with missing-teaching warnings appended rather than substituted for source. It requests one exact choice and separate optional feedback. Only Accept attempts the lifecycle's todo-to-pending compare-and-set; Question and Change leave status untouched.

The consumer requires a calling Agent and supplies that exact object to the user-question service, which enforces live-root ownership. Filesystem versions bracket the source read and are checked again before acceptance. Directory validation supplies the configured grammar and confirms the requested identity. These checks detect observed revision changes; they do not create an atomic transaction across filesystem state and lifecycle memory.

Each invocation combines caller cancellation with the plugin lifetime. Disposal closes admission, aborts active operations, and awaits their settlement. The tool returns a canonical JSON result only after its accepted transition settles; its renderer does not read services or repeat the human prompt.

This is a task-planning decision, not a permission grant. The [permission approval decision](2026-07-06-approval-seam.md) remains authoritative for action permissions, sandbox escalation, and their audit events. The scoped active-note search found no superseded development-loop decision; that permission note remains independently useful and unchanged.

## Alternatives considered

**Infer acceptance from feedback.** Rejected because questions and revision instructions can contain affirmative language without selecting Accept. Separate choice and feedback fields preserve that distinction.

**Present the cached summary.** Rejected because a summary cannot establish which complete source the person considered. Current source and version observations expose changes during the interaction.

**Use the permission approval service.** Rejected for this task-planning interaction: allow/reject permission outcomes do not represent Question, Change, and independent feedback. The tool does not use a generic question to grant permission for a privileged action.

**Store a durable approval grant here.** Deferred to the loop persistence and completion-policy owners. A local pending status is not revision-bound authorization that survives restart or later source edits.

## Consequences

The behavior tests exercise explicit choices, malformed answers, caller rejection, source changes, lifecycle conflicts, cancellation, and disposal through real services. The missing-file regression distinguishes disappearance after discovery from an initially absent piece. Filesystem version checks and lifecycle compare-and-set protect different observations; neither substitutes for the other.

The tool does not enforce policy on every direct lifecycle caller, persist an approval grant, dispatch workers, or mount a user interface. The composed loop must supply those owners. Subsequent file edits and process restarts require separate revision-binding and reconciliation rules; a successful local approval does not prove those rules exist.
