---
description: "通过绑定修订版本、标明归属的 Research 证据验证已批准片段的前提，并在证据不足时拒绝准入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-claims

[English](README.md) | 中文

## 概述

验证已批准片段中的显式论断，并保留 Research 结论及其来源标识。报告用于编写准入前，会重新检查这些标识。已完成的报告记录的是一次观察，不是批准，也不是论断真实性的独立证明。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 服务提供 `ctx.devLoopClaims`；独立的 `./tool` 插件在 agent（智能体）作用域中提供 `dev_loop_verify_claims`。两者均以 Cordis 插件挂载，而不是可安装的 profile bundle。Host 需要 agents、directory、roles、references、filesystem 和 storage-domain 服务；工具还需要 tools 注册表。组合归属见[架构](../../../docs/architecture.zh.md)。

所有[配置字段](src/types.ts)均为必填项，没有默认值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `repositoryRoot` | 必填 | 包含片段和本地证据的仓库。 |
| `maxPieceBytes` | 必填 | 完整解码后 UTF-8 源文本的限制。 |
| `maxClaims` | 必填 | 清单行数上限，以及 Research 结论与候选论断的合计数量上限。 |
| `maxEvidenceBytes` | 必填 | 仅限制序列化后的扁平证据数组；本地文件摘要以流式方式计算，不受此字节预算限制。 |
| `maxReportBytes` | 必填 | 完整保留报告的限制，包括归属信息。 |
| `verificationTimeoutMs` | 必填 | 验证期限，单位为毫秒。 |

数值字段必须为正安全整数。限制针对完整值执行拒绝，不进行截断。本文不声明可运行的部署示例；组合验证仍由测试负责人负责。

### 观察行为

在仓库根目录运行 `pnpm exec vitest run packages/dev-loop/claims/tests --testTimeout=30000`。预期可观察到带实际 Research 委派与会话来源的受支持结论，以及针对未解决或过期证据的明确准入阻塞。此命令是行为验证路径，不表示完整套件已达到 GREEN；下文的根级清理阻塞仍未解决。

### 源文本与报告语义

片段必须恰好包含一个 `Resources and proof` 章节：其中只有一个非空 GFM 表格，列依次为 `Claim`、`Citation`、`How established` 和 `Checked against`，或者只有纯文本句子 `No load-bearing claims.`。每行必须有四个非空单元格。稳定的论断 ID 包含片段 ID、行序号和解码后的单元格文本。片段和本地证据摘要要求保持原始字节的 UTF-8：文件系统必须报告已知大小，且等于完整解码文本重新编码后的字节数。文件系统负责遇错即失败的解码；大小未知或初始 BOM 被剥离时，拒绝建立原始标识，而不是对规范化输入计算哈希。不规范化空白。

`verifyPieceClaims` 要求完全匹配的存活发起者，通过 directory 和 filesystem 服务读取片段，检查引用，再将全文评估委派给 Research。Research 必须返回一个严格 JSON 对象，为每个清单行提供恰好一条未改写的结论，并评估遗漏的前提。服务添加实际的委派、会话和 preset 归属；Research 不能自行提供这些来源信息。证据检查发现限制时，会将报告为 `supported` 的结论降为 `unverified`。

`getReport` 返回最新且匹配的终态观察的独立副本，包括失败记录，但不检查源文本是否变化。`requireAdmissible` 单独要求源文本与证据标识仍然有效、引用有效且归属未被反驳、清单覆盖完整、没有额外的承重论断、没有被反驳的结论，并且承重结论获得支持且无限制。非空清单要求没有覆盖限制；空清单要求记录覆盖说明。报告及其唯一的、已结算、已完成且清理静止的 Research 委派均不得有顶层限制。准入重新解析该委派的实际输出，将覆盖评估、额外论断和结论字段与保留报告比较，仅允许所有者添加的证据降级与限制。

证据缺失、不完整、被新记录取代或未解决时，以 `CLAIM_VERIFICATION_OUTSTANDING` 拒绝；源文本或已检查的证据标识变化时，以 `CLAIM_REPORT_STALE` 拒绝。调用方必须解决报告中的限制并重新验证当前片段，不能把保留的报告视为授权。两种方法都不会改写已批准的源文本或授予例外。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制——点击展开</summary>

[服务](src/index.ts)连接 [Markdown 清单](src/inventory.ts)、[严格 Research 解析器](src/research.ts)和[证据标识检查](src/evidence.ts)。[持久化域](src/records.ts)以片段 ID 为键保存最新尝试和终态报告。意图在委派前提交；缺少匹配终态报告时，尝试保持未解决，不能把旧报告暴露为当前报告。终态报告超限会使意图保持未解决。意图提交前的失败不会替换上一次尝试。

本服务实例中，每个片段同时只能运行一次验证。取消信号合并调用方、期限和服务生命周期；服务的资源释放函数在自身调用域关闭前等待已接纳的工作结束。根级清理存在尚未解决的依赖 API 顺序阻塞：已接纳的模型清理仍被挂起时，storage-domain provider 就可能关闭 Claims 域。读取返回独立记录副本。准入在异步检查后再次检查最新报告标识。

本包没有 `./invariant` 配套模块：持久化域是权威数据，不是 claims 自有缓存的镜像。准入在使用时比较可独立变化的文件、引用和角色记录。验证与准入之间的文件漂移是预期情况，并在准入时拒绝；源文本不变不是始终成立的运行时不变量。[决策记录](../../../.agents/notes/implemented/architecture/2026-09-13-revision-bound-claims-admission.md)负责说明理由。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 作用域内的验证工具与结果

#### 模型看到什么

[工具](src/tool.ts)只接受 `pieceId`，并将证据描述为：“Findings are reported by Research, not your direct inspection; a report is not admission approval.” 其 JSON 文本结果包含完整报告，以及 `Resources and proof` 行；每行包含论断文本、证据定位符、检查过的摘要与版本，以及 `Reported by Research delegation` 归属说明，其中含实际会话和可选 preset。本包不添加系统提示词章节。

#### Token 影响

作用域内的 schema 增加固定请求 token。每次验证结果将随数据变化的报告和证明行 token 加入工具历史。`maxReportBytes` 限制保留的报告，不限制重复了结论数据的完整工具结果包装。

#### KV Cache 影响

工具结果追加到对话历史，不替换已有消息。挂载或移除作用域内工具会改变工具 schema 前缀。Provider 缓存是否可用以及何时淘汰，不在本包保证范围内。

### 委派 Research 评估

#### 模型看到什么

Research 收到完整源文本、清单、报告 ID、严格 JSON 要求，以及依赖这些论断的决策。任务要求保留论断 ID 和文本、评估遗漏前提，并禁止改写源文本。任务还说明有界否定范围、显式导出摘要，以及限定于历史环境与时间的测量日志和元数据要求。[任务构造](src/index.ts)负责完整措辞；roles 服务负责子任务执行与交付。

#### Token 影响

委派产生独立的 Research 请求与响应 token。源文本字节数和论断数量受到限制；本包不施加模型 token 预算。Research 终态响应作为完整 JSON 值验证，不从外围散文或代码围栏中提取。

#### KV Cache 影响

Research 通过独立委派运行，不替换调用方历史。源文本、清单和报告 ID 的变化会改变任务内容；子任务前缀能否复用取决于 roles provider 和模型 provider。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

准入有意比语义真实性验证更窄。

- **测量支持是历史性的报告。** 可选的严格测量元数据记录 `command`、非空 `environment`、非负安全整数 `recordedAt`、`result` 和 `reportedExecution`。受支持的测量证据要求 `executed`，以及本地日志定位符和匹配摘要；元数据缺失或 `not-executed` 时保持未验证。Claims 从不执行命令，也不证明报告的执行属实。支持仅覆盖记录的环境与时间，不代表当前性能；预置测试日志不是真实基准测试运行。
- **否定支持有明确范围。** 报告的零结果搜索只能支持其记录的语料与查询。每个显式导出入口必须有对应的内容清单摘要；验证和准入重新读取定位符及清单中的所有文件。这些检查既不重新运行搜索，也不证明普遍不存在或与决策完整范围之间的可机器检查关系。Research 的评估必须将所需的更广泛不存在性保持为未验证。
- **原始标识要求后端字节大小证据。** 大小未知、BOM 被剥离或解码失败时，无法检查片段或本地证据标识。大小相等不是文件系统快照，也不能锁定并发写入方。
- **Research 是有归属的证据，不是独立检查。** 本地检查比较内容摘要；依赖检查要求版本与符号字段，以及 manifest（元数据清单）、锁文件和入口文件标识，而不是独立解释导出与版本。外部证据检查 URL、版本、摘要字段及明显可变的 URL 片段，不抓取内容，也不独立认证其不可变性。
- **清单完整性依赖 Research 评估。** 解析器只清点显式证明表，不提取任意散文中的所有前提。Research 判定结论是否承重并报告遗漏；严格 JSON 验证不能证明这些判断。
- **报告是最新观察，不是审计历史或文件系统事务。** 域为每个片段保留最新尝试与报告。准入采样当前文件和角色记录，不锁定外部写入方。单片段互斥仅在进程内有效。
- **验证证据不是 GREEN 声明。** 实现的定向测试仍在评估中；本文不声明行为测试或真实组合覆盖已通过。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

非权威说明：源代码覆盖率仍待确认，根级资源释放顺序依赖独立的依赖项前置工作。不声明完整 GREEN 结果。

</details>
