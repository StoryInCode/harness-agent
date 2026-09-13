---
description: "为生命周期消费者提供受保护的开发循环条目状态变更、可取消的 Git 晋升和头部恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-lifecycle

[English](README.md) | 中文

## Summary

通过一个拒绝过期或非法转换的 compare-and-set 写入者变更开发循环条目的状态。完成操作会等待策略监听器、重写磁盘头部，并暂存一次移入集合 `done/` 目录的移动。取消操作会等待活动工作并执行受保护的头部恢复。memory 模式是非持久的；required 模式使用持久化提供者进行重启对账和先持久后可见的发布。仅凭本包不执行验证。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过主机组合挂载本服务，并提供 `devLoopDirectory`、`fs` 和 `subprocess`。目录在 `Service.init` 期间、挂载完成之前水合所有有效条目；畸形的 id 保留其解析错误。处置会在 Cordis 合流初始化之前中止活动列举或扫描，且被取消的结果不会被发布。

### 配置

Cordis 在挂载时校验以下可选字段。子进程限制适用于每个子进程请求；durability 选择状态记录策略。required 模式需要 `devLoopPersistence` 以及 Lifecycle 组合条目上的 `inject: ['devLoopPersistence']`，以便 Loader 等待它。缺少必需的持久化会拒绝初始化。

| 字段 | 默认值 | 接受的值 |
|---|---|---|
| `terminationGraceMs` | `5000` | 正整数毫秒，至多 `2147483647` |
| `outputMaxBytes` | `65536` | 每个收集流的正整数字节 |
| `durability` | `memory` | `memory` 或 `required`；required 模式等待持久化水合和写入 |

### 状态变更

`getStatus(pieceId)` 返回持有的逻辑状态，而非新的磁盘读取。`canTransition(from, to)` 检查导出的 `LEGAL_TRANSITIONS` 表：`todo → pending`、`pending → done`、`pending → blocked` 和 `blocked → todo`。`done` 没有出边。

携带观察到的状态调用 `transition(pieceId, expected, to, reason?, signal?, authorization?)`。过期或竞争的声明以 `StalePieceStatusError`（`PIECE_STALE_STATUS`）拒绝；非法边以 `InvalidStateTransitionError`（`INVALID_STATE_TRANSITION`）拒绝。两种拒绝都不会创建 intent。非完成转换不会改变磁盘头部；required 模式将其逻辑状态持久记录。

受信任的人类 Consumer 从实际工具或命令调用提供第六个参数，绝不使用模型参数。required 的 todo-to-pending 准入以 `PIECE_AUTHORIZATION_REQUIRED` 拒绝缺失的接受，以 `PIECE_REVIEW_STALE` 拒绝已变更的评审源。即使 Consumer 转发了授权，memory 模式仍保持非持久。required 水合将不一致的历史/源观察隔离；此后 `getStatus` 和转换以 `PIECE_QUARANTINED` 拒绝，而非一个看似可用的状态。

### 完成策略与公告

`piece/pre-complete` 是任何完成文件系统或 Git 工作之前被等待的串行钩子。其 `PiecePreCompleteEvent` 携带 pending-to-done 请求、可选原因和合并的调用者/生命周期信号。监听器返回 void 或拒绝以否决；它们必须在返回前结算其拥有的工作。拒绝会释放声明且不发布完成。没有监听器即意味着没有运行验证：自主操作需要组合的策略消费者。

`piece/approved`、`piece/blocked` 和 `piece/completed` 是发布后的 `emit` 公告。完成公告包含移动后的 `newPath`。Cordis 传播同步监听器错误，在该监听器处停止分发，且不回滚已发布状态。它不等待异步监听器；订阅者拥有自己被拒绝的 promise。`blocked → todo` 没有公告。这些事件无法提供被等待的持久持久化。

### 失败与取消

无取消时，非零或信号命令退出会引发 `PieceMoveFailedError`，保留失败的 `argv`、捕获的 `stderr` 和 `pieceId`；Git 跟踪拒绝时其代码为 `PIECE_MOVE_NOT_TRACKED`，否则为 `PIECE_MOVE_FAILED`。服务只有在终止并合流托管范围之后才选择取消或普通退出失败。该等待期间的 abort 优先于非零领导者退出并保留原始 abort 原因。提供者清理失败优先于两者：取消并不能证明托管范围为空。此 API 不会在取消之外报告每条命令结果。一次不成功的晋升使内存保持 pending 且不发出完成公告。

在成功的头部编辑之后，任何发布前失败（包括 `git mv` 之后的取消）都会触发受保护的编辑，恢复实际的先前磁盘头部，而非逻辑预期状态。恢复使用前向编辑返回的版本，且从不重置 Git 索引。恢复冲突或源缺失会引发 `PieceRecoveryFailedError`（`PIECE_RECOVERY_FAILED`），标准 `cause` 携带发起错误，`recoveryError` 携带恢复错误。重试前请检查源、目标和已暂存变更；被中断的移动可能已经迁移了文件。

可选的第五个参数与生命周期处置一起取消前向工作。文件系统调用和子进程请求接收该信号，处置会等待活动操作。每条命令都终止其提供者托管范围并等待 `waitForExit()`，且不携带已取消的前向信号，即使在领导者的 `done` 结算之后也是如此。在该等待成功之前不会开始后续命令。头部恢复使用全新的、未中止的生命周期，即使在取消之后也会被等待。钩子和提供者必须在取消时结算；服务不会为了提前返回而抛弃它们。发布前观察到的取消会阻止完成通知；它不能证明文件系统回滚。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

声明是同步的、在第一个 await 之前，同时读者继续看到已提交的内存。完成会检查 Git 跟踪、获取文件系统 stat 版本，并通过 `fs.editText` 编辑实际头部。字面编辑包含前导头部，以避免改变正文中匹配的示例。已为 done 的头部仍受保护，并可由活跃的 pending 重试晋升。

完成 effect 序列为 tracking → 头部编辑 → `git add -u` → `mkdir -p done` → `git mv`。required 模式的终端记录先于内存发布和公告。跟踪先于变更；`git add -u` 无法开始跟踪未跟踪的源。Git 暂存头部和重命名而不创建提交。文件系统 API 既不提供目录创建也不提供重命名。

头部编辑、Git 索引变更、文件移动和内存发布不是一个事务。恢复只恢复拥有的头部；索引可以保留已暂存的完成内容，目录创建也可能残留。进程崩溃可能完全阻止恢复。required 模式在策略或 effect 之前等待持久 intent，并在内存发布或通知之前等待终端更新。[持久化](../persistence/README.zh.md)拥有历史、对账、完整记录限制和仅观察的确认。终端记录失败会将条目隔离并保留未解决的 intent；取消不会取消记录义务。effect 记录将前向头部/索引/移动观察与后续清理区分开。

不发布不变量伴生：合法性直接从单一表强制，而非独立维护的观察。该检查不提供跨进程的文件/索引/记录对账。确切操作和事件声明位于 [src/index.ts](src/index.ts)；共享事件字段位于 [src/types.ts](src/types.ts)。

</details>

## Model Experience

无，此主机侧状态机不注册工具、提示或会话事件。

#### KV Cache effect

此处没有任何内容进入模型请求，因此提供者缓存复用不受影响。

## 已知限制与延期工作

本地操作不构成完整的自主开发循环。

- **需要集成：** 人类批准（00.03）、验证（00.10）、持久化/对账（00.12）和声明检查（00.13）仍是独立义务。通过生命周期测试不能证明任何完整循环要求。
- **memory 模式是进程本地的：** 水合仅在挂载时发生一次，外部文件编辑不会刷新持有的状态。required 模式通过持久化水合已提交的历史；它不会重建活跃执行或自动修复隔离。
- **完成不是文档格式校验器：** 它要求有效的状态头部，但在外部编辑后不会重新校验所有语料库小节。必须在 `piece/pre-complete` 上安装格式策略。
- **恢复是补偿性的，而非原子性的：** 失败后已暂存的变更可能残留。并发编辑由文件系统版本守卫保护，而非跨进程 Git 事务。移动期间的取消可能留下需要检查的不确定结果。
- **完成要求被跟踪的 Git 源和 POSIX 执行世界：** `mkdir -p` 不可移植到原生 Windows。可移植的目录创建需要文件系统能力变更。
- **重新打开未指定：** 02.04 与监督者计划在目标状态上不一致；在该策略所有者解决之前，`done` 保持吸收性。

### Dev Note

无。
