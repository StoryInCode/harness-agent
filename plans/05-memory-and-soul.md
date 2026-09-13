# 05 — SOUL Persona, Curated Memory Notes, & Transcript Search Tool

## Features

- Immutable human SOUL identity persona injected into system prompt Slot #1 (INV-09)
- Delimiter-separated semantic memory storage for persistent user and agent notes (USER.md, MEMORY.md)
- Cross-process mutual exclusion with POSIX file locking and atomic staging replacement
- Invariant prompt-snapshot prefix cache stability frozen across active turns (INV-08)
- Model-facing memory mutation tool supporting single actions and atomic batch operations
- Deferred batch character budget validation enforcing 2,200 char and 1,375 char ceilings
- Historical session transcript search reusing existing `@deepseek-ai/dsh-tool-session-query` package
- Unicode NFKC normalization and threat scanner blocking prompt injection vectors on write
- Load-time injection sanitization masking malicious entries with audit placeholders
- External drift detection and unreadable file protection with automated forensic backups
- Strict write-authority separation guaranteeing zero autonomous model authority over SOUL.md

## 1. Purpose

`@deepseek-ai/dsh-memory`, `@deepseek-ai/dsh-memory-local`, and `@deepseek-ai/dsh-tool-memory` (reusing existing `@deepseek-ai/dsh-tool-session-query`) establish the cognitive continuity, identity sovereignty, and episodic retrieval substrate for autonomous engineering in StoryInCode.

- **What it owns**:
  - The `memory` capability seam (`MemoryStore` abstract Service class in `@deepseek-ai/dsh-memory` extending `@deepseek-ai/cordis.Service`).
  - The filesystem storage provider (`LocalMemoryStore` in `@deepseek-ai/dsh-memory-local`) managing `~/.hermes/memories/USER.md` (user preferences) and `~/.hermes/memories/MEMORY.md` (agent operational notes) using `ENTRY_DELIMITER = "\n§\n"`.
  - Cross-process POSIX file locking (`USER.md.lock`, `MEMORY.md.lock`) and atomic temporary staging replacement (`.mem_<uuid>`).
  - Active enforcement of Invariant `INV-08` (Prompt Prefix Cache Stability), freezing a snapshot of curated memory notes at turn assembly so mid-turn tool mutations never invalidate KV prefix cache tokens.
  - Active enforcement of Invariant `INV-09` (Human SOUL Sovereignty), guaranteeing that `SOUL.md` is strictly human-authored with zero tool mutation paths exposed to the model.
  - Unicode NFKC normalization and threat pattern scanning blocking prompt injection and invisible control characters on memory write, and masking poisoned notes with `[BLOCKED: ...]` placeholders on load.
  - External drift detection backing up corrupted files to `.bak.<timestamp>` and failing closed on unreadable files.
  - Model-facing tool `memory` (`@deepseek-ai/dsh-tool-memory`) providing `add`, `replace`, `remove`, and batch `operations` with deferred character limit validation (2,200 chars for `MEMORY.md`, 1,375 chars for `USER.md`).
  - Historical session retrieval: reuses existing model-facing package `@deepseek-ai/dsh-tool-session-query` mounted in `hermes-brain` to expose `session_search` backed by host `ctx.sessionQuery`.
  - Identity Slot #1 system-prompt integration for `SOUL.md` via `@deepseek-ai/dsh-persona` (`PERSONA_PREFIX_SECTION`, order 0).

- **What it deliberately does NOT own**:
  - Long-term skill lifecycle state transitions (`active` -> `stale` -> `archived`) in `.curator_ledger.jsonl` (owned by `@deepseek-ai/dsh-memory-curator`, Plan 06).
  - Periodic background review forks every 10 turns and review subagent scheduling (owned by `@deepseek-ai/dsh-memory-curator`, Plan 06).
  - Host resource guards (`hermes-work.slice`, 3 GiB headroom admission gate `INV-12`, and generic file write interceptors) (owned by `@deepseek-ai/dsh-guard-resource`, Plan 08).
  - The underlying SQLite FTS5 database and session event corpus indexing (owned by `@deepseek-ai/dsh-session-query-sqlite` / `@deepseek-ai/dsh-session-query`, reused substrate).
  - The session query model tools (owned and provided by existing `@deepseek-ai/dsh-tool-session-query`, reused without duplication).
  - Colocated system axioms and card-level task axiom contracts (owned by `@deepseek-ai/dsh-axiom`, Plan 03).
  - Kanban card lifecycle transitions, DAG links, and CAS claims (owned by `@deepseek-ai/dsh-kanban-sqlite`, Plan 01).

## 2. Harness Architecture Fit

### 2.1 Exact Primitives
- `@deepseek-ai/dsh-memory`: **Service Definition** (`MemoryStore extends Service`). Merges `interface Context { memory: MemoryStore }` into `@deepseek-ai/cordis` (`packages/core/tools/src/index.ts:44-47`).
- `@deepseek-ai/dsh-memory-local`: **Service Provider & Prompt Contributor** (`LocalMemoryStore extends MemoryStore`). Implements POSIX locking, atomic renames, NFKC scanning, and contributes the turn-stable curated memory section (`memory:curated-notes`) to `ctx.systemPrompt`.
- `@deepseek-ai/dsh-tool-memory`: **Consumer / Model-Facing Tool**. Function plugin exporting `name`, `inject = ['tools', 'memory']`, `Config`, `apply(ctx)`. Registers model-facing tool `memory` via `ctx.tools.register()` (`packages/core/tools/src/index.ts:1027-1052`).
- `@deepseek-ai/dsh-tool-session-query`: **Existing Consumer / Model-Facing Tool** (`packages/session-query/tool-session-query`). Reused directly in agent preset `hermes-brain`; exports `session_search`, `session_event_search`, `session_trace`, `session_event_trace`, and `session_event_read` delegating to host `ctx.sessionQuery`.
- `SOUL.md` Persona Integration: **Agent-Preset Composition & Prompt Contribution** using existing `@deepseek-ai/dsh-persona` (`packages/preset/persona/src/index.ts:1-76`).

### 2.2 Host Plane vs Agent Plane Separation
- **Host Plane (`packages/bundle/base/cordis.patch.yml`)**:
  `@deepseek-ai/dsh-memory` and `@deepseek-ai/dsh-memory-local` reside strictly on the Host Plane (`PRESET-RULES.md:6`). Memory files (`~/.hermes/memories/USER.md` and `MEMORY.md`) represent multi-session, cross-agent durable state shared across the Brain orchestrator, worker runners, independent reviewers, and future curator processes. Per **PRESET-RULE 6**, a row that injects host services (`fs`) and resolves before any session exists belongs in the host composition.
- **Agent Plane (`presets/hermes-brain/agent.cordis.yml`, `presets/hermes-worker/agent.cordis.yml`)**:
  `@deepseek-ai/dsh-persona` shadows the deployment persona with `SOUL.md` (`packages/preset/persona/src/index.ts:6-12`). `@deepseek-ai/dsh-tool-memory` and `@deepseek-ai/dsh-tool-session-query` contribute tools to `ctx.tools`. Per **PRESET-RULE 4** (`PRESET-RULES.md:10`), rows that only register into host registries (`ctx.tools`, `ctx.systemPrompt`) and provide no Cordis service need no `isolate` realm.

### 2.3 Why SOUL.md is a Prompt Contribution and NOT a Skill
1. **Cognitive Domain (Identity vs Procedure)**: Per Spec §3.1 table, `SOUL.md` governs pervasive identity, communication axioms, and ethical posture. These rules must be active from turn zero across every prompt. In Harness, a skill (`dsh-skill`) is a procedural workflow loaded dynamically on-demand via `skill_view` (`packages/skill/tool-skill/README.md:84`). An agent cannot decide whether to adopt its identity; identity is non-optional.
2. **Prompt Prefix Cache Primacy**: Modern LLMs cache KV activations strictly from the beginning of the prompt. `SOUL.md` sits in Identity Slot #1 (`PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'`, order `DEPLOYMENT_PERSONA_PREFIX = 0` in `packages/core/system-prompt/src/index.ts:123, 174`). A dynamically loaded skill appears late in the prompt, destroying prefix cache reuse.
3. **Write Sovereignty Invariant (`INV-09`)**: Skills are subject to inspection and autonomous revision (`skill_manage`, curator consolidation in Plan 06). Placing `SOUL.md` in a skill package would expose identity to procedural skill management mechanisms. As a prompt contribution, `SOUL.md` is rendered read-only into prompt assembly.

### 2.4 Reusing Existing Session Query Tooling
DeepSeek Harness already includes `@deepseek-ai/dsh-tool-session-query` (`packages/session-query/tool-session-query`) alongside `@deepseek-ai/dsh-session-query-sqlite` and `@deepseek-ai/dsh-session-query`. Creating a duplicate package (`@deepseek-ai/dsh-tool-session-search`) would violate the Monorepo Reuse Mandate (`packages/AGENTS.md:11`), introduce maintenance overhead, and cause tool collisions on `ctx.tools.register('session_search')`.

- **What the Existing Package Already Provides**:
  1. **Five Read-Only Model Tools**: `session_search` (matches prior sessions via BM25 full-text query, returning title and ranked excerpts), `session_event_search` (event search within a session), `session_trace` (authorized session ancestor/descendant tree), `session_event_trace` (direct replacement and source event relationships), and `session_event_read` (unabridged event payload JSON).
  2. **Caller-Derived Workspace Authority**: Uses `ToolExecution.exec.agent` to derive caller identity and enforces exact-string `cwd` equality between caller and target session (`packages/session-query/tool-session-query/src/workspace-access.ts:18-35`).
  3. **Cursor-Free Result Formatting**: Pages through provider cursors internally up to `maxSearchResults`, returning clean plain-text excerpts without exposing pagination tokens or cursors to the model.
  4. **Boundary Sanitization & Safety**: Sanitizes provider diagnostics into safe error codes (`src/service-boundary.ts`), preserves caller cancellation, and respects cooperative search deadlines (`searchTimeoutMs`).
  5. **Shared Prompt Guidance**: Injects system prompt section `tool:session-query` teaching the model to follow `session_search` hits with trace or read operations.
- **What Genuinely Still Needs Adding**:
  - **Zero new packages or code files**: No package setup, schemas, or service boundaries need to be authored.
  - **Preset Configuration Only**: In `presets/hermes-brain/agent.cordis.yml`, configure the existing `@deepseek-ai/dsh-tool-session-query` with `maxSearchResults: 20` (bounding hit count to conserve LLM token context) and `searchTimeoutMs: 15000` (15-second cooperative timeout).

### 2.5 Write-Authority Split (Human SOUL Sovereignty - INV-09)
1. **Tool Domain Exclusion**: No tool registered in the runtime accepts `SOUL.md` as a target. The `memory` tool strictly restricts targets to `memory` (`MEMORY.md`) and `user` (`USER.md`).
2. **Tool Guard Enforcement**: The host resource guard (`ctx.tools.guard()` in `@deepseek-ai/dsh-guard-resource`, Plan 08) monitors all filesystem mutation tools (`write_file`, `edit_file`, `str_replace_editor`, `bash`). Any call attempting to write, truncate, or delete `SOUL.md` is synchronously vetoed before execution (`packages/core/tools/src/index.ts:1100-1106`).
3. **OS Permission Boundary**: `~/.hermes/SOUL.md` is provisioned with read-only permissions for the worker runtime user (`chmod 644`), writable only by the human founder or administrator.

## 3. Spec Coverage

| Spec Requirement | Handled Here | Delegated Elsewhere | Architectural Reason |
|---|---|---|---|
| SOUL identity persona (Slot #1) (§3.1) | Yes (`@deepseek-ai/dsh-persona`, order 0) | None | Eager Identity Slot #1 prompt contribution |
| Zero autonomous SOUL edit authority (`INV-09`) (§3.1) | Yes (`memory` tool rejects soul; write-authority split) | `@deepseek-ai/dsh-guard-resource` (Plan 08) | Tool schema omits soul; host guard blocks fs/bash tools |
| Curated semantic notes (`USER.md`, `MEMORY.md`) (§3.2) | Yes (`MemoryStore`, `LocalMemoryStore`) | None | Plaintext files with `\n§\n` delimiters |
| Storage locking & atomic replace (§3.2, §3.3) | Yes (`LocalMemoryStore.mutate`) | None | POSIX `.lock` files + atomic rename (`.mem_<uuid>`) |
| Model tool `memory` (add, replace, remove) (§3.3) | Yes (`@deepseek-ai/dsh-tool-memory`) | None | Model presentation layer mapping intent to store ops |
| Deferred batch budget validation (§3.3) | Yes (`LocalMemoryStore`, `tool-memory`) | None | Budget checked against final state of batch ops |
| Turn prefix cache stability (`INV-08`) (§3.4) | Yes (`LocalMemoryStore` prompt snapshot, order 10) | None | Snapshot frozen at turn start, immune to mid-turn writes |
| Historical session FTS retrieval (`session_search`) (§3.4) | Reused (`@deepseek-ai/dsh-tool-session-query`) | `@deepseek-ai/dsh-session-query-sqlite` (Core) | Reuses existing tool package; configured with `maxSearchResults: 20` in `hermes-brain` preset |
| Threat scanning & NFKC normalization (§3.7) | Yes (`LocalMemoryStore.scanThreat`) | None | Input sanitization & invisible control code rejection |
| Load-time sanitization (`[BLOCKED: ...]`) (§3.7) | Yes (`LocalMemoryStore.loadSanitized`) | None | Masks poisoned entries in prompt while preserving raw disk |
| External drift detection & backups (§3.7) | Yes (`LocalMemoryStore.parseWithDriftGuard`) | None | Creates `.bak.<timestamp>` on malformed non-delimited edits |
| Unreadable file guard (§3.7) | Yes (`LocalMemoryStore.readSafe`) | None | Fails closed on EACCES/EIO to prevent accidental wipe |
| Skill curator daemon (§3.5) | No | `@deepseek-ai/dsh-memory-curator` (Plan 06) | Periodic daemon managing skill lifecycle decay |
| Background review fork (every 10 turns) (§3.6) | No | `@deepseek-ai/dsh-memory-curator` (Plan 06) | Event hook on `agent/turn-stopping` spawning subagents |
| Unattended deletion protection staging (§3.7) | No | `@deepseek-ai/dsh-memory-curator` (Plan 06) | Intercepts reviewer deletions into approval queue |
| Host memory headroom floor 3 GiB (`INV-12`) (§3.7) | No | `@deepseek-ai/dsh-guard-resource` (Plan 08) | Resource admission gate evaluating `/proc/meminfo` |

## 4. Proposed Package / File Layout

```
packages/
└── memory/
    ├── memory/                               # @deepseek-ai/dsh-memory (Service Definition)
    │   ├── package.json, tsconfig.json, README.md
    │   └── src/
    │       ├── index.ts                      # Abstract MemoryStore class & Context augment
    │       ├── types.ts                      # MemoryNote, MemoryTarget, MemoryOperation, MemoryBudget
    │       ├── errors.ts                     # MemoryError, MemoryBudgetError, MemoryThreatError, DriftError
    │       └── events.ts                     # memory/changed, memory/drift-detected typed Cordis events
    ├── memory-local/                         # @deepseek-ai/dsh-memory-local (Service Provider)
    │   ├── package.json, tsconfig.json, README.md
    │   ├── src/
    │   │   ├── index.ts                      # LocalMemoryStore default export & lifecycle apply
    │   │   ├── parser.ts                     # ENTRY_DELIMITER (\n§\n) splitter, normalizer, serializer
    │   │   ├── lock.ts                       # Cross-process POSIX .lock manager & atomic file renamer
    │   │   ├── security.ts                   # Unicode NFKC normalization & regex threat pattern scanner
    │   │   └── snapshot.ts                   # Turn-stable prompt snapshot manager (order 10)
    │   └── tests/
    │       ├── store-contract.spec.ts        # MemoryStore contract test suite
    │       ├── parser-delimiter.spec.ts      # Delimiter parsing, blank stripping, drift detection
    │       ├── lock-concurrency.spec.ts      # Multi-process mutual exclusion & stale lock recovery
    │       ├── threat-scanner.spec.ts        # NFKC bypass tests, prompt injection detection
    │       ├── prefix-cache-stability.spec.ts# INV-08: mid-turn writes do not alter prompt snapshot
    │       └── hmr-disposal.spec.ts          # Section cleanup and resource disposal on unload
    └── tool-memory/                          # @deepseek-ai/dsh-tool-memory (Consumer Tool)
        ├── package.json, tsconfig.json, README.md
        ├── src/
        │   ├── index.ts                      # Named export apply, inject=['tools', 'memory']
        │   ├── schema.ts                     # Tool input/output schemas, parameter compilation
        │   ├── operations.ts                 # Single & batch action executor, deferred validation
        │   └── presentation.ts               # Host presentCall & presentResult projections
        └── tests/
            ├── tool-memory.spec.ts           # Tool execution, add/replace/remove semantics
            ├── deferred-batch.spec.ts        # Simultaneous remove+add under maximum capacity
            └── soul-protection.spec.ts       # INV-09: verification that tool rejects target='soul'
```

*(Note: Historical session search introduces no new package in this tree. It directly reuses the existing `@deepseek-ai/dsh-tool-session-query` package located at `packages/session-query/tool-session-query/`.)*

## 5. Public Contracts

### 5.1 Core Types & Errors (`packages/memory/memory/src/types.ts`, `errors.ts`)

```typescript
// packages/memory/memory/src/types.ts
export type MemoryTarget = 'memory' | 'user'
export type MemoryAction = 'add' | 'replace' | 'remove'

export interface MemoryNote {
  readonly id: string
  readonly content: string
  readonly sanitizedContent: string
  readonly isBlocked: boolean
}

export interface MemoryOperation {
  readonly action: MemoryAction
  readonly content?: string
  readonly oldText?: string
  readonly newText?: string
}

export interface MemoryBudget {
  readonly target: MemoryTarget
  readonly charLimit: number
  readonly currentChars: number
  readonly remainingChars: number
}

export interface MemoryBatchResult {
  readonly target: MemoryTarget
  readonly operationsApplied: number
  readonly notesCount: number
  readonly charCount: number
  readonly charLimit: number
  readonly notes: readonly MemoryNote[]
}

// packages/memory/memory/src/errors.ts
export class MemoryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'MemoryError'
  }
}
export class MemoryBudgetExceededError extends MemoryError {
  constructor(target: MemoryTarget, attempted: number, limit: number) {
    super(`Memory budget exceeded for ${target}: ${attempted} chars exceeds limit of ${limit} chars`, 'MEMORY_BUDGET_EXCEEDED')
  }
}
export class MemoryThreatDetectedError extends MemoryError {
  constructor(reason: string) {
    super(`Memory write rejected due to security threat: ${reason}`, 'MEMORY_THREAT_DETECTED')
  }
}
export class MemoryDriftError extends MemoryError {
  constructor(path: string, backupPath: string) {
    super(`Memory file at ${path} has drifted (missing delimiter). Backup saved to ${backupPath}`, 'MEMORY_DRIFT_DETECTED')
  }
}
export class MemoryReadError extends MemoryError {
  constructor(path: string, cause: unknown) {
    super(`Failed to read memory file at ${path}: ${String(cause)}`, 'MEMORY_READ_FAILED')
  }
}
```

### 5.2 Capability Seam (`packages/memory/memory/src/index.ts`)

```typescript
// packages/memory/memory/src/index.ts
import { Context, Service } from '@deepseek-ai/cordis'
import type { MemoryBudget, MemoryBatchResult, MemoryNote, MemoryOperation, MemoryTarget } from './types.ts'

export const ENTRY_DELIMITER = '\n§\n'
export const MEMORY_CHAR_LIMIT = 2200
export const USER_CHAR_LIMIT = 1375

declare module '@deepseek-ai/cordis' {
  interface Context {
    memory: MemoryStore
  }
  interface Events {
    'memory/changed'(payload: { target: MemoryTarget; charCount: number }): void
    'memory/drift-detected'(payload: { target: MemoryTarget; backupPath: string }): void
  }
}

export abstract class MemoryStore extends Service {
  static inject = ['fs']
  constructor(ctx: Context, name = 'memory') {
    super(ctx, name)
  }
  /** Read all parsed memory notes for target, evaluating load-time sanitization. */
  abstract getNotes(target: MemoryTarget): Promise<readonly MemoryNote[]>
  /** Read raw formatted file content from disk. */
  abstract getRawContent(target: MemoryTarget): Promise<string>
  /** Get budget allocation and remaining character capacity for target. */
  abstract getBudget(target: MemoryTarget): Promise<MemoryBudget>
  /** Execute atomic batch operations under POSIX lock with deferred character budget validation. */
  abstract mutate(target: MemoryTarget, operations: readonly MemoryOperation[]): Promise<MemoryBatchResult>
  /** Read turn-stable prompt snapshot captured at turn boundary (INV-08). */
  abstract getTurnPromptSnapshot(): string
}
export default MemoryStore
```

### 5.3 Local Provider Implementation (`packages/memory/memory-local/src/index.ts`)

```typescript
// packages/memory/memory-local/src/index.ts
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MemoryStore, MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT } from '@deepseek-ai/dsh-memory'
import type { MemoryBudget, MemoryBatchResult, MemoryNote, MemoryOperation, MemoryTarget } from '@deepseek-ai/dsh-memory'
import { MemoryFileLock } from './lock.ts'
import { parseDelimitedNotes, serializeNotes } from './parser.ts'
import { scanThreat, sanitizeNote } from './security.ts'

export interface Config {
  memoriesDir?: string
  memoryCharLimit?: number
  userCharLimit?: number
  lockTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  memoriesDir: z.string().default('~/.hermes/memories'),
  memoryCharLimit: z.number().default(MEMORY_CHAR_LIMIT),
  userCharLimit: z.number().default(USER_CHAR_LIMIT),
  lockTimeoutMs: z.number().default(5000),
})

export class LocalMemoryStore extends MemoryStore {
  static inject = ['fs', 'systemPrompt']
  private readonly _memoriesDir: string
  private readonly _memoryLimit: number
  private readonly _userLimit: number
  private readonly _lockTimeoutMs: number
  private _frozenPromptSnapshot = ''

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'memory')
    this._memoriesDir = config.memoriesDir ?? '~/.hermes/memories'
    this._memoryLimit = config.memoryCharLimit ?? MEMORY_CHAR_LIMIT
    this._userLimit = config.userCharLimit ?? USER_CHAR_LIMIT
    this._lockTimeoutMs = config.lockTimeoutMs ?? 5000

    ctx.effect(() => {
      this._capturePromptSnapshot()
      return ctx.systemPrompt.section({
        name: 'memory:curated-notes',
        order: 10,
        text: () => this.getTurnPromptSnapshot(),
      })
    }, 'memory.systemPrompt')
  }

  getTurnPromptSnapshot(): string {
    return this._frozenPromptSnapshot
  }

  private _capturePromptSnapshot(): void {
    const userText = this._readSafe('user')
    const memoryText = this._readSafe('memory')
    this._frozenPromptSnapshot = [
      '# Curated Memory',
      '## User Profile (USER.md)',
      userText || '(No user notes recorded)',
      '## System & Environment Notes (MEMORY.md)',
      memoryText || '(No operational notes recorded)',
    ].join('\n\n')
  }

  async mutate(target: MemoryTarget, operations: readonly MemoryOperation[]): Promise<MemoryBatchResult> {
    const lock = new MemoryFileLock(this._getFilePath(target), this._lockTimeoutMs)
    return await lock.withLock(async () => {
      const currentNotes = await this.getNotes(target)
      let mutableNotes = [...currentNotes.map(n => n.content)]

      for (const op of operations) {
        if (op.action === 'add' && op.content) {
          scanThreat(op.content)
          mutableNotes.push(op.content.trim())
        } else if (op.action === 'remove') {
          const needle = (op.oldText ?? op.content ?? '').trim()
          mutableNotes = mutableNotes.filter(n => n !== needle && !n.includes(needle))
        } else if (op.action === 'replace' && (op.newText ?? op.content)) {
          const replacement = (op.newText ?? op.content)!.trim()
          scanThreat(replacement)
          const needle = (op.oldText ?? '').trim()
          mutableNotes = mutableNotes.map(n => (n === needle || n.includes(needle) ? replacement : n))
        }
      }

      // Deferred batch validation: check total length against ceiling only at end of batch
      const serialized = serializeNotes(mutableNotes)
      const limit = target === 'memory' ? this._memoryLimit : this._userLimit
      if (serialized.length > limit) {
        throw new MemoryBudgetExceededError(target, serialized.length, limit)
      }

      await lock.atomicWrite(serialized)
      this.ctx.emit('memory/changed', { target, charCount: serialized.length })

      // Note: _frozenPromptSnapshot is deliberately NOT updated here to satisfy INV-08
      return {
        target,
        operationsApplied: operations.length,
        notesCount: mutableNotes.length,
        charCount: serialized.length,
        charLimit: limit,
        notes: mutableNotes.map((content, idx) => ({
          id: `${target}-${idx}`,
          content,
          sanitizedContent: sanitizeNote(content),
          isBlocked: false,
        })),
      }
    })
  }
}
export default LocalMemoryStore
```

### 5.4 Model Tool Contracts

#### 5.4.1 `memory` Tool (`packages/memory/tool-memory/src/schema.ts`)

```typescript
// packages/memory/tool-memory/src/schema.ts
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

export const memoryToolParameters = {
  action: {
    type: 'string',
    enum: ['add', 'replace', 'remove'],
    description: 'Operation to perform for a single mutation. Omit when using operations array.',
  },
  target: {
    type: 'string',
    enum: ['memory', 'user'],
    required: true,
    description: 'Target note store: "memory" for operational notes, "user" for founder preferences. SOUL.md cannot be targeted.',
  },
  content: {
    type: 'string',
    description: 'Note text for "add", or replacement text for "replace". Must not contain injection payloads.',
  },
  old_text: {
    type: 'string',
    description: 'Existing text snippet to match for "replace" or "remove".',
  },
  new_text: {
    type: 'string',
    description: 'Replacement text for "replace" action.',
  },
  operations: {
    type: 'array',
    description: 'Atomic batch of operations evaluated sequentially with deferred character budget validation.',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['add', 'replace', 'remove'], required: true },
        content: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
      },
    },
  },
} as const satisfies ParameterSchemaSpec

export const memoryOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    success: { type: 'boolean', required: true },
    target: { type: 'string', enum: ['memory', 'user'], required: true },
    operationsApplied: { type: 'integer', required: true },
    charCount: { type: 'integer', required: true },
    charLimit: { type: 'integer', required: true },
    notesCount: { type: 'integer', required: true },
  },
} as const
```

#### 5.4.2 Reused Historical Session Query Tool Contract (`@deepseek-ai/dsh-tool-session-query`)

Rather than authoring a duplicate package, Hermes reuses the shipped `@deepseek-ai/dsh-tool-session-query` package (`packages/session-query/tool-session-query/src/index.ts`).

```typescript
// Reused from packages/session-query/tool-session-query/src/index.ts
export const name = 'tool-session-query'
export const inject = ['tools', 'systemPrompt', 'sessionQuery', 'sessionProjections']

export interface Config {
  /** Maximum authorized hits returned by one search call. Defaults to 100. */
  maxSearchResults?: number
  /** Cooperative full-text search deadline in milliseconds. Defaults to 30000. */
  searchTimeoutMs?: number
}
```

- **What the Shipped Tool Provides Out-of-the-Box**:
  1. `session_search`: Queries prior sessions within the caller's authorized workspace (`cwd`) using BM25 full-text search against the SQLite index, returning ranked hits with session title and excerpts.
  2. `session_event_search`: Intrasession event search over historical events.
  3. `session_trace`: Lineage inspection returning authorized parent/child session trees.
  4. `session_event_trace`: Causal graph tracing event replacements and references.
  5. `session_event_read`: Exact unabridged event JSON payload retrieval.
  6. Shared prompt section `tool:session-query` providing guidance to the model.
- **Hermes Configuration**: The preset configures `maxSearchResults: 20` (limiting search result context consumption) and `searchTimeoutMs: 15000` (15-second cooperative timeout). No custom package or schema implementation is required.

## 6. Lifecycle and Scoping

### 6.1 Placement Matrix & Plane Invariants

| Component | Plane | Cordis Scope | `isolate` Realm? | Registry Target | Reason / Invariant |
|---|---|---|---|---|---|
| `@deepseek-ai/dsh-memory` | Host | Root Container | No | `ctx.memory` | Core Service Definition |
| `@deepseek-ai/dsh-memory-local` | Host | Root Container | No | `ctx.memory`, `systemPrompt` | Injects `fs`, cross-session file persistence (PRESET-RULE 6) |
| `@deepseek-ai/dsh-persona` | Agent | Agent Scope | No | `ctx.systemPrompt` | Shadows deployment persona with `SOUL.md` (PRESET-RULE 1) |
| `@deepseek-ai/dsh-tool-memory` | Agent | Agent Scope | No | `ctx.tools` | Registry contributor; scoped tool presentation (PRESET-RULE 4) |
| `@deepseek-ai/dsh-tool-session-query` | Agent | Agent Scope | No | `ctx.tools` | Existing registry contributor querying host `sessionQuery` (PRESET-RULE 4) |

### 6.2 Application and Disposal Mechanics
1. **Host-Plane Activation**: `LocalMemoryStore` loads at host boot in `packages/bundle/base/cordis.patch.yml`. It parses `USER.md` and `MEMORY.md`, establishes POSIX lock paths, and registers `memory:curated-notes` on `ctx.systemPrompt` at order 10. Teardown unbinds the prompt section cleanly via `ctx.effect()`.
2. **Agent-Plane Tool Mounting**: When an agent session mounts `hermes-brain` or `hermes-worker`, `@deepseek-ai/dsh-tool-memory` and (for `hermes-brain`) existing `@deepseek-ai/dsh-tool-session-query` register their respective tools into the agent's scoped `ctx.tools` runtime. Disposing the agent scope unregisters the tools and emits `tools/change` (`packages/core/tools/src/index.ts:1047-1051`).
3. **Turn Snapshot Cache Stability (`INV-08`)**: `LocalMemoryStore` captures a frozen snapshot of curated notes when a session opens. When `ctx.systemPrompt.section` executes, it renders this frozen string. Mid-turn tool calls modify disk files immediately but do not touch the session's active prompt snapshot, maintaining byte-identical prefix hashes across turns.

## 7. Agent Preset Integration

### 7.1 Preset Configuration Rows (`hermes-brain` and `hermes-worker`)

```yaml
# presets/hermes-brain/agent.cordis.yml & presets/hermes-worker/agent.cordis.yml

# ── Identity Slot #1: Human SOUL Persona ─────────────────────────────────────
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    # Read immutable SOUL.md into Slot #1 (order 0: DEPLOYMENT_PERSONA_PREFIX)
    prefix: !!js readFileSync(process.env.HERMES_SOUL_PATH || (process.env.HOME + '/.hermes/SOUL.md'), 'utf8')
    suffix: ''
    complete: false
    includeRuntimeContext: true

# ── Model Tools: Memory Notes & Historical Session Search ─────────────────────
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'

# Reuses existing shipped tool package @deepseek-ai/dsh-tool-session-query in hermes-brain
- id: tool-session-search
  name: '@deepseek-ai/dsh-tool-session-query'
  config:
    maxSearchResults: 20
    searchTimeoutMs: 15000
```

### 7.2 What Becomes Visible Inside the Preset
1. **System Prompt**:
   - Identity Slot #1 (order 0): Complete `SOUL.md` persona text (action-first style, no filler, plain technical communication).
   - Identity Slot #2 (order 10): Curated memory notes (`USER.md` + `MEMORY.md`), frozen per turn (`INV-08`).
2. **Tools**:
   - `memory`: Available to both `hermes-brain` and `hermes-worker` to record durable semantic facts.
   - `session_search`: Available to `hermes-brain` to retrieve past decisions and architectural context from historical transcripts.

## 8. Execution Flow

### 8.1 Scenario A: Initial Boot & Turn Prompt Assembly (`INV-08`)
1. **Host Boot**: `LocalMemoryStore` reads `USER.md` and `MEMORY.md`, replaces poisoned entries with `[BLOCKED: ...]`, and freezes `_frozenPromptSnapshot`.
2. **Turn Assembly**: Agent loop runs `agent/pre-step` and renders prompt sections (`packages/core/agent-loop/README.md:119`).
3. **Slot #1 Injection**: `@deepseek-ai/dsh-persona` renders `SOUL.md` at order 0 (`DEPLOYMENT_PERSONA_PREFIX`).
4. **Slot #2 Injection**: `LocalMemoryStore` renders `_frozenPromptSnapshot` at order 10 (`memory:curated-notes`).
5. **Prefix Cache Hit**: Top of prompt context remains static and identical across sequential turns.

### 8.2 Scenario B: Atomic Batch Memory Mutation with Deferred Validation
1. **Tool Invocation**: Agent calls `memory` tool with `operations` (e.g. `remove` 300 chars, `add` 250 chars).
2. **Lock Acquisition**: `LocalMemoryStore` acquires POSIX lock (`MEMORY.md.lock`, 5000ms timeout).
3. **In-Memory Sequential Mutation**: Applies removals first, then validates addition content with NFKC threat scanner.
4. **Deferred Budget Check**: Final serialized character length (2,000 chars) is verified against the 2,200 char ceiling.
5. **Atomic Commit**: Serialized payload is written to `.mem_<uuid>` and atomically renamed over `MEMORY.md`.
6. **Bus Event**: Emits `'memory/changed'` on host bus. `_frozenPromptSnapshot` in live session remains unchanged (`INV-08`).

#### 8.3 Scenario C: Historical Session Retrieval (`session_search`)
1. **Tool Invocation**: Model calls `session_search({ query: "Kahn algorithm" })`.
2. **Delegation**: Existing `@deepseek-ai/dsh-tool-session-query` forwards query to `ctx.sessionQuery.searchSessions` through its service boundary (`packages/session-query/tool-session-query/src/operations.ts:25-45`).
3. **FTS5 Search**: `SessionQueryEngine` runs BM25 full-text query across SQLite `messages_fts` table (`packages/session-query/session-query/src/index.ts:152-156`).
4. **Hit Formatting**: Top matching sessions, event sequences, and snippets are formatted as structured plain-text output bounded by `maxSearchResults: 20`.

## 9. Error, Cancellation, and Lifecycle Behavior

### 9.1 File Lock Contention and Stale Lock Recovery
- **Lock Acquisition**: `MemoryFileLock` uses cooperative lock files with exponential backoff (25ms to 500ms) up to `lockTimeoutMs` (5,000ms).
- **Timeout Rejection**: If the lock cannot be acquired within 5,000ms, mutation fails with `MemoryLockError`.
- **Stale Lock Recovery**: If lock file age exceeds 60,000ms and recorded PID is dead (`process.kill(pid, 0)` throws `ESRCH`), the lock is reclaimed.

### 9.2 External Drift Detection & Recovery
- **Detection**: When parsing `USER.md` or `MEMORY.md`, if text lacks `\n§\n` delimiters, `LocalMemoryStore` flags external drift.
- **Forensic Preservation**: Saves a forensic backup to `<file>.bak.<timestamp>`.
- **Remediation Error**: Throws `MemoryDriftError`, notifying the operator and failing closed to prevent data erasure.

### 9.3 Unreadable File Guard
If `fs.readFile` fails with `EACCES` or `EIO`, the provider fails closed with `MemoryReadError`, refusing to assume an empty file and preventing wipeouts.

### 9.4 Threat Injection Handling
- **On Write**: `scanThreat()` applies NFKC normalization and regex checks. Malicious payloads throw `MemoryThreatDetectedError` immediately, aborting writes.
- **On Load**: Malicious entries found on disk are masked in `_frozenPromptSnapshot` with `[BLOCKED: security threat detected]`, while raw disk text is preserved for audit.

## 10. Testing Strategy

### 10.1 Unit Tests (`packages/memory/memory-local/tests/`, `tool-memory/tests/`)
- `parser-delimiter.spec.ts`: Test `\n§\n` splitting, blank trimming, empty note filtering, and serialization.
- `threat-scanner.spec.ts`: Test NFKC homoglyph normalization, zero-width space rejection (`\u200B`), and prompt injection blocking.
- `deferred-batch.spec.ts`: At 2,150 / 2,200 chars, verify single 100 char add fails, while batch `remove` (200 chars) + `add` (100 chars) succeeds.

### 10.2 Concurrency & Integration Tests (`lock-concurrency.spec.ts`)
- 5 concurrent worker processes submit simultaneous mutations to `MEMORY.md`.
- Verify zero file corruptions, no lost updates, and correct stale lock reclamation after `SIGKILL`.

### 10.3 Invariant Enforcement Tests
- **`prefix-cache-stability.spec.ts` (INV-08)**: Verify mid-turn `memory` tool mutation alters disk immediately but prompt assembly SHA-256 hash remains 100% byte-identical within the active session.
- **`soul-protection.spec.ts` (INV-09)**: Inspect tool schemas to verify `target` rejects `'soul'`, and reflect over runtime tool registry to verify zero tools can mutate `SOUL.md`.

### 10.4 Preset Session Query Integration Verification
- Verify that mounting existing `@deepseek-ai/dsh-tool-session-query` inside `hermes-brain` registers `session_search` into `ctx.tools`, delegates through `ctx.sessionQuery`, and respects configured `maxSearchResults: 20` and `searchTimeoutMs: 15000`.

### 10.5 HMR and Disposal Tests (`hmr-disposal.spec.ts`)
- Mount tools in scoped context; dispose fiber and assert `ctx.tools` removes entries and fires `tools/change`.

## Port sources

| Capability in this plan | Hermes source file(s) | What to take | What must change in the port | Effort |
|---|---|---|---|---|
| Curated memory notes model & delimiter parsing | `/home/sic/Downloads/hermes-agent-main/tools/memory_tool_store.py:19-24, 66-85` | `ENTRY_DELIMITER = "\n§\n"`, block headers (`MEMORY (your personal notes)`, `USER PROFILE (who the user is)`), and storage separation between `USER.md` (1,375 chars) and `MEMORY.md` (2,200 chars). | Convert Python string routines to TypeScript parser in `parser.ts` (`parseEntries`, `serializeEntries`), with typed interfaces (`MemoryNote`, `MemoryTarget`). | direct port |
| File storage, POSIX locking & atomic replacement | `/home/sic/Downloads/hermes-agent-main/tools/memory_tool_store.py:140-160, 190-213` | POSIX file lock protocol (`fcntl.flock(LOCK_EX)` / `.lock` files), atomic replacement using temporary files (`atomic_write_text`), and directory creation logic. | Translate Python `fcntl` to Node.js `fs.openSync` with `fs.flockSync` or bespoke `.lock` mechanism in `src/lock.ts`, and perform atomic replacement via `.mem_<uuid>` staging rename. | direct port |
| Single and batch memory operations with deferred validation | `/home/sic/Downloads/hermes-agent-main/tools/memory_tool.py:80-120, 260-335`<br>`/home/sic/Downloads/hermes-agent-main/tools/memory_tool_store.py:214-250` | Mutation actions (`add`, `replace`, `remove`), unique substring matching (`_find_unique_match`), and batch operations list processing where character limits are validated only against the final resulting state. | Convert Python dictionaries to TypeScript execution handlers in `src/operations.ts`, returning typed success/error responses. | direct port |
| Prompt prefix cache stability (`INV-08`) | `/home/sic/Downloads/hermes-agent-main/tools/memory_tool_store.py:66-85`<br>`/home/sic/Downloads/hermes-agent-main/agent/prompt_builder.py:1450-1485` | Turn-stable snapshot pattern: `_system_prompt_snapshot` is captured once at session/turn start and frozen; mid-turn writes to disk and memory state never mutate the active turn's prompt, guaranteeing prefix cache stability. | Implement Cordis system-prompt contributor in `src/snapshot.ts` contributing prompt section `memory:curated-notes` at order 10 with a turn-immutable frozen string. | port with adaptation |
| Human SOUL identity sovereignty (`INV-09`) | `/home/sic/Downloads/hermes-agent-main/agent/prompt_builder.py:1450-1485`<br>`/home/sic/Downloads/hermes-agent-main/tools/file_tools_write_guards.py:129-140` | Primary identity injection in Identity Slot #1 (`~/.hermes/SOUL.md`), strict omission of `soul` from mutable tool targets, and protected file write guards preventing automated edits to `SOUL.md`. | Shadow deployment persona via Cordis `@deepseek-ai/dsh-persona` integration at order `DEPLOYMENT_PERSONA_PREFIX = 0`, and enforce `INV-09` via host resource guard blocking filesystem mutation tools. | port with adaptation |
| Unicode NFKC normalization & threat pattern scanner | `/home/sic/Downloads/hermes-agent-main/tools/threat_patterns.py:12-98`<br>`/home/sic/Downloads/hermes-agent-main/tools/memory_tool_store.py:25-30` | Unicode NFKC normalization, `INVISIBLE_CHARS` detection (zero-width spaces, direction isolates), regex patterns for prompt injection (`_PATTERNS` in `strict` and `context` scopes), and load-time masking placeholder (`[BLOCKED: ...]`). | Port Python `unicodedata.normalize` and regexes to JavaScript `String.prototype.normalize('NFKC')` and TypeScript security module in `src/security.ts`. | direct port |
| External drift detection & corrupt file forensics | `/home/sic/Downloads/hermes-agent-main/tools/memory_tool_store.py:35-55, 190-213` | Drift detection algorithm: verify file on disk round-trips cleanly through `\n§\n` parser before saving; if non-conforming content exists, backup to `.bak.<timestamp>`, abort mutation, and return remediation instructions. Fail closed on unreadable files (`_read_failed_error`). | Convert Python exception handling to TypeScript `MemoryDriftError` and `MemoryReadError` classes, saving backup via `ctx.fs`. | direct port |
| Historical session retrieval integration | `/home/sic/Downloads/hermes-agent-main/tools/session_search_tool.py:1-60, 200-350` | Session query parameters and ranking semantics (demoting background/cron sessions, filtering hidden sources, excerpt formatting). | Reused existing `@deepseek-ai/dsh-tool-session-query` package; configured with `maxSearchResults: 20` and `searchTimeoutMs: 15000` in `hermes-brain` preset (no new code needed). | reference only |

The single most valuable capability to port is the delimiter-separated memory note parser with atomic POSIX locking, deferred batch validation, and prompt-snapshot freeze (`tools/memory_tool_store.py:19-24, 66-85, 190-250`). It preserves prompt prefix cache stability across multi-turn sessions while enabling atomic memory consolidation under strict character limits without intermediate overflow failures.

## 11. Implementation Steps

1. **Package Setup**: Create `packages/memory/memory`, `memory-local`, and `tool-memory`.
2. **Service Definition (`@deepseek-ai/dsh-memory`)**: Implement `types.ts`, `errors.ts`, `events.ts`, and abstract `MemoryStore` class.
3. **Local Provider (`@deepseek-ai/dsh-memory-local`)**:
   - Implement `parser.ts` (`\n§\n` delimiter) and `security.ts` (NFKC + threat scanner).
   - Implement `lock.ts` (POSIX `.lock`, timeout, stale recovery, atomic rename).
   - Implement `LocalMemoryStore` registering prompt section at order 10 (`INV-08`).
4. **Memory Tool (`@deepseek-ai/dsh-tool-memory`)**: Implement `schema.ts`, `operations.ts` (deferred budget validation), and `presentation.ts`.
5. **Validate Existing Session Query Tool**: Verify that existing `@deepseek-ai/dsh-tool-session-query` (`packages/session-query/tool-session-query`) cleanly resolves in preset tests with `maxSearchResults: 20` and `searchTimeoutMs: 15000` without requiring custom code.
6. **Preset & Bundle Composition**: Add `dsh-memory-local` to host bundle `cordis.patch.yml`; add `dsh-persona`, `dsh-tool-memory`, and `dsh-tool-session-query` rows to `hermes-brain` (and `dsh-persona`, `dsh-tool-memory` to `hermes-worker`).
7. **Verification**: Run complete unit, concurrency, invariant (`INV-08`, `INV-09`), and HMR test suites.

## 12. Acceptance Criteria

- [ ] `MemoryStore` service definition published and merged into Cordis `Context` under key `memory`.
- [ ] `LocalMemoryStore` reads and writes `USER.md` and `MEMORY.md` delimited strictly by `\n§\n`.
- [ ] Concurrent writes to memory files across separate processes are serialized via POSIX file locks without data corruption.
- [ ] Memory prompt snapshot captured at session initialization remains byte-identical across all turns of an active conversation (`INV-08`).
- [ ] `SOUL.md` is rendered as Identity Slot #1 in system prompt via `@deepseek-ai/dsh-persona` at order `DEPLOYMENT_PERSONA_PREFIX = 0`.
- [ ] Tool registry reflection verifies that no autonomous agent tool allows editing or mutating `SOUL.md` (`INV-09`).
- [ ] `memory` tool supports `add`, `replace`, `remove`, and batch `operations`.
- [ ] Batch memory operations defer character limit enforcement to the final state, permitting simultaneous remove + add when at capacity.
- [ ] Input containing prompt injection vectors or invisible control characters is rejected with `MemoryThreatDetectedError`.
- [ ] Malformed memory files lacking delimiters trigger automatic `.bak.<timestamp>` generation and fail closed with `MemoryDriftError`.
- [ ] Existing `@deepseek-ai/dsh-tool-session-query` is reused in `hermes-brain` preset, querying historical sessions via `ctx.sessionQuery` with `maxSearchResults: 20` without creating a duplicate package.
- [ ] Hot module replacement cleanly unregisters prompt sections and tools without orphaned listeners.

## Review fixes applied

- **REVIEW-seams Finding 2 (Duplicate Session Search Package)**:
  - Eliminated proposed duplicate package `@deepseek-ai/dsh-tool-session-search`.
  - Reused existing shipped tool package `@deepseek-ai/dsh-tool-session-query` (`packages/session-query/tool-session-query/`) across all sections: features list, architecture fit, spec coverage, package layout, contracts, lifecycle, preset integration, testing strategy, implementation steps, and acceptance criteria.
  - Documented out-of-the-box capabilities (`session_search`, `session_event_search`, `session_trace`, `session_event_trace`, `session_event_read`, workspace `cwd` equality check, cursor-free excerpts) and confirmed only preset configuration (`maxSearchResults: 20`, `searchTimeoutMs: 15000`) was needed.
- Added `## Port sources` section detailing source mappings from Hermes repositories (`tools/memory_tool_store.py`, `tools/memory_tool.py`, `tools/threat_patterns.py`, `agent/prompt_builder.py`, `tools/file_tools_write_guards.py`, and `tools/session_search_tool.py`) to accelerate memory subsystem implementation.
