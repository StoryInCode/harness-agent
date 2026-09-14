---
description: "面向 DeepSeek Harness 的 Google Antigravity 聊天模型适配器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-antigravity

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-llm-antigravity` 将 Harness LLM 请求直接路由到已安装的 Google Antigravity CLI (`agy`)。它从 `agy models` 动态发现模型（例如支持思考的 Gemini 3.8 Flash、Gemini 3.1 Pro 以及 Claude Sonnet/Opus），并在 `ctx.llm` 下将它们注册为 `antigravity` 提供方，同时向用户界面实时流式传输推理和文本 token。

## 目录

- [使用此包](#使用此包)
- [配置说明](#配置说明)

-----

<a id="使用此包"></a>
## 使用此包

将此插件挂载到您的 Cordis 编排中，使 Antigravity 模型在 DeepSeek Harness 模型下拉菜单、默认模型配置和 subagent 设置中可选。

```yaml
- id: llm-antigravity
  name: '@deepseek-ai/dsh-llm-antigravity'
```

<a id="配置说明"></a>
## 配置说明

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `antigravity` | 注册在 `ctx.llm` 上的提供方路由名称 |
| `command` | `agy` | 已安装的 Antigravity CLI 可执行文件 |
| `timeoutMs` | `300000` | 单次运行截止时间（毫秒） |
| `disposeGraceMs` | `3000` | 进程终止宽限期（毫秒） |
| `env` | `{}` | 子进程环境变量覆盖 |
