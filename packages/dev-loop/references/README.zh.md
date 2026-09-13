---
description: "检查开发循环的来源定位信息并保留报告归属，不声称已验证实际查阅。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-references

[English](README.md) | 中文

## 概述

对照本地文件检查 piece 的 References，并保留委派历史中可获得的确切报告身份。区分来源缺失与缺少查阅者证据。重启后读取最新的持久化观察结果，并在修改 piece 后重新检查。来源可解析或报告可关联，均不能证明实际查阅或声明为真。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 服务发布 `ctx.devLoopReferences`。将其服务行与 Directory、Roles、文件系统及 storage-domain provider 组合在同一 Host 中；本包不是可安装的 profile bundle，也不是模型工具。

### 配置

部署方提供每个字段。数值限制必须是正的安全整数，观察结果预算必须容纳最小错误封装；没有部署默认值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `repositoryRoot` | 必填 | 本地代码定位信息及规范化包含检查使用的显式仓库根目录。 |
| `maxPieceBytes` | 必填 | 本所有者读取的完整解码 piece 文本的 UTF-8 字节上限。 |
| `maxSourceBytes` | 必填 | 完整解码来源文本的 UTF-8 字节上限。 |
| `maxObservationBytes` | 必填 | 完整 `JSON.stringify(observation)` 的 UTF-8 字节上限，包含错误和元数据。 |
| `maxReferences` | 必填 | 接纳的定位信息数量上限，而不只是表格行数；超限使观察结果无效，但不截断条目。 |

### 读取与验证

调用 `verifyReferences(pieceId, signal)` 以读取、检查并持久化观察结果，然后接收独立副本。`getProvenance(pieceId)` 返回最新持久化观察结果的独立副本；不存在时返回 `undefined`，不会重新检查文件。没有接纳调用方自编验证记录的 API。

观察结果将结构有效性与查阅置信度分开。来源状态为 `resolved`、`missing`、`invalid` 和 `not-checked`；归属状态为 `linked-report`、`unverified` 和 `contradicted`。所有情况下查阅状态均为 `unverified`。错误和限制解释尚未解决的检查，不将缺少证据视为编造。

### 观察结果

在仓库根目录运行所有者本地测试套件，不覆盖已记录的 RED 产物：

```sh
pnpm exec vitest run packages/dev-loop/references/tests --testTimeout=30000 --hookTimeout=30000
```

预期结果是七个文件和 106 项测试通过：历史基线的 84 项、21 项补充用例，以及一项单独冻结的嵌套定义回归。断言包括持久化重开后保留独立观察副本，以及真实子报告声称使用过来源时查阅状态仍未验证。[基线](tests/RED.md) 单独记录 Test Writer 的 RED 执行，与此预期结果分开。

### References 语法

使用一种受支持的表格格式，并严格遵守以下列顺序。列标题中的行内 Markdown 和空白会被规范化；缺少的解释字段保持缺失，不进行猜测。

- `Source | Role/preset that inspected it | Question it answered | Direct inspection or reported | How it was used`
- `Source | Role/preset and provenance | Decision informed`
- `Source | Question answered | Provenance`
- `Source | Provenance | Decision informed`
- `Source | Role/preset | Provenance | Decision informed`

纯文本 `None.` 或 `No references.` 声明记录显式空观察结果。不支持或重排的列格式、重复的必需列及格式错误的行均为无效，而不是空表。Directory 可能在 References 获得 piece 前以自身解析错误拒绝缺少 References 章节的文件；该错误直接传播，不生成虚构观察结果。

### 来源与归属策略

行内代码中的本地路径相对于 `repositoryRoot` 解析；相对 Markdown 链接相对于 piece 所在目录解析。规范化包含检查涵盖中间符号链接。绝对路径、目录、逃逸目标及不支持的定位语法会被拒绝。可选的 `:N` 和 `:N-M` 后缀要求正数、顺序正确且在解码文件行数范围内。片段会被保留，但不进行语义验证。HTTP(S) 定位信息保持 `not-checked`；References 不抓取它们。

每个 AST 定位信息保留所在行的来源和归属文字。链接标签内的代码片段属于显示文字，不是第二个定位信息。已解析来源的指纹覆盖整个解码文件，而非仅选中行。SHA-256 对文件系统解码后完整文本的 UTF-8 编码计算散列，不规范化换行；它不是原始未解码字节的指纹。

使用 `delegation:<UUID>` 进行确切归属关联。References 仅查询 `devLoopRoles.getDelegations(pieceId)`：不在该 piece 历史中的记录均为不可用，无论它未知还是属于其他 piece。关联要求记录已结束且具有实际子 Session；保留已记录角色、可选的实际 preset、终态及限制。仅有请求的记录不能证明报告已执行，失败或中止报告仍是附有限制的部分结果。

显式 `role:<canonical role>` 和 `preset:<id>` 标记声明身份；四列格式中整个独立 `Role/preset` 单元格等于 `Research`、`Test Writer`、`Implementer` 或 `Utility` 也声明该角色。可见的不匹配为 `contradicted`。声明 preset 但没有已记录 preset 时仍为 `unverified`。其他文字原样保留，不启发式提取身份。关联和直接查阅声明均不能证明作者使用过任何来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

Directory 提供 piece 路径和元数据，不提供 Markdown AST。References 通过文件系统解析和流式操作读取，使用 `mdast-util-from-markdown`、`mdast-util-gfm` 和 `micromark-extension-gfm` 解析 Markdown/GFM，并负责定位信息与归属策略。`unist-util-visit` 递归收集文档全局的引用链接定义，包括嵌套在引用块中的定义；同一标识符采用首次定义。运行时代码不导入仅供仓库脚本使用的 Markdown 模块。

References 拥有 `dev_loop_references` 单布局存储域，使用 Zod 验证权威记录，并将验证到持久化发布的过程串行化。无效存储记录和写入失败会被拒绝，不会成为可信观察结果。取消阻止新检查；已接纳的写入在存储域生命周期内完成。资源释放会等待已接纳操作结束，再关闭存储。消费者使用本服务，而不重新打开或复制其存储域。

不发布运行时不变量配套模块：保留的观察结果只有一个权威存储域，来源变化是允许的，而不是必须与存储指纹相等的独立维护值。重新验证产生新观察结果，而不是通过不变量声称文件永不变化。[公开 DTO](src/types.ts) 定义独立返回值。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Directory API](../directory/src/index.ts) — piece 查找与解析拒绝。
- [Roles 记录](../roles/src/types.ts) — 请求与实际委派事实的区别。
- [存储域](../../storage/storage-domain/README.zh.md) — 权威验证与持久化。
- [References 决策](../../../.agents/notes/implemented/architecture/2026-09-13-references-observation-not-inspection.zh.md) — 理由与必需验证。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本 Host 服务不注册模型工具、提示词贡献或 Session 事件，也不增加模型输入 token。

#### KV Cache 影响

这里的内容不进入模型请求，因此本包不影响 provider 的 KV Cache 复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

观察结果描述有界检查，而不是实际查阅的真伪判定器。

- Directory 在查找时进行整文件读取；References 限制仅约束自身后续读取，不约束 Directory 缓冲。
- piece 超限会在发布观察结果或摘要前拒绝。来源超限保留无效条目，不生成来源摘要。完整观察结果超限会拒绝持久化；证据不会被静默截断。
- piece 指纹标识已检查文本，不证明编辑后仍然新鲜。修改 piece 后需重新检查；今天缺少文件不能证明它从未存在。
- 不抓取 URL，不语义检查片段，关联作者身份不证明来源使用或声明为真。独立来源访问证据需要单独所有者。
- Claims 和 Gates 是后续消费者，不包含在本包中。piece 00.08 不引入新模型消费者、Session 事件，也不承诺录制 Session 快照；后续面向模型的消费者必须通过现有工具运行时记录渲染结果，并添加对应的无密钥场景。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

[Test Writer 基线](tests/RED.md) 负责不可变的 RED 命令及证据限制。集成协调者报告最终覆盖率运行中七个文件的 106 项测试通过，五个生产模块各自的语句、分支、函数及行覆盖率均为 100%。本次文档任务没有执行该运行。协调者还报告最终依赖闭包及包 TypeScript 构建通过，整包 lint 零警告/错误，独立 tsdown JavaScript/声明产物构建通过。最终严格源码测试检查退出码为 2，恰有 98 项 vendored 诊断，没有包诊断；这不等于全局类型检查通过。主检出 Roles 策略集成、共享生成器及根 Typert 构建流程仍待完成；独立构建不验证该流程。应将转述的 GREEN 结果与历史 RED 证据区分。

</details>
