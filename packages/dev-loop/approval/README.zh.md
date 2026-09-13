---
description: "展示完整规格源码，供人类在开发循环工作入队前显式批准。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-approval

[English](README.md) | 中文

## 概述

请人类对一个规格任务块选择 Accept、Question 或 Change。工具展示完整的当前 Markdown，警告缺失的教学小节，并且仅将人类显式接受且未改变的 todo 任务块入队。问题和反馈绝不授权工作。此 fork 自有 Consumer 使用既有用户问答界面；不提供新浏览器面板或持久化批准存储。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

## 使用本包 <a id="use-this-package"></a>

在 `tools`、`userQuestions`、`devLoopDirectory`、`devLoopLifecycle` 和 `fs` 可用且具有用户问答应答者时挂载此函数插件。它没有配置字段，也不发布服务。共享 provider 属于 Host 组合；Consumer 可限定到会话预设。在线委派子级不能请求人工批准；它必须向父级报告未解决的决定。

### 审阅任务块

从在线根 agent（智能体）调用 `present_piece_for_approval`，参数为 `{"pieceId":"00.03"}`。通用界面展示两个问题：`decision` 包含完整源码及单选标签 `Accept`、`Question`、`Change`；`feedback` 接受可选独立文本。它不使用二元计划审阅界面。

仅接受一个精确的决定选择，且不允许自定义决定文本。跳过、重复、无法识别或多个选择均以 `APPROVAL_DECISION_REQUIRED` 失败。重复反馈答案也会失败。反馈去除首尾空白，空白时省略。结果为严格对象，例如 `{"pieceId":"00.03","decision":"change","feedback":"Explain the alternatives."}`。

Accept 调用生命周期从 `todo` 到 `pending` 的比较并设置，仅在该操作成功后返回。Question 和 Change 保持生命周期状态不变。本工具从不重写任务块文件，也不自行启动实现工作。

### 审阅警告与失败

源码完整读取，并使用目录配置的解析器选项重新验证。教学检查识别 `## Teach me while you build` 内、代码围栏外的 Markdown 子标题和粗体列表标签。每个缺失标签追加 `Review warning: missing teaching subsection: <name>.`，其中 `<name>` 为 `Approaches considered` 或 `Prior art inspected`；原始源码保持完整。

任务块缺失报告 `PIECE_NOT_FOUND`；格式错误保留解析器诊断。非 todo 生命周期状态报告 `PIECE_NOT_APPROVABLE`。源码版本改变或解析 id 不匹配报告 `PIECE_REVIEW_STALE`，需要重新展示。竞争的生命周期转换使接受失败，而不是产生成功结果。

调用方缺失报告 `CALLER_NOT_LIVE`。问答服务检查提供的调用方是否为确切在线根，并以 `DELEGATED_CALLER` 拒绝自有子级；没有应答者认领请求时报告 `NO_PROVIDER`。Provider 失败和取消返回工具错误，不产生批准。

### 取消与释放

操作组合工具调用信号与插件生命周期，并将其传给目录查询、文件系统调用、人类等待和生命周期转换的第五个参数。每次等待读取或答案后以及转换前立即检查取消。插件 dispose（资源释放）移除工具、中止待定操作，并等待其 provider 结算；迟到的 Accept 不能从已卸载插件授权工作。Provider 必须遵守取消并结算其拥有的工作，不能遗弃工作。

## 理解实现 <a id="understand-the-implementation"></a>

[源码](src/index.ts)拥有源码新鲜度检查、教学详情组装、精确决定解析、工具注册和待定操作所有权。[结果类型](src/types.ts)定义模型可见的决定字段。文件系统版本包围展示读取，并在接受前再次检查；解析的源码 id 必须等于请求 id。这些检查不会使文件系统观察与生命周期变更原子化。

Cordis 拥有注册清理，问答服务拥有在线根验证和应答者分派，生命周期拥有状态比较。纯工具渲染器仅序列化规范结果，不序列化在线运行时对象。不发布 invariant 配套入口：此 Consumer 没有需要协调的独立状态投影；它在操作内检查被审阅版本，并将状态竞争委托给生命周期写入者。

## 模型体验 <a id="model-experience"></a>

### 工具 schema

#### 模型看到什么

模型看到具有一个必填 `pieceId` 字符串的 `present_piece_for_approval`。生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-dev-loop-approval)拥有完整 schema。可见性遵循挂载作用域；不注册额外系统提示词。

#### Token 影响

工具可见的每个请求承担固定 schema 成本。

#### KV Cache 影响

定义和可见性不变时，schema 的前缀稳定。改变插件或工具限制可能改变该请求前缀；provider 缓存保留不在本包控制范围内。

### 工具调用历史与结果

#### 模型看到什么

模型保留其任务块 id 参数，并收到包含 `pieceId`、小写 `decision` 和可选去除首尾空白的 `feedback` 的紧凑 JSON，或工具错误。完整源码和审阅警告是用户问题详情，本工具不将它们添加到模型上下文。模型必须决定如何处理 Question 或 Change，然后才能再次请求审阅。

#### Token 影响

参数、反馈以及结果或错误文本增加数据相关的历史 token。等待不增加模型请求；完整任务块不会复制到结果中。

#### KV Cache 影响

工具结果追加到对话，而不是替换先前消息。它保留先前可复用前缀；反馈大小仅影响新追加内容。

## 已知限制与延后工作 <a id="known-limitations-and-deferred-work"></a>

- **批准不持久化：**接受更新生命周期内存并发出公告。绑定修订的证据和重启协调恢复属于 00.12；本工具不会自动重新展示中断的审阅。
- **新鲜度不是跨服务事务：**最终文件版本检查缩小审阅竞争窗口，但无法阻止该检查与生命周期提交之间的外部编辑。
- **通用 UI 限制：**决定问题可提供自定义文本，但本工具拒绝将其作为授权。缺失教学小节产生警告而不否决；更广泛的验证属于其策略 Consumer。
- **组合与演示独立：**此 fork 自有包不安装 00.14 dev-loop 预设。包测试不能确立已挂载 Web 演示或完整循环批准证据。
- **人类等待依赖 provider：**缺失应答者会失败，取消后不结算的应答者可能延迟释放。此处不提供独立截止时间或脱离式等待。

### 开发备注

[决策记录](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-approval.zh.md)解释为何此任务规划选择使用问答而不成为权限授予。
