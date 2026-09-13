# Agent Note: 开发循环容量跟随自有运行清理

Status: implemented

[English](2026-09-13-development-loop-queue.md) | 中文

## 问题

生命周期批准公告包含状态转换，而不包含 Agent、provider、角色任务或 worktree。它不能构造可执行工作。此外，执行者结果可能在清理完成前结算，因此计数完成公告可能在资源仍活跃时释放容量。

## 决策

[开发循环队列](../../../../packages/dev-loop/queue/README.zh.md)准入任务块及其 Consumer 拥有的启动回调和取消信号。它捕获确切在线的发起 Agent，在调用异步工厂前预留容量，并保留该预留，直到返回的一次性运行的结果和 dispose（资源释放）结算。清理失败关闭准入并保留不确定的预留。

角色 Consumer 拥有 provider、任务和 worktree；队列拥有排序、依赖、容量和取消。[批准决策](2026-09-13-development-loop-approval.zh.md)保持独立。在停放前捕获发起者可防止后续唤醒的环境调用方替换原始委派者。既有 `SubagentRun` 结果和释放 promise 提供结算；其子级 SessionId 不是可继续运行纪元。

## 考虑过的替代方案

队列直接拥有启动会吸收角色和 worktree 策略。分派器注册表会增加另一套生命周期，尽管每次调用已拥有自己的回调和信号。计数全局开始／结束公告会丢失启动拒绝和清理信息，并要求关联无关运行。

[p-queue](https://raw.githubusercontent.com/sindresorhus/p-queue/main/readme.md) 等维护中的优先队列提供通用调度。其 README 说明中止任务不会自动停止任务内部工作。任务块依赖、Agent 身份和等待资源清理仍需要自有集成。当前实现将这些职责保留在一个请求生命周期内，而不是引入另一层队列。此比较是文档检查，不是关于固定库实现的主张；未复用代码。

## 影响

可配置默认值四是部署约定，不是基准或进程级子级上限。状态是进程本地的，仅接受一次性租约。从不结算的回调或 provider 可能使拆卸等待；超时不能证明资源停止。Provider 失败和持久化协调恢复仍是独立职责。既有 agent loop（智能体循环）调度和 subagent 目录决策保留各自范围；此功能不取代它们。

## 验证

[所有者本地测试](../../../../packages/dev-loop/queue/tests/queue.spec.ts)使用真实 Agent、Directory、Lifecycle、文件系统、子进程和 Loader 服务，以及可控的外部工作租约。它们区分被保持的启动、结果结算和被保持的清理，检查归属和依赖唤醒，并证明取消等待迟到资源。容量快照从用于准入的同一预留记录派生，而不是从独立维护的事件计数器派生。
