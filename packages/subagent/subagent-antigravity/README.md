---
description: "The installed Antigravity CLI subagent bundle for users configuring fresh, unattended delegations and maintainers checking process lifecycle behavior."
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-antigravity

English | [中文](README.zh.md)

## Summary

Delegate a self-contained text task to the installed Antigravity CLI in the selected workspace. This optional Profile Bundle returns one final answer or a safe failure diagnostic and leaves authentication and permissions with the native product. Each task starts a fresh process and conversation; no parent history is copied. Install the Bundle for Host availability and separately expose a delegation tool in an Agent Preset.

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

The Host needs an installed, authenticated `agy` CLI that supports the documented [headless streaming input](https://antigravity.google/docs/cli/headless.md). This package does not install that executable, sign in, read credentials, or proxy model requests.

### Installing the Bundle

Add `@deepseek-ai/dsh-subagent-antigravity` through the [Profile plugin installer](../../../docs/architecture.md). The [patch](cordis.patch.yml) contributes only the dormant Host provider named `antigravity`; mounting starts no CLI process. The Agent Preset separately binds `dsh-tool-subagent` with `provider: antigravity`, a unique `toolName`, `backgroundMode: one-shot`, and `maxDepth: provider-managed`. Keep the ordinary Job registry and controls for background calls. Removing the Bundle withdraws Host availability without deleting native Antigravity data.

### Configuration

Each Host provider row accepts these deployment-owned fields. Native permission settings remain authoritative; the provider never passes `--dangerously-skip-permissions`.

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `antigravity` | Unique, non-empty registry name |
| `command` | `agy` | Installed executable name or path; no shell interpolation |
| `model` | native settings | Optional non-empty model slug |
| `env` | `{}` | Explicit environment entries layered after subprocess credential scrubbing |
| `timeoutMs` | `300000` | Positive whole-run deadline in milliseconds, at most `2147483647` |
| `maxOutputBytes` | `1048576` | Positive integer UTF-8 retention cap per stream; stdout overflow fails closed |
| `disposeGraceMs` | `3000` | Positive managed-range termination grace in milliseconds, at most `2147483647` |

The child uses `request.cwd` when supplied, otherwise the parent Session cwd. The selected directory must be absolute and accessible; an invalid explicit value rejects without fallback before spawn. Omission still requires a usable parent workspace. The subprocess service scrubs credential-shaped and managed `DSH_*` ambient variables before applying `env`; explicit entries deliberately opt in. Ordinary native home, project settings, and cached authentication remain accessible to the CLI.

### Results and failures

The provider sends one NDJSON user message through stdin and immediately closes input. It accepts exactly one nested `result` with `status: SUCCESS`, nonblank `response`, and no `error` field, only after exit code zero, no signal, no timeout, complete stdout, and managed-tree cleanup. Malformed output, missing or duplicate results, unsuccessful status, output overflow, and process failures produce fixed diagnostics without copying stderr or raw error text.

Cancellation returns `aborted`; timeout returns `error` even if the child handles termination and exits zero. Both await the subprocess provider's managed-range exit. Disposal is idempotent and awaits the same cleanup. Observation failures are reported rather than treated as successful teardown. No workspace changes are rolled back.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [plugin entry](src/index.ts) validates configuration and registers one reversible provider contribution. The [run implementation](src/run.ts) sends documented streaming input rather than placing the prompt in process arguments. It uses shared subagent settlement and run-handle helpers, the shared deadline library, and the subprocess service's bounded collection and managed-range ownership. No SDK, private OAuth flow, proxy, or independent process manager is involved.

Only final text reaches the parent. Intermediate events and native metadata are parsed only enough to recognize the terminal envelope; stderr stays in bounded subprocess memory without spill or logging. A fresh CLI process has its own conversation history, and the provider never supplies continuation or resume flags.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read the [subagent service](../subagent/README.md) for delegation semantics, the [subprocess service](../../subprocess/subprocess/README.md) for environment and process ownership, the [delegation decision](../../../.agents/notes/implemented/feature/2026-09-13-antigravity-native-delegation.md), and the [official headless reference](https://antigravity.google/docs/cli/headless.md) for native input, results, and permission behavior.

-----

<a id="model-experience"></a>
## Model Experience

### Child request

#### What the model sees

The Antigravity child receives only the standalone text task in a fresh conversation, with native settings and tools in the selected workspace. The provider advertises no support for parent agent options, output schemas, depth enforcement, tool filters, or personas; the shared service rejects requests requiring them.

#### Token effect

The child consumes its own model context and inference tokens. Only its final answer or a safe failure diagnostic enters the parent context through the delegation tool or Job result.

#### KV Cache effect

Native child cache reuse is independent of the parent's prefix. A fresh process does not copy the parent's history or cache.

### Parent results, indirectly

#### What the model sees

The generic `dsh-tool-subagent` tool returns the final text or a failed stop reason with safe diagnostic facts. Background calls use ordinary Job acknowledgements, completion notices, collection, and cancellation. Native reasoning, tool traffic, usage, conversation identifiers, stderr, and workspace diffs are not copied into the parent Session.

#### Token effect

The parent receives the ordinary tool or Job result text. This provider adds no model-facing tool schema by itself.

#### KV Cache effect

Tool and Job results append after the reusable parent prefix; this provider does not rewrite earlier parent messages.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These constraints define the provider's deployment and isolation limits.

- The installed CLI version and authentication are deployment responsibilities. Native settings are not hermetic: workspace writes may be auto-allowed, and a soft-denied tool can still produce native `SUCCESS`.
- This provider does not impose the parent's filesystem sandbox on native tools or claim that successful text proves requested side effects occurred.
- Native conversation files may persist; the provider never resumes them. There is no continuation, interactive approval bridge, progress delivery, structured-output enforcement, or child usage accounting.
- Output limits cap retained bytes, not total bytes the process can emit before its deadline.

**Runtime invariant:** No companion is published. Registration and run pairing belong to the shared subagent service; managed process ownership belongs to the subprocess service.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Native CLI authentication and inference smoke verification is separate from the package's keyless protocol and subprocess tests.

</details>
