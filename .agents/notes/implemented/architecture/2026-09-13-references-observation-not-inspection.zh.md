# Agent Note: References 观察结果不能证明实际查阅

Status: implemented

[English](2026-09-13-references-observation-not-inspection.md) | 中文

## 问题

今天可解析的来源不能证明报告作者查阅过它。委派记录能标识报告生产者，却不一定记录来源使用。将这些独立事实合并为已验证查阅标志，会让看似合理的文字获得未经证明的权威；将缺少证据视为编造则会产生相反但同样没有根据的断言。

## 决策

[References 服务](../../../../packages/dev-loop/references/README.zh.md) 将本地定位检查与报告归属作为独立观察结果保留。查阅状态保持未验证。确切的委派 UUID 仅通过 Roles 实际的 piece 范围 `getDelegations(pieceId)` 历史关联；未知及属于其他 piece 的 id 同样不可用。已结束记录必须具有实际子身份。已记录角色、可选的实际 preset、终态及限制，与请求标签和报告文字保持区别。

显式角色/preset 声明可以与可见身份矛盾，但缺少实际 preset 时仍为未验证。失败和中止报告保留其限制。关联报告和直接声明均不能证明来源使用。Claims 和 Gates 将决定尚未解决的证据如何影响后续工作；References 不决定声明真假。

References 拥有 `dev_loop_references` 单布局存储域、Zod 验证及串行化的验证/写入生命周期。后续持久化及消费者使用本所有者，而不是第二个来源存储。持久化成功后才发布；即使调用方取消，已接纳写入也会在存储域关闭前结束。重新打开的观察结果标识已检查的 piece 文本，不证明后续编辑后仍然新鲜。

维护中的 `mdast-util-from-markdown`、`mdast-util-gfm` 和 `micromark-extension-gfm` 依赖负责 Markdown/GFM 解析。`unist-util-visit` 收集整篇文档中的引用链接定义，包括引用块，采用首次定义优先的语义；仅扫描根节点会遗漏有效的全局定义。协调者报告查阅了已安装的 MIT 许可 `unist-util-visit` 5.1.0 manifest（元数据清单）及 `lib/index.js` 中的前序遍历文档和实现，并报告单独冻结的嵌套引用块 RED 回归在递归收集后通过。本次文档任务直接查阅了包依赖声明和解析器用法，没有查阅外部实现或执行回归。

References 负责接纳的表格格式、定位规则与归属语义，不导入仅供仓库脚本使用的模块。其自身流式读取执行显式字节预算；Directory 现有的整文件查找不受这些限制约束。完整解码文本指纹及完整 JSON 预算防止部分证据伪装为完整证据。

## 有限范围的取代关系

没有先前的 References 所有者被取代。[Directory 决策](../../implemented/architecture/2026-09-12-development-loop-piece-directory.zh.md) 保持有效：它仍负责 piece 发现、章节验证、解析失败及最小 PieceRecord。它对简单标题检测拒绝使用 mdast，并不意味着拒绝对 References 表格使用维护中的 GFM 解析。本决策不替换任何 Directory 决策或解析器。

[维护中依赖决策](../../implemented/process/2026-07-26-dependencies-over-hand-rolling.zh.md) 保持有效并直接适用，没有被取代。[fork 本地门禁策略](../../implemented/process/2026-09-12-fork-local-gate-policy-and-upstream-sync.zh.md) 也保持有效：这些显式请求的双语文档不会重新启用聚合配对检查，也不改变其他 fork 本地页面的决策。对有效的 proposed、implemented 和 rejected 笔记进行限定搜索后，没有发现可合并或归档的现有 References 来源所有者。Directory 和 fork 策略笔记保留英文正文，仅添加语言切换链接与中文对侧；其决策保持不变。冻结归档保持不变。

## 考虑过的替代方案

**信任报告文字，或将文件存在等同于实际查阅。** 对非正式人工笔记足够，但不足以支持自动化证据决策：两者都可能存在而没有实际来源使用。保留声明，不将其升级为事实。

**通用来源关系图。** MAIN piece 转述 Research 对有日期的 W3C PROV-DM 概览及选定介绍章节的查阅，没有记录 preset，也没有复用代码。它对归属、委派和使用的区分为本决策提供依据；本次文档任务没有独立查阅该外部来源。跨系统来源追踪会让通用图变得有用，但当前消费者需要确切报告关联和显式不确定性，而不是图框架。

**可信来源访问插桩。** 当独立观察的来源使用成为产品要求时，它能提供更强证据。但它需要单独负责的观察/事件路径和测试；验证时读取文件不能追溯补足该证据。

**按竖线拆分原始表格文字。** 这避免解析器依赖，却会误解 Markdown 代码和链接嵌套。维护中的 AST 解析让本包负责真正的应用规则，而不是另一套 Markdown 语法。

**使用 `mdast-util-to-string` 替换文本渲染器。** 协调者报告查阅了 4.0.0 版本，发现它丢弃 `break` 节点，而 References 将其渲染为空格。这种替换会改变规范化标题的接纳行为，而不只是删除自有代码，因此不添加该依赖。只有在明确决定修改语法并提供相应测试后才重新考虑。

## 验证

[冻结的 Test Writer 基线](../../../../packages/dev-loop/references/tests/RED.md) 和 [DTO](../../../../packages/dev-loop/references/src/types.ts) 定义必需行为。基线报告五个文件中的 84 项行为失败，而不是缺少导入失败；这是 Test Writer 证据。集成协调者报告最终覆盖率运行通过，涵盖七个文件的 106 项测试：未改动的历史 84 项、21 项补充用例，以及一项单独冻结的嵌套定义回归。五个生产模块各自的语句、分支、函数及行覆盖率均为 100%。报告的命令为 `pnpm exec vitest run packages/dev-loop/references/tests --testTimeout=30000 --hookTimeout=30000 --coverage --coverage.include='packages/dev-loop/references/src/**/*.ts' --coverage.reportsDirectory=/tmp/references-final-coverage --reporter=verbose --reporter=json --outputFile.json=/tmp/references-final-GREEN-vitest.json`，退出码为 0，执行日志为 `/tmp/references-final-GREEN.log`；这些是本地证据路径，不是已提交产物。

协调者报告解析器仅移除由维护中的解析器及递归定义收集保证不可能发生的图片 alt 和引用定义回退，以局部断言替换，同时保留将 break 渲染为空格的行为。协调者报告最终 `tsc -b` 依赖闭包及 `tsc -p` 包构建通过，整包 lint 零警告/错误，独立 tsdown JavaScript/声明产物构建通过，输出位于 `/tmp/references-final-build`。最终严格测试程序退出码为 2，在涵盖 106 项测试的检查中恰有 98 项 vendored 诊断，没有包诊断，记录于 `/tmp/references-final-strict-typescript.log`；这不等于全局类型检查通过。这些路径是本地证据，不是已提交产物。本次文档任务没有执行这些行为/类型/构建命令。主检出中新 Roles 策略、共享生成器及根 Typert 流程的集成仍由父 agent 负责，尚待完成；独立 tsdown 产物不能证明该流程成功。

报告通过的套件覆盖受支持及格式错误的表格、显式空声明、规范化包含检查、有效行范围、多字节限制、确切实际关联、矛盾身份、缺少证据、真实说谎子报告、独立副本持久化重开、无效权威记录、写入失败及资源释放顺序。piece 超限不发布摘要；来源超限不生成来源指纹；完整观察结果超限拒绝而不截断。验证使用基线的可复现命令及其 30 秒测试/hook 预算，不覆盖 RED 产物。

piece 00.08 不增加模型消费者、提示词注入、Session 事件，也不承诺录制 Session 快照。后续面向模型的消费者必须通过现有工具运行时记录渲染结果，并添加对应的无密钥场景。

## 后果

规范化包含检查不能证明历史存在或实际来源使用。不抓取 URL，也不语义检查片段。本所有者策略不约束 Directory 缓冲；编辑会使已检查指纹过期。即使 References 准确报告限制，忽略限制的消费者仍可能歪曲证据。

复用候选：将结构观察与认知置信度分开。当前用于 References DTO 及冻结行为基线；Claims 是潜在消费者。泛化需要另一个已实现消费者及独立来源使用所有者。包级验证支持这种分离；缺少这些额外消费者与观察时，泛化仍未得到验证。可迁移的教训是精确命名证据证明了哪种关系，而不是暴露通用成功标志。
