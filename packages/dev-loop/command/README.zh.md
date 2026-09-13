---
description: "通过人工命令检查开发循环片段，并显式批准审阅过的源文件摘要。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-command

[English](README.md) | 中文

## 概述

检查片段和队列观测，而不启动模型轮次。审阅完整源文件及其 SHA-256 摘要，然后显式接受该版本，或附带原因阻塞待处理工作。修改要求精确的存活根 Agent（智能体）。Lifecycle 拥有状态变更和配置的持久化；这些命令不派发工作者，也不修复恢复异常。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与推迟的工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

挂载此具名导出的函数插件时，需提供 `commands`、`agents`、`devLoopDirectory`、`devLoopLifecycle`、`devLoopQueue` 和 `fs`。它注册 `dev-loop`，而非模型工具。dispose（资源释放）时移除注册。

### 配置

两个字节预算均为必填的安全整数；没有部署默认值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxInputBytes` | 必填 | 正数 UTF-8 原始输入上限 |
| `maxOutputBytes` | 必填 | 完整序列化 CommandResult 的 UTF-8 上限；必须容纳超限拒绝信息 |

### 检查与决策

语法接受 `help`、`status`、`list`、`queue`、`show <id>`、`approve <id> <sha256>` 和 `reject <id> <reason...>`。`show` 包含完整且经过验证的源文件及其原始 SHA-256 摘要。批准要求匹配的当前摘要和 todo 状态；拒绝要求 pending 状态和非空原因。批准请求 `todo → pending`；拒绝请求 `pending → blocked`。两者均不创建 Queue 回调。

修改调用方必须是宿主中注册的精确存活根 Agent，而非复制的身份或委派子级。批准在内存和必需模式下均向 Lifecycle 转发实际命令 ID、接收 Session ID，以及审阅过的源文件和版本。必需模式历史由[持久化](../persistence/README.zh.md)拥有，而非此消费方。过时摘要要求重新审阅源文件。

输入和输出限制拒绝超限值，而非截断源文件、原因或结果元数据。取消和意外缺陷会拒绝命令操作；预期的领域失败产生错误结果。[命令解析](src/input.ts)拥有精确语法和拒绝文本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

[消费方](src/index.ts)验证命令输入和根所有权，然后将状态修改委派给唯一的 Lifecycle 写入方。[源文件审阅](src/review.ts)将完整且经过验证的 UTF-8 源文件绑定到文件系统观测；缺失或不匹配的字节数不能确立审阅版本。[检查](src/observations.ts)读取片段集和队列观测，而不恢复执行。

共享命令运行时用实际调用身份记录 `command/run` 和 `command/done`。不发布不变量伴随模块：此消费方不保留独立的状态投影；源文件新鲜度和根所有权在操作期间检查，Lifecycle 拥有比较并设置接纳。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 人工命令结果

#### 模型看到什么

`dev-loop` 人工命令不注册模型工具或提示词，也不将结果注入模型上下文。

#### Token 影响

命令结果不会通过此包增加模型输入 token。

#### KV Cache 影响

命令执行不改变模型请求前缀，也不启动模型轮次。

## 已知限制与推迟的工作
<a id="known-limitations-and-deferred-work"></a>

这些命令检查并请求决策；它们不实现自主循环。

- **持久化取决于 Lifecycle：** 内存模式仍不持久化；必需模式需要持久化提供方及激活顺序。
- **没有恢复修改：** 通过独立的[恢复消费方](../persistence/README.zh.md#use-this-package)检查和确认恢复异常；两个消费方均不提供修复或重新打开操作。
- **不恢复工作者：** 状态和队列输出不会在重启后重建回调、Agent 或工作。
- **没有原子审阅事务：** 源文件观测和生命周期接纳是独立操作；已配置的 Lifecycle 持久化提供自身的过时源文件检查。

<a id="dev-note"></a>
### 开发备注

完整操作和已记录 Session 验证由集成负责人负责。本文不声称测试套件已通过。
