---
description: "The Google Antigravity chat LLM adapter for DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-antigravity

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-antigravity` routes Harness LLM requests directly to the installed Google Antigravity CLI (`agy`). It discovers models dynamically from `agy models` (such as Gemini 3.8 Flash, Gemini 3.1 Pro, and Claude Sonnet/Opus with reasoning), registers them under the `antigravity` provider in `ctx.llm`, and streams reasoning and text tokens live to the user interface.

## Table of Contents

- [Use this package](#use-this-package)
- [Configuration](#configuration)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin into your Cordis composition to make Antigravity models selectable in the DeepSeek Harness model dropdown, default model configuration, and subagent settings.

```yaml
- id: llm-antigravity
  name: '@deepseek-ai/dsh-llm-antigravity'
```

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `antigravity` | Provider route key registered on `ctx.llm` |
| `command` | `agy` | Installed Antigravity CLI executable |
| `timeoutMs` | `300000` | Whole-run deadline in milliseconds |
| `disposeGraceMs` | `3000` | Process termination grace period |
| `env` | `{}` | Child environment overlays |
