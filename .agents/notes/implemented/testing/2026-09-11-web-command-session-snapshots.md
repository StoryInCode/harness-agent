# Agent Note: Web command Session snapshots

Status: implemented

English | [中文](2026-09-11-web-command-session-snapshots.zh.md)

## Problem

Commands append durable lifecycle records without a model turn. A message-driven replay adapter cannot exercise this behavior without inventing a user message, while an in-process Web scaffold bypasses authentication, public argument decoding, and process teardown.

## Decision

The [Web command adapter](../../../../snapshots/web/commands.snapshot.ts) extracts command names and arguments from the selected canonical Session JSONL and invokes the shipped Web profile through authenticated Remote requests. Session creation uses the public controller and does not send a model input. The adapter compares persisted output only after graceful process shutdown drains storage.

This specializes the [Session corpus decision](2026-08-24-session-log-snapshot-corpus.md); that note retains ownership of normalization, fixture generations, and independent workspace expectations. Neither decision supersedes the other.

Restart scheduling belongs to the manifest because the Session cannot record a process boundary that occurs between commands. The [command-operation metadata](../../../../packages/test-support/session-snapshot/README.md) references canonical command ordinals instead of duplicating text; replay therefore has one authoritative input sequence even across process generations.

## Alternatives considered

An in-process command call cannot prove the shipped HTTP path. A synthesized user message changes the tested behavior. Reading persistence before teardown can observe a valid but incomplete write queue. A fixed or probed port introduces cross-process contention.

The `dev-loop-command-recovery` Session fixture is a recorded capture, not a fabricated transcript: each command ran through the authenticated Web RPC of a real `dsh --profile web` process on port zero, the restart ran as a graceful SIGTERM followed by a relaunch on the same private home, and the canonical JSONL is the byte normalization fixed point of that persisted log.

## Invariants

- The child binds port zero and publishes its readiness URL; temporary homes and credentials belong to that launch only.
- Authentication URLs and cookies never enter committed fixtures.
- Forced termination fails the test rather than certifying durable output.
- Commands produce no request, user-message, assistant-message, or turn records.
- Normalized Session identities are fixed points, and workspace comparison rejects an injected unexpected file.

## Consequences

Command-only scenarios can verify the public command result and canonical durable records without calling a model provider. The native Session lock addon and Web client artifacts remain launch prerequisites even when the controller does not open a browser. The empty request-header class explicitly records the absence of model prompts and schemas.
