# Set 02 — The Kanban Substrate and Interaction Surfaces

The Kanban subsystem provides the multi-session, multi-process work board and coordination substrate for DeepSeek Harness. Actionable tasks arrive with a Kiro-style `tasks.md` document and are decomposed into subtask cards linked strictly to the originating task. The board enforces a strict three-state lifecycle (`todo`, `pending`, `done`), with manual-by-default execution where the Brain stages next-in-line cards for explicit user acceptance. Automode is strictly opt-in and per-task, never wholesale. Completed subtasks mechanically roll up to complete the parent task once all subtasks are verified. Overridden tasks are quarantined to a read-never trash store to prevent context contamination. All operations are strictly workspace-scoped, preventing cross-workspace card leakage.

## Set Index

*Completed pieces live in `02-kanban/done/`.*

| Piece ID | Title | Package | Depends on | Queue Order | Status |
|---|---|---|---|---|---|
| `02.01` | Kanban Service Definition and Entity Model | `@deepseek-ai/dsh-kanban` | none | 1 | todo |
| `02.02` | Kiro-Style tasks.md Document Format and Parser | `@deepseek-ai/dsh-kanban-tasks-parser` | `02.01` | 2 | todo |
| `02.03` | Task-to-Subtask Split and Decomposition Engine | `@deepseek-ai/dsh-kanban-decomposition` | `02.01`, `02.02` | 3 | todo |
| `02.04` | Three-State Lifecycle State Machine | `@deepseek-ai/dsh-kanban-lifecycle` | `02.01` | 4 | todo |
| `02.05` | Verification Roll-Up and Task Completion Engine | `@deepseek-ai/dsh-kanban-rollup` | `02.01`, `02.04` | 5 | todo |
| `02.06` | Overridden Task Trash and Read-Never Store | `@deepseek-ai/dsh-kanban-trash` | `02.01` | 6 | todo |
| `02.07` | Workspace Scoping and Multi-Tenant Isolation | `@deepseek-ai/dsh-kanban-workspace` | `02.01` | 7 | todo |
| `02.08` | Brain Staging Queue and Candidate Selector | `@deepseek-ai/dsh-kanban-staging` | `02.01`, `02.04`, `02.07` | 8 | todo |
| `02.09` | User Accept Path and Execution Handoff | `@deepseek-ai/dsh-kanban-accept` | `02.04`, `02.08` | 9 | todo |
| `02.10` | Per-Task Automode Opt-In Controller | `@deepseek-ai/dsh-kanban-automode` | `02.01`, `02.08`, `02.09` | 10 | todo |
| `02.11` | Card Discussion Coordinator by ID | `@deepseek-ai/dsh-kanban-discussion` | `02.01`, `02.02` | 11 | todo |
| `02.12` | Operator Slash Command Surface `/kanban` | `@deepseek-ai/dsh-command-kanban` | `02.01`, `02.09`, `02.10`, `02.11` | 12 | todo |
| `02.13` | Workspace Task Dropdown and Filtered Card View UI Extension | `@deepseek-ai/dsh-kanban-ui` | `02.01`, `02.07` | 13 | todo |
| `02.14` | Model-Facing Kanban Interaction Tools | `@deepseek-ai/dsh-tool-kanban` | `02.01`, `02.02`, `02.04`, `02.06` | 14 | todo |
| `02.15` | Kanban SQLite Relational Persistence Backend | `@deepseek-ai/dsh-kanban-sqlite` | `02.01`, `02.06`, `02.07` | 15 | todo |
| `02.16` | Pre-Complete Serial Hook and Verification Gate Hook | `@deepseek-ai/dsh-kanban-gates` | `02.01`, `02.04`, `02.05` | 16 | todo |

## Earlier Plan Overrides

This piece set overrides specific legacy designs from `plans/01-kanban-substrate.md` and `plans/02-kanban-interaction-tools.md`:

1. **Kiro-style `tasks.md` per card**: Overrides Plan 01 (§4.1) freeform body/DoD columns with structured `tasks.md` documents, checklist items, and bi-directional AST synchronization (`02.02`).
2. **Verification rolls up**: Overrides Plan 01 (§8.3) manual root card completion with a mechanical rule: when 100% of subtasks are verified `done`, the originating task rolls up to `done` (`02.05`, `02.16`).
3. **Three states only (`todo`, `pending`, `done`)**: Overrides Plan 01 (§4.2) 9-state transition matrix with strict 3-state vocabulary and forbidden skip transitions (`02.04`).
4. **Read-never trash quarantine**: Overrides Plan 01 (§4.2) in-place archiving. Overridden tasks move to an isolated trash store permanently excluded from active queries and LLM contexts (`02.06`).
5. **Per-task opt-in automode**: Overrides Plan 01 (§1, §4.3) wholesale auto-dispatch defaults. Automode is opt-in and scoped strictly to one task and its subtasks, revokable at any time (`02.10`).
6. **Manual-by-default Brain staging**: Overrides Plan 01 (§4.3) unprompted dispatch. Brain stages next cards (`staged: true`), requiring human acceptance before execution (`02.08`, `02.09`).
7. **Discussion by card ID**: Overrides Plan 01 (§5.1) asynchronous comment logs. `/kanban <card-id>` opens focused, interactive discussion before granting go-ahead (`02.11`, `02.12`).
8. **Workspace-scoped task dropdown**: Overrides Plan 01 (§5.2) global multi-tenant views. Kanban UI renders tasks exclusively for the current workspace; selecting a task shows only its subtasks (`02.07`, `02.13`).

## Execution Protocol

1. **Intake & Decomposition**: Actionable tasks arrive with `tasks.md` (`02.02`). `02.03` splits them into subtask cards linked to the parent task within the current workspace (`02.07`).
2. **Review & Discussion**: Operators can inspect cards or run `/kanban <card-id>` (`02.11`, `02.12`) to discuss and clarify details with the Brain before go-ahead.
3. **Staging**: The Brain scans `todo` subtasks and marks ready candidates `staged: true` (`02.08`). Staged cards wait visibly in the UI (`02.13`).
4. **Acceptance or Automode**: In manual mode, the user accepts staged cards via `/kanban accept <id>` (`02.09`), transitioning them to `pending` and dispatching them to Dev Loop (`00.04`). If automode is enabled for the task (`02.10`), staging triggers automatic acceptance.
5. **Execution & Pre-Complete Verification**: Workers execute cards. Calling completion triggers serial `kanban/pre-complete` verification gates (`02.16`). Passing gates transitions cards to `done` (`02.04`).
6. **Roll-Up & Audit**: When all subtasks reach `done`, `02.05` verifies the set and rolls the parent task to `done`. Overridden tasks are quarantined to trash (`02.06`), and all mutations are ACID-persisted in SQLite (`02.15`).
