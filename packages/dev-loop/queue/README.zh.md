---
description: "限制已批准开发循环的一次性委派数量，同时保留调用方身份并等待完整的执行者清理。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-queue

[English](README.md) | 中文

## 概述

将已批准任务块和 Consumer 拥有的启动回调提交到有界分派队列。规范队列优先级和依赖控制回调运行时间。预留覆盖启动、执行和清理，包括取消后才完成的启动。此 fork 自有服务不从批准事件推断任务，也不在没有提交请求时创建 subagent。

## 目录

- [使用本包](#use-this-package)
- [所有权与调度](#ownership-and-scheduling)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 使用本包 <a id="use-this-package"></a>

在 `agents`、`devLoopDirectory` 和 `devLoopLifecycle` 可用时挂载服务。经验证的 `maxConcurrency` 配置为 1 到 32 的整数，默认 4。这是部署约定，不是测得的机器容量或全局 subagent 上限。

角色 Consumer 在 `ctx.agents.withInitiator(agent, ...)` 下调用 `ctx.devLoopQueue.enqueue({ pieceId, signal, dispatch })`。回调接收已捕获的 Agent 和组合取消信号，返回既有的一次性 `SubagentRun`。Consumer 选择 provider、请求、角色和 worktree；队列不注入分派器或 subagent provider。

准入要求确切在线发起者、规范任务块及依赖、逻辑生命周期状态 `pending`，且同一任务块没有未结请求。在线的自有子级可以提交工作；人类根授权仍由批准 Consumer 负责。准入在异步查询前预留任务块 id，并返回票据而不等待执行者容量。

票据的 `result` 仅在 dispose（资源释放）和结果观察结算后返回执行者的 `SubagentResult`。除非本请求被取消，子级停止原因（包括 `error` 和 `aborted`）仍是结果值。启动和基础设施失败会拒绝票据。`cancel(reason?)` 是幂等的，会中止请求并等待完整清理；清理失败也会拒绝取消。普通结算后，同一仍为 pending 的任务块可为另一个角色再次提交。

`getActiveWorkers()` 报告启动中和运行中预留的独立标量记录，包括清理阶段。`getQueuedEntries()` 按分派顺序报告等待依赖或容量的已准入请求。两者均不返回在线 Agent 对象、回调或运行句柄。返回的 `subagentId` 是子级会话 id，不是可继续运行的纪元。

## 所有权与调度 <a id="ownership-and-scheduling"></a>

较小的规范队列数字优先，同值按 FIFO 请求顺序排序。调度器检查当前逻辑依赖状态，而不是过期磁盘状态头部。未完成依赖会停放请求；被阻塞依赖会触发 pending-to-blocked 生命周期转换并拒绝请求，不妨碍无关工作。生命周期批准、完成和阻塞公告仅唤醒既有请求。全局 subagent 事件不创建工作，也不释放容量。

调度清除环境中的发起者归属。启动前，队列重新检查已捕获 Agent 的确切在线身份和任务块的 pending 状态，然后在该 Agent 的发起者作用域下调用回调。容量在调用异步回调前预留，而不是在其返回子级句柄后预留。

排队期间取消不会调用回调。启动期间取消会等待其结算，并释放任何迟到返回的运行。执行期间取消不先等待结果，而是开始释放；释放和结果观察都必须结算，容量才可复用。因此，不结算的回调或 provider 会延迟拆卸，而不会被遗弃。

Dispose 关闭准入和唤醒、中止全部请求，并等待待定准入、启动、执行和清理。运行释放失败时，队列关闭准入、取消其他请求，并因静止尚未证明而保留失败的预留。失败传至票据和队列拆卸，而不是将该容量报告为空闲。

[实现](src/index.ts)拥有请求认领、容量选择、已捕获发起者和租约结算；[公共类型](src/types.ts)定义票据与快照。不发布 invariant 配套入口：容量查询从分派检查拥有的同一预留条目派生，而非独立事件计数器。Provider 静止由运行的释放 promise 确立，不能从单独的公告数量推断。

## 模型体验 <a id="model-experience"></a>

无，因为此 Host 侧调度器不注册工具、提示词或会话事件。

#### KV Cache 影响

队列不增加模型上下文。其调度和快照不改变可复用请求前缀；模型可见的角色结果仍由分派 Consumer 拥有。

## 已知限制与延后工作 <a id="known-limitations-and-deferred-work"></a>

- **进程本地状态：**准入、排序、预留和失败关闭不持久化。重启恢复和持久化批准证据属于 00.12。
- **仅一次性操作：**上限计数本队列提交的租约，不计无关 subagent 或 provider 内部执行者。可继续驻留纪元需要独立的所有权设计。
- **Consumer 拥有工作：**仅批准无法确定父级、provider、任务或 worktree。角色 Consumer 必须提供回调和取消生命周期；此处不安装 `/dev-loop` 操作界面。
- **静止依赖 provider：**清理失败永久关闭此服务实例。启动或清理卡住会延迟取消和释放；不存在虚假宣称执行者已停止的脱离式超时。
- **依赖策略由事件驱动：**停放请求等待生命周期唤醒或其他调度触发。本包不解决循环依赖或让低优先级工作饥饿的优先级问题。

<a id="dev-note"></a>
### 开发备注

[决策记录](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-queue.zh.md)解释回调所有权，以及为何容量跟随运行清理而不是全局事件数量。
