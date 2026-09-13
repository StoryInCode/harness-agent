# Set 03 — Colocated Axiom Subsystem, Candidate Discovery, and Verification Sweeper

The Colocated Axiom subsystem establishes the normative constraint and objective verification layer for DeepSeek Harness. Per the binding colocation directive, system axioms live in `AGENTS.md` files next to the code they govern, discovered through the existing `dsh-agent-instructions` chain, completely replacing the obsolete central truth tree (`.hermes/truth/`). Machine-checkable axioms are declared as fenced YAML code blocks (` ```axiom `), enforcing a strict architectural demarcation between automated predicate checks and model-binding prose guidance. Planners can resolve the applicable instruction and constraint chain for candidate paths before touching files using `resolve_candidate_axioms`. Card-level definition-of-done contracts and proof records are persisted via `ctx.storageDomain` under the `task_axioms` domain. A deterministic predicate sweeper evaluates 9 AST, filesystem, and shell conditions, rejects exit-status masking (`INV-11`), enforces anti-self-grading reversion (`INV-10`), and gates card completion on `'kanban/pre-complete'` on verified proof (`INV-01`).

## Set Index

*Completed pieces live in `03-axioms/done/`.*

| Piece ID | Title | Package | Depends on | Queue Order | Status |
|---|---|---|---|---|---|
| `03.01` | Axiom Service Definition and Core Entity Contracts | `@deepseek-ai/dsh-axiom` | none | 1 | todo |
| `03.02` | Fenced Axiom Block Parser and Prose Demarcator | `@deepseek-ai/dsh-axiom-parser` | `03.01` | 2 | todo |
| `03.03` | Task Axiom Storage Domain and Lifecycle Store | `@deepseek-ai/dsh-axiom-store` | `03.01` | 3 | todo |
| `03.04` | Planning-Time Candidate Path Resolver | `@deepseek-ai/dsh-axiom-candidate-resolver` | `03.01`, `03.02` | 4 | todo |
| `03.05` | Model-Facing Candidate Axiom Resolution Tool | `@deepseek-ai/dsh-tool-candidate-axioms` | `03.01`, `03.04` | 5 | todo |
| `03.06` | Git Diff Impact Analyzer | `@deepseek-ai/dsh-axiom-diff-analyzer` | `03.01`, `03.02` | 6 | todo |
| `03.07` | Hierarchical Scope Consistency and Contradiction Analyzer | `@deepseek-ai/dsh-axiom-consistency` | `03.01`, `03.02` | 7 | todo |
| `03.08` | Task Axiom Promotion Writer | `@deepseek-ai/dsh-axiom-promoter` | `03.01`, `03.02`, `03.03` | 8 | todo |
| `03.09` | Declarative Predicate Sweeper Engine | `@deepseek-ai/dsh-axiom-predicates` | `03.01` | 9 | todo |
| `03.10` | Anti-Cheat Attributable Shell Seam | `@deepseek-ai/dsh-axiom-anti-cheat` | `03.01`, `03.09` | 10 | todo |
| `03.11` | Axiom Verifier Host Service and Anti-Self-Grading Sweeper | `@deepseek-ai/dsh-axiom-verifier` | `03.01`, `03.03`, `03.09`, `03.10` | 11 | todo |
| `03.12` | No Unproven Done Completion Gate Hook | `@deepseek-ai/dsh-axiom-completion-gate` | `03.01`, `03.11`, `02.01`, `02.16` | 12 | todo |
| `03.13` | Model-Facing Task Axiom Proof Tools | `@deepseek-ai/dsh-tool-axiom` | `03.01`, `03.03`, `03.11` | 13 | todo |
| `03.14` | Automated Auto-Todo Generator on Sweep Failure | `@deepseek-ai/dsh-axiom-auto-todo` | `03.01`, `03.11`, `02.01` | 14 | todo |
| `03.15` | Task Continuation Packet Compiler | `@deepseek-ai/dsh-axiom-continuation` | `03.01`, `03.03`, `03.11` | 15 | todo |
| `03.16` | Axioms Host Bundle Patch and Preset Composition | `@deepseek-ai/dsh-axiom-presets` | `03.01`, `03.05`, `03.11`, `03.13` | 16 | todo |

## Earlier Plan Overrides

This piece set overrides legacy designs from `plans/03-axiom-subsystem.md` and `plans/04-axiom-verification-sweeper.md`:

1. **Colocated `AGENTS.md` over Central Truth Tree**: Overrides central `.hermes/truth/` registry, compiler, and tree-blindness guards (`INV-02`) with colocated `AGENTS.md` files governed by directory containment (`03.01`, `03.02`).
2. **Elimination of `dsh-axiom-context` & Collapsing `dsh-axiom-local`**: Native `dsh-agent-instructions` handles runtime prompt injection; storage and service definition collapse into `@deepseek-ai/dsh-axiom` (`03.01`).
3. **`ctx.storageDomain` over Bespoke File Store**: Replaces `~/.hermes/task-axioms/<id>.json` file management with `ctx.storageDomain` (`task_axioms` domain, version 1) providing synchronous cached reads and atomic durability (`03.03`).
4. **Planning-Time Tool over Core Modification**: Replaces invasive changes to `dsh-agent-instructions` with model-facing `resolve_candidate_axioms` tool registered in `hermes-brain` (`03.04`, `03.05`).
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
