# Set 03 — Colocated Axiom Subsystem, Candidate Discovery, and Verification Sweeper

The Colocated Axiom subsystem establishes the normative constraint and objective verification layer for DeepSeek Harness. Per the binding colocation directive, system axioms live in `AGENTS.md` files next to the code they govern, discovered through the existing `dsh-agent-instructions` chain. Machine-checkable axioms are declared as fenced YAML code blocks (` ```axiom `), enforcing a strict architectural demarcation between automated predicate checks and model-binding prose guidance. Planners can resolve the applicable instruction and constraint chain for candidate paths before touching files using `resolve_candidate_axioms`. Card-level definition-of-done contracts and proof records are persisted via `ctx.storageDomain` under the `task_axioms` domain. A deterministic predicate sweeper evaluates 9 AST, filesystem, and shell conditions, rejects exit-status masking (`INV-11`), enforces anti-self-grading reversion (`INV-10`), and gates card completion on `'kanban/pre-complete'` on verified proof (`INV-01`).

## Set Index

*Completed pieces live in `03-axioms/done/`.*

| ID | Title | Lead | Package | Depends on | Queue | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `03.01` | [Axiom Service Definition and Core Entity Contracts](03.01-axiom-service-definition.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-axiom` | `none` | 1 | todo |
| `03.02` | [Fenced Axiom Block Parser and Prose Demarcator](03.02-fenced-axiom-parser.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-axiom-parser` | `03.01` | 2 | todo |
| `03.03` | [Task Axiom Storage Domain and Lifecycle Store](03.03-task-axiom-store.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-axiom-store` | `03.01` | 3 | todo |
| `03.04` | [Planning-Time Candidate Path Resolver](03.04-candidate-path-resolver.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-axiom-candidate-resolver` | `03.01, 03.02` | 4 | todo |
| `03.05` | [Model-Facing Candidate Axiom Resolution Tool](03.05-candidate-axioms-tool.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-tool-candidate-axioms` | `03.01, 03.04` | 5 | todo |
| `03.06` | [Git Diff Impact Analyzer](03.06-git-diff-impact-analyzer.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-axiom-diff-analyzer` | `03.01, 03.02` | 6 | todo |
| `03.07` | [Hierarchical Scope Consistency and Contradiction Analyzer](03.07-hierarchy-consistency-analyzer.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-axiom-consistency` | `03.01, 03.02` | 7 | todo |
| `03.08` | [Task Axiom Promotion Writer](03.08-task-axiom-promoter.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-axiom-promoter` | `03.01, 03.02, 03.03` | 8 | todo |
| `03.09` | [Declarative Predicate Sweeper Engine](03.09-predicate-evaluators.md) | 🐾 Neko-chan (Inspector Cat) | `@deepseek-ai/dsh-axiom-predicates` | `03.01` | 9 | todo |
| `03.10` | [Anti-Cheat Attributable Shell Seam](03.10-anti-cheat-shell-seam.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-axiom-anti-cheat` | `03.01, 03.09` | 10 | todo |
| `03.11` | [Axiom Verifier Host Service and Anti-Self-Grading Sweeper](03.11-axiom-verifier-service.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-axiom-verifier` | `03.01, 03.03, 03.09, 03.10` | 11 | todo |
| `03.12` | [No Unproven Done Completion Gate Hook](03.12-no-unproven-done-gate.md) | 🔬 Hououin Kyouma (Mad Scientist) | `@deepseek-ai/dsh-axiom-completion-gate` | `03.01, 03.11, 02.01, 02.16` | 12 | todo |
| `03.13` | [Model-Facing Task Axiom Proof Tools](03.13-model-proof-tools.md) | 🍰 L (Forensic Detective) | `@deepseek-ai/dsh-tool-axiom` | `03.01, 03.03, 03.11` | 13 | todo |
| `03.14` | [Automated Auto-Todo Generator on Sweep Failure](03.14-auto-todo-generator.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-axiom-auto-todo` | `03.01, 03.11, 02.01` | 14 | todo |
| `03.15` | [Task Continuation Packet Compiler](03.15-continuation-packet-compiler.md) | 💻 Daru (Super Hacker) | `@deepseek-ai/dsh-axiom-continuation` | `03.01, 03.03, 03.11` | 15 | todo |
| `03.16` | [Axioms Host Bundle Patch and Preset Composition](03.16-preset-composition-patch.md) | 🌸 Mayuri (Gentle Seamstress) | `@deepseek-ai/dsh-axiom-presets` | `03.01, 03.05, 03.11, 03.13` | 16 | todo |

## Core Architectural Principles

1. **Colocated `AGENTS.md` over Central Truth Tree**: Colocated `AGENTS.md` files governed by directory containment (`03.01`, `03.02`).
2. **Elimination of `dsh-axiom-context` & Collapsing `dsh-axiom-local`**: Native `dsh-agent-instructions` handles runtime prompt injection; storage and service definition collapse into `@deepseek-ai/dsh-axiom` (`03.01`).
3. **`ctx.storageDomain` for Task Axiom Persistence**: `ctx.storageDomain` (`task_axioms` domain, version 1) provides synchronous cached reads and atomic durability (`03.03`).
4. **Planning-Time Candidate Tool**: Model-facing `resolve_candidate_axioms` tool registered in the Brain preset (`03.04`, `03.05`).
5. **Decoupled Serial Gating over Database Coupling**: Intercepts card completion strictly via published Cordis serial hook `'kanban/pre-complete'` without SQLite table coupling (`03.12`).

## Execution Protocol

1. **Candidate Deliberation**: During brainstorming, the Brain planner queries candidate packages via `resolve_candidate_axioms` (`03.05`), which resolves directory chains and returns instructions and checkable blocks (`03.04`).
2. **Card Intake & DoD Storage**: Decomposed task cards initialize `TaskAxiomDocument` records in `ctx.storageDomain` (`03.03`) detailing governing system axioms and specific task DoD criteria.
3. **Execution Context**: When workers execute in dedicated worktrees, ambient `dsh-agent-instructions` injects local `AGENTS.md` chains into the session inbox.
4. **Proof Attachment & On-Demand Sweep**: Workers execute tests and attach typed proofs via `attach_proof` (`03.13`). On-demand sweeps run via `verify_task_axioms` (`03.13`), calling `AxiomVerifier` (`03.11`).
5. **Anti-Cheat & Anti-Self-Grading**: `assertAttributableShellCommand` (`03.10`) rejects masked shell syntax (`INV-11`). If a worker falsely claims `SATISFIED`, the sweeper resets status to `ACTIVE` with attributable blocker (`INV-10`).
6. **Completion Gate Hook**: Calling card completion triggers `'kanban/pre-complete'` (`03.12`, `02.16`). If any task axiom or governing colocated check is unmet, `UnprovenDoneError` halts the transition (`INV-01`).
7. **Failure Escalation**: Sweep failures generate auto-todo markdown files and post card comments (`03.14`), while `03.15` compiles minimal continuation packets for worker resumption (`M-010`).
8. **Promotion**: Approved, verified task axioms can be promoted to permanent colocated repository axioms in target `AGENTS.md` files (`03.08`).
