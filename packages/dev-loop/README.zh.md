---
description: "development-loop 包组：任务块发现、受保护的生命周期变更、保留的 worktree 和持久化角色委派，供贡献者选择服务及定位参考。"
kind: "package-group"
---

# dev-loop/ — 任务块发现与委派

[English](README.md) | 中文

## 概述

发现任务块规格、请求人工批准，并通过受保护的操作改变状态。委派专业任务并取得持久化、明确归属的报告，同时保留其 worktree 供交接。Queue 限制从准入到清理的工作；Roles 组合委派流程，但不拥有分配退役。这些包不提供完整的自主循环或持久化生命周期转换记录。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

按操作的所有者选择服务。

| 包 | 职责 |
|---|---|
| [`approval`](approval/README.zh.md) | 展示当前源码供 Accept、Question 或 Change；拒绝过期接受。 |
| [`directory`](directory/README.zh.md) | 通过文件系统服务发现并验证任务块规格。 |
| [`lifecycle`](lifecycle/README.zh.md) | 保护状态变更，并将已跟踪任务块文件移入 `done/`。 |
| [`queue`](queue/README.zh.md) | 准入 Consumer 拥有的一次性委派，并限制从启动到完整清理的工作。 |
| [`roles`](roles/README.zh.md) | 委派专业任务，并保留有界、明确归属的历史。 |
| [`worktree`](worktree/README.zh.md) | 跨角色保留任务块的分离检出，并保守退役干净的自有目录树。 |

<a id="related-documentation"></a>
## 相关文档

- [开发循环子系统](../../docs/subsystems/development-loop.zh.md)——本组共享类型、生命周期语义和生成的 Cordis API 的权威所有者。
- [文件系统子系统](../../docs/subsystems/filesystem.zh.md)——文件访问与版本保护的编辑。
- [子进程子系统](../../docs/subsystems/subprocess.zh.md)——命令执行与取消。

<a id="dev-note"></a>
## 开发备注

无。
