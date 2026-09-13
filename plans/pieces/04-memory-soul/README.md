# Set 04 — SOUL Persona, Curated Memory, and Self-Learning Curator

The Memory, Soul, and Curator subsystem establishes identity sovereignty, durable semantic memory, and autonomous procedural self-learning for DeepSeek Harness. The founder's immutable persona is injected into Identity Slot #1 (`deployment:persona-prefix` at order 0) from `~/.hermes/SOUL.md`, actively protected by a tool execution guard that rejects autonomous file or shell mutations (`INV-09`). Semantic notes are persisted in `USER.md` (user preferences, 1,375 char ceiling) and `MEMORY.md` (agent operational notes, 2,200 char ceiling) separated by `\n§\n`, committed under cross-process POSIX file locks with atomic staging renames. To preserve Invariant `INV-08` (Prompt Prefix Cache Stability), memory notes are frozen as a prompt snapshot at turn initialization so mid-turn tool mutations never invalidate KV cache prefixes. Historical session retrieval reuses the existing `@deepseek-ai/dsh-tool-session-query` package directly in `hermes-brain`, querying host `ctx.sessionQuery` within the caller workspace. In the background, an autonomous curator tracks skill usage via `ctx.storageDomain` (`curator` domain, version 1), transitions inactive skills (`active` -> `stale` at 30 days, `stale` -> `archived` at 90 days), and moves retired skills into timestamped archive directories without file deletion (Skill Preservation Invariant). Background review subagents fork every 10 turns via `ctx.subagents.start('spawn')` under strict tool allowlisting, preempting within 2.0 seconds on human turn arrival. When a lesson or defect recurs across >= 2 independent sessions (`M-013`), it is staged as a candidate axiom and promoted to colocated `AGENTS.md` files through a dependency edge to Set 03.

## Set Index

*Completed pieces live in `04-memory-soul/done/`.*

| Piece ID | Title | Package | Depends on | Queue Order | Status |
|---|---|---|---|---|---|
| `04.01` | SOUL Persona Prompt Contribution and Human Write Sovereignty Guard | `@deepseek-ai/dsh-soul` | none | 1 | todo |
| `04.02` | Memory Service Definition and Core Entity Contracts | `@deepseek-ai/dsh-memory` | none | 2 | todo |
| `04.03` | Delimited Memory Note Parser and External Drift Detector | `@deepseek-ai/dsh-memory-parser` | `04.02` | 3 | todo |
| `04.04` | Unicode NFKC Threat Scanner and Injection Sanitizer | `@deepseek-ai/dsh-memory-security` | `04.02` | 4 | todo |
| `04.05` | Cross-Process POSIX File Lock and Staging Renamer | `@deepseek-ai/dsh-memory-lock` | `04.02` | 5 | todo |
| `04.06` | Local Memory Storage Provider and Turn-Snapshot Prefix Cache | `@deepseek-ai/dsh-memory-local` | `04.02`, `04.03`, `04.04`, `04.05` | 6 | todo |
| `04.07` | Model-Facing Memory Read and Write Tool | `@deepseek-ai/dsh-tool-memory` | `04.01`, `04.02`, `04.06` | 7 | todo |
| `04.08` | Historical Session Search Consumer and Query Parameterization | `@deepseek-ai/dsh-tool-session-query` | none | 8 | todo |
| `04.09` | Curator Storage Domain and Audit Ledger Store | `@deepseek-ai/dsh-memory-curator-store` | none | 9 | todo |
| `04.10` | Skill Lifecycle Decay Engine and Preservation Invariant | `@deepseek-ai/dsh-memory-curator-lifecycle` | `04.09` | 10 | todo |
| `04.11` | Background Review Fork Dispatcher and Lineage Guard | `@deepseek-ai/dsh-memory-curator-review` | `04.09`, `04.10` | 11 | todo |
| `04.12` | Human Turn Preemption Controller and Cancellation Watchdog | `@deepseek-ai/dsh-memory-curator-preemption` | `04.11` | 12 | todo |
| `04.13` | Review Governance Gates and Deletion Approval Staging | `@deepseek-ai/dsh-memory-curator-governance` | `04.07`, `04.11` | 13 | todo |
| `04.14` | Repeated Lesson Candidate Axiom Promotion Engine | `@deepseek-ai/dsh-memory-curator-promoter` | `04.09`, `04.11`, `03.01`, `03.08` | 14 | todo |
| `04.15` | Memory and Curator Host Bundle Patch and Preset Composition | `@deepseek-ai/dsh-memory-presets` | `04.01`, `04.06`, `04.07`, `04.08`, `04.09`, `04.10`, `04.11`, `04.12`, `04.13`, `04.14` | 15 | todo |

## Earlier Plan Overrides

This piece set overrides legacy designs from `plans/05-memory-and-soul.md` and `plans/06-curator-and-self-learning.md`:

1. **`ctx.storageDomain` over Bespoke Files**: Overrides legacy `.curator_ledger.jsonl` and `.usage.json` files with `ctx.storageDomain` (`curator` domain, version 1, tables `ledger` and `usage`), eliminating manual file locking and JSONL parsing (`04.09`).
2. **Monorepo Reuse Mandate for Session Query**: Overrides the proposed `@deepseek-ai/dsh-tool-session-search` duplicate package with the shipped `@deepseek-ai/dsh-tool-session-query` package configured for Brain preset (`04.08`, `REVIEW-seams.md` Finding 2).
3. **Parent Session Lifecycle Linkage**: Overrides unlinked background review forks by registering parent session disposal listeners to abort active review subagents, preventing orphaned runs (`04.11`, `REVIEW-lifecycle.md` Finding 4).
4. **Stale Lock Recovery with PID Liveness**: Overrides naive lockfile existence checks by inspecting lockfile mtime (> `lockTimeoutMs * 2`) and verifying process liveness (`process.kill(pid, 0)` throws `ESRCH`) before unlinking stale locks (`04.05`, `REVIEW-lifecycle.md` Gap 6).
5. **Configurable Housekeeping Tick Interval**: Overrides hardcoded 60-second timer with configurable `housekeepingTickIntervalMs` in curator config (`04.10`, `REVIEW-lifecycle.md` Gap 3).
6. **Decoupled Lesson Promotion via Dependency Edge**: Overrides inline axiom writing by staging proposals at `~/.hermes/candidate-axioms/<id>.json` and delegating canonical promotion to Set 03 (`03.01`, `03.08`) without duplicating axiom verification logic (`04.14`).

## Execution Protocol

1. **Identity & Memory Prompt Assembly**: When an agent session starts, `04.01` renders immutable `SOUL.md` into Identity Slot #1 (`deployment:persona-prefix`, order 0). `04.06` captures a frozen snapshot of `USER.md` and `MEMORY.md` notes and contributes `memory:curated-notes` at order 10 (`INV-08`).
2. **Model Memory Operations**: Agents invoke the `memory` tool (`04.07`) to record facts. `04.04` validates input with NFKC threat scanning, `04.05` acquires POSIX lock, and `04.03` validates character budgets on final batch state before committing via atomic swap. Mid-turn writes update disk immediately while active turn prompts remain static (`INV-08`).
3. **Historical Search**: When past context is required, the Brain calls `session_search` (`04.08`), delegating to host `ctx.sessionQuery` with 20-hit limits and workspace scoping.
4. **Turn Counting & Review Fork**: Foreground turns increment counters on `agent/turn-stopping`. At 10 turns, `04.11` spawns a sandboxed review subagent with tool allowlist (`skill`, `read_file`, `fs_search`, `skill_manage`, `memory`). Lineage checks prevent recursive forks.
5. **Preemption Watchdog**: If a human user inputs a message during review execution, `04.12` signals abort and unmounts the child within a 2.0-second watchdog deadline.
6. **Review Governance**: Inside review forks, `04.13` enforces read-before-write on skills and stages any memory deletions to `~/.hermes/approvals/pending/`.
7. **Skill Housekeeping**: Housekeeping timers evaluate inactive skills via `04.10`, transitioning >30d inactive skills to `stale` and >90d to `.archive/` without deleting files. Invocations immediately reactivate skills. All transitions log to `ctx.storageDomain` (`04.09`).
8. **Candidate Axiom Promotion**: Recurring lessons across >= 2 independent sessions stage candidate proposals in `~/.hermes/candidate-axioms/` (`04.14`) and hand off to `03.08` for canonical `AGENTS.md` promotion.
