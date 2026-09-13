---
description: "开发循环任务块目录（ctx.devLoopDirectory），供维护者发现、解析并依据 plans 公理验证 plans/pieces 规格 Markdown。"
kind: "package-reference"
---

# @deepseek-ai/dsh-dev-loop-directory

[English](README.md) | 中文

## 概述

使用本包读取开发循环任务块语料。它在配置根目录下发现任务块规格文件，解析各文件的头部和章节，并依据 `plans/AGENTS.md` 的 `axiom` 块验证，为每个文件返回 `PieceRecord`。读取经过 `fs` seam，绝不使用 `node:fs`，因此沙箱或远程后端控制每次文件访问。Markdown 语法是纯函数，因此验证检查可验证已有文本而不触及磁盘。这仅是 Host 侧状态：不注册工具、提示词或会话事件，模型永远看不到它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将其作为 Host 服务行挂载，通过 `ctx.devLoopDirectory` 读取语料。

### 配置

每个字段都是可选的；`cordis.yml` 行可设置一个字段并继承其余值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | `plans/pieces` | 包含集合目录的目录，相对于文件系统后端基点。 |
| `maxLines` | `280` | 包含上限的行数限制，对应 `R-piece-size` 公理。 |
| `primitives` | `plans/AGENTS.md` META AXIOM 的 18 个值 | 封闭的 Harness 原语词集；声明其他值的任务块会被拒绝。 |

### 服务 API

```text
ctx.devLoopDirectory.validate(filePath, content)        // pure; throws PieceParseError on a blocker
ctx.devLoopDirectory.scanSet('00-dev-loop', signal)     // SetScan { pieces, rejected }
ctx.devLoopDirectory.getQueueCandidates(setName, signal) // pieces declaring todo or pending
ctx.devLoopDirectory.getPiece('00.01', signal)          // rejects PieceNotFoundError when absent
ctx.devLoopDirectory.listSets(signal)                   // set directory names under the root, sorted
```

可选调用方信号到达根、集合和 `done/` 路径解析，以及列表和读取。每次解析结算后，服务在启动下一次文件系统请求前检查取消。

`scanSet` 合并集合目录与其 `done/` 子目录，因为 `R-done-pieces-moved` 公理将已完成任务块移到那里。因此，已完成任务块仍可作为另一任务块的依赖解析，而 `getQueueCandidates` 将其排除在分派之外。

`listSets` 仅返回根的直接子目录：旁边的文件不是集合，集合自己的 `done/` 位于更深一层并属于该集合。**空**根返回 `[]`，这是空语料的诚实答案；**缺失**根以携带 `FS_NOT_FOUND` 和绝对路径的 `FsError` 拒绝，因为将配置错误理解为“没有工作”会让每个 Consumer 静默闲置。`getQueueCandidates` 和 `getPiece` 通过同一方法枚举，因此集合发现只有一个所有者，不会漂移。

### 部分结果，而非全有或全无

`scanSet` 返回 `SetScan { pieces, rejected }`。验证失败的文件成为 `PieceRejection { path, code, findings }`，集合其余部分仍返回。一个格式错误的同级文件绝不拒绝调用方请求的任务块：坏文件是关于语料的数据，而不是属于无关读取者的异常，这也是 linter 按文件报告而非中止的原因。

`getQueueCandidates` 从扫描的每个集合的有效任务块中选择，`getPiece` 仅当请求 id 自身文件被拒绝时才引发解析错误——绝不指名调用方未请求的文件。两种情况仍会抛出，因为它们是关于请求而非单个文件内容的事实：集合名称没有匹配目录时的 `SetNotFoundError`，以及两个文件声明同一 id 时的 `DuplicatePieceError`。

拒绝项的 id 从文件名派生，因为解析失败文件的内容中没有可信 id。

### 验证严重性

发现项携带其强制执行公理的严重性。`blocker` 通过抛出 `PieceParseError` 拒绝文件，公开 `code`、`path` 和每个 `finding`。`warning` 记录在返回记录的 `warnings` 数组中，不拒绝文件。

| 发现代码 | 严重性 | 条件 |
|---|---|---|
| `MALFORMED_PIECE_HEADER` | blocker | 没有 `# NN.MM — Title` 行、缺失 `**Label:**`、队列不是正整数，或 `Depends on` 条目不是 `NN.MM` id。 |
| `PIECE_SIZE_EXCEEDED` | blocker | 物理行数超过 `maxLines`。 |
| `MISSING_REQUIRED_SECTION` | blocker | 缺失阻塞级必需章节，或规范顺序中较后章节出现在必须先于它的章节前。 |
| `INVALID_HARNESS_PRIMITIVE` | blocker | 声明的原语不在 `primitives` 中。 |
| `INVALID_PIECE_STATUS` | blocker | 声明状态不是 `todo`、`pending`、`done` 或 `blocked`。 |
| `MISSING_RECOMMENDED_SECTION` | warning | 缺失 `## Reuse capture`，其公理声明 `severity: warning`。 |

按一个规范顺序识别十一个章节。十个是阻塞级必需项；`## Reuse capture` 是唯一警告。列表之外的 `##` 标题被忽略，因为任务块可带额外章节。代码围栏内以 `##` 开头的行是内容，不是标题。

<a id="understand-the-implementation"></a>
## 理解实现

`src/parse.ts` 拥有语法且没有 I/O：它拆分行、读取首个标题前的带标签头部区域，然后使用单调游标一次遍历 `##` 标题，同时跟踪代码围栏区域，因此同一次扫描即可识别缺失章节和顺序颠倒章节。`src/index.ts` 拥有发现：通过 `ctx.fs` 解析并列出目录，保留匹配 `NN.MM-<kebab-slug>.md` 的基本文件名，读取各文件并委托解析器。

`Directory` 是 `docs/cookbook/adding-a-package.md` 为公开条目和元数据以供发现或选择的服务定义的角色词。没有任何对象向此服务注册任务块，因此称为 `Registry` 会误命名。

**运行时 invariant：**不发布配套入口。本包没有可由两个独立观察报告不同结果的关系——它返回的每项事实都在一次遍历中从一个文件文本派生，因此差异会是其自身规格已经覆盖的解析器缺陷。

## 模型体验 <a id="model-experience"></a>

无，因为此 Host 侧目录不注册工具、提示词或会话事件。

#### KV Cache 影响

没有内容进入模型请求，因此 provider 缓存复用不受影响。

## 已知限制与延后工作 <a id="known-limitations-and-deferred-work"></a>

- **仅识别 ATX `##` 标题**——setext 下划线标题不是章节。只有语料不包含这种标题时才安全；引入它的任务块会被当作缺失章节验证。
- **不依据引用文件检查参考表行号范围**——解析器确认 `## References` 章节存在，但不打开其引用路径，也不验证行号范围可解析。来源验证是独立 Consumer 的职责。
- **不公开解析后的参考行**——需要表格列的 Consumer 必须重新解析章节正文，因为当前没有调用者需要这些列，`PieceRecord` 在有人需要前保持最小。
- **`validate` 通过抛出报告阻塞项，通过返回报告警告**——同一概念有两个通道。统一的 `{ record, findings }` 返回可让调用者一次报告所有文件问题；保留分离是因为规格将错误代码写为失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

规范章节列表及严重性映射是 `src/parse.ts` 中的模块常量，镜像 `plans/AGENTS.md` 的 `axiom` 块：五项阻塞公理和一项 `severity: warning` 公理。在那里新增、修改公理或调整严重性时，修改常量并添加对应的拒绝／接受测试用例；解析器其他部分无需移动。

标题遍历有意不基于仓库共享的 `scripts/markdown.ts` mdast 辅助模块。根据源码平面／产物平面规则，`packages/` 不能导入脚本平面模块，因此此处跟踪围栏的扫描是有意识地重复约二十行，而非疏忽。将 `mdast-util-from-markdown` 作为包依赖是替代方案；当任务块格式接受 setext 或 HTML 标题时，它就成为正确选择——本文编写时，整个语料中测得此类标题出现零次。

</details>
