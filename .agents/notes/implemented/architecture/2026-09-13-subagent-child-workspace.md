# Agent Note: Select a subagent workspace before child creation

Status: implemented

## Problem

A delegated task can need a different checkout from its parent. Changing one shell command's directory leaves the child's recorded workspace, setup, model instructions, and other workspace readers pointing elsewhere. Mutating or substituting the parent also corrupts lineage and concurrent siblings.

## Decision

The [subagent start request](../../../../packages/subagent/subagent/src/types.ts) carries optional absolute `cwd`. Existing provider request resolution selects explicit request cwd before configured cwd and parent fallback. Invalid explicit values reject without fallback. Omission retains each provider's existing behavior, including an undefined in-process workspace. Validation belongs to the execution-world owner: in-process checks path form without probing the host filesystem; external local adapters retain accessible-directory validation.

The [child metadata helper](../../../../packages/subagent/subagent/src/child-agent.ts) receives the selected workspace before setup and publication. Spawn and fork use their shared driver; continuable creation records the same choice. Cold resume reads the existing persisted header rather than selecting again. ACP, DSH SDK, Codex, Claude Code, and Antigravity pass it to their existing process, SDK, or wire request. No new Agent-loop behavior, Session format, capability flag, or model-tool parameter is introduced.

## Alternatives considered

Prompt instructions, per-command working directories, filesystem options, and tool wrappers govern individual operations rather than child creation metadata. Persona and tool-filter options govern composition and tool visibility; Agent route options select models, not workspaces. Optional inherited presets likewise do not supply a per-request creation directory. Post-creation events arrive after readers can observe the wrong workspace.

The Agent factory already accepts workspace metadata, but providers own that unpublished creation call. An adjacent provider would duplicate composition inheritance, policy, lineage, structured output, and joined cleanup. A wrapper around the existing start method has no additional creation input. Static provider configuration cannot distinguish simultaneous piece assignments. Therefore the existing request-to-provider implementation owns the small optional input; a global side map or fake parent is not a substitute.

## Consequences

The [native-provider decision](../feature/2026-08-04-claude-code-and-codex-subagent-backends.md) continues to own product process and transport behavior; workspace selection supplies its execution input. The field is a baseline obligation for current providers. It does not select a permission mode, but workspace-relative policy derives its roots from this metadata; choosing a directory alone does not confine execution. Existing tools may continue omitting it. Role dispatch can pass a validated worktree assignment without changing parent identity. The [worktree ownership decision](../feature/2026-09-13-development-loop-worktree.md) remains separate: selecting a checkout does not authorize deleting it.

## Verification

The [Loader cases](../../../../packages/subagent/subagent-in-process-driver/tests/cwd-loader-composition.spec.ts) observe actual spawn/fork creation metadata and model input, distinct sibling workspaces, and unchanged parent state. [Continuable cases](../../../../packages/subagent/subagent/tests/continuation-cwd.spec.ts) reopen persisted children and verify workspace retention. Each external provider's owner-local request-cwd suite observes its actual dispatch input, including omission, invalid values, and a valid override when parent cwd is absent.
