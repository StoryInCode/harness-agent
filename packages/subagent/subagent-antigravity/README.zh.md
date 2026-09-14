---
description: "基于已安装 Antigravity CLI 的子智能体 Bundle，供用户配置全新无人值守委派，并供维护者检查进程生命周期行为。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-subagent-antigravity

[English](README.md) | 中文

## 概述

将自包含的文本任务委派给已安装的 Antigravity CLI，在所选工作区中执行。这个可选 Profile Bundle 返回一份最终答案或安全的失败诊断，认证与权限仍由原生产品负责。每个任务启动全新进程和对话，不复制父会话历史。安装 Bundle 以提供 Host 可用性，再单独在 Agent Preset 中暴露委派工具。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Host 需要已安装、已认证且支持文档所述[无头流式输入](https://antigravity.google/docs/cli/headless.md)的 `agy` CLI。本包不安装该可执行文件，不登录，不读取凭据，也不代理模型请求。

### 安装 Bundle

通过 [Profile 插件安装器](../../../docs/architecture.zh.md)添加 `@deepseek-ai/dsh-subagent-antigravity`。[补丁](cordis.patch.yml)仅贡献名为 `antigravity` 的休眠 Host 提供者；挂载不启动 CLI 进程。Agent Preset 单独绑定 `dsh-tool-subagent`，设置 `provider: antigravity`、唯一的 `toolName`、`backgroundMode: one-shot` 和 `maxDepth: provider-managed`。后台调用需保留常规 Job 注册表与控制工具。移除 Bundle 会撤销 Host 可用性，但不删除原生 Antigravity 数据。

### 配置

每个 Host 提供者行接受以下部署自有字段。原生权限设置仍是权威；提供者绝不传递 `--dangerously-skip-permissions`。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `antigravity` | 唯一的非空注册表名称 |
| `command` | `agy` | 已安装的可执行文件名或路径；不进行 shell 插值 |
| `model` | 原生设置 | 可选的非空模型标识 |
| `env` | `{}` | 在子进程凭据清理之后叠加的显式环境条目 |
| `timeoutMs` | `300000` | 整次运行的正数截止时间，单位毫秒，最大 `2147483647` |
| `maxOutputBytes` | `1048576` | 每个流保留的 UTF-8 字节上限，须为正整数；stdout 溢出时失败关闭 |
| `disposeGraceMs` | `3000` | 托管范围终止的正数宽限时间，单位毫秒，最大 `2147483647` |

子进程使用已提供的 `request.cwd`，否则取父 Session cwd。所选目录必须绝对且可访问；无效的显式值会在 spawn 前拒绝，且不回退。省略时仍要求父级工作区可用。子进程服务先清理凭据形态和受管理的 `DSH_*` 环境变量，再应用 `env`；显式条目表示有意启用。CLI 仍可访问常规原生主目录、项目设置和缓存认证。

### 原生模型选择

提供者在 Host 工作目录中运行 `agy models` 来公布原生模型，不启动对话。发现使用与委派相同的可执行文件、显式环境、截止时间、输出上限和终止宽限时间。取消和移除提供者会终止发现，并等待托管进程树清理完成。空白、格式错误、重复、截断或非成功输出会安全失败，不暴露 stderr。

一次性请求的 `nativeModel` 覆盖配置的 `model`；省略时保留配置或原生默认值。所选标识直接传给 `--model`，由 CLI 校验。原生模型独立于 Host LLM 路由，绝不继承父级模型或推理强度。Preset 可通过[委派工具的设置策略](../tool-subagent/README.zh.md)启用模型选择；本提供者自身不授予选择权限。

### 结果与失败

提供者通过 stdin 发送一条 NDJSON 用户消息，并立即关闭输入。仅在退出码为零、无信号、无超时、stdout 完整且托管进程树清理完成后，才接受恰好一个嵌套 `result`，其 `status` 为 `SUCCESS`、`response` 非空白且无 `error` 字段。格式错误的输出、缺失或重复的结果、非成功状态、输出溢出和进程失败均产生固定诊断，不复制 stderr 或原始错误文本。

取消返回 `aborted`；超时返回 `error`，即使子进程处理终止并以零退出也是如此。两者都会等待子进程提供者的托管范围退出。释放操作幂等，并等待同一清理过程。观察失败会报告错误，不会视为成功清理。不回滚任何工作区变更。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

[插件入口](src/index.ts)校验配置并注册一个可撤销的提供者贡献。[运行实现](src/run.ts)发送文档定义的流式输入，而非将提示放入进程参数。它使用共享子智能体结算和运行句柄辅助函数、共享截止时间库，以及子进程服务的有界收集和托管范围所有权。不涉及 SDK、私有 OAuth 流程、代理或独立进程管理器。

只有最终文本到达父会话。对中间事件和原生元数据的解析仅足以识别终结信封；stderr 保留在有界子进程内存中，不溢写文件或记录日志。全新 CLI 进程拥有自己的对话历史，提供者从不传递继续或恢复标志。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

阅读[子智能体服务](../subagent/README.zh.md)了解委派语义，[子进程服务](../../subprocess/subprocess/README.zh.md)了解环境与进程所有权，阅读[委派决策](../../../.agents/notes/implemented/feature/2026-09-13-antigravity-native-delegation.zh.md)，以及[官方无头模式参考](https://antigravity.google/docs/cli/headless.md)了解原生输入、结果和权限行为。

-----

<a id="model-experience"></a>
## 模型体验

### 子请求

#### 模型看到什么

Antigravity 子智能体仅在全新对话中接收独立文本任务，并使用所选工作区中的原生设置和工具。提供者声明不支持父智能体选项、输出 schema、深度强制限制、工具过滤或 persona；共享服务拒绝需要这些能力的请求。

#### Token 影响

子智能体消耗自己的模型上下文和推理 token。只有其最终答案或安全失败诊断通过委派工具或 Job 结果进入父上下文。

#### KV Cache 影响

原生子智能体缓存复用独立于父请求前缀。全新进程不复制父会话历史或缓存。

### 间接影响父结果

#### 模型看到什么

通用 `dsh-tool-subagent` 工具返回最终文本，或带安全诊断事实的失败停止原因。后台调用使用常规 Job 确认、完成通知、收集和取消机制。原生推理、工具通信、用量、对话标识符、stderr 和工作区差异均不复制到父 Session。

#### Token 影响

父智能体接收常规工具或 Job 结果文本。本提供者本身不添加面向模型的工具 schema。

#### KV Cache 影响

工具和 Job 结果追加在可复用的父请求前缀之后；本提供者不改写更早的父消息。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

以下约束定义提供者的部署与隔离限制。

- 已安装 CLI 的版本和认证由部署方负责。原生设置并非封闭隔离：工作区写入可能自动获准，被软拒绝的工具仍可能产生原生 `SUCCESS`。
- 本提供者不将父会话的文件系统沙箱施加到原生工具，也不声称成功文本证明请求的副作用已经发生。
- 原生对话文件可能持久化；提供者从不恢复它们。不支持继续对话、交互审批桥接、进度传递、结构化输出强制或子智能体用量统计。
- 输出限制约束保留字节数，而非进程在截止时间前可输出的总字节数。

**运行时不变量：** 不发布伴随包。注册和运行配对归共享子智能体服务所有；托管进程所有权归子进程服务所有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

原生 CLI 认证与推理冒烟验证独立于本包的无密钥协议和子进程测试。

</details>
