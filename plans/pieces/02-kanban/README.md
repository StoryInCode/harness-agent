# Set 02 — The Kanban Substrate and Interaction Surfaces

The Kanban subsystem provides the multi-session, multi-process work board and coordination substrate for DeepSeek Harness. Actionable tasks arrive with a Kiro-style `tasks.md` document and are decomposed into subtask cards linked strictly to the originating task. The board enforces a strict three-state lifecycle (`todo`, `pending`, `done`), with manual-by-default execution where the Brain stages next-in-line cards for explicit user acceptance. Automode is strictly opt-in and per-task, never wholesale. Completed subtasks mechanically roll up to complete the parent task once all subtasks are verified. Overridden tasks are quarantined to a read-never trash store to prevent context contamination. All operations are strictly workspace-scoped, preventing cross-workspace card leakage.

## Set Index

*Completed pieces live in `02-kanban/done/`.*

| ID | Title | Lead | Package | Depends on | Queue | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `02.01` | [Kanban Service Definition and Entity Model](02.01-kanban-service-definition.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-kanban` | `none` | 1 | todo |
| `02.02` | [Kiro-Style tasks.md Document Format and Parser](02.02-tasks-markdown-document.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-kanban-tasks-parser` | `02.01` | 2 | todo |
| `02.03` | [Task-to-Subtask Split and Decomposition Engine](02.03-task-decomposition-split.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-kanban-decomposition` | `02.01, 02.02` | 3 | todo |
| `02.04` | [Three-State Lifecycle State Machine](02.04-three-state-lifecycle.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-kanban-lifecycle` | `02.01` | 4 | todo |
| `02.05` | [Verification Roll-Up and Task Completion Engine](02.05-verification-rollup.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-kanban-rollup` | `02.01, 02.04` | 5 | todo |
| `02.06` | [Overridden Task Trash and Read-Never Store](02.06-trash-quarantine.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-kanban-trash` | `02.01` | 6 | todo |
| `02.07` | [Workspace Scoping and Multi-Tenant Isolation](02.07-workspace-scoping.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-kanban-workspace` | `02.01` | 7 | todo |
| `02.08` | [Brain Staging Queue and Candidate Selector](02.08-brain-staging-queue.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-kanban-staging` | `02.01, 02.04, 02.07` | 8 | todo |
| `02.09` | [User Accept Path and Execution Handoff](02.09-user-accept-path.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-kanban-accept` | `02.04, 02.08` | 9 | todo |
| `02.10` | [Per-Task Automode Opt-In Controller](02.10-per-task-automode.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-kanban-automode` | `02.01, 02.08, 02.09` | 10 | todo |
| `02.11` | [Card Discussion Coordinator by ID](02.11-card-discussion-session.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-kanban-discussion` | `02.01, 02.02` | 11 | todo |
| `02.12` | [Operator Slash Command Surface `/kanban`](02.12-operator-slash-command.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-command-kanban` | `02.01, 02.09, 02.10, 02.11` | 12 | todo |
| `02.13` | [Workspace Task Dropdown and Filtered Card View UI Extension](02.13-workspace-dropdown-ui.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-kanban-ui` | `02.01, 02.07` | 13 | todo |
| `02.14` | [Model-Facing Kanban Interaction Tools](02.14-model-kanban-tools.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-tool-kanban` | `02.01, 02.02, 02.04, 02.06` | 14 | todo |
| `02.15` | [Kanban SQLite Relational Persistence Backend](02.15-sqlite-relational-persistence.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-kanban-sqlite` | `02.01, 02.06, 02.07` | 15 | todo |
| `02.16` | [Pre-Complete Serial Hook and Verification Gate Hook](02.16-pre-complete-verification-gates.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-kanban-gates` | `02.01, 02.04, 02.05` | 16 | todo |

## Core Architectural Principles

1. **Kiro-style `tasks.md` per card**: Structured `tasks.md` documents, checklist items, and bi-directional AST synchronization (`02.02`).
2. **Verification rolls up**: When 100% of subtasks are verified `done`, the originating task mechanically rolls up to `done` (`02.05`, `02.16`).
3. **Three states only (`todo`, `pending`, `done`)**: Strict 3-state vocabulary and forbidden skip transitions (`02.04`).
4. **Read-never trash quarantine**: Overridden tasks move to an isolated trash store permanently excluded from active queries and LLM contexts (`02.06`).
5. **Per-task opt-in automode**: Automode is opt-in and scoped strictly to one task and its subtasks, revokable at any time (`02.10`).
6. **Manual-by-default Brain staging**: Brain stages next cards (`staged: true`), requiring human acceptance before execution (`02.08`, `02.09`).
7. **Discussion by card ID**: `/kanban <card-id>` opens focused, interactive discussion before granting go-ahead (`02.11`, `02.12`).
8. **Workspace-scoped task dropdown**: Kanban UI renders tasks exclusively for the current workspace; selecting a task shows only its subtasks (`02.07`, `02.13`).

## Execution Protocol

1. **Intake & Decomposition**: Actionable tasks arrive with `tasks.md` (`02.02`). `02.03` splits them into subtask cards linked to the parent task within the current workspace (`02.07`).
2. **Review & Discussion**: Operators can inspect cards or run `/kanban <card-id>` (`02.11`, `02.12`) to discuss and clarify details with the Brain before go-ahead.
3. **Staging**: The Brain scans `todo` subtasks and marks ready candidates `staged: true` (`02.08`). Staged cards wait visibly in the UI (`02.13`).
4. **Acceptance or Automode**: In manual mode, the user accepts staged cards via `/kanban accept <id>` (`02.09`), transitioning them to `pending` and dispatching them to Dev Loop (`00.04a`). If automode is enabled for the task (`02.10`), staging triggers automatic acceptance.
5. **Execution & Pre-Complete Verification**: Workers execute cards. Calling completion triggers serial `kanban/pre-complete` verification gates (`02.16`). Passing gates transitions cards to `done` (`02.04`).
6. **Roll-Up & Audit**: When all subtasks reach `done`, `02.05` verifies the set and rolls the parent task to `done`. Overridden tasks are quarantined to trash (`02.06`), and all mutations are ACID-persisted in SQLite (`02.15`).
