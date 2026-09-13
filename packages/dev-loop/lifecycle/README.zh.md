---
description: "供生命周期 Consumer 使用的受保护开发循环任务块状态变更、可取消 Git 提升及头部恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-lifecycle

[English](README.md) | 中文

## 概述

通过拒绝过期或非法转换的比较并设置写入者改变开发循环任务块状态。完成会等待策略监听器、重写磁盘头部，并暂存移入集合 `done/` 目录的变更。取消等待活跃工作和受保护的头部恢复。状态仍在内存中；仅本包不会强制验证或提供重启持久性。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过提供 `devLoopDirectory`、`fs` 和 `subprocess` 的 Host 组合挂载服务。目录在 `Service.init` 期间、挂载结算前装入全部有效任务块；格式错误的 id 保留解析错误。Dispose（资源释放）在 Cordis 等待初始化前中止活跃列表或扫描，已取消结果不会发布。

### 配置

Cordis 在挂载时验证以下可选字段，并将其提供给每个子进程请求。

| 字段 | 默认值 | 接受值 |
|---|---|---|
| `terminationGraceMs` | `5000` | 正整数毫秒，最多 `2147483647` |
| `outputMaxBytes` | `65536` | 每条收集流的正整数字节数 |

### 状态变更

`getStatus(pieceId)` 返回持有的逻辑状态，而不是重新读取磁盘。`canTransition(from, to)` 检查导出的 `LEGAL_TRANSITIONS` 表：`todo → pending`、`pending → done`、`pending → blocked` 和 `blocked → todo`。`done` 没有出边。

使用观察到的状态调用 `transition(pieceId, expected, to, reason?, signal?)`。过期或竞争认领以 `StalePieceStatusError`（`PIECE_STALE_STATUS`）拒绝；非法边以 `InvalidStateTransitionError`（`INVALID_STATE_TRANSITION`）拒绝。非完成转换仅改变内存，因此已批准内存为 `pending` 时，磁盘头部仍可声明 `todo`。

### 完成策略与公告

`piece/pre-complete` 是在任何完成文件系统或 Git 工作前等待的串行钩子。其 `PiecePreCompleteEvent` 携带 pending-to-done 请求、可选理由和组合调用方／生命周期信号。监听器返回 void 或通过拒绝否决；它们必须在返回前结算拥有的工作。拒绝释放认领，不发布完成。没有监听器表示未运行验证：自主操作需要组合的策略 Consumer。

`piece/approved`、`piece/blocked` 和 `piece/completed` 是发布后的 `emit` 公告。完成包含重定位的 `newPath`。Cordis 传播同步监听器错误，在该监听器处停止分派，不回滚已发布状态。它不等待异步监听器；订阅者拥有其被拒绝 promise。`blocked → todo` 没有公告。这些事件不能提供需等待的持久化。

### 失败与取消 <a id="failure-and-cancellation"></a>

没有取消时，非零或信号导致的命令退出引发 `PieceMoveFailedError`，保留失败的 `argv`、捕获的 `stderr` 和 `pieceId`；Git 跟踪拒绝时其代码为 `PIECE_MOVE_NOT_TRACKED`，否则为 `PIECE_MOVE_FAILED`。服务仅在终止并等待受管范围后选择取消或普通退出失败。该等待期间的中止优先于主进程非零退出，并保留原始中止理由。Provider 清理失败优先于两者：取消不证明受管范围为空。此 API 不在取消旁报告每项命令结果。提升不成功会保持内存为 pending，不发出完成。

头部编辑成功后，任何发布前失败（包括 `git mv` 后的取消）都触发受保护编辑，恢复实际先前磁盘头部，而非逻辑预期状态。恢复使用正向编辑返回的版本，从不重置 Git 索引。恢复冲突或源码缺失引发 `PieceRecoveryFailedError`（`PIECE_RECOVERY_FAILED`），标准 `cause` 保留发起错误，`recoveryError` 保留恢复错误。重试前检查源码、目标和暂存变更；中断的移动可能已经重定位文件。

可选第五个参数与生命周期 dispose 一起取消正向工作。文件系统调用和子进程请求接收该信号，dispose 等待活跃操作。每条命令终止其 provider 管理的范围，并在不传递已取消正向信号的情况下等待 `waitForExit()`，即使主进程的 `done` 已结算。该等待成功前不启动后续命令。头部恢复使用新的未中止生命周期，即使取消后也会等待。钩子和 provider 必须在取消后结算；服务不会遗弃它们以让拆卸提前返回。发布前观察到取消会阻止完成通知，但不证明文件系统回滚。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

认领在首次等待前同步进行，而读取者仍看到已提交内存。完成检查 Git 跟踪、取得文件系统 stat 版本，并通过 `fs.editText` 编辑实际头部。字面编辑包含前置头部，避免修改正文中匹配的示例。已为 done 的头部仍受保护，可通过在线 pending 重试提升。

经过检查的命令顺序为跟踪 → 头部编辑 → `git add -u` → `mkdir -p done` → `git mv` → 内存发布 → 公告。跟踪先于变更；`git add -u` 不能开始跟踪未跟踪源码。Git 暂存头部和重命名，不创建提交。文件系统 API 既不提供目录创建，也不提供重命名。

头部编辑、Git 索引变更、文件移动和内存发布不是一个事务。恢复仅还原自有头部；索引可保留暂存的完成内容，目录创建也可残留。进程崩溃可能完全阻止恢复。要求的 [00.12 持久化集成](../../../plans/pieces/00-dev-loop/00.12-loop-persistence.md)必须协调位置、头部与持久化状态，并在通知前引入需等待的持久化操作。

不发布 invariant 配套入口：合法性直接从一张表强制执行，而非由独立维护的观察确定。该检查不提供跨进程文件／索引／记录协调。精确操作和事件声明位于 [src/index.ts](src/index.ts)；共享事件字段位于 [src/types.ts](src/types.ts)。

</details>

## 模型体验 <a id="model-experience"></a>

无，因为此 Host 侧状态机不注册工具、提示词或会话事件。

#### KV Cache 影响

没有内容进入模型请求，因此 provider 缓存复用不受影响。

## 已知限制与延后工作 <a id="known-limitations-and-deferred-work"></a>

本地操作不构成完整的自主开发循环。

- **需要集成：**人工批准（00.03）、验证（00.10）、持久化／协调恢复（00.12）和主张检查（00.13）仍是独立义务。生命周期测试通过不证明这些完整循环要求中的任何一项。
- **状态是进程本地的：**挂载时仅装入一次，外部文件编辑不刷新持有状态，非完成转换不更新磁盘。此处没有持久化转换记录或重启协调恢复。
- **完成不是文档格式验证器：**它要求有效状态头部，但不会在外部编辑后重新验证全部语料章节。需要时必须在 `piece/pre-complete` 安装格式策略。
- **恢复是补偿性的，不是原子的：**失败后暂存变更可残留。并发编辑由文件系统版本保护，而不是跨进程 Git 事务保护。移动期间取消可能留下需检查的不确定结果。
- **完成要求已跟踪 Git 源码和 POSIX 执行环境：**`mkdir -p` 不可移植到原生 Windows。可移植目录创建需要文件系统能力变更。
- **重新打开未定义：**02.04 与 supervisor 计划对目标状态存在分歧；计划所有者解决该策略前，`done` 保持吸收态。

<a id="dev-note"></a>
### 开发备注

无。
