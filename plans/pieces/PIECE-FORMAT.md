# Micro-gate format (Piece format)

One micro-gate = one atomic component an agent can ingest, specify with frozen BDD tests, implement to green, and verify through gates in a single focused sitting.
Hard limit: 280 lines (strictly tracking the `R-piece-size` axiom). If a component does not fit within 280 lines, it is too coarse and must be decomposed into sequential micro-gates (`a`, `b`, `c`, ...).

## Micro-gate Filename & ID Grammar

- **Filename format**: `NN.MM[a-z]-<kebab-slug>.md` (e.g. `00.01a-heading-scanner.md`)
- **ID format**: `NN.MM[a-z]?` (e.g. `00.01a` or legacy `00.01`)
- **Location**:
  - Active / todo / pending micro-gates live directly in their numbered set folder: `plans/pieces/<set>/`
  - Completed micro-gates live in the set's done subdirectory: `plans/pieces/<set>/done/`

---

## The 5 Developer Personas

Every micro-gate is authored and championed by a specialized persona from the harness roster (`packages/dev-loop/roles/src/personas.ts`). The persona shapes the voice, teaching metaphors, inquiry angles, and candidate choices:

1. 🐾 **Neko-chan (Inspector Cat / Pure Intake)**:
   - *Domain*: Markdown AST extraction, heading scanning, metadata parsing, BDD parsing, syntax & schema validation.
   - *Voice*: Playful, inquisitive, cat puns (`nya~`, `paw-sitive`), sensory metaphors (scent of fresh files, purring validators).
2. 🍰 **L (Forensic Detective / Epistemic Auditor)**:
   - *Domain*: Proof tables, citation verification, cryptographic SHA-256 tokens, CAS claim verification, fail-closed gates, epistemic bounds.
   - *Voice*: Hyper-analytical, calm, percentages & probability bounds, deductive reasoning ("We observe X. Therefore hypothesis Y is eliminated.").
3. 💻 **Daru (Super Hacker / Subprocesses & Plumbing)**:
   - *Domain*: Git worktree allocation, child subprocess runners, SQLite schemas, write-ahead logging (WAL), crash recovery hydration, hard test rigs.
   - *Voice*: Tech-savvy, pragmatic, otaku slang, zero tolerance for fluffy abstractions over concrete system calls.
4. 🔬 **Hououin Kyouma (Mad Scientist / Divergence Controller)**:
   - *Domain*: Four Gates verification (Format, Red Baseline, Green Worktree, Mainline Transfer), pre-complete hooks, anti-cheat detection, world line divergence.
   - *Voice*: Dramatic, grandiose, Steins;Gate references ("El Psy Kongroo", reading Steiner, divergence meters), uncompromising vetoes against regression.
5. 🌸 **Mayuri (Gentle Seamstress / UX & Roster Harmony)**:
   - *Domain*: Markdown presentation cards, operator slash commands (`/approve`, `/reject`), multi-turn interactive questions, preset tool composition.
   - *Voice*: Warm, empathetic, human-centered (`tut-turii~`), focuses on operator clarity and reducing cognitive burden.

---

## Micro-Gate Canonical Template

Every micro-gate MUST carry all 11 canonical sections in exact order:

```markdown
# NN.MM[a-z] — <Title>

**Set:** <set name> · **Queue:** <sequential number> · **Depends on:** <piece ids, or none>
**Lead Developer:** <Persona or Role>
**Status:** todo | pending | done | blocked  (a `done` piece lives in `<set>/done/`; `blocked` is set by the loop when a gate or subagent fails)
**Primitive:** <primitive> · **Package:** `<package or module>`

> **Header generalization**:
> - `**Primitive:**` (or `**Harness primitive:**`): Architectural primitive, matching standard modular software primitives (`Service`, `Module`, `Package`, `Library`, `Component`, `Function`, `CLI`, `API`, `Hook`, `Plugin`, `Store`, `Worker`, `Workflow`) or framework-specific primitives.
> - `**Package:**` (or `**Module:**` or `**Component:**`): Owning package, module, or component name.
> - `**Lead Developer:**` (or `**Lead:**` or `**Author:**`): Responsible persona or engineering role.

## Summary

What it does (2-4 sentences in the authoring persona's voice) and how it does it (exact mechanism and seam). Written so the reader can approve or redirect without opening another file.

### Human Decision Point: Option A vs Option B
- **Option A (Active)**: <the chosen approach and its concrete trade-offs>
- **Option B (Alternative)**: <the rejected approach and why it was passed over>

## Behaviour

Given / When / Then BDD scenarios (2-6 scenarios). Each scenario is an executable test specification:
- **Given** <initial state> **When** <trigger or input> **Then** <observable outcome>

## Architecture fit

Why this primitive and seam were chosen. Mentions the system architectural plane, service entry point, and extension contract (written as `## Architecture fit` or `## Harness fit`).

## Contracts

TypeScript interfaces, type signatures, config schemas, or event maps. Compact code block without filler.

## Dependencies

Micro-gates that must reach `done` first, and the exact contracts/exports assumed from each.

## References

Real sources inspected to author the micro-gate:

| Source | Role/preset that inspected it | Question it answered | Direct inspection or reported | How it was used |
|---|---|---|---|---|
| `path/to/file:line` | <role or persona> | <concrete question> | direct inspection / reported by <persona> | <usage> |

## How to see it

Concrete instructions for the owner to observe the working code:
- Command line to run (e.g. `pnpm exec vitest run ...`)
- Exact test names and expected terminal output assertion
"Tests pass" is not an answer. Name what to run, where to look, and what correct looks like.

## Teach me while you build

The educational heart of the micro-gate, narrated in the authoring persona's voice:
- **Background**: Prerequisite concept defined simply before code is read.
- **How it works here**: Concrete file paths, call order, inputs, outputs, failure mode.
- **Why this approach**: Explicit Option A vs Option B decision with rationale.
- **Approaches considered**: 2-4 real candidate approaches with tradeoffs.
- **Prior art inspected**: External libraries or specs opened (with exact files/APIs).
- **What we get for free**: Framework capabilities used vs code we write.
- **What to notice**: Concrete implementation nuance to inspect in the code.
- **Concepts to own**: Transferable CS concept defined in standard terminology.
- **Interview angle**: Plausible interview question, crisp answer, follow-up.
- **Decisions you can now make alone**: Concrete calls the owner is now equipped to make.
- **Lesson**: One transferable takeaway.

## Resources and proof

Load-bearing claims proof table:

| Claim | Citation | How established | Checked against |
|---|---|---|---|
| <claim statement> | <repo path + symbol, doc, or spec> | direct inspection / reported by <persona> / measured / unverified | <date or version> |

Never cite what was not opened. A quote is verbatim or it is not a quote. Prefer primary sources.

## Reuse capture

Knowledge capture for future extraction:
- **Reuse candidate**: name · what it does · current usage · potential reuse · what to generalize · evidence · confidence
- **Known limitations**: conditions where this should NOT be reused
- **Failure worth keeping** (if any): what was tried, why it failed, what worked instead, and when the rejected approach would still fit

State "no reuse candidates" explicitly when there are none. Looking generic is not evidence.

## Acceptance

Checklist of concrete, objectively verifiable conditions for completion.
```

---

## Granularity & Decomposition Rules

1. **Atomic Seam Boundary**: A micro-gate must never mix disparate concerns across packages or planes. Each micro-gate targets one distinct parser, command, state edge, table, or verification gate.
2. **BDD Sizing**: The scenarios in `## Behaviour` must be small and precise enough for the Test Writer to author a focused RED test suite immediately without mock explosion or test runner timeouts.
3. **Strict Line Ceiling (`R-piece-size`)**: Max 280 lines per markdown file. If teaching, contracts, or scenarios push a file past 280 lines, decompose the unit of work into `a`, `b`, `c` micro-gates.
4. **Unique Sequential Queue Numbers**: Queue numbers across a set must be unique, strictly positive integers ordered sequentially.
5. **Persona Authorship**: The micro-gate must adopt its authoring persona's voice and domain focus throughout `Summary`, `Why this approach`, and `Teach me while you build`.
6. **Proof Table Establishment**: The third column of the `Resources and proof` table must explicitly use one of: `direct inspection`, `measured`, `reported by <persona>`, `readme only`, or `unverified`.
7. **Lifecycle Placement (`R-done-pieces-moved`)**: Completed micro-gates move to `<set>/done/` with an updated row in the set's `README.md`. Todo and pending micro-gates stay at the set root.
8. **Atomic Micro-Sizing & Cognitive Ceiling (Non-Reliance on Frontier Models)**:
   A micro-gate must be micro enough that an **Index 2 (Balanced / Core Engineering) model** (e.g. Gemini 3.8 Flash-Medium, Claude Sonnet, GPT-5-mini, GLM-Flash) can implement and test it in a single pass without cognitive collapse or hallucination. Never force an implementer to juggle multi-package complexity or make unguided architectural choices:
   - Target scope: Exactly ONE pure function or isolated service method ($\le 50$ lines of production code) and 2–4 crisp Given/When/Then scenarios ($\le 35$ lines of test code).
   - Pre-decided architecture: Explicit `### Human Decision Point: Option A vs Option B` in `## Summary`.
   - Complete contract: Self-contained, compilable TypeScript interface definitions in `## Contracts`.
9. **Intelligence Index Floor & The Strict Non-Downgrade Invariant**:
   Subagent delegation must strictly match or exceed the task's required intelligence index floor:
   - **Index 3 Floor**: Multi-package integrations, architectural refactoring, complex AST parsers/compilers, state-machine synchronization, and formal verification gates (Gates 1–4).
   - **Index 2 Floor**: Behavioral test authoring against Given/When/Then contracts, feature implementation in `packages/` to satisfy frozen tests, schema validation.
   - **Index 1 Floor**: Purely mechanical chores (moving files to `done/`, updating markdown table rows in `README.md`, running linters, simple regex checks).
   *Non-Downgrade Rule*: Never downgrade an Index 2 or Index 3 task to an Index 1 model to save tokens or bypass slot waits. If an Index 2 model is busy, promote upward (to Index 3) or queue; never downgrade downward.
10. **Resilient Delegation & Failure Recovery**:
    - **Usage Limits / 429 Failover**: If a subagent call hits rate limits or quota exhaustion, immediately failover to the next candidate in the fallback chain for that intelligence tier (Index 2: `opencode-go/glm-5.3-flash` → `zai/glm-5.3-flash` → `gemini-3.8-flash-medium` → `gpt-oss-120b-medium` → OpenRouter Free). If tier exhausted, promote upward to Index 3. Never downgrade downward.
    - **Subagent Failures & Bounded Retries**: If a worker crashes or fails gates, inspect diagnostics and retry up to 2 times after cleaning the worktree (`git checkout . && git clean -fd`). If unresolved after 2 retries, mark status as `blocked` in `todo_write` and `goal`, and advance to the next candidate.
    - **Slot Hygiene**: Cleanly terminate and drain stalled subagents to release slots before spawning replacements.
