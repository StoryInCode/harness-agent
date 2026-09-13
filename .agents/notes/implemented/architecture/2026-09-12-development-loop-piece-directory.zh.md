# Agent Note: 开发循环 piece 目录

Status: implemented

[English](2026-09-12-development-loop-piece-directory.md) | 中文

## 问题

`plans/` 规范语料包含 118 个 Markdown 文件，由 `plans/AGENTS.md` 中可机器检查的 `axiom` 块约束。这些公理指定了四个 shell 检查器——`check-piece-primitive.sh`、`check-piece-sections.sh`、`check-claim-citations.sh`、`check-done-pieces.sh`——但它们都不存在，因此没有任何公理得到执行。文档引用不存在的脚本不能执行任何约束，语料也因此发生偏离：一个 piece 的 `Package:` 缺少粗体标记，233 项章节违规和 105 项证明表格违规未被发现，格式权威 `PIECE-FORMAT.md` 与 `plans/AGENTS.md` 对状态取值的规定也不一致。

开发循环还需要将语料作为数据，而不仅是文字：审批节点必须渲染 piece 的场景，调度队列必须知道还剩哪些 piece，验证门禁必须验证 piece 结构。每个消费者都需要同样的解析，因此解析应归一个明确所有者负责。

## 决策

`@deepseek-ai/dsh-dev-loop-directory` 发布 `ctx.devLoopDirectory`，这是 Host 平面的 Service Provider，在配置的根目录下发现 piece 文件并返回经过验证的 `PieceRecord` 值。`root`、`maxLines` 和 `primitives` 是由 schemastery 验证的 `Config` 字段，均为可选，因此 `cordis.yml` 行可只设置一个字段，其余沿用默认值。

**语法是纯函数，与 I/O 分离。** `src/parse.ts` 不访问文件系统；`src/index.ts` 通过 `ctx.fs` seam 负责发现。两个调用方需要解析：在 `readText` 后调用的服务，以及已持有文本的验证门禁。纯函数也让测试套件不再需要临时目录，从而使逐文件 100% 覆盖率的成本可接受——已交付包的两个源码文件在语句、分支、函数及行上均达到 100%，没有 `v8 ignore` 注释。

**扫描返回部分结果，而不是全有或全无。** `scanSet` 返回 `SetScan { pieces, rejected }`：验证失败的文件成为 `PieceRejection`，集合的其余部分仍会返回。`getQueueCandidates` 从扫描的每个集合中选择有效 piece，`getPiece` 仅在请求 id 对应文件自身被拒绝时抛出解析错误，绝不指向调用方未询问的文件。`SET_NOT_FOUND` 和 `DUPLICATE_PIECE_ID` 仍然抛出，因为它们是请求本身的事实，而非某个文件内容的事实。

该策略替代了一个错误 piece 就会拒绝整个集合的全有或全无扫描。Reviewer 角色通过针对全部七个集合驱动服务，而不是只使用测试中的那个集合，发现了问题：七个中有六个无法扫描，`getQueueCandidates()` 抛出而不是返回候选，`getPiece('01.03')` 报告的解析错误指向 `01.01`。套件通过，是因为每个真实语料测试都限于唯一合规集合——“真实语料通过”意味着“我们检查的那 11% 通过”。格式错误的同级文件是有关语料的数据，不是无关调用方的异常；这也正是 linter 按文件报告而不是中止的原因。

**发现项携带所执行公理的严重程度。** `blocker` 通过抛出 `PieceParseError` 拒绝文件，该错误公开 `code`、`path` 及每项发现；`Reuse capture` 是唯一警告，因为 `R-piece-reuse-capture` 声明 `severity: warning`，而其他五个 piece 内容公理均为阻断项。单个发现类型携带 `severity` 字段，优于按严重程度分别设置并行数组；后者迫使每个消费者了解所有数组。

**章节遍历使用单调游标进行一次前向扫描**，因此缺少章节与章节换序由同一个循环发现。换序会报告那个按规范应靠后、却过早出现的章节，然后回退游标，使一次交换只产生一项发现，而不是一连串错误。

**扫描识别代码围栏。** 围栏代码块中的 `##` 行是内容，反引号和波浪线围栏均如此；未闭合围栏延伸到文件末尾，结束围栏允许长于开始围栏。这不是假设问题：piece 在 `## Contracts` 中嵌入 Markdown 和 TypeScript 模板，直接验证 piece 文本的门禁也会遇到同样输入。

**公理检查器使用本包，而不重新实现语法**，因此公理与执行它的运行时不会偏离。`scripts/check-pieces.ts` 通过 `findings` 字段将 `PieceParseError` 转回数据，所以无需修改 API 就能服务四个不同范围的检查器。只有证明表格的列规则留在脚本中，因为它是公理规则，而不是 piece 格式规则。

### `Directory`，不是 `Registry`

`docs/cookbook/adding-a-package.md` 将 `Registry` 保留给“动态的具名注册集合，包括查找、重复或优先级规则、生命周期和资源释放”，并将 `Directory` 定义为“公开条目及元数据，用于发现或选择”的服务。没有机制注册 piece；文件是被发现的。包、`ctx` 键和类在编写任何代码前就完成了重命名。

## 考虑过的替代方案

**使用 `mdast-util-from-markdown` 检测标题。** 它已是根 devDependency 和 `packages/client/ui-primitives` 的运行时依赖，仓库自己的门禁脚本也通过建立在其上的 `scripts/markdown.ts` 解析 Markdown。拒绝原因：`scripts/markdown.ts` 属于脚本平面，根据源码平面/产物平面规则不能从 `packages/` 导入，因此实际上不会复用任何内容；而 mdast 额外提供的正确性——setext 标题、HTML 块、缩进代码——在整个语料的测量结果中出现次数为零。跟踪围栏的扫描约二十行。一旦 piece 格式允许 setext 或 HTML 标题，这个选择就应改变。

**`remark` 配合 `unified-lint-rule` 和 `vfile-message`，** 即 remark-lint、MDX 和 Gatsby 使用的技术栈。它是真正的插件架构，适合必须让第三方贡献规则的情况。拒绝原因是约六个包和这里不需要的控制反转；不过 `vfile-message` 的严重程度字段确实启发了发现项模型。

**每个公理一个 shell 脚本，** 即 `plans/AGENTS.md` 指定的方式。当检查只需一行 `grep` 时有优势。拒绝原因是无法返回结构化发现项、无法携带严重程度，也无法在工具或门禁进程内复用。

**由 schemastery 验证的 YAML frontmatter。** 当头部语法扩展时有优势。拒绝原因是 `PIECE-FORMAT.md` 固定使用 `**Bold:** value ·` 文字头部。

## 后果

公理现在得到执行。在语料上运行检查器立即发现了阅读未发现的真实缺陷——`02.13` 使用 `Package:` 而不是 `**Package:**`——并量化了其余偏离。集合 00 的十三个 piece 通过全部四项检查；集合 01 至 06 没有通过，那些是 piece 中真实的公理违规，而不是解析器缺陷。

代价是循环的其余十二个 piece 都依赖这个包获取输入，以及这套语法属于本 fork 自己：piece 格式变更需要协调 `plans/AGENTS.md`、`PIECE-FORMAT.md`、规范章节列表和语料。

三个行为曾短暂地先于测试进入包——缩进代码围栏、只报告一次缺少头部标签而不是倾倒全部取值，以及 `dependsOn` 语法。Implementer 角色报告了缺口，没有让实现看起来已被覆盖；现在用例固定了全部三个行为。可测量的后果是：逐文件覆盖率此前只通过真实语料中格式错误的 `06-verification/06.20` 才到达 `dependsOn` 分支，因此门禁依赖语料缺陷；添加用例后，不使用语料也达到 100% 覆盖。规则确实改变了一个结果——`06.20` 的拒绝码从 `MISSING_REQUIRED_SECTION` 变为 `MALFORMED_PIECE_HEADER`，使 `check-pieces primitive` 从零项语料违规变为一项，指出真实缺陷。

有两个流程事实值得保留。解析器的首个实现写于任何测试存在之前，并使用不识别围栏的正则扫描标题；Research 角色通过与 `markdownlint` 的 `MD043` 对比发现缺陷。另一个事实是：Test Writer 角色仅收到规范，就产出了一套实现无需弱化任何断言便满足的测试——套件中仅有两个需要修改的地方，都是对增长中语料的硬编码枚举，即固定用例数量和固定 id 列表，由编写它们的角色发现。

## 延后工作

**语料并不合规，目录报告这一事实，而不是因此失败。** 集合 01 至 06 有 233 项章节违规和 105 项证明表格违规，所以扫描它们会返回零个 piece 及每个文件一项拒绝。这些是规范中真实的公理违规，随着循环推进到各集合逐个修正；目录的职责是报告，而不是等待修正。

**`DUPLICATE_PIECE_ID` 现在仅考虑有效 piece。** 被拒绝文件的内容中没有可信 id，因此格式错误文件与有效文件之间的冲突不会报告。这是有意缩小语料缺陷检查的范围，因为从未解析内容中猜测 id，比漏掉罕见冲突更糟。
