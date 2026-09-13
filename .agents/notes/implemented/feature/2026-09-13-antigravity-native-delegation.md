# Agent Note: Antigravity native delegation

Status: implemented

English | [中文](2026-09-13-antigravity-native-delegation.zh.md)

## Problem

An Antigravity subscription is not a Google Cloud Vertex credential. Treating Vertex Application Default Credentials as subscription authentication offers the wrong billing route and cannot reuse an installed `agy` login. Antigravity's documented headless interface runs a complete agent with its own tools and history, not an interchangeable LLM transport.

## Decision

The optional [Antigravity provider](../../../../packages/subagent/subagent-antigravity/README.md) delegates one standalone task to the installed CLI. It follows the [product-subagent ownership rules](2026-08-04-claude-code-and-codex-subagent-backends.md): the Host registers the provider, an independently selected user preset grants the tool, and the parent receives a final result rather than another provider in the model picker. The existing Claude Code and Codex decision remains the authority for those integrations.

Authentication and native tool permissions remain owned by `agy`. DSH neither extracts keyring tokens nor requests unofficial subscription OAuth. A configured executable and optional model select the native product; defaults do not bypass permission checks. A single NDJSON stdin message avoids task text in process arguments. Bounded stdout supplies exactly one successful result, accepted only after clean exit and managed process-tree cleanup. Native intermediate events and stderr do not enter the parent transcript.

## Alternatives considered

A raw subscription adapter would keep DSH's tool loop but requires unofficial OAuth access, which [Antigravity's terms](https://antigravity.google/terms) explicitly restrict. Native delegation preserves the installed CLI's authentication without implementing that protocol. Vertex is a separate Google Cloud product and cannot serve as an Antigravity subscription fallback.

## Consequences

The parent retains its selected model. Antigravity receives only the delegated task and the parent workspace, not DSH history, tools, persona, or recursion guarantees. Its native permissions and settings govern workspace effects; cancellation does not roll back completed edits. Native permission denial may still produce an explanatory successful response, which is not proof that the requested task was completed.

The dependency is an installed CLI, not a bundled SDK. Compatibility follows the documented `stream-json` protocol and requires a working native login. Direct subscription-model access would need a separately reviewed provider and authorization design; rebranding Vertex or disguising the CLI's agent loop as an LLM is not an alternative.
