---
description: "保留开发循环状态转换历史，并在不授权恢复的情况下检查隔离的规格片段。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-persistence

[English](README.md) | 中文

## 概述

重启后恢复已提交的开发循环状态，并在接纳更多工作之前检查差异。必需的生命周期持久化在副作用之前记录意图，在发布成功之前记录最终结果。人工接受始终绑定到审阅过的源文件。恢复确认只记录知悉，不授予修复或恢复隔离片段的权限。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟的工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在宿主组合中挂载默认服务，并提供 `storageDomain`、`devLoopDirectory` 和 `fs`。为 Lifecycle 配置 `durability: required`，并在其组合条目中添加 `inject: ['devLoopPersistence']`，使 Loader 等待提供方。缺少必需的持久化服务会拒绝初始化；省略生命周期持久化配置会选择不持久化的内存模式，而非在存储失败后自动回退。

### 配置

所有提供方字段均须显式设置；字节和记录预算为正安全整数。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `repositoryRoot` | 必填 | 仓库进程路径，在派生仓库身份之前规范化 |
| `maxRecordBytes` | 必填 | 每条完整保留的转换或异常记录的 UTF-8 JSON 上限，包括最终结果和确认元数据 |
| `maxHistoryRecords` | 必填 | 每个片段的意图记录数，包括失败尝试；超限时拒绝，不截断 |

### 持久状态与隔离

Lifecycle 在等待接纳之前持有比较并设置声明。意图在策略或文件系统副作用之前持久化；其最终结果在内存发布和通知之前更新同一记录。失败尝试保留其序号。非法转换和过时声明不创建意图。意图 I/O 失败报告 `DEV_LOOP_INTENT_WRITE_FAILED`，且无副作用；最终结果 I/O 失败报告 `DEV_LOOP_TERMINAL_WRITE_FAILED`，并分别说明头部、索引、移动和清理的观测结果。

恢复加载将已提交的历史与当前源文件和位置进行比较。一致的 pending 或 blocked 状态可以保留 `todo` 磁盘头部。源文件缺失或重复、实质性编辑、状态与路径冲突、无日志的 done 文件、未解决意图以及不确定副作用均保留为异常。隔离状态的读取和转换以 `PIECE_QUARANTINED` 拒绝；done 目录本身不是满足依赖关系的独立授权。

源文件身份保留规范的 Directory 路径、实际文件系统版本，以及原始和规范化 SHA-256 摘要。规范化仅将初始生命周期 Status 值改为 `todo`；正文示例、空白、换行和其他内容仍有意义。实时接受检查审阅版本。重启比较记录的字节，而不要求旧的提供方版本令牌在复制后保留。消费方要求完整、经过验证的 UTF-8，且已知字节数必须匹配；不支持带 BOM 前缀的输入。

### 恢复检查

独立的具名导出插件 `@deepseek-ai/dsh-dev-loop-persistence/command` 挂载时需要 `commands`、`agents` 和 `devLoopPersistence`。它注册 `dev-loop-recovery`；用户输入仅接受 `inspect <pieceId>` 或 `acknowledge <anomalyId> <reason...>`。必填的 `maxInputBytes` 和 `maxOutputBytes` 限制 UTF-8 输入和完整序列化 CommandResult。输出上限必须容纳完整的超限错误结果。

检查返回的文本等于 `JSON.stringify({pieceId,history,anomalies})`，其中历史按序号排列，确定性异常仅保留该片段的记录。确认要求精确的存活根 Agent（智能体），重新读取记录的本地观测，并以 `DEV_LOOP_ANOMALY_STALE` 拒绝变化。其 JSON 结果记录实际命令和 Session 身份、除首尾空白之外的完整原因、观测和时间戳。确认在重启后保留，但绝不解除隔离或改变状态。不存在 repair、promote 或 done 动词。

结果超限时返回 `Recovery output exceeds maxOutputBytes; increase the configured limit.`，而非截断历史。命令运行时拥有实际的 `command/run` 和 `command/done` Session 记录。dispose（资源释放）移除注册。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`dev_loop` 第 1 版单布局存储域保留转换和异常。转换记录包含意图及可选的最终结果；不存在独立发布的片段表。仓库身份将记录绑定到规范的绝对仓库进程路径。解析会拒绝格式错误的持久值以及不一致的身份或转换历史，而非跳过它们。

[服务](src/index.ts)拥有串行写入和独立的检查结果副本；[源文件观测](src/source.ts)提供纯哈希，不获取内容或授权；[恢复消费方](src/command.ts)拥有命令语法和人工身份检查。Lifecycle 为实际策略、文件系统和 Git 副作用提供顺序保证。Lifecycle 跟踪并等待已接纳工作；关闭还要求依赖项按顺序 dispose，以保持存储可用。取消不会取消已接纳的最终结果记录义务。

不发布不变量伴随模块：恢复加载和转换接纳在各自负责的操作中强制执行历史与源文件的关系，而非仅为检查器维护第二份状态投影。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Lifecycle](../lifecycle/README.zh.md)：合法转换和补偿性头部恢复。
- [人工命令](../command/README.zh.md)：源文件审阅和绑定版本的接受。
- [持久化决策](../../../.agents/notes/implemented/architecture/2026-09-14-development-loop-persistence.md)：顺序、否决的替代方案和恢复限制。

-----

<a id="model-experience"></a>
## 模型体验

### 恢复命令结果

#### 模型看到什么

宿主服务和 `dev-loop-recovery` 人工命令不注册模型工具或提示词，也不将命令输出注入模型上下文。

#### Token 影响

持久历史和恢复结果不会通过此包增加模型输入 token。

#### KV Cache 影响

这些操作不修改模型请求前缀。Session 命令记录仍是命令运行时输出，而非此包注入的模型历史。

## 已知限制与推迟的工作
<a id="known-limitations-and-deferred-work"></a>

恢复保留不确定性，而非静默授权工作。

- **根级 dispose 顺序尚未解决：** 外部存储提供方的关闭前置条件可能在已接纳工作完成之前关闭存储单元。Lifecycle 的等待不能独立保证根级 dispose 期间端到端的存储可用性。
- **没有原子的文件系统/Git/存储事务：** 头部恢复不会回滚 Git 索引，也不能证明移动没有发生。
- **没有自动修复或执行恢复：** 确认不会解除隔离、重新打开 done 片段、重建 Queue 回调、恢复 Agent 或恢复工作。
- **不支持仓库迁移：** 拒绝来自其他规范仓库根目录的记录；不支持导入和根目录迁移。
- **可信消费方授权：** 记录的工具/命令事实是可信观测，不是针对恶意可信插件的密码学证明。此包不替代完成策略。
- **不接受有损源文件或输出：** 未知字节数、被剥离 BOM 的源文件，以及超限的完整记录或结果均被拒绝，而非通过规范化消除差异或截断。

<a id="dev-note"></a>
### 开发备注

行为及已记录 Session 验证由集成负责人负责；本文不声称冻结的行为测试套件或恢复重放已经通过。
