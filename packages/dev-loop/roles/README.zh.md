---
description: "在保留的 worktree 中委派有界的专业任务，并检索持久化、明确归属的报告。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-roles

[English](README.md) | 中文

## 概述

委派 Research、Test Writer、Implementer 或 Utility 工作，同时保留下一位专业执行者需要的文件。每个请求都在准入前保存，每份终态回执在清理结算后记录实际子级、保留的分配、可选预设和报告证据。历史在 Host 重启后仍然存在。报告是有归属的证据，不证明其中的主张已经过独立验证。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在配置的 subagent provider 注册后，将默认服务在 Host 中挂载一次，并同时提供 Agents、Subagents、Queue、Worktree 和持久化 storage-domain 后端。将具名导出的 `./tool` Consumer 挂载到 Brain 的作用域组合中，而不是共享 Host Loader 的根条目组中。[fixture（测试前置数据）](tests/harness.ts) 提供私有 Git 仓库、JSON 存储、实际 provider 和脚本化模型响应；随附配置方案不挂载本包。

| 所有者 | 必填配置 | 含义 |
|---|---|---|
| Host | `roles` | 全部四个角色，每个都有非空 provider、persona 和显式继承工具过滤器。 |
| Host | `maxBriefBytes` | 完整任务 JSON 的 UTF-8 字节上限，为正安全整数。 |
| Host | `maxOutcomeBytes` | 完整终态记录的字节上限，为正安全整数，包含任务和来源。 |
| 作用域 Consumer | `maxToolOutputBytes` | 完整渲染内容数组的字节上限，为正安全整数，必须容纳固定溢出错误。 |
| 作用域 Consumer | `maxHistoryRecords` | 每份模型历史回执的最大记录数，为正安全整数。 |

角色还可在 provider 支持时设置 `agentOptions` 和 `maxDepth`。Provider 名称选择 subagent 注册表，而不是 LLM（大语言模型）路由。缺失 provider 或不支持 persona／过滤器／选项能力会导致挂载失败；运行时在启动时再次检查能力。Host 部署必须为每个角色选择合适的能力；persona 不是强制执行机制。

作用域 Brain 使用 `dev_loop_delegate` 委派任务，使用 `dev_loop_delegations` 读取任务块历史。成功的原生回执包含序列化 JSON 文本。委派返回一条已结算记录；历史返回完整的时间顺序数组，包含未解决的请求记录。两个工具都不接受模型提供的 provider、cwd、预设、父级、persona 或过滤器权限。

超大任务在持久化或启动前拒绝。非文本或超大报告成为带明确限制的失败观察，而不是截断的完成结果。模型输出溢出会指出持久化委派 id；历史溢出不返回部分数组。如果必需元数据本身无法放入终态预算，终态记录会明确拒绝，先前的请求记录保持未解决。持久化失败绝不会报告为成功委派。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>所有权、顺序与观察到的证据</summary>

[服务](src/index.ts) 在等待前捕获确切的在线发起者，将意图持久化到单一 `dev_loop_roles` 领域，并在 Queue 准入期间恢复同一发起者。准入后的分派取得保留的分配，通过公共 subagent 请求传递目录、persona 和过滤器。它仅捕获返回的 id 和实际可选头部预设，然后将实际租约交给 Queue。Queue 拥有结果观察和 dispose（资源释放）；Roles 拥有终态持久化，并在关闭领域前等待其操作结算。Roles 从不退役分配。

[记录解析器](src/records.ts) 使用 Zod 可辨识联合校验权威存储。历史从领域读取独立记录，而不维护第二份缓存。请求记录表示意图，不是子级活跃的证据；存储与启动之间的崩溃需要本包以外的协调恢复。Roles 不发布运行时不变式配套入口，因为它没有可与权威记录比较的独立维护观察。

`SubagentRuntime.start` 拒绝且未返回租约时，清理保持 `unproven`：Queue 没有可等待的子级租约。返回租约后，即使结果拒绝，成功等待票据取消也能证明清理完成。取消拒绝会使清理保持 `unproven`，不确定的清理始终记录为 `failed`，绝不是 `aborted` 或 `completed`。Roles 只保留通过公共运行时和 Queue 可观察的失败，不推断隐藏的启动释放失败。

[委派决策](../../../.agents/notes/implemented/feature/2026-09-13-development-loop-roles.zh.md) 拥有归属和持久化的理由。Queue 与 Worktree 保持各自独立的生命周期职责。

</details>

<a id="model-experience"></a>
## 模型体验

### 作用域 Brain 工具 schema 与回执

#### 模型看到什么

[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-dev-loop-roles)拥有 schema，仅公开任务和任务块历史输入。回执包含实际 id、分配元数据、完整保留的结果、限制及 `reported` 来源。省略预设表示没有记录预设，而不是猜测父级组合。请求历史保持未解决。固定的历史溢出文本为 `Delegation history overflow: complete history exceeds the record or byte limit; no partial history returned.`

#### Token 影响

作用域 Consumer 挂载期间，schema 增加固定 token。每个结果向 Brain 历史追加数据相关 token，受 Consumer 的完整渲染字节数和记录数限制。字节预算不保证 token 数量；持久化存储不会自动裁剪。

#### KV Cache 影响

工具回执以仅追加方式增长历史。稳定的 schema 可保留已经可复用的前缀；挂载、移除或修改工具描述会改变 schema 输入。本包不承诺 provider 缓存可用性或淘汰行为。

### 子级任务与配置的 persona

#### 模型看到什么

子级收到角色、任务块、任务、理由、可选验证详情和 Host 配置的 persona。分配的目录进入不可变的子级头部和既有模型 cwd 变量。任务以本包拥有的以下指令结束。

##### 报告归属指令

```markdown
Report the evidence you inspected, cite sources, and state limitations. Your report is attributed to your role, not direct inspection by the parent.
```

#### Token 影响

每个子级发起独立的模型请求。任务和 persona token 取决于请求与 Host 策略。完整模型任务输入受字节限制，但这不限制继承上下文、配置的 persona、provider 缓冲或子级的 token 用量。

#### KV Cache 影响

每个子级任务独立于 Brain 的请求历史。角色策略、分配的 cwd、实际继承组合和任务文本都可能改变子级请求前缀。Roles 不改写先前的 Brain 消息。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- Research 要求非空的显式 `toolFilter.allow` 列表；可选 `deny` 条目从中扣除。其他角色要求显式 `allow` 和／或 `deny`。此配置检查不证明获准工具为只读。Provider 将配置的过滤器应用于继承 schema 和执行器分派。这不限制可信插件、直接服务调用或获准 shell 的文件系统副作用；persona 和 worktree 分配不是隔离机制。
- 不提供任意预设选择器、provider 降级、跨仓库路由、自动删除历史、崩溃协调恢复、转移或分配退役。
- 启动、持久化存储和 worktree 分配是独立操作。崩溃残留的请求与明确的终态持久化失败需要检查，而不是自动重试。Queue 无法证明静止时，清理错误保持未证明状态。
- 结果上限包含必需元数据。配置过小而无法容纳这些事实时，不能保留有界终态记录，会明确失败，而不是丢弃身份或编造完成状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——非权威内容</summary>

[惰性 RED 基线](tests/RED.md)、[领域修正](tests/domain-amendment.md)和[覆盖率补充报告](tests/COVERAGE-ADDITIONS.md)保留历史证据，不代表当前源码验收。覆盖率报告记录了 47 个通过用例和失败的严格逐文件覆盖率检查；其源码哈希界定该观察范围。实际 provider 的清理失败集成仍是该报告注明的缺口。本次文档更新不声称任何新的运行时、快照或覆盖率结果。

</details>
