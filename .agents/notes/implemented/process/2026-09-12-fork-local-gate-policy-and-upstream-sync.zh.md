# Agent Note: fork 本地门禁策略与上游同步

Status: implemented

[English](2026-09-12-fork-local-gate-policy-and-upstream-sync.md) | 中文

## 问题

本检出是 `deepseek-ai/deepseek-harness` 的 fork，上游变化很快：本笔记之前的 30 天有 4,023 次提交，仅 `tsconfig.host.json` 在 90 天内就有 571 次提交，`tsconfig.base.json` 有 391 次，`verify-package-readme-model-experience.ts` 有 316 次，`scripts/run-gates.ts` 有 251 次。fork 的任何改动只要编辑其中一个文件，几乎每次同步都会冲突。

两个具体需求使问题必须解决。fork 交付仅英文文档，因此 `verify-translation-pairing` 对每个 fork 本地包 README 都失败；上游要求每份文档都有中文对侧及 `.i18n.yaml` 一致性记录。此外，`packages/dev-loop/` 下的 fork 本地包需要路径别名和项目引用，而包目录名与 npm 名称不同时，`gen-tsconfig-paths` 无法生成它们。

两种简单应对都不可行。删除导致问题的门禁脚本，会在上游每次修改它时产生冲突，也失去主动运行检查的能力。手工维护接线修改，意味着每天多次、无限期地重新解决相同冲突，却没有记录说明 fork 究竟改了什么、为什么改。

## 决策

fork 行为放在上游没有的文件中，因为上游缺少的文件不会冲突。编辑上游所有的文件是最后手段，改动尽可能小，并加上标记。

`scripts/fork-gate-overrides.ts` 和 `scripts/fork-gate-overrides.manifest.json` 负责门禁策略。manifest（元数据清单）列出本 fork 不运行的门禁，并且**要求每项都有非空理由**，使无法解释的排除不会被误认为失误。格式错误的策略会抛出，而不是降级为“运行全部”，因为拼写错误不能静默恢复 fork 已移除的门禁，也不能移除它需要的门禁。`applyForkGatePolicy` 对调用方的门禁类型使用泛型，也从每个保留门禁的 `needs` 和 `after` 中剪除已移除 id，因为依赖不存在门禁会让依赖方永久无法满足前提。

聚合过滤只有一个上游所有的接入点：`scripts/run-gates.ts` 中 `gatesForMode` 的返回值封装。`translation-pairing` 是唯一被禁用的门禁；`pnpm run verify-translation-pairing` 仍可按名称直接运行。

目录生成器独立将每个所属页面扩展为各语言文件。manifest 的可选 `englishOnlySubsystemPages` 记录英文文件基名及非空理由，`resolveForkSubsystemPages` 向 `gen-cordis-catalog.ts` 提供必需文件。英文始终必需。每个未指定页面保留双语；策略项若未对应任何映射所有者则失败。第二个上游调用点是必要的，因为聚合过滤不能改变单个生成器的语言要求。`development-loop.md` 是声明的仅英文所有者。解析器、所有权、标记、类型链接和新鲜度检查没有禁用。`scripts/project-doc-site.spec.ts` 中的子系统导航断言使用同一组选择目标：英文行仍然必需，仅省略明确声明的中文对侧。独立负向探测确认，删除仅英文页面的英文行、普通英文行或普通中文行仍会失败。

上游所有文件中的每处 fork 本地修改都带 `FORK-LOCAL:` 注释，`FORK.md` 是完整清单：fork 所有文件、每项带标记修改及其无法避免的理由、禁用门禁和同步流程。`scripts/fork-diff.ts` 计算相对 `upstream/master` 的差异，将 fork 所有的新增文件（不会冲突）与修改的上游文件（实际发生冲突的部分）分开，并标出任何缺少标记的上游文件修改。它检查工作树，而不只是 `HEAD`，因为差异是磁盘文件的属性。

集成通过将上游合并进 fork 完成，绝不通过不断 cherry-pick 推进：合并会推进共同祖先，使 `git rerere` 重放每次解决方案；cherry-pick 不携带祖先关系，因此会无限重复，并破坏 `git diff upstream/master...HEAD` 作为差异度量的作用。`rerere.enabled` 和 `rerere.autoupdate` 已设置。`origin` 指向 fork，`upstream` 仅用于获取，其推送 URL 被有意禁用。

fork 本地包留在 `packages/` 内，而不是放到独立目录树。这是有意接受频繁变化的接线文件中的冲突，换取上游 39 个 `packages/*/*` 门禁覆盖 fork 代码，并使每次同步都反映上游变化对 fork 本地实现的影响。

### 为什么 `fork-diff` 报告而不失败

`--strict` 在存在未标记差异时以非零码退出，是合并后应运行的形式。默认形式报告并以零退出，因为针对上游文件的正常进行中功能工作，合理地会表现为未标记差异。首次运行发现 16 个存在差异的上游文件，其中 14 个属于无关的进行中工作。持续为红的信号会被忽略。

## 考虑过的替代方案

**删除 `verify-translation-pairing.ts`。** 拒绝原因：上游每次修改该文件都会冲突，并失去主动运行检查的能力。

**将 fork 的 README 加入 `scripts/translation-pairing.manifest.json`。** 拒绝原因：该 manifest 声明的约定覆盖“生成、指导性或本身就是双语”的文档，现有九项确实都属于这些类别。包 README 不属于其中任何一类，因此添加它会滥用豁免，并对 `FORK.md` 隐藏差异。

**将 fork 本地包移出 `packages/`，放入独立目录树。** 测量表明冲突成本更低——上游文件修改可从四处降至一处，因为 39 个门禁脚本及 `gen-tsconfig-paths` 硬编码了 `packages/*/*`，将不再看到 fork 代码，也就不再需要 `translation-pairing` 覆盖。所有者拒绝此方案，选择让上游门禁覆盖 fork 代码，并将每次合并视为有意的开发工作，用于揭示上游变化如何影响 fork 实现。

**静默跳过每个缺少的中文目录页面。** 拒绝原因：意外删除已有配对与有意选择仅英文所有者将无法区分。显式页面选择保留这一区别，并继续对照生成器的实际所有权映射检查。

**使用独立仓库作为依赖。** 不修改本检出，但需要独立 CI、版本管理，以及每次本地修改后的发布或链接步骤。

**由 fork 所有的生成器幂等地重新插入接线修改。** 对 tsconfig 条目仍在考虑；它将手工补丁变为重新运行一个命令。尚未构建，因为只有一个 fork 本地包时，修改仅有两行。

## 后果

门禁及页面语言选择是必须附带理由的数据。[FORK.md](../../../../FORK.md) 清点新增且带标记的集成点。私有 fixture（测试前置数据）测试验证策略解析和依赖剪除，语言选择测试则保留英文及未指定的双语所有者，并拒绝过期策略项。差异问题可以按需回答，而不必重新推导。

代价是 fork 完全不再通过聚合运行 `translation-pairing`，不只是对 fork 本地文件如此：机制作用于整个聚合，因此上游文档丢失中文对侧在这里不会被发现。重新启用只需删除 manifest 中一行。fork 接受接线、目录集成和导航文件反复冲突，作为上游门禁覆盖的代价。带标记的策略调用点和文档所有者注册必须在上游合并后保留。

`FORK.md` 和 `FORK-LOCAL` 标记的有效性取决于维护纪律；`fork-diff --strict` 机械检查它们是否完整，除非有人运行，否则它只是建议性检查。

## 延后工作

已提交的 `pnpm-lock.yaml` 与已提交的 `pnpm-workspace.yaml` overrides 不一致，因此干净检出上的 `pnpm install --frozen-lockfile` 会以 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` 失败。这早于 fork 的修改，已记录在 `FORK.md` 中。

## 相关记录

本笔记部分取代两个上游决策；它们保持有效，因为它们对上游和本 fork 仍运行的每个门禁仍具权威性：

- [双语文档与配对门禁](2026-07-02-bilingual-docs-and-pairing-gate.zh.md) — 建立本 fork 停止执行的配对要求。其理由不变，改变的仅是本 fork 是否参与。
- [自动翻译配对合并](2026-08-08-automatic-translation-pairing-merges.zh.md) — 配对自动化，现在无法从本 fork 的聚合到达。
- [质量门禁](2026-06-11-quality-gates.zh.md) — 本策略过滤的门禁架构，以及为何 `gatesForMode` 是正确的单一封装入口。

交叉链接按设计仅为单向。添加反向链接会为了 fork 本地事项修改上游所有文件，这恰是本笔记要避免的冲突来源；`FORK.md` 和本笔记代替它承担 fork 索引的作用。
