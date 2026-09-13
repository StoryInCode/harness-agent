# Agent Note: Web 命令 Session 快照

Status: implemented

[English](2026-09-11-web-command-session-snapshots.md) | 中文

## Problem

命令无需模型轮次即可追加持久生命周期记录。消息驱动的重放适配器必须虚构用户消息才能执行此行为，而进程内 Web 支架绕过了身份验证、公开参数解码和进程清理。

## Decision

[Web 命令适配器](../../../../snapshots/web/commands.snapshot.ts)从选定的规范 Session JSONL 提取命令名称和参数，并通过经过身份验证的 Remote 请求调用随附的 Web 配置。Session 创建使用公开控制器，不发送模型输入。适配器仅在进程正常关闭并排空存储后比较持久输出。

此决定具体落实了 [Session 语料库决定](2026-08-24-session-log-snapshot-corpus.zh.md)；该说明仍负责规范化、夹具代际和独立工作区预期。两项决定互不替代。

重启调度属于 manifest，因为 Session 无法记录发生在命令之间的进程边界。[命令操作元数据](../../../../packages/test-support/session-snapshot/README.zh.md)引用规范命令序号而不重复文本，因此跨越进程代际的重放仍只有一个权威输入序列。

## Alternatives considered

进程内命令调用无法证明随附 HTTP 路径。合成用户消息改变了受测行为。清理前读取持久数据可能观察到有效但不完整的写入队列。固定或预探测端口引入跨进程争用。

`dev-loop-command-recovery` Session 夹具是真实录制，而非虚构记录：每条命令都通过零端口上真实 `dsh --profile web` 进程的经过身份验证的 Web RPC 执行，重启以正常 SIGTERM 加同一私有主目录上的重新启动完成，规范 JSONL 是该持久化日志的字节规范化不动点。

## Invariants

- 子进程绑定零端口并发布就绪 URL；临时主目录和凭据仅属于该次启动。
- 身份验证 URL 和 Cookie 永不进入提交的夹具。
- 强制终止使测试失败，而不是证明输出已持久化。
- 命令不产生请求、用户消息、助手消息或轮次记录。
- 规范化 Session 标识保持不动点，工作区比较拒绝注入的意外文件。

## Consequences

纯命令场景无需调用模型提供方即可验证公开命令结果和规范持久记录。即使控制器不打开浏览器，原生 Session 锁扩展和 Web 客户端产物仍是启动前提。空请求头类别明确记录不存在模型提示和模式。
