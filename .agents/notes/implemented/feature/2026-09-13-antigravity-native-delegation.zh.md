# Agent Note: Antigravity 原生委派

Status: implemented

[English](2026-09-13-antigravity-native-delegation.md) | 中文

## 问题

Antigravity 订阅并非 Google Cloud Vertex 凭据。将 Vertex Application Default Credentials 视为订阅认证会提供错误的计费路由，也无法复用已安装的 `agy` 登录。Antigravity 文档中的无头接口运行的是拥有独立工具和历史记录的完整 agent（智能体），而非可互换的 LLM（大语言模型）传输层。

## 决策

可选的 [Antigravity 提供方](../../../../packages/subagent/subagent-antigravity/README.zh.md) 将一个独立任务委派给已安装的 CLI。它遵循[产品 subagent 的所有权规则](2026-08-04-claude-code-and-codex-subagent-backends.zh.md)：Host 注册提供方，单独选择的用户 preset 授予工具，父级接收最终结果，而非在模型选择器中新增提供方。现有 Claude Code 和 Codex 决策仍是这两项集成的权威说明。

认证和原生工具权限仍由 `agy` 管理。DSH 既不提取钥匙串令牌，也不请求非官方订阅 OAuth。配置的可执行文件和可选模型决定使用的原生产品；默认配置不绕过权限检查。单条 NDJSON stdin 消息避免将任务文本放入进程参数。有界 stdout 提供恰好一个成功结果，只有进程正常退出且受管进程树完成清理后才会接受。原生中间事件和 stderr 不进入父级记录。

## 考虑过的替代方案

直接的订阅适配器可以保留 DSH 的工具循环，但需要非官方 OAuth 访问，而 [Antigravity 条款](https://antigravity.google/terms)明确限制此类访问。原生委派保留已安装 CLI 的认证方式，无需实现该协议。Vertex 是独立的 Google Cloud 产品，不能作为 Antigravity 订阅的回退方案。

## 影响

父级保留所选模型。Antigravity 仅接收委派任务和父级工作区，不接收 DSH 历史记录、工具、persona 或递归保证。其原生权限和设置控制工作区修改；取消不会回滚已完成的编辑。原生权限拒绝仍可能返回解释性的成功响应，这不代表所请求的任务已完成。

依赖项是已安装的 CLI，而非捆绑的 SDK。兼容性遵循文档中的 `stream-json` 协议，并要求可用的原生登录。直接访问订阅模型需要单独审查提供方与授权设计；给 Vertex 改名或将 CLI 的 agent 循环伪装成 LLM 都不是替代方案。
