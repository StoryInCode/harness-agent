# 开发循环

[English](development-loop.md) | 中文

## 概要

发现任务块规格、请求受保护的状态变更，并委派保留文件和持久化报告的专业工作。本参考拥有 [packages/dev-loop](../../packages/dev-loop/README.zh.md) 的共享类型和 Cordis API。批准、准入、worktree 分配和角色委派各有独立所有者。持久化委派历史不会使生命周期转换持久化，也不提供完整的自主开发循环。

## 目录

- [目录值](#directory-values)
- [生命周期状态](#lifecycle-state)
- [人工决定](#human-decisions)
- [分派请求](#dispatch-requests)
- [Worktree 分配](#worktree-assignments)
- [角色委派记录](#role-delegation-records)
- [完成与事件](#completion-and-events)
- [失败与取消](#failure-and-cancellation)
- [Cordis API](#cordis-surface)
- [开发备注](#dev-note)

-----

<a id="directory-values"></a>
## 目录值

[目录类型声明](../../packages/dev-loop/directory/src/types.ts)定义解析后的记录和逐文件验证结果。目录配置和接受的文件语法属于[目录包](../../packages/dev-loop/directory/README.zh.md#use-this-package)。

| 类型 | 含义 |
|---|---|
| `PieceStatus` | 封闭状态联合：`todo`、`pending`、`done` 或 `blocked`。目录记录报告文件声明的状态，而不是生命周期服务的当前内存。 |
| `PieceMetadata` | 头部元数据：点分 id、标题、集合、集合内队列位置、依赖 id、状态、Harness 原语和所属包。 |
| `PieceRecord` | 已验证元数据，加上源码路径、物理行数、摘要、提取的 `PieceScenario` 值和非阻塞警告。 |
| `PieceScenario` | 一条提取的 Given/When/Then 场景，按文档顺序包含 `given`、`when` 和 `then` 文本。 |
| `PieceFinding` | 机器可读的 `PieceFindingCode`、`PieceFindingSeverity`（`blocker` 或 `warning`）和说明。阻塞项拒绝文件；警告随接受的记录返回。 |
| `PieceRejection` | 被拒绝的路径、首个阻塞代码和全部发现。 |
| `SetScan` | 按队列位置再按 id 排序的已接受 `pieces`，以及按扫描顺序排列的 `rejected` 文件。 |

扫描合并集合目录及其 `done/` 子目录。格式错误的文件作为拒绝项保持可见，不会扣留有效的同级文件；缺失集合、已接受记录中重复的 id 和文件系统失败仍会拒绝请求。单任务块查询区分 id 不存在与其文件被拒绝。队列候选仅包含有效的 `todo` 和 `pending` 记录；选择本身既不证明依赖完成，也不证明已批准。

<a id="lifecycle-state"></a>
## 生命周期状态

生命周期服务在挂载期间一次性装入有效记录。`getStatus` 读取已提交内存，而不是重新扫描目录；外部编辑不会刷新它。被拒绝文件保留解析错误，不会取得状态。

`LEGAL_TRANSITIONS` 允许 `todo → pending`、`pending → done`、`pending → blocked` 和 `blocked → todo`。`done` 没有出边。`transition` 要求预期状态，并在异步工作前认领任务块；过期或竞争认领会拒绝。完成操作进行期间，读取者仍看到已提交状态。非完成转换仅改变内存，因此逻辑上的 `pending` 可与声明 `todo` 的磁盘头部并存。

<a id="human-decisions"></a>
## 人工决定

[批准结果声明](../../packages/dev-loop/approval/src/types.ts)将 `ApprovalDecision` 定义为 `accept`、`question` 或 `change`，将 `PresentPieceResult` 定义为请求的 `pieceId`、显式 `decision` 和可选的去除首尾空白的 `feedback`。[批准包](../../packages/dev-loop/approval/README.zh.md)拥有展示、精确选择验证、在线根调用要求和源码版本检查。只有接受才尝试 `todo → pending`；它不创建持久化授权，也不限制生命周期服务的直接调用者。

<a id="dispatch-requests"></a>
## 分派请求

[队列声明](../../packages/dev-loop/queue/src/types.ts)将 `QueueRequest` 定义为任务块 id、调用方取消信号和接收已捕获 Agent 与组合信号的启动回调。`QueueTicket` 包含任务块 id、结果 promise 和需等待的取消方法；它是操作句柄，不是 JSON 记录。`QueueEntry` 是独立的标量快照，包含规范优先级、准入时间、queued/starting/running 状态和可选子级 SessionId。[队列包](../../packages/dev-loop/queue/README.zh.md)拥有准入、排序、依赖唤醒、预留生命周期和清理失败语义。它不选择 provider，也不从批准公告创建请求。

<a id="worktree-assignments"></a>
## Worktree 分配

[Worktree 声明](../../packages/dev-loop/worktree/src/types.ts)将 `AssignWorktreeRequest` 定义为任务块 id、调用方目录和取消信号。`WorktreeAssignment` 记录带品牌的 `WorktreeAssignmentId`、已验证的 `GitCommit` 基点、主线和 worktree 路径、任务块 id，以及 created/borrowed 所有权。这份保留记录描述分配，并非其文件或 HEAD 保持不变的实时断言。`WorktreeRetirement` 区分移除与因目录树被借用、存在修改或 HEAD 改变而保留。[Worktree 包](../../packages/dev-loop/worktree/README.zh.md)拥有分配、仓库身份、命令静止和保守退役。它既不转移变更，也不设置子级会话元数据。

<a id="role-delegation-records"></a>
## 角色委派记录

[Roles 声明](../../packages/dev-loop/roles/src/types.ts)定义封闭的 `DevLoopRole` 联合、有界 `DelegationBrief`、可选 `VerificationAssignment`、Host `RoleConfig` 与 `Config`，以及作用域 `ToolConfig`。`DelegationRecord` 通过 `state` 区分未解决的 `RequestedDelegation` 意图与 `SettledDelegation` 观察。带品牌的 `DelegationId` 在整个生命周期标识同一持久化行；子级身份、worktree 分配和实际预设都是可选观察，不是推断的权限。

已结算记录将完成状态与 `cleanup` 分开：不确定清理强制为 `failed`，而 `reported` 来源绝不证明独立验证。[Roles 包](../../packages/dev-loop/roles/README.zh.md)拥有持久化顺序、清理证据、字节限制和策略限制。其历史在服务重启后仍然存在，但既不协调恢复未解决请求，也不恢复 Worktree 的进程本地分配映射。

<a id="completion-and-events"></a>
## 完成与事件

[生命周期类型声明](../../packages/dev-loop/lifecycle/src/types.ts)区分可取消请求与已发布结果。

| 类型 | 含义 |
|---|---|
| `PiecePreCompleteEvent` | 未提交的 `pending → done` 请求：任务块 id、可选理由和组合的调用方／生命周期 `AbortSignal`。不携带已提交时间戳或目标路径。 |
| `StateTransitionEvent` | 内存转换：任务块 id、`from`、`to`、发布时的纪元毫秒时间戳、可选理由和可选重定位路径。不是持久化记录。 |
| `PieceCompletedEvent` | 缩窄为 `to: 'done'` 且要求 `newPath` 的 `StateTransitionEvent`。 |

`piece/pre-complete` 是在完成操作触及文件或 Git 前等待的串行策略。监听器返回 void 或通过拒绝否决，并且必须在返回前结算其拥有的工作。空监听器集合不执行验证。生命周期服务不会仅因为转换发出 `piece/approved` 就强制要求人工批准。

完成要求源码已被跟踪，通过文件系统版本保护将实际磁盘头部编辑为 `done`，暂存已编辑文件，并移入集合的 `done/` 目录。内存发布和 `piece/completed` 在移动成功后发生；Git 暂存不创建提交。头部编辑、索引更新、移动和内存发布不是原子操作。

`piece/approved`、`piece/blocked` 和 `piece/completed` 在内存发布后使用 `emit`。同步监听器错误传播且不回滚；异步监听器不会被等待。这些公告不能提供需等待的持久化。`blocked → todo` 没有公告，服务也不要求非空阻塞理由。

<a id="failure-and-cancellation"></a>
## 失败与取消

发布前失败保持内存不变并释放认领。头部编辑后、发布前的每次失败都尝试使用正向编辑返回的版本，仅恢复先前磁盘头部，包括成功移动后的取消；恢复不重置 Git 索引。`PieceRecoveryFailedError` 保留两项失败，重试前必须检查源码、目标和索引。取消或中断移动不证明已回滚。

调用方取消和生命周期 dispose（资源释放）会取消正向工作。Dispose 在等待初始化前向启动列表或扫描发出信号，并等待活跃完成工作，包括使用新生命周期的头部恢复。每条命令终止并等待 provider 管理的进程范围，而不是将主进程退出视为静止；钩子和 provider 必须结算其操作。[生命周期包](../../packages/dev-loop/lifecycle/README.zh.md#failure-and-cancellation)拥有错误代码和恢复详情；其[限制](../../packages/dev-loop/lifecycle/README.zh.md#known-limitations-and-deferred-work)涵盖重启协调恢复、策略集成和 POSIX 命令要求。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevloopdirectory--devloopdirectory"></a>

### `ctx.devLoopDirectory` — `DevLoopDirectory`

Reads and validates the piece corpus.

A set's pieces live in `<root>/<set>` until they complete, then move to `<root>/<set>/done` per `R-done-pieces-moved`; every read merges both so the directory stays the whole-set view regardless of completion state.

```ts cordis-catalog
/**
 * Validate one piece file's text without reading the filesystem.
 * @param filePath - path the content came from, reported in findings.
 * @param content - complete file text.
 * @returns the validated record, carrying any warnings.
 */
validate(filePath: string, content: string): PieceRecord

/**
 * Read every piece of one set, pending and completed together.
 *
 * A file this parser rejects is reported in `rejected` rather than thrown, so
 * one malformed piece never denies the caller the rest of its set. The defects
 * that still throw belong to the request or the set as a whole rather than to
 * one file's contents: an unmatched set name, and one id owned by two files.
 *
 * @param setName - set directory name such as `00-dev-loop`.
 * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
 * @returns the parsed records ordered by queue position then by id, beside every rejected file.
 */
async scanSet(setName: string, signal?: AbortSignal): Promise<SetScan>

/**
 * List the set directories under the configured root, in name order.
 *
 * Only direct subdirectories of the root are sets: a file beside them is not
 * one, a set's own `done/` subdirectory lives one level deeper and is part of
 * its set, and no listing recurses. A root holding no set directory returns an
 * empty list, which is the answer for an empty corpus; a configured root that
 * does not exist is misconfiguration and rejects, as reading it as "no work"
 * would idle every consumer silently.
 *
 * @param signal - aborts root resolution and listing; cancellation after resolution prevents the listing.
 * @returns every set directory name under the root, sorted by name.
 */
async listSets(signal?: AbortSignal): Promise<string[]>

/**
 * Select the pieces available for dispatch: those declaring `todo` or
 * `pending`. A `done` piece stays resolvable through {@link getPiece} but is
 * never a candidate, and a `blocked` piece is excluded because it waits on a
 * human decision rather than on a dispatch slot. Selection reads the valid
 * pieces of every set it scans, so a malformed file elsewhere in the corpus
 * withholds only itself.
 * @param setName - set to select from; omitted selects across every set. An unmatched name rejects with {@link SetNotFoundError}.
 * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
 * @returns candidates ordered by queue position then id within one set, and by set before
 * queue when selecting across every set, because queue numbers are set-local.
 */
async getQueueCandidates(setName?: string, signal?: AbortSignal): Promise<PieceRecord[]>

/**
 * Read one piece by id, searching the set directory its id prefix names.
 *
 * A malformed sibling never decides this call: the parse failure surfaces
 * only when the requested id owns the rejected file, which its filename
 * declares.
 *
 * @param id - dotted piece id such as `00.01`.
 * @param signal - aborts path resolution, directory listings and reads; cancellation after resolution prevents the next request.
 * @returns the validated record.
 * @throws PieceParseError when the requested id's own file failed to parse.
 */
async getPiece(id: string, signal?: AbortSignal): Promise<PieceRecord>
```

Source: [`packages/dev-loop/directory/src/index.ts`](../../packages/dev-loop/directory/src/index.ts)

<a id="ctxdevlooplifecycle--devlooplifecycle"></a>

### `ctx.devLoopLifecycle` — `DevLoopLifecycle`

The guarded piece state machine.

Every status change passes through transition, which is the only writer, so the legality check cannot be bypassed by a caller reaching around the service.

```ts cordis-catalog
/**
 * Read a piece's current status.
 * @param pieceId - dotted piece id such as `00.01`.
 * @returns the in-memory status hydrated at mount and updated by this service; external edits are not refreshed.
 * @throws PieceNotFoundError when the corpus declares no such id, and PieceParseError when its file was rejected by the scan.
 */
getStatus(pieceId: string): PieceStatus

/**
 * Whether an edge is legal, as a pure predicate callable before mutating, so
 * a caller can pre-check without duplicating the transition table.
 * @param from - the status a piece currently holds.
 * @param to - the status the caller intends.
 * @returns whether the state machine permits that edge.
 */
canTransition(from: PieceStatus, to: PieceStatus): boolean

/**
 * Move a piece to a new status, committing any completing move first.
 *
 * The claim on `expected` is taken synchronously, before the first `await`,
 * so two callers that both observed the same status cannot both reach the
 * move: the second one rejects while the first is still committing.
 *
 * @param pieceId - dotted piece id such as `00.01`.
 * @param expected - the status the caller observed; a mismatch rejects with {@link StalePieceStatusError}.
 * @param to - the status to move to.
 * @param reason - why the transition happened; recorded on the event.
 * @param signal - optional caller cancellation, combined with lifecycle disposal.
 * @returns after memory publication and synchronous announcement dispatch; no durable record is written.
 * @throws Hook, filesystem, command or cancellation errors before publication leave memory unchanged.
 * Recovery is awaited on a fresh lifetime; PieceRecoveryFailedError retains both failures.
 * A synchronous announcement error propagates after commit without rollback; async listeners are not awaited.
 */
async transition(pieceId: string, expected: PieceStatus, to: PieceStatus, reason?: string, signal?: AbortSignal): Promise<void>
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="ctxdevloopqueue--devloopqueue"></a>

### `ctx.devLoopQueue` — `DevLoopQueue`

One process-local concurrency limit for approved, explicitly submitted role requests.

```ts cordis-catalog
/**
 * Capture the exact live initiator and admit a canonical pending piece.
 * @param request - consumer-owned startup callback and cancellation signal.
 * @returns an admission ticket, without waiting for capacity or worker completion.
 * @throws if closed, cancelled, duplicated, not pending, missing a dependency, or lacking a live initiator.
 */
async enqueue(request: QueueRequest): Promise<QueueTicket>

/**
 * Inspect currently occupied capacity.
 * @returns detached scalar records for startup, execution and cleanup reservations.
 */
getActiveWorkers(): QueueEntry[]

/**
 * Inspect requests awaiting dispatch.
 * @returns eligible or dependency-parked requests, in canonical priority and FIFO order.
 */
getQueuedEntries(): QueueEntry[]
```

Source: [`packages/dev-loop/queue/src/index.ts`](../../packages/dev-loop/queue/src/index.ts)

<a id="ctxdevlooproles--devlooproles"></a>

### `ctx.devLoopRoles` — `DevLoopRoles`

Coordinates role policy, retained assignments, Queue leases and durable observations.

```ts cordis-catalog
/**
 * Delegate from the exact live initiator; persist intent before Queue admission.
 * Cancellation joins the ticket; uncertain startup or cleanup records failure, not quiescence. Assignments are never retired.
 * @param brief - complete bounded role assignment, without execution authority.
 * @param signal - caller cancellation lifetime, combined with service disposal.
 * @returns detached settled observation after Queue cleanup and terminal durability.
 * @throws on invalid input, stale initiator, closed service, or failed durable recording.
 */
async delegate(brief: DelegationBrief, signal: AbortSignal): Promise<SettledDelegation>

/**
 * Read full durable history, including unresolved requests that do not imply activity.
 * @param pieceId - canonical piece identity in this Host's repository association.
 * @returns detached records ordered by requested time, then delegation id; never truncated.
 * @throws when the piece id is invalid or storage is closed.
 */
getDelegations(pieceId: string): Promise<readonly DelegationRecord[]>
```

Source: [`packages/dev-loop/roles/src/index.ts`](../../packages/dev-loop/roles/src/index.ts)

<a id="ctxdevloopworktree--devloopworktree"></a>

### `ctx.devLoopWorktree` — `DevLoopWorktree`

Process-lifetime assignments shared across roles; unload preserves all physical trees.

```ts cordis-catalog
/** Allocate or reuse a verified assignment, retaining files across role completion.
 * @param request - piece, starting directory and cancellation; the first caller owns a coalesced attempt.
 * @returns immutable assignment; cancellation joins owned commands and failures preserve residue.
 */
async assignWorktree(request: AssignWorktreeRequest): Promise<WorktreeAssignment>

/** Read the retained assignment without probing or changing Git.
 * @param pieceId - corpus dotted piece identity.
 * @returns published assignment, or undefined.
 */
getAssignment(pieceId: string): WorktreeAssignment | undefined

/** Remove only an owned, clean, unchanged tree; callers must first stop every user.
 * @param id - retained assignment identity.
 * @param signal - caller cancellation.
 * @returns removal or preservation reason; failures retain both mapping and residue.
 */
async retireWorktree(id: WorktreeAssignmentId, signal: AbortSignal): Promise<WorktreeRetirement>
```

Source: [`packages/dev-loop/worktree/src/index.ts`](../../packages/dev-loop/worktree/src/index.ts)

<a id="piece-events"></a>

### `piece/*` events

<a id="pieceapproved--emit"></a>

#### `piece/approved` — emit

A piece was approved at the junction and may enter the dispatch queue.

```ts cordis-catalog
/**
 * A piece was approved at the junction and may enter the dispatch queue.
 * @param event - the recorded transition from `todo` to `pending`.
 * @mode emit
 */
'piece/approved'(event: StateTransitionEvent): void
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="pieceblocked--emit"></a>

#### `piece/blocked` — emit

A piece was blocked by a failed gate, a failed subagent, or a contradicted claim.

```ts cordis-catalog
/**
 * A piece was blocked by a failed gate, a failed subagent, or a contradicted claim.
 * @param event - the transition, carrying the recorded reason.
 * @mode emit
 */
'piece/blocked'(event: StateTransitionEvent): void
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="piececompleted--emit"></a>

#### `piece/completed` — emit

A piece completed, published strictly after the move committed.

```ts cordis-catalog
/**
 * A piece completed, published strictly after the move committed.
 * @param event - the transition, carrying the piece's new path under `done/`.
 * @mode emit
 */
'piece/completed'(event: PieceCompletedEvent): void
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)

<a id="piecepre-complete--serial"></a>

#### `piece/pre-complete` — serial

Await completion policy before filesystem or Git work. Listeners return void or reject to veto; an empty listener set enforces no verification.

```ts cordis-catalog
/**
 * Await completion policy before filesystem or Git work. Listeners return
 * void or reject to veto; an empty listener set enforces no verification.
 * @param event - the claimed request and its cancellation lifetime.
 * @mode serial
 */
'piece/pre-complete'(event: PiecePreCompleteEvent): void | Promise<void>
```

Source: [`packages/dev-loop/lifecycle/src/index.ts`](../../packages/dev-loop/lifecycle/src/index.ts)
<!-- END GENERATED cordis-surface -->

<a id="dev-note"></a>
## 开发备注

无。
