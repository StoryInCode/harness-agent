# 03 — Colocated Axiom Subsystem, Candidate Path Discovery, & Task Axiom Store

## Features

- Colocated axiom authoring in `AGENTS.md` files governing directory containment subtrees
- Machine-checkable axiom block specification embedded within markdown files via fenced YAML code blocks
- Clear demarcation separating machine-evaluated predicate blocks from model-binding prose instructions
- Planning-time candidate path discovery resolving governing axiom chains before files are touched
- Model-facing tool `resolve_candidate_axioms` providing on-demand axiom inspection for brainstorming and planning
- Direct reuse of `dsh-agent-instructions` discovery, directory chain ordering, budgeting, and sibling deduplication
- Host-plane task axiom store persisting card-level DoD contracts and proof records via `ctx.storageDomain` (`task_axioms` domain)
- Git diff impact analyzer mapping modified worktree files to applicable governing `AGENTS.md` chains
- Hierarchical consistency analyzer detecting polarity and constraint contradictions across parent and child scopes
- Declarative preset integration ensuring agents see governing constraints through composition without orchestration code

## 1. Purpose

`@deepseek-ai/dsh-axiom` provides the normative constraint layer for autonomous software engineering in StoryInCode. Axioms define what must remain true across the codebase (system axioms) and what specific obligations an engineering card must fulfill (task axioms). Per the binding colocation directive (`AXIOM-COLOCATION.md`), system axioms live in colocated `AGENTS.md` files next to the code they govern (`packages/<group>/<pkg>/AGENTS.md`, `apps/<app>/AGENTS.md`), abandoning the obsolete central truth tree (`.hermes/truth/`).

- **What it owns**:
  - The `axioms` capability seam (`AxiomRegistry` Service class in `@deepseek-ai/dsh-axiom` extending `@deepseek-ai/cordis.Service`).
  - The machine-checkable axiom parser (`parseAxiomBlocks`) extracting declarative predicate checks from ```` ```axiom ```` fenced blocks in `AGENTS.md`.
  - Planning-time candidate path resolution (`resolveCandidateChain(paths)`) discovering and composing the applicable `AGENTS.md` chain for candidate paths before any file has been modified.
  - The model-facing tool `resolve_candidate_axioms` registered into `ctx.tools` on the agent plane for planner deliberation.
  - The task axiom document store managing card definition-of-done (DoD) contracts and proof references persisted via `ctx.storageDomain` (`task_axioms` domain).
  - The git diff impact analyzer (`analyzeDiffImpact(repoRoot, diffText)`) mapping worktree modifications to governing `AGENTS.md` files.
  - Hierarchical scope consistency checking (`checkHierarchyConsistency`) flagging contradictory rules between ancestor and descendant `AGENTS.md` files.

- **What it deliberately does NOT own**:
  - Runtime prompt injection of touched files and session baseline loading (natively owned by `@deepseek-ai/dsh-agent-instructions`).
  - Declarative predicate execution and shell sweep runner across the 9 check types (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Model-facing proof tools `attach_proof` and `verify_task_axioms` (owned by `@deepseek-ai/dsh-tool-axiom`, Plan 04).
  - Merge gating and "No Unproven Done" enforcement on `kanban/pre-complete` (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Anti-self-grading check reversion (`INV-10`) (owned by `@deepseek-ai/dsh-axiom-verifier`, Plan 04).
  - Kanban card state transitions, SQLite schema, and claim locks (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).
  - Auto-todo issue generation on sweep failure (owned by `@deepseek-ai/dsh-ledger` and `@deepseek-ai/dsh-axiom-verifier`, Plans 04 and 13).
  - Git worktree provisioning, base commit pinning, and dirty work preservation (owned by `@deepseek-ai/dsh-worktree-local`, Plan 07).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-axiom`: **Service Provider** (`AxiomRegistry extends Service`). Merges `interface Context { axioms: AxiomRegistry }` into `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:44-47`). Implements task axiom persistence, candidate path gathering, checkable block extraction, diff impact analysis, and consistency checks.
- `resolve_candidate_axioms`: **Consumer / Model-Facing Tool**. Function plugin registered via `ctx.tools.register()` (`packages/core/tools/src/index.ts:1047-1051`), providing the planner on-demand visibility into candidate package constraints.

### 2.2 Host Plane vs Agent Plane Separation
- **Host Plane (`base.cordis.yml` patch layer)**:
  - `@deepseek-ai/dsh-axiom` resides exclusively on the Host Plane (`PRESET-RULES.md:6`).
  - *Justification*: Task axiom documents represent multi-session contracts shared across the Brain orchestrator, worker runners, independent reviewers, and supervisor daemons. Programmatic methods (`getTaskAxioms`, `resolveCandidateChain`, `getCheckableAxiomsForPaths`) are called by host services (`AxiomVerifier`, `Integrator`, `Supervisor`). Per **PRESET-RULE 6**, a row that injects host services (`storageDomain`, `fs`) and resolves before any session exists belongs on the host plane.
- **Agent Plane (`presets/hermes-brain/agent.cordis.yml`, `presets/hermes-worker/agent.cordis.yml`)**:
  - `@deepseek-ai/dsh-agent-instructions` resides on the Agent Plane (already carried in `dsh-base` / presets with `maxBytes: 65536`).
  - `resolve_candidate_axioms` tool resides on the Agent Plane in `hermes-brain` (and optionally `hermes-worker`).
  - *Justification*: The tool registers into `ctx.tools` under the agent's scoped context. Per **PRESET-RULE 4** (`PRESET-RULES.md:10`), rows that only register into host registries (`ctx.tools`) and provide no Cordis service need no `isolate` realm.

### 2.3 Package Survival and Collapsing
The obsolete mapping (`00-architecture-mapping.md`) allocated three packages: `dsh-axiom`, `dsh-axiom-local`, and `dsh-axiom-context`. With colocated axioms:
1. **`dsh-axiom-context` is DELETED**: In the central model, this plugin injected `axiom:governance` at prompt order 200 and guarded `.hermes/truth/` (`INV-02`). With colocation, `dsh-agent-instructions` already delivers broad-to-specific prompt injection for `AGENTS.md` files. There is no central truth tree to hide, making tree blindness obsolete.
2. **`dsh-axiom-local` is COLLAPSED into `@deepseek-ai/dsh-axiom`**: In Harness, service definitions split from providers only when multiple backend implementations exist (e.g., `dsh-fs` vs `dsh-fs-local` vs `dsh-fs-e2b`). Here, axioms are colocated files accessed via the ambient `ctx.fs` provider and local task JSON files. An abstract interface package with one implementation violates the repo rule: *"Require a current owner and need. Tie each abstraction to a current contract"* (`packages/AGENTS.md:11`). `@deepseek-ai/dsh-axiom` houses both the service contract and its storageDomain implementation.

### 2.4 Addressing the Planning-Time Gap: Tool vs Sibling vs Extension
The planner must see governing axioms for packages it is *reasoning about* during brainstorming and planning, before touching any file.
- **Option (a) — Extension to `dsh-agent-instructions`**: Rejected. Core `agent-instructions` is an event-hook projection engine coupling inbox synchronization to `tools/result` execution touches (`packages/context/agent-instructions/src/index.ts:343-359`). It publishes no service. Modifying core violates the repo rule: *"Prefer extension over core modification"*.
- **Option (b) — Sibling Event-Hook Plugin**: Rejected. During brainstorming, before any card exists, an event hook cannot guess what candidate directories the planner is contemplating.
- **Option (c) — Model-Facing Tool (`resolve_candidate_axioms`)**: **CHOSEN**. The planner explicitly queries the candidate paths it considers (e.g. `['packages/core/tools', 'packages/auth']`). The tool invokes `ctx.axioms.resolveCandidateChain(paths)`, which reuses the battle-tested discovery and rendering logic from `agent-instructions`, returning the exact instruction chain and checkable constraints directly into the conversation turn.

### 2.5 Real Functions Reused vs New Implementations

| Capability | Source Function in `dsh-agent-instructions` | Reused / New | Role in Colocated Axiom Subsystem |
|---|---|---|---|
| Project root walk | `findProjectRoot` (`src/files.ts:181-196`) | **Reused** | Walks upward to `.git` marker; respects I/O errors |
| Ancestor directory chain | `ancestorChain` (`src/files.ts:204-217`) | **Reused** | Computes broad-to-specific directory hierarchy from root to candidate |
| Descendant directories | `descendantDirsBetween` (`src/files.ts:225-232`) | **Reused** | Resolves intermediate directories between session cwd and candidate |
| Sibling candidate dedup | `dedupInstructionFilesByDirectory` (`src/files.ts:375-391`) | **Reused** | Collapses byte-identical siblings (`CLAUDE.md` symlinking `AGENTS.md`) |
| Precedence byte budgeting | `renderWorkspaceInstructionSet` (`src/render.ts:341-348`) | **Reused** | Enforces byte caps, dropping broader files before truncating specific |
| Whitespace digest | `trimmedInstructionDigest` (`src/digest.ts:26-28`) | **Reused** | Fast content comparison for duplicate suppression |
| Checkable block parsing | *None* | **NEW** (`src/parser.ts`) | Extracts and validates ```` ```axiom ```` fenced YAML blocks |
| Multi-path candidate resolution | *None* | **NEW** (`src/candidate-resolver.ts`) | Aggregates chains across multiple candidate paths with union dedup |
| Task axiom domain persistence | *None* | **NEW** (`src/spec.ts`) | Schema-validated persistence via `ctx.storageDomain` (`task_axioms` domain) |
| Git diff impact mapper | *None* | **NEW** (`src/diff-analyzer.ts`) | Maps modified files in diff to governing `AGENTS.md` files |
| Scope polarity analyzer | *None* | **NEW** (`src/consistency.ts`) | Detects direct contradictory rules between ancestor and child scopes |

### 2.6 Evidence-Based Evaluation of Repository Storage Capability (Option (a) ctx.storageDomain vs Bespoke Store)
An explicit audit was performed evaluating whether task axiom persistence requires a bespoke database or maps directly to the repository's storage capability (`ctx.storageDomain` in `packages/storage/storage-domain`):

**Decision: Option (a) — Consume `ctx.storageDomain` (`task_axioms` domain); drop plain file persistence and bespoke file management.**

1. *External Reader Audit*:
   The specification originally noted storing files under `~/.hermes/task-axioms/<row_id>.json`. Stated explicitly: this filesystem path is **NOT** a system requirement because no tool, script, or external binary outside the DeepSeek Harness reads or writes it. It was an artifact of the ported Python Hermes specification. All internal consumers (`AxiomVerifier` in Plan 04, `Supervisor` in Plan 12, and orchestrator tools) access task axioms strictly through the service method `ctx.axioms.getTaskAxioms(rowId)`.
2. *Access Pattern and Storage Shape*:
   Task axioms are pure small keyed documents (`TaskAxiomDocument`) mapped 1:1 by card/row ID (`rowId`). Operations are point writes (`saveTaskAxioms`), point updates (`updateTaskAxiomStatus`), and point reads (`getTaskAxioms`).
3. *Absence of Bespoke Relational / Concurrency Requirements*:
   Contrasting with Kanban (Plan 01), which required bespoke SQLite due to cross-table transactions (`BEGIN IMMEDIATE`), multi-segment relational queries, and cross-process lock contention (`PRAGMA busy_timeout = 120000`), the task axiom store has:
   - Zero cross-table transactions (`packages/storage/storage-domain/README.md:152`).
   - Zero secondary indexes or multi-segment keys.
   - Zero cross-process concurrency contention (the host process acts as the single writer via the domain write chain).
4. *Advantages of ctx.storageDomain Reuse*:
   - **Zero Disk Latency on Synchronous Reads**: `domain.table('documents').get(rowId)` returns synchronously from in-memory cache, enabling instant axiom checks during completion gates without disk I/O.
   - **Built-in Schema Versioning**: Declarative domain declaration via `defineDomain` and `TASK_AXIOMS_DOMAIN_VERSION = 1` enforces Zod schema validation on startup and rejects mismatched schemas with `DomainError('version-mismatch')`.
   - **Elimination of Invented Persistence Machinery**: Eliminates custom directory creation, `.tmp` staging files, POSIX rename atomic dance, and manual JSON serialization errors.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| Colocated axiom governance (`AXIOM-COLOCATION.md`) | Yes (`AxiomRegistry`, `AGENTS.md` parser) | None | Core data model replacing central truth tree |
| Machine-checkable axiom block schema (§2.2.2, §2.5) | Yes (`CheckableAxiom`, `PredicateCheck`) | None | Fenced block grammar inside markdown files |
| Prose vs checkable axiom separation (§2.1, §2.5) | Yes (`parseAxiomBlocks`, dual representation) | None | Prose binds model; checks bind sweeper |
| Planning-time candidate path resolution (§2.4) | Yes (`resolveCandidateChain`, `resolve_candidate_axioms`) | None | Solves planning gap before files are touched |
| Task axiom domain storage (§2.2.1, §2.3) | Yes (`TaskAxiomDocument`, `ctx.storageDomain`) | None | Card DoD contract storage in `task_axioms` domain |
| Task and proof ID conventions (§2.3) | Yes (`AxiomId`, `TaskAxiomId`, `ProofId`) | None | Type-safe branded identifier constructors |
| Git diff impact analysis (§2.7) | Yes (`analyzeDiffImpact`) | `@deepseek-ai/dsh-integrator` (Plan 10) | Analyzer here; merge gate in integrator |
| Hierarchical conflict check (§2.7, `M-001` - `M-006`) | Yes (`checkHierarchyConsistency`) | `@deepseek-ai/dsh-supervisor` (Plan 12) | Analyzer here; distress warning in supervisor |
| Task axiom promotion workflow (§2.7) | Yes (`promoteToColocatedAxiom`) | None | Appends approved assertions into target `AGENTS.md` |
| Runtime prompt injection of touched files (§2.4) | Delegated | `@deepseek-ai/dsh-agent-instructions` (reused) | Shipped harness context plugin handles this |
| 9-predicate evaluation engine (§2.5) | Delegated | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | Shell and AST verification engine |
| Model tools `attach_proof` & `verify` (§2.5) | Delegated | `@deepseek-ai/dsh-tool-axiom` (Plan 04) | Worker verification tool presentation |
| No Unproven Done merge gate (`INV-01`, `M-009`) | Delegated | `@deepseek-ai/dsh-axiom-verifier` (Plan 04) | Kanban lifecycle interception |

## 4. Proposed Package / File Layout

```
packages/axiom/
└── axiom/                                # @deepseek-ai/dsh-axiom (Service Provider)
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── src/
    │   ├── index.ts                      # AxiomRegistry service class & Cordis export
    │   ├── spec.ts                       # defineDomain spec (taskAxiomsDomainSpec) & Zod schemas
    │   ├── brand.ts                      # AxiomId, TaskAxiomId, ProofId branded constructors
    │   ├── types.ts                      # Axiom, CheckableAxiom, TaskAxiom, PredicateCheck, etc.
    │   ├── parser.ts                     # Fenced ```axiom block parser and validator
    │   ├── candidate-resolver.ts         # Planning-time candidate path resolution engine
    │   ├── diff-analyzer.ts              # Git diff parser mapping touched paths to AGENTS.md
    │   ├── consistency.ts                # Hierarchical polarity and contradiction analyzer
    │   ├── promoter.ts                   # Task-to-colocated axiom promotion writer
    │   └── tool.ts                       # resolve_candidate_axioms tool definition
    └── tests/
        ├── memory-double.ts              # In-memory test double for AxiomRegistry contracts
        ├── parser.spec.ts                # Markdown extraction of ```axiom blocks and prose
        ├── candidate-resolver.spec.ts    # Multi-path candidate resolution and budgeting tests
        ├── domain-store.spec.ts          # Storage domain CRUD, Zod schema validation, version mismatch
        ├── diff-analyzer.spec.ts         # Git diff to AGENTS.md containment mapping tests
        ├── consistency.spec.ts           # Ancestor/descendant polarity conflict tests
        ├── promoter.spec.ts              # Task axiom promotion into local AGENTS.md
        └── tool.spec.ts                  # resolve_candidate_axioms tool invocation tests
```

## 5. Public Contracts

### 5.1 Machine-Checkable Axiom Specification in `AGENTS.md`
Inside an `AGENTS.md` file, prose provides human and model guidance. Machine-checkable axioms are declared using a fenced code block with info string `axiom`:

````markdown
# AGENTS.md — Auth Service

All authentication tokens must be signed with Ed25519. RS256 is deprecated and forbidden.

```axiom
id: SIC-AUTH-001
type: invariant
verification: deterministic
checks:
  - type: grep_absent
    path: src/
    pattern: 'RS256'
  - type: required_symbol
    path: src/jwt.ts
    symbol: 'ed25519'
  - type: test
    command: pnpm --filter @sic/auth test:unit
    timeoutMs: 30000
```
````

- **Separation**: Sections without ```` ```axiom ```` blocks are pure prose axioms binding model behavior. Sections with ```` ```axiom ```` blocks declare machine-verifiable constraints.
- **Containment Paths**: Relative paths inside `checks` (e.g. `src/jwt.ts`) are evaluated relative to the directory containing that `AGENTS.md`.

### 5.2 Domain Types & Identifiers (`packages/axiom/axiom/src/brand.ts`, `types.ts`)

```typescript
// packages/axiom/axiom/src/brand.ts
export type AxiomId = string & { readonly __brand: unique symbol }
export type TaskAxiomId = string & { readonly __brand: unique symbol }
export type ProofId = string & { readonly __brand: unique symbol }

export function axiomId(raw: string): AxiomId {
  if (!/^(?:META|SIC|HERMES|HS|H)(?:-[A-Z0-9]+)*-\d{3}$/.test(raw)) {
    throw new TypeError(`invalid AxiomId format: "${raw}"`)
  }
  return raw as AxiomId
}

export function taskAxiomId(raw: string): TaskAxiomId {
  if (!/^[A-Za-z0-9_-]+-A\d+$/.test(raw)) {
    throw new TypeError(`invalid TaskAxiomId format: "${raw}"`)
  }
  return raw as TaskAxiomId
}

export function proofId(raw: string): ProofId {
  if (!/^[A-Za-z0-9_-]+-P\d+$/.test(raw)) {
    throw new TypeError(`invalid ProofId format: "${raw}"`)
  }
  return raw as ProofId
}

// packages/axiom/axiom/src/types.ts
export type AxiomType = 'meta' | 'invariant' | 'rule' | 'policy'
export type AxiomVerificationKind = 'deterministic' | 'behavioral' | 'semantic'

export interface PredicateCheck {
  readonly type: 'path_exists' | 'path_absent' | 'forbidden_file_pattern'
    | 'grep_absent' | 'required_symbol' | 'required_reference'
    | 'forbidden_import' | 'max_lines' | 'forbidden_directory' | 'test'
  readonly path?: string
  readonly pattern?: string
  readonly symbol?: string
  readonly reference?: string
  readonly source?: string
  readonly target?: string
  readonly limit?: number
  readonly command?: string
  readonly timeoutMs?: number
}

export interface CheckableAxiom {
  readonly id: AxiomId
  readonly type: AxiomType
  readonly statement?: string
  readonly verification: AxiomVerificationKind
  readonly checks: readonly PredicateCheck[]
  readonly definedIn: string  // Project-relative path to owning AGENTS.md
  readonly scopeDir: string    // Directory governing the checks
}

export type TaskAxiomStatus = 'PROPOSED' | 'ACTIVE' | 'SATISFIED' | 'VIOLATED' | 'BLOCKED' | 'SUPERSEDED'

export interface TaskAxiom {
  readonly id: TaskAxiomId
  readonly statement: string
  readonly status: TaskAxiomStatus
  readonly proofs: readonly ProofId[]
  readonly blocker: string
  readonly checks?: readonly PredicateCheck[]
  readonly verified?: {
    readonly state: TaskAxiomStatus
    readonly when: string
    readonly checks?: readonly unknown[]
  }
  readonly promotedTo?: AxiomId | null
}

export type ProofType = 'test' | 'runtime-observation' | 'static-analysis' | 'diff' | 'inspection'
export type ProofResult = 'passed' | 'failed' | 'inconclusive'

export interface ProofRecord {
  readonly id: ProofId
  readonly axiom: TaskAxiomId
  readonly type: ProofType
  readonly artifact: string
  readonly result: ProofResult
  readonly detail: string
  readonly when: string
}

export interface TaskAxiomDocument {
  readonly task: string
  readonly row: string
  readonly goal: string
  readonly created: string
  readonly governing: readonly AxiomId[]
  readonly axioms: readonly TaskAxiom[]
  readonly proofs: readonly ProofRecord[]
  readonly unresolved: readonly string[]
  readonly nextAction: string
}

export interface CandidateAxiomChain {
  readonly candidatePaths: readonly string[]
  readonly instructionFiles: readonly { displayPath: string; absolutePath: string }[]
  readonly renderedInstructions: string
  readonly checkableAxioms: readonly CheckableAxiom[]
}
```

### 5.3 Domain Specification (`packages/axiom/axiom/src/spec.ts`)

```typescript
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { TaskAxiomDocument } from './types.ts'

export const taskAxiomDocumentSchema = z.object({
  task: z.string(),
  row: z.string(),
  goal: z.string(),
  created: z.string(),
  governing: z.array(z.string()),
  axioms: z.array(z.record(z.unknown())),
  proofs: z.array(z.record(z.unknown())),
  unresolved: z.array(z.string()),
  nextAction: z.string(),
})

export const TASK_AXIOMS_DOMAIN_VERSION = 1

export const taskAxiomsDomainSpec = defineDomain({
  name: 'task_axioms',
  version: TASK_AXIOMS_DOMAIN_VERSION,
  tables: {
    documents: domainTable<string, TaskAxiomDocument>(taskAxiomDocumentSchema as any),
  },
})
```

### 5.4 Service Definition & Cordis Events (`packages/axiom/axiom/src/index.ts`)

```typescript
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AxiomId, TaskAxiomId, TaskAxiomStatus,
  TaskAxiomDocument, CheckableAxiom, CandidateAxiomChain,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    axioms: AxiomRegistry
  }
  interface Events {
    'axioms/task-updated': (doc: TaskAxiomDocument) => void
    'axioms/promoted': (taskAxiomId: TaskAxiomId, canonicalId: AxiomId, targetFile: string) => void
    'axioms/conflict-detected': (conflict: { fileA: string; fileB: string; reason: string }) => void
  }
}

export abstract class AxiomRegistry extends Service {
  constructor(ctx: Context) {
    super(ctx, 'axioms', true)
  }

  // Planning-Time Candidate Path Resolution
  abstract resolveCandidateChain(candidatePaths: readonly string[], options?: { maxBytes?: number }): Promise<CandidateAxiomChain>
  abstract getCheckableAxiomsForPaths(paths: readonly string[]): Promise<readonly CheckableAxiom[]>

  // Task Axiom Document Operations (persisted via ctx.storageDomain task_axioms domain)
  abstract getTaskAxioms(rowId: string): Promise<TaskAxiomDocument | undefined>
  abstract saveTaskAxioms(doc: TaskAxiomDocument): Promise<void>
  abstract updateTaskAxiomStatus(rowId: string, axiomId: TaskAxiomId, status: TaskAxiomStatus, blocker?: string): Promise<void>

  // Consistency & Diff Analysis
  abstract analyzeDiffImpact(repoRoot: string, diffText?: string): Promise<{ affectedInstructionFiles: readonly string[]; checkableAxioms: readonly CheckableAxiom[] }>
  abstract checkHierarchyConsistency(projectRoot: string): Promise<{ valid: boolean; conflicts: readonly { fileA: string; fileB: string; reason: string }[] }>

  // Lifecycle Promotion
  abstract promoteToColocatedAxiom(rowId: string, taskAxiomId: TaskAxiomId, targetAgentsMdPath: string, canonicalId: AxiomId): Promise<void>
}
```

### 5.5 Model-Facing Tool Contract (`packages/axiom/axiom/src/tool.ts`)

```typescript
import { ToolRegistration } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

export const resolveCandidateAxiomsTool: ToolRegistration = {
  name: 'resolve_candidate_axioms',
  description: 'Inspect the governing instructions, axioms, and machine-checkable constraints for candidate paths being planned or modified, before touching any files.',
  parameters: z.object({
    paths: z.array(z.string()).description('List of project-relative file or directory paths under consideration'),
  }),
  execute: async ({ paths }, { session, ctx }) => {
    const chain = await ctx.axioms.resolveCandidateChain(paths)
    return {
      instructions: chain.renderedInstructions,
      applicableFiles: chain.instructionFiles.map(f => f.displayPath),
      checkableCount: chain.checkableAxioms.length,
      checkableAxioms: chain.checkableAxioms.map(a => ({
        id: a.id,
        type: a.type,
        scope: a.scopeDir,
        checks: a.checks,
      })),
    }
  },
}
```

### 5.6 Service Provider Config Schema (`packages/axiom/axiom/src/index.ts`)

```typescript
import z from '@deepseek-ai/schemastery'

export interface AxiomConfig {
  /** Directory names marking project root. Default: ['.git'] */
  projectRootMarkers?: string[]
  /** Base instruction candidate names. Default: ['AGENTS.md', 'CLAUDE.md'] */
  instructionFileCandidates?: string[]
  /** Maximum bytes for rendered candidate chains. Default: 65536 */
  maxBytes?: number
  /** Maximum bytes read per instruction file. Default: 1048576 */
  maxSourceBytes?: number
}

export const AxiomConfig: z<AxiomConfig> = z.object({
  projectRootMarkers: z.array(z.string()).default(['.git']),
  instructionFileCandidates: z.array(z.string()).default(['AGENTS.md', 'CLAUDE.md']),
  maxBytes: z.number().default(65536),
  maxSourceBytes: z.number().default(1048576),
})
```

## 6. Lifecycle and Scoping

- **Host-Plane Lifecycle (`@deepseek-ai/dsh-axiom`)**:
  - Mounted once in the host container via `packages/bundle/base/cordis.patch.yml`.
  - Publishes `ctx.axioms` as a process-wide singleton (`PRESET-RULES.md:6`).
  - Injects `['storageDomain', 'fs']` (`packages/fs/fs/src/index.ts:86-90`).
  - On startup (`[Service.init]()`):
    1. Opens typed domain via `ctx.storageDomain`:
       ```typescript
       const domain = await this.ctx.storageDomain.open(taskAxiomsDomainSpec)
       this.ctx.effect(() => () => domain.close(), 'axioms.domainClose')
       this.documentsTable = domain.table('documents')
       ```
    2. Synchronous in-memory reads via `this.documentsTable.get(rowId)` provide zero disk latency during checks.
    3. Writes queue sequentially on the domain write chain, guaranteeing atomic durability before resolving.
  - On shutdown / HMR disposal:
    - Disposing the service automatically closes the domain handle via `domain.close()`, draining queued writes and releasing resources without descriptor leaks.

- **Agent-Plane Lifecycle (`resolve_candidate_axioms`)**:
  - Mounted inside agent preset (`presets/hermes-brain/agent.cordis.yml` as `tool-candidate-axioms` via `@deepseek-ai/dsh-axiom/tool`).
  - Injects `['tools', 'axioms']`.
  - Registers `resolve_candidate_axioms` into `ctx.tools` on the session scope.
  - Per **PRESET-RULE 4** (`PRESET-RULES.md:10`), registering into `ctx.tools` requires no `isolate` realm.
  - Sibling agent sessions each resolve the host-plane `ctx.axioms` via standard Cordis parent traversal.

## 7. Agent Preset Integration

### 7.1 Host Plane Composition (`packages/bundle/base/cordis.patch.yml`)
Per **PRESET-RULE 2, 6, and 8**, service providers injecting host capabilities (`storageDomain`, `fs`) and persisting shared task axiom contracts across sessions belong strictly to the Host Plane:

```yaml
# packages/bundle/base/cordis.patch.yml
'@deepseek-ai/dsh-storage-domain':
  routes:
    task_axioms: sqlite

'@deepseek-ai/dsh-axiom':
  maxBytes: 65536
  maxSourceBytes: 1048576
```

### 7.2 Agent Plane Preset (`presets/hermes-brain/agent.cordis.yml`)

```yaml
# packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml
# ── colocated candidate axiom resolution tool ─────────────────────────────────
# Exposes resolve_candidate_axioms to the planner during brainstorming.
# Per PRESET-RULE 4: registers into ctx.tools, no isolate realm needed.
- id: tool-candidate-axioms
  name: '@deepseek-ai/dsh-axiom/tool'
  inject: ['tools', 'axioms']

# packages/preset/agent-presets/presets/hermes-worker/agent.cordis.yml
# dsh-base already carries @deepseek-ai/dsh-agent-instructions with maxBytes: 65536.
# When worker session cwd is set to card workspace_path (e.g. packages/auth),
# dsh-agent-instructions automatically loads the broad-to-specific AGENTS.md chain
# into the durable baseline context on turn 1.
```

- **Why Preset Composition Satisfies "The Planner Sees Them"**:
  1. The brain preset carries `tool-candidate-axioms`. When deliberating, the planner queries candidate package paths via `resolve_candidate_axioms` and receives the complete governing chain before touching any file.
  2. The worker preset inherits `dsh-agent-instructions`. When a card is dispatched with `workspace_path: packages/auth`, the worker session starts with `cwd = packages/auth`. `dsh-agent-instructions` automatically discovers and loads `AGENTS.md` (root) -> `packages/AGENTS.md` -> `packages/auth/AGENTS.md`.
  3. Zero custom orchestration code is required in the parent dispatcher or loop driver. Composition via presets handles constraint delivery declaratively.

## 8. Execution Flow

### 8.1 Planning-Time Candidate Path Gathering Flow

```
Planner (hermes-brain during brainstorming / deliberation)
  │
  ├──> Model invokes resolve_candidate_axioms({ paths: ['packages/auth', 'packages/core/tools'] })
  │      │
  │      └──> AxiomRegistry.resolveCandidateChain(paths)
  │             │
  │             ├──> findProjectRoot(cwd, markers, fs)
  │             │
  │             ├──> For each path in paths:
  │             │      ├── targetDir = dirname(resolve(projectRoot, path))
  │             │      └── chain = ancestorChain(projectRoot, targetDir)
  │             │
  │             ├──> Discover all candidate instruction files in chain directories
  │             │
  │             ├──> Read file contents under maxSourceBytes via fs
  │             │
  │             ├──> dedupInstructionFilesByDirectory(loadedFiles)
  │             │
  │             ├──> parseAxiomBlocks(loadedFiles) -> CheckableAxiom[]
  │             │
  │             └──> renderWorkspaceInstructionSet(loadedFiles, { maxBytes })
  │
  └──> Tool returns { instructions, applicableFiles, checkableCount, checkableAxioms }
         └── Model receives full normative constraints before writing card DoD or modifying code
```

### 8.2 Execution-Time Worker Context Flow (Native `dsh-agent-instructions`)

```
Worker session spawned with cwd = "packages/auth"
  │
  ├──> Step 1: agent/pre-step hook (dsh-agent-instructions)
  │      │
  │      ├──> loadBaselineInstructionSet(cwd="packages/auth")
  │      │      └── Returns root AGENTS.md -> packages/AGENTS.md -> packages/auth/AGENTS.md
  │      │
  │      └──> Baseline message injected into session inbox as durable user/message
  │
  ├──> Worker touches deeper path: read("packages/auth/src/jwt.ts")
  │      │
  │      ├──> tools/result hook detects touch
  │      └──> descendantDirsBetween("packages/auth", "packages/auth/src/jwt.ts")
  │
  └──> Next Step: reconcileInstructionContext projects newly relevant nested AGENTS.md
```

### 8.3 Machine-Checkable Axiom Sweep Flow (Plan 04 Seam)

```
Sweeper / Card Completion (dsh-axiom-verifier in Plan 04)
  │
  ├──> Queries ctx.axioms.getCheckableAxiomsForPaths(touchedFiles)
  │      │
  │      ├──> Resolves governing AGENTS.md files for all touched paths
  │      └──> Returns parsed CheckableAxiom[] containing 9-predicate checks
  │
  ├──> Merges checks with card-level task axioms from ctx.axioms.getTaskAxioms(rowId)
  │      │
  │      └──> Evaluated synchronously from ctx.storageDomain (task_axioms domain)
  │
  └──> Evaluates checks via shell / AST evaluators (Plan 04)
```

## 9. Error, Cancellation, and Lifecycle Behavior

- **Malformed ```` ```axiom ```` Blocks**:
  If an `AGENTS.md` contains a syntax error in its YAML block or fails schema validation against `PredicateCheck`, `parseAxiomBlocks` logs a structured warning naming the file and line number. The prose of the file is still loaded as guidance, while the invalid checkable block is skipped to prevent crashing the agent loop.
- **Missing Task Axiom Documents**:
  If `getTaskAxioms(rowId)` is called for an uninitialized card, it returns `undefined` from `table.get(rowId)`. `saveTaskAxioms` calls `this.documentsTable.put(doc.row, doc)`, queuing on the domain write chain to ensure atomic durability before resolving.
- **Hierarchical Axiom Contradictions (`M-001`)**:
  If `checkHierarchyConsistency` detects a child `AGENTS.md` declaring an invariant that directly inverts an ancestor constraint (e.g. parent: `grep_absent 'eval'`, child: `required_symbol 'eval'`) without an explicit `overrides: <id>` field, `valid` is set to `false` and the host emits `axioms/conflict-detected`.
- **Cancellation & Abort Signals**:
  All asynchronous file reads and directory traversals accept `AbortSignal`. When turn execution or candidate resolution is cancelled, operations terminate immediately via `signal.throwIfAborted()`.
- **Durable vs Process-Local State**:
  Task axiom documents are durably persisted in `ctx.storageDomain` (`task_axioms` domain over configured storage backend) with schema validation. Repository `AGENTS.md` files are durable on disk. In-memory parsed check structures and candidate path index maps are process-local caches invalidated on file modification or task updates.
- **Schema Version Mismatch**:
  Opening the domain against incompatible media triggers fast failure via `DomainError('version-mismatch')`, preventing silent database corruption.

## 10. Testing Strategy

All test suites live in `packages/axiom/axiom/tests/`:

### 10.1 Parser & Schema Tests (`tests/parser.spec.ts`)
- Tests parsing of markdown files containing multiple ```` ```axiom ```` fenced blocks.
- Verifies correct extraction of `id`, `type`, `verification`, and 9 predicate check types.
- Verifies that pure prose sections without fenced blocks produce zero checkable axioms.
- Asserts that malformed YAML blocks produce graceful diagnostic warnings and do not crash.

### 10.2 Candidate Resolver Tests (`tests/candidate-resolver.spec.ts`)
- Creates a multi-level directory fixture (`root/AGENTS.md`, `root/pkgA/AGENTS.md`, `root/pkgA/sub/AGENTS.md`).
- Queries `resolveCandidateChain` with candidate paths (`pkgA/sub/index.ts`).
- Asserts that the returned chain contains all three instruction files in broad-to-specific order.
- Queries disjoint candidate paths (`['pkgA/index.ts', 'pkgB/index.ts']`) and asserts union discovery with root deduplication.
- Tests byte budget enforcement: asserts broader files are omitted before specific files are truncated.

### 10.3 Task Axiom Domain Store Tests (`tests/domain-store.spec.ts`)
- Tests CRUD operations on `task_axioms` domain table via `ctx.storageDomain`.
- Tests Zod schema validation on stored `TaskAxiomDocument` records.
- Tests fast failure on version mismatch (`DomainError('version-mismatch')`).
- Tests `updateTaskAxiomStatus` transitions (`PROPOSED` -> `ACTIVE` -> `SATISFIED` / `VIOLATED`) via `table.update()`.

### 10.4 Diff Impact & Consistency Tests (`tests/diff-analyzer.spec.ts`, `tests/consistency.spec.ts`)
- Generates git diffs touching nested files; verifies mapping to the governing `AGENTS.md` hierarchy.
- Tests detection of contradictory predicate checks between parent and child `AGENTS.md` files.
- Verifies that explicit `overrides: <id>` suppresses conflict alarms.

### 10.5 Scoped Tool Tests (`tests/tool.spec.ts`)
- Mounts `resolveCandidateAxiomsTool` under an agent session context.
- Invokes the tool with candidate paths and verifies model-visible output format.
- Verifies tool handles nonexistent paths gracefully by resolving up to the nearest existing ancestor.

### 10.6 Preset Composition & Disposal Tests (`tests/composition.spec.ts`)
- Boots `hermes-brain` preset via Cordis Loader (`cordis-plugin-loader`).
- Verifies `resolve_candidate_axioms` tool is registered in `ctx.tools`.
- Disposes fiber and verifies HMR clean removal of tool registration.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Task axiom data model & lifecycle schema | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:49-140` | Task axiom state machine (`PROPOSED`, `ACTIVE`, `SATISFIED`, `VIOLATED`, `BLOCKED`, `SUPERSEDED`), proof types (`test`, `static-analysis`, `runtime-observation`, `database-query`, `schema-validation`, `artifact`, `diff`, `inspection`, `code-reference`, `human-review`), behavioral classification, and task axiom record structure. | Convert Python dictionary structures into TypeScript interfaces and Zod schemas in `src/spec.ts` (`TaskAxiomDocument`, `TaskAxiom`, `ProofRecord`), and apply branded ID types (`TaskId`, `AxiomId`, `ProofId`). | direct port |
| Task axiom document persistence (`task_axioms` domain) | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:44-84` | CRUD lifecycle operations on task axiom records mapped by task/card ID (`create`, `load`, `save`). | Replace bespoke filesystem operations under `~/.hermes/task-axioms/<id>.json` with repository `ctx.storageDomain` (`task_axioms` domain, version 1, table `documents`), providing synchronous in-memory reads and single-chain atomic writes. | port with adaptation |
| Machine-checkable axiom block grammar & parsing | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_verify.py:104-250`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_compile.py:60-120` | Declarative predicate check grammar (`path-exists`, `path-absent`, `forbidden-file-pattern`, `grep-absent`, `required-symbol`, `forbidden-import`, `dependency-rule`, `max-lines`, `forbidden-directory`, `command`), and clean separation between machine-checked assertions and prose instructions. | Replace central `.hermes/truth/*.yaml` compiler with markdown fenced code block parser (`src/parser.ts`) extracting ```` ```axiom ```` YAML blocks embedded directly in colocated `AGENTS.md` files. | port with adaptation |
| Planning-time candidate path resolution & instruction gathering | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_resolve.py:49-110`<br>`packages/context/agent-instructions/src/files.ts:181-232, 375-391` | Path-scoped rule retrieval algorithm: directory ancestor chain walking, broad-to-specific containment ordering, sibling deduplication, and byte budgeting. | Replace central compiled index lookup with upward directory walk discovering colocated `AGENTS.md` files; integrate with `dsh-agent-instructions` helpers and expose via `ctx.axioms.resolveCandidateChain(paths)`. | port with adaptation |
| Model-facing tool `resolve_candidate_axioms` | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_resolve.py:1-25, 90-130` | Planning query interface: given candidate directory paths, resolve and format governing prose instructions, checkable axioms, and budget truncation metadata for agent context. | Replace CLI argument parser with model-facing tool constructed via `defineTool` on `ctx.tools` on the agent plane, returning formatted JSON/markdown for LLM planning. | port with adaptation |
| Git diff impact analyzer | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_impact.py:40-110` | Git diff file extraction, path glob pattern matching (`matches_any`), and mapping touched worktree paths to applicable governing constraint scopes. | Convert Python `subprocess.run` to pure diff text parsing in `src/diff-analyzer.ts` (`analyzeDiffImpact(repoRoot, diffText)`), mapping touched files to governing colocated `AGENTS.md` chains. | direct port |
| Hierarchical consistency & contradiction analyzer | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/truth_check.py:76-135`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:234-270` | Core word stemming and noise/polarity stripping (`_core`), negation detection (`_negated`), and pairwise contradiction detection (`M-001..M-006`) across parent and child scopes. | Port Python regex stemming to TypeScript word tokenizer in `src/consistency.ts` (`checkHierarchyConsistency`), reporting warnings for contradictory directives across ancestor/child `AGENTS.md` files. | direct port |
| Definition-of-done evaluator (`M-009`) & task promotion | `/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/task_axioms.py:205-232`<br>`/home/sic/Desktop/storyincode/.hermes/skills/sic-orchestrator/assets/merge_card.py:80-140` | Deterministic definition-of-done evaluation algorithm: ensure every required task axiom is `SATISFIED` with an accepted proof, no axiom is `BLOCKED` or `VIOLATED`, and no unresolved blockers exist. Markdown formatting for task-to-colocated axiom promotion. | Implement as public methods on `AxiomRegistry` Service, emitting Cordis domain events and formatting markdown additions for target `AGENTS.md` files. | direct port |

The single most valuable capability to port is the task axiom lifecycle state machine, proof attachment schema, and deterministic definition-of-done validator (`task_axioms.py:49-61, 96-150, 205-232`). This transforms subjective "done" claims into structured, falsifiable proof records that survive agent turn context compaction and worker retries, guaranteeing that engineering tasks only complete when concrete evidence is recorded.

## 11. Implementation Steps

1. **Initialize Package Structure** at `packages/axiom/axiom/`:
   - Setup `package.json` with dependencies on `@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent-instructions`, `@deepseek-ai/dsh-storage-domain`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/schemastery`, `zod`, `js-yaml`, and subpath export `./tool` pointing to `./src/tool.ts`.
   - Setup `tsconfig.json` extending `tsconfig.base.json` (`packages/AGENTS.md:23`).
   - Implement `brand.ts` with branded constructors (`axiomId`, `taskAxiomId`, `proofId`).
   - Implement `types.ts` defining domain interfaces (`CheckableAxiom`, `TaskAxiomDocument`, `PredicateCheck`, etc.).

2. **Implement Fenced Block Parser** (`src/parser.ts`):
   - Regex/markdown scanner extracting ```` ```axiom ... ``` ```` fenced YAML blocks.
   - Schema validation using Schemastery against `PredicateCheck` and `CheckableAxiom`.
   - Path normalizer resolving relative check targets against the enclosing `AGENTS.md` directory.

3. **Implement Candidate Path Resolver** (`src/candidate-resolver.ts`):
   - Integrates `findProjectRoot`, `ancestorChain`, and `descendantDirsBetween` from `@deepseek-ai/dsh-agent-instructions/files.ts`.
   - Resolves directory containment chains across input paths, collecting `instructionFileCandidates`.
   - Applies `dedupInstructionFilesByDirectory` and `renderWorkspaceInstructionSet` for budgeted rendering.
   - Extracts checkable axioms via `parseAxiomBlocks`.

4. **Implement Task Axiom Domain Specification & Storage** (`src/spec.ts`):
   - Define `taskAxiomsDomainSpec` with `defineDomain` and `TASK_AXIOMS_DOMAIN_VERSION = 1`.
   - Define Zod schema for `TaskAxiomDocument` under table `documents`.
   - Implement domain lifecycle in `AxiomRegistry`: open domain on `[Service.init]()`, register disposal on `ctx.effect`, and manage records via domain table handle.

5. **Implement Diff Analyzer & Consistency Checker** (`src/diff-analyzer.ts`, `src/consistency.ts`):
   - Parses unified git diff patches to extract modified file paths.
   - Maps modified paths to governing `AGENTS.md` chains and checkable axioms.
   - Compares parent and child checkable assertions to flag contradictory predicates.

6. **Implement AxiomRegistry Service & Tool Consumer** (`src/index.ts`, `src/tool.ts`):
   - Subclasses `Service` from `@deepseek-ai/cordis` as `AxiomRegistry`.
   - Exposes `resolve_candidate_axioms` tool definition via subpath export `@deepseek-ai/dsh-axiom/tool`.

7. **Preset & Patch Layer Configuration**:
   - Register `@deepseek-ai/dsh-storage-domain` route `task_axioms: sqlite` and `@deepseek-ai/dsh-axiom` in `packages/bundle/base/cordis.patch.yml` on the Host Plane.
   - Add tool row `tool-candidate-axioms` (`@deepseek-ai/dsh-axiom/tool`) to `packages/preset/agent-presets/presets/hermes-brain/agent.cordis.yml`.

8. **Test Suite & Verification**:
   - Implement unit and integration suites under `packages/axiom/axiom/tests/`.
   - Verify 100% test pass and full coverage.

## 12. Acceptance Criteria

- [ ] `AxiomRegistry` extends `@deepseek-ai/cordis.Service` and binds to `ctx.axioms` on the Host Plane.
- [ ] Machine-checkable axioms are authored inside `AGENTS.md` using ```` ```axiom ```` fenced YAML blocks.
- [ ] `parseAxiomBlocks` accurately extracts checkable axioms while treating surrounding text as model-binding prose.
- [ ] `resolveCandidateChain` resolves the broad-to-specific `AGENTS.md` chain for candidate paths before files are touched, reusing `findProjectRoot`, `ancestorChain`, and `dedupInstructionFilesByDirectory`.
- [ ] Model tool `resolve_candidate_axioms` is available in `hermes-brain` preset via tool row `tool-candidate-axioms` (`@deepseek-ai/dsh-axiom/tool`) and returns instructions and checkable axioms.
- [ ] Task axioms are persisted and updated via `ctx.storageDomain` (`task_axioms` domain) conforming to the domain schema with schema version validation.
- [ ] Git diff impact analyzer correctly maps modified files to their governing `AGENTS.md` chains.
- [ ] Hierarchical consistency checker flags contradictory assertions across parent/child `AGENTS.md` scopes.
- [ ] Obsolete packages `dsh-axiom-local` and `dsh-axiom-context` are removed/collapsed into `@deepseek-ai/dsh-axiom`.
- [ ] Preset composition conforms to `PRESET-RULES.md`: Host Service on Host Plane, tool row on Agent Plane with no isolate realm.

## 13. Deviation from the Mapping

- **Colocated `AGENTS.md` Architecture**: Overriding `plans/00-architecture-mapping.md` and `HERMES-AGENT-SPEC.md` §2 per the binding instruction in `AXIOM-COLOCATION.md`, the central truth registry (`.hermes/truth/`), truth index compiler (`.compiled/*.json`), and tree blindness guard (`INV-02`) are eliminated. Axioms are colocated with code in `AGENTS.md` files governed by directory containment.
- **Package Collapsing**:
  - `dsh-axiom-context` is eliminated: context injection is handled natively by `@deepseek-ai/dsh-agent-instructions`.
  - `dsh-axiom-local` is collapsed into `@deepseek-ai/dsh-axiom`: an artificial interface/provider split across two packages was removed in favor of a single coherent package owning `ctx.axioms`.

## Review fixes applied

- REVIEW-contracts #3: Resolved candidate-axioms tool row preset audit failure by explicitly declaring `@deepseek-ai/dsh-axiom/tool` under id `tool-candidate-axioms` in `hermes-brain/agent.cordis.yml`, keeping `AxiomRegistry` service on the host plane.
- REVIEW-storage finding (Task Axiom Store Storage Domain Reuse):
  - Evaluated repository `ctx.storageDomain` capability vs bespoke store or plain files under `~/.hermes/task-axioms/`.
  - Stated explicitly: the file path `~/.hermes/task-axioms/<row_id>.json` was an artifact of the ported Python Hermes specification, with no genuine external reader outside the Harness. All consumers access task axioms through `ctx.axioms.getTaskAxioms(rowId)`.
  - Selected **Option (a) — `ctx.storageDomain`** (`task_axioms` domain, version 1, table `documents`).
  - Reason: Task axiom contracts and proof records are small keyed documents mapped 1:1 by card/row ID. They require no cross-table transactions, no relational joins, no recursive DAG queries, and no multi-process lock retry policy (contrasting with Plan 01 Kanban). Synchronous in-memory reads eliminate disk latency during sweeper and completion checks, and the single-domain write chain guarantees atomic durability. Dropped custom filesystem tempfile/rename persistence machinery.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`task_axioms.py`, `truth_verify.py`, `truth_compile.py`, `truth_resolve.py`, `truth_impact.py`, `truth_check.py`, and `merge_card.py`) to accelerate axiom subsystem implementation.
