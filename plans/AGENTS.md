# Axioms — DeepSeek Harness work

Colocated axioms governing everything under `plans/`. Machine-checkable axioms are fenced
`axiom` blocks; prose axioms bind the model but are not mechanically evaluated.

## META AXIOM — Harness patterns are mandatory

Every implementation produced from these plans MUST follow current DeepSeek Harness
patterns. This overrides convenience, familiarity, and any pattern carried in from another
framework, from Hermes, or from the model's own training.

Concretely, for any unit of work:

1. The correct Harness primitive owns the behavior — Service Definition, Service Provider,
   Consumer, model-facing tool, event/hook plugin, agent-preset composition, skill, skill
   provider, subagent provider, subagent consumer, workflow capability, session projection,
   session event, command, profile, bundle, patch layer, or client UI extension. "Plugin"
   is not an answer.
2. Existing seams are reused before new ones are invented. If Harness already ships the
   capability, compose it; do not reimplement it.
3. Registrations are effects (`ctx.effect()` / `ctx.on()`); registries return disposers.
4. Plugins depend through declared `inject` services and published events, never by reaching
   into another plugin.
5. Host plane versus agent plane is decided by the rules in `PRESET-RULES`, and every service
   row inside a preset sits in a `cordis:group` carrying an `isolate` realm.
6. Durable state uses the session/event/projection conventions or `ctx.storageDomain`; it does
   not invent private persistence.
7. Deployment-varying values are validated `Config` fields changeable from `cordis.yml`.
   A `DEFAULT_*` constant is not configurability.
8. Core modification is a last resort and requires the full register: desired behavior, every
   extension point considered, why each is insufficient, why it cannot live in an adjacent
   plugin, and the smallest possible change.

```axiom
id: R-harness-primitive-declared
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "scripts/check-piece-primitive.sh"
description: >-
  Every piece file declares a Harness primitive from the closed vocabulary in its
  `## Harness fit` section, and names the owning package.
```

```axiom
id: R-piece-size
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "awk 'END{exit (NR>280)}' \"$FILE\""
description: >-
  A piece file is at most 280 lines. The ceiling tracks the mandatory content: 160 originally,
  raised to 220 when the visibility, teaching and reuse-capture sections became mandatory, and
  raised to 280 when `Resources and proof` became required and the teaching contract grew its
  approaches, prior-art, concepts, interview and decision-rights subsections. Measured on the
  fullest piece, those additions cost about 60 lines. The ceiling is a forcing function, not a
  target: the median piece is well under half of it, and a unit of work that genuinely needs
  this much room to describe is usually two pieces.
```

```axiom
id: R-piece-required-sections
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "scripts/check-piece-sections.sh"
description: >-
  Every piece carries: Summary, Behaviour (Given/When/Then), Harness fit, Contracts,
  Dependencies, References, Acceptance.
```

## Axiom — no invented delegation or evidence

No document may claim an agent was invoked, a source was inspected, a benchmark exists, a
model is available, or a verification ran, unless it actually happened. Reported findings
carry the role and preset that produced them, and are distinguishable from direct inspection.

## Axiom — specs are ingestion-sized

A specification is written to be consumed one component at a time. Large monolithic plan
documents are a defect, not a style preference. The unit of review, approval, delegation and
implementation is one piece.

## META AXIOM — every completed task is visible to the owner

A task is not done when the code works. It is done when the owner can SEE it working.

Every completion report MUST state, concretely and specifically, how to observe the result:

- For an API surface: the exact endpoint, method, a runnable example request, and the response
  the owner should expect to see.
- For a UI surface: the exact route or screen, how to reach it from a running app, what
  command starts that app, and what the owner should see on screen.
- For a CLI or command surface: the exact command line and its expected output.
- For a behaviour with no direct surface: the exact test command that demonstrates it, and the
  assertion output that proves it.

The report states what to run, where to look, and what a correct result looks like. "Tests
pass" is not an answer to "how do I see it". A report that cannot answer this is incomplete,
and the task stays open.

```axiom
id: R-piece-visible-result
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "grep -q '^## How to see it' \"$FILE\""
description: >-
  Every piece carries a `## How to see it` section naming the endpoint, route, command or
  test that lets the owner observe the finished behaviour, and what a correct result looks
  like.
```

## META AXIOM — teach while building

Every unit of work teaches its owner, who is to be treated as a junior developer becoming a
better developer by building this system. Never assume prior knowledge of the architecture,
libraries, terminology, design patterns, framework features, or techniques in use. Simplify
the explanation, never the underlying concept, and keep correct technical terminology.

The purpose is to build a second brain and a future partner, not to produce documentation.
Teaching succeeds when the reader can later influence this project's direction, pick up tasks
without a briefing, and be trusted to make calls of their own. Write for a reader who will
ACT on this, not merely understand it: transfer the judgment behind the decision, not only the
facts of it, and be explicit about what remains uncertain so that reader can disagree with you
on evidence rather than deferring. A passage that leaves them able to recite the design but
unable to extend it has failed, however accurate it is.

Each piece and each completion report carries a teaching section that explains:

- **What it does** — the behaviour in plain language.
- **Background** — the framework, library or concept knowledge needed FIRST. Define each
  technical term on first use. Never explain one unfamiliar concept using five others.
- **How it works here** — grounded in the real files and code of this project: what calls it,
  what inputs arrive, what happens internally, what it calls next, what comes back, and what
  happens on failure. Point at actual files and say what to look at in them.
- **Why this approach** — the design decision, the simplest alternative, and when that
  alternative would be the better choice. Not every small decision needs a debate.
- **Approaches considered** — two to four REAL candidate approaches, never straw men. For each:
  what it is, who actually uses it, its tradeoffs, and the conditions under which it would win
  here. At least one candidate comes from outside this repository. When the space is genuinely
  narrow, say so and explain why rather than inventing rivals.
- **Prior art inspected** — the named external projects, libraries, specifications or standards
  actually examined for this piece: the project, the exact file, module, RFC section or API
  inspected, what idea was taken, adapted or rejected, and whether any code was reused and
  under which license. Distinguish reading the source from reading the README from inferring
  from observed behaviour. NEVER name a project that was not opened; delegate the check to a
  Research agent or state that no prior art was inspected.
- **What we get for free** — explicitly separate our application logic from framework
  behaviour, library behaviour, generated code, configuration and infrastructure. Name which
  capabilities of the dependency we use, what it saves us writing, what conventions it
  expects, and which related capabilities we are deliberately not using yet.
- **From the docs** — only when documentation materially informed the decision: the source,
  the section, a short verified quote, its plain-English meaning, and how it affects the
  implementation. NEVER invent a documentation quote. If the documentation was not actually
  inspected, say so, or delegate the check to a Research agent.
- **What to notice** — one or two specific things to look at in the code.
- **Concepts to own** — the transferable computer-science and engineering concepts this piece
  exercises, named with their standard industry terminology, not this repository's local
  vocabulary. Each concept gets its correct name, a one-line definition, and the exact place in
  this piece where it appears, so the owner can recognise the same concept in unfamiliar code.
- **Interview angle** — how this work answers questions asked in software-industry interviews:
  the question it plausibly answers, a crisp answer grounded in THIS implementation rather than
  in generic advice, and the follow-up question an interviewer would ask next. System-design,
  coding, and debugging angles all count. Omit it when the piece is pure boilerplate, and say
  why.
- **Decisions you can now make alone** — the concrete calls this piece equips the reader to
  make without asking: which changes are safe to make here unaided, which still need
  escalation and to whom, and the open questions where their judgment is genuinely wanted.
  This is the measure of whether the teaching worked; a piece that transfers no decision
  authority transferred no understanding.
- **What you should learn from this** — one short transferable lesson.

Additional obligations:

- Teaching accompanies meaningful units of work, not every command or file edit. Explain the
  code that carries an important idea — boundaries, data transformation, state, async
  behaviour, persistence, API surfaces, auth, error handling, concurrency, caching, injection,
  lifecycle, abstractions, tests, security and performance decisions. Skip routine imports and
  boilerplate.
- Tests are taught as evidence of behaviour: say what an important test PROVES, and for
  test-first work explain the progression — what behaviour was missing at RED, what
  implementation produced GREEN, what review then found.
- Failures teach too: symptom, expectation, cause, how the cause was found, the fix, and the
  general debugging lesson. Do not present the final implementation as if it were obvious.
- Research is part of implementation, not a preliminary to it. Reaching a defensible approach
  requires looking outward — documentation, specifications, comparable open-source
  implementations — and `Approaches considered` and `Prior art inspected` are where that
  looking is recorded. A piece whose teaching section names no external source and no rejected
  alternative is evidence that the exploration did not happen.
- Explanations build progressively. Explain a concept thoroughly the first time; later, recall
  it in one line and teach only the new part.
- Never fake certainty. Keep documentation statements, source-code evidence, test evidence,
  external-repository behaviour, proposals, inference and open questions distinguishable.

```axiom
id: R-piece-teaches
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "grep -q '^## Teach me while you build' \"$FILE\""
description: >-
  Every piece carries a `## Teach me while you build` section grounded in this project's real
  code, defining its terms, separating framework-provided behaviour from what we write,
  recording the candidate approaches and the external prior art actually inspected, naming the
  transferable concepts and their interview angle, and ending with a transferable lesson.
```

## META AXIOM — capture reusable knowledge, do not prematurely generalize

Explanations, decisions, research findings, tests and debugging discoveries are inputs to a
reusable engineering knowledge base. Solve the concrete problem first; leave behind enough
structured evidence that a later Research/Utility agent can extract what is worth reusing.
Do not turn everything into a shared abstraction while building.

For a significant unit of work, preserve when relevant: the problem solved, the context, the
constraints, the files involved, the framework or library capabilities used, the external
implementations or documentation that influenced it, the alternatives considered, why this
approach won, the tests that demonstrate the behaviour, the problems hit during
implementation, what fixed them, the known limitations, and the situations where this
solution should NOT be reused.

**Reuse candidates are marked, not extracted.** When something looks reusable, record:

```
Reuse candidate: <name>
What it does: <plain English>
Current usage: <where and why>
Potential reuse: <other situations>
What would need to become generic: <project-specific assumptions to remove>
Evidence: <code, tests, docs, observed behaviour>
Confidence: low | medium | high
```

Looking generic is not evidence. A candidate normally needs at least one working
implementation; higher confidence comes from repeated use or independent verification.

**Failures are preserved when they teach.** What was tried, why it seemed reasonable, what
happened, why it failed, how it was diagnosed, what worked instead, and when the rejected
approach would still be appropriate. Not trivial typos — failures that teach something
transferable about the framework, architecture, dependency, tooling or process.

**Keep the eight kinds distinct; do not flatten them into a "best practices" list:**
reusable code · reusable implementation pattern · reusable architecture decision · reusable
dependency or plugin · reusable agent workflow · reusable test pattern · reusable lesson ·
anti-pattern or warning.

**Context is part of the knowledge.** A rule without its conditions is dangerous. Record
"optimistic updates suited this reversible, predictable task-state transition; do not apply
them to irreversible billing or destructive operations" — never "always use optimistic
updates". The system learns conditional patterns, not universal rules.

**Extraction is periodic and advisory.** A later Research/Utility agent inspects completed
work to propose consolidation, missing abstractions, guardrails, automation, internal
documentation and reusable test helpers. It PROPOSES; it does not rewrite shared
infrastructure on its own.

```axiom
id: R-piece-reuse-capture
severity: warning
applies_to: plans/pieces/**/*.md
check: shell
command: "grep -q '^## Reuse capture' \"$FILE\""
description: >-
  Every piece carries a `## Reuse capture` section marking reuse candidates with evidence and
  confidence, or stating explicitly that the piece produces none.
```

## META AXIOM — finished work moves to `done/`

A piece that is complete does not stay in the plan set. It moves to a `done/` folder, so the
remaining plan is always the remaining work and progress is visible by looking at the tree.

- Each set directory has a sibling `done/` subdirectory: `<set>/done/`.
- A piece moves there after implementation passes the frozen tests, transfer to master, and
  successful post-transfer tests. No separate Reviewer stage is required. Move it and update
  the index promptly, then commit the completed milestone; do not push without authorization.
- The move preserves the filename and its id, so references from other pieces stay resolvable.
  A piece referring to a completed dependency looks in `<set>/done/` for it.
- The set README records the move: the index shows each piece as pending or done and where it
  now lives, so the README alone answers "what is left".
- Nothing is deleted. `done/` is the record of what was built and how, and it feeds the
  reuse-capture extraction pass.
- A piece that is superseded rather than completed goes to trash per the override rule, not to
  `done/` — `done/` means built, trash means discarded.

```axiom
id: R-done-pieces-moved
severity: warning
applies_to: plans/pieces/**/*.md
check: shell
command: "scripts/check-done-pieces.sh"
description: >-
  No piece whose status is `done` remains in its set directory; it lives in the set's `done/`
  subdirectory, and the set README reflects its status.
```

## META AXIOM — verify the spec, do not follow it blindly

A design piece is a set of CLAIMS, not a set of orders. Whoever implements it is responsible for
checking it before building on it. A piece was written by an agent working from evidence that may
be stale, partial, or simply wrong, and implementing a wrong claim faithfully is still a defect.

Before implementing, verify every load-bearing claim the piece makes:

- **Claims about this repository** — that a file, service, export, event, table or behaviour
  exists as described. Open it. Paths drift, APIs change, and file:line citations rot.
- **Claims about a dependency or framework** — that an API exists, behaves as stated, and is
  available in the pinned version. Check the installed version, not the latest documentation.
- **Claims about an external project** — that it implements what the piece says it does. Read the
  source, not the README.
- **Claims about performance, limits, quotas or hardware** — treat as unverified until measured on
  the target machine. A number nobody measured is a guess wearing a number's clothes.
- **Claims that something does not exist** — the most dangerous kind, because it justifies writing
  new code. Search before accepting it.

Delegate this checking. A Research preset exists for exactly this: give it the specific claim and
the decision that rests on it, require the exact file, symbol, section or version as evidence, and
keep its findings distinguishable from your own inspection. Do not re-derive alone what a
specialist can verify faster, and do not accept a specialist's report as proof that YOU inspected
the source.

When verification contradicts the piece: STOP and report the contradiction with its evidence.
Do not silently implement the corrected version, and do not implement the wrong version because
the piece said so. The piece is amended first, then the work proceeds. A contradiction found
during implementation is a valuable result, not an obstacle — record it.

Unverifiable claims are marked UNVERIFIED in the piece rather than quietly assumed. An
implementation resting on an unverified claim says so in its completion report.

```axiom
id: R-claims-verified
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "scripts/check-claim-citations.sh"
description: >-
  Every load-bearing claim in a piece carries a citation in its `## Resources and proof` table,
  marked as directly inspected, reported by a named role, or UNVERIFIED.
```

## META AXIOM — resources and citations of proof

Every piece carries a `## Resources and proof` section serving two audiences: the implementer who
must trust it, and the owner who is learning from it.

It contains:

- **A proof table** — one row per load-bearing claim: the claim, the citation that proves it
  (repository path with symbol, documentation section, specification clause, or external source),
  how it was established (direct inspection / reported by a named role and preset / measured /
  UNVERIFIED), and the date or version it was checked against.
- **Learning resources** — where the owner goes to understand this properly: official
  documentation sections, specifications, the source files worth reading in this repository, and
  the external projects that solve the same problem well. Each with one line on what it is good
  for, so the list is a reading path rather than a link dump.

Rules: never cite something that was not opened. A quote is verbatim or it is not a quote.
Distinguish the specification from one implementation of it. Prefer a primary source to a summary
of it, and say when only a summary was available. Version-pin anything that changes.

## META AXIOM — isolate with worktrees, never with branches

Parallel agents need isolated workspaces. They do not need branches, and branches are the wrong
tool here: a branch is easy to forget, easy to leave behind, and it hides work from the owner who
has to see everything that gets committed. Every branch created is a place the owner is not
looking.

- **Do not create branches.** Not for a piece, not for a role, not for a subagent. Work lands on
  the mainline where it is visible.
- **Isolate with a detached worktree** under the ignored `.worktrees/` directory — one per
  concurrent worker, created from the current mainline commit with a detached `HEAD`, never with
  `-b`. Several workers may then hold the same commit at once, which a branch checkout forbids.
- **Verify the worktree root is ignored before creating anything in it.** An unignored worktree
  directory commits an entire second copy of the tree.
- **Detect existing isolation first.** When `git rev-parse --git-dir` and `--git-common-dir`
  differ and the directory is not a submodule, the worker is already isolated; do not nest
  another worktree inside it.
- **Merge work back to the mainline, then remove the worktree.** A worktree is a scratch space
  with a lifetime, not a place work accumulates. Between units of work, `git worktree list`
  should show only the main checkout, with no detached worker worktrees remaining.
- **Implement against frozen tests.** The Test Writer hands off tests and behavioral RED proof.
  The Implementer changes production code, not the handed-off tests. A necessary test correction
  returns to the Test Writer and establishes a new recorded baseline before implementation.

```axiom
id: R-no-feature-branches
severity: blocker
applies_to: plans/pieces/**/*.md
check: shell
command: "scripts/check-no-branches.sh"
description: >-
  No piece creates a git branch. Isolation uses detached worktrees under the ignored
  `.worktrees/` directory, and finished work merges to the mainline, so every commit stays
  visible to the owner in one place.
```
