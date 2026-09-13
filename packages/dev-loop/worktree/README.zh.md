---
description: "跨开发循环角色保留分离的 Git worktree 分配，并仅显式退役干净、未改变的自有目录树。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-worktree

[English](README.md) | 中文

## 概述

为每个开发循环任务块提供独立检出，并跨 Test Writer 和 Implementer 运行保留文件。重复请求保留相同目录和基点提交。既有的链接隔离会被借用，而不是嵌套。取消和卸载保留物理目录树；显式退役拒绝可能仍需转移的工作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

## 使用本包 <a id="use-this-package"></a>

在 Host 组合中挂载服务，`fs` 和 `subprocess` provider 必须共享执行环境。主线必须标识具有有效提交的非裸主检出。请求分配前配置以下字段：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `mainlinePath` | 必填 | 主检出目录 |
| `worktreeRoot` | `.worktrees` | 规范主线下被忽略的目录 |
| `commandTimeoutMs` | 必填 | 正整数命令截止时间，最多 2147483647 ms |
| `outputMaxBytes` | 必填 | 每条流收集的字节数，为正安全整数 |
| `terminationGraceMs` | 必填 | 正整数终止／排空宽限时间，最多 2147483647 ms |

`assignWorktree` 接受点分任务块 ID、cwd 和取消信号。其不可变结果标识目录、固定提交和创建或借用的所有权。兼容的重叠调用者共享所有者的尝试；取消等待者不取消该所有者。所有者取消会在子进程结算后拒绝合并的等待者。角色完成不退役分配。

仅在停止分配的全部使用者后调用 `retireWorktree`。借用的目录树、改变的 HEAD，以及已暂存、未暂存、未跟踪或忽略的文件都会阻止移除。Git 移除从不强制执行。失败保留映射，并披露尝试的路径及保留或不确定的残留；恢复前检查该路径。服务从不修复忽略文件，也不自动删除失败的分配。

从仓库根目录观察行为：

```bash
pnpm exec vitest run packages/dev-loop/worktree/tests/worktree.spec.ts
```

冻结用例执行实际分离检出／索引隔离、角色文件保留、借用、拒绝、显式退役、Loader 发布，以及等待受管范围静止的取消。

## 理解实现 <a id="understand-the-implementation"></a>

<details>
<summary>实现内部机制——点击展开</summary>

[服务](src/index.ts)串行化变更，并仅在 Git 清单确认路径和提交后发布一份保留分配。分离 HEAD 表示检出直接指向提交，而不创建分支。Git 提供检出创建和注册；文件系统提供规范身份与包含关系；[命令辅助模块](src/git.ts)提供有界 Git 观察和命令生命周期所有权。

命令截止时间启动取消，而不是成功清理。辅助模块请求终止并无限期等待 `waitForExit()`，包括 provider 失败后。取消后的零退出码不能发布成功。NUL 分隔的清单保留普通按行解析可能破坏的路径。

不发布 invariant 配套入口：发布直接检查 Git 观察，而保留分配在调用者修改文件或 HEAD 后仍有意作为有效历史基点。周期性相等断言会拒绝这种受支持工作，而不是诊断自有的不一致。

</details>

## 模型体验 <a id="model-experience"></a>

无，因为此 Host 服务不注册模型工具、提示词或会话事件。

#### KV Cache 影响

没有内容进入模型请求，因此 token 用量和 provider 缓存复用不受影响。

## 已知限制与延后工作 <a id="known-limitations-and-deferred-work"></a>

分配和删除权限不能证明转移正确。

- 分配是进程本地的；重启恢复和持久化关联属于 00.12。已占用而未记录的路径需要显式恢复，而不是自动接管。
- 子级会话 cwd 集成属于 00.06。本包不改变父级头部，也不编造 subagent 请求字段。
- 不支持子模块和裸仓库。被忽略的资源（包括依赖和秘密）不会复制到新检出，存在时会阻止退役。
- 不提供跨进程锁，也不提供防止外部写入者与退役检查竞争的事务保护。调用者必须在退役前停止分配使用者。
- 无法确立受管范围静止的 provider 可能使拆卸等待或拒绝其观察。经过的时间不能证明清理。
- 目录分配不是文件系统隔离、转移验证或删除脏工作的许可。不创建分支、提交、推送、转移或自动清理。

### 开发备注

[决策记录](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-worktree.zh.md)解释保留所有权，以及为何角色完成和干净状态都不能证明转移。
